import { describe, expect, it } from "vitest";
import { FONT_FAMILY } from "@excalidraw/common";

import { blankScene, createText } from "./scene";
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
