import { LinearElementEditor } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { moveNativeLinearEndpointWithCore, nativeElementsMap } from "./coreAdapter";

import { blankScene } from "./scene";

import type { Point, SceneFile } from "./scene";

export type Endpoint = "start" | "end";

/** Limit native line editing to two-point, unbound, ungrouped straight lines. */
export function canEditEndpoints(element: ExcalidrawElement): boolean {
  return (
    (element.type === "line" || element.type === "arrow") &&
    !element.isDeleted &&
    !element.locked &&
    !element.frameId &&
    !element.groupIds.length &&
    !element.boundElements?.length &&
    !element.startBinding &&
    !element.endBinding &&
    (element.type === "line"
      ? !element.polygon
      : element.elbowed === false) &&
    element.points.length === 2 &&
    [element.x, element.y, element.width, element.height, element.angle]
      .every(Number.isFinite) &&
    element.points.every((point) => point.every(Number.isFinite))
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
