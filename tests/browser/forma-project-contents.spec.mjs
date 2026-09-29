import { test, expect, attachJSON, captureViewport, openForma } from "./fixtures.mjs";
import { measureOrdinaryCopy } from "./helpers/ordinary-copy-layout.mjs";
import { verifyFocus, pressTo, tabTo } from "./helpers/keyboard-journey.mjs";
import { measureModalLayout } from "./helpers/modal-layout.mjs";

const path = "/studio/project";
const rawName = "  Native keyboard layout check — unsent  ";
const copy = {
  en: { direction: "ltr", heading: "Create a document", name: "Document name", close: "Close", create: "Create & open", opener: "New document" },
  fr: { direction: "ltr", heading: "Créer un document", name: "Nom du document", close: "Fermer", create: "Créer et ouvrir", opener: "Nouveau document" },
  ar: { direction: "rtl", heading: "إنشاء مستند", name: "اسم المستند", close: "إغلاق", create: "إنشاء وفتح", opener: "مستند جديد" },
};

test("Project contents: an ordinary unsent document dialog reflows and closes through native keys", async ({ page, context, geometry }, testInfo) => {
  const locale = geometry.locale ?? "en-US", expected = copy[locale.split("-")[0]];
  expect(expected, "Only the bounded EN/FR/AR catalog cases are declared here").toBeTruthy();
  await openForma(page, context, geometry, path, testInfo);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator("html")).toHaveAttribute("dir", expected.direction);
  await expect(page.locator("forma-ui-language-picker select:visible")).toHaveValue(locale.split("-")[0]);
  const owner = page.locator("forma-project-contents");
  const opener = owner.locator(".page-header-actions").getByRole("button", { name: expected.opener, exact: true });
  const dialog = owner.locator("dialog.new-document-dialog:not(.document-copy-dialog):modal");
  const name = dialog.getByRole("textbox", { name: expected.name, exact: true });
  const close = dialog.locator(".modal-card > button.modal-close");
  const footerClose = dialog.locator("footer").getByRole("button", { name: expected.close, exact: true });
  const submit = dialog.locator("button[type=submit]");
  const custody = () => owner.locator(".document-library-grid > article.document-card").evaluateAll(elements =>
    elements.map(element => ({ handle: element.querySelector("header small")?.textContent, title: element.querySelector("h3")?.textContent, text: element.textContent })));
  await expect(owner.locator(".document-library-grid > article.document-card").first()).toBeVisible();
  // A visible card can still be awaiting its existing delivery read. Keep the
  // complete custody snapshot, but start after each real controller has rendered.
  for (const card of await owner.locator(".document-library-grid > article.document-card").all()) {
    const delivery = card.locator(":scope > forma-output-requirements");
    await expect(delivery).toHaveCount(1);
    await expect(delivery.locator(':scope > section:not([aria-busy="true"])')).toHaveCount(1);
  }
  const before = await custody(), beforeURL = page.url();
  expect(before.length).toBeGreaterThan(0);
  await attachJSON(testInfo, "project-contents-before", before);
  const layout = async (stage, focusObservation, headingMustBeVisible = false) => {
    const observation = await dialog.evaluate(measureModalLayout, { focusClip: focusObservation.focus.intersection, headingMustBeVisible });
    await attachJSON(testInfo, stage, observation);
    expect(observation.language).toBe(locale);
    expect(observation.direction).toBe(expected.direction);
    expect(observation.dialogDirection).toBe(expected.direction);
    expect(observation.cardDirection).toBe(expected.direction);
    expect(observation.headingText).toBe(expected.heading);
    expect(observation.failures, stage).toEqual([]);
  };
  await tabTo(page, opener);
  await verifyFocus(page, opener, testInfo, "pc-01-opener");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveAttribute("aria-labelledby", "new-document-title");
  await expect(dialog.locator("#new-document-title")).toHaveJSProperty("textContent", expected.heading);
  await expect(close).toHaveAccessibleName(expected.close);
  await expect(submit).toHaveJSProperty("textContent", expected.create);
  await expect(submit).toBeDisabled();
  await expect(name).toHaveValue("");
  const opened = await verifyFocus(page, name, testInfo, "pc-02-name");
  await layout("pc-02-open-layout", opened);
  await name.fill(rawName); // Already genuinely focused; never submit.
  await expect(name).toHaveValue(rawName);
  await expect(submit).toBeEnabled();
  await pressTo(page, "Shift+Tab", close, testInfo, "pc-03-header-close").then(observation => layout("pc-03-heading-clearance", observation, true));
  await pressTo(page, "Tab", name, testInfo, "pc-04-name-return");
  await expect(name).toHaveValue(rawName);
  await pressTo(page, "Tab", footerClose, testInfo, "pc-05-footer-close");
  await pressTo(page, "Tab", submit, testInfo, "pc-06-create-unactivated").then(observation => layout("pc-06-footer-layout", observation));
  await expect(name).toHaveValue(rawName);
  expect(await custody()).toEqual(before);
  await pressTo(page, "Shift+Tab", footerClose, testInfo, "pc-07-footer-return");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await verifyFocus(page, opener, testInfo, "pc-08-close-return");

  // Ordinary Close clears only this unsent name. There is no original write to recover.
  await page.keyboard.press("Enter");
  await verifyFocus(page, name, testInfo, "pc-09-pristine-reopen");
  await expect(name).toHaveValue("");
  await expect(submit).toBeDisabled();
  await name.fill(rawName);
  await pressTo(page, "Escape", opener, testInfo, "pc-10-escape-return");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Enter");
  await verifyFocus(page, name, testInfo, "pc-11-pristine-after-escape");
  await expect(name).toHaveValue("");
  await expect(submit).toBeDisabled();
  await pressTo(page, "Shift+Tab", close, testInfo, "pc-12-icon-close");
  await pressTo(page, "Enter", opener, testInfo, "pc-13-icon-close-return");
  await expect(dialog).toHaveCount(0);
  expect(await custody()).toEqual(before);
  expect(page.url()).toBe(beforeURL);
  await expect(owner.locator(".project-blank-original-recovery")).toHaveCount(0);
  await attachJSON(testInfo, "project-contents-after", { documents: await custody(), url: page.url(),
    recoveryCoverage: "UNOBSERVED: original-operation Check/Open/Discard-name/lifetime states require an actual submitted creation. This journey never submits." });
});

