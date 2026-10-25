const APPLE_EPOCH_S = 978_307_200;

/** Messages stores either seconds or nanoseconds since 2001-01-01 depending on macOS version. */
export function appleDateToMs(value: number | bigint): number {
  const n = typeof value === "bigint" ? Number(value) : value;
  const seconds = n > 1e12 ? n / 1e9 : n;
  return Math.round((seconds + APPLE_EPOCH_S) * 1000);
}

const NSSTRING = new TextEncoder().encode("NSString");

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Newer macOS versions leave `message.text` empty and keep the body in a
 * typedstream `attributedBody` blob. The plain string follows the NSString
 * class marker, five header bytes, and a length prefix (one byte, or 0x81
 * followed by a little-endian uint16).
 */
export function decodeAttributedBody(blob: Uint8Array | null | undefined): string | null {
  if (!blob || blob.length === 0) return null;
  const at = indexOf(blob, NSSTRING);
  if (at < 0) return null;
  let i = at + NSSTRING.length + 5;
  if (i >= blob.length) return null;
  let length = blob[i]!;
  i += 1;
  if (length === 0x81) {
    if (i + 2 > blob.length) return null;
    length = blob[i]! | (blob[i + 1]! << 8);
    i += 2;
  } else if (length === 0x82) {
    if (i + 3 > blob.length) return null;
    length = blob[i]! | (blob[i + 1]! << 8) | (blob[i + 2]! << 16);
    i += 3;
  }
  if (length <= 0 || i + length > blob.length) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(blob.subarray(i, i + length));
}

