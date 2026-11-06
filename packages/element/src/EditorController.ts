import { Scene } from "./Scene";
import { dragSelectedElements } from "./dragElements";

import type {
  ExcalidrawElement,
  NonDeleted,
} from "./types";
import type {
  AppState,
  PointerDownState,
} from "../../excalidraw/types";

export type CoreEditorSelectionState = Pick<
  AppState,
  "selectedElementIds" | "selectedGroupIds" | "editingGroupId"
>;

export type CoreEditorVersion = {
  id: string;
  version: number;
  versionNonce: number;
};

export type CoreEditorTransactionResult = {
  readonly elements: readonly ExcalidrawElement[];
  /** Baseline is captured after Scene has normalized imported indices. */
  readonly baseline: readonly CoreEditorVersion[];
  readonly changedIds: ReadonlySet<string>;
};

const initialSelection = (): CoreEditorSelectionState => ({
  selectedElementIds: {},
  selectedGroupIds: {},
  editingGroupId: null,
});

const sameVersion = (a: CoreEditorVersion, b: CoreEditorVersion) =>
  a.id === b.id &&
  a.version === b.version &&
  a.versionNonce === b.versionNonce;

/**
 * Framework-independent Excalidraw editor controller.
 *
 * This owns one original core Scene, the core selection/group-editing state
 * and the transaction lifecycle. React and Svelte may both drive it without
 * copying geometry, binding or hit-test code. Each transaction uses a private
 * Scene, publishes only on success and leaves the previous Scene untouched
 * on exceptions. Callers own their UI, document files and view rendering.
 *
 * New operations belong here or in the original element package; avoid
 * adding yet another Svelte-only per-shape controller.
 */
export class CoreEditorController {
  private scene: Scene;
  private selection: CoreEditorSelectionState;
  private disposed = false;
  private readonly subscribers = new Set<() => void>();

  constructor(
    elements: readonly ExcalidrawElement[] = [],
    state: Partial<CoreEditorSelectionState> = {},
  ) {
    this.scene = new Scene(structuredClone(elements), {
      skipValidation: true,
    });
    this.selection = {
      ...initialSelection(),
      ...state,
      selectedElementIds: { ...state.selectedElementIds },
      selectedGroupIds: { ...state.selectedGroupIds },
    };
  }

