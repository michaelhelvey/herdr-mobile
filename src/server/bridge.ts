import type { AppState } from "../shared/messages.ts";
import type { HerdrClient, HerdrSubscription, SubscriptionHandle } from "./herdr.ts";
import { agentPaneIds, stateFromSnapshot } from "./snapshot.ts";

/** The subscriptions that do not depend on a pane. */
const GLOBAL_SUBSCRIPTIONS: HerdrSubscription[] = [
  { type: "workspace.created" },
  { type: "workspace.updated" },
  { type: "workspace.renamed" },
  { type: "workspace.closed" },
  { type: "tab.created" },
  { type: "tab.closed" },
  { type: "pane.created" },
  { type: "pane.closed" },
  { type: "pane.exited" },
  { type: "pane.updated" },
  { type: "pane.agent_detected" },
];

/** The settings of a `Bridge`. */
export interface BridgeOptions {
  client: HerdrClient;
  /** The bridge calls this function each time the state changes. */
  onState(state: AppState): void;
  /** The time between two refreshes when no event comes. Events can get lost. Default 5000. */
  pollMs?: number;
  /** The time to wait after an event before a refresh, so that a burst of events causes one. */
  debounceMs?: number;
  /** The time to wait before the bridge tries again after a failure. Default 1000. */
  retryMs?: number;
  /**
   * The number of failed refreshes in sequence before the bridge reports that Herdr is down. Until
   * then, the bridge keeps the last good state. Herdr does not always answer a request. Default 3.
   */
  failureLimit?: number;
  /** Writes diagnostic messages. Default `console.error`. */
  log?(message: string): void;
}

/**
 * Keeps a copy of the Herdr state. The bridge gets a full snapshot when Herdr sends an event, and
 * at an interval. It sends the state to `onState` only when the state changes.
 */
export class Bridge {
  #options: Required<BridgeOptions>;
  #state: AppState = { herdr: { ok: false, error: "not connected yet" }, workspaces: [] };
  #stateJson = "";
  #subscription: SubscriptionHandle | null = null;
  #subscribedPanes = "";
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;
  #refreshing: Promise<void> | null = null;
  #dirty = false;
  #stopped = false;
  #failures = 0;

  constructor(options: BridgeOptions) {
    this.#options = {
      pollMs: 5000,
      debounceMs: 50,
      retryMs: 1000,
      failureLimit: 3,
      log: (message) => console.error(`[bridge] ${message}`),
      ...options,
    };
  }

  /** The most recent state. */
  get state(): AppState {
    return this.#state;
  }

  /** Gets the first snapshot and starts to listen for changes. */
  async start(): Promise<void> {
    this.#pollTimer = setInterval(() => this.#schedule(0), this.#options.pollMs);
    await this.refresh();
  }

  /** Stops all timers and closes the subscription. */
  stop(): void {
    this.#stopped = true;

    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
    }

    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
    }

    this.#subscription?.close();
  }

  /** Gets a new snapshot now. If a refresh is in progress, one more refresh runs after it. */
  refresh(): Promise<void> {
    if (this.#refreshing) {
      this.#dirty = true;

      return this.#refreshing;
    }

    this.#refreshing = this.#refreshLoop().finally(() => {
      this.#refreshing = null;
    });

    return this.#refreshing;
  }

  async #refreshLoop(): Promise<void> {
    do {
      this.#dirty = false;
      await this.#refreshOnce();
    } while (this.#dirty && !this.#stopped);
  }

  async #refreshOnce(): Promise<void> {
    let next: AppState;

    try {
      next = stateFromSnapshot(await this.#options.client.request("session.snapshot", {}));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.#failures++;
      this.#options.log(`refresh failed (${this.#failures}): ${message}`);

      if (this.#state.herdr.ok && this.#failures < this.#options.failureLimit) {
        this.#schedule(this.#options.retryMs);

        return;
      }

      next = { herdr: { ok: false, error: message }, workspaces: [] };
    }

    if (this.#stopped) {
      return;
    }

    this.#publish(next);

    if (next.herdr.ok) {
      this.#failures = 0;
      this.#ensureSubscription(agentPaneIds(next));
    }
  }

  #publish(next: AppState): void {
    const json = JSON.stringify(next);

    if (json === this.#stateJson) {
      return;
    }

    this.#state = next;
    this.#stateJson = json;
    this.#options.onState(next);
  }

  #ensureSubscription(paneIds: string[]): void {
    const key = paneIds.join(",");

    if (this.#subscription && key === this.#subscribedPanes) {
      return;
    }

    const previous = this.#subscription;

    const subscriptions: HerdrSubscription[] = [
      ...GLOBAL_SUBSCRIPTIONS,
      ...paneIds.map((paneId) => ({ type: "pane.agent_status_changed" as const, pane_id: paneId })),
    ];

    this.#subscribedPanes = key;

    const handle = this.#options.client.subscribe(subscriptions, {
      onEvent: () => this.#schedule(this.#options.debounceMs),
      onClose: (error) => {
        if (this.#subscription !== handle) {
          return;
        }

        this.#subscription = null;

        if (error && !this.#stopped) {
          this.#options.log(`subscription stopped: ${error.message}`);
          this.#schedule(this.#options.retryMs);
        }
      },
    });

    this.#subscription = handle;
    previous?.close();
  }

  #schedule(delayMs: number): void {
    if (this.#stopped || this.#debounceTimer) {
      return;
    }

    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      void this.refresh();
    }, delayMs);
  }
}
