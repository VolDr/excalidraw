import type { ExcalidrawElement } from "@excalidraw/element/types";

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
  | "hand";

export type NativeShape = Exclude<NativeTool, "selection" | "hand">;
export type Point = { x: number; y: number };

const SOURCE = "https://github.com/VolDr/excalidraw";
const SUPPORTED_TYPES = new Set<string>([
  "rectangle",
  "ellipse",
  "diamond",
  "line",
  "arrow",
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
    (element) => !element.isDeleted && !SUPPORTED_TYPES.has(element.type),
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
  return SUPPORTED_TYPES.has(element.type) && !element.isDeleted;
}

export function elementBounds(element: ExcalidrawElement) {
  return {
    x: element.x,
    y: element.y,
    width: Math.abs(element.width),
    height: Math.abs(element.height),
  };
}

export function pickElement(
  elements: readonly ExcalidrawElement[],
  point: Point,
  tolerance = 7,
): ExcalidrawElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    if (!isNativeShape(element) || element.locked) {
      continue;
    }
    const { x, y, width, height } = elementBounds(element);
    if (
      point.x >= x - tolerance &&
      point.x <= x + width + tolerance &&
      point.y >= y - tolerance &&
      point.y <= y + height + tolerance
    ) {
      return element;
    }
  }
  return null;
}
