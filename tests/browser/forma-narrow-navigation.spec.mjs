import { test, expect, attachJSON, openForma } from "./fixtures.mjs";
import { documentPath, rawOutcome, savedArticles, waitForExistingDocument, verifyFocus, pressTo, tabTo } from "./helpers/keyboard-journey.mjs";
import { measureFormaFocusVisibility } from "../helpers/forma-dom-focus-visibility.mjs";

test("Narrow Document keeps tight Assistant focus and hovered keyboard neighbors unobstructed", async ({ page, context, geometry }, testInfo) => {
  await openForma(page, context, geometry, documentPath, testInfo);
  await waitForExistingDocument(page);
  const entry = page.locator(".output-recipe-entry");
  const recipe = entry.getByRole("combobox", { name: "Workflow recipes", exact: true });
  const slides = entry.getByRole("checkbox", { name: "Slides", exact: true });
  const goal = entry.getByRole("textbox", { name: "What needs to be delivered?", exact: true });
  const write = page.locator('.document-workbench-tasks [data-workbench-pane="write"]');
  const result = page.locator('.document-workbench-tasks [data-workbench-pane="result"]');
  const review = page.locator('.document-workbench-tasks [data-workbench-pane="review"]');
  const account = page.getByRole("button", { name: "Account and settings", exact: true });
  const compare = page.locator(".document-actions").getByRole("button", { name: "Compare", exact: true });
  const panel = page.locator("forma-assistant-panel");
  const launcher = panel.locator(".forma-assistant-launcher");
  const originalArticles = await savedArticles(page);
  const options = { regionSelectors: [".output-recipe-entry", ".output-requirement-warning", "forma-ui-notice"], checkVisibleControls: true };
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const custody = async () => ({
    raw: await goal.inputValue(), recipe: await recipe.inputValue(), slides: await slides.isChecked(),
    open: await entry.getAttribute("open"), write: await write.getAttribute("aria-pressed"),
    scroll: await page.locator("#document-context-panel").evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft })),
  });
  const hoverOnce = async () => {
    await settle();
    await expect(panel).toHaveAttribute("data-tight-launcher", "true");
    const box = await launcher.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBe(44);
    expect(box.height).toBe(44);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y);
    expect(await launcher.evaluate(element => element.matches(":hover"))).toBe(true);
    return { box, point };
  };
  const intersects = (box, envelope) => box.x < envelope.right && box.x + box.width > envelope.left
    && box.y < envelope.bottom && box.y + box.height > envelope.top;
  const tabUnderHover = async (destination, hover, maximum = 30) => {
    // Observe each actual native step. An early move at an unrelated control
    // must not masquerade as a correction caused by the eventual target.
    for (let index = 0; index < maximum; index += 1) {
      const before = { box: await launcher.boundingBox(), point: hover.point };
      await page.keyboard.press("Tab");
      await settle();
      const active = page.locator(":focus");
      await expect(active).toHaveCount(1);
      const observation = await active.evaluate(measureFormaFocusVisibility, {
        ...options, stage: `narrow-header-tab-${index + 1}`, requireFocusVisible: true,
      });
      const after = await launcher.boundingBox();
      const priorIntersection = intersects(before.box, observation.focus.envelope);
      await attachJSON(testInfo, `narrow-header-tab-${index + 1}`, { before, after, priorIntersection, observation });
      expect(observation.failures).toEqual([]);
      expect(observation.unassessed).toEqual([]);
      expect(await launcher.evaluate(element => element.matches(":hover"))).toBe(true);
      if (priorIntersection) expect(after).not.toEqual(before.box);
      else expect(after, "A noncolliding intermediate focus must not move the hovered launcher").toEqual(before.box);
      if (await destination.evaluate(element => element.matches(":focus"))) return before;
    }
    throw new Error("Header target was not reached by bounded native Tab traversal");
  };
  const motion = async (name, before, focused, { requireIntersection = true } = {}) => {
    const after = await launcher.boundingBox();
    const envelope = focused.focus.envelope;
    const priorIntersection = intersects(before.box, envelope);
    await attachJSON(testInfo, name, { before, after, focused: focused.focus.element, envelope, priorIntersection });
    if (requireIntersection) expect(priorIntersection, "This journey must actually exercise a newly intersecting focus ring").toBe(true);
    if (priorIntersection) expect(after).not.toEqual(before.box);
    else expect(after, "A noncolliding focus must keep the hovered launcher stationary").toEqual(before.box);
    expect(await launcher.evaluate(element => element.matches(":hover")), "The pointer stays at its original coordinate").toBe(true);
    await settle();
    expect(await launcher.boundingBox(), "A settled tight launcher must not keep moving").toEqual(after);
    await expect(panel).toHaveAttribute("data-tight-launcher", "true");
  };

  await entry.locator("summary").click();
  await recipe.selectOption("executive-deck");
  await slides.check();
  await expect(slides).toBeFocused();
  await pressTo(page, "Tab", goal, testInfo, "narrow-00-native-entry-arrival", options);
  await goal.fill(rawOutcome);
  await expect(goal).toHaveValue(rawOutcome);
  await verifyFocus(page, goal, testInfo, "narrow-01-entry", options);
  await expect(panel).toHaveAttribute("data-tight-launcher", "true");
  const retained = await custody();
  expect(retained).toMatchObject({ raw: rawOutcome, recipe: "executive-deck", slides: true, open: "", write: "true" });

  // Ordinary Account activation establishes a real keyboard return point. No
  // focus assignment or scroll repair is used to reach the shell's last control.
  await account.click();
  await pressTo(page, "Escape", account, testInfo, "narrow-02-account-return", options);
  await tabTo(page, launcher, 20, "Shift+Tab");
  const own = await verifyFocus(page, launcher, testInfo, "narrow-03-launcher-own-focus", options);
  expect(own.focus.outlineExtent).toBe(0);
  expect(own.focus.boxShadow).toBe("none");
  expect(own.focus.raw.width).toBe(44);
  expect(own.focus.raw.height).toBe(44);
  await expect(panel).toHaveAttribute("data-tight-launcher", "true");
  const ownBox = await launcher.boundingBox();
  await settle();
  expect(await launcher.boundingBox()).toEqual(ownBox);
  expect(await custody()).toEqual(retained);

  await account.click();
  await pressTo(page, "Escape", account, testInfo, "narrow-04-header-return", options);
  const headerHover = await hoverOnce();
  const immediatelyBeforeCompare = await tabUnderHover(compare, headerHover);
  const headerFocus = await verifyFocus(page, compare, testInfo, "narrow-05-hovered-header-focus", options);
  await motion("narrow-header-focus-motion", immediatelyBeforeCompare, headerFocus, { requireIntersection: false });
  expect(await custody()).toEqual(retained);

  // Selecting the already-current Write pane does not switch or author data.
  // It gives a native starting point without panning the intervening mode strip.
  await write.click();
  await expect(write).toHaveAttribute("aria-pressed", "true");
  const taskHover = await hoverOnce();
  await pressTo(page, "Tab", result, testInfo, "narrow-06-hovered-results-focus", options);
  expect(await launcher.boundingBox(), "Results focus does not yet intersect the hovered launcher").toEqual(taskHover.box);
  const immediatelyBeforeReview = { box: await launcher.boundingBox(), point: taskHover.point };
  const taskFocus = await pressTo(page, "Tab", review, testInfo, "narrow-07-hovered-review-focus", options);
  await motion("narrow-task-focus-motion", immediatelyBeforeReview, taskFocus, { requireIntersection: false });
  expect(await custody()).toEqual(retained);
  expect(await savedArticles(page)).toEqual(originalArticles);
  await expect(page).toHaveURL(new URL(documentPath, testInfo.project.use.baseURL).href);
  await attachJSON(testInfo, "narrow-retained-custody", await custody());
});
