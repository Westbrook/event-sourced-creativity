import { test, expect, attachJSON, openForma } from "./fixtures.mjs";
import { verifyFocus, pressTo, tabTo } from "./helpers/keyboard-journey.mjs";
import { measureModalLayout } from "./helpers/modal-layout.mjs";

const path = "/studio/project";
const rawName = "  Native keyboard layout check — unsent  ";
const copy = {
  en: { direction: "ltr", heading: "Create a document", name: "Document name", close: "Close", create: "Create & open", opener: "New document" },
  fr: { direction: "ltr", heading: "Créer un document", name: "Nom du document", close: "Fermer", create: "Créer et ouvrir", opener: "Nouveau document" },
  ar: { direction: "rtl", heading: "إنشاء مستند", name: "اسم المستند", close: "إغلاق", create: "إنشاء وفتح", opener: "مستند جديد" },
};

test("Project contents: an ordinary unsent document dialog reflows and closes through native keys", async ({ page, context, geometry }, testInfo) => {
  const locale = geometry.locale ?? "en-US", expected = copy[locale.split("-")[0]];
  expect(expected, "Only the bounded EN/FR/AR catalog cases are declared here").toBeTruthy();
  await openForma(page, context, geometry, path, testInfo);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator("html")).toHaveAttribute("dir", expected.direction);
  await expect(page.locator("forma-ui-language-picker select:visible")).toHaveValue(locale.split("-")[0]);
  const owner = page.locator("forma-project-contents");
  const opener = owner.locator(".page-header-actions").getByRole("button", { name: expected.opener, exact: true });
  const dialog = owner.locator("dialog.new-document-dialog:not(.document-copy-dialog):modal");
  const name = dialog.getByRole("textbox", { name: expected.name, exact: true });
  const close = dialog.locator(".modal-card > button.modal-close");
  const footerClose = dialog.locator("footer").getByRole("button", { name: expected.close, exact: true });
  const submit = dialog.locator("button[type=submit]");
  const custody = () => owner.locator(".document-library-grid > article.document-card").evaluateAll(elements =>
    elements.map(element => ({ handle: element.querySelector("header small")?.textContent, title: element.querySelector("h3")?.textContent, text: element.textContent })));
  await expect(owner.locator(".document-library-grid > article.document-card").first()).toBeVisible();
  // A visible card can still be awaiting its existing delivery read. Keep the
  // complete custody snapshot, but start after each real controller has rendered.
  for (const card of await owner.locator(".document-library-grid > article.document-card").all()) {
    const delivery = card.locator(":scope > forma-output-requirements");
    await expect(delivery).toHaveCount(1);
    await expect(delivery.locator(':scope > section:not([aria-busy="true"])')).toHaveCount(1);
  }
  const before = await custody(), beforeURL = page.url();
  expect(before.length).toBeGreaterThan(0);
  await attachJSON(testInfo, "project-contents-before", before);
  const layout = async (stage, focusObservation, headingMustBeVisible = false) => {
    const observation = await dialog.evaluate(measureModalLayout, { focusClip: focusObservation.focus.intersection, headingMustBeVisible });
    await attachJSON(testInfo, stage, observation);
    expect(observation.language).toBe(locale);
    expect(observation.direction).toBe(expected.direction);
    expect(observation.dialogDirection).toBe(expected.direction);
    expect(observation.cardDirection).toBe(expected.direction);
    expect(observation.headingText).toBe(expected.heading);
    expect(observation.failures, stage).toEqual([]);
  };
  await tabTo(page, opener);
  await verifyFocus(page, opener, testInfo, "pc-01-opener");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveAttribute("aria-labelledby", "new-document-title");
  await expect(dialog.locator("#new-document-title")).toHaveJSProperty("textContent", expected.heading);
  await expect(close).toHaveAccessibleName(expected.close);
  await expect(submit).toHaveJSProperty("textContent", expected.create);
  await expect(submit).toBeDisabled();
  await expect(name).toHaveValue("");
  const opened = await verifyFocus(page, name, testInfo, "pc-02-name");
  await layout("pc-02-open-layout", opened);
  await name.fill(rawName); // Already genuinely focused; never submit.
  await expect(name).toHaveValue(rawName);
  await expect(submit).toBeEnabled();
  await pressTo(page, "Shift+Tab", close, testInfo, "pc-03-header-close").then(observation => layout("pc-03-heading-clearance", observation, true));
  await pressTo(page, "Tab", name, testInfo, "pc-04-name-return");
  await expect(name).toHaveValue(rawName);
  await pressTo(page, "Tab", footerClose, testInfo, "pc-05-footer-close");
  await pressTo(page, "Tab", submit, testInfo, "pc-06-create-unactivated").then(observation => layout("pc-06-footer-layout", observation));
  await expect(name).toHaveValue(rawName);
  expect(await custody()).toEqual(before);
  await pressTo(page, "Shift+Tab", footerClose, testInfo, "pc-07-footer-return");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await verifyFocus(page, opener, testInfo, "pc-08-close-return");

  // Ordinary Close clears only this unsent name. There is no original write to recover.
  await page.keyboard.press("Enter");
  await verifyFocus(page, name, testInfo, "pc-09-pristine-reopen");
  await expect(name).toHaveValue("");
  await expect(submit).toBeDisabled();
  await name.fill(rawName);
  await pressTo(page, "Escape", opener, testInfo, "pc-10-escape-return");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Enter");
  await verifyFocus(page, name, testInfo, "pc-11-pristine-after-escape");
  await expect(name).toHaveValue("");
  await expect(submit).toBeDisabled();
  await pressTo(page, "Shift+Tab", close, testInfo, "pc-12-icon-close");
  await pressTo(page, "Enter", opener, testInfo, "pc-13-icon-close-return");
  await expect(dialog).toHaveCount(0);
  expect(await custody()).toEqual(before);
  expect(page.url()).toBe(beforeURL);
  await expect(owner.locator(".project-blank-original-recovery")).toHaveCount(0);
  await attachJSON(testInfo, "project-contents-after", { documents: await custody(), url: page.url(),
    recoveryCoverage: "UNOBSERVED: original-operation Check/Open/Discard-name/lifetime states require an actual submitted creation. This journey never submits." });
});
