import { test as base, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { measureFormaFocusVisibility } from "../helpers/forma-dom-focus-visibility.mjs";
import { MODEL_PATH, syntheticMedia } from "./assets.mjs";

const origin = "http://127.0.0.1:4181";
const rootPath = fileURLToPath(new URL("../../", import.meta.url));
const fontStylesheet = new URL("https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap").href;
const copy = {
  en: { front: "Front", capture: "Use this view", forward: "Move forward", backward: "Move backward", remove: "Remove layer" },
  ar: { front: "أمام", capture: "استخدام هذا المنظر", forward: "نقل إلى الأمام", backward: "نقل إلى الخلف", remove: "إزالة الطبقة" },
};
const snapshot = page => page.evaluate(() => globalThis.formaNative3d?.snapshot() ?? null);
const attach = (testInfo, name, value) => testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: "application/json" });

const test = base.extend({ native3d: async ({ page, context }, use, testInfo) => {
  const media = syntheticMedia(), record = { modules: [], syntheticMedia: [], fontFallback: [], forbidden: [], downloads: [], pageErrors: [] };
  const locale = testInfo.project.name.includes("-ar-") ? "ar" : "en";
  page.on("pageerror", error => record.pageErrors.push(error.message));
  page.on("download", download => record.downloads.push(download.suggestedFilename()));
  await context.routeWebSocket("**/*", socket => {
    record.forbidden.push({ kind: "websocket", url: socket.url() }); socket.close();
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const receipt = { method: request.method(), origin: url.origin, path: url.pathname, resourceType: request.resourceType() };
    if (request.method() === "GET" && request.resourceType() === "stylesheet" && url.href === fontStylesheet) {
      record.fontFallback.push(receipt); await route.abort("blockedbyclient"); return;
    }
    if (url.origin === origin && request.method() === "GET" && !url.search && !url.hash && media.has(url.pathname)) {
      const asset = media.get(url.pathname); record.syntheticMedia.push(receipt);
      await route.fulfill({ status: 200, contentType: asset.mime, body: Buffer.from(asset.bytes),
        headers: { "cache-control": "no-store", "x-forma-synthetic-fixture": "native3d" } }); return;
    }
    // Exact fixture directory plus source modules/dependencies needed by real
    // components. No API fallback and no server-side application entry point.
    const modulePath = url.pathname.startsWith("/src/") || url.pathname.startsWith("/tests/model3d-native/")
      || url.pathname.startsWith("/node_modules/") || url.pathname === "/@vite/client"
      || url.pathname.startsWith("/@id/") || url.pathname.startsWith("/@fs/" + rootPath + "node_modules/");
    if (url.origin === origin && request.method() === "GET" && modulePath
      && ["document", "script", "stylesheet", "image", "font", "fetch"].includes(request.resourceType())
      && !decodeURIComponent(url.pathname).split("/").some(part => part === "..")) {
      record.modules.push(receipt); await route.continue(); return;
    }
    record.forbidden.push(receipt); await route.abort("blockedbyclient");
  });
  const api = {
    locale, copy: copy[locale],
    async open(surface) {
      await page.goto(`/tests/model3d-native/index.html?surface=${surface}&locale=${locale}`);
      await expect(page.locator("html")).toHaveAttribute("data-native3d-ready", "true");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
      const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(nodes => nodes.map(node => new URL(node.href).pathname));
      expect(styles).toEqual(["/src/styles.css", "/src/design-system.css", "/src/responsive-foundation.css"]);
      if (["workspace", "workspace-populated"].includes(surface)) {
        await expect.poll(async () => (await snapshot(page))?.outputRequirements?.state,
          { message: "The real Store admits the declared empty Output snapshot" }).toBe("ready");
      }
      const initial = await snapshot(page);
      expect(initial.initializedFromAccount).toBe(false); expect(initial.sourceActive).toBe(true);
      expect(initial.owner.actualRegistryInstance).toBe(true); expect(initial.owner.connected).toBe(true);
      expect(initial.custody.optimisticEvents).toEqual([]); expect(initial.custody.jobs).toEqual([]);
      return initial;
    },
  };
  try { await use(api); }
  finally {
    const state = await snapshot(page).catch(() => null);
    await attach(testInfo, "native3d-network-and-custody", { browser: record, fixture: state });
    expect(record.forbidden, "Undeclared requests never qualify").toEqual([]);
    expect(record.downloads, "These tests reveal files; they never authorize or initiate export").toEqual([]);
    expect(record.pageErrors).toEqual([]);
    if (state) expect(state.network.forbidden, "Application fetch has no permissive fallback").toEqual([]);
  }
} });

