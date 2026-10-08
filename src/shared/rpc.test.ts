import { describe, expect, test } from "bun:test";

import { parseClientMessage } from "./rpc.ts";

function rpc(call: unknown): string {
  return JSON.stringify({ type: "rpc", id: 1, call });
}

describe("parseClientMessage", () => {
  test("accepts keys for a dialog", () => {
    expect(
      parseClientMessage(rpc({ method: "keys", paneId: "w1:p1", keys: ["down", "enter"] })),
    ).toEqual({
      type: "rpc",
      id: 1,
      call: { method: "keys", paneId: "w1:p1", keys: ["down", "enter"] },
    });
  });

  test("refuses a key that is not in the allowed list", () => {
    expect(() =>
      parseClientMessage(rpc({ method: "keys", paneId: "w1:p1", keys: ["ctrl+d"] })),
    ).toThrow('key "ctrl+d" is not allowed');
  });

  test("refuses a method that the bridge does not expose", () => {
    expect(() =>
      parseClientMessage(rpc({ method: "pane.send_text", paneId: "w1:p1", text: "rm -rf ~" })),
    ).toThrow("call.method");
  });

  test("refuses an empty prompt", () => {
    expect(() =>
      parseClientMessage(rpc({ method: "prompt", paneId: "w1:p1", text: "   " })),
    ).toThrow("call.text");
  });

  test("refuses an image ID that could point outside the upload folder", () => {
    expect(() =>
      parseClientMessage(
        rpc({ method: "prompt", paneId: "w1:p1", text: "x", images: ["../../.ssh/id_rsa"] }),
      ),
    ).toThrow("not an upload ID");
  });

  test("accepts a message with only an image", () => {
    const id = "0b9c2a4e-6f1d-4c1e-9a7b-3d2f1e0c9b8a.jpg";

    expect(
      parseClientMessage(rpc({ method: "prompt", paneId: "w1:p1", text: "", images: [id] })),
    ).toMatchObject({ call: { images: [id] } });
  });
});
