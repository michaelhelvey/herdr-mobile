import type { LanguageFn } from "highlight.js";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { Marked } from "marked";

/** The languages that the PWA highlights, by name, and the other names for each. */
const LANGUAGES: [string, LanguageFn, string[]][] = [
  ["bash", bash, ["sh", "shell", "zsh", "console"]],
  ["css", css, []],
  ["diff", diff, ["patch"]],
  ["go", go, []],
  ["ini", ini, ["toml"]],
  ["javascript", javascript, ["js", "jsx", "mjs", "cjs"]],
  ["json", json, ["jsonc", "webmanifest"]],
  ["markdown", markdown, ["md"]],
  ["python", python, ["py"]],
  ["rust", rust, ["rs"]],
  ["sql", sql, []],
  ["typescript", typescript, ["ts", "tsx", "mts", "cts"]],
  ["xml", xml, ["html", "svg"]],
  ["yaml", yaml, ["yml"]],
];

for (const [name, language, aliases] of LANGUAGES) {
  hljs.registerLanguage(name, language);
  hljs.registerAliases(aliases, { languageName: name });
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Changes the characters that have a meaning in HTML into entities. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** Gives the highlight.js language for a file path, or `null` if it is not known. */
export function languageForPath(path: string): string | null {
  const name = path.split("/").at(-1) ?? "";
  const extension = name.includes(".") ? (name.split(".").at(-1) ?? "") : name;

  return hljs.getLanguage(extension.toLowerCase()) ? extension.toLowerCase() : null;
}

/** Gives the code as HTML with highlight spans. The result is safe to put in the page. */
export function highlight(code: string, language: string | null): string {
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  }

  return escapeHtml(code);
}

function safeHref(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href.trim()) ? href : null;
}

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    code({ text, lang }) {
      const language = (lang ?? "").trim().split(/\s+/)[0] ?? "";
      const label = language ? escapeHtml(language) : "code";

      return (
        `<div class="code-block"><div class="code-head"><span>${label}</span>` +
        `<button type="button" class="code-copy" data-copy>Copy</button></div>` +
        `<pre><code class="hljs">${highlight(text, language || null)}</code></pre></div>`
      );
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      const safe = safeHref(href);

      return safe
        ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : label;
    },
    image({ text }) {
      return escapeHtml(text);
    },
  },
});

/**
 * Changes Markdown from an agent into HTML. Raw HTML in the Markdown shows as text, and only web
 * and mail links stay links, so the result is safe to put in the page.
 */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false });

  return html
    .replaceAll("<table>", '<div class="table-wrap"><table>')
    .replaceAll("</table>", "</table></div>");
}
