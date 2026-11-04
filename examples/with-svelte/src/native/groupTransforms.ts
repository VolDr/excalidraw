import {
  getBoundTextMaxHeight,
  getBoundTextMaxWidth,
  getCommonBounds,
  rescalePointsInElement,
} from "@excalidraw/element";
import { pointFrom, pointRotateRads } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { nativeLabelBox, syncNativeBoundLabels } from "./boundText";
import {
  nativeElementsMap,
  resizeNativeGroupWithCore,
  rotateNativeGroupWithCore,
  updateNativeElement,
} from "./coreAdapter";
import { editableSelection, safeGroupMembers } from "./groups";

import type { Bounds } from "./selection";
import type { Point, SceneFile } from "./scene";
import type { Handle } from "./transforms";

const MIN_SHAPE_SIZE = 21;
const MIN_IMAGE_SIZE = 8;
const HANDLE_KEYS: Handle[] = ["nw", "ne", "sw", "se", "rotate"];

type GroupFrame = {
  id: string;
  bounds: Bounds;
  roots: ExcalidrawElement[];
};

const isBoundLabel = (element: ExcalidrawElement): boolean =>
  element.type === "text" && element.containerId !== null;

/**
 * Guard two-point, unbound lines and arrows. Imported routed, linked, or
 * out-of-bounds geometries remain read-only for group transforms.
 */
const isSimpleLinear = (element: ExcalidrawElement): boolean => {
  if (element.type !== "line" && element.type !== "arrow") {
    return false;
  }
  if (
    element.points.length !== 2 ||
    element.width <= 0 ||
    element.height <= 0 ||
    element.boundElements?.length ||
    element.startBinding ||
    element.endBinding ||
    (element.type === "line" &&
      "polygon" in element &&
      element.polygon === true) ||
    (element.type === "arrow" &&
      (element.elbowed ||
        ("fixedSegments" in element && element.fixedSegments != null)))
  ) {
    return false;
  }
  const xs = element.points.map(([x]) => x);
  const ys = element.points.map(([, y]) => y);
  // Official point rescaling assumes normalized element extents. Never
  // reinterpret malformed imported local coordinates by silently shifting
  // their endpoints to the container's edges.
  return (
    element.points.every(
      ([x, y]) =>
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        x >= 0 &&
        y >= 0 &&
        x <= element.width &&
        y <= element.height,
    ) &&
    Math.abs(Math.min(...xs)) < 1e-6 &&
    Math.abs(Math.max(...xs) - element.width) < 1e-6 &&
    Math.abs(Math.min(...ys)) < 1e-6 &&
    Math.abs(Math.max(...ys) - element.height) < 1e-6
  );
};

/**
 * Supported groups include ordinary boxes, raster images and strictly
 * unbound two-point lines/arrows. Text is transformed only with its box.
 * Freehand, standalone text, routed/linked arrows and nested groups are
 * movable, but not transformable through native group handles.
 */
export function transformableGroup(
  scene: SceneFile,
  ids: readonly string[],
): GroupFrame | null {
  const selected = new Set(ids);
  if (selected.size < 2 || editableSelection(scene, ids).length !== selected.size) {
    return null;
  }
  const first = scene.elements.find((element) => selected.has(element.id));
  const groupId = first?.groupIds.length === 1 ? first.groupIds[0] : null;
  if (!groupId) {
    return null;
  }
  const members = safeGroupMembers(scene, groupId);
  const roots = members.filter((element) => !isBoundLabel(element));
  if (
    roots.length !== selected.size ||
    roots.some(
      (element) =>
        !selected.has(element.id) ||
        !(
          ["rectangle", "ellipse", "diamond", "image"].includes(element.type) ||
          isSimpleLinear(element)
        ) ||
        !Number.isFinite(element.angle) ||
        element.width <= 0 ||
        element.height <= 0,
    )
  ) {
    return null;
  }
  // Reuse the same type-aware bounds as Excalidraw (including rotated
  // ellipses, diamonds and two-point arrows).
  const [x, y, right, bottom] = getCommonBounds(roots, nativeElementsMap(scene));
  if (![x, y, right, bottom].every(Number.isFinite) || right <= x || bottom <= y) {
    return null;
  }
  return { id: groupId, roots, bounds: { x, y, width: right - x, height: bottom - y } };
}

export function groupHandleLocations(bounds: Bounds): Record<Handle, Point> {
  const { x, y, width, height } = bounds;
  return {
    nw: { x, y },
    ne: { x: x + width, y },
    sw: { x, y: y + height },
    se: { x: x + width, y: y + height },
    rotate: { x: x + width / 2, y: y - 28 },
  };
}

export function pickGroupHandle(
  bounds: Bounds,
  point: Point,
  tolerance = 9,
): Handle | null {
  const handles = groupHandleLocations(bounds);
  return (
    HANDLE_KEYS.find(
      (key) => Math.hypot(
        point.x - handles[key].x,
        point.y - handles[key].y,
      ) <= tolerance,
    ) ?? null
  );
}

const normalizedAngle = (value: number): ExcalidrawElement["angle"] =>
  Math.atan2(Math.sin(value), Math.cos(value)) as ExcalidrawElement["angle"];



