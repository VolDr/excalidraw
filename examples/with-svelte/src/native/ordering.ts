import { syncInvalidIndicesImmutable } from "@excalidraw/element";

import type { SceneFile } from "./scene";

/**
 * Delegate fractional-index generation to the original Excalidraw core.
 * Only pure insertion transactions require repair in the native editor.
 * This does not mutate source elements, file data, or non-index fields.
 */
export const indexInsertedNativeElements = (
  previous: SceneFile,
  next: SceneFile,
): SceneFile => {
  if (next.elements.length <= previous.elements.length) {
    return next;
  }
  const ids = new Set(next.elements.map((element) => element.id));
  if (
    ids.size !== next.elements.length ||
    !previous.elements.every((element) => ids.has(element.id))
  ) {
    return next;
  }

  try {
    const indexed = syncInvalidIndicesImmutable(next.elements);
    if (!indexed) {
      return next;
    }
    let changed = false;
    const elements = next.elements.map((element) => {
      const corrected = indexed.get(element.id) ?? element;
      if (corrected !== element) {
        changed = true;
      }
      return corrected;
    });
    return changed ? { ...next, elements } : next;
  } catch {
    // Preserve a successful edit even if a malformed legacy scene cannot
    // be safely normalized. React's full editor remains available.
    return next;
  }
};
