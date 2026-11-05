import { getNextSingleWidthAndHeightFromPointer, getTransformHandles } from "@excalidraw/element";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  isNativeLinkedArrow,
  isNativeOrbitLinkedArrow,
  isSafeBoundBox,
  syncNativeBindings,
} from "./bindings";
import { canEditIndependently, editableSelection } from "./groups";
import {
  deleteNativeElementsWithCore,
  dragNativeSelectionWithCore,
  resizeNativeBoxWithCore,
  resizeNativeImageWithCore,
  rotateNativeBoxWithCore,
  rotateNativeImageWithCore,
  updateNativeElement,
  nativeElementsMap,
} from "./coreAdapter";
import { nativeLabelBox, syncNativeBoundLabels } from "./boundText";
import { nativeImageSource } from "./images";

import type { Point, SceneFile } from "./scene";

export type Corner = "nw" | "ne" | "sw" | "se";
export type Handle = Corner | "rotate";

const MIN_SIZE = 8;
const corners: Corner[] = ["nw", "ne", "sw", "se"];

const rotatePoint = (
  point: Point,
  center: Point,
  angle: ExcalidrawElement["angle"],
): Point => {
  const [x, y] = pointRotateRads(
    pointFrom(point.x, point.y),
    pointFrom(center.x, center.y),
    angle,
  );
  return { x, y };
};

export function isBoxTransformable(
  element: ExcalidrawElement,
  scene?: SceneFile,
): boolean {
  return (
    (element.type === "rectangle" ||
      element.type === "ellipse" ||
      element.type === "diamond" ||
      (element.type === "image" &&
        element.width > 0 &&
        element.height > 0 &&
        !!scene &&
        !!nativeImageSource(scene, element))) &&
    !element.isDeleted &&
    !element.locked &&
    !element.frameId &&
    element.groupIds.length === 0 &&
    !(scene && element.boundElements?.some((ref) => {
      const arrow = scene.elements.find((item) => item.id === ref.id);
      return !!arrow && isNativeOrbitLinkedArrow(scene, arrow);
    })) &&
    (!element.boundElements?.length ||
      (!!scene && isSafeBoundBox(scene, element)))
  );
}

export const canMove = canEditIndependently;

/** Handles in world coordinates, including rotated elements. */
export function handleLocations(
  element: ExcalidrawElement,
): Record<Handle, Point> {
  const { x, y, width, height, angle } = element;
  const center = { x: x + width / 2, y: y + height / 2 };
  return {
    nw: rotatePoint({ x, y }, center, angle),
    ne: rotatePoint({ x: x + width, y }, center, angle),
    sw: rotatePoint({ x, y: y + height }, center, angle),
    se: rotatePoint({ x: x + width, y: y + height }, center, angle),
    rotate: rotatePoint({ x: center.x, y: y - 28 }, center, angle),
  };
}

/**
 * Excalidraw owns the location and zoom-dependent size of the native
 * transform handles. The Svelte layer only converts the core's rectangle
 * records into centers for painting and pointer hit-testing.
 *
 * Retain legacy handleLocations solely for guarded cropped-image anchors.
 */
export function coreHandleLocations(
  element: ExcalidrawElement,
  zoom: number,
  scene?: SceneFile,
): Record<Handle, Point> | null {
  if (!Number.isFinite(zoom) || zoom <= 0 || !isBoxTransformable(element, scene)) {
    return null;
  }
  const handles = getTransformHandles(
    element,
    { value: zoom } as Parameters<typeof getTransformHandles>[1],
    nativeElementsMap(scene ?? { elements: [element] }),
    "mouse",
  );
  const center = (
    box: readonly [number, number, number, number] | undefined,
  ): Point | null => box
    ? { x: box[0] + box[2] / 2, y: box[1] + box[3] / 2 }
    : null;

  const nw = center(handles.nw);
  const ne = center(handles.ne);
  const sw = center(handles.sw);
  const se = center(handles.se);
  const rotate = center(handles.rotation);

  return nw && ne && sw && se && rotate
    ? { nw, ne, sw, se, rotate }
    : null;
}

