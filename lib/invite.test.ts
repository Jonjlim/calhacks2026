import { describe, expect, it } from "vitest";
import { extractInviteToken, inviteUrl } from "./invite";

describe("extractInviteToken", () => {
  it("returns a bare token unchanged", () => {
    expect(extractInviteToken("  K7P2  ")).toBe("K7P2");
  });

  it("treats a short room code as case-insensitive", () => {
    expect(extractInviteToken("k7p2")).toBe("K7P2");
  });

  it("keeps an older long link exactly as written", () => {
    expect(extractInviteToken("0a1b2c3d4e5f60718293a4b5c6d7e8f9")).toBe("0a1b2c3d4e5f60718293a4b5c6d7e8f9");
  });

  it("pulls the token out of a pasted join link", () => {
    expect(extractInviteToken("https://unwrap.app/join/K7P2?x=1#y")).toBe("K7P2");
    expect(extractInviteToken("/join/K7P2")).toBe("K7P2");
  });
});

describe("inviteUrl", () => {
  it("joins the path onto the origin", () => {
    expect(inviteUrl("/join/abc", "http://localhost:3000")).toBe("http://localhost:3000/join/abc");
  });
});
