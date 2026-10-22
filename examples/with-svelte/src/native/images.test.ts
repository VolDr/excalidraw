import { describe, expect, it, vi } from "vitest";

import type { ExcalidrawImageElement } from "@excalidraw/element/types";
import {
  addNativeImage,
  imageSourceRect,
  NativeImageCache,
  nativeImageSource,
  paintNativeImage,
} from "./images";
import {
  blankScene,
  parseScene,
  serializeScene,
  unsupportedCount,
} from "./scene";
import { deleteSelection, moveSelection } from "./transforms";
import { duplicateSelection } from "./selection";


const sample = "data:image/png;base64,AAAA";
const setup = () =>
  addNativeImage(
    blankScene(),
    { mimeType: "image/png", dataURL: sample },
    { width: 1200, height: 600 },
    { x: 300, y: 200 },
  );

describe("native Excalidraw raster images", () => {
  it("inserts image and matching binary file, preserving both through JSON save", () => {
    const { scene, element } = setup();
    expect(element.type).toBe("image");
    expect(element.width).toBe(520);
    expect(element.height).toBe(260);
    expect(element.x).toBe(40);
    expect(element.y).toBe(70);
    expect(element.scale).toEqual([1, 1]);
    expect(element.crop).toBeNull();
    expect(scene.files[element.fileId!]).toMatchObject({
      id: element.fileId,
      mimeType: "image/png",
      dataURL: sample,
    });
    expect(unsupportedCount(scene)).toBe(0);
    expect(parseScene(serializeScene(scene))).toEqual(scene);
    expect(nativeImageSource(scene, element)?.dataURL).toBe(sample);
  });

  it("moves, duplicates and deletes image element without dropping binary data", () => {
    const { scene, element } = setup();
    const moved = moveSelection(scene, [element.id], 20, 10);
    expect(moved.elements[0].x).toBe(60);
    const copied = duplicateSelection(moved, [element.id]);
    expect(copied.scene.elements).toHaveLength(2);
    expect(copied.scene.elements[1].id).not.toBe(element.id);
    const duplicate = copied.scene.elements[1];
    expect(duplicate.type).toBe("image");
    if (duplicate.type === "image") {
      expect(duplicate.fileId).toBe(element.fileId);
    }
    expect(copied.scene.files).toEqual(scene.files);
    const deleted = deleteSelection(copied.scene, [element.id]);
    expect(deleted.elements[0].isDeleted).toBe(true);
    expect(deleted.elements[1].isDeleted).toBe(false);
    expect(deleted.files).toEqual(scene.files);
  });

  it("refuses remote URLs, mismatched MIME, missing images, and SVG", () => {
    const { scene, element } = setup();
    const remote = {
      ...scene,
      files: {
        [element.fileId!]: {
          mimeType: "image/png",
          dataURL: "https://example.com/photo.png",
        },
      },
    };
    expect(nativeImageSource(remote, element)).toBeNull();
    expect(unsupportedCount(remote)).toBe(1);
    const svg = {
      ...scene,
      files: {
        [element.fileId!]: {
          mimeType: "image/svg+xml",
          dataURL: "data:image/svg+xml;base64,PHN2Zy8+",
        },
      },
    };
    expect(nativeImageSource(svg, element)).toBeNull();
    expect(unsupportedCount(svg)).toBe(1);
    expect(() =>
      addNativeImage(
        scene,
        {
          mimeType: "image/svg+xml",
          dataURL: "data:image/svg+xml;base64,AAAA",
        },
        { width: 100, height: 100 },
        { x: 0, y: 0 },
      ),
    ).toThrow();
    expect(() =>
      addNativeImage(
        scene,
        { mimeType: "image/png", dataURL: sample },
        { width: 0, height: 100 },
        { x: 0, y: 0 },
      ),
    ).toThrow();
  });

  it("converts crop coordinates from the saved natural dimensions", () => {
    const { element } = setup();
    const cropped: ExcalidrawImageElement = {
      ...element,
      crop: {
        x: 25,
        y: 20,
        width: 50,
        height: 60,
        naturalWidth: 100,
        naturalHeight: 100,
      },
    };
    expect(imageSourceRect(cropped, 800, 600)).toEqual({
      sx: 200,
      sy: 120,
      sw: 400,
      sh: 360,
    });
    expect(
      imageSourceRect(
        {
          ...cropped,
          crop: {
            ...cropped.crop!,
            x: -10,
          },
        },
        800,
        600,
      ),
    ).toBeNull();
    expect(imageSourceRect(element, 800, 600)).toEqual({
      sx: 0,
      sy: 0,
      sw: 800,
      sh: 600,
    });
  });

  it("draws cropped, flipped, rotated image with element opacity", () => {
    const { element } = setup();
    const flipped = {
      ...element,
      scale: [-1, 1] as [number, number],
      opacity: 70,
      angle: (Math.PI / 2) as typeof element.angle,
    };
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const image = new Image();
    Object.defineProperty(image, "naturalWidth", { value: 500 });
    Object.defineProperty(image, "naturalHeight", { value: 200 });
    const draw = vi.spyOn(ctx, "drawImage");
    const flip = vi.spyOn(ctx, "scale");
    const rotate = vi.spyOn(ctx, "rotate");
    expect(paintNativeImage(ctx, flipped, image)).toBe(true);
    expect(draw).toHaveBeenCalledWith(
      image,
      0,
      0,
      500,
      200,
      -260,
      -130,
      520,
      260,
    );
    expect(flip).toHaveBeenCalledWith(-1, 1);
    expect(rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(paintNativeImage(ctx, flipped, null)).toBe(false);
  });

  it("caches decoded bitmaps and ignores stale asynchronous completions", () => {
    const { scene, element } = setup();
    const created: HTMLImageElement[] = [];
    const factory = () => {
      const image = {
        src: "",
        onload: null,
        onerror: null,
      } as unknown as HTMLImageElement;
      created.push(image);
      return image;
    };
    const onReady = vi.fn();
    const cache = new NativeImageCache(factory);
    cache.sync(scene, onReady);
    cache.sync(scene, onReady);
    expect(created).toHaveLength(1);
    expect(cache.get(element.fileId)).toBeNull();
    created[0].onload?.(new Event("load"));
    expect(cache.get(element.fileId)).toBe(created[0]);
    expect(onReady).toHaveBeenCalledTimes(1);
    const different = {
      ...scene,
      files: {
        ...scene.files,
        [element.fileId!]: {
          mimeType: "image/png",
          dataURL: "data:image/png;base64,BBBB",
        },
      },
    };
    cache.sync(different, onReady);
    expect(created).toHaveLength(2);
    created[0].onload?.(new Event("load"));
    expect(onReady).toHaveBeenCalledTimes(1);
    created[1].onerror?.(new Event("error"));
    expect(onReady).toHaveBeenCalledTimes(2);
    expect(cache.get(element.fileId)).toBeNull();
    cache.clear();
  });
});
