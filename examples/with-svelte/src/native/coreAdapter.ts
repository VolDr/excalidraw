import { fixBindingsAfterDeletion, newElementWith } from "@excalidraw/element";

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
 * Apply the original Excalidraw reciprocal-binding deletion lifecycle to a
 * private copy, then soft-delete the requested IDs. The core helper mutates
 * its arguments, so it must never see the Svelte state objects directly.
 *
 * Selection/unsupported-binding policy is enforced by the caller; this layer
 * only handles mutation mechanics. The original scene is never modified.
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
  const elements = structuredClone(scene.elements);
  const deleted = elements.filter((element) => ids.has(element.id));
  fixBindingsAfterDeletion(elements, deleted);
  return {
    ...scene,
    elements: elements.map((element) =>
      ids.has(element.id)
        ? updateNativeElement(element, { isDeleted: true })
        : element,
    ),
  };
}
