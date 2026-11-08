import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { registerOwner } from "./helpers";

const ready = async (page: Page) => {
  await page.locator("body[data-hydrated=true]").waitFor();
  await page.waitForLoadState("networkidle");
};

test.describe("roles and permissions (real browser)", () => {
  test("a Company Admin creates, edits, assigns and deletes a custom role; system roles stay fixed", async ({ page }) => {
    await registerOwner(page, "Roles E2E Co");
    await page.goto("/settings/roles");
    await ready(page);
    await expect(page.getByRole("heading", { name: "Roles and permissions", level: 1 })).toBeVisible();

    // The five system roles are listed, marked, and cannot be edited or deleted.
    for (const name of ["Company Admin", "Admin", "Manager", "Sales", "Viewer"]) {
      await expect(page.getByRole("listitem").filter({ hasText: name }).first()).toBeVisible();
    }
    const adminRow = page.getByRole("listitem").filter({ hasText: "Company Admin" }).first();
    await expect(adminRow.getByText("System")).toBeVisible();
    await expect(adminRow.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(adminRow.getByRole("button", { name: "Delete" })).toHaveCount(0);

    // Create: the Save button stays off until the role is valid.
    await page.getByRole("button", { name: "New role" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Create role" })).toBeDisabled();
    await dialog.getByLabel("Role name").fill("Support Lead");
    await expect(dialog.getByRole("button", { name: "Create role" })).toBeDisabled(); // still no permissions

    // Ask for "edit contacts": the editor adds the "view contacts" it depends on, narrowest first.
    await dialog.getByLabel("Create and edit contacts", { exact: true }).selectOption("own");
    await expect(dialog.getByLabel("View contacts", { exact: true })).toHaveValue("own");
    await expect(dialog.getByText("2 permissions selected")).toBeVisible();
    // Widen the base: still coherent (view all, edit own).
    await dialog.getByLabel("View contacts", { exact: true }).selectOption("all");
    await expect(dialog.getByLabel("Create and edit contacts", { exact: true })).toHaveValue("own");
    // Removing the base removes what is built on it.
    await dialog.getByLabel("View contacts", { exact: true }).selectOption("none");
    await expect(dialog.getByLabel("Create and edit contacts", { exact: true })).toHaveValue("none");
    await dialog.getByLabel("View contacts", { exact: true }).selectOption("all");
    await dialog.getByLabel("Create and edit contacts", { exact: true }).selectOption("own");

    // Accessibility of the editor itself, dialog open.
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(" ")})`)).toEqual([]);

    await dialog.getByRole("button", { name: "Create role" }).click();
    await expect(page.getByText("Role created").first()).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: "Support Lead" });
    await expect(row.getByText("Custom")).toBeVisible();
    await expect(row).toContainText("2 permissions · 0 people");

    // The new role is immediately offered when inviting someone from the Team page.
    await page.goto("/settings/team");
    await ready(page);
    await expect(page.getByRole("listitem").filter({ hasText: "Support Lead" })).toBeVisible();
    await page.getByRole("button", { name: "Invite teammate" }).click();
    await expect(page.getByRole("dialog").getByLabel("Role").locator("option", { hasText: "Support Lead" })).toHaveCount(1);
    await page.keyboard.press("Escape");

    // Edit it: add lead access, save.
    await page.goto("/settings/roles");
    await ready(page);
    await page.getByRole("listitem").filter({ hasText: "Support Lead" }).getByRole("button", { name: "Edit" }).click();
    await page.getByRole("dialog").getByLabel("View leads", { exact: true }).selectOption("all");
    await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Role updated").first()).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Support Lead" })).toContainText("3 permissions");

    // Delete it.
    await page.getByRole("listitem").filter({ hasText: "Support Lead" }).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete role" }).click();
    await expect(page.getByText("Role deleted").first()).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Support Lead" })).toHaveCount(0);
  });

  test("a duplicate role name is refused with a clear message", async ({ page }) => {
    await registerOwner(page, "Roles Dup Co");
    await page.goto("/settings/roles");
    await ready(page);
    await page.getByRole("button", { name: "New role" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Role name").fill("manager");
    await dialog.getByLabel("View tasks", { exact: true }).selectOption("all");
    await dialog.getByRole("button", { name: "Create role" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "already exists" })).toBeVisible();
  });
});

test.describe("navigation", () => {
  test("sections are grouped, collapsible, remembered, and never hide the current page", async ({ page }) => {
    await registerOwner(page, "Nav E2E Co");
    const nav = page.getByRole("navigation", { name: "Primary" });
    for (const title of ["Workspace", "Customers", "Sales", "Administration"]) {
      await expect(nav.getByRole("button", { name: title })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Roles and permissions" })).toBeVisible();

    await nav.getByRole("button", { name: "Customers" }).click();
    await expect(nav.getByRole("link", { name: "Leads" })).toBeHidden();
    await expect(nav.getByRole("button", { name: "Customers" })).toHaveAttribute("aria-expanded", "false");
    await page.reload();
    await ready(page);
    await expect(nav.getByRole("link", { name: "Leads" })).toBeHidden(); // remembered

    // Open a page inside the collapsed section from the command palette: it must reveal itself.
    await page.goto("/contacts");
    await ready(page);
    await expect(nav.getByRole("link", { name: "Contacts" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Contacts" })).toHaveAttribute("aria-current", "page");

    await page.goto("/dashboard");
    await ready(page);
    await nav.getByRole("button", { name: "Customers" }).click(); // expand again
    await expect(nav.getByRole("link", { name: "Leads" })).toBeVisible();
  });
});

test.describe("phone-width layout (390 x 844)", () => {
  test("pages do not scroll sideways and the menu opens as a drawer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await registerOwner(page, "Mobile E2E Co");
    const pages = ["/dashboard", "/contacts", "/companies", "/leads", "/deals", "/tasks", "/settings/team", "/settings/roles", "/settings/company", "/settings/security"];
    const overflowing: string[] = [];
    for (const url of pages) {
      await page.goto(url);
      await ready(page);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) overflowing.push(`${url} (+${over}px)`);
    }
    expect(overflowing).toEqual([]);

    await page.goto("/dashboard");
    await ready(page);
    await page.getByRole("button", { name: "Open menu" }).click();
    const drawer = page.getByRole("navigation", { name: "Primary" });
    await expect(drawer.getByRole("link", { name: "Contacts" })).toBeVisible();
    await drawer.getByRole("link", { name: "Contacts" }).click();
    await expect(page).toHaveURL(/\/contacts/);
  });
});
