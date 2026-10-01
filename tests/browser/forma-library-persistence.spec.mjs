import { test as retainedTest, expect, openForma, captureViewport } from "./fixtures.mjs";
import { tabTo } from "./helpers/keyboard-journey.mjs";
import { installLibraryPersistenceNetwork, persistenceProvenance, LIBRARY_BLOCK_ID,
  ORIGINAL_TEXT, EDITED_TEXT, ORIGINAL_WEIGHT, EDITED_WEIGHT, LIBRARY_ROUTE, EDITOR_ROUTE,
} from "./helpers/library-persistence-network.mjs";

// SOURCE ONLY: additive prospective case, not a member of the sealed F44 suite.
// Requires a separately coordinated project; this packet changes no config,
// registration, fixture, helper or input of the retained twenty E11 cases.
// tabTo/native focus plus PNG capture covers reachability and functional state
// only. No strict ring envelope, clipping, overlay clearance or E11 geometry
// acceptance transfers to this separate stateful fixture.
const attach = (testInfo, name, value) => testInfo.attach(name, {
  contentType: "application/json", body: JSON.stringify({ ...value, persistenceFixture: persistenceProvenance }, null, 2),
});
const test = retainedTest.extend({
  persistence: [async ({ context, baseURL }, use, testInfo) => {
    const transport = await installLibraryPersistenceNetwork(context, baseURL, testInfo);
    testInfo.annotations.push({ type: "stateful-synthetic-library", description: persistenceProvenance.effects });
    try { await use(transport.record); }
    finally {
      await attach(testInfo, "library-persistence-network", transport.record);
      await transport.dispose();
      expect(transport.record.forbidden, "The only admitted write is the one exact in-memory Library Save").toEqual([]);
    }
  }, { auto: true }],
});
test.use({ geometry: { viewport: { width: 390, height: 844 }, zoom: 1, hasTouch: true } });

const editorSelector = "forma-library forma-library-block-editor";
const fieldSelector = "form.library-block-form forma-ui-rich-text.block-editor-copy textarea.ui-rich-text-input";
const rangeSelector = "form.library-block-form label.library-weight > input[type=range]";
const query = "library-persistence";

async function sourceState(library) {
  return library.evaluate((element, targetId) => {
    const store = element.store, projection = store.projection.get();
    const targets = projection.libraryBlocks.filter(block => block.id === targetId);
    if (!element.isConnected || element.localName !== "forma-library" || targets.length !== 1)
      throw new Error("Require the one current real Library and exact existing fixture block");
    const target = targets[0];
    return {
      route: store.route.get(), head: store.head.get(), events: store.events.get(), target,
      identity: { id: target.id, projectId: target.projectId, documentId: target.documentId,
        scope: target.scope, type: target.type, handle: target.handle, locked: target.locked },
      stable: {
        session: store.session.get(), content: store.content.get(), jobs: store.documentJobs.get(),
        optimisticEvents: store.optimisticEvents.get(), projectId: projection.projectId,
        documentId: projection.documentId, projectName: projection.projectName,
        unrelatedLibraryBlocks: projection.libraryBlocks.filter(block => block.id !== targetId),
        documentBlocks: projection.blocks, documents: projection.documents,
        collections: projection.collections, membership: projection.membership,
        relations: projection.libraryBlockRelations, outputs: projection.libraryOutputs,
        artifacts: projection.libraryArtifacts,
      },
      ui: Object.fromEntries(["focusBlockId", "editingBlockId", "selectedOutputId", "focusCollectionId", "libraryView", "libraryOutputScope"]
        .map(key => [key, store.ui[key]])),
    };
  }, LIBRARY_BLOCK_ID);
}
async function formState(editor) {
  return editor.evaluate(element => {
    const form = element.querySelector("form.library-block-form");
    const rich = form?.querySelector("forma-ui-rich-text.block-editor-copy");
    const field = rich?.querySelector("textarea.ui-rich-text-input");
    const label = form?.querySelector("label.library-weight"), range = label?.querySelector("input[type=range]");
    const output = label?.querySelector("output"), submit = form?.querySelector("footer > button.primary");
    if (!(form instanceof HTMLFormElement) || !(field instanceof HTMLTextAreaElement)
      || !(label instanceof HTMLLabelElement) || !(range instanceof HTMLInputElement)
      || !(output instanceof HTMLOutputElement) || !(submit instanceof HTMLButtonElement))
      throw new Error("Require the actual Library native form and direct weight controls");
    return { connected: element.isConnected, blockId: element.blockId, text: field.value, richText: rich.value,
      weight: range.value, output: output.value, navigationBlocked: element.navigationBlocked,
      disabled: field.disabled || range.disabled || submit.disabled, readOnly: field.readOnly,
      formAssociation: field.form === form && range.form === form && output.form === form && submit.form === form,
      weightAssociation: Boolean(range.id) && label.control === range && label.htmlFor === range.id
        && range.labels.length === 1 && range.labels[0] === label
        && output.htmlFor.length === 1 && output.htmlFor[0] === range.id,
      submitType: submit.type, submitText: submit.textContent };
  });
}
async function expectForm(editor, text, weight, dirty) {
  await expect(editor).toHaveCount(1);
  await expect(editor.locator(fieldSelector)).toHaveValue(text);
  await expect(editor.locator(rangeSelector)).toHaveValue(String(weight));
  await expect.poll(() => formState(editor)).toMatchObject({ connected: true, blockId: LIBRARY_BLOCK_ID,
    text, richText: text, weight: String(weight), output: Math.round(weight * 100) + "%",
    navigationBlocked: dirty, disabled: false, readOnly: false, formAssociation: true,
    weightAssociation: true, submitType: "submit", submitText: "Save changes" });
}
function expectUnchangedSource(current, initial, route) {
  expect(current.route).toBe(route);
  expect(current.head).toBe(initial.head);
  expect(current.events).toEqual(initial.events);
  expect(current.target).toEqual(initial.target);
  expect(current.stable).toEqual(initial.stable);
  expect(current.ui).toEqual(initial.ui);
}
function expectCommittedSource(current, initial, persistence, route) {
  expect(current.route).toBe(route);
  expect(current.head).toBe(persistence.committedHead);
  expect(current.events).toEqual([...initial.events, ...persistence.committed]);
  expect(current.identity).toEqual(initial.identity);
  expect(current.target.properties).toEqual({ ...initial.target.properties, text: EDITED_TEXT, weight: EDITED_WEIGHT });
  expect(current.stable).toEqual(initial.stable);
  expect(persistence.saveAttempts).toHaveLength(1);
  expect(persistence.committed).toHaveLength(2);
}

