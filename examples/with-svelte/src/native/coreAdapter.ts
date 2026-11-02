import {
  dragSelectedElements,
  fixBindingsAfterDeletion,
  getBoundTextMaxHeight,
  getBoundTextMaxWidth,
  getNextSingleWidthAndHeightFromPointer,
  resizeMultipleElements,
  transformElements,
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
  ExcalidrawTextElement,
  ExcalidrawTextElementWithContainer,
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
 * A single reciprocal label is safe for core's built-in text-resize handler.
 * Reject malformed imported links and foreign/locked text before mutation.
 * Returns null for an independent box and undefined for an unsafe binding.
 */
const safeResizeLabel = (
  scene: SceneFile,
  element: ExcalidrawElement,
): ExcalidrawTextElement | null | undefined => {
  const refs = element.boundElements;
  if (!refs?.length) {
    return null;
  }
  if (refs.length !== 1 || refs[0].type !== "text") {
    return undefined;
  }
  const label = scene.elements.find((item) => item.id === refs[0].id);
  if (
    !label ||
    label.type !== "text" ||
    label.isDeleted ||
    label.locked ||
    label.frameId ||
    label.groupIds.length !== 0 ||
    label.containerId !== element.id ||
    !label.autoResize ||
    label.boundElements?.length ||
    scene.elements.some((item) =>
      !item.isDeleted &&
      item.id !== element.id &&
      item.boundElements?.some((ref) => ref.id === label.id)
    ) ||
    !Number.isFinite(label.fontSize) ||
    !Number.isFinite(label.width) ||
    !Number.isFinite(label.height) ||
    label.width < 0 ||
    label.height < 0 ||
    element.width <= 20 ||
    element.height <= 20
  ) {
    return undefined;
  }
  return label;
};

/** Shared safety boundary for core rotation and resize of native boxes. */
const canCoreTransformBox = (
  scene: SceneFile,
  element: ExcalidrawElement,
  label: ExcalidrawTextElement | null | undefined,
): boolean =>
  ["rectangle", "ellipse", "diamond"].includes(element.type) &&
  !element.isDeleted &&
  !element.locked &&
  !element.frameId &&
  element.groupIds.length === 0 &&
  label !== undefined &&
  Number.isFinite(element.width) &&
  Number.isFinite(element.height) &&
  element.width > 0 &&
  element.height > 0 &&
  !scene.elements.some(
    (other) =>
      other.id !== element.id &&
      !other.isDeleted &&
      ((other.type === "text" &&
        other.id !== label?.id &&
        other.containerId === element.id) ||
        (other.type === "arrow" &&
          (other.startBinding?.elementId === element.id ||
            other.endBinding?.elementId === element.id))),
  );

/**
 * Check that core reflow preserved both ends of the only text binding. This
 * atomic postcondition is shared by native resize and rotation.
 */
const acceptCoreLabelResult = (
  source: SceneFile,
  result: SceneFile,
  id: string,
  label: ExcalidrawTextElement | null,
): SceneFile => {
  if (!label || result === source) {
    return result;
  }
  const boxAfter = result.elements.find((item) => item.id === id);
  const labelAfter = result.elements.find((item) => item.id === label.id);
  if (
    !boxAfter ||
    !labelAfter ||
    labelAfter.type !== "text" ||
    boxAfter.isDeleted ||
    labelAfter.isDeleted ||
    boxAfter.width <= 20 ||
    boxAfter.height <= 20 ||
    boxAfter.boundElements?.length !== 1 ||
    boxAfter.boundElements[0].id !== label.id ||
    boxAfter.boundElements[0].type !== "text" ||
    labelAfter.containerId !== id ||
    labelAfter.originalText !== label.originalText ||
    !labelAfter.autoResize ||
    labelAfter.locked ||
    labelAfter.frameId !== null ||
    labelAfter.groupIds.length !== 0 ||
    !Number.isFinite(labelAfter.fontSize) ||
    Math.abs(Math.sin(labelAfter.angle - boxAfter.angle)) > 1e-6 ||
    Math.abs(Math.cos(labelAfter.angle - boxAfter.angle) - 1) > 1e-6 ||
    ![boxAfter.x, boxAfter.y, boxAfter.width, boxAfter.height,
      labelAfter.x, labelAfter.y, labelAfter.width, labelAfter.height,
      labelAfter.angle, boxAfter.angle].every(Number.isFinite) ||
    labelAfter.width > getBoundTextMaxWidth(boxAfter, labelAfter) + 0.5 ||
    labelAfter.height > getBoundTextMaxHeight(
      boxAfter,
      labelAfter as ExcalidrawTextElementWithContainer,
    ) + 0.5
  ) {
    return source;
  }
  return result;
};

/**
 * Core single-element resize for independent native boxes and intact
 * reciprocal single-label pairs. The safety checks refuse unsupported
 * imported bindings; images, grouped text and arrow paths still require
 * separate parity handling.
 */
export function resizeNativeBoxWithCore(
  scene: SceneFile,
  id: string,
  handle: "nw" | "ne" | "sw" | "se",
  pointer: { x: number; y: number },
): SceneFile {
  const element = scene.elements.find((item) => item.id === id);
  const label = element ? safeResizeLabel(scene, element) : undefined;
  if (
    !element ||
    !canCoreTransformBox(scene, element, label) ||
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
  const minSize = label ? 21 : 8;
  const resized = withNativeCoreScene(scene, (core) => {
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
  return acceptCoreLabelResult(scene, resized, id, label);
}

/**
 * Let Excalidraw rotate a single native box and its reciprocal label in one
 * core Scene transaction; never split text from its container on rotation.
 */
export function rotateNativeBoxWithCore(
  scene: SceneFile,
  id: string,
  pointer: { x: number; y: number },
): SceneFile {
  const element = scene.elements.find((item) => item.id === id);
  const label = element ? safeResizeLabel(scene, element) : undefined;
  if (
    !element ||
    !canCoreTransformBox(scene, element, label) ||
    !Number.isFinite(pointer.x) ||
    !Number.isFinite(pointer.y)
  ) {
    return scene;
  }
  const rotated = withNativeCoreScene(scene, (core) => {
    const target = core.getNonDeletedElement(id);
    if (!target) {
      return;
    }
    const originals = new Map<string, NonDeleted<ExcalidrawElement>>();
    for (const item of core.getNonDeletedElements()) {
      originals.set(item.id, structuredClone(item));
    }
    transformElements(
      originals,
      "rotation",
      [target],
      core,
      false,
      false,
      false,
      pointer.x,
      pointer.y,
      element.x + element.width / 2,
      element.y + element.height / 2,
    );
  });
  return acceptCoreLabelResult(scene, rotated, id, label);
}

/**
 * Framework-neutral edit policy for a complete plain group. Require every
 * member and forbid even one orphaned external binding; core geometry must
 * never receive a partially selected or malformed imported group.
 */
const isPlainNativeBoxGroup = (
  scene: SceneFile,
  ids: readonly string[],
  allowRotated: boolean,
): boolean => {
  const selected = new Set(ids);
  if (selected.size < 2 || selected.size !== ids.length) {
    return false;
  }
  const roots = scene.elements.filter((element) => selected.has(element.id));
  const groupId = roots[0]?.groupIds.length === 1 ? roots[0].groupIds[0] : null;
  return !!groupId &&
    roots.length === selected.size &&
    roots.every((element) =>
      ["rectangle", "ellipse", "diamond"].includes(element.type) &&
      !element.isDeleted &&
      !element.locked &&
      element.frameId === null &&
      element.groupIds.length === 1 &&
      element.groupIds[0] === groupId &&
      !element.boundElements?.length &&
      (allowRotated || element.angle === 0) &&
      element.width > 0 &&
      element.height > 0 &&
      Number.isFinite(element.width) &&
      Number.isFinite(element.height) &&
      Number.isFinite(element.angle),
    ) &&
    !scene.elements.some((element) =>
      !element.isDeleted &&
      ((!selected.has(element.id) && element.groupIds.includes(groupId)) ||
        (element.type === "text" &&
          element.containerId !== null &&
          selected.has(element.containerId)) ||
        (element.type === "arrow" &&
          (!!element.startBinding && selected.has(element.startBinding.elementId) ||
            !!element.endBinding && selected.has(element.endBinding.elementId)))),
    );
};

/**
 * Use the original uniform multi-element resize for *plain* flat groups.
 * This is deliberately narrower than the native group's overall supported
 * shape set: labeled boxes, images and linear elements require their own
 * layout/point/ratio parity before their core branch can be enabled.
 */
export function resizeNativeGroupWithCore(
  scene: SceneFile,
  ids: readonly string[],
  handle: "nw" | "ne" | "sw" | "se",
  scale: number,
  bounds: { x: number; y: number; width: number; height: number },
): SceneFile {
  if (
    !isPlainNativeBoxGroup(scene, ids, false) ||
    !Number.isFinite(scale) ||
    scale <= 0 ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return scene;
  }
  if (Math.abs(scale - 1) < 1e-9) {
    return scene;
  }

  return withNativeCoreScene(scene, (core) => {
    const originals = new Map(
      core.getNonDeletedElements().map((element) => [
        element.id,
        structuredClone(element),
      ]),
    ) as ElementsMap;
    const selectedRoots = ids.map((id) => core.getNonDeletedElement(id));
    if (selectedRoots.some((element) => !element)) {
      return;
    }
    resizeMultipleElements(
      selectedRoots as NonDeletedExcalidrawElement[],
      core.getNonDeletedElementsMap(),
      handle,
      core,
      originals,
      {
        shouldMaintainAspectRatio: true,
        shouldResizeFromCenter: false,
        flipByX: false,
        flipByY: false,
        nextWidth: bounds.width * scale,
        nextHeight: bounds.height * scale,
        originalBoundingBox: {
          minX: bounds.x,
          minY: bounds.y,
          maxX: bounds.x + bounds.width,
          maxY: bounds.y + bounds.height,
          midX: bounds.x + bounds.width / 2,
          midY: bounds.y + bounds.height / 2,
          width: bounds.width,
          height: bounds.height,
        },
      },
    );
  });
}

/**
 * Original Excalidraw multi-selection rotation, restricted to a safe
 * complete group of plain boxes. Uses the same rotation normalization and
 * element-center calculation as the React editor.
 */
export function rotateNativeGroupWithCore(
  scene: SceneFile,
  ids: readonly string[],
  pointer: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
): SceneFile {
  if (
    !isPlainNativeBoxGroup(scene, ids, true) ||
    ![pointer.x, pointer.y, bounds.x, bounds.y, bounds.width, bounds.height]
      .every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return scene;
  }
  return withNativeCoreScene(scene, (core) => {
    const originalElements = new Map<string, NonDeleted<ExcalidrawElement>>();
    for (const element of core.getNonDeletedElements()) {
      originalElements.set(element.id, structuredClone(element));
    }
    const selected = ids.map((id) => core.getNonDeletedElement(id));
    if (selected.some((element) => !element)) {
      return;
    }
    transformElements(
      originalElements,
      "rotation",
      selected as NonDeletedExcalidrawElement[],
      core,
      false,
      false,
      true,
      pointer.x,
      pointer.y,
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
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
