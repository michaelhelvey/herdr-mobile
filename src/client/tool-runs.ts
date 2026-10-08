import type { ChatItem } from "../shared/history.ts";

type ToolItem = Extract<ChatItem, { type: "tool" }>;

/** One thing that the chat shows: an item, or a run of tool calls that did not change files. */
export type ChatRow =
  { kind: "item"; item: ChatItem } | { kind: "tools"; id: string; tools: ToolItem[] };

/**
 * Puts tool calls that come one after the other, and that did not change a file, into one row.
 * Tool calls that changed a file stay single, because the user wants to see each change.
 */
export function groupToolRuns(items: readonly ChatItem[]): ChatRow[] {
  const rows: ChatRow[] = [];

  for (const item of items) {
    const last = rows.at(-1);

    if (item.type === "tool" && !item.diff) {
      if (last?.kind === "tools") {
        last.tools.push(item);
      } else {
        rows.push({ kind: "tools", id: item.id, tools: [item] });
      }
    } else {
      rows.push({ kind: "item", item });
    }
  }

  return rows;
}

/** Gives the names of the tools in a run, without repeats, in the order that they ran. */
export function toolNames(tools: readonly ToolItem[]): string[] {
  return [...new Set(tools.map((tool) => tool.name))];
}
