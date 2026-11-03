import {
  calculateFixedPointForNonElbowArrowBinding,
  getGlobalFixedPointForBindableElement,
  intersectElementWithLineSegment,
  LinearElementEditor,
} from "@excalidraw/element";
import { lineSegment, pointFrom, pointRotateRads } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  ExcalidrawArrowElement,
  ExcalidrawBindableElement,
  NonDeleted,
} from "@excalidraw/element/types";
import type { GlobalPoint, LocalPoint } from "@excalidraw/math";

import { nativeLabelBox } from "./boundText";
import {
  nativeElementsMap,
  reconnectNativeArrowWithCore,
  updateNativeElement,
} from "./coreAdapter";
import { hitTest } from "./scene";

import type { Point, SceneFile } from "./scene";

type Box = Extract<
  ExcalidrawElement,
  { type: "rectangle" | "ellipse" | "diamond" }
>;
type End = "start" | "end";
const EPS = 0.00001;

const isBox = (el: ExcalidrawElement): el is Box =>
  el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond";

const isTwoPointArrow = (el: ExcalidrawElement): el is ExcalidrawArrowElement =>
  el.type === "arrow" &&
  "elbowed" in el &&
  el.elbowed === false &&
  el.points.length === 2 &&
  !el.isDeleted &&
  !el.locked &&
  !el.frameId &&
  el.groupIds.length === 0 &&
  !el.boundElements?.length;

const validBinding = (
  binding: ExcalidrawArrowElement["startBinding"],
): boolean =>
  !binding ||
  (binding.mode === "inside" &&
    binding.fixedPoint.length === 2 &&
    binding.fixedPoint.every((v) => Number.isFinite(v) && v >= 0 && v <= 1));

/**
 * Only recognize a reciprocal two-point "inside" binding; foreign/complex
 * bindings are never rewritten by native geometry operations.
 */
export function isSafeBoundBox(
  scene: SceneFile,
  el: ExcalidrawElement,
): el is Box {
  if (
    !isBox(el) ||
    el.isDeleted ||
    el.locked ||
    el.frameId ||
    el.groupIds.length ||
    el.width < 8 ||
    el.height < 8
  ) {
    return false;
  }
  return (el.boundElements ?? []).every((ref) => {
    const arrow = scene.elements.find((item) => item.id === ref.id);
    if (ref.type === "text") {
      return !!arrow && nativeLabelBox(scene, arrow)?.id === el.id;
    }
    return (
      ref.type === "arrow" &&
      !!arrow &&
      isTwoPointArrow(arrow) &&
      validBinding(arrow.startBinding) &&
      validBinding(arrow.endBinding) &&
      (arrow.startBinding?.elementId === el.id ||
        arrow.endBinding?.elementId === el.id)
    );
  });
}

export function isNativeLinkedArrow(
  scene: SceneFile,
  el: ExcalidrawElement,
): el is ExcalidrawArrowElement {
  if (
    !isTwoPointArrow(el) ||
    (!el.startBinding && !el.endBinding) ||
    !validBinding(el.startBinding) ||
    !validBinding(el.endBinding)
  ) {
    return false;
  }
  for (const binding of [el.startBinding, el.endBinding]) {
    if (!binding) {
      continue;
    }
    const target = scene.elements.find((item) => item.id === binding.elementId);
    if (
      !target ||
      !isSafeBoundBox(scene, target) ||
      !target.boundElements?.some(
        (ref) => ref.id === el.id && ref.type === "arrow",
      )
    ) {
      return false;
    }
  }
  return true;
}

const world = (shape: ExcalidrawElement, point: Point): Point => {
  const center = pointFrom<GlobalPoint>(
    shape.x + shape.width / 2,
    shape.y + shape.height / 2,
  );
  const [x, y] = pointRotateRads(
    pointFrom<GlobalPoint>(point.x, point.y),
    center,
    shape.angle,
  );
  return { x, y };
};

const center = (shape: ExcalidrawElement): Point => ({
  x: shape.x + shape.width / 2,
  y: shape.y + shape.height / 2,
});

