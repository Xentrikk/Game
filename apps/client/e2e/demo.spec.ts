import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { snapshot, tap } from "./world";

/** Smoke test for the single-file offline preview (pnpm --filter @hearth/client build:demo). */
const DEMO = resolve(import.meta.dirname, "../dist-demo/demo.html");

test("offline preview: make a character and walk around town", async ({ page }, testInfo) => {
  test.skip(!existsSync(DEMO), "Build the preview first: pnpm --filter @hearth/client build:demo");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`file://${DEMO}`);
  await page.getByRole("button", { name: "Make your character" }).click();
  await page.getByRole("tab", { name: "Hair" }).click();
  await page.getByRole("button", { name: "Bun" }).click();
  await page.getByRole("tab", { name: "About" }).click();
  await page.getByLabel("Display name", { exact: true }).fill("Tester");
  await page.getByRole("button", { name: "Done!" }).click();

  // The town opens with the preview's welcome message; the villagers are there.
  const box = page.locator(".world-dialogue");
  await expect(box).toContainText("Hearth preview");
  await expect.poll(async () => (await snapshot(page)).others.length).toBe(7);
  for (let i = 0; i < 8 && (await box.count()); i++) {
    await page.keyboard.press("z");
    await page.waitForTimeout(120);
  }
  await expect(box).toHaveCount(0);

  const start = (await snapshot(page)).self!;
  await tap(page, "right");
  await page.keyboard.down("ArrowRight");
  await expect.poll(async () => (await snapshot(page)).self!.x).toBeGreaterThan(start.x);
  await page.keyboard.up("ArrowRight");
  if (process.env.SCREENSHOT_DIR) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/demo-${testInfo.project.name}.png` });
  }
  expect(errors).toEqual([]);
});
