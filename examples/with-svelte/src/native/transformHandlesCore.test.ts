import { describe, expect, it } from "vitest";
import { getTransformHandles } from "@excalidraw/element";
import { blankScene, createShape } from "./scene";
import { coreHandleLocations, pickHandle } from "./transforms";

describe("native handles use the core zoom geometry", () => {
  it("locates corner and rotation handles exactly where Excalidraw reports them", () => {
    const box = createShape("rectangle", { x: 50, y: 20 }, { x: 170, y: 130 });
    const scene = { ...blankScene(), elements: [box] };
    const locations = coreHandleLocations(box, 2, scene);
    const original = getTransformHandles(
      box,
      { value: 2 } as Parameters<typeof getTransformHandles>[1],
      new Map([[box.id, box]]) as Parameters<typeof getTransformHandles>[2],
    );
    expect(locations).not.toBeNull();
    expect(locations!.nw.x).toBeCloseTo(original.nw![0] + original.nw![2] / 2);
    expect(locations!.rotate.y).toBeCloseTo(original.rotation![1] + original.rotation![3] / 2);
    expect(pickHandle(box, locations!.nw, 4, scene, 2)).toBe("nw");
    expect(pickHandle(box, locations!.rotate, 4, scene, 2)).toBe("rotate");
  });

  it("rejects invalid zoom and locked selections", () => {
    const box = createShape("diamond", { x: 0, y: 0 }, { x: 100, y: 100 });
    const scene = { ...blankScene(), elements: [box] };
    expect(coreHandleLocations(box, 0, scene)).toBeNull();
    expect(coreHandleLocations({ ...box, locked: true }, 1, scene)).toBeNull();
  });
});
