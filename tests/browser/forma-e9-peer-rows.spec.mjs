import { test, expect, attachJSON, openForma } from "./fixtures.mjs";
import { documentPath, rawOutcome, savedArticles, waitForExistingDocument, tabTo, verifyFocus, pressTo } from "./helpers/keyboard-journey.mjs";
import { controlRow, rowVerdict } from "./helpers/e9-peer-observation.mjs";
import { measureFormaFocusVisibility } from "../helpers/forma-dom-focus-visibility.mjs";

// New observations of existing source-preview routes and retained seed only.
// These registrations are opt-in and do not replace the existing full suite.
const profiles = [
  { name: "EN wide", geometry: { viewport: { width: 1280, height: 900 }, zoom: 1 } },
  { name: "EN 320", geometry: { viewport: { width: 320, height: 800 }, zoom: 1 } },
  { name: "EN shallow", geometry: { viewport: { width: 844, height: 390 }, zoom: 1 } },
  { name: "EN true 200", geometry: { viewport: null, window: { width: 838, height: 884 }, zoom: 2 } },
  { name: "EN coarse 390", geometry: { viewport: { width: 390, height: 844 }, zoom: 1, hasTouch: true } },
  { name: "FR true 200", geometry: { viewport: null, window: { width: 838, height: 884 }, zoom: 2, locale: "fr" } },
  { name: "AR coarse 320", geometry: { viewport: { width: 320, height: 800 }, zoom: 1, locale: "ar", hasTouch: true } },
  { name: "JA 768", geometry: { viewport: { width: 768, height: 900 }, zoom: 1, locale: "ja" } },
];
const slidesNames = { en: "Slides", fr: "Diapositives", ar: "شرائح", ja: "スライド" };
const options = { overlaySelectors: [".forma-assistant-launcher", ":popover-open", ":modal", ".topbar"],
  regionSelectors: [".output-recipe-entry", ".output-requirement-warning", "forma-ui-notice"], checkVisibleControls: true };
const rawName = "  Café e\u0301 العربية 日本語 — unsent name  ";

test.beforeEach(async ({ baseURL }, testInfo) => {
  expect(process.env.FORMA_A11Y_SYNTHETIC_NETWORK, "Existing finite transport is a required E9 premise").toBe("1");
  expect(baseURL).toBe(testInfo.project.use.baseURL);
  expect(testInfo.project.use.baseURL).toBe("http://127.0.0.1:4186");
});


