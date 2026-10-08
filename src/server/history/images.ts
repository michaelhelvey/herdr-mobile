/** An image from a session file. */
export interface StoredImage {
  mediaType: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Keeps the images of session files in memory, so that the history can refer to an image by ID
 * and the PWA loads the bytes only when it shows the image. When the images use more than the
 * limit, the store removes the oldest.
 */
export class ImageStore {
  #images = new Map<string, StoredImage>();
  #bytes = 0;

  constructor(private readonly limit = 64 * 1024 * 1024) {}

  /** Adds an image that is in base64. */
  put(id: string, mediaType: string, base64: string): void {
    if (this.#images.has(id)) {
      return;
    }

    const bytes = Uint8Array.from(Buffer.from(base64, "base64"));

    this.#images.set(id, { mediaType, bytes });
    this.#bytes += bytes.length;

    for (const [oldId, image] of this.#images) {
      if (this.#bytes <= this.limit || oldId === id) {
        break;
      }

      this.#images.delete(oldId);
      this.#bytes -= image.bytes.length;
    }
  }

  /** Gives the image, or `undefined` if the store does not have it. */
  get(id: string): StoredImage | undefined {
    return this.#images.get(id);
  }
}
