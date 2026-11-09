import { describe, expect, it } from "vitest";
import { CoreEditorSession } from "@excalidraw/element";
import { blankScene, createShape } from "./scene";
import { indexInsertedNativeElements } from "./ordering";
import { canLayoutNativeSelection, nativeLayoutUnitCount, type NativeLayoutAction } from "./layout";
import { groupSelection } from "./groups";
import { updateNativeBoxLabel } from "./boundText";

const previewLayout = (
  scene: ReturnType<typeof blankScene>,
  ids: readonly string[],
  action: NativeLayoutAction,
) => {
  if (!canLayoutNativeSelection(scene, ids) ||
      (action.kind === "distribute" && nativeLayoutUnitCount(scene, ids) < 3)) {
    return scene;
  }
  const session = new CoreEditorSession(scene);
  try {
    return session.previewLayoutDocument(scene, ids, action);
  } finally {
    session.destroy();
  }
};

const sample = () => {
  const start = blankScene();
  const elements = [
    createShape("rectangle", { x: 20, y: 40 }, { x: 90, y: 100 }),
    createShape("ellipse", { x: 230, y: 90 }, { x: 300, y: 170 }),
    createShape("diamond", { x: 390, y: 150 }, { x: 460, y: 240 }),
  ];
  return indexInsertedNativeElements(start, { ...start, elements });
};

describe("native align/distribute delegates to Excalidraw", () => {
  it("aligns independent boxes using the original scene mutations", () => {
    const source = sample();
    const ids = source.elements.map((e) => e.id);
    const result = previewLayout(source, ids, {
      kind: "align", alignment: { axis: "x", position: "start" },
    });
    expect(result).not.toBe(source);
    expect(result.elements.map((e) => e.x)).toEqual([20, 20, 20]);
    expect(result.elements[1].version).toBeGreaterThan(source.elements[1].version);
    expect(source.elements[1].x).toBe(230);
  });

  it("distributes independent objects without changing IDs or source", () => {
    const source = sample();
    const ids = source.elements.map((e) => e.id);
    const result = previewLayout(source, ids, {
      kind: "distribute", distribution: { axis: "x", space: "between" },
    });
    expect(result.elements.map((e) => e.id)).toEqual(ids);
    expect(result.elements[0].x).toBe(source.elements[0].x);
    expect(result.elements[2].x).toBe(source.elements[2].x);
    expect(result.elements[1].x).not.toBe(source.elements[1].x);
  });

  it("treats complete safe groups as one unit and preserves internal offsets", () => {
    const source = sample();
    const group = groupSelection(source, [source.elements[0].id, source.elements[1].id]);
    const ids = source.elements.map((e) => e.id);
    expect(group.groupId).not.toBeNull();
    expect(nativeLayoutUnitCount(group.scene, ids.slice(0, 2))).toBe(0);
    expect(nativeLayoutUnitCount(group.scene, ids)).toBe(2);
    const aligned = previewLayout(group.scene, ids, {
      kind: "align", alignment: { axis: "x", position: "start" },
    });
    expect(aligned).not.toBe(group.scene);
    expect(aligned.elements[0].x).toBe(group.scene.elements[0].x);
    expect(aligned.elements[1].x).toBe(group.scene.elements[1].x);
    expect(aligned.elements[2].x).toBe(group.scene.elements[0].x);
    expect(aligned.elements[0].groupIds).toEqual([group.groupId]);
    expect(aligned.elements[1].groupIds).toEqual([group.groupId]);
    expect(previewLayout(group.scene, ids.slice(0, 2), {
      kind: "align", alignment: { axis: "y", position: "center" },
    })).toBe(group.scene);
    expect(previewLayout(group.scene, ids, {
      kind: "distribute", distribution: { axis: "x", space: "between" },
    })).toBe(group.scene);
  });

  it("distributes three logical units when one is a group", () => {
    const source = sample();
    const fourth = createShape("rectangle", { x: 760, y: 30 }, { x: 840, y: 130 });
    const extended = indexInsertedNativeElements(
      source, { ...source, elements: [...source.elements, fourth] },
    );
    const ids = extended.elements.map((e) => e.id);
    const grouped = groupSelection(extended, ids.slice(0, 2));
    expect(nativeLayoutUnitCount(grouped.scene, ids)).toBe(3);
    const distributed = previewLayout(grouped.scene, ids, {
      kind: "distribute", distribution: { axis: "x", space: "between" },
    });
    expect(distributed.elements[2].x).not.toBe(grouped.scene.elements[2].x);
    expect(distributed.elements[1].x - distributed.elements[0].x).toBe(
      grouped.scene.elements[1].x - grouped.scene.elements[0].x,
    );
  });

  it("moves a validated reciprocal caption together with its box", () => {
    const source = sample();
    const labeled = updateNativeBoxLabel(source, source.elements[0].id, "Caption");
    const indexed = indexInsertedNativeElements(source, labeled);
    const ids = [source.elements[0].id, source.elements[1].id];
    expect(canLayoutNativeSelection(indexed, ids)).toBe(true);
    const next = previewLayout(indexed, ids, {
      kind: "align", alignment: { axis: "x", position: "start" },
    });
    const text = next.elements.find((element) => element.type === "text");
    expect(text?.type).toBe("text");
    if (text?.type === "text") {
      expect(text.containerId).toBe(ids[0]);
      expect(text.isDeleted).toBe(false);
    }
  });

  it("aligns complete nested groups as one unit through original core group bounds", () => {
    const source = sample();
    const fourth = createShape("rectangle", { x: 630, y: 20 }, { x: 720, y: 90 });
    const four = indexInsertedNativeElements(source, {
      ...source, elements: [...source.elements, fourth],
    });
    const ids = four.elements.map((element) => element.id);
    const inner = groupSelection(four, ids.slice(0, 2));
    const nested = groupSelection(inner.scene, ids.slice(0, 3));
    expect(nativeLayoutUnitCount(nested.scene, ids)).toBe(2);
    const next = previewLayout(nested.scene, ids, {
      kind: "align", alignment: { axis: "y", position: "start" },
    });
    expect(next).not.toBe(nested.scene);
    // Inner group geometry remains rigid, while the outer group moves as a unit.
    expect(next.elements[1].y - next.elements[0].y).toBe(
      nested.scene.elements[1].y - nested.scene.elements[0].y,
    );
    expect(next.elements[3].y).toBe(20);
    expect(next.elements[0].groupIds).toEqual(nested.scene.elements[0].groupIds);
  });

  it("does not edit groups, single elements or partially valid sets", () => {
    const source = sample();
    expect(canLayoutNativeSelection(source, [source.elements[0].id])).toBe(false);
    expect(previewLayout(source, [source.elements[0].id], {
      kind: "align", alignment: { axis: "y", position: "center" },
    })).toBe(source);
    const locked = {
      ...source,
      elements: [{ ...source.elements[0], locked: true }, ...source.elements.slice(1)],
    };
    expect(canLayoutNativeSelection(locked, locked.elements.map((e) => e.id))).toBe(false);
  });
});