async function tabTo(page, target, maximum = 100) {
  await expect(target).toHaveCount(1); await expect(target).toBeVisible(); await expect(target).toBeEnabled();
  for (let index = 0; index < maximum; index++) {
    if (await target.evaluate(node => node.ownerDocument.activeElement === node)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Native Tab did not reach the expected connected control");
}
async function focusEvidence(page, target, testInfo, stage) {
  let observation;
  try {
    await expect(target).toBeFocused();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(async () => {
      observation = await target.evaluate(measureFormaFocusVisibility, { stage, requireFocusVisible: true,
        overlaySelectors: [":modal", ":popover-open"] });
      expect(observation.failures, stage).toEqual([]);
      expect(observation.unassessed, stage + ": unsupported geometry is not a pass").toEqual([]);
      expect(observation.pass).toBe(true);
    }).toPass({ timeout: 3_000, intervals: [50, 100, 200] });
  } finally {
    await attach(testInfo, stage, observation ?? { error: "Expected focused native control was unavailable" });
    await testInfo.attach(stage + "-viewport", { body: await page.screenshot(), contentType: "image/png" });
  }
  const width = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(width.scroll, stage + ": document has no horizontal spill").toBeLessThanOrEqual(width.client + 1);
}
async function openComposition(page, native3d, testInfo) {
  const initial = await native3d.open("composition");
  const opener = page.locator("forma-reference-composition-editor > button");
  await tabTo(page, opener); await page.keyboard.press("Enter");
  const dialog = page.locator("forma-reference-composition-editor dialog.reference-compositor:modal");
  await expect(dialog).toHaveCount(1);
  await expect(dialog.locator(".reference-compositor-layer-list > li")).toHaveCount(2);
  // Chromium can initially focus the keyboard-scrollable modal card. The
  // product has no autofocus contract naming Close; require owned native focus
  // first, then use actual Tab to reach and measure the Close control.
  const entryFocus = await dialog.evaluate(node => ({
    contained: node.contains(node.ownerDocument.activeElement),
    activeTag: node.ownerDocument.activeElement?.tagName,
    activeClass: node.ownerDocument.activeElement?.getAttribute("class"),
  }));
  await attach(testInfo, "composition-native-entry-focus", entryFocus);
  expect(entryFocus.contained).toBe(true);
  await tabTo(page, dialog.locator(".modal-close"));
  await focusEvidence(page, dialog.locator(".modal-close"), testInfo, "composition-close-native-tab-focus");
  return { initial, opener, dialog };
}

test("real model preset captures a local square reference with the selected camera", async ({ page, native3d }, testInfo) => {
  const initial = await native3d.open("viewer");
  const viewer = page.locator("forma-model3d-viewer"), canvas = viewer.locator("canvas.model3d-viewer-canvas");
  await expect(canvas).toHaveCount(1);
  await expect(viewer.locator(".model3d-viewer-frame")).toHaveAttribute("aria-busy", "false");
  await tabTo(page, canvas); await expect(canvas).toBeFocused();
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("Home");
  const front = viewer.getByRole("button", { name: native3d.copy.front, exact: true });
  await tabTo(page, front); await focusEvidence(page, front, testInfo, "model-front-preset-focus");
  await page.keyboard.press("Enter");
  const capture = viewer.getByRole("button", { name: native3d.copy.capture, exact: true });
  await tabTo(page, capture); await focusEvidence(page, capture, testInfo, "model-capture-control-focus");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await snapshot(page)).captures.length).toBe(1);
  const after = await snapshot(page), saved = after.captures[0];
  expect(saved.src).toBe(MODEL_PATH); expect(saved.mime).toBe("image/png");
  expect([saved.width, saved.height]).toEqual([1024, 1024]); expect(saved.byteLength).toBeGreaterThan(128);
  expect(saved.sha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(saved.view.position).toEqual([0, 0, 6.4]); expect(saved.view.target).toEqual([0, 0, 0]);
  expect(after.custody).toEqual(initial.custody); expect(after.saves).toEqual([]);
});

test("real editor closes by Escape and Close before unmounting and restores its original opener", async ({ page, native3d }, testInfo) => {
  const { initial, opener, dialog } = await openComposition(page, native3d, testInfo);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  await focusEvidence(page, opener, testInfo, "composition-escape-opener-focus");
  await page.keyboard.press("Enter"); await expect(dialog).toHaveCount(1);
  const close = dialog.locator(".modal-close");
  await tabTo(page, close); await page.keyboard.press("Enter"); await expect(dialog).toHaveCount(0);
  await focusEvidence(page, opener, testInfo, "composition-close-opener-focus");
  const after = await snapshot(page); expect(after.custody).toEqual(initial.custody); expect(after.saves).toEqual([]);
});

test("pending composition save survives its own canonical update and restores native opener focus", async ({ page, native3d }, testInfo) => {
  const { initial, opener, dialog } = await openComposition(page, native3d, testInfo);
  const use = dialog.locator(".reference-compositor-card > footer .button.primary");
  await tabTo(page, use); await focusEvidence(page, use, testInfo, "composition-save-focus");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await snapshot(page)).pendingSave).toBe(true);
  await expect(dialog).toHaveAttribute("closedby", "none"); await expect(use).toBeDisabled();
  await expect(opener).toBeEnabled();
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(1);
  expect((await snapshot(page)).saves).toHaveLength(1);
  await page.evaluate(() => globalThis.formaNative3d.completeSyntheticSave());
  await expect(dialog).toHaveCount(0);
  await focusEvidence(page, opener, testInfo, "composition-save-opener-focus");
  const after = await snapshot(page), saved = after.saves[0];
  expect(saved.renderBeforeResolution).toEqual({ sameChild: true, nativeModal: true, openerEnabled: true, canonicalHashUpdated: true });
  expect(saved.completed).toBe(true); expect(saved.mime).toBe("image/png"); expect(saved.byteLength).toBeGreaterThan(128);
  expect(after.pendingSave).toBe(false); expect(after.custody.events.length).toBe(initial.custody.events.length + 3);
  expect(after.custody.events.slice(0, initial.custody.events.length)).toEqual(initial.custody.events);
  expect(after.custody.optimisticEvents).toEqual([]); expect(after.custody.content).toEqual(initial.custody.content);
  expect(after.custody.session).toEqual(initial.custody.session); expect(after.custody.jobs).toEqual([]);
});