// The full census remains diagnostic at these two explicit task boundaries.
// Every declared peer is still a strict paint obstacle and critical body region.
const taskScopes = {
  projects: {
    owner: "forma-projects .projects-grid > article.project-card.current > footer",
    controls: ":scope > button", count: 3,
    regions: ["forma-projects .projects-grid > article.project-card.current > footer > button"],
  },
  dialog: {
    owner: "body > dialog.shared-text-dialog:modal > form.shared-text-dialog-card",
    controls: ":scope > label > input, :scope > footer > button", count: 3,
    regions: ["body > dialog.shared-text-dialog:modal > form.shared-text-dialog-card > label > input",
      "body > dialog.shared-text-dialog:modal > form.shared-text-dialog-card > footer > button"],
  },
};
async function verifyTaskFocus(page, target, testInfo, stage, kind) {
  const scope = taskScopes[kind];
  if (!scope) throw new Error("Require an explicit E9 task scope");
  await expect(target).toBeFocused();
  const held = await target.evaluateHandle((element, { scope, kind }) => {
    const doc = element.ownerDocument, owner = element.closest(scope.owner);
    if (!owner) throw new Error("Require the actual current E9 task owner");
    const controls = [...owner.querySelectorAll(scope.controls)], card = kind === "projects" ? owner.parentElement : null;
    const dialog = kind === "dialog" ? owner.parentElement : null;
    return { inspect: () => {
      const current = [...owner.querySelectorAll(scope.controls)];
      return { kind, ownerSelector: scope.owner, controlSelector: scope.controls,
        predicates: {
          connectedOwner: owner.isConnected && owner.ownerDocument === doc,
          uniqueCurrentOwner: doc.querySelectorAll(scope.owner).length === 1 && doc.querySelector(scope.owner) === owner,
          sameCurrentTarget: element.isConnected && element.closest(scope.owner) === owner && controls.includes(element),
          nativeFocus: doc.activeElement === element && doc.hasFocus(),
          completeCurrentControls: controls.length === scope.count && current.length === scope.count
            && controls.every((control, index) => control.isConnected && current[index] === control),
          actualProjectsFooter: kind !== "projects" || (card.matches("article.project-card.current")
            && card.querySelector(":scope > footer") === owner
            && card.querySelector(".project-card-title > h2")?.textContent === "Studio launch"
            && controls.every(control => control instanceof HTMLButtonElement && control.parentElement === owner)),
          actualNativeModal: kind !== "dialog" || (dialog instanceof HTMLDialogElement && dialog.parentElement === doc.body
            && dialog.matches(":modal") && dialog.open && owner instanceof HTMLFormElement
            && dialog.querySelector(":scope > form.shared-text-dialog-card") === owner),
          nativeDialogControls: kind !== "dialog" || (controls[0] instanceof HTMLInputElement
            && controls.slice(1).every(control => control instanceof HTMLButtonElement)
            && controls.every(control => control.form === owner && [...owner.elements].includes(control))
            && controls[0].labels.length === 1 && controls[0].labels[0].control === controls[0]
            && controls[0].parentElement === controls[0].labels[0]),
        },
        targetIndex: controls.indexOf(element),
        controls: controls.map(control => ({ tag: control.tagName, type: control.type, id: control.id,
          text: control.textContent, value: control.value, disabled: control.disabled, name: control.getAttribute("aria-label") })),
        limit: "Only these positively owned task controls have asserted peer obstruction coverage. The entire other-control census is retained as raw diagnostics, not asserted clear; background scrolled/inert controls are not qualified.",
      };
    } };
  }, { scope, kind });
  const failures = []; let before;
  const witness = async suffix => {
    const value = await held.evaluate(state => state.inspect());
    await attachJSON(testInfo, stage + "-task-owner-" + suffix, value);
    for (const [key, passed] of Object.entries(value.predicates)) expect(passed, stage + ": " + key).toBe(true);
    return value;
  };
  try {
    before = await witness("before");
    const census = await target.evaluate(measureFormaFocusVisibility, { stage, requireFocusVisible: true, ...options });
    await attachJSON(testInfo, stage + "-full-census-diagnostic", { observation: census,
      limit: "Unchanged full-page observation retained verbatim. Its failures/unassessed/pass are diagnostic only at this explicit task boundary and are not reclassified as a global pass." });
    await verifyFocus(page, target, testInfo, stage, { ...options, checkVisibleControls: false,
      overlaySelectors: [...options.overlaySelectors, ...scope.regions], regionSelectors: [...options.regionSelectors, ...scope.regions] });
  } catch (error) { failures.push(error); }
  try {
    const after = await witness("after");
    if (before) expect(after, stage + ": same held native task owners through strict capture").toEqual(before);
  } catch (error) { failures.push(error); }
  try { await held.dispose(); } catch (error) { failures.push(error); }
  if (failures.length > 1) throw new AggregateError(failures, "E9 scoped native observation and owner custody failed");
  if (failures.length) throw failures[0];
}

