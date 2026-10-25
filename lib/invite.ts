/** Accepts a bare invite token or a pasted `/join/<token>` link and returns the token. */
export function extractInviteToken(input: string): string {
  const trimmed = input.trim();
  const match = /\/join\/([^/?#\s]+)/.exec(trimmed);
  const token = match ? decodeURIComponent(match[1]!) : trimmed;
  // Short room codes are not case-sensitive; older long links keep their exact spelling.
  return token.length <= 8 ? token.toUpperCase() : token;
}

export function inviteUrl(joinPath: string, origin: string): string {
  return new URL(joinPath, origin).toString();
}

/**
 * QR codes and shared invitations always use the address the host opened.
 * A stale deployment/tunnel setting must never redirect friends elsewhere.
 */
export function appOrigin(pageOrigin: string): string {
  return pageOrigin.replace(/\/+$/, "");
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
