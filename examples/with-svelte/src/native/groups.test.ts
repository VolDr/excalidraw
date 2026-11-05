import { describe, expect, it } from "vitest";

import { blankScene, createShape } from "./scene";
import { updateNativeBoxLabel, nativeLabelBox } from "./boundText";
const sceneJson = (scene: unknown) => JSON.stringify(scene);
import { deleteSelection, moveSelection } from "./transforms";
import {
  editableSelection,
  groupSelection,
  safeGroupMembers,
  selectionUnit,
  ungroupSelection,
} from "./groups";

describe("Svelte groups with original Excalidraw nesting", () => {
  it("moves grouped members together and refuses partial group deletion", () => {
    const a = createShape("rectangle", { x: 4, y: 6 }, { x: 40, y: 50 });
    const b = createShape("ellipse", { x: 80, y: 90 }, { x: 130, y: 150 });
    const base = { ...blankScene(), elements: [a, b] };
    const grouped = groupSelection(base, [a.id, b.id]);
    const moved = moveSelection(grouped.scene, [a.id, b.id], 12, 10);
    expect(moved.elements[0].x).toBe(16);
    expect(moved.elements[1].x).toBe(92);
    expect(moveSelection(grouped.scene, [a.id], 12, 10)).toBe(grouped.scene);
    expect(deleteSelection(grouped.scene, [a.id])).toBe(grouped.scene);
    const deleted = deleteSelection(grouped.scene, [a.id, b.id]);
    expect(deleted.elements.map((e) => e.isDeleted)).toEqual([true, true]);
  });

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
    expect(editableSelection(grouped.scene, [a.id, b.id])).toEqual([
      a.id,
      b.id,
    ]);
    const ungrouped = ungroupSelection(grouped.scene, [a.id, b.id]);
    expect(
      ungrouped.scene.elements.every((element) => !element.groupIds.length),
    ).toBe(true);
    expect(scene.elements[0].groupIds).toEqual([]);
  });

  it("nests whole groups without losing parent hierarchy and safely unwraps only the outer group", () => {
    const a = createShape("rectangle", { x: 5, y: 10 }, { x: 85, y: 80 });
    const b = createShape("ellipse", { x: 110, y: 10 }, { x: 185, y: 75 });
    const c = createShape("diamond", { x: 210, y: 10 }, { x: 270, y: 85 });
    const source = { ...blankScene(), elements: [a, b, c] };
    const inner = groupSelection(source, [a.id, b.id]);
    const nested = groupSelection(inner.scene, [a.id, b.id, c.id]);
    expect(nested.groupId).toBeTruthy();
    expect(nested.scene.elements.map((el) => el.groupIds)).toEqual([
      [inner.groupId, nested.groupId],
      [inner.groupId, nested.groupId],
      [nested.groupId],
    ]);
    expect(selectionUnit(nested.scene, a.id)).toEqual([a.id, b.id, c.id]);
    expect(selectionUnit(nested.scene, c.id)).toEqual([a.id, b.id, c.id]);
    expect(editableSelection(nested.scene, [a.id, b.id])).toEqual([]);
    expect(editableSelection(nested.scene, [a.id, b.id, c.id])).toEqual([a.id, b.id, c.id]);
    const moved = moveSelection(nested.scene, [a.id, b.id, c.id], 15, 25);
    expect(moved.elements.map((e) => e.x)).toEqual([20, 125, 225]);
    expect(deleteSelection(nested.scene, [a.id, b.id])).toBe(nested.scene);
    const unwrapped = ungroupSelection(nested.scene, [a.id, b.id, c.id]);
    expect(unwrapped.scene.elements.map((e) => e.groupIds)).toEqual([
      [inner.groupId], [inner.groupId], [],
    ]);
    expect(selectionUnit(unwrapped.scene, a.id)).toEqual([a.id, b.id]);
    expect(sceneJson(source)).not.toEqual(sceneJson(nested.scene));
  });

  it("keeps a reciprocal label inside the same nested group as its box", () => {
    const a = createShape("rectangle", { x: 10, y: 10 }, { x: 180, y: 110 });
    const b = createShape("ellipse", { x: 220, y: 10 }, { x: 330, y: 110 });
    const c = createShape("diamond", { x: 360, y: 20 }, { x: 450, y: 130 });
    const source = { ...blankScene(), elements: [a, b, c] };
    const labeled = updateNativeBoxLabel(source, a.id, "Header");
    const inner = groupSelection(labeled, [a.id, b.id]);
    expect(inner.groupId).not.toBeNull();
    const nested = groupSelection(inner.scene, [a.id, b.id, c.id]);
    const box = nested.scene.elements.find((e) => e.id === a.id)!;
    const text = nested.scene.elements.find((e) => e.type === "text")!;
    expect(box.groupIds).toEqual([inner.groupId, nested.groupId]);
    expect(text.groupIds).toEqual(box.groupIds);
    expect(nativeLabelBox(nested.scene, text)?.id).toBe(box.id);
    expect(selectionUnit(nested.scene, text.id)).toEqual([a.id, b.id, c.id]);
    const moved = moveSelection(nested.scene, [a.id, b.id, c.id], 20, 10);
    const nextLabel = moved.elements.find((e) => e.id === text.id)!;
    expect(nextLabel.type).toBe("text");
    expect(nextLabel.groupIds).toEqual(text.groupIds);
    expect(nextLabel.x).toBeCloseTo(text.x + 20);
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
