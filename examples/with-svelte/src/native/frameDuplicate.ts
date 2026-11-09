import {
  duplicateElements,
  syncMovedIndices,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { SceneFile } from "./scene";

/**
 * React Excalidraw already has a complete frame+child duplication routine,
 * including nested-group IDs, bound-text references, and the reciprocal
 * binding graph. Do not use independent duplicateElement() for a frame:
 * it would copy just the frame without its owned children.
 */
export const duplicateNativeFrameWithCore = (
  scene: SceneFile,
  frameId: string,
  offset = 24,
): { scene: SceneFile; ids: string[] } => {
  const none = { scene, ids: [] as string[] };
  const frame = scene.elements.find((el) => el.id === frameId);
  if (!frame || frame.type !== "frame" || frame.isDeleted ||
      frame.locked || frame.groupIds.length || frame.frameId ||
      !Number.isFinite(offset) || Math.abs(offset) > 1e5) return none;

  const children = scene.elements.filter((el) =>
    !el.isDeleted && el.frameId === frame.id,
  );
  const contents = [frame, ...children];
  const originals = new Set(contents.map((el) => el.id));
  const groups = new Set(children.flatMap((el) => el.groupIds));
  if (scene.elements.some((el) =>
    !el.isDeleted && !originals.has(el.id) &&
    el.groupIds.some((gid) => groups.has(gid))
  )) return none;
  if (
    contents.some((el) =>
      el.locked ||
      el.type === "magicframe" ||
      el.type === "embeddable" ||
      el.type === "iframe" ||
      el.type === "image" && !el.fileId ||
      el.type === "arrow" && (
        !!el.startBinding && !originals.has(el.startBinding.elementId) ||
        !!el.endBinding && !originals.has(el.endBinding.elementId)
      ) ||
      el.type === "text" && !!el.containerId &&
        !originals.has(el.containerId) ||
      el.boundElements?.some((ref) => !originals.has(ref.id))
    )
  ) return none;
  // No foreign reference may target only part of the frame's closed graph.
  if (scene.elements.some((el) => !el.isDeleted && !originals.has(el.id) &&
    (el.type === "arrow" &&
      (el.startBinding && originals.has(el.startBinding.elementId) ||
       el.endBinding && originals.has(el.endBinding.elementId)) ||
      el.type === "text" && el.containerId &&
        originals.has(el.containerId) ||
      el.boundElements?.some((ref) => originals.has(ref.id))
    )
  )) return none;

  try {
    // Give the original core its own copies, never mutate the source file.
    const cloned = scene.elements.map((el) => structuredClone(el));
    const originalFrame = cloned.find((el) => el.id === frameId);
    if (!originalFrame) return none;
    const result = duplicateElements({
      type: "in-place",
      elements: cloned,
      idsOfElementsToDuplicate: new Map([[frameId, originalFrame]]),
      appState: {
        editingGroupId: null,
        selectedGroupIds: {},
      },
      randomizeSeed: true,
      overrides: ({ origElement }) => ({
        x: origElement.x + offset,
        y: origElement.y + offset,
      }),
    });
    const mappedFrame = result.origIdToDuplicateId.get(frameId);
    if (!mappedFrame) return none;
    const duplicates = result.duplicatedElements;
    const duplicateById = new Map(duplicates.map((el) => [el.id, el]));
    if (duplicates.length !== originals.size ||
        duplicateById.size !== originals.size ||
        result.elementsWithDuplicates.length !== scene.elements.length + originals.size ||
        duplicates.some((el) => !Number.isFinite(el.x) || !Number.isFinite(el.y))) {
      return none;
    }
    for (const old of contents) {
      const newId = result.origIdToDuplicateId.get(old.id);
      const next = newId && duplicateById.get(newId);
      if (
        !next || next.id === old.id || next.type !== old.type ||
        next.frameId !== (old.id === frameId ? null : mappedFrame) ||
        next.groupIds.length !== old.groupIds.length ||
        (old.type === "text" && next.type === "text" &&
          next.containerId !== (old.containerId
            ? result.origIdToDuplicateId.get(old.containerId) : null)) ||
        (old.type === "arrow" && next.type === "arrow" && (
          next.startBinding?.elementId !== (old.startBinding
            ? result.origIdToDuplicateId.get(old.startBinding.elementId) : undefined) ||
          next.endBinding?.elementId !== (old.endBinding
            ? result.origIdToDuplicateId.get(old.endBinding.elementId) : undefined)
        )) ||
        old.boundElements?.some((ref) =>
          !next.boundElements?.some((target) =>
            target.type === ref.type &&
            target.id === result.origIdToDuplicateId.get(ref.id)
          )
        )
      ) return none;
    }
    const indexed = syncMovedIndices(
      result.elementsWithDuplicates,
      new Map(duplicates.map((el) => [el.id, el])),
    ) as ExcalidrawElement[];
    const sourceById = new Map(scene.elements.map((el) => [el.id, el]));
    const elements = indexed.map((el) => {
      const old = sourceById.get(el.id);
      return old && JSON.stringify(old) === JSON.stringify(el) ? old : el;
    });
    return { scene: { ...scene, elements }, ids: [mappedFrame] };
  } catch {
    return none;
  }
};
