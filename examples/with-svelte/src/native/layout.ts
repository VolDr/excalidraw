import { alignElements, distributeElements } from "@excalidraw/element";

import type { Alignment, Distribution } from "@excalidraw/element";
import type { ExcalidrawElement, NonDeletedExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { nativeEditableLabel } from "./boundText";
import { isSafeBoundBox } from "./bindings";
import { withNativeCoreScene } from "./coreAdapter";
import { editableSelection, safeGroupMembers } from "./groups";
import { nativeStyleTarget } from "./styles";

import type { SceneFile } from "./scene";

export type NativeLayoutAction =
  | { kind: "align"; alignment: Alignment }
  | { kind: "distribute"; distribution: Distribution };

type LayoutSelection = {
  unitCount: number;
  selectedGroupIds: Record<string, boolean>;
};

const isBoundLabel = (element: ExcalidrawElement) =>
  element.type === "text" && element.containerId !== null;

/**
 * Excalidraw aligns groups as logical selection units. Verify complete
 * native groups (including their internal caption nodes) before building
 * the same selectedGroupIds input expected by the original algorithms.
 * Invalid imported links, nested groups, locked roots and partial
 * selections must never be mutated as a side effect of a layout command.
 */
const nativeLayoutSelection = (
  scene: SceneFile,
  ids: readonly string[],
): LayoutSelection | null => {
  const unique = new Set(ids);
  if (
    unique.size !== ids.length ||
    unique.size < 2 ||
    editableSelection(scene, ids).length !== unique.size
  ) {
    return null;
  }

  const byId = new Map(scene.elements.map((element) => [element.id, element]));
  const units = new Set<string>();
  const selectedGroupIds: Record<string, boolean> = {};

  for (const id of ids) {
    const element = byId.get(id);
    if (!element || element.isDeleted || element.locked || element.frameId) {
      return null;
    }

    if (element.groupIds.length === 1) {
      const groupId = element.groupIds[0];
      // Group policy comes from the existing native safeGroupMembers guard:
      // labels are included in the group, but never selected on their own.
      const members = safeGroupMembers(scene, groupId);
      if (
        !members.length ||
        members.filter((member) => !isBoundLabel(member))
          .some((member) => !unique.has(member.id))
      ) {
        return null;
      }
      selectedGroupIds[groupId] = true;
      units.add(`group:${groupId}`);
      continue;
    }

    if (element.groupIds.length) {
      return null;
    }
    if (
      !nativeStyleTarget(scene, id) &&
      !(
        isSafeBoundBox(scene, element) &&
        element.boundElements?.length === 1 &&
        element.boundElements[0].type === "text" &&
        !!nativeEditableLabel(scene, element)
      )
    ) {
      return null;
    }
    units.add(`element:${id}`);
  }

  // A whole selected group is one unit; two members of the same group
  // do not constitute two candidates for align/distribute.
  return units.size >= 2
    ? { unitCount: units.size, selectedGroupIds }
    : null;
};

export const nativeLayoutUnitCount = (
  scene: SceneFile,
  ids: readonly string[],
) => nativeLayoutSelection(scene, ids)?.unitCount ?? 0;

export const canLayoutNativeSelection = (
  scene: SceneFile,
  ids: readonly string[],
) => nativeLayoutUnitCount(scene, ids) >= 2;

/**
 * Core Scene holds the original group-aware alignment/distribution
 * geometry, bound-text positioning and element-version semantics.
 * Svelte provides only the validated selection and undo transaction.
 */
export const layoutNativeSelectionWithCore = (
  scene: SceneFile,
  ids: readonly string[],
  action: NativeLayoutAction,
): SceneFile => {
  const selection = nativeLayoutSelection(scene, ids);
  if (
    !selection ||
    (action.kind === "distribute" && selection.unitCount < 3)
  ) {
    return scene;
  }

  return withNativeCoreScene(scene, (core) => {
    const selected = ids.map((id) => core.getNonDeletedElement(id));
    if (selected.some((element) => !element)) {
      return;
    }
    const elements = selected as NonDeletedExcalidrawElement[];
    const appState = {
      selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])),
      selectedGroupIds: selection.selectedGroupIds,
      editingGroupId: null,
    } as AppState;

    if (action.kind === "align") {
      alignElements(elements, action.alignment, core, appState);
    } else {
      distributeElements(
        elements,
        core.getElementsMapIncludingDeleted(),
        action.distribution,
        appState,
        core,
      );
    }
  });
};
