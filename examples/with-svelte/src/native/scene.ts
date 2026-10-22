import { newFreeDrawElement, newTextElement } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";

import { nativeImageSource } from "./images";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

/**
 * A serializable scene boundary shared by the native Svelte editor and
 * the legacy React adapter. Unknown but valid Excalidraw elements are
 * preserved byte-for-byte at the property level (unless edited elsewhere).
 */
export interface SceneFile {
  type: "excalidraw";
  version: number;
  source: string;
  elements: ExcalidrawElement[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export type NativeTool =
  | "selection"
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "line"
  | "arrow"
  | "text"
  | "freedraw"
  | "hand";

export type NativeShape = Exclude<
  NativeTool,
  "selection" | "hand" | "text" | "freedraw"
>;
export type Point = { x: number; y: number };

const SOURCE = "https://github.com/VolDr/excalidraw";
const SUPPORTED_TYPES = new Set<string>([
  "rectangle",
  "ellipse",
  "diamond",
  "line",
  "arrow",
  "text",
  "freedraw",
  "image",
]);

export const blankScene = (): SceneFile => ({
  type: "excalidraw",
  version: 2,
  source: SOURCE,
  elements: [],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseScene(input: string): SceneFile {
  const data: unknown = JSON.parse(input);
  if (
    !isRecord(data) ||
    data.type !== "excalidraw" ||
    !Array.isArray(data.elements) ||
    (data.appState != null && !isRecord(data.appState)) ||
    (data.files != null && !isRecord(data.files))
  ) {
    throw new Error("Это не файл .excalidraw.");
  }
  if (
    !data.elements.every(
      (element: unknown) =>
        isRecord(element) &&
        typeof element.id === "string" &&
        typeof element.type === "string" &&
        Number.isFinite(element.x) &&
        Number.isFinite(element.y),
    )
  ) {
    throw new Error("Файл содержит некорректные элементы.");
  }
  return {
    type: "excalidraw",
    version: typeof data.version === "number" ? data.version : 2,
    source: typeof data.source === "string" ? data.source : SOURCE,
    elements: data.elements as ExcalidrawElement[],
    appState: isRecord(data.appState) ? data.appState : {},
    files: isRecord(data.files) ? data.files : {},
  };
}

export const serializeScene = (scene: SceneFile): string =>
  JSON.stringify(scene, null, 2);

export const unsupportedCount = (scene: SceneFile): number =>
  scene.elements.filter(
    (element) =>
      !element.isDeleted &&
      (!isNativeShape(element) ||
        (element.type === "image" && !nativeImageSource(scene, element))),
  ).length;

const versionNonce = () => Math.floor(Math.random() * 2 ** 31);

export function createShape(
  tool: NativeShape,
  start: Point,
  end: Point,
): ExcalidrawElement {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  const now = Date.now();
  const base = {
    id: crypto.randomUUID(),
    type: tool,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "hachure",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: null,
    seed: versionNonce(),
    version: 1,
    versionNonce: versionNonce(),
    isDeleted: false,
    boundElements: null,
    updated: now,
    created: now,
    link: null,
    locked: false,
  };

  if (tool === "line" || tool === "arrow") {
    // A line's points are relative to the bounding box, including when
    // dragging from bottom-right towards top-left.
    const points = [
      [start.x - x, start.y - y],
      [end.x - x, end.y - y],
    ];
    return {
      ...base,
      points,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: tool === "arrow" ? "arrow" : null,
      ...(tool === "arrow" ? { elbowed: false } : { polygon: false }),
    } as unknown as ExcalidrawElement;
  }
  return base as unknown as ExcalidrawElement;
}

/** Create canonical Excalidraw text with the element package's own metrics. */
export const createText = (
  point: Point,
  value: string,
): ExcalidrawTextElement =>
  newTextElement({ x: point.x, y: point.y, text: value, fontSize: 20 });

/**
 * Preserve the original id, container metadata, index and custom fields.
 * Complex/bound text is intentionally not offered for native editing yet.
 */
export function replaceText(
  scene: SceneFile,
  id: string,
  value: string,
): SceneFile {
  return {
    ...scene,
    elements: scene.elements.map((element) => {
      if (
        element.id !== id ||
        element.type !== "text" ||
        element.locked ||
        element.containerId
      ) {
        return element;
      }
      const measured = newTextElement({
        x: element.x,
        y: element.y,
        text: value,
        fontSize: element.fontSize,
        fontFamily: element.fontFamily,
        textAlign: "left",
        verticalAlign: "top",
      });
      return {
        ...element,
        text: measured.text,
        originalText: measured.originalText,
        width: measured.width,
        height: measured.height,
        version: element.version + 1,
        versionNonce: versionNonce(),
        updated: Date.now(),
      };
    }),
  };
}

/**
 * Svelte pointer samples become an official Excalidraw freedraw element.
 * Coordinates are normalized while pressure samples retain their order.
 */
export function createFreeDraw(
  points: readonly Point[],
  pressures: readonly number[],
) {
  if (!points.length) {
    throw new Error("Freehand drawing needs at least one point.");
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return newFreeDrawElement({
    type: "freedraw",
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
    points: points.map((p) => pointFrom<LocalPoint>(p.x - x, p.y - y)),
    pressures: [...pressures],
    simulatePressure: false,
  });
}

export function moveElement(
  element: ExcalidrawElement,
  dx: number,
  dy: number,
): ExcalidrawElement {
  if (!dx && !dy) {
    return element;
  }
  return {
    ...element,
    x: element.x + dx,
    y: element.y + dy,
    version: element.version + 1,
    versionNonce: versionNonce(),
    updated: Date.now(),
  };
}

export function moveById(
  scene: SceneFile,
  id: string,
  dx: number,
  dy: number,
): SceneFile {
  return {
    ...scene,
    elements: scene.elements.map((element) =>
      element.id === id && !element.locked && !element.isDeleted
        ? moveElement(element, dx, dy)
        : element,
    ),
  };
}

/** Soft-delete to retain scene identity for undo/redo and file compatibility. */
export function deleteById(scene: SceneFile, id: string): SceneFile {
  return {
    ...scene,
    elements: scene.elements.map((element) =>
      element.id === id && !element.locked
        ? {
            ...element,
            isDeleted: true,
            version: element.version + 1,
            versionNonce: versionNonce(),
            updated: Date.now(),
          }
        : element,
    ),
  };
}

export function isNativeShape(element: ExcalidrawElement): boolean {
  if (element.isDeleted || !SUPPORTED_TYPES.has(element.type)) {
    return false;
  }
  // Bound text needs layout/binding support before it can be edited safely.
  return element.type !== "text" || element.containerId === null;
}

export function elementBounds(element: ExcalidrawElement) {
  return {
    x: element.x,
    y: element.y,
    width: Math.abs(element.width),
    height: Math.abs(element.height),
  };
}

function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2
    ? Math.max(
        0,
        Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / l2),
      )
    : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

/**
 * Hit-test in the rotated element coordinate space; don't select an entire
 * arrow's bounding rectangle. Defer bound/complex geometry to the full editor.
 */
export function hitTest(
  element: ExcalidrawElement,
  point: Point,
  tolerance = 7,
): boolean {
  if (!isNativeShape(element) || element.locked) {
    return false;
  }
  const { x, y, width, height } = elementBounds(element);
  const cx = x + width / 2;
  const cy = y + height / 2;
  const angle = -element.angle;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const local = {
    x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: cy + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
  if (
    element.type === "line" ||
    element.type === "arrow" ||
    element.type === "freedraw"
  ) {
    const points = element.points.map((p) => ({
      x: element.x + p[0],
      y: element.y + p[1],
    }));
    if (points.length === 1) {
      return (
        Math.hypot(local.x - points[0].x, local.y - points[0].y) <= tolerance
      );
    }
    return points
      .slice(1)
      .some(
        (p, i) =>
          segmentDistance(local, points[i], p) <=
          tolerance + element.strokeWidth / 2,
      );
  }
  if (element.type === "ellipse") {
    const rx = width / 2 + tolerance;
    const ry = height / 2 + tolerance;
    return (
      rx > 0 &&
      ry > 0 &&
      ((local.x - cx) / rx) ** 2 + ((local.y - cy) / ry) ** 2 <= 1
    );
  }
  if (element.type === "diamond") {
    const rx = width / 2 + tolerance;
    const ry = height / 2 + tolerance;
    return (
      rx > 0 &&
      ry > 0 &&
      Math.abs((local.x - cx) / rx) + Math.abs((local.y - cy) / ry) <= 1
    );
  }
  return (
    local.x >= x - tolerance &&
    local.x <= x + width + tolerance &&
    local.y >= y - tolerance &&
    local.y <= y + height + tolerance
  );
}

export function pickElement(
  elements: readonly ExcalidrawElement[],
  point: Point,
  tolerance = 7,
): ExcalidrawElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    if (hitTest(element, point, tolerance)) {
      return element;
    }
  }
  return null;
}
