import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import { type DialogView, modelLabel, parseDialogView } from "../../shared/harness.ts";
import type { ChatItem } from "../../shared/history.ts";
import type { AgentView, ModelChangeView } from "../../shared/messages.ts";
import type { AllowedKey } from "../../shared/rpc.ts";
import { adapterFor } from "../agents/registry.ts";
import type { Block } from "../agents/types.ts";
import { appState, call, linkStatus, uploadImage } from "../connection.ts";
import { prepareImage } from "../images.ts";
import { agentTitle, shortPath, STATUS_LABELS } from "../format.ts";
import { back } from "../router.ts";
import { countUserText, type PendingMessage, settlePending } from "../pending.ts";
import { optionTone, shapeQuestion } from "../question.ts";
import { useControls } from "../use-controls.ts";
import { useHistory } from "../use-history.ts";
import { useTranscript } from "../use-transcript.ts";
import { ChatList } from "./chat.tsx";
import { Composer, ModelSheet } from "./composer.tsx";
import { ChevronLeft } from "./icons.tsx";

/** The distance from the bottom, in pixels, inside which new content scrolls into view. */
const STICK_DISTANCE = 120;

function findAgent(paneId: string): AgentView | null {
  for (const workspace of appState.value?.workspaces ?? []) {
    const agent = workspace.agents.find((candidate) => candidate.paneId === paneId);

    if (agent) {
      return agent;
    }
  }

  return null;
}

/** The detail screen of one agent: its transcript and a composer. */
export function AgentScreen({ paneId }: { paneId: string }) {
  const agent = findAgent(paneId);

  return (
    <div class="detail">
      <header class="detail-top">
        <button type="button" class="icon-button" aria-label="Back" onClick={back}>
          <ChevronLeft />
        </button>
        <div class="detail-heading">
          <div class="detail-title">{agent ? agentTitle(agent) : paneId}</div>
          {agent && (
            <div class={`detail-sub status-${agent.status}`}>
              <span class="status-dot" aria-hidden="true" />
              {STATUS_LABELS[agent.status]} · {agent.kind} · {shortPath(agent.cwd)}
            </div>
          )}
        </div>
        <span class="icon-button-spacer" />
      </header>
      {agent ? (
        <AgentBody agent={agent} />
      ) : appState.value === null ? (
        <div class="gone">
          <p>Connecting…</p>
        </div>
      ) : (
        <div class="gone">
          <p>This agent is not running anymore.</p>
          <button type="button" class="pill-button" onClick={back}>
            Back to agents
          </button>
        </div>
      )}
    </div>
  );
}

const NO_ITEMS: readonly ChatItem[] = [];

