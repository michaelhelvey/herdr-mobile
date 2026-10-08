/** Splits a stream of text chunks into complete lines. A line ends with `\n`. */
export class LineBuffer {
  #rest = "";

  /** Adds a chunk and gives the lines that are now complete, without the `\n`. */
  push(chunk: string): string[] {
    const parts = (this.#rest + chunk).split("\n");

    this.#rest = parts.pop() ?? "";

    return parts.filter((line) => line.length > 0);
  }
}
