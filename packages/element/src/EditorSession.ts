import { CoreEditorController, type CoreEditorTransactionResult } from "./EditorController";
import { getCommonBounds } from "./bounds";
import { getCoreGraphDefects, isCoreGraphTransitionValid } from "./EditorGraph";
import { newElementWith } from "./mutateElement";
import { syncInvalidIndicesImmutable, validateFractionalIndices } from "./fractionalIndex";
import type { Alignment } from "./align";
import type { Distribution } from "./distribute";
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
  options: { allowReorder?: boolean } = {},
): TDoc => {
  if (
    tx.elements.length !== source.elements.length ||
    tx.baseline.length !== source.elements.length
  ) {
    throw new Error("Document transaction changed element count");
  }
  const sources = new Map(source.elements.map((element) => [element.id, element]));
  const baselines = new Map(tx.baseline.map((entry) => [entry.id, entry]));
  if (
    sources.size !== source.elements.length ||
    baselines.size !== tx.baseline.length ||
    tx.elements.some((element) => !sources.has(element.id) || !baselines.has(element.id)) ||
    new Set(tx.elements.map((element) => element.id)).size !== sources.size
  ) {
    throw new Error("Document transaction changed element identities");
  }
  const reordered = tx.elements.some(
    (element, index) => element.id !== source.elements[index].id,
  );
  if (reordered && !options.allowReorder) {
    throw new Error("Reorder requires an explicit core document command");
  }

  let changed = reordered;
  const elements = tx.elements.map((updated) => {
    const original = sources.get(updated.id)!;
    const baseline = baselines.get(updated.id)!;
    if (!tx.changedIds.has(updated.id)) return original;
    // A displaced neighbor may change array position while keeping its
    // original Excalidraw fractional index and element data intact.
    // Reusing that object preserves shape-cache/React revision semantics.
    if (
      options.allowReorder &&
      updated.index === baseline.index &&
      updated.version === baseline.version &&
      updated.versionNonce === baseline.versionNonce &&
      sameElementAsideFromOrder(original, updated)
    ) return original;
    changed = true;
    const revisionDelta = updated.version - baseline.version;
    const next = {
      ...updated,
      index: options.allowReorder ? updated.index : original.index,
      version: original.version + Math.max(0, revisionDelta),
    } as ExcalidrawElement;
    return revisionDelta <= 0 ? newElementWith(next, {}, true) : next;
  });
  return changed ? ({ ...source, elements } as TDoc) : source;
};

const hasValidDocumentOrder = (
  elements: readonly ExcalidrawElement[],
): boolean => {
  try {
    validateFractionalIndices(elements, {
      includeBoundTextValidation: false,
      shouldThrow: true,
      ignoreLogs: true,
    });
    return true;
  } catch {
    return false;
  }
};

/** Reordering may edit only the array order, index and Excalidraw revision. */
const sameElementAsideFromOrder = (
  before: ExcalidrawElement,
  after: ExcalidrawElement,
): boolean => {
  const strip = (element: ExcalidrawElement) => {
    const { index, version, versionNonce, updated, ...stable } = element;
    return stable;
  };
  return JSON.stringify(strip(before)) === JSON.stringify(strip(after));
};

/**
 * The original fractional-index reconciler owns insertion ordering.
 * Existing valid elements and unknown document fields retain identity.
 */