/** Delegate linear geometry to the official editor, including rotation. */
const worldEndpoints = (
  el: ExcalidrawArrowElement,
): { start: Point; end: Point } => {
  const map = nativeElementsMap({ elements: [el] });
  const [sx, sy] = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    el,
    0,
    map,
  );
  const [ex, ey] = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    el,
    -1,
    map,
  );
  return {
    start: { x: sx, y: sy },
    end: { x: ex, y: ey },
  };
};


/**
 * Use Excalidraw's actual shape boundary (including rotation and rounded
 * corners) rather than a second rectangle/diamond/ellipse approximation.
 * Cast a ray from the center towards the opposite endpoint and take the
 * closest intersection in the forward direction.
 */
const outline = (scene: SceneFile, shape: Box, toward: Point): Point => {
  const c = center(shape);
  let dx = toward.x - c.x;
  let dy = toward.y - c.y;
  const norm = Math.hypot(dx, dy);
  if (norm < EPS) {
    dx = 1;
    dy = 0;
  } else {
    dx /= norm;
    dy /= norm;
  }
  const reach = Math.max(shape.width, shape.height, norm, 1) * 4;
  const origin = pointFrom<GlobalPoint>(c.x, c.y);
  const intersections = intersectElementWithLineSegment(
    shape,
    nativeElementsMap(scene),
    lineSegment(
      origin,
      pointFrom<GlobalPoint>(c.x + dx * reach, c.y + dy * reach),
    ),
  ).filter(
    (point) =>
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1]) &&
      (point[0] - c.x) * dx + (point[1] - c.y) * dy >= -EPS,
  );
  if (intersections.length) {
    intersections.sort(
      (a, b) =>
        Math.hypot(a[0] - c.x, a[1] - c.y) -
        Math.hypot(b[0] - c.x, b[1] - c.y),
    );
    return { x: intersections[0][0], y: intersections[0][1] };
  }
  // If an imported shape has no usable outline intersection, retain a
  // finite, on-box anchor rather than accidentally binding far outside it.
  return world(shape, {
    x: shape.x + shape.width,
    y: shape.y + shape.height / 2,
  });
};

/** Derive bindings using the original non-elbow arrow algorithm. */
const fixedPoint = (
  scene: SceneFile,
  arrow: ExcalidrawArrowElement,
  shape: Box,
  at: Point,
  endpoint: End,
): [number, number] =>
  calculateFixedPointForNonElbowArrowBinding(
    arrow as NonDeleted<ExcalidrawArrowElement>,
    shape as NonDeleted<ExcalidrawBindableElement>,
    endpoint,
    nativeElementsMap(scene),
    pointFrom<GlobalPoint>(at.x, at.y),
  ).fixedPoint;

const attached = (
  scene: SceneFile,
  binding: ExcalidrawArrowElement["startBinding"],
): Point | null => {
  if (!binding) {
    return null;
  }
  const shape = scene.elements.find((item) => item.id === binding.elementId);
  if (!shape || !isBox(shape)) {
    return null;
  }
  const [x, y] = getGlobalFixedPointForBindableElement(
    binding.fixedPoint,
    shape,
    nativeElementsMap(scene),
  );
  return { x, y };
};

