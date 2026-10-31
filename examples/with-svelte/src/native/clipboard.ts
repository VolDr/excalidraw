import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";

import { nativeImageSource } from "./images";
import { blankScene, parseScene } from "./scene";
import { duplicateSelection } from "./selection";

import type { SceneFile } from "./scene";

const CLIPBOARD_TYPE = "excalidraw/svelte-native-selection";
const MAX_CLIPBOARD_SIZE = 24_000_000;

const unchanged = (scene: SceneFile) => ({ scene, ids: [] as string[] });

/**
 * Copy only native-editable roots, their reciprocal labels, and the image
 * files they actually reference. Using native duplication creates an already
 * self-contained selection without exposing foreign scene bindings.
 */
export function copyNativeSelection(
  scene: SceneFile,
  ids: readonly string[],
): string | null {
  const cloned = duplicateSelection(scene, ids, 0);
  if (!cloned.ids.length) {
    return null;
  }
  const elements = cloned.scene.elements.slice(scene.elements.length);
  const files: Record<string, unknown> = {};
  for (const element of elements) {
    if (element.type === "image") {
      if (!element.fileId || !nativeImageSource(scene, element)) {
        return null;
      }
      files[element.fileId] = structuredClone(scene.files[element.fileId]);
    }
  }
  return JSON.stringify({
    type: CLIPBOARD_TYPE,
    version: 1,
    rootIds: cloned.ids,
    elements,
    files,
  });
}

/**
 * Accept only the editor's tagged selection format. Revalidate its scene
 * and whole groups, then assign fresh element, group and binary file IDs.
 * Plain text and malformed clipboard data are intentionally ignored.
 */
export function pasteNativeSelection(
  scene: SceneFile,
  encoded: string,
  offset = 24,
): { scene: SceneFile; ids: string[] } {
  if (!encoded || encoded.length > MAX_CLIPBOARD_SIZE || !Number.isFinite(offset)) {
    return unchanged(scene);
  }
  try {
    const payload: unknown = JSON.parse(encoded);
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      !("type" in payload) ||
      payload.type !== CLIPBOARD_TYPE ||
      !("version" in payload) ||
      payload.version !== 1 ||
      !("elements" in payload) ||
      !Array.isArray(payload.elements) ||
      !payload.elements.length ||
      payload.elements.length > 1000 ||
      !("rootIds" in payload) ||
      !Array.isArray(payload.rootIds) ||
      !payload.rootIds.length ||
      !payload.rootIds.every((id) => typeof id === "string") ||
      new Set(payload.rootIds).size !== payload.rootIds.length ||
      !("files" in payload)
    ) {
      return unchanged(scene);
    }
    const source = parseScene(JSON.stringify({
      ...blankScene(),
      elements: payload.elements,
      files: payload.files,
    }));
    // Every element must be part of the copyable selection: no dangling
    // labels, partially copied groups or unsupported foreign references.
    for (const element of source.elements) {
      if (element.type === "image" && !nativeImageSource(source, element)) {
        return unchanged(scene);
      }
    }
    const duplicated = duplicateSelection(source, payload.rootIds, offset);
    const pasted = duplicated.scene.elements.slice(source.elements.length);
    if (
      duplicated.ids.length !== payload.rootIds.length ||
      pasted.length !== source.elements.length
    ) {
      return unchanged(scene);
    }

    const fileIds = new Map<string, FileId>();
    const files = { ...scene.files };
    const elements: ExcalidrawElement[] = pasted.map((element) => {
      if (element.type !== "image" || !element.fileId) {
        return element;
      }
      const oldId = element.fileId;
      let fileId = fileIds.get(oldId);
      if (!fileId) {
        fileId = crypto.randomUUID() as FileId;
        fileIds.set(oldId, fileId);
        files[fileId] = {
          ...(structuredClone(source.files[oldId]) as Record<string, unknown>),
          id: fileId,
        };
      }
      return { ...element, fileId };
    });
    return {
      scene: { ...scene, elements: [...scene.elements, ...elements], files },
      ids: duplicated.ids,
    };
  } catch {
    // Malformed or incompatible external clipboard contents never mutate
    // the current document.
    return unchanged(scene);
  }
}
