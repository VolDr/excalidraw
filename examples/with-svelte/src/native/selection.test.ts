import { describe, expect, it } from "vitest";

import {
  nativeEditableLabel,
  nativeLabelBox,
  updateNativeBoxLabel,
} from "./boundText";
import { groupSelection, safeGroupMembers } from "./groups";
import { appendNativeArrow } from "./bindings";
import {
  blankScene,
  createShape,
  createText,
  parseScene,
  serializeScene,
} from "./scene";
import {
  duplicateSelection,
  elementsInMarquee,
  rectangleBetween,
  visualBounds,
} from "./selection";
import { deleteSelection } from "./transforms";

describe("native marquee and duplication", () => {
  it("duplicates a bound box and its label with fresh reciprocal IDs", () => {
    const box = createShape("rectangle", { x: 10, y: 20 }, { x: 220, y: 120 });
    const scene = updateNativeBoxLabel(
      { ...blankScene(), elements: [box] },
      box.id,
      "Linked\ntext",
    );
    const sourceLabel = scene.elements[1];
    const result = duplicateSelection(scene, [box.id]);
    expect(result.ids).toHaveLength(1);
    expect(result.scene.elements).toHaveLength(4);
    const [copiedBox, copiedLabel] = result.scene.elements.slice(2);
    expect(copiedBox.id).not.toBe(box.id);
    expect(copiedLabel.id).not.toBe(sourceLabel.id);
    expect(copiedBox.boundElements).toEqual([
      { id: copiedLabel.id, type: "text" },
    ]);
    expect(copiedLabel.type).toBe("text");
    if (copiedLabel.type !== "text") {
      return;
    }
    expect(copiedLabel.containerId).toBe(copiedBox.id);
    expect(copiedLabel.originalText).toBe("Linked\ntext");
    expect(copiedLabel.x - sourceLabel.x).toBe(24);
    expect(copiedLabel.y - sourceLabel.y).toBe(24);
    expect(nativeLabelBox(result.scene, copiedLabel)?.id).toBe(copiedBox.id);
    expect(nativeEditableLabel(result.scene, copiedBox)?.id).toBe(
      copiedLabel.id,
    );
    expect(result.ids).toEqual([copiedBox.id]);
    expect(parseScene(serializeScene(result.scene))).toEqual(result.scene);
    expect(scene.elements[0].boundElements?.[0].id).toBe(sourceLabel.id);

    const removed = deleteSelection(result.scene, result.ids);
    expect(removed.elements[2].isDeleted).toBe(true);
    expect(removed.elements[3].isDeleted).toBe(true);
    expect(removed.elements[0].isDeleted).toBe(false);
    expect(removed.elements[1].isDeleted).toBe(false);
    expect(nativeLabelBox(removed, removed.elements[1])?.id).toBe(box.id);
  });

  it("does not duplicate malformed box bindings, mixed arrow links or locked labels", () => {
    const box = createShape("ellipse", { x: 0, y: 0 }, { x: 180, y: 120 });
    const scene = updateNativeBoxLabel(
      { ...blankScene(), elements: [box] },
      box.id,
      "Guarded label",
    );
    const label = scene.elements[1];
    const invalid = [
      {
        ...scene,
        elements: [
          {
            ...scene.elements[0],
            boundElements: [
              { id: label.id, type: "text" as const },
              { id: "arrow-id", type: "arrow" as const },
            ],
          },
          label,
        ],
      },
      {
        ...scene,
        elements: [scene.elements[0], { ...label, locked: true }],
      },
      {
        ...scene,
        elements: [scene.elements[0], { ...label, groupIds: ["g"] }],
      },
    ];
    for (const imported of invalid) {
      const result = duplicateSelection(imported, [box.id]);
      expect(result.scene).toBe(imported);
      expect(result.ids).toEqual([]);
    }
  });

  it("duplicates multiple labeled and standalone shapes in document order", () => {
    const box = createShape("diamond", { x: 20, y: 20 }, { x: 220, y: 180 });
    const other = createShape(
      "rectangle",
      { x: 300, y: 20 },
      { x: 380, y: 110 },
    );
    const linked = updateNativeBoxLabel(
      { ...blankScene(), elements: [box, other] },
      box.id,
      "Text",
    );
    const result = duplicateSelection(linked, [other.id, box.id], 16);
    expect(result.ids).toHaveLength(2);
    expect(result.scene.elements).toHaveLength(6);
    const [copyBox, copyOther, copyText] = result.scene.elements.slice(3);
    expect(result.ids).toEqual([copyBox.id, copyOther.id]);
    expect(copyBox.boundElements?.[0].id).toBe(copyText.id);
    expect(copyText.type).toBe("text");
    if (copyText.type === "text") {
      expect(copyText.containerId).toBe(copyBox.id);
    }
    expect(copyOther.x).toBe(other.x + 16);
  });

  it("marquee selects whole groups on intersection and requires full enclosure in reverse", () => {
    const a = createShape("rectangle", { x: 0, y: 0 }, { x: 20, y: 20 });
    const b = createShape("rectangle", { x: 100, y: 100 }, { x: 120, y: 120 });
    const grouped = groupSelection({ ...blankScene(), elements: [a, b] }, [
      a.id,
      b.id,
    ]);
    expect(
      elementsInMarquee(grouped.scene, { x: -5, y: -5 }, { x: 25, y: 25 }),
    ).toEqual([a.id, b.id]);
    expect(
      elementsInMarquee(grouped.scene, { x: 25, y: 25 }, { x: -5, y: -5 }),
    ).toEqual([]);
  });

  it("duplicates an entire flat group with a fresh shared group ID", () => {
    const a = createShape("rectangle", { x: 10, y: 20 }, { x: 50, y: 60 });
    const b = createShape("ellipse", { x: 100, y: 110 }, { x: 150, y: 170 });
    const grouped = groupSelection({ ...blankScene(), elements: [a, b] }, [
      a.id,
      b.id,
    ]);
    const originalGroupId = grouped.groupId!;
    expect(duplicateSelection(grouped.scene, [a.id]).scene).toBe(grouped.scene);
    const duplicated = duplicateSelection(grouped.scene, [a.id, b.id]);
    expect(duplicated.ids).toHaveLength(2);
    const [copyA, copyB] = duplicated.scene.elements.slice(2);
    expect(copyA.groupIds).toHaveLength(1);
    expect(copyA.groupIds).toEqual(copyB.groupIds);
    expect(copyA.groupIds[0]).not.toBe(originalGroupId);
    expect(copyA.id).not.toBe(a.id);
    expect(copyB.x).toBe(124);
    expect(duplicated.scene.elements[0].groupIds).toEqual([originalGroupId]);
  });

  it("duplicates nested groups with fresh IDs for every ancestry level and reciprocal text", () => {
    const a = createShape("rectangle", { x: 20, y: 20 }, { x: 190, y: 120 });
    const b = createShape("ellipse", { x: 220, y: 20 }, { x: 300, y: 100 });
    const c = createShape("diamond", { x: 360, y: 20 }, { x: 440, y: 140 });
    const base = updateNativeBoxLabel(
      { ...blankScene(), elements: [a, b, c] },
      a.id,
      "nested caption",
    );
    const inner = groupSelection(base, [a.id, b.id]);
    const outer = groupSelection(inner.scene, [a.id, b.id, c.id]);
    expect(outer.groupId).toBeTruthy();
    const originals = outer.scene.elements;
    expect(duplicateSelection(outer.scene, [a.id, b.id]).scene).toBe(outer.scene);
    const copied = duplicateSelection(outer.scene, [a.id, b.id, c.id], 30);
    expect(copied.ids).toHaveLength(3);
    expect(copied.scene.elements).toHaveLength(originals.length * 2);
    const duplicated = copied.scene.elements.slice(originals.length);
    const copyByType = new Map(copied.ids.map((id) => [
      id,
      copied.scene.elements.find((element) => element.id === id)!,
    ]));
    const copiedBox = [...copyByType.values()].find((e) => e.type === "rectangle")!;
    const copiedEllipse = [...copyByType.values()].find((e) => e.type === "ellipse")!;
    const copiedDiamond = [...copyByType.values()].find((e) => e.type === "diamond")!;
    const copiedText = duplicated.find((e) => e.type === "text")!;
    expect(copiedBox.groupIds).toHaveLength(2);
    expect(copiedBox.groupIds).toEqual(copiedEllipse.groupIds);
    expect(copiedDiamond.groupIds).toEqual([copiedBox.groupIds[1]]);
    expect(copiedBox.groupIds).not.toContain(inner.groupId);
    expect(copiedBox.groupIds).not.toContain(outer.groupId);
    expect(copiedText.groupIds).toEqual(copiedBox.groupIds);
    expect(copiedBox.boundElements?.[0].id).toBe(copiedText.id);
    expect(copiedText.type === "text" && copiedText.containerId).toBe(copiedBox.id);
    expect(copiedBox.x).toBe(a.x + 30);
    expect(originals[0].id).toBe(a.id);
  });

  it("duplicates a closed linked group using the original reciprocal remapper", () => {
    const boxA = createShape("rectangle", { x: 10, y: 10 }, { x: 120, y: 110 });
    const boxB = createShape("diamond", { x: 250, y: 10 }, { x: 380, y: 130 });
    const plain = { ...blankScene(), elements: [boxA, boxB] };
    const arrow = createShape("arrow", { x: 90, y: 55 }, { x: 280, y: 55 });
    const linked = appendNativeArrow(plain, arrow, { x: 90, y: 55 }, { x: 280, y: 55 });
    const link = linked.elements.find((e) => e.type === "arrow");
    expect(link?.type).toBe("arrow");
    if (link?.type !== "arrow") return;
    const group = groupSelection(linked, [boxA.id, boxB.id, link.id]);
    expect(group.groupId).toBeTruthy();
    const copied = duplicateSelection(group.scene, [boxA.id, boxB.id, link.id]);
    expect(copied.ids).toHaveLength(3);
    const next = copied.scene.elements.slice(group.scene.elements.length);
    expect(next).toHaveLength(3);
    const copiedArrow = next.find((e) => e.type === "arrow");
    expect(copiedArrow?.type).toBe("arrow");
    if (copiedArrow?.type !== "arrow") return;
    const [nextA, nextB] = next.filter((e) => e.type !== "arrow");
    expect(copiedArrow.startBinding?.elementId).toBe(nextA.id);
    expect(copiedArrow.endBinding?.elementId).toBe(nextB.id);
    expect(nextA.boundElements?.some((ref) => ref.id === copiedArrow.id)).toBe(true);
    expect(nextB.boundElements?.some((ref) => ref.id === copiedArrow.id)).toBe(true);
    expect(safeGroupMembers(copied.scene, copiedArrow.groupIds.at(-1)!)).toHaveLength(3);
    expect(group.scene.elements[0].boundElements?.[0].id).toBe(link.id);
  });

  it("supports rectangle direction and partly intersected elements", () => {
    const inside = createShape("rectangle", { x: 10, y: 10 }, { x: 30, y: 30 });
    const crossing = createShape("ellipse", { x: 40, y: 40 }, { x: 70, y: 70 });
    const outside = createShape(
      "diamond",
      { x: 95, y: 95 },
      { x: 120, y: 120 },
    );
    const scene = { ...blankScene(), elements: [inside, crossing, outside] };
    expect(rectangleBetween({ x: 55, y: 55 }, { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 55,
      height: 55,
    });
    expect(elementsInMarquee(scene, { x: 0, y: 0 }, { x: 55, y: 55 })).toEqual([
      inside.id,
      crossing.id,
    ]);
    expect(elementsInMarquee(scene, { x: 55, y: 55 }, { x: 0, y: 0 })).toEqual([
      inside.id,
    ]);
  });

  it("uses rotated world bounds and refuses to select bound elements", () => {
    const rect = createShape("rectangle", { x: 0, y: 0 }, { x: 100, y: 20 });
    const rotated = { ...rect, angle: (Math.PI / 2) as typeof rect.angle };
    const bounds = visualBounds(rotated);
    expect(bounds.width).toBeCloseTo(20);
    expect(bounds.height).toBeCloseTo(100);
    const locked = { ...rect, id: crypto.randomUUID(), locked: true };
    const bound = {
      ...rect,
      id: crypto.randomUUID(),
      boundElements: [{ id: "a", type: "text" as const }],
    };
    const scene = { ...blankScene(), elements: [rotated, locked, bound] };
    expect(
      elementsInMarquee(scene, { x: 30, y: -50 }, { x: 70, y: 70 }),
    ).toEqual([rotated.id]);
  });

  it("duplicates standalone elements and preserves identity of originals", () => {
    const rect = createShape("rectangle", { x: 3, y: 4 }, { x: 25, y: 30 });
    const text = createText({ x: 40, y: 50 }, "Hello");
    const locked = {
      ...createShape("rectangle", { x: 0, y: 0 }, { x: 10, y: 10 }),
      locked: true,
    };
    const scene = { ...blankScene(), elements: [rect, text, locked] };
    const result = duplicateSelection(scene, [rect.id, text.id, locked.id]);
    expect(result.ids).toHaveLength(2);
    expect(result.scene.elements).toHaveLength(5);
    expect(result.scene.elements[0]).toEqual(rect);
    expect(result.scene.elements[3].id).not.toEqual(rect.id);
    expect(result.scene.elements[3].x).toBe(27);
    expect(result.scene.elements[4].y).toBe(74);
    expect(result.scene.elements[3].version).toBe(1);
    expect(result.scene.elements[3].index).toBeNull();
    expect(duplicateSelection(scene, [locked.id]).scene).toBe(scene);
  });
});
