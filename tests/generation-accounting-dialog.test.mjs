import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as accounting from "../src/model/generation-accounting-inspection.ts";
import { inputInspection, accountingResponse, deferred } from "./helpers/generation-accounting-fixture.mjs";

// Actual component class/handlers and accounting reader; native modal, Lit
// templates, store and network use narrow in-memory ports. Not a browser/AT,
// viewport or full-store authorization certificate. No held test imports.
const requireDependency = createRequire(process.env.FORMA_ACCOUNTING_CANONICAL_PACKAGE ?? new URL("../package.json", import.meta.url));
const ts = requireDependency("typescript");
const source = fs.readFileSync(new URL("../src/components/generation-input-dialog.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const nothing = Symbol("nothing"), html = (strings, ...values) => ({ strings, values });
let active;
class ElementPort {
  constructor() { this.store = active.store; this.i18n = active.i18n; this.isConnected = true; this.renderRoot = { querySelector: selector => selector === "dialog" ? active.dialog : null }; }
  requestUpdate() { active.updates++; }
  connectedCallback() {}
  disconnectedCallback() {}
  dispatchEvent(event) { active.events.push(event.type); return true; }
}
const registry = new Map(), listeners = new Map();
const windowPort = { addEventListener(name, listener) { const list = listeners.get(name) ?? new Set(); list.add(listener); listeners.set(name, list); }, removeEventListener(name, listener) { listeners.get(name)?.delete(listener); } };
const moduleExports = {};
new Function("exports", "require", "window", "customElements", code)(moduleExports, specifier => {
  if (specifier === "lit") return { html, nothing };
  if (specifier === "lit/directives/cache.js") return { cache: value => value };
  if (specifier === "lit/directives/keyed.js") return { keyed: (_key, value) => value };
  if (specifier.endsWith("/localized-template")) return { localizeTemplateResult: value => value };
  if (specifier.endsWith("/generation-execution-evidence")) return { isManagedVideoInspection: () => false };
  if (specifier.endsWith("/saved-storyboard-inspection")) return { savedStoryboardInspection: () => null };
  if (specifier.endsWith("/model3d")) return { model3dPromptLength: () => 0 };
  if (specifier.endsWith("/forma-element")) return { FormaElement: ElementPort, icon: () => nothing, copyTextToClipboard: async () => { active.copies++; return true; } };
  if (specifier.endsWith("/modal-dialog")) return { ensureModalDialog: dialog => { dialog.open = true; } };
  if (specifier.endsWith("/generation-accounting-inspection.ts")) return accounting;
  throw new Error(`Unexpected actual component dependency: ${specifier}`);
}, windowPort, { get: name => registry.get(name), define: (name, constructor) => registry.set(name, constructor) });

const templates = value => value && typeof value === "object" && Array.isArray(value.values)
  ? [value, ...value.values.flatMap(templates)] : Array.isArray(value) ? value.flatMap(templates) : [];
const handler = (template, event) => template.values.find((value, index) => typeof value === "function" && template.strings[index].trimEnd().endsWith(`@${event}=`));
const text = value => value && typeof value === "object" && Array.isArray(value.values) ? value.strings.join(" ") + value.values.map(text).join(" ")
  : Array.isArray(value) ? value.map(text).join(" ") : typeof value === "string" || typeof value === "number" ? String(value) : "";
const settle = async predicate => { for (let index = 0; index < 30 && !predicate(); index++) await new Promise(resolve => setImmediate(resolve)); assert.ok(predicate(), "The narrow component state reached its expected result"); };

function fixture(t, role = "admin") {
  const subscriptions = new Set();
  const f = { updates: 0, events: [], copies: 0, toasts: [], requests: [], session: { user: { role }, projectContext: null, impersonation: null }, scope: { key: "owner:principal", shared: false }, route: "/activity?document=doc-1", dialog: { open: true, close() { this.open = false; } }, reply: async () => Response.json(accountingResponse()) };
  f.store = { session: { get: () => f.session }, route: { get: () => f.route }, captureAuthorizationScope: () => f.scope,
    subscribe(callback) { subscriptions.add(callback); return () => subscriptions.delete(callback); },
    toast(value) { f.toasts.push(value); },
    async guardedFetch(url, init, _action, controls) { assert.equal(controls.current(), true); f.requests.push({ url, init }); const response = await f.reply(); if (!controls.current()) throw new Error("retired"); return response; } };
  f.i18n = { t: (_key, fallback) => fallback, system: value => value, number: (value, options) => new Intl.NumberFormat("en", options).format(value) };
  active = f; f.host = new moduleExports.GenerationInputDialog(); f.host.inspection = inputInspection(); f.host.open = true; f.host.connectedCallback();
  f.draw = () => { f.host.willUpdate(); f.host.updated(); return f.host.render(); };
  f.section = () => templates(f.draw()).find(value => value.strings.join("").includes('class="generation-receipt-summary generation-accounting-preview"'));
  f.inspect = () => { const section = f.section(); assert.ok(section); const click = handler(section, "click"); assert.ok(click); click(); };
  f.notify = () => { for (const callback of subscriptions) callback(); };
  f.nativeClose = () => { const root = templates(f.draw()).find(value => value.strings.join("").includes('<dialog class="generation-input-dialog"')); f.dialog.open = false; handler(root, "close")({ currentTarget: f.dialog }); };
  f.authorizeChanged = () => { for (const callback of listeners.get("forma-authorization-changed") ?? []) callback(); };
  t.after(() => { f.host.isConnected = false; f.host.disconnectedCallback(); assert.equal(subscriptions.size, 0); });
  return f;
}

test("actual dialog exposes one explicit read, preserves button focusability, and shows source-free diagnostics", async t => {
  const f = fixture(t); assert.ok(f.section()); assert.equal(f.requests.length, 0);
  const gate = deferred(); f.reply = () => gate.promise; f.inspect(); f.inspect();
  assert.equal(f.requests.length, 1, "aria-disabled loading button refuses duplicate dispatch without losing native focusability");
  assert.equal(f.requests[0].url, "/api/admin/generation-accounting?jobId=job-1"); assert.equal(f.requests[0].init.method, "GET");
  assert.doesNotMatch(f.section().strings.join(""), /\?disabled=/u);
  const value = accountingResponse(); value.preview.rawCheckpoint = "PRIVATE_SERVER_SOURCE"; gate.resolve(Response.json(value));
  await settle(() => text(f.section()).includes("Accounting diagnostic receipt"));
  assert.match(text(f.section()), /19\.644000|19.644000/u); assert.doesNotMatch(text(f.section()), /PRIVATE_SERVER_SOURCE/u);
  assert.equal(f.toasts.length, 0); assert.equal(f.copies, 0);
});

test("actual dialog hides accounting for non-admin and shared/impersonated/non-video states", t => {
  const f = fixture(t, "creator"); assert.equal(f.section(), undefined);
  f.session.user.role = "admin"; f.scope.shared = true; assert.equal(f.section(), undefined);
  f.scope.shared = false; f.session.impersonation = { active: true }; assert.equal(f.section(), undefined);
  f.session.impersonation = null; f.host.inspection.receipt.job.artifact_kind = "slides"; assert.equal(f.section(), undefined);
  assert.equal(f.requests.length, 0);
});

for (const boundary of ["native-close", "route", "authorization", "inspection", "opening-current", "disconnect"])
test(`actual dialog retires deferred accounting at ${boundary}`, async t => {
  const f = fixture(t), gate = deferred(); f.reply = () => gate.promise; f.inspect();
  const original = JSON.stringify(f.host.inspection), signal = f.requests[0].init.signal;
  if (boundary === "native-close") f.nativeClose();
  if (boundary === "route") { f.route = "/library"; f.notify(); }
  if (boundary === "authorization") { f.scope = { ...f.scope, key: "other:principal" }; f.authorizeChanged(); }
  if (boundary === "inspection") { f.host.inspection = inputInspection(); f.draw(); }
  if (boundary === "opening-current") { f.host.openingCurrent = () => false; f.notify(); }
  if (boundary === "disconnect") { f.host.isConnected = false; f.host.disconnectedCallback(); }
  assert.equal(signal.aborted, true, boundary);
  gate.resolve(Response.json(accountingResponse())); await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(text(f.host.render()), /Accounting diagnostic receipt/u);
  assert.equal(f.toasts.length, 0); assert.equal(f.requests.length, 1);
  if (boundary === "route" || boundary === "opening-current") assert.equal(JSON.stringify(f.host.inspection), original, "accounting retirement does not rewrite the original receipt");
});

test("actual same-job dialog reopen cannot display an older read or its failure", async t => {
  const f = fixture(t), old = deferred(); f.reply = () => old.promise; f.inspect(); f.nativeClose();
  f.host.open = true; f.host.inspection = inputInspection(); f.dialog.open = true;
  const current = accountingResponse(); current.preview.snapshotSha256 = "d".repeat(64); f.reply = async () => Response.json(current); f.inspect();
  await settle(() => text(f.section()).includes("d".repeat(64)));
  old.reject(new Error("PRIVATE_OLD_FAILURE")); await new Promise(resolve => setImmediate(resolve));
  assert.match(text(f.section()), new RegExp("d".repeat(64))); assert.doesNotMatch(text(f.section()), /PRIVATE_OLD_FAILURE/u); assert.equal(f.toasts.length, 0);
});
