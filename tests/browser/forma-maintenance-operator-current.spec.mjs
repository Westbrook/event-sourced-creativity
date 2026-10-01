// Actual current Product frontend with a finite, explicitly synthetic operator protocol.
// Three source-declared journeys × four existing profiles; no execution is asserted here.
// No Worker/DB/provider request or production permission/adoption qualification.
import { test as base, expect, applyBrowserZoom, captureViewport, browserMetrics } from "./fixtures.mjs";
import { tabTo, verifyFocus } from "./helpers/keyboard-journey.mjs";
import { syntheticNetworkEnabled } from "./helpers/synthetic-network.mjs";
import { installMaintenanceOperatorFixture, installMaintenanceRetirementObserver } from "./helpers/maintenance-operator-browser-fixture.mjs";

const qualification = Object.freeze({
  application: "Actual current Product frontend and native DOM; finite synthetic Product session/material/operator responses",
  protocol: "Synthetic immutable original proposal/receipt simulation, not a genuine backend commit or permission proof",
  lifecycle: "Native guarded navigation plus explicitly synthetic public platformSession.reset retirement",
  input: "Playwright mouse/keyboard and emulated touch/composition; no physical touchscreen, OS IME or assistive-technology claim",
  zoom: "Existing chrome.tabs.setZoom helper and observed CSS×DPR-once screenshot contract; no CSS scale/pinch substitute",
  unavailable: "No Worker/DB/provider, source capture, durable registration/adoption, general-editor mutation or generation availability",
});
const attach = (info, name, observation) => info.attach(name, { body: JSON.stringify({ qualification, observation }, null, 2), contentType: "application/json" });
const review = page => page.locator("forma-experience-review");
const adoption = page => review(page).locator("form[data-experience-adoption-proposal]");
const action = page => review(page).locator("form[data-experience-action]");
const maintenance = page => review(page).locator("details[data-experience-maintenance]");
const translated = (page, key) => review(page).evaluate((element, key) => element.i18n.t("experience.review." + key, key), key);
const activate = (locator, geometry) => geometry.hasTouch ? locator.tap() : locator.click();
const values = form => form.evaluate(element => Object.fromEntries(new FormData(element)));
const epoch = form => form.getAttribute("data-experience-adoption-owner");
const commandCount = api => api.snapshot().commands.length;
const operationCount = api => api.snapshot().calls.filter(call => /\/maintenance\/(?:adoption-proposals|adoption-operations\/)/u.test(call.path)).length;

const test = base.extend({
  operator: async ({ context, page, baseURL }, use, info) => {
    expect(syntheticNetworkEnabled(baseURL)).toBe(true);
    const api = await installMaintenanceOperatorFixture(context, baseURL), errors = [];
    const onError = error => errors.push(error);
    page.on("pageerror", onError);
    let failed = false, primary;
    try { await use(api); } catch (error) { failed = true; primary = error; }
    const cleanup = [];
    try { await api.close(); } catch (error) { cleanup.push(error); }
    page.off("pageerror", onError);
    try { await attach(info, "operator-finite-transport", api.snapshot()); } catch (error) { cleanup.push(error); }
    try {
      const saved = api.snapshot();
      expect(saved.errors).toEqual([]);
      expect(saved.commands.length).toBeLessThanOrEqual(1);
      expect(saved.originals.length).toBeLessThanOrEqual(1);
      expect(saved.calls.filter(call => call.method === "GET" && call.path.includes("/maintenance/adoption-operations/")).length).toBeLessThanOrEqual(1);
    } catch (error) { cleanup.push(error); }
    cleanup.push(...errors);
    if (failed && cleanup.length) throw new AggregateError([primary, ...cleanup], "Operator journey and fixture closure failed");
    if (failed) throw primary;
    if (cleanup.length) throw new AggregateError(cleanup, "Operator fixture closure failed");
  },
});

// Retain native handles only for identity assertions; cleanup never replaces the
// original assertion/error, including a thrown non-Error value.
async function withHandles(locators, run) {
  const handles = [], cleanup = [];
  let failed = false, primary;
  try {
    for (const locator of locators) {
      const handle = await locator.elementHandle();
      expect(handle).not.toBe(null); handles.push(handle);
    }
    await run(handles);
  } catch (error) { failed = true; primary = error; }
  finally {
    for (const handle of handles) {
      try { await handle.dispose(); } catch (error) { cleanup.push(error); }
    }
  }
  if (failed && cleanup.length) throw new AggregateError([primary, ...cleanup], "Operator assertion and retained-handle cleanup failed");
  if (failed) throw primary;
  if (cleanup.length) throw new AggregateError(cleanup, "Operator retained-handle cleanup failed");
}

