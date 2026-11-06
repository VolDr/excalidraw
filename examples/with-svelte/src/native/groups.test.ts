import { describe, expect, it } from "vitest";

import { blankScene, createShape } from "./scene";
import { updateNativeBoxLabel, nativeLabelBox, nativeReciprocalCaption } from "./boundText";
import { appendNativeArrow } from "./bindings";
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

  it("groups closed arrow links without rewriting their reciprocal binding graph", () => {
    const a = createShape("rectangle", { x: 10, y: 10 }, { x: 110, y: 110 });
    const b = createShape("ellipse", { x: 260, y: 10 }, { x: 360, y: 110 });
    const base = { ...blankScene(), elements: [a, b] };
    const arrow = createShape("arrow", { x: 90, y: 50 }, { x: 290, y: 50 });
    const linked = appendNativeArrow(base, arrow, { x: 90, y: 50 }, { x: 290, y: 50 });
    const linkedArrow = linked.elements.find((el) => el.type === "arrow");
    expect(linkedArrow?.type).toBe("arrow");
    if (linkedArrow?.type !== "arrow") return;
    expect(linkedArrow.startBinding?.elementId).toBe(a.id);
    expect(linkedArrow.endBinding?.elementId).toBe(b.id);
    const ids = [a.id, b.id, linkedArrow.id];
    const grouped = groupSelection(linked, ids);
    expect(grouped.groupId).toBeTruthy();
    expect(editableSelection(grouped.scene, ids)).toEqual(ids);
    expect(selectionUnit(grouped.scene, linkedArrow.id)).toEqual(ids);
    const moved = moveSelection(grouped.scene, ids, 30, 12);
    expect(moved).not.toBe(grouped.scene);
    const movedArrow = moved.elements.find((el) => el.id === linkedArrow.id);
    expect(movedArrow?.type).toBe("arrow");
    if (movedArrow?.type === "arrow") {
      expect(movedArrow.startBinding?.elementId).toBe(a.id);
      expect(movedArrow.endBinding?.elementId).toBe(b.id);
    }
    expect(moved.elements[0].x).toBe(a.x + 30);
    expect(groupSelection(linked, [a.id, linkedArrow.id]).scene).toBe(linked);
  });

  it("keeps a box caption and bound arrow together in a closed group", () => {
    const a = createShape("rectangle", { x: 10, y: 10 }, { x: 180, y: 120 });
    const b = createShape("ellipse", { x: 300, y: 10 }, { x: 410, y: 120 });
    const original = updateNativeBoxLabel({ ...blankScene(), elements: [a, b] }, a.id, "Caption");
    const arrow = createShape("arrow", { x: 145, y: 55 }, { x: 320, y: 55 });
    // Arrow binding reuses the native/core binding adapter; the box already
    // has a label, so create a reciprocal imported graph for this fixture.
    const caption = original.elements.find((element) => element.type === "text")!;
    const source = appendNativeArrow(original, arrow, { x: 145, y: 55 }, { x: 320, y: 55 });
    const actualArrow = source.elements.find((element) => element.type === "arrow");
    if (actualArrow?.type !== "arrow") return;
    expect(actualArrow.startBinding?.elementId).toBe(a.id);
    expect(actualArrow.endBinding?.elementId).toBe(b.id);
    expect(source.elements[0].boundElements?.some((ref) =>
      ref.type === "text" && ref.id === caption.id
    )).toBe(true);
    expect(source.elements[0].boundElements?.some((ref) =>
      ref.type === "arrow" && ref.id === actualArrow.id
    )).toBe(true);
    expect(nativeReciprocalCaption(source, caption)?.id).toBe(a.id);
    const ids = [a.id, b.id, actualArrow.id];
    // The internal text never becomes a separately selectable root.
    const result = groupSelection(source, ids);
    expect(result.groupId).not.toBeNull();
    const label = result.scene.elements.find((element) => element.id === caption.id)!;
    expect(label.groupIds).toEqual([result.groupId]);
    expect(selectionUnit(result.scene, label.id)).toEqual(ids);
    const moved = moveSelection(result.scene, ids, 10, 15);
    expect(moved).not.toBe(result.scene);
    const deleted = deleteSelection(result.scene, ids);
    expect(deleted.elements.every((element) => element.isDeleted)).toBe(true);
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
