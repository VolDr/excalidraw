import {
  bindBindingElement,
  dragSelectedElements,
  fixBindingsAfterDeletion,
  getGlobalFixedPointForBindableElement,
  getBoundTextMaxHeight,
  getBoundTextMaxWidth,
  getNextSingleWidthAndHeightFromPointer,
  isElbowArrow,
  LinearElementEditor,
  resizeMultipleElements,
  transformElements,
  resizeSingleElement,
  newElementWith,
  Scene,
  unbindBindingElement,
  updateElbowArrowPoints,
  validateElbowPoints,
} from "@excalidraw/element";

import type { ElementUpdate } from "@excalidraw/element";
import type {
  ElementsMap,
  ExcalidrawArrowElement,
  ExcalidrawElbowArrowElement,
  ExcalidrawBindableElement,
  ExcalidrawElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
  ExcalidrawTextElement,
  ExcalidrawTextElementWithContainer,
} from "@excalidraw/element/types";
import type { AppClassProperties, PointerDownState } from "@excalidraw/excalidraw/types";
import { pointFrom } from "@excalidraw/math";

import type { GlobalPoint } from "@excalidraw/math";

import { nativeImageSource } from "./images";

import type { SceneFile } from "./scene";

/**
 * Keep Excalidraw's version/nonce/timestamp and no-op semantics consistent
 * across the Svelte immutable scene adapter. Never hand-roll metadata bumps.
 */
export const updateNativeElement = <T extends ExcalidrawElement>(
  element: T,
  changes: ElementUpdate<T>,
): T => newElementWith(element, changes);

/**
 * Original Excalidraw geometry/binding APIs use a map of all elements.
 * A native SceneFile is still a serializable snapshot; this temporary
 * adapter builds the expected map without mounting the React editor.
 */
export const nativeElementsMap = (
  scene: { readonly elements: readonly ExcalidrawElement[] },
): ElementsMap =>
  new Map(scene.elements.map((element) => [element.id, element])) as ElementsMap;

/**
 * Run a Scene-dependent Excalidraw algorithm without exposing our immutable
 * Svelte store to the core's in-place mutations.
 *
 * Scene synchronizes fractional indices when constructed. These are *not*
 * applied back to the native file: preserve original element order and index
 * explicitly, and adopt only elements whose versions changed in the core
 * transaction. Unknown extension fields and unrelated objects survive.
 */
export function withNativeCoreScene(
  scene: SceneFile,
  operation: (core: Scene) => void,
): SceneFile {
  const core = new Scene(structuredClone(scene.elements), {
    skipValidation: true,
  });
  // Scene repairs null/invalid fractional indices during construction,
  // bumping element versions. Treat that as private setup, never as a Svelte
  // edit. Compare against this baseline, not against the imported versions.
  const baseline = core.getElementsIncludingDeleted().map((element) => ({
    version: element.version,
    versionNonce: element.versionNonce,
  }));
  try {
    operation(core);
    const nextElements = core.getElementsIncludingDeleted();
    if (
      nextElements.length !== scene.elements.length ||
      nextElements.some((element, index) => element.id !== scene.elements[index].id)
    ) {
      throw new Error("Core Scene adapter cannot insert or reorder elements");
    }

    let changed = false;
    const elements = scene.elements.map((original, index) => {
      const updated = nextElements[index];
      const initial = baseline[index];
      if (
        updated.version === initial.version &&
        updated.versionNonce === initial.versionNonce
      ) {
        return original;
      }
      changed = true;
      return {
        ...updated,
        index: original.index,
        version: original.version + (updated.version - initial.version),
      };
    });
    return changed ? { ...scene, elements } : scene;
  } finally {
    core.destroy();
  }
}

/**
 * Delegate native pointer motion to Excalidraw's original drag engine.
 * Its only pointer-down dependency is the originalElements snapshot.
 * We supply that snapshot from an isolated core Scene rather than creating
 * a second React pointer controller. No snapping is enabled by native UI.
 *
 * The caller must first authorize the complete selection through native
 * safe-selection guards; this is an implementation bridge, not permission
 * to edit arbitrary imported bindings or frames.
 */
export function dragNativeSelectionWithCore(
  scene: SceneFile,
  ids: ReadonlySet<string>,
  dx: number,
  dy: number,
): SceneFile {
  if (!ids.size || (!dx && !dy) || !Number.isFinite(dx) || !Number.isFinite(dy)) {
    return scene;
  }
  return withNativeCoreScene(scene, (core) => {
    const selected = Array.from(ids, (id) => core.getNonDeletedElement(id));
    if (selected.some((element) => !element)) {
      return;
    }
    const originalElements = new Map<string, NonDeleted<ExcalidrawElement>>();
    for (const element of core.getNonDeletedElements()) {
      originalElements.set(element.id, structuredClone(element));
    }
    // Verified against dragElements.ts: this function only reads the
    // pointerDownState.originalElements field.
    const pointerDown = { originalElements } as PointerDownState;
    dragSelectedElements(
      pointerDown,
      selected as NonDeleted<ExcalidrawElement>[],
      { x: dx, y: dy },
      core,
      { x: 0, y: 0 },
      null,
    );
  });
}

/**
 * Bind and snap a simple arrow endpoint with Excalidraw's own fixed-point
 * computation. Called by both arrow creation and endpoint reconnection.
 */
const bindAndAnchorNativeArrowEndpoint = (
  arrow: NonDeleted<ExcalidrawArrowElement>,
  target: NonDeleted<ExcalidrawBindableElement>,
  endpoint: "start" | "end",
  worldPoint: { x: number; y: number },
  core: Scene,
): void => {
  // Zoom affects elbow midpoint snapping, which is not enabled in this
  // limited native path; non-elbow arrows use the explicit focusPoint.
  bindBindingElement(
    arrow,
    target,
    "inside",
    endpoint,
    core,
    { value: 1 } as Parameters<typeof bindBindingElement>[5],
    pointFrom<GlobalPoint>(worldPoint.x, worldPoint.y),
  );
  const binding = arrow[endpoint === "start" ? "startBinding" : "endBinding"];
  if (binding) {
    const [x, y] = getGlobalFixedPointForBindableElement(
      binding.fixedPoint,
      target,
      core.getNonDeletedElementsMap(),
    );
    const local = LinearElementEditor.createPointAt(
      arrow,
      core.getNonDeletedElementsMap(),
      x,
      y,
      null,
    );
    LinearElementEditor.movePoints(
      arrow,
      core,
      new Map([[endpoint === "start" ? 0 : 1, { point: local }]]),
    );
  }
};

/**
 * Bind a new two-point arrow in a private Scene instead of composing hand-
 * written arrow/box boundElements and fixedPoint structures.
 */
export function bindNewNativeArrowWithCore(
  scene: SceneFile,
  arrowId: string,
  startTargetId: string | null,
  endTargetId: string | null,
  anchors: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  },
): SceneFile {
  if (
    (!startTargetId && !endTargetId) ||
    (!!startTargetId && startTargetId === endTargetId) ||
    ![anchors.start.x, anchors.start.y, anchors.end.x, anchors.end.y]
      .every(Number.isFinite)
  ) {
    return scene;
  }
  const arrow = scene.elements.find((item) => item.id === arrowId);
  if (
    !arrow ||
    arrow.type !== "arrow" ||
    arrow.isDeleted ||
    arrow.locked ||
    arrow.elbowed ||
    arrow.points.length !== 2 ||
    arrow.startBinding ||
    arrow.endBinding ||
    arrow.boundElements?.length ||
    arrow.frameId !== null ||
    arrow.groupIds.length !== 0
  ) {
    return scene;
  }
  for (const id of [startTargetId, endTargetId]) {
    if (!id) {
      continue;
    }
    const target = scene.elements.find((item) => item.id === id);
    if (
      !target ||
      target.isDeleted ||
      target.locked ||
      target.frameId !== null ||
      target.groupIds.length !== 0 ||
      !["rectangle", "ellipse", "diamond"].includes(target.type)
    ) {
      return scene;
    }
  }
  return withNativeCoreScene(scene, (core) => {
    const current = core.getNonDeletedElement(arrowId);
    if (!current || current.type !== "arrow") {
      return;
    }
    for (const [endpoint, targetId] of [
      ["start", startTargetId],
      ["end", endTargetId],
    ] as const) {
      if (!targetId) {
        continue;
      }
      const target = core.getNonDeletedElement(targetId);
      if (!target) {
        return;
      }
      bindAndAnchorNativeArrowEndpoint(
        current,
        target as NonDeleted<ExcalidrawBindableElement>,
        endpoint,
        anchors[endpoint],
        core,
      );
    }
  });
}

