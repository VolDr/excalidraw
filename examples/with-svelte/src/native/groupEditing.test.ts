import { describe, expect, it } from "vitest";
import { blankScene, createShape } from "./scene";
import { groupSelection } from "./groups";
import { moveSelection } from "./transforms";
import {
  nativeEnterEditingGroup,
  nativeEditingSelectionUnit,
  editableNativeGroupSelection,
  nativeExitEditingGroup,
} from "./groupEditing";

const nested = () => {
  const a = createShape("rectangle", { x: 10, y: 10 }, { x: 110, y: 90 });
  const b = createShape("ellipse", { x: 160, y: 10 }, { x: 240, y: 90 });
  const c = createShape("diamond", { x: 300, y: 10 }, { x: 390, y: 90 });
  const base = { ...blankScene(), elements: [a, b, c] };
  const inner = groupSelection(base, [a.id, b.id]);
  const outer = groupSelection(inner.scene, [a.id, b.id, c.id]);
  return { scene: outer.scene, inner: inner.groupId!, outer: outer.groupId!, a, b, c };
};

describe("native nested group editing scope", () => {
  it("enters outer then inner group, then exits one level at a time", () => {
    const { scene, inner, outer, a, b, c } = nested();
    expect(nativeEnterEditingGroup(scene, a.id, null)).toBe(outer);
    expect(nativeEditingSelectionUnit(scene, a.id, outer)).toEqual([a.id, b.id]);
    expect(nativeEditingSelectionUnit(scene, c.id, outer)).toEqual([c.id]);
    expect(nativeEnterEditingGroup(scene, a.id, outer)).toBe(inner);
    expect(nativeEditingSelectionUnit(scene, a.id, inner)).toEqual([a.id]);
    expect(nativeEnterEditingGroup(scene, a.id, inner)).toBeNull();
    const exitingInner = nativeExitEditingGroup(scene, inner);
    expect(exitingInner).toEqual({ editingGroupId: outer, selectedIds: [a.id, b.id] });
    const exitingOuter = nativeExitEditingGroup(scene, outer);
    expect(exitingOuter).toEqual({
      editingGroupId: null, selectedIds: [a.id, b.id, c.id],
    });
  });

  it("rejects moving a partial nested child group and allows moving one leaf", () => {
    const { scene, inner, a, b, c } = nested();
    expect(editableNativeGroupSelection(scene, [a.id, b.id], inner))
      .toEqual([a.id, b.id]);
    expect(editableNativeGroupSelection(scene, [a.id], inner)).toEqual([a.id]);
    const moved = moveSelection(scene, [a.id], 30, 10, inner);
    expect(moved).not.toBe(scene);
    expect(moved.elements.find((e) => e.id === a.id)?.x).toBe(a.x + 30);
    expect(moved.elements.find((e) => e.id === b.id)?.x).toBe(b.x);
    expect(moveSelection(scene, [c.id], 20, 10, inner)).toBe(scene);
  });
});
