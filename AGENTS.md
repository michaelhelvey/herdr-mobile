# herdr-mobile

A small web PWA (not a native app) to control the agents in Herdr from a phone. It must look good
and work well on a phone screen first.

## Toolchains

- Use `rstack` cli for linting and formatting (node_modules/rstack/docs/llms.txt). Use `bun run` for
  its scripts. A different `rs` binary is on the macOS `PATH`.
- Use `bun` for package management, the dev server, the bundler, and unit tests
  (https://bun.sh/llms.txt). Do not add Vite, Webpack, or other build tools.
- The UI uses `preact` and `@preact/signals`.

## Layout

```
./index.html            -- the entry point of the app. Bun bundles it and its imports.
./src/main.tsx          -- renders the app into the page.
./src/app.tsx           -- the root component.
./src/client/           -- browser code: the WebSocket connection to the bridge, formatting.
./src/server/           -- the bridge (Bun). It reads the Herdr socket and serves the PWA and `/ws`.
./src/shared/           -- types and parsers for the messages between the bridge and the PWA.
./docs/protocol.md      -- the Herdr socket API.
./rstack.config.ts      -- lint, format, and git hook configuration.
```

## Scripts

- `bun run dev`: start the bridge, which also serves the PWA with hot reload, at
  http://localhost:5173.
- `bun run build`: compile the bridge and the PWA into one binary, `dist/herdr-bridge`.
- `bun run start`: run the compiled binary.
- `bun run validate`: format, then lint, type check, and run the tests.

## General Rules

- Always validate your work via all relevant checks (`bun run validate`) before declaring your work
  done.
- Expose scripts for developers via the `scripts` section of `package.json`.
- Keep the README short and to the point.

## Typescript Rules

- All documentation and code comments should use ASD-STE100 Simplified Technical English.
- Add doc comments to all public exports from a module. Avoid non-doc comments within code unless
  overwhelmingly necessary to explain an otherwise odd decision that would strike the reader as
  wrong at first glance (e.g. a lint ignore).
- Do not cast unknown data (for example, data from the network). Parse it.
- Keep logic in plain `.ts` modules that do not touch the DOM, so that `bun test` can test it.

## Testing Rules

- Put a test next to the module that it tests, as `name.test.ts`.
- Any test that calls a real external service, uses a web browser, and so on, is an e2e test, and
  must be suffixed with `.e2e.test.ts`.
- Do not write tautological tests. Tests must assert something meaningful about the system that they
  test which cannot be trivially derived from the literal tokens in the code.
- Do not write code that requires module mocks in order to test -- use proper dependency injection.
  Creating `mock` functions from `bun:test` in order to assert how they are called is allowed.

## Github / Collaboration Rules

- Don't make git commits unless you're in a worktree or I ask you to. If you're not in a worktree,
  that means that you are working collaboratively with me and other agents.
- Outside of a worktree, other agents and humans will be working with you in the same working tree.
  Do not change unrelated files or step on their work.
