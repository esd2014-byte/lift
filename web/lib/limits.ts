/**
 * Largest progress photo, in bytes of image data. Shared by the app (which shrinks
 * photos to fit) and the server (which enforces it).
 *
 * Vercel rejects request bodies over 4.5 MB before the route ever runs, and the
 * photo travels as base64, which is a third larger than the image. 3 MB of image
 * is about 4 MB on the wire: under the ceiling with room for the JSON around it.
 */
export const MAX_PHOTO_BYTES = 3_000_000;

/** Decoded size of a base64 payload. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}
