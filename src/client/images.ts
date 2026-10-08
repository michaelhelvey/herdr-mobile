/** The longest side of an image that the PWA sends. Agents make larger images smaller anyway. */
export const MAX_IMAGE_SIDE = 2048;

/** Images this small go as they are, so that a screenshot keeps its exact pixels. */
const KEEP_BYTES = 1.5 * 1024 * 1024;

/** Gives the size that fits in a square of `max` and keeps the aspect ratio. */
export function fitSize(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));

  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Makes an image ready to send. A small PNG, JPEG, GIF, or WebP goes as it is. A large image, or an
 * image in a type that agents do not read (for example HEIC), becomes a JPEG that fits in
 * `MAX_IMAGE_SIDE`.
 */
export async function prepareImage(file: Blob): Promise<Blob> {
  const readable = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type);
  const bitmap = await createImageBitmap(file);
  const size = fitSize(bitmap.width, bitmap.height, MAX_IMAGE_SIDE);

  if (readable && file.size <= KEEP_BYTES && size.width === bitmap.width) {
    bitmap.close();

    return file;
  }

  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close();

    return file;
  }

  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();

  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.86 });
}
