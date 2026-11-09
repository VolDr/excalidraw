import { describe, expect, it } from "vitest";
import { blankScene, createShape } from "./scene";
import { nativeEraserHit, eraseNativeHits } from "./eraser";
import { groupSelection } from "./groups";
import { appendNativeArrow } from "./bindings";
import { updateNativeBoxLabel } from "./boundText";

describe("native eraser uses original binding-aware deletion", () => {
  it("erases a safe whole group rather than one child", () => {
    const a = createShape("rectangle", { x: 10, y: 10 }, { x: 130, y: 100 });
    const b = createShape("diamond", { x: 170, y: 10 }, { x: 300, y: 100 });
    const grouped = groupSelection({ ...blankScene(), elements: [a, b] }, [a.id, b.id]);
    expect(nativeEraserHit(grouped.scene, { x: 40, y: 30 }, 8)).toEqual([a.id, b.id]);
    const erased = eraseNativeHits(grouped.scene, [a.id, b.id]);
    expect(erased.elements.every((item) => item.isDeleted)).toBe(true);
    expect(grouped.scene.elements.every((item) => !item.isDeleted)).toBe(true);
  });

  it("uses core reciprocal cleanup when erasing a captioned bound box", () => {
    const a = createShape("rectangle", { x: 10, y: 10 }, { x: 180, y: 120 });
    const b = createShape("ellipse", { x: 320, y: 10 }, { x: 460, y: 140 });
    const labeled = updateNativeBoxLabel(
      { ...blankScene(), elements: [a, b] }, a.id, "caption",
    );
    const link = createShape("arrow", { x: 140, y: 60 }, { x: 340, y: 60 });
    const scene = appendNativeArrow(labeled, link, { x: 140, y: 60 }, { x: 340, y: 60 });
    const rootIds = nativeEraserHit(scene, { x: 28, y: 24 }, 8);
    expect(rootIds).toContain(a.id);
    const erased = eraseNativeHits(scene, rootIds);
    expect(erased.elements.find((el) => el.id === a.id)?.isDeleted).toBe(true);
    const text = erased.elements.find((el) => el.type === "text");
    expect(text?.isDeleted).toBe(true);
    const arrow = erased.elements.find((el) => el.type === "arrow");
    if (arrow?.type === "arrow") expect(arrow.startBinding).toBeNull();
  });
});
