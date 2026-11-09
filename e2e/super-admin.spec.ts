import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

// Runs in order against ONE shared database: setup can only happen once.
test.describe.configure({ mode: "serial" });

const BOOTSTRAP_TOKEN = "e2e-bootstrap-token-0123456789abcdef"; // matches playwright.config.ts
const SA = { name: "Platform Owner", email: "root@e2e.test", password: "a-long-e2e-password" };
const ADMIN = { name: "Amira Admin", email: "amira@e2e.test", password: "another-long-e2e-password" };
const COMPANY = "Gulf Traders E2E";

let inviteUrl = "";

/** Signs in and, when `landing` is given, waits until the session exists before the caller navigates on. */
async function signIn(page: Page, email: string, password: string, landing?: RegExp) {
  await page.goto("/login");
  await page.locator("body[data-hydrated=true]").waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (landing) await expect(page).toHaveURL(landing);
}
const SA_HOME = /\/super-admin$/;
const WORKSPACE = /\/dashboard/;

async function newPage(browser: Browser) {
  const ctx = await browser.newContext();
  return { ctx, page: await ctx.newPage() };
}

test("first-run setup creates the Super Admin once, then closes", async ({ page }) => {
  await page.goto("/setup");
  await page.locator("body[data-hydrated=true]").waitFor();
  await page.getByLabel("Setup token").fill("not-the-token-not-the-token-x");
  await page.getByLabel("Your name").fill(SA.name);
  await page.getByLabel("Email").fill(SA.email);
  await page.getByLabel("Password").fill(SA.password);
  await page.getByRole("button", { name: "Create Super Admin" }).click();
  await expect(page.getByRole("alert").first()).toContainText("not correct");

  await page.getByLabel("Setup token").fill(BOOTSTRAP_TOKEN);
  await page.getByRole("button", { name: "Create Super Admin" }).click();
  await expect(page.getByRole("heading", { name: "Super Admin created" })).toBeVisible();

  const closed = await page.goto("/setup");
  expect(closed?.status()).toBe(404);
});

