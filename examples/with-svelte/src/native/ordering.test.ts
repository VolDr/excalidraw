import { describe, expect, it } from "vitest";

import { validateFractionalIndices } from "@excalidraw/element";
import { blankScene, createShape } from "./scene";
import { indexInsertedNativeElements } from "./ordering";

describe("Svelte core fractional-index adapter", () => {
  it("assigns core keys to appended elements, without mutating source", () => {
    const start = blankScene();
    const a = createShape("rectangle", { x: 0, y: 0 }, { x: 50, y: 50 });
    const b = createShape("ellipse", { x: 100, y: 0 }, { x: 160, y: 60 });
    const next = indexInsertedNativeElements(start, { ...start, elements: [a, b] });
    validateFractionalIndices(next.elements, {
      shouldThrow: true,
      includeBoundTextValidation: false,
      ignoreLogs: true,
    });
    expect(a.index).toBeNull();
    expect(b.index).toBeNull();
    expect(next.elements.every((element) => element.index !== null)).toBe(true);
  });

  it("preserves already valid originals when appending another shape", () => {
    const source = blankScene();
    const box = createShape("rectangle", { x: 0, y: 0 }, { x: 30, y: 30 });
    const first = indexInsertedNativeElements(source, { ...source, elements: [box] });
    const arrow = createShape("arrow", { x: 40, y: 40 }, { x: 90, y: 90 });
    const second = indexInsertedNativeElements(first, { ...first, elements: [...first.elements, arrow] });
    expect(second.elements[0]).toBe(first.elements[0]);
    expect(second.elements[1].index).not.toBeNull();
  });

  it("does not rewrite indices during ordinary edits", () => {
    const source = blankScene();
    const box = createShape("diamond", { x: 0, y: 0 }, { x: 30, y: 30 });
    const current = { ...source, elements: [box] };
    const next = { ...current, elements: [{ ...box, x: 5 }] };
    expect(indexInsertedNativeElements(current, next)).toBe(next);
  });
});
