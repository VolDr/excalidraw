import {
  addElementsToFrame,
  isCursorInFrame,
  isElementInFrame,
  removeElementsFromFrame,
} from "@excalidraw/element";

import type { ExcalidrawElement, ExcalidrawFrameElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { nativeElementsMap } from "./coreAdapter";
import { isSafeNativeFrameChild } from "./frameMove";
import { editableSelection } from "./groups";
import { isNativeShape } from "./scene";

import type { Point, SceneFile } from "./scene";

const independent = (scene: SceneFile, item: ExcalidrawElement) =>
  !item.isDeleted && !item.locked && isNativeShape(item) &&
  item.type !== "frame" &&
  !item.groupIds.length && !item.boundElements?.length &&
  (item.type !== "text" || !item.containerId) &&
  (item.type !== "line" && item.type !== "arrow" ||
    (!item.startBinding && !item.endBinding)) &&
  !scene.elements.some((other) =>
    !other.isDeleted && other.id !== item.id &&
    (other.type === "text" && other.containerId === item.id ||
      other.type === "arrow" &&
      (other.startBinding?.elementId === item.id ||
        other.endBinding?.elementId === item.id) ||
      other.boundElements?.some((ref) => ref.id === item.id)
    )
  );

/**
 * Reproduce the React editor's frame drop path for a single independent root:
 * getTopLayerFrameAtSceneCoords -> isElementInFrame -> addElementsToFrame or
 * removeElementsFromFrame. Geometry, overlap, membership and fractional-index
 * reordering all remain owned by the original Excalidraw functions.
 *
 * Groups and connected arrows deliberately remain read-only on frame drops
 * until the original multi-selection drop semantics can be ported as a unit.
 */
export const reconcileNativeFrameDrop = (
  source: SceneFile,
  moved: SceneFile,
  ids: readonly string[],
  pointer: Point,
): SceneFile => {
  if (source === moved || ids.length !== 1 ||
      ![pointer.x, pointer.y].every(Number.isFinite) ||
      source.elements.length !== moved.elements.length) return moved;

  const id = ids[0];
  const old = source.elements.find((el) => el.id === id);
  const root = moved.elements.find((el) => el.id === id);
  if (!old || !root || old.type !== root.type ||
      !independent(source, old) ||
      (old.frameId &&
        !isSafeNativeFrameChild(source, old)) ||
      editableSelection(source, [id]).length !== 1) return moved;

  // No cross-frame move if another editor-side mutation happened during drag.
  if (moved.elements.some((el, i) => el.id !== id &&
      el !== source.elements[i])) return moved;
  const map = nativeElementsMap(moved);
  const frames = moved.elements.filter((el): el is ExcalidrawFrameElement =>
    el.type === "frame" && !el.isDeleted && !el.locked &&
    !el.frameId && !el.groupIds.length
  );
  let target: ExcalidrawFrameElement | null = null;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (isCursorInFrame(pointer, frames[i], map)) {
      target = frames[i];
      break;
    }
  }
  const state = {
    selectedElementIds: { [id]: true },
    selectedGroupIds: {},
    selectedElementsAreBeingDragged: true,
    frameToHighlight: target,
    editingGroupId: null,
  } as unknown as AppState;
  try {
    const withinTarget = !!target && isElementInFrame(
      root, map, state, { targetFrame: target },
    );
    const oldFrame = old.frameId
      ? moved.elements.find((el) => el.id === old.frameId) : null;
    const stillInOld = !!oldFrame && oldFrame.type === "frame" &&
      isElementInFrame(root, map, state, { targetFrame: oldFrame });

    if ((!target || !withinTarget) && (!old.frameId || stillInOld)) {
      return moved;
    }
    const destination = target && withinTarget ? target.id : null;
    if (destination === root.frameId) return moved;

    const copied = moved.elements.map((el) => structuredClone(el));
    const byId = new Map(copied.map((el) => [el.id, el]));
    const child = byId.get(id);
    if (!child) return moved;
    let result = copied;
    if (destination) {
      const frame = byId.get(destination);
      if (!frame || frame.type !== "frame") return moved;
      result = addElementsToFrame(copied, [child], frame);
    } else {
      removeElementsFromFrame(new Set([child]), byId);
    }
    if (result.length !== moved.elements.length ||
        new Set(result.map((el) => el.id)).size !== moved.elements.length) {
      return moved;
    }
    const after = result.find((el) => el.id === id);
    if (!after || after.frameId !== destination) return moved;
    const originalById = new Map(moved.elements.map((el) => [el.id, el]));
    for (const el of result) {
      const initial = originalById.get(el.id);
      if (!initial || el.type !== initial.type ||
          el.isDeleted !== initial.isDeleted ||
          JSON.stringify(el.groupIds) !== JSON.stringify(initial.groupIds) ||
          JSON.stringify(el.boundElements) !== JSON.stringify(initial.boundElements) ||
          (el.id !== id && (
            el.frameId !== initial.frameId ||
            el.x !== initial.x || el.y !== initial.y ||
            el.width !== initial.width || el.height !== initial.height ||
            el.angle !== initial.angle
          ))) return moved;
    }
    return {
      ...moved,
      elements: result.map((el) => {
        const previous = originalById.get(el.id);
        return previous && JSON.stringify(previous) === JSON.stringify(el)
          ? previous : el;
      }),
    };
  } catch {
    return moved;
  }
};
