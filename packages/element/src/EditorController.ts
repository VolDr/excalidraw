import { Scene } from "./Scene";
import { dragSelectedElements } from "./dragElements";
import { fixBindingsAfterDeletion } from "./binding";
import { getCommonBounds } from "./bounds";
import { transformElements } from "./resizeElements";
import type { MaybeTransformHandleType } from "./transformHandles";
import { getElementsInGroup, selectGroupsFromGivenElements } from "./groups";

import type {
  ExcalidrawElement,
  NonDeleted,
} from "./types";
import type {
  AppState,
  InteractiveCanvasAppState,
  PointerDownState,
} from "../../excalidraw/types";

export type CoreEditorSelectionState = Pick<
  AppState,
  "selectedElementIds" | "selectedGroupIds" | "editingGroupId"
>;

export type CoreEditorToolState = Pick<AppState,
  "activeTool" | "currentItemArrowType"
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
  private tool: CoreEditorToolState = {
    activeTool: {
      type: "selection",
      customType: null,
      locked: false,
      fromSelection: false,
      lastActiveTool: null,
    },
    currentItemArrowType: "round",
  };
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

  getToolState(): CoreEditorToolState {
    this.assertOpen();
    return {
      activeTool: { ...this.tool.activeTool },
      currentItemArrowType: this.tool.currentItemArrowType,
    };
  }

  setActiveTool(
    activeTool: AppState["activeTool"],
    currentItemArrowType: AppState["currentItemArrowType"] =
      this.tool.currentItemArrowType,
  ): void {
    this.assertOpen();
    if (
      JSON.stringify(this.tool.activeTool) === JSON.stringify(activeTool) &&
      this.tool.currentItemArrowType === currentItemArrowType
    ) return;
    this.tool = {
      activeTool: { ...activeTool },
      currentItemArrowType,
    };
    this.notify();
  }

  /**
   * React's group selection is based on the original innermost-to-outermost
   * groupIds and getElementsInGroup, not on Svelte's safeGroupMembers lists.
   * Entering an editingGroupId selects immediate children; nested child
   * groups stay atomic until entered. Container labels select their owner.
   */
  getSelectionUnit(
    id: string,
    editingGroupId: string | null = this.selection.editingGroupId,
  ): string[] {
    this.assertOpen();
    const hit = this.scene.getNonDeletedElement(id);
    if (!hit || hit.locked) return [];
    const element = hit.type === "text" && hit.containerId
      ? this.scene.getNonDeletedElement(hit.containerId) : hit;
    if (!element || element.locked) return [];
    const index = editingGroupId
      ? element.groupIds.indexOf(editingGroupId)
      : element.groupIds.length;
    if (index < 0) return [];
    const groupId = index > 0 ? element.groupIds[index - 1] : null;
    if (!groupId) return [element.id];
    return getElementsInGroup(
      this.scene.getNonDeletedElementsMap(), groupId,
    )
      .filter((member) =>
        !member.isDeleted &&
        !(member.type === "text" && !!member.containerId)
      )
      .map((member) => member.id);
  }

  enterGroupForElement(
    id: string,
    currentGroupId: string | null = this.selection.editingGroupId,
  ): string | null {
    this.assertOpen();
    const hit = this.scene.getNonDeletedElement(id);
    const element = hit?.type === "text" && hit.containerId
      ? this.scene.getNonDeletedElement(hit.containerId) : hit;
    if (!element || element.locked) return null;
    const position = currentGroupId === null
      ? element.groupIds.length
      : element.groupIds.indexOf(currentGroupId);
    if (position < 1) return null;
    const groupId = element.groupIds[position - 1];
    const members = getElementsInGroup(
      this.scene.getNonDeletedElementsMap(), groupId,
    );
    return members.filter((member) =>
      !(member.type === "text" && member.containerId)
    ).length > 0 ? groupId : null;
  }

  exitEditingGroup(
    groupId: string | null = this.selection.editingGroupId,
  ): { editingGroupId: string | null; selectedIds: string[] } {
    this.assertOpen();
    if (!groupId) {
      return { editingGroupId: null, selectedIds: [] };
    }
    const roots = getElementsInGroup(
      this.scene.getNonDeletedElementsMap(), groupId,
    ).filter((item) => !(item.type === "text" && item.containerId));
    const first = roots[0];
    if (!first) {
      return { editingGroupId: null, selectedIds: [] };
    }
    const index = first.groupIds.indexOf(groupId);
    const parent = index < 0 ? null : first.groupIds[index + 1] ?? null;
    return {
      editingGroupId: parent,
      selectedIds: this.getSelectionUnit(first.id, parent),
    };
  }

  setSelection(
    selectedElementIds: readonly string[],
    editingGroupId: string | null = this.selection.editingGroupId,
    selectedGroupIds?: AppState["selectedGroupIds"],
  ): void {
    this.assertOpen();
    const elements = this.scene.getNonDeletedElementsMap();
    const normalized = Object.fromEntries(
      [...new Set(selectedElementIds)]
        .filter((id) => !!elements.get(id))
        .map((id) => [id, true] as const),
    ) as AppState["selectedElementIds"];
    // Original Excalidraw group selection implementation determines which
    // groups are selected, including group-editing scopes.
    const selected = this.scene.getSelectedElements({
      selectedElementIds: normalized,
    });
    const groups = selectedGroupIds ??
      selectGroupsFromGivenElements(
        selected,
        {
          selectedElementIds: normalized,
          selectedGroupIds: {},
          editingGroupId,
        } as InteractiveCanvasAppState,
      );
    this.selection = {
      selectedElementIds: normalized,
      selectedGroupIds: { ...groups },
      editingGroupId,
    };
    this.notify();
  }

  /**
   * The original Select All action targets every non-deleted unlocked root,
   * including imported elbows, frames and foreign graph components. Bound
   * captions are selected through their owners; group-state derivation runs
   * through the original Scene selection helpers in setSelection().
   */
  selectAll(): void {
    this.assertOpen();
    this.setSelection(
      this.scene.getNonDeletedElements()
        .filter((element) =>
          !element.locked &&
          !(element.type === "text" && !!element.containerId)
        )
        .map((element) => element.id),
      null,
    );
  }

  readElements(): readonly ExcalidrawElement[] {
    this.assertOpen();
    return structuredClone(this.scene.getElementsIncludingDeleted());
  }

  replaceElements(elements: readonly ExcalidrawElement[]): void {
    this.assertOpen();
    // Keep the same original Scene instance across Svelte document updates.
    // Its maps, subscriptions and selection cache belong to the editor
    // lifetime, not to individual pointer frames. Stage the next document
    // first so malformed imports cannot damage the live Scene.
    const staged = new Scene(structuredClone(elements), {
      skipValidation: true,
    });
    try {
      this.scene.replaceAllElements(
        [...staged.getElementsIncludingDeleted()],
        { skipValidation: true },
      );
    } finally {
      staged.destroy();
    }
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
    return this.evaluate(
      this.scene.getElementsIncludingDeleted(), operation, true,
    );
  }

  /**
   * Pointer previews run from the original pointer-down elements, not
   * the last preview. This keeps even nonlinear rotations/bindings stable
   * during a drag, without creating a separate short-lived controller.
   * The controller's committed Scene and selection do not change.
   */
  previewTransaction(
    originalElements: readonly ExcalidrawElement[],
    operation: (scene: Scene, state: Readonly<CoreEditorSelectionState>) => void,
  ): CoreEditorTransactionResult {
    this.assertOpen();
    return this.evaluate(originalElements, operation, false);
  }

  private evaluate(
    originalElements: readonly ExcalidrawElement[],
    operation: (scene: Scene, state: Readonly<CoreEditorSelectionState>) => void,
    adopt: boolean,
  ): CoreEditorTransactionResult {
    const draft = new Scene(structuredClone(originalElements), {
      skipValidation: true,
    });
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
        // A pointer preview may be evaluated from an older gesture-start
        // snapshot; returning the controller's latest committed document
        // here would splice unrelated changes into a no-op preview.
        const elements = structuredClone(originalElements);
        draft.destroy();
        return { elements, baseline, changedIds };
      }

      // Output must not expose mutable Scene-owned element references.
      const elements = structuredClone(after);
      if (adopt) {
        // An editor owns one Scene for its whole lifetime. Keep its object
        // identity, subscriptions and selection caches; adopt only the
        // successfully computed elements from the isolated draft.
        this.scene.replaceAllElements([...after], { skipValidation: true });
        draft.destroy();
        this.selection.selectedElementIds = Object.fromEntries(
          Object.entries(this.selection.selectedElementIds)
            .filter(([id]) => !!this.scene.getNonDeletedElement(id)),
        );
        this.notify();
      } else {
        draft.destroy();
      }
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
      this.applyOriginalDrag(scene, state.selectedElementIds, dx, dy);
    });
  }

  /**
   * Multi-selection geometry and reciprocal binding updates are delegated
   * wholesale to the original transformElements. This includes complex
   * elbows, imported binding graphs, frames and nested groups where the
   * original editor permits transforming them.
   */
  previewTransformSelection(
    originalElements: readonly ExcalidrawElement[],
    selectedIds: ReadonlySet<string>,
    handle: MaybeTransformHandleType,
    pointer: { x: number; y: number },
    center: { x: number; y: number },
    shouldMaintainAspectRatio = selectedIds.size > 1,
  ): CoreEditorTransactionResult {
    if (
      ![pointer.x, pointer.y, center.x, center.y]
        .every(Number.isFinite) || !handle
    ) {
      throw new Error("Invalid transform handle or pointer");
    }
    return this.previewTransaction(originalElements, (scene) => {
      const selected = scene.getSelectedElements({
        selectedElementIds: Object.fromEntries(
          [...selectedIds].map((id) => [id, true]),
        ),
      });
      if (!selected.length) return;
      const originalElementsMap = new Map<string, NonDeleted<ExcalidrawElement>>(
        scene.getNonDeletedElements().map((el) => [
          el.id, structuredClone(el),
        ]),
      );
      transformElements(
        originalElementsMap as PointerDownState["originalElements"],
        handle,
        selected,
        scene,
        false,
        false,
        shouldMaintainAspectRatio,
        pointer.x, pointer.y,
        center.x, center.y,
      );
    });
  }

  /**
   * Excalidraw's original reciprocal-binding deletion lifecycle, evaluated
   * against the private transaction Scene. The host does not separately
   * soft-delete after repairing links; both changes have one undo boundary.
   */
  previewDeleteElements(
    originalElements: readonly ExcalidrawElement[],
    ids: ReadonlySet<string>,
  ): CoreEditorTransactionResult {
    return this.previewTransaction(originalElements, (scene) => {
      if (!ids.size) return;
      const elements = scene.getElementsIncludingDeleted();
      const targets = elements.filter((el) => ids.has(el.id) && !el.isDeleted);
      if (targets.length !== ids.size) return;

      fixBindingsAfterDeletion(elements, targets);
      for (const element of targets) {
        scene.mutateElement(element, { isDeleted: true });
      }
      // Scene caches must no longer expose the soft-deleted elements.
      scene.replaceAllElements([...elements], { skipValidation: true });
    });
  }

  /** Selection bounds are calculated by the original Excalidraw geometry. */
  getSelectionBounds(
    ids: readonly string[],
  ): [number, number, number, number] | null {
    this.assertOpen();
    if (ids.length < 2 || new Set(ids).size !== ids.length) return null;
    const selected = ids.map((id) => this.scene.getNonDeletedElement(id));
    if (selected.some((el) => !el)) return null;
    const [x1, y1, x2, y2] = getCommonBounds(
      selected as NonDeleted<ExcalidrawElement>[],
    );
    return [x1, y1, x2, y2].every(Number.isFinite) &&
      x2 > x1 && y2 > y1
      ? [x1, y1, x2, y2] : null;
  }

  previewDragSelection(
    originalElements: readonly ExcalidrawElement[],
    selectedIds: ReadonlySet<string>,
    dx: number,
    dy: number,
  ): CoreEditorTransactionResult {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      throw new Error("Invalid drag offset");
    }
    return this.previewTransaction(originalElements, (scene) => {
      this.applyOriginalDrag(
        scene,
        Object.fromEntries([...selectedIds].map((id) => [id, true])),
        dx,
        dy,
      );
    });
  }

  private applyOriginalDrag(
    scene: Scene,
    selectedElementIds: AppState["selectedElementIds"],
    dx: number,
    dy: number,
  ): void {
    if (!dx && !dy) return;
    const selected = scene.getSelectedElements({ selectedElementIds });
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
