import { CoreEditorSession, deleteCoreDocumentElements } from "@excalidraw/element";
import { describe, expect, it } from "vitest";

import { blankScene, createShape } from "./scene";

describe("framework-independent editor session commands", () => {
  it("previews core dragging from the original pointer-down scene without mutating it", () => {
    const first = createShape("rectangle", { x: 10, y: 20 }, { x: 80, y: 90 });
    const second = createShape("ellipse", { x: 130, y: 40 }, { x: 220, y: 130 });
    const original = {
      ...blankScene(),
      elements: [first, second],
      appState: { viewBackgroundColor: "#fdfaf3", gridSize: 16 },
      files: { ignored: { data: "metadata" } },
    };
    const session = new CoreEditorSession(original);
    try {
      const preview = session.previewDragDocument(original, [first.id], 12, -7);
      expect(preview).not.toBe(original);
      expect(preview.elements[0].x).toBe(first.x + 12);
      expect(preview.elements[0].y).toBe(first.y - 7);
      expect(preview.elements[1]).toBe(second);
      expect(preview.appState).toBe(original.appState);
      expect(preview.files).toBe(original.files);
      expect(original.elements[0].x).toBe(10);
      expect(session.document).toBe(original);

      const nextPreview = session.previewDragDocument(original, [first.id], 24, -7);
      expect(nextPreview.elements[0].x).toBe(first.x + 24);
      session.commit(original, preview);
      expect(session.undo().elements[0].x).toBe(first.x);
      expect(session.redo().elements[0].x).toBe(first.x + 12);
    } finally {
      session.destroy();
    }
  });

  it("refuses duplicate, locked and unknown selected IDs before drag or transform", () => {
    const first = createShape("rectangle", { x: 10, y: 20 }, { x: 80, y: 90 });
    const locked = { ...createShape("ellipse", { x: 90, y: 20 }, { x: 150, y: 80 }), locked: true };
    const original = { ...blankScene(), elements: [first, locked] };
    const session = new CoreEditorSession(original);
    try {
      expect(session.previewDragDocument(original, [first.id, first.id], 20, 0)).toBe(original);
      expect(session.previewDragDocument(original, [locked.id], 20, 0)).toBe(original);
      expect(session.previewDragDocument(original, ["missing"], 20, 0)).toBe(original);
      expect(session.previewTransformDocument(original, [locked.id], "se", { x: 180, y: 90 })).toBe(original);
      expect(session.previewTransformDocument(original, [first.id], "se", { x: NaN, y: 90 })).toBe(original);
    } finally {
      session.destroy();
    }
  });

  it("deletes with core reciprocal-cleanup semantics and keeps external metadata", () => {
    const first = createShape("rectangle", { x: 12, y: 30 }, { x: 102, y: 120 });
    const second = createShape("diamond", { x: 150, y: 30 }, { x: 210, y: 90 });
    const original = { ...blankScene(), elements: [first, second], files: { keep: 1 } };
    const session = new CoreEditorSession(original);
    try {
      const deleted = session.previewDeleteDocument(original, new Set([first.id]));
      expect(deleted.elements[0].isDeleted).toBe(true);
      expect(deleted.elements[1]).toBe(second);
      expect(deleted.files).toBe(original.files);
      expect(original.elements[0].isDeleted).toBe(false);
      expect(session.previewDeleteDocument(original, new Set(["missing"]))).toBe(original);
      expect(deleteCoreDocumentElements(original, new Set([first.id])).elements[0].isDeleted).toBe(true);
    } finally {
      session.destroy();
    }
  });
});
