import { CoreEditorController, type CoreEditorTransactionResult } from "./EditorController";
import { getCommonBounds } from "./bounds";
import { getCoreGraphDefects, isCoreGraphTransitionValid } from "./EditorGraph";
import { newElementWith } from "./mutateElement";
import type { ExcalidrawElement } from "./types";
import type { AppState } from "../../excalidraw/types";
import {
  CoreEditorHistory,
  type CoreEditorDocumentLike,
} from "./EditorHistory";


/**
 * Adopt a transaction into an immutable document without losing unknown scene
 * fields, embedded files, fractional indices, unrelated object identities or
 * revision bookkeeping. The original core alone computes element geometry.
 *
 * Scene construction can normalize imported fractional indices before the
 * transaction starts; those incidental changes must never leak into the file.
 */
export const applyCoreDocumentTransaction = <TDoc extends CoreEditorDocumentLike>(
  source: TDoc,
  tx: CoreEditorTransactionResult,
): TDoc => {
  if (
    tx.elements.length !== source.elements.length ||
    tx.baseline.length !== source.elements.length ||
    tx.elements.some((element, index) =>
      element.id !== source.elements[index].id ||
      tx.baseline[index].id !== element.id
    )
  ) {
    throw new Error("Document transaction changed element identities or order");
  }
  let changed = false;
  const elements = source.elements.map((original, index) => {
    if (!tx.changedIds.has(original.id)) return original;
    changed = true;
    const updated = tx.elements[index];
    const baseline = tx.baseline[index];
    const revisionDelta = updated.version - baseline.version;
    const next = {
      ...updated,
      index: original.index,
      version: original.version + Math.max(0, revisionDelta),
    } as ExcalidrawElement;
    return revisionDelta <= 0 ? newElementWith(next, {}, true) : next;
  });
  return changed ? ({ ...source, elements } as TDoc) : source;
};

/**
 * One framework-independent lifetime for Scene, full typed AppState and
 * Excalidraw's ElementsDelta-based document history.
 *
 * Presentation hosts (React, Svelte, etc.) supply immutable document
 * snapshots and draw their own UI. Gesture previews are ephemeral; a
 * commit(previous, next) records exactly one original input gesture.
 * File imports reset history instead of inheriting another file's stack.
 */
export class CoreEditorSession<
  TDoc extends CoreEditorDocumentLike
