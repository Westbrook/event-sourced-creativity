import { test, expect, attachJSON, openForma } from "./fixtures.mjs";
import { documentPath, waitForExistingDocument, savedArticles, verifyFocus, tabTo } from "./helpers/keyboard-journey.mjs";

const copy = {
  en: { direction: "ltr", view: "Change view · Document", open: "Ask Forma",
    close: "Close Forma assistant", heading: "Forma assistant", message: "Message Forma" },
  ar: { direction: "rtl", view: "تغيير العرض · مستند", open: "اسأل Forma",
    close: "إغلاق مساعد Forma", heading: "مساعد Forma", message: "أرسل رسالة إلى Forma" },
};

test("Coarse Studio Assistant retains a visible native utility cell and current Close/Escape return", async ({ page, context, geometry }, testInfo) => {
  const expected = copy[(geometry.locale ?? "en-US").split("-")[0]];
  const workspace = page.locator("forma-workspace");
  const nav = workspace.locator("forma-studio-mode-nav[active=document]");
  const view = nav.locator("forma-ui-popover.studio-view-menu > .ui-popover > button.ui-popover-trigger");
  const panel = page.locator(".application-creative > forma-creative-assistant > forma-assistant-panel");
  const launcher = panel.locator(":scope > button.forma-assistant-launcher");
  const dialog = panel.locator(":scope > section.forma-assistant-panel");
  const input = dialog.locator("textarea.forma-assistant-input");
  const close = dialog.locator(".forma-assistant-header > button.forma-assistant-close");
  const coverage = { completed: false, stages: [], observedReads: [],
    limits: "Chromium-rendered coarse-pointer media with native keyboard input, not physical touch hardware. Only current View focus and Assistant open/Close/Escape; no Send, Review, Accept, route activation, new draft, provider or AT claim." };
  const navigations = [], priorLaunchers = [];
  const onNavigation = frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); };
  let retained, articles, firstInputValue;

  const media = () => page.evaluate(() => ({
    coarse: matchMedia("(pointer: coarse)").matches, fine: matchMedia("(pointer: fine)").matches,
    hoverNone: matchMedia("(hover: none)").matches, hoverHover: matchMedia("(hover: hover)").matches,
    maxTouchPoints: navigator.maxTouchPoints,
    language: document.documentElement.lang, direction: document.documentElement.dir,
  }));
  const assertMedia = evidence => {
    expect(evidence).toMatchObject({ coarse: true, fine: false, hoverNone: true, hoverHover: false,
      language: geometry.locale ?? "en-US", direction: expected.direction });
    expect(evidence.maxTouchPoints).toBeGreaterThan(0);
  };
  const unchanged = async stage => {
    const evidence = await retained.evaluate(state => state.inspect());
    evidence.savedArticlesEqual = JSON.stringify(await savedArticles(page)) === JSON.stringify(articles);
    evidence.mainFrameNavigations = [...navigations];
    await attachJSON(testInfo, stage + "-custody", evidence);
    expect(evidence.checks).toEqual(Object.fromEntries(Object.keys(evidence.checks).map(key => [key, true])));
    expect(evidence.fields.every(field => field.sameOwner && field.valueEqual)).toBe(true);
    expect(evidence.savedArticlesEqual).toBe(true);
    expect(evidence.mainFrameNavigations).toEqual([]);
  };
  const readSlot = () => panel.evaluate(element => {
    const shell = element.closest(".application-creative");
    const host = shell.querySelector("#main-content .studio-header-stack > forma-studio-mode-nav");
    const nativeNav = host?.querySelector(":scope > .studio-mode-nav");
    const button = element.querySelector(":scope > button.forma-assistant-launcher");
    if (!host || !nativeNav) return { error: "No actual current Studio slot owner" };
    const style = getComputedStyle(host);
    return {
      direction: style.direction, display: style.display,
      reservation: style.getPropertyValue("--forma-assistant-studio-slot").trim(),
      columns: style.gridTemplateColumns.trim().split(/\s+/u).map(Number.parseFloat),
      gap: Number.parseFloat(style.columnGap),
      host: host.getBoundingClientRect().toJSON(), nav: nativeNav.getBoundingClientRect().toJSON(),
      logicalEndInset: style.direction === "rtl"
        ? Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft)
        : Number.parseFloat(style.borderRightWidth) + Number.parseFloat(style.paddingRight),
      marker: element.dataset.studioLauncher ?? null,
      compact: element.dataset.compactLauncher ?? null, tight: element.dataset.tightLauncher ?? null,
      coordinates: ["left", "top", "size"].map(name => element.style.getPropertyValue("--forma-assistant-studio-" + name)),
      floatingOffset: element.style.getPropertyValue("--forma-assistant-obstacle-offset"),
      directNativeButton: button instanceof HTMLButtonElement && button.isConnected && button.parentElement === element,
      launcherHovered: button?.matches(":hover") ?? null,
    };
  });
  const observe = async (target, stage, open = false) => {
    const result = await verifyFocus(page, target, testInfo, stage, { checkVisibleControls: !open });
    expect(result.focus.raw.width).toBeGreaterThanOrEqual(44);
    expect(result.focus.raw.height).toBeGreaterThanOrEqual(44);
    coverage.stages.push(stage);
    return result;
  };
  const closedSlot = async stage => {
    await expect(dialog).toHaveCount(0);
    await expect(launcher).toHaveCount(1);
    await expect(launcher).toBeEnabled();
    await expect(launcher).toHaveAccessibleName(expected.open);
    const focused = await observe(launcher, stage);
    const slot = await readSlot(), pointer = await media();
    await attachJSON(testInfo, stage + "-utility-cell", { slot, pointer });
    assertMedia(pointer);
    expect(slot).toMatchObject({ direction: expected.direction, display: "grid", reservation: "1",
      marker: "true", compact: "true", tight: "true", directNativeButton: true, floatingOffset: "" });
    expect(slot.columns).toHaveLength(2);
    expect(slot.columns.every(Number.isFinite)).toBe(true);
    expect(slot.columns[0]).toBeGreaterThan(0);
    expect(slot.columns[1]).toBe(48);
    expect(slot.gap).toBeGreaterThanOrEqual(8);
    expect(slot.logicalEndInset).toBeGreaterThanOrEqual(8);
    expect(focused.focus.raw.width).toBe(48);
    expect(focused.focus.raw.height).toBe(48);
    expect(focused.focus.outlineExtent).toBe(0);
    expect(focused.focus.boxShadow).toBe("none");
    expect(focused.focus.raw.top).toBeGreaterThanOrEqual(slot.host.top);
    expect(focused.focus.raw.bottom).toBeLessThanOrEqual(slot.host.bottom);
    if (expected.direction === "rtl") {
      expect(focused.focus.raw.right + slot.gap).toBeLessThanOrEqual(slot.nav.left);
      expect(focused.focus.raw.left).toBeGreaterThanOrEqual(slot.host.left + slot.logicalEndInset);
    } else {
      expect(slot.nav.right + slot.gap).toBeLessThanOrEqual(focused.focus.raw.left);
      expect(focused.focus.raw.right).toBeLessThanOrEqual(slot.host.right - slot.logicalEndInset);
    }
    await unchanged(stage);
  };

  try {
    expect(Boolean(expected)).toBe(true);
    expect(geometry.hasTouch, "Only the two explicit coarse projects run this addition").toBe(true);
    await openForma(page, context, geometry, documentPath, testInfo);
    await waitForExistingDocument(page);
    const pointer = await media();
    await attachJSON(testInfo, "assistant-coarse-media", pointer);
    assertMedia(pointer);
    await expect(nav).toHaveCount(1);
    await expect(panel, "Reuse the actual enabled floating Assistant; never create an owner or fake authority").toHaveCount(1);
    await expect(view, "The existing local author Document must really expose View").toHaveCount(1);
    await expect(view).toHaveAccessibleName(expected.view);
    await expect(workspace.locator(".document-title-row > h1")).toHaveCount(1);
    articles = await savedArticles(page);
    retained = await workspace.evaluateHandle(element => {
      const shell = element.closest(".application-creative");
      const owner = shell.querySelector(":scope > forma-creative-assistant");
      const panel = owner.querySelector(":scope > forma-assistant-panel");
      const nav = element.querySelector("forma-studio-mode-nav[active=document]");
      const title = element.querySelector(".document-title-row > h1"), titleText = title.textContent;
      const href = location.href, length = history.length;
      const posture = document.documentElement.getAttribute("data-document-focus");
      const value = field => JSON.stringify([field.value, Boolean(field.checked),
        field.tagName === "SELECT" ? [...field.options].map(option => option.selected) : null]);
      const fields = [...element.querySelectorAll("input,textarea,select")].map((node, index) => ({
        node, index, tag: node.tagName, type: node.type, value: value(node),
      }));
      return { inspect: () => {
        const currentFields = [...element.querySelectorAll("input,textarea,select")];
        return { checks: {
          workspace: element.isConnected && document.querySelector("forma-workspace") === element,
          shell: shell.isConnected && element.closest(".application-creative") === shell,
          assistantOwner: owner.isConnected && owner.parentElement === shell && panel.isConnected
            && owner.querySelector(":scope > forma-assistant-panel") === panel,
          navigation: nav.isConnected && element.querySelector("forma-studio-mode-nav[active=document]") === nav,
          title: title.isConnected && element.querySelector(".document-title-row > h1") === title && title.textContent === titleText,
          fields: currentFields.length === fields.length && fields.every((field, index) => currentFields[index] === field.node),
          route: location.href === href, historyLength: history.length === length,
          documentFocusPosture: document.documentElement.getAttribute("data-document-focus") === posture,
        }, fields: fields.map(field => ({ index: field.index, tag: field.tag, type: field.type,
          sameOwner: field.node.isConnected && element.contains(field.node), valueEqual: value(field.node) === field.value })) };
      } };
    });
    page.on("framenavigated", onNavigation);
    await unchanged("assistant-coarse-00-initial");
    await tabTo(page, view);
    const viewFocus = await observe(view, "assistant-coarse-01-view-trigger");
    expect(viewFocus.focus.raw.height).toBeGreaterThanOrEqual(48);
    await expect(view).toHaveAttribute("aria-expanded", "false");
    await tabTo(page, launcher);
    await closedSlot("assistant-coarse-02-launcher");

    for (const action of ["close-button", "escape"]) {
      await expect(launcher).toBeFocused();
      const original = await launcher.elementHandle();
      expect(original).not.toBeNull();
      priorLaunchers.push(original);
      const expectedOrigin = new URL(page.url()).origin;
      const [reply] = await Promise.all([
        page.waitForResponse(response => {
          const request = response.request(), url = new URL(response.url());
          return request.method() === "GET" && request.frame() === page.mainFrame()
            && url.origin === expectedOrigin && url.pathname === "/api/assistant"
            && url.searchParams.get("route") === documentPath;
        }, { timeout: 10_000 }),
        page.keyboard.press("Enter"),
      ]);
      expect(reply.ok(), "Observe the app's real permitted Assistant history GET").toBe(true);
      expect(await reply.finished()).toBeNull();
      coverage.observedReads.push({ path: "/api/assistant", method: "GET", status: reply.status(),
        note: "GET may perform existing schema/legacy-task housekeeping; no paid-work or universal zero-DB-write claim." });
      await expect(dialog).toHaveAttribute("role", "dialog");
      await expect(dialog).toHaveAttribute("aria-modal", "false");
      await expect(dialog).toHaveAccessibleName(expected.heading);
      await expect(input).toHaveAccessibleName(expected.message);
      await expect(input).toBeEnabled();
      await expect(launcher).toHaveCount(0);
      expect(await original.evaluate(button => button.isConnected), "Opening retires the old launcher DOM node").toBe(false);
      await observe(input, "assistant-coarse-" + action + "-opened-input", true);
      const currentValue = await input.inputValue();
      if (firstInputValue === undefined) firstInputValue = currentValue;
      expect(currentValue === firstInputValue, "The unsent native Assistant value remains unchanged across reopen").toBe(true);
      const openSlot = await readSlot();
      await attachJSON(testInfo, "assistant-coarse-" + action + "-open-slot", openSlot);
      expect(openSlot).toMatchObject({ display: "grid", reservation: "1", marker: null, floatingOffset: "" });
      expect(openSlot.columns[1]).toBe(48);
      expect(openSlot.coordinates).toEqual(["", "", ""]);
      await unchanged("assistant-coarse-" + action + "-open");
      if (action === "close-button") {
        await tabTo(page, close, 80, "Shift+Tab");
        await expect(close).toHaveAccessibleName(expected.close);
        await observe(close, "assistant-coarse-close-button-native", true);
        await page.keyboard.press("Enter");
      } else {
        await expect(input).toBeFocused();
        await page.keyboard.press("Escape");
      }
      await closedSlot("assistant-coarse-" + action + "-return");
      const currentReturn = await launcher.evaluate((button, prior) => ({
        currentNative: button instanceof HTMLButtonElement && button.isConnected && button.parentElement.matches("forma-assistant-panel"),
        replacedRetiredButton: button !== prior && !prior.isConnected,
        active: document.activeElement === button, focusVisible: button.matches(":focus-visible"),
      }), original);
      await attachJSON(testInfo, "assistant-coarse-" + action + "-current-return", currentReturn);
      expect(currentReturn).toEqual(Object.fromEntries(Object.keys(currentReturn).map(key => [key, true])));
    }
    coverage.completed = true;
  } finally {
    page.off("framenavigated", onNavigation);
    await attachJSON(testInfo, "assistant-coarse-coverage", coverage);
    await retained?.dispose();
    for (const previous of priorLaunchers) await previous?.dispose();
  }
});