/**
 * Reconnect one endpoint of a *validated* ordinary two-point arrow using
 * Excalidraw's own local point editor and reciprocal binding lifecycle.
 *
 * This adapter does not hit-test or decide whether a foreign scene is safe
 * to edit. Those remain responsibilities of native/bindings.ts. It never
 * modifies the input scene and refuses missing/deleted/non-simple targets.
 */
export function reconnectNativeArrowWithCore(
  scene: SceneFile,
  arrowId: string,
  endpoint: "start" | "end",
  worldPoint: { x: number; y: number },
  targetId: string | null,
): SceneFile {
  if (!Number.isFinite(worldPoint.x) || !Number.isFinite(worldPoint.y)) {
    return scene;
  }
  const arrow = scene.elements.find((item) => item.id === arrowId);
  const target = targetId
    ? scene.elements.find((item) => item.id === targetId)
    : null;
  if (
    !arrow ||
    arrow.type !== "arrow" ||
    arrow.isDeleted ||
    arrow.locked ||
    arrow.elbowed ||
    arrow.points.length !== 2 ||
    arrow.groupIds.length !== 0 ||
    arrow.frameId !== null ||
    arrow.boundElements?.length ||
    (targetId !== null &&
      (!target ||
        target.isDeleted ||
        target.locked ||
        target.frameId !== null ||
        target.groupIds.length !== 0 ||
        !["rectangle", "ellipse", "diamond"].includes(target.type))) ||
    (targetId !== null &&
      targetId ===
        arrow[endpoint === "start" ? "endBinding" : "startBinding"]?.elementId)
  ) {
    return scene;
  }
  return withNativeCoreScene(scene, (core) => {
    const current = core.getNonDeletedElement(arrowId);
    if (!current || current.type !== "arrow") {
      return;
    }
    const nextTarget = targetId ? core.getNonDeletedElement(targetId) : null;
    const map = core.getNonDeletedElementsMap();

    // Core owns local-coordinate normalization, including when the first
    // point moves and the second point must stay fixed in world coordinates.
    const localPoint = LinearElementEditor.createPointAt(
      current,
      map,
      worldPoint.x,
      worldPoint.y,
      null,
    );
    LinearElementEditor.movePoints(
      current,
      core,
      new Map([[endpoint === "start" ? 0 : 1, { point: localPoint }]]),
    );

    // Always unbind before binding (including on the same target) so the
    // reciprocal target list cannot accumulate duplicate arrow references.
    const previousBinding =
      current[endpoint === "start" ? "startBinding" : "endBinding"];
    unbindBindingElement(current, endpoint, core);
    const previousTarget = previousBinding
      ? core.getNonDeletedElement(previousBinding.elementId)
      : null;
    // Native scenes represent an empty reverse list with null. Excalidraw's
    // unbind helper leaves [] in this case; normalize only that representation.
    if (previousTarget?.boundElements?.length === 0) {
      core.mutateElement(previousTarget, { boundElements: null });
    }
    if (nextTarget) {
      bindAndAnchorNativeArrowEndpoint(
        current,
        nextTarget as NonDeleted<ExcalidrawBindableElement>,
        endpoint,
        worldPoint,
        core,
      );
    }
  });
}

/**
 * Safe scope for editing nodes of unbound open lines and non-elbow arrows.
 * An imported path with an unsupported relationship remains read-only.
 */
export const canEditNativeLinearPoints = (
  element: ExcalidrawElement,
): element is Extract<ExcalidrawElement, { type: "line" | "arrow" }> =>
  (element.type === "line" || element.type === "arrow") &&
  !element.isDeleted &&
  !element.locked &&
  element.frameId === null &&
  element.groupIds.length === 0 &&
  !element.boundElements?.length &&
  !element.startBinding &&
  !element.endBinding &&
  (element.type === "line"
    ? !element.polygon
    : !element.elbowed &&
      !("fixedSegments" in element && element.fixedSegments != null)) &&
  element.points.length >= 2 &&
  element.points.length <= 128 &&
  [element.x, element.y, element.width, element.height, element.angle]
    .every(Number.isFinite) &&
  element.width >= 0 &&
  element.height >= 0 &&
  element.points.every(
    (point) =>
      point.length === 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1]),
  );

/**
 * Move any point of an ordinary unbound polyline/arrow using Excalidraw's
 * original `LinearElementEditor` point normalization and motion.
 *
 * This generic point handler also supports the former two-endpoint workflow.
 * It validates *all* other world points rather than merely the opposite end
 * to catch unintended geometry drift in rotated and reversed imports.
 */
export function moveNativeLinearPointWithCore(
  scene: SceneFile,
  id: string,
  pointIndex: number,
  pointer: { x: number; y: number },
): SceneFile {
  const original = scene.elements.find((item) => item.id === id);
  if (
    !original ||
    !canEditNativeLinearPoints(original) ||
    !Number.isInteger(pointIndex) ||
    pointIndex < 0 ||
    pointIndex >= original.points.length ||
    !Number.isFinite(pointer.x) ||
    !Number.isFinite(pointer.y) ||
    scene.elements.some(
      (item) =>
        item.id !== id &&
        !item.isDeleted &&
        ((item.type === "text" && item.containerId === id) ||
          item.boundElements?.some((ref) => ref.id === id)),
    )
  ) {
    return scene;
  }

  const sourceMap = nativeElementsMap(scene);
  const before = LinearElementEditor.getPointsGlobalCoordinates(
    original,
    sourceMap,
  );
  if (
    !before.every((p) => p.every(Number.isFinite)) ||
    Math.hypot(
      before[pointIndex][0] - pointer.x,
      before[pointIndex][1] - pointer.y,
    ) < 1e-8
  ) {
    return scene;
  }

  const projected = withNativeCoreScene(scene, (core) => {
    const current = core.getNonDeletedElement(id);
    if (!current || (current.type !== "line" && current.type !== "arrow")) {
      return;
    }
    // Excalidraw's own normalization puts the first local point at [0, 0].
    // Required for source/imported reversed polylines as well as native ones.
    if (
      Math.abs(current.points[0][0]) > 1e-8 ||
      Math.abs(current.points[0][1]) > 1e-8
    ) {
      const normalized =
        LinearElementEditor.getNormalizeElementPointsAndCoords(current);
      core.mutateElement(current, normalized);
    }
    const local = LinearElementEditor.createPointAt(
      current,
      core.getNonDeletedElementsMap(),
      pointer.x,
      pointer.y,
      null,
    );
    LinearElementEditor.movePoints(
      current,
      core,
      new Map([[pointIndex, { point: local }]]),
    );
  });
  if (projected === scene) {
    return scene;
  }
  const changed = projected.elements.find((item) => item.id === id);
  if (
    !changed ||
    (changed.type !== "line" && changed.type !== "arrow") ||
    changed.points.length !== original.points.length ||
    !canEditNativeLinearPoints(changed) ||
    projected.elements.some(
      (item, index) => item.id !== id && item !== scene.elements[index],
    )
  ) {
    return scene;
  }
  const after = LinearElementEditor.getPointsGlobalCoordinates(
    changed,
    nativeElementsMap(projected),
  );
  if (
    after.length !== before.length ||
    after.some(
      (point, i) =>
        !point.every(Number.isFinite) ||
        Math.hypot(
          point[0] - (i === pointIndex ? pointer.x : before[i][0]),
          point[1] - (i === pointIndex ? pointer.y : before[i][1]),
        ) > 0.01,
    )
  ) {
    return scene;
  }

  // Apply the verified core geometry once with official metadata/version
  // logic, keeping the original imported extension fields and file/order.
  const updated = updateNativeElement(original, {
    x: changed.x,
    y: changed.y,
    width: changed.width,
    height: changed.height,
    angle: changed.angle,
    points: changed.points,
  });
  return updated === original
    ? scene
    : {
        ...scene,
        elements: scene.elements.map((item) =>
          item.id === id ? updated : item,
        ),
      };
}

