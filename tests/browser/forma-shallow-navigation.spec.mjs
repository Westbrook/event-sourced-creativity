import { test, expect, attachJSON, openForma } from "./fixtures.mjs";
import { documentPath, savedArticles, waitForExistingDocument, verifyFocus, pressTo, tabTo } from "./helpers/keyboard-journey.mjs";

test("Short Document rail retains keyboard expansion and destinations without a floating shortcut dock", async ({ page, context, geometry }, testInfo) => {
  await openForma(page, context, geometry, documentPath, testInfo);
  await waitForExistingDocument(page);
  const shell = page.locator(".application-creative");
  await expect(shell).toHaveAttribute("data-nav-posture", "rail");
  await expect(shell).toHaveAttribute("data-short-height", "true");
  const rail = page.locator("forma-project-rail .project-rail");
  const toggle = rail.locator(".rail-collapse-toggle");
  const originalArticles = await savedArticles(page);
  await expect(rail).toHaveClass(/\bcollapsed\b/);
  await expect(rail.locator(".rail-dock")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await tabTo(page, toggle);
  await verifyFocus(page, toggle, testInfo, "rail-01-expand-invoker", { checkVisibleControls: true });
  await page.keyboard.press("Enter");
  await expect(rail).toHaveClass(/\bexpanded\b/);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(rail.locator(".rail-content")).not.toHaveAttribute("popover");
  const overview = rail.locator(".rail-project-overview");
  const documents = rail.locator(".rail-document-links a[href]");
  const library = rail.locator(".rail-library-links a[href]");
  await expect(overview).toHaveCount(1);
  expect(await documents.count()).toBeGreaterThan(0);
  expect(await library.count()).toBeGreaterThan(0);
  await attachJSON(testInfo, "rail-expanded-destinations", await rail.locator(".rail-content a[href]").evaluateAll(
    elements => elements.map(element => ({ text: element.textContent, href: element.getAttribute("href") }))));
  await tabTo(page, overview, 5);
  await verifyFocus(page, overview, testInfo, "rail-02-overview", { checkVisibleControls: true });
  await pressTo(page, "Escape", toggle, testInfo, "rail-03-collapse-return", { checkVisibleControls: true });
  await expect(rail).toHaveClass(/\bcollapsed\b/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(rail.locator(".rail-dock")).toBeHidden();
  await expect(page).toHaveURL(new URL(documentPath, testInfo.project.use.baseURL).href);
  expect(await savedArticles(page)).toEqual(originalArticles);
});
