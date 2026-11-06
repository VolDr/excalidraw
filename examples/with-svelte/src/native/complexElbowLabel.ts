import {
  LinearElementEditor,
  normalizeText,
  redrawTextBoundingBox,
} from "@excalidraw/element";
import type { ExcalidrawTextElement } from "@excalidraw/element/types";
import { nativeEditableComplexElbow } from "./complexElbow";
import { nativeElementsMap, withNativeCoreScene } from "./coreAdapter";
import type { SceneFile } from "./scene";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Existing reciprocal arrow-label text, not an invented Svelte text model. */
export const nativeComplexElbowLabel = (
  scene: SceneFile,
  arrowId: string,
): ExcalidrawTextElement | null => {
  const arrow = nativeEditableComplexElbow(scene, arrowId);
  if (!arrow) return null;
  const refs = arrow.boundElements ?? [];
  if (refs.length !== 1 || refs[0].type !== "text") return null;
  const text = scene.elements.find((item) => item.id === refs[0].id);
  if (!text || text.type !== "text" || text.isDeleted || text.locked ||
      text.containerId !== arrow.id || !!text.frameId ||
      text.groupIds.length !== 0 || text.angle !== 0 ||
      !text.autoResize || !!text.boundElements?.length ||
      ![text.x, text.y, text.width, text.height, text.fontSize]
        .every(Number.isFinite)) return null;
  if (scene.elements.some((other) =>
    !other.isDeleted && other.id !== text.id &&
    ((other.type === "text" && other.containerId === arrow.id) ||
      (other.id !== arrow.id &&
        other.boundElements?.some((ref) => ref.id === text.id))))) return null;
  return text;
};

/** The original Excalidraw path positions labels along routed arrows. */
export const nativeComplexElbowLabelLayout = (
  scene: SceneFile,
  arrowId: string,
): ExcalidrawTextElement | null => {
  const arrow = nativeEditableComplexElbow(scene, arrowId);
  const text = nativeComplexElbowLabel(scene, arrowId);
  if (!arrow || !text) return null;
  try {
    const { x, y } = LinearElementEditor.getBoundTextElementPosition(
      arrow, text, nativeElementsMap(scene),
    );
    return Number.isFinite(x) && Number.isFinite(y)
      ? { ...text, x, y } : null;
  } catch {
    return null;
  }
};

/**
 * Excalidraw's redrawTextBoundingBox owns wrapping, positioning and text
 * size while the original Scene owns element versions and immutable snapshots.
 * Keep every existing endpoint, fixed segment and unrelated element intact.
 */
export const editNativeComplexElbowLabel = (
  scene: SceneFile,
  arrowId: string,
  value: string,
): SceneFile => {
  const arrow = nativeEditableComplexElbow(scene, arrowId);
  const oldText = nativeComplexElbowLabel(scene, arrowId);
  const originalText = normalizeText(value.trimEnd());
  if (!arrow || !oldText || !originalText ||
      originalText === oldText.originalText) return scene;
  let next: SceneFile;
  try {
    next = withNativeCoreScene(scene, (core) => {
      const label = core.getNonDeletedElement(oldText.id);
      const target = core.getNonDeletedElement(arrowId);
      if (!target || !label || label.type !== "text" ||
          target.type !== "arrow") return;
      core.mutateElement(label, { originalText, text: originalText });
      redrawTextBoundingBox(label, target, core);
    });
  } catch {
    return scene;
  }

  const newArrow = nativeEditableComplexElbow(next, arrowId);
  const newText = nativeComplexElbowLabel(next, arrowId);
  if (!newArrow || !newText || next === scene ||
      newText.originalText !== originalText ||
      !same(newArrow.startBinding, arrow.startBinding) ||
      !same(newArrow.endBinding, arrow.endBinding) ||
      !same(newArrow.fixedSegments, arrow.fixedSegments) ||
      !same(newArrow.boundElements, arrow.boundElements) ||
      !same(newArrow.groupIds, arrow.groupIds) ||
      newText.containerId !== oldText.containerId ||
      next.elements.some((element, index) =>
        element.id !== arrow.id && element.id !== oldText.id &&
        element !== scene.elements[index])) return scene;
  return next;
};
