/** A screen of the app. */
export type Route = { name: "list" } | { name: "agent"; paneId: string };

/** Gives the route for a URL path. A path that is not known goes to the list. */
export function parseRoute(pathname: string): Route {
  const match = /^\/agent\/([^/]+)\/?$/.exec(pathname);
  const id = match?.[1];

  return id ? { name: "agent", paneId: decodeURIComponent(id) } : { name: "list" };
}

/** Gives the URL path of a route. */
export function routePath(route: Route): string {
  return route.name === "agent" ? `/agent/${encodeURIComponent(route.paneId)}` : "/";
}
