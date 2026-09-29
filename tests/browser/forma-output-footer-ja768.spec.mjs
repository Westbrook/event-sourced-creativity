import { test, expect, attachJSON, applyBrowserZoom, browserMetrics, captureViewport } from "./fixtures.mjs";
import { documentPath, rawOutcome, tabTo, waitForExistingDocument } from "./helpers/keyboard-journey.mjs";
import { observeRequirementFooter, openJapaneseBuiltFooter, installCachedFooterFonts, installOwnedTelemetryDiagnostics } from "./helpers/output-footer-observation.mjs";

// Proposed single Japanese residual profile. Existing French spec/config are unchanged.
test("Japanese 768: unchanged requirement explanation is readable beside the Ask launcher", async ({ page, context, geometry }, testInfo) => {
  expect(process.env.FORMA_A11Y_SYNTHETIC_NETWORK).toBe("1");
  expect(testInfo.project.use.baseURL).toBe("http://127.0.0.1:4186");
  expect(geometry).toEqual({ viewport: { width: 768, height: 900 }, zoom: 1, locale: "ja", hasTouch: false });
  const fonts = await installCachedFooterFonts(context, page, testInfo.project.use.baseURL);
  const telemetry = await installOwnedTelemetryDiagnostics(context, page, testInfo.project.use.baseURL);
  const diagnostics = { pageErrorCount: 0, consoleErrorCount: 0, downloadCount: 0, newPageCount: 0, errors: [] };
  const recordError = (kind, value) => { if (diagnostics.errors.length < 20) diagnostics.errors.push({ kind, value: String(value).slice(0, 1500) }); };
  page.on("pageerror", error => { diagnostics.pageErrorCount++; recordError("pageerror", error); });
  page.on("console", message => { if (message.type() === "error") {
    diagnostics.consoleErrorCount++; recordError("console", message.text()); telemetry.recordConsoleError(message);
  } });
  page.on("download", () => { diagnostics.downloadCount++; });
  context.on("page", opened => { if (opened !== page) diagnostics.newPageCount++; });
  let primaryFailed = false, primaryError;
  const finalErrors = [];
  try {
    await openJapaneseBuiltFooter(page, context, geometry, documentPath, testInfo,
      { expect, attachJSON, applyBrowserZoom, browserMetrics });
    await waitForExistingDocument(page);
    const owner = page.locator("forma-workspace"), entry = owner.locator(".output-recipe-entry");
    const summary = entry.locator(":scope > summary"), recipe = entry.locator(":scope > form > label > select");
    const goal = entry.locator(":scope > form > label > textarea"), review = entry.locator(':scope > form > button[type="submit"]');
    await expect(summary).toHaveText("成果物レシピを確認");
    await expect(review).toHaveText("編集可能な要件を確認・生成なし");
    await tabTo(page, summary, 160); await page.keyboard.press("Enter"); await expect(entry).toHaveAttribute("open", "");
    await expect(recipe).toHaveAccessibleName("作業のレシピ");
    await expect(goal).toHaveAccessibleName("何を納品する必要がありますか？");
    await expect(recipe.locator('option[value="executive-deck"]')).toHaveText("経営層向けプレゼンテーション");
    await recipe.selectOption("executive-deck");
    await entry.getByRole("checkbox", { name: "スライド", exact: true }).check();
    await goal.fill(rawOutcome); await tabTo(page, review, 160); await page.keyboard.press("Enter");
    const draft = owner.locator("[data-output-recipe-draft]"), card = draft.locator("forma-output-requirement-card");
    const form = card.locator(":scope > .output-requirement-card > form.output-requirement-form");
    const original = form.locator('textarea[name="originalText"]');
    await expect(original).toHaveValue(rawOutcome); await expect(original).toBeFocused();
    const footer = form.locator(":scope > footer.output-requirement-form-footer");
    const cancel = footer.locator(':scope > .output-requirement-actions > button[type="button"]');
    const save = footer.locator(':scope > .output-requirement-actions > button[type="submit"]');
    await expect(cancel).toHaveText("キャンセル"); await expect(save).toHaveText("要件を保存");
    await expect(save).toBeDisabled(); await tabTo(page, cancel, 160); await expect(cancel).toBeFocused();
    const identity = await card.evaluate(element => {
      const input = element.newDraft;
      if (!input || element.snapshot || !element.hasOpenDraft) throw new Error("Require actual unsaved recipe owner");
      return { ...input.scope, requirementId: input.requirementId, revision: input.revision };
    });
    expect(identity).toMatchObject({ projectId: "project-atmosphere", documentId: "doc-atmosphere", revision: "synthetic-delivery-r1" });
    expect(await draft.getAttribute("data-output-recipe-draft")).toBe(identity.requirementId);
    const metrics = await browserMetrics(page);
    const binding = { locale: "ja", stage: "requirement-cancel-unactivated", origin: "http://127.0.0.1:4186", pathname: documentPath,
      innerWidth: metrics.width, innerHeight: metrics.height, devicePixelRatio: metrics.dpr,
      zoomReceipt: { mechanism: "chrome.tabs.setZoom", factor: 1, receiptId: "browser-zoom-100" },
      identity, saveDisabled: true, askKind: "launcher", expectedJapaneseLauncherLabel: "Forma に質問",
      expectedJapaneseText: "この解釈を保存します。生成前に納品計画を確認して確定してください。保存によって生成の開始、結果の承認、支出の許可が行われることはありません。" };
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
      limits: "One fresh synthetic Japanese draft, registered 768x900/zoom1/DPR1/noncoarse posture and native wheel reading. No expanded Assistant, live authorization, generation or full E9 census." });
    expect(observation.allParagraphLinesInsideViewport, "Every explanation line needs a reachable reading position").toBe(true);
    expect(observation.anyLineBoxIntersectsAsk, "Ask launcher must not cover this explanation at its reading position").toBe(false);
    expect(observation.allSampleCentersOwnedByParagraph, "Visible paragraph lines must be in front of shared chrome").toBe(true);
  } catch (error) {
    primaryFailed = true; primaryError = error;
  } finally {
    const retain = async action => { try { await action(); } catch (error) { if (finalErrors.length < 8) finalErrors.push(error); } };
    await retain(() => attachJSON(testInfo, "ja768-footer-final-diagnostics", { primaryFailed,
      primaryError: primaryFailed ? String(primaryError).slice(0, 2000) : null,
      fonts: fonts.evidence(), telemetry: telemetry.evidence(), diagnostics,
      limits: "No live API/provider/shared-reader fixture. Font cache identity is not Japanese glyph identity. No full focus perimeter or whole journey acceptance." }));
    await retain(() => { const fontEvidence = fonts.evidence();
      expect(fontEvidence.halted).toBe(false);
      expect(fontEvidence.errors).toEqual([]);
      expect(fontEvidence.pendingRequests).toBe(0);
      expect(fontEvidence.counts.blocked).toBe(0); expect(fontEvidence.counts.routeErrors).toBe(0);
      expect(fontEvidence.counts.abortErrors).toBe(0); expect(fontEvidence.counts.capErrors).toBe(0);
      expect(fontEvidence.counts.failed).toBe(0); expect(fontEvidence.counts.lifecycleErrors).toBe(0);
      expect(fontEvidence.counts.recordsDropped).toBe(0); expect(fontEvidence.counts.errorsDropped).toBe(0);
    });
    await retain(() => { expect(diagnostics.pageErrorCount).toBe(0);
      expect(diagnostics.downloadCount).toBe(0); expect(diagnostics.newPageCount).toBe(0); });
    await retain(async () => {
      await expect.poll(() => {
        const { pendingTelemetry, outstandingAbortOperations, pendingNativeAssociations,
          pendingNativeLogErrors, nativeIssues } = telemetry.evidence().counts;
        return { pendingTelemetry, outstandingAbortOperations, pendingNativeAssociations,
          pendingNativeLogErrors, nativeIssues };
      }, { timeout: 2500 }).toEqual({ pendingTelemetry: 0, outstandingAbortOperations: 0,
        pendingNativeAssociations: 0, pendingNativeLogErrors: 0, nativeIssues: 0 });
    });
    await retain(() => telemetry.dispose());
    await retain(() => attachJSON(testInfo, "ja768-owned-telemetry-diagnostics", telemetry.evidence()));
    await retain(() => {
      const evidence = telemetry.evidence(), counts = evidence.counts;
      expect(evidence.halted).toBe(false);
      expect(evidence.native.ready).toBe(true);
      expect(evidence.native.closed).toBe(true);
      expect(evidence.native.ownershipSealed).toBe(true);
      expect(evidence.native.activeRouteTasks).toBe(0);
      expect(evidence.native.issues).toEqual([]);
      expect(evidence.errors).toEqual([]);
      expect(counts.consoleErrors).toBe(diagnostics.consoleErrorCount);
      expect(counts.consoleErrors).toBe(counts.expectedConsoleErrors + counts.unexpectedConsoleErrors
        + counts.ambiguousConsoleErrors + counts.pendingConsole);
      expect(counts.expectedConsoleErrors).toBeLessThanOrEqual(counts.ownedExpectedFailures);
      expect(counts.nativeLogErrors).toBe(counts.expectedNativeLogErrors + counts.pendingNativeLogErrors
        + counts.ambiguousNativeLogErrors + counts.unexpectedNativeLogErrors);
      expect(counts.expectedNativeLogErrors).toBe(counts.expectedConsoleErrors);
      expect(counts.expectedNativeLogErrors).toBe(counts.ownedExpectedFailures);
      expect(counts.requestFailures).toBe(counts.ownedExpectedFailures + counts.pendingFailureClassification
        + counts.unexpectedRequestFailures);
      for (const key of ["unexpectedConsoleErrors", "ambiguousConsoleErrors", "pendingConsole",
        "unexpectedRequestFailures", "pendingFailureClassification", "pendingTelemetry", "outstandingAbortOperations", "abortErrors",
        "pendingNativeAssociations", "pendingNativeLogErrors", "ambiguousNativeLogErrors",
        "unexpectedNativeLogErrors", "nativeIssues", "runtimeConsoleErrors",
        "capErrors", "handlerErrors", "recordsDropped", "errorsDropped"]) {
        expect(counts[key], `Owned telemetry diagnostic ${key}`).toBe(0);
      }
    });
    await retain(() => attachJSON(testInfo, "ja768-footer-final-errors", {
      primaryFailed, errors: finalErrors.map(error => String(error).slice(0, 2000)) }));
  }
  if (primaryFailed) {
    if (finalErrors.length) throw new AggregateError([primaryError, ...finalErrors], "JA footer primary and final evidence failures");
    throw primaryError;
  }
  if (finalErrors.length) throw new AggregateError(finalErrors, "JA footer final evidence failures");
});
