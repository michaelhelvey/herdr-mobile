import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import type { ChatItem, DiffLine, FileDiff } from "../../shared/history.ts";
import { highlight, languageForPath, renderMarkdown } from "../markdown.ts";
import { fetchImage } from "../connection.ts";
import type { PendingMessage } from "../pending.ts";
import { type ChatRow, groupToolRuns, toolNames } from "../tool-runs.ts";

type ToolItem = Extract<ChatItem, { type: "tool" }>;

/** The number of diff lines that a closed diff card shows. */
const DIFF_PREVIEW_LINES = 14;

/** The chat: messages, tool runs, and file changes, then the messages that are not sent yet. */
export function ChatList({
  items,
  pending,
  onRetry,
}: {
  items: readonly ChatItem[];
  pending: readonly PendingMessage[];
  onRetry: (message: PendingMessage) => void;
}) {
  const rows = useMemo(() => groupToolRuns(items), [items]);

  return (
    <>
      {rows.map((row) => (
        <Row key={row.kind === "tools" ? row.id : row.item.id} row={row} />
      ))}
      {pending.map((message) => (
        <div key={message.id} class="user-turn">
          {message.previews.length > 0 && (
            <div class="msg-images">
              {message.previews.map((url) => (
                <ImageThumb key={url} url={url} />
              ))}
            </div>
          )}
          <button
            type="button"
            class={`msg msg-user msg-pending ${message.failed ? "msg-failed" : ""}`}
            disabled={!message.failed}
            onClick={() => onRetry(message)}
          >
            {message.text}
            <span class="msg-state">
              {message.failed ? "Not sent · tap to try again" : "Sending…"}
            </span>
          </button>
        </div>
      ))}
    </>
  );
}

function Row({ row }: { row: ChatRow }) {
  if (row.kind === "tools") {
    return <ToolRun tools={row.tools} />;
  }

  const { item } = row;

  switch (item.type) {
    case "user":
      return (
        <div class="user-turn">
          {item.images.length > 0 && (
            <div class="msg-images">
              {item.images.map((id) => (
                <HistoryImage key={id} id={id} />
              ))}
            </div>
          )}
          {item.text && <div class="msg msg-user">{item.text}</div>}
        </div>
      );

    case "assistant":
      return <Markdown text={item.text} />;

    case "notice":
      return <div class="msg-meta">{item.text}</div>;

    case "output":
      return (
        <div class="output-card">
          {item.markdown ? <Markdown text={item.text} /> : <pre>{item.text}</pre>}
        </div>
      );

    case "tool":
      return item.diff ? <DiffCard diff={item.diff} /> : <ToolRun tools={[item]} />;
  }
}

