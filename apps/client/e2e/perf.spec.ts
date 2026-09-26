import { expect, test } from "@playwright/test";
import { TOWN_MAX_PLAYERS, VIEW_H, VIEW_W } from "@hearth/shared";
import { botTokens, startBots } from "./bots";
import { E2E_API, createPlayer, deleteE2eUsers, signInWithPassword } from "./helpers";
import { enterTown, snapshot } from "./world";

/**
 * PROMPT.md Section 12: "A steady 60 fps with 50 players visible on a 2021 mid-range Android phone."
 * We can't run a phone here, so we approximate one: Chromium with the CPU throttled 4× (Chrome DevTools'
 * "mid-tier mobile" setting) and a phone-sized viewport, with 49 bots walking around the plaza.
 */
const CPU_THROTTLE = Number(process.env.PERF_CPU_THROTTLE ?? 4);

test("frame rate with a full Town Square (49 bots + you)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Measured once, on the phone viewport.");
  // Timing-sensitive; shared CI runners vary too much, so CI opts in with PERF=1.
  test.skip(!!process.env.CI && !process.env.PERF, "Set PERF=1 to run the frame-rate budget in CI.");
  test.setTimeout(180_000);
  await deleteE2eUsers();
  const tokens = await botTokens(TOWN_MAX_PLAYERS - 1, E2E_API);
  const swarm = await startBots(tokens, E2E_API);
  try {
    const player = await createPlayer(`perf_${Date.now().toString(36).slice(-5)}`);
    await signInWithPassword(page, player);
    await enterTown(page);
    await expect
      .poll(async () => (await snapshot(page)).others.length, { timeout: 30_000 })
      .toBe(TOWN_MAX_PLAYERS - 1);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
    await page.waitForTimeout(2000); // let it settle under throttling

    // How many other players are on screen right now.
    const s = await snapshot(page);
    const cam = { x: s.self!.px.x + 8 - VIEW_W / 2, y: s.self!.px.y + 12 - VIEW_H / 2 };
    const onScreen = s.others.filter(
      (o) => o.px.x > cam.x - 16 && o.px.x < cam.x + VIEW_W && o.px.y > cam.y - 24 && o.px.y < cam.y + VIEW_H,
    ).length;

    if (process.env.SCREENSHOT_DIR)
      await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/world-crowd.png` });

    // Count real frames for 10 seconds.
    const frames = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const times: number[] = [];
          const end = performance.now() + 10_000;
          const tick = (t: number) => {
            times.push(t);
            if (t < end) requestAnimationFrame(tick);
            else resolve(times);
          };
          requestAnimationFrame(tick);
        }),
    );
    const gaps = frames.slice(1).map((t, i) => t - frames[i]!);
    const fps = (gaps.length / (frames.at(-1)! - frames[0]!)) * 1000;
    const sorted = [...gaps].sort((a, b) => a - b);
    const p99 = sorted[Math.floor(sorted.length * 0.99)]!;
    const dropped = gaps.filter((g) => g > (1000 / 60) * 1.5).length;
    const result = {
      cpuThrottle: CPU_THROTTLE,
      playersInRoom: s.others.length + 1,
      othersOnScreen: onScreen,
      averageFps: Math.round(fps * 10) / 10,
      p99FrameMs: Math.round(p99 * 10) / 10,
      droppedFrames: dropped,
      frames: gaps.length,
    };
    console.log(JSON.stringify(result));
    testInfo.annotations.push({ type: "perf", description: JSON.stringify(result) });

    expect(onScreen, "bots should be on screen to make this meaningful").toBeGreaterThanOrEqual(20);
    expect(result.averageFps).toBeGreaterThanOrEqual(58);
    expect(dropped / gaps.length).toBeLessThan(0.02);
  } finally {
    await swarm.stop();
  }
});
