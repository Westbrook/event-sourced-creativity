import { test, expect, attachJSON, openForma, browserMetrics, captureViewport } from "./fixtures.mjs";
import { documentPath, waitForExistingDocument, tabTo, verifyFocus } from "./helpers/keyboard-journey.mjs";
import { controlRow, rowVerdict } from "./helpers/e9-peer-observation.mjs";

// One proposed observation, not the full E9 profile census. Root must integrate
// and qualify this file against a fresh, isolated finite-transport build.
test.use({ geometry: { viewport: { width: 320, height: 800 }, zoom: 1, locale: "en-US" } });

const originalHandle = "direction/nocturne";
const originalContent = "A quiet interior that feels held between dusk and night.";
const rawName = "  Café e\u0301 العربية 日本語 — unsent name  ";
const selected = { focusBlockId: "block-direction", editingBlockId: "block-direction" };
const modeOwner = "forma-workspace forma-studio-mode-nav > .studio-mode-nav";
const paneOwner = "forma-workspace .document-workbench-tasks";
// Reverse order follows native tab order back from the still-open editor.
const readings = [
  { id: "review", owner: paneOwner, selector: ':scope > button[data-workbench-pane="review"]', label: "Assigned review" },
  { id: "creative-results", owner: paneOwner, selector: ':scope > button[data-workbench-pane="result"]', label: "Creative results" },
  { id: "write", owner: paneOwner, selector: ':scope > button[data-workbench-pane="write"]', label: "Write" },
  { id: "change-view", owner: modeOwner, selector: ".studio-view-menu .ui-popover-trigger", label: "Change view · Document" },
];
const focusOptions = {
  overlaySelectors: [".forma-assistant-launcher", ":popover-open", ":modal", ".topbar", ".application-task-navigation"],
  regionSelectors: [], checkVisibleControls: false,
};

// Narrow adaptation of the existing E9 source-custody ledger. Importing the
// full E9 spec would register its census, so this one-case file does not do so.
async function retainSource(owner) {
  return owner.evaluateHandle(element => {
    const store = element.store;
    if (!store?.events?.get || !store?.projection?.get || !store?.content?.get || !store?.head?.get)
      throw new Error("Require the actual component Store for source custody");
    const selection = () => ({ focusBlockId: store.ui.focusBlockId, editingBlockId: store.ui.editingBlockId });
    const read = () => {
      const projection = store.projection.get(), presented = projection.presentedBriefItems;
      if (!(presented instanceof Set) || [...presented].some(value => typeof value !== "string"))
        throw new Error("Require the declared presentedBriefItems Set<string>");
      return { events: JSON.stringify(store.events.get()), eventCount: store.events.get().length,
        optimisticEvents: JSON.stringify(store.optimisticEvents.get()), head: store.head.get(),
        content: JSON.stringify(store.content.get()),
        projection: JSON.stringify({ ...projection, presentedBriefItems: { type: "Set<string>", values: [...presented] } }),
        session: JSON.stringify(store.session.get()), jobs: JSON.stringify(store.documentJobs.get()),
        route: store.route.get(), selectedOutputId: store.ui.selectedOutputId };
    };
    let editor = null, form = null, editorValue = null;
    return { original: read(), initialSelection: selection(),
      retainEditor: () => {
        editor = element.querySelector('forma-context-block article[data-block-id="block-direction"] textarea#block-copy-block-direction');
        form = editor?.closest("form.block-editor");
        if (!(editor instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement) || editor.form !== form)
          throw new Error("Require the actual direction editor and native form");
        editorValue = editor.value;
        return editorValue;
      },
      inspect: () => ({ sameOwner: element.isConnected && element.store === store,
        raw: read(), selection: selection(), editor: editor ? {
          sameOwner: editor.isConnected && form.isConnected && editor.form === form && element.contains(form)
            && element.querySelectorAll("#block-copy-block-direction").length === 1
            && element.querySelector("#block-copy-block-direction") === editor,
          originalValue: editorValue, value: editor.value,
        } : null }),
    };
  });
}

// Diagnostic only until each declared button is reached. An offscreen sibling
// in an intentional horizontal strip is not declared an initial-fit failure.
async function headerState(page, testInfo, stage) {
  const state = await page.evaluate(({ modeOwner, paneOwner }) => {
    const box = element => element.getBoundingClientRect().toJSON();
    const describe = element => element ? { tag: element.tagName, id: element.id,
      className: element.getAttribute("class"), text: element.textContent, rect: box(element) } : null;
    return { active: describe(document.activeElement), scrollX, scrollY,
      owners: [modeOwner, paneOwner].map(selector => {
        const owners = [...document.querySelectorAll(selector)];
        return { selector, count: owners.length, elements: owners.map(element => ({ ...describe(element),
          scrollLeft: element.scrollLeft, scrollTop: element.scrollTop,
          clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
          buttons: [...element.querySelectorAll("button")].map(describe) })) };
      }) };
  }, { modeOwner, paneOwner });
  await attachJSON(testInfo, stage + "-header-state", { ...state,
    limit: "Raw geometry at this stage; no assertion that all strip labels fit simultaneously or were initially readable." });
  return state;
}

