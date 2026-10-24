import { expect, MOCK_TOKEN, test } from "./fixtures";

/**
 * Invite-link route (/join/[token]) and the room page it should lead to.
 * Today both are static/mock; tests assert what exists and `fixme` what does not.
 */

test.describe("/join/[token]", () => {
  test("renders the join form pre-filled from the URL", async ({ page }) => {
    await page.goto(`/join/${MOCK_TOKEN}`);
    await expect(page.getByText("Join a room", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("Invite code")).toHaveValue(MOCK_TOKEN);
    await expect(page.getByPlaceholder("Your name")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Join" })).toBeVisible();
  });

  // DEFECT QA-3 (components/room/JoinRoomForm.tsx via app/join/[token]/page.tsx): the route param
  // reaches the form still percent-encoded, so "hello%20world" is pre-filled literally. Real backend
  // tokens are 32 hex chars (no encoding needed), so impact is low today, but any token containing
  // an encoded character would silently fail to match. `test.fail` turns red when it is fixed.
  test.fail("DEFECT QA-3: decodes percent-encoded tokens before pre-filling", async ({ page }) => {
    for (const [segment, decoded] of [
      ["hello%20world", "hello world"],
      ["a%2Fb", "a/b"],
      ["%E2%9C%A8", "✨"],
    ] as const) {
      await page.goto(`/join/${segment}`);
      await expect(page.getByPlaceholder("Invite code"), segment).toHaveValue(decoded, { timeout: 2_000 });
    }
  });

  test("renders a hostile token as inert text (no markup injection, no script execution)", async ({ page }) => {
    let dialogs = 0;
    page.on("dialog", (d) => {
      dialogs++;
      void d.dismiss();
    });
    await page.goto(`/join/${encodeURIComponent('"><img src=x onerror=alert(1)>')}`);
    await expect(page.getByPlaceholder("Invite code")).toBeVisible();
    await expect(page.locator("img[src='x']")).toHaveCount(0);
    expect(dialogs).toBe(0);
  });

  test("does not crash on an absurdly long token", async ({ page }) => {
    const response = await page.goto(`/join/${"x".repeat(2000)}`);
    expect(response?.status()).toBeLessThan(500);
  });

  test("a bare /join (no token) is a clean 404, not a crash", async ({ request }) => {
    expect((await request.get("/join")).status()).toBe(404);
  });

  test("the page sets a sensible document title and language", async ({ page }) => {
    await page.goto(`/join/${MOCK_TOKEN}`);
    await expect(page).toHaveTitle(/Unwrap/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  // --- Not implemented yet. Each is a real acceptance test waiting for the feature. -----------------

  test.fixme("submitting joins the room via api.rooms.joinRoom and moves to the room (frontend is not wired to Convex)", async () => {
    // 1. visit /join/<real token>  2. enter a name  3. submit
    // expect: preview of the room (title/recipient) from api.rooms.previewInvite, then redirect to /room/<id>
  });

  test.fixme("an invalid or expired invite link shows a friendly 'invite not valid' state (previewInvite returns not_found)", async () => {});

  test.fixme("a returning member opening their own invite goes straight to the room (previewInvite.alreadyMember)", async () => {});

  test.fixme("after joining, the friend can submit exactly one memory about the recipient and sees a confirmation", async () => {
    // There is no memory-input UI yet. Backend path: api.clues.upsertManualPreference (room-visible manual clue).
  });
});

test.describe("/room/[roomId] (mock data)", () => {
  test("shows the demo room header and participant count", async ({ page }) => {
    await page.goto("/room/room_demo");
    await expect(page.getByRole("heading", { level: 1, name: "Maya's birthday" })).toBeVisible();
    await expect(page.getByText(/For Maya · birthday · 2 in the room/)).toBeVisible();
  });

  test("renders the three working areas (chat, shortlist, proposal)", async ({ page }) => {
    await page.goto("/room/room_demo");
    await expect(page.locator("main section")).toHaveCount(3);
  });

  test("GAP: any room id renders the same mock room (no not-found state yet)", async ({ page }) => {
    const response = await page.goto("/room/this-room-does-not-exist");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Maya's birthday" })).toBeVisible();
  });

  test.fixme("a non-member opening /room/<id> sees an unauthorized/not-found state (backend returns unauthorized)", async () => {});
});

test.describe("routing", () => {
  test("an unknown URL is a 404", async ({ request }) => {
    expect((await request.get("/definitely-not-a-page")).status()).toBe(404);
  });
});
