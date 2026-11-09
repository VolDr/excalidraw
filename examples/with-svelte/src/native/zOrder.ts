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
    if (element.groupIds.length > 0) {
      const members = safeGroupMembers(
        scene, element.groupIds[element.groupIds.length - 1],
      );
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
