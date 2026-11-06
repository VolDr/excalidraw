import {
  bindBindingElement,
  isElbowArrow,
  LinearElementEditor,
  unbindBindingElement,
} from "@excalidraw/element";

import type {
  ExcalidrawBindableElement,
  ExcalidrawElement,
  NonDeleted,
} from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { nativeEditableComplexElbow } from "./complexElbow";
import { nativeElementsMap, withNativeCoreScene } from "./coreAdapter";
import { hitTest } from "./scene";
import type { Point, SceneFile } from "./scene";

type End = "start" | "end";
const isBox = (el: ExcalidrawElement): boolean =>
  ["rectangle", "ellipse", "diamond"].includes(el.type);

const finite = (point: Point) => Number.isFinite(point.x) &&
  Number.isFinite(point.y) && Math.abs(point.x) < 1e6 && Math.abs(point.y) < 1e6;

const safeTarget = (scene: SceneFile, el: ExcalidrawElement): boolean => {
  if (!isBox(el) || el.isDeleted || el.locked || !!el.frameId ||
      el.groupIds.length || el.width <= 8 || el.height <= 8) return false;
  const refs = el.boundElements ?? [];
  if (new Set(refs.map((r) => r.id)).size !== refs.length) return false;
  for (const ref of refs) {
    const related = scene.elements.find((other) => other.id === ref.id);
    if (!related || related.isDeleted) return false;
    if (ref.type === "text") {
      if (related.type !== "text" || related.containerId !== el.id) return false;
    } else if (ref.type === "arrow") {
      if (related.type !== "arrow" ||
          (related.startBinding?.elementId !== el.id &&
           related.endBinding?.elementId !== el.id)) return false;
    } else return false;
  }
  return !scene.elements.some((other) => !other.isDeleted &&
    other.type === "arrow" &&
    (other.startBinding?.elementId === el.id ||
      other.endBinding?.elementId === el.id) &&
    !refs.some((ref) => ref.id === other.id && ref.type === "arrow"));
};

/** Original core global endpoint geometry for fixed/imported elbows. */
export const nativeComplexElbowEndpoints = (
  scene: SceneFile,
  id: string,
): { start: Point; end: Point } | null => {
  const arrow = nativeEditableComplexElbow(scene, id);
  if (!arrow) return null;
  try {
    const map = nativeElementsMap(scene);
    const start = LinearElementEditor.getPointAtIndexGlobalCoordinates(arrow, 0, map);
    const end = LinearElementEditor.getPointAtIndexGlobalCoordinates(arrow, -1, map);
    if (![...start, ...end].every(Number.isFinite)) return null;
    return {
      start: { x: start[0], y: start[1] },
      end: { x: end[0], y: end[1] },
    };
  } catch {
    return null;
  }
};

export const pickNativeComplexElbowEndpoint = (
  scene: SceneFile,
  id: string,
  at: Point,
  tolerance = 9,
): End | null => {
  const ends = nativeComplexElbowEndpoints(scene, id);
  if (!ends || !finite(at) || !Number.isFinite(tolerance)) return null;
  for (const end of ["end", "start"] as const) {
    if (Math.hypot(at.x - ends[end].x, at.y - ends[end].y) <= tolerance) return end;
  }
  return null;
};

const findTarget = (
  scene: SceneFile,
  at: Point,
): ExcalidrawElement | null => {
  const map = nativeElementsMap(scene);
  for (let i = scene.elements.length - 1; i >= 0; i--) {
    const el = scene.elements[i];
    if (isBox(el) && hitTest(el, at, 10, map)) {
      return safeTarget(scene, el) ? el : null;
    }
  }
  return null;
};

/**
 * Original LinearElementEditor moves endpoints, while Excalidraw core
 * unbindBindingElement/bindBindingElement and Scene.mutateElement own
 * fixed-point recalculation and orthogonal rerouting. Never synthesize
 * new global bends, reciprocal references or route direction in Svelte.
 */
export const reconnectNativeComplexElbowEndpoint = (
  scene: SceneFile,
  id: string,
  end: End,
  at: Point,
): SceneFile => {
  const arrow = nativeEditableComplexElbow(scene, id);
  if (!arrow || !finite(at)) return scene;
  const target = findTarget(scene, at);
  const opposite = arrow[end === "start" ? "endBinding" : "startBinding"];
  if (target?.id === opposite?.elementId) return scene;

  const originalBinding = arrow[end === "start" ? "startBinding" : "endBinding"];
  const allowed = new Set([
    arrow.id,
    originalBinding?.elementId,
    target?.id,
    ...(arrow.boundElements ?? []).filter((ref) => ref.type === "text")
      .map((ref) => ref.id),
  ].filter((id): id is string => !!id));

  let next: SceneFile;
  try {
    next = withNativeCoreScene(scene, (core) => {
      const current = core.getNonDeletedElement(id);
      if (!current || !isElbowArrow(current)) return;
      if (originalBinding) {
        unbindBindingElement(current, end, core);
      }
      const point = LinearElementEditor.createPointAt(
        current, core.getNonDeletedElementsMap(), at.x, at.y, null,
      );
      LinearElementEditor.movePoints(
        current, core,
        new Map([[
          end === "start" ? 0 : current.points.length - 1,
          { point },
        ]]),
        undefined,
        { isBindingEnabled: false },
      );
      if (target) {
        const nextTarget = core.getNonDeletedElement(target.id);
        if (!nextTarget) return;
        bindBindingElement(
          current,
          nextTarget as NonDeleted<ExcalidrawBindableElement>,
          "orbit", end, core,
          { value: 1 } as AppState["zoom"],
        );
      }
      core.mutateElement(
        current, { points: [...current.points] },
        { isBindingEnabled: false },
      );
    });
  } catch {
    return scene;
  }

  const after = nativeEditableComplexElbow(next, id);
  if (!after || next === scene ||
      after[end === "start" ? "startBinding" : "endBinding"]?.elementId !==
        (target?.id ?? undefined) ||
      after[end === "start" ? "endBinding" : "startBinding"]?.elementId !==
        opposite?.elementId ||
      next.elements.some((el, i) =>
        !allowed.has(el.id) && el !== scene.elements[i]
      )) return scene;
  if (target && !next.elements.find((item) => item.id === target.id)
    ?.boundElements?.some((ref) =>
      ref.type === "arrow" && ref.id === id
    )) return scene;
  if (originalBinding && originalBinding.elementId !== target?.id &&
      next.elements.find((item) => item.id === originalBinding.elementId)
        ?.boundElements?.some((ref) => ref.id === id &&
          originalBinding.elementId !== opposite?.elementId)) {
    return scene;
  }
  return next;
};
