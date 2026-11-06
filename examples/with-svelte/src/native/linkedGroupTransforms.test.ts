import { describe, expect, it } from "vitest";
import { blankScene, createShape } from "./scene";
import { appendNativeArrow } from "./bindings";
import { groupSelection, safeGroupMembers } from "./groups";
import { transformableGroup, transformGroup } from "./groupTransforms";

describe("core transform of linked ordinary arrow groups", () => {
  it("resizes two bound boxes and one two-point arrow as a closed unit", () => {
    const a = createShape("rectangle", { x: 20, y: 10 }, { x: 160, y: 130 });
    const b = createShape("ellipse", { x: 330, y: 20 }, { x: 480, y: 140 });
    const arrow = createShape("arrow", { x: 130, y: 70 }, { x: 355, y: 70 });
    const connected = appendNativeArrow(
      { ...blankScene(), elements: [a, b] },
      arrow, { x: 130, y: 70 }, { x: 355, y: 70 },
    );
    const link = connected.elements.find((element) => element.type === "arrow");
    if (link?.type !== "arrow" || !link.startBinding || !link.endBinding) {
      throw Error("Fixture requires original reciprocal links");
    }
    const ids = [a.id, b.id, link.id];
    const group = groupSelection(connected, ids);
    expect(group.groupId).not.toBeNull();
    const bounds = transformableGroup(group.scene, ids)?.bounds;
    expect(bounds).toBeDefined();
    const resized = transformGroup(group.scene, ids, "se", {
      x: bounds!.x + bounds!.width * 1.3,
      y: bounds!.y + bounds!.height * 1.3,
    });
    expect(resized).not.toBe(group.scene);
    const result = resized.elements.find((item) => item.id === link.id);
    expect(result?.type === "arrow" && result.startBinding?.elementId).toBe(a.id);
    expect(result?.type === "arrow" && result.endBinding?.elementId).toBe(b.id);
    expect(safeGroupMembers(resized, group.groupId!)).toHaveLength(3);
    const center = {
      x: bounds!.x + bounds!.width / 2,
      y: bounds!.y + bounds!.height / 2,
    };
    const rotated = transformGroup(group.scene, ids, "rotate", {
      x: center.x + 150, y: center.y,
    });
    expect(rotated).not.toBe(group.scene);
    expect(safeGroupMembers(rotated, group.groupId!)).toHaveLength(3);
    const rotatedBounds = transformableGroup(rotated, ids)?.bounds;
    expect(rotatedBounds).toBeDefined();
    const scaledAgain = transformGroup(rotated, ids, "se", {
      x: rotatedBounds!.x + rotatedBounds!.width * 1.1,
      y: rotatedBounds!.y + rotatedBounds!.height * 1.1,
    });
    // Rotated multi-selection uses the same original bounding-box algorithm.
    expect(scaledAgain).not.toBe(rotated);
    expect(safeGroupMembers(scaledAgain, group.groupId!)).toHaveLength(3);
  });

  it("supports a fully selected group with one connected arrow end", () => {
    const box = createShape("rectangle", { x: 30, y: 10 }, { x: 150, y: 130 });
    const arrow = createShape("arrow", { x: 110, y: 70 }, { x: 280, y: 120 });
    const original = appendNativeArrow(
      { ...blankScene(), elements: [box] },
      arrow, { x: 110, y: 70 }, { x: 280, y: 120 },
    );
    const link = original.elements.find((item) => item.type === "arrow");
    if (link?.type !== "arrow" || !link.startBinding || link.endBinding) {
      throw Error("Fixture requires one-ended binding");
    }
    const ids = [box.id, link.id];
    const group = groupSelection(original, ids);
    expect(group.groupId).not.toBeNull();
    expect(transformableGroup(group.scene, ids)).not.toBeNull();
    const bounds = transformableGroup(group.scene, ids)!.bounds;
    const scaled = transformGroup(group.scene, ids, "se", {
      x: bounds.x + bounds.width * 1.2,
      y: bounds.y + bounds.height * 1.2,
    });
    expect(scaled).not.toBe(group.scene);
    const after = scaled.elements.find((item) => item.id === link.id);
    expect(after?.type === "arrow" && after.startBinding?.elementId).toBe(box.id);
    expect(after?.type === "arrow" && !after.endBinding).toBe(true);
    expect(safeGroupMembers(scaled, group.groupId!)).toHaveLength(2);
  });
});
