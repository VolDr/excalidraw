import { describe, expect, it } from "vitest";
import { blankScene, createShape } from "./scene";
import { indexInsertedNativeElements } from "./ordering";
import { canLayoutNativeSelection, layoutNativeSelectionWithCore } from "./layout";

const sample = () => {
  const start = blankScene();
  const elements = [
    createShape("rectangle", { x: 20, y: 40 }, { x: 90, y: 100 }),
    createShape("ellipse", { x: 230, y: 90 }, { x: 300, y: 170 }),
    createShape("diamond", { x: 390, y: 150 }, { x: 460, y: 240 }),
  ];
  return indexInsertedNativeElements(start, { ...start, elements });
};

describe("native align/distribute delegates to Excalidraw", () => {
  it("aligns independent boxes using the original scene mutations", () => {
    const source = sample();
    const ids = source.elements.map((e) => e.id);
    const result = layoutNativeSelectionWithCore(source, ids, {
      kind: "align", alignment: { axis: "x", position: "start" },
    });
    expect(result).not.toBe(source);
    expect(result.elements.map((e) => e.x)).toEqual([20, 20, 20]);
    expect(result.elements[1].version).toBeGreaterThan(source.elements[1].version);
    expect(source.elements[1].x).toBe(230);
  });

  it("distributes independent objects without changing IDs or source", () => {
    const source = sample();
    const ids = source.elements.map((e) => e.id);
    const result = layoutNativeSelectionWithCore(source, ids, {
      kind: "distribute", distribution: { axis: "x", space: "between" },
    });
    expect(result.elements.map((e) => e.id)).toEqual(ids);
    expect(result.elements[0].x).toBe(source.elements[0].x);
    expect(result.elements[2].x).toBe(source.elements[2].x);
    expect(result.elements[1].x).not.toBe(source.elements[1].x);
  });

  it("does not edit groups, single elements or partially valid sets", () => {
    const source = sample();
    expect(canLayoutNativeSelection(source, [source.elements[0].id])).toBe(false);
    expect(layoutNativeSelectionWithCore(source, [source.elements[0].id], {
      kind: "align", alignment: { axis: "y", position: "center" },
    })).toBe(source);
    const locked = {
      ...source,
      elements: [{ ...source.elements[0], locked: true }, ...source.elements.slice(1)],
    };
    expect(canLayoutNativeSelection(locked, locked.elements.map((e) => e.id))).toBe(false);
  });
});
