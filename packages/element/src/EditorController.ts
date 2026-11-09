import { Scene } from "./Scene";
import { getDefaultAppState } from "../../excalidraw/appState";
import { dragSelectedElements } from "./dragElements";
import { fixBindingsAfterDeletion } from "./binding";
import { getCommonBounds } from "./bounds";
import { transformElements } from "./resizeElements";
import { alignElements, type Alignment } from "./align";
import { distributeElements, type Distribution } from "./distribute";
import { moveAllLeft, moveAllRight, moveOneLeft, moveOneRight } from "./zindex";
import type { MaybeTransformHandleType } from "./transformHandles";
import { getElementsInGroup, getSelectedElementsByGroup, selectGroupsFromGivenElements } from "./groups";

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
  // One canonical Excalidraw AppState, not separate Svelte selection/tool/view stores.
  private appState: AppState;
  private disposed = false;
  private readonly subscribers = new Set<() => void>();

  constructor(
    elements: readonly ExcalidrawElement[] = [],
    state: Partial<AppState> = {},
  ) {
    this.scene = new Scene(structuredClone(elements), {
      skipValidation: true,
    });
    // Reuse React's actual default state. The controller stays headless:
    // this module has no dependency on React components or browser globals.
    const defaults = getDefaultAppState();
    this.appState = {
      ...defaults,
      offsetTop: 0,
      offsetLeft: 0,
      width: 0,
      height: 0,
      ...state,
      activeTool: { ...defaults.activeTool, ...state.activeTool },
      zoom: { ...defaults.zoom, ...state.zoom },
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
      selectedElementIds: { ...this.appState.selectedElementIds },
      selectedGroupIds: { ...this.appState.selectedGroupIds },
      editingGroupId: this.appState.editingGroupId,
    };
  }

  getToolState(): CoreEditorToolState {
    this.assertOpen();
    return {
      activeTool: { ...this.appState.activeTool },
      currentItemArrowType: this.appState.currentItemArrowType,
    };
  }

  /**
   * Full typed AppState is owned by the core. Return a detached view of the
   * mutable selection/tool/viewport fields used by framework hosts.
   */
  getAppState(): AppState {
    this.assertOpen();
    return {
      ...this.appState,
      selectedElementIds: { ...this.appState.selectedElementIds },
      selectedGroupIds: { ...this.appState.selectedGroupIds },
      activeTool: { ...this.appState.activeTool },
      zoom: { ...this.appState.zoom },
    };
  }

  /**
   * Non-geometry editor state (styles, preferences, zoom, tool, etc.).
   * Selection always goes through the original group normalization path.
   */
  setAppState(patch: Partial<AppState>): void {
    this.assertOpen();
    const {
      selectedElementIds,
      selectedGroupIds,
      editingGroupId,
      ...rest
    } = patch;
    if (
      selectedElementIds !== undefined ||
      selectedGroupIds !== undefined ||
      editingGroupId !== undefined
    ) {
      const ids = Object.entries(
        selectedElementIds ?? this.appState.selectedElementIds,
      ).filter(([, selected]) => selected).map(([id]) => id);
      this.setSelection(
        ids,
        editingGroupId === undefined
          ? this.appState.editingGroupId : editingGroupId,
        selectedGroupIds,
      );
    }
    if (!Object.keys(rest).length) return;
    const next = { ...this.appState, ...rest };
    if (rest.activeTool) next.activeTool = { ...rest.activeTool };
    if (rest.zoom) next.zoom = { ...rest.zoom };
    this.appState = next;
    this.notify();
  }

  /**
   * Excalidraw scroll is expressed in scene units, whereas the Svelte canvas
   * positions its viewport with pixel pan. No independent camera state.
   */
  getViewport(): { zoom: number; pan: { x: number; y: number } } {
    this.assertOpen();
    const zoom = this.appState.zoom.value;
    return {
      zoom,
      pan: {
        x: this.appState.scrollX * zoom,
        y: this.appState.scrollY * zoom,
      },
    };
  }

  setViewport(zoom: number, pan: { x: number; y: number }): void {
    this.assertOpen();
    if (
      !Number.isFinite(zoom) || zoom <= 0 ||
      !Number.isFinite(pan.x) || !Number.isFinite(pan.y)
    ) {
      throw new Error("Invalid viewport");
    }
    const scrollX = pan.x / zoom;
    const scrollY = pan.y / zoom;
    if (
      this.appState.zoom.value === zoom &&
      this.appState.scrollX === scrollX &&
      this.appState.scrollY === scrollY
    ) return;
    this.setAppState({
      zoom: { value: zoom as AppState["zoom"]["value"] },
      scrollX,
      scrollY,
    });
  }

  setActiveTool(
    activeTool: AppState["activeTool"],
    currentItemArrowType: AppState["currentItemArrowType"] =
      this.appState.currentItemArrowType,
  ): void {
    this.assertOpen();
    if (
      JSON.stringify(this.appState.activeTool) === JSON.stringify(activeTool) &&
      this.appState.currentItemArrowType === currentItemArrowType
    ) return;
    this.appState = {
      ...this.appState,
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
    editingGroupId: string | null = this.appState.editingGroupId,
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
    currentGroupId: string | null = this.appState.editingGroupId,
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
    groupId: string | null = this.appState.editingGroupId,
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
    editingGroupId: string | null = this.appState.editingGroupId,
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
    this.appState = {
      ...this.appState,
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
    const editingGroupId = this.appState.editingGroupId;
    const remains = editingGroupId
      ? getElementsInGroup(
          this.scene.getNonDeletedElementsMap(),
          editingGroupId,
        ).length > 0
      : false;
    // A new document may have deleted/reorganized groups. Re-derive the
    // selected groups using Excalidraw's current Scene, not a stale copy.
    this.setSelection(
      Object.keys(this.appState.selectedElementIds),
      remains ? editingGroupId : null,
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
        const activeIds = Object.keys(this.appState.selectedElementIds)
          .filter((id) => !!this.scene.getNonDeletedElement(id));
        const editingGroupId = this.appState.editingGroupId;
        const remains = editingGroupId
          ? getElementsInGroup(
              this.scene.getNonDeletedElementsMap(),
              editingGroupId,
            ).length > 0
          : false;
        this.setSelection(activeIds, remains ? editingGroupId : null);
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
   * Pure preview of the original editor's z-order commands. No Svelte
   * geometry/index algorithm is involved. The complete reordered array is
   * published by the transaction Scene; consumers validate indices and
   * imported bindings before adopting it as a document.
   */
  previewReorderSelection(
    originalElements: readonly ExcalidrawElement[],
    selectedIds: readonly string[],
    direction: "back" | "forward" | "bottom" | "top",
  ): CoreEditorTransactionResult {
    if (!selectedIds.length || new Set(selectedIds).size !== selectedIds.length) {
      throw new Error("Invalid z-order selection");
    }
    return this.previewTransaction(originalElements, (scene) => {
      const selectedElementIds = Object.fromEntries(
        selectedIds.map((id) => [id, true]),
      ) as AppState["selectedElementIds"];
      const selected = scene.getSelectedElements({ selectedElementIds });
      if (selected.length !== selectedIds.length ||
          selected.some((element) => element.locked)) return;
      const state: AppState = {
        ...this.appState,
        selectedElementIds,
        selectedGroupIds: selectGroupsFromGivenElements(
          selected, {
            ...this.appState,
            selectedElementIds,
            selectedGroupIds: {},
            editingGroupId: null,
          },
        ),
        editingGroupId: null,
      };
      const original = scene.getElementsIncludingDeleted();
      const ordered = direction === "back"
        ? moveOneLeft(original, state, scene)
        : direction === "forward"
          ? moveOneRight(original, state, scene)
          : direction === "bottom"
            ? moveAllLeft(original, state)
            : moveAllRight(original, state);
      if (ordered.length !== original.length ||
          ordered.every((item, index) => item.id === original[index].id)) return;
      // Z-index functions return a new ordered array. Keep the preview Scene
      // authoritative instead of exporting an independent Svelte-side array.
      scene.replaceAllElements([...ordered], { skipValidation: true });
    });
  }

  /**
   * Original group-aware alignment/distribution inside the same transaction
   * boundary used for drag and transform. Selection groups are derived from
   * Excalidraw itself instead of duplicated Svelte state.
   */
  previewLayoutSelection(
    originalElements: readonly ExcalidrawElement[],
    selectedIds: readonly string[],
    action: { kind: "align"; alignment: Alignment } |
      { kind: "distribute"; distribution: Distribution },
  ): CoreEditorTransactionResult {
    if (selectedIds.length < (action.kind === "align" ? 2 : 3) ||
        new Set(selectedIds).size !== selectedIds.length) {
      throw new Error("Invalid layout selection");
    }
    return this.previewTransaction(originalElements, (scene) => {
      const selected = selectedIds.map((id) => scene.getNonDeletedElement(id));
      if (selected.some((element) => !element || element.locked)) return;
      const selectedElementIds = Object.fromEntries(
        selectedIds.map((id) => [id, true]),
      ) as AppState["selectedElementIds"];
      const state: AppState = {
        ...this.appState,
        selectedElementIds,
        selectedGroupIds: selectGroupsFromGivenElements(
          selected as NonDeleted<ExcalidrawElement>[],
          {
            ...this.appState,
            selectedElementIds,
            selectedGroupIds: {},
            editingGroupId: null,
          },
        ),
        editingGroupId: null,
      };
      const elements = selected as NonDeleted<ExcalidrawElement>[];
      const units = getSelectedElementsByGroup(
        elements, scene.getElementsMapIncludingDeleted(), state,
      );
      if (units.length < (action.kind === "align" ? 2 : 3)) return;
      if (action.kind === "align") {
        alignElements(elements, action.alignment, scene, state);
      } else {
        distributeElements(
          elements, scene.getElementsMapIncludingDeleted(),
          action.distribution, state, scene,
        );
      }
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
