import { expect, MOCK_TOKEN, test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Landing page create/join flows. These run against the MOCK backend
 * (lib/mocks/landing.ts): nothing is persisted and the UI must say so.
 */

const form = (page: Page) => page.locator("form");
const alertIn = (page: Page) => form(page).getByRole("alert");
const entered = (page: Page) => page.getByRole("status").filter({ hasText: /ready to try|found the room/i });

async function openCreate(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create a gift room" }).click();
  await expect(page.getByRole("heading", { name: "Start a gift room" })).toBeVisible();
}

async function openJoin(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Join with a code" }).click();
  await expect(page.getByRole("heading", { name: "Join a gift room" })).toBeVisible();
}

const fillCreate = async (page: Page, v: { recipient?: string; occasion?: string; name?: string }) => {
  if (v.recipient !== undefined) await page.getByLabel("Who is the gift for?").fill(v.recipient);
  if (v.occasion !== undefined) await page.getByLabel("What's the occasion?").fill(v.occasion);
  if (v.name !== undefined) await page.getByLabel("Your name").fill(v.name);
};

test.describe("landing", () => {
  test("renders the headline and both entry points without console errors", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Thoughtful gifts,\s*together\./ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create a gift room" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Join with a code" })).toBeVisible();
    await expect(page.getByRole("link", { name: /unwrap/i })).toBeVisible();
  });

  test("describes the scene for screen readers", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/hand-painted floating island/i)).toBeAttached();
  });

  test("toggles sound and remembers it across reloads", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: /sound (on|off)/i });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.getByRole("button", { name: /sound on/i })).toHaveAttribute("aria-pressed", "true");
  });

  test("still works when localStorage is blocked", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /sound off/i })).toBeVisible();
    await page.getByRole("button", { name: /sound off/i }).click();
    await expect(page.getByRole("button", { name: /sound on/i })).toBeVisible();
  });
});

test.describe("create a gift room (mock backend)", () => {
  test("focuses the first field when the form opens", async ({ page }) => {
    await openCreate(page);
    await expect(page.getByLabel("Who is the gift for?")).toBeFocused();
  });

  test("validates required fields one at a time with specific messages", async ({ page }) => {
    await openCreate(page);
    const submit = page.getByRole("button", { name: "Open the room" });

    await submit.click();
    await expect(alertIn(page)).toHaveText("Add who the gift is for.");

    await fillCreate(page, { recipient: "Maya" });
    await submit.click();
    await expect(alertIn(page)).toHaveText("Add the occasion.");

    await fillCreate(page, { occasion: "Her 25th birthday" });
    await submit.click();
    await expect(alertIn(page)).toHaveText("Add your name.");
    await expect(entered(page)).toHaveCount(0);
  });

  test("treats whitespace-only input as empty", async ({ page }) => {
    await openCreate(page);
    await fillCreate(page, { recipient: "   ", occasion: "   ", name: "   " });
    await page.getByRole("button", { name: "Open the room" }).click();
    await expect(alertIn(page)).toHaveText("Add who the gift is for.");
  });

  test("rejects a name longer than 40 characters", async ({ page }) => {
    await openCreate(page);
    await fillCreate(page, { recipient: "Maya", occasion: "Birthday", name: "a".repeat(41) });
    await page.getByRole("button", { name: "Open the room" }).click();
    await expect(alertIn(page)).toHaveText("Keep your name under 40 characters.");
  });

  test("accepts exactly 40 characters", async ({ page }) => {
    await openCreate(page);
    await fillCreate(page, { recipient: "Maya", occasion: "Birthday", name: "a".repeat(40) });
    await page.getByRole("button", { name: "Open the room" }).click();
    await expect(entered(page)).toBeVisible();
  });

  test("stops the occasion field at 80 characters so it cannot overflow the backend limit", async ({ page }) => {
    await openCreate(page);
    const occasion = page.getByLabel("What's the occasion?");
    await occasion.fill("x".repeat(120));
    expect(await occasion.inputValue()).toHaveLength(80);
  });

  test("shows a pending state, then an honest 'preview mode' result that links to the demo room", async ({ page }) => {
    await openCreate(page);
    await fillCreate(page, { recipient: "Maya", occasion: "Her 25th birthday", name: "Alex" });
    await page.getByRole("button", { name: "Open the room" }).click();

    const pending = page.getByRole("button", { name: "Opening…" });
    await expect(pending).toBeDisabled();

    const card = entered(page);
    await expect(card).toBeVisible();
    await expect(card).toContainText("Preview mode");
    await expect(card).toContainText("Rooms aren't saved");
    await expect(card.getByRole("link", { name: /Open the demo room/ })).toHaveAttribute("href", "/room/room_demo");
  });

  test("ignores a rapid double submit (one result, no error)", async ({ page }) => {
    await openCreate(page);
    await fillCreate(page, { recipient: "Maya", occasion: "Birthday", name: "Alex" });
    await page.getByRole("button", { name: "Open the room" }).dblclick();
    await expect(entered(page)).toHaveCount(1);
    await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveCount(0);
  });

  test("submits with the Enter key from any field", async ({ page }) => {
    await openCreate(page);
    await fillCreate(page, { recipient: "Maya", occasion: "Birthday", name: "Alex" });
    await page.getByLabel("Your name").press("Enter");
    await expect(entered(page)).toBeVisible();
  });

  test("Back returns to the two entry points and discards the draft", async ({ page }) => {
    await openCreate(page);
    await fillCreate(page, { recipient: "Maya" });
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("button", { name: "Create a gift room" })).toBeVisible();
    await page.getByRole("button", { name: "Create a gift room" }).click();
    await expect(page.getByLabel("Who is the gift for?")).toHaveValue("");
  });

  test("clears a previous error once the form is corrected and resubmitted", async ({ page }) => {
    await openCreate(page);
    await page.getByRole("button", { name: "Open the room" }).click();
    await expect(alertIn(page)).toBeVisible();
    await fillCreate(page, { recipient: "Maya", occasion: "Birthday", name: "Alex" });
    await page.getByRole("button", { name: "Open the room" }).click();
    await expect(entered(page)).toBeVisible();
  });

  test("keeps markup in names inert (no script execution)", async ({ page }) => {
    let dialogs = 0;
    page.on("dialog", (d) => {
      dialogs++;
      void d.dismiss();
    });
    await openCreate(page);
    await fillCreate(page, { recipient: "<img src=x onerror=alert(1)>", occasion: "<script>alert(2)</script>", name: "<b>Alex</b>" });
    await page.getByRole("button", { name: "Open the room" }).click();
    await expect(entered(page)).toBeVisible();
    expect(dialogs).toBe(0);
  });

  test("opens the demo room from the result", async ({ page }) => {
    await openCreate(page);
    await fillCreate(page, { recipient: "Maya", occasion: "Birthday", name: "Alex" });
    await page.getByRole("button", { name: "Open the room" }).click();
    await page.getByRole("link", { name: /Open the demo room/ }).click();
    await expect(page).toHaveURL(/\/room\/room_demo$/);
    await expect(page.getByRole("heading", { level: 1, name: "Maya's birthday" })).toBeVisible();
  });
});

