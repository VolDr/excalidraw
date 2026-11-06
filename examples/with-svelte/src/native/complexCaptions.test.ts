import { describe, expect, it } from "vitest";
import { blankScene, createShape } from "./scene";
import { appendNativeArrow } from "./bindings";
import { updateNativeBoxLabel } from "./boundText";
import { groupSelection, safeGroupMembers } from "./groups";
import {
  nativeCompositeCaptionTarget,
  updateNativeCompositeCaption,
} from "./complexCaptions";

const composite = () => {
  const boxA = createShape("rectangle", { x: 10, y: 10 }, { x: 210, y: 130 });
  const boxB = createShape("ellipse", { x: 320, y: 10 }, { x: 450, y: 130 });
  const labeled = updateNativeBoxLabel(
    { ...blankScene(), elements: [boxA, boxB] },
    boxA.id, "Initial label",
  );
  const arrow = createShape("arrow", { x: 170, y: 55 }, { x: 350, y: 55 });
  const linked = appendNativeArrow(
    labeled, arrow, { x: 170, y: 55 }, { x: 350, y: 55 },
  );
  const link = linked.elements.find((e) => e.type === "arrow");
  if (link?.type !== "arrow" || !link.startBinding || !link.endBinding) {
    throw new Error("fixture requires reciprocal core binding");
  }
  const group = groupSelection(linked, [boxA.id, boxB.id, link.id]);
  if (!group.groupId) throw new Error("fixture requires closed group");
  return { scene: group.scene, boxA, boxB, link, groupId: group.groupId };
};

describe("closed composite captions use the original text and arrow core", () => {
  it("edits the caption, retains arrow link targets and updates core versioning", () => {
    const { scene, boxA, link, groupId } = composite();
    const oldText = nativeCompositeCaptionTarget(scene, boxA.id)!;
    const updated = updateNativeCompositeCaption(
      scene, boxA.id, "Longer caption\nwith a second line",
    );
    expect(updated).not.toBe(scene);
    const text = nativeCompositeCaptionTarget(updated, boxA.id)!;
    const arrow = updated.elements.find((e) => e.id === link.id);
    expect(text.id).toBe(oldText.id);
    expect(text.originalText).toBe("Longer caption\nwith a second line");
    expect(text.version).toBeGreaterThan(oldText.version);
    expect(arrow?.type).toBe("arrow");
    if (arrow?.type === "arrow") {
      expect(arrow.startBinding?.elementId).toBe(boxA.id);
    }
    expect(updated.elements[0].boundElements).toEqual(scene.elements[0].boundElements);
    expect(safeGroupMembers(updated, groupId)).toHaveLength(4);
    expect(scene.elements.find((e) => e.id === oldText.id)).toBe(oldText);
  });

  it("rejects missing group closure and blank text without mutating the source", () => {
    const { scene, boxA, link } = composite();
    expect(updateNativeCompositeCaption(scene, boxA.id, "")).toBe(scene);
    const broken = {
      ...scene,
      elements: scene.elements.map((element) =>
        element.id === link.id ? { ...element, locked: true } : element,
      ),
    };
    expect(nativeCompositeCaptionTarget(broken, boxA.id)).toBeNull();
    expect(updateNativeCompositeCaption(broken, boxA.id, "No")).toBe(broken);
  });
});
