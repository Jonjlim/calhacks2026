import { describe, expect, it } from "vitest";
import { extractInviteToken, inviteUrl } from "./invite";

describe("extractInviteToken", () => {
  it("returns a bare token unchanged", () => {
    expect(extractInviteToken("  abc123  ")).toBe("abc123");
  });

  it("pulls the token out of a pasted join link", () => {
    expect(extractInviteToken("https://unwrap.app/join/abc123?x=1#y")).toBe("abc123");
    expect(extractInviteToken("/join/abc123")).toBe("abc123");
  });
});

describe("inviteUrl", () => {
  it("joins the path onto the origin", () => {
    expect(inviteUrl("/join/abc", "http://localhost:3000")).toBe("http://localhost:3000/join/abc");
  });
});