test("layer order boundaries and removing the final layer keep focus on an enabled owned peer", async ({ page, native3d }, testInfo) => {
  const { initial, opener, dialog } = await openComposition(page, native3d, testInfo);
  const layers = dialog.locator(".reference-compositor-layer-list > li > button");
  const before = await layers.allTextContents();
  const forward = dialog.getByRole("button", { name: native3d.copy.forward, exact: true });
  const backward = dialog.getByRole("button", { name: native3d.copy.backward, exact: true });
  const remove = dialog.getByRole("button", { name: native3d.copy.remove, exact: true });
  await tabTo(page, backward); await page.keyboard.press("Enter");
  await expect(backward).toBeDisabled(); expect(await layers.allTextContents()).toEqual([...before].reverse());
  await focusEvidence(page, forward, testInfo, "composition-rear-boundary-peer");
  await page.keyboard.press("Enter"); await expect(forward).toBeDisabled();
  expect(await layers.allTextContents()).toEqual(before);
  await focusEvidence(page, backward, testInfo, "composition-front-boundary-peer");
  await tabTo(page, remove); await page.keyboard.press("Enter"); await expect(layers).toHaveCount(1);
  await focusEvidence(page, remove, testInfo, "composition-remaining-layer-remove-focus");
  await page.keyboard.press("Enter"); await expect(layers).toHaveCount(0);
  await focusEvidence(page, dialog.locator(".reference-compositor-source-list > button").first(), testInfo, "composition-empty-source-peer");
  await page.keyboard.press("Tab");
  await focusEvidence(page, dialog.locator(".reference-compositor-source-list > button").nth(1), testInfo, "composition-next-source-native-tab-focus");
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  expect((await snapshot(page)).custody).toEqual(initial.custody);
});

