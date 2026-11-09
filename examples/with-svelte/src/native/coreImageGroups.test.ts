import { describe, expect, it } from "vitest";

import { updateNativeBoxLabel, nativeLabelBox } from "./boundText";
import {
  resizeNativeGroupWithCore,
  rotateNativeGroupWithCore,
} from "./coreAdapter";
import { transformGroup, transformableGroup } from "./groupTransforms";
import { groupSelection } from "./groups";
import { SceneHistory } from "./history";
import { addNativeImage } from "./images";
import { blankScene, createShape, parseScene, serializeScene } from "./scene";

const createImage = () =>
  addNativeImage(
    blankScene(),
    { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" },
    { width: 400, height: 200 },
    { x: 210, y: 140 },
  );

describe("core native flat-group embedded image transforms", () => {
  it("resizes a flipped image, ordinary box and reversed arrow in one core transaction", () => {
    const added = createImage();
    const image = { ...added.element, scale: [-1, 1] as [number, number] };
    const box = createShape("rectangle", { x: 460, y: 40 }, { x: 580, y: 130 });
    const arrow = createShape("arrow", { x: 800, y: 190 }, { x: 640, y: 80 });
    const foreign = createShape("diamond", { x: 930, y: 40 }, { x: 1030, y: 120 });
    const grouped = groupSelection(
      { ...added.scene, elements: [image, box, arrow, foreign] },
      [image.id, box.id, arrow.id],
    );
    expect(grouped.ids).toHaveLength(3);
    const source = grouped.scene;
    const snapshot = structuredClone(source);
    const { bounds } = transformableGroup(source, grouped.ids)!;
    const scaled = transformGroup(source, grouped.ids, "se", {
      x: bounds.x + bounds.width * 1.4,
      y: bounds.y + bounds.height * 1.4,
    });
    expect(scaled).not.toBe(source);
    const result = scaled.elements[0];
    const nextArrow = scaled.elements[2];
    expect(result.type).toBe("image");
    expect(nextArrow.type).toBe("arrow");
    if (result.type !== "image" || nextArrow.type !== "arrow") {
      throw new Error("Expected image and arrow");
    }
    expect(result.width).toBeCloseTo(image.width * 1.4);
    expect(result.height).toBeCloseTo(image.height * 1.4);
    expect(result.scale).toEqual([-1, 1]);
    expect(result.crop).toBeNull();
    expect(result.fileId).toBe(image.fileId);
    expect(result.index).toBe(image.index);
    expect(result.groupIds).toEqual(source.elements[0].groupIds);
    expect(nextArrow.points[0][0]).toBeCloseTo(
      arrow.type === "arrow" ? arrow.points[0][0] * 1.4 : 0,
    );
    expect(nextArrow.endArrowhead).toBe(
      arrow.type === "arrow" ? arrow.endArrowhead : null,
    );
    expect(scaled.elements[3]).toBe(foreign);
    expect(scaled.files).toBe(source.files);
    expect(source).toEqual(snapshot);
    const history = new SceneHistory();
    history.commit(source);
    expect(history.undo(scaled)).toEqual(source);
    expect(history.redo(source)).toEqual(scaled);
    expect(parseScene(serializeScene(scaled))).toEqual(scaled);
  });

  it("rotates a flipped image with a reciprocal box caption", () => {
    const added = createImage();
    const image = { ...added.element, scale: [1, -1] as [number, number] };
    const box = createShape("ellipse", { x: 450, y: 30 }, { x: 720, y: 230 });
    const labeled = updateNativeBoxLabel(
      { ...added.scene, elements: [image, box] },
      box.id,
      "Caption in image group",
    );
    const grouped = groupSelection(labeled, [image.id, box.id]);
    expect(grouped.ids).toHaveLength(2);
    const source = grouped.scene;
    const { bounds } = transformableGroup(source, grouped.ids)!;
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const next = transformGroup(source, grouped.ids, "rotate", {
      x: center.x + 180,
      y: center.y,
    });
    expect(next).not.toBe(source);
    const img = next.elements.find((item) => item.id === image.id);
    const container = next.elements.find((item) => item.id === box.id);
    const label = next.elements.find(
      (item) => item.type === "text" && item.containerId === box.id,
    );
    expect(img?.type).toBe("image");
    expect(label?.type).toBe("text");
    if (img?.type !== "image" || label?.type !== "text" || !container) {
      throw new Error("Expected rotated image and label");
    }
    expect(img.angle).toBeCloseTo(Math.PI / 2);
    expect(img.scale).toEqual([1, -1]);
    expect(img.fileId).toBe(image.fileId);
    expect(img.crop).toBeNull();
    expect(label.originalText).toBe("Caption in image group");
    expect(label.angle).toBeCloseTo(container.angle);
    expect(container.boundElements).toEqual([{ id: label.id, type: "text" }]);
    expect(nativeLabelBox(next, label)?.id).toBe(box.id);
    expect(next.files).toBe(source.files);
    expect(source.elements[0].angle).toBe(0);
  });

  it("rejects cropped, invalid-flip and externally linked images from core", () => {
    const added = createImage();
    const box = createShape("rectangle", { x: 480, y: 50 }, { x: 600, y: 180 });
    const grouped = groupSelection(
      { ...added.scene, elements: [added.element, box] },
      [added.element.id, box.id],
    );
    const source = grouped.scene;
    const bounds = transformableGroup(source, grouped.ids)!.bounds;
    const cropped = {
      ...source,
      elements: source.elements.map((item) =>
        item.type === "image"
          ? {
              ...item,
              crop: {
                x: 10, y: 10, width: 80, height: 45,
                naturalWidth: 100, naturalHeight: 50,
              },
            }
          : item,
      ),
    };
    expect(resizeNativeGroupWithCore(
      cropped, grouped.ids, "se", 1.3, bounds,
    )).toBe(cropped);
    expect(rotateNativeGroupWithCore(cropped, grouped.ids, {
      x: bounds.x + bounds.width / 2 + 140,
      y: bounds.y + bounds.height / 2,
    }, bounds)).toBe(cropped);
    const legacy = transformGroup(cropped, grouped.ids, "se", {
      x: bounds.x + bounds.width * 1.3,
      y: bounds.y + bounds.height * 1.3,
    });
    expect(legacy).not.toBe(cropped);
    const legacyImage = legacy.elements.find((item) => item.type === "image");
    expect(legacyImage?.type).toBe("image");
    if (legacyImage?.type === "image") {
      expect(legacyImage.crop).toEqual(
        cropped.elements.find((item) => item.type === "image")?.crop,
      );
      expect(legacyImage.fileId).toBe(added.element.fileId);
    }
    expect(legacy.files).toBe(source.files);

    const invalid = {
      ...source,
      elements: source.elements.map((item) =>
        item.type === "image"
          ? { ...item, scale: [0, 1] as [number, number] }
          : item,
      ),
    };
    expect(resizeNativeGroupWithCore(
      invalid, grouped.ids, "se", 1.3, bounds,
    )).toBe(invalid);
    expect(transformGroup(invalid, grouped.ids, "se", {
      x: bounds.x + bounds.width * 1.3,
      y: bounds.y + bounds.height * 1.3,
    })).toBe(invalid);

    const outsider = {
      ...createShape("arrow", { x: 700, y: 100 }, { x: 790, y: 160 }),
      startBinding: {
        elementId: added.element.id,
        fixedPoint: [0.5, 0.5] as [number, number],
        mode: "inside" as const,
      },
    };
    const linked = { ...source, elements: [...source.elements, outsider] };
    expect(resizeNativeGroupWithCore(
      linked, grouped.ids, "se", 1.3, bounds,
    )).toBe(linked);
    expect(transformGroup(linked, grouped.ids, "rotate", {
      x: bounds.x + bounds.width / 2 + 100,
      y: bounds.y + bounds.height / 2,
    })).toBe(linked);
  });
});
