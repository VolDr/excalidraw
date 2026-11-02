import {
  duplicateElement,
  fixDuplicatedBindingsAfterDuplication,
  elementsOverlappingBBox,
  getElementBounds,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import { nativeEditableLabel } from "./boundText";
import { nativeElementsMap } from "./coreAdapter";
import {
  canEditIndependently,
  editableSelection,
  selectionUnit,
} from "./groups";

import type { Point, SceneFile } from "./scene";

export type Bounds = { x: number; y: number; width: number; height: number };

export function rectangleBetween(a: Point, b: Point): Bounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Use Excalidraw's element-specific bounds for rotated/linear shapes. */
export function visualBounds(element: ExcalidrawElement): Bounds {
  const map = nativeElementsMap({ elements: [element] });
  const [x1, y1, x2, y2] = getElementBounds(element, map);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Right-to-left selection must fully enclose the visual bounding box.
 * Left-to-right selection picks any overlapping native editable element.
 * Unsupported/bound/grouped elements never become draggable.
 */
export function elementsInMarquee(
  scene: SceneFile,
  start: Point,
  end: Point,
): string[] {
  const box = rectangleBetween(start, end);
  const fullyEnclosed = end.x < start.x;
  const elementsMap = nativeElementsMap(scene);
  // Excalidraw's own marquee geometry handles rotated shapes, diamonds,
  // ellipses, paths and group semantics. Only validated, selectable native
  // roots are passed into it: linked labels remain internal to their boxes.
  const candidates = scene.elements.filter(
    (element) =>
      !(element.type === "text" && element.containerId !== null) &&
      selectionUnit(scene, element.id).length > 0,
  );
  const hits = elementsOverlappingBBox({
    elements: candidates,
    elementsMap,
    bounds: [box.x, box.y, box.x + box.width, box.y + box.height],
    type: fullyEnclosed ? "contain" : "overlap",
    excludeElementsInFrames: false,
    includeStroke: false,
  });
  const ids = new Set<string>();
  for (const element of hits) {
    selectionUnit(scene, element.id).forEach((id) => ids.add(id));
  }
  return scene.elements
    .filter((element) => ids.has(element.id))
    .map((element) => element.id);
}

/**
 * Duplicate independent elements and safe, reciprocal box/label pairs.
 * Remap both sides before appending: no copy may refer to its original.
 * Imported arrow bindings and complex grouped/frame content are untouched.
 */
export function duplicateSelection(
  scene: SceneFile,
  ids: readonly string[],
  offset = 24,
): { scene: SceneFile; ids: string[] } {
  const requested = new Set(editableSelection(scene, ids));
  const selected = new Set<string>();
  const copiedParents = new Set<string>();

  for (const element of scene.elements) {
    if (!requested.has(element.id)) {
      continue;
    }
    if (
      canEditIndependently(element) ||
      (element.groupIds.length === 1 && !element.boundElements?.length)
    ) {
      selected.add(element.id);
      copiedParents.add(element.id);
      continue;
    }
    const label = nativeEditableLabel(scene, element);
    if (label) {
      selected.add(element.id);
      selected.add(label.id);
      copiedParents.add(element.id);
    }
  }

  // A root allowed for selection might still have an arrow binding which
  // cannot be cloned by this limited native duplication path. In that case
  // reject the entire operation instead of silently copying other roots.
  if (!selected.size || copiedParents.size !== requested.size) {
    return { scene, ids: [] };
  }

  // Delegate identity creation, deep copy, seed generation and group ID
  // remapping to Excalidraw's own duplication algorithm.
  const originals = scene.elements.filter((element) => selected.has(element.id));
  const idsByOriginal = new Map<string, string>();
  const groupIdMap = new Map<string, string>();
  const nativeCopies = originals.map((element) => {
    const copy = duplicateElement(null, groupIdMap, element, true);
    idsByOriginal.set(element.id, copy.id);
    return copy;
  });

  // Excalidraw owns reciprocal-link remapping as well as ID creation.
  // Run it on independent deep copies, never on the imported source scene.
  const duplicates: ExcalidrawElement[] = nativeCopies.map((copy) => ({
    ...copy,
    x: copy.x + offset,
    y: copy.y + offset,
    index: null,
    version: 1,
  }));
  const duplicateMap = nativeElementsMap({ elements: duplicates }) as NonDeletedSceneElementsMap;
  fixDuplicatedBindingsAfterDuplication(
    duplicates,
    idsByOriginal,
    duplicateMap,
  );

  return {
    scene: { ...scene, elements: [...scene.elements, ...duplicates] },
    // Select copied boxes, not their separately bound text elements.
    ids: scene.elements
      .filter((element) => copiedParents.has(element.id))
      .map((element) => idsByOriginal.get(element.id)!),
  };
}
