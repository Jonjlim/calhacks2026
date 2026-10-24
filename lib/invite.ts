/** Accepts a bare invite token or a pasted `/join/<token>` link and returns the token. */
export function extractInviteToken(input: string): string {
  const trimmed = input.trim();
  const match = /\/join\/([^/?#\s]+)/.exec(trimmed);
  return match ? decodeURIComponent(match[1]!) : trimmed;
}

export function inviteUrl(joinPath: string, origin: string): string {
  return new URL(joinPath, origin).toString();
}
