import { test, expect, attachJSON, openForma } from "./fixtures.mjs";
import { documentPath, waitForExistingDocument, savedArticles, verifyFocus, tabTo } from "./helpers/keyboard-journey.mjs";
import { observeInitialSession } from "./helpers/initial-session.mjs";

// Additive, conditional on the original E3 View18/24/25/27 source gates and a
// rebuilt app. These are ordinary native links, not an ARIA menu/arrow-key model.
const focusedPath = documentPath + "/focus";
const modes = ["document", "board", "guided", "layers", "adaptive", "editor", "chat"];
const copy = {
  en: { direction: "ltr", navigation: "Document views", heading: "Change view", trigger: "Change view · Document",
    families: ["Write", "Shape", "Present"], readerFamily: "Read",
    views: ["Document", "Context board", "Guided brief", "Reality layers", "Adaptive path", "Creative editor", "Chat"] },
  fr: { direction: "ltr", navigation: "Vues du document", heading: "Changer de vue", trigger: "Changer de vue · Document",
    families: ["Écrire", "Composer", "Présenter"], readerFamily: "Lire",
    views: ["Document", "Tableau de contexte", "Brief guidé", "Couches de réalité", "Parcours adaptatif", "Éditeur créatif", "Discussion"] },
  ar: { direction: "rtl", navigation: "طرق عرض المستند", heading: "تغيير العرض", trigger: "تغيير العرض · مستند",
    families: ["كتابة", "تشكيل", "عرض"], readerFamily: "قراءة",
    views: ["مستند", "لوحة السياق", "ملخص إبداعي موجّه", "طبقات الواقع", "مسار تكيّفي", "المحرر الإبداعي", "دردشة"] },
};

