import { CoreEditorController } from "./EditorController";
import type { AppState } from "../../excalidraw/types";
import {
  CoreEditorHistory,
  type CoreEditorDocumentLike,
} from "./EditorHistory";

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