test("actual Workspace creates a model context draft through its native choice card", async ({ page, native3d }, testInfo) => {
  for (const [surface, selector, blockIds] of [
    ["workspace", ".blank-context > button", []],
    ["workspace-populated", "button.add-block", ["native3d-direction"]],
  ]) {
    const initial = await native3d.open(surface), invokerReceipts = [];
    let originalInvoker;
    try {
      expect(initial.surface).toBe(surface);
      expect(initial.scaffold).toMatchObject({ kind: "structural-only", rootTag: "div", directOwnerChain: true,
        applicationUnregistered: true, navPosture: native3d.locale === "ar" ? "compact" : "expanded",
        shortHeight: "false", layoutIntent: "workbench", documentFocus: false });
      expect(initial.network.forbidden).toEqual([]);
      expect(initial.network.reads.filter(value => value.source === "declared-empty-synthetic-review-resume")).toHaveLength(1);
      expect(initial.network.reads.filter(value => value.source === "declared-empty-synthetic-output-requirements")).toHaveLength(1);
      expect(initial.outputRequirements).toMatchObject({ state: "ready", error: null, snapshot: {
        requirements: [], confirmedPlan: null, targetStates: [], summary: null, assets: [], results: [], grants: [],
      } });
      expect(initial.custody.events.filter(event => event.type === "BlockCreated").map(event => event.payload.block_id)).toEqual(blockIds);
      const workspace = page.locator("forma-workspace");
      const opener = workspace.locator("#document-context-panel " + selector);
      await tabTo(page, opener);
      originalInvoker = await opener.elementHandle();
      expect(originalInvoker).not.toBeNull();
      const inspectInvoker = async stage => {
        const state = await originalInvoker.evaluate(node => ({ connected: node.isConnected,
          focused: node.ownerDocument.activeElement === node }));
        invokerReceipts.push({ stage, ...state });
        expect(state.connected, surface + ": the original invoker remains mounted").toBe(true);
        return state;
      };
      expect((await inspectInvoker("before-open")).focused).toBe(true);
      await page.keyboard.press("Enter");
      const dialog = workspace.locator("dialog.block-composer-dialog:modal"); await expect(dialog).toHaveCount(1);
      await inspectInvoker("native-modal-open");
      const model = dialog.locator('button[data-choice-value="model3d"]');
      await tabTo(page, model); await focusEvidence(page, model, testInfo, surface + "-model-context-choice");
      await page.keyboard.press("Enter");
      const file = dialog.locator('.reference-choice input[type="file"]');
      await expect(file).toHaveCount(1); await expect(file).toHaveAttribute("accept", ".glb,model/gltf-binary");
      await expect(file).toBeEnabled();
      await inspectInvoker("model-choice-open");
      await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
      expect((await inspectInvoker("after-escape")).focused).toBe(true);
      expect(await opener.evaluate((node, original) => node === original, originalInvoker)).toBe(true);
      await focusEvidence(page, opener, testInfo, surface + "-model-context-return-focus");
    } finally {
      const after = await snapshot(page);
      await attach(testInfo, surface + "-network-and-custody", { initial, final: after, invoker: invokerReceipts });
      expect(after.custody).toEqual(initial.custody);
      expect(after.outputRequirements).toEqual(initial.outputRequirements);
      expect(after.scaffold).toEqual(initial.scaffold);
      expect(after.network.forbidden, surface + ": application fetch remains closed before navigation").toEqual([]);
      expect(after.saves).toEqual([]); expect(after.captures).toEqual([]);
      await originalInvoker?.dispose();
    }
  }
});

