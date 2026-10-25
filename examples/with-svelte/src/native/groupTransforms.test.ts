import { describe, expect, it } from "vitest";

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
