import { LinearElementEditor } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  canEditNativeLinearPoints,
  deleteNativeLinearMidpointWithCore,
  insertNativeLinearMidpointWithCore,
  moveNativeLinearEndpointWithCore,
  moveNativeLinearPointWithCore,
  nativeElementsMap,
} from "./coreAdapter";

import { blankScene } from "./scene";

import type { Point, SceneFile } from "./scene";

export type Endpoint = "start" | "end";

/**
 * Index-based handles for every vertex of an open polyline or simple arrow.
 * Bound arrows and elbow routes remain outside native point editing.
 */
export const canEditLinearPoints = canEditNativeLinearPoints;

export function linearPointLocations(
  element: ExcalidrawElement,
): Point[] | null {
  if (!canEditLinearPoints(element)) {
    return null;
  }
  const map = nativeElementsMap({ elements: [element] });
  const points = LinearElementEditor.getPointsGlobalCoordinates(element, map);
  return points.every((point) => point.every(Number.isFinite))
    ? points.map(([x, y]) => ({ x, y }))
    : null;
}

/** Prefer the last (topmost) vertex if handles overlap. */
export function pickLinearPoint(
  element: ExcalidrawElement,
  location: Point,
  tolerance = 9,
): number | null {
  if (!Number.isFinite(location.x) || !Number.isFinite(location.y) ||
      !Number.isFinite(tolerance) || tolerance < 0) {
    return null;
  }
  const points = linearPointLocations(element);
  if (!points) {
    return null;
  }
  for (let i = points.length - 1; i >= 0; --i) {
    const point = points[i];
    if (Math.hypot(point.x - location.x, point.y - location.y) <= tolerance) {
      return i;
    }
  }
  return null;
}

/** Move a selected polyline vertex through the original core point editor. */
export function updateLinearPoint(
  scene: SceneFile,
  id: string,
  index: number,
  target: Point,
): SceneFile {
  const element = scene.elements.find((item) => item.id === id);
  return element && canEditLinearPoints(element)
    ? moveNativeLinearPointWithCore(scene, id, index, target)
    : scene;
}

/** Midpoints are provided by Excalidraw's original segment geometry. */
export function linearSegmentMidpoints(
  element: ExcalidrawElement,
): Point[] | null {
  if (!canEditLinearPoints(element) || element.points.length >= 128) {
    return null;
  }
  const map = nativeElementsMap({ elements: [element] });
  try {
    const midpoints = Array.from(
      { length: element.points.length - 1 },
      (_, i) => LinearElementEditor.getSegmentMidPoint(element, i + 1, map),
    );
    return midpoints.every((p) => p.every(Number.isFinite))
      ? midpoints.map(([x, y]) => ({ x, y }))
      : null;
  } catch {
    // An unsupported imported path must never break pointer hit-testing.
    return null;
  }
}

/** Locate the nearest midpoint handle; return its left segment index. */
export function pickLinearSegmentMidpoint(
  element: ExcalidrawElement,
  location: Point,
  tolerance = 9,
): number | null {
  if (
    ![location.x, location.y, tolerance].every(Number.isFinite) ||
    tolerance < 0
  ) {
    return null;
  }
  const midpoints = linearSegmentMidpoints(element);
  if (!midpoints) {
    return null;
  }
  let closest: number | null = null;
  let distance = tolerance;
  for (const [i, point] of midpoints.entries()) {
    const current = Math.hypot(point.x - location.x, point.y - location.y);
    if (current <= distance) {
      closest = i;
      distance = current;
    }
  }
  return closest;
}

export function insertLinearMidpoint(
  scene: SceneFile,
  id: string,
  segmentIndex: number,
): SceneFile {
  return insertNativeLinearMidpointWithCore(scene, id, segmentIndex);
}

/** Removing first/last endpoints is deliberately unsupported. */
export function deleteLinearMidpoint(
  scene: SceneFile,
  id: string,
  pointIndex: number,
): SceneFile {
  return deleteNativeLinearMidpointWithCore(scene, id, pointIndex);
}

/** Limit native line editing to two-point, unbound, ungrouped straight lines. */
export function canEditEndpoints(element: ExcalidrawElement): boolean {
  return (
    canEditLinearPoints(element) &&
    element.points.length === 2
  );
}

export function endpointLocations(
  element: ExcalidrawElement,
): { start: Point; end: Point } | null {
  if (!canEditEndpoints(element)) {
    return null;
  }
  if (element.type !== "line" && element.type !== "arrow") {
    return null;
  }
  const map = nativeElementsMap({ elements: [element] });
  const [startX, startY] = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    element,
    0,
    map,
  );
  const [endX, endY] = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    element,
    -1,
    map,
  );
  return {
    start: { x: startX, y: startY },
    end: { x: endX, y: endY },
  };
}

export function pickEndpoint(
  element: ExcalidrawElement,
  location: Point,
  tolerance = 9,
): Endpoint | null {
  const p = endpointLocations(element);
  if (!p) {
    return null;
  }
  if (Math.hypot(location.x - p.start.x, location.y - p.start.y) <= tolerance) {
    return "start";
  }
  if (Math.hypot(location.x - p.end.x, location.y - p.end.y) <= tolerance) {
    return "end";
  }
  return null;
}

/**
 * Framework-neutral compatibility wrapper around the core Scene point
 * editor. Direct callers still receive an element; scene callers preserve
 * all unrelated objects, index metadata and the original snapshot.
 */
export function moveEndpoint(
  element: ExcalidrawElement,
  endpoint: Endpoint,
  target: Point,
): ExcalidrawElement {
  if (!canEditEndpoints(element)) {
    return element;
  }
  const source = { ...blankScene(), elements: [element] };
  const updated = moveNativeLinearEndpointWithCore(
    source,
    element.id,
    endpoint,
    target,
  );
  return updated.elements[0];
}

/** Edit the selected line inside an isolated original Excalidraw Scene. */
export function updateLineEndpoint(
  scene: SceneFile,
  id: string,
  endpoint: Endpoint,
  target: Point,
): SceneFile {
  const item = scene.elements.find((element) => element.id === id);
  return item && canEditEndpoints(item)
    ? moveNativeLinearEndpointWithCore(scene, id, endpoint, target)
    : scene;
}