export const indexCoreInsertedElements = <TDoc extends CoreEditorDocumentLike>(
  previous: TDoc,
  next: TDoc,
): TDoc => {
  if (next.elements.length <= previous.elements.length) return next;
  const ids = new Set(next.elements.map((element) => element.id));
  if (
    ids.size !== next.elements.length ||
    !previous.elements.every((element) => ids.has(element.id))
  ) return next;
  try {
    const indexed = syncInvalidIndicesImmutable(next.elements);
    if (!indexed) return next;
    let changed = false;
    const elements = next.elements.map((element) => {
      const corrected = indexed.get(element.id) ?? element;
      if (corrected !== element) changed = true;
      return corrected;
    });
    return changed ? ({ ...next, elements } as TDoc) : next;
  } catch {
    // A malformed imported document must not be discarded on insertion.
    return next;
  }
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
        new Map<string, ExcalidrawElement>(
          original.elements.map((element) => [element.id, element]),
        ),
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

  /** Original Excalidraw alignment and distribution, including groups. */
  previewLayoutDocument(
    original: TDoc,
    selectedIds: readonly string[],
    action: { kind: "align"; alignment: Alignment } |
      { kind: "distribute"; distribution: Distribution },
  ): TDoc {
    this.assertOpen();
    const minimum = action.kind === "align" ? 2 : 3;
    if (
      selectedIds.length < minimum ||
      new Set(selectedIds).size !== selectedIds.length ||
      selectedIds.some((id) => !original.elements.some((element) =>
        element.id === id && !element.isDeleted && !element.locked
      ))
    ) return original;
    try {
      const tx = this.controller.previewLayoutSelection(
        original.elements, selectedIds, action,
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
   * Original Excalidraw layer movement with its fractional-index repair.
   * Unlike geometry transactions, reordering is allowed to return a new
   * element array order, while retaining exact IDs, group ancestry, bindings
   * and all non-index content from the imported document.
   */
  previewReorderDocument(
    original: TDoc,
    selectedIds: readonly string[],
    direction: "back" | "forward" | "bottom" | "top",
  ): TDoc {
    this.assertOpen();
    if (
      !selectedIds.length ||
      new Set(selectedIds).size !== selectedIds.length ||
      !hasValidDocumentOrder(original.elements) ||
      selectedIds.some((id) => !original.elements.some((element) =>
        element.id === id && !element.isDeleted && !element.locked
      ))
    ) return original;
    try {
      const tx = this.controller.previewReorderSelection(
        original.elements, selectedIds, direction,
      );
      const next = applyCoreDocumentTransaction(original, tx, {
        allowReorder: true,
      });
      if (next === original ||
          !hasValidDocumentOrder(next.elements)) return original;
      const after = new Map(next.elements.map((element) => [element.id, element]));
      if (
        after.size !== original.elements.length ||
        original.elements.some((element) => {
          const updated = after.get(element.id);
          return !updated || !sameElementAsideFromOrder(element, updated);
        })
      ) return original;
      const priorDefects = getCoreGraphDefects(original.elements);
      const nextDefects = getCoreGraphDefects(next.elements);
      return [...nextDefects].every((defect) => priorDefects.has(defect))
        ? next : original;
    } catch {
      return original;
    }
  }

  /**
   * Original addToGroup/removeFromSelectedGroups mutate only group ancestry.
   * Caller supplies a closed set of members (including reciprocal captions).
   * The command refuses all other graph, geometry or document mutations.
   */
  previewGroupMembershipDocument(
    original: TDoc,
    memberIds: ReadonlySet<string>,
    operation: { kind: "add" | "remove"; groupIds: readonly string[] },
  ): TDoc {
    this.assertOpen();
    const groups = new Set(operation.groupIds);
    if (
      !memberIds.size || !groups.size ||
      groups.size !== operation.groupIds.length ||
      (operation.kind === "add" && groups.size !== 1) ||
      operation.groupIds.some((id) => typeof id !== "string" || !id) ||
      memberIds.size !== original.elements.filter((element) =>
        memberIds.has(element.id) && !element.isDeleted && !element.locked
      ).length
    ) return original;
    if (
      operation.kind === "add" &&
      original.elements.some((element) =>
        element.groupIds.some((id) => groups.has(id))
      )
    ) return original;

    try {
      const tx = this.controller.previewGroupMembership(
        original.elements, memberIds, operation,
      );
      const next = applyCoreDocumentTransaction(original, tx);
      if (next === original) return original;
      const byId = new Map(next.elements.map((element) => [element.id, element]));
      const stable = (element: ExcalidrawElement) => {
        const {
          groupIds, index, version, versionNonce, updated, ...unchanged
        } = element;
        return unchanged;
      };
      for (const previous of original.elements) {
        const updated = byId.get(previous.id);
        if (
          !updated ||
          !sameElementAsideFromOrder(previous, updated) &&
            JSON.stringify(stable(previous)) !== JSON.stringify(stable(updated)) ||
          previous.index !== updated.index
        ) return original;
        const expectedGroups = memberIds.has(previous.id)
          ? operation.kind === "add"
            ? [...previous.groupIds, operation.groupIds[0]]
            : previous.groupIds.filter((groupId) => !groups.has(groupId))
          : previous.groupIds;
        if (
          JSON.stringify(updated.groupIds) !== JSON.stringify(expectedGroups)
        ) return original;
      }
      const priorDefects = getCoreGraphDefects(original.elements);
      const nextDefects = getCoreGraphDefects(next.elements);
      return [...nextDefects].every((defect) => priorDefects.has(defect))
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
    const indexed = indexCoreInsertedElements(previous, next);
    this.history.commit(previous, indexed);
    this.replaceDocument(indexed);
    return indexed;
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

/**
 * Stateless entry point for document consumers (clipboard, command tests)
 * without a persistent editor host. Uses the exact same Scene, binding and
 * graph-validation lifecycle as CoreEditorSession.
 */
export const deleteCoreDocumentElements = <TDoc extends CoreEditorDocumentLike>(
  document: TDoc,
  ids: ReadonlySet<string>,
): TDoc => {
  const session = new CoreEditorSession(document);
  try {
    return session.previewDeleteDocument(document, ids);
  } finally {
    session.destroy();
  }
};

/**
 * Stateless entry point for group commands used in headless consumers and
 * fixtures. Svelte's persistent editor calls the session method directly.
 */
export const changeCoreDocumentGroups = <TDoc extends CoreEditorDocumentLike>(
  document: TDoc,
  ids: ReadonlySet<string>,
  operation: { kind: "add" | "remove"; groupIds: readonly string[] },
): TDoc => {
  const session = new CoreEditorSession(document);
  try {
    return session.previewGroupMembershipDocument(document, ids, operation);
  } finally {
    session.destroy();
  }
};