function AgentBody({ agent }: { agent: AgentView }) {
  const connected = linkStatus.value === "open";
  const history = useHistory(agent.paneId, agent.status, connected);
  const fallback = history.mode === "unsupported";
  const controls = useControls(agent.paneId, connected);
  const [modelOpen, setModelOpen] = useState(false);

  const transcript = useTranscript(agent.paneId, agent.kind, agent.status, connected, fallback);

  const sessionModel = history.state?.model ?? null;
  const sessionEffort = history.state?.effort ?? null;

  const items = history.state?.items ?? NO_ITEMS;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const nextPending = useRef(1);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setPending((current) => (current.length === 0 ? current : settlePending(current, items)));
  }, [items]);

  useLayoutEffect(() => {
    const element = scroller.current;

    if (element && stick.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [items, pending, transcript.blocks, agent.status]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = setTimeout(() => setNotice(null), 4000);

    return () => clearTimeout(timer);
  }, [notice]);

  function refresh() {
    stick.current = true;
    setTimeout(() => {
      history.reload();
      transcript.reload();
    }, 300);
  }

  async function sendKeys(keys: AllowedKey[]) {
    try {
      await call({ method: "keys", paneId: agent.paneId, keys });
      refresh();
    } catch (problem) {
      setNotice(problem instanceof Error ? problem.message : String(problem));
    }
  }

  async function runCommand(text: string) {
    try {
      await call({ method: "prompt", paneId: agent.paneId, text, images: [] });
      refresh();
    } catch (problem) {
      setNotice(problem instanceof Error ? problem.message : String(problem));
    }
  }

  async function send(text: string, files: Blob[]) {
    if (text.startsWith("/") && files.length === 0) {
      return runCommand(text);
    }

    const message: PendingMessage = {
      id: nextPending.current++,
      text,
      seen: countUserText(items, text),
      failed: false,
      files,
      previews: files.map((file) => URL.createObjectURL(file)),
    };

    stick.current = true;
    setPending((current) => [...current, message]);

    try {
      const images = await Promise.all(files.map((file) => prepareImage(file).then(uploadImage)));

      await call({ method: "prompt", paneId: agent.paneId, text, images });
      refresh();

      // The history can show the message in a form that does not match, for example with the
      // text that an agent changed. The message is sent, so do not show it as pending forever.
      setTimeout(() => setPending((current) => current.filter((m) => m.id !== message.id)), 90_000);

      if (fallback) {
        setTimeout(() => setPending((current) => current.filter((m) => m.id !== message.id)), 2500);
      }
    } catch (problem) {
      setPending((current) =>
        current.map((m) => (m.id === message.id ? { ...m, failed: true } : m)),
      );
      setNotice(problem instanceof Error ? problem.message : String(problem));
    }
  }

  function retry(message: PendingMessage) {
    setPending((current) => current.filter((m) => m.id !== message.id));
    void send(message.text, message.files);
  }

  const loading = fallback ? transcript.blocks === null : history.mode === "loading";
  const empty = fallback ? transcript.blocks?.length === 0 : items.length === 0;

  return (
    <>
      <div
        class="transcript"
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget;

          stick.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < STICK_DISTANCE;
        }}
      >
        <div class="transcript-inner">
          {loading && pending.length === 0 ? (
            <p class="empty center">{transcript.error ?? "Loading…"}</p>
          ) : empty && pending.length === 0 ? (
            <p class="empty center">Nothing here yet. Say hi.</p>
          ) : fallback ? (
            <>
              {transcript.blocks?.map((block, index) => (
                <BlockView key={index} block={block} />
              ))}
              <ChatList items={NO_ITEMS} pending={pending} onRetry={retry} />
            </>
          ) : (
            <ChatList items={items} pending={pending} onRetry={retry} />
          )}
          {agent.status === "working" && (
            <div class="typing" role="status" aria-label="The agent is working">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      </div>
      {notice && (
        <div class="toast" role="alert">
          {notice}
        </div>
      )}
      {agent.status === "blocked" ? (
        <QuestionSheet
          paneId={agent.paneId}
          onError={setNotice}
          onDone={refresh}
          onKeys={(keys) => void sendKeys(keys)}
        />
      ) : (
        <Composer
          working={agent.status === "working"}
          disabled={!connected}
          controls={controls}
          modelLabel={
            controls && (controls.models.length > 0 || sessionModel)
              ? chipLabel(agent.modelChange, sessionModel, sessionEffort)
              : null
          }
          modelLocked={!controls || controls.models.length === 0}
          onSend={send}
          onStop={() => void sendKeys(adapterFor(agent.kind).interruptKeys)}
          onOpenModel={() => setModelOpen(true)}
        />
      )}
      {modelOpen && controls && (
        <ModelSheet
          controls={controls}
          model={sessionModel}
          effort={sessionEffort}
          onClose={() => setModelOpen(false)}
          onApply={async (change) => {
            setModelOpen(false);

            try {
              await call({ method: "setModel", paneId: agent.paneId, change });
            } catch (problem) {
              setNotice(problem instanceof Error ? problem.message : String(problem));
            }
          }}
        />
      )}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.role) {
    case "user":
      return <div class="msg msg-user">{block.text}</div>;

    case "agent":
      return <div class="msg msg-agent">{block.text}</div>;

    case "tool":
      return <ToolBlock text={block.text} />;

    case "meta":
      return <div class="msg-meta">{block.text}</div>;

    case "terminal":
      return <pre class="msg-terminal">{block.text}</pre>;
  }
}

