import { expect, attachJSON, browserMetrics, captureViewport } from "../fixtures.mjs";
import { measureFormaFocusVisibility } from "../../helpers/forma-dom-focus-visibility.mjs";

export const documentPath = "/document/doc-atmosphere/atmosphere-studies";
export const rawOutcome = "  Prepare a launch review deck from the existing Studio launch decisions.  ";
export const rawSource = "  Reuse the approved Studio launch decisions; preserve the original wording.  ";
export const savedArticles = page => page.locator("forma-workspace article").evaluateAll(
  elements => elements.map(element => ({ id: element.dataset.blockId ?? null, className: element.className, text: element.textContent })));

export async function waitForExistingDocument(page) {
  await expect(page.locator(".output-recipe-entry")).toHaveCount(1);
  await expect(page.locator("#document-context-panel .block-list article[data-block-id]")).toHaveCount(4);
  await expect(page.locator("forma-workspace article")).toHaveCount(5);
}

export async function verifyFocus(page, locator, testInfo, stage, options = {}) {
  let observation;
  try {
    await expect(locator, stage).toBeFocused();
    // Let the application's existing queued placement frame paint; never repair it.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // Wait for actual layout/placement to settle, without repairing focus or scrolling.
    await expect(async () => {
      observation = await locator.evaluate(measureFormaFocusVisibility, { stage, requireFocusVisible: true, ...options });
      expect(observation.failures, stage).toEqual([]);
      expect(observation.unassessed, `${stage}: unsupported geometry is not a pass`).toEqual([]);
    }).toPass({ timeout: 3_000, intervals: [50, 100, 200] });
  } finally {
    if (!observation && await locator.count() === 1) {
      observation = await locator.evaluate(measureFormaFocusVisibility, { stage, requireFocusVisible: true, ...options });
    }
    await attachJSON(testInfo, stage, observation ?? { error: "No focus observation available" });
    await captureViewport(page, testInfo, stage);
  }
  const metrics = await browserMetrics(page);
  expect(metrics.documentScrollWidth, `${stage}: page has horizontal overflow`).toBeLessThanOrEqual(metrics.documentWidth + 1);
  return observation;
}

export async function pressTo(page, key, destination, testInfo, stage, options) {
  await page.keyboard.press(key);
  return verifyFocus(page, destination, testInfo, stage, options);
}

export async function tabTo(page, destination, maximum = 80, key = "Tab") {
  if (!["Tab", "Shift+Tab"].includes(key)) throw new Error("Use native forward or reverse Tab traversal");
  for (let index = 0; index < maximum; index += 1) {
    if (await destination.evaluate(element => element.matches(":focus"))) return;
    await page.keyboard.press(key);
  }
  await expect(destination, `Destination must be reachable through native ${key} traversal`).toBeFocused();
}
