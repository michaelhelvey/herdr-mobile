import type { ChatItem } from "../shared/history.ts";

/** A message that the user sent, before it shows in the history of the agent. */
export interface PendingMessage {
  id: number;
  text: string;
  /** The number of user items with the same text when the user sent it. */
  seen: number;
  failed: boolean;
  /** The images of the message, to send again after a failure. */
  files: Blob[];
  /** Object URLs of the images, to show before the history has them. */
  previews: string[];
}

/** Gives the number of user items with this text. */
export function countUserText(items: readonly ChatItem[], text: string): number {
  const wanted = text.trim();

  return items.filter((item) => item.type === "user" && item.text.trim() === wanted).length;
}

/** Removes the pending messages that the history shows now. */
export function settlePending(
  pending: readonly PendingMessage[],
  items: readonly ChatItem[],
): PendingMessage[] {
  return pending.filter((message) => countUserText(items, message.text) <= message.seen);
}
