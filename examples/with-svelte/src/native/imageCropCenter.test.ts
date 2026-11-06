import { describe, expect, it } from "vitest";
import { addNativeImage } from "./images";
import { blankScene } from "./scene";
import { cropNativeImageCenter, resetNativeImageCrop } from "./imageCrop";

const makeScene = () =>
  addNativeImage(
    blankScene(),
    { mimeType: "image/png", dataURL: "data:image/png;base64,aGVsbG8=" },
    { width: 800, height: 600 },
    { x: 200, y: 200 },
  );

describe("native center cropping uses Excalidraw core", () => {
  it("retains the image center and aspect ratio", () => {
    const { scene, element } = makeScene();
    const next = cropNativeImageCenter(scene, element.id, { width: 800, height: 600 });
    expect(next).not.toBe(scene);
    const image = next.elements[0];
    expect(image.type).toBe("image");
    if (image.type !== "image") return;
    expect(image.crop).not.toBeNull();
    expect(image.width).toBeCloseTo(element.width * 0.8);
    expect(image.height).toBeCloseTo(element.height * 0.8);
    expect(image.x + image.width / 2).toBeCloseTo(element.x + element.width / 2);
    expect(image.y + image.height / 2).toBeCloseTo(element.y + element.height / 2);
    expect(scene.elements[0]).toBe(element);
    const uncropped = resetNativeImageCrop(next, element.id);
    expect(uncropped.elements[0].type).toBe("image");
    if (uncropped.elements[0].type === "image") {
      expect(uncropped.elements[0].crop).toBeNull();
    }
  });

  it("rejects unsupported or invalid dimensions", () => {
    const { scene, element } = makeScene();
    expect(cropNativeImageCenter(scene, element.id, { width: 0, height: 600 })).toBe(scene);
    const locked = { ...scene, elements: [{ ...element, locked: true }] };
    expect(cropNativeImageCenter(locked, element.id, { width: 800, height: 600 })).toBe(locked);
  });
});
