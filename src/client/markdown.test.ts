import { describe, expect, test } from "bun:test";

import { languageForPath, renderMarkdown } from "./markdown.ts";

describe("renderMarkdown", () => {
  test("shows raw HTML as text", () => {
    const html = renderMarkdown('hi <img src=x onerror="alert(1)"> <script>alert(2)</script>');

    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  test("keeps web links and removes script links", () => {
    const html = renderMarkdown("[ok](https://herdr.dev) [bad](javascript:alert(1))");

    expect(html).toContain('<a href="https://herdr.dev" target="_blank"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("bad");
  });

  test("highlights a code block in the language of the fence", () => {
    const html = renderMarkdown("```ts\nconst x: number = 1;\n```");

    expect(html).toContain('<div class="code-head"><span>ts</span>');
    expect(html).toContain('class="hljs-keyword">const</span>');
  });

  test("puts a table in a box that scrolls on a narrow screen", () => {
    expect(renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |")).toContain(
      '<div class="table-wrap"><table>',
    );
  });
});

describe("languageForPath", () => {
  test("knows common source files and refuses others", () => {
    expect(languageForPath("src/app.tsx")).toBe("tsx");
    expect(languageForPath("Cargo.toml")).toBe("toml");
    expect(languageForPath("notes.weird")).toBeNull();
  });
});
