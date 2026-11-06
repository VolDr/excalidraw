import { getElementsInGroup } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { safeGroupMembers, selectionUnit } from "./groups";

import type { SceneFile } from "./scene";

/**
 * EditingGroupId is the original Excalidraw concept: while editing an
 * outer group, a click selects its immediate children; children that form
 * inner groups stay atomic until the user enters those groups as well.
 * Group ancestry is already stored by the original Excalidraw algorithms
 * in innermost -> outermost order. The Svelte host only tracks UI scope.
 */
export const nativeEnterEditingGroup = (
  scene: SceneFile,
  id: string,
  currentGroupId: string | null,
): string | null => {
  const hit = scene.elements.find((element) => element.id === id);
  const element = hit?.type === "text" && hit.containerId
    ? scene.elements.find((candidate) => candidate.id === hit.containerId)
    : hit;
  if (!element || element.isDeleted) return null;
  const position = currentGroupId === null
    ? element.groupIds.length
    : element.groupIds.indexOf(currentGroupId);
  if (position < 1) return null;
  const next = element.groupIds[position - 1];
  return safeGroupMembers(scene, next).length > 0 ? next : null;
};

export const nativeEditingSelectionUnit = (
  scene: SceneFile,
  id: string,
  editingGroupId: string | null,
): string[] => {
  if (!editingGroupId) return selectionUnit(scene, id);
  const hit = scene.elements.find((element) => element.id === id);
  const element = hit?.type === "text" && hit.containerId
    ? scene.elements.find((candidate) => candidate.id === hit.containerId)
    : hit;
  if (
    !element ||
    element.isDeleted ||
    element.locked ||
    !safeGroupMembers(scene, editingGroupId).some((member) => member.id === element.id)
  ) return [];

  const position = element.groupIds.indexOf(editingGroupId);
  if (position < 0) return [];
  const nestedId = position > 0 ? element.groupIds[position - 1] : null;
  if (nestedId) {
    const members = safeGroupMembers(scene, nestedId);
    return members
      .filter((member) => !(member.type === "text" && member.containerId))
      .map((member) => member.id);
  }

  // The existing safeGroupMembers validation already checks the full
  // reciprocal graph of the edited group. Its individual root can move
  // through Excalidraw's original dragElements binding updates.
  return element.type === "text" && element.containerId
    ? [] : [element.id];
};

/** Reject partial inner groups and selected bound-text nodes. */
export const editableNativeGroupSelection = (
  scene: SceneFile,
  ids: readonly string[],
  editingGroupId: string,
): string[] => {
  const selected = new Set(ids);
  if (!selected.size || selected.size !== ids.length ||
      !safeGroupMembers(scene, editingGroupId).length) return [];

  for (const id of ids) {
    const unit = nativeEditingSelectionUnit(scene, id, editingGroupId);
    if (!unit.length || unit.some((member) => !selected.has(member))) {
      return [];
    }
  }
  return getElementsInGroup(scene.elements, editingGroupId)
    .filter((element) =>
      selected.has(element.id) &&
      !element.isDeleted &&
      !(element.type === "text" && element.containerId)
    )
    .map((element) => element.id);
};

/** Exiting one level selects the group being exited in its parent scope. */
export const nativeExitEditingGroup = (
  scene: SceneFile,
  editingGroupId: string,
): { editingGroupId: string | null; selectedIds: string[] } => {
  const members = safeGroupMembers(scene, editingGroupId);
  const first = members.find((element) =>
    !(element.type === "text" && element.containerId)
  );
  if (!first) {
    return { editingGroupId: null, selectedIds: [] };
  }
  const index = first.groupIds.indexOf(editingGroupId);
  const parent = first.groupIds[index + 1] ?? null;
  return {
    editingGroupId: parent,
    selectedIds: nativeEditingSelectionUnit(scene, first.id, parent),
  };
};
