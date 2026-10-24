import { describe, expect, it } from "vitest";

import { blankScene, createShape, createText } from "./scene";
import { groupSelection } from "./groups";
import {
  duplicateSelection,
  elementsInMarquee,
  rectangleBetween,
  visualBounds,
} from "./selection";

describe("native marquee and duplication", () => {
  it("marquee selects whole groups on intersection and requires full enclosure in reverse", () => {
    const a = createShape("rectangle", { x: 0, y: 0 }, { x: 20, y: 20 });
    const b = createShape("rectangle", { x: 100, y: 100 }, { x: 120, y: 120 });
    const grouped = groupSelection({ ...blankScene(), elements: [a, b] }, [
      a.id,
      b.id,
    ]);
    expect(
      elementsInMarquee(grouped.scene, { x: -5, y: -5 }, { x: 25, y: 25 }),
    ).toEqual([a.id, b.id]);
    expect(
      elementsInMarquee(grouped.scene, { x: 25, y: 25 }, { x: -5, y: -5 }),
    ).toEqual([]);
  });

  it("duplicates an entire flat group with a fresh shared group ID", () => {
    const a = createShape("rectangle", { x: 10, y: 20 }, { x: 50, y: 60 });
    const b = createShape("ellipse", { x: 100, y: 110 }, { x: 150, y: 170 });
    const grouped = groupSelection({ ...blankScene(), elements: [a, b] }, [
      a.id,
      b.id,
    ]);
    const originalGroupId = grouped.groupId!;
    expect(duplicateSelection(grouped.scene, [a.id]).scene).toBe(grouped.scene);
    const duplicated = duplicateSelection(grouped.scene, [a.id, b.id]);
    expect(duplicated.ids).toHaveLength(2);
    const [copyA, copyB] = duplicated.scene.elements.slice(2);
    expect(copyA.groupIds).toHaveLength(1);
    expect(copyA.groupIds).toEqual(copyB.groupIds);
    expect(copyA.groupIds[0]).not.toBe(originalGroupId);
    expect(copyA.id).not.toBe(a.id);
    expect(copyB.x).toBe(124);
    expect(duplicated.scene.elements[0].groupIds).toEqual([originalGroupId]);
  });

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
