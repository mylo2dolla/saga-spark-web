import { expect, test } from "@playwright/test";

test("landing page renders primary CTAs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your next adventure starts with a single spark." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create your campaign" })).toBeVisible();
  await expect(page.getByRole("link", { name: "I already have an account" })).toBeVisible();
});

test("login route renders authentication controls", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Login" })).toBeVisible();
});

test("signup route renders account creation controls", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await expect(page.getByLabel("Display name")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign up" })).toBeVisible();
});

test("dashboard route renders core campaign actions", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create campaign" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Join campaign" })).toBeVisible();
});
