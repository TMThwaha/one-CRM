import { expect, type Page } from "@playwright/test";

let n = 0;
export const uniq = (p: string) => `${p}-${Date.now().toString(36)}${++n}`;

export async function registerOwner(page: Page, org = "E2E Traders") {
  const email = `${uniq("owner")}@e2e.test`;
  await page.goto("/register");
  await page.locator("body[data-hydrated=true]").waitFor();
  await page.getByLabel("Your name").fill("Asha Verma");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("a-long-e2e-password");
  await page.getByLabel("Company name").fill(org);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return email;
}

/** Opens the "New" menu and picks an entry. */
export async function newMenu(page: Page, item: string) {
  await page.getByRole("button", { name: "Create new" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}