test("output header export reveals and focuses an offscreen original model file without downloading", async ({ page, native3d }, testInfo) => {
  const initial = await native3d.open("artifact");
  const owner = page.locator("forma-document-artifacts"), opener = owner.locator('.document-artifact-list > button[data-forma-content="primary"]');
  await tabTo(page, opener); await page.keyboard.press("Enter");
  const dialog = owner.locator('dialog.document-artifact-view[data-artifact-kind="model3d"]:modal');
  await expect(dialog).toHaveCount(1); await expect(dialog.locator("canvas.model3d-viewer-canvas")).toHaveCount(1);
  const files = dialog.locator(".model3d-output-files .artifact-export-choice"), first = files.first();
  await expect(files).toHaveCount(2); await expect(dialog.locator("[data-artifact-export]")).toHaveCount(2);
  const primary = dialog.locator(".artifact-viewer-review-toggle");
  await expect(primary).toHaveAttribute("aria-controls", "artifact-model3d-files-native3d-artifact");
  expect(await primary.getAttribute("aria-expanded")).toBeNull();
  await tabTo(page, primary);
  const before = await first.evaluate(node => {
    const content = node.closest(".document-artifact-reader-content"), body = node.getBoundingClientRect(), clip = content.getBoundingClientRect();
    return { belowContent: body.bottom > clip.bottom, scrollTop: content.scrollTop, body: body.toJSON(), clip: clip.toJSON() };
  });
  await attach(testInfo, "model-export-before-reveal", before); expect(before.belowContent).toBe(true);
  await page.keyboard.press("Enter");
  await focusEvidence(page, first, testInfo, "model-original-file-keyboard-reveal");
  await expect(dialog.locator("forma-ui-popover :popover-open")).toHaveCount(0);
  const after = await snapshot(page); expect(after.custody).toEqual(initial.custody);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  await focusEvidence(page, opener, testInfo, "model-export-viewer-return-focus");
});

test("complete output-kind rail reaches 3D by native radio navigation in the full stylesheet cascade", async ({ page, native3d }, testInfo) => {
  const initial = await native3d.open("artifact");
  const owner = page.locator("forma-document-artifacts"), opener = owner.locator(".document-artifacts > header > button");
  await tabTo(page, opener); await page.keyboard.press("Enter");
  const dialog = owner.locator("dialog.document-artifact-create:modal"), picker = dialog.locator(".artifact-kind-picker");
  await expect(dialog).toHaveCount(1);
  const radios = picker.locator('input[type="radio"]'); await expect(radios).toHaveCount(7);
  const first = picker.locator('input[value="short_story"]'), model = picker.locator('input[value="model3d"]');
  await expect(first).toBeChecked(); await tabTo(page, first);
  // ArrowUp wraps from the first to last radio; it does not open any intermediate
  // Scene/payment/recovery form or invoke a request inspector.
  await page.keyboard.press("ArrowUp"); await expect(model).toBeChecked();
  await focusEvidence(page, model, testInfo, "output-model-kind-radio-focus");
  const geometry = await picker.evaluate(node => ({
    autoFlow: getComputedStyle(node).gridAutoFlow,
    padding: getComputedStyle(node).scrollPaddingInlineStart,
    clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
    cards: [...node.querySelectorAll(":scope > label")].map(label => ({ text: label.textContent.trim(), rect: label.getBoundingClientRect().toJSON() })),
    rect: node.getBoundingClientRect().toJSON(),
  }));
  await attach(testInfo, "output-kind-rail-geometry", geometry);
  expect(geometry.autoFlow).toBe("column"); expect(geometry.cards).toHaveLength(7);
  expect(new Set(geometry.cards.map(card => card.rect.top)).size).toBe(1);
  const modelCard = geometry.cards.at(-1).rect;
  expect(modelCard.left).toBeGreaterThanOrEqual(geometry.rect.left);
  expect(modelCard.right).toBeLessThanOrEqual(geometry.rect.right);
  await expect(dialog.locator("forma-model3d-settings-editor")).toHaveCount(1);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  expect((await snapshot(page)).custody).toEqual(initial.custody);
});
