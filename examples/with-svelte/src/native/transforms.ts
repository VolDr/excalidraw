import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  detachDeletedNativeBindings,
  isNativeLinkedArrow,
  isSafeBoundBox,
  syncNativeBindings,
} from "./bindings";
import { canEditIndependently, editableSelection } from "./groups";
import { nativeImageSource } from "./images";

import type { Point, SceneFile } from "./scene";

export type Corner = "nw" | "ne" | "sw" | "se";
export type Handle = Corner | "rotate";

const MIN_SIZE = 8;
const corners: Corner[] = ["nw", "ne", "sw", "se"];

const rotatePoint = (point: Point, center: Point, angle: number): Point => {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
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

export function pickHandle(
  element: ExcalidrawElement,
  point: Point,
  tolerance = 9,
  scene?: SceneFile,
): Handle | null {
  if (!isBoxTransformable(element, scene)) {
    return null;
  }
  const locations = handleLocations(element);
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
  const dx = target.x - fixed.x;
  const dy = target.y - fixed.y;
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  const horizontalSign = corner.endsWith("e") ? 1 : -1;
  const verticalSign = corner.startsWith("s") ? 1 : -1;
  const projectedWidth = horizontalSign * (dx * cos + dy * sin);
  const projectedHeight = verticalSign * (-dx * sin + dy * cos);
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
  return {
    ...element,
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    version: element.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  };
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
  return {
    ...element,
    angle: angle as ExcalidrawElement["angle"],
    version: element.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  };
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
  return syncNativeBindings({
    ...scene,
    elements: scene.elements.map((element) =>
      selected.has(element.id)
        ? {
            ...element,
            x: element.x + dx,
            y: element.y + dy,
            version: element.version + 1,
            versionNonce: Math.floor(Math.random() * 2 ** 31),
            updated: Date.now(),
          }
        : element,
    ),
  });
}

export function deleteSelection(
  scene: SceneFile,
  ids: readonly string[],
): SceneFile {
  const selected = new Set(editableSelection(scene, ids));
  const wanted = new Set(ids);
  for (const element of scene.elements) {
    if (wanted.has(element.id) && isNativeLinkedArrow(scene, element)) {
      selected.add(element.id);
    }
  }
  if (!selected.size) {
    return scene;
  }
  const unlinked = detachDeletedNativeBindings(scene, selected);
  return {
    ...unlinked,
    elements: unlinked.elements.map((element) =>
      selected.has(element.id)
        ? {
            ...element,
            isDeleted: true,
            version: element.version + 1,
            versionNonce: Math.floor(Math.random() * 2 ** 31),
            updated: Date.now(),
          }
        : element,
    ),
  };
}

export function transformSelected(
  scene: SceneFile,
  id: string,
  handle: Handle,
  point: Point,
): SceneFile {
  return syncNativeBindings({
    ...scene,
    elements: scene.elements.map((element) =>
      element.id !== id
        ? element
        : handle === "rotate"
        ? rotateElement(element, point, scene)
        : resizeElement(element, handle, point, scene),
    ),
  });
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
        ? {
            ...element,
            scale: nextScale,
            version: element.version + 1,
            versionNonce: Math.floor(Math.random() * 2 ** 31),
            updated: Date.now(),
          }
        : item,
    ),
  };
}
