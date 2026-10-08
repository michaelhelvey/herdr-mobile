import { describe, expect, test } from "bun:test";

import { parseStateMessage } from "./messages.ts";
import { ParseError } from "./parse.ts";

describe("parseStateMessage", () => {
  test("changes a status that is not known to unknown", () => {
    const message = parseStateMessage(
      JSON.stringify({
        type: "state",
        state: {
          herdr: { ok: true, version: "0.9.3" },
          workspaces: [
            {
              id: "w1",
              label: "app",
              agents: [
                { paneId: "w1:p1", kind: "claude", title: null, status: "napping", cwd: null },
              ],
            },
          ],
        },
      }),
    );

    expect(message.state.workspaces[0]?.agents[0]?.status).toBe("unknown");
  });

  test("tells where the message is not valid", () => {
    const raw = JSON.stringify({
      type: "state",
      state: {
        herdr: { ok: true, version: "1" },
        workspaces: [{ id: "w1", label: 7, agents: [] }],
      },
    });

    expect(() => parseStateMessage(raw)).toThrow(
      new ParseError("state.workspaces[0].label: expected a string"),
    );
  });
});