async function openProduct(page, context, geometry, api, info) {
  const response = await page.goto("/product/delivery", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.locator("forma-platform-shell")).toBeAttached();
  await expect(page.locator("forma-product-delivery .role-dashboard")).toBeVisible();
  await expect(review(page).locator(".experience-review-candidates button")).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("lang", geometry.locale ?? "en-US");
  await expect(page.locator("html")).toHaveAttribute("dir", (geometry.locale ?? "en-US").startsWith("ar") ? "rtl" : "ltr");
  await page.evaluate(() => document.fonts.ready);
  const zoom = await applyBrowserZoom(page, context, geometry.zoom, info);
  const metrics = await browserMetrics(page);
  if (geometry.zoom === 2) {
    expect(geometry.viewport).toBe(null);
    expect(geometry.window).toEqual({ width: 838, height: 884 });
  }
  if (geometry.hasTouch) {
    const touch = await page.evaluate(() => ({ coarse: matchMedia("(pointer:coarse)").matches, points: navigator.maxTouchPoints }));
    expect(touch.coarse).toBe(true); expect(touch.points).toBeGreaterThan(0);
    await attach(info, "operator-touch-emulation", touch);
  }
  await attach(info, "operator-admission", { project: info.project.name, geometry, zoom, metrics, actor: api.actor,
    initialOperationCount: operationCount(api) });
  expect(operationCount(api)).toBe(0);
}
async function selectCandidate(page, geometry) {
  await activate(review(page).locator(".experience-review-candidates button"), geometry);
  await expect(maintenance(page)).toBeAttached();
  await expect(review(page).locator(".experience-review-selected")).toBeVisible();
}
async function loadNominations(page, geometry) {
  const details = maintenance(page);
  if (!await details.evaluate(element => element.open)) await activate(details.locator(":scope > summary"), geometry);
  await activate(review(page).locator("[data-experience-adoption-load]"), geometry);
  await expect(adoption(page)).toBeVisible();
  await expect(adoption(page).locator('select[name="nomination"] option:not([value=""])')).toHaveCount(1);
}
async function fillAdoption(page, api, title = "  Baseline A 日本語  ") {
  const form = adoption(page);
  await form.locator('select[name="nomination"]').selectOption(api.bindingHash);
  await form.locator('input[name="title"]').fill(title);
  await form.locator('textarea[name="evidence"]').fill("  Original evidence A\nنور 文書  ");
  return values(form);
}
async function checkGeometry(page, info, name, geometry) {
  const measured = await review(page).evaluate(root => {
    const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const visible = node => {
      if (!node.getClientRects().length || getComputedStyle(node).visibility === "hidden" || node.closest("[hidden],[inert]")) return false;
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.localName === "details" && !ancestor.open && !ancestor.querySelector(":scope > summary")?.contains(node)) return false;
      }
      return true;
    };
    const controls = [...root.querySelectorAll("button,input,select,textarea,summary")].filter(visible).map(node => {
      const css = getComputedStyle(node); return { tag: node.localName, ...box(node), fontSize: Number.parseFloat(css.fontSize), display: css.display, marker: css.listStyleType };
    });
    const rows = [...root.querySelectorAll(".experience-review-actions")].filter(visible).map(node => ({
      bounds: box(node), gap: Number.parseFloat(getComputedStyle(node).gap), controls: [...node.children].filter(child => child.matches("button") && visible(child)).map(box),
    }));
    return { direction: getComputedStyle(root.querySelector(".experience-review")).direction,
      clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, controls, rows };
  });
  const failures = [];
  try { await attach(info, name, measured); } catch (error) { failures.push(error); }
  try { await captureViewport(page, info, name); } catch (error) { failures.push(error); }
  try {
  expect(measured.direction).toBe((geometry.locale ?? "en-US").startsWith("ar") ? "rtl" : "ltr");
  expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth + 1);
  expect(measured.controls.length).toBeGreaterThan(0);
  for (const control of measured.controls) {
    expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44);
    if (["input", "select", "textarea"].includes(control.tag)) expect(control.fontSize).toBeGreaterThanOrEqual(16);
    if (control.tag === "summary") { expect(control.display).toBe("list-item"); expect(control.marker).not.toBe("none"); }
  }
  expect(measured.rows.length).toBeGreaterThan(0);
  for (const row of measured.rows) {
    expect(row.gap).toBeGreaterThanOrEqual(4);
    for (const control of row.controls) {
      expect(control.left).toBeGreaterThanOrEqual(row.bounds.left - 1);
      expect(control.right).toBeLessThanOrEqual(row.bounds.right + 1);
    }
    for (let left = 0; left < row.controls.length; left++) for (let right = left + 1; right < row.controls.length; right++) {
      const a = row.controls[left], b = row.controls[right];
      expect(Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom)).toBeGreaterThanOrEqual(4 - 0.01);
      // Retained flex:1 1 12rem + align-items:stretch promises equal controls
      // on the same visual line, not equal widths across different wrap lines.
      if (Math.abs(a.top - b.top) <= 1) {
        expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
      }
    }
  }
  } catch (error) { failures.push(error); }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "Operator geometry observation and/or assertions failed");
}
async function nativeDepartureRefused(page, geometry, api) {
  // This exact existing task is a declared synthetic navigation capability only.
  const link = page.locator('forma-platform-shell a[href="/product/insights"]');
  await expect(link).toHaveCount(1);
  const before = api.snapshot(), url = page.url();
  await activate(link, geometry);
  await expect(page).toHaveURL(url);
  await expect(page.locator("forma-product-delivery")).toBeAttached();
  expect(api.snapshot().commands).toEqual(before.commands);
  expect(api.snapshot().calls).toEqual(before.calls);
}
async function assertReplacementReset(page, form, reset, info, name, geometry) {
  await withHandles([form, reset], async ([oldForm, oldReset]) => {
  const attribute = name === "action-reset" ? "data-experience-action-owner" : "data-experience-adoption-owner";
  const priorEpoch = await form.getAttribute(attribute);
  if (geometry.hasTouch) await reset.tap();
  else { await tabTo(page, reset); await verifyFocus(page, reset, info, name + "-before", { checkVisibleControls: false }); await page.keyboard.press("Enter"); }
  await expect.poll(() => oldForm.evaluate(node => node.isConnected)).toBe(false);
  expect(await oldReset.evaluate(node => node.isConnected)).toBe(false);
  await expect(form).toBeVisible();
  expect(await form.getAttribute(attribute)).not.toBe(priorEpoch);
  await verifyFocus(page, reset, info, name + "-successor", {
    checkVisibleControls: false, requireFocusVisible: !geometry.hasTouch,
  });
  });
}

