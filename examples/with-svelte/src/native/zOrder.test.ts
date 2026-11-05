import { describe, expect, it } from "vitest";

import { validateFractionalIndices } from "@excalidraw/element";

import { blankScene, createShape } from "./scene";
import { indexInsertedNativeElements } from "./ordering";
import { moveNativeLayerWithCore } from "./zOrder";

const sceneWith3 = () => {
  const start = blankScene();
  const elements = [
    createShape("rectangle", { x: 0, y: 0 }, { x: 60, y: 40 }),
    createShape("ellipse", { x: 100, y: 0 }, { x: 160, y: 40 }),
    createShape("diamond", { x: 200, y: 0 }, { x: 260, y: 40 }),
  ];
  return indexInsertedNativeElements(start, { ...start, elements });
};

describe("native layer controls reuse Excalidraw zindex", () => {
  it("moves a safe element forward while retaining its geometry and metadata", () => {
    const source = sceneWith3();
    const id = source.elements[0].id;
    const moved = moveNativeLayerWithCore(source, id, "forward");
    expect(moved.elements.map((e) => e.id)).toEqual([
      source.elements[1].id,
      id,
      source.elements[2].id,
    ]);
    validateFractionalIndices(moved.elements, {
      includeBoundTextValidation: false,
      shouldThrow: true,
      ignoreLogs: true,
    });
    expect(moved.elements[2]).toBe(source.elements[2]);
    expect(moved.elements[1].x).toBe(source.elements[0].x);
    expect(moved.elements[1].version).toBeGreaterThan(source.elements[0].version);
  });

  it("preserves source and supports front/back/no-op gestures", () => {
    const source = sceneWith3();
    const back = moveNativeLayerWithCore(source, source.elements[2].id, "bottom");
    expect(back.elements[0].id).toBe(source.elements[2].id);
    expect(moveNativeLayerWithCore(back, source.elements[2].id, "back")).toBe(back);
    const front = moveNativeLayerWithCore(back, source.elements[2].id, "top");
    expect(front.elements[2].id).toBe(source.elements[2].id);
    expect(source.elements[0].type).toBe("rectangle");
  });

  it("refuses locked, grouped and unindexed imports", () => {
    const scene = sceneWith3();
    const id = scene.elements[1].id;
    const locked = {
      ...scene,
      elements: scene.elements.map((el) => el.id === id ? { ...el, locked: true } : el),
    };
    expect(moveNativeLayerWithCore(locked, id, "top")).toBe(locked);
    const invalid = {
      ...scene,
      elements: scene.elements.map((el) => ({ ...el, index: null })),
    };
    expect(moveNativeLayerWithCore(invalid, id, "bottom")).toBe(invalid);
  });
});
