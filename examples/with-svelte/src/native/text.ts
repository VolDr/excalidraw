import { getFontString, getVerticalOffset, isRTL } from "@excalidraw/common";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

export type TextDraw = {
  text: string;
  x: number;
  y: number;
};

/**
 * Match the font, alphabetic baseline, alignment and line positions from
 * Excalidraw's renderElement. Coordinates are relative to the text box,
 * because the main canvas already applies scene transforms and rotation.
 * Bound text remains handled by the React fallback.
 */
export function textDrawLines(
  element: ExcalidrawTextElement,
): TextDraw[] {
  const lineHeightPx = element.fontSize * element.lineHeight;
  const y = getVerticalOffset(
    element.fontFamily,
    element.fontSize,
    lineHeightPx,
  );
  const x =
    element.textAlign === "center"
      ? element.width / 2
      : element.textAlign === "right"
        ? element.width
        : 0;
  return element.text.replace(/\r\n?/g, "\n").split("\n").map(
    (text, index) => ({
      text,
      x,
      y: y + index * lineHeightPx,
    }),
  );
}

export function paintNativeText(
  ctx: CanvasRenderingContext2D,
  element: ExcalidrawTextElement,
  color: string,
): void {
  if (element.isDeleted || element.containerId !== null) {
    return;
  }
  ctx.save();
  ctx.font = getFontString(element);
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = element.textAlign;
  ctx.direction = isRTL(element.text) ? "rtl" : "ltr";
  // Canvas mirrors Excalidraw's layout without editing the text record.
  for (const line of textDrawLines(element)) {
    ctx.fillText(line.text, element.x + line.x, element.y + line.y);
  }
  ctx.restore();
}
