import { signal } from "@preact/signals";

import { parseRoute, type Route, routePath } from "./routes.ts";

/** The current route. */
export const route = signal<Route>(parseRoute(window.location.pathname));

window.addEventListener("popstate", () => {
  route.value = parseRoute(window.location.pathname);
});

/** Goes to a route. It keeps the URL hash, because the hash can hold the pairing token. */
export function navigate(next: Route): void {
  window.history.pushState({ app: true }, "", `${routePath(next)}${window.location.hash}`);
  route.value = next;
}

/**
 * Goes back to the list. If the app opened the current screen, it uses the browser history, so
 * that the back gesture and this function do the same thing.
 */
export function back(): void {
  const state: unknown = window.history.state;

  if (typeof state === "object" && state !== null && "app" in state) {
    window.history.back();

    return;
  }

  window.history.replaceState(null, "", `/${window.location.hash}`);
  route.value = { name: "list" };
}
