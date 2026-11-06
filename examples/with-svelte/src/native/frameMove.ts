import { dragNativeSelectionWithCore } from "./coreAdapter";
import { isNativeShape } from "./scene";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { SceneFile } from "./scene";

/**
 * Move a frame and every child with Excalidraw's original dragSelectedElements.
 * The React core already includes frame children in a frame drag. Svelte only
 * checks that it did not silently detach imported links or move external
 * elements. Atomic rejection keeps the original scene unchanged.
 */
export const moveNativeFrameWithCore = (
  scene: SceneFile,
  id: string,
  dx: number,
  dy: number,
): SceneFile => {
  const frame = scene.elements.find((element) => element.id === id);
  if (
    !frame || frame.type !== "frame" || frame.isDeleted ||
    frame.locked || !!frame.frameId ||
    !Number.isFinite(dx) || !Number.isFinite(dy) ||
    (!dx && !dy) ||
    scene.elements.some((element) =>
      !element.isDeleted && element.frameId === id &&
      (element.locked || element.type === "frame" ||
        element.type === "magicframe")
    )
  ) return scene;

  const members = scene.elements.filter((element) =>
    !element.isDeleted && element.frameId === id,
  );
  const movedIds = new Set([id, ...members.map((element) => element.id)]);
  // Never move half of an imported group belonging partly to the frame.
  const groupIds = new Set(members.flatMap((element) => element.groupIds));
  if (scene.elements.some((element) =>
    !element.isDeleted && !movedIds.has(element.id) &&
    element.groupIds.some((groupId) => groupIds.has(groupId))
  )) return scene;

  let next: SceneFile;
  try {
    next = dragNativeSelectionWithCore(scene, new Set([id]), dx, dy);
  } catch {
    return scene;
  }
  if (next === scene) return scene;
  for (let i = 0; i < scene.elements.length; i++) {
    const old = scene.elements[i];
    const updated = next.elements[i];
    if (!updated || updated.id !== old.id) return scene;
    if (!movedIds.has(old.id)) {
      if (updated !== old) return scene;
      continue;
    }
    if (
      updated.type !== old.type ||
      updated.frameId !== old.frameId ||
      updated.isDeleted !== old.isDeleted ||
      updated.locked !== old.locked ||
      updated.index !== old.index ||
      JSON.stringify(updated.groupIds) !== JSON.stringify(old.groupIds) ||
      JSON.stringify(updated.boundElements) !== JSON.stringify(old.boundElements) ||
      Math.abs(updated.x - old.x - dx) > 0.5 ||
      Math.abs(updated.y - old.y - dy) > 0.5 ||
      updated.width !== old.width ||
      updated.height !== old.height ||
      updated.angle !== old.angle
    ) return scene;
    if (old.type === "arrow" && (
      updated.type !== "arrow" ||
      JSON.stringify(updated.startBinding) !== JSON.stringify(old.startBinding) ||
      JSON.stringify(updated.endBinding) !== JSON.stringify(old.endBinding)
    )) return scene;
    if (old.type === "text" && (
      updated.type !== "text" ||
      old.containerId !== updated.containerId ||
      old.originalText !== updated.originalText
    )) return scene;
  }
  return next;
};

/**
 * A simple child of a valid native frame is individually editable, like in
 * the original Excalidraw editor. Imported partial bindings, group ancestry
 * and attached labels must remain guarded until their full graph can move.
 */
export const isSafeNativeFrameChild = (
  scene: SceneFile,
  element: ExcalidrawElement,
): boolean => {
  const frame = element.frameId &&
    scene.elements.find((candidate) => candidate.id === element.frameId);
  if (
    !frame || frame.type !== "frame" || frame.isDeleted || frame.locked ||
    element.isDeleted || element.locked || !isNativeShape(element) ||
    element.type === "frame" || element.type === "magicframe" ||
    !!element.groupIds.length || !!element.boundElements?.length ||
    element.type === "text" && !!element.containerId ||
    (element.type === "arrow" || element.type === "line") &&
      (!!element.startBinding || !!element.endBinding) ||
    ![element.x, element.y, element.width, element.height, element.angle]
      .every(Number.isFinite)
  ) return false;

  return !scene.elements.some((other) =>
    !other.isDeleted && other.id !== element.id &&
    (
      other.type === "arrow" &&
        (other.startBinding?.elementId === element.id ||
          other.endBinding?.elementId === element.id) ||
      other.type === "text" && other.containerId === element.id ||
      other.boundElements?.some((ref) => ref.id === element.id)
    )
  );
};

/** Move one independent framed child without detaching its frame. */
export const moveNativeFrameChildWithCore = (
  scene: SceneFile,
  id: string,
  dx: number,
  dy: number,
): SceneFile => {
  const root = scene.elements.find((el) => el.id === id);
  if (!root || !isSafeNativeFrameChild(scene, root) ||
      !Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) {
    return scene;
  }
  let next: SceneFile;
  try {
    next = dragNativeSelectionWithCore(scene, new Set([id]), dx, dy);
  } catch {
    return scene;
  }
  const after = next.elements.find((el) => el.id === id);
  if (
    next === scene || !after ||
    after.frameId !== root.frameId ||
    after.type !== root.type ||
    ![after.x, after.y].every(Number.isFinite) ||
    Math.abs(after.x - root.x - dx) > 0.5 ||
    Math.abs(after.y - root.y - dy) > 0.5 ||
    next.elements.some((el, index) => el.id !== id && el !== scene.elements[index])
  ) return scene;
  return next;
};