async function profileWitness(page, geometry, testInfo) {
  const language = geometry.locale ?? "en-US", direction = language === "ar" ? "rtl" : "ltr";
  await expect(page.locator("html")).toHaveAttribute("lang", language);
  await expect(page.locator("html")).toHaveAttribute("dir", direction);
  const measured = await page.evaluate(() => ({ language: document.documentElement.lang, direction: document.documentElement.dir,
    coarse: matchMedia("(pointer: coarse)").matches, hoverNone: matchMedia("(hover: none)").matches,
    maxTouchPoints: navigator.maxTouchPoints, targetToken: getComputedStyle(document.documentElement).getPropertyValue("--forma-control-min-size").trim() }));
  if (geometry.hasTouch) { expect(measured.coarse).toBe(true); expect(measured.maxTouchPoints).toBeGreaterThan(0); }
  await attachJSON(testInfo, "e9-profile", { ...measured,
    limit: "Existing Chromium locale/zoom/touch-capability fixture. Current selected E9 peers match no coarse48 rule; their retained physical acceptance floor is44. Requirement inline44 is an acceptance requirement, not an existing CSS guarantee. Other owners, physical devices and AT are unobserved." });
}

async function withSourceCustody(owner, page, testInfo, run, expectedSelection = "unchanged") {
  const beforeURL = page.url(), saved = await owner.evaluateHandle(element => {
    const store = element.store;
    if (!store?.events?.get || !store?.projection?.get || !store?.content?.get || !store?.head?.get)
      throw new Error("Require current actual component Store for E9 custody");
    const selection = () => ({ focusBlockId: store.ui.focusBlockId, editingBlockId: store.ui.editingBlockId });
    const read = () => {
      const projection = store.projection.get(), presented = projection.presentedBriefItems;
      if (!(presented instanceof Set) || [...presented].some(value => typeof value !== "string"))
        throw new Error("Require the declared CreativeProjection.presentedBriefItems Set<string>");
      return { events: JSON.stringify(store.events.get()), eventCount: store.events.get().length,
        optimisticEvents: JSON.stringify(store.optimisticEvents.get()), head: store.head.get(),
        content: JSON.stringify(store.content.get()),
        projection: JSON.stringify({ ...projection, presentedBriefItems: { type: "Set<string>", values: [...presented] } }),
        session: JSON.stringify(store.session.get()), jobs: JSON.stringify(store.documentJobs.get()),
        route: store.route.get(), selectedOutputId: store.ui.selectedOutputId };
    };
    return { original: read(), initialSelection: selection(), inspect: () => ({
      sameOwner: element.isConnected && element.store === store, raw: read(), selection: selection() }) };
  });
  const failures = [], initialSelection = await saved.evaluate(state => state.initialSelection);
  const selectionLedger = [{ stage: "before-native-actions", selection: initialSelection }];
  const captureSelection = async stage => {
    const selection = await saved.evaluate(state => state.inspect().selection);
    selectionLedger.push({ stage, selection }); return selection;
  };
  try { await run({ captureSelection, initialSelection }); } catch (error) { failures.push(error); }
  try {
    const custody = await saved.evaluate(state => ({ original: state.original, ...state.inspect() }));
    selectionLedger.push({ stage: "after-native-actions", selection: custody.selection });
    await attachJSON(testInfo, "e9-source-custody", { ...custody, beforeURL, afterURL: page.url(), initialSelection, selectionLedger,
      allowedSelection: expectedSelection === "unchanged" ? { kind: "unchanged", expected: initialSelection }
        : { kind: "native decision selection, Controls open and Escape close", expectedFinal: expectedSelection },
      limit: "Explicit synthetic source fields, current CreativeProjection including its declared presentedBriefItems Set<string>, and focus/edit selection ledger. Private caches, other UI state and non-JSON payload objects are not covered. No authored save or provider action is activated." });
    expect(custody.sameOwner).toBe(true); expect(custody.original.eventCount).toBeGreaterThan(0);
    expect(custody.original.head).toBeGreaterThan(0); expect(custody.raw).toEqual(custody.original);
    expect(JSON.parse(custody.original.projection)).toMatchObject({ projectId: "project-atmosphere", documentId: "doc-atmosphere", documentTitle: "Atmosphere studies" });
    expect(custody.selection).toEqual(expectedSelection === "unchanged" ? initialSelection : expectedSelection);
    expect(page.url()).toBe(beforeURL);
  } catch (error) { failures.push(error); }
  try { await saved.dispose(); } catch (error) { failures.push(error); }
  if (failures.length > 1) throw new AggregateError(failures, "E9 native observation and source custody failed");
  if (failures.length) throw failures[0];
}

