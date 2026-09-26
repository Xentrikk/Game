import { expect, test, type Page } from "@playwright/test";
import {
  TEST_CODE,
  phonesFor,
  waitBeforeResend,
  deleteE2eUsers,
  emailCode,
  emailLink,
  lastEmailId,
  spritePixels,
} from "./helpers";

/** Set SCREENSHOT_DIR to save screenshots of each screen, e.g. for design review. */
async function snap(page: Page, project: string, name: string) {
  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${project}-${name}.png` });
}

test.beforeEach(async () => {
  await deleteE2eUsers();
});

test("sign up by phone, make a character, link email, sign back in by email and see the same character", async ({
  page,
}, testInfo) => {
  const phones = phonesFor(testInfo.project.name);
  const handle = `e2e_${testInfo.project.name.slice(0, 3)}_${Date.now().toString(36).slice(-5)}`;
  const email = `${handle}@e2e.hearth.test`;

  // Welcome → phone
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hearth" })).toBeVisible();
  await page.waitForTimeout(3000);
  await snap(page, testInfo.project.name, "1-welcome");
  await page.getByRole("button", { name: "Continue with phone" }).click();
  await page.getByLabel(/^Country/).selectOption("US");
  await page.getByLabel("Phone number", { exact: true }).fill(phones.main);
  await snap(page, testInfo.project.name, "2-phone");
  await page.getByRole("button", { name: "Send code" }).click();

  // A wrong code shows attempts left; the right code signs in.
  await expect(page.getByText("We texted a code to")).toBeVisible();
  await page.getByLabel("6-digit code").fill("000000");
  await expect(page.getByRole("alert")).toContainText("4 tries left");
  await snap(page, testInfo.project.name, "3-code");
  await page.getByLabel("6-digit code").fill(TEST_CODE);

  // Age gate
  await expect(page.getByRole("heading", { name: "When's your birthday?" })).toBeVisible();
  await page.getByLabel(/^Month/).selectOption("5");
  await page.getByLabel(/^Day/).selectOption("5");
  await page.getByLabel(/^Year/).selectOption("2000");
  await snap(page, testInfo.project.name, "4-age");
  await page.getByRole("button", { name: "Continue" }).click();

  // Terms
  await expect(page.getByRole("heading", { name: "A few ground rules" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText("Please agree to continue.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue" }).click();

  // Handle: reserved first, then a free one
  await expect(page.getByRole("heading", { name: "Pick your handle" })).toBeVisible();
  await page.getByLabel(/^Handle/).fill("admin");
  await expect(page.getByText("That handle is reserved")).toBeVisible();
  await page.getByLabel(/^Handle/).fill(handle);
  await expect(page.getByText("That handle is free!")).toBeVisible();
  await snap(page, testInfo.project.name, "5-handle");
  await page.getByRole("button", { name: "Claim handle" }).click();

  // Character creator
  await expect(page.getByRole("heading", { name: "Make your character" })).toBeVisible();
  await page.getByRole("tab", { name: "Hair" }).click();
  await page.getByRole("button", { name: "Ponytail" }).click();
  await page.getByRole("button", { name: "Hair color 6" }).click();
  await page.getByRole("tab", { name: "Top" }).click();
  await page.getByRole("button", { name: "Hoodie" }).click();
  await page.getByRole("button", { name: "top main color 11" }).click();
  await page.getByRole("tab", { name: "Extra" }).click();
  await page.getByRole("button", { name: "Beanie" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "None" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Flower" }).click();
  await page.getByRole("tab", { name: "About" }).click();
  await page.getByLabel("Display name", { exact: true }).fill("Pixel Pal");
  await page.getByLabel("Pronouns (optional)").fill("they/them");
  await page.getByLabel(/Bio/).fill("Here to hang out.");
  await page.getByRole("tab", { name: "Top" }).click();
  await snap(page, testInfo.project.name, "6-creator");
  await page.getByRole("tab", { name: "About" }).click();
  await page.getByRole("button", { name: "Done!" }).click();

  // Home
  await expect(page.getByText(`@${handle}`)).toBeVisible();
  await expect(page.getByText("they/them")).toBeVisible();
  const before = await spritePixels(page, "Pixel Pal's character");
  await page.waitForTimeout(3000);
  await snap(page, testInfo.project.name, "7-home");

  // Link an email
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByTestId("account-phone")).toHaveText(`+1${phones.main}`);
  await page.getByRole("button", { name: "Add an email" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  const linkMail = await emailCode(email);
  await page.getByLabel("6-digit code").fill(linkMail.code);
  await expect(page.getByText("Email added.")).toBeVisible();
  await expect(page.getByTestId("account-email")).toHaveText(email);

  // Sign out
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue with email" })).toBeVisible();

  // Sign back in with the email code
  await waitBeforeResend();
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  const signInMail = await emailCode(email, linkMail.id);
  await page.getByLabel("6-digit code").fill(signInMail.code);

  // Same account, same character, pixel for pixel
  await expect(page.getByText(`@${handle}`)).toBeVisible();
  expect(await spritePixels(page, "Pixel Pal's character")).toBe(before);

  // Sign out again, then sign in with the email's magic link instead of the code
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  const prevId = await lastEmailId(email);
  await waitBeforeResend();
  await page.getByRole("button", { name: "Send code" }).click();
  const { link } = await emailLink(email, prevId);
  await page.goto(link);
  await expect(page.getByText(`@${handle}`)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
});

test("under-13s are blocked with a neutral message and can't get back in", async ({ page }, testInfo) => {
  const phones = phonesFor(testInfo.project.name);
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with phone" }).click();
  await page.getByLabel(/^Country/).selectOption("US");
  await page.getByLabel("Phone number", { exact: true }).fill(phones.underage);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill(TEST_CODE);

  await page.getByLabel(/^Month/).selectOption("1");
  await page.getByLabel(/^Day/).selectOption("1");
  await page.getByLabel(/^Year/).selectOption(String(new Date().getFullYear() - 10));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Sorry, you can't create a Hearth account right now.")).toBeVisible();

  // Signing in again leads to the same message.
  await waitBeforeResend();
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with phone" }).click();
  await page.getByLabel(/^Country/).selectOption("US");
  await page.getByLabel("Phone number", { exact: true }).fill(phones.underage);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill(TEST_CODE);
  await expect(page.getByRole("alert")).toHaveText("Sorry, you can't create a Hearth account right now.");
});