export function pickHandle(
  element: ExcalidrawElement,
  point: Point,
  tolerance = 9,
  scene?: SceneFile,
  zoom = 1,
): Handle | null {
  if (!isBoxTransformable(element, scene)) {
    return null;
  }
  const locations = coreHandleLocations(element, zoom, scene) ?? handleLocations(element);
  for (const key of [...corners, "rotate"] as Handle[]) {
    if (
      Math.hypot(point.x - locations[key].x, point.y - locations[key].y) <=
      tolerance
    ) {
      return key;
    }
  }
  return null;
}

/**
 * Drag a corner while keeping the opposite world-space corner fixed.
 * For rotated shapes, project onto the local axes and reconstitute world
 * coordinates. Below the minimum size, clamp rather than flipping.
 */
export function resizeElement(
  element: ExcalidrawElement,
  corner: Corner,
  target: Point,
  scene?: SceneFile,
): ExcalidrawElement {
  if (!isBoxTransformable(element, scene)) {
    return element;
  }
  const loc = handleLocations(element);
  const opposite: Record<Corner, Corner> = {
    nw: "se",
    ne: "sw",
    sw: "ne",
    se: "nw",
  };
  const fixed = loc[opposite[corner]];
  // Excalidraw owns local-axis pointer projection for rotated and
  // unrotated shapes; Svelte keeps only its current no-flip/min-size UI
  // policy and the world-space opposite-corner anchor.
  const { nextWidth: projectedWidth, nextHeight: projectedHeight } =
    getNextSingleWidthAndHeightFromPointer(
      element,
      element,
      corner,
      target.x,
      target.y,
    );
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  const horizontalSign = corner.endsWith("e") ? 1 : -1;
  const verticalSign = corner.startsWith("s") ? 1 : -1;
  // Image resize keeps the existing crop and flipped axes while preserving
  // the displayed aspect ratio. Shapes retain independent width and height.
  const ratio = element.width / element.height;
  const imageHeight =
    element.type === "image" && Number.isFinite(ratio) && ratio > 0
      ? Math.max(
          MIN_SIZE,
          MIN_SIZE / ratio,
          (ratio * projectedWidth + projectedHeight) / (ratio * ratio + 1),
        )
      : null;
  const width =
    imageHeight === null
      ? Math.max(MIN_SIZE, projectedWidth)
      : ratio * imageHeight;
  const height =
    imageHeight === null ? Math.max(MIN_SIZE, projectedHeight) : imageHeight;
  const centerOffset = {
    x: (horizontalSign * width) / 2,
    y: (verticalSign * height) / 2,
  };
  const center = {
    x: fixed.x + centerOffset.x * cos - centerOffset.y * sin,
    y: fixed.y + centerOffset.x * sin + centerOffset.y * cos,
  };
  return updateNativeElement(element, {
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
  });
}

export function rotateElement(
  element: ExcalidrawElement,
  point: Point,
  scene?: SceneFile,
): ExcalidrawElement {
  if (!isBoxTransformable(element, scene)) {
    return element;
  }
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  let angle = Math.atan2(point.y - cy, point.x - cx) + Math.PI / 2;
  if (angle > Math.PI) {
    angle -= Math.PI * 2;
  }
  return updateNativeElement(element, {
    angle: angle as ExcalidrawElement["angle"],
  });
}