// Read existing controls at the existing capture stages. These are local DOM
// and text-fragment layout checks, not a new paint/focus-envelope observer.
// No scrolling, focusing, disclosure activation, or provider action is added.
async function sharedMobileControls(editor) {
  const sample = await editor.evaluate(element => {
    const issues = [];
    const require = (condition, message) => { if (!condition) throw new Error(message); };
    const one = (owner, selector) => {
      const nodes = owner.querySelectorAll(selector);
      require(nodes.length === 1, `Require one current ${selector}`);
      return nodes[0];
    };
    const rect = node => {
      const r = node.getBoundingClientRect();
      const result = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      require(Object.values(result).every(Number.isFinite), "Finite native control geometry");
      return result;
    };
    const contains = (outer, inner) => inner.left >= outer.left && inner.right <= outer.right
      && inner.top >= outer.top && inner.bottom <= outer.bottom;
    const overlaps = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left)
      && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
    const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const text = (node, name, owners) => {
      require(node.isConnected && node.ownerDocument === document, `Current ${name}`);
      const raw = node.textContent ?? "";
      require(raw.length > 0 && raw.length <= 4096, `Bounded full ${name} text`);
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const nodes = [];
      for (let current = walker.nextNode(); current; current = walker.nextNode()) {
        require(nodes.length < 16, `Bounded ${name} text nodes`);
        nodes.push(current);
      }
      const fragments = [];
      for (const current of nodes) {
        require(current.isConnected && node.contains(current), `Current ${name} text node`);
        if (!current.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(current);
        const rows = Array.from(range.getClientRects());
        require(rows.length <= 64 && fragments.length + rows.length <= 64, `Bounded ${name} fragments`);
        const firstFragment = fragments.length;
        for (const r of rows) {
          const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
          require(Object.values(box).every(Number.isFinite), `Finite ${name} text geometry`);
          if (box.width > 0 && box.height > 0) fragments.push(box);
        }
        require(fragments.length > firstFragment, `${name}: nonempty text node ${nodes.indexOf(current)} has no positive local fragment`);
      }
      const box = rect(node), style = getComputedStyle(node);
      if (!fragments.length || style.display === "none" || style.visibility !== "visible" || Number(style.opacity) !== 1)
        issues.push(`${name}: missing visible local text layout`);
      for (const fragment of fragments) if (![box, ...owners].every(owner => contains(owner, fragment)))
        issues.push(`${name}: full text fragment escapes its control or slot`);
      return { raw, box, fragments, viewport: contains(viewport, box) ? "fully-in-viewport"
        : overlaps(viewport, box) ? "partly-in-viewport" : "offscreen", fullPaintAssessed: false };
    };
    require(element.isConnected && element === document.querySelector("forma-library forma-library-block-editor"), "Current Library editor owner");
    const shell = element.closest("forma-shell"), topbar = one(shell, ".app-shell > .topbar");
    const switcher = one(topbar, ":scope > forma-ui-workspace-switcher");
    const nav = one(switcher, ":scope > nav.application-switcher");
    const links = [...nav.querySelectorAll(":scope > a")];
    require(links.length === 2 && links.filter(link => link.getAttribute("aria-current") === "page").length === 1,
      "Keep both actual workspace destinations and one current destination");
    const topbarBox = rect(topbar), navBox = rect(nav);
    const navStyle = getComputedStyle(nav);
    const navClient = { left: navBox.left + parseFloat(navStyle.borderLeftWidth),
      right: navBox.right - parseFloat(navStyle.borderRightWidth),
      top: navBox.top + parseFloat(navStyle.borderTopWidth), bottom: navBox.bottom - parseFloat(navStyle.borderBottomWidth) };
    const destinations = links.map(link => ({ href: link.getAttribute("href"), current: link.getAttribute("aria-current"),
      ...text(link, "Workspace destination", [navClient, topbarBox]) }));
    for (const destination of destinations) if (!destination.href || destination.box.width < 44 || destination.box.height < 44)
      issues.push("Workspace destination: preserve its href and 44px target");
    const groups = [one(topbar, ":scope > .brand"), switcher, one(topbar, ":scope > .top-actions")].map(rect);
    if (groups.some(group => !contains(topbarBox, group)) || groups.some((group, i) => groups.slice(i + 1).some(other => overlaps(group, other))))
      issues.push("Topbar groups overlap or escape the header");
    const section = one(element, ":scope > .library-block-editor");
    const header = one(section, ":scope > .library-block-editor-header");
    const layout = one(section, ":scope > .library-block-editor-layout");
    const browser = one(layout, ":scope > .library-block-browser.collapsed");
    const toggle = one(browser, ":scope > header > button.library-panel-toggle");
    const toggleLabel = one(toggle, ":scope > .library-panel-toggle-label");
    require(toggle.getAttribute("aria-expanded") === "false" && !toggle.disabled, "Keep the enabled collapsed context action");
    const context = text(toggleLabel, "Expand project context", [rect(toggle), rect(browser)]);
    if (context.raw !== toggle.getAttribute("aria-label")) issues.push("Collapsed context must display its complete accessible name");
    const toggleBox = rect(toggle);
    if (toggleBox.width < 44 || toggleBox.height < 44) issues.push("Collapsed context: preserve a 44px target");
    const workbench = one(layout, ":scope > .library-block-workbench");
    const intelligence = one(workbench, ":scope > forma-context-intelligence");
    const actions = one(intelligence, ":scope > .context-intelligence-actions");
    const buttons = [...actions.querySelectorAll(":scope > button")];
    require(buttons.length === 2, "Preserve both existing analysis controls");
    const analysis = buttons.map(button => text(button, "Analysis action", [rect(actions), rect(workbench)]));
    const heading = one(workbench, ":scope > form.library-block-form > fieldset:first-child > #library-block-identity");
    const identity = text(heading, "Block identity", [rect(workbench)]);
    const headerBox = rect(header), actionsBox = rect(actions);
    // Limit unused spacing between these consecutive rows to two root text
    // lines' units. Control and translated text heights remain intrinsic.
    const gapBudget = 2 * parseFloat(getComputedStyle(document.documentElement).fontSize);
    const gaps = { headerToContext: toggleBox.top - headerBox.bottom,
      contextToAnalysis: actionsBox.top - toggleBox.bottom,
      analysisToIdentity: identity.box.top - actionsBox.bottom };
    if (!Number.isFinite(gapBudget) || Object.values(gaps).some(gap => !Number.isFinite(gap) || gap < 0 || gap > gapBudget))
      issues.push("Collapsed context and analysis rows leave an oversized empty gap or overlap");
    return { issues, viewport, dpr: devicePixelRatio, destinations, groups, context, analysis, identity, gaps, gapBudget,
      scope: "Same-stage current owner and full local Range containment; offscreen is explicit. No glyph-paint, overlay, AT, or strict focus-envelope acceptance." };
  });
  expect(sample.issues, JSON.stringify(sample, null, 2)).toEqual([]);
  return sample;
}