async function retainRow(row, selector, count) {
  await expect(row).toHaveCount(1); await expect(row.locator(selector)).toHaveCount(count);
  const raw = await row.locator(selector).evaluateAll(nodes => nodes.map(node => ({ tag: node.tagName,
    text: node.textContent, ariaLabel: node.getAttribute("aria-label"), type: node.type, disabled: node.disabled })));
  expect(raw.every(item => item.tag === "BUTTON" && item.text.trim())).toBe(true);
  return raw;
}
async function observeRow(row, selector, retained, testInfo, stage, observations) {
  const observation = await row.evaluate(controlRow, selector);
  const current = await row.locator(selector).evaluateAll(nodes => nodes.map(node => ({ tag: node.tagName,
    text: node.textContent, ariaLabel: node.getAttribute("aria-label"), type: node.type, disabled: node.disabled })));
  const failures = rowVerdict(observation, retained.map(item => item.text.trim()), true);
  observations.push({ stage, observation, retained, current, failures });
  await attachJSON(testInfo, stage + "-peer-row", observations.at(-1));
}
function assertRows(observations, count) {
  expect(observations).toHaveLength(count);
  for (const entry of observations) {
    expect(entry.current, entry.stage + ": full raw native controls retained").toEqual(entry.retained);
    expect(entry.observation.controls).toHaveLength(entry.retained.length);
    expect(entry.failures, entry.stage).toEqual([]);
  }
}

