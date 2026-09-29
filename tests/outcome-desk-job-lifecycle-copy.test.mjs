import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Reuse the complete current Shell/Canvas/Store fixture. These are explicit
// existing job DTO projections, not backend lifecycle transitions or media.
const file = fileURLToPath(new URL("./outcome-desk-canvas-navigation.test.mjs", import.meta.url));
const raw = readFileSync(file, "utf8");
const marker = 'for(const locale of["en","fr","ar","ja"])test("actual ';
assert.ok(raw.includes(marker));
const url = pathToFileURL(file).href + "?terminal-job-lifecycle-fixture";
const hook = registerHooks({ load(current, context, next) {
  return current === url ? { format: "module", source: raw.slice(0, raw.indexOf(marker)) + "\nexport {canvasPage};", shortCircuit: true }
    : next(current, context);
} });
let canvasPage;
try { ({ canvasPage } = await import(url)); } finally { hook.deregister(); }
const terminalLabels = { en: "Inspect this request", fr: "Examiner cette demande", ar: "افحص هذا الطلب", ja: "このリクエストを確認" };
for (const locale of ["en", "fr", "ar", "ja"]) for (const status of ["queued", "running", "committing", "failed", "partial", "completed", "canceled"]) {
  test("current exact Desk request lifecycle copy " + locale + "/" + status, async t => {
    const f = await canvasPage(t, { locale, state: "uncertain-receipt" });
    const original = f.store.documentJobs.get().find(row => row.documentId === f.documentId); assert.ok(original);
    const projected = { ...original, canvasId: "synthetic-board", sourceSurface: "canvas", status };
    f.store.documentJobs.set(f.store.documentJobs.get().map(row => row.jobId === original.jobId ? projected : row));
    f.store.notify(); await f.settle();
    const before = { events: JSON.stringify(f.store.events.get()), jobs: JSON.stringify(f.store.documentJobs.get()), output: JSON.stringify(f.outputSnapshot()) };
    const links = f.tree().visible("a").filter(node => {
      const href = node.attributes.href;
      return href && new URL(href, "http://localhost").searchParams.get("outcome") === "job:" + original.jobId;
    });
    assert.equal(links.length, 1); await f.act(links[0], "click", { button: 0 });
    const tree = f.tree(), actions = tree.visible("button").filter(node => String(node.attributes["data-choice-value"] ?? "").startsWith("job:" + original.jobId + ":"));
    assert.equal(actions.length, 1);
    const label = tree.visible("strong").find(node => { for (let at = node.parent; at; at = at.parent) if (at === actions[0]) return true; return false; });
    assert.ok(label);
    const terminal = status === "completed" || status === "canceled", failed = status === "failed" || status === "partial";
    const expected = terminal ? terminalLabels[locale] : f.i18n.t("next.exact." + (failed ? "inspect-job" : "check-job") + ".label");
    assert.equal(label.text, expected, "terminal requests must not be presented as work still in progress");
    const actionId = failed || terminal ? "inspect-job" : "check-job";
    assert.ok(String(actions[0].attributes["data-choice-value"]).startsWith("job:" + original.jobId + ":" + actionId + ":"));
    assert.equal(new URL(f.store.route.get(), "http://localhost").searchParams.get("outcome"), "job:" + original.jobId);
    if (terminal) assert.ok(actions[0].text.includes(f.i18n.t("next.exact.inspect-terminal-job.reason")));
    assert.deepEqual({ events: JSON.stringify(f.store.events.get()), jobs: JSON.stringify(f.store.documentJobs.get()), output: JSON.stringify(f.outputSnapshot()) }, before);
    // Full-page setup mounts Workspace before Canvas. Reuse only the existing
    // init-identity/current-scope read classifier; every other command stays forbidden.
    assert.deepEqual(f.storeHost.requests.filter(row => (row.init.method ?? "GET") !== "GET" && !f.isReadOnlyResume(row)), []);
  });
}