test("Library Back and Escape retain an unsaved draft and one Save survives leave and reopen", async ({ page, context, geometry, persistence }, testInfo) => {
  expect(process.env.FORMA_LIBRARY_PERSISTENCE).toBe("1");
  expect(testInfo.project.name).toBe("f-library-persistence");
  expect(testInfo.project.use.baseURL).toBe("http://127.0.0.1:4186");
  const absolute = route => new URL(route, testInfo.project.use.baseURL).href;
  await openForma(page, context, geometry, LIBRARY_ROUTE, testInfo);
  const library = page.locator("forma-library"), editor = page.locator(editorSelector);
  const openBlock = library.locator(`[data-context-controls-id="${LIBRARY_BLOCK_ID}"]`);
  const search = library.locator('form.library-toolbar forma-ui-search input[type="search"]');
  const view = library.locator("form.library-toolbar forma-ui-segmented-control.segmented > .ui-segmented > button");
  await expect(library).toHaveCount(1);
  await expect(openBlock).toHaveCount(1);
  await expect(view).toHaveCount(4);
  await tabTo(page, view.nth(1));
  await page.keyboard.press("Enter");
  await expect(view.nth(1)).toHaveAttribute("aria-pressed", "true");
  await tabTo(page, search);
  await page.keyboard.insertText(query);
  await expect(search).toHaveValue(query);
  const initial = await sourceState(library);
  expect(initial.head).toBe(persistence.initialHead);
  // Both Library routes retain the declared workspace profile, which omits ComparisonOpened.
  expect(initial.events).toEqual(persistence.originalEvents.filter(event => event.type !== "ComparisonOpened"));
  expect(initial.stable.session.user.userId).toBe("e6-network-synthetic-principal");
  expect(initial.identity).toMatchObject({ id: LIBRARY_BLOCK_ID, projectId: "project-atmosphere", scope: "library", type: "direction", locked: false });
  expect(initial.target.properties).toMatchObject({ text: ORIGINAL_TEXT, weight: ORIGINAL_WEIGHT, subtype: "Campaign goal", intent: "include" });
  expect(initial.ui.libraryView).toBe("blocks");
  const originalOwner = await library.elementHandle();
  try {
    await tabTo(page, openBlock);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(absolute(EDITOR_ROUTE));
    await expectForm(editor, ORIGINAL_TEXT, ORIGINAL_WEIGHT, false);
    expectUnchangedSource(await sourceState(library), initial, EDITOR_ROUTE);
    const field = editor.locator(fieldSelector), range = editor.locator(rangeSelector);
    await tabTo(page, field);
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText(EDITED_TEXT);
    await tabTo(page, range);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expectForm(editor, EDITED_TEXT, EDITED_WEIGHT, true);
    expectUnchangedSource(await sourceState(library), initial, EDITOR_ROUTE);
    expect(persistence.saveAttempts).toEqual([]);
    const back = editor.locator(".library-block-editor-header").getByRole("button", { name: "Back to Library", exact: true });
    await tabTo(page, back);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(absolute(LIBRARY_ROUTE));
    await expect(editor).toHaveCount(0);
    await expect(search).toHaveValue(query);
    await expect(view.nth(1)).toHaveAttribute("aria-pressed", "true");
    expect(await originalOwner.evaluate(element => element.isConnected && element === document.querySelector("forma-library"))).toBe(true);
    expectUnchangedSource(await sourceState(library), initial, LIBRARY_ROUTE);
    expect(persistence.saveAttempts).toEqual([]);
    await tabTo(page, openBlock);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(absolute(EDITOR_ROUTE));
    await expectForm(editor, EDITED_TEXT, EDITED_WEIGHT, true);
    expectUnchangedSource(await sourceState(library), initial, EDITOR_ROUTE);
    await attach(testInfo, "library-unsaved-back-reopen", { form: await formState(editor), source: await sourceState(library), saveAttempts: persistence.saveAttempts,
      sharedControls: await sharedMobileControls(editor),
      scope: "Actual Back retains the dirty draft; no Cancel/discard outcome is asserted" });
    await captureViewport(page, testInfo, "library-unsaved-back-reopen");

    // Escape is a separate actual keyboard branch. Start from the currently
    // focused editable field; Back sharing #close is not evidence it ran.
    await tabTo(page, field);
    await expect(field).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(absolute(LIBRARY_ROUTE));
    await expect(editor).toHaveCount(0);
    await expect(search).toHaveValue(query);
    await expect(view.nth(1)).toHaveAttribute("aria-pressed", "true");
    expect(await originalOwner.evaluate(element => element.isConnected && element === document.querySelector("forma-library"))).toBe(true);
    expectUnchangedSource(await sourceState(library), initial, LIBRARY_ROUTE);
    expect(persistence.saveAttempts).toEqual([]);
    await tabTo(page, openBlock);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(absolute(EDITOR_ROUTE));
    await expectForm(editor, EDITED_TEXT, EDITED_WEIGHT, true);
    expectUnchangedSource(await sourceState(library), initial, EDITOR_ROUTE);
    expect(persistence.saveAttempts).toEqual([]);
    await attach(testInfo, "library-unsaved-escape-reopen", { form: await formState(editor), source: await sourceState(library),
      saveAttempts: persistence.saveAttempts,
      scope: "Actual focused-field Escape and native reopen retain the same unsaved draft; no Cancel/discard or full focus-ring/clip/overlay clearance claim" });

    const save = editor.locator("form.library-block-form > footer > button.primary");
    await expect(save).toHaveText("Save changes");
    await tabTo(page, save);
    await expect(save).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => persistence.saveAttempts.length).toBe(1);
    await expect(page.getByText("Reusable block and its connected context were updated.", { exact: true })).toBeVisible();
    await expectForm(editor, EDITED_TEXT, EDITED_WEIGHT, false);
    expectCommittedSource(await sourceState(library), initial, persistence, EDITOR_ROUTE);
    await tabTo(page, back);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(absolute(LIBRARY_ROUTE));
    await expect(search).toHaveValue(query);
    await expect(view.nth(1)).toHaveAttribute("aria-pressed", "true");
    expectCommittedSource(await sourceState(library), initial, persistence, LIBRARY_ROUTE);
    expect((await sourceState(library)).ui).toEqual(initial.ui);
    await tabTo(page, openBlock);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(absolute(EDITOR_ROUTE));
    await expectForm(editor, EDITED_TEXT, EDITED_WEIGHT, false);
    expectCommittedSource(await sourceState(library), initial, persistence, EDITOR_ROUTE);
    await attach(testInfo, "library-saved-spa-reopen", { form: await formState(editor), source: await sourceState(library), saveAttempts: persistence.saveAttempts.length });

    // Return through the real Back control, then reload the admitted Library root.
    // This additionally tests the normal Store reload and its owned GET response,
    // rather than only the retained editor's DOM draft cache. A normal account
    // snapshot may supply prior events; a delta read is valid and is recorded.
    // No refresh of the editor URL or storage/cache mutation is admitted.
    await tabTo(page, back);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(absolute(LIBRARY_ROUTE));
    const readsBeforeReload = persistence.reads.length;
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("forma-shell")).toBeAttached();
    await expect(library).toHaveCount(1);
    await expect(openBlock).toHaveCount(1);
    await expect.poll(() => persistence.reads.slice(readsBeforeReload).some(read => read.profile === "workspace"
      && read.head === persistence.committedHead && read.committedCount === 2)).toBe(true);
    expectCommittedSource(await sourceState(library), initial, persistence, LIBRARY_ROUTE);
    await tabTo(page, openBlock);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(absolute(EDITOR_ROUTE));
    await expectForm(editor, EDITED_TEXT, EDITED_WEIGHT, false);
    expectCommittedSource(await sourceState(library), initial, persistence, EDITOR_ROUTE);
    await attach(testInfo, "library-committed-ram-readback", { form: await formState(editor), source: await sourceState(library),
      sharedControls: await sharedMobileControls(editor),
      freshReads: persistence.reads.slice(readsBeforeReload), saveAttempts: persistence.saveAttempts.length,
      limit: "One synthetic RAM acknowledgement and actual Store reload/fold, including the normal account snapshot and recorded delta GET path; not live database durability or a Cancel/discard test. Retained capture helper metadata describes the unchanged base transport; this persistenceFixture declares the separate opt-in override." });
    await captureViewport(page, testInfo, "library-committed-ram-readback");
    expect(persistence.forbidden).toEqual([]);
    expect(persistence.saveAttempts).toHaveLength(1);
  } finally { await originalOwner?.dispose(); }
});
