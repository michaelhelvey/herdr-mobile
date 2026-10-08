import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import {
  type CommandInfo,
  filterCommands,
  type HarnessControls,
  isModel,
  type ModelChange,
} from "../../shared/harness.ts";
import { MAX_IMAGES } from "../../shared/rpc.ts";
import { ArrowUp, Plus, StopSquare } from "./icons.tsx";

/** The most command suggestions that show above the composer. */
const MAX_SUGGESTIONS = 8;

const SOURCE_LABELS: Record<CommandInfo["source"], string> = {
  builtin: "Built-in",
  skill: "Skill",
  command: "Command",
};

/** The properties of the composer. */
export interface ComposerProps {
  working: boolean;
  disabled: boolean;
  /** The commands, models, and efforts of the harness, or `null` if it has none. */
  controls: HarnessControls | null;
  /** The text of the model chip, or `null` to hide the chip. */
  modelLabel: string | null;
  /** The bridge cannot change the model, so the chip only shows it. */
  modelLocked: boolean;
  onSend: (text: string, files: Blob[]) => Promise<void>;
  onStop: () => void;
  onOpenModel: () => void;
}

interface Attachment {
  id: number;
  file: Blob;
  url: string;
}

function imagesIn(files: Iterable<File> | null | undefined): File[] {
  return [...(files ?? [])].filter((file) => file.type.startsWith("image/"));
}

/** Gives the command that the user types, if the text is only a slash and a name. */
export function commandQuery(text: string): string | null {
  const match = /^\/(\S*)$/.exec(text);

  return match ? (match[1] ?? "") : null;
}

/**
 * The message box: text, images, a slash command menu, and the model chip. When the text starts
 * with a slash, the commands that match show above the box.
 */
