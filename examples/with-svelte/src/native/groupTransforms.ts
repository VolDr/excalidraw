import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { LocalPoint } from "@excalidraw/math";

import { syncNativeBoundLabels } from "./boundText";
import { editableSelection, safeGroupMembers } from "./groups";
import { visualBounds } from "./selection";

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
    (element.type === "line" && element.polygon) ||
    (element.type === "arrow" &&
      (element.elbowed ||
        ("fixedSegments" in element && element.fixedSegments != null)))
  ) {
    return false;
  }
  return element.points.every(
    ([x, y]) =>
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      x >= 0 &&
      y >= 0 &&
      x <= element.width &&
      y <= element.height,
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
  const visual = roots.map(visualBounds);
  const x = Math.min(...visual.map((box) => box.x));
  const y = Math.min(...visual.map((box) => box.y));
  const right = Math.max(...visual.map((box) => box.x + box.width));
  const bottom = Math.max(...visual.map((box) => box.y + box.height));
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

const touch = <T extends ExcalidrawElement>(element: T, change: Partial<T>): T => ({
  ...element,
  ...change,
  version: element.version + 1,
  versionNonce: Math.floor(Math.random() * 2 ** 31),
  updated: Date.now(),
});

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

  const byId = new Map<string, ExcalidrawElement>();
  for (const element of roots) {
    const oldCenter = {
      x: element.x + element.width / 2,
      y: element.y + element.height / 2,
    };
    const dx = oldCenter.x - anchor.x;
    const dy = oldCenter.y - anchor.y;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const center = {
      x: anchor.x + (dx * cos - dy * sin) * scale,
      y: anchor.y + (dx * sin + dy * cos) * scale,
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
        touch(element, {
          ...geometry,
          points: element.points.map((p) =>
            pointFrom<LocalPoint>(p[0] * scale, p[1] * scale),
          ),
        }),
      );
    } else {
      byId.set(element.id, touch(element, geometry));
    }
  }
  const updated = {
    ...scene,
    elements: scene.elements.map((element) => byId.get(element.id) ?? element),
  };
  // Only labels of transformed boxes get official Excalidraw reflow/placement.
  return syncNativeBoundLabels(updated, new Set(byId.keys()));
}