async function observeRecipeForm(form, testInfo, stage, discardCount, initial = null) {
  const witness = await form.evaluate(element => {
    const card = element.closest("forma-output-requirement-card"), draft = card?.parentElement;
    const host = card?.closest("forma-output-requirements"), current = card?.newDraft;
    const original = element.querySelector(':scope > label.output-requirement-field > textarea[name="originalText"]');
    const name = element.querySelector(':scope > label.output-requirement-field > input[name="packageLabel"]');
    const footer = element.querySelector(":scope > footer.output-requirement-form-footer > .output-requirement-actions");
    const save = footer?.querySelector(':scope > button[type="submit"]'), cancel = footer?.querySelector(':scope > button[type="button"]');
    if (!(element instanceof HTMLFormElement) || !(original instanceof HTMLTextAreaElement)
      || !(name instanceof HTMLInputElement) || !(save instanceof HTMLButtonElement) || !(cancel instanceof HTMLButtonElement)
      || !card || !draft || !host?.store || !current) throw new Error("Require actual current recipe form, native fields/actions and public draft");
    const resource = host.store.outputRequirements.resource(current.scope.documentId), snapshot = resource.snapshot;
    const scope = host.store.captureAuthorizationScope(), fields = [name, original], controls = [name, original, save, cancel];
    const uniqueId = node => Boolean(node.id) && document.querySelectorAll("#" + CSS.escape(node.id)).length === 1;
    const discard = [...element.querySelectorAll(":scope > .output-requirement-warning > .output-requirement-actions > button")];
    return {
      associations: {
        actualCurrentForm: element.isConnected && card.querySelector(":scope > .output-requirement-card > form.output-requirement-form") === element,
        actualCurrentDraft: draft.isConnected && card.parentElement === draft && draft.getAttribute("data-output-recipe-draft") === current.requirementId
          && host.querySelector(":scope > section > [data-output-recipe-draft]") === draft
          && host.querySelector("[data-output-recipe-draft] > forma-output-requirement-card") === card,
        actualFormOwners: controls.every(control => control.form === element && [...element.elements].includes(control)),
        nativeLabels: fields.every(field => field.labels.length === 1 && field.labels[0] === field.parentElement
          && field.labels[0].control === field && field.labels[0].htmlFor === field.id),
        explicitFormAttributes: [name, original, save].every(control => control.getAttribute("form") === element.id)
          && cancel.getAttribute("form") === null,
        uniqueCurrentIds: [element, name, original, save].every(uniqueId),
        unsavedCurrentCard: card.snapshot === null && card.hasOpenDraft === true && card.originalSaveId === "",
        currentResourceRevision: resource.state === "ready" && card.resourceState === "ready" && snapshot !== null
          && current.revision === snapshot.revision && current.scope.projectId === snapshot.projectId
          && current.scope.documentId === snapshot.documentId && typeof current.scope.authorizationScopeKey === "string"
          && current.scope.authorizationScopeKey.length > 0 && current.scope.authorizationScopeKey === scope?.key,
        currentRequirementIdentity: typeof current.requirementId === "string" && current.requirementId.length > 0
          && current.requirementId === current.spec.id && current.canEdit === true,
      },
      raw: { form: { id: element.id, method: element.method, noValidate: element.noValidate },
        controls: controls.map(control => ({ tag: control.tagName, id: control.id, name: control.name, type: control.type,
          formAttribute: control.getAttribute("form"), value: control.value, disabled: control.disabled, label: control.getAttribute("aria-label") })),
        newDraft: JSON.stringify(current), editorState: JSON.stringify(card.editorState),
        resource: snapshot ? { projectId: snapshot.projectId, documentId: snapshot.documentId, revision: snapshot.revision,
          sourceRevision: snapshot.sourceRevision, requirementRevision: snapshot.requirementRevision } : null },
      discardChoices: discard.map(button => ({ tag: button.tagName, type: button.type, text: button.textContent,
        disabled: button.disabled, nativeFormOwner: button.form === element && [...element.elements].includes(button) })),
    };
  });
  await attachJSON(testInfo, stage + "-native-form", witness);
  for (const [key, value] of Object.entries(witness.associations)) expect(value, stage + ": " + key).toBe(true);
  expect(witness.raw.form.noValidate).toBe(true);
  expect(witness.raw.controls.map(control => control.tag)).toEqual(["INPUT", "TEXTAREA", "BUTTON", "BUTTON"]);
  expect(witness.raw.controls[1].value).toBe(rawOutcome);
  expect(witness.raw.controls.map(control => control.disabled)).toEqual([false, false, true, false]);
  expect(JSON.parse(witness.raw.newDraft)).toMatchObject({ originalText: rawOutcome, revision: "synthetic-delivery-r1" });
  expect(witness.raw.resource).toMatchObject({ projectId: "project-atmosphere", documentId: "doc-atmosphere",
    revision: "synthetic-delivery-r1", sourceRevision: "synthetic-source-r1", requirementRevision: "synthetic-requirements-r1" });
  expect(witness.discardChoices).toHaveLength(discardCount);
  for (const choice of witness.discardChoices) {
    expect(choice).toMatchObject({ tag: "BUTTON", type: "button", disabled: false, nativeFormOwner: true });
    expect(choice.text.trim()).toBeTruthy();
  }
  if (initial) expect(witness.raw, stage + ": unchanged current public draft/revision and native control data").toEqual(initial.raw);
  return witness;
}

