import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newMenu, registerOwner, uniq } from "./helpers";

const ready = async (page: Page) => {
  await page.locator("body[data-hydrated=true]").waitFor();
  await page.waitForLoadState("networkidle");
};
const bell = (page: Page, name: RegExp | string) => page.getByRole("button", { name });

test("assigning a task reaches the assignee through events, the queue and the worker (real browser)", async ({ page, browser }) => {
  await registerOwner(page, "Notify E2E Co");

  // The owner invites a Sales teammate, who joins in a separate browser context.
  await page.goto("/settings/team");
  await page.getByRole("button", { name: "Invite teammate" }).click();
  await page.getByLabel("Email").fill(`${uniq("rep")}@e2e.test`);
  await page.getByLabel("Role").selectOption({ label: "Sales" });
  await page.getByRole("button", { name: "Create invitation" }).click();
  const link = await page.getByLabel("Invitation link").inputValue();

  const ctx = await browser.newContext();
  const rep = await ctx.newPage();
  await rep.goto(new URL(link).pathname);
  await rep.locator("body[data-hydrated=true]").waitFor();
  await rep.getByLabel("Your name").fill("Rohan Rep");
  await rep.getByLabel("Choose a password").fill("a-long-rep-password");
  await rep.getByRole("button", { name: "Join workspace" }).click();
  await expect(rep).toHaveURL(/\/dashboard/);
  await ready(rep);
  await expect(bell(rep, /^Notifications$/)).toBeVisible(); // nothing yet

  // The owner assigns a task to the teammate.
  await page.goto("/tasks");
  await ready(page);
  await newMenu(page, "Task");
  await page.getByLabel("What needs to be done? *").fill("Prepare the supplier call");
  await page.getByLabel("Assignee").selectOption({ label: "Rohan Rep" });
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Task created").first()).toBeVisible();

  // Event -> dispatcher -> job -> handler -> notification. The worker polls every 500 ms in this run;
  // the teammate's page picks it up on reload (the bell also refreshes itself every 15 s).
  await expect(async () => {
    await rep.reload();
    await rep.locator("body[data-hydrated=true]").waitFor();
    await expect(bell(rep, /Notifications, 1 unread/)).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });

  // The person who assigned it is not notified about their own action.
  await ready(page);
  await expect(bell(page, /^Notifications$/)).toBeVisible();

  // Open the bell: the message names who and what, and the popover is accessible.
  await bell(rep, /Notifications, 1 unread/).click();
  const item = rep.getByRole("menuitem", { name: /assigned you a task/ });
  await expect(item).toContainText("Asha Verma assigned you a task");
  await expect(item).toContainText("Prepare the supplier call");
  const axe = await new AxeBuilder({ page: rep }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(" ")})`)).toEqual([]);

  // Clicking it opens the tasks and marks it read.
  await item.click();
  await expect(rep).toHaveURL(/\/tasks/);
  await expect(bell(rep, /^Notifications$/)).toBeVisible();
  await rep.reload();
  await ready(rep);
  await expect(bell(rep, /^Notifications$/)).toBeVisible(); // still read after a reload: it was saved
  await ctx.close();
});
