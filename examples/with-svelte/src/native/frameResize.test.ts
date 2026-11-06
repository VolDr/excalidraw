import { describe, expect, it } from "vitest";
import { blankScene, createShape } from "./scene";
import { createNativeFrameWithCore } from "./frames";
import {
  nativeFrameHandleLocations,
  resizeNativeFrameWithCore,
} from "./frameResize";

describe("frame resize uses original geometry and membership calculations", () => {
  it("resizes a frame without moving or recapturing the existing child", () => {
    const box = createShape("rectangle", { x: 55, y: 55 }, { x: 125, y: 115 });
    const created = createNativeFrameWithCore(
      { ...blankScene(), elements: [box] },
      { x: 20, y: 20 }, { x: 220, y: 180 },
    );
    expect(created).not.toBeNull();
    const { scene, frame } = created!;
    expect(Object.keys(nativeFrameHandleLocations(scene, frame.id, 1)).length)
      .toBeGreaterThan(0);
    const changed = resizeNativeFrameWithCore(
      scene, frame.id, "se",
      { x: frame.x + frame.width + 60, y: frame.y + frame.height + 60 },
    );
    expect(changed).not.toBe(scene);
    expect(changed.elements.find((el) => el.id === frame.id)?.width)
      .toBeGreaterThan(frame.width);
    expect(changed.elements.find((el) => el.id === box.id))
      .toBe(scene.elements.find((el) => el.id === box.id));
  });

  it("refuses a frame resize that would orphan its existing child", () => {
    const box = createShape("rectangle", { x: 130, y: 100 }, { x: 195, y: 175 });
    const created = createNativeFrameWithCore(
      { ...blankScene(), elements: [box] },
      { x: 20, y: 20 }, { x: 220, y: 200 },
    );
    if (!created) throw Error("Core frame fixture not created");
    const result = resizeNativeFrameWithCore(
      created.scene, created.frame.id, "se", { x: 75, y: 65 },
    );
    expect(result).toBe(created.scene);
  });
});
