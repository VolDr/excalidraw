import { describe, expect, it } from "vitest";

import {
  blankScene,
  createShape,
  createText,
  createFreeDraw,
  replaceText,
  hitTest,
  deleteById,
  moveById,
  parseScene,
  pickElement,
  serializeScene,
  unsupportedCount,
} from "./scene";
import { SceneHistory } from "./history";

describe("native scene compatibility", () => {
  it("round-trips imported unknown elements and embedded binary files", () => {
    const original = blankScene();
    original.elements = [
      {
        ...createShape("rectangle", { x: 3, y: 6 }, { x: 50, y: 70 }),
        customData: { createdBy: "external" },
      },
      {
        ...createShape("rectangle", { x: 10, y: 10 }, { x: 40, y: 40 }),
        type: "image",
        fileId: "img1",
        status: "saved",
      },
    ] as typeof original.elements;
    original.files = {
      img1: { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" },
    };
    original.appState = { viewBackgroundColor: "#fdfaf3", gridSize: 20 };
    const withExtensions = {
      ...original,
      customSceneMetadata: { owner: "external", revision: 42 },
    };
    const restored = parseScene(serializeScene(withExtensions));
    expect(restored).toEqual(withExtensions);
    expect(restored.elements).toEqual(original.elements);
    expect(unsupportedCount(restored)).toBe(0);
  });

  it("normalizes reverse drag and preserves arrow endpoints", () => {
    const arrow = createShape("arrow", { x: 90, y: 85 }, { x: 15, y: 25 });
    expect([arrow.x, arrow.y, arrow.width, arrow.height]).toEqual([
      15, 25, 75, 60,
    ]);
    if (arrow.type === "arrow") {
      expect(arrow.points).toEqual([
        [75, 60],
        [0, 0],
      ]);
    }
  });

  it("moves, selects, deletes and undoes a gesture", () => {
    const scene = blankScene();
    const rect = createShape("rectangle", { x: 10, y: 20 }, { x: 80, y: 90 });
    scene.elements = [rect];
    expect(pickElement(scene.elements, { x: 30, y: 30 })?.id).toBe(rect.id);
    const history = new SceneHistory();
    history.commit(scene);
    const moved = moveById(scene, rect.id, 11, -7);
    expect(moved.elements[0].x).toBe(21);
    expect(history.undo(moved).elements[0].x).toBe(10);
    expect(history.redo(scene).elements[0].x).toBe(21);
    expect(deleteById(moved, rect.id).elements[0].isDeleted).toBe(true);
    expect(scene.elements[0].isDeleted).toBe(false);
  });

  it("creates text with Excalidraw metrics, preserves identity when edited", () => {
    const text = createText({ x: 10, y: 20 }, "Hello");
    expect(text.type).toBe("text");
    expect(text.width).toBeGreaterThan(0);
    const scene = blankScene();
    scene.elements = [text];
    const edited = replaceText(scene, text.id, "Hello world");
    const result = edited.elements[0];
    expect(result.id).toBe(text.id);
    expect(result.version).toBeGreaterThan(text.version);
    if (result.type === "text") {
      expect(result.text).toBe("Hello world");
      expect(result.width).toBeGreaterThan(text.width);
    }
  });

  it("serializes pressure-aware freehand and avoids selecting empty arrow bounds", () => {
    const stroke = createFreeDraw(
      [
        { x: 40, y: 30 },
        { x: 60, y: 55 },
        { x: 80, y: 35 },
      ],
      [0.5, 0.7, 0.6],
    );
    expect(stroke.points.length).toBe(3);
    expect(stroke.pressures.length).toBe(3);
    expect(
      parseScene(serializeScene({ ...blankScene(), elements: [stroke] }))
        .elements[0],
    ).toEqual(stroke);
    const line = createShape("arrow", { x: 10, y: 10 }, { x: 100, y: 100 });
    expect(hitTest(line, { x: 50, y: 50 })).toBe(true);
    expect(hitTest(line, { x: 90, y: 10 })).toBe(false);
  });

  it("rejects corrupted group IDs, geometry, broken polylines and duplicate element IDs", () => {
    const box = createShape("rectangle", { x: 10, y: 20 }, { x: 140, y: 120 });
    const arrow = createShape("arrow", { x: 160, y: 40 }, { x: 270, y: 130 });
    const valid = { ...blankScene(), elements: [box, arrow] };
    expect(parseScene(serializeScene(valid))).toEqual(valid);

    const invalid = [
      [{ ...box, groupIds: null }, arrow],
      [{ ...box, width: "large" }, arrow],
      [{ ...box, angle: Infinity }, arrow],
      [{ ...box, boundElements: [{ type: "text" }] }, arrow],
      [box, { ...arrow, points: null }],
      [box, { ...arrow, points: [[0, 0], [NaN, 10]] }],
      [box, { ...arrow, groupIds: ["ok", 3] }],
      [box, { ...box, x: 200 }],
    ];
    for (const elements of invalid) {
      expect(() =>
        parseScene(JSON.stringify({ ...valid, elements })),
      ).toThrow("Файл содержит некорректные элементы.");
    }
  });

  it("rejects non-Excalidraw input", () => {
    expect(() => parseScene('{"elements":[]}')).toThrow();
    expect(() =>
      parseScene('{"type":"excalidraw","elements":[null]}'),
    ).toThrow();
  });
});
