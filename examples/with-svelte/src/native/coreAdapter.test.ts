import {
  newArrowElement,
  newElement,
  newElementWith,
  newLinearElement,
} from "@excalidraw/element";
import { describe, expect, it } from "vitest";

import { nativeElementsMap, updateNativeElement } from "./coreAdapter";
import { blankScene, createShape } from "./scene";

describe("Svelte scene adapter to original Excalidraw core", () => {
  it("uses native Excalidraw constructors for all supported primitives", () => {
    const rect = createShape("rectangle", { x: 20, y: 30 }, { x: 120, y: 130 });
    const line = createShape("line", { x: 140, y: 40 }, { x: 240, y: 90 });
    const arrow = createShape("arrow", { x: 330, y: 140 }, { x: 250, y: 70 });
    const ellipse = createShape("ellipse", { x: 20, y: 30 }, { x: 70, y: 100 });

    // Compare the schema and metadata values the official constructors own,
    // not random IDs or timestamps.
    const official = newElement({ type: "rectangle", x: 20, y: 30, width: 100, height: 100 });
    expect(rect.type).toBe(official.type);
    expect(rect.version).toBe(official.version);
    expect(rect.roundness).toEqual(official.roundness);
    expect(rect.groupIds).toEqual(official.groupIds);
    expect(rect.boundElements).toEqual(official.boundElements);
    expect(rect.locked).toBe(false);
    expect(ellipse.type).toBe("ellipse");

    const officialLine = newLinearElement({
      type: "line", x: 140, y: 40, width: 100, height: 50, points: [[0, 0], [100, 50]],
    });
    expect(line.type).toBe(officialLine.type);
    if (line.type === "line") {
      expect(line.points).toEqual(officialLine.points);
      expect(line.polygon).toBe(officialLine.polygon);
    }
    const officialArrow = newArrowElement({
      type: "arrow", x: 250, y: 70, width: 80, height: 70,
      points: [[80, 70], [0, 0]], elbowed: false, endArrowhead: "arrow",
    });
    expect(arrow.type).toBe(officialArrow.type);
    if (arrow.type === "arrow") {
      expect(arrow.points).toEqual(officialArrow.points);
      expect(arrow.endArrowhead).toBe(officialArrow.endArrowhead);
      expect(arrow.elbowed).toBe(false);
    }
  });

  it("delegates version/nonce updates and no-op detection to newElementWith", () => {
    const element = createShape("rectangle", { x: 12, y: 17 }, { x: 112, y: 117 });
    const scene = { ...blankScene(), elements: [element] };
    const map = nativeElementsMap(scene);
    expect(map.get(element.id)).toBe(element);
    expect(updateNativeElement(element, { x: element.x })).toBe(element);

    const moved = updateNativeElement(element, { x: 44, y: 55 });
    const expected = newElementWith(element, { x: 44, y: 55 });
    expect(moved.x).toBe(expected.x);
    expect(moved.y).toBe(expected.y);
    expect(moved.version).toBe(element.version + 1);
    expect(moved.versionNonce).not.toBe(element.versionNonce);
    expect(element.x).toBe(12);
    expect(element.version).toBe(scene.elements[0].version);

    const deleted = updateNativeElement(moved, { isDeleted: true });
    expect(deleted.isDeleted).toBe(true);
    expect(deleted.version).toBe(moved.version + 1);
    expect(updateNativeElement(deleted, { isDeleted: true })).toBe(deleted);
    expect(scene.elements[0].isDeleted).toBe(false);
  });

  it("retains import extension fields on immutable updates", () => {
    const element = {
      ...createShape("diamond", { x: 0, y: 10 }, { x: 90, y: 100 }),
      customData: { from: "external", nested: { untouched: true } },
      extraMetadata: { feature: "future-version" },
    };
    const result = updateNativeElement(element, { x: 23 });
    expect(result.customData).toEqual(element.customData);
    expect(result.extraMetadata).toEqual(element.extraMetadata);
    expect(result.id).toBe(element.id);
    expect(element.x).toBe(0);
  });
});
