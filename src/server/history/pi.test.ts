import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { piControls, piModels } from "./pi.ts";

async function settings(dir: string, enabledModels: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "settings.json"), JSON.stringify({ enabledModels }));
}

describe("piModels", () => {
  test("uses the project models before the user models, and skips patterns", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-models-"));
    const home = join(root, "home");
    const cwd = join(root, "project");

    await settings(home, ["t4/user-model"]);
    await settings(join(cwd, ".pi"), ["t4/gpt-5.6-sol", "anthropic/*"]);

    expect(await piModels(cwd, home)).toEqual([{ alias: "t4/gpt-5.6-sol", label: "gpt-5.6-sol" }]);
    expect(await piModels(join(root, "other"), home)).toEqual([
      { alias: "t4/user-model", label: "user-model" },
    ]);
  });
});

describe("piControls", () => {
  test("gives the thinking levels, and no default switch", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-controls-"));
    const controls = await piControls(null, root);

    expect(controls.efforts).toContain("xhigh");
    expect(controls.defaults).toBe(false);
    expect(controls.commands.some((command) => command.name === "compact")).toBe(true);
  });
});
