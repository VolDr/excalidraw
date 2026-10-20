import { describe, expect, it } from "vitest";

import {
  canMove,
  deleteSelection,
  handleLocations,
  isBoxTransformable,
  moveSelection,
  pickHandle,
  resizeElement,
  rotateElement,
  transformSelected,
} from "./transforms";
import { blankScene, createShape } from "./scene";

describe("native transforms", () => {
  it("moves and deletes multiple elements in a single undoable scene transaction", () => {
    const a = createShape("rectangle", { x: 10, y: 20 }, { x: 70, y: 70 });
    const b = createShape("ellipse", { x: 80, y: 90 }, { x: 130, y: 150 });
    const locked = { ...createShape("diamond", { x: 0, y: 0 }, { x: 20, y: 20 }), locked: true };
    const scene = { ...blankScene(), elements: [a, b, locked] };
    const moved = moveSelection(scene, [a.id, b.id, locked.id], 12, -8);
    expect(moved.elements.map((el) => [el.x, el.y])).toEqual([
      [22, 12], [92, 82], [0, 0],
    ]);
    expect(scene.elements[0].x).toBe(10);
    const deleted = deleteSelection(moved, [a.id, b.id, locked.id]);
    expect(deleted.elements.map((el) => el.isDeleted)).toEqual([true, true, false]);
  });

  it("resizes corners and maintains identity and fixed opposite corner", () => {
    const el = createShape("rectangle", { x: 10, y: 20 }, { x: 110, y: 70 });
    const before = handleLocations(el);
    expect(pickHandle(el, before.se)).toBe("se");
    const resized = resizeElement(el, "se", { x: 150, y: 100 });
    expect([resized.x, resized.y, resized.width, resized.height]).toEqual([10, 20, 140, 80]);
    expect(resized.id).toBe(el.id);
    expect(resized.version).toBe(el.version + 1);
    expect(handleLocations(resized).nw).toEqual(before.nw);
    const clamped = resizeElement(el, "nw", { x: 400, y: 400 });
    expect(clamped.width).toBe(8);
    expect(clamped.height).toBe(8);
    expect(handleLocations(clamped).se).toEqual(before.se);
  });

  it("keeps the world-space anchor fixed for a rotated resize", () => {
    const el = rotateElement(
      createShape("rectangle", { x: 50, y: 60 }, { x: 150, y: 110 }),
      { x: 100, y: 60 },
    );
    expect(el.angle).toBeCloseTo(0);
    const rotated = rotateElement(el, { x: 150, y: 85 });
    expect(rotated.angle).toBeCloseTo(Math.PI / 2);
    const fixed = handleLocations(rotated).nw;
    const moving = handleLocations(rotated).se;
    const changed = resizeElement(rotated, "se", { x: moving.x - 20, y: moving.y + 40 });
    expect(handleLocations(changed).nw.x).toBeCloseTo(fixed.x);
    expect(handleLocations(changed).nw.y).toBeCloseTo(fixed.y);
    expect(changed.width).toBeCloseTo(140);
    expect(changed.height).toBeCloseTo(70);
    const scene = { ...blankScene(), elements: [rotated] };
    expect(transformSelected(scene, rotated.id, "rotate", { x: 150, y: 85 }).elements[0].angle)
      .toBeCloseTo(Math.PI / 2);
  });

  it("refuses transforms that would corrupt bound, framed, grouped or locked elements", () => {
    const a = createShape("rectangle", { x: 0, y: 0 }, { x: 60, y: 50 });
    const bound = { ...a, boundElements: [{ id: "label", type: "text" as const }] };
    const framed = { ...a, frameId: "frame-1" };
    const grouped = { ...a, groupIds: ["g1"] };
    const locked = { ...a, locked: true };
    for (const element of [bound, framed, grouped, locked]) {
      expect(canMove(element)).toBe(false);
      expect(isBoxTransformable(element)).toBe(false);
      expect(resizeElement(element, "se", { x: 100, y: 100 })).toBe(element);
      expect(rotateElement(element, { x: 100, y: 100 })).toBe(element);
    }
  });
});
