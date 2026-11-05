import {
  moveAllLeft,
  moveAllRight,
  moveOneLeft,
  moveOneRight,
  Scene,
  validateFractionalIndices,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { nativeEditableLabel } from "./boundText";
import { isSafeBoundBox } from "./bindings";
import { editableSelection, safeGroupMembers } from "./groups";
import { nativeStyleTarget } from "./styles";

import type { SceneFile } from "./scene";

export type NativeLayerMove = "back" | "forward" | "bottom" | "top";

/**
 * Core z-index algorithms expect group members and bound labels to occupy
 * contiguous slots in the document array. Do not reorder a malformed legacy
 * scene where a group is split by unrelated elements, or a label is detached
 * from its container. Preserve those documents for the full React editor.
 */
const hasContiguousGroupRanges = (scene: SceneFile): boolean => {
  const rangeByGroup = new Map<string, { first: number; last: number; count: number }>();
  scene.elements.forEach((element, index) => {
    if (element.isDeleted || !element.groupIds.length) {
      return;
    }
    const id = element.groupIds[element.groupIds.length - 1];
    const range = rangeByGroup.get(id);
    if (range) {
      range.last = index;
      range.count++;
    } else {
      rangeByGroup.set(id, { first: index, last: index, count: 1 });
    }
  });
  for (const range of rangeByGroup.values()) {
    if (range.last - range.first + 1 !== range.count) {
      return false;
    }
  }
  return true;
};

export const canMoveNativeLayer = (
  scene: SceneFile,
  selectedIds: readonly string[],
): boolean => {
  const ids = new Set(selectedIds);
  if (
    !ids.size ||
    ids.size !== selectedIds.length ||
    !hasContiguousGroupRanges(scene) ||
    editableSelection(scene, selectedIds).length !== ids.size
  ) {
    return false;
  }

  const byId = new Map(scene.elements.map((element) => [element.id, element]));
  for (const id of ids) {
    const element = byId.get(id);
    if (!element || element.isDeleted || element.locked || element.frameId) {
      return false;
    }
    if (element.groupIds.length === 1) {
      const members = safeGroupMembers(scene, element.groupIds[0]);
      if (
        !members.length ||
        members
          .filter((member) => member.type !== "text" || !member.containerId)
          .some((member) => !ids.has(member.id))
      ) {
        return false;
      }
      continue;
    }
    if (element.groupIds.length) {
      return false;
    }
    if (nativeStyleTarget(scene, id)) {
      continue;
    }
    if (
      !isSafeBoundBox(scene, element) ||
      element.boundElements?.length !== 1 ||
      element.boundElements[0].type !== "text" ||
      !nativeEditableLabel(scene, element)
    ) {
      return false;
    }
  }
  return true;
};

/**
 * Invoke Excalidraw's own z-order operations in an isolated core Scene.
 * The adapter authorizes whole validated selections, including safe flat
 * groups and reciprocal captions, and adopts the core's reordered array.
 * Excalidraw owns bound-text adjacency and fractional indices.
 */
export function moveNativeLayerWithCore(
  scene: SceneFile,
  idOrIds: string | readonly string[],
  direction: NativeLayerMove,
): SceneFile {
  const ids = typeof idOrIds === "string" ? [idOrIds] : [...idOrIds];
  if (!canMoveNativeLayer(scene, ids)) {
    return scene;
  }
  try {
    validateFractionalIndices(scene.elements, {
      includeBoundTextValidation: false,
      shouldThrow: true,
      ignoreLogs: true,
    });
  } catch {
    // Avoid silently rewriting a damaged imported document on reorder.
    return scene;
  }

  const core = new Scene(structuredClone(scene.elements), { skipValidation: true });
  try {
    const originals = core.getElementsIncludingDeleted();
    const initialById = new Map(
      originals.map((element) => [
        element.id,
        { index: element.index, version: element.version },
      ]),
    );
    const selectedElementIds: AppState["selectedElementIds"] = Object.fromEntries(ids.map((id) => [id, true]));
    const state = {
      selectedElementIds,
      editingGroupId: null,
    } as AppState;

    const reordered = direction === "back"
      ? moveOneLeft(originals, state, core)
      : direction === "forward"
        ? moveOneRight(originals, state, core)
        : direction === "bottom"
          ? moveAllLeft(originals, state)
          : moveAllRight(originals, state);

    if (
      reordered.length !== scene.elements.length ||
      reordered.every((element, index) => element.id === scene.elements[index].id)
    ) {
      return scene;
    }
    const reorderedIds = new Set(reordered.map((element) => element.id));
    if (reorderedIds.size !== scene.elements.length ||
        scene.elements.some((element) => !reorderedIds.has(element.id))) {
      return scene;
    }

    validateFractionalIndices(reordered, {
      includeBoundTextValidation: false,
      shouldThrow: true,
      ignoreLogs: true,
    });
    const sourceById = new Map(scene.elements.map((element) => [element.id, element]));
    const elements: ExcalidrawElement[] = reordered.map((element) => {
      const original = sourceById.get(element.id)!;
      const baseline = initialById.get(element.id)!;
      if (element.index === baseline.index) {
        return original;
      }
      return {
        ...original,
        index: element.index,
        version: original.version + element.version - baseline.version,
        versionNonce: element.versionNonce,
        updated: element.updated,
      };
    });
    return { ...scene, elements };
  } catch {
    return scene;
  } finally {
    core.destroy();
  }
}
