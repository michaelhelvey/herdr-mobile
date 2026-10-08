import { describe, expect, test } from "bun:test";

import { commandQuery } from "./composer.tsx";

describe("commandQuery", () => {
  test("gives the name while the user types a command, and stops at the first space", () => {
    expect(commandQuery("/")).toBe("");
    expect(commandQuery("/com")).toBe("com");
    expect(commandQuery("/compact now")).toBeNull();
    expect(commandQuery("hi /x")).toBeNull();
  });
});
