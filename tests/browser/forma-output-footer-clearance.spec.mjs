import { test, expect, attachJSON, openForma, browserMetrics, captureViewport } from "./fixtures.mjs";
import { documentPath, rawOutcome, tabTo, waitForExistingDocument } from "./helpers/keyboard-journey.mjs";
import { observeRequirementFooter } from "./helpers/output-footer-observation.mjs";

// This is the single missing copy observation, not a rerun of E9's peer census.
test("French true 200: unchanged requirement explanation is readable beside the Ask launcher", async ({ page, context, geometry }, testInfo) => {
  expect(process.env.FORMA_A11Y_SYNTHETIC_NETWORK).toBe("1");
  expect(testInfo.project.use.baseURL).toBe("http://127.0.0.1:4186");
  expect(geometry).toMatchObject({ zoom: 2, locale: "fr", viewport: null });
  await openForma(page, context, geometry, documentPath, testInfo);
  await waitForExistingDocument(page);
  const owner = page.locator("forma-workspace"), entry = owner.locator(".output-recipe-entry");
  const summary = entry.locator(":scope > summary"), recipe = entry.locator(":scope > form > label > select");
  const goal = entry.locator(":scope > form > label > textarea"), review = entry.locator(':scope > form > button[type="submit"]');
  await tabTo(page, summary, 160); await page.keyboard.press("Enter"); await expect(entry).toHaveAttribute("open", "");
  await recipe.selectOption("executive-deck");
  await entry.getByRole("checkbox", { name: "Diapositives", exact: true }).check();
  await goal.fill(rawOutcome); await tabTo(page, review, 160); await page.keyboard.press("Enter");
  const draft = owner.locator("[data-output-recipe-draft]"), card = draft.locator("forma-output-requirement-card");
  const form = card.locator(":scope > .output-requirement-card > form.output-requirement-form");
  const original = form.locator('textarea[name="originalText"]');
  await expect(original).toHaveValue(rawOutcome); await expect(original).toBeFocused();
  const footer = form.locator(":scope > footer.output-requirement-form-footer");
  const cancel = footer.locator(':scope > .output-requirement-actions > button[type="button"]');
  const save = footer.locator(':scope > .output-requirement-actions > button[type="submit"]');
  await expect(save).toBeDisabled(); await tabTo(page, cancel, 160); await expect(cancel).toBeFocused();
  const identity = await card.evaluate(element => {
    const input = element.newDraft;
    if (!input || element.snapshot || !element.hasOpenDraft) throw new Error("Require actual unsaved recipe owner");
    return { ...input.scope, requirementId: input.requirementId, revision: input.revision };
  });
  expect(identity).toMatchObject({ projectId: "project-atmosphere", documentId: "doc-atmosphere", revision: "synthetic-delivery-r1" });
  expect(await draft.getAttribute("data-output-recipe-draft")).toBe(identity.requirementId);
  const metrics = await browserMetrics(page);
  const binding = { stage: "requirement-cancel-unactivated", origin: "http://127.0.0.1:4186", pathname: documentPath,
    innerWidth: metrics.width, innerHeight: metrics.height, devicePixelRatio: metrics.dpr,
    zoomReceipt: { mechanism: "chrome.tabs.setZoom", factor: 2, receiptId: "browser-zoom-200" },
    identity, saveDisabled: true, askKind: "launcher", expectedFrenchLauncherLabel: "Demander à Forma",
    expectedFrenchText: "Enregistrez cette interprétation. Examinez et confirmez le plan de livraison avant la génération ; l’enregistrement ne lance jamais de génération, n’approuve aucun résultat et n’autorise aucune dépense." };
  const observations = [];
  const capture = async stage => {
    const value = await page.evaluate(observeRequirementFooter, binding);
    observations.push(value); await attachJSON(testInfo, stage, value); await captureViewport(page, testInfo, stage);
    return value;
  };
  let observation = await capture("footer-native-cancel-stage");
  // Retain the first native-focus position, then use ordinary wheel input only
  // if reading requires it. No scrollIntoView, focus injection or CSS change.
  for (let step = 0; step < 6 && !(observation.allParagraphLinesInsideViewport && !observation.anyLineBoxIntersectsAsk && observation.allSampleCentersOwnedByParagraph); step++) {
    const bounds = await footer.boundingBox();
    await page.mouse.move(Math.min(metrics.width - 20, Math.max(20, bounds.x + bounds.width / 2)), metrics.height - 35);
    await page.mouse.wheel(0, -80);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    observation = await capture(`footer-reading-wheel-${step + 1}`);
  }
  await expect(original).toHaveValue(rawOutcome); await expect(save).toBeDisabled(); await expect(cancel).toBeFocused();
  await attachJSON(testInfo, "footer-reading-sequence", { observationCount: observations.length,
    originalStagePreserved: true, noCancelOrSaveActivated: true, paragraphText: observation.paragraph.text,
    limits: "One fresh synthetic French draft, actual browser zoom and native wheel reading. No expanded Assistant, live authorization, generation or full E9 census." });
  expect(observation.allParagraphLinesInsideViewport, "Every explanation line needs a reachable reading position").toBe(true);
  expect(observation.anyLineBoxIntersectsAsk, "Ask launcher must not cover this explanation at its reading position").toBe(false);
  expect(observation.allSampleCentersOwnedByParagraph, "Visible paragraph lines must be in front of shared chrome").toBe(true);
});