/** Backwards-compatible two-point endpoint adapter. */
export function moveNativeLinearEndpointWithCore(
  scene: SceneFile,
  id: string,
  endpoint: "start" | "end",
  pointer: { x: number; y: number },
): SceneFile {
  const element = scene.elements.find((item) => item.id === id);
  if (!element || !canEditNativeLinearPoints(element) ||
      element.points.length !== 2) {
    return scene;
  }
  return moveNativeLinearPointWithCore(
    scene,
    id,
    endpoint === "start" ? 0 : element.points.length - 1,
    pointer,
  );
}

/**
 * Insert a midpoint in a safe unbound linear path, or remove an internal
 * vertex. Both operations call Excalidraw's original LinearElementEditor
 * methods in the isolated Scene and validate every surviving world vertex.
 *
 * The Excalidraw methods read only the fields supplied here from the React
 * editor state: addMidpoint needs elementId and initialState.segmentMidpoint,
 * while deletePoints needs app.scene and app.state.selectedLinearElement.
 * No React editor is instantiated, and snap-to-grid is explicitly disabled.
 */
function editNativeLinearTopologyWithCore(
  scene: SceneFile,
  id: string,
  index: number,
  action: "insert" | "remove",
): SceneFile {
  const original = scene.elements.find((item) => item.id === id);
  if (
    !original ||
    !canEditNativeLinearPoints(original) ||
    !Number.isInteger(index) ||
    (action === "insert"
      ? index < 0 || index >= original.points.length - 1 ||
        original.points.length >= 128
      : index <= 0 || index >= original.points.length - 1 ||
        original.points.length <= 2) ||
    scene.elements.some(
      (other) =>
        !other.isDeleted &&
        other.id !== id &&
        ((other.type === "text" && other.containerId === id) ||
          other.boundElements?.some((ref) => ref.id === id)),
    )
  ) {
    return scene;
  }
  const map = nativeElementsMap(scene);
  let before: ReturnType<typeof LinearElementEditor.getPointsGlobalCoordinates>;
  let midpoint: ReturnType<typeof LinearElementEditor.getSegmentMidPoint> | null = null;
  try {
    before = LinearElementEditor.getPointsGlobalCoordinates(original, map);
    if (action === "insert") {
      midpoint = LinearElementEditor.getSegmentMidPoint(original, index + 1, map);
    }
  } catch {
    return scene;
  }
  if (
    !before.every((p) => p.every(Number.isFinite)) ||
    (midpoint !== null && !midpoint.every(Number.isFinite))
  ) {
    return scene;
  }
  const expected = action === "insert" && midpoint
    ? [
        ...before.slice(0, index + 1),
        midpoint,
        ...before.slice(index + 1),
      ]
    : before.filter((_, i) => i !== index);

  let projected: SceneFile;
  try {
    projected = withNativeCoreScene(scene, (core) => {
      const current = core.getNonDeletedElement(id);
      if (!current || (current.type !== "line" && current.type !== "arrow")) {
        return;
      }
      if (
        Math.abs(current.points[0][0]) > 1e-8 ||
        Math.abs(current.points[0][1]) > 1e-8
      ) {
        core.mutateElement(
          current,
          LinearElementEditor.getNormalizeElementPointsAndCoords(current),
        );
      }

      if (action === "insert" && midpoint) {
        // Original addMidpoint obtains its point through createPointAt
        // and inserts it at initialState.segmentMidpoint.index.
        const editor = {
          elementId: id,
          selectedPointsIndices: null,
          initialState: {
            segmentMidpoint: { index: index + 1, added: false },
            lastClickedPoint: null,
          },
        } as unknown as LinearElementEditor;
        LinearElementEditor.addMidpoint(
          editor,
          { x: midpoint[0], y: midpoint[1] } as Parameters<
            typeof LinearElementEditor.addMidpoint
          >[1],
          {} as AppClassProperties,
          false,
          core,
        );
      } else if (action === "remove") {
        LinearElementEditor.deletePoints(
          current,
          {
            scene: core,
            state: { selectedLinearElement: null },
          } as AppClassProperties,
          [index],
        );
      }
    });
  } catch {
    // Invalid third-party imported geometry must not partially edit a scene.
    return scene;
  }
  if (projected === scene) {
    return scene;
  }
  const changed = projected.elements.find((item) => item.id === id);
  if (
    !changed ||
    !canEditNativeLinearPoints(changed) ||
    changed.points.length !== expected.length ||
    projected.elements.some((item, i) =>
      item.id !== id && item !== scene.elements[i]
    )
  ) {
    return scene;
  }
  let after: ReturnType<typeof LinearElementEditor.getPointsGlobalCoordinates>;
  try {
    after = LinearElementEditor.getPointsGlobalCoordinates(
      changed,
      nativeElementsMap(projected),
    );
  } catch {
    return scene;
  }
  if (
    after.length !== expected.length ||
    after.some(
      (point, i) =>
        !point.every(Number.isFinite) ||
        Math.hypot(
          point[0] - expected[i][0],
          point[1] - expected[i][1],
        ) > 0.01,
    )
  ) {
    return scene;
  }
  const updated = updateNativeElement(original, {
    x: changed.x,
    y: changed.y,
    width: changed.width,
    height: changed.height,
    angle: changed.angle,
    points: changed.points,
  });
  return updated === original
    ? scene
    : {
        ...scene,
        elements: scene.elements.map((item) =>
          item.id === id ? updated : item,
        ),
      };
}

export const insertNativeLinearMidpointWithCore = (
  scene: SceneFile,
  id: string,
  segmentIndex: number,
): SceneFile => editNativeLinearTopologyWithCore(scene, id, segmentIndex, "insert");

export const deleteNativeLinearMidpointWithCore = (
  scene: SceneFile,
  id: string,
  pointIndex: number,
): SceneFile => editNativeLinearTopologyWithCore(scene, id, pointIndex, "remove");

/**
 * Native Svelte's safe orbit-binding bridge. The binding policy (including
 * orphan checks) is enforced by native/bindings.ts before invoking this
 * adapter; this function only delegates core point motion, bind/unbind and
 * rerouting. No custom fixed-point ratios or hand-authored bend geometry.
 */
