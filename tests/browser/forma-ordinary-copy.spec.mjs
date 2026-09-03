import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, attachJSON, captureViewport, openForma } from "./fixtures.mjs";
import { verifyFocus, tabTo } from "./helpers/keyboard-journey.mjs";
import { observeInitialSession } from "./helpers/initial-session.mjs";
import { measureOrdinaryCopy } from "./helpers/ordinary-copy-layout.mjs";

const copy = {
  en: { dir: "ltr", ask: "Ask Forma", settings: "Workspaces & collaboration", shared: "Projects shared with you",
    name: "New organization name", create: "Create workspace", library: "Project library",
    file: "Import as document", export: "Export project event archive", close: "Close preview", accept: "Import document copy" },
  fr: { dir: "ltr", ask: "Demander à Forma", settings: "Espaces de travail et collaboration", shared: "Projets partagés avec vous",
    name: "Nom de la nouvelle organisation", create: "Créer un espace de travail", library: "Bibliothèque du projet",
    file: "Importer comme document", export: "Exporter l’archive des événements du projet", close: "Fermer l’aperçu",
    accept: "Importer une copie du document" },
  ar: { dir: "rtl", ask: "اسأل Forma", settings: "مساحات العمل والتعاون", shared: "المشروعات المشتركة معك",
    name: "اسم المؤسسة الجديدة", create: "إنشاء مساحة عمل", library: "مكتبة المشروع",
    file: "استيراد كمستند", export: "تصدير أرشيف أحداث المشروع", close: "إغلاق المعاينة", accept: "استيراد نسخة من المستند" },
};
const settingsNameLabelSelector = 'section[aria-labelledby="workspace-organizations-heading"] > form.workspace-settings-form > label:has(> input[name="name"])';
const settingsSelectors = [
  settingsNameLabelSelector,
  ".page-header-copy > :is(.eyebrow,h1,p)",
  'section[aria-labelledby="workspace-invitations-heading"] > :is(h2,p)',
  'section[aria-labelledby="workspace-organizations-heading"] > :is(h2,p)',
  'section[aria-labelledby="workspace-projects-heading"] > :is(h2,p)',
];
const libraryLifecycleRegions = [
  { kind: "scope", selector: ".library-main > .library-body > section.lifecycle-next-actions > p.lifecycle-next-scope", className: "lifecycle-next-scope", role: null },
  { kind: "status", selector: '.library-main > .library-body > section.lifecycle-next-actions > p.muted[role="status"]', className: "muted", role: "status" },
];
const librarySelectors = [
  ".library-main > .page-header--library > .page-header-copy > :is(.eyebrow,h1,p)",
  ".library-body .section-heading > div > :is(.eyebrow,h2,p.section-note)",
  ...libraryLifecycleRegions.map(region => region.selector),
];
const launcherSelector = ".application-creative > forma-creative-assistant > forma-assistant-panel > button.forma-assistant-launcher";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const checkFocus = async (page, target, testInfo, stage, options = {}) => {
  const observation = await verifyFocus(page, target, testInfo, stage, options);
  expect(observation.focus.raw.width, stage + ": native/label width").toBeGreaterThanOrEqual(44);
  expect(observation.focus.raw.height, stage + ": native/label height").toBeGreaterThanOrEqual(44);
  return observation;
};

