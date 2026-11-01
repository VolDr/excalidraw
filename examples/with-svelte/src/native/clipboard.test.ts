import { describe, expect, it } from "vitest";

import { appendNativeArrow } from "./bindings";
import { updateNativeBoxLabel } from "./boundText";
import {
  copyNativeSelection,
  cutNativeSelection,
  pasteNativeSelection,
} from "./clipboard";
import { groupSelection } from "./groups";
import { SceneHistory } from "./history";
import { addNativeImage } from "./images";
import {
  blankScene,
  createShape,
  parseScene,
  serializeScene,
} from "./scene";

const labeledGroup = () => {
  const box = createShape("rectangle", { x: 20, y: 20 }, { x: 210, y: 120 });
  const ellipse = createShape("ellipse", { x: 300, y: 30 }, { x: 430, y: 130 });
  const labeled = updateNativeBoxLabel(
    { ...blankScene(), elements: [box, ellipse] },
    box.id,
    "Copy me with my box",
  );
  const grouped = groupSelection(labeled, [box.id, ellipse.id]);
  return { scene: grouped.scene, ids: grouped.ids, box, ellipse };
};

describe("Svelte native scene clipboard", () => {
  it("copies and pastes the entire group including its reciprocal label", () => {
    const { scene, ids, box, ellipse } = labeledGroup();
    const before = structuredClone(scene);
    const payload = copyNativeSelection(scene, ids);
    expect(payload).toBeTruthy();
    const first = pasteNativeSelection(scene, payload!);
    expect(first.ids).toHaveLength(2);
    expect(first.scene.elements).toHaveLength(6);
    const [copiedBox, copiedEllipse, copiedLabel] = first.scene.elements.slice(3);
    expect(copiedBox.id).not.toBe(box.id);
    expect(copiedEllipse.id).not.toBe(ellipse.id);
    expect(copiedBox.groupIds).toEqual(copiedLabel.groupIds);
    expect(copiedBox.groupIds).toEqual(copiedEllipse.groupIds);
    expect(copiedBox.groupIds[0]).not.toBe(scene.elements[0].groupIds[0]);
    expect(copiedBox.boundElements?.[0].id).toBe(copiedLabel.id);
    expect(copiedLabel.type).toBe("text");
    if (copiedLabel.type === "text") {
      expect(copiedLabel.containerId).toBe(copiedBox.id);
      expect(copiedLabel.originalText).toBe("Copy me with my box");
    }
    expect(copiedBox.x).toBeCloseTo(box.x + 24);
    expect(copiedEllipse.x).toBeCloseTo(ellipse.x + 24);
    expect(first.scene.elements.slice(0, 3)).toEqual(scene.elements);
    expect(scene).toEqual(before);
    expect(parseScene(serializeScene(first.scene))).toEqual(first.scene);

    const second = pasteNativeSelection(first.scene, payload!, 48);
    expect(second.scene.elements).toHaveLength(9);
    expect(new Set(second.scene.elements.map((e) => e.id)).size).toBe(9);
    expect(second.scene.elements[6].x).toBeCloseTo(box.x + 48);
    const history = new SceneHistory();
    history.commit(scene);
    expect(history.undo(first.scene)).toEqual(scene);
    expect(history.redo(scene)).toEqual(first.scene);
  });

  it("cuts an entire labeled group and restores it via undo", () => {
    const { scene, ids } = labeledGroup();
    const cut = cutNativeSelection(scene, ids);
    expect(cut.text).toBeTruthy();
    expect(cut.scene).not.toBe(scene);
    expect(cut.scene.elements.map((element) => element.isDeleted)).toEqual([
      true,
      true,
      true,
    ]);
    expect(scene.elements.every((element) => !element.isDeleted)).toBe(true);
    const pasted = pasteNativeSelection(cut.scene, cut.text!);
    expect(pasted.ids).toHaveLength(2);
    expect(pasted.scene.elements).toHaveLength(6);
    expect(pasted.scene.elements.slice(3).every((element) => !element.isDeleted))
      .toBe(true);
    expect(pasted.scene.elements[3].boundElements?.[0].id).toBe(
      pasted.scene.elements[5].id,
    );
    const history = new SceneHistory();
    history.commit(scene);
    expect(history.undo(cut.scene)).toEqual(scene);
  });

  it("refuses an entire mixed copy/cut if a linked target is unsafe to clone", () => {
    const left = createShape("rectangle", { x: 20, y: 20 }, { x: 130, y: 100 });
    const right = createShape("ellipse", { x: 280, y: 20 }, { x: 400, y: 120 });
    const other = createShape("diamond", { x: 440, y: 20 }, { x: 520, y: 100 });
    const arrow = createShape("arrow", { x: 130, y: 70 }, { x: 280, y: 70 });
    const scene = appendNativeArrow(
      { ...blankScene(), elements: [left, right, other] },
      arrow,
      { x: 130, y: 70 },
      { x: 280, y: 70 },
    );
    expect(copyNativeSelection(scene, [left.id, other.id])).toBeNull();
    const cut = cutNativeSelection(scene, [left.id, other.id]);
    expect(cut).toEqual({ scene, text: null });
    expect(scene.elements.every((element) => !element.isDeleted)).toBe(true);
    expect(copyNativeSelection(scene, [other.id])).toBeTruthy();
  });

  it("rejects a clipboard payload larger than paste can accept before cutting", () => {
    const box = createShape("rectangle", { x: 10, y: 10 }, { x: 110, y: 100 });
    const large = {
      ...box,
      customData: { payload: "x".repeat(24_000_001) },
    };
    const scene = { ...blankScene(), elements: [large] };
    expect(copyNativeSelection(scene, [box.id])).toBeNull();
    const cut = cutNativeSelection(scene, [box.id]);
    expect(cut.text).toBeNull();
    expect(cut.scene).toBe(scene);
    expect(scene.elements[0].isDeleted).toBe(false);
  });

  it("does not copy unsupported half-selected or malformed groups", () => {
    const { scene, ids } = labeledGroup();
    expect(copyNativeSelection(scene, [ids[0]])).toBeNull();
    const payload = JSON.parse(copyNativeSelection(scene, ids)!);
    payload.elements = payload.elements.filter(
      (element: { type: string }) => element.type !== "text",
    );
    expect(pasteNativeSelection(scene, JSON.stringify(payload)).scene).toBe(scene);
    const malformed = JSON.parse(copyNativeSelection(scene, ids)!);
    malformed.elements[0].boundElements[0].id = "missing-text";
    expect(pasteNativeSelection(scene, JSON.stringify(malformed)).scene).toBe(scene);
  });

  it("pastes embedded raster files under fresh IDs without overwriting originals", () => {
    const created = addNativeImage(
      blankScene(),
      { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" },
      { width: 80, height: 60 },
      { x: 160, y: 170 },
    );
    const box = createShape("rectangle", { x: 300, y: 90 }, { x: 400, y: 200 });
    const grouped = groupSelection(
      { ...created.scene, elements: [created.element, box] },
      [created.element.id, box.id],
    );
    const payload = copyNativeSelection(grouped.scene, grouped.ids);
    const pasted = pasteNativeSelection(grouped.scene, payload!);
    expect(pasted.ids).toHaveLength(2);
    expect(pasted.scene.elements).toHaveLength(4);
    expect(Object.keys(pasted.scene.files)).toHaveLength(2);
    const original = created.element;
    const copied = pasted.scene.elements[2];
    expect(copied.type).toBe("image");
    if (copied.type !== "image") {
      return;
    }
    expect(copied.fileId).not.toBe(original.fileId);
    expect(pasted.scene.files[copied.fileId!]).toEqual({
      ...(created.scene.files[original.fileId!] as Record<string, unknown>),
      id: copied.fileId,
    });
    expect(pasted.scene.files[original.fileId!]).toEqual(
      created.scene.files[original.fileId!],
    );
    expect(pasted.scene.appState).toEqual(grouped.scene.appState);
    expect(parseScene(serializeScene(pasted.scene))).toEqual(pasted.scene);

    const damaged = JSON.parse(payload!);
    damaged.files = {};
    expect(pasteNativeSelection(grouped.scene, JSON.stringify(damaged)).scene)
      .toBe(grouped.scene);
  });

  it("ignores external, invalid, oversized and incomplete clipboard contents", () => {
    const { scene, ids } = labeledGroup();
    for (const text of [
      "",
      "ordinary user text",
      "{}",
      '{"type":"excalidraw"}',
      "{ definitely not JSON",
      "x".repeat(24_000_001),
    ]) {
      const result = pasteNativeSelection(scene, text);
      expect(result.scene).toBe(scene);
      expect(result.ids).toEqual([]);
    }
    expect(copyNativeSelection(scene, [])).toBeNull();
    const valid = copyNativeSelection(scene, ids)!;
    expect(pasteNativeSelection(scene, valid, Number.NaN).scene).toBe(scene);
    const partial = JSON.parse(valid);
    partial.rootIds = [partial.rootIds[0]];
    expect(pasteNativeSelection(scene, JSON.stringify(partial)).scene).toBe(scene);
  });
});
