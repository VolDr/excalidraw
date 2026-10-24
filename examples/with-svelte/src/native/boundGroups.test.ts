import { describe, expect, it } from "vitest";

import { appendNativeArrow } from "./bindings";
import {
  nativeBoundLabelLayout,
  nativeEditableLabel,
  nativeLabelBox,
  updateNativeBoxLabel,
} from "./boundText";
import {
  editableSelection,
  groupSelection,
  safeGroupMembers,
  selectionUnit,
  ungroupSelection,
} from "./groups";
import { SceneHistory } from "./history";
import {
  blankScene,
  createShape,
  parseScene,
  serializeScene,
} from "./scene";
import { duplicateSelection, elementsInMarquee } from "./selection";
import {
  deleteSelection,
  moveSelection,
  transformSelected,
} from "./transforms";

const labeledPair = () => {
  const box = createShape("rectangle", { x: 20, y: 30 }, { x: 220, y: 150 });
  const other = createShape("ellipse", { x: 300, y: 60 }, { x: 410, y: 190 });
  const scene = updateNativeBoxLabel(
    { ...blankScene(), elements: [box, other] },
    box.id,
    "One label\nTwo lines",
  );
  return { box, other, label: scene.elements[2], scene };
};

describe("atomic Svelte bound-text groups", () => {
  it("groups two roots and an internal label without exposing the label as a selection root", () => {
    const { box, other, label, scene } = labeledPair();
    const grouped = groupSelection(scene, [box.id, other.id]);
    const id = grouped.groupId!;
    expect(id).toBeTruthy();
    expect(grouped.ids).toEqual([box.id, other.id]);
    expect(grouped.scene.elements.map((element) => element.groupIds)).toEqual([
      [id],
      [id],
      [id],
    ]);
    expect(safeGroupMembers(grouped.scene, id)).toHaveLength(3);
    expect(nativeLabelBox(grouped.scene, grouped.scene.elements[2])?.id).toBe(
      box.id,
    );
    expect(nativeEditableLabel(grouped.scene, grouped.scene.elements[0])?.id).toBe(
      label.id,
    );
    expect(selectionUnit(grouped.scene, box.id)).toEqual([box.id, other.id]);
    expect(selectionUnit(grouped.scene, other.id)).toEqual([box.id, other.id]);
    expect(selectionUnit(grouped.scene, label.id)).toEqual([box.id, other.id]);
    expect(editableSelection(grouped.scene, [box.id])).toEqual([]);
    expect(editableSelection(grouped.scene, [box.id, other.id])).toEqual([
      box.id,
      other.id,
    ]);
    expect(
      elementsInMarquee(
        grouped.scene,
        { x: 10, y: 20 },
        { x: 120, y: 110 },
      ),
    ).toEqual([box.id, other.id]);
    expect(
      elementsInMarquee(
        grouped.scene,
        { x: 120, y: 110 },
        { x: 10, y: 20 },
      ),
    ).toEqual([]);
  });

  it("moves, edits, deletes and ungroups a reciprocal label atomically", () => {
    const { box, other, label, scene } = labeledPair();
    const grouped = groupSelection(scene, [box.id, other.id]).scene;
    const before = nativeBoundLabelLayout(grouped, grouped.elements[2])!;
    const moved = moveSelection(grouped, [box.id, other.id], 37, -16);
    const after = moved.elements[2];
    expect(after.x).toBeCloseTo(before.x + 37);
    expect(after.y).toBeCloseTo(before.y - 16);
    expect(after.groupIds).toEqual(grouped.elements[0].groupIds);
    expect(after.type).toBe("text");
    if (after.type !== "text") {
      return;
    }
    expect(after.originalText).toBe("One label\nTwo lines");
    expect(after.containerId).toBe(box.id);

    const edited = updateNativeBoxLabel(moved, box.id, "Changed group label");
    expect(edited.elements[2].id).toBe(label.id);
    expect(
      edited.elements[2].type === "text" &&
        edited.elements[2].originalText,
    ).toBe("Changed group label");
    expect(edited.elements[2].groupIds).toEqual(
      edited.elements[0].groupIds,
    );
    expect(moveSelection(grouped, [box.id], 5, 0)).toBe(grouped);
    expect(deleteSelection(grouped, [box.id])).toBe(grouped);
    expect(ungroupSelection(grouped, [box.id]).scene).toBe(grouped);

    const ungrouped = ungroupSelection(edited, [box.id, other.id]);
    expect(ungrouped.ids).toEqual([box.id, other.id]);
    expect(ungrouped.scene.elements.every((element) => !element.groupIds.length))
      .toBe(true);
    expect(nativeLabelBox(ungrouped.scene, ungrouped.scene.elements[2])?.id)
      .toBe(box.id);
    const deleted = deleteSelection(grouped, [box.id, other.id]);
    expect(deleted.elements.every((element) => element.isDeleted)).toBe(true);
    expect(scene.elements.every((element) => !element.isDeleted)).toBe(true);
  });

  it("duplicates the entire group with fresh IDs and no reference to originals", () => {
    const { box, other, label, scene } = labeledPair();
    scene.files = { image1: { dataURL: "data:image/png;base64,AAAA" } };
    scene.appState = { gridSize: 20 };
    const grouped = groupSelection(scene, [box.id, other.id]).scene;
    expect(duplicateSelection(grouped, [box.id]).scene).toBe(grouped);
    const result = duplicateSelection(grouped, [box.id, other.id]);
    const [copyBox, copyOther, copyLabel] = result.scene.elements.slice(3);
    expect(result.scene.elements).toHaveLength(6);
    expect(result.ids).toEqual([copyBox.id, copyOther.id]);
    expect(copyBox.id).not.toBe(box.id);
    expect(copyLabel.id).not.toBe(label.id);
    expect(copyBox.groupIds).toEqual(copyOther.groupIds);
    expect(copyBox.groupIds).toEqual(copyLabel.groupIds);
    expect(copyBox.groupIds[0]).not.toBe(grouped.elements[0].groupIds[0]);
    expect(copyBox.boundElements).toEqual([
      { id: copyLabel.id, type: "text" },
    ]);
    expect(copyLabel.type).toBe("text");
    if (copyLabel.type === "text") {
      expect(copyLabel.containerId).toBe(copyBox.id);
      expect(copyLabel.originalText).toBe("One label\nTwo lines");
    }
    expect(nativeLabelBox(result.scene, copyLabel)?.id).toBe(copyBox.id);
    expect(result.scene.files).toEqual(grouped.files);
    expect(result.scene.appState).toEqual(grouped.appState);
    expect(result.scene.elements[0].boundElements).toEqual([
      { id: label.id, type: "text" },
    ]);
    expect(parseScene(serializeScene(result.scene))).toEqual(result.scene);
  });

  it("keeps labels correct after ungrouping, resizing and rotating, with undo/redo", () => {
    const { box, other, scene } = labeledPair();
    const history = new SceneHistory();
    const grouped = groupSelection(scene, [box.id, other.id]).scene;
    history.commit(scene);
    expect(history.undo(grouped)).toEqual(scene);
    expect(history.redo(scene)).toEqual(grouped);

    // Individual resize handles intentionally stay disabled while grouped.
    expect(
      transformSelected(grouped, box.id, "rotate", { x: 300, y: 150 }),
    ).toEqual(grouped);

    const ungrouped = ungroupSelection(grouped, [box.id, other.id]).scene;
    const resized = transformSelected(ungrouped, box.id, "se", {
      x: 270,
      y: 210,
    });
    const rotated = transformSelected(resized, box.id, "rotate", {
      x: 340,
      y: 130,
    });
    const container = rotated.elements[0];
    const label = rotated.elements[2];
    expect(container.angle).not.toBe(0);
    expect(label.angle).toBeCloseTo(container.angle);
    expect(label.x + label.width / 2).toBeCloseTo(
      container.x + container.width / 2,
    );
    expect(label.y + label.height / 2).toBeCloseTo(
      container.y + container.height / 2,
    );
    expect(nativeBoundLabelLayout(rotated, label)).not.toBeNull();
    expect(parseScene(serializeScene(rotated))).toEqual(rotated);
  });

  it("refuses to change incompatible, partially grouped and foreign bindings", () => {
    const { box, other, label, scene } = labeledPair();
    const grouped = groupSelection(scene, [box.id, other.id]).scene;
    const mismatched = {
      ...grouped,
      elements: grouped.elements.map((element) =>
        element.id === label.id ? { ...element, groupIds: [] } : element,
      ),
    };
    const id = grouped.elements[0].groupIds[0];
    expect(safeGroupMembers(mismatched, id)).toEqual([]);
    expect(selectionUnit(mismatched, box.id)).toEqual([]);
    expect(editableSelection(mismatched, [box.id, other.id])).toEqual([]);
    expect(duplicateSelection(mismatched, [box.id, other.id]).scene).toBe(
      mismatched,
    );
    expect(moveSelection(mismatched, [box.id, other.id], 10, 20)).toBe(
      mismatched,
    );
    expect(ungroupSelection(mismatched, [box.id, other.id]).scene).toBe(
      mismatched,
    );
    expect(deleteSelection(mismatched, [box.id, other.id])).toBe(mismatched);
    expect(parseScene(serializeScene(mismatched))).toEqual(mismatched);

    const outsider = {
      ...scene,
      elements: [
        scene.elements[0],
        scene.elements[1],
        { ...label, groupIds: ["external"] },
      ],
    };
    expect(groupSelection(outsider, [box.id, other.id]).scene).toBe(outsider);
    const extra = {
      ...scene,
      elements: [
        ...scene.elements,
        { ...label, id: crypto.randomUUID() },
      ],
    };
    expect(nativeLabelBox(extra, label)).toBeNull();
    expect(groupSelection(extra, [box.id, other.id]).scene).toBe(extra);

    const orphan = {
      ...scene,
      elements: [{ ...box, boundElements: null }, other, label],
    };
    expect(selectionUnit(orphan, box.id)).toEqual([]);
    expect(moveSelection(orphan, [box.id], 8, 8)).toBe(orphan);
    expect(duplicateSelection(orphan, [box.id]).scene).toBe(orphan);
    expect(groupSelection(orphan, [box.id, other.id]).scene).toBe(orphan);

    const arrow = createShape("arrow", { x: 80, y: 75 }, { x: 500, y: 180 });
    const attached = appendNativeArrow(
      scene,
      arrow,
      { x: 80, y: 75 },
      { x: 500, y: 180 },
    );
    // Simulate a foreign arrow whose reverse reference is missing.
    const hiddenArrow = {
      ...attached,
      elements: attached.elements.map((element) =>
        element.id === box.id
          ? { ...element, boundElements: [{ id: label.id, type: "text" as const }] }
          : element,
      ),
    };
    expect(nativeLabelBox(hiddenArrow, label)).toBeNull();
    expect(groupSelection(hiddenArrow, [box.id, other.id]).scene).toBe(
      hiddenArrow,
    );
  });
});
