import { expect, MOCK_TOKEN, test } from "./fixtures";
import type { Page } from "@playwright/test";

/** Phone-sized layout reliability: nothing may force sideways scrolling or push controls off-screen. */

const WIDTHS = [320, 360, 390, 430] as const;
const PAGES = ["/", `/join/${MOCK_TOKEN}`, "/room/room_demo"] as const;

const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

for (const path of PAGES) {
  for (const width of WIDTHS) {
    test(`no horizontal scrolling at ${width}px on ${path}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await overflowX(page)).toBeLessThanOrEqual(1);
    });
  }
}

test.describe("landing controls stay inside a phone viewport", () => {
  for (const width of WIDTHS) {
    // DEFECT QA-4: at 320px the primary button (min-w-[284px] after 40px page padding) ends at x=324,
    // 4px past the viewport; `main` is overflow-hidden so it is clipped silently. `test.fail` keeps CI
    // green while the defect exists and turns red when it is fixed.
    const run = width === 320 ? test.fail : test;
    run(`${width === 320 ? "DEFECT QA-4: " : ""}primary actions fit at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      for (const name of ["Create a gift room", "Join with a code"]) {
        const box = await page.getByRole("button", { name }).boundingBox();
        expect(box, name).not.toBeNull();
        expect(box!.x, `${name} left edge`).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `${name} right edge`).toBeLessThanOrEqual(width);
      }
    });
  }

  test("the create form fits and its fields are reachable on a 360px phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/");
    await page.getByRole("button", { name: "Create a gift room" }).click();
    for (const label of ["Who is the gift for?", "What's the occasion?", "Your name"]) {
      const box = await page.getByLabel(label).boundingBox();
      expect(box, label).not.toBeNull();
      expect(box!.x + box!.width, `${label} right edge`).toBeLessThanOrEqual(360);
    }
  });
});

test.describe("form fields avoid iOS focus-zoom (font-size >= 16px)", () => {
  test("/join/[token] inputs", async ({ page }) => {
    await page.goto(`/join/${MOCK_TOKEN}`);
    for (const placeholder of ["Invite code", "Your name"]) {
      const size = await page.getByPlaceholder(placeholder).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size, placeholder).toBeGreaterThanOrEqual(16);
    }
  });

  // DEFECT QA-2: the landing form fields are text-[15px]; iOS Safari zooms the page on focus for
  // inputs under 16px. `test.fail` keeps CI green while it exists and turns red when it is fixed.
  test.fail("DEFECT QA-2: landing create/join inputs", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Create a gift room" }).click();
    const size = await page.getByLabel("Who is the gift for?").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  });
});
