import { describe, expect, it } from "vitest";
import { blankScene, createShape } from "./scene";
import { createNativeFrameWithCore } from "./frames";
import { duplicateNativeFrameWithCore } from "./frameDuplicate";

describe("frame duplication reuses Excalidraw's whole-frame core algorithm", () => {
  it("duplicates the frame and its child, remapping the child frameId", () => {
    const box = createShape("rectangle", { x: 50, y: 40 }, { x: 130, y: 120 });
    const created = createNativeFrameWithCore(
      { ...blankScene(), elements: [box] },
      { x: 15, y: 15 }, { x: 200, y: 170 },
    );
    if (!created) throw Error("Missing frame fixture");
    const result = duplicateNativeFrameWithCore(
      created.scene, created.frame.id,
    );
    expect(result.ids).toHaveLength(1);
    expect(result.scene.elements.length).toBe(created.scene.elements.length * 2);
    const copiedFrame = result.scene.elements.find((el) =>
      el.id === result.ids[0],
    );
    const copiedChild = result.scene.elements.find((el) =>
      el.frameId === copiedFrame?.id,
    );
    expect(copiedFrame?.type).toBe("frame");
    expect(copiedChild?.type).toBe("rectangle");
    expect(copiedChild?.id).not.toBe(box.id);
    expect(copiedChild?.x).toBe(box.x + 24);
    expect(created.scene.elements.find((el) => el.id === box.id)?.frameId)
      .toBe(created.frame.id);
  });
});
