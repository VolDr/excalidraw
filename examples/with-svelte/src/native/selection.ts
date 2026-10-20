import type { ExcalidrawElement } from "@excalidraw/element/types";

import { editableSelection, selectionUnit } from "./groups";

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
 * Duplicate a safe, independent selection without remapping unsupported
 * Excalidraw bindings. The new elements are appended above originals.
 */
export function duplicateSelection(
  scene: SceneFile,
  ids: readonly string[],
  offset = 24,
): { scene: SceneFile; ids: string[] } {
  const selected = new Set(editableSelection(scene, ids));
  const now = Date.now();
  const newGroupIds = new Map<string, string>();
  const duplicates = scene.elements
    .filter((element) => selected.has(element.id))
    .map((element) => {
      const groupIds = element.groupIds.map((id) => {
        if (!newGroupIds.has(id)) {
          newGroupIds.set(id, crypto.randomUUID());
        }
        return newGroupIds.get(id)!;
      });
      return {
        ...structuredClone(element),
        id: crypto.randomUUID(),
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
    }) as ExcalidrawElement[];
  if (!duplicates.length) {
    return { scene, ids: [] };
  }
  return {
    scene: { ...scene, elements: [...scene.elements, ...duplicates] },
    ids: duplicates.map((element) => element.id),
  };
}
