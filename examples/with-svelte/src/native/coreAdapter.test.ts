import {
  getBoundTextMaxHeight,
  getBoundTextMaxWidth,
  newArrowElement,
  newElement,
  newElementWith,
  newLinearElement,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";
import { describe, expect, it } from "vitest";

import type { LocalPoint } from "@excalidraw/math";
import type { ExcalidrawTextElementWithContainer } from "@excalidraw/element/types";

import { appendNativeArrow, isNativeLinkedArrow, nativeLinkedEndpoints } from "./bindings";
import { updateNativeBoxLabel } from "./boundText";
import { groupSelection } from "./groups";
import { SceneHistory } from "./history";
import {
  deleteNativeElementsWithCore,
  dragNativeSelectionWithCore,
  withNativeCoreScene,
  nativeElementsMap,
  resizeNativeBoxWithCore,
  resizeNativeGroupWithCore,
  rotateNativeGroupWithCore,
  rotateNativeBoxWithCore,
  updateNativeElement,
} from "./coreAdapter";
import { blankScene, createShape, createText } from "./scene";
import { handleLocations, moveSelection, rotateElement, transformSelected } from "./transforms";

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
      type: "line", x: 140, y: 40, width: 100, height: 50, points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(100, 50)],
    });
    expect(line.type).toBe(officialLine.type);
    if (line.type === "line") {
      expect(line.points).toEqual(officialLine.points);
      expect(line.polygon).toBe(officialLine.polygon);
    }
    const officialArrow = newArrowElement({
      type: "arrow", x: 250, y: 70, width: 80, height: 70,
      points: [pointFrom<LocalPoint>(80, 70), pointFrom<LocalPoint>(0, 0)],
      elbowed: false, endArrowhead: "arrow",
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

  it("does not leak Scene constructor fractional-index repairs into source documents", () => {
    const box = createShape("rectangle", { x: 20, y: 30 }, { x: 120, y: 110 });
    const other = createShape("ellipse", { x: 160, y: 20 }, { x: 250, y: 90 });
    // Native elements intentionally have null indices; the core Scene
    // assigns temporary indices and bumps versions on construction.
    const original = { ...blankScene(), elements: [box, other] };
    const unchanged = withNativeCoreScene(original, () => {});
    expect(unchanged).toBe(original);
    expect(original.elements[0].index).toBeNull();
    expect(original.elements[0].version).toBe(box.version);

    const changed = withNativeCoreScene(original, (core) => {
      const item = core.getNonDeletedElement(box.id);
      if (!item) {
        throw new Error("Expected native box to exist in core scene");
      }
      // Scene owns this cloned mutable element, never the source box.
      core.mutateElement(
        item as Parameters<typeof core.mutateElement>[0],
        { x: item.x + 55 },
      );
    });
    expect(changed.elements[0].x).toBe(box.x + 55);
    expect(changed.elements[0].version).toBe(box.version + 1);
    expect(changed.elements[0].index).toBeNull();
    expect(changed.elements[1]).toBe(other);
    expect(original.elements).toEqual([box, other]);
    expect(original.elements[0].x).toBe(20);
  });

  it("preserves imported custom fields and existing fractional indices", () => {
    const custom = {
      ...createShape("diamond", { x: 0, y: 0 }, { x: 80, y: 80 }),
      customData: { author: "imported" },
      foreignField: { untouched: true },
    };
    const untouched = createShape("rectangle", { x: 150, y: 20 }, { x: 230, y: 80 });
    const source = { ...blankScene(), elements: [custom, untouched] };
    const result = withNativeCoreScene(source, (core) => {
      const item = core.getNonDeletedElement(custom.id);
      if (!item) {
        throw new Error("Expected imported item");
      }
      core.mutateElement(
        item as Parameters<typeof core.mutateElement>[0],
        { y: 17 },
      );
    });
    expect(result.elements[0].customData).toEqual(custom.customData);
    expect((result.elements[0] as typeof custom).foreignField).toEqual(custom.foreignField);
    expect(result.elements[0].index).toBe(custom.index);
    expect(result.elements[0].version).toBe(custom.version + 1);
    expect(result.elements[1]).toBe(untouched);
    expect(source.elements[0]).toBe(custom);
  });

  it("delegates native multi-selection dragging through the core Scene", () => {
    const rectangle = createShape("rectangle", { x: 10, y: 20 }, { x: 110, y: 100 });
    const ellipse = createShape("ellipse", { x: 230, y: 40 }, { x: 330, y: 130 });
    const locked = {
      ...createShape("diamond", { x: 400, y: 20 }, { x: 470, y: 90 }),
      locked: true,
    };
    const scene = { ...blankScene(), elements: [rectangle, ellipse, locked] };
    const initial = structuredClone(scene);
    const moved = moveSelection(scene, [rectangle.id, ellipse.id, locked.id], 45, -13);
    expect(moved.elements.map((element) => [element.x, element.y])).toEqual([
      [55, 7],
      [275, 27],
      [400, 20],
    ]);
    expect(moved.elements[0].version).toBe(rectangle.version + 1);
    expect(moved.elements[1].version).toBe(ellipse.version + 1);
    expect(moved.elements[2]).toBe(locked);
    expect(moved.elements[0].index).toBe(rectangle.index);
    expect(scene).toEqual(initial);
    expect(dragNativeSelectionWithCore(scene, new Set(), 10, 10)).toBe(scene);
    expect(dragNativeSelectionWithCore(scene, new Set([rectangle.id]), 0, 0)).toBe(scene);
  });

  it("preserves reciprocal labels on core-driven group drag and undo", () => {
    const rectangle = createShape("rectangle", { x: 10, y: 20 }, { x: 230, y: 140 });
    const other = createShape("ellipse", { x: 330, y: 40 }, { x: 440, y: 150 });
    const labeled = updateNativeBoxLabel(
      { ...blankScene(), elements: [rectangle, other] },
      rectangle.id,
      "Core group drag",
    );
    const grouped = groupSelection(labeled, [rectangle.id, other.id]);
    expect(grouped.ids).toHaveLength(2);
    const scene = grouped.scene;
    const label = scene.elements[2];
    const history = new SceneHistory();
    history.commit(scene);
    const dragged = moveSelection(scene, grouped.ids, 60, 25);
    expect(dragged.elements[0].x).toBe(scene.elements[0].x + 60);
    expect(dragged.elements[1].x).toBe(scene.elements[1].x + 60);
    expect(dragged.elements[2].x).toBeCloseTo(label.x + 60);
    expect(dragged.elements[2].y).toBeCloseTo(label.y + 25);
    expect(dragged.elements[2].groupIds).toEqual(dragged.elements[0].groupIds);
    expect(dragged.elements[0].boundElements?.[0].id).toBe(label.id);
    expect(history.undo(dragged)).toEqual(scene);
    expect(scene.elements[0].x).toBe(rectangle.x);
  });

  it("updates reciprocal arrows through Excalidraw's original bound-element drag", () => {
    const left = createShape("rectangle", { x: 10, y: 10 }, { x: 110, y: 110 });
    const right = createShape("ellipse", { x: 230, y: 10 }, { x: 330, y: 110 });
    const arrow = createShape("arrow", { x: 110, y: 60 }, { x: 230, y: 60 });
    const scene = appendNativeArrow(
      { ...blankScene(), elements: [left, right] },
      arrow,
      { x: 110, y: 60 },
      { x: 230, y: 60 },
    );
    const before = nativeLinkedEndpoints(scene, scene.elements[2]);
    expect(before).not.toBeNull();
    const snapshot = structuredClone(scene);
    const moved = moveSelection(scene, [left.id], 35, 20);
    const attached = nativeLinkedEndpoints(moved, moved.elements[2]);
    expect(attached).not.toBeNull();
    expect(attached?.start.x).toBeCloseTo(before!.start.x + 35, 1);
    expect(attached?.start.y).toBeCloseTo(before!.start.y + 20, 1);
    expect(attached?.end.x).toBeCloseTo(before!.end.x, 1);
    expect(attached?.end.y).toBeCloseTo(before!.end.y, 1);
    expect(isNativeLinkedArrow(moved, moved.elements[2])).toBe(true);
    expect(moved.elements[1]).toBe(scene.elements[1]);
    expect(scene).toEqual(snapshot);
  });

  it("resizes unbound boxes with original Excalidraw Scene geometry", () => {
    for (const type of ["rectangle", "ellipse", "diamond"] as const) {
      const shape = createShape(type, { x: 10, y: 20 }, { x: 110, y: 70 });
      const unrelated = {
        ...createShape("rectangle", { x: 280, y: 100 }, { x: 350, y: 160 }),
        customData: { external: true },
      };
      const source = { ...blankScene(), elements: [shape, unrelated] };
      const snapshot = structuredClone(source);
      const next = transformSelected(source, shape.id, "se", { x: 150, y: 100 });
      expect(next.elements[0].x).toBeCloseTo(shape.x);
      expect(next.elements[0].y).toBeCloseTo(shape.y);
      expect(next.elements[0].width).toBeCloseTo(140);
      expect(next.elements[0].height).toBeCloseTo(80);
      expect(next.elements[0].version).toBe(shape.version + 1);
      expect(next.elements[0].index).toBe(shape.index);
      expect(next.elements[1]).toBe(unrelated);
      expect(source).toEqual(snapshot);
    }
  });

  it("keeps the opposite corner fixed on core resize of a rotated box", () => {
    const initial = createShape("rectangle", { x: 50, y: 60 }, { x: 150, y: 110 });
    const rotated = rotateElement(initial, { x: 150, y: 85 });
    const fixed = handleLocations(rotated).nw;
    const moving = handleLocations(rotated).se;
    const scene = { ...blankScene(), elements: [rotated] };
    const next = resizeNativeBoxWithCore(scene, rotated.id, "se", {
      x: moving.x - 20,
      y: moving.y + 40,
    });
    const result = handleLocations(next.elements[0]).nw;
    expect(result.x).toBeCloseTo(fixed.x, 3);
    expect(result.y).toBeCloseTo(fixed.y, 3);
    expect(next.elements[0].width).toBeGreaterThan(rotated.width);
    expect(next.elements[0].index).toBe(rotated.index);
    expect(scene.elements[0]).toBe(rotated);
  });

  it("refuses to resize unsupported, locked and bound shapes inside the core adapter", () => {
    const box = createShape("rectangle", { x: 10, y: 20 }, { x: 110, y: 120 });
    const other = createShape("rectangle", { x: 150, y: 20 }, { x: 250, y: 120 });
    const scene = { ...blankScene(), elements: [
      { ...box, locked: true },
      { ...other, boundElements: [{ id: "external-arrow", type: "arrow" as const }] },
    ] };
    expect(resizeNativeBoxWithCore(scene, box.id, "se", { x: 300, y: 300 })).toBe(scene);
    expect(resizeNativeBoxWithCore(scene, other.id, "nw", { x: 15, y: 15 })).toBe(scene);
    expect(resizeNativeBoxWithCore(scene, "missing", "se", { x: 100, y: 100 })).toBe(scene);
    expect(resizeNativeBoxWithCore(scene, box.id, "se", { x: NaN, y: 100 })).toBe(scene);

    // A malformed imported label can point at a box without the required
    // reciprocal boundElements reference. Do not silently alter that box.
    const orphan = createShape("rectangle", { x: 0, y: 0 }, { x: 110, y: 90 });
    const label = { ...createText({ x: 0, y: 0 }, "Orphan"), containerId: orphan.id };
    const malformed = { ...blankScene(), elements: [orphan, label] };
    expect(resizeNativeBoxWithCore(malformed, orphan.id, "se", {
      x: 200, y: 190,
    })).toBe(malformed);
  });

  it("rejects unsafe or partial core multi-transform before mutating Scene", () => {
    const box = createShape("rectangle", { x: 20, y: 30 }, { x: 120, y: 110 });
    const other = createShape("ellipse", { x: 180, y: 50 }, { x: 280, y: 150 });
    const grouped = groupSelection(
      { ...blankScene(), elements: [box, other] },
      [box.id, other.id],
    );
    const scene = grouped.scene;
    const bounds = { x: 20, y: 30, width: 260, height: 120 };
    const pointer = { x: 240, y: 70 };
    expect(resizeNativeGroupWithCore(scene, [box.id], "se", 1.5, bounds)).toBe(scene);
    expect(rotateNativeGroupWithCore(scene, [other.id], pointer, bounds)).toBe(scene);
    expect(resizeNativeGroupWithCore(scene, grouped.ids, "se", NaN, bounds)).toBe(scene);
    expect(rotateNativeGroupWithCore(scene, grouped.ids, { x: NaN, y: 0 }, bounds)).toBe(scene);
    const orphan = {
      ...createShape("arrow", { x: 120, y: 70 }, { x: 180, y: 70 }),
      startBinding: {
        elementId: box.id,
        fixedPoint: [1, 0.5] as [number, number],
        mode: "inside" as const,
      },
    };
    const damaged = { ...scene, elements: [...scene.elements, orphan] };
    expect(resizeNativeGroupWithCore(damaged, grouped.ids, "se", 1.5, bounds)).toBe(damaged);
    expect(rotateNativeGroupWithCore(damaged, grouped.ids, pointer, bounds)).toBe(damaged);
    expect(scene.elements[0].x).toBe(box.x);
    expect(scene.elements[1].angle).toBe(0);
  });

  it("resizes a box with one reciprocal label using Excalidraw text reflow", () => {
    const box = createShape("rectangle", { x: 20, y: 30 }, { x: 290, y: 170 });
    const labeled = updateNativeBoxLabel(
      { ...blankScene(), elements: [box] },
      box.id,
      "A native label\\nwith two lines",
    );
    const foreign = {
      ...createShape("diamond", { x: 430, y: 30 }, { x: 530, y: 130 }),
      customData: { imported: "preserve" },
    };
    const source = { ...labeled, elements: [...labeled.elements, foreign] };
    const copyBefore = structuredClone(source);
    const before = source.elements[1];
    const updated = transformSelected(source, box.id, "se", { x: 390, y: 235 });
    expect(updated).not.toBe(source);
    const nextBox = updated.elements[0];
    const nextLabel = updated.elements[1];
    expect(nextBox.width).toBeGreaterThan(box.width);
    expect(nextBox.height).toBeGreaterThan(box.height);
    expect(nextBox.boundElements).toEqual([
      { id: nextLabel.id, type: "text" },
    ]);
    expect(nextLabel.type).toBe("text");
    if (nextLabel.type !== "text") {
      throw new Error("Core resize must preserve the original bound text");
    }
    expect(nextLabel.containerId).toBe(box.id);
    expect(nextLabel.id).toBe(before.id);
    expect(nextLabel.originalText).toBe(
      before.type === "text" ? before.originalText : undefined,
    );
    expect(nextLabel.width).toBeLessThanOrEqual(
      getBoundTextMaxWidth(nextBox, nextLabel) + 0.5,
    );
    expect(nextLabel.height).toBeLessThanOrEqual(
      getBoundTextMaxHeight(
        nextBox,
        nextLabel as ExcalidrawTextElementWithContainer,
      ) + 0.5,
    );
    expect(updated.elements[2]).toBe(foreign);
    expect(nextBox.index).toBe(box.index);
    expect(nextLabel.index).toBe(before.index);
    expect(source).toEqual(copyBefore);
    const history = new SceneHistory();
    history.commit(source);
    expect(history.undo(updated)).toEqual(source);
    expect(history.redo(source)).toEqual(updated);
  });

  it("rotates a reciprocal label together with its box using core transforms", () => {
    const box = createShape("rectangle", { x: 20, y: 30 }, { x: 280, y: 170 });
    const labeled = updateNativeBoxLabel(
      { ...blankScene(), elements: [box] },
      box.id,
      "Rotate with me",
    );
    const original = structuredClone(labeled);
    const center = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
    const rotated = transformSelected(labeled, box.id, "rotate", {
      x: center.x + 100,
      y: center.y,
    });
    expect(rotated).not.toBe(labeled);
    expect(rotated.elements[0].angle).toBeCloseTo(Math.PI / 2);
    const label = rotated.elements[1];
    expect(label.type).toBe("text");
    if (label.type !== "text") {
      throw new Error("Expected unchanged reciprocal label type");
    }
    expect(label.angle).toBeCloseTo(rotated.elements[0].angle);
    expect(label.containerId).toBe(box.id);
    expect(rotated.elements[0].boundElements).toEqual([
      { id: label.id, type: "text" },
    ]);
    expect(label.originalText).toBe(
      labeled.elements[1].type === "text"
        ? labeled.elements[1].originalText
        : undefined,
    );
    expect(rotated.elements[0].index).toBe(labeled.elements[0].index);
    expect(rotated.elements[1].index).toBe(labeled.elements[1].index);
    expect(labeled).toEqual(original);
    const history = new SceneHistory();
    history.commit(labeled);
    expect(history.undo(rotated)).toEqual(labeled);
  });

  it("refuses unsafe single-box core rotation with orphan external label references", () => {
    const box = createShape("rectangle", { x: 20, y: 30 }, { x: 250, y: 150 });
    const orphan = {
      ...createText({ x: 0, y: 0 }, "Missing reverse"),
      containerId: box.id,
    };
    const scene = { ...blankScene(), elements: [box, orphan] };
    expect(rotateNativeBoxWithCore(scene, box.id, { x: 400, y: 110 }))
      .toBe(scene);
    expect(scene.elements[0].angle).toBe(0);
  });

  it("does not core-resize a box with a foreign reverse reference to its label", () => {
    const box = createShape("rectangle", { x: 10, y: 20 }, { x: 250, y: 140 });
    const source = updateNativeBoxLabel(
      { ...blankScene(), elements: [box] },
      box.id,
      "Protected",
    );
    const label = source.elements[1];
    const foreign = {
      ...createShape("rectangle", { x: 400, y: 30 }, { x: 500, y: 150 }),
      boundElements: [{ id: label.id, type: "text" as const }],
    };
    const damaged = { ...source, elements: [...source.elements, foreign] };
    const previous = structuredClone(damaged);
    expect(resizeNativeBoxWithCore(
      damaged,
      box.id,
      "se",
      { x: 320, y: 200 },
    )).toBe(damaged);
    expect(damaged).toEqual(previous);
  });

  it("cleans up both reciprocal sides when deleting an arrow", () => {
    const left = createShape("rectangle", { x: 10, y: 10 }, { x: 110, y: 110 });
    const right = createShape("ellipse", { x: 210, y: 10 }, { x: 310, y: 110 });
    const arrow = createShape("arrow", { x: 110, y: 60 }, { x: 210, y: 60 });
    const original = appendNativeArrow(
      { ...blankScene(), elements: [left, right] },
      arrow,
      { x: 110, y: 60 },
      { x: 210, y: 60 },
    );
    const snapshot = structuredClone(original);
    const removed = deleteNativeElementsWithCore(original, new Set([arrow.id]));
    expect(removed.elements[2].isDeleted).toBe(true);
    expect(removed.elements[0].boundElements).toBeNull();
    expect(removed.elements[1].boundElements).toBeNull();
    expect(original).toEqual(snapshot);
    expect(deleteNativeElementsWithCore(original, new Set(["missing"]))).toBe(original);
  });

  it("detaches the deleted arrow target while preserving the opposite end", () => {
    const left = createShape("rectangle", { x: 10, y: 10 }, { x: 110, y: 110 });
    const right = createShape("rectangle", { x: 210, y: 10 }, { x: 310, y: 110 });
    const arrow = createShape("arrow", { x: 110, y: 60 }, { x: 210, y: 60 });
    const original = appendNativeArrow(
      { ...blankScene(), elements: [left, right] },
      arrow,
      { x: 110, y: 60 },
      { x: 210, y: 60 },
    );
    const removed = deleteNativeElementsWithCore(original, new Set([left.id]));
    expect(removed.elements[0].isDeleted).toBe(true);
    const surviving = removed.elements[2];
    expect(surviving.type).toBe("arrow");
    if (surviving.type === "arrow") {
      expect(surviving.startBinding).toBeNull();
      expect(surviving.endBinding?.elementId).toBe(right.id);
    }
    expect(removed.elements[1].boundElements?.[0].id).toBe(arrow.id);
    expect(original.elements[0].isDeleted).toBe(false);
  });

  it("cleans up a reciprocal label without deleting unrelated elements", () => {
    const box = createShape("rectangle", { x: 10, y: 10 }, { x: 220, y: 150 });
    const other = createShape("diamond", { x: 300, y: 10 }, { x: 400, y: 110 });
    const scene = updateNativeBoxLabel(
      { ...blankScene(), elements: [box, other] },
      box.id,
      "Caption",
    );
    const textId = scene.elements[2].id;
    const removed = deleteNativeElementsWithCore(scene, new Set([textId]));
    expect(removed.elements[2].isDeleted).toBe(true);
    expect(removed.elements[0].boundElements).toBeNull();
    expect(removed.elements[1]).toEqual(other);
    expect(scene.elements[0].boundElements?.[0].id).toBe(textId);
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
