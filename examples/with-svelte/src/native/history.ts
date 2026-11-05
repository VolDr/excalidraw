import {
  ElementsDelta,
  validateFractionalIndices,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
  SceneElementsMap,
} from "@excalidraw/element/types";

import type { SceneFile } from "./scene";

const MAX_UNDO = 100;

type HistoryEntry = {
  snapshot: SceneFile;
  /** Excalidraw's original forward element delta, when safely applicable. */
  delta: ElementsDelta | null;
};

const toElementsMap = (
  elements: readonly ExcalidrawElement[],
): SceneElementsMap =>
  new Map(elements.map((element) => [element.id, element])) as SceneElementsMap;

const validIndices = (elements: readonly ExcalidrawElement[]) => {
  try {
    validateFractionalIndices(elements, {
      shouldThrow: true,
      includeBoundTextValidation: false,
      ignoreLogs: true,
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * Only pure edits to the same element IDs and z-order can enter the delta
 * path. Original Excalidraw deltas own property changes and binding repair.
 * Insertion, removal, layer changes and malformed imports still use the
 * previous whole-scene snapshots: no element can silently disappear.
 */
const calculateCoreDelta = (
  previous: SceneFile,
  next: SceneFile,
): ElementsDelta | null => {
  if (
    previous.elements.length !== next.elements.length ||
    !validIndices(previous.elements) ||
    !validIndices(next.elements) ||
    previous.elements.some((element, i) =>
      element.id !== next.elements[i].id ||
      element.index !== next.elements[i].index
    )
  ) {
    return null;
  }
  try {
    const delta = ElementsDelta.calculate(
      toElementsMap(previous.elements) as Map<string, OrderedExcalidrawElement>,
      toElementsMap(next.elements) as Map<string, OrderedExcalidrawElement>,
    );
    return delta.isEmpty() ? null : delta;
  } catch {
    return null;
  }
};

const normalizeNested = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeNested);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, normalizeNested(val)]),
    );
  }
  return value;
};

const contentSignature = (element: ExcalidrawElement): string =>
  JSON.stringify(normalizeNested(Object.fromEntries(
    Object.entries(element).filter(
      ([key]) => !["version", "versionNonce", "updated"].includes(key),
    ),
  )));

/**
 * Attempt to replay the core's immutable delta on private copies. Verify the
 * full resulting element data against the known safe snapshot (ignoring only
 * version bookkeeping). If an imported/complex scene is incompatible, return
 * null and let the original snapshot history path handle it.
 *
 * Scene metadata and binary files are not tracked by ElementsDelta. They are
 * restored from the snapshot irrespective of the element-delta path.
 */
const applyCoreDelta = (
  current: SceneFile,
  target: SceneFile,
  delta: ElementsDelta | null,
  direction: "undo" | "redo",
): SceneFile | null => {
  if (
    !delta ||
    current.elements.length !== target.elements.length ||
    current.elements.some((element, i) => element.id !== target.elements[i].id) ||
    !validIndices(current.elements)
  ) {
    return null;
  }
  try {
    const coreMap = toElementsMap(structuredClone(current.elements));
    const change = direction === "undo" ? delta.inverse() : delta;
    const [updated] = change.applyTo(coreMap, undefined, {
      // Match Excalidraw's HistoryDelta: undo/redo are new local revisions.
      excludedProperties: new Set(["version", "versionNonce"]),
    });
    const elements = current.elements.map((element) =>
      updated.get(element.id),
    );
    if (
      elements.some((element) => !element) ||
      !validIndices(elements as ExcalidrawElement[]) ||
      elements.some((element, index) =>
        contentSignature(element!) !== contentSignature(target.elements[index])
      )
    ) {
      return null;
    }
    return { ...structuredClone(target), elements: elements as ExcalidrawElement[] };
  } catch {
    return null;
  }
};

/**
 * Framework-independent gesture transactions. The original Excalidraw
 * ElementsDelta now handles compatible element-only undo/redo, including its
 * binding repair and revision updates. Full scene snapshots remain a
 * conservative fallback and still hold appState, files, and unknown fields.
 */
export class SceneHistory {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  commit(previous: SceneFile, next: SceneFile) {
    if (previous === next) {
      return;
    }
    this.past.push({
      snapshot: structuredClone(previous),
      delta: calculateCoreDelta(previous, next),
    });
    if (this.past.length > MAX_UNDO) {
      this.past.shift();
    }
    this.future = [];
  }

  undo(current: SceneFile): SceneFile {
    const entry = this.past.pop();
    if (!entry) {
      return current;
    }
    this.future.push({
      snapshot: structuredClone(current),
      delta: entry.delta,
    });
    return (
      applyCoreDelta(current, entry.snapshot, entry.delta, "undo") ??
      structuredClone(entry.snapshot)
    );
  }

  redo(current: SceneFile): SceneFile {
    const entry = this.future.pop();
    if (!entry) {
      return current;
    }
    this.past.push({
      snapshot: structuredClone(current),
      delta: entry.delta,
    });
    return (
      applyCoreDelta(current, entry.snapshot, entry.delta, "redo") ??
      structuredClone(entry.snapshot)
    );
  }

  clear() {
    this.past = [];
    this.future = [];
  }
}