// Raw fields, real page copy and article data stay in this browser-owned handle.
// File selection is the one planned Library change; its identity/SHA is checked
// separately. No field is filled, no state is assigned, and no draft is seeded.
const retainCustody = (owner, selectors) => owner.evaluateHandle((element, scopes) => {
  const value = node => JSON.stringify([node.value, node.checked,
    node.tagName === "SELECT" ? [...node.options].map(option => option.selected) : null]);
  const fields = [...element.querySelectorAll("input:not([type=file]),textarea,select")].map(node => ({ node, value: value(node) }));
  const articles = () => [...element.querySelectorAll(".library-content article")]
    .map(node => ({ id: node.getAttribute("data-block-id"), className: node.getAttribute("class"), text: node.textContent }));
  const text = () => [...new Set(scopes.flatMap(selector => [...element.querySelectorAll(selector)]))]
    .map(node => ({ tag: node.tagName, id: node.id, text: node.textContent }));
  const priorArticles = articles(), priorText = text();
  const href = location.href, historyLength = history.length;
  return { inspect: () => ({
    ownerConnected: element.isConnected, sameRoute: location.href === href, sameHistory: history.length === historyLength,
    fieldCount: fields.length, fieldsEqual: fields.every(item => item.node.isConnected && element.contains(item.node) && value(item.node) === item.value),
    articleCount: priorArticles.length, articlesEqual: JSON.stringify(articles()) === JSON.stringify(priorArticles),
    copyCount: priorText.length, copyEqual: JSON.stringify(text()) === JSON.stringify(priorText),
  }) };
}, selectors);
const checkCustody = async (saved, testInfo, stage) => {
  const result = await saved.evaluate(state => state.inspect());
  await attachJSON(testInfo, stage, result);
  expect(result.ownerConnected && result.sameRoute && result.sameHistory && result.fieldsEqual && result.articlesEqual && result.copyEqual, stage).toBe(true);
};
const observeCopy = async (page, owner, focus, expected, testInfo, stage, options, inspectLibraryEyebrows) => {
  const launcher = page.locator(launcherSelector);
  await expect(launcher).toHaveCount(1);
  await expect(launcher).toHaveAccessibleName(expected.ask);
  await expect(launcher).toBeEnabled();
  let nativeFocus, nativeLauncher, primaryError;
  const observations = [];
  try {
    nativeFocus = await focus.elementHandle();
    nativeLauncher = await launcher.elementHandle();
    for (let index = 0; index < 2; index += 1) {
      if (index) await page.waitForTimeout(250); // observation interval, never a focus/scroll repair or retry
      const result = await owner.evaluate(measureOrdinaryCopy, { ...options, focus: nativeFocus, launcher: nativeLauncher });
      observations.push(result);
      if (inspectLibraryEyebrows) await inspectLibraryEyebrows(result, index);
      await attachJSON(testInfo, stage + "-ranges-" + index, result);
      await captureViewport(page, testInfo, stage + "-ranges-" + index);
      if (result.primary?.outsideViewport) testInfo.annotations.push({ type: "Ordinary-copy coverage", description: stage + ": " + result.primary.disposition });
    }
    await checkFocus(page, focus, testInfo, stage + "-native-after", options.focusOptions ?? {});
  } catch (error) { primaryError = error; }
  const cleanupErrors = [];
  for (const handle of [nativeFocus, nativeLauncher]) {
    try { await handle?.dispose(); } catch (error) { cleanupErrors.push(error); }
  }
  const errors = [...(primaryError ? [primaryError] : []), ...cleanupErrors];
  if (errors.length > 1) throw new AggregateError(errors, "Ordinary-copy observation and native handle cleanup failed");
  if (errors.length === 1) throw errors[0];
  return observations;
};
const assertCopyClearance = (observations, expectedHiddenLibraryIssues = []) => {
  for (const [sample, result] of observations.entries()) {
    // Only the Library caller can supply its separately witnessed, retained
    // hidden-eyebrow issues. Exact equality rejects every additional issue.
    expect(result.issues, "Owned, current, visible ordinary-copy prerequisites; exact retained hidden Library policy only")
      .toEqual(expectedHiddenLibraryIssues[sample] ?? []);
    expect(result.observedObstructions, "Opaque Assistant must not intercept measured visible text fragments").toEqual([]);
    expect(result.unassessed, "Unknown clipping/paint is not ordinary-copy clearance").toEqual([]);
    expect(result.rawIntersections, "Any remaining fragment/Assistant overlap needs explicit disposition, not a silent pass").toEqual([]);
  }
  const shape = result => ({ viewport: result.viewport, launcher: result.launcher.raw,
    compact: result.launcher.dataset.compactLauncher ?? null, tight: result.launcher.dataset.tightLauncher ?? null,
    copy: result.copy.map(item => ({ element: item.element, raw: item.raw, fragments: item.fragments.map(fragment => fragment.raw) })) });
  expect(shape(observations[1]), "Two bounded observations must retain the same native layout, without an epsilon").toEqual(shape(observations[0]));
};

