import { describe, expect, test } from "bun:test";

import { bridgeUrl, reconnectDelay, tokenFromHash } from "./connection.ts";

describe("reconnectDelay", () => {
  test("doubles the delay and stops at the maximum", () => {
    expect([0, 1, 2, 3, 4, 5, 10].map((attempt) => reconnectDelay(attempt))).toEqual([
      500, 1000, 2000, 4000, 8000, 8000, 8000,
    ]);
  });
});

describe("bridgeUrl", () => {
  test("uses wss for a page on https, such as a tunnel", () => {
    expect(bridgeUrl({ protocol: "https:", host: "herdr.example.ts.net" })).toBe(
      "wss://herdr.example.ts.net/ws",
    );
  });

  test("uses ws and keeps the port for a page on the local network", () => {
    expect(bridgeUrl({ protocol: "http:", host: "192.168.1.20:5173" })).toBe(
      "ws://192.168.1.20:5173/ws",
    );
  });
});

describe("tokenFromHash", () => {
  test("reads the token from a pairing link and ignores other hashes", () => {
    expect(tokenFromHash("#token=abc_123-x")).toBe("abc_123-x");
    expect(tokenFromHash("#token=")).toBeNull();
    expect(tokenFromHash("")).toBeNull();
  });
});
