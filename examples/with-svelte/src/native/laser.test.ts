import { describe, expect, it } from "vitest";
import { NativeLaserStroke } from "./laser";

describe("original Excalidraw laser stroke outline", () => {
  it("creates ephemeral outline points from a pointer gesture", () => {
    const laser = new NativeLaserStroke(1);
    laser.add({ x: 10, y: 10 });
    const output = laser.add({ x: 30, y: 40 });
    expect(output.length).toBeGreaterThan(2);
    expect(output.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(laser.close().length).toBeGreaterThan(2);
  });

  it("does not accept non-finite positions", () => {
    const laser = new NativeLaserStroke(1);
    expect(laser.add({ x: NaN, y: 0 })).toEqual([]);
  });
});
