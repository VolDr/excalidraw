import { describe, expect, it } from "vitest";

import { blankScene, createShape, createText } from "./scene";
import {
  duplicateSelection,
  elementsInMarquee,
  rectangleBetween,
  visualBounds,
} from "./selection";

describe("native marquee and duplication", () => {
  it("supports rectangle direction and partly intersected elements", () => {
    const inside = createShape("rectangle", { x: 10, y: 10 }, { x: 30, y: 30 });
    const crossing = createShape("ellipse", { x: 40, y: 40 }, { x: 70, y: 70 });
    const outside = createShape(
      "diamond",
      { x: 95, y: 95 },
      { x: 120, y: 120 },
    );
    const scene = { ...blankScene(), elements: [inside, crossing, outside] };
    expect(rectangleBetween({ x: 55, y: 55 }, { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 55,
      height: 55,
    });
    expect(elementsInMarquee(scene, { x: 0, y: 0 }, { x: 55, y: 55 })).toEqual([
      inside.id,
      crossing.id,
    ]);
    expect(elementsInMarquee(scene, { x: 55, y: 55 }, { x: 0, y: 0 })).toEqual([
      inside.id,
    ]);
  });

  it("uses rotated world bounds and refuses to select bound elements", () => {
    const rect = createShape("rectangle", { x: 0, y: 0 }, { x: 100, y: 20 });
    const rotated = { ...rect, angle: (Math.PI / 2) as typeof rect.angle };
    const bounds = visualBounds(rotated);
    expect(bounds.width).toBeCloseTo(20);
    expect(bounds.height).toBeCloseTo(100);
    const locked = { ...rect, id: crypto.randomUUID(), locked: true };
    const bound = {
      ...rect,
      id: crypto.randomUUID(),
      boundElements: [{ id: "a", type: "text" as const }],
    };
    const scene = { ...blankScene(), elements: [rotated, locked, bound] };
    expect(
      elementsInMarquee(scene, { x: 30, y: -50 }, { x: 70, y: 70 }),
    ).toEqual([rotated.id]);
  });

  it("duplicates standalone elements and preserves identity of originals", () => {
    const rect = createShape("rectangle", { x: 3, y: 4 }, { x: 25, y: 30 });
    const text = createText({ x: 40, y: 50 }, "Hello");
    const locked = {
      ...createShape("rectangle", { x: 0, y: 0 }, { x: 10, y: 10 }),
      locked: true,
    };
    const scene = { ...blankScene(), elements: [rect, text, locked] };
    const result = duplicateSelection(scene, [rect.id, text.id, locked.id]);
    expect(result.ids).toHaveLength(2);
    expect(result.scene.elements).toHaveLength(5);
    expect(result.scene.elements[0]).toEqual(rect);
    expect(result.scene.elements[3].id).not.toEqual(rect.id);
    expect(result.scene.elements[3].x).toBe(27);
    expect(result.scene.elements[4].y).toBe(74);
    expect(result.scene.elements[3].version).toBe(1);
    expect(result.scene.elements[3].index).toBeNull();
    expect(duplicateSelection(scene, [locked.id]).scene).toBe(scene);
  });
});