export function reconnectNativeOrbitElbowWithCore(
  scene: SceneFile,
  arrowId: string,
  endpoint: "start" | "end",
  pointer: { x: number; y: number },
  targetId: string | null,
): SceneFile {
  const arrow = scene.elements.find((item) => item.id === arrowId);
  const target = targetId
    ? scene.elements.find((item) => item.id === targetId)
    : null;
  if (
    !isElbowArrow(arrow) ||
    arrow.isDeleted ||
    arrow.locked ||
    arrow.frameId !== null ||
    arrow.groupIds.length !== 0 ||
    arrow.fixedSegments?.length ||
    arrow.boundElements?.length ||
    arrow.points.length < 2 ||
    ![pointer.x, pointer.y].every(Number.isFinite) ||
    (targetId !== null &&
      (!target ||
        target.isDeleted ||
        target.locked ||
        target.frameId !== null ||
        target.groupIds.length !== 0 ||
        !["rectangle", "ellipse", "diamond"].includes(target.type))) ||
    (targetId !== null &&
      arrow[endpoint === "start" ? "endBinding" : "startBinding"]
        ?.elementId === targetId)
  ) {
    return scene;
  }
  try {
    return withNativeCoreScene(scene, (core) => {
      const current = core.getNonDeletedElement(arrowId);
      if (!current || !isElbowArrow(current)) {
        return;
      }

      // Break the previous reciprocal link first. When moving a bound
      // endpoint, its old target must not influence the next router pass.
      const previousBinding = current[
        endpoint === "start" ? "startBinding" : "endBinding"
      ];
      if (previousBinding) {
        unbindBindingElement(current, endpoint, core);
        const previousTarget = core.getNonDeletedElement(
          previousBinding.elementId,
        );
        if (previousTarget?.boundElements?.length === 0) {
          core.mutateElement(previousTarget, { boundElements: null });
        }
      }

      const point = LinearElementEditor.createPointAt(
        current,
        core.getNonDeletedElementsMap(),
        pointer.x,
        pointer.y,
        null,
      );
      LinearElementEditor.movePoints(
        current,
        core,
        new Map([[
          endpoint === "start" ? 0 : current.points.length - 1,
          { point },
        ]]),
        undefined,
        { isBindingEnabled: false },
      );

      if (targetId) {
        const nextTarget = core.getNonDeletedElement(targetId);
        if (!nextTarget) {
          throw new Error("Orbit binding target disappeared");
        }
        bindBindingElement(
          current,
          nextTarget as NonDeleted<ExcalidrawBindableElement>,
          "orbit",
          endpoint,
          core,
          { value: 1 } as Parameters<typeof bindBindingElement>[5],
        );
      }

      // A binding-only mutation need not reroute an elbow: the Scene point
      // update asks Excalidraw to recalculate its orthogonal route and
      // anchor locations using the newly linked target.
      core.mutateElement(
        current,
        {
          points: [...current.points],
        },
        { isBindingEnabled: false },
      );
    });
  } catch {
    return scene;
  }
}

/**
 * Scope of native elbow work: a well-formed orthogonal, unbound elbow
 * with no fixed segments, labels, groups or foreign references. Binding an
 * elbow uses orbit semantics and must not reuse the ordinary inside-link UI.
 */
export const canEditNativeElbowArrow = (
  element: ExcalidrawElement,
): element is ExcalidrawElbowArrowElement =>
  isElbowArrow(element) &&
  !element.isDeleted &&
  !element.locked &&
  element.frameId === null &&
  element.groupIds.length === 0 &&
  !element.startBinding &&
  !element.endBinding &&
  !element.boundElements?.length &&
  (element.fixedSegments == null ||
    (Array.isArray(element.fixedSegments) && element.fixedSegments.length === 0)) &&
  element.angle === 0 &&
  Array.isArray(element.points) &&
  element.points.length >= 2 &&
  element.points.length <= 128 &&
  [element.x, element.y, element.width, element.height].every(Number.isFinite) &&
  element.points.every((point) =>
    point.length === 2 && point.every(Number.isFinite)
  ) &&
  element.points.slice(1).every((p, i) =>
    Math.abs(p[0] - element.points[i][0]) < 1e-6 ||
    Math.abs(p[1] - element.points[i][1]) < 1e-6
  );

/**
 * Reuse the same conversion boundary as Excalidraw's changeArrowType action:
 * construct a zero-angle elbow starting at the source's global first point
 * and let updateElbowArrowPoints compute its route. Never hand-roll bends.
 */
export function convertNativeArrowToElbowWithCore(
  scene: SceneFile,
  id: string,
): SceneFile {
  const original = scene.elements.find((item) => item.id === id);
  if (
    !original ||
    original.type !== "arrow" ||
    original.elbowed ||
    !canEditNativeLinearPoints(original) ||
    original.points.length !== 2 ||
    scene.elements.some((other) =>
      other.id !== id &&
      !other.isDeleted &&
      ((other.type === "text" && other.containerId === id) ||
        other.boundElements?.some((ref) => ref.id === id))
    )
  ) {
    return scene;
  }

  const map = nativeElementsMap(scene);
  const start = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    original, 0, map,
  );
  const end = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    original, -1, map,
  );
  if (![...start, ...end].every(Number.isFinite) ||
      Math.hypot(end[0] - start[0], end[1] - start[1]) < 1) {
    return scene;
  }

  let candidate: ExcalidrawElbowArrowElement;
  try {
    // A horizontal initial segment satisfies the elbow router's source
    // invariant; the requested end point goes through the core update.
    const template = {
      ...original,
      x: start[0],
      y: start[1],
      angle: 0,
      roundness: null,
      elbowed: true,
      points: [
        pointFrom(0, 0),
        pointFrom(end[0] - start[0] || 1, 0),
      ],
      fixedSegments: null,
      startIsSpecial: false,
      endIsSpecial: false,
    } as ExcalidrawElbowArrowElement;
    const route = updateElbowArrowPoints(
      template,
      map as Parameters<typeof updateElbowArrowPoints>[1],
      {
        points: [
          pointFrom(0, 0),
          pointFrom(end[0] - start[0], end[1] - start[1]),
        ],
        fixedSegments: null,
        startBinding: null,
        endBinding: null,
      },
      { isBindingEnabled: false },
    );
    candidate = {
      ...template,
      ...route,
    };
  } catch {
    return scene;
  }
  if (
    !canEditNativeElbowArrow(candidate) ||
    !validateElbowPoints(candidate.points) ||
    Math.hypot(candidate.x + candidate.points[0][0] - start[0],
      candidate.y + candidate.points[0][1] - start[1]) > 0.1 ||
    Math.hypot(
      candidate.x + candidate.points[candidate.points.length - 1][0] - end[0],
      candidate.y + candidate.points[candidate.points.length - 1][1] - end[1],
    ) > 0.1
  ) {
    return scene;
  }
  const next = updateNativeElement(original, {
    elbowed: true,
    angle: candidate.angle,
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
    roundness: candidate.roundness,
    points: candidate.points,
    fixedSegments: candidate.fixedSegments,
    startIsSpecial: candidate.startIsSpecial,
    endIsSpecial: candidate.endIsSpecial,
  } as ElementUpdate<typeof original>);
  return next === original
    ? scene
    : { ...scene, elements: scene.elements.map((item) =>
      item.id === id ? next : item
    ) };
}

/**
 * Endpoint dragging delegates to the original LinearElementEditor, whose
 * Scene.mutateElement triggers updateElbowArrowPoints / orthogonal rerouting.
 */
