import {
  dragSelectedElements,
  fixBindingsAfterDeletion,
  getNextSingleWidthAndHeightFromPointer,
  resizeSingleElement,
  newElementWith,
  Scene,
} from "@excalidraw/element";

import type { ElementUpdate } from "@excalidraw/element";
import type {
  ElementsMap,
  ExcalidrawElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import type { PointerDownState } from "@excalidraw/excalidraw/types";

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
  // Scene repairs null/invalid fractional indices during construction,
  // bumping element versions. Treat that as private setup, never as a Svelte
  // edit. Compare against this baseline, not against the imported versions.
  const baseline = core.getElementsIncludingDeleted().map((element) => ({
    version: element.version,
    versionNonce: element.versionNonce,
  }));
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
      const initial = baseline[index];
      if (
        updated.version === initial.version &&
        updated.versionNonce === initial.versionNonce
      ) {
        return original;
      }
      changed = true;
      return {
        ...updated,
        index: original.index,
        version: original.version + (updated.version - initial.version),
      };
    });
    return changed ? { ...scene, elements } : scene;
  } finally {
    core.destroy();
  }
}

/**
 * Delegate native pointer motion to Excalidraw's original drag engine.
 * Its only pointer-down dependency is the originalElements snapshot.
 * We supply that snapshot from an isolated core Scene rather than creating
 * a second React pointer controller. No snapping is enabled by native UI.
 *
 * The caller must first authorize the complete selection through native
 * safe-selection guards; this is an implementation bridge, not permission
 * to edit arbitrary imported bindings or frames.
 */
export function dragNativeSelectionWithCore(
  scene: SceneFile,
  ids: ReadonlySet<string>,
  dx: number,
  dy: number,
): SceneFile {
  if (!ids.size || (!dx && !dy) || !Number.isFinite(dx) || !Number.isFinite(dy)) {
    return scene;
  }
  return withNativeCoreScene(scene, (core) => {
    const selected = Array.from(ids, (id) => core.getNonDeletedElement(id));
    if (selected.some((element) => !element)) {
      return;
    }
    const originalElements = new Map<string, NonDeleted<ExcalidrawElement>>();
    for (const element of core.getNonDeletedElements()) {
      originalElements.set(element.id, structuredClone(element));
    }
    // Verified against dragElements.ts: this function only reads the
    // pointerDownState.originalElements field.
    const pointerDown = { originalElements } as PointerDownState;
    dragSelectedElements(
      pointerDown,
      selected as NonDeleted<ExcalidrawElement>[],
      { x: dx, y: dy },
      core,
      { x: 0, y: 0 },
      null,
    );
  });
}

/**
 * Core single-element resize for plain unbound native boxes. The safety
 * restrictions are intentionally duplicated at this boundary: callers
 * may not pass a complex imported element into a Scene mutator.
 * Images (crop/flip), text containers, arrows and nested groups require
 * separate parity handling.
 */
export function resizeNativeBoxWithCore(
  scene: SceneFile,
  id: string,
  handle: "nw" | "ne" | "sw" | "se",
  pointer: { x: number; y: number },
): SceneFile {
  const element = scene.elements.find((item) => item.id === id);
  if (
    !element ||
    !["rectangle", "ellipse", "diamond"].includes(element.type) ||
    element.isDeleted ||
    element.locked ||
    element.frameId ||
    element.groupIds.length ||
    element.boundElements?.length ||
    !Number.isFinite(element.width) ||
    !Number.isFinite(element.height) ||
    element.width <= 0 ||
    element.height <= 0 ||
    scene.elements.some(
      (other) =>
        other.id !== id &&
        !other.isDeleted &&
        ((other.type === "text" && other.containerId === id) ||
          (other.type === "arrow" &&
            (other.startBinding?.elementId === id ||
              other.endBinding?.elementId === id))),
    ) ||
    !Number.isFinite(pointer.x) ||
    !Number.isFinite(pointer.y)
  ) {
    return scene;
  }
  const { nextWidth, nextHeight } = getNextSingleWidthAndHeightFromPointer(
    element,
    element,
    handle,
    pointer.x,
    pointer.y,
  );
  if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) {
    return scene;
  }
  const minSize = 8;
  return withNativeCoreScene(scene, (core) => {
    const latest = core.getNonDeletedElement(id);
    if (!latest) {
      return;
    }
    const originalElementsMap = new Map(
      core.getNonDeletedElements().map((item) => [
        item.id,
        structuredClone(item),
      ]),
    ) as ElementsMap;
    const original = originalElementsMap.get(id);
    if (!original) {
      return;
    }
    resizeSingleElement(
      Math.max(minSize, nextWidth),
      Math.max(minSize, nextHeight),
      latest as NonDeletedExcalidrawElement,
      original as NonDeletedExcalidrawElement,
      originalElementsMap,
      core,
      handle,
      {
        shouldMaintainAspectRatio: false,
        shouldResizeFromCenter: false,
      },
    );
  });
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
