import { open, stat } from "node:fs/promises";

/** Takes the parsed lines of a JSONL file, one at a time, in the order of the file. */
export interface RecordSink {
  add: (entry: unknown) => void;
}

/**
 * Reads a growing JSONL file. Each call parses only the lines that are new since the last call.
 * If the file gets shorter, the harness wrote it again, so it starts again with a new sink.
 */
export class JsonlTail<T extends RecordSink> {
  #offset = 0;
  #sink: T;

  constructor(
    readonly path: string,
    private readonly make: () => T,
  ) {
    this.#sink = make();
  }

  async read(): Promise<T> {
    const { size } = await stat(this.path);

    if (size < this.#offset) {
      this.#offset = 0;
      this.#sink = this.make();
    }

    if (size === this.#offset) {
      return this.#sink;
    }

    const handle = await open(this.path, "r");

    try {
      const bytes = new Uint8Array(size - this.#offset);

      await handle.read(bytes, 0, bytes.length, this.#offset);

      const end = bytes.lastIndexOf(10);

      if (end === -1) {
        return this.#sink;
      }

      const chunk = new TextDecoder().decode(bytes.subarray(0, end));

      this.#offset += end + 1;

      for (const line of chunk.split("\n")) {
        if (line.trim()) {
          try {
            this.#sink.add(JSON.parse(line));
          } catch {
            // A line that is not valid JSON is not a record. The harness can write it later again.
          }
        }
      }

      return this.#sink;
    } finally {
      await handle.close();
    }
  }
}
