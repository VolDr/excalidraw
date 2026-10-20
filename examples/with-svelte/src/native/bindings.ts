import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawElement, ExcalidrawArrowElement } from "@excalidraw/element/types";
import type { LocalPoint } from "@excalidraw/math";

import { hitTest } from "./scene";

import type { Point, SceneFile } from "./scene";

type Box = Extract<ExcalidrawElement, { type: "rectangle" | "ellipse" | "diamond" }>;
type End = "start" | "end";
const EPS = 0.00001;

const isBox = (el: ExcalidrawElement): el is Box =>
  el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond";

const isTwoPointArrow = (el: ExcalidrawElement): el is ExcalidrawArrowElement =>
  el.type === "arrow" && !el.elbowed && el.points.length === 2 &&
  !el.isDeleted && !el.locked && !el.frameId && el.groupIds.length === 0 &&
  !el.boundElements?.length;

const validBinding = (binding: ExcalidrawArrowElement["startBinding"]): boolean =>
  !binding || (binding.mode === "inside" &&
    binding.fixedPoint.length === 2 &&
    binding.fixedPoint.every((v) => Number.isFinite(v) && v >= 0 && v <= 1));

/**
 * Only recognize a reciprocal two-point "inside" binding; foreign/complex
 * bindings are never rewritten by native geometry operations.
 */
export function isSafeBoundBox(scene: SceneFile, el: ExcalidrawElement): el is Box {
  if (!isBox(el) || el.isDeleted || el.locked || el.frameId ||
      el.groupIds.length || el.width < 8 || el.height < 8) {
    return false;
  }
  return (el.boundElements ?? []).every((ref) => {
    const arrow = scene.elements.find((item) => item.id === ref.id);
    return ref.type === "arrow" && !!arrow && isTwoPointArrow(arrow) &&
      validBinding(arrow.startBinding) && validBinding(arrow.endBinding) &&
      (arrow.startBinding?.elementId === el.id || arrow.endBinding?.elementId === el.id);
  });
}

export function isNativeLinkedArrow(scene: SceneFile, el: ExcalidrawElement): el is ExcalidrawArrowElement {
  if (!isTwoPointArrow(el) ||
      (!el.startBinding && !el.endBinding) ||
      !validBinding(el.startBinding) || !validBinding(el.endBinding)) {
    return false;
  }
  for (const binding of [el.startBinding, el.endBinding]) {
    if (!binding) {
      continue;
    }
    const target = scene.elements.find((item) => item.id === binding.elementId);
    if (!target || !isSafeBoundBox(scene, target) ||
        !target.boundElements?.some((ref) => ref.id === el.id && ref.type === "arrow")) {
      return false;
    }
  }
  return true;
}

const world = (shape: ExcalidrawElement, point: Point): Point => {
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  return {
    x: cx + dx * Math.cos(shape.angle) - dy * Math.sin(shape.angle),
    y: cy + dx * Math.sin(shape.angle) + dy * Math.cos(shape.angle),
  };
};

const local = (shape: ExcalidrawElement, point: Point): Point => {
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  return {
    x: cx + dx * Math.cos(shape.angle) + dy * Math.sin(shape.angle),
    y: cy - dx * Math.sin(shape.angle) + dy * Math.cos(shape.angle),
  };
};

const center = (shape: ExcalidrawElement): Point => ({
  x: shape.x + shape.width / 2, y: shape.y + shape.height / 2,
});

const worldEndpoints = (el: ExcalidrawArrowElement): { start: Point; end: Point } => {
  const p = el.points;
  return {
    start: world(el, { x: el.x + p[0][0], y: el.y + p[0][1] }),
    end: world(el, { x: el.x + p[p.length - 1][0], y: el.y + p[p.length - 1][1] }),
  };
};

/** Rotated shape outline in direction of the other endpoint. */
const outline = (shape: Box, toward: Point): Point => {
  const c = center(shape);
  const other = local(shape, toward);
  const dx = other.x - c.x;
  const dy = other.y - c.y;
  const rx = shape.width / 2;
  const ry = shape.height / 2;
  const nx = dx / rx;
  const ny = dy / ry;
  let divisor = 1;
  if (shape.type === "ellipse") {
    divisor = Math.hypot(nx, ny);
  } else if (shape.type === "diamond") {
    divisor = Math.abs(nx) + Math.abs(ny);
  } else {
    divisor = Math.max(Math.abs(nx), Math.abs(ny));
  }
  if (divisor < EPS) {
    return world(shape, { x: c.x + rx, y: c.y });
  }
  return world(shape, { x: c.x + dx / divisor, y: c.y + dy / divisor });
};

const fixedPoint = (shape: Box, at: Point): [number, number] => {
  const p = local(shape, at);
  return [
    Math.max(0, Math.min(1, (p.x - shape.x) / shape.width)),
    Math.max(0, Math.min(1, (p.y - shape.y) / shape.height)),
  ];
};

const attached = (scene: SceneFile, binding: ExcalidrawArrowElement["startBinding"]): Point | null => {
  if (!binding) {
    return null;
  }
  const shape = scene.elements.find((item) => item.id === binding.elementId);
  if (!shape) {
    return null;
  }
  return world(shape, {
    x: shape.x + shape.width * binding.fixedPoint[0],
    y: shape.y + shape.height * binding.fixedPoint[1],
  });
};

const touch = <T extends ExcalidrawElement>(el: T, patch: Partial<T>): T => ({
  ...el, ...patch,
  version: el.version + 1,
  versionNonce: Math.floor(Math.random() * 2 ** 31),
  updated: Date.now(),
});

