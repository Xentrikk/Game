import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPlayer, deleteE2eUsers, signInWithPassword, type TestPlayer } from "./helpers";
import { PNG } from "pngjs";
import { enterTown, settle, snapshot, tap, walkTo } from "./world";

/** Screenshot of just the game canvas, decoded. */
async function canvasPixels(page: Page) {
  // Hide HTML overlays (menu button, banners) so only the game itself is measured.
  const png = PNG.sync.read(
    await page
      .locator(".world-canvas canvas")
      .screenshot({ style: ".world-toolbar, .world-banner { visibility: hidden !important; }" }),
  );
  const colors = new Map<string, number>();
  let luminance = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b] = [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
    luminance += 0.299 * r + 0.587 * g + 0.114 * b;
    const key = `${r},${g},${b}`;
    colors.set(key, (colors.get(key) ?? 0) + 1);
  }
  return { meanLuminance: luminance / (png.data.length / 4), colors };
}

async function snap(page: Page, name: string) {
  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/world-${name}.png` });
}

async function playerInTown(browser: Browser, player: TestPlayer, url = "/") {
  const context = await browser.newContext({ viewport: { width: 960, height: 640 } });
  const page = await context.newPage();
  await signInWithPassword(page, player);
  if (url !== "/") await page.goto(url);
  await enterTown(page);
  return page;
}

const suffix = () => Date.now().toString(36).slice(-5);

/** Presses A until the dialogue box is gone (the first press may just finish the typewriter text). */
async function closeDialogue(page: Page) {
  const box = page.locator(".world-dialogue");
  for (let i = 0; i < 10 && (await box.count()); i++) {
    await page.keyboard.press("z");
    await page.waitForTimeout(150);
  }
  await expect(box).toHaveCount(0);
}

test.describe("the Town Square", () => {
  test.beforeEach(async ({ browserName: _ }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Multi-browser world tests run once, on desktop.");
    await deleteE2eUsers();
  });

  test("two players see each other walk around smoothly", async ({ browser }) => {
    const a = await createPlayer(`w_a_${suffix()}`);
    const b = await createPlayer(`w_b_${suffix()}`, {
      ...(await import("@hearth/shared")).defaultAppearance(),
      hair: { style: "puff", color: 8 },
    });
    const pageA = await playerInTown(browser, a);
    const pageB = await playerInTown(browser, b);

    // Each sees the other.
    await expect.poll(async () => (await snapshot(pageB)).others.map((o) => o.handle)).toContain(a.handle);
    await expect.poll(async () => (await snapshot(pageA)).others.map((o) => o.handle)).toContain(b.handle);

    // A walks to the plaza's west side; B sees A arrive at the same tile.
    await walkTo(pageA, { x: 16, y: 16 });
    await settle(pageA);
    await expect
      .poll(async () => {
        const seen = (await snapshot(pageB)).others.find((o) => o.handle === a.handle);
        return seen && { x: seen.x, y: seen.y, px: seen.px };
      })
      .toEqual({ x: 16, y: 16, px: { x: 16 * 16, y: 16 * 16 - 8 } });

    // Smoothness: while A takes one step, B's view of A passes through in-between pixel positions.
    const samples = pageB.evaluate(
      (handle) =>
        new Promise<number[]>((resolve) => {
          const xs: number[] = [];
          const h = (
            window as unknown as {
              __hearth: { snapshot(): { others: { handle: string; px: { x: number } }[] } };
            }
          ).__hearth;
          const end = performance.now() + 900;
          const tick = () => {
            const o = h.snapshot().others.find((p) => p.handle === handle);
            if (o) xs.push(o.px.x);
            if (performance.now() < end) requestAnimationFrame(tick);
            else resolve(xs);
          };
          tick();
        }),
      a.handle,
    );
    await walkTo(pageA, { x: 17, y: 16 });
    const xs = await samples;
    const between = new Set(xs.filter((x) => x > 16 * 16 && x < 17 * 16));
    expect(between.size, `B saw A at x = ${[...new Set(xs)].join(", ")}`).toBeGreaterThanOrEqual(3);
    await snap(pageB, "two-players");

    // When A leaves town, B stops seeing them right away.
    await pageA.getByRole("button", { name: "Menu" }).click();
    await pageA.getByRole("button", { name: "Leave town" }).click();
    await expect
      .poll(async () => (await snapshot(pageB)).others.map((o) => o.handle))
      .not.toContain(a.handle);
    await pageA.context().close();
    await pageB.context().close();
  });

  test("walls block movement, and signs and NPCs talk", async ({ browser }) => {
    const p = await createPlayer(`w_c_${suffix()}`);
    const page = await playerInTown(browser, p);

    // The fountain blocks the way north.
    await walkTo(page, { x: 19, y: 15 });
    await tap(page, "up");
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(600);
    await page.keyboard.up("ArrowUp");
    expect((await snapshot(page)).self).toMatchObject({ x: 19, y: 15, dir: "up" });

    // Reading the fountain.
    await page.keyboard.press("z");
    await expect(page.getByRole("status").filter({ hasText: "The fountain sparkles" }).first()).toBeVisible();
    await snap(page, "sign");
    await closeDialogue(page);

    // Talking to Mayor Pip (standing at 17,15), from below.
    await walkTo(page, { x: 17, y: 16 });
    await tap(page, "up");
    await page.keyboard.press("Enter");
    const box = page.locator(".world-dialogue");
    await expect(box).toContainText("Mayor Pip");
    await expect(box).toContainText("Oh! A new face!");
    // Movement is paused while talking.
    const before = (await snapshot(page)).self!;
    await page.keyboard.down("ArrowDown");
    await page.waitForTimeout(400);
    await page.keyboard.up("ArrowDown");
    expect((await snapshot(page)).self).toMatchObject({ x: before.x, y: before.y });
    await snap(page, "npc");
    await page.context().close();
  });

  test("a dropped connection reconnects in the same place", async ({ browser }) => {
    const a = await createPlayer(`w_d_${suffix()}`);
    const b = await createPlayer(`w_e_${suffix()}`);
    const pageA = await playerInTown(browser, a);
    const pageB = await playerInTown(browser, b);
    await walkTo(pageA, { x: 22, y: 16 });
    await settle(pageA);
    // The SDK only auto-reconnects rooms that have been up for 5 s.
    await pageA.waitForTimeout(5200);

    await pageA.evaluate(() => (window as unknown as { __hearth: { drop(): void } }).__hearth.drop());
    await expect(pageA.getByText("Connection lost. Reconnecting…")).toBeVisible();
    await expect(pageA.getByText("Connection lost. Reconnecting…")).toBeHidden({ timeout: 15_000 });
    expect((await snapshot(pageA)).self).toMatchObject({ x: 22, y: 16 });

    // B still sees exactly one A, in the same place, and A can keep walking.
    const seenA = async () => (await snapshot(pageB)).others.filter((o) => o.handle === a.handle);
    expect((await seenA()).map((o) => [o.x, o.y])).toEqual([[22, 16]]);
    await walkTo(pageA, { x: 22, y: 17 });
    await expect.poll(async () => (await seenA()).map((o) => [o.x, o.y])).toEqual([[22, 17]]);
    await pageA.context().close();
    await pageB.context().close();
  });

  test("opening the town in a second window replaces the first", async ({ browser }) => {
    const p = await createPlayer(`w_f_${suffix()}`);
    const first = await playerInTown(browser, p);
    const second = await playerInTown(browser, p);
    await expect(first.getByText("You opened Hearth somewhere else.")).toBeVisible();
    await expect.poll(async () => (await snapshot(second)).self).toBeTruthy();
    await first.context().close();
    await second.context().close();
  });

  test("pocket mode and the day/night tint", async ({ browser }) => {
    const p = await createPlayer(`w_g_${suffix()}`);
    const page = await playerInTown(browser, p);
    await page.evaluate(() =>
      (window as unknown as { __hearth: { setHour(h: number): void } }).__hearth.setHour(12),
    );
    await page.waitForTimeout(300);
    const day = await canvasPixels(page);
    await snap(page, "day");

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: "Pocket mode: Off" }).click();
    await expect(page.getByRole("button", { name: "Pocket mode: On" })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect.poll(async () => (await snapshot(page)).pocket).toBe(true);
    await page.waitForTimeout(300);
    // Every pixel on screen is one of the four Game Boy greens.
    const greens = new Set(["15,56,15", "48,98,48", "139,172,15", "155,188,15"]);
    const pocketColors = [...(await canvasPixels(page)).colors.keys()];
    expect(pocketColors.filter((c) => !greens.has(c))).toEqual([]);
    await snap(page, "pocket");

    // The setting is remembered on this device.
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: "Leave town" }).click();
    await enterTown(page);
    await expect.poll(async () => (await snapshot(page)).pocket).toBe(true);
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: "Pocket mode: On" }).click();
    await page.getByRole("button", { name: "Close" }).click();

    await page.evaluate(() =>
      (window as unknown as { __hearth: { setHour(h: number): void } }).__hearth.setHour(22),
    );
    await expect.poll(async () => (await snapshot(page)).tint).not.toBe(0xffffff);
    await page.waitForTimeout(300);
    // Night is visibly darker than day.
    const night = await canvasPixels(page);
    expect(night.meanLuminance).toBeLessThan(day.meanLuminance * 0.8);
    await snap(page, "night");
    await page.context().close();
  });
});

test("phone: walk with the D-pad and talk with the A button", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Touch controls are tested on the phone viewport.");
  await deleteE2eUsers();
  const p = await createPlayer(`w_t_${suffix()}`);
  await signInWithPassword(page, p);
  await enterTown(page);
  await expect(page.getByRole("group", { name: "Game controls" })).toBeVisible();
  await page.waitForTimeout(500);
  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/world-phone.png` });

  // Hold the D-pad left until the player has taken a few steps.
  const start = (await snapshot(page)).self!;
  const left = page.getByRole("button", { name: "Move left" });
  const box = (await left.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(async () => (await snapshot(page)).self!.x).toBeLessThanOrEqual(start.x - 2);
  await page.mouse.up();
  await settle(page);
  const stopped = (await snapshot(page)).self!;
  await page.waitForTimeout(500);
  expect((await snapshot(page)).self).toMatchObject({ x: stopped.x, y: stopped.y });

  // Walk up to Mayor Pip with the keyboard helper, then talk with the on-screen A button.
  await walkTo(page, { x: 17, y: 16 });
  await tap(page, "up");
  await page.getByRole("button", { name: "A: talk or read" }).tap();
  await expect(page.locator(".world-dialogue")).toContainText("Mayor Pip");
  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/world-phone-talk.png` });
});
