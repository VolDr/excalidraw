import type { ExcalidrawElement } from "@excalidraw/element/types";

import { isNativeShape } from "./scene";

import type { SceneFile } from "./scene";

/**
 * Native groups support one group level and standalone elements only.
 * Existing nested, bound or framed groups remain intact for React editing.
 */
const isIndependent = (element: ExcalidrawElement): boolean => {
  if (
    !isNativeShape(element) ||
    element.locked ||
    element.frameId ||
    element.boundElements?.length
  ) {
    return false;
  }
  if (element.type === "line" || element.type === "arrow") {
    return !element.startBinding && !element.endBinding;
  }
  return element.type !== "text" || element.containerId === null;
};

export const canEditIndependently = (element: ExcalidrawElement): boolean =>
  isIndependent(element) && element.groupIds.length === 0;

export function safeGroupMembers(
  scene: SceneFile,
  id: string,
): ExcalidrawElement[] {
  const members = scene.elements.filter((element) =>
    element.groupIds.includes(id),
  );
  if (
    members.length < 2 ||
    members.some(
      (element) => element.groupIds.length !== 1 || !isIndependent(element),
    )
  ) {
    return [];
  }
  return members;
}

/** Hit-testing one grouped shape selects every safely movable member. */
export function selectionUnit(scene: SceneFile, id: string): string[] {
  const element = scene.elements.find((item) => item.id === id);
  if (!element || !isIndependent(element)) {
    return [];
  }
  if (!element.groupIds.length) {
    return [id];
  }
  if (element.groupIds.length !== 1) {
    return [];
  }
  return safeGroupMembers(scene, element.groupIds[0]).map((item) => item.id);
}

/** Canonicalize independent elements and whole safe groups in scene order. */
export function editableSelection(
  scene: SceneFile,
  ids: readonly string[],
): string[] {
  const selected = new Set(ids);
  const groupIds = new Set<string>();
  for (const element of scene.elements) {
    if (selected.has(element.id) && element.groupIds.length === 1) {
      const groupId = element.groupIds[0];
      const members = safeGroupMembers(scene, groupId);
      if (
        members.length &&
        members.every((member) => selected.has(member.id))
      ) {
        groupIds.add(groupId);
      }
    }
  }
  return scene.elements
    .filter(
      (element) =>
        selected.has(element.id) &&
        (canEditIndependently(element) ||
          (element.groupIds.length === 1 && groupIds.has(element.groupIds[0]))),
    )
    .map((element) => element.id);
}

const touch = <T extends ExcalidrawElement>(
  element: T,
  change: Partial<T>,
): T => ({
  ...element,
  ...change,
  version: element.version + 1,
  versionNonce: Math.floor(Math.random() * 2 ** 31),
  updated: Date.now(),
});

/** Groups only new, independent elements; no silent changes to old groups. */
export function groupSelection(
  scene: SceneFile,
  ids: readonly string[],
): { scene: SceneFile; ids: string[]; groupId: string | null } {
  const selected = new Set(ids);
  const eligible = scene.elements.filter((element) => selected.has(element.id));
  if (
    eligible.length < 2 ||
    eligible.some((element) => !canEditIndependently(element))
  ) {
    return { scene, ids: [], groupId: null };
  }
  const groupId = crypto.randomUUID();
  return {
    scene: {
      ...scene,
      elements: scene.elements.map((element) =>
        selected.has(element.id)
          ? touch(element, { groupIds: [groupId] })
          : element,
      ),
    },
    ids: eligible.map((element) => element.id),
    groupId,
  };
}

/** Undoable removal of a complete, flat native group. */
export function ungroupSelection(
  scene: SceneFile,
  ids: readonly string[],
): { scene: SceneFile; ids: string[] } {
  const selected = new Set(ids);
  const groupIds = new Set(
    scene.elements
      .filter(
        (element) => selected.has(element.id) && element.groupIds.length === 1,
      )
      .map((element) => element.groupIds[0]),
  );
  const allowed = new Set<string>();
  for (const groupId of groupIds) {
    const members = safeGroupMembers(scene, groupId);
    if (
      members.length &&
      members.every((element) => selected.has(element.id))
    ) {
      allowed.add(groupId);
    }
  }
  if (!allowed.size) {
    return { scene, ids: [] };
  }
  const affected = scene.elements.filter(
    (element) =>
      element.groupIds.length === 1 && allowed.has(element.groupIds[0]),
  );
  return {
    scene: {
      ...scene,
      elements: scene.elements.map((element) =>
        affected.includes(element) ? touch(element, { groupIds: [] }) : element,
      ),
    },
    ids: affected.map((element) => element.id),
  };
}
