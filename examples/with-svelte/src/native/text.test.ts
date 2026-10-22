import { getFontString, getVerticalOffset } from "@excalidraw/common";
import { describe, expect, it, vi } from "vitest";

import { blankScene, createText, replaceText } from "./scene";
import { paintNativeText, textDrawLines } from "./text";

describe("native text parity", () => {
  it("honors Excalidraw multiline baseline, alignment and font settings", () => {
    const original = createText({ x: 30, y: 40 }, "Hello\nWorld");
    const text = {
      ...original,
      fontSize: 24,
      lineHeight: 1.25 as typeof original.lineHeight,
      textAlign: "center" as const,
      width: 200,
      opacity: 45,
    };
    const rows = textDrawLines(text);
    const offset = getVerticalOffset(
      text.fontFamily,
      text.fontSize,
      text.fontSize * text.lineHeight,
    );
    expect(rows).toEqual([
      { text: "Hello", x: 100, y: offset },
      { text: "World", x: 100, y: offset + 30 },
    ]);

    const ctx = document.createElement("canvas").getContext("2d")!;
    const state: Array<{
      font: string;
      align: string;
      baseline: string;
      alpha: number;
    }> = [];
    const draw = vi.spyOn(ctx, "fillText").mockImplementation(() => {
      state.push({
        font: ctx.font.replace(/"/g, ""),
        align: ctx.textAlign,
        baseline: ctx.textBaseline,
        alpha: ctx.globalAlpha,
      });
    });
    const save = vi.spyOn(ctx, "save");
    const restore = vi.spyOn(ctx, "restore");
    paintNativeText(ctx, text, "#123456");
    expect(draw).toHaveBeenNthCalledWith(1, "Hello", 130, 40 + offset);
    expect(draw).toHaveBeenNthCalledWith(2, "World", 130, 70 + offset);
    expect(state).toEqual([
      {
        font: getFontString(text),
        align: "center",
        baseline: "alphabetic",
        alpha: 1,
      },
      {
        font: getFontString(text),
        align: "center",
        baseline: "alphabetic",
        alpha: 1,
      },
    ]);
    expect(save).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("preserves left/center/right offsets and normalizes CRLF line breaks", () => {
    const text = createText({ x: 0, y: 0 }, "One");
    const center = { ...text, width: 130, textAlign: "center" as const };
    const right = {
      ...center,
      textAlign: "right" as const,
      text: "First\r\nSecond\rThird",
    };
    expect(textDrawLines(text)[0].x).toBe(0);
    expect(textDrawLines(center)[0].x).toBe(65);
    expect(textDrawLines(right).map((row) => row.text)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
    expect(textDrawLines(right)[0].x).toBe(130);
  });

  it("keeps horizontal and vertical alignment anchors when auto-resizing", () => {
    const original = createText({ x: 20, y: 30 }, "Small");
    const centered = {
      ...original,
      textAlign: "center" as const,
      verticalAlign: "middle" as const,
    };
    const scene = { ...blankScene(), elements: [centered] };
    const updated = replaceText(
      scene,
      centered.id,
      "A much longer string\nwith two lines",
    );
    const text = updated.elements[0];
    expect(text.type).toBe("text");
    if (text.type !== "text") {
      return;
    }
    expect(text.x + text.width / 2).toBeCloseTo(
      centered.x + centered.width / 2,
    );
    expect(text.y + text.height / 2).toBeCloseTo(
      centered.y + centered.height / 2,
    );
    expect(text.originalText).toBe("A much longer string\nwith two lines");
    expect(text.text).toBe(text.originalText);
    expect(text.id).toBe(centered.id);
    expect(text.version).toBe(centered.version + 1);
    expect(scene.elements[0]).toBe(centered);
  });

  it("preserves fixed-width text box while rewrapping and retains original text", () => {
    const original = createText({ x: 20, y: 30 }, "Hello");
    const fixed = {
      ...original,
      width: 90,
      autoResize: false,
      textAlign: "right" as const,
      verticalAlign: "bottom" as const,
    };
    const scene = { ...blankScene(), elements: [fixed] };
    const input = "This sentence is longer than the available width";
    const updated = replaceText(scene, fixed.id, input).elements[0];
    expect(updated.type).toBe("text");
    if (updated.type !== "text") {
      return;
    }
    expect(updated.width).toBe(90);
    expect(updated.x).toBe(fixed.x);
    expect(updated.y + updated.height).toBeCloseTo(fixed.y + fixed.height);
    expect(updated.originalText).toBe(input);
    expect(updated.height).toBeGreaterThan(0);
    expect(updated.lineHeight).toBe(fixed.lineHeight);
    expect(updated.fontFamily).toBe(fixed.fontFamily);
  });

  it("does not rewrite locked or bound text and never paints a bound label", () => {
    const original = createText({ x: 0, y: 0 }, "No change");
    const bound = { ...original, containerId: "box-id" };
    const locked = { ...original, id: crypto.randomUUID(), locked: true };
    const scene = { ...blankScene(), elements: [bound, locked] };
    expect(replaceText(scene, bound.id, "changed").elements[0]).toBe(bound);
    expect(replaceText(scene, locked.id, "changed").elements[1]).toBe(locked);
    const ctx = document.createElement("canvas").getContext("2d")!;
    const fill = vi.spyOn(ctx, "fillText");
    paintNativeText(ctx, bound, "#000000");
    expect(fill).not.toHaveBeenCalled();
  });
});
