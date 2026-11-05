import { describe, expect, it } from "vitest";
import { FONT_FAMILY } from "@excalidraw/common";

import { blankScene, createShape, createText } from "./scene";
import { updateNativeBoxLabel } from "./boundText";
import { applyNativeTypography, nativeTypographyTarget } from "./textStyles";

describe("Svelte typography reuses core text layout", () => {
  it("updates font size and redraws bounds in an isolated core scene", () => {
    const text = createText({ x: 50, y: 70 }, "One\nTwo");
    const source = { ...blankScene(), elements: [text] };
    const changed = applyNativeTypography(source, text.id, {
      key: "fontSize", value: 36,
    });
    expect(changed).not.toBe(source);
    expect(changed.elements[0].type).toBe("text");
    if (changed.elements[0].type === "text") {
      expect(changed.elements[0].fontSize).toBe(36);
      expect(changed.elements[0].height).toBeGreaterThan(text.height);
      expect(changed.elements[0].version).toBeGreaterThan(text.version);
    }
    expect(source.elements[0]).toBe(text);
  });

  it("keeps original metadata, changes font family, and avoids needless updates", () => {
    const text = createText({ x: 10, y: 10 }, "Layout");
    const source = { ...blankScene(), elements: [text] };
    const next = applyNativeTypography(source, text.id, {
      key: "fontFamily", value: FONT_FAMILY.Helvetica,
    });
    expect(next.elements[0].type).toBe("text");
    if (next.elements[0].type === "text") {
      expect(next.elements[0].fontFamily).toBe(FONT_FAMILY.Helvetica);
      expect(next.elements[0].id).toBe(text.id);
      expect(next.elements[0].index).toBe(text.index);
    }
    expect(applyNativeTypography(next, text.id, {
      key: "fontFamily", value: FONT_FAMILY.Helvetica,
    })).toBe(next);
  });

  it("updates a reciprocal caption and keeps its container binding intact", () => {
    const box = createShape("rectangle", { x: 20, y: 20 }, { x: 180, y: 110 });
    const base = { ...blankScene(), elements: [box] };
    const labeled = updateNativeBoxLabel(base, box.id, "Title");
    const label = labeled.elements.find((element) => element.type === "text");
    expect(label?.type).toBe("text");
    expect(nativeTypographyTarget(labeled, box.id)?.id).toBe(label?.id);
    if (label?.type !== "text") return;

    const next = applyNativeTypography(labeled, box.id, {
      key: "fontSize", value: 36,
    });
    const updated = next.elements.find((element) => element.id === label.id);
    const container = next.elements.find((element) => element.id === box.id);
    expect(updated?.type).toBe("text");
    if (updated?.type === "text") {
      expect(updated.fontSize).toBe(36);
      expect(updated.containerId).toBe(box.id);
      expect(updated.version).toBeGreaterThan(label.version);
    }
    expect(container?.boundElements).toEqual(labeled.elements[0].boundElements);
    expect(labeled.elements.find((element) => element.id === label.id)).toBe(label);
  });

  it("rejects a caption when its reciprocal link is damaged", () => {
    const box = createShape("diamond", { x: 0, y: 0 }, { x: 160, y: 160 });
    const scene = updateNativeBoxLabel({ ...blankScene(), elements: [box] }, box.id, "Hello");
    const label = scene.elements.find((element) => element.type === "text");
    if (label?.type !== "text") return;
    const damaged = {
      ...scene,
      elements: scene.elements.map((element) =>
        element.id === label.id ? { ...element, containerId: "missing" } : element
      ),
    };
    expect(nativeTypographyTarget(damaged, box.id)).toBeNull();
    expect(applyNativeTypography(damaged, box.id, {
      key: "fontSize", value: 48,
    })).toBe(damaged);
  });

  it("guards bound labels, rotation and imported non-resizable text", () => {
    const text = createText({ x: 10, y: 10 }, "Unbound");
    const source = { ...blankScene(), elements: [text] };
    for (const variant of [
      { ...text, containerId: "box" },
      { ...text, angle: Math.PI / 4 },
      { ...text, autoResize: false },
      { ...text, locked: true },
    ]) {
      const scene = { ...source, elements: [variant as typeof text] };
      expect(nativeTypographyTarget(scene, text.id)).toBeNull();
      expect(applyNativeTypography(scene, text.id, { key: "fontSize", value: 36 })).toBe(scene);
    }
    expect(applyNativeTypography(source, text.id, { key: "fontSize", value: NaN })).toBe(source);
    expect(applyNativeTypography(source, text.id, { key: "fontSize", value: 10000 })).toBe(source);
  });
});
