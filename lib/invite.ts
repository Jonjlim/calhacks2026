/** Accepts a bare invite token or a pasted `/join/<token>` link and returns the token. */
export function extractInviteToken(input: string): string {
  const trimmed = input.trim();
  const match = /\/join\/([^/?#\s]+)/.exec(trimmed);
  return match ? decodeURIComponent(match[1]!) : trimmed;
}

export function inviteUrl(joinPath: string, origin: string): string {
  return new URL(joinPath, origin).toString();
}

/**
 * Origin for links other devices open (QR codes, copied invites): a
 * configured public origin (NEXT_PUBLIC_APP_URL — a tunnel or deployment)
 * wins over the page's own, which may be localhost.
 */
export function appOrigin(pageOrigin: string): string {
  return (process.env.NEXT_PUBLIC_APP_URL || pageOrigin).replace(/\/+$/, "");
}

/** A phone on the network can't open these. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "0.0.0.0" || host === "[::1]" || host.startsWith("127.");
  } catch {
    return false;
  }
}