test("Ordinary Settings copy stays clear of Ask at the existing native Create focus stage", async ({ page, context, geometry }, testInfo) => {
  const path = "/settings/workspaces", locale = geometry.locale ?? "en-US", expected = copy[locale.split("-")[0]];
  const sessionObserver = observeInitialSession(page, path);
  const actualRead = page.waitForResponse(response => response.request().method() === "GET"
    && new URL(response.url()).origin === new URL(page.url()).origin && new URL(response.url()).pathname === "/api/workspaces");
  let saved, nameLabelOwner, primaryError;
  try {
    expect(expected).toBeTruthy();
    await openForma(page, context, geometry, path, testInfo);
    const response = await actualRead;
    expect(response.ok(), "Existing workspaces read, not fabricated empty data").toBe(true);
    const overview = await response.json(), initial = await sessionObserver.read();
    await attachJSON(testInfo, "copy-settings-authentic-session", initial.evidence);
    expect(["organizations", "projects", "invitations"].every(key => Array.isArray(overview?.[key]))).toBe(true);
    expect(["creator", "admin"].includes(initial.session.user.role), "This exact prior Create-focus path requires the actual permitted account").toBe(true);
    await attachJSON(testInfo, "copy-settings-existing-scope", {
      status: response.status(), organizations: overview.organizations.length, projects: overview.projects.length,
      invitations: overview.invitations.length, premise: "Actual existing landing only; no organization task or new empty data." });
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveAttribute("dir", expected.dir);
    await expect(page.locator("forma-ui-language-picker select:visible")).toHaveValue(locale.split("-")[0]);
    const owner = page.locator("forma-workspace-settings");
    await expect(owner).toHaveCount(1);
    await expect(owner.locator("#workspace-settings-heading")).toHaveText(expected.settings);
    await expect(owner.locator("#workspace-projects-heading")).toHaveText(expected.shared);
    await expect(owner.locator(".workspace-settings-error")).toHaveCount(0);
    const form = owner.locator('section[aria-labelledby="workspace-organizations-heading"] > form.workspace-settings-form');
    const name = form.locator('input[name="name"]'), create = form.locator('button[type="submit"]');
    await expect(form).toHaveCount(1);
    await expect(name).toHaveAccessibleName(expected.name);
    await expect(create).toHaveAccessibleName(expected.create);
    await expect(create).toBeEnabled();
    const nameLabel = owner.locator(settingsNameLabelSelector);
    await expect(nameLabel).toHaveCount(1);
    await expect(nameLabel).toHaveJSProperty("textContent", expected.name);
    nameLabelOwner = await name.evaluateHandle(input => ({ input, label: input.parentElement, form: input.form }));
    const readNameLabel = () => nameLabelOwner.evaluate(({ input, label, form }, selector) => {
      const doc = input.ownerDocument, win = doc.defaultView, selected = [...doc.querySelectorAll("forma-workspace-settings " + selector)];
      return { current: input.isConnected && label?.isConnected && form?.isConnected
          && label instanceof win.HTMLLabelElement && input instanceof win.HTMLInputElement
          && input.name === "name" && input.parentElement === label && label.parentElement === form
          && input.form === form && label.control === input && input.labels.length === 1 && input.labels[0] === label
          && label.querySelectorAll("input,button,select,textarea,output,meter,progress").length === 1
          && selected.length === 1 && selected[0] === label,
        raw: { text: label?.textContent ?? null, labelTag: label?.tagName ?? null, labelFor: label?.getAttribute("for") ?? null,
          inputId: input.id, inputName: input.name, inputType: input.type, inputValue: input.value,
          inputDisabled: input.disabled, inputRequired: input.required },
      };
    }, settingsNameLabelSelector);
    const initialNameLabel = await readNameLabel();
    await attachJSON(testInfo, "copy-settings-name-label-before", initialNameLabel);
    saved = await retainCustody(owner, settingsSelectors);
    await tabTo(page, name);
    await checkFocus(page, name, testInfo, "copy-settings-01-name", { checkVisibleControls: true });
    // Native Tab may still be smoothly scrolling after focus first becomes clear.
    // Observe only actual ancestor scroll positions/events, never copy geometry.
    const createScroll = await create.evaluateHandle(element => {
      const doc = element.ownerDocument, win = doc.defaultView, ancestors = [];
      for (let parent = element.parentElement; parent; parent = parent.parentElement) ancestors.push(parent);
      const targets = [...new Set([doc.scrollingElement, ...ancestors].filter(Boolean))];
      const positions = () => targets.map(node => ({ tag: node.tagName, id: node.id, left: node.scrollLeft, top: node.scrollTop }));
      const initial = positions(), pending = new Set();
      let scrollEvents = 0, scrollEnds = 0, frame = 0, timer;
      const onScroll = event => {
        const target = event.target === doc ? doc.scrollingElement : event.target;
        if (!targets.includes(target)) return;
        if (event.type === "scroll") { pending.add(target); scrollEvents += 1; }
        else { pending.delete(target); scrollEnds += 1; }
      };
      doc.addEventListener("scroll", onScroll, true);
      doc.addEventListener("scrollend", onScroll, true);
      return {
        wait: () => new Promise(resolve => {
          const started = win.performance.now();
          let previous = JSON.stringify(positions()), unchangedFrames = 0;
          const finish = completed => {
            win.cancelAnimationFrame(frame); win.clearTimeout(timer);
            resolve({ completed, elapsedMs: win.performance.now() - started, initial, final: positions(),
              scrollEvents, scrollEnds, pendingTargets: pending.size, unchangedFrames,
              sameFocusedControl: element.isConnected && doc.activeElement === element });
          };
          const sample = () => {
            const current = JSON.stringify(positions());
            unchangedFrames = current === previous && pending.size === 0 ? unchangedFrames + 1 : 0;
            previous = current;
            if (unchangedFrames >= 2) finish(true);
            else frame = win.requestAnimationFrame(sample);
          };
          timer = win.setTimeout(() => finish(false), 2000); // Failure bound, never a blind settling delay.
          frame = win.requestAnimationFrame(sample);
        }),
        dispose: () => {
          win.cancelAnimationFrame(frame); win.clearTimeout(timer);
          doc.removeEventListener("scroll", onScroll, true);
          doc.removeEventListener("scrollend", onScroll, true);
        },
      };
    });
    let scrollError;
    try {
      await page.keyboard.press("Tab");
      await checkFocus(page, create, testInfo, "copy-settings-02-create-unactivated", { checkVisibleControls: true });
      const readiness = await createScroll.evaluate(state => state.wait());
      await attachJSON(testInfo, "copy-settings-02-native-scroll-completion", readiness);
      expect(readiness.completed && readiness.sameFocusedControl,
        "Native ancestor scroll must finish with Create still focused before the two fixed copy samples").toBe(true);
    } catch (error) { scrollError = error; }
    const scrollCleanupErrors = [];
    try { await createScroll.evaluate(state => state.dispose()); } catch (error) { scrollCleanupErrors.push(error); }
    try { await createScroll.dispose(); } catch (error) { scrollCleanupErrors.push(error); }
    const scrollErrors = [...(scrollError ? [scrollError] : []), ...scrollCleanupErrors];
    if (scrollErrors.length > 1) throw new AggregateError(scrollErrors, "Native scroll readiness and observation cleanup failed");
    if (scrollErrors.length === 1) throw scrollErrors[0];
    const observations = await observeCopy(page, owner, create, expected, testInfo, "copy-settings-02", {
      ownerSelector: "forma-workspace-settings", selectors: settingsSelectors, primarySelector: "#workspace-projects-heading",
      focusOptions: { checkVisibleControls: true }, allowPrimaryOffscreen: testInfo.project.name === "shallow" });
    const afterSamplesNameLabel = await readNameLabel();
    await attachJSON(testInfo, "copy-settings-name-label-after-samples", afterSamplesNameLabel);
    // Preserve the original raw/native return path BEFORE the new copy verdict.
    await page.keyboard.press("Shift+Tab");
    await checkFocus(page, name, testInfo, "copy-settings-03-name-return", { checkVisibleControls: true });
    await checkCustody(saved, testInfo, "copy-settings-custody");
    const afterReturnNameLabel = await readNameLabel();
    await attachJSON(testInfo, "copy-settings-name-label-custody", {
      initial: initialNameLabel, afterSamples: afterSamplesNameLabel, afterReturn: afterReturnNameLabel });
    for (const state of [initialNameLabel, afterSamplesNameLabel, afterReturnNameLabel]) {
      expect(state.current, "The same actual implicit LABEL owns the retained native organization-name input").toBe(true);
      expect(state.raw).toEqual(initialNameLabel.raw);
      expect(state.raw.text).toBe(expected.name);
    }
    const nameLabelCoverage = observations.map((result, sample) => {
      const items = result.copy.filter(item => item.element.tag === "LABEL");
      expect(items, "Exactly the current organization-name label joins the existing selected copy").toHaveLength(1);
      expect(items[0].text).toBe(expected.name);
      const visibleFragments = items[0].fragments.filter(fragment => fragment.hasVisibleLayout).length;
      return { sample, copyIndex: items[0].index, fullRawText: initialNameLabel.raw.text,
        fragmentCount: items[0].fragments.length, visibleFragments,
        disposition: visibleFragments ? "VISIBLE LABEL FRAGMENTS COLLECTED: subject to unchanged strict ordinary-copy clearance"
          : "UNOBSERVED: no visible label fragment at this native Create focus; no label-clearance claim" };
    });
    await attachJSON(testInfo, "copy-settings-name-label-coverage", nameLabelCoverage);
    for (const item of nameLabelCoverage) testInfo.annotations.push({ type: "Settings name-label coverage", description: item.disposition });
    assertCopyClearance(observations);
  } catch (error) { primaryError = error; }
  const cleanupErrors = [];
  for (const dispose of [() => nameLabelOwner?.dispose(), () => saved?.dispose(), () => sessionObserver.dispose()]) {
    try { await dispose(); } catch (error) { cleanupErrors.push(error); }
  }
  const errors = [...(primaryError ? [primaryError] : []), ...cleanupErrors];
  if (errors.length > 1) throw new AggregateError(errors, "Settings copy observation and custody cleanup failed");
  if (errors.length === 1) throw errors[0];
});

