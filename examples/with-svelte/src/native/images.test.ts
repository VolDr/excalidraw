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
import {
  deleteSelection,
  flipNativeImage,
  handleLocations,
  isBoxTransformable,
  moveSelection,
  pickHandle,
  resizeElement,
  rotateElement,
  transformSelected,
} from "./transforms";
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

  it("resizes images proportionally, preserving file, crop and flips", () => {
    const { scene, element } = setup();
    const cropped: ExcalidrawImageElement = {
      ...element,
      scale: [-1, 1],
      crop: {
        x: 10,
        y: 15,
        width: 80,
        height: 50,
        naturalWidth: 100,
        naturalHeight: 100,
      },
    };
    const input = { ...scene, elements: [cropped] };
    const handles = handleLocations(cropped);
    expect(isBoxTransformable(cropped, input)).toBe(true);
    expect(isBoxTransformable(cropped)).toBe(false);
    expect(pickHandle(cropped, handles.se, 9, input)).toBe("se");
    const changed = transformSelected(input, cropped.id, "se", {
      x: handles.se.x + 120,
      y: handles.se.y + 60,
    });
    const result = changed.elements[0];
    expect(result.type).toBe("image");
    if (result.type !== "image") {
      return;
    }
    expect(result.width / result.height).toBeCloseTo(2);
    expect(result.width).toBeGreaterThan(element.width);
    expect(handleLocations(result).nw).toEqual(handles.nw);
    expect(result.crop).toEqual(cropped.crop);
    expect(result.scale).toEqual([-1, 1]);
    expect(result.fileId).toBe(element.fileId);
    expect(changed.files).toBe(input.files);
    expect(parseScene(serializeScene(changed)).elements[0]).toEqual(result);
    const clamped = resizeElement(cropped, "nw", { x: 1e6, y: 1e6 }, input);
    expect(clamped.width).toBeGreaterThanOrEqual(8);
    expect(clamped.height).toBeGreaterThanOrEqual(8);
    expect(clamped.width / clamped.height).toBeCloseTo(2);
    expect(handleLocations(clamped).se).toEqual(handles.se);
  });

  it("resizes rotated images around the opposite world-space corner", () => {
    const { scene, element } = setup();
    const rotated = rotateElement(element, { x: 300, y: 200 }, scene);
    expect(rotated.angle).toBeCloseTo(Math.PI / 2);
    const input = { ...scene, elements: [rotated] };
    const handles = handleLocations(rotated);
    const resized = resizeElement(
      rotated,
      "se",
      {
        x: handles.se.x - 40,
        y: handles.se.y + 80,
      },
      input,
    );
    expect(handleLocations(resized).nw.x).toBeCloseTo(handles.nw.x);
    expect(handleLocations(resized).nw.y).toBeCloseTo(handles.nw.y);
    expect(resized.width / resized.height).toBeCloseTo(2);
    expect(resized.angle).toBe(rotated.angle);
  });

  it("flips images without rewriting their binary or crop records", () => {
    const { scene, element } = setup();
    const horizontal = flipNativeImage(scene, element.id, "horizontal");
    const flipped = horizontal.elements[0];
    expect(flipped.type).toBe("image");
    if (flipped.type !== "image") {
      return;
    }
    expect(flipped.scale).toEqual([-1, 1]);
    expect(flipped.version).toBe(element.version + 1);
    expect(flipped.fileId).toBe(element.fileId);
    const vertical = flipNativeImage(horizontal, element.id, "vertical");
    expect((vertical.elements[0] as ExcalidrawImageElement).scale).toEqual([
      -1, -1,
    ]);
    const restored = flipNativeImage(vertical, element.id, "horizontal");
    expect((restored.elements[0] as ExcalidrawImageElement).scale).toEqual([
      1, -1,
    ]);
    expect(restored.files).toBe(scene.files);
    const locked = { ...scene, elements: [{ ...element, locked: true }] };
    expect(flipNativeImage(locked, element.id, "horizontal")).toBe(locked);
    const grouped = { ...scene, elements: [{ ...element, groupIds: ["g"] }] };
    expect(
      resizeElement(grouped.elements[0], "se", { x: 500, y: 300 }, grouped),
    ).toBe(grouped.elements[0]);
  });

  it("refuses transforms when the image file is unsupported", () => {
    const { scene, element } = setup();
    const unsupported = {
      ...scene,
      files: { [element.fileId!]: { mimeType: "image/svg+xml", dataURL: "" } },
    };
    expect(isBoxTransformable(element, unsupported)).toBe(false);
    expect(
      rotateElement(element, { x: 100, y: 100 }, unsupported),
    ).toBe(element);
    expect(
      flipNativeImage(unsupported, element.id, "vertical"),
    ).toBe(unsupported);
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