export function moveSelection(
  scene: SceneFile,
  ids: readonly string[],
  dx: number,
  dy: number,
): SceneFile {
  if ((!dx && !dy) || ids.length === 0) {
    return scene;
  }
  const selected = new Set(editableSelection(scene, ids));
  if (!selected.size) {
    return scene;
  }
  // Core owns group movement, bound labels and reciprocal arrow updates.
  // Native policy has already narrowed this to valid editable roots/groups.
  const moved = syncNativeBoundLabels(
    dragNativeSelectionWithCore(scene, selected, dx, dy),
    selected,
  );
  // The core drag engine calls updateBoundElements for moved boxes. Refuse
  // the whole gesture if it ever breaks a reciprocal orbit relationship.
  if (moved !== scene && scene.elements.some((element) =>
    isNativeOrbitLinkedArrow(scene, element) &&
    !isNativeOrbitLinkedArrow(
      moved,
      moved.elements.find((item) => item.id === element.id) ?? element,
    )
  )) {
    return scene;
  }
  return moved;
}

export function deleteSelection(
  scene: SceneFile,
  ids: readonly string[],
): SceneFile {
  const selected = new Set(editableSelection(scene, ids));
  const wanted = new Set(ids);
  for (const element of scene.elements) {
    if (wanted.has(element.id) &&
      (isNativeLinkedArrow(scene, element) ||
        isNativeOrbitLinkedArrow(scene, element))) {
      selected.add(element.id);
    }
  }
  if (!selected.size) {
    return scene;
  }
  for (const element of scene.elements) {
    const box = nativeLabelBox(scene, element);
    if (box && selected.has(box.id)) {
      selected.add(element.id);
    }
  }
  return deleteNativeElementsWithCore(scene, selected);
}

export function transformSelected(
  scene: SceneFile,
  id: string,
  handle: Handle,
  point: Point,
): SceneFile {
  const current = scene.elements.find((element) => element.id === id);
  if (!current) {
    return scene;
  }
  // Native box resize now uses Excalidraw's resizeSingleElement, including
  // its own bound-text reflow for one validated reciprocal label. Unsupported
  // arrow links, imported orphan labels and raster crops stay guarded.
  const textRef =
    current.boundElements?.length === 1 &&
    current.boundElements[0].type === "text"
      ? scene.elements.find((item) => item.id === current.boundElements?.[0].id)
      : null;
  if (
    isBoxTransformable(current, scene) &&
    (current.type === "rectangle" ||
      current.type === "ellipse" ||
      current.type === "diamond") &&
    (!current.boundElements?.length ||
      (!!textRef && nativeLabelBox(scene, textRef)?.id === id))
  ) {
    return handle === "rotate"
      ? rotateNativeBoxWithCore(scene, id, point)
      : resizeNativeBoxWithCore(scene, id, handle, point);
  }
  // Image crops have additional coordinate semantics and stay on the
  // guarded legacy path. Uncropped embedded raster geometry is core-owned.
  if (
    current.type === "image" &&
    current.crop === null &&
    isBoxTransformable(current, scene)
  ) {
    return handle === "rotate"
      ? rotateNativeImageWithCore(scene, id, point)
      : resizeNativeImageWithCore(scene, id, handle, point);
  }
  const transformed =
    handle === "rotate"
      ? rotateElement(current, point, scene)
      : resizeElement(current, handle, point, scene);
  if (transformed === current) {
    return scene;
  }
  const updated = {
    ...scene,
    elements: scene.elements.map((element) =>
      element.id === id ? transformed : element,
    ),
  };
  return syncNativeBoundLabels(syncNativeBindings(updated), new Set([id]));
}

/** Flip a supported raster image without rewriting its file or crop data. */
export function flipNativeImage(
  scene: SceneFile,
  id: string,
  axis: "horizontal" | "vertical",
): SceneFile {
  const element = scene.elements.find((item) => item.id === id);
  if (
    !element ||
    element.type !== "image" ||
    !isBoxTransformable(element, scene)
  ) {
    return scene;
  }
  const nextScale: [number, number] = [
    element.scale[0] === -1 ? -1 : 1,
    element.scale[1] === -1 ? -1 : 1,
  ];
  const index = axis === "horizontal" ? 0 : 1;
  nextScale[index] = -nextScale[index];
  return {
    ...scene,
    elements: scene.elements.map((item) =>
      item.id === id
        ? updateNativeElement(element, { scale: nextScale })
        : item,
    ),
  };
}
