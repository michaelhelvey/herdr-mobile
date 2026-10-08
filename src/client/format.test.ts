import { describe, expect, test } from "bun:test";

import { agentTitle, shortPath } from "./format.ts";

describe("shortPath", () => {
  test("gives the last directory", () => {
    expect(shortPath("/Users/me/dev/helvetici/herdr-mobile")).toBe("herdr-mobile");
  });

  test("shows the home directory as ~", () => {
    expect(shortPath("/Users/me")).toBe("~");
  });

  test("gives an empty string when there is no path", () => {
    expect(shortPath(null)).toBe("");
  });
});

describe("agentTitle", () => {
  test("uses the kind when the title is only spaces", () => {
    expect(
      agentTitle({ paneId: "w1:p1", kind: "codex", title: "  ", status: "idle", cwd: null }),
    ).toBe("codex");
  });
});
