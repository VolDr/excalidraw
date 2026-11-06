import { editableSelection, selectionUnit } from "./groups";
import { deleteSelection } from "./transforms";
import { pickElement } from "./scene";
import type { Point, SceneFile } from "./scene";

/**
 * Svelte eraser uses the existing Excalidraw hit-test path and the original
 * core binding-aware deletion lifecycle; it does not mutate individual
 * references, labels or arrow endpoints itself.
 */
export const nativeEraserHit = (
  scene: SceneFile,
  at: Point,
  tolerance: number,
): string[] => {
  const hit = pickElement(scene.elements, at, tolerance);
  if (!hit) return [];
  // A container-bound label is part of its figure, never a separate eraser
  // target. A grouped member is likewise erased as its whole safe group.
  const root = hit.type === "text" && hit.containerId
    ? scene.elements.find((item) => item.id === hit.containerId) ?? hit
    : hit;
  const unit = selectionUnit(scene, root.id);
  return unit.length && editableSelection(scene, unit).length === unit.length
    ? unit
    : [];
};

/**
 * One continuous eraser gesture has a single original Scene and one undo
 * transaction. If the core refuses an imported or damaged relationship,
 * no partial element deletion is exported.
 */
export const eraseNativeHits = (
  scene: SceneFile,
  ids: readonly string[],
): SceneFile => {
  const selected = editableSelection(scene, ids);
  if (!selected.length || selected.length !== new Set(ids).size) return scene;
  try {
    const next = deleteSelection(scene, selected);
    return next.elements.some((el, index) =>
      el.isDeleted !== scene.elements[index]?.isDeleted
    ) ? next : scene;
  } catch {
    return scene;
  }
};
