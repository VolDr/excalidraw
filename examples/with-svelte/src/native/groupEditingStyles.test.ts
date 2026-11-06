import { describe, expect, it } from "vitest";
import { blankScene, createShape, createText } from "./scene";
import { groupSelection } from "./groups";
import { nativeStyleTarget, applyNativeStyle } from "./styles";
import { nativeTypographyTarget, applyNativeTypography } from "./textStyles";

describe("properties of independently editable nested group children", () => {
  const createNested = () => {
    const a = createShape("rectangle", { x: 15, y: 20 }, { x: 115, y: 120 });
    const b = createShape("ellipse", { x: 155, y: 20 }, { x: 260, y: 120 });
    const text = createText({ x: 320, y: 40 }, "Independent group text");
    const input = { ...blankScene(), elements: [a, b, text] };
    const inner = groupSelection(input, [a.id, b.id]);
    const outer = groupSelection(inner.scene, [a.id, b.id, text.id]);
    return { scene: outer.scene, a, b, text, inner: inner.groupId!, outer: outer.groupId! };
  };

  it("updates an inner rectangle only after entering its inner editing scope", () => {
    const { scene, a, b, inner } = createNested();
    expect(nativeStyleTarget(scene, a.id)).toBeNull();
    expect(nativeStyleTarget(scene, a.id, inner)?.id).toBe(a.id);
    const next = applyNativeStyle(scene, a.id, { key: "opacity", value: 50 }, inner);
    expect(next).not.toBe(scene);
    expect(next.elements.find((e) => e.id === a.id)?.opacity).toBe(50);
    expect(next.elements.find((e) => e.id === b.id)?.opacity).toBe(b.opacity);
    expect(next.elements.find((e) => e.id === a.id)?.groupIds)
      .toEqual(scene.elements.find((e) => e.id === a.id)?.groupIds);
    expect(applyNativeStyle(scene, a.id, { key: "opacity", value: 50 }))
      .toBe(scene);
  });

  it("resizes standalone text through original metrics inside the outer group", () => {
    const { scene, text, outer } = createNested();
    expect(nativeTypographyTarget(scene, text.id, outer)?.id).toBe(text.id);
    const changed = applyNativeTypography(
      scene, text.id, { key: "fontSize", value: 36 }, outer,
    );
    const after = changed.elements.find((e) => e.id === text.id);
    expect(after?.type).toBe("text");
    if (after?.type === "text") expect(after.fontSize).toBe(36);
    expect(changed.elements.find((e) => e.id === text.id)?.groupIds)
      .toEqual(scene.elements.find((e) => e.id === text.id)?.groupIds);
  });
});
