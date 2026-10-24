import { getFontString } from "@excalidraw/common";
import {
  computeBoundTextPosition,
  getBoundTextMaxWidth,
  measureText,
  wrapText,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawTextElement,
  ExcalidrawTextElementWithContainer,
} from "@excalidraw/element/types";

import type { SceneFile } from "./scene";

type LabelBox = Extract<
  ExcalidrawElement,
  { type: "rectangle" | "ellipse" | "diamond" }
>;

/**
 * Enable only a single reciprocal label on an independent box. A more
 * complicated combination of arrow links, grouped labels, or nested frames
 * is intentionally delegated to the full editor to protect imported data.
 */
export function nativeLabelBox(
  scene: SceneFile,
  label: ExcalidrawElement,
): LabelBox | null {
  if (
    label.type !== "text" ||
    !label.containerId ||
    label.isDeleted ||
    label.locked ||
    !label.autoResize ||
    label.boundElements?.length ||
    label.frameId ||
    label.groupIds.length
  ) {
    return null;
  }
  const box = scene.elements.find((item) => item.id === label.containerId);
  if (
    !box ||
    (box.type !== "rectangle" &&
      box.type !== "ellipse" &&
      box.type !== "diamond") ||
    box.isDeleted ||
    box.locked ||
    box.frameId ||
    box.groupIds.length ||
    box.width <= 20 ||
    box.height <= 20 ||
    box.boundElements?.length !== 1 ||
    box.boundElements[0].type !== "text" ||
    box.boundElements[0].id !== label.id
  ) {
    return null;
  }
  return box;
}

/** Derive official placement and wrapping without changing the file. */
export function nativeBoundLabelLayout(
  scene: SceneFile,
  element: ExcalidrawElement,
): ExcalidrawTextElement | null {
  const box = nativeLabelBox(scene, element);
  if (!box || element.type !== "text") {
    return null;
  }
  const maxWidth = getBoundTextMaxWidth(box, element);
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
    return null;
  }
  const text = wrapText(
    element.originalText ?? element.text,
    getFontString(element),
    maxWidth,
  );
  const metrics = measureText(
    text,
    getFontString(element),
    element.lineHeight,
  );
  const resized = {
    ...element,
    text,
    width: metrics.width,
    height: metrics.height,
    angle: box.angle,
  };
  const map = new Map(
    scene.elements.map((item) => [item.id, item]),
  ) as ElementsMap;
  const position = computeBoundTextPosition(
    box,
    resized as ExcalidrawTextElementWithContainer,
    map,
  );
  return { ...resized, ...position };
}

/**
 * Move/rotate/rewrap the label together with its container. Both elements
 * remain valid Excalidraw elements in serialized scene and undo history.
 */
export function syncNativeBoundLabels(scene: SceneFile): SceneFile {
  let changed = false;
  const elements = scene.elements.map((element) => {
    const layout = nativeBoundLabelLayout(scene, element);
    if (
      !layout ||
      (layout.x === element.x &&
        layout.y === element.y &&
        layout.angle === element.angle &&
        layout.text === (element as ExcalidrawTextElement).text &&
        layout.width === element.width &&
        layout.height === element.height)
    ) {
      return element;
    }
    changed = true;
    return {
      ...layout,
      version: element.version + 1,
      versionNonce: Math.floor(Math.random() * 2 ** 31),
      updated: Date.now(),
    };
  });
  return changed ? { ...scene, elements } : scene;
}
