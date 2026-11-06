import { describe, expect, it } from "vitest";
import { getUncroppedImageElement } from "@excalidraw/element";

import { blankScene } from "./scene";
import { nativeElementsMap } from "./coreAdapter";
import { addNativeImage } from "./images";
import { resetNativeImageCrop } from "./imageCrop";

const makeImageScene = () =>
  addNativeImage(
    blankScene(),
    { mimeType: "image/png", dataURL: "data:image/png;base64,aGVsbG8=" },
    { width: 800, height: 600 },
    { x: 200, y: 200 },
  );

describe("Svelte crop reset delegates to Excalidraw", () => {
  it("uses original uncrop geometry for rotated and flipped rasters", () => {
    const { scene, element } = makeImageScene();
    const cropped = {
      ...element,
      angle: (Math.PI / 4) as typeof element.angle,
      scale: [-1, 1] as [number, number],
      crop: {
        x: 150, y: 100, width: 500, height: 350,
        naturalWidth: 800, naturalHeight: 600,
      },
    };
    const source = { ...scene, elements: [cropped] };
    const expected = getUncroppedImageElement(cropped, nativeElementsMap(source));
    const next = resetNativeImageCrop(source, element.id);
    expect(next).not.toBe(source);
    expect(next.elements[0].type).toBe("image");
    if (next.elements[0].type === "image") {
      expect(next.elements[0].crop).toBeNull();
      expect(next.elements[0].x).toBeCloseTo(expected.x);
      expect(next.elements[0].y).toBeCloseTo(expected.y);
      expect(next.elements[0].width).toBeCloseTo(expected.width);
      expect(next.elements[0].height).toBeCloseTo(expected.height);
      expect(next.elements[0].scale).toEqual([-1, 1]);
      expect(next.elements[0].version).toBeGreaterThan(cropped.version);
    }
    expect(source.elements[0]).toBe(cropped);
    expect(source.files).toBe(next.files);
  });

  it("refuses uncropped images and malformed external crop data", () => {
    const { scene, element } = makeImageScene();
    expect(resetNativeImageCrop(scene, element.id)).toBe(scene);
    const invalid = {
      ...scene,
      elements: [{ ...element, crop: {
        x: -10, y: 0, width: 100, height: 100,
        naturalWidth: 800, naturalHeight: 600,
      } }],
    };
    expect(resetNativeImageCrop(invalid, element.id)).toBe(invalid);
  });
});
