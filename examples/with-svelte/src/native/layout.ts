import { alignElements, distributeElements } from "@excalidraw/element";

import type { Alignment, Distribution } from "@excalidraw/element";
import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { withNativeCoreScene } from "./coreAdapter";
import { editableSelection } from "./groups";
import { nativeStyleTarget } from "./styles";

import type { SceneFile } from "./scene";

export type NativeLayoutAction =
  | { kind: "align"; alignment: Alignment }
  | { kind: "distribute"; distribution: Distribution };

/**
 * Use Excalidraw's existing align/distribute implementation on an isolated
 * core Scene. Svelte merely selects eligible roots and exposes controls.
 *
 * This first path intentionally rejects groups, captions, bound arrows and
 * damaged imported references. The original core handles all translation,
 * bounding boxes, revision increments and bound-element repair.
 */
export const canLayoutNativeSelection = (
  scene: SceneFile,
  ids: readonly string[],
): boolean => {
  const unique = [...new Set(ids)];
  if (unique.length < 2 || unique.length !== ids.length) {
    return false;
  }
  const allowed = new Set(editableSelection(scene, unique));
  return (
    allowed.size === unique.length &&
    unique.every((id) => {
      const element = nativeStyleTarget(scene, id);
      return !!element && !element.groupIds.length;
    })
  );
};

export const layoutNativeSelectionWithCore = (
  scene: SceneFile,
  ids: readonly string[],
  action: NativeLayoutAction,
): SceneFile => {
  if (
    !canLayoutNativeSelection(scene, ids) ||
    (action.kind === "distribute" && ids.length < 3)
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
      selectedGroupIds: {},
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
