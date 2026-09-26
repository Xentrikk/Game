import { expect, test, type Browser, type Page } from "@playwright/test";
import { createPlayer, deleteE2eUsers, signInWithPassword, type TestPlayer } from "./helpers";
import { enterTown, snapshot, walkTo } from "./world";

const suffix = () => Date.now().toString(36).slice(-4);

async function snap(page: Page, name: string) {
  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/p3-${name}.png` });
}

async function signedIn(browser: Browser, player: TestPlayer) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  const page = await context.newPage();
  await signInWithPassword(page, player);
  return page;
}

/** Opens someone's card from the Add tab by handle and adds them. */
async function addFriend(page: Page, handle: string) {
  await page.getByRole("button", { name: /^Friends/ }).click();
  await page.getByRole("tab", { name: "Add" }).click();
  await page.getByPlaceholder("@handle").fill(handle);
  await page.getByRole("button", { name: "Find" }).click();
  const card = page.getByRole("dialog");
  await card.getByRole("button", { name: "Add friend" }).click();
  await expect(card.getByText("Friend request sent.").first()).toBeVisible();
  await card.press("Escape");
  await page.getByRole("button", { name: "Close Friends" }).click();
}

test.describe("friends and talking", () => {
  test.beforeEach(async ({ browserName: _ }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Multi-browser social tests run once, on desktop.");
    await deleteE2eUsers();
  });

  test("A friends B, messages B while B is offline, B reads it on login, then B blocks A", async ({
    browser,
  }) => {
    const s = suffix();
    const a = await createPlayer(`fa_${s}`);
    const b = await createPlayer(`fb_${s}`);

    // A sends a friend request by handle.
    const pageA = await signedIn(browser, a);
    await addFriend(pageA, b.handle);

    // B accepts it.
    let pageB = await signedIn(browser, b);
    await expect(pageB.getByRole("button", { name: /^Friends/ })).toContainText("1");
    await pageB.getByRole("button", { name: /^Friends/ }).click();
    await pageB.getByRole("tab", { name: /Requests/ }).click();
    await snap(pageB, "request");
    await pageB.getByRole("button", { name: "Accept" }).click();
    await pageB.getByRole("tab", { name: "Friends" }).click();
    await expect(pageB.getByRole("button", { name: new RegExp(a.handle) })).toBeVisible();

    // A sees B online, then B leaves.
    await pageA.getByRole("button", { name: /^Friends/ }).click();
    await expect(pageA.getByRole("button", { name: new RegExp(`${b.handle}.*Online`) })).toBeVisible();
    await pageB.context().close();
    await expect(pageA.getByRole("button", { name: new RegExp(`${b.handle}.*Offline`) })).toBeVisible({
      timeout: 10_000,
    });

    // A messages B while B is offline.
    await pageA.getByRole("button", { name: "Message" }).click();
    const composer = pageA.getByPlaceholder(`Message ${b.handle}`);
    await composer.fill("Hi! Are you around later?");
    await composer.press("Enter");
    await expect(pageA.locator(".msg.mine .bubble")).toHaveText("Hi! Are you around later?");
    await expect(pageA.getByTestId("receipt")).toHaveText("Sent");

    // B signs in: the chat shows 1 unread, and opening it shows the message. A sees it's read.
    pageB = await signedIn(browser, b);
    await expect(pageB.getByRole("button", { name: /^Chats/ })).toContainText("1");
    await expect(pageA.getByTestId("receipt")).toHaveText("Delivered");
    await pageB.getByRole("button", { name: /^Chats/ }).click();
    await pageB.getByRole("button", { name: new RegExp(a.handle) }).click();
    await expect(pageB.locator(".msg.theirs .bubble")).toHaveText("Hi! Are you around later?");
    await expect(pageA.getByTestId("receipt")).toHaveText("Read");
    await snap(pageB, "chat");

    // B blocks A (from A's card, opened from the friends list).
    await pageB
      .getByRole("button", { name: "Close Chat" })
      .or(pageB.getByRole("button", { name: `Close ${a.handle}` }))
      .click();
    await pageB.getByRole("button", { name: /^Friends/ }).click();
    await pageB.getByRole("button", { name: new RegExp(a.handle) }).click();
    const card = pageB.getByRole("dialog");
    await card.getByRole("button", { name: "Block" }).click();
    await card.getByRole("button", { name: "Block" }).click(); // confirm
    await expect(card).toHaveCount(0);
    await expect(pageB.getByText("No friends yet.")).toBeVisible();

    // A can no longer message B...
    await composer.fill("hello?");
    await composer.press("Enter");
    await expect(pageA.getByRole("alert").filter({ hasText: "You can only message friends." })).toBeVisible();
    // ...can't find them...
    await pageA.getByRole("button", { name: `Close ${b.handle}` }).click();
    await pageA.getByRole("button", { name: /^Friends/ }).click();
    await expect(pageA.getByText("No friends yet.")).toBeVisible();
    await pageA.getByRole("tab", { name: "Add" }).click();
    await pageA.getByPlaceholder("@handle").fill(b.handle);
    await pageA.getByRole("button", { name: "Find" }).click();
    await expect(pageA.getByRole("alert").filter({ hasText: "No one has that handle" })).toBeVisible();
    await pageA.getByRole("button", { name: "Close Friends" }).click();

    // ...and they can't see each other in the Town Square.
    await enterTown(pageA);
    await enterTown(pageB);
    await pageA.waitForTimeout(1500);
    expect((await snapshot(pageA)).others.map((o) => o.handle)).not.toContain(b.handle);
    expect((await snapshot(pageB)).others.map((o) => o.handle)).not.toContain(a.handle);
    await pageA.context().close();
    await pageB.context().close();
  });

  test("live chat: typing indicator, receipts, edit and delete", async ({ browser }) => {
    const s = suffix();
    const a = await createPlayer(`la_${s}`);
    const b = await createPlayer(`lb_${s}`);
    const pageA = await signedIn(browser, a);
    await addFriend(pageA, b.handle);
    const pageB = await signedIn(browser, b);
    await pageB.getByRole("button", { name: /^Friends/ }).click();
    await pageB.getByRole("tab", { name: /Requests/ }).click();
    await pageB.getByRole("button", { name: "Accept" }).click();
    await pageB.getByRole("tab", { name: "Friends" }).click();
    await pageB.getByRole("button", { name: "Message" }).click();

    // A opens the same chat from their side (an empty DM only shows up for the other person once it has a message).
    await pageA.getByRole("button", { name: /^Friends/ }).click();
    await pageA.getByRole("button", { name: "Message" }).click();

    // Typing shows up for the other person.
    await pageB.getByPlaceholder(`Message ${a.handle}`).pressSequentially("hey the");
    await expect(pageA.getByTestId("typing")).toContainText(`${b.handle} is typing`);
    await pageB.getByPlaceholder(`Message ${a.handle}`).pressSequentially("re!");
    await pageB.getByPlaceholder(`Message ${a.handle}`).press("Enter");
    await expect(pageA.locator(".msg.theirs .bubble")).toHaveText("hey there!");
    // A has the chat open, so B sees it read straight away.
    await expect(pageB.getByTestId("receipt")).toHaveText("Read");

    // B edits, then deletes; A sees both.
    await pageB.getByRole("button", { name: "Message options" }).click();
    await pageB.getByRole("menuitem", { name: "Edit" }).click();
    const box = pageB.getByPlaceholder(`Message ${a.handle}`);
    await box.fill("hey there, friend!");
    await box.press("Enter");
    await expect(pageA.locator(".msg.theirs .bubble")).toContainText("hey there, friend! (edited)");
    await pageB.getByRole("button", { name: "Message options" }).click();
    await pageB.getByRole("menuitem", { name: "Delete" }).click();
    await expect(pageA.locator(".msg.theirs .bubble")).toHaveText("Message deleted");
    await snap(pageA, "live-chat");
    await pageA.context().close();
    await pageB.context().close();
  });

  test("in the world: Say bubbles, emotes and player cards", async ({ browser }) => {
    const s = suffix();
    const a = await createPlayer(`wa_${s}`);
    const b = await createPlayer(`wb_${s}`);
    const pageA = await signedIn(browser, a);
    const pageB = await signedIn(browser, b);
    await enterTown(pageA);
    await enterTown(pageB);
    await expect.poll(async () => (await snapshot(pageA)).others.map((o) => o.handle)).toContain(b.handle);

    // A says something: B sees a bubble over A's head and the line in the log.
    await pageA.keyboard.press("t");
    await pageA.getByLabel("Say something to people nearby").fill("Hello, town!");
    await pageA.getByLabel("Say something to people nearby").press("Enter");
    await expect(pageB.locator(".speech")).toHaveText("Hello, town!");
    await expect(pageA.locator(".speech")).toHaveText("Hello, town!");
    await pageB.getByRole("button", { name: "Log" }).click();
    await expect(pageB.getByRole("region", { name: "Chat log" })).toContainText(`${a.handle}: Hello, town!`);

    // B waves.
    await pageB.getByRole("button", { name: "Emote" }).click();
    await pageB.getByRole("menuitem", { name: "Wave" }).click();
    await expect(pageA.locator(".float-emote")).toHaveCount(1);
    await snap(pageA, "world-talk");

    // Clicking B opens B's card with Add friend.
    await walkTo(pageA, { x: 22, y: 16 });
    const other = (await snapshot(pageA)).others.find((o) => o.handle === b.handle)!;
    const canvas = pageA.locator(".world-canvas canvas");
    const box = (await canvas.boundingBox())!;
    const me = (await snapshot(pageA)).self!;
    const scale = box.width / 320;
    // The camera centres on the local player, so screen position = relative world position + centre.
    const sx = box.x + (160 + (other.px.x - me.px.x)) * scale;
    const sy = box.y + (90 + (other.px.y - me.px.y) + 12) * scale;
    await pageA.mouse.click(sx, sy);
    await expect(pageA.getByRole("dialog", { name: b.handle })).toBeVisible();
    await expect(pageA.getByRole("dialog").getByRole("button", { name: "Add friend" })).toBeVisible();
    await pageA.context().close();
    await pageB.context().close();
  });

  test("friends see where you are, and Go takes you to them", async ({ browser }) => {
    const s = suffix();
    const a = await createPlayer(`ga_${s}`);
    const b = await createPlayer(`gb_${s}`);
    const pageA = await signedIn(browser, a);
    await addFriend(pageA, b.handle);
    const pageB = await signedIn(browser, b);
    await pageB.getByRole("button", { name: /^Friends/ }).click();
    await pageB.getByRole("tab", { name: /Requests/ }).click();
    await pageB.getByRole("button", { name: "Accept" }).click();
    await pageB.getByRole("button", { name: "Close Friends" }).click();

    await enterTown(pageB);
    await pageA.getByRole("button", { name: /^Friends/ }).click();
    await expect(
      pageA.getByRole("button", { name: new RegExp(`${b.handle}.*Online · Town Square`) }),
    ).toBeVisible();
    await pageA.getByRole("button", { name: "Close Friends" }).click();

    // A walks into town and lands in B's instance; the Go button (re)joins it from inside the world.
    await enterTown(pageA);
    const roomOf = (p: Page) =>
      p.evaluate(() => (window as unknown as { __hearth: { roomId(): string } }).__hearth.roomId());
    expect(await roomOf(pageA)).toBe(await roomOf(pageB));
    await pageA.getByRole("button", { name: "Friends" }).click();
    await pageA.getByRole("button", { name: "Go" }).click();
    await expect
      .poll(async () => (await snapshot(pageA).catch(() => null))?.others.map((o) => o.handle))
      .toContain(b.handle);
    expect(await roomOf(pageA)).toBe(await roomOf(pageB));

    // Leaving town clears the location for friends.
    await pageB.getByRole("button", { name: "Menu" }).click();
    await pageB.getByRole("button", { name: "Leave town" }).click();
    await pageA.getByRole("button", { name: "Friends" }).click();
    await expect(pageA.getByRole("button", { name: new RegExp(`${b.handle}.*Online$`) })).toBeVisible();
    await pageA.context().close();
    await pageB.context().close();
  });
});
