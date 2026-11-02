import {
  fixBindingsAfterDeletion,
  newElementWith,
  Scene,
} from "@excalidraw/element";

import type { ElementUpdate } from "@excalidraw/element";
import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import type { SceneFile } from "./scene";

/**
 * Keep Excalidraw's version/nonce/timestamp and no-op semantics consistent
 * across the Svelte immutable scene adapter. Never hand-roll metadata bumps.
 */
export const updateNativeElement = <T extends ExcalidrawElement>(
  element: T,
  changes: ElementUpdate<T>,
): T => newElementWith(element, changes);

/**
 * Original Excalidraw geometry/binding APIs use a map of all elements.
 * A native SceneFile is still a serializable snapshot; this temporary
 * adapter builds the expected map without mounting the React editor.
 */
export const nativeElementsMap = (
  scene: { readonly elements: readonly ExcalidrawElement[] },
): ElementsMap =>
  new Map(scene.elements.map((element) => [element.id, element])) as ElementsMap;

/**
 * Run a Scene-dependent Excalidraw algorithm without exposing our immutable
 * Svelte store to the core's in-place mutations.
 *
 * Scene synchronizes fractional indices when constructed. These are *not*
 * applied back to the native file: preserve original element order and index
 * explicitly, and adopt only elements whose versions changed in the core
 * transaction. Unknown extension fields and unrelated objects survive.
 */
export function withNativeCoreScene(
  scene: SceneFile,
  operation: (core: Scene) => void,
): SceneFile {
  const core = new Scene(structuredClone(scene.elements), {
    skipValidation: true,
  });
  try {
    operation(core);
    const nextElements = core.getElementsIncludingDeleted();
    if (
      nextElements.length !== scene.elements.length ||
      nextElements.some((element, index) => element.id !== scene.elements[index].id)
    ) {
      throw new Error("Core Scene adapter cannot insert or reorder elements");
    }

    let changed = false;
    const elements = scene.elements.map((original, index) => {
      const updated = nextElements[index];
      if (
        updated.version === original.version &&
        updated.versionNonce === original.versionNonce
      ) {
        return original;
      }
      changed = true;
      return {
        ...updated,
        index: original.index,
      };
    });
    return changed ? { ...scene, elements } : scene;
  } finally {
    core.destroy();
  }
}

/**
 * The official reciprocal-binding deletion lifecycle updates all affected
 * neighbors in an isolated core Scene. Soft deletion remains immutable and
 * source order/index/extension fields are preserved by the adapter.
 */
export function deleteNativeElementsWithCore(
  scene: SceneFile,
  ids: ReadonlySet<string>,
): SceneFile {
  if (!ids.size) {
    return scene;
  }
  const originals = scene.elements.filter(
    (element) => ids.has(element.id) && !element.isDeleted,
  );
  if (!originals.length || originals.length !== ids.size) {
    return scene;
  }
  const unbound = withNativeCoreScene(scene, (core) => {
    const elements = core.getElementsIncludingDeleted();
    fixBindingsAfterDeletion(
      elements,
      elements.filter((element) => ids.has(element.id)),
    );
  });
  return {
    ...unbound,
    elements: unbound.elements.map((element) =>
      ids.has(element.id)
        ? updateNativeElement(element, { isDeleted: true })
        : element,
    ),
  };
}
