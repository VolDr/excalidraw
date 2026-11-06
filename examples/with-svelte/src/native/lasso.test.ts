import { describe, expect, it } from "vitest";

import { blankScene, createShape } from "./scene";
import { elementsInNativeLasso } from "./lasso";
import { groupSelection } from "./groups";

const around = (x: number, y: number, width: number, height: number) =>
  [
    { x: x - 15, y: y - 15 },
    { x: x + width + 15, y: y - 15 },
    { x: x + width + 15, y: y + height + 15 },
    { x: x - 15, y: y + height + 15 },
  ];

describe("Svelte lasso delegates original polygon hit-testing", () => {
  it("encloses only a fully surrounded native rectangle", () => {
    const one = createShape("rectangle", { x: 30, y: 30 }, { x: 120, y: 130 });
    const two = createShape("ellipse", { x: 260, y: 40 }, { x: 380, y: 150 });
    const scene = { ...blankScene(), elements: [one, two] };
    expect(elementsInNativeLasso(scene, around(30, 30, 90, 100)))
      .toEqual([one.id]);
    expect(elementsInNativeLasso(scene, [{ x: 0, y: 0 }])).toEqual([]);
  });

  it("selects a safe complete flat group, not a partial child", () => {
    const one = createShape("rectangle", { x: 30, y: 30 }, { x: 100, y: 120 });
    const two = createShape("diamond", { x: 160, y: 20 }, { x: 260, y: 130 });
    const grouped = groupSelection(
      { ...blankScene(), elements: [one, two] }, [one.id, two.id],
    );
    const large = around(30, 20, 230, 110);
    expect(elementsInNativeLasso(grouped.scene, large))
      .toEqual([one.id, two.id]);
    expect(elementsInNativeLasso(grouped.scene, around(30, 30, 70, 90)))
      .toEqual([]);
  });

  it("rejects malicious import geometry and non-finite points", () => {
    const scene = blankScene();
    expect(elementsInNativeLasso(scene, [
      { x: Number.NaN, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 0 },
    ])).toEqual([]);
  });
});
