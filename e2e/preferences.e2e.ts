import { expect, test, type Page } from "@playwright/test";

// Two pages in one context share localStorage and receive each other's `storage` events,
// exactly like two browser tabs of the installed app.
async function openTwoTabs(context: import("@playwright/test").BrowserContext) {
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await tabA.goto("/");
  await tabB.goto("/");
  return { tabA, tabB };
}

const amount = (page: Page) => page.getByLabel("Water (ml)", { exact: true });
const customRatio = (page: Page) => page.getByLabel("Custom ratio (water per 1 part coffee)", { exact: true });
const result = (page: Page) => page.getByRole("status");

test("a preference saved in another tab replaces this tab's stale amount and ratio, and survives reload", async ({
  context,
}) => {
  const { tabA, tabB } = await openTwoTabs(context);

  await amount(tabA).fill("300");
  await expect(result(tabA)).toHaveText("18.8 grams");

  await tabB.getByRole("button", { name: "500 ml", exact: true }).click();
  await tabB.getByRole("button", { name: "1:18", exact: true }).click();
  await expect(result(tabB)).toHaveText("27.8 grams");

  await expect(amount(tabA)).toHaveValue("500");
  await expect(result(tabA)).toHaveText("27.8 grams");

  await tabA.reload();
  await expect(amount(tabA)).toHaveValue("500");
  await expect(result(tabA)).toHaveText("27.8 grams");
});

test("a custom ratio typed in one tab is replaced by a ratio saved in another tab", async ({ context }) => {
  const { tabA, tabB } = await openTwoTabs(context);

  await tabA.locator("summary").click();
  await customRatio(tabA).fill("17.5");
  await expect(result(tabA)).toHaveText("14.3 grams");

  await tabB.getByRole("button", { name: "500 ml", exact: true }).click();
  await tabB.getByRole("button", { name: "1:15", exact: true }).click();

  await expect(amount(tabA)).toHaveValue("500");
  await expect(customRatio(tabA)).toHaveValue("15");
  await expect(result(tabA)).toHaveText("33.3 grams");
});

test("an unrelated in-progress edit survives a change to a different saved field", async ({ context }) => {
  const { tabA, tabB } = await openTwoTabs(context);

  await amount(tabA).fill("300,");
  await tabB.getByRole("button", { name: "1:18", exact: true }).click();

  await expect(tabA.getByRole("button", { name: "1:18", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(amount(tabA)).toHaveValue("300,");

  await amount(tabA).pressSequentially("5");
  await expect(amount(tabA)).toHaveValue("300,5");
  await expect(result(tabA)).toHaveText("16.7 grams");
});

test("a discarded draft stays discarded when preferences later return to its old saved value", async ({ context }) => {
  const { tabA, tabB } = await openTwoTabs(context);

  await amount(tabA).fill("300");
  await amount(tabA).fill("300,");

  await tabB.getByRole("button", { name: "500 ml", exact: true }).click();
  await expect(amount(tabA)).toHaveValue("500");

  await amount(tabB).fill("300");
  await expect(amount(tabA)).toHaveValue("300");
  await expect(result(tabA)).toHaveText("18.8 grams");
});

test("typing on page load replaces the default, and replaces the full restored amount after reload", async ({ page }) => {
  await page.goto("/");
  await expect(amount(page)).toBeFocused();
  await page.keyboard.type("320");
  await expect(amount(page)).toHaveValue("320");
  await expect(result(page)).toHaveText("20 grams");

  await amount(page).fill("1000");
  await page.reload();
  await expect(amount(page)).toBeFocused();
  await page.keyboard.type("320");
  await expect(amount(page)).toHaveValue("320");
  await expect(result(page)).toHaveText("20 grams");
});

