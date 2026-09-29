import { test, expect, attachJSON, openForma, browserMetrics, captureViewport } from "./fixtures.mjs";
import { documentPath, tabTo, waitForExistingDocument } from "./helpers/keyboard-journey.mjs";
import { observeContextReading } from "./helpers/context-return-reading-observation.mjs";

// One current synthetic owner, not proof of the unresolved historical neighbor
// or lower-paragraph identity. Integrate beside the admitted fixtures unchanged.
test("French true 200: Controls return and current Direction paragraph reading", async ({ page, context, geometry }, testInfo) => {
  expect(process.env.FORMA_A11Y_SYNTHETIC_NETWORK).toBe("1");
  expect(testInfo.project.use.baseURL).toBe("http://127.0.0.1:4186");
  expect(geometry).toMatchObject({ zoom: 2, locale: "fr", viewport: null });
  await openForma(page, context, geometry, documentPath, testInfo);
  await waitForExistingDocument(page);
  const host = page.locator("forma-context-block").filter({
    has: page.locator('[id="context-controls-document-block-direction"]'),
  });
  await expect(host).toHaveCount(1);
  const radio = host.getByRole("radio");
  const toggle = host.locator("button.context-controls-toggle");
  const controls = host.locator('[id="context-controls-document-block-direction"]');
  await expect(radio).toHaveCount(1);
  await radio.check(); await expect(radio).toBeChecked();
  await expect(toggle).toHaveCount(1);
  await tabTo(page, toggle, 160); await page.keyboard.press("Enter");
  await expect(controls).toHaveAttribute("role", "region");
  await expect(controls).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(controls).not.toHaveAttribute("role", "region");
  await expect(toggle).toBeFocused();
  // Allow existing placement to paint; no scroll or focus repair.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const metrics = await browserMetrics(page);
  const binding = { stage: "controls-return", origin: "http://127.0.0.1:4186", pathname: documentPath,
    innerWidth: metrics.width, innerHeight: metrics.height, devicePixelRatio: metrics.dpr,
    zoomReceipt: { mechanism: "chrome.tabs.setZoom", factor: 2, receiptId: "browser-zoom-200" } };
  const expectedText = "A quiet interior that feels held between dusk and night.";
  const observations = [];
  const capture = async (name, stage) => {
    const value = await page.evaluate(observeContextReading, { ...binding, stage });
    observations.push(value);
    await attachJSON(testInfo, name, value); await captureViewport(page, testInfo, name);
    return value;
  };
  // Preserve fresh post-Escape metadata before any additional reading wheel.
  let observation = await capture("context-controls-native-return", "controls-return");
  const initialDirectionStatus = observation.metadata.filter(row => row.identity.id === "block-direction");
  expect(initialDirectionStatus).toHaveLength(1);
  expect(initialDirectionStatus[0].fullySampledClear,
    "The current Direction status must be clear immediately after native Controls return, before reading scrolls").toBe(true);
  expect(observation.controls.focused).toBe(true);
  expect(observation.controls.focusVisible).toBe(true);
  await attachJSON(testInfo, "context-return-correspondence-gap", {
    status: "CURRENT_SEED_MEASUREMENTS_ONLY_HISTORICAL_CORRESPONDENCE_UNRESOLVED",
    freshRoute: { selection: "scoped native radio check", open: "Tab to Controls then Enter", close: "Escape on focused Controls region" },
    currentSeed: { projectId: "project-atmosphere", documentId: "doc-atmosphere", blockId: "block-direction",
      type: "direction", handle: "direction/nocturne", text: expectedText },
    originalCorrespondence: observation.originalCorrespondence,
    limits: "The original record proves Controls return, not this exact preceding action. Neighboring metadata and lower-paragraph historical identities remain unresolved. Hidden offscreen metadata is not a failure or clearance claim.",
  });
  const readingInputs = [];
  for (let step = 0; step < 6 && !observation.direction.fullySampledClear; step++) {
    const input = observation.readingInput;
    if (input == null) await attachJSON(testInfo, `context-direction-reading-incomplete-${step + 1}`, {
      status: "INCOMPLETE_READING_INPUT_UNRESOLVED", step: step + 1, observation,
      limits: "No ordinary wheel target is established; current reading and historical correspondence remain incomplete.",
    });
    expect(input != null, "The observer must supply an unambiguous ordinary reading input").toBe(true);
    expect([input.x, input.y, input.deltaY].every(Number.isFinite)).toBe(true);
    expect(input.x).toBeGreaterThanOrEqual(0); expect(input.x).toBeLessThan(metrics.width);
    expect(input.y).toBeGreaterThanOrEqual(0); expect(input.y).toBeLessThan(metrics.height);
    expect(input.deltaY).not.toBe(0);
    const beforeOwners = observation.scrollOwners;
    readingInputs.push(input);
    await page.mouse.move(input.x, input.y); await page.mouse.wheel(0, input.deltaY);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    observation = await capture(`context-direction-reading-wheel-${step + 1}`, "direction-reading");
    const afterOwners = observation.scrollOwners;
    const identity = owner => ({ tag: owner.tag, id: owner.id, classes: owner.classes });
    const sameOwnerSequence = JSON.stringify(beforeOwners.map(identity)) === JSON.stringify(afterOwners.map(identity));
    const changedOwners = sameOwnerSequence ? afterOwners.flatMap((owner, index) => {
      const before = beforeOwners[index];
      return owner.scrollTop === before.scrollTop && owner.scrollLeft === before.scrollLeft ? [] : [{
        index, owner: identity(owner), before: { scrollTop: before.scrollTop, scrollLeft: before.scrollLeft },
        after: { scrollTop: owner.scrollTop, scrollLeft: owner.scrollLeft },
      }];
    }) : [];
    const noProgress = sameOwnerSequence && changedOwners.length === 0 && !observation.direction.fullySampledClear;
    await attachJSON(testInfo, `context-direction-reading-step-${step + 1}`, {
      status: !sameOwnerSequence ? "INCOMPLETE_SCROLL_OWNER_SEQUENCE_CHANGED"
        : noProgress ? "INCOMPLETE_NO_NATIVE_SCROLL_PROGRESS" : "READING_STEP_MEASURED",
      step: step + 1, input, sameOwnerSequence, beforeOwners, afterOwners, changedOwners,
      fullySampledClear: observation.direction.fullySampledClear,
      originalCorrespondence: observation.originalCorrespondence,
    });
    expect(sameOwnerSequence, "Reading must retain the same observed scroll-owner sequence").toBe(true);
    expect(noProgress, "Stop rather than repeat an ineffective native wheel while Direction remains unclear").toBe(false);
  }
  await expect(host).toHaveCount(1); await expect(radio).toBeChecked(); await expect(toggle).toBeFocused();
  await attachJSON(testInfo, "context-direction-reading-sequence", {
    status: "MEASUREMENTS_ONLY_REQUIRES_OWNER_VISUAL_REVIEW", observationCount: observations.length,
    firstReturnSnapshotPreserved: true, readingInputs, originalCorrespondence: observation.originalCorrespondence,
    originalM02Closure: "PENDING_EXACT_HISTORICAL_CORRESPONDENCE",
    limits: "At most six ordinary wheels after current native Controls return; no forced focus, CSS change, Save/Create/Generate/Export, live backend or provider. Full glyph paint, clipping and original-frame correspondence require separate owner review; no whole-E9, physical-touch or AT claim.",
  });
  expect(observation.direction.text).toBe(expectedText);
  expect(observation.controls.focused).toBe(true);
  expect(observation.controls.focusVisible).toBe(true);
  expect(observation.direction.fullySampledClear, "The current seed Direction needs a reachable sampled reading position").toBe(true);
});
