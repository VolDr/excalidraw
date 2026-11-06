import { describe, expect, it } from "vitest";
import { blankScene, createShape } from "./scene";
import { groupSelection } from "./groups";
import { updateNativeBoxLabel } from "./boundText";
import { appendNativeArrow } from "./bindings";
import { canTransformNativeInnerBox, transformNativeInnerBoxWithCore } from "./innerElementTransforms";

describe("transforming one box inside a validated closed group", () => {
  const linked = () => {
    const a = createShape("rectangle", { x: 20, y: 20 }, { x: 230, y: 150 });
    const b = createShape("ellipse", { x: 350, y: 10 }, { x: 500, y: 150 });
    const labeled = updateNativeBoxLabel(
      { ...blankScene(), elements: [a, b] }, a.id, "Bound caption",
    );
    const arrow = createShape("arrow", { x: 190, y: 70 }, { x: 390, y: 70 });
    const source = appendNativeArrow(labeled, arrow, { x: 190, y: 70 }, { x: 390, y: 70 });
    const link = source.elements.find((item) => item.type === "arrow");
    if (link?.type !== "arrow" || !link.startBinding || !link.endBinding) {
      throw new Error("Requires original reciprocal core links");
    }
    const group = groupSelection(source, [a.id, b.id, link.id]);
    if (!group.groupId) throw new Error("Requires complete linked group");
    return { scene: group.scene, a, b, link, groupId: group.groupId };
  };

  it("resizes an inner captioned box while keeping arrow target IDs", () => {
    const { scene, a, b, link, groupId } = linked();
    expect(canTransformNativeInnerBox(scene, a.id, groupId)).toBe(true);
    const next = transformNativeInnerBoxWithCore(
      scene, a.id, groupId, "se",
      { x: a.x + a.width + 80, y: a.y + a.height + 50 },
    );
    expect(next).not.toBe(scene);
    expect(next.elements.find((element) => element.id === a.id)?.width).toBeGreaterThan(a.width);
    expect(next.elements.find((element) => element.id === b.id))
      .toBe(scene.elements.find((element) => element.id === b.id));
    const connected = next.elements.find((element) => element.id === link.id);
    expect(connected?.type === "arrow" && connected.startBinding?.elementId).toBe(a.id);
    const caption = next.elements.find((element) => element.type === "text");
    expect(caption?.type === "text" && caption.containerId).toBe(a.id);
  });

  it("rotates a box within its selected parent group", () => {
    const { scene, a, link, groupId } = linked();
    const center = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    const next = transformNativeInnerBoxWithCore(
      scene, a.id, groupId, "rotate", { x: center.x + 100, y: center.y },
    );
    expect(next).not.toBe(scene);
    expect(next.elements.find((element) => element.id === a.id)?.angle)
      .toBeCloseTo(Math.PI / 2);
    const arrow = next.elements.find((element) => element.id === link.id);
    expect(arrow?.type === "arrow" && arrow.startBinding?.elementId).toBe(a.id);
  });
});
