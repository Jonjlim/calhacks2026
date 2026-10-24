import { expect, webglTest as test } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Real WebGL (software-rendered in headless Chromium). These are smoke tests
 * of the integration between the 3D scene, the intro, and the DOM controls;
 * they do not judge visuals.
 */

const headline = (page: Page) => page.getByRole("heading", { level: 1, name: /Thoughtful gifts,\s*together\./ });
const intro = (page: Page) => page.getByRole("dialog", { name: "Storybook introduction" });

test.describe("3D landing", () => {
  test("?intro=0 shows the page immediately and the WebGL canvas is created with a real size", async ({ page }) => {
    await page.goto("/?intro=0");
    await expect(headline(page)).toBeVisible();
    const canvas = page.locator("canvas").first();
    // The scene is a dynamic import; the first hit in `next dev` includes a cold compile of the whole 3D bundle.
    await expect(canvas).toBeAttached({ timeout: 90_000 });
    const box = await canvas.boundingBox();
    expect(box!.width).toBeGreaterThan(300);
    expect(box!.height).toBeGreaterThan(300);
    await expect(intro(page)).toHaveCount(0);
  });

  test("the create button is not covered by the 3D layer (a click would reach it)", async ({ page }) => {
    // Software WebGL in headless Chromium runs this scene at ~1 fps, so a real click can starve
    // the main thread. Hit-testing proves the same thing (nothing sits on top) without needing frames.
    await page.goto("/?intro=0");
    const button = page.getByRole("button", { name: "Create a gift room" });
    await expect(button).toBeVisible();
    const reachable = await button.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit !== null && el.contains(hit);
    });
    expect(reachable).toBe(true);
  });

  test("forcing the intro (?intro=1) shows the storybook, and Skip lands on the interactive page", async ({ page }) => {
    await page.goto("/?intro=1");
    await expect(intro(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Create a gift room" })).toHaveCount(0);
    await page.getByRole("button", { name: "Skip intro" }).click();
    await expect(intro(page)).toHaveCount(0);
    await expect(headline(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create a gift room" })).toBeVisible();
  });

  test("the intro never blocks the page forever: Replay intro starts it again and Skip still works", async ({ page }) => {
    await page.goto("/?intro=0");
    await page.getByRole("button", { name: "Replay intro" }).click();
    await expect(intro(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Skip intro" }).click();
    await expect(headline(page)).toBeVisible();
  });

  test("reduced motion skips the intro entirely, even when forced", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?intro=1");
    await expect(headline(page)).toBeVisible();
    await expect(intro(page)).toHaveCount(0);
  });

  test("the intro autoplays once per browser session, not on every visit", async ({ page }) => {
    await page.goto("/");
    await expect(intro(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Skip intro" }).click();
    await expect(headline(page)).toBeVisible();
    await page.reload();
    await expect(headline(page)).toBeVisible();
    await expect(intro(page)).toHaveCount(0);
  });

  test("?intro=0 wins over the first-visit autoplay", async ({ page }) => {
    await page.goto("/?intro=0");
    await expect(headline(page)).toBeVisible();
    await expect(intro(page)).toHaveCount(0);
  });
});