// E6 follow-up only: retain the complete ordinary-dialog case above. Reuse all
// six configured PC geometries/locales, native keys and the read-only guard.
test("E6 Project Contents header actions keep complete short labels in content-led rows", async ({ page, context, geometry }, testInfo) => {
  const locale = geometry.locale ?? "en-US", expected = copy[locale.split("-")[0]];
  expect(expected).toBeTruthy();
  await openForma(page, context, geometry, path, testInfo);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator("html")).toHaveAttribute("dir", expected.direction);
  await expect(page.locator("forma-ui-language-picker select:visible")).toHaveValue(locale.split("-")[0]);
  const owner = page.locator("forma-project-contents");
  const header = owner.locator(".studio-main > .page-header--document");
  const actions = header.locator(":scope > .page-header-actions");
  const controls = actions.locator(":scope > .button");
  await expect(controls).toHaveCount(3); // The same three authorized actions recorded in R24.
  await expect(controls.nth(2)).toHaveAccessibleName(expected.opener);
  const custody = () => owner.locator(".document-library-grid > article.document-card").evaluateAll(elements =>
    elements.map(element => ({ handle: element.querySelector("header small")?.textContent, title: element.querySelector("h3")?.textContent, text: element.textContent })));
  await expect(owner.locator(".document-library-grid > article.document-card").first()).toBeVisible();
  // A visible card can still be awaiting its existing delivery read. Keep the
  // complete custody snapshot, but start after each real controller has rendered.
  for (const card of await owner.locator(".document-library-grid > article.document-card").all()) {
    const delivery = card.locator(":scope > forma-output-requirements");
    await expect(delivery).toHaveCount(1);
    await expect(delivery.locator(':scope > section:not([aria-busy="true"])')).toHaveCount(1);
  }
  const before = await custody(), beforeURL = page.url();
  expect(before.length).toBeGreaterThan(0);
  const signatures = () => controls.evaluateAll(elements => elements.map(element => ({
    tag: element.tagName, text: element.textContent, href: element.getAttribute("href"), disabled: element.matches(":disabled"),
  })));
  const originalControls = await signatures();
  expect(originalControls.map(control => control.tag)).toEqual(["A", "A", "BUTTON"]);


  // This extends the existing three native stages; no new journey or action.
  const ordinaryExpected = {
    en: { ask: "Ask Forma", heading: "Project contents", description: "See and manage the documents, canvases, and reusable blocks that inherit this project’s access and authored folders." },
    fr: { ask: "Demander à Forma", heading: "Contenus du projet", description: "Consultez et gérez les documents, les canevas et les blocs réutilisables qui héritent des accès et des dossiers créés pour ce projet." },
    ar: { ask: "اسأل Forma", heading: "محتويات المشروع", description: "اطّلع على المستندات ومساحات العمل والكتل القابلة لإعادة الاستخدام التي ترث أذونات الوصول إلى هذا المشروع ومجلداته المُنشأة، وأدِرها." },
  }[locale.split("-")[0]];
  const headingSelector = ".studio-main > .page-header--document > .page-header-copy > h1";
  const descriptionSelector = ".studio-main > .page-header--document > .page-header-copy > p";
  await expect(header).toHaveCount(1);
  await expect(owner.locator(headingSelector)).toHaveCount(1);
  await expect(owner.locator(descriptionSelector)).toHaveCount(1);
  await expect(owner.locator(headingSelector)).toHaveJSProperty("textContent", ordinaryExpected.heading);
  await expect(owner.locator(descriptionSelector)).toHaveJSProperty("textContent", ordinaryExpected.description);
  const readCopyState = () => header.evaluate(element => {
    const doc = element.ownerDocument, win = doc.defaultView;
    const media = "(max-height: 37.5rem) and (orientation: landscape)";
    const policySelector = ".page-header--document .page-header-copy > p";
    const heading = [...element.querySelectorAll(":scope > .page-header-copy > h1")];
    const description = [...element.querySelectorAll(":scope > .page-header-copy > p")];
    const raw = nodes => nodes.map(node => ({ tag: node.tagName, text: node.textContent,
      hidden: node.hasAttribute("hidden"), inert: node.hasAttribute("inert"), ariaHidden: node.getAttribute("aria-hidden") }));
    const policyWitnesses = [], unreadableStylesheets = [];
    const walk = (rules, mediaChain, source) => {
      for (const rule of rules) {
        const chain = rule.type === win.CSSRule.MEDIA_RULE ? [...mediaChain, rule.conditionText] : mediaChain;
        if (rule.type === win.CSSRule.STYLE_RULE && chain.length === 1 && chain[0] === media
          && rule.selectorText.split(",").map(value => value.trim()).includes(policySelector)
          && rule.style.length === 1 && rule.style.getPropertyValue("display") === "none"
          && rule.style.getPropertyPriority("display") === "") {
          policyWitnesses.push({ source, media: chain[0], selector: rule.selectorText, declaration: rule.style.cssText });
        }
        if (rule.cssRules) walk(rule.cssRules, chain, source);
      }
    };
    for (const sheet of doc.styleSheets) {
      const source = sheet.href ?? sheet.ownerNode?.getAttribute("data-vite-dev-id") ?? "inline stylesheet";
      try { walk(sheet.cssRules, [], source); } catch { unreadableStylesheets.push(source); }
    }
    const p = description.length === 1 ? description[0] : null;
    const ownStyle = p ? win.getComputedStyle(p) : null;
    const ancestors = [];
    for (let node = p?.parentElement; node; node = node.parentElement) {
      const style = win.getComputedStyle(node);
      ancestors.push({ tag: node.tagName, className: node.getAttribute("class"), display: style.display,
        visibility: style.visibility, opacity: style.opacity,
        hidden: node.matches("[hidden],[inert],[aria-hidden='true']") });
    }
    const descriptionStyle = ownStyle ? { display: ownStyle.display, visibility: ownStyle.visibility,
      opacity: ownStyle.opacity, color: ownStyle.color, fontFamily: ownStyle.fontFamily,
      fontSize: ownStyle.fontSize, lineHeight: ownStyle.lineHeight, clientRects: p.getClientRects().length } : null;
    const mediaMatches = win.matchMedia(media).matches;
    const exactSuppression = Boolean(p && mediaMatches && policyWitnesses.length === 1
      && ownStyle.display === "none" && ownStyle.visibility === "visible" && Number(ownStyle.opacity) === 1
      && p.getClientRects().length === 0 && !p.matches("[hidden],[inert],[aria-hidden='true']")
      && ancestors.every(item => item.display !== "none" && item.visibility === "visible"
        && Number(item.opacity) === 1 && !item.hidden));
    return { currentOwner: element.matches("forma-project-contents .studio-main > .page-header--document") && element.isConnected,
      custody: { heading: raw(heading), description: raw(description) },
      descriptionPolicy: { media, mediaMatches, policySelector, policyWitnesses, unreadableStylesheets,
        descriptionStyle, ancestors, exactSuppression,
        disposition: exactSuppression ? "UNOBSERVED: exact retained short-height display:none description policy; no copy clearance claimed"
          : "INCLUDED IN STRICT COPY MEASUREMENT: unexpected hiding, clipping and opacity remain failures" } };
  });
  const originalCopy = await readCopyState();
  await attachJSON(testInfo, "e6-pc-copy-before", originalCopy);
  const copyMeasurements = [];

  const readHeader = () => header.evaluate(element => {
    const doc = element.ownerDocument, win = doc.defaultView;
    const actions = element.querySelector(":scope > .page-header-actions");
    if (!actions) throw new Error("Measure the current direct PC action group");
    const rect = node => {
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const headerStyle = win.getComputedStyle(element), actionStyle = win.getComputedStyle(actions), box = rect(element);
    const content = { left: box.left + element.clientLeft + Number.parseFloat(headerStyle.paddingLeft),
      right: box.left + element.clientLeft + element.clientWidth - Number.parseFloat(headerStyle.paddingRight) };
    const buttons = [...actions.querySelectorAll(":scope > .button")].map(button => {
      const style = win.getComputedStyle(button), words = [], walker = doc.createTreeWalker(button, win.NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim() || node.parentElement.closest('[aria-hidden="true"],.forma-icon,script,style')) continue;
        for (const match of node.textContent.matchAll(/\S+/gu)) {
          const range = doc.createRange();
          range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
          const fragments = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(r =>
            ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }));
          const lines = [];
          for (const fragment of fragments) if (!lines.some(top => Math.abs(top - fragment.top) <= 1)) lines.push(fragment.top);
          // Multiple bidi runs on one line are not mistaken for a broken word.
          words.push({ text: match[0], fragments, lineTops: lines });
        }
      }
      return { tag: button.tagName, text: button.textContent, href: button.getAttribute("href"), box: rect(button),
        focused: button.matches(":focus"), words, clientWidth: button.clientWidth, scrollWidth: button.scrollWidth,
        style: { flex: style.flex, whiteSpace: style.whiteSpace, overflowX: style.overflowX, overflowY: style.overflowY,
          textOverflow: style.textOverflow, lineClamp: style.getPropertyValue("-webkit-line-clamp"),
          fontSize: style.fontSize, lineHeight: style.lineHeight, alignSelf: style.alignSelf } };
    });
    return { language: doc.documentElement.lang, direction: doc.documentElement.dir, actionDirection: actionStyle.direction,
      viewport: { width: win.innerWidth, height: win.innerHeight, dpr: win.devicePixelRatio, scale: win.visualViewport?.scale ?? null },
      header: box, content, actions: rect(actions), gap: Number.parseFloat(actionStyle.columnGap),
      flexWrap: actionStyle.flexWrap, buttons,
      scroll: { document: doc.documentElement.scrollWidth, client: doc.documentElement.clientWidth,
        actions: actions.scrollWidth, actionsClient: actions.clientWidth },
      limits: "Own inline fit and short catalog words only; all rows need not be simultaneously onscreen. Native focus/outline/hit evidence is separate." };
  });

  const measurements = [];
  for (let index = 0; index < 3; index += 1) {
    const native = controls.nth(index), stage = "e6-pc-header-0" + (index + 1);
    await tabTo(page, native);
    await verifyFocus(page, native, testInfo, stage); // No focus assignment, test scrolling or activation.
    const metrics = await readHeader();
    await attachJSON(testInfo, stage + "-layout", metrics);
    measurements.push({ stage, metrics });
    const launcher = page.locator(".application-creative > forma-creative-assistant > forma-assistant-panel > button.forma-assistant-launcher");
    await expect(launcher).toHaveCount(1);
    await expect(launcher).toHaveAccessibleName(ordinaryExpected.ask);
    await expect(launcher).toBeEnabled();
    let nativeHandle, launcherHandle, primaryError;
    const samples = [], states = [];
    try {
      nativeHandle = await native.elementHandle();
      launcherHandle = await launcher.elementHandle();
      for (let sample = 0; sample < 2; sample += 1) {
        if (sample) await page.waitForTimeout(250); // Existing bounded observation interval, not a placement repair.
        const state = await readCopyState();
        states.push(state);
        const selectors = state.descriptionPolicy.exactSuppression ? [headingSelector] : [headingSelector, descriptionSelector];
        const result = await owner.evaluate(measureOrdinaryCopy, { ownerSelector: "forma-project-contents", selectors,
          primarySelector: headingSelector, focus: nativeHandle, launcher: launcherHandle });
        samples.push(result);
        await attachJSON(testInfo, stage + "-copy-state-" + sample, state);
        await attachJSON(testInfo, stage + "-copy-ranges-" + sample, result);
        await captureViewport(page, testInfo, stage + "-copy-ranges-" + sample);
      }
      await verifyFocus(page, native, testInfo, stage + "-copy-native-after");
      copyMeasurements.push({ stage, samples, states });
    } catch (error) { primaryError = error; }
    const cleanupErrors = [];
    for (const handle of [nativeHandle, launcherHandle]) {
      try { await handle?.dispose(); } catch (error) { cleanupErrors.push(error); }
    }
    const errors = [...(primaryError ? [primaryError] : []), ...cleanupErrors];
    if (errors.length > 1) throw new AggregateError(errors, "PC copy observation and native handle cleanup failed");
    if (errors.length === 1) throw errors[0];
  }
  // Preserve native authority/custody before reporting the intended word-fit
  // failure. The existing original test owns creation entry/Close/Escape.
  expect(await signatures()).toEqual(originalControls);
  expect(await custody()).toEqual(before);
  expect(page.url()).toBe(beforeURL);
  await expect(owner.locator("dialog:modal")).toHaveCount(0);
  await expect(owner.locator(".project-blank-original-recovery")).toHaveCount(0);
  await attachJSON(testInfo, "e6-pc-header-custody", { before, after: await custody(), beforeURL, afterURL: page.url(), controls: originalControls });

  const violations = [];
  for (const { stage, metrics: m } of measurements) {
    if (m.direction !== expected.direction || m.actionDirection !== expected.direction)
      violations.push({ stage, issue: "header action flow no longer follows the actual locale direction" });
    if (m.flexWrap !== "wrap") violations.push({ stage, issue: "native header peers lost content-led row wrapping" });
    if (m.actions.left < m.content.left - 1 || m.actions.right > m.content.right + 1)
      violations.push({ stage, issue: "action group escapes the existing logical header gutter", metrics: m });
    if (m.scroll.document > m.scroll.client + 1 || m.scroll.actions > m.scroll.actionsClient + 1)
      violations.push({ stage, issue: "header correction must not create horizontal overflow", scroll: m.scroll });
    for (const [index, button] of m.buttons.entries()) {
      if (button.box.width < 44 || button.box.height < 44)
        violations.push({ stage, index, issue: "native action body is below the existing shared 44px floor", box: button.box });
      if (button.box.left < m.content.left - 1 || button.box.right > m.content.right + 1 || button.scrollWidth > button.clientWidth + 1)
        violations.push({ stage, index, issue: "native action leaves its content lane", button });
      if (!button.words.length || button.style.whiteSpace !== "normal"
        || ["hidden", "clip"].includes(button.style.overflowX) || ["hidden", "clip"].includes(button.style.overflowY)
        || button.style.textOverflow === "ellipsis" || !["", "none", "0"].includes(button.style.lineClamp))
        violations.push({ stage, index, issue: "complete native action text is absent or concealed", style: button.style });
      for (const word of button.words) {
        if (word.lineTops.length !== 1) violations.push({ stage, index, issue: "ordinary short catalog word breaks into line fragments", word });
        if (word.fragments.some(r => r.left < button.box.left - 1 || r.right > button.box.right + 1))
          violations.push({ stage, index, issue: "native label exceeds its own inline bounds", word });
      }
    }
    for (let a = 0; a < m.buttons.length; a += 1) for (let b = a + 1; b < m.buttons.length; b += 1) {
      const first = m.buttons[a].box, second = m.buttons[b].box;
      if (first.top >= second.bottom || second.top >= first.bottom) continue; // Separate rows are allowed.
      const gap = Math.max(first.left, second.left) - Math.min(first.right, second.right);
      if (Math.abs(first.height - second.height) > 1 || !Number.isFinite(m.gap) || gap < m.gap - 1)
        violations.push({ stage, issue: "same-row peers lost their shared height or gutter", a, b, gap, expectedGap: m.gap, first, second });
    }
  }
  await attachJSON(testInfo, "e6-pc-header-desired-layout", { violations });
  expect(violations).toEqual([]);
  // The complete existing native/card/action/route/word-fit tails precede this new copy verdict.
  const finalCopy = await readCopyState();
  await attachJSON(testInfo, "e6-pc-copy-after", finalCopy);
  expect(finalCopy.currentOwner).toBe(true);
  expect(finalCopy.custody).toEqual(originalCopy.custody);
  expect(finalCopy.descriptionPolicy).toEqual(originalCopy.descriptionPolicy);
  for (const { stage, samples, states } of copyMeasurements) {
    for (const state of states) {
      expect(state.currentOwner, stage + ": original copy remains in the actual owner").toBe(true);
      expect(state.custody, stage + ": complete raw heading and description custody").toEqual(originalCopy.custody);
      expect(state.descriptionPolicy, stage + ": preserve the exact observed short-height description policy").toEqual(originalCopy.descriptionPolicy);
      if (state.descriptionPolicy.exactSuppression) testInfo.annotations.push({ type: "PC ordinary-copy coverage",
        description: stage + ": " + state.descriptionPolicy.disposition });
    }
    for (const result of samples) {
      expect(result.issues, stage + ": owned, current and visible ordinary-copy prerequisites").toEqual([]);
      expect(result.observedObstructions, stage + ": opaque Assistant cannot intercept visible text fragments").toEqual([]);
      expect(result.unassessed, stage + ": unsupported clipping/paint cannot pass").toEqual([]);
      expect(result.rawIntersections, stage + ": raw text/Assistant overlap cannot silently pass").toEqual([]);
    }
    const shape = result => ({ viewport: result.viewport, launcher: result.launcher.raw,
      compact: result.launcher.dataset.compactLauncher ?? null, tight: result.launcher.dataset.tightLauncher ?? null,
      copy: result.copy.map(item => ({ element: item.element, raw: item.raw, fragments: item.fragments.map(fragment => fragment.raw) })) });
    expect(shape(samples[1]), stage + ": exact stable native geometry, without epsilon").toEqual(shape(samples[0]));
  }
});