test("EN 320: full header labels are reachable after actual Rename Cancel without source changes", async ({ page, context, geometry, baseURL }, testInfo) => {
  expect(process.env.FORMA_A11Y_SYNTHETIC_NETWORK).toBe("1");
  expect(baseURL).toBe("http://127.0.0.1:4186");
  expect(testInfo.project.use.baseURL).toBe(baseURL);
  await openForma(page, context, geometry, documentPath, testInfo);
  await waitForExistingDocument(page);
  const profile = await page.evaluate(() => ({ language: document.documentElement.lang,
    direction: document.documentElement.dir, coarse: matchMedia("(pointer: coarse)").matches,
    hoverNone: matchMedia("(hover: none)").matches, maxTouchPoints: navigator.maxTouchPoints }));
  const metrics = await browserMetrics(page);
  await attachJSON(testInfo, "en320-profile", { profile, metrics });
  expect(profile).toEqual({ language: "en-US", direction: "ltr", coarse: false, hoverNone: false, maxTouchPoints: 0 });
  expect(metrics.width).toBe(320); expect(metrics.height).toBe(800); expect(metrics.dpr).toBe(1);

  const owner = page.locator("forma-workspace");
  const block = owner.locator('forma-context-block:has(article[data-block-id="block-direction"])');
  await expect(owner).toHaveCount(1); await expect(block).toHaveCount(1);
  const radio = block.locator('.context-decision-select > input[type="radio"]');
  const toggle = block.locator(".context-controls-toggle");
  const panel = block.locator(".context-controls-panel");
  const handle = panel.locator('article[data-block-id="block-direction"] .block-heading .handle');
  const beforeURL = page.url(), held = await retainSource(owner);
  const ledger = [], failures = [];
  let editorRetained = false, controlsOpened = false, cancelActivated = false;
  const checkpoint = async (stage, expectedSelection) => {
    const custody = await held.evaluate(state => ({ original: state.original, initialSelection: state.initialSelection, ...state.inspect() }));
    ledger.push({ stage, ...custody, url: page.url() });
    await attachJSON(testInfo, stage + "-source-custody", ledger.at(-1));
    expect(custody.sameOwner).toBe(true);
    expect(custody.original.eventCount).toBeGreaterThan(0); expect(custody.original.head).toBeGreaterThan(0);
    expect(JSON.parse(custody.original.projection)).toMatchObject({ projectId: "project-atmosphere", documentId: "doc-atmosphere", documentTitle: "Atmosphere studies" });
    expect(custody.raw).toEqual(custody.original); expect(page.url()).toBe(beforeURL);
    if (expectedSelection) expect(custody.selection).toEqual(expectedSelection);
    if (editorRetained) expect(custody.editor).toEqual({ sameOwner: true, originalValue: originalContent, value: originalContent });
    return custody;
  };
  const openControlsCustody = async stage => {
    await checkpoint(stage, selected);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(radio).toBeChecked(); await expect(handle).toHaveText(originalHandle);
    await expect(page.locator(paneOwner).locator('[data-workbench-pane="write"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(paneOwner).locator('[data-workbench-pane="result"]')).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(paneOwner).locator('[data-workbench-pane="review"]')).toHaveAttribute("aria-pressed", "false");
    if (cancelActivated) {
      await expect(page.locator("body > dialog.shared-text-dialog:modal")).toHaveCount(0);
      await expect(page.locator(":popover-open")).toHaveCount(0);
    }
  };
  try {
    const initial = await checkpoint("before-native-actions");
    await tabTo(page, radio, 160);
    await verifyFocus(page, radio, testInfo, "decision-select", focusOptions);
    await page.keyboard.press("Space"); await expect(radio).toBeChecked();
    await checkpoint("decision-selected", { focusBlockId: "block-direction", editingBlockId: initial.initialSelection.editingBlockId });
    await tabTo(page, toggle, 160);
    await verifyFocus(page, toggle, testInfo, "controls-invoker", focusOptions);
    await page.keyboard.press("Enter"); await expect(panel).toBeFocused();
    controlsOpened = true;
    expect(await held.evaluate(state => state.retainEditor())).toBe(originalContent); editorRetained = true;
    await openControlsCustody("controls-open");
    // Preserve the retained native approach to Rename; neither action runs.
    const actions = panel.locator("forma-context-intelligence > .context-intelligence-actions > button");
    await expect(actions).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      await expect(actions.nth(index)).toBeEnabled(); await tabTo(page, actions.nth(index), 160);
    }
    await tabTo(page, handle, 160, "Shift+Tab");
    await verifyFocus(page, handle, testInfo, "rename-invoker", focusOptions);
    await page.keyboard.press("Enter");
    const dialog = page.locator("body > dialog.shared-text-dialog:modal");
    const form = dialog.locator(":scope > form.shared-text-dialog-card");
    const input = form.locator(":scope > label > input");
    const cancel = form.locator(':scope > footer > button[type="button"]');
    const save = form.locator(':scope > footer > button[value="confirm"]');
    await expect(dialog).toHaveCount(1); await expect(dialog).toHaveAccessibleName("Rename this creative decision");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(originalHandle);
    await input.fill(rawName); await expect(input).toHaveValue(rawName);
    await page.keyboard.press("Tab"); await expect(cancel).toBeFocused();
    await page.keyboard.press("Tab"); await expect(save).toBeFocused(); await expect(save).toBeEnabled();
    await page.keyboard.press("Shift+Tab"); await expect(cancel).toBeFocused(); await expect(cancel).toBeEnabled();
    await expect(cancel).toHaveAccessibleName("Cancel"); await expect(save).toHaveAccessibleName("Save name");
    await expect(input).toHaveValue(rawName);
    await attachJSON(testInfo, "rename-pre-activation", { originalValue: originalHandle,
      unsentValue: await input.inputValue(), focused: "native Cancel", saveActivated: false });
    await captureViewport(page, testInfo, "rename-pre-activation");
    await page.keyboard.press("Enter"); cancelActivated = true;
    await expect(dialog).toHaveCount(0); await expect(handle).toBeFocused();

    // This is the first post-closure sample, before reading traversal or the
    // helper's layout-settling wait. It is not a zero-latency paint guarantee.
    await headerState(page, testInfo, "actual-cancel-initial");
    await captureViewport(page, testInfo, "actual-cancel-initial");
    await openControlsCustody("actual-cancel-initial");
    await verifyFocus(page, handle, testInfo, "actual-cancel-handle-return", focusOptions);

    for (const reading of readings) {
      const strip = page.locator(reading.owner), target = strip.locator(reading.selector);
      await expect(strip).toHaveCount(1); await expect(target).toHaveCount(1);
      await expect(target).toBeEnabled(); await expect(target).toHaveAccessibleName(reading.label);
      await tabTo(page, target, 160, "Shift+Tab");
      const stage = "reachable-header-" + reading.id;
      const focus = await verifyFocus(page, target, testInfo, stage, focusOptions);
      const observation = await strip.evaluate(controlRow, reading.selector);
      const verdict = rowVerdict(observation, [reading.label], false);
      await attachJSON(testInfo, stage + "-complete-label", { observation, failures: verdict,
        expectedLabel: reading.label, input: { key: "Shift+Tab", maximum: 160, actualPressCount: "not returned by existing tabTo" },
        limit: "One reached text button: Range fragments/ordinary English words inside its body, plus existing focus viewport/clipping/finite paint checks. No simultaneous strip fit, continuous paint or glyph-ink certificate." });
      await headerState(page, testInfo, stage);
      await captureViewport(page, testInfo, stage + "-label");
      await expect(target).toBeFocused();
      await openControlsCustody(stage);
      expect(observation.controls).toHaveLength(1); expect(verdict, stage).toEqual([]);
      expect(observation.controls[0].raw, stage + ": label and focus observations retain the same native body bounds").toEqual(focus.focus.raw);
    }
    // Do not press Escape: Controls-close is a different retained observation.
  } catch (error) { failures.push(error); }
  finally {
    try {
      if (controlsOpened) await openControlsCustody("final-or-failure");
      else await checkpoint("final-or-failure");
    } catch (error) { failures.push(error); }
    try { await attachJSON(testInfo, "source-custody-ledger", { beforeURL, ledger, cancelActivated,
      limit: "Exact JSON source fields and declared projection Set serialization, held actual Store/textarea and route. The only unsent edit is the Rename value, canceled natively; editor content remains original. Private caches, other UI state, providers and production are unobserved." }); }
    catch (error) { failures.push(error); }
    try { await held.dispose(); } catch (error) { failures.push(error); }
  }
  if (failures.length > 1) throw new AggregateError(failures, "Header reading and source custody failures retained");
  if (failures.length) throw failures[0];
});

