import { describe, expect, it, vi } from "vitest";

import {
  nativeBoundLabelLayout,
  nativeLabelBox,
  syncNativeBoundLabels,
} from "./boundText";
import { blankScene, createShape, createText, parseScene, serializeScene, unsupportedCount } from "./scene";
import { deleteSelection, moveSelection, transformSelected } from "./transforms";

const makeScene = () => {
  const rectangle = createShape("rectangle", { x: 10, y: 20 }, { x: 250, y: 150 });
  const label = createText({ x: 0, y: 0 }, "First line\nSecond line");
  const box = {
    ...rectangle,
    boundElements: [{ id: label.id, type: "text" as const }],
  };
  const text = {
    ...label,
    containerId: box.id,
    textAlign: "center" as const,
    verticalAlign: "middle" as const,
  };
  const scene = { ...blankScene(), elements: [box, text] };
  return { box, text, scene };
};

describe("native flat box labels", () => {
  it("recognizes reciprocal labels and calculates official center alignment", () => {
    const { box, text, scene } = makeScene();
    expect(nativeLabelBox(scene, text)?.id).toBe(box.id);
    expect(unsupportedCount(scene)).toBe(0);
    const layout = nativeBoundLabelLayout(scene, text);
    expect(layout).not.toBeNull();
    expect(layout!.x + layout!.width / 2).toBeCloseTo(box.x + box.width / 2);
    expect(layout!.y + layout!.height / 2).toBeCloseTo(box.y + box.height / 2);
    const before = JSON.stringify(scene);
    nativeBoundLabelLayout(scene, text);
    expect(JSON.stringify(scene)).toBe(before);
  });

  it("follows translation and rotation, persists metadata, and does not mutate original", () => {
    const { box, text, scene } = makeScene();
    const initial = syncNativeBoundLabels(scene);
    const before = initial.elements[1];
    const moved = moveSelection(initial, [box.id], 35, 24);
    const updated = moved.elements[1];
    expect(updated.x).toBeCloseTo(before.x + 35);
    expect(updated.y).toBeCloseTo(before.y + 24);
    expect(updated.type).toBe("text");
    if (updated.type !== "text") {
      return;
    }
    expect(updated.containerId).toBe(box.id);
    expect(updated.originalText).toBe(text.originalText);
    expect(updated.version).toBe(before.version + 1);
    const rotated = transformSelected(moved, box.id, "rotate", {
      x: moved.elements[0].x + moved.elements[0].width / 2 + 30,
      y: moved.elements[0].y + moved.elements[0].height / 2,
    });
    expect(rotated.elements[1].angle).toBeCloseTo(Math.PI / 2);
    expect(parseScene(serializeScene(rotated))).toEqual(rotated);
    expect(scene.elements[1].angle).toBe(text.angle);
  });

  it("reflows label on resize and deletes both sides atomically", () => {
    const { box, scene } = makeScene();
    const synced = syncNativeBoundLabels(scene);
    const smaller = transformSelected(synced, box.id, "se", {
      x: box.x + 155,
      y: box.y + 110,
    });
    const updated = smaller.elements[1];
    expect(updated.type).toBe("text");
    if (updated.type !== "text") {
      return;
    }
    expect(updated.containerId).toBe(box.id);
    expect(updated.originalText).toBe(scene.elements[1].type === "text"
      ? scene.elements[1].originalText : null);
    expect(updated.width).toBeGreaterThan(0);
    expect(updated.height).toBeGreaterThan(0);
    const deleted = deleteSelection(smaller, [box.id]);
    expect(deleted.elements.every((element) => element.isDeleted)).toBe(true);
    expect(scene.elements.every((element) => !element.isDeleted)).toBe(true);
  });

  it("keeps foreign or inconsistent binding records completely unsupported", () => {
    const { box, text, scene } = makeScene();
    const cases = [
      { ...scene, elements: [{ ...box, boundElements: null }, text] },
      { ...scene, elements: [box, { ...text, groupIds: ["nested"] }] },
      { ...scene, elements: [{ ...box, boundElements: [...box.boundElements!, {
        id: "missing", type: "arrow" as const,
      }] }, text] },
      { ...scene, elements: [box, { ...text, containerId: "other" }] },
    ];
    for (const input of cases) {
      expect(nativeLabelBox(input, input.elements[1])).toBeNull();
      expect(unsupportedCount(input)).toBe(1);
      const previous = JSON.stringify(input);
      expect(syncNativeBoundLabels(input)).toBe(input);
      expect(JSON.stringify(input)).toBe(previous);
      expect(moveSelection(input, [input.elements[0].id], 10, 10)).toBe(input);
    }
  });

  it("does not paint an orphan label in the native text renderer", async () => {
    const { text } = makeScene();
    const { paintNativeText } = await import("./text");
    const ctx = document.createElement("canvas").getContext("2d")!;
    const paint = vi.spyOn(ctx, "fillText");
    paintNativeText(ctx, text, "#123456");
    expect(paint).not.toHaveBeenCalled();
  });
});
