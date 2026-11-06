import { transformElements } from "@excalidraw/element";

import type { ExcalidrawElement, NonDeleted, NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { nativeReciprocalCaption } from "./boundText";
import { validBinding } from "./bindings";
import { withNativeCoreScene } from "./coreAdapter";
import { editableNativeGroupSelection } from "./groupEditing";
import { hasClosedNativeSimpleLinks, safeGroupMembers } from "./groups";

import type { Handle } from "./transforms";
import type { Point, SceneFile } from "./scene";

const isBox = (element: ExcalidrawElement) =>
  element.type === "rectangle" ||
  element.type === "ellipse" ||
  element.type === "diamond";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Excalidraw's original single-element resize and rotation operations may
 * update all connected arrows. Keep only an entire validated group editable;
 * its immediate child box is the single transform target.
 */
export const canTransformNativeInnerBox = (
  scene: SceneFile,
  id: string,
  editingGroupId: string,
): boolean => {
  if (editableNativeGroupSelection(scene, [id], editingGroupId).length !== 1) {
    return false;
  }
  const box = scene.elements.find((element) => element.id === id);
  if (
    !box || !isBox(box) || box.isDeleted || box.locked || !!box.frameId ||
    box.width <= 20 || box.height <= 20 ||
    ![box.x, box.y, box.angle, box.width, box.height].every(Number.isFinite)
  ) return false;
  const outer = box.groupIds.at(-1)!;
  const members = safeGroupMembers(scene, outer);
  if (!members.length) return false;
  const refs = box.boundElements ?? [];
  if (
    new Set(refs.map((ref) => ref.id)).size !== refs.length ||
    refs.some((ref) => ref.type !== "text" && ref.type !== "arrow") ||
    refs.filter((ref) => ref.type === "text").length > 1
  ) return false;
  if (refs.some((ref) => ref.type === "arrow") &&
      !hasClosedNativeSimpleLinks(scene, members)) return false;
  for (const ref of refs) {
    if (ref.type === "text") {
      const label = scene.elements.find((element) => element.id === ref.id);
      if (!label || nativeReciprocalCaption(scene, label)?.id !== id) return false;
    }
  }
  return true;
};

/**
 * The original transformElements delegates to resizeSingleElement for a
 * resize gesture and to rotateSingleElement for rotation. No Svelte size
 * or endpoint geometry is calculated.
 */
export const transformNativeInnerBoxWithCore = (
  scene: SceneFile,
  id: string,
  editingGroupId: string,
  handle: Handle,
  pointer: Point,
): SceneFile => {
  if (
    !canTransformNativeInnerBox(scene, id, editingGroupId) ||
    !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)
  ) return scene;
  const sourceBox = scene.elements.find((element) => element.id === id)!;
  const outer = sourceBox.groupIds.at(-1)!;
  const members = safeGroupMembers(scene, outer);
  const memberIds = new Set(members.map((element) => element.id));

  let result: SceneFile;
  try {
    result = withNativeCoreScene(scene, (core) => {
      const target = core.getNonDeletedElement(id);
      if (!target || !isBox(target)) return;
      const originals = new Map<string, NonDeleted<ExcalidrawElement>>(
        core.getNonDeletedElements().map((element) => [
          element.id, structuredClone(element),
        ]),
      );
    transformElements(
      originals,
      handle === "rotate" ? "rotation" : handle,
      [target as NonDeletedExcalidrawElement],
      core,
      false,
      false,
      false,
      pointer.x,
      pointer.y,
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    });
  } catch {
    // Original source is immutable even if core rejects an imported shape.
    return scene;
  }
  if (result === scene || !safeGroupMembers(result, outer).length) {
    return scene;
  }

  for (let i = 0; i < scene.elements.length; i++) {
    const before = scene.elements[i];
    const after = result.elements[i];
    if (!after || after.id !== before.id) return scene;
    if (!memberIds.has(before.id)) {
      if (after !== before) return scene;
      continue;
    }
    if (
      before.type !== after.type ||
      before.isDeleted !== after.isDeleted ||
      before.index !== after.index ||
      before.locked !== after.locked ||
      !same(before.groupIds, after.groupIds) ||
      !same(before.boundElements, after.boundElements) ||
      ![after.x, after.y, after.width, after.height, after.angle].every(Number.isFinite) ||
      after.width < 0 || after.height < 0
    ) return scene;
    if (before.type === "arrow") {
      if (
        after.type !== "arrow" ||
        before.startBinding?.elementId !== after.startBinding?.elementId ||
        before.endBinding?.elementId !== after.endBinding?.elementId ||
        !validBinding(after.startBinding) || !validBinding(after.endBinding) ||
        after.points.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v)))
      ) return scene;
    }
    if (before.type === "text" && (
      after.type !== "text" ||
      before.containerId !== after.containerId ||
      before.originalText !== after.originalText
    )) return scene;
  }
  const nextBox = result.elements.find((element) => element.id === id);
  return nextBox && nextBox.width > 20 && nextBox.height > 20 ? result : scene;
};
