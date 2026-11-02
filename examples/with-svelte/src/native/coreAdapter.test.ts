import {
  newArrowElement,
  newElement,
  newElementWith,
  newLinearElement,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";
import { describe, expect, it } from "vitest";

import type { LocalPoint } from "@excalidraw/math";

import { appendNativeArrow, isNativeLinkedArrow, nativeLinkedEndpoints } from "./bindings";
import { updateNativeBoxLabel } from "./boundText";
import { groupSelection } from "./groups";
import { SceneHistory } from "./history";
import {
  deleteNativeElementsWithCore,
  dragNativeSelectionWithCore,
  withNativeCoreScene,
  nativeElementsMap,
  updateNativeElement,
} from "./coreAdapter";
import { blankScene, createShape } from "./scene";
import { moveSelection } from "./transforms";

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