  /**
   * Host subscriptions only signal that the core state has changed.
   * Consumers read snapshots explicitly; no React component is needed.
   */
  onUpdate(callback: () => void): () => void {
    this.assertOpen();
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private notify(): void {
    for (const subscriber of this.subscribers) subscriber();
  }

  getSelection(): CoreEditorSelectionState {
    this.assertOpen();
    return {
      selectedElementIds: { ...this.selection.selectedElementIds },
      selectedGroupIds: { ...this.selection.selectedGroupIds },
      editingGroupId: this.selection.editingGroupId,
    };
  }

  setSelection(
    selectedElementIds: readonly string[],
    editingGroupId: string | null = this.selection.editingGroupId,
    selectedGroupIds: AppState["selectedGroupIds"] = {},
  ): void {
    this.assertOpen();
    const elements = this.scene.getNonDeletedElementsMap();
    this.selection = {
      selectedElementIds: Object.fromEntries(
        selectedElementIds
          .filter((id) => elements.has(id))
          .map((id) => [id, true]),
      ),
      selectedGroupIds: { ...selectedGroupIds },
      editingGroupId,
    };
    this.notify();
  }

  readElements(): readonly ExcalidrawElement[] {
    this.assertOpen();
    return structuredClone(this.scene.getElementsIncludingDeleted());
  }

  replaceElements(elements: readonly ExcalidrawElement[]): void {
    this.assertOpen();
    const next = new Scene(structuredClone(elements), {
      skipValidation: true,
    });
    const current = this.scene;
    this.scene = next;
    current.destroy();
    this.setSelection(
      Object.keys(this.selection.selectedElementIds),
      this.selection.editingGroupId,
      this.selection.selectedGroupIds,
    );
  }

  /**
   * The sole mutable boundary. Original element methods operate on the
   * isolated Scene; the updated Scene is adopted atomically on success.
   * Original methods may insert or reorder elements: no operation-specific
   * filtering of graph topology happens here.
   */
  transact(
    operation: (scene: Scene, state: Readonly<CoreEditorSelectionState>) => void,
  ): CoreEditorTransactionResult {
    this.assertOpen();
    const draft = new Scene(structuredClone(
      this.scene.getElementsIncludingDeleted(),
    ), { skipValidation: true });
    const baseline: CoreEditorVersion[] = draft
      .getElementsIncludingDeleted()
      .map((element) => ({
        id: element.id,
        version: element.version,
        versionNonce: element.versionNonce,
      }));
    const before = new Map(baseline.map((v) => [v.id, v]));
    // Some of the original Scene APIs replace arrays or reorder elements
    // without bumping the element version. Version-only detection silently
    // discarded those operations, so retain an immutable data baseline too.
    const beforeData = new Map(
      draft.getElementsIncludingDeleted().map((element) => [
        element.id, JSON.stringify(element),
      ]),
    );
    try {
      operation(draft, this.getSelection());
      const after = draft.getElementsIncludingDeleted();
      const changedIds = new Set<string>();
      for (let i = 0; i < after.length; i++) {
        const element = after[i];
        const old = before.get(element.id);
        if (
          !old || !sameVersion(old, element) ||
          beforeData.get(element.id) !== JSON.stringify(element) ||
          baseline[i]?.id !== element.id
        ) {
          changedIds.add(element.id);
        }
      }
      if (after.length !== baseline.length) {
        for (const old of baseline) {
          if (!after.some((el) => el.id === old.id)) {
            changedIds.add(old.id);
          }
        }
      }

      if (!changedIds.size) {
        const elements = structuredClone(this.scene.getElementsIncludingDeleted());
        draft.destroy();
        return { elements, baseline, changedIds };
      }

      // Output must not expose mutable Scene-owned element references.
      const elements = structuredClone(after);
      const previous = this.scene;
      this.scene = draft;
      previous.destroy();
      // Remove stale selection after deleting/replacing elements.
      this.selection.selectedElementIds = Object.fromEntries(
        Object.entries(this.selection.selectedElementIds)
          .filter(([id]) => !!this.scene.getNonDeletedElement(id)),
      );
      this.notify();
      return { elements, baseline, changedIds };
    } catch (error) {
      draft.destroy();
      throw error;
    }
  }

  /**
   * Equivalent to the React selection drag path: original selected roots,
   * original pointer-down snapshots, dragSelectedElements and its reciprocal
   * binding/frame updates. No Svelte-specific geometry or graph validator.
   */
  dragSelection(dx: number, dy: number): CoreEditorTransactionResult {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      throw new Error("Invalid drag offset");
    }
    return this.transact((scene, state) => {
      if (!dx && !dy) return;
      const selected = scene.getSelectedElements({
        selectedElementIds: state.selectedElementIds,
      });
      if (!selected.length) return;
      const originals = new Map<string, NonDeleted<ExcalidrawElement>>(
        scene.getNonDeletedElements().map((element) => [
          element.id, structuredClone(element),
        ]),
      );
      dragSelectedElements(
        { originalElements: originals } as PointerDownState,
        selected,
        { x: dx, y: dy },
        scene,
        { x: 0, y: 0 },
        null,
      );
    });
  }

  destroy(): void {
    if (this.disposed) return;
    this.scene.destroy();
    this.subscribers.clear();
    this.disposed = true;
  }

  private assertOpen(): void {
    if (this.disposed) {
      throw new Error("CoreEditorController has been destroyed");
    }
  }
}