export function moveNativeElbowEndpointWithCore(
  scene: SceneFile,
  id: string,
  endpoint: "start" | "end",
  pointer: { x: number; y: number },
): SceneFile {
  const original = scene.elements.find((item) => item.id === id);
  if (
    !original ||
    !canEditNativeElbowArrow(original) ||
    ![pointer.x, pointer.y].every(Number.isFinite) ||
    scene.elements.some((other) =>
      other.id !== id &&
      !other.isDeleted &&
      ((other.type === "text" && other.containerId === id) ||
        other.boundElements?.some((ref) => ref.id === id))
    )
  ) {
    return scene;
  }
  const map = nativeElementsMap(scene);
  const first = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    original, 0, map,
  );
  const last = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    original, -1, map,
  );
  const anchored = endpoint === "start" ? last : first;
  const previous = endpoint === "start" ? first : last;
  if (Math.hypot(pointer.x - previous[0], pointer.y - previous[1]) < 1e-8) {
    return scene;
  }

  let projected: SceneFile;
  try {
    projected = withNativeCoreScene(scene, (core) => {
      const current = core.getNonDeletedElement(id);
      if (!current || !isElbowArrow(current)) {
        return;
      }
      const point = LinearElementEditor.createPointAt(
        current,
        core.getNonDeletedElementsMap(),
        pointer.x,
        pointer.y,
        null,
      );
      LinearElementEditor.movePoints(
        current,
        core,
        new Map([[
          endpoint === "start" ? 0 : current.points.length - 1,
          { point },
        ]]),
        undefined,
        { isBindingEnabled: false },
      );
    });
  } catch {
    return scene;
  }
  const next = projected.elements.find((item) => item.id === id);
  if (
    projected === scene ||
    !next ||
    !canEditNativeElbowArrow(next) ||
    !validateElbowPoints(next.points) ||
    projected.elements.some((item, i) =>
      item.id !== id && item !== scene.elements[i]
    )
  ) {
    return scene;
  }
  const afterMap = nativeElementsMap(projected);
  const afterFirst = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    next, 0, afterMap,
  );
  const afterLast = LinearElementEditor.getPointAtIndexGlobalCoordinates(
    next, -1, afterMap,
  );
  const moved = endpoint === "start" ? afterFirst : afterLast;
  const stable = endpoint === "start" ? afterLast : afterFirst;
  if (
    Math.hypot(stable[0] - anchored[0], stable[1] - anchored[1]) > 0.1 ||
    Math.hypot(moved[0] - pointer.x, moved[1] - pointer.y) > 0.1
  ) {
    return scene;
  }
  return projected;
}

/**
 * An uncropped embedded raster image can use the Excalidraw transform engine
 * without needing crop-coordinate or external binary asset reconciliation.
 * All reverse links must be absent, including orphaned imported references.
 */
const canCoreTransformImage = (
  scene: SceneFile,
  id: string,
): boolean => {
  const element = scene.elements.find((item) => item.id === id);
  if (
    !element ||
    element.type !== "image" ||
    element.isDeleted ||
    element.locked ||
    element.frameId !== null ||
    element.groupIds.length !== 0 ||
    element.boundElements?.length ||
    element.crop !== null ||
    !nativeImageSource(scene, element) ||
    !Number.isFinite(element.x) ||
    !Number.isFinite(element.y) ||
    !Number.isFinite(element.width) ||
    !Number.isFinite(element.height) ||
    !Number.isFinite(element.angle) ||
    element.width <= 0 ||
    element.height <= 0 ||
    element.scale.length !== 2 ||
    element.scale.some((value) => value !== 1 && value !== -1) ||
    scene.elements.some((other) =>
      !other.isDeleted &&
      other.id !== id &&
      ((other.type === "text" && other.containerId === id) ||
        (other.type === "arrow" &&
          (other.startBinding?.elementId === id ||
            other.endBinding?.elementId === id)) ||
        other.boundElements?.some((ref) => ref.id === id))
    )
  ) {
    return false;
  }
  return true;
};

/** Fail closed if core mutates the image file/crop/flip or unrelated data. */
const acceptCoreImageTransform = (
  source: SceneFile,
  next: SceneFile,
  id: string,
): SceneFile => {
  if (next === source) {
    return source;
  }
  const prev = source.elements.find((item) => item.id === id);
  const image = next.elements.find((item) => item.id === id);
  if (
    !prev ||
    prev.type !== "image" ||
    !image ||
    image.type !== "image" ||
    image.isDeleted ||
    image.fileId !== prev.fileId ||
    image.status !== prev.status ||
    image.crop !== null ||
    !Array.isArray(image.scale) ||
    image.scale.length !== 2 ||
    image.scale[0] !== prev.scale[0] ||
    image.scale[1] !== prev.scale[1] ||
    image.groupIds.length !== 0 ||
    image.boundElements?.length ||
    ![image.x, image.y, image.width, image.height, image.angle]
      .every(Number.isFinite) ||
    image.width <= 0 ||
    image.height <= 0 ||
    Math.abs(image.width / image.height - prev.width / prev.height) > 1e-6 ||
    next.files !== source.files ||
    next.elements.some((item, index) =>
      item.id !== id && item !== source.elements[index]
    )
  ) {
    return source;
  }
  return next;
};

/** Use original aspect-locked single resize for safe embedded images. */
export function resizeNativeImageWithCore(
  scene: SceneFile,
  id: string,
  handle: "nw" | "ne" | "sw" | "se",
  pointer: { x: number; y: number },
): SceneFile {
  if (
    !canCoreTransformImage(scene, id) ||
    !Number.isFinite(pointer.x) ||
    !Number.isFinite(pointer.y)
  ) {
    return scene;
  }
  const image = scene.elements.find((item) => item.id === id);
  if (!image || image.type !== "image") {
    return scene;
  }
  const { nextWidth, nextHeight } =
    getNextSingleWidthAndHeightFromPointer(
      image,
      image,
      handle,
      pointer.x,
      pointer.y,
      { shouldMaintainAspectRatio: true },
    );
  if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) {
    return scene;
  }
  // Native policy does not flip across the opposite edge; clamp instead.
  // Excalidraw supplies the *uniform scale factor* from pointer projection.
  const minScale = Math.max(8 / image.width, 8 / image.height);
  const scale = nextWidth <= 0 || nextHeight <= 0
    ? minScale
    : Math.max(minScale, nextWidth / image.width);
  if (
    !Number.isFinite(scale) ||
    !Number.isFinite(image.width * scale) ||
    !Number.isFinite(image.height * scale)
  ) {
    return scene;
  }
  const resized = withNativeCoreScene(scene, (core) => {
    const target = core.getNonDeletedElement(id);
    if (!target || target.type !== "image") {
      return;
    }
    const originals = new Map(
      core.getNonDeletedElements().map((item) => [item.id, structuredClone(item)]),
    ) as ElementsMap;
    const original = originals.get(id);
    if (!original) {
      return;
    }
    resizeSingleElement(
      image.width * scale,
      image.height * scale,
      target,
      original as NonDeletedExcalidrawElement,
      originals,
      core,
      handle,
      {
        shouldMaintainAspectRatio: true,
        shouldResizeFromCenter: false,
      },
    );
  });
  return acceptCoreImageTransform(scene, resized, id);
}

/** Use original Excalidraw rotation for safe uncropped images. */
export function rotateNativeImageWithCore(
  scene: SceneFile,
  id: string,
  pointer: { x: number; y: number },
): SceneFile {
  if (
    !canCoreTransformImage(scene, id) ||
    !Number.isFinite(pointer.x) ||
    !Number.isFinite(pointer.y)
  ) {
    return scene;
  }
  const image = scene.elements.find((item) => item.id === id);
  if (!image || image.type !== "image") {
    return scene;
  }
  const rotated = withNativeCoreScene(scene, (core) => {
    const target = core.getNonDeletedElement(id);
    if (!target || target.type !== "image") {
      return;
    }
    const originals = new Map<string, NonDeleted<ExcalidrawElement>>();
    for (const item of core.getNonDeletedElements()) {
      originals.set(item.id, structuredClone(item));
    }
    transformElements(
      originals,
      "rotation",
      [target],
      core,
      false,
      false,
      false,
      pointer.x,
      pointer.y,
      image.x + image.width / 2,
      image.y + image.height / 2,
    );
  });
  return acceptCoreImageTransform(scene, rotated, id);
}

