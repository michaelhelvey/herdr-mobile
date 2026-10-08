import { describe, expect, test } from "bun:test";

import { applyHistory, type ChatItem } from "./history.ts";

function user(id: string): ChatItem {
  return { type: "user", id, text: id, images: [] };
}

describe("applyHistory", () => {
  test("replaces the items that the bridge sent again and adds the new items", () => {
    const first = applyHistory(null, {
      key: "s",
      total: 3,
      start: 0,
      items: ["a", "b", "c"].map(user),
      model: null,
      effort: null,
    });

    const next = applyHistory(first, {
      key: "s",
      total: 4,
      start: 1,
      items: ["B", "c", "d"].map(user),
      model: null,
      effort: null,
    });

    expect(next.items.map((item) => item.id)).toEqual(["a", "B", "c", "d"]);
  });

  test("starts again when the session changes", () => {
    const first = applyHistory(null, {
      key: "s1",
      total: 2,
      start: 0,
      items: ["a", "b"].map(user),
      model: null,
      effort: null,
    });

    const next = applyHistory(first, {
      key: "s2",
      total: 1,
      start: 0,
      items: ["x"].map(user),
      model: null,
      effort: null,
    });

    expect(next).toEqual({ key: "s2", base: 0, items: [user("x")], model: null, effort: null });
  });
});