/** Normalize two world endpoints to Excalidraw's local coordinate system. */
function withEndpoints(
  arrow: ExcalidrawArrowElement,
  start: Point,
  end: Point,
): ExcalidrawArrowElement {
  const previous = worldEndpoints(arrow);
  if (
    Math.hypot(previous.start.x - start.x, previous.start.y - start.y) < EPS &&
    Math.hypot(previous.end.x - end.x, previous.end.y - end.y) < EPS
  ) {
    return arrow;
  }
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return updateNativeElement(arrow, {
    x,
    y,
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
  const elementsMap = nativeElementsMap(scene);
  for (let i = scene.elements.length - 1; i >= 0; i--) {
    const element = scene.elements[i];
    if (isSafeBoundBox(scene, element) && hitTest(element, at, 10, elementsMap)) {
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
  const start = startBox
    ? outline(scene, startBox, endBox ? center(endBox) : endAt)
    : startAt;
  const end = endBox
    ? outline(scene, endBox, startBox ? center(startBox) : startAt)
    : endAt;
  const arrow = withEndpoints(element, start, end);
  const startBinding = startBox
    ? {
        elementId: startBox.id,
        fixedPoint: fixedPoint(scene, arrow, startBox, start, "start"),
        mode: "inside" as const,
      }
    : null;
  const endBinding = endBox
    ? {
        elementId: endBox.id,
        fixedPoint: fixedPoint(scene, arrow, endBox, end, "end"),
        mode: "inside" as const,
      }
    : null;
  const bound = { ...arrow, startBinding, endBinding };
  // Match the official normalized fixed points immediately so the first
  // subsequent sync is a no-op (and cannot make the arrow visibly jump).
  const anchored = withEndpoints(
    bound,
    (startBinding && attached(scene, startBinding)) || start,
    (endBinding && attached(scene, endBinding)) || end,
  );
  const elements = scene.elements.map((el) =>
    el.id === startBox?.id || el.id === endBox?.id
      ? updateNativeElement(el, {
          boundElements: [
            ...(el.boundElements ?? []),
            { id: element.id, type: "arrow" as const },
          ],
        })
      : el,
  );
  return { ...scene, elements: [...elements, anchored] };
}

export function pickNativeLinkedEndpoint(
  scene: SceneFile,
  element: ExcalidrawElement,
  point: Point,
  tolerance = 9,
): End | null {
  const endpoints = nativeLinkedEndpoints(scene, element);
  if (!endpoints) {
    return null;
  }
  for (const key of ["start", "end"] as const) {
    const p = endpoints[key];
    if (Math.hypot(point.x - p.x, point.y - p.y) <= tolerance) {
      return key;
    }
  }
  return null;
}

/** Picking a bound arrow is allowed, but the arrow itself cannot be dragged. */
export function nativeLinkedEndpoints(
  scene: SceneFile,
  element: ExcalidrawElement,
): { start: Point; end: Point } | null {
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
  const otherBinding =
    opposite === "start" ? el.startBinding : el.endBinding;
  const found = findTarget(scene, pointer);
  const shape = found?.id === otherBinding?.elementId ? null : found;
  const target = shape ? outline(scene, shape, before[opposite]) : pointer;
  if (
    !shape &&
    !oldBinding &&
    Math.hypot(
      before[endpoint].x - target.x,
      before[endpoint].y - target.y,
    ) < EPS
  ) {
    return scene;
  }

  // Excalidraw owns both endpoint normalization and reciprocal binding
  // updates. The native layer only chooses an eligible target/outline.
  const updated = reconnectNativeArrowWithCore(
    scene,
    arrowId,
    endpoint,
    target,
    shape?.id ?? null,
  );
  if (updated === scene) {
    return scene;
  }
  const resultArrow = updated.elements.find((item) => item.id === arrowId);
  if (
    !resultArrow ||
    (!isNativeLinkedArrow(updated, resultArrow) &&
      !(isTwoPointArrow(resultArrow) &&
        !resultArrow.startBinding &&
        !resultArrow.endBinding))
  ) {
    return scene;
  }
  const retained =
    opposite === "start" ? resultArrow.startBinding : resultArrow.endBinding;
  if (
    JSON.stringify(retained) !== JSON.stringify(otherBinding) ||
    (shape && (endpoint === "start"
      ? resultArrow.startBinding?.elementId
      : resultArrow.endBinding?.elementId) !== shape.id) ||
    (!shape &&
      (endpoint === "start" ? resultArrow.startBinding : resultArrow.endBinding))
  ) {
    return scene;
  }
  // The core transaction is adopted only after validating both sides of the
  // arrow and keeping every unrelated element unchanged.
  const affected = new Set([
    arrowId,
    oldBinding?.elementId,
    shape?.id,
  ]);
  if (
    updated.elements.some(
      (item, index) =>
        !affected.has(item.id) && item !== scene.elements[index],
    )
  ) {
    return scene;
  }
  return updated;
}
