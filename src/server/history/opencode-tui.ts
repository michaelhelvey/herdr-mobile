import type { DialogView } from "../../shared/harness.ts";
import { record } from "../../shared/parse.ts";
import type { AllowedKey } from "../../shared/rpc.ts";
import type { HerdrClient } from "../herdr.ts";

/** The bar at the left of the boxes of OpenCode, and the scroll bar at the right. */
const BAR = /^\s*┃ ?/;

const SCROLLBAR = /\s+[█▀▄▐▌]$/;

const OPTION = /^(\d)\. (.+)$/;

const DIGITS: AllowedKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** The option of an OpenCode question that opens a text field. The PWA cannot type into it. */
const CUSTOM_ANSWER = "Type your own answer";

/** A question or a permission request on the screen of OpenCode. */
export interface OpencodeDialog extends DialogView {
  /** `question` is a form of the question tool. `permission` asks to allow a tool call. */
  kind: "question" | "permission";
}

/** The labels of the permission options, in the order that OpenCode shows them. */
const PERMISSION_OPTIONS = ["Allow once", "Always allow", "Reject"];

function clean(line: string): string {
  return line.replace(SCROLLBAR, "").trimEnd();
}

/** Gives the lines of the box at the bottom of the screen, without the bar at the left. */
function bottomBox(lines: string[]): string[] {
  let end = lines.length;

  while (end > 0 && !BAR.test(lines[end - 1] ?? "")) {
    end--;
  }

  let start = end;

  while (start > 0 && BAR.test(lines[start - 1] ?? "")) {
    start--;
  }

  return lines.slice(start, end).map((line) => line.replace(BAR, "").trimEnd());
}

function parseQuestion(box: string[]): OpencodeDialog | null {
  const hint = box.findLastIndex((line) => /↑↓ select/.test(line));
  const top = box.findLastIndex((line, index) => index < hint && line.trim() === "Questions");

  if (hint === -1 || top === -1) {
    return null;
  }

  const body = box.slice(top + 1, hint);
  const first = body.findIndex((line) => OPTION.test(line.trim()));

  if (first === -1) {
    return null;
  }

  const question = body
    .slice(0, first)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  const options = body.slice(first).flatMap((line) => {
    const match = OPTION.exec(line.trim());

    return match?.[2] && match[2].trim() !== CUSTOM_ANSWER
      ? [{ label: match[2].trim(), selected: false }]
      : [];
  });

  return question && options.length > 0 ? { kind: "question", question, options } : null;
}

function parsePermission(box: string[]): OpencodeDialog | null {
  const top = box.findLastIndex((line) => line.includes("Permission required"));

  if (top === -1) {
    return null;
  }

  const rest = box.slice(top + 1);
  const row = rest.findIndex((line) => line.includes("Allow once") && line.includes("Reject"));

  if (row === -1) {
    return null;
  }

  const choices = rest[row] ?? "";

  const [title = "", ...details] = rest
    .slice(0, row)
    .map((line) => line.trim())
    .filter(Boolean);

  const ask = title.startsWith("$ ")
    ? `Run ${title.slice(2)}?`
    : title
      ? `${title}?`
      : "Allow this?";

  return {
    kind: "permission",
    question: [ask, ...details].join("\n\n"),
    options: PERMISSION_OPTIONS.filter((label) => choices.includes(label)).map((label) => ({
      label,
      selected: false,
    })),
  };
}

/** Reads a question or a permission request from the `visible` screen text of OpenCode. */
export function parseOpencodeDialog(text: string): OpencodeDialog | null {
  const box = bottomBox(text.split("\n").map(clean));

  return parseQuestion(box) ?? parsePermission(box);
}

/**
 * Gives the keys that pick option `index` of a dialog. A digit picks a question option and sends
 * it. A permission request starts on the first option, so the keys move right, then press enter.
 * Esc rejects a permission request.
 */
export function chooseKeys(dialog: OpencodeDialog, index: number): AllowedKey[] {
  if (dialog.kind === "question") {
    const digit = DIGITS[index];

    if (!digit) {
      throw new Error("the app can pick only the first 9 options");
    }

    return [digit];
  }

  if (dialog.options[index]?.label === "Reject") {
    return ["esc"];
  }

  return [...Array.from({ length: index }, (): AllowedKey => "right"), "enter"];
}

/** Reads and answers the dialogs of OpenCode through Herdr. */
export class OpencodeTui {
  constructor(
    private readonly client: HerdrClient,
    private readonly paneId: string,
  ) {}

  async dialog(): Promise<OpencodeDialog | null> {
    const result = record(
      await this.client.request("agent.read", { target: this.paneId, source: "visible" }),
      "result",
    );

    const read = record(result.read, "result.read");

    return parseOpencodeDialog(typeof read.text === "string" ? read.text : "");
  }

  async choose(index: number, labels: string[]): Promise<void> {
    const dialog = await this.dialog();

    const same =
      dialog !== null &&
      dialog.options.length === labels.length &&
      dialog.options.every((option, i) => option.label === labels[i]);

    if (!same) {
      throw new Error("the question on the agent changed. Look again");
    }

    for (const key of chooseKeys(dialog, index)) {
      await this.client.request("agent.send_keys", { target: this.paneId, keys: [key] });
      await Bun.sleep(60);
    }
  }
}
