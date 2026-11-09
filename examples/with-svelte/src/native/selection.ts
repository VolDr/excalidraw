import { CoreEditorSession, elementsOverlappingBBox, getElementBounds } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { nativeEditableLabel } from "./boundText";
import { duplicateNativeFrameWithCore } from "./frameDuplicate";
import { nativeElementsMap } from "./coreAdapter";
import {
  canEditIndependently,
  editableSelection,
  safeGroupMembers,
  selectionUnit,
} from "./groups";

import type { Point, SceneFile } from "./scene";

export type Bounds = { x: number; y: number; width: number; height: number };

export function rectangleBetween(a: Point, b: Point): Bounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** Use Excalidraw's element-specific bounds for rotated/linear shapes. */
export function visualBounds(element: ExcalidrawElement): Bounds {
  const map = nativeElementsMap({ elements: [element] });
  const [x1, y1, x2, y2] = getElementBounds(element, map);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Right-to-left selection must fully enclose the visual bounding box.
 * Left-to-right selection picks any overlapping native editable element.
 * Unsupported/bound/grouped elements never become draggable.
 */
export function elementsInMarquee(
  scene: SceneFile,
  start: Point,
  end: Point,
): string[] {
  const box = rectangleBetween(start, end);
  const fullyEnclosed = end.x < start.x;
  const elementsMap = nativeElementsMap(scene);
  // Excalidraw's own marquee geometry handles rotated shapes, diamonds,
  // ellipses, paths and group semantics. Only validated, selectable native
  // roots are passed into it: linked labels remain internal to their boxes.
  const candidates = scene.elements.filter(
    (element) =>
      !(element.type === "text" && element.containerId !== null) &&
      selectionUnit(scene, element.id).length > 0,
  );
  const hits = elementsOverlappingBBox({
    elements: candidates,
    elementsMap,
    bounds: [box.x, box.y, box.x + box.width, box.y + box.height],
    type: fullyEnclosed ? "contain" : "overlap",
    excludeElementsInFrames: false,
    includeStroke: false,
  });
  const ids = new Set<string>();
  for (const element of hits) {
    selectionUnit(scene, element.id).forEach((id) => ids.add(id));
  }
  return scene.elements
    .filter((element) => ids.has(element.id))
    .map((element) => element.id);
}

/**
 * Duplicate independent roots, complete nested groups and reciprocal labels.
 * Excalidraw's duplicateElement owns all nested group-ID remapping, while
 * fixDuplicatedBindingsAfterDuplication updates the paired text references.
 * Unsafe external arrow links and frame attachments remain untouched.
 */
export function duplicateSelection(
  scene: SceneFile,
  ids: readonly string[],
  offset = 24,
  session?: CoreEditorSession<SceneFile>,
): { scene: SceneFile; ids: string[] } {
  if (
    ids.length === 1 &&
    scene.elements.some((element) =>
      element.id === ids[0] && element.type === "frame" && !element.isDeleted
    )
  ) {
    return duplicateNativeFrameWithCore(scene, ids[0], offset);
  }
  const requested = new Set(editableSelection(scene, ids));
  const selected = new Set<string>();
  const copiedParents = new Set<string>();

  for (const element of scene.elements) {
    if (!requested.has(element.id)) {
      continue;
    }
    const directLabel = nativeEditableLabel(scene, element);
    const groupedCaption = element.groupIds.length
      ? element.boundElements?.find((ref) => ref.type === "text")
      : null;
    const label = directLabel ?? (
      groupedCaption
        ? scene.elements.find((item) =>
            item.id === groupedCaption.id &&
            item.type === "text" &&
            item.containerId === element.id,
          )
        : null
    );
    if (label) {
      selected.add(element.id);
      selected.add(label.id);
      copiedParents.add(element.id);
      continue;
    }
    if (
      canEditIndependently(element) ||
      (element.groupIds.length > 0 &&
        (!element.boundElements?.length ||
          element.boundElements.every((ref) => ref.type === "arrow")))
    ) {
      selected.add(element.id);
      copiedParents.add(element.id);
      continue;
    }
  }

  // A root allowed for selection might still have an unsafe arrow binding.
  // Never copy a partial logical group or drop a linked member silently.
  if (!selected.size || copiedParents.size !== requested.size) {
    return { scene, ids: [] };
  }

  // The original duplicateElements lifecycle now owns nested group IDs,
  // frame-safe ordering, reciprocal captions, arrow bindings, and versions.
  // Native selection policy still prevents partial imported graph copying.
  const memberIds = scene.elements
    .filter((element) => selected.has(element.id))
    .map((element) => element.id);
  const temporary = session ? null : new CoreEditorSession(scene);
  try {
    const duplicated = (session ?? temporary!).previewDuplicateDocument(
      scene, memberIds, offset,
    );
    if (duplicated.document === scene) return { scene, ids: [] };
    const mappedBySource = new Map<string, string>(
      memberIds.map((id, index) => [id, duplicated.ids[index]] as const),
    );
    const candidate = duplicated.document;
    const copiedRootIds = scene.elements
      .filter((element) => copiedParents.has(element.id))
      .map((element) => mappedBySource.get(element.id))
      .filter((id): id is string => !!id);
    if (copiedRootIds.length !== requested.size) {
      return { scene, ids: [] };
    }
    for (const duplicate of candidate.elements) {
      if (
        !duplicated.ids.includes(duplicate.id) ||
        duplicate.type !== "arrow" ||
        !(duplicate.startBinding || duplicate.endBinding) ||
        !duplicate.groupIds.length
      ) continue;
      const outer = duplicate.groupIds[duplicate.groupIds.length - 1];
      if (!safeGroupMembers(candidate, outer).length) {
        return { scene, ids: [] };
      }
    }
    return { scene: candidate, ids: copiedRootIds };
  } finally {
    temporary?.destroy();
  }
}
