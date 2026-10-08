import { describe, expect, test } from "bun:test";

import type { ChatItem } from "../shared/history.ts";
import { settlePending } from "./pending.ts";

function user(id: string, text: string): ChatItem {
  return { type: "user", id, text, images: [] };
}

describe("settlePending", () => {
  test("keeps a message until the history has one more user item with its text", () => {
    const pending = [{ id: 1, text: "yes", seen: 1, failed: false, files: [], previews: [] }];
    const before = [user("u1", "yes")];

    expect(settlePending(pending, before)).toEqual(pending);
    expect(settlePending(pending, [...before, user("u2", " yes ")])).toEqual([]);
  });
});
