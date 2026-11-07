import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { newMenu, registerOwner, uniq } from "./helpers";

test("a Sales teammate sees only their own deals (invite flow through the real UI)", async ({ page, browser }) => {
  await registerOwner(page, "Perm Co");

  // Owner creates a deal
  await newMenu(page, "Deal");
  await page.getByLabel("Deal title *").fill("Owner secret deal");
  await page.getByRole("button", { name: "Create deal" }).click();
  await expect(page.getByText("Deal created").first()).toBeVisible();

  // Owner invites a Sales user and copies the link
  await page.goto("/settings/team");
  await page.getByRole("button", { name: "Invite teammate" }).click();
  const email = `${uniq("rep")}@e2e.test`;
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Role").selectOption({ label: "Sales" });
  await page.getByRole("button", { name: "Create invitation" }).click();
  const link = await page.getByLabel("Invitation link").inputValue();
  expect(link).toContain("/accept-invite/");

  // The teammate joins in a separate browser context (separate cookies)
  const ctx = await browser.newContext();
  const rep = await ctx.newPage();
  const path = new URL(link).pathname;
  await rep.goto(path);
  await rep.locator("body[data-hydrated=true]").waitFor();
  await expect(rep.getByRole("heading", { name: /Join Perm Co/ })).toBeVisible();
  await rep.getByLabel("Your name").fill("Rohan Rep");
  await rep.getByLabel("Choose a password").fill("a-long-rep-password");
  await rep.getByRole("button", { name: "Join workspace" }).click();
  await expect(rep).toHaveURL(/\/dashboard/);

  // Rep: no admin navigation, cannot see the owner's deal anywhere
  await expect(rep.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  await rep.goto("/deals");
  await expect(rep.getByText("No deals in this pipeline")).toBeVisible();
  await rep.goto("/audit-nonexistent");
  await rep.goto("/settings/audit");
  await expect(rep.getByText("We couldn't find that")).toBeVisible(); // 404, not a permission leak

  // Rep creates a deal of their own; it shows up for the rep
  await newMenu(rep, "Deal");
  await rep.getByLabel("Deal title *").fill("Rep own deal");
  await rep.getByRole("button", { name: "Create deal" }).click();
  await expect(rep.getByText("Deal created").first()).toBeVisible();
  await rep.goto("/deals");
  await expect(rep.getByRole("link", { name: "Rep own deal" })).toBeVisible();
  await expect(rep.getByRole("link", { name: "Owner secret deal" })).toHaveCount(0);

  // Search cannot find it either
  await rep.keyboard.press("Control+k");
  await rep.getByRole("combobox", { name: "Search or run a command" }).fill("secret");
  await expect(rep.getByText(/No results for/)).toBeVisible();
  await ctx.close();

  // Owner sees both
  await page.goto("/deals");
  await expect(page.getByRole("link", { name: "Rep own deal" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Owner secret deal" })).toBeVisible();
});

test.describe("accessibility (axe, WCAG 2.1 A/AA rules)", () => {
  const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

  test("login and register", async ({ page }) => {
    for (const url of ["/login", "/register"]) {
      await page.goto(url);
      await page.locator("body[data-hydrated=true]").waitFor();
      const r = await new AxeBuilder({ page }).withTags(tags).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`), url).toEqual([]);
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`app pages in ${theme} mode`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("onecrm-theme", t), theme);
      await registerOwner(page, "A11y Co");
      await newMenu(page, "Contact");
      await page.getByLabel("First name *").fill("Axe");
      await page.getByLabel("Email").fill(`${uniq("axe")}@e2e.test`);
      await page.getByRole("button", { name: "Create contact" }).click();
      await expect(page.getByText("Contact created").first()).toBeVisible();
      for (const url of ["/dashboard", "/contacts", "/companies", "/leads", "/deals", "/tasks", "/settings/team", "/settings/audit"]) {
        await page.goto(url);
        await page.locator("body[data-hydrated=true]").waitFor();
        await page.waitForLoadState("networkidle");
        const r = await new AxeBuilder({ page }).withTags(tags).analyze();
        expect(r.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(" ")})`), `${theme} ${url}`).toEqual([]);
      }
    });
  }
});