/**
 * Uncropped embedded raster images can use core transforms without the
 * crop/binary reconciliation required by complex imported images.
 */
const canCoreTransformImage = (scene: SceneFile, id: string): boolean => {
  const element = scene.elements.find((item) => item.id === id);
  return !!element &&
    element.type === "image" &&
    !element.isDeleted &&
    !element.locked &&
    element.frameId === null &&
    element.groupIds.length === 0 &&
    !element.boundElements?.length &&
    element.crop === null &&
    !!nativeImageSource(scene, element) &&
    [element.x, element.y, element.width, element.height, element.angle]
      .every(Number.isFinite) &&
    element.width > 0 &&
    element.height > 0 &&
    Array.isArray(element.scale) &&
    element.scale.length === 2 &&
    element.scale.every((value) => value === 1 || value === -1) &&
    !scene.elements.some((other) =>
      !other.isDeleted &&
      other.id !== id &&
      ((other.type === "text" && other.containerId === id) ||
        (other.type === "arrow" &&
          (other.startBinding?.elementId === id ||
            other.endBinding?.elementId === id)) ||
        other.boundElements?.some((ref) => ref.id === id))
    );
};

/** Adopt only a valid image-only geometry mutation, preserving binary data. */
const acceptCoreImageTransform = (
  source: SceneFile,
  next: SceneFile,
  id: string,
): SceneFile => {
  if (next === source) {
    return source;
  }
  const prev = source.elements.find((item) => item.id === id);
  const image = next.elements.find((item) => item.id === id);
  if (
    !prev ||
    prev.type !== "image" ||
    !image ||
    image.type !== "image" ||
    image.isDeleted ||
    image.fileId !== prev.fileId ||
    image.status !== prev.status ||
    image.crop !== null ||
    image.scale[0] !== prev.scale[0] ||
    image.scale[1] !== prev.scale[1] ||
    image.groupIds.length !== 0 ||
    image.boundElements?.length ||
    ![image.x, image.y, image.width, image.height, image.angle]
      .every(Number.isFinite) ||
    image.width <= 0 ||
    image.height <= 0 ||
    next.files !== source.files ||
    next.elements.some((item, index) =>
      item.id !== id && item !== source.elements[index]
    )
  ) {
    return source;
  }
  return next;
};

/** Use original Excalidraw aspect-locked resize for an uncropped image. */
export function resizeNativeImageWithCore(
  scene: SceneFile,
  id: string,
  handle: "nw" | "ne" | "sw" | "se",
  pointer: { x: number; y: number },
): SceneFile {
  if (
    !canCoreTransformImage(scene, id) ||
    !Number.isFinite(pointer.x) ||
    !Number.isFinite(pointer.y)
  ) {
    return scene;
  }
  const image = scene.elements.find((item) => item.id === id);
  if (!image || image.type !== "image") {
    return scene;
  }
  const { nextWidth, nextHeight } =
    getNextSingleWidthAndHeightFromPointer(
      image,
      image,
      handle,
      pointer.x,
      pointer.y,
      { shouldMaintainAspectRatio: true },
    );
  if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) {
    return scene;
  }
  // Native UI clamps at the opposite edge rather than flipping the raster.
  // Excalidraw supplies the uniform scale from pointer projection.
  const minScale = Math.max(8 / image.width, 8 / image.height);
  const scale = nextWidth <= 0 || nextHeight <= 0
    ? minScale
    : Math.max(minScale, nextWidth / image.width);
  const resized = withNativeCoreScene(scene, (core) => {
    const target = core.getNonDeletedElement(id);
    if (!target || target.type !== "image") {
      return;
    }
    const originals = new Map(
      core.getNonDeletedElements().map((item) => [item.id, structuredClone(item)]),
    ) as ElementsMap;
    const original = originals.get(id);
    if (!original) {
      return;
    }
    resizeSingleElement(
      image.width * scale,
      image.height * scale,
      target,
      original as NonDeletedExcalidrawElement,
      originals,
      core,
      handle,
      {
        shouldMaintainAspectRatio: true,
        shouldResizeFromCenter: false,
      },
    );
  });
  return acceptCoreImageTransform(scene, resized, id);
}

/** Use original Excalidraw rotation for an uncropped image. */
export function rotateNativeImageWithCore(
  scene: SceneFile,
  id: string,
  pointer: { x: number; y: number },
): SceneFile {
  if (
    !canCoreTransformImage(scene, id) ||
    !Number.isFinite(pointer.x) ||
    !Number.isFinite(pointer.y)
  ) {
    return scene;
  }
  const image = scene.elements.find((item) => item.id === id);
  if (!image || image.type !== "image") {
    return scene;
  }
  const rotated = withNativeCoreScene(scene, (core) => {
    const target = core.getNonDeletedElement(id);
    if (!target || target.type !== "image") {
      return;
    }
    const originals = new Map<string, NonDeleted<ExcalidrawElement>>();
    for (const item of core.getNonDeletedElements()) {
      originals.set(item.id, structuredClone(item));
    }
    transformElements(
      originals,
      "rotation",
      [target],
      core,
      false,
      false,
      false,
      pointer.x,
      pointer.y,
      image.x + image.width / 2,
      image.y + image.height / 2,
    );
  });
  return acceptCoreImageTransform(scene, rotated, id);
}

/**
 * A single reciprocal label is safe for core's built-in text-resize handler.
 * Reject malformed imported links and foreign/locked text before mutation.
 * Returns null for an independent box and undefined for an unsafe binding.
 */
const safeResizeLabel = (
  scene: SceneFile,
  element: ExcalidrawElement,
): ExcalidrawTextElement | null | undefined => {
  const refs = element.boundElements;
  if (!refs?.length) {
    return null;
  }
  if (refs.length !== 1 || refs[0].type !== "text") {
    return undefined;
  }
  const label = scene.elements.find((item) => item.id === refs[0].id);
  if (
    !label ||
    label.type !== "text" ||
    label.isDeleted ||
    label.locked ||
    label.frameId ||
    label.groupIds.length !== 0 ||
    label.containerId !== element.id ||
    !label.autoResize ||
    label.boundElements?.length ||
    scene.elements.some((item) =>
      !item.isDeleted &&
      item.id !== element.id &&
      item.boundElements?.some((ref) => ref.id === label.id)
    ) ||
    !Number.isFinite(label.fontSize) ||
    !Number.isFinite(label.width) ||
    !Number.isFinite(label.height) ||
    label.width < 0 ||
    label.height < 0 ||
    element.width <= 20 ||
    element.height <= 20
  ) {
    return undefined;
  }
  return label;
};

/** Shared safety boundary for core rotation and resize of native boxes. */
const canCoreTransformBox = (
  scene: SceneFile,
  element: ExcalidrawElement,
  label: ExcalidrawTextElement | null | undefined,
): boolean =>
  ["rectangle", "ellipse", "diamond"].includes(element.type) &&
  !element.isDeleted &&
  !element.locked &&
  !element.frameId &&
  element.groupIds.length === 0 &&
  label !== undefined &&
  Number.isFinite(element.width) &&
  Number.isFinite(element.height) &&
  element.width > 0 &&
  element.height > 0 &&
  !scene.elements.some(
    (other) =>
      other.id !== element.id &&
      !other.isDeleted &&
      ((other.type === "text" &&
        other.id !== label?.id &&
        other.containerId === element.id) ||
        (other.type === "arrow" &&
          (other.startBinding?.elementId === element.id ||
            other.endBinding?.elementId === element.id))),
  );

