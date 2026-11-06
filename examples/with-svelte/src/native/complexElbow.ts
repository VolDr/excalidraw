import { isElbowArrow, LinearElementEditor, validateElbowPoints } from "@excalidraw/element";
import type { ExcalidrawElbowArrowElement } from "@excalidraw/element/types";
import { nativeElementsMap, withNativeCoreScene } from "./coreAdapter";
import type { Point, SceneFile } from "./scene";

const finitePoint = (point: readonly number[]): boolean =>
  point.length === 2 && point.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e6);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const bindingValid = (binding: ExcalidrawElbowArrowElement["startBinding"]) =>
  !binding || (
    typeof binding.elementId === "string" &&
    (binding.mode === "orbit" || binding.mode === "inside") &&
    Array.isArray(binding.fixedPoint) &&
    finitePoint(binding.fixedPoint) &&
    (binding.mode !== "inside" || binding.fixedPoint.every((n) => n >= 0 && n <= 1))
  );

/**
 * Imported routed elbows can have fixed segments, labels, or complex
 * original inside/orbit bindings. Never replace Excalidraw's router.
 * Only expose segment editing when all references are reciprocal.
 */
export const nativeEditableComplexElbow = (
  scene: SceneFile,
  id: string,
): ExcalidrawElbowArrowElement | null => {
  const arrow = scene.elements.find((item) => item.id === id);
  if (!arrow || !isElbowArrow(arrow) || arrow.isDeleted || arrow.locked ||
      !!arrow.frameId || arrow.groupIds.length > 0 || arrow.angle !== 0 ||
      arrow.points.length < 4 || arrow.points.length > 128 ||
      ![arrow.x, arrow.y, arrow.width, arrow.height].every(Number.isFinite) ||
      !arrow.points.every(finitePoint) || !validateElbowPoints(arrow.points) ||
      !bindingValid(arrow.startBinding) || !bindingValid(arrow.endBinding)) {
    return null;
  }
  const fixed = arrow.fixedSegments ?? [];
  if (!Array.isArray(fixed) || fixed.length > 64 ||
      new Set(fixed.map((s) => s.index)).size !== fixed.length ||
      fixed.some((s) => !Number.isInteger(s.index) ||
        s.index <= 1 || s.index >= arrow.points.length - 1 ||
        !finitePoint(s.start) || !finitePoint(s.end) ||
        !(s.start[0] === s.end[0] || s.start[1] === s.end[1]))) return null;

  const textRefs = arrow.boundElements ?? [];
  if (new Set(textRefs.map((r) => r.id)).size !== textRefs.length ||
      textRefs.some((r) => {
        if (r.type !== "text") return true;
        const label = scene.elements.find((el) => el.id === r.id);
        return !label || label.type !== "text" || label.isDeleted ||
          label.containerId !== arrow.id;
      })) return null;

  const targets = new Set<string>();
  for (const binding of [arrow.startBinding, arrow.endBinding]) {
    if (!binding) continue;
    const box = scene.elements.find((item) => item.id === binding.elementId);
    if (!box || box.isDeleted || box.locked || !!box.frameId ||
        !["rectangle", "ellipse", "diamond"].includes(box.type) ||
        targets.has(box.id) ||
        !box.boundElements?.some((r) => r.id === arrow.id && r.type === "arrow")) {
      return null;
    }
    targets.add(box.id);
  }
  // No unexpected external reverse references or hidden arrow labels.
  if (scene.elements.some((item) =>
    !item.isDeleted && item.id !== arrow.id &&
    (item.boundElements?.some((r) => r.id === arrow.id && !targets.has(item.id)) ||
      (item.type === "text" && item.containerId === arrow.id &&
       !textRefs.some((r) => r.type === "text" && r.id === item.id))))) {
    return null;
  }
  return arrow;
};

export const nativeComplexElbowMidpoints = (
  scene: SceneFile,
  id: string,
): Array<{ index: number; point: Point; fixed: boolean }> => {
  const arrow = nativeEditableComplexElbow(scene, id);
  if (!arrow) return [];
  const map = nativeElementsMap(scene);
  const fixed = new Set((arrow.fixedSegments ?? []).map((s) => s.index));
  const handles: Array<{ index: number; point: Point; fixed: boolean }> = [];
  for (let index = 2; index < arrow.points.length - 1; index++) {
    try {
      const p = LinearElementEditor.getSegmentMidPoint(arrow, index, map);
      if (finitePoint(p)) handles.push({
        index, point: { x: p[0], y: p[1] }, fixed: fixed.has(index),
      });
    } catch {
      return [];
    }
  }
  return handles;
};

export const pickNativeComplexElbowSegment = (
  scene: SceneFile, id: string, point: Point, tolerance = 9,
): number | null => {
  if (![point.x, point.y, tolerance].every(Number.isFinite) ||
      tolerance < 0) return null;
  let index: number | null = null;
  let closest = tolerance;
  for (const handle of nativeComplexElbowMidpoints(scene, id)) {
    const distance = Math.hypot(point.x - handle.point.x, point.y - handle.point.y);
    if (distance <= closest) {
      closest = distance;
      index = handle.index;
    }
  }
  return index;
};

/** Use the original LinearElementEditor for fixed-segment edits. */
export const updateNativeComplexElbowSegment = (
  scene: SceneFile,
  id: string,
  index: number,
  pointer: Point | null,
): SceneFile => {
  const before = nativeEditableComplexElbow(scene, id);
  if (!before || !Number.isInteger(index) || index <= 1 ||
      index >= before.points.length - 1 ||
      (pointer && !finitePoint([pointer.x, pointer.y])) ||
      (!pointer && !before.fixedSegments?.some((s) => s.index === index))) {
    return scene;
  }
  let candidate: SceneFile;
  try {
    candidate = withNativeCoreScene(scene, (core) => {
      const arrow = core.getNonDeletedElement(id);
      if (!arrow || !isElbowArrow(arrow)) return;
      if (!pointer) {
        LinearElementEditor.deleteFixedSegment(arrow, core, index);
      } else {
        const editor = new LinearElementEditor(
          arrow, core.getNonDeletedElementsMap(),
        );
        LinearElementEditor.moveFixedSegment(
          editor, index, pointer.x, pointer.y, core,
        );
      }
    });
  } catch {
    return scene;
  }
  const after = nativeEditableComplexElbow(candidate, id);
  if (!after || candidate === scene ||
      !same(before.startBinding, after.startBinding) ||
      !same(before.endBinding, after.endBinding) ||
      !same(before.boundElements, after.boundElements) ||
      !same(before.groupIds, after.groupIds) ||
      before.index !== after.index ||
      candidate.elements.some((el, i) =>
        el.id !== id && el.type !== "text" && el !== scene.elements[i]
      )) return scene;
  return candidate;
};
