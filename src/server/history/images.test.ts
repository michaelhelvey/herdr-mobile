import { describe, expect, test } from "bun:test";

import { ImageStore } from "./images.ts";

describe("ImageStore", () => {
  test("removes the oldest images when it is full", () => {
    const store = new ImageStore(5);

    store.put("a", "image/png", Buffer.from("abc").toString("base64"));
    store.put("b", "image/png", Buffer.from("def").toString("base64"));

    expect(store.get("a")).toBeUndefined();
    expect(new TextDecoder().decode(store.get("b")?.bytes)).toBe("def");
  });
});