test("operator: native disclosures, select Escape and exact Reset successors retain usable action gutters", async ({ page, context, geometry, operator: api }, info) => {
  await openProduct(page, context, geometry, api, info);
  await selectCandidate(page, geometry);
  const patch = review(page).locator("details.experience-review-patch"), summary = maintenance(page).locator(":scope > summary");
  expect(await patch.evaluate(node => node.open)).toBe(false);
  expect(await maintenance(page).evaluate(node => node.open)).toBe(false);
  const beforeKeyboard = api.snapshot();
  await tabTo(page, patch.locator(":scope > summary")); await page.keyboard.press("Tab");
  await verifyFocus(page, summary, info, "closed-patch-tab-exclusion", { checkVisibleControls: false });
  await page.keyboard.press("Tab");
  await verifyFocus(page, review(page).locator('form[data-experience-proposal] input[name="title"]'), info, "closed-maintenance-tab-exclusion", { checkVisibleControls: false });
  expect(api.snapshot().commands).toEqual(beforeKeyboard.commands);
  await loadNominations(page, geometry);
  const select = adoption(page).locator('select[name="nomination"]'), beforeEscape = await select.inputValue(), callsBeforeEscape = api.snapshot().calls;
  // Fail closed when the actual engine cannot expose native popup state; a
  // Space/Escape roundtrip alone is not proof that a picker opened.
  expect(await page.evaluate(() => CSS.supports("selector(select:open)"))).toBe(true);
  await tabTo(page, select); await page.keyboard.press("Space");
  await expect.poll(() => select.evaluate(node => node.matches(":open"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => select.evaluate(node => node.matches(":open"))).toBe(false);
  await expect(select).toHaveValue(beforeEscape);
  await verifyFocus(page, select, info, "native-select-escape", { checkVisibleControls: false });
  expect(api.snapshot().calls).toEqual(callsBeforeEscape);
  await fillAdoption(page, api);
  await checkGeometry(page, info, "adoption-action-gutters", geometry);
  await nativeDepartureRefused(page, geometry, api);
  const resetCommands = commandCount(api);
  await assertReplacementReset(page, adoption(page), adoption(page).locator("[data-experience-adoption-reset]"), info, "adoption-reset", geometry);
  expect(await values(adoption(page))).toEqual({ nomination: "", title: "", ownerUserId: api.actor, evidence: "" });
  expect(commandCount(api)).toBe(resetCommands);
  await fillAdoption(page, api);
  const gate = api.arm("proposal");
  await activate(adoption(page).locator("[data-experience-adoption-propose]"), geometry);
  const original = await gate.response; gate.release();
  await expect(review(page).locator("[data-experience-acknowledgment]")).toContainText(original.body.receipt.eventId);
  const decisionId = original.body.result.decision.decisionId;
  await activate(page.locator(`[data-experience-decision-review="${decisionId}"]`), geometry);
  await expect(action(page)).toBeVisible();
  // Reserved Maintenance decisions must not fall through the generic delivery editor.
  await expect(page.locator(`[data-delivery-editor-toggle="${decisionId}"]`)).toHaveCount(0);
  await expect(page.locator(`form[data-delivery-decision-id="${decisionId}"]`)).toHaveCount(0);
  const saved = await values(action(page));
  await action(page).locator('textarea[name="evidence"]').fill("  Unrecorded action B نور  ");
  await checkGeometry(page, info, "decision-action-gutters", geometry);
  const commands = commandCount(api);
  await assertReplacementReset(page, action(page), action(page).locator("button.experience-review-action-reset"), info, "action-reset", geometry);
  expect(await values(action(page))).toEqual(saved);
  expect(commandCount(api)).toBe(commands);
  expect(commands).toBe(1);
});

test("operator: an uncertain original ACK preserves a newer draft, focus, simulated composition and departure ownership", async ({ page, context, geometry, operator: api }, info) => {
  await openProduct(page, context, geometry, api, info); await selectCandidate(page, geometry); await loadNominations(page, geometry);
  const submitted = await fillAdoption(page, api), form = adoption(page), originalEpoch = await epoch(form);
  await withHandles([form], async ([originalForm]) => {
  const lost = api.arm("proposal", { drop: true });
  await activate(form.locator("[data-experience-adoption-propose]"), geometry);
  const originalRequest = await lost.reached, original = await lost.response; lost.release();
  const check = review(page).getByRole("button", { name: await translated(page, "Check original"), exact: true });
  await expect(check).toBeVisible();
  expect(originalRequest.body.title).toBe(submitted.title.trim());
  expect(originalRequest.body.evidence).toBe(submitted.evidence.trim());
  expect(commandCount(api)).toBe(1);
  await checkGeometry(page, info, "uncertain-action-gutters", geometry);
  const held = api.arm("original");
  await activate(check, geometry);
  const originalRead = await held.reached, readback = await held.response;
  expect(original.status).toBe(201); expect(readback.status).toBe(200);
  expect(readback.raw).toBe(original.raw); expect(readback.body).toEqual(original.body);
  expect(originalRead.method).toBe("GET");
  expect(originalRead.path).toBe("/api/portfolio/product/experiences/maintenance/adoption-operations/maintenance-proposal/" + originalRequest.body.requestId);
  await form.locator('textarea[name="evidence"]').fill("  Newer unsaved B\nنور 文書  ");
  const field = form.locator('input[name="title"]');
  await activate(field, geometry);
  await field.evaluate(node => {
    node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    node.value = "  変換中 B  "; node.setSelectionRange(2, 5, "forward");
    node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "変換中", isComposing: true }));
  });
  const newer = await values(form), selection = await field.evaluate(node => ({ start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection }));
  held.release();
  await expect(review(page).locator("[data-experience-acknowledgment]")).toContainText(original.body.receipt.eventId);
  expect(await originalForm.evaluate(node => node.isConnected)).toBe(true);
  expect(await epoch(form)).toBe(originalEpoch); expect(await values(form)).toEqual(newer);
  expect(await field.evaluate(node => ({ start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection }))).toEqual(selection);
  await verifyFocus(page, field, info, "original-ack-keeps-newer-composition-focus", { checkVisibleControls: false });
  expect(commandCount(api)).toBe(1);
  await field.evaluate(node => node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "変換中" })));
  await nativeDepartureRefused(page, geometry, api);
  expect(await values(form)).toEqual(newer);
  await assertReplacementReset(page, form, form.locator("[data-experience-adoption-reset]"), info, "adoption-reset", geometry);
  expect(await values(form)).toEqual({ nomination: "", title: "", ownerUserId: api.actor, evidence: "" });
  expect(commandCount(api)).toBe(1);
  await attach(info, "original-ack-newer-draft", { originalRequest, original, newer, selection, originalEpoch,
    receiptIdentity: "Exact retained synthetic proposal envelope; Check original did not submit a second command", simulatedComposition: true });
  });
});

