import { getFontString } from "@excalidraw/common";
import {
  computeBoundTextPosition,
  computeContainerDimensionForBoundText,
  getBoundTextMaxHeight,
  getBoundTextMaxWidth,
  measureText,
  normalizeText,
  newTextElement,
  wrapText,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  ExcalidrawTextElementWithContainer,
} from "@excalidraw/element/types";

import { nativeElementsMap, updateNativeElement } from "./coreAdapter";

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
    label.groupIds.some((id, index) => label.groupIds.indexOf(id) !== index)
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
    box.groupIds.length !== label.groupIds.length ||
    box.groupIds.some((id, index) => id !== label.groupIds[index]) ||
    box.width <= 20 ||
    box.height <= 20 ||
    box.boundElements?.length !== 1 ||
    box.boundElements[0].type !== "text" ||
    box.boundElements[0].id !== label.id ||
    scene.elements.some(
      (item) =>
        item.type === "text" &&
        !item.isDeleted &&
        item.containerId === box.id &&
        item.id !== label.id,
    ) ||
    scene.elements.some(
      (item) =>
        item.type === "arrow" &&
        !item.isDeleted &&
        (item.startBinding?.elementId === box.id ||
          item.endBinding?.elementId === box.id),
    )
  ) {
    return null;
  }
  return box;
}

/**
 * Validate a single reciprocal text label, including when its container
 * also has one or more bound arrows. This is a relationship safety gate,
 * not a second text layout algorithm. Editing of mixed bound graphs is
 * delegated separately to the original core.
 */
export function nativeReciprocalCaption(
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
    new Set(label.groupIds).size !== label.groupIds.length
  ) return null;
  const box = scene.elements.find((item) => item.id === label.containerId);
  if (
    !box ||
    !["rectangle", "ellipse", "diamond"].includes(box.type) ||
    box.isDeleted ||
    box.locked ||
    box.frameId ||
    box.width <= 20 ||
    box.height <= 20 ||
    box.groupIds.length !== label.groupIds.length ||
    box.groupIds.some((id, i) => id !== label.groupIds[i]) ||
    !box.boundElements ||
    box.boundElements.filter((ref) => ref.type === "text").length !== 1 ||
    !box.boundElements.some((ref) =>
      ref.type === "text" && ref.id === label.id
    ) ||
    box.boundElements.some((ref) =>
      ref.type !== "text" && ref.type !== "arrow"
    ) ||
    new Set(box.boundElements.map((ref) => ref.id)).size !== box.boundElements.length ||
    scene.elements.some((other) =>
      !other.isDeleted && other.id !== label.id && other.id !== box.id &&
      ((other.type === "text" && other.containerId === box.id) ||
        other.boundElements?.some((ref) => ref.id === label.id))
    )
  ) return null;
  return box as LabelBox;
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
  const map = nativeElementsMap(scene);
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
export function syncNativeBoundLabels(
  scene: SceneFile,
  changedContainers?: ReadonlySet<string>,
): SceneFile {
  let changed = false;
  const elements = scene.elements.map((element) => {
    if (
      changedContainers &&
      (element.type !== "text" ||
        !element.containerId ||
        !changedContainers.has(element.containerId))
    ) {
      return element;
    }
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
    if (element.type !== "text") {
      return element;
    }
    return updateNativeElement(element, {
      x: layout.x,
      y: layout.y,
      text: layout.text,
      width: layout.width,
      height: layout.height,
      angle: layout.angle,
    });
  });
  return changed ? { ...scene, elements } : scene;
}

/**
 * Return a safe label target for new or existing text. We do not touch boxes
 * with arrow links or multiple bindings: their geometry belongs to React.
 */
export function nativeEditableLabel(
  scene: SceneFile,
  box: ExcalidrawElement,
): ExcalidrawTextElement | null | undefined {
  if (
    (box.type !== "rectangle" &&
      box.type !== "ellipse" &&
      box.type !== "diamond") ||
    box.isDeleted ||
    box.locked ||
    box.frameId ||
    box.groupIds.some((id, index) => box.groupIds.indexOf(id) !== index) ||
    box.width <= 20 ||
    box.height <= 20
  ) {
    return undefined;
  }
  if (!box.boundElements?.length) {
    // Do not create a new internal member in an existing group.
    if (box.groupIds.length) {
      return undefined;
    }
    // A malformed imported label may still point at this box even when
    // the reverse reference is missing. Do not create a second label.
    return scene.elements.some(
      (element) =>
        element.type === "text" &&
        element.containerId === box.id &&
        !element.isDeleted,
    )
      ? undefined
      : null;
  }
  if (
    box.boundElements.length !== 1 ||
    box.boundElements[0].type !== "text"
  ) {
    return undefined;
  }
  const label = scene.elements.find(
    (element) => element.id === box.boundElements?.[0].id,
  );
  if (
    !label ||
    label.type !== "text" ||
    nativeLabelBox(scene, label)?.id !== box.id
  ) {
    return undefined;
  }
  return label;
}

