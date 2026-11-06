import { describe, expect, it } from "vitest";
import { blankScene, createShape } from "./scene";
import { createNativeFrameWithCore } from "./frames";
import { isSafeNativeFrameChild, moveNativeFrameWithCore, moveNativeFrameChildWithCore } from "./frameMove";
import { selectionUnit, editableSelection } from "./groups";

describe("original frame movement includes its children", () => {
  it("translates both frame and child using the original drag engine", () => {
    const box = createShape("rectangle", { x: 50, y: 50 }, { x: 115, y: 120 });
    const created = createNativeFrameWithCore(
      { ...blankScene(), elements: [box] },
      { x: 20, y: 20 }, { x: 200, y: 180 },
    );
    if (!created) throw Error("Expected a canonical core frame");
    const result = moveNativeFrameWithCore(
      created.scene, created.frame.id, 31, 19,
    );
    expect(result).not.toBe(created.scene);
    expect(result.elements.find((e) => e.id === box.id)?.x).toBe(box.x + 31);
    expect(result.elements.find((e) => e.id === box.id)?.y).toBe(box.y + 19);
    expect(result.elements.find((e) => e.id === created.frame.id)?.x)
      .toBe(created.frame.x + 31);
  });

  it("selects and moves an ordinary child while retaining its frame ID", () => {
    const box = createShape("rectangle", { x: 50, y: 50 }, { x: 110, y: 120 });
    const created = createNativeFrameWithCore(
      { ...blankScene(), elements: [box] },
      { x: 20, y: 20 }, { x: 200, y: 170 },
    );
    if (!created) throw Error("Expected core frame");
    const root = created.scene.elements.find((el) => el.id === box.id)!;
    expect(isSafeNativeFrameChild(created.scene, root)).toBe(true);
    expect(selectionUnit(created.scene, box.id)).toEqual([box.id]);
    expect(editableSelection(created.scene, [box.id])).toEqual([box.id]);
    const moved = moveNativeFrameChildWithCore(
      created.scene, box.id, 35, -12,
    );
    expect(moved).not.toBe(created.scene);
    expect(moved.elements.find((el) => el.id === box.id)?.x).toBe(box.x + 35);
    expect(moved.elements.find((el) => el.id === box.id)?.frameId)
      .toBe(created.frame.id);
    expect(moved.elements.find((el) => el.id === created.frame.id))
      .toBe(created.scene.elements.find((el) => el.id === created.frame.id));
  });

  it("rejects a missing frame or a malformed half-framed group", () => {
    const scene = blankScene();
    expect(moveNativeFrameWithCore(scene, "missing", 2, 1)).toBe(scene);
  });
});
