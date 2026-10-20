import { describe, expect, it } from "vitest";

import { blankScene, createShape } from "./scene";
import {
  editableSelection,
  groupSelection,
  safeGroupMembers,
  selectionUnit,
  ungroupSelection,
} from "./groups";

describe("flat Svelte groups", () => {
  it("groups two independent shapes, selects whole group, moves and ungroups safely", () => {
    const a = createShape("rectangle", { x: 0, y: 0 }, { x: 30, y: 40 });
    const b = createShape("ellipse", { x: 50, y: 60 }, { x: 90, y: 90 });
    const scene = { ...blankScene(), elements: [a, b] };
    const grouped = groupSelection(scene, [a.id, b.id]);
    expect(grouped.groupId).toBeTruthy();
    expect(grouped.scene.elements[0].groupIds).toEqual([grouped.groupId]);
    expect(grouped.scene.elements[1].groupIds).toEqual([grouped.groupId]);
    expect(selectionUnit(grouped.scene, b.id)).toEqual([a.id, b.id]);
    expect(editableSelection(grouped.scene, [a.id])).toEqual([]);
    expect(editableSelection(grouped.scene, [a.id, b.id])).toEqual([a.id, b.id]);
    const ungrouped = ungroupSelection(grouped.scene, [a.id, b.id]);
    expect(ungrouped.scene.elements.every((element) => !element.groupIds.length)).toBe(true);
    expect(scene.elements[0].groupIds).toEqual([]);
  });

  it("does not change partially selected, nested, bound or locked groups", () => {
    const a = createShape("rectangle", { x: 0, y: 0 }, { x: 30, y: 40 });
    const b = createShape("rectangle", { x: 50, y: 60 }, { x: 70, y: 90 });
    const c = { ...a, id: crypto.randomUUID(), groupIds: ["nested", "outer"] };
    const scene = { ...blankScene(), elements: [a, b, c] };
    expect(groupSelection(scene, [a.id, c.id]).scene).toBe(scene);
    const grouped = groupSelection(scene, [a.id, b.id]);
    expect(ungroupSelection(grouped.scene, [a.id]).scene).toBe(grouped.scene);
    const damaged = {
      ...grouped.scene,
      elements: grouped.scene.elements.map((el) =>
        el.id === b.id ? { ...el, locked: true } : el,
      ),
    };
    expect(safeGroupMembers(damaged, grouped.groupId!)).toEqual([]);
    expect(selectionUnit(damaged, a.id)).toEqual([]);
    expect(editableSelection(damaged, [a.id, b.id])).toEqual([]);
  });
});
