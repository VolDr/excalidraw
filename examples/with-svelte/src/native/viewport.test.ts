import { describe, expect, it } from "vitest";

import { blankScene, createShape } from "./scene";
import { fitNativeViewportWithCore } from "./viewport";

describe("Svelte viewport fitting delegates to Excalidraw", () => {
  it("centers supported scene elements using original common bounds", () => {
    const a = createShape("rectangle", { x: 50, y: 25 }, { x: 150, y: 125 });
    const b = createShape("ellipse", { x: 200, y: 75 }, { x: 300, y: 175 });
    const scene = { ...blankScene(), elements: [a, b] };
    const result = fitNativeViewportWithCore(
      scene, [], "all", { x: 800, y: 600 }, 1, { x: 0, y: 0 },
    );
    expect(result).not.toBeNull();
    if (!result) return;
    const centerX = (50 + 300) / 2;
    const centerY = (25 + 175) / 2;
    expect(centerX * result.zoom + result.pan.x).toBeCloseTo(400);
    expect(centerY * result.zoom + result.pan.y).toBeCloseTo(300);
    expect(result.zoom).toBeLessThanOrEqual(5);
  });

  it("only fits selected elements and ignores deleted objects", () => {
    const a = createShape("rectangle", { x: 10, y: 10 }, { x: 90, y: 80 });
    const b = createShape("diamond", { x: 1000, y: 1000 }, { x: 1100, y: 1100 });
    const scene = { ...blankScene(), elements: [a, { ...b, isDeleted: true }] };
    const fit = fitNativeViewportWithCore(
      scene, [a.id], "selection", { x: 500, y: 400 }, 1, { x: 0, y: 0 },
    );
    expect(fit).not.toBeNull();
    expect(fitNativeViewportWithCore(scene, [b.id], "selection",
      { x: 500, y: 400 }, 1, { x: 0, y: 0 })).toBeNull();
  });

  it("refuses empty, zero-sized and invalid viewports", () => {
    const scene = blankScene();
    expect(fitNativeViewportWithCore(scene, [], "all", { x: 500, y: 400 }, 1, { x: 0, y: 0 })).toBeNull();
    const a = createShape("rectangle", { x: 0, y: 0 }, { x: 100, y: 100 });
    const next = { ...scene, elements: [a] };
    expect(fitNativeViewportWithCore(next, [], "all", { x: 0, y: 0 }, 1, { x: 0, y: 0 })).toBeNull();
    expect(fitNativeViewportWithCore(next, [], "all", { x: 500, y: 400 }, 0, { x: 0, y: 0 })).toBeNull();
  });
});