/** Assistant text as Markdown. The copy buttons of code blocks copy the code. */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = root.current;

    function copy(event: MouseEvent) {
      const target = event.target;

      if (!(target instanceof HTMLButtonElement) || !target.matches("[data-copy]")) {
        return;
      }

      const code = target.closest(".code-block")?.querySelector("code")?.textContent ?? "";

      void navigator.clipboard?.writeText(code).then(() => {
        target.textContent = "Copied";
        setTimeout(() => (target.textContent = "Copy"), 1500);
      });
    }

    element?.addEventListener("click", copy);

    return () => element?.removeEventListener("click", copy);
  }, []);

  return (
    <div
      ref={root}
      class="markdown"
      // The HTML comes from `renderMarkdown`, which escapes raw HTML and removes unsafe links.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function ToolRun({ tools }: { tools: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  const running = tools.some((tool) => tool.output === null);
  const failed = tools.some((tool) => tool.isError);
  const names = toolNames(tools);

  const label =
    tools.length === 1
      ? `${tools[0]?.name ?? "Tool"} · ${tools[0]?.summary ?? ""}`
      : `Ran ${tools.length} tools · ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}`;

  return (
    <div class={`tool-run ${open ? "open" : ""}`}>
      <button type="button" class="tool-run-head" onClick={() => setOpen(!open)}>
        <span class={`tool-run-dot ${running ? "running" : failed ? "failed" : ""}`} />
        <span class="tool-run-label">{label}</span>
        <span class="tool-run-caret" aria-hidden="true">
          ›
        </span>
      </button>
      {open && (
        <div class="tool-run-body">
          {tools.map((tool) => (
            <ToolDetail key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolDetail({ tool }: { tool: ToolItem }) {
  return (
    <div class={`tool-detail ${tool.isError ? "failed" : ""}`}>
      <div class="tool-detail-head">
        <span class="tool-name">{tool.name}</span>
        <code>{tool.summary}</code>
      </div>
      {tool.output !== null && tool.output.trim() !== "" && (
        <pre class="tool-output">{tool.output}</pre>
      )}
    </div>
  );
}

function splitPath(path: string): { dir: string; name: string } {
  const index = path.lastIndexOf("/");

  return index === -1
    ? { dir: "", name: path }
    : { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

/** A change to one file, as a unified diff with line numbers and syntax colors. */
export function DiffCard({ diff }: { diff: FileDiff }) {
  const [open, setOpen] = useState(false);
  const language = languageForPath(diff.path);
  const { dir, name } = splitPath(diff.path);
  const total = diff.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  const long = total > DIFF_PREVIEW_LINES;
  let budget = open ? Number.POSITIVE_INFINITY : DIFF_PREVIEW_LINES;

  return (
    <div class="diff-card">
      <div class="diff-head">
        <div class="diff-path">
          <span class="diff-dir">{dir}</span>
          <span class="diff-name">{name}</span>
        </div>
        <div class="diff-stats">
          {diff.action === "create" && <span class="diff-badge">New</span>}
          {diff.added > 0 && <span class="diff-add">+{diff.added}</span>}
          {diff.removed > 0 && <span class="diff-del">−{diff.removed}</span>}
        </div>
      </div>
      <div class={`diff-body ${long && !open ? "clipped" : ""}`}>
        <table class="diff-table">
          {diff.hunks.map((hunk, index) => {
            if (budget <= 0) {
              return null;
            }

            const lines = hunk.lines.slice(0, budget);

            budget -= lines.length;

            return (
              <tbody key={index}>
                {index > 0 && (
                  <tr class="diff-gap">
                    <td colSpan={3}>⋯</td>
                  </tr>
                )}
                {lines.map((line, row) => (
                  <DiffRow key={row} line={line} language={language} />
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
      {(long || diff.truncated) && (
        <button type="button" class="diff-more" onClick={() => setOpen(!open)}>
          {open
            ? diff.truncated
              ? "Show less · the bridge cut the rest"
              : "Show less"
            : `Show all ${total} lines`}
        </button>
      )}
    </div>
  );
}

function DiffRow({ line, language }: { line: DiffLine; language: string | null }) {
  const html = useMemo(() => highlight(line.text, language), [line.text, language]);
  const sign = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";

  return (
    <tr class={`diff-line ${line.kind}`}>
      <td class="diff-no">{line.kind === "del" ? line.oldNo : line.newNo}</td>
      <td class="diff-sign">{sign}</td>
      {/* `highlight` escapes the code, so the HTML is safe. */}
      <td class="diff-code" dangerouslySetInnerHTML={{ __html: html || " " }} />
    </tr>
  );
}

/** An image of the history. It loads the image from the bridge when it shows. */
function HistoryImage({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current: string | null = null;
    let cancelled = false;

    fetchImage(id).then(
      (value) => {
        if (cancelled) {
          URL.revokeObjectURL(value);
        } else {
          current = value;
          setUrl(value);
        }
      },
      () => !cancelled && setFailed(true),
    );

    return () => {
      cancelled = true;

      if (current) {
        URL.revokeObjectURL(current);
      }
    };
  }, [id]);

  if (failed) {
    return <div class="msg-image missing">Image</div>;
  }

  return url ? <ImageThumb url={url} /> : <div class="msg-image loading" />;
}

/** A small image in a message. A tap shows the image on the full screen. */
function ImageThumb({ url }: { url: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        class="msg-image"
        aria-label="Show the image"
        onClick={() => setOpen(true)}
      >
        <img src={url} alt="" />
      </button>
      {open && (
        <button
          type="button"
          class="lightbox"
          aria-label="Close the image"
          onClick={() => setOpen(false)}
        >
          <img src={url} alt="" />
        </button>
      )}
    </>
  );
}
