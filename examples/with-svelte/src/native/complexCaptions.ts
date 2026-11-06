import {
  getBoundTextMaxHeight,
  getBoundTextMaxWidth,
  normalizeText,
  redrawTextBoundingBox,
  updateBoundElements,
} from "@excalidraw/element";

import type { ExcalidrawTextElement, ExcalidrawTextElementWithContainer } from "@excalidraw/element/types";

import { nativeReciprocalCaption } from "./boundText";
import { withNativeCoreScene } from "./coreAdapter";
import { safeGroupMembers } from "./groups";

import type { SceneFile } from "./scene";

/**
 * A box may contain a caption AND arrows pointing at it. Editing this text
 * needs the original Excalidraw redraw + arrow binding lifecycle, rather
 * than native manual measurement of the new label.
 *
 * Only complete, closed, non-rotated native groups are currently eligible.
 * Plain captions continue using the simpler single-label pathway.
 */
export const nativeCompositeCaptionTarget = (
  scene: SceneFile,
  boxId: string,
): ExcalidrawTextElement | null => {
  const box = scene.elements.find((item) => item.id === boxId);
  if (
    !box ||
    !["rectangle", "ellipse", "diamond"].includes(box.type) ||
    box.isDeleted ||
    box.locked ||
    box.frameId ||
    box.angle !== 0 ||
    !box.groupIds.length ||
    !box.boundElements?.some((ref) => ref.type === "arrow")
  ) return null;

  const ref = box.boundElements.find((item) => item.type === "text");
  const label = ref && scene.elements.find((item) => item.id === ref.id);
  if (
    !label ||
    label.type !== "text" ||
    label.angle !== 0 ||
    nativeReciprocalCaption(scene, label)?.id !== box.id
  ) return null;
  const groupId = box.groupIds[box.groupIds.length - 1];
  const members = safeGroupMembers(scene, groupId);
  return members.some((item) => item.id === label.id) ? label : null;
};

/**
 * Change the original text in a temporary original Excalidraw Scene:
 * redrawTextBoundingBox updates the caption and container, and
 * updateBoundElements reconciles arrow endpoints if the box has grown.
 * Adopt the result only after checking every reciprocal relationship.
 */
export const updateNativeCompositeCaption = (
  scene: SceneFile,
  boxId: string,
  value: string,
): SceneFile => {
  const label = nativeCompositeCaptionTarget(scene, boxId);
  const originalText = normalizeText(value.trimEnd());
  if (!label || !originalText || label.originalText === originalText) {
    return scene;
  }
  const box = scene.elements.find((item) => item.id === boxId)!;
  const groupId = box.groupIds[box.groupIds.length - 1];
  const members = new Set(safeGroupMembers(scene, groupId).map((item) => item.id));

  const next = withNativeCoreScene(scene, (core) => {
    const coreLabel = core.getNonDeletedElement(label.id);
    const coreBox = core.getNonDeletedElement(boxId);
    if (!coreLabel || coreLabel.type !== "text" || !coreBox) return;
    const oldWidth = coreBox.width;
    const oldHeight = coreBox.height;
    core.mutateElement(coreLabel, { originalText, text: originalText });
    redrawTextBoundingBox(coreLabel, coreBox, core);
    if (coreBox.width !== oldWidth || coreBox.height !== oldHeight) {
      updateBoundElements(coreBox, core);
    }
  });
  if (next === scene || !safeGroupMembers(next, groupId).length) {
    return scene;
  }

  const nextBox = next.elements.find((item) => item.id === boxId);
  const nextLabel = next.elements.find((item) => item.id === label.id);
  if (
    !nextBox ||
    !nextLabel ||
    nextLabel.type !== "text" ||
    nextLabel.originalText !== originalText ||
    nextLabel.containerId !== boxId ||
    nextBox.type !== box.type ||
    JSON.stringify(nextBox.boundElements) !== JSON.stringify(box.boundElements) ||
    ![nextLabel.x, nextLabel.y, nextLabel.width, nextLabel.height]
      .every(Number.isFinite) ||
    nextLabel.width > getBoundTextMaxWidth(nextBox, nextLabel) + 0.5 ||
    nextLabel.height > getBoundTextMaxHeight(nextBox, nextLabel as ExcalidrawTextElementWithContainer) + 0.5
  ) return scene;

  // No mutations to foreign roots, deleted items, group ancestry or
  // arrow endpoint targets may leak from the isolated Scene operation.
  for (let index = 0; index < scene.elements.length; index++) {
    const before = scene.elements[index];
    const after = next.elements[index];
    if (
      !after ||
      (!members.has(before.id) && before !== after) ||
      before.id !== after.id ||
      before.isDeleted !== after.isDeleted ||
      before.type !== after.type ||
      before.groupIds.join("\u0000") !== after.groupIds.join("\u0000")
    ) return scene;
    if (before.type === "arrow") {
      if (
        after.type !== "arrow" ||
        JSON.stringify(before.startBinding) !== JSON.stringify(after.startBinding) ||
        JSON.stringify(before.endBinding) !== JSON.stringify(after.endBinding)
      ) return scene;
    }
  }
  return next;
};
