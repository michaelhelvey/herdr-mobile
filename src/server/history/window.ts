import type { ChatItem, History } from "../../shared/history.ts";

/** The most items that the bridge sends in a first load. */
export const MAX_ITEMS = 200;

/**
 * The number of items before `since` that the bridge sends again. A tool result changes its tool
 * call, which can be a few items back.
 */
export const RESEND = 12;

/** The parts of a history that a provider reads from the session of an agent. */
export interface SessionView {
  key: string;
  items: readonly ChatItem[];
  model: string | null;
  effort: string | null;
}

/**
 * Gives the part of the history that the PWA does not have. `since` is the number of items that
 * the PWA has. Without it, or if it is not valid, it gives the most recent items.
 */
export function historyWindow(view: SessionView, since: number | null): History {
  const total = view.items.length;

  const start =
    since === null || since > total ? Math.max(0, total - MAX_ITEMS) : Math.max(0, since - RESEND);

  return {
    key: view.key,
    total,
    start,
    items: view.items.slice(start),
    model: view.model,
    effort: view.effort,
  };
}
