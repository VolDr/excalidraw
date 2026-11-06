import {
  getGlobalFixedPointForBindableElement,
  intersectElementWithLineSegment,
  isElbowArrow,
  LinearElementEditor,
} from "@excalidraw/element";
import { lineSegment, pointFrom, pointRotateRads } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  ExcalidrawArrowElement,
  ExcalidrawElbowArrowElement,
} from "@excalidraw/element/types";
import type { GlobalPoint, LocalPoint } from "@excalidraw/math";

import { nativeLabelBox, nativeReciprocalCaption } from "./boundText";
import {
  bindNewNativeArrowWithCore,
  canEditNativeElbowArrow,
  nativeElementsMap,
  reconnectNativeOrbitElbowWithCore,
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

export const isTwoPointArrow = (
  el: ExcalidrawElement,
  allowGrouped = false,
): el is ExcalidrawArrowElement =>
  el.type === "arrow" &&
  "elbowed" in el &&
  el.elbowed === false &&
  el.points.length === 2 &&
  !el.isDeleted &&
  !el.locked &&
  !el.frameId &&
  (allowGrouped || el.groupIds.length === 0) &&
  !el.boundElements?.length;

export const validBinding = (
  binding: ExcalidrawArrowElement["startBinding"],
): boolean =>
  !binding ||
  (binding.mode === "inside" &&
    Array.isArray(binding.fixedPoint) &&
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
  const reverse = el.boundElements ?? [];
  if (new Set(reverse.map((ref) => ref.id)).size !== reverse.length) {
    return false;
  }
  // A foreign or damaged import may reference this box from its arrow/text
  // while the reverse list is missing. Do not treat it as an independent,
  // safe target and silently overwrite half of the original relationship.
  if (scene.elements.some((item) =>
    !item.isDeleted &&
    ((item.type === "arrow" &&
      (item.startBinding?.elementId === el.id ||
        item.endBinding?.elementId === el.id) &&
      !reverse.some((ref) => ref.id === item.id && ref.type === "arrow")) ||
      (item.type === "text" &&
        item.containerId === el.id &&
        !reverse.some((ref) => ref.id === item.id && ref.type === "text")))
  )) {
    return false;
  }
  return reverse.every((ref) => {
    const arrow = scene.elements.find((item) => item.id === ref.id);
    if (ref.type === "text") {
      return !!arrow && nativeReciprocalCaption(scene, arrow)?.id === el.id;
    }
    return (
      ref.type === "arrow" &&
      !!arrow &&
      (isTwoPointArrow(arrow) && validBinding(arrow.startBinding) &&
        validBinding(arrow.endBinding) ||
        isNativeOrbitLinkedArrow(scene, arrow)) &&
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

/**
 * A small, closed orbit-only graph is safe to edit without React's full
 * binding controller. Validate all arrows sharing each target together:
 * every forward orbit endpoint needs exactly one reciprocal box reference,
 * and every reverse reference must lead back to an eligible routed arrow.
 * No recursion through isSafeBoundBox: that guard itself calls this one.
 */
const isOrbitArrowCandidate = (
  el: ExcalidrawElement,
): el is ExcalidrawElbowArrowElement => {
  if (
    !isElbowArrow(el) ||
    el.isDeleted ||
    el.locked ||
    el.frameId !== null ||
    el.groupIds.length !== 0 ||
    el.boundElements?.length ||
    (el.fixedSegments != null &&
      (!Array.isArray(el.fixedSegments) || el.fixedSegments.length !== 0)) ||
    el.angle !== 0 ||
    !Array.isArray(el.points) ||
    el.points.length < 2 ||
    el.points.length > 128 ||
    ![el.x, el.y, el.width, el.height].every(Number.isFinite) ||
    !el.points.every((p) =>
      p.length === 2 && p.every(Number.isFinite)
    ) ||
    !el.points.slice(1).every((p, i) =>
      Math.abs(p[0] - el.points[i][0]) < 1e-6 ||
      Math.abs(p[1] - el.points[i][1]) < 1e-6
    )
  ) {
    return false;
  }
  const refs = [el.startBinding, el.endBinding].filter(
    (binding): binding is NonNullable<typeof el.startBinding> => !!binding,
  );
  return refs.length > 0 &&
    new Set(refs.map((binding) => binding.elementId)).size === refs.length &&
    refs.every((binding) =>
      binding.mode === "orbit" &&
      Array.isArray(binding.fixedPoint) &&
      binding.fixedPoint.length === 2 &&
      binding.fixedPoint.every(
        (n) => Number.isFinite(n) && n >= -10 && n <= 10,
      )
    );
};

/**
 * Supports several orbit elbows attached to the same box, provided their
 * entire connected component consists of validated, reciprocal orbit links.
 * Limit each box to 16 endpoints while full large-document parity is pending.
 */
export function isNativeOrbitLinkedArrow(
  scene: SceneFile,
  el: ExcalidrawElement,
): el is ExcalidrawElbowArrowElement {
  if (!isOrbitArrowCandidate(el)) {
    return false;
  }

  const byId = new Map(scene.elements.map((item) => [item.id, item]));
  const checkedArrows = new Set<string>();
  const checkedBoxes = new Set<string>();
  const pending = [el.id];

  while (pending.length) {
    const id = pending.pop()!;
    if (checkedArrows.has(id)) {
      continue;
    }
    const arrow = byId.get(id);
    if (!arrow || !isOrbitArrowCandidate(arrow)) {
      return false;
    }
    checkedArrows.add(id);
    // An imported extra box/link may point *at* this arrow while the arrow
    // does not point back. Such a half-link invalidates the entire component,
    // not only the foreign box that happens to carry the stale reference.
    if (scene.elements.some((other) =>
      !other.isDeleted &&
      other.id !== id &&
      ((other.type === "text" && other.containerId === id) ||
        other.boundElements?.some((ref) =>
          ref.id === id &&
          !(ref.type === "arrow" &&
            (arrow.startBinding?.elementId === other.id ||
              arrow.endBinding?.elementId === other.id))
        ))
    )) {
      return false;
    }
    for (const binding of [arrow.startBinding, arrow.endBinding]) {
      if (!binding) {
        continue;
      }
      const box = byId.get(binding.elementId);
      if (
        !box ||
        !isBox(box) ||
        box.isDeleted ||
        box.locked ||
        box.frameId !== null ||
        box.groupIds.length !== 0 ||
        box.width < 8 ||
        box.height < 8 ||
        ![box.x, box.y, box.angle, box.width, box.height]
          .every(Number.isFinite) ||
        !Array.isArray(box.boundElements) ||
        box.boundElements.length === 0 ||
        box.boundElements.length > 16 ||
        new Set(box.boundElements.map((ref) => ref.id)).size !==
          box.boundElements.length ||
        !box.boundElements.some(
          (ref) => ref.id === arrow.id && ref.type === "arrow",
        )
      ) {
        return false;
      }
      if (checkedBoxes.has(box.id)) {
        continue;
      }
      checkedBoxes.add(box.id);
      // Refuse half-imported links even if a different valid orbit arrow is
      // present. There can be no hidden text or missing reverse arrow ref.
      if (scene.elements.some((other) =>
        !other.isDeleted &&
        ((other.type === "text" && other.containerId === box.id) ||
          (other.type === "arrow" &&
            (other.startBinding?.elementId === box.id ||
              other.endBinding?.elementId === box.id) &&
            !box.boundElements?.some(
              (ref) => ref.id === other.id && ref.type === "arrow",
            )))
      )) {
        return false;
      }
      for (const ref of box.boundElements) {
        if (ref.type !== "arrow") {
          return false;
        }
        const sibling = byId.get(ref.id);
        if (
          !sibling ||
          !isOrbitArrowCandidate(sibling) ||
          !(
            sibling.startBinding?.elementId === box.id ||
            sibling.endBinding?.elementId === box.id
          )
        ) {
          return false;
        }
        pending.push(sibling.id);
      }
    }
  }
  return true;
}

/** World-space ends of a validated orbit-routed elbow. */
export function nativeOrbitEndpoints(
  scene: SceneFile,
  element: ExcalidrawElement,
): { start: Point; end: Point } | null {
  if (!isNativeOrbitLinkedArrow(scene, element)) {
    return null;
  }
  const map = nativeElementsMap(scene);
  const [sx, sy] = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    element, 0, map,
  );
  const [ex, ey] = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    element, -1, map,
  );
  return [sx, sy, ex, ey].every(Number.isFinite)
    ? { start: { x: sx, y: sy }, end: { x: ex, y: ey } }
    : null;
}

export function pickNativeOrbitEndpoint(
  scene: SceneFile,
  element: ExcalidrawElement,
  at: Point,
  tolerance = 9,
): End | null {
  if (![at.x, at.y, tolerance].every(Number.isFinite) || tolerance < 0) {
    return null;
  }
  const points = nativeOrbitEndpoints(scene, element);
  if (!points) {
    return null;
  }
  for (const endpoint of ["end", "start"] as const) {
    const p = points[endpoint];
    if (Math.hypot(at.x - p.x, at.y - p.y) <= tolerance) {
      return endpoint;
    }
  }
  return null;
}

/**
 * Rebind only an unpinned, ungrouped elbow to one independent safe box.
 * The Excalidraw core owns orbit snapping, reciprocal links and rerouting.
 */
export function reconnectNativeOrbitEndpoint(
  scene: SceneFile,
  arrowId: string,
  endpoint: End,
  pointer: Point,
): SceneFile {
  if (![pointer.x, pointer.y].every(Number.isFinite)) {
    return scene;
  }
  const arrow = scene.elements.find((item) => item.id === arrowId);
  if (!arrow || (
    !canEditNativeElbowArrow(arrow) &&
    !isNativeOrbitLinkedArrow(scene, arrow)
  )) {
    return scene;
  }
  // A dangling reverse reference to an otherwise unbound arrow must not be
  // silently turned into a valid relationship during this operation.
  if (scene.elements.some((item) =>
    !item.isDeleted &&
    item.id !== arrowId &&
    item.boundElements?.some((ref) => ref.id === arrowId) &&
    !(
      (arrow.startBinding?.elementId === item.id ||
        arrow.endBinding?.elementId === item.id) &&
      isNativeOrbitLinkedArrow(scene, arrow)
    )
  )) {
    return scene;
  }

  const oppositeBinding = arrow[
    endpoint === "start" ? "endBinding" : "startBinding"
  ];
  const previousBinding = arrow[
    endpoint === "start" ? "startBinding" : "endBinding"
  ];
  let selected: Box | null = null;
  const map = nativeElementsMap(scene);
  for (let i = scene.elements.length - 1; i >= 0; i--) {
    const item = scene.elements[i];
    if (!isBox(item) || item.isDeleted || !hitTest(item, pointer, 10, map)) {
      continue;
    }
    // A shared target is allowed only when every *other* reverse link is
    // already a validated orbit elbow in the same closed component.
    // Never combine an orbit with a text caption or an inside-mode arrow.
    if (
      !isSafeBoundBox(scene, item) ||
      ((item.boundElements?.length ?? 0) >= 16 &&
        !item.boundElements?.some((ref) => ref.id === arrowId)) ||
      item.boundElements?.some((ref) => {
        if (ref.id === arrowId) {
          return false;
        }
        if (ref.type !== "arrow") {
          return true;
        }
        const sibling = scene.elements.find((other) => other.id === ref.id);
        return !sibling || !isNativeOrbitLinkedArrow(scene, sibling);
      })
    ) {
      return scene;
    }
    selected = item;
    break;
  }
  if (selected?.id === oppositeBinding?.elementId) {
    return scene;
  }

  const before = nativeOrbitEndpoints(scene, arrow);
  const next = reconnectNativeOrbitElbowWithCore(
    scene,
    arrowId,
    endpoint,
    pointer,
    selected?.id ?? null,
  );
  if (next === scene) {
    return scene;
  }
  const updated = next.elements.find((item) => item.id === arrowId);
  if (
    !updated ||
    (!canEditNativeElbowArrow(updated) &&
      !isNativeOrbitLinkedArrow(next, updated)) ||
    (updated.type === "arrow" &&
      JSON.stringify(updated[
        endpoint === "start" ? "endBinding" : "startBinding"
      ]) !== JSON.stringify(oppositeBinding)) ||
    (selected &&
      (updated.type !== "arrow" || updated[
        endpoint === "start" ? "startBinding" : "endBinding"
      ]?.elementId !== selected.id)) ||
    (!selected &&
      updated.type === "arrow" &&
      updated[endpoint === "start" ? "startBinding" : "endBinding"]) ||
    next.elements.some((item, index) =>
      item.id !== arrowId &&
      item.id !== previousBinding?.elementId &&
      item.id !== selected?.id &&
      item !== scene.elements[index]
    )
  ) {
    return scene;
  }
  // No opposite endpoint drift while adjusting an unbound-to-bound arrow.
  if (!oppositeBinding && before) {
    const after = nativeOrbitEndpoints(next, updated);
    if (after) {
      const opposite = endpoint === "start" ? "end" : "start";
      if (Math.hypot(
        before[opposite].x - after[opposite].x,
        before[opposite].y - after[opposite].y,
      ) > 0.5) {
        return scene;
      }
    }
  }
  return next;
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
  const created = {
    ...scene,
    elements: [...scene.elements, arrow],
  };
  if (!startBox && !endBox) {
    return created;
  }
  const linked = bindNewNativeArrowWithCore(
    created,
    arrow.id,
    startBox?.id ?? null,
    endBox?.id ?? null,
    { start, end },
  );
  const result = linked.elements.find((item) => item.id === arrow.id);
  // Do not export inconsistent links in the event core rejects a malformed
  // imported target. Preserve the user's new arrow as an unbound shape.
  return result && isNativeLinkedArrow(linked, result)
    ? linked
    : created;
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
  if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) {
    return scene;
  }
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
