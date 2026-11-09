import { describe, expect, it } from "vitest";

import { CoreEditorSession, validateFractionalIndices } from "@excalidraw/element";

import { blankScene, createShape } from "./scene";
import { indexInsertedNativeElements } from "./ordering";
import { canMoveNativeLayer, type NativeLayerMove } from "./zOrder";
import { groupSelection } from "./groups";
import { updateNativeBoxLabel } from "./boundText";

const previewLayer = (
  scene: ReturnType<typeof blankScene>,
  idOrIds: string | readonly string[],
  direction: NativeLayerMove,
) => {
  const ids = typeof idOrIds === "string" ? [idOrIds] : [...idOrIds];
  if (!canMoveNativeLayer(scene, ids)) return scene;
  const session = new CoreEditorSession(scene);
  try {
    return session.previewReorderDocument(scene, ids, direction);
  } finally {
    session.destroy();
  }
};

const sceneWith3 = () => {
  const start = blankScene();
  const elements = [
    createShape("rectangle", { x: 0, y: 0 }, { x: 60, y: 40 }),
    createShape("ellipse", { x: 100, y: 0 }, { x: 160, y: 40 }),
    createShape("diamond", { x: 200, y: 0 }, { x: 260, y: 40 }),
  ];
  return indexInsertedNativeElements(start, { ...start, elements });
};

describe("native layer controls reuse Excalidraw zindex", () => {
  it("moves a safe element forward while retaining its geometry and metadata", () => {
    const source = sceneWith3();
    const id = source.elements[0].id;
    const moved = previewLayer(source, id, "forward");
    expect(moved.elements.map((e) => e.id)).toEqual([
      source.elements[1].id,
      id,
      source.elements[2].id,
    ]);
    validateFractionalIndices(moved.elements, {
      includeBoundTextValidation: false,
      shouldThrow: true,
      ignoreLogs: true,
    });
    expect(moved.elements[2]).toBe(source.elements[2]);
    expect(moved.elements[1].x).toBe(source.elements[0].x);
    expect(moved.elements[1].version).toBeGreaterThan(source.elements[0].version);
  });

  it("preserves source and supports front/back/no-op gestures", () => {
    const source = sceneWith3();
    const back = previewLayer(source, source.elements[2].id, "bottom");
    expect(back.elements[0].id).toBe(source.elements[2].id);
    expect(previewLayer(back, source.elements[2].id, "back")).toBe(back);
    const front = previewLayer(back, source.elements[2].id, "top");
    expect(front.elements[2].id).toBe(source.elements[2].id);
    expect(source.elements[0].type).toBe("rectangle");
  });

  it("reorders a complete contiguous native group as one layer unit", () => {
    const source = sceneWith3();
    const first = source.elements[0].id;
    const second = source.elements[1].id;
    const grouped = groupSelection(source, [first, second]).scene;
    expect(canMoveNativeLayer(grouped, [first, second])).toBe(true);
    expect(canMoveNativeLayer(grouped, [first])).toBe(false);
    const moved = previewLayer(grouped, [first, second], "top");
    expect(moved.elements.map((element) => element.id)).toEqual([
      source.elements[2].id, first, second,
    ]);
    expect(moved.elements[1].groupIds).toEqual(grouped.elements[0].groupIds);
    expect(moved.elements[2].groupIds).toEqual(grouped.elements[1].groupIds);
    validateFractionalIndices(moved.elements, {
      includeBoundTextValidation: false,
      shouldThrow: true,
      ignoreLogs: true,
    });
  });

  it("moves a reciprocal box and caption together", () => {
    const start = blankScene();
    const box = createShape("rectangle", { x: 0, y: 0 }, { x: 100, y: 100 });
    const lone = indexInsertedNativeElements(start, { ...start, elements: [box] });
    const labeled = indexInsertedNativeElements(lone, updateNativeBoxLabel(lone, box.id, "Hello"));
    const next = createShape("diamond", { x: 200, y: 0 }, { x: 280, y: 80 });
    const scene = indexInsertedNativeElements(labeled, {
      ...labeled,
      elements: [...labeled.elements, next],
    });
    expect(canMoveNativeLayer(scene, [box.id])).toBe(true);
    const moved = previewLayer(scene, box.id, "top");
    expect(moved.elements[0].id).toBe(next.id);
    expect(moved.elements[1].id).toBe(box.id);
    expect(moved.elements[2].type).toBe("text");
    expect(moved.elements[2].type === "text" && moved.elements[2].containerId).toBe(box.id);
  });

  it("refuses locked, grouped and unindexed imports", () => {
    const scene = sceneWith3();
    const id = scene.elements[1].id;
    const locked = {
      ...scene,
      elements: scene.elements.map((el) => el.id === id ? { ...el, locked: true } : el),
    };
    expect(previewLayer(locked, id, "top")).toBe(locked);
    const invalid = {
      ...scene,
      elements: scene.elements.map((el) => ({ ...el, index: null })),
    };
    expect(previewLayer(invalid, id, "bottom")).toBe(invalid);
  });
});
