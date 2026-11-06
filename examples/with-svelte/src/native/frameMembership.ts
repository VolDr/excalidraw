import {
  addElementsToFrame,
  getElementsInResizingFrame,
  removeElementsFromFrame,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { nativeElementsMap } from "./coreAdapter";
import { isNativeShape } from "./scene";

import type { SceneFile } from "./scene";

const isSafeMembershipRoot = (
  scene: SceneFile,
  root: ExcalidrawElement,
): boolean => {
  if (
    !isNativeShape(root) || root.isDeleted || root.locked ||
    !!root.groupIds.length || !!root.boundElements?.length ||
    root.type === "frame" || root.type === "magicframe" ||
    (root.type === "text" && !!root.containerId) ||
    (root.type === "line" || root.type === "arrow") &&
      (!!root.startBinding || !!root.endBinding) ||
    ![root.x, root.y, root.width, root.height, root.angle].every(Number.isFinite)
  ) return false;

  // An imported element can have no forward references but still be the
  // target of an external arrow, orphaned text or reverse binding.
  return !scene.elements.some((other) =>
    !other.isDeleted && other.id !== root.id &&
    (
      other.type === "arrow" &&
        (other.startBinding?.elementId === root.id ||
          other.endBinding?.elementId === root.id) ||
      other.type === "text" && other.containerId === root.id ||
      other.boundElements?.some((ref) => ref.id === root.id)
    )
  );
};

/**
 * Reconcile only independent frame children after original core resize.
 *
 * The membership candidate set comes from Excalidraw's original
 * getElementsInResizingFrame (including its intersection and group rules).
 * The actual adoption/removal is delegated to original frame mutators,
 * never to Svelte-made frameId assignments or fractional-index ordering.
 *
 * Mixed group/link deltas fail closed; valid existing content is unchanged.
 */
export const reconcileNativeResizedFrameMembership = (
  source: SceneFile,
  resized: SceneFile,
  frameId: string,
): SceneFile => {
  if (resized === source ||
      source.elements.length !== resized.elements.length) return source;

  const oldFrame = source.elements.find((el) => el.id === frameId);
  const newFrame = resized.elements.find((el) => el.id === frameId);
  if (
    !oldFrame || oldFrame.type !== "frame" ||
    !newFrame || newFrame.type !== "frame" ||
    oldFrame.isDeleted || newFrame.isDeleted ||
    oldFrame.frameId !== newFrame.frameId
  ) return source;

  const state = {
    editingGroupId: null,
    selectedElementIds: { [frameId]: true },
    selectedGroupIds: {},
  } as unknown as AppState;
  try {
    const candidates = getElementsInResizingFrame(
      resized.elements, newFrame, state, nativeElementsMap(resized),
    );
    // Excalidraw's function intentionally excludes bound text elements,
    // so the comparison uses top-level frame roots, not internal captions.
    const originalRoots = source.elements.filter((el) =>
      !el.isDeleted && el.frameId === frameId &&
      !(el.type === "text" && !!el.containerId)
    );
    const oldIds = new Set(originalRoots.map((el) => el.id));
    const newIds = new Set(candidates.map((el) => el.id));
    if (newIds.size !== candidates.length ||
        candidates.some((el) => el.isDeleted || el.id === frameId)) {
      return source;
    }

    const removing = originalRoots.filter((el) => !newIds.has(el.id));
    const adding = candidates.filter((el) => !oldIds.has(el.id));
    if (!removing.length && !adding.length) return resized;

    const changed = [...removing, ...adding];
    if (
      changed.some((el) =>
        !isSafeMembershipRoot(source, el) ||
        (el.frameId !== null && el.frameId !== frameId)
      )
    ) return source;

    const clones = resized.elements.map((el) => structuredClone(el));
    const byId = new Map(clones.map((el) => [el.id, el]));
    const frame = byId.get(frameId);
    if (!frame || frame.type !== "frame") return source;
    const toRemove = removing.map((el) => byId.get(el.id));
    const toAdd = adding.map((el) => byId.get(el.id));
    if ([...toRemove, ...toAdd].some((el) => !el)) return source;

    removeElementsFromFrame(
      new Set(toRemove as ExcalidrawElement[]),
      byId,
    );
    const merged = addElementsToFrame(
      clones,
      toAdd as ExcalidrawElement[],
      frame,
    );
    if (merged.length !== source.elements.length) return source;
    const resultById = new Map(merged.map((el) => [el.id, el]));
    if (resultById.size !== source.elements.length) return source;
    for (const previous of source.elements) {
      const after = resultById.get(previous.id);
      if (!after ||
          (previous.id !== frameId &&
            (previous.isDeleted !== after.isDeleted ||
              previous.type !== after.type ||
              JSON.stringify(previous.groupIds) !== JSON.stringify(after.groupIds) ||
              JSON.stringify(previous.boundElements) !== JSON.stringify(after.boundElements)))) {
        return source;
      }
      if (previous.id === frameId) continue;
      const shouldBelong = newIds.has(previous.id);
      if (previous.frameId === frameId || shouldBelong) {
        if (after.frameId !== (shouldBelong ? frameId : null)) return source;
      } else if (previous.frameId !== after.frameId) {
        return source;
      }
    }
    const previousById = new Map(source.elements.map((el) => [el.id, el]));
    const nextElements = merged.map((el) => {
      const original = previousById.get(el.id);
      return original &&
        JSON.stringify(original) === JSON.stringify(el) ? original : el;
    });
    return { ...resized, elements: nextElements };
  } catch {
    return source;
  }
};
