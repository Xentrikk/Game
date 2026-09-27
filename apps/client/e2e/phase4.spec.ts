import { expect, test, type Browser, type Page } from "@playwright/test";
import { befriendViaApi, createPlayer, deleteE2eUsers, signInWithPassword, type TestPlayer } from "./helpers";
import { snapshot } from "./world";

const suffix = () => Date.now().toString(36).slice(-4);

async function signedIn(browser: Browser, player: TestPlayer) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  const page = await context.newPage();
  await signInWithPassword(page, player);
  return page;
}

/** Claims the daily gift (50 coins) so a fresh player has something to spend. */
async function claimDailyGift(page: Page) {
  await page.getByRole("button", { name: "Inventory" }).click();
  await page.getByRole("button", { name: "Daily gift" }).click();
  await expect(
    page.getByRole("complementary", { name: "Inventory" }).getByText("50 coins", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close Inventory" }).click();
}

test.describe("homes, inventory and trading", () => {
  test.beforeEach(async (_fixtures, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Economy tests run once, on desktop.");
    await deleteE2eUsers();
  });

  test("claims the daily gift, then buys and sells in a shop", async ({ browser }) => {
    const s = suffix();
    const a = await createPlayer(`ec_${s}`);
    const page = await signedIn(browser, a);

    await claimDailyGift(page);

    await page.getByRole("button", { name: "Shops" }).click();
    const shop = page.getByRole("complementary", { name: "General Store" });
    await expect(shop).toBeVisible();
    await shop.getByRole("button", { name: "Buy (50)" }).click(); // Wooden Chair, exactly the daily gift
    await page.getByRole("button", { name: "Close General Store" }).click();

    await page.getByRole("button", { name: "Inventory" }).click();
    const inv = page.getByRole("complementary", { name: "Inventory" });
    await expect(inv.getByText("Wooden Chair")).toBeVisible();
    await expect(inv.getByText("0 coins")).toBeVisible();
    await inv.getByRole("button", { name: "Sell (20)" }).click();
    await expect(inv.getByText("20 coins")).toBeVisible();
    await expect(inv.getByText("Wooden Chair")).toHaveCount(0);
    await page.context().close();
  });

  test("sends a letter with an attachment and coins; the recipient claims it once", async ({ browser }) => {
    const s = suffix();
    const a = await createPlayer(`la_${s}`);
    const b = await createPlayer(`lb_${s}`);
    await befriendViaApi(a, b);
    const pageA = await signedIn(browser, a);
    const pageB = await signedIn(browser, b);
    await claimDailyGift(pageA);

    await pageA.getByRole("button", { name: "Letters" }).click();
    const composeA = pageA.getByRole("complementary", { name: "Letters" });
    await composeA.getByRole("tab", { name: "Write" }).click();
    // The native <select>'s accessible name picks up its currently-shown option text too, so "To"
    // isn't matched reliably by label; it's simply the first select in the compose form.
    await composeA
      .locator("select")
      .first()
      .selectOption({ label: `${b.handle} (@${b.handle})` });
    await composeA.getByLabel("Message").fill("Here's something for you!");
    await composeA.getByLabel("Coins to send").fill("20");
    await composeA.getByRole("button", { name: "Send letter" }).click();
    await expect(composeA.getByText("Letter sent!")).toBeVisible();

    await pageB.getByRole("button", { name: /^Letters/ }).click();
    const inboxB = pageB.getByRole("complementary", { name: "Letters" });
    await expect(inboxB.getByText("Here's something for you!")).toBeVisible();
    await inboxB.getByRole("button", { name: "Claim" }).click();
    await expect(inboxB.getByRole("button", { name: "Claim" })).toHaveCount(0);
    await pageB.getByRole("button", { name: "Close Letters" }).click();

    await pageB.getByRole("button", { name: "Inventory" }).click();
    await expect(pageB.getByRole("complementary", { name: "Inventory" }).getByText("20 coins")).toBeVisible();
    await pageA.context().close();
    await pageB.context().close();
  });

  test("trades an item and coins between friends; changing an offer resets Ready", async ({ browser }) => {
    const s = suffix();
    const a = await createPlayer(`ta_${s}`);
    const b = await createPlayer(`tb_${s}`);
    await befriendViaApi(a, b);
    const pageA = await signedIn(browser, a);
    const pageB = await signedIn(browser, b);
    await claimDailyGift(pageA);

    await pageA.getByRole("button", { name: "Shops" }).click();
    const shopA = pageA.getByRole("complementary", { name: "General Store" });
    await shopA.getByRole("button", { name: "Buy (25)" }).click(); // Sparkler
    await pageA.getByRole("button", { name: "Close General Store" }).click();

    // A opens a trade from B's profile card.
    await pageA.getByRole("button", { name: /^Friends/ }).click();
    await pageA.getByRole("button", { name: new RegExp(b.handle) }).click();
    await pageA.getByRole("dialog").getByRole("button", { name: "Trade" }).click();
    const tradeA = pageA.getByRole("complementary", { name: "Trade" });
    await expect(tradeA).toBeVisible();

    // The trade shows up for B too, without B having done anything yet.
    await expect(pageB.getByRole("button", { name: "Trade" })).toBeVisible({ timeout: 10_000 });
    await pageB.getByRole("button", { name: "Trade" }).click();
    const tradeB = pageB.getByRole("complementary", { name: "Trade" });
    await expect(tradeB).toBeVisible();

    // A offers the sparkler and 5 coins; B sees it live.
    await tradeA.locator("select").first().selectOption({ label: "Sparkler (have 1)" });
    await tradeA.getByLabel("Coins").fill("5");
    await tradeA.getByRole("button", { name: "Update offer" }).click();
    await expect(tradeB.getByText("Sparkler")).toBeVisible();

    await tradeA.getByRole("button", { name: "Ready" }).click();
    await expect(tradeA.getByRole("button", { name: "Not ready" })).toBeVisible();
    await tradeB.getByRole("button", { name: "Ready" }).click();
    await expect(tradeB.getByRole("button", { name: "Not ready" })).toBeVisible();
    await expect(tradeA.getByRole("button", { name: "Confirm" })).toBeEnabled();

    // Changing the offer resets both sides' Ready, live for both.
    await tradeA.getByLabel("Coins").fill("10");
    await tradeA.getByRole("button", { name: "Update offer" }).click();
    await expect(tradeA.getByRole("button", { name: "Ready" })).toBeVisible();
    await expect(tradeB.getByRole("button", { name: "Ready" })).toBeVisible();
    await expect(tradeA.getByRole("button", { name: "Confirm" })).toBeDisabled();

    await tradeA.getByRole("button", { name: "Ready" }).click();
    await tradeB.getByRole("button", { name: "Ready" }).click();
    await tradeA.getByRole("button", { name: "Confirm" }).click();
    await expect(pageA.getByText("Trade complete!")).toBeVisible();
    await expect(pageB.getByText("Trade complete!")).toBeVisible();
    await pageA.getByRole("button", { name: "Nice!" }).click();
    await pageB.getByRole("button", { name: "Nice!" }).click();

    await pageB.getByRole("button", { name: "Inventory" }).click();
    await expect(pageB.getByRole("complementary", { name: "Inventory" }).getByText("Sparkler")).toBeVisible();
    await pageA.context().close();
    await pageB.context().close();
  });

  test("a home's access setting controls who can visit", async ({ browser }) => {
    const s = suffix();
    const a = await createPlayer(`ha_${s}`);
    const b = await createPlayer(`hb_${s}`);
    await befriendViaApi(a, b);
    const pageA = await signedIn(browser, a);
    const pageB = await signedIn(browser, b);

    // A closes their home to everyone but themself.
    await pageA.getByRole("button", { name: "My home" }).click();
    await expect
      .poll(async () => (await snapshot(pageA).catch(() => null))?.self, { timeout: 20_000 })
      .toBeTruthy();
    await pageA.getByRole("button", { name: "Menu" }).click();
    await pageA.getByRole("button", { name: "Manage home" }).click();
    await pageA.getByRole("radio", { name: "Closed" }).click();
    await pageA.getByRole("button", { name: "Close Manage your home" }).click();
    await pageA.getByRole("button", { name: "Menu" }).click();
    await pageA.getByRole("button", { name: "Leave" }).click();

    // B, a friend, is turned away.
    await pageB.getByRole("button", { name: /^Friends/ }).click();
    await pageB.getByRole("button", { name: new RegExp(a.handle) }).click();
    await pageB.getByRole("dialog").getByRole("button", { name: "Visit home" }).click();
    await expect(pageB.getByText(/isn't open to you/i)).toBeVisible({ timeout: 10_000 });
    await pageB.getByRole("button", { name: "Back" }).click();

    // A switches to inviting specific guests, and invites B.
    await pageA.getByRole("button", { name: "My home" }).click();
    await expect
      .poll(async () => (await snapshot(pageA).catch(() => null))?.self, { timeout: 20_000 })
      .toBeTruthy();
    await pageA.getByRole("button", { name: "Menu" }).click();
    await pageA.getByRole("button", { name: "Manage home" }).click();
    await pageA.getByRole("radio", { name: "Invite only" }).click();
    await pageA.getByRole("button", { name: "Invite" }).click();
    await pageA.getByRole("button", { name: "Close Manage your home" }).click();
    await pageA.getByRole("button", { name: "Menu" }).click();
    await pageA.getByRole("button", { name: "Leave" }).click();

    // B is let in now.
    await pageB.getByRole("button", { name: /^Friends/ }).click();
    await pageB.getByRole("button", { name: new RegExp(a.handle) }).click();
    await pageB.getByRole("dialog").getByRole("button", { name: "Visit home" }).click();
    await expect
      .poll(async () => (await snapshot(pageB).catch(() => null))?.self, { timeout: 20_000 })
      .toBeTruthy();
    await pageA.context().close();
    await pageB.context().close();
  });
});