/**
 * Check that core reflow preserved both ends of the only text binding. This
 * atomic postcondition is shared by native resize and rotation.
 */
const acceptCoreLabelResult = (
  source: SceneFile,
  result: SceneFile,
  id: string,
  label: ExcalidrawTextElement | null,
): SceneFile => {
  if (!label || result === source) {
    return result;
  }
  const boxAfter = result.elements.find((item) => item.id === id);
  const labelAfter = result.elements.find((item) => item.id === label.id);
  if (
    !boxAfter ||
    !labelAfter ||
    labelAfter.type !== "text" ||
    boxAfter.isDeleted ||
    labelAfter.isDeleted ||
    boxAfter.width <= 20 ||
    boxAfter.height <= 20 ||
    boxAfter.boundElements?.length !== 1 ||
    boxAfter.boundElements[0].id !== label.id ||
    boxAfter.boundElements[0].type !== "text" ||
    labelAfter.containerId !== id ||
    labelAfter.originalText !== label.originalText ||
    !labelAfter.autoResize ||
    labelAfter.locked ||
    labelAfter.frameId !== null ||
    labelAfter.groupIds.length !== 0 ||
    !Number.isFinite(labelAfter.fontSize) ||
    Math.abs(Math.sin(labelAfter.angle - boxAfter.angle)) > 1e-6 ||
    Math.abs(Math.cos(labelAfter.angle - boxAfter.angle) - 1) > 1e-6 ||
    ![boxAfter.x, boxAfter.y, boxAfter.width, boxAfter.height,
      labelAfter.x, labelAfter.y, labelAfter.width, labelAfter.height,
      labelAfter.angle, boxAfter.angle].every(Number.isFinite) ||
    labelAfter.width > getBoundTextMaxWidth(boxAfter, labelAfter) + 0.5 ||
    labelAfter.height > getBoundTextMaxHeight(
      boxAfter,
      labelAfter as ExcalidrawTextElementWithContainer,
    ) + 0.5
  ) {
    return source;
  }
  return result;
};

/**
 * Core single-element resize for independent native boxes and intact
 * reciprocal single-label pairs. The safety checks refuse unsupported
 * imported bindings; images, grouped text and arrow paths still require
 * separate parity handling.
 */
export function resizeNativeBoxWithCore(
  scene: SceneFile,
  id: string,
  handle: "nw" | "ne" | "sw" | "se",
  pointer: { x: number; y: number },
): SceneFile {
  const element = scene.elements.find((item) => item.id === id);
  const label = element ? safeResizeLabel(scene, element) : undefined;
  if (
    !element ||
    !canCoreTransformBox(scene, element, label) ||
    !Number.isFinite(pointer.x) ||
    !Number.isFinite(pointer.y)
  ) {
    return scene;
  }
  const { nextWidth, nextHeight } = getNextSingleWidthAndHeightFromPointer(
    element,
    element,
    handle,
    pointer.x,
    pointer.y,
  );
  if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) {
    return scene;
  }
  const minSize = label ? 21 : 8;
  const resized = withNativeCoreScene(scene, (core) => {
    const latest = core.getNonDeletedElement(id);
    if (!latest) {
      return;
    }
    const originalElementsMap = new Map(
      core.getNonDeletedElements().map((item) => [
        item.id,
        structuredClone(item),
      ]),
    ) as ElementsMap;
    const original = originalElementsMap.get(id);
    if (!original) {
      return;
    }
    resizeSingleElement(
      Math.max(minSize, nextWidth),
      Math.max(minSize, nextHeight),
      latest as NonDeletedExcalidrawElement,
      original as NonDeletedExcalidrawElement,
      originalElementsMap,
      core,
      handle,
      {
        shouldMaintainAspectRatio: false,
        shouldResizeFromCenter: false,
      },
    );
  });
  return acceptCoreLabelResult(scene, resized, id, label);
}

/**
 * Let Excalidraw rotate a single native box and its reciprocal label in one
 * core Scene transaction; never split text from its container on rotation.
 */
export function rotateNativeBoxWithCore(
  scene: SceneFile,
  id: string,
  pointer: { x: number; y: number },
): SceneFile {
  const element = scene.elements.find((item) => item.id === id);
  const label = element ? safeResizeLabel(scene, element) : undefined;
  if (
    !element ||
    !canCoreTransformBox(scene, element, label) ||
    !Number.isFinite(pointer.x) ||
    !Number.isFinite(pointer.y)
  ) {
    return scene;
  }
  const rotated = withNativeCoreScene(scene, (core) => {
    const target = core.getNonDeletedElement(id);
    if (!target) {
      return;
    }
    const originals = new Map<string, NonDeleted<ExcalidrawElement>>();
    for (const item of core.getNonDeletedElements()) {
      originals.set(item.id, structuredClone(item));
    }
    transformElements(
      originals,
      "rotation",
      [target],
      core,
      false,
      false,
      false,
      pointer.x,
      pointer.y,
      element.x + element.width / 2,
      element.y + element.height / 2,
    );
  });
  return acceptCoreLabelResult(scene, rotated, id, label);
}

/**
 * A group can be transformed by core only if its complete flat membership
 * consists of supported box roots and, optionally, one exact reciprocal text
 * label per box. Returning the labels lets the caller validate every core
 * mutation before adopting it into the immutable Svelte scene.
 *
 * Unsupported/foreign links, unselected members, nested groups, invalid
 * geometry and arrow references all fail closed.
 */
const getSafeCoreGroupLabels = (
  scene: SceneFile,
  ids: readonly string[],
  allowRotated: boolean,
): ExcalidrawTextElement[] | null => {
  const selected = new Set(ids);
  if (selected.size < 2 || selected.size !== ids.length) {
    return null;
  }
  const roots = scene.elements.filter((element) => selected.has(element.id));
  const groupId = roots[0]?.groupIds.length === 1 ? roots[0].groupIds[0] : null;
  if (!groupId || roots.length !== selected.size || roots.some((element) =>
    !["rectangle", "ellipse", "diamond"].includes(element.type) ||
    element.isDeleted ||
    element.locked ||
    element.frameId !== null ||
    element.groupIds.length !== 1 ||
    element.groupIds[0] !== groupId ||
    (!allowRotated && element.angle !== 0) ||
    !Number.isFinite(element.angle) ||
    !Number.isFinite(element.width) ||
    !Number.isFinite(element.height) ||
    element.width <= 0 ||
    element.height <= 0
  )) {
    return null;
  }

  const labels: ExcalidrawTextElement[] = [];
  const members = new Set(selected);
  for (const root of roots) {
    const refs = root.boundElements;
    if (!refs?.length) {
      continue;
    }
    if (refs.length !== 1 || refs[0].type !== "text") {
      return null;
    }
    const label = scene.elements.find((item) => item.id === refs[0].id);
    if (
      !label ||
      label.type !== "text" ||
      label.isDeleted ||
      label.locked ||
      label.frameId !== null ||
      label.groupIds.length !== 1 ||
      label.groupIds[0] !== groupId ||
      label.containerId !== root.id ||
      !label.autoResize ||
      label.boundElements?.length ||
      root.width <= 20 ||
      root.height <= 20 ||
      !Number.isFinite(label.fontSize) ||
      label.fontSize <= 0 ||
      !Number.isFinite(label.width) ||
      !Number.isFinite(label.height) ||
      !Number.isFinite(label.angle) ||
      label.width < 0 ||
      label.height < 0 ||
      members.has(label.id)
    ) {
      return null;
    }
    labels.push(label);
    members.add(label.id);
  }

  // All active group members must be accounted for; a partial group cannot
  // be resized, even if an unexpected member is locked or not selectable.
  if (scene.elements.some((element) =>
    !element.isDeleted &&
    element.groupIds.includes(groupId) &&
    !members.has(element.id)
  )) {
    return null;
  }

  // Reject both forward and reverse orphan links. Only the validated
  // per-container text relationships may reference selected objects.
  const labelsById = new Map(labels.map((label) => [label.id, label]));
  if (scene.elements.some((element) =>
    !element.isDeleted &&
    (
      (element.type === "arrow" &&
        (!!element.startBinding && selected.has(element.startBinding.elementId) ||
          !!element.endBinding && selected.has(element.endBinding.elementId))) ||
      (element.type === "text" &&
        element.containerId !== null &&
        selected.has(element.containerId) &&
        !labelsById.has(element.id)) ||
      (!selected.has(element.id) &&
        element.boundElements?.some((ref) =>
          selected.has(ref.id) ||
          (labelsById.has(ref.id) && labelsById.get(ref.id)?.containerId !== element.id)
        ))
    )
  )) {
    return null;
  }
  return labels;
};