test.describe("join with an invite code (mock backend)", () => {
  test("the header 'Join a room' button opens the same form", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Join a room" }).click();
    await expect(page.getByRole("heading", { name: "Join a gift room" })).toBeVisible();
  });

  test("requires a code and a name", async ({ page }) => {
    await openJoin(page);
    await page.getByRole("button", { name: "Join the room" }).click();
    await expect(alertIn(page)).toHaveText("Add your invite code.");
    await page.getByLabel("Invite code").fill(MOCK_TOKEN);
    await page.getByRole("button", { name: "Join the room" }).click();
    await expect(alertIn(page)).toHaveText("Add your name.");
  });

  test("rejects an unknown code with a friendly message and no navigation", async ({ page }) => {
    await openJoin(page);
    await page.getByLabel("Invite code").fill("not-a-real-code");
    await page.getByLabel("Your name").fill("Sam");
    await page.getByRole("button", { name: "Join the room" }).click();
    await expect(alertIn(page)).toHaveText("We couldn't find a room with that code.");
    await expect(page).toHaveURL(/\/$/);
  });

  test("rejects a code longer than 64 characters", async ({ page }) => {
    await openJoin(page);
    await page.getByLabel("Invite code").fill("a".repeat(70));
    await page.getByLabel("Your name").fill("Sam");
    await page.getByRole("button", { name: "Join the room" }).click();
    await expect(alertIn(page)).toHaveText("That code looks too long.");
  });

  test("joins with the fixture code, and trims stray whitespace around it", async ({ page }) => {
    await openJoin(page);
    await page.getByLabel("Invite code").fill(`  ${MOCK_TOKEN}  `);
    await page.getByLabel("Your name").fill("Sam");
    await page.getByRole("button", { name: "Join the room" }).click();
    const card = entered(page);
    await expect(card).toContainText("You found the room.");
    await expect(card).toContainText("Preview mode");
  });

  test("codes are case-sensitive (matches the backend, which indexes the exact token)", async ({ page }) => {
    await openJoin(page);
    await page.getByLabel("Invite code").fill(MOCK_TOKEN.toUpperCase());
    await page.getByLabel("Your name").fill("Sam");
    await page.getByRole("button", { name: "Join the room" }).click();
    await expect(alertIn(page)).toHaveText("We couldn't find a room with that code.");
  });

  test("shows a pending state and ignores a rapid double submit", async ({ page }) => {
    await openJoin(page);
    await page.getByLabel("Invite code").fill(MOCK_TOKEN);
    await page.getByLabel("Your name").fill("Sam");
    const submit = page.getByRole("button", { name: "Join the room" });
    await submit.dblclick();
    await expect(page.getByRole("button", { name: "Finding it…" })).toBeDisabled();
    await expect(entered(page)).toHaveCount(1);
  });

  test("does not pre-fill the code or claim the demo code is secret (preview copy is visible)", async ({ page }) => {
    await openJoin(page);
    await expect(page.getByLabel("Invite code")).toHaveValue("");
    await expect(page.getByText(/Preview build/)).toBeVisible();
  });

  test("is fully keyboard operable: Tab order, Enter to open, Enter to submit", async ({ page }) => {
    await page.goto("/");
    const join = page.getByRole("button", { name: "Join with a code" });
    await join.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Invite code")).toBeFocused();
    await page.keyboard.type(MOCK_TOKEN);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Your name")).toBeFocused();
    await page.keyboard.type("Sam");
    await page.keyboard.press("Enter");
    await expect(entered(page)).toBeVisible();
  });
});
