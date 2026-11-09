import { CoreEditorSession, changeCoreDocumentGroups, deleteCoreDocumentElements, validateFractionalIndices } from "@excalidraw/element";
import { describe, expect, it } from "vitest";

import { blankScene, createShape } from "./scene";
import { indexInsertedNativeElements } from "./ordering";

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
  it("moves layers using core fractional-index repair and retains unrelated objects", () => {
    const empty = blankScene();
    const elements = [
      createShape("rectangle", { x: 0, y: 0 }, { x: 50, y: 50 }),
      createShape("ellipse", { x: 80, y: 0 }, { x: 130, y: 50 }),
      createShape("diamond", { x: 150, y: 0 }, { x: 200, y: 50 }),
    ];
    const source = indexInsertedNativeElements(empty, { ...empty, elements });
    const session = new CoreEditorSession(source);
    try {
      const next = session.previewReorderDocument(source, [elements[0].id], "forward");
      expect(next.elements.map((element) => element.id)).toEqual([
        elements[1].id, elements[0].id, elements[2].id,
      ]);
      validateFractionalIndices(next.elements, {
        includeBoundTextValidation: false, shouldThrow: true, ignoreLogs: true,
      });
      expect(next.elements[2]).toBe(source.elements[2]);
      expect(source.elements[0].id).toBe(elements[0].id);
      expect(session.previewReorderDocument(source, [elements[0].id, elements[0].id], "top")).toBe(source);
      session.commit(source, next);
      expect(session.undo().elements.map((element) => element.id)).toEqual(
        source.elements.map((element) => element.id),
      );
      expect(session.redo().elements.map((element) => element.id)).toEqual(
        next.elements.map((element) => element.id),
      );
    } finally {
      session.destroy();
    }
  });

  it("aligns via original core and keeps a consistent document transaction", () => {
    const left = createShape("rectangle", { x: 10, y: 20 }, { x: 60, y: 70 });
    const right = createShape("ellipse", { x: 100, y: 90 }, { x: 150, y: 140 });
    const source = { ...blankScene(), elements: [left, right] };
    const session = new CoreEditorSession(source);
    try {
      const aligned = session.previewLayoutDocument(source, [left.id, right.id], {
        kind: "align", alignment: { axis: "x", position: "start" },
      });
      expect(aligned.elements[0].x).toBe(10);
      expect(aligned.elements[1].x).toBe(10);
      expect(session.previewLayoutDocument(source, [left.id], {
        kind: "align", alignment: { axis: "x", position: "center" },
      })).toBe(source);
      expect(source.elements[1].x).toBe(100);
    } finally {
      session.destroy();
    }
  });

  it("groups and ungroups nested members in one core operation without geometry rewrites", () => {
    const first = createShape("rectangle", { x: 10, y: 10 }, { x: 60, y: 60 });
    const second = createShape("ellipse", { x: 80, y: 10 }, { x: 130, y: 60 });
    const unrelated = createShape("diamond", { x: 160, y: 10 }, { x: 210, y: 60 });
    const source = {
      ...blankScene(),
      elements: [
        { ...first, groupIds: ["inner"] },
        { ...second, groupIds: ["inner"] },
        unrelated,
      ],
      files: { marker: { id: "keep" } },
    };
    const session = new CoreEditorSession(source);
    try {
      const ids = new Set([first.id, second.id, unrelated.id]);
      const grouped = session.previewGroupMembershipDocument(source, ids, {
        kind: "add", groupIds: ["outer"],
      });
      expect(grouped).not.toBe(source);
      expect(grouped.elements[0].groupIds).toEqual(["inner", "outer"]);
      expect(grouped.elements[1].groupIds).toEqual(["inner", "outer"]);
      expect(grouped.elements[2].groupIds).toEqual(["outer"]);
      expect(grouped.elements.map((element) => element.x)).toEqual(source.elements.map((element) => element.x));
      expect(grouped.files).toBe(source.files);
      expect(source.elements[0].groupIds).toEqual(["inner"]);
      expect(changeCoreDocumentGroups(grouped, ids, {
        kind: "remove", groupIds: ["outer"],
      }).elements.map((element) => element.groupIds)).toEqual([
        ["inner"], ["inner"], [],
      ]);
      expect(session.previewGroupMembershipDocument(grouped, ids, {
        kind: "add", groupIds: ["outer"],
      })).toBe(grouped);
    } finally {
      session.destroy();
    }
  });

  it("assigns Excalidraw fractional indices on session commits, not in Svelte", () => {
    const empty = blankScene();
    const first = createShape("rectangle", { x: 0, y: 0 }, { x: 40, y: 40 });
    const baseline = indexInsertedNativeElements(empty, {
      ...empty, elements: [first],
    });
    const second = createShape("ellipse", { x: 70, y: 0 }, { x: 110, y: 40 });
    const pending = { ...baseline, elements: [...baseline.elements, second] };
    const session = new CoreEditorSession(baseline);
    try {
      const committed = session.commit(baseline, pending);
      validateFractionalIndices(committed.elements, {
        includeBoundTextValidation: false, shouldThrow: true, ignoreLogs: true,
      });
      expect(committed.elements[0]).toBe(baseline.elements[0]);
      expect(committed.elements[1].id).toBe(second.id);
      expect(committed.elements[1].index).not.toBeNull();
      expect(session.undo().elements).toEqual(baseline.elements);
      expect(session.redo().elements).toEqual(committed.elements);
    } finally {
      session.destroy();
    }
  });

});