test("the Super Admin signs in to a separate control panel", async ({ page }) => {
  await signIn(page, SA.email, SA.password);
  await expect(page).toHaveURL(/\/super-admin$/);
  await expect(page.getByRole("heading", { name: "Platform overview" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Platform" }).getByRole("link", { name: "Companies", exact: true })).toBeVisible();
  // No company workspace navigation leaks into the platform panel.
  await expect(page.getByRole("link", { name: "Contacts" })).toHaveCount(0);
});

test("creates a company through the wizard and appoints its administrator", async ({ page }) => {
  await signIn(page, SA.email, SA.password, SA_HOME);
  await page.goto("/super-admin/companies/new");
  await page.locator("body[data-hydrated=true]").waitFor();

  // Step 1: validation blocks an empty form
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Legal company name is required")).toBeVisible();
  await page.getByLabel("Legal company name").fill(`${COMPANY} LLC`);
  await page.getByLabel("Display name").fill(COMPANY);
  await page.getByLabel("Industry").fill("trading");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2: choosing a country pre-fills currency, zone, language and phone code
  await page.getByLabel("Country *", { exact: true }).selectOption("AE");
  await expect(page.getByLabel("Default currency")).toHaveValue("AED");
  await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Dubai");
  await expect(page.getByLabel("Phone country code")).toHaveValue("+971");
  await page.getByLabel("City").fill("Dubai");
  await page.getByLabel("Subscription plan").selectOption({ label: "Starter" });
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3
  await page.getByLabel("Administrator full name").fill(ADMIN.name);
  await page.getByLabel("Administrator email").fill(ADMIN.email);
  await page.getByLabel("Job title").fill("Managing Director");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 4: review shows what will be created
  await expect(page.getByText(`${ADMIN.name} (${ADMIN.email})`)).toBeVisible();
  await expect(page.getByText("Asia/Dubai")).toBeVisible();
  await page.getByRole("button", { name: "Confirm and create company" }).click();

  await expect(page.getByRole("heading", { name: `${COMPANY} was created` })).toBeVisible();
  // No SMTP in the test environment, so the UI must say so and show the link instead of claiming delivery.
  await expect(page.getByText("The invitation email was not delivered")).toBeVisible();
  inviteUrl = (await page.locator("code", { hasText: "/accept-invite/" }).first().innerText()).trim();
  expect(inviteUrl).toContain("/accept-invite/");

  await page.goto("/super-admin/companies?q=Gulf");
  const row = page.getByRole("row", { name: new RegExp(COMPANY) });
  await expect(row).toContainText("United Arab Emirates");
  await expect(row).toContainText("Invitation pending");
  await expect(row).toContainText("Active");
});

test("the Company Admin accepts, lands in their own workspace and cannot reach the platform", async ({ browser }) => {
  const { ctx, page } = await newPage(browser);
  await page.goto(inviteUrl);
  await page.locator("body[data-hydrated=true]").waitFor();
  await expect(page.getByLabel("Your name")).toHaveValue(ADMIN.name); // pre-filled from the appointment
  await page.getByLabel("Choose a password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Join workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // The administrator manages their own company profile; platform-controlled identity is read-only.
  await page.goto("/settings/company");
  await page.locator("body[data-hydrated=true]").waitFor();
  await expect(page.getByText(`${COMPANY} LLC`)).toBeVisible();
  await page.getByLabel("City").fill("Abu Dhabi");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Company settings saved").first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("City")).toHaveValue("Abu Dhabi");

  const platform = await page.goto("/super-admin");
  expect(platform?.status()).toBe(404);
  const api = await page.request.get("/api/v1/platform/companies");
  expect(api.status()).toBe(404);
  await ctx.close();
});

test("suspending the company ends the administrator's access; reactivating restores it", async ({ browser }) => {
  const sa = await newPage(browser);
  await signIn(sa.page, SA.email, SA.password, SA_HOME);
  await sa.page.goto("/super-admin/companies?q=Gulf");
  await sa.page.getByRole("link", { name: COMPANY, exact: true }).click();
  await expect(sa.page.getByRole("heading", { name: COMPANY, level: 1 })).toBeVisible();
  await expect(sa.page.getByText(ADMIN.email).first()).toBeVisible();

  const admin = await newPage(browser);
  await signIn(admin.page, ADMIN.email, ADMIN.password, WORKSPACE);

  await sa.page.locator("body[data-hydrated=true]").waitFor();
  await sa.page.getByRole("button", { name: "Suspend", exact: true }).click();
  await expect(sa.page.getByRole("button", { name: "Suspend", exact: true }).last()).toBeDisabled(); // reason required
  await sa.page.getByLabel("Reason").fill("E2E: unpaid invoice");
  await sa.page.getByRole("dialog").getByRole("button", { name: "Suspend" }).click();
  await expect(sa.page.getByText("Suspended on")).toBeVisible();

  await admin.page.goto("/dashboard");
  await expect(admin.page).toHaveURL(/\/login/);
  await signIn(admin.page, ADMIN.email, ADMIN.password);
  await expect(admin.page.getByText("not linked to an active company")).toBeVisible();

  await sa.page.getByRole("button", { name: "Activate", exact: true }).click();
  await sa.page.getByRole("dialog").getByRole("button", { name: "Activate" }).click();
  await expect(sa.page.getByText("Suspended on")).toHaveCount(0);
  // Reactivation restores access immediately, with no new sign-in needed.
  await admin.page.goto("/dashboard");
  await expect(admin.page).toHaveURL(WORKSPACE);
  await expect(admin.page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Amira/ })).toBeVisible();

  await sa.ctx.close();
  await admin.ctx.close();
});

for (const theme of ["light", "dark"] as const) {
  test(`accessibility: Super Admin pages in ${theme} mode (axe, WCAG 2.1 A/AA)`, async ({ page }) => {
    const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
    await page.addInitScript((t) => localStorage.setItem("onecrm-theme", t), theme);
    await signIn(page, SA.email, SA.password, SA_HOME);
    await page.goto("/super-admin/companies?q=Gulf");
    await page.getByRole("link", { name: COMPANY, exact: true }).click();
    await expect(page.getByRole("heading", { name: COMPANY, level: 1 })).toBeVisible();
    const detail = page.url();
    const urls = [
      "/super-admin", "/super-admin/companies", "/super-admin/companies/new", detail, "/super-admin/administrators",
      "/super-admin/users", "/super-admin/countries", "/super-admin/plans", "/super-admin/audit", "/super-admin/jobs", "/super-admin/security",
    ];
    for (const url of urls) {
      await page.goto(url);
      await page.locator("body[data-hydrated=true]").waitFor();
      await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page }).withTags(tags).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(" ")})`), `${theme} ${url}`).toEqual([]);
    }
  });
}
