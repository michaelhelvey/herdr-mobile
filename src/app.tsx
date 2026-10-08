import { useState } from "preact/hooks";

import { appState, linkStatus, pair } from "./client/connection.ts";
import { route } from "./client/router.ts";
import { AgentScreen } from "./client/views/agent.tsx";
import { ListView } from "./client/views/list.tsx";

/** The root component of the app. */
export function App() {
  const current = route.value;

  if (linkStatus.value === "unpaired") {
    return <PairScreen />;
  }

  if (current.name === "agent") {
    return <AgentScreen key={current.paneId} paneId={current.paneId} />;
  }

  const state = appState.value;

  return (
    <div class="shell">
      <header class="top">
        <h1>herdr</h1>
        <LinkPill />
      </header>
      <main>{state ? <ListView state={state} /> : <p class="empty">Connecting…</p>}</main>
    </div>
  );
}

function LinkPill() {
  const status = linkStatus.value;
  const herdr = appState.value?.herdr;
  const ok = status === "open" && herdr?.ok === true;

  const label =
    status !== "open"
      ? status === "connecting"
        ? "Connecting"
        : "Offline"
      : ok
        ? "Live"
        : "Herdr down";

  return (
    <span class={`pill ${ok ? "pill-ok" : "pill-bad"}`}>
      <span class="pill-dot" />
      {label}
    </span>
  );
}

function PairScreen() {
  const [token, setToken] = useState("");

  return (
    <div class="pair">
      <img class="pair-icon" src="/icon-512.png" alt="" width="96" height="96" />
      <h1>Pair this phone</h1>
      <p class="pair-lead">
        You are connecting from outside your home network, so the bridge needs to know this phone.
      </p>
      <ol class="pair-steps">
        <li>
          On your Mac, start the bridge with <code>HERDR_BRIDGE_PUBLIC_URL</code> set to your
          tunnel.
        </li>
        <li>Open the Camera on this phone.</li>
        <li>Scan the code under “Away from home”. That is all.</li>
      </ol>
      <details class="pair-manual">
        <summary>Have a token?</summary>
        <form
          class="pair-form"
          onSubmit={(event) => {
            event.preventDefault();

            if (token.trim()) {
              pair(token);
            }
          }}
        >
          <input
            type="password"
            value={token}
            placeholder="Paste the token"
            aria-label="Pairing token"
            autoComplete="off"
            onInput={(event) => setToken(event.currentTarget.value)}
          />
          <button type="submit" class="pill-button" disabled={!token.trim()}>
            Pair
          </button>
        </form>
      </details>
    </div>
  );
}