/** Commit group text transforms only if all original bindings survive core. */
const acceptCoreGroupLabels = (
  source: SceneFile,
  result: SceneFile,
  ids: readonly string[],
  labels: readonly ExcalidrawTextElement[],
): SceneFile => {
  if (result === source) {
    return source;
  }
  const selected = new Set(ids);
  const labelIds = new Set(labels.map((label) => label.id));
  const after = new Map(result.elements.map((element) => [element.id, element]));
  for (const original of source.elements) {
    const updated = after.get(original.id);
    if (!updated) {
      return source;
    }
    if (!selected.has(original.id) && !labelIds.has(original.id) && updated !== original) {
      return source;
    }
    if (selected.has(original.id) && (
      updated.isDeleted ||
      updated.type !== original.type ||
      updated.groupIds.length !== 1 ||
      updated.groupIds[0] !== original.groupIds[0] ||
      JSON.stringify(updated.boundElements ?? null) !==
        JSON.stringify(original.boundElements ?? null) ||
      ![updated.x, updated.y, updated.width, updated.height, updated.angle]
        .every(Number.isFinite) ||
      updated.width <= 0 ||
      updated.height <= 0
    )) {
      return source;
    }
  }
  for (const label of labels) {
    const bound = after.get(label.id);
    const box = after.get(label.containerId!);
    if (
      !bound ||
      bound.type !== "text" ||
      !box ||
      bound.isDeleted ||
      box.isDeleted ||
      bound.containerId !== box.id ||
      bound.originalText !== label.originalText ||
      bound.groupIds.length !== 1 ||
      bound.groupIds[0] !== label.groupIds[0] ||
      box.boundElements?.length !== 1 ||
      box.boundElements[0].id !== label.id ||
      box.boundElements[0].type !== "text" ||
      !bound.autoResize ||
      bound.locked ||
      bound.frameId !== null ||
      ![bound.x, bound.y, bound.width, bound.height, bound.fontSize, bound.angle]
        .every(Number.isFinite) ||
      bound.fontSize <= 0 ||
      bound.width < 0 ||
      bound.height < 0 ||
      box.width <= 20 ||
      box.height <= 20 ||
      Math.abs(Math.sin(bound.angle - box.angle)) > 1e-6 ||
      Math.abs(Math.cos(bound.angle - box.angle) - 1) > 1e-6 ||
      bound.width > getBoundTextMaxWidth(box, bound) + 0.5 ||
      bound.height > getBoundTextMaxHeight(
        box,
        bound as ExcalidrawTextElementWithContainer,
      ) + 0.5
    ) {
      return source;
    }
  }
  return result;
};

/**
 * Use the original multi-element resize for complete flat groups of boxes,
 * including validated reciprocal text labels. Cropped images and linear
 * elements still require separate parity handling.
 */
export function resizeNativeGroupWithCore(
  scene: SceneFile,
  ids: readonly string[],
  handle: "nw" | "ne" | "sw" | "se",
  scale: number,
  bounds: { x: number; y: number; width: number; height: number },
): SceneFile {
  const labels = getSafeCoreGroupLabels(scene, ids, false);
  if (
    labels === null ||
    !Number.isFinite(scale) ||
    scale <= 0 ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return scene;
  }
  if (Math.abs(scale - 1) < 1e-9) {
    return scene;
  }

  const resized = withNativeCoreScene(scene, (core) => {
    const originals = new Map(
      core.getNonDeletedElements().map((element) => [
        element.id,
        structuredClone(element),
      ]),
    ) as ElementsMap;
    const selectedRoots = ids.map((id) => core.getNonDeletedElement(id));
    if (selectedRoots.some((element) => !element)) {
      return;
    }
    resizeMultipleElements(
      selectedRoots as NonDeletedExcalidrawElement[],
      core.getNonDeletedElementsMap(),
      handle,
      core,
      originals,
      {
        shouldMaintainAspectRatio: true,
        shouldResizeFromCenter: false,
        flipByX: false,
        flipByY: false,
        nextWidth: bounds.width * scale,
        nextHeight: bounds.height * scale,
        originalBoundingBox: {
          minX: bounds.x,
          minY: bounds.y,
          maxX: bounds.x + bounds.width,
          maxY: bounds.y + bounds.height,
          midX: bounds.x + bounds.width / 2,
          midY: bounds.y + bounds.height / 2,
          width: bounds.width,
          height: bounds.height,
        },
      },
    );
  });
  return acceptCoreGroupLabels(scene, resized, ids, labels);
}

/**
 * Original Excalidraw multi-selection rotation, restricted to a safe
 * complete group of plain boxes. Uses the same rotation normalization and
 * element-center calculation as the React editor.
 */
export function rotateNativeGroupWithCore(
  scene: SceneFile,
  ids: readonly string[],
  pointer: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
): SceneFile {
  const labels = getSafeCoreGroupLabels(scene, ids, true);
  if (
    labels === null ||
    ![pointer.x, pointer.y, bounds.x, bounds.y, bounds.width, bounds.height]
      .every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return scene;
  }
  const rotated = withNativeCoreScene(scene, (core) => {
    const originalElements = new Map<string, NonDeleted<ExcalidrawElement>>();
    for (const element of core.getNonDeletedElements()) {
      originalElements.set(element.id, structuredClone(element));
    }
    const selected = ids.map((id) => core.getNonDeletedElement(id));
    if (selected.some((element) => !element)) {
      return;
    }
    transformElements(
      originalElements,
      "rotation",
      selected as NonDeletedExcalidrawElement[],
      core,
      false,
      false,
      true,
      pointer.x,
      pointer.y,
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
  });
  return acceptCoreGroupLabels(scene, rotated, ids, labels);
}

/**
 * The official reciprocal-binding deletion lifecycle updates all affected
 * neighbors in an isolated core Scene. Soft deletion remains immutable and
 * source order/index/extension fields are preserved by the adapter.
 */
export function deleteNativeElementsWithCore(
  scene: SceneFile,
  ids: ReadonlySet<string>,
): SceneFile {
  if (!ids.size) {
    return scene;
  }
  const originals = scene.elements.filter(
    (element) => ids.has(element.id) && !element.isDeleted,
  );
  if (!originals.length || originals.length !== ids.size) {
    return scene;
  }
  const unbound = withNativeCoreScene(scene, (core) => {
    const elements = core.getElementsIncludingDeleted();
    fixBindingsAfterDeletion(
      elements,
      elements.filter((element) => ids.has(element.id)),
    );
  });
  return {
    ...unbound,
    elements: unbound.elements.map((element) =>
      ids.has(element.id)
        ? updateNativeElement(element, { isDeleted: true })
        : element,
    ),
  };
}