/**
 * Every pointer sample applies to the immutable gesture-start scene, avoiding
 * accumulated precision errors, history churn and drifting bound labels.
 * Uniform resizing preserves raster aspect ratios, crop and binary metadata.
 */
export function transformGroup(
  scene: SceneFile,
  selectedIds: readonly string[],
  handle: Handle,
  point: Point,
): SceneFile {
  const group = transformableGroup(scene, selectedIds);
  if (!group || ![point.x, point.y].every(Number.isFinite)) {
    return scene;
  }
  const { bounds, roots } = group;
  const origin = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  let scale = 1;
  let radians = 0;
  let anchor = origin;

  if (handle === "rotate") {
    // Handle starts above the axis-aligned selection frame. Subsequent drags
    // always recalculate from the original scene, never the intermediate one.
    radians = Math.atan2(point.y - origin.y, point.x - origin.x) + Math.PI / 2;
    if (!Number.isFinite(radians)) {
      return scene;
    }
  } else {
    const opposite: Record<Exclude<Handle, "rotate">, Exclude<Handle, "rotate">> = {
      nw: "se",
      ne: "sw",
      sw: "ne",
      se: "nw",
    };
    anchor = groupHandleLocations(bounds)[opposite[handle]];
    const signedX = (handle.endsWith("e") ? 1 : -1) * (point.x - anchor.x);
    const signedY = (handle.startsWith("s") ? 1 : -1) * (point.y - anchor.y);
    const relativeX = signedX / bounds.width;
    const relativeY = signedY / bounds.height;
    const candidate =
      Math.abs(relativeX - 1) >= Math.abs(relativeY - 1)
        ? relativeX
        : relativeY;
    const minimum = Math.max(
      ...roots.map((element) => {
        const minimumSize = element.type === "image" ? MIN_IMAGE_SIZE : MIN_SHAPE_SIZE;
        return minimumSize / Math.min(element.width, element.height);
      }),
    );
    scale = Math.max(minimum, candidate);
    if (!Number.isFinite(scale)) {
      return scene;
    }
  }

  if (Math.abs(scale - 1) < 1e-9 && Math.abs(radians) < 1e-9) {
    return scene;
  }

  // Original Excalidraw multi-selection rotation now also handles simple
  // unbound two-point lines/arrows alongside boxes and bound box labels.
  // Images, routed arrows and unsupported paths keep the guarded fallback.
  const coreGroup = roots.every((element) =>
    ["rectangle", "ellipse", "diamond"].includes(element.type) ||
    isSimpleLinear(element)
  );
  if (handle === "rotate" && coreGroup) {
    return rotateNativeGroupWithCore(
      scene,
      roots.map((element) => element.id),
      point,
      bounds,
    );
  }

  // Core multi-resize scales normalized local linear points and reflows
  // reciprocal box labels. Keep the existing zero-angle gate for corner
  // resizing; other rotated/mixed image groups retain the native fallback.
  if (
    handle !== "rotate" &&
    coreGroup &&
    roots.every((element) => element.angle === 0)
  ) {
    return resizeNativeGroupWithCore(
      scene,
      roots.map((element) => element.id),
      handle,
      scale,
      bounds,
    );
  }

  const byId = new Map<string, ExcalidrawElement>();
  for (const element of roots) {
    const oldCenter = {
      x: element.x + element.width / 2,
      y: element.y + element.height / 2,
    };
    const [rotatedX, rotatedY] = pointRotateRads(
      pointFrom(oldCenter.x, oldCenter.y),
      pointFrom(anchor.x, anchor.y),
      radians as ExcalidrawElement["angle"],
    );
    const center = {
      x: anchor.x + (rotatedX - anchor.x) * scale,
      y: anchor.y + (rotatedY - anchor.y) * scale,
    };
    const width = element.width * scale;
    const height = element.height * scale;
    const geometry = {
      x: center.x - width / 2,
      y: center.y - height / 2,
      width,
      height,
      angle: normalizedAngle(element.angle + radians),
    };
    if (element.type === "line" || element.type === "arrow") {
      byId.set(
        element.id,
        updateNativeElement(element, {
          ...geometry,
          ...rescalePointsInElement(
            element as NonDeletedExcalidrawElement,
            width,
            height,
            false,
          ),
        }),
      );
    } else {
      byId.set(element.id, updateNativeElement(element, geometry));
    }
  }
  const updated = {
    ...scene,
    elements: scene.elements.map((element) => byId.get(element.id) ?? element),
  };
  // Only labels of transformed boxes get official Excalidraw reflow/placement.
  const result = syncNativeBoundLabels(updated, new Set(byId.keys()));
  // Never silently write a group in which a shrunken container no longer
  // accommodates its label. Such a resize remains a no-op, not a broken
  // reciprocal reference or an overflow exported to Excalidraw.
  for (const label of result.elements) {
    if (
      label.type !== "text" ||
      !label.containerId ||
      !byId.has(label.containerId) ||
      label.isDeleted
    ) {
      continue;
    }
    const box = nativeLabelBox(result, label);
    if (
      !box ||
      label.width > getBoundTextMaxWidth(box, label) + 0.5 ||
      label.height > getBoundTextMaxHeight(box, label) + 0.5
    ) {
      return scene;
    }
  }
  return result;
}