> {
  readonly controller: CoreEditorController;
  readonly history = new CoreEditorHistory<TDoc>();

  private currentDocument: TDoc;
  private disposed = false;

  constructor(document: TDoc, initialAppState: Partial<AppState> = {}) {
    this.currentDocument = document;
    this.controller = new CoreEditorController(document.elements, initialAppState);
  }

  get document(): TDoc {
    this.assertOpen();
    return this.currentDocument;
  }

  get canUndo(): boolean {
    this.assertOpen();
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    this.assertOpen();
    return this.history.canRedo;
  }


  /**
   * Run the original Excalidraw drag engine from a gesture-start snapshot.
   * Svelte provides only IDs and pointer deltas, not geometry or a graph
   * compatibility policy. Invalid imports are left untouched.
   */
  previewDragDocument(
    original: TDoc,
    selectedIds: readonly string[],
    dx: number,
    dy: number,
  ): TDoc {
    this.assertOpen();
    if (
      !selectedIds.length ||
      ![dx, dy].every(Number.isFinite) ||
      (!dx && !dy) ||
      new Set(selectedIds).size !== selectedIds.length ||
      selectedIds.some((id) => !original.elements.some((element) =>
        element.id === id && !element.isDeleted && !element.locked
      ))
    ) return original;

    try {
      const tx = this.controller.previewDragSelection(
        original.elements, new Set(selectedIds), dx, dy,
      );
      const next = applyCoreDocumentTransaction(original, tx);
      return next !== original &&
        isCoreGraphTransitionValid(original.elements, next.elements)
        ? next : original;
    } catch {
      // Corrupt imported diagrams must not corrupt the live editor.
      return original;
    }
  }

  /**
   * Transform single/multiple selections using Excalidraw's own Scene,
   * transformElements and binding updates. Only core graph invariants gate
   * adoption; no Svelte-specific list of editable element kinds.
   */
  previewTransformDocument(
    original: TDoc,
    selectedIds: readonly string[],
    handle: "nw" | "ne" | "sw" | "se" | "rotate",
    pointer: { x: number; y: number },
    shouldMaintainAspectRatio = selectedIds.length > 1,
  ): TDoc {
    this.assertOpen();
    if (
      !selectedIds.length ||
      new Set(selectedIds).size !== selectedIds.length ||
      ![pointer.x, pointer.y].every(Number.isFinite)
    ) return original;
    const selected = original.elements.filter((element) =>
      selectedIds.includes(element.id) &&
      !element.isDeleted && !element.locked
    );
    if (selected.length !== selectedIds.length) return original;

    try {
      const [left, top, right, bottom] = getCommonBounds(
        selected,
        new Map(original.elements.map((element) => [element.id, element])),
      );
      if (
        ![left, top, right, bottom].every(Number.isFinite) ||
        right <= left || bottom <= top
      ) return original;
      const tx = this.controller.previewTransformSelection(
        original.elements, new Set(selectedIds),
        handle === "rotate" ? "rotation" : handle,
        pointer,
        { x: (left + right) / 2, y: (top + bottom) / 2 },
        shouldMaintainAspectRatio,
      );
      const next = applyCoreDocumentTransaction(original, tx);
      return next !== original &&
        isCoreGraphTransitionValid(original.elements, next.elements)
        ? next : original;
    } catch {
      return original;
    }
  }

  /**
   * Core deletion updates reciprocal links in the same transaction.
   * Imported graphs may have existing defects, but deletion cannot add new
   * dangling references.
   */
  previewDeleteDocument(
    original: TDoc,
    selectedIds: ReadonlySet<string>,
  ): TDoc {
    this.assertOpen();
    if (
      !selectedIds.size ||
      original.elements.filter((element) =>
        selectedIds.has(element.id) && !element.isDeleted
      ).length !== selectedIds.size
    ) return original;
    try {
      const tx = this.controller.previewDeleteElements(
        original.elements, selectedIds,
      );
      const next = applyCoreDocumentTransaction(original, tx);
      if (next === original) return original;
      const before = getCoreGraphDefects(original.elements);
      const after = getCoreGraphDefects(next.elements);
      return [...after].every((defect) => before.has(defect))
        ? next : original;
    } catch {
      return original;
    }
  }

  /**
   * Synchronize external file loads, peer snapshots or gesture previews.
   * This is intentionally not undoable; durable commits are explicit.
   */
  replaceDocument(next: TDoc): void {
    this.assertOpen();
    if (next === this.currentDocument) return;
    const previousElements = this.currentDocument.elements;
    this.currentDocument = next;
    if (next.elements !== previousElements) {
      this.controller.replaceElements(next.elements);
    }
  }

  /**
   * Preserve one undo step per gesture, even when Svelte has previewed
   * intermediate pointer positions. The controller and history agree on the
   * exact next document at the transaction boundary.
   */
  commit(previous: TDoc, next: TDoc): TDoc {
    this.assertOpen();
    if (previous === next) return next;
    this.history.commit(previous, next);
    this.replaceDocument(next);
    return next;
  }

  undo(current: TDoc = this.document): TDoc {
    this.assertOpen();
    if (!this.history.canUndo) return current;
    const next = this.history.undo(current);
    this.replaceDocument(next);
    return next;
  }

  redo(current: TDoc = this.document): TDoc {
    this.assertOpen();
    if (!this.history.canRedo) return current;
    const next = this.history.redo(current);
    this.replaceDocument(next);
    return next;
  }

  reset(document: TDoc): void {
    this.assertOpen();
    this.history.clear();
    this.replaceDocument(document);
    this.controller.setSelection([], null);
  }

  destroy(): void {
    if (this.disposed) return;
    this.controller.destroy();
    this.history.clear();
    this.disposed = true;
  }

  private assertOpen(): void {
    if (this.disposed) {
      throw new Error("CoreEditorSession has been destroyed");
    }
  }
}