for (const profile of profiles) test.describe(profile.name, () => {
  test.use({ geometry: profile.geometry });

  test("E9 Projects footer retains full native peer labels and source", async ({ page, context, geometry }, testInfo) => {
    await openForma(page, context, geometry, "/projects", testInfo);
    await profileWitness(page, geometry, testInfo);
    const owner = page.locator("forma-projects"), card = owner.locator(".projects-grid > article.project-card.current");
    await expect(card).toHaveCount(1); await expect(card.locator(".project-card-title > h2")).toHaveJSProperty("textContent", "Studio launch");
    const row = card.locator(":scope > footer"), selector = ":scope > button", buttons = row.locator(selector);
    const retained = await retainRow(row, selector, 3), observations = [];
    await withSourceCustody(owner, page, testInfo, async () => {
      for (let index = 0; index < 3; index += 1) {
        const button = buttons.nth(index), stage = "e9-project-footer-" + index + "-unactivated";
        await expect(button).toBeEnabled(); await tabTo(page, button, 160);
        await verifyTaskFocus(page, button, testInfo, stage, "projects");
        await observeRow(row, selector, retained, testInfo, stage, observations);
      }
      assertRows(observations, 3);
    });
  });

  test("E9 local requirement footer and discard peers preserve unsaved source", async ({ page, context, geometry }, testInfo) => {
    await openForma(page, context, geometry, documentPath, testInfo); await waitForExistingDocument(page);
    await profileWitness(page, geometry, testInfo);
    const owner = page.locator("forma-workspace"), entry = owner.locator(".output-recipe-entry"), summary = entry.locator(":scope > summary");
    const recipe = entry.locator(":scope > form > label > select"), goal = entry.locator(":scope > form > label > textarea");
    const review = entry.locator(':scope > form > button[type="submit"]'), clear = entry.locator(':scope > form > button[type="button"]');
    const beforeArticles = await savedArticles(page), observations = [];
    await withSourceCustody(owner, page, testInfo, async () => {
      await tabTo(page, summary, 160); await verifyFocus(page, summary, testInfo, "e9-recipe-summary", options);
      await page.keyboard.press("Enter"); await expect(entry).toHaveAttribute("open", "");
      await recipe.selectOption("executive-deck");
      const slides = entry.getByRole("checkbox", { name: slidesNames[(geometry.locale ?? "en").split("-")[0]], exact: true });
      await slides.check(); await pressTo(page, "Tab", goal, testInfo, "e9-recipe-goal", options);
      await goal.fill(rawOutcome); await expect(goal).toHaveValue(rawOutcome);
      await pressTo(page, "Tab", review, testInfo, "e9-recipe-review", options); await page.keyboard.press("Enter");
      const draft = owner.locator("[data-output-recipe-draft]"), form = draft.locator("forma-output-requirement-card > .output-requirement-card > form.output-requirement-form");
      const original = form.locator('label.output-requirement-field > textarea[name="originalText"]');
      await verifyFocus(page, original, testInfo, "e9-recipe-original", options); await expect(original).toHaveValue(rawOutcome);
      const originalId = await original.getAttribute("id"), draftId = await draft.getAttribute("data-output-recipe-draft");
      expect(originalId).toBeTruthy(); expect(draftId).toBeTruthy();
      const footer = form.locator(":scope > footer.output-requirement-form-footer > .output-requirement-actions");
      const retained = await retainRow(footer, ":scope > button", 2), save = footer.locator('button[type="submit"]'), cancel = footer.locator('button[type="button"]');
      // The retained pristine recipe has suggested origins and no confirmed
      // interpretation basis. Do not confirm it merely to enable native Save.
      await expect(save).toBeDisabled(); await expect(cancel).toBeEnabled();
      const recipeForm = await observeRecipeForm(form, testInfo, "e9-requirement-initial", 0);
      await attachJSON(testInfo, "e9-requirement-disabled-save", { raw: retained,
        nativeSaveFocus: "UNOBSERVED: actual pristine draft policy disables Save; no interpretation confirmation or persistence is authorized here." });
      await tabTo(page, cancel, 160); await verifyFocus(page, cancel, testInfo, "e9-requirement-cancel-unactivated", options);
      await observeRow(footer, ":scope > button", retained, testInfo, "e9-requirement-footer", observations);
      const discardRow = form.locator(":scope > .output-requirement-warning > .output-requirement-actions");
      await page.keyboard.press("Escape"); await expect(discardRow).toHaveCount(1);
      await observeRecipeForm(form, testInfo, "e9-requirement-discard-open", 2, recipeForm);
      const keep = discardRow.locator(":scope > button").first(), discard = discardRow.locator(":scope > button").last();
      const retainedDiscard = await retainRow(discardRow, ":scope > button", 2);
      await verifyFocus(page, keep, testInfo, "e9-requirement-keep", options);
      await observeRow(discardRow, ":scope > button", retainedDiscard, testInfo, "e9-requirement-keep", observations);
      await pressTo(page, "Tab", discard, testInfo, "e9-requirement-discard", options);
      await observeRow(discardRow, ":scope > button", retainedDiscard, testInfo, "e9-requirement-discard", observations);
      await expect(original).toHaveAttribute("id", originalId); await expect(original).toHaveValue(rawOutcome);
      await expect(draft).toHaveAttribute("data-output-recipe-draft", draftId);
      await observeRecipeForm(form, testInfo, "e9-requirement-before-native-discard", 2, recipeForm);
      await pressTo(page, "Enter", review, testInfo, "e9-requirement-review-return", options);
      await expect(draft).toHaveCount(0); await expect(recipe).toHaveValue("executive-deck");
      await expect(slides).toBeChecked(); await expect(goal).toHaveValue(rawOutcome);
      await pressTo(page, "Tab", clear, testInfo, "e9-recipe-clear", options);
      await pressTo(page, "Enter", summary, testInfo, "e9-recipe-summary-return", options);
      await expect(recipe).toHaveValue(""); await expect(goal).toHaveValue(""); await expect(entry.getByRole("checkbox")).toHaveCount(0);
      expect(await savedArticles(page)).toEqual(beforeArticles);
      await attachJSON(testInfo, "e9-recipe-raw-custody", { rawOutcome, originalId, draftId, beforeArticles, afterArticles: await savedArticles(page) });
      assertRows(observations, 3);
    });
  });

  test("E9 context peers and shared text-dialog footer retain native cancel custody", async ({ page, context, geometry }, testInfo) => {
    await openForma(page, context, geometry, documentPath, testInfo); await waitForExistingDocument(page);
    await profileWitness(page, geometry, testInfo);
    const owner = page.locator("forma-workspace"), block = owner.locator('forma-context-block:has(article[data-block-id="block-direction"])');
    await expect(block).toHaveCount(1);
    const radio = block.locator('.context-decision-select > input[type="radio"]'), toggle = block.locator(".context-controls-toggle");
    const observations = [];
    await withSourceCustody(owner, page, testInfo, async ({ captureSelection, initialSelection }) => {
      await tabTo(page, radio, 160); await verifyFocus(page, radio, testInfo, "e9-context-select", options);
      await page.keyboard.press("Space"); await expect(radio).toBeChecked();
      expect(await captureSelection("native-decision-selected")).toEqual({ focusBlockId: "block-direction", editingBlockId: initialSelection.editingBlockId });
      await tabTo(page, toggle, 160); await verifyFocus(page, toggle, testInfo, "e9-context-controls", options);
      await page.keyboard.press("Enter"); await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const panel = block.locator(".context-controls-panel"), actions = panel.locator("forma-context-intelligence > .context-intelligence-actions");
      await expect(panel).toBeFocused();
      expect(await captureSelection("native-controls-open")).toEqual({ focusBlockId: "block-direction", editingBlockId: "block-direction" });
      const retained = await retainRow(actions, ":scope > button", 2);
      for (let index = 0; index < 2; index += 1) {
        const button = actions.locator(":scope > button").nth(index), stage = "e9-context-action-" + index + "-unactivated";
        await expect(button).toBeEnabled(); await tabTo(page, button, 160);
        await verifyFocus(page, button, testInfo, stage, options);
        await observeRow(actions, ":scope > button", retained, testInfo, stage, observations);
      }
      const handle = panel.locator('article[data-block-id="block-direction"] .block-heading .handle');
      await expect(handle).toHaveText("direction/nocturne"); await tabTo(page, handle, 160, "Shift+Tab");
      await verifyFocus(page, handle, testInfo, "e9-context-rename", options); await page.keyboard.press("Enter");
      const dialog = page.locator("body > dialog.shared-text-dialog:modal"), form = dialog.locator(":scope > form.shared-text-dialog-card");
      const input = form.locator(":scope > label > input"), footer = form.locator(":scope > footer");
      const cancel = footer.locator('button[type="button"]'), save = footer.locator('button[value="confirm"]');
      await expect(dialog).toHaveCount(1); await expect(input).toHaveValue("direction/nocturne");
      await verifyTaskFocus(page, input, testInfo, "e9-shared-dialog-input", "dialog");
      const label = await input.evaluate(node => ({ name: node.labels?.[0]?.querySelector("span")?.textContent,
        associated: node.labels?.length === 1 && node.labels[0].control === node && node.parentElement === node.labels[0],
        ownedForm: node.form === node.closest("form.shared-text-dialog-card"), required: node.required, maxLength: node.maxLength }));
      expect(label).toMatchObject({ associated: true, ownedForm: true, required: true, maxLength: 120 }); expect(label.name?.trim()).toBeTruthy();
      const dialogLabelledBy = await dialog.getAttribute("aria-labelledby"), title = await form.locator(":scope > h2").textContent();
      expect(dialogLabelledBy).toBeTruthy(); await expect(form.locator(":scope > h2")).toHaveAttribute("id", dialogLabelledBy);
      await expect(dialog).toHaveAccessibleName(title);
      const retainedDialog = await retainRow(footer, ":scope > button", 2);
      await input.fill(rawName); await expect(input).toHaveValue(rawName);
      await page.keyboard.press("Tab"); await verifyTaskFocus(page, cancel, testInfo, "e9-shared-dialog-cancel-unactivated", "dialog");
      await observeRow(footer, ":scope > button", retainedDialog, testInfo, "e9-shared-dialog-cancel", observations);
      await page.keyboard.press("Tab"); await verifyTaskFocus(page, save, testInfo, "e9-shared-dialog-save-unactivated", "dialog");
      await observeRow(footer, ":scope > button", retainedDialog, testInfo, "e9-shared-dialog-save", observations);
      await expect(input).toHaveValue(rawName); await expect(save).toBeEnabled();
      await attachJSON(testInfo, "e9-shared-dialog-raw-custody", { label, title, dialogLabelledBy, originalValue: "direction/nocturne", unsentValue: await input.inputValue(), retainedDialog });
      await page.keyboard.press("Shift+Tab"); await verifyTaskFocus(page, cancel, testInfo, "e9-shared-dialog-cancel-return", "dialog");
      await page.keyboard.press("Enter"); await expect(dialog).toHaveCount(0);
      await verifyFocus(page, handle, testInfo, "e9-shared-dialog-native-return", options);
      await expect(handle).toHaveText("direction/nocturne");
      expect(await captureSelection("native-shared-dialog-canceled")).toEqual({ focusBlockId: "block-direction", editingBlockId: "block-direction" });
      await page.keyboard.press("Escape"); await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await verifyFocus(page, toggle, testInfo, "e9-context-native-return", options); await expect(radio).toBeChecked();
      const selection = await captureSelection("native-controls-closed");
      await attachJSON(testInfo, "e9-context-selection", selection);
      expect(selection).toEqual({ focusBlockId: "block-direction", editingBlockId: "" });
      assertRows(observations, 4);
    }, { focusBlockId: "block-direction", editingBlockId: "" });
  });
});
