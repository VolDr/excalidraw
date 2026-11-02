import { duplicateElement, getElementBounds } from "@excalidraw/element";

import type { ExcalidrawElement, ElementsMap } from "@excalidraw/element/types";

import { nativeEditableLabel } from "./boundText";
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
  const map = new Map([[element.id, element]]) as ElementsMap;
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
  const selection = rectangleBetween(start, end);
  const enclosed = end.x < start.x;
  const seen = new Set<string>();
  const result = new Set<string>();
  const intersects = (element: ExcalidrawElement): boolean => {
    const box = visualBounds(element);
    return enclosed
      ? box.x >= selection.x &&
          box.y >= selection.y &&
          box.x + box.width <= selection.x + selection.width &&
          box.y + box.height <= selection.y + selection.height
      : box.x <= selection.x + selection.width &&
          box.x + box.width >= selection.x &&
          box.y <= selection.y + selection.height &&
          box.y + box.height >= selection.y;
  };
  for (const element of scene.elements) {
    const unit = selectionUnit(scene, element.id);
    if (!unit.length || unit.some((id) => seen.has(id))) {
      continue;
    }
    unit.forEach((id) => seen.add(id));
    const members = scene.elements.filter((member) => unit.includes(member.id));
    if (enclosed ? members.every(intersects) : members.some(intersects)) {
      unit.forEach((id) => result.add(id));
    }
  }
  return scene.elements
    .filter((element) => result.has(element.id))
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

  // Native-only policy: append copies after the source elements and reset
  // their fractional indices until the editor's index manager is migrated.
  // The reciprocal text IDs must be rewritten after all IDs are allocated.
  const duplicates = nativeCopies.map((nativeCopy, index): ExcalidrawElement => {
    const element = originals[index];
    const copy = {
      ...nativeCopy,
      x: nativeCopy.x + offset,
      y: nativeCopy.y + offset,
      index: null,
      version: 1,
    };
    if (element.type === "text" && element.containerId) {
      return { ...copy, containerId: idsByOriginal.get(element.containerId)! };
    }
    if (element.boundElements?.length) {
      return {
        ...copy,
        boundElements: element.boundElements.map((ref) => ({
          ...ref,
          id: idsByOriginal.get(ref.id)!,
        })),
      };
    }
    return copy;
  });

  return {
    scene: { ...scene, elements: [...scene.elements, ...duplicates] },
    // Select copied boxes, not their separately bound text elements.
    ids: scene.elements
      .filter((element) => copiedParents.has(element.id))
      .map((element) => idsByOriginal.get(element.id)!),
  };
}
