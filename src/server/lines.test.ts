import { describe, expect, test } from "bun:test";

import { LineBuffer } from "./lines.ts";

describe("LineBuffer", () => {
  test("keeps a partial line until the newline arrives", () => {
    const buffer = new LineBuffer();

    expect(buffer.push('{"id":"1",')).toEqual([]);
    expect(buffer.push('"result":{}}\n{"ev')).toEqual(['{"id":"1","result":{}}']);
    expect(buffer.push('ent":"x"}\n')).toEqual(['{"event":"x"}']);
  });

  test("gives many lines from one chunk and skips empty lines", () => {
    const buffer = new LineBuffer();

    expect(buffer.push("a\n\nb\nc")).toEqual(["a", "b"]);
    expect(buffer.push("\n")).toEqual(["c"]);
  });
});