export function Composer({
  working,
  disabled,
  controls,
  modelLabel,
  modelLocked,
  onSend,
  onStop,
  onOpenModel,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const query = commandQuery(text);

  const suggestions = useMemo(
    () =>
      query === null || !controls
        ? []
        : filterCommands(controls.commands, query).slice(0, MAX_SUGGESTIONS),
    [controls, query],
  );

  useLayoutEffect(() => {
    const element = input.current;

    if (element) {
      element.style.height = "auto";
      element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
    }
  }, [text]);

  function attach(files: File[]) {
    const room = MAX_IMAGES - attachments.length;

    const added = files.slice(0, Math.max(0, room)).map((file) => ({
      id: nextId.current++,
      file,
      url: URL.createObjectURL(file),
    }));

    setAttachments((current) => [...current, ...added]);
  }

  function detach(id: number) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function pick(command: CommandInfo) {
    setText(`/${command.name} `);
    input.current?.focus();
  }

  function startCommand() {
    if (text.trim() === "") {
      setText("/");
    }

    input.current?.focus();
  }

  async function submit() {
    const value = text.trim();

    if ((!value && attachments.length === 0) || sending) {
      return;
    }

    const files = attachments.map((attachment) => attachment.file);

    setSending(true);
    setText("");
    setAttachments([]);

    try {
      await onSend(value, files);
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  const hasContent = text.trim() !== "" || attachments.length > 0;
  const canSend = hasContent && !sending && !disabled;

  return (
    <form
      class="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {suggestions.length > 0 && (
        <ul class="suggestions" aria-label="Commands">
          {suggestions.map((command) => (
            <li key={command.name}>
              <button type="button" class="suggestion" onClick={() => pick(command)}>
                <span class="suggestion-name">/{command.name}</span>
                <span class="suggestion-desc">{command.description}</span>
                <span class={`suggestion-source ${command.source}`}>
                  {SOURCE_LABELS[command.source]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div class={`composer-box ${disabled ? "disabled" : ""}`}>
        {attachments.length > 0 && (
          <div class="attachments">
            {attachments.map((attachment) => (
              <div key={attachment.id} class="attachment">
                <img src={attachment.url} alt="" />
                <button
                  type="button"
                  class="attachment-remove"
                  aria-label="Remove the image"
                  onClick={() => detach(attachment.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={input}
          rows={1}
          value={text}
          placeholder={working ? "Queue a message…" : "Message the agent…"}
          aria-label="Message"
          disabled={disabled}
          onInput={(event) => setText(event.currentTarget.value)}
          onPaste={(event) => {
            const images = imagesIn(event.clipboardData?.files);

            if (images.length > 0) {
              event.preventDefault();
              attach(images);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            } else if (event.key === "Tab" && suggestions[0]) {
              event.preventDefault();
              pick(suggestions[0]);
            }
          }}
        />
        <div class="composer-row">
          <button
            type="button"
            class="composer-tool"
            aria-label="Add photos"
            disabled={disabled || attachments.length >= MAX_IMAGES}
            onClick={() => picker.current?.click()}
          >
            <Plus />
          </button>
          <input
            ref={picker}
            class="visually-hidden"
            type="file"
            accept="image/*"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              attach(imagesIn(event.currentTarget.files));
              event.currentTarget.value = "";
            }}
          />
          {controls && controls.commands.length > 0 && (
            <button
              type="button"
              class="composer-tool slash"
              aria-label="Commands"
              disabled={disabled}
              onClick={startCommand}
            >
              /
            </button>
          )}
          {modelLabel && (
            <button
              type="button"
              class="model-chip"
              disabled={disabled || modelLocked}
              onClick={onOpenModel}
            >
              {modelLabel}
            </button>
          )}
          <span class="composer-spacer" />
          {working && !hasContent ? (
            <button
              type="button"
              class="round-button stop"
              aria-label="Stop the agent"
              onClick={onStop}
            >
              <StopSquare />
            </button>
          ) : (
            <button type="submit" class="round-button send" aria-label="Send" disabled={!canSend}>
              <ArrowUp />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

/** The properties of the model sheet. */
export interface ModelSheetProps {
  controls: HarnessControls;
  /** The model ID of the session, for example `claude-opus-5-5`. */
  model: string | null;
  effort: string | null;
  onApply: (change: ModelChange) => Promise<void>;
  onClose: () => void;
}

/**
 * A sheet to pick the model and the effort level of the agent. The bridge applies the change when
 * the agent is ready for input.
 */
export function ModelSheet({ controls, model, effort, onApply, onClose }: ModelSheetProps) {
  const current = controls.models.find((option) => isModel(option.alias, model));
  const [choice, setPicked] = useState<string | null>(null);
  const [touched, setLevel] = useState<string | null | undefined>(undefined);
  const picked = choice ?? current?.alias ?? controls.models[0]?.alias ?? "";
  const level = touched === undefined ? effort : touched;
  const [scope, setScope] = useState<ModelChange["scope"]>("session");
  const changed = picked !== current?.alias || level !== effort || scope === "default";

  return (
    <div class="modal">
      <button type="button" class="modal-backdrop" aria-label="Close" onClick={onClose} />
      <div class="modal-sheet" role="dialog" aria-label="Model and effort">
        <div class="modal-grabber" />
        <h3>Model</h3>
        <div class="model-list">
          {controls.models.map((option) => (
            <button
              key={option.alias}
              type="button"
              class={`model-option ${option.alias === picked ? "picked" : ""}`}
              onClick={() => setPicked(option.alias)}
            >
              <span>
                {option.label}
                {option.alias === current?.alias && <span class="model-now">Now</span>}
              </span>
              <span class="model-radio" aria-hidden="true" />
            </button>
          ))}
        </div>
        {controls.efforts.length > 0 && (
          <>
            <h3>Effort</h3>
            <div class="effort-row">
              {controls.efforts.map((value) => (
                <button
                  key={value}
                  type="button"
                  class={`effort ${value === level ? "current" : ""}`}
                  onClick={() => setLevel(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </>
        )}
        {controls.defaults && (
          <label class="scope-row" htmlFor="scope-default">
            <span>
              <span class="scope-title">Also make it my default</span>
              <span class="scope-note">New sessions start with this model and effort.</span>
            </span>
            <input
              id="scope-default"
              type="checkbox"
              class="switch"
              aria-label="Also make it my default"
              checked={scope === "default"}
              onChange={(event) => setScope(event.currentTarget.checked ? "default" : "session")}
            />
          </label>
        )}
        <button
          type="button"
          class="apply-button"
          disabled={!changed || !picked}
          onClick={() => void onApply({ model: picked, effort: level, scope })}
        >
          {scope === "default" ? "Apply and save as default" : "Apply to this agent"}
        </button>
        <p class="modal-note">If the agent is busy, the change waits until it is ready.</p>
      </div>
    </div>
  );
}
