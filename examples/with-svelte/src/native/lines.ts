import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { LocalPoint } from "@excalidraw/math";

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
    (element.type === "line" || !element.elbowed) &&
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
  const points = element.points;
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const rotate = (p: readonly [number, number]): Point => {
    const x = element.x + p[0];
    const y = element.y + p[1];
    const dx = x - cx;
    const dy = y - cy;
    return {
      x: cx + dx * Math.cos(element.angle) - dy * Math.sin(element.angle),
      y: cy + dx * Math.sin(element.angle) + dy * Math.cos(element.angle),
    };
  };
  return { start: rotate(points[0]), end: rotate(points[1]) };
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
 * Rewrite endpoints in world space and normalize to an unrotated, two-point
 * Excalidraw element. The endpoint opposite the dragged one stays fixed.
 */
export function moveEndpoint(
  element: ExcalidrawElement,
  endpoint: Endpoint,
  target: Point,
): ExcalidrawElement {
  const points = endpointLocations(element);
  if (!points) {
    return element;
  }
  const start = endpoint === "start" ? target : points.start;
  const end = endpoint === "end" ? target : points.end;
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    ...element,
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    angle: 0 as ExcalidrawElement["angle"],
    points: [
      pointFrom<LocalPoint>(start.x - x, start.y - y),
      pointFrom<LocalPoint>(end.x - x, end.y - y),
    ],
    version: element.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  } as ExcalidrawElement;
}

export function updateLineEndpoint(
  scene: SceneFile,
  id: string,
  endpoint: Endpoint,
  target: Point,
): SceneFile {
  return {
    ...scene,
    elements: scene.elements.map((element) =>
      element.id === id ? moveEndpoint(element, endpoint, target) : element,
    ),
  };
}
