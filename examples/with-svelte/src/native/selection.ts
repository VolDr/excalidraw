import type { ExcalidrawElement } from "@excalidraw/element/types";

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

/** Axis-aligned extents of a possibly rotated element. */
export function visualBounds(element: ExcalidrawElement): Bounds {
  const center = {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  };
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  const offsets = [
    [-element.width / 2, -element.height / 2],
    [element.width / 2, -element.height / 2],
    [element.width / 2, element.height / 2],
    [-element.width / 2, element.height / 2],
  ];
  const corners = offsets.map(([dx, dy]) => ({
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  }));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
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
      (element.groupIds.length === 1 &&
        !element.boundElements?.length)
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

  if (!selected.size) {
    return { scene, ids: [] };
  }

  const now = Date.now();
  const idsByOriginal = new Map<string, string>();
  const newGroupIds = new Map<string, string>();
  for (const element of scene.elements) {
    if (selected.has(element.id)) {
      idsByOriginal.set(element.id, crypto.randomUUID());
    }
  }

  const duplicates = scene.elements
    .filter((element) => selected.has(element.id))
    .map((element): ExcalidrawElement => {
      const groupIds = element.groupIds.map((id) => {
        if (!newGroupIds.has(id)) {
          newGroupIds.set(id, crypto.randomUUID());
        }
        return newGroupIds.get(id)!;
      });
      const id = idsByOriginal.get(element.id)!;
      const copy = {
        ...structuredClone(element),
        id,
        groupIds,
        x: element.x + offset,
        y: element.y + offset,
        index: null,
        version: 1,
        versionNonce: Math.floor(Math.random() * 2 ** 31),
        seed: Math.floor(Math.random() * 2 ** 31),
        created: now,
        updated: now,
      };

      if (element.type === "text" && element.containerId) {
        return {
          ...copy,
          containerId: idsByOriginal.get(element.containerId)!,
        };
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
    // The user selects the copied box, not its separately bound label.
    ids: duplicates
      .filter((element) =>
        [...copiedParents].some((originalId) =>
          idsByOriginal.get(originalId) === element.id,
        ),
      )
      .map((element) => element.id),
  };
}
