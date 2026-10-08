import { describe, expect, test } from "bun:test";

import { isPrivateAddress, isTrustedRequest } from "./trust.ts";

describe("isPrivateAddress", () => {
  test("accepts the home network, this machine, and Tailscale", () => {
    expect(
      [
        "192.168.50.20",
        "10.0.0.4",
        "172.20.1.1",
        "127.0.0.1",
        "::1",
        "::ffff:192.168.1.9",
        "100.101.2.3",
        "fd7a:115c::1",
      ].map(isPrivateAddress),
    ).toEqual([true, true, true, true, true, true, true, true]);
  });

  test("refuses public addresses, also those that are near a private range", () => {
    expect(
      ["8.8.8.8", "172.32.0.1", "100.128.0.1", "192.169.0.1", "2606:4700::1", "not-an-ip"].map(
        isPrivateAddress,
      ),
    ).toEqual([false, false, false, false, false, false]);
  });
});

describe("isTrustedRequest", () => {
  test("trusts a phone on the home network", () => {
    expect(isTrustedRequest("192.168.50.20", new Headers())).toBe(true);
  });

  test("does not trust a tunnel that connects from this machine", () => {
    expect(isTrustedRequest("127.0.0.1", new Headers({ "cf-connecting-ip": "203.0.113.9" }))).toBe(
      false,
    );
    expect(isTrustedRequest("::1", new Headers({ "x-forwarded-for": "203.0.113.9" }))).toBe(false);
  });

  test("does not trust a request without an address", () => {
    expect(isTrustedRequest(null, new Headers())).toBe(false);
  });
});