/**
 * Add, edit or clear a single safe bound label in one undoable scene update.
 * Grow its box when text exceeds the available interior, matching Excalidraw's
 * bound-text dimension rules. Unsupported imported bindings are unchanged.
 */
export function updateNativeBoxLabel(
  scene: SceneFile,
  boxId: string,
  value: string,
): SceneFile {
  const container = scene.elements.find((element) => element.id === boxId);
  if (
    !container ||
    (container.type !== "rectangle" &&
      container.type !== "ellipse" &&
      container.type !== "diamond")
  ) {
    return scene;
  }
  const existing = nativeEditableLabel(scene, container);
  if (existing === undefined) {
    return scene;
  }
  const originalText = normalizeText(value.trimEnd());
  if (existing && originalText === (existing.originalText ?? existing.text)) {
    return scene;
  }

  if (!originalText) {
    if (!existing) {
      return scene;
    }
    return {
      ...scene,
      elements: scene.elements.map((element) => {
        if (element.id === boxId) {
          return updateNativeElement(element, { boundElements: null });
        }
        if (element.id === existing.id) {
          return updateNativeElement(element, { isDeleted: true });
        }
        return element;
      }),
    };
  }

  const label = existing ?? {
    ...newTextElement({
      x: container.x,
      y: container.y,
      text: originalText,
      fontSize: 20,
    }),
    containerId: boxId,
    textAlign: "center" as const,
    verticalAlign: "middle" as const,
    strokeColor: container.strokeColor,
  };
  const font = getFontString(label);
  const originalMaxWidth = Math.max(1, getBoundTextMaxWidth(container, label));
  let wrapped = wrapText(originalText, font, originalMaxWidth);
  let metrics = measureText(wrapped, font, label.lineHeight);
  let width = container.width;
  let height = container.height;

  if (metrics.width > originalMaxWidth) {
    width = Math.max(
      width,
      computeContainerDimensionForBoundText(metrics.width, container.type),
    );
    wrapped = wrapText(
      originalText,
      font,
      Math.max(1, getBoundTextMaxWidth({ ...container, width }, label)),
    );
    metrics = measureText(wrapped, font, label.lineHeight);
  }
  if (
    metrics.height >
    getBoundTextMaxHeight(
      { ...container, width, height },
      label as ExcalidrawTextElementWithContainer,
    )
  ) {
    height = Math.max(
      height,
      computeContainerDimensionForBoundText(metrics.height, container.type),
    );
  }

  const resized = { ...container, width, height };
  const nextLabel = {
    ...label,
    text: wrapped,
    originalText,
    width: metrics.width,
    height: metrics.height,
    angle: resized.angle,
  };
  const elements = scene.elements.map((element) => {
    if (element.id === boxId) {
      if (
        existing &&
        width === container.width &&
        height === container.height
      ) {
        return element;
      }
      return updateNativeElement(element, {
        width,
        height,
        boundElements: [{ id: label.id, type: "text" as const }],
      });
    }
    if (element.id === label.id) {
      return nextLabel;
    }
    return element;
  });
  if (!existing) {
    elements.push(nextLabel);
  }
  const candidate = { ...scene, elements };
  const positioned = nativeBoundLabelLayout(candidate, nextLabel);
  if (!positioned) {
    return scene;
  }
  const updatedLabel = existing
    ? updateNativeElement(existing, {
        text: positioned.text,
        originalText: positioned.originalText,
        x: positioned.x,
        y: positioned.y,
        width: positioned.width,
        height: positioned.height,
        angle: positioned.angle,
      })
    : positioned;
  return {
    ...candidate,
    elements: elements.map((element) =>
      element.id === label.id ? updatedLabel : element,
    ),
  };
}