function ToolBlock({ text }: { text: string }) {
  const [first = "", ...rest] = text.split("\n");

  if (rest.length === 0) {
    return <div class="msg-tool">{first}</div>;
  }

  return (
    <details class="msg-tool">
      <summary>{first}</summary>
      <pre>{rest.join("\n")}</pre>
    </details>
  );
}

/** Gives the text of the model chip, for example `Opus 5.5 · medium`. */
function chipLabel(
  change: ModelChangeView | undefined,
  model: string | null,
  effort: string | null,
): string {
  if (change?.status === "queued" || change?.status === "applying") {
    return `→ ${change.label}…`;
  }

  if (change?.status === "failed") {
    return `⚠ ${change.label}`;
  }

  if (change?.status === "done") {
    return change.label;
  }

  const name = model ? modelLabel(model) : "Model";

  return effort ? `${name} · ${effort}` : name;
}

/** How often the question sheet reads the question again. */
const QUESTION_POLL_MS = 1000;

/**
 * The question that a blocked agent asks, with a button for each option. The bridge reads the
 * question from the screen of the agent and picks the option for the user.
 */
function QuestionSheet({
  paneId,
  onError,
  onDone,
  onKeys,
}: {
  paneId: string;
  onError: (message: string) => void;
  onDone: () => void;
  onKeys: (keys: AllowedKey[]) => void;
}) {
  const [dialog, setDialog] = useState<DialogView | null | undefined>(undefined);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const next = parseDialogView(await call({ method: "dialog", paneId }));

        if (!cancelled) {
          setDialog(next);
        }
      } catch {
        if (!cancelled) {
          setDialog(null);
        }
      }

      if (!cancelled) {
        timer = setTimeout(() => void poll(), QUESTION_POLL_MS);
      }
    }

    void poll();

    return () => {
      cancelled = true;

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [paneId]);

  async function choose(index: number) {
    if (!dialog || busy !== null) {
      return;
    }

    setBusy(index);

    try {
      await call({
        method: "choose",
        paneId,
        index,
        labels: dialog.options.map((option) => option.label),
      });
      onDone();
    } catch (problem) {
      onError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class="sheet question">
      <div class="sheet-title">
        <span class="status-dot" aria-hidden="true" />
        Needs you
      </div>
      {dialog === undefined ? (
        <p class="question-headline muted">Reading the question…</p>
      ) : dialog ? (
        <>
          <QuestionBody text={dialog.question} />
          <div class="question-options">
            {dialog.options.map((option, index) => (
              <button
                key={option.label}
                type="button"
                class={`question-option tone-${optionTone(option.label)}`}
                disabled={busy !== null}
                onClick={() => void choose(index)}
              >
                {busy === index ? (
                  <span class="question-spinner" aria-label="Sending" />
                ) : (
                  option.label
                )}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p class="question-headline">The agent asks something that the app cannot read.</p>
          <div class="question-options">
            <button
              type="button"
              class="question-option tone-yes"
              onClick={() => onKeys(["enter"])}
            >
              Confirm
            </button>
            <button type="button" class="question-option tone-no" onClick={() => onKeys(["esc"])}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function QuestionBody({ text }: { text: string }) {
  const shape = useMemo(() => shapeQuestion(text), [text]);
  const [open, setOpen] = useState(false);

  return (
    <div class="question-body">
      {shape.headline && <p class="question-headline">{shape.headline}</p>}
      {shape.details.length > 0 && (
        <>
          {open && (
            <div class="question-details">
              {shape.details.map((detail, index) =>
                detail.kind === "path" ? (
                  <code key={index} class="question-path">
                    {detail.text}
                  </code>
                ) : (
                  <p key={index}>{detail.text}</p>
                ),
              )}
            </div>
          )}
          <button type="button" class="question-more" onClick={() => setOpen(!open)}>
            {open ? "Hide details" : "Show details"}
          </button>
        </>
      )}
    </div>
  );
}