test("Document View: observe the authorized native disclosure without leaving focused Document", async ({ page, context, geometry }, testInfo) => {
  const expected = copy[(geometry.locale ?? "en-US").split("-")[0]];
  const workspace = page.locator("forma-workspace");
  const nav = workspace.locator("forma-studio-mode-nav[active=document]");
  const families = nav.locator(":scope > .studio-mode-nav > .studio-mode-families > a");
  const menu = nav.locator("forma-ui-popover.studio-view-menu");
  const trigger = menu.locator(":scope > .ui-popover > button.ui-popover-trigger");
  const panel = menu.locator(":scope > .ui-popover > section.ui-popover-panel");
  const links = panel.locator(":scope > .studio-view-options > a[data-studio-view]");
  const focusToggle = nav.locator(":scope > .studio-mode-nav > .document-focus-toggle");
  const navigations = [];
  const onNavigation = frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); };
  const coverage = { authority: "UNOBSERVED", posture: "UNOBSERVED", menu: "UNOBSERVED", completed: false,
    outsideEscape: { branch: "UNOBSERVED", status: "UNOBSERVED: no outside-View epilogue completed", completed: false },
    verifiedFocusStages: [], openingFocus: [],
    limits: "One existing Document; real current permissions only. Other views/shortcuts are not activated. No draft is created, route change, coarse-pointer/Chat fit, AT or production acceptance." };
  let retained, articles;
  const sessionObservation = observeInitialSession(page, focusedPath);
  const observeFocus = async (target, stage, open = false) => {
    await expect(target, stage + ": native accessible name").not.toHaveAccessibleName("");
    // An open native popover intentionally covers background controls. Keep its
    // actual focused target strict; do not treat that background as unobscured.
    const result = await verifyFocus(page, target, testInfo, stage, { checkVisibleControls: !open });
    expect(result.focus.raw.width, stage + ": native target width").toBeGreaterThanOrEqual(44);
    expect(result.focus.raw.height, stage + ": native target height").toBeGreaterThanOrEqual(44);
    const text = await target.evaluate((element, clip) => {
      const range = document.createRange(); range.selectNodeContents(element);
      return [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => ({
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        contained: rect.left >= clip.left && rect.right <= clip.right && rect.top >= clip.top && rect.bottom <= clip.bottom,
      }));
    }, result.focus.intersection);
    await attachJSON(testInfo, stage + "-label-ranges", { coverage: "Actual DOM text ranges, not glyph/contrast conformance", rectangles: text });
    expect(text.length, stage + ": painted native label").toBeGreaterThan(0);
    expect(text.every(rect => rect.contained), stage + ": complete label inside the actual clip").toBe(true);
    coverage.verifiedFocusStages.push(stage);
  };
  const unchanged = async stage => {
    const receipt = await retained.evaluate(state => state.inspect());
    receipt.savedArticlesEqual = JSON.stringify(await savedArticles(page)) === JSON.stringify(articles);
    receipt.mainFrameNavigations = [...navigations];
    await attachJSON(testInfo, stage, receipt);
    expect(receipt.checks, stage + ": original native owners and focused route").toEqual(
      Object.fromEntries(Object.keys(receipt.checks).map(key => [key, true])));
    expect(receipt.fields.every(field => field.sameOwner && field.valueEqual), stage + ": raw native fields remain unchanged").toBe(true);
    expect(receipt.savedArticlesEqual, stage + ": five existing saved articles remain unchanged").toBe(true);
    expect(receipt.mainFrameNavigations, stage + ": no navigation while opening or dismissing View").toEqual([]);
  };
  const openMenu = async stage => {
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(panel).toHaveAttribute("popover", "auto");
    await expect(menu.locator(".ui-popover-panel:popover-open")).toHaveCount(1);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toHaveAccessibleName(expected.heading);
    await expect(panel.locator(":scope > h3")).toHaveText(expected.heading);
    await expect(panel.locator(":scope > nav")).toHaveAccessibleName(expected.navigation);
    await expect(links).toHaveCount(modes.length);
    for (let index = 0; index < modes.length; index += 1) {
      await expect(links.nth(index)).toHaveAccessibleName(expected.views[index]);
      await expect(links.nth(index)).toHaveAttribute("href", index === 0 ? focusedPath : documentPath + "/view/" + modes[index] + "/focus");
    }
    // Shared native popover opening has no authored autofocus. Record what the
    // browser did; the next known link is reached by real Tab, never focus().
    coverage.openingFocus.push(await menu.evaluate((element, stageName) => {
      const active = document.activeElement;
      return { stage: stageName, tag: active?.tagName ?? null,
        isTrigger: active === element.querySelector(".ui-popover-trigger"),
        view: active?.getAttribute("data-studio-view") ?? null,
        insidePanel: Boolean(element.querySelector(".ui-popover-panel")?.contains(active)) };
    }, stage));
    await unchanged(stage + "-custody");
  };
  const closed = async stage => {
    await expect(menu.locator(".ui-popover-panel:popover-open")).toHaveCount(0);
    await expect(panel).not.toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await observeFocus(trigger, stage);
    await unchanged(stage + "-custody");
  };
  try {
    expect(Boolean(expected), "Only the existing EN/FR/AR profiles are declared").toBe(true);
    await openForma(page, context, geometry, focusedPath, testInfo);
    await waitForExistingDocument(page);
    const { session, evidence } = await sessionObservation.read();
    await attachJSON(testInfo, "authenticated-initial-session", evidence);
    const projectContext = session?.projectContext;
    expect(Boolean(session?.user?.userId), "No authentication or project authority is manufactured").toBe(true);
    if (projectContext) expect(typeof projectContext.projectId === "string" && Array.isArray(projectContext.permissions)
      && projectContext.permissions.every(value => typeof value === "string")).toBe(true);
    const canAuthor = !projectContext || projectContext.permissions.includes("project.author");
    coverage.authority = projectContext ? (canAuthor ? "Actual shared project.author permission" : "Actual shared reader without project.author")
      : "Actual personal account without a shared-project context";
    await expect(page).toHaveURL(new URL(focusedPath, page.url()).href);
    await expect(page.locator("html")).toHaveAttribute("dir", expected.direction);
    await expect(nav).toHaveCount(1);
    await expect(nav.locator(":scope > .studio-mode-nav")).toHaveAccessibleName(expected.navigation);
    expect(await nav.evaluate(element => getComputedStyle(element).direction)).toBe(expected.direction);
    await expect(page.locator("html")).toHaveAttribute("data-document-focus", "");
    await expect(focusToggle).toHaveAttribute("aria-pressed", "true");
    coverage.posture = "Actual canonical /focus entry; the focus-toggle control is not activated";
    await expect(nav.locator(":scope > .studio-mode-nav > .studio-mode-links > a")).toHaveCount(0);
    await expect(families).toHaveCount(canAuthor ? 3 : 2);
    const familyNames = canAuthor ? expected.families : [expected.readerFamily, expected.families[2]];
    const familyHrefs = canAuthor ? [focusedPath, documentPath + "/view/board/focus", focusedPath + "#output-title"]
      : [focusedPath, focusedPath + "#output-title"];
    for (let index = 0; index < familyNames.length; index += 1) {
      await expect(families.nth(index)).toHaveAccessibleName(familyNames[index]);
      await expect(families.nth(index)).toHaveAttribute("href", familyHrefs[index]);
    }
    await expect(menu).toHaveCount(canAuthor ? 1 : 0);
    if (canAuthor) {
      await expect(trigger).toHaveAccessibleName(expected.trigger);
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(panel).not.toBeVisible();
      await expect(links).toHaveCount(modes.length);
      expect(await links.evaluateAll(elements => elements.map(element => ({
        mode: element.getAttribute("data-studio-view"), current: element.getAttribute("aria-current"),
      })))).toEqual(modes.map((mode, index) => ({ mode, current: index === 0 ? "page" : null })));
    } else {
      await expect(nav.locator(".studio-current-view")).toHaveText(expected.views[0]);
      await expect(nav.locator(".context-set-trigger")).toHaveCount(0);
    }
    articles = await savedArticles(page);
    // Raw values remain inside the browser-owned handle. No field is filled,
    // selected or blurred by script; only equality and descriptors are emitted.
    retained = await workspace.evaluateHandle(element => {
      const nativeNav = element.querySelector("forma-studio-mode-nav[active=document]");
      const nativeMenu = nativeNav.querySelector("forma-ui-popover.studio-view-menu");
      const nativeTrigger = nativeMenu?.querySelector(":scope > .ui-popover > button.ui-popover-trigger") ?? null;
      const nativePanel = nativeMenu?.querySelector(":scope > .ui-popover > section.ui-popover-panel") ?? null;
      const nativeLinks = [...(nativePanel?.querySelectorAll(":scope > .studio-view-options > a[data-studio-view]") ?? [])];
      const values = field => JSON.stringify([field.value, Boolean(field.checked),
        field.tagName === "SELECT" ? [...field.options].map(option => option.selected) : null]);
      const fields = [...element.querySelectorAll("input,textarea,select")].map((node, index) => ({
        node, index, tag: node.tagName, type: node.type, id: node.id, name: node.name, value: values(node),
      }));
      const href = location.href, length = history.length;
      const triggerId = nativeTrigger?.id ?? null, panelId = nativePanel?.id ?? null;
      const linkState = nativeLinks.map(node => [node.getAttribute("href"), node.getAttribute("aria-current")]);
      return { inspect: () => {
        const currentMenu = nativeNav.querySelector("forma-ui-popover.studio-view-menu");
        const currentFields = [...element.querySelectorAll("input,textarea,select")];
        return { checks: {
          workspace: element.isConnected && document.querySelector("forma-workspace") === element,
          navigation: nativeNav.isConnected && element.querySelector("forma-studio-mode-nav[active=document]") === nativeNav,
          menu: currentMenu === nativeMenu && (!nativeMenu || nativeMenu.isConnected),
          trigger: !nativeMenu || nativeTrigger.isConnected && nativeMenu.querySelector(".ui-popover-trigger") === nativeTrigger && nativeTrigger.id === triggerId,
          panel: !nativeMenu || nativePanel.isConnected && nativeMenu.querySelector(".ui-popover-panel") === nativePanel && nativePanel.id === panelId,
          nativeAssociation: !nativeMenu || Boolean(triggerId && panelId
            && nativeTrigger.popoverTargetElement === nativePanel && nativeTrigger.getAttribute("aria-controls") === panelId
            && document.getElementById(triggerId) === nativeTrigger && document.getElementById(panelId) === nativePanel
            && [...document.querySelectorAll("[id]")].filter(node => node.id === triggerId || node.id === panelId).length === 2),
          links: !nativeMenu || nativeLinks.length === nativePanel.querySelectorAll(":scope > .studio-view-options > a").length
            && nativeLinks.every((node, index) => node.isConnected
              && nativePanel.querySelectorAll(":scope > .studio-view-options > a")[index] === node
              && node.getAttribute("href") === linkState[index][0] && node.getAttribute("aria-current") === linkState[index][1]),
          fields: currentFields.length === fields.length && fields.every((field, index) => currentFields[index] === field.node),
          focusedDocument: document.documentElement.hasAttribute("data-document-focus")
            && nativeNav.querySelector(".document-focus-toggle")?.getAttribute("aria-pressed") === "true",
          route: location.href === href, historyLength: history.length === length,
        }, fields: fields.map(field => ({ index: field.index, tag: field.tag, type: field.type, id: field.id, name: field.name,
          sameOwner: field.node.isConnected && element.contains(field.node), valueEqual: values(field.node) === field.value })) };
      } };
    });
    page.on("framenavigated", onNavigation);
    await unchanged("view-00-initial-custody");
    await tabTo(page, families.first());
    for (let index = 0; index < familyNames.length; index += 1) {
      if (index) await page.keyboard.press("Tab");
      await observeFocus(families.nth(index), "view-family-" + index);
    }
    if (!canAuthor) {
      await unchanged("view-reader-custody");
      coverage.menu = "UNOBSERVED: actual reader has only Document plus Read/Present; no native View disclosure is available";
      coverage.completed = true; return;
    }
    await page.keyboard.press("Tab");
    await observeFocus(trigger, "view-01-trigger");
    await openMenu("view-02-open");
    await tabTo(page, links.first(), 3);
    for (let index = 0; index < modes.length; index += 1) {
      if (index) await page.keyboard.press("Tab");
      await observeFocus(links.nth(index), "view-03-option-" + modes[index], true);
    }
    await page.keyboard.press("Shift+Tab");
    await observeFocus(links.nth(modes.length - 2), "view-04-reverse", true);
    await page.keyboard.press("Escape");
    await closed("view-05-escape-return");
    await openMenu("view-06-reopen");
    await tabTo(page, links.first(), 3);
    await observeFocus(links.first(), "view-07-current-document", true);
    await page.keyboard.press("Enter");
    await closed("view-08-current-selection-return");
    coverage.menu = "OBSERVED: 3 direct shortcuts, native View/7 link traversal, reverse Tab, Escape and exact current-Document dismissal; focused route and raw work unchanged";
    // Leave the same native popover by Tab without activating either adjacent
    // action. The author-only Add context button is the next direct DOM peer.
    const outside = nav.locator(":scope > .studio-mode-nav > button.context-set-trigger");
    await expect(outside, "One actual next outside control").toHaveCount(1);
    await expect(outside).toHaveAttribute("type", "button");
    await expect(outside).toBeVisible();
    await expect(outside).toBeEnabled();
    await expect(outside).not.toHaveAccessibleName("");
    const originalOutside = await outside.elementHandle();
    expect(originalOutside, "Retain the actual outside native button").not.toBeNull();
    const observeOutside = async (stage, open) => {
      const identity = await outside.evaluate((button, original) => ({
        original: button === original && button.isConnected,
        directOutside: button.parentElement?.matches(".studio-mode-nav") === true && !button.closest(".ui-popover"),
        nativeEnabled: button instanceof HTMLButtonElement && button.type === "button" && !button.disabled,
        active: document.activeElement === button, focusVisible: button.matches(":focus-visible"),
      }), originalOutside);
      await attachJSON(testInfo, stage + "-native-identity", identity);
      try {
        // Compact chrome intentionally hides its text label. Keep the original
        // strict body/ring/clip/hit checks; do not require hidden text to paint.
        const result = await verifyFocus(page, outside, testInfo, stage, { checkVisibleControls: !open });
        expect(identity, stage + ": the same exact native outside control").toEqual(
          Object.fromEntries(Object.keys(identity).map(key => [key, true])));
        expect(result.focus.raw.width, stage + ": native target width").toBeGreaterThanOrEqual(44);
        expect(result.focus.raw.height, stage + ": native target height").toBeGreaterThanOrEqual(44);
        await expect(menu.locator(".ui-popover-panel:popover-open")).toHaveCount(open ? 1 : 0);
        await expect(trigger).toHaveAttribute("aria-expanded", String(open));
        coverage.verifiedFocusStages.push(stage);
      } finally {
        await unchanged(stage + "-custody");
      }
    };
    try {
      await expect(page.locator("dialog[open]"), "No dialog may shield the outside Escape").toHaveCount(0);
      await openMenu("view-09-outside-reopen");
      await tabTo(page, links.last(), modes.length + 3);
      await expect(links.last(), "Tab departs from the last known native View link").toBeFocused();
      await page.keyboard.press("Tab");
      const stayedOpen = await panel.evaluate(element => element.matches(":popover-open"));
      coverage.outsideEscape = { branch: stayedOpen ? "OPEN_AFTER_NATIVE_TAB_EXIT" : "CLOSED_AFTER_NATIVE_TAB_EXIT",
        status: "PENDING: exact outside focus and custody must pass", completed: false };
      await attachJSON(testInfo, "view-10-native-tab-exit", { panelOpen: stayedOpen, expectedOutside: "button.context-set-trigger" });
      await observeOutside("view-10-outside-native-tab", stayedOpen);
      if (stayedOpen) {
        await expect(page.locator("dialog[open]")).toHaveCount(0);
        await expect(page.locator(":popover-open"), "Only the original View panel is open").toHaveCount(1);
        await expect(outside).toBeFocused();
        coverage.outsideEscape.status = "PENDING: Escape from the observed open-panel outside control";
        await page.keyboard.press("Escape");
        try {
          await expect(panel).not.toBeVisible();
        } finally {
          await observeOutside("view-11-outside-escape", false);
        }
        coverage.outsideEscape.status = "OBSERVED: outside Escape closed View; exact outside native focus, focused Document and raw work retained";
      } else {
        await expect(panel).not.toBeVisible();
        coverage.outsideEscape.status = "UNOBSERVED outside-open Escape: native Tab already closed View; outside focus and custody observed";
      }
      coverage.outsideEscape.completed = true;
    } finally {
      await originalOutside?.dispose();
    }
    coverage.completed = true;
  } finally {
    sessionObservation.dispose();
    page.off("framenavigated", onNavigation);
    testInfo.annotations.push({ type: "E3 coverage", description: coverage.menu });
    testInfo.annotations.push({ type: "E3 outside Escape", description: coverage.outsideEscape.status });
    await attachJSON(testInfo, "view-native-coverage", coverage);
    await retained?.dispose();
  }
});