test("operator: pending native departure is refused and synthetic session retirement excludes the late original response", async ({ page, context, baseURL, geometry, operator: api }, info) => {
  await openProduct(page, context, geometry, api, info); await selectCandidate(page, geometry); await loadNominations(page, geometry); await fillAdoption(page, api);
  await withHandles([review(page), adoption(page), adoption(page).locator('input[name="title"]')], async ([oldReview, oldForm, oldField]) => {
    const observer = await installMaintenanceRetirementObserver(page, baseURL);
    let failed = false, primary;
    const cleanup = [];
    try {
      const held = api.arm("proposal");
      await activate(adoption(page).locator("[data-experience-adoption-propose]"), geometry);
      const request = await held.reached, response = await held.response;
      expect(response.status).toBe(201);
      await expect(adoption(page).locator("[data-experience-adoption-propose]")).toBeDisabled();
      await nativeDepartureRefused(page, geometry, api);
      // Reuse the previously reviewed public session seam, never a private Review handler.
      // This is explicit lifecycle simulation, not real authorization revocation.
      await page.evaluate(async () => { const { platformSession } = await import("/src/platform/session-controller.ts"); platformSession.reset(); });
      await expect.poll(() => oldForm.evaluate(node => node.isConnected)).toBe(false);
      expect(await oldField.evaluate(node => node.isConnected)).toBe(false);
      held.release();
      // The exact native response reaches the stale owner and is cancelled before
      // JSON. Node route completion alone cannot establish browser continuation.
      await expect.poll(async () => (await observer.snapshot()).cancelCompleted).toBe(1);
      await expect.poll(async () => (await observer.snapshot()).pending).toBe(0);
      const observed = await observer.snapshot();
      expect(observed.captured).toEqual({ method: request.method, path: request.path, raw: request.raw });
      expect(observed.matched).toBe(1); expect(observed.fetchReturned).toBe(1);
      expect(observed.cancelCalled).toBe(1); expect(observed.jsonCalled).toBe(0);
      expect(observed.errors).toEqual([]); expect(observed.overflow).toBe(0);
      expect(observed.events.filter(row => row.kind === "fetch-returned").map(row => ({ status: row.status,
        sameNativeResponse: row.sameNativeResponse, sameNativeBody: row.sameNativeBody })))
        .toEqual([{ status: 201, sameNativeResponse: true, sameNativeBody: true }]);
      await oldReview.evaluate(async node => { await node.updateComplete; });
      expect(await oldForm.evaluate(node => node.isConnected)).toBe(false);
      expect(await oldReview.evaluate(node => node.querySelectorAll("[data-experience-acknowledgment]").length)).toBe(0);
      await expect(page.locator("forma-experience-review [data-experience-acknowledgment]")).toHaveCount(0);
      expect(commandCount(api)).toBe(1); expect(api.snapshot().originals).toHaveLength(1);
      await attach(info, "retired-original-response", { request, response, observed,
        syntheticSessionRetirement: true, originalRetainedByFixture: true, currentPermissionOrBackendCommitObserved: false });
    } catch (error) { failed = true; primary = error; }
    finally {
      // Release/drain fixture routes first, then restore all native descriptors.
      // Failed/retired documents or native work not drained are errors, not a pass.
      try { await api.close(); } catch (error) { cleanup.push(error); }
      try { await observer.close(); } catch (error) { cleanup.push(error); }
      try { await attach(info, "retirement-observer-closure", await observer.snapshot()); } catch (error) { cleanup.push(error); }
    }
    if (failed && cleanup.length) throw new AggregateError([primary, ...cleanup], "Retired original journey and native observation closure failed");
    if (failed) throw primary;
    if (cleanup.length) throw new AggregateError(cleanup, "Retirement native observation closure failed");
  });
});
