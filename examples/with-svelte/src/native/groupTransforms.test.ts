import { pointFrom } from "@excalidraw/math";
import { describe, expect, it } from "vitest";

import type { LocalPoint } from "@excalidraw/math";

import { nativeLabelBox, updateNativeBoxLabel } from "./boundText";
import {
  groupHandleLocations,
  pickGroupHandle,
  transformableGroup,
  transformGroup,
} from "./groupTransforms";
import { groupSelection } from "./groups";
import { SceneHistory } from "./history";
import {
  blankScene,
  createShape,
  createText,
  parseScene,
  serializeScene,
} from "./scene";

const example = () => {
  const box = createShape("rectangle", { x: 20, y: 30 }, { x: 220, y: 160 });
  const sibling = createShape("ellipse", { x: 300, y: 40 }, { x: 410, y: 180 });
  const labeled = updateNativeBoxLabel(
    { ...blankScene(), elements: [box, sibling] },
    box.id,
    "Grouped bound label",
  );
  const group = groupSelection(labeled, [box.id, sibling.id]);
  return { box, sibling, label: labeled.elements[2], scene: group.scene, ids: group.ids };
};

describe("native flat group transforms", () => {
  it("offers handles only for an entire supported group", () => {
    const { box, sibling, scene, ids } = example();
    const group = transformableGroup(scene, ids);
    expect(group).not.toBeNull();
    expect(group?.id).toBe(scene.elements[0].groupIds[0]);
    expect(group?.bounds).toEqual({ x: 20, y: 30, width: 390, height: 150 });
    const handles = groupHandleLocations(group!.bounds);
    expect(pickGroupHandle(group!.bounds, handles.se)).toBe("se");
    expect(pickGroupHandle(group!.bounds, handles.rotate)).toBe("rotate");
    expect(pickGroupHandle(group!.bounds, { x: -1000, y: -1000 })).toBeNull();
    expect(transformableGroup(scene, [box.id])).toBeNull();
    expect(transformableGroup(scene, [sibling.id])).toBeNull();
    expect(transformableGroup(scene, [box.id, sibling.id, "unknown"])).toBeNull();
  });

  it("resizes members uniformly and reflows the reciprocal bound label", () => {
    const { box, sibling, label, scene, ids } = example();
    const { bounds } = transformableGroup(scene, ids)!;
    const next = transformGroup(scene, ids, "se", {
      x: bounds.x + bounds.width + 78,
      y: bounds.y + bounds.height + 30,
    });
    const resizedBox = next.elements[0];
    const resizedSibling = next.elements[1];
    const resizedLabel = next.elements[2];
    expect(resizedBox.width).toBeGreaterThan(box.width);
    expect(resizedSibling.width / sibling.width).toBeCloseTo(
      resizedBox.width / box.width,
    );
    expect(resizedBox.id).toBe(box.id);
    expect(resizedLabel.id).toBe(label.id);
    expect(resizedLabel.groupIds).toEqual(resizedBox.groupIds);
    expect(resizedBox.boundElements).toEqual([
      { id: resizedLabel.id, type: "text" },
    ]);
    expect(resizedLabel.type).toBe("text");
    if (resizedLabel.type !== "text") {
      return;
    }
    expect(resizedLabel.containerId).toBe(box.id);
    expect(resizedLabel.originalText).toBe("Grouped bound label");
    expect(resizedLabel.x + resizedLabel.width / 2).toBeCloseTo(
      resizedBox.x + resizedBox.width / 2,
    );
    expect(nativeLabelBox(next, resizedLabel)?.id).toBe(box.id);
    expect(parseScene(serializeScene(next))).toEqual(next);
  });

  it("rotates multiple roots around one group center, preserving text orientation", () => {
    const { box, sibling, scene, ids } = example();
    const { bounds } = transformableGroup(scene, ids)!;
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const rotated = transformGroup(scene, ids, "rotate", {
      x: centerX + 200,
      y: centerY,
    });
    expect(rotated.elements[0].angle).toBeCloseTo(Math.PI / 2);
    expect(rotated.elements[1].angle).toBeCloseTo(Math.PI / 2);
    expect(rotated.elements[2].angle).toBeCloseTo(Math.PI / 2);
    const originalCenter = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
    const newCenter = {
      x: rotated.elements[0].x + rotated.elements[0].width / 2,
      y: rotated.elements[0].y + rotated.elements[0].height / 2,
    };
    expect(newCenter.x).toBeCloseTo(centerX - (originalCenter.y - centerY));
    expect(newCenter.y).toBeCloseTo(centerY + (originalCenter.x - centerX));
    expect(rotated.elements[0].groupIds).toEqual(rotated.elements[1].groupIds);
    expect(rotated.elements[1].id).toBe(sibling.id);
    expect(nativeLabelBox(rotated, rotated.elements[2])?.id).toBe(box.id);
    expect(scene.elements[0].angle).toBe(0);
  });

  it("keeps undo/redo, files, extension data and original scene intact", () => {
    const { scene, ids } = example();
    const imported = {
      ...scene,
      files: { image1: { dataURL: "data:image/png;base64,AAAA" } },
      customData: { origin: "imported" },
      appState: { gridSize: 20 },
    };
    const { bounds } = transformableGroup(imported, ids)!;
    const resized = transformGroup(imported, ids, "nw", {
      x: bounds.x - 32,
      y: bounds.y - 25,
    });
    const history = new SceneHistory();
    history.commit(imported);
    expect(history.undo(resized)).toEqual(imported);
    expect(history.redo(imported)).toEqual(resized);
    expect(resized.files).toEqual(imported.files);
    expect(resized.appState).toEqual(imported.appState);
    expect(parseScene(serializeScene(resized))).toEqual(resized);
    expect(imported.elements.every((element) => element.groupIds.length === 1))
      .toBe(true);
  });

  it("refuses partial, nested, damaged and unsupported imported groups", () => {
    const { box, sibling, label, scene, ids } = example();
    const p = { x: 500, y: 500 };
    const malformed = {
      ...scene,
      elements: scene.elements.map((element) =>
        element.id === label.id ? { ...element, groupIds: [] } : element,
      ),
    };
    const nested = {
      ...scene,
      elements: scene.elements.map((element) => ({
        ...element,
        groupIds: ["outer", ...element.groupIds],
      })),
    };
    for (const input of [malformed, nested]) {
      expect(transformableGroup(input, ids)).toBeNull();
      expect(transformGroup(input, ids, "rotate", p)).toBe(input);
      expect(transformGroup(input, ids, "se", p)).toBe(input);
    }
    const standalone = createText({ x: 470, y: 120 }, "Separate");
    const mixed = groupSelection(
      { ...blankScene(), elements: [box, sibling, standalone] },
      [box.id, standalone.id],
    );
    expect(mixed.groupId).toBeTruthy();
    expect(transformableGroup(mixed.scene, mixed.ids)).toBeNull();
    expect(transformGroup(mixed.scene, mixed.ids, "rotate", p))
      .toBe(mixed.scene);
    expect(transformGroup(scene, [box.id], "rotate", p)).toBe(scene);
    expect(transformGroup(scene, ids, "se", { x: NaN, y: 10 })).toBe(scene);
  });

  it("scales and rotates an unbound two-point arrow without changing its metadata", () => {
    const box = createShape("rectangle", { x: 20, y: 10 }, { x: 130, y: 90 });
    const arrow = createShape("arrow", { x: 170, y: 50 }, { x: 280, y: 130 });
    const scene = { ...blankScene(), elements: [box, arrow] };
    const grouped = groupSelection(scene, [box.id, arrow.id]);
    expect(grouped.groupId).toBeTruthy();
    const frame = transformableGroup(grouped.scene, grouped.ids);
    expect(frame).not.toBeNull();
    const point = groupHandleLocations(frame!.bounds).se;
    const scaled = transformGroup(grouped.scene, grouped.ids, "se", {
      x: point.x + 100,
      y: point.y + 80,
    });
    const scaledArrow = scaled.elements[1];
    expect(scaledArrow.type).toBe("arrow");
    if (scaledArrow.type !== "arrow" || arrow.type !== "arrow") {
      return;
    }
    const scale = scaledArrow.width / arrow.width;
    expect(scale).toBeGreaterThan(1);
    expect(scaledArrow.points[1][0]).toBeCloseTo(arrow.points[1][0] * scale);
    expect(scaledArrow.points[1][1]).toBeCloseTo(arrow.points[1][1] * scale);
    expect(scaledArrow.startBinding).toBeNull();
    expect(scaledArrow.endBinding).toBeNull();
    expect(scaledArrow.endArrowhead).toBe(arrow.endArrowhead);
    expect(scaledArrow.id).toBe(arrow.id);
    const center = {
      x: frame!.bounds.x + frame!.bounds.width / 2,
      y: frame!.bounds.y + frame!.bounds.height / 2,
    };
    const rotated = transformGroup(grouped.scene, grouped.ids, "rotate", {
      x: center.x + 200,
      y: center.y,
    });
    const rotatedArrow = rotated.elements[1];
    expect(rotatedArrow.angle).toBeCloseTo(Math.PI / 2);
    expect(rotatedArrow.type).toBe("arrow");
    if (rotatedArrow.type === "arrow") {
      expect(rotatedArrow.points).toEqual(arrow.points);
    }
    expect(parseScene(serializeScene(scaled))).toEqual(scaled);
    expect(scene.elements[1]).toEqual(arrow);
  });

  it("transforms a simple line while retaining endpoint order and scene roundtrip", () => {
    const line = createShape("line", { x: 170, y: 170 }, { x: 70, y: 90 });
    const box = createShape("diamond", { x: 250, y: 100 }, { x: 340, y: 210 });
    const scene = { ...blankScene(), elements: [line, box] };
    const grouped = groupSelection(scene, [line.id, box.id]);
    expect(grouped.groupId).toBeTruthy();
    const group = transformableGroup(grouped.scene, grouped.ids);
    expect(group).not.toBeNull();
    const handle = groupHandleLocations(group!.bounds).se;
    const next = transformGroup(grouped.scene, grouped.ids, "se", {
      x: handle.x + 55,
      y: handle.y + 45,
    });
    const result = next.elements[0];
    expect(result.type).toBe("line");
    if (result.type !== "line" || line.type !== "line") {
      return;
    }
    expect(result.id).toBe(line.id);
    expect(result.points.length).toBe(2);
    expect(result.points[0][0]).toBeGreaterThan(result.points[1][0]);
    expect(result.points[0][1]).toBeGreaterThan(result.points[1][1]);
    expect(result.width).toBeGreaterThan(line.width);
    expect(result.points[0][0]).toBeCloseTo(
      line.points[0][0] * (result.width / line.width),
    );
    expect(parseScene(serializeScene(next))).toEqual(next);
  });

  it("rejects bound, routed and multi-point arrows during group transforms", () => {
    const box = createShape("rectangle", { x: 5, y: 5 }, { x: 115, y: 85 });
    const arrow = createShape("arrow", { x: 130, y: 30 }, { x: 260, y: 120 });
    const base = groupSelection(
      { ...blankScene(), elements: [box, arrow] },
      [box.id, arrow.id],
    );
    expect(transformableGroup(base.scene, base.ids)).not.toBeNull();
    if (arrow.type !== "arrow") {
      return;
    }
    const unsafe = [
      { ...arrow, points: [...arrow.points, arrow.points[1]] },
      { ...arrow, elbowed: true },
      {
        ...arrow,
        startBinding: {
          elementId: box.id,
          fixedPoint: [0.5, 0.5] as [number, number],
          mode: "inside" as const,
        },
      },
      {
        ...arrow,
        points: [
          pointFrom<LocalPoint>(-15, 0),
          pointFrom<LocalPoint>(arrow.width, arrow.height),
        ],
      },
    ];
    for (const invalid of unsafe) {
      const scene = {
        ...base.scene,
        elements: base.scene.elements.map((element) =>
          element.id === arrow.id ? { ...invalid, groupIds: [...element.groupIds] } : element,
        ),
      };
      expect(transformableGroup(scene, base.ids)).toBeNull();
      expect(transformGroup(scene, base.ids, "se", { x: 330, y: 240 }))
        .toBe(scene);
    }
  });

  it("clamps small group resizes rather than flipping shapes or labels", () => {
    const { box, scene, ids } = example();
    const { bounds } = transformableGroup(scene, ids)!;
    const next = transformGroup(scene, ids, "se", {
      x: bounds.x - 400,
      y: bounds.y - 400,
    });
    expect(next.elements[0].width).toBeGreaterThan(20);
    expect(next.elements[0].height).toBeGreaterThan(20);
    expect(next.elements[0].angle).toBe(box.angle);
    expect(next.elements[2].type).toBe("text");
    expect(nativeLabelBox(next, next.elements[2])).not.toBeNull();
  });
});
