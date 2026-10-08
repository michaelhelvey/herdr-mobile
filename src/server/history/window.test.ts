import { describe, expect, test } from "bun:test";

import type { ChatItem } from "../../shared/history.ts";
import { historyWindow, MAX_ITEMS, RESEND } from "./window.ts";

function view(count: number) {
  const items: ChatItem[] = Array.from({ length: count }, (_, i) => ({
    type: "notice",
    id: `n${i}`,
    text: String(i),
  }));

  return { key: "k", items, model: null, effort: null };
}

describe("historyWindow", () => {
  test("gives the most recent items on a first load", () => {
    const history = historyWindow(view(MAX_ITEMS + 50), null);

    expect(history.start).toBe(50);
    expect(history.items).toHaveLength(MAX_ITEMS);
  });

  test("sends a few items again before `since`, so that changed tool calls arrive", () => {
    const history = historyWindow(view(100), 90);

    expect(history.start).toBe(90 - RESEND);
    expect(history.total).toBe(100);
  });

  test("loads again from the end when `since` is past the end", () => {
    expect(historyWindow(view(10), 40).start).toBe(0);
  });
});
