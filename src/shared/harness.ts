import { array, optionalString, ParseError, record, string } from "./parse.ts";

/** Where a slash command comes from. */
export type CommandSource = "builtin" | "skill" | "command";

/** A slash command that the user can send to an agent. */
export interface CommandInfo {
  /** The name without the slash, for example `compact` or `review`. */
  name: string;
  description: string;
  source: CommandSource;
}

/** A model that the user can pick. */
export interface ModelOption {
  /** The name of the model in the model picker of the harness, in lower case, for example `opus`. */
  alias: string;
  label: string;
}

/** The controls of an agent harness: its slash commands, models, and effort levels. */
export interface HarnessControls {
  commands: CommandInfo[];
  models: ModelOption[];
  efforts: string[];
}

/** A question that an agent asks, with the options that the user can pick. */
export interface DialogView {
  question: string;
  options: { label: string; selected: boolean }[];
}

/** Parses the result of a `dialog` call. `null` means that the bridge cannot read the question. */
export function parseDialogView(value: unknown): DialogView | null {
  if (value === null) {
    return null;
  }

  const dialog = record(value, "dialog");

  return {
    question: string(dialog.question, "dialog.question"),
    options: array(dialog.options, "dialog.options").map((raw, index) => {
      const option = record(raw, `dialog.options[${index}]`);

      return {
        label: string(option.label, `dialog.options[${index}].label`),
        selected: option.selected === true,
      };
    }),
  };
}

/** A model change that the user asks for. The bridge applies it when the agent is ready. */
export interface ModelChange {
  model: string;
  effort: string | null;
  /** `session` changes only this agent. `default` also changes the default for new sessions. */
  scope: "session" | "default";
}

/** Parses the result of a `controls` call. */
export function parseControls(value: unknown): HarnessControls {
  const controls = record(value, "controls");

  return {
    commands: array(controls.commands, "controls.commands").map((raw, index) => {
      const command = record(raw, `controls.commands[${index}]`);
      const source = command.source;

      if (source !== "builtin" && source !== "skill" && source !== "command") {
        throw new ParseError(`controls.commands[${index}].source: not known`);
      }

      return {
        name: string(command.name, `controls.commands[${index}].name`),
        description: optionalString(command.description, "description") ?? "",
        source,
      };
    }),
    models: array(controls.models, "controls.models").map((raw, index) => {
      const model = record(raw, `controls.models[${index}]`);

      return {
        alias: string(model.alias, `controls.models[${index}].alias`),
        label: string(model.label, `controls.models[${index}].label`),
      };
    }),
    efforts: array(controls.efforts, "controls.efforts").map((raw, index) =>
      string(raw, `controls.efforts[${index}]`),
    ),
  };
}

/**
 * Gives a short name for a model ID, for example `Opus 5.5` for `claude-opus-5-5`. An ID that has
 * a different form stays as it is.
 */
export function modelLabel(id: string): string {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id);

  if (!match?.[1]) {
    return id;
  }

  return `${match[1].charAt(0).toUpperCase()}${match[1].slice(1)} ${match[2]}.${match[3]}`;
}

/** Gives the commands whose name starts with the text after the slash, then the others that contain it. */
export function filterCommands(commands: readonly CommandInfo[], query: string): CommandInfo[] {
  const wanted = query.replace(/^\//, "").toLowerCase();

  if (!wanted) {
    return [...commands];
  }

  const starts = commands.filter((command) => command.name.toLowerCase().startsWith(wanted));

  const contains = commands.filter(
    (command) =>
      !starts.includes(command) &&
      (command.name.toLowerCase().includes(wanted) ||
        command.description.toLowerCase().includes(wanted)),
  );

  return [...starts, ...contains];
}
