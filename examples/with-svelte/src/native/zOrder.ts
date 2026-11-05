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

import { nativeStyleTarget } from "./styles";

import type { SceneFile } from "./scene";

export type NativeLayerMove = "back" | "forward" | "bottom" | "top";

/**
 * Invoke Excalidraw's own z-order operations in an isolated core Scene.
 * This adapter only selects a strictly independent root and adopts the
 * reordered array, preserving untouched source objects and extension fields.
 * The original algorithms own bound-text adjacency and fractional indices.
 */
export function moveNativeLayerWithCore(
  scene: SceneFile,
  id: string,
  direction: NativeLayerMove,
): SceneFile {
  if (!nativeStyleTarget(scene, id)) {
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
    const selectedElementIds: AppState["selectedElementIds"] = { [id]: true };
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
    const ids = new Set(reordered.map((element) => element.id));
    if (ids.size !== scene.elements.length ||
        scene.elements.some((element) => !ids.has(element.id))) {
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
