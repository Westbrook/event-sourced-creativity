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
  if (metrics.documentScrollWidth > metrics.documentWidth + 1) {
    // Diagnose the actual overflowing layout without changing native focus,
    // scroll, styles, or the assertion. A clipped child is not a page owner.
    const overflow = await page.evaluate(() => {
      const describe = element => {
        const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
        return {
          tag: element.tagName, id: element.id, className: element.getAttribute("class"),
          bounds: bounds.toJSON(), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
          display: style.display, visibility: style.visibility, position: style.position,
          overflowX: style.overflowX, overflowY: style.overflowY, contain: style.contain,
          transform: style.transform, width: style.width, minWidth: style.minWidth, maxWidth: style.maxWidth,
          left: style.left, right: style.right, boxSizing: style.boxSizing,
        };
      };
      const width = document.documentElement.clientWidth, candidates = [];
      for (const element of document.querySelectorAll("*")) {
        const item = describe(element);
        if (item.display === "none") continue;
        const pseudos = ["::before", "::after"].flatMap(pseudo => {
          const style = getComputedStyle(element, pseudo);
          return style.display !== "none" && !["none", "normal"].includes(style.content) ? [{
            pseudo, position: style.position, width: style.width, height: style.height,
            left: style.left, right: style.right, top: style.top, bottom: style.bottom,
            transform: style.transform, bounds: "unmeasured generated box",
          }] : [];
        });
        const reasons = [];
        if (item.bounds.width && (item.bounds.left < -1 || item.bounds.right > width + 1)) reasons.push("outside-layout-viewport");
        if (item.scrollWidth > item.clientWidth + 1) reasons.push("own-scroll-overflow");
        if (["absolute", "fixed"].includes(item.position)) reasons.push("out-of-flow");
        if (pseudos.length) reasons.push("generated-box");
        if (!reasons.length) continue;
        const ancestors = [];
        for (let parent = element.parentElement; parent; parent = parent.parentElement) ancestors.push(describe(parent));
        candidates.push({ ...item, reasons, pseudos, ancestors });
      }
      return { root: describe(document.documentElement), body: describe(document.body),
        viewport: { width, scrollX, scrollY }, candidates,
        boundary: "Read-only light-DOM candidates, not proof of which box expands the root; generated-box bounds remain unmeasured." };
    });
    await attachJSON(testInfo, stage + "-horizontal-overflow", { metrics, ...overflow });
  }
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
