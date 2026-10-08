import { describe, expect, test } from "bun:test";

import { parseRoute, routePath } from "./routes.ts";

describe("parseRoute", () => {
  test("gives back the pane ID that routePath encoded", () => {
    const route = { name: "agent", paneId: "w3:p12" } as const;

    expect(parseRoute(routePath(route))).toEqual(route);
  });

  test("sends a path that is not known to the list", () => {
    expect(parseRoute("/agent/")).toEqual({ name: "list" });
    expect(parseRoute("/settings")).toEqual({ name: "list" });
  });
});
