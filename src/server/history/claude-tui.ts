import type { DialogView, ModelChange } from "../../shared/harness.ts";
import { record } from "../../shared/parse.ts";
import type { AllowedKey } from "../../shared/rpc.ts";
import type { HerdrClient } from "../herdr.ts";

/** The effort levels of Claude Code, from low to high. */
export const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"] as const;

/** One option of a menu on the screen. `selected` tells that the cursor is on it. */
export type MenuOption = DialogView["options"][number];

/** A question or approval dialog on the screen. */
export type ScreenDialog = DialogView;

/** The model picker of Claude Code on the screen. */
export interface ModelPicker {
  options: MenuOption[];
  /** The effort level that the picker shows, or `null` if it shows none. */
  effort: string | null;
}

const CURSOR = "❯";

const NUMBERED = /^\d+\.\s+/;

const FOOTER = /(enter to|esc to|to cancel|to confirm|←\/→)/i;

/** Gives the label of a menu line: without the cursor, the number, the check, and the details. */
function optionLabel(line: string): string {
  return line
    .replace(CURSOR, "")
    .trim()
    .replace(NUMBERED, "")
    .split(/\s{2,}/)[0]!
    .replace(/\s*✔\s*$/, "")
    .trim();
}

/**
 * Finds the menu around the cursor line: the lines next to it whose text starts in the same
 * column. Gives the index of the first menu line and the options, or `null` if there is no cursor.
 */
function findMenu(lines: string[]): { start: number; options: MenuOption[] } | null {
  const cursorLine = lines.findLastIndex((line) => line.trimStart().startsWith(CURSOR));

  if (cursorLine === -1) {
    return null;
  }

  const cursorText = lines[cursorLine] ?? "";
  const column = cursorText.indexOf(CURSOR) + CURSOR.length + 1;

  function isOption(line: string | undefined): boolean {
    return (
      line !== undefined &&
      line.trim() !== "" &&
      !FOOTER.test(line) &&
      (line.trimStart().startsWith(CURSOR) ||
        (line.length > column && line.slice(0, column).trim() === "" && line[column] !== " "))
    );
  }

  let start = cursorLine;
  let end = cursorLine;

  while (isOption(lines[start - 1])) {
    start--;
  }

  while (isOption(lines[end + 1])) {
    end++;
  }

  const options = lines.slice(start, end + 1).map((line) => ({
    label: optionLabel(line),
    selected: line.trimStart().startsWith(CURSOR),
  }));

  return { start, options };
}

