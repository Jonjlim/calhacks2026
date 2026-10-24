import { type Browser, type BrowserContext, type Page } from "@playwright/test";
import { expect, MOCK_TOKEN, test } from "./fixtures";

/**
 * Two independent browser contexts (two "people").
 *
 * What can be verified today: with the mock backend each context is its own
 * island, and both must be honest about it. Real cross-browser sync (room
 * created by A, joined by B, memory visible to both) needs the frontend wired
 * to a Convex deployment and is `fixme` below; it is NOT claimed as passing.
 */

async function newPerson(browser: Browser, baseURL: string | undefined): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (/webgl/i.test(type)) return null;
      return (original as (this: HTMLCanvasElement, type: string, ...rest: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  return { context, page: await context.newPage() };
}

test.describe("two browsers, mock backend", () => {
  test("organizer and friend each get an honest 'preview mode' result; neither is told a shared room exists", async ({ browser, baseURL }) => {
    const organizer = await newPerson(browser, baseURL);
    const friend = await newPerson(browser, baseURL);

    await organizer.page.goto("/");
    await organizer.page.getByRole("button", { name: "Create a gift room" }).click();
    await organizer.page.getByLabel("Who is the gift for?").fill("Maya");
    await organizer.page.getByLabel("What's the occasion?").fill("Birthday");
    await organizer.page.getByLabel("Your name").fill("Alex");
    await organizer.page.getByRole("button", { name: "Open the room" }).click();

    await friend.page.goto("/");
    await friend.page.getByRole("button", { name: "Join with a code" }).click();
    await friend.page.getByLabel("Invite code").fill(MOCK_TOKEN);
    await friend.page.getByLabel("Your name").fill("Sam");
    await friend.page.getByRole("button", { name: "Join the room" }).click();

    for (const { page } of [organizer, friend]) {
      const card = page.getByRole("status").filter({ hasText: /ready to try|found the room/i });
      await expect(card).toContainText("Preview mode");
      await expect(card).toContainText(/aren't saved/i);
    }
    await organizer.context.close();
    await friend.context.close();
  });

  test("state is isolated per browser context (no storage leaks between people)", async ({ browser, baseURL }) => {
    const a = await newPerson(browser, baseURL);
    const b = await newPerson(browser, baseURL);
    await a.page.goto("/");
    await a.page.getByRole("button", { name: /sound off/i }).click();
    await expect(a.page.getByRole("button", { name: /sound on/i })).toBeVisible();
    await b.page.goto("/");
    await expect(b.page.getByRole("button", { name: /sound off/i })).toBeVisible();
    await a.context.close();
    await b.context.close();
  });
});

test.describe("two browsers, real backend", () => {
  test.fixme("organizer creates a room, friend joins by invite link, both see two participants (needs Convex deployment + Convex Auth wired in the frontend)", async () => {
    // organizer: createRoom -> getInvite -> link/QR
    // friend:    /join/<token> -> previewInvite -> joinRoom
    // both:      getRoom shows 2 participants within ~2s without reload
  });

  test.fixme("a memory submitted by the friend appears for the organizer in real time (api.clues.upsertManualPreference -> listPublishedClues subscription)", async () => {});

  test.fixme("a stranger without the token cannot open /room/<id> (backend returns unauthorized)", async () => {});
});