test("Ordinary Library copy stays clear of Ask after genuine preview Close and native Export focus", async ({ page, context, geometry }, testInfo) => {
  const path = "/library?document=doc-atmosphere", locale = geometry.locale ?? "en-US", expected = copy[locale.split("-")[0]];
  const suppliedPath = process.env.FORMA_A11Y_IMPORT_ARCHIVE, expectedHash = process.env.FORMA_A11Y_IMPORT_ARCHIVE_SHA256;
  expect(typeof suppliedPath === "string" && isAbsolute(suppliedPath), "Reuse the authorized retained archive outside checkout").toBe(true);
  expect(expectedHash, "Use its independently retained SHA; never export to prepare this test").toMatch(/^[a-f0-9]{64}$/);
  const archivePath = await realpath(suppliedPath), checkout = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  const relation = relative(checkout, archivePath);
  expect(relation.startsWith(".." + sep) || isAbsolute(relation)).toBe(true);
  const bytes = await readFile(archivePath);
  expect(sha256(bytes)).toBe(expectedHash);
  const archive = JSON.parse(bytes.toString("utf8"));
  expect(archive).toMatchObject({ format: "forma-event-archive", version: 1 });
  expect(Array.isArray(archive.events) && archive.events.length > 0 && Array.isArray(archive.mediaManifest)).toBe(true);
  await attachJSON(testInfo, "copy-library-retained-archive", { sha256: expectedHash, bytes: bytes.length,
    eventCount: archive.events.length, mediaCount: archive.mediaManifest.length, premise: "Same authorized archive; local parse only. No Export or Import activation." });
  const sessionObserver = observeInitialSession(page, path);
  let saved, originalInput, hiddenEyebrows, primaryError;
  try {
    expect(expected).toBeTruthy();
    await openForma(page, context, geometry, path, testInfo);
    const initial = await sessionObserver.read();
    await attachJSON(testInfo, "copy-library-authentic-session", initial.evidence);
    expect(initial.session.projectContext == null && initial.session.capabilities?.includes("project.author"),
      "Use the actual existing personal author archive path; do not change actor or project scope").toBe(true);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveAttribute("dir", expected.dir);
    await expect(page.locator("forma-ui-language-picker select:visible")).toHaveValue(locale.split("-")[0]);
    const owner = page.locator("forma-library");
    await expect(owner).toHaveCount(1);
    await expect(owner.locator(".library-content .asset-card").first()).toBeVisible();
    await expect(owner.locator(".page-header-copy > h1")).toHaveText(expected.library);
    const file = owner.locator(".page-header-actions .file-button > input[type=file]");
    const exportButton = owner.locator(".page-header--library > .page-header-actions > button.secondary");
    await expect(file).toHaveCount(1); await expect(file).toHaveAccessibleName(expected.file);
    await expect(exportButton).toHaveCount(1); await expect(exportButton).toHaveAccessibleName(expected.export);
    await expect(exportButton).toBeEnabled();
    const lifecyclePresence = await owner.evaluate((element, regions) => ({
      sections: element.querySelectorAll(".library-main > .library-body > section.lifecycle-next-actions").length,
      ...Object.fromEntries(regions.map(region => [region.kind, element.querySelectorAll(region.selector).length])),
    }), libraryLifecycleRegions);
    await attachJSON(testInfo, "copy-library-lifecycle-presence", lifecyclePresence);
    expect(lifecyclePresence.sections, "Only the actual current document's lifecycle section").toBeLessThanOrEqual(1);
    expect(lifecyclePresence.scope, "Every rendered lifecycle section has its direct scope paragraph").toBe(lifecyclePresence.sections);
    expect(lifecyclePresence.status, "Delivery uncertainty is conditional, never manufactured").toBeLessThanOrEqual(lifecyclePresence.sections);
    saved = await retainCustody(owner, librarySelectors);
    hiddenEyebrows = await owner.evaluateHandle((element, selectors) => {
      const doc = element.ownerDocument, win = doc.defaultView;
      const headerSelector = ".library-main > .page-header--library > .page-header-copy > span.eyebrow";
      const sectionSelector = ".library-main > .library-body > .library-content > section > .section-heading > div > span.eyebrow";
      const selected = () => [...new Set(selectors.flatMap(selector => [...element.querySelectorAll(selector)]))];
      const candidates = () => [...element.querySelectorAll(headerSelector), ...element.querySelectorAll(sectionSelector)];
      const originalNodes = candidates(), originalSelected = selected();
      const originalRaw = originalSelected.map(node => node.textContent);
      const describe = node => ({ tag: node.tagName, id: node.id || null, className: node.getAttribute("class"), role: node.getAttribute("role") });
      const style = node => {
        const s = win.getComputedStyle(node);
        return { display: s.display, visibility: s.visibility, opacity: s.opacity, color: s.color,
          clip: s.clip, clipPath: s.clipPath, maskImage: s.maskImage,
          overflowX: s.overflowX, overflowY: s.overflowY, textOverflow: s.textOverflow,
          hidden: node.matches("[hidden],[inert],[aria-hidden='true']") };
      };
      return { inspect: () => {
        const nodes = candidates(), all = selected(), witnesses = [], unreadableStylesheets = [];
        const policies = [".page-header--library .eyebrow, .page-header--document .eyebrow", ".section-heading .eyebrow"];
        for (const sheet of doc.styleSheets) {
          const viteSource = sheet.ownerNode?.getAttribute("data-vite-dev-id") ?? null;
          const href = sheet.href ? new URL(sheet.href, doc.location.href) : null;
          const source = sheet.href ?? viteSource ?? "inline stylesheet";
          const designSystemOwner = sheet.ownerNode instanceof win.HTMLStyleElement && !href
            && Boolean(viteSource?.endsWith("/src/design-system.css"))
            || sheet.ownerNode instanceof win.HTMLLinkElement && href?.origin === doc.location.origin
              && href.pathname === "/src/design-system.css" && !href.search && !href.hash;
          try {
            // Both retained DS declarations are top-level, unconditional rules.
            for (const rule of sheet.cssRules) {
              if (rule.type !== win.CSSRule.STYLE_RULE) continue;
              const selector = rule.selectorText.split(",").map(value => value.trim()).join(", ");
              if (policies.includes(selector) && rule.style.length === 1
                && rule.style.getPropertyValue("display") === "none" && rule.style.getPropertyPriority("display") === "")
                witnesses.push({ source, designSystemOwner, selector, declaration: rule.style.cssText });
            }
          } catch { unreadableStylesheets.push(source); }
        }
        return { currentOwner: element.isConnected && element.matches("forma-library")
            && doc.querySelectorAll("forma-library").length === 1 && doc.querySelector("forma-library") === element,
          counts: { header: element.querySelectorAll(headerSelector).length, sections: element.querySelectorAll(sectionSelector).length },
          originalRaw, selectedRaw: all.map(node => node.textContent),
          sameSelectedNodes: all.length === originalSelected.length && all.every((node, index) => node === originalSelected[index]),
          witnesses, unreadableStylesheets,
          items: nodes.map((node, index) => {
            const s = style(node), selector = index === 0 ? headerSelector : sectionSelector;
            const policy = policies[index === 0 ? 0 : 1], ancestors = [];
            for (let parent = node.parentElement; parent; parent = parent.parentElement) ancestors.push({ element: describe(parent), ...style(parent) });
            const box = node.getBoundingClientRect().toJSON();
            const exactPolicy = node.tagName === "SPAN" && node.getAttribute("class") === "eyebrow"
              && node.matches(selector) && originalNodes[index] === node && node.isConnected && element.contains(node)
              && node.textContent.trim().length > 0 && s.display === "none" && s.visibility === "visible" && Number(s.opacity) === 1
              && !s.hidden && s.color !== "transparent" && !/^rgba\([^,]+,[^,]+,[^,]+,\s*0(?:\.0+)?\)$/.test(s.color)
              && s.clip === "auto" && s.clipPath === "none" && s.maskImage === "none"
              && s.overflowX === "visible" && s.overflowY === "visible" && s.textOverflow !== "ellipsis"
              && node.getClientRects().length === 0 && box.width === 0 && box.height === 0
              && witnesses.filter(witness => witness.selector === policy).length === 1
              && witnesses.find(witness => witness.selector === policy)?.designSystemOwner === true
              && ancestors.every(parent => parent.display !== "none" && parent.visibility === "visible"
                && Number(parent.opacity) === 1 && !parent.hidden);
            return { index, copyIndex: all.indexOf(node), element: describe(node), rawText: node.textContent,
              originalText: originalNodes[index]?.textContent ?? null, selector, policy, style: s, box, ancestors,
              sameNode: originalNodes[index] === node, exactPolicy,
              disposition: exactPolicy ? "UNOBSERVED: exact retained Library eyebrow display:none policy; hidden text is not certified clear"
                : "NO EXCEPTION: unexpected owner/style/policy must retain the strict collector issue" };
          }) };
      } };
    }, librarySelectors);
    const initialEyebrows = await hiddenEyebrows.evaluate(state => state.inspect());
    await attachJSON(testInfo, "copy-library-hidden-eyebrows-before", initialEyebrows);
    originalInput = await file.elementHandle();
    await tabTo(page, file);
    await checkFocus(page, file, testInfo, "copy-library-01-input", { nativeFileLabel: true, overlaySelectors: [".forma-assistant-launcher", ":popover-open", ":modal", ".topbar"] });
    await file.setInputFiles([]);
    await file.setInputFiles(archivePath);
    expect(await file.evaluate(async input => {
      const selected = input.files?.[0];
      return selected ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", await selected.arrayBuffer()))]
        .map(value => value.toString(16).padStart(2, "0")).join("") : null;
    })).toBe(expectedHash);
    const dialog = owner.locator("dialog.library-import-dialog:modal");
    const close = dialog.locator(".modal-card > button.modal-close"), accept = dialog.locator(".modal-card > button.primary");
    await expect(dialog).toHaveCount(1);
    await expect(close).toHaveAccessibleName(expected.close);
    await expect(accept).toHaveText(expected.accept);
    await expect(accept).toBeEnabled();
    await expect(accept).toHaveAttribute("aria-busy", "false");
    await expect(owner.locator(".library-import-recovery")).toHaveCount(0);
    await tabTo(page, close, 4);
    await checkFocus(page, close, testInfo, "copy-library-02-close");
    await page.keyboard.press("Tab");
    await checkFocus(page, accept, testInfo, "copy-library-03-import-unactivated");
    await page.keyboard.press("Shift+Tab");
    await checkFocus(page, close, testInfo, "copy-library-04-close-return");
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    expect(await file.evaluate((element, original) => element === original, originalInput)).toBe(true);
    await checkFocus(page, file, testInfo, "copy-library-05-restored-input", { nativeFileLabel: true, overlaySelectors: [".forma-assistant-launcher", ":popover-open", ":modal", ".topbar"] });
    await page.keyboard.press("Tab");
    await checkFocus(page, exportButton, testInfo, "copy-library-06-export-unactivated");
    const eyebrowObservations = [];
    const observations = await observeCopy(page, owner, exportButton, expected, testInfo, "copy-library-06", {
      ownerSelector: "forma-library", selectors: librarySelectors,
      primarySelector: ".library-main > .page-header--library > .page-header-copy > p",
      allowPrimaryOffscreen: testInfo.project.name === "shallow" }, async (_result, sample) => {
      const witness = await hiddenEyebrows.evaluate(state => state.inspect());
      eyebrowObservations.push(witness);
      await attachJSON(testInfo, "copy-library-06-hidden-eyebrows-" + sample, witness);
    });
    await checkCustody(saved, testInfo, "copy-library-custody");
    expect(sha256(await readFile(archivePath))).toBe(expectedHash);
    await expect(owner.locator(".library-import-recovery")).toHaveCount(0);
    // Describe only the added paragraphs after the original custody checks.
    // This does not waive any copy verdict or infer a missing scope/permission.
    const lifecycleCoverage = observations.map((result, sample) => ({ sample,
      regions: libraryLifecycleRegions.map(({ kind, className, role }) => {
        const items = (result.copy ?? []).filter(item => item.element.tag === "P" && item.element.role === role
          && (item.element.className ?? "").split(/\s+/).includes(className));
        const fragments = items.flatMap(item => item.fragments);
        const visibleFragments = fragments.filter(fragment => fragment.hasVisibleLayout).length;
        return { kind, count: items.length, copyIndices: items.map(item => item.index),
          fragmentCount: fragments.length, visibleFragments,
          disposition: !items.length ? "UNOBSERVED: paragraph not rendered in the actual lifecycle state; no scope/permission inferred"
            : !visibleFragments ? "UNOBSERVED: no visible paragraph fragments at this native Export focus; no clearance claimed"
              : "VISIBLE FRAGMENTS COLLECTED: subject to the unchanged ordinary-copy verdict, not glyph-ink or whole-paragraph proof" };
      }) }));
    await attachJSON(testInfo, "copy-library-lifecycle-coverage", lifecycleCoverage);
    for (const record of lifecycleCoverage.flatMap(sample => sample.regions)) {
      if (record.disposition.startsWith("UNOBSERVED")) testInfo.annotations.push({ type: "Lifecycle-copy coverage", description: record.kind + ": " + record.disposition });
      expect(record.count, record.kind + ": actual paragraph membership must survive the original custody path").toBe(lifecyclePresence[record.kind]);
    }
    // The full archive/native/custody/lifecycle tail precedes this exact policy
    // classification. Raw collector issues/copy/intersections are never edited.
    const expectedHiddenIssues = [];
    expect(eyebrowObservations).toHaveLength(observations.length);
    for (const [sample, witness] of eyebrowObservations.entries()) {
      expect(witness.currentOwner && witness.sameSelectedNodes).toBe(true);
      expect(witness.counts).toEqual({ header: 1, sections: 3 });
      expect(witness.selectedRaw).toEqual(initialEyebrows.originalRaw);
      expect(witness.items).toHaveLength(4);
      const issues = [];
      for (const item of witness.items) {
        expect(item.sameNode && item.exactPolicy, item.disposition).toBe(true);
        const observed = observations[sample].copy[item.copyIndex];
        expect(observed.index).toBe(item.copyIndex);
        expect(observed.element).toEqual(item.element);
        expect(observed.text).toBe(item.rawText.trim());
        expect(observed.style.display).toBe("none");
        expect(observed.style.visibility).toBe("visible");
        expect(Number(observed.style.opacity)).toBe(1);
        expect(observed.fragments).toEqual([]);
        expect(observed.raw.width).toBe(0); expect(observed.raw.height).toBe(0);
        issues.push({ kind: "selected ordinary copy is empty or style-hidden", copyIndex: item.copyIndex, element: item.element });
        testInfo.annotations.push({ type: "Library hidden-copy coverage", description: item.selector + ": " + item.disposition });
      }
      expectedHiddenIssues.push(issues);
    }
    await attachJSON(testInfo, "copy-library-hidden-eyebrow-disposition", { expectedHiddenIssues,
      rawCollectorIssues: observations.map(result => result.issues),
      note: "Exact known issues are UNOBSERVED hidden copy; all other issues, obstructions, unsupported geometry, raw intersections and stability checks remain strict." });
    assertCopyClearance(observations, expectedHiddenIssues);
  } catch (error) { primaryError = error; }
  const cleanupErrors = [];
  for (const dispose of [() => hiddenEyebrows?.dispose(), () => saved?.dispose(), () => originalInput?.dispose(), () => sessionObserver.dispose()]) {
    try { await dispose(); } catch (error) { cleanupErrors.push(error); }
  }
  const errors = [...(primaryError ? [primaryError] : []), ...cleanupErrors];
  if (errors.length > 1) throw new AggregateError(errors, "Library copy observation and custody handle cleanup failed");
  if (errors.length === 1) throw errors[0];
});
