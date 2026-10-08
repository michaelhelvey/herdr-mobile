import { describe, expect, test } from "bun:test";

import { fitSize } from "./images.ts";

describe("fitSize", () => {
  test("makes a tall phone screenshot fit and keeps its shape", () => {
    expect(fitSize(1179, 2556, 2048)).toEqual({ width: 945, height: 2048 });
  });

  test("does not make a small image larger", () => {
    expect(fitSize(300, 200, 2048)).toEqual({ width: 300, height: 200 });
  });
});
