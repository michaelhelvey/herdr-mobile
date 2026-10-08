import type { HerdrClient } from "../herdr.ts";
import { ClaudeHistory } from "./claude.ts";
import type { ImageStore } from "./images.ts";
import { OpencodeHistory } from "./opencode.ts";
import { PiHistory } from "./pi.ts";
import type { HistoryProvider } from "./types.ts";

/** Makes the history providers, by the Herdr agent kind. */
export function createHistoryProviders(
  client: HerdrClient,
  images: ImageStore,
  uploadDir: string,
): Map<string, HistoryProvider> {
  return new Map<string, HistoryProvider>([
    ["claude", new ClaudeHistory(client, images, uploadDir)],
    ["opencode", new OpencodeHistory(client, images, uploadDir)],
    ["pi", new PiHistory(client, images, uploadDir)],
  ]);
}