/** Removes trailing spaces and blank lines at the end. */
function screenLines(text: string): string[] {
  const lines = text.split("\n").map((line) => line.trimEnd());

  while (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

/** Changes the effort text of the picker, for example `Extra high`, into a level. */
export function effortLevel(text: string): string | null {
  const value = text.toLowerCase().replace(/[\s-]/g, "");

  if (value === "extrahigh" || value === "xhigh") {
    return "xhigh";
  }

  return EFFORT_ORDER.find((level) => level === value) ?? null;
}

/** Reads the model picker from the screen text, or gives `null` if the picker is not open. */
export function parseModelPicker(text: string): ModelPicker | null {
  const lines = screenLines(text);
  const title = lines.findLastIndex((line) => line.trim() === "Select model");

  if (title === -1) {
    return null;
  }

  const below = lines.slice(title);
  const menu = findMenu(below);
  const effortLine = below.find((line) => /\beffort\b/i.test(line) && /←\/→/.test(line));
  const effortText = effortLine ? /([A-Za-z][A-Za-z -]*?)\s+effort\b/i.exec(effortLine) : null;

  if (!menu) {
    return null;
  }

  return {
    options: menu.options,
    effort: effortText?.[1] ? effortLevel(effortText[1].replace(/^\W+/, "")) : null,
  };
}

/**
 * Reads a question dialog from the bottom of the screen: the menu at the cursor and the text above
 * it, up to the rule line above the dialog. Gives `null` if there is no menu.
 */
export function parseDialog(text: string): ScreenDialog | null {
  const lines = screenLines(text);
  const menu = findMenu(lines);

  if (!menu || menu.options.length < 2) {
    return null;
  }

  const above: string[] = [];

  for (let index = menu.start - 1; index >= 0 && above.length < 14; index--) {
    const line = lines[index] ?? "";

    if (/^\s*[─━═▔▁-]{10,}\s*$/.test(line)) {
      break;
    }

    above.unshift(line.trim());
  }

  const question = above
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { question, options: menu.options };
}

/** Gives the keys that move the cursor from one option to another. */
export function moveKeys(from: number, to: number): AllowedKey[] {
  const key: AllowedKey = to > from ? "down" : "up";

  return Array.from({ length: Math.abs(to - from) }, () => key);
}

/** Gives the keys that change the effort from one level to another. */
export function effortKeys(from: string, to: string): AllowedKey[] {
  const a = EFFORT_ORDER.indexOf(from as (typeof EFFORT_ORDER)[number]);
  const b = EFFORT_ORDER.indexOf(to as (typeof EFFORT_ORDER)[number]);

  if (a === -1 || b === -1) {
    return [];
  }

  const key: AllowedKey = b > a ? "right" : "left";

  return Array.from({ length: Math.abs(b - a) }, () => key);
}

/** The time to wait for the TUI to draw the next screen after a key. */
const SETTLE_MS = 700;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Controls the TUI of Claude Code with keys, and reads the screen after each step to check the
 * result. If a step does not give the expected screen, it presses Esc to cancel and throws.
 */
export class ClaudeTui {
  constructor(
    private readonly client: HerdrClient,
    private readonly paneId: string,
    private readonly pause = 250,
  ) {}

  async screen(): Promise<string> {
    const result = record(
      await this.client.request("agent.read", { target: this.paneId, source: "recent_unwrapped" }),
      "result",
    );

    const read = record(result.read, "result.read");

    return typeof read.text === "string" ? read.text : "";
  }

  async keys(keys: AllowedKey[]): Promise<void> {
    for (const key of keys) {
      await this.client.request("agent.send_keys", { target: this.paneId, keys: [key] });
      await sleep(60);
    }

    await sleep(this.pause);
  }

  /** Reads the screen until `check` gives a value, or gives `null` after the time limit. */
  async waitFor<T>(check: (text: string) => T | null, timeoutMs = 4000): Promise<T | null> {
    const end = Date.now() + timeoutMs;

    while (Date.now() < end) {
      const value = check(await this.screen());

      if (value !== null) {
        return value;
      }

      await sleep(this.pause);
    }

    return null;
  }

  async #fail(message: string): Promise<never> {
    await this.keys(["esc"]).catch(() => undefined);

    throw new Error(message);
  }

  /** Opens the model picker, picks the model and the effort, and applies them. */
  async setModel(change: ModelChange): Promise<void> {
    await this.client.request("agent.prompt", { target: this.paneId, text: "/model" });

    let picker = await this.waitFor(parseModelPicker);

    if (!picker) {
      return this.#fail("the model picker did not open");
    }

    const target = picker.options.findIndex(
      (option) => option.label.toLowerCase() === change.model,
    );

    if (target === -1) {
      return this.#fail(`the model picker has no ${change.model}`);
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const current = picker.options.findIndex((option) => option.selected);

      if (current === target) {
        break;
      }

      await this.keys(moveKeys(current, target));
      picker = (await this.waitFor(parseModelPicker, 1500)) ?? picker;
    }

    if (!picker.options[target]?.selected) {
      return this.#fail(`could not select ${change.model}`);
    }

    if (change.effort) {
      for (let attempt = 0; attempt < 3 && picker.effort !== change.effort; attempt++) {
        if (!picker.effort) {
          return this.#fail("the model picker shows no effort level");
        }

        await this.keys(effortKeys(picker.effort, change.effort));
        picker = (await this.waitFor(parseModelPicker, 1500)) ?? picker;
      }

      if (picker.effort !== change.effort) {
        return this.#fail(`could not set the effort to ${change.effort}`);
      }
    }

    await this.keys([change.scope === "session" ? "s" : "enter"]);
    await this.#confirmSwitch(change);
  }

  /**
   * After the picker closes, Claude Code can ask "Switch model?" because the conversation is cached
   * for the old model. The user already asked for the change, so this picks "Yes". The change is
   * done only when the screen shows no menu.
   */
  async #confirmSwitch(change: ModelChange): Promise<void> {
    for (let step = 0; step < 3; step++) {
      const closed = await this.waitFor((text) => (parseModelPicker(text) ? null : true), 3000);

      if (!closed) {
        return this.#fail("the model picker did not close");
      }

      await sleep(SETTLE_MS);

      const dialog = parseDialog(await this.screen());

      if (!dialog) {
        return;
      }

      const yes = dialog.options.findIndex((option) => /^yes\b/i.test(option.label));

      if (!/switch model/i.test(dialog.question) || yes === -1) {
        return this.#fail(`the agent asked something else: ${dialog.question.split("\n")[0]}`);
      }

      await this.choose(
        yes,
        dialog.options.map((option) => option.label),
      );
    }

    return this.#fail(`could not finish the change to ${change.model}`);
  }

  /**
   * Picks an option of the dialog on the screen. `labels` are the options that the user saw. On a
   * failure it does not press Esc, because Esc can mean "no" in a dialog.
   */
  async choose(index: number, labels: string[]): Promise<void> {
    let dialog = parseDialog(await this.screen());

    function same(found: ScreenDialog | null): boolean {
      return (
        found !== null &&
        found.options.length === labels.length &&
        found.options.every((option, i) => option.label === labels[i])
      );
    }

    if (!same(dialog)) {
      throw new Error("the question on the agent changed. Look again");
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const current = dialog?.options.findIndex((option) => option.selected) ?? -1;

      if (current === index) {
        break;
      }

      await this.keys(moveKeys(current, index));
      dialog = parseDialog(await this.screen());

      if (!same(dialog)) {
        throw new Error("the question on the agent changed. Look again");
      }
    }

    if (!dialog?.options[index]?.selected) {
      throw new Error("could not select the option");
    }

    await this.keys(["enter"]);
  }
}
