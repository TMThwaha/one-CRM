import { expect, test } from "@playwright/test";
import { newMenu, registerOwner, uniq } from "./helpers";

test.describe("core CRM flow (real browser, real server, real database)", () => {
  test("register, create contact + company, log activity, see the connected timeline", async ({ page }) => {
    await registerOwner(page);
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Asha/ })).toBeVisible();

    // company
    await newMenu(page, "Company");
    await page.getByLabel("Company name *").fill("Acme Corp");
    await page.getByLabel("Website domain").fill("acme.test");
    await page.getByRole("button", { name: "Create company" }).click();
    await expect(page.getByText("Company created").first()).toBeVisible();

    // contact linked to the company
    await newMenu(page, "Contact");
    await page.getByLabel("First name *").fill("Ravi");
    await page.getByLabel("Last name").fill("Kumar");
    await page.getByLabel("Email").fill("ravi@acme.test");
    await page.getByLabel("Company", { exact: true }).selectOption({ label: "Acme Corp" });
    await page.getByRole("button", { name: "Create contact" }).click();
    await expect(page.getByText("Contact created").first()).toBeVisible();

    await page.goto("/contacts");
    await page.getByRole("link", { name: "Ravi Kumar" }).click();
    await expect(page.getByRole("heading", { name: "Ravi Kumar" })).toBeVisible();
    await expect(page.getByText("Contact created").first()).toBeVisible(); // system timeline entry

    // log a call
    await page.getByLabel("Activity type").selectOption("call");
    await page.getByLabel("Subject").fill("Intro call");
    await page.getByRole("button", { name: "Log activity" }).click();
    await expect(page.getByText("Intro call")).toBeVisible();

    // duplicate email is rejected with a field-level message
    await newMenu(page, "Contact");
    await page.getByLabel("First name *").fill("Dup");
    await page.getByLabel("Email").fill("RAVI@acme.test");
    await page.getByRole("button", { name: "Create contact" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /already exists/ })).toBeVisible();
  });

  test("deal board: create, move by select, lost needs a reason, won closes", async ({ page }) => {
    await registerOwner(page);
    await newMenu(page, "Deal");
    await page.getByLabel("Deal title *").fill("Big rollout");
    await page.getByLabel("Amount").fill("250000.50");
    await page.getByRole("button", { name: "Create deal" }).click();
    await expect(page.getByText("Deal created").first()).toBeVisible();

    await page.goto("/deals");
    const qualification = page.getByRole("region", { name: /^Qualification/ });
    await expect(qualification.getByRole("link", { name: "Big rollout" })).toBeVisible();
    await expect(qualification.getByText("₹2,50,000.50").first()).toBeVisible();

    await page.getByLabel("Move Big rollout to stage").selectOption({ label: "Proposal" });
    await expect(page.getByRole("region", { name: /^Proposal/ }).getByRole("link", { name: "Big rollout" })).toBeVisible();

    // lost requires a reason
    await page.getByLabel("Move Big rollout to stage").selectOption({ label: "Lost" });
    const confirm = page.getByRole("button", { name: "Mark as lost" });
    await expect(confirm).toBeDisabled();
    await page.getByLabel("Reason").fill("Budget frozen");
    await confirm.click();
    await expect(page.getByRole("region", { name: /^Lost/ }).getByRole("link", { name: "Big rollout" })).toBeVisible();

    // deal page shows reason and the stage history on the timeline
    await page.getByRole("link", { name: "Big rollout" }).click();
    await expect(page.getByText("Lost: Budget frozen")).toBeVisible();
    await expect(page.getByText("Moved from Proposal to Lost")).toBeVisible();
  });

  test("lead: explainable score, convert to contact + deal", async ({ page }) => {
    await registerOwner(page);
    await newMenu(page, "Lead");
    await page.getByLabel("First name *").fill("Priya");
    await page.getByLabel("Email").fill("priya@bigco.test");
    await page.getByLabel("Company", { exact: true }).fill("BigCo");
    await page.getByLabel("Job title").fill("Founder");
    await page.getByLabel("Source").selectOption("Referral");
    await page.getByRole("button", { name: "Create lead" }).click();
    await expect(page.getByText("Lead created").first()).toBeVisible();

    await page.goto("/leads");
    await page.getByRole("button", { name: "Priya" }).click();
    await expect(page.getByText("Why this score")).toBeVisible();
    await expect(page.getByText("Senior decision-maker title")).toBeVisible();
    await page.getByRole("button", { name: "Convert" }).click();
    await page.getByLabel("Also create a deal").check();
    await page.getByRole("button", { name: "Convert lead" }).click();
    await expect(page).toHaveURL(/\/contacts\//);
    await expect(page.getByRole("heading", { name: "Priya" })).toBeVisible();
    await expect(page.getByText("BigCo").first()).toBeVisible();
  });

  test("tasks: create, complete from the list", async ({ page }) => {
    await registerOwner(page);
    const title = uniq("Call");
    await newMenu(page, "Task");
    await page.getByLabel("What needs to be done? *").fill(title);
    await page.getByRole("button", { name: "Today" }).click();
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByText("Task created").first()).toBeVisible();
    await page.goto("/tasks");
    await expect(page.getByText(title)).toBeVisible();
    await page.getByRole("checkbox", { name: new RegExp(`Complete task: ${title}`) }).click();
    await expect(page.getByText(title)).toBeHidden(); // leaves "My open tasks"
    await page.getByRole("tab", { name: "Completed" }).click();
    await expect(page.getByText(title)).toBeVisible();
  });

  test("command palette searches and navigates; theme persists", async ({ page }) => {
    await registerOwner(page);
    await newMenu(page, "Company");
    await page.getByLabel("Company name *").fill("Zenith Labs");
    await page.getByRole("button", { name: "Create company" }).click();
    await expect(page.getByText("Company created").first()).toBeVisible();

    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Search or run a command" }).fill("zenith");
    await page.getByRole("option", { name: /Zenith Labs/ }).click();
    await expect(page.getByRole("heading", { name: "Zenith Labs" })).toBeVisible();

    await page.getByRole("button", { name: "Theme" }).click();
    await page.getByRole("menuitem", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("auth: wrong password is generic; logout ends the session", async ({ page }) => {
    const email = await registerOwner(page);
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/contacts");
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Invalid" })).toHaveText("Invalid email or password");
  });
});
