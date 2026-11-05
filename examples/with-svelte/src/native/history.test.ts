import { describe, expect, it } from "vitest";
import { blankScene, createShape } from "./scene";
import { indexInsertedNativeElements } from "./ordering";
import { updateNativeElement } from "./coreAdapter";
import { SceneHistory } from "./history";

const withOneShape = () => {
  const empty = blankScene();
  const box = createShape("rectangle", { x: 10, y: 20 }, { x: 110, y: 120 });
  return indexInsertedNativeElements(empty, { ...empty, elements: [box] });
};

describe("Svelte history with original Excalidraw ElementsDelta", () => {
  it("keeps a single transaction for geometry changes and supports redo", () => {
    const source = withOneShape();
    const element = source.elements[0];
    const changed = {
      ...source,
      elements: [updateNativeElement(element, { x: element.x + 45 })],
    };
    const history = new SceneHistory();
    history.commit(source, changed);
    expect(history.canUndo).toBe(true);
    const restored = history.undo(changed);
    expect(restored.elements[0].x).toBe(element.x);
    expect(history.canRedo).toBe(true);
    const redone = history.redo(restored);
    expect(redone.elements[0].x).toBe(changed.elements[0].x);
    expect(history.canRedo).toBe(false);
  });

  it("falls back safely for additions and tracks scene files", () => {
    const before = withOneShape();
    const extra = createShape("ellipse", { x: 140, y: 20 }, { x: 200, y: 120 });
    const added = indexInsertedNativeElements(before, {
      ...before,
      elements: [...before.elements, extra],
      files: { ...before.files, one: { id: "one" } },
    });
    const history = new SceneHistory();
    history.commit(before, added);
    const undone = history.undo(added);
    expect(undone.elements).toHaveLength(1);
    expect(undone.files).toEqual(before.files);
    const redone = history.redo(undone);
    expect(redone.elements).toHaveLength(2);
    expect(redone.files).toEqual(added.files);
  });

  it("clears redo after a new edit", () => {
    const source = withOneShape();
    const changed = {
      ...source,
      elements: [updateNativeElement(source.elements[0], { opacity: 40 })],
    };
    const history = new SceneHistory();
    history.commit(source, changed);
    const old = history.undo(changed);
    history.commit(old, {
      ...old,
      elements: [updateNativeElement(old.elements[0], { opacity: 60 })],
    });
    expect(history.canRedo).toBe(false);
    history.clear();
    expect(history.canUndo).toBe(false);
  });
});