/** Normalize two world endpoints to Excalidraw's local coordinate system. */
function withEndpoints(arrow: ExcalidrawArrowElement, start: Point, end: Point): ExcalidrawArrowElement {
  const previous = worldEndpoints(arrow);
  if (Math.hypot(previous.start.x - start.x, previous.start.y - start.y) < EPS &&
      Math.hypot(previous.end.x - end.x, previous.end.y - end.y) < EPS) {
    return arrow;
  }
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return touch(arrow, {
    x, y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    angle: 0 as ExcalidrawArrowElement["angle"],
    points: [
      pointFrom<LocalPoint>(start.x - x, start.y - y),
      pointFrom<LocalPoint>(end.x - x, end.y - y),
    ],
  });
}

/** Recompute only recognized arrows after a bound box moves, rotates, or resizes. */
export function syncNativeBindings(scene: SceneFile): SceneFile {
  let changed = false;
  const elements = scene.elements.map((el) => {
    if (!isNativeLinkedArrow(scene, el)) {
      return el;
    }
    const endpoints = worldEndpoints(el);
    const start = attached(scene, el.startBinding) ?? endpoints.start;
    const end = attached(scene, el.endBinding) ?? endpoints.end;
    const updated = withEndpoints(el, start, end);
    changed ||= updated !== el;
    return updated;
  });
  return changed ? { ...scene, elements } : scene;
}

const findTarget = (scene: SceneFile, at: Point): Box | null => {
  for (let i = scene.elements.length - 1; i >= 0; i--) {
    const element = scene.elements[i];
    if (isSafeBoundBox(scene, element) && hitTest(element, at, 10)) {
      return element;
    }
  }
  return null;
};

/** Create a new arrow and reciprocal bindings in one immutable transaction. */
export function appendNativeArrow(
  scene: SceneFile,
  element: ExcalidrawElement,
  startAt: Point,
  endAt: Point,
): SceneFile {
  if (!isTwoPointArrow(element)) {
    return { ...scene, elements: [...scene.elements, element] };
  }
  const startBox = findTarget(scene, startAt);
  const foundEnd = findTarget(scene, endAt);
  const endBox = foundEnd?.id === startBox?.id ? null : foundEnd;
  const start = startBox ? outline(startBox, endBox ? center(endBox) : endAt) : startAt;
  const end = endBox ? outline(endBox, startBox ? center(startBox) : startAt) : endAt;
  const arrow = withEndpoints(element, start, end);
  const startBinding = startBox
    ? { elementId: startBox.id, fixedPoint: fixedPoint(startBox, start), mode: "inside" as const }
    : null;
  const endBinding = endBox
    ? { elementId: endBox.id, fixedPoint: fixedPoint(endBox, end), mode: "inside" as const }
    : null;
  const bound = { ...arrow, startBinding, endBinding };
  const elements = scene.elements.map((el) =>
    (el.id === startBox?.id || el.id === endBox?.id)
      ? touch(el, {
          boundElements: [
            ...(el.boundElements ?? []),
            { id: element.id, type: "arrow" as const },
          ],
        })
      : el,
  );
  return { ...scene, elements: [...elements, bound] };
}

/** Picking a bound arrow is allowed, but the arrow itself cannot be dragged. */
export function nativeLinkedEndpoints(scene: SceneFile, element: ExcalidrawElement): { start: Point; end: Point } | null {
  return isNativeLinkedArrow(scene, element) ? worldEndpoints(element) : null;
}

/**
 * An endpoint dropped on a safe shape gains its reciprocal binding; dropping
 * it in empty space detaches the old shape. Existing opposite binding remains.
 */
export function reconnectNativeEndpoint(
  scene: SceneFile,
  arrowId: string,
  endpoint: End,
  pointer: Point,
): SceneFile {
  const el = scene.elements.find((item) => item.id === arrowId);
  if (!el || !isNativeLinkedArrow(scene, el)) {
    return scene;
  }
  const opposite = endpoint === "start" ? "end" : "start";
  const before = worldEndpoints(el);
  const oldBinding = endpoint === "start" ? el.startBinding : el.endBinding;
  const otherBinding = opposite === "start" ? el.startBinding : el.endBinding;
  const found = findTarget(scene, pointer);
  const shape = found?.id === otherBinding?.elementId ? null : found;
  const target = shape ? outline(shape, before[opposite]) : pointer;
  const binding = shape
    ? { elementId: shape.id, fixedPoint: fixedPoint(shape, target), mode: "inside" as const }
    : null;
  const moved = withEndpoints(el, endpoint === "start" ? target : before.start,
    endpoint === "end" ? target : before.end);
  const updated = touch(moved, {
    [endpoint === "start" ? "startBinding" : "endBinding"]: binding,
  });
  const elements = scene.elements.map((item) => {
    if (item.id === arrowId) {
      return updated;
    }
    const had = item.id === oldBinding?.elementId;
    const has = item.id === shape?.id;
    if (!had && !has) {
      return item;
    }
    const linkedFromOtherEnd = otherBinding?.elementId === item.id;
    const remaining = (item.boundElements ?? []).filter(
      (ref) => ref.id !== arrowId,
    );
    if (has || linkedFromOtherEnd) {
      remaining.push({ id: arrowId, type: "arrow" });
    }
    return touch(item, { boundElements: remaining.length ? remaining : null });
  });
  return { ...scene, elements };
}
