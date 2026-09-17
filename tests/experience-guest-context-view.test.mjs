import assert from "node:assert/strict";
import test from "node:test";
import { ExperienceIntakeRuntime } from "../src/experiences/intake-runtime.ts";
import { ExperienceView } from "../src/experiences/view.ts";
import { guestContextResponse, installGuestContextDom, settle, findLink, visible } from "./helpers/guest-context-client.mjs";

async function fixture(t, { response, href, globalHref, pending = false } = {}) {
  response ??= await guestContextResponse();
  const dom = installGuestContextDom(t, { ...(href === undefined ? {} : { href }), globalHref }), requests = [];
  let resolve, mounts = 0, foreignFetches = 0, nextResponse = response, nextStatus = 200;
  t.mock.method(globalThis, "fetch", () => { foreignFetches++; throw Error("unexpected output/provider fetch"); });
  const runtime = new ExperienceIntakeRuntime(response.plan.release, async (path, init) => {
    requests.push({ path, init });
    if (pending) await new Promise(done => { resolve = done; });
    return Response.json(nextResponse, { status: nextStatus });
  });
  const view = new ExperienceView(dom.root, runtime, { async mount() { mounts++; throw Error("context-only must not mount an output host"); } });
  const started = runtime.resume(response.plan.draftId);
  t.after(() => { view.dispose(); runtime.dispose(); assert.equal(foreignFetches, 0); });
  if (!pending) { await started; await settle(); }
  return { ...dom, response, runtime, view, requests, started, resolve: () => resolve(), mounts: () => mounts,
    respond: (value, status = 200) => { nextResponse = value; nextStatus = status; } };
}
function noOutput(f) {
  assert.equal(f.mounts(), 0);
  assert.equal(findLink(f.root, "Continue"), undefined);
  assert.equal(f.root.querySelector(".experience-native-host"), null);
  assert.ok(f.requests.every(({ path, init }) => path.startsWith("/api/experiences/drafts/") && (init.method ?? "GET") === "GET"));
}

test("claimed context reopens exact saved settings with only same-Document Edit in Forma", async t => {
  const f = await fixture(t), edit = findLink(f.root, "Edit in Forma");
  assert.equal(f.runtime.state.phase, "complete", JSON.stringify(f.runtime.state.issues));
  assert.equal(f.runtime.contextOnly, true); assert.equal(f.runtime.receipt, undefined);
  assert.deepEqual(f.runtime.contextReceipt, f.response.custody);
  assert.deepEqual(f.runtime.committedPlan, f.response.plan);
  assert.ok(edit); assert.equal(visible(edit), true); assert.equal(edit.href, f.response.custody.documentRoute);
  assert.equal(f.root.querySelectorAll("a").length, 1);
  assert.match(f.root.querySelector(".experience-saved-details").textContent, /Saved settings.*A copper lamp beside a window/);
  assert.match(f.root.textContent, /Generation unavailable/);
  assert.equal(f.root.querySelector("textarea"), null); assert.equal(f.runtime.canRetry, false);
  assert.equal(f.requests.length, 1); noOutput(f);
  const requests = f.requests.length;
  await f.runtime.prepare(); await f.runtime.submit(); f.runtime.back();
  assert.equal(f.runtime.change("subject", "Replacement subject"), false);
  assert.equal(f.runtime.changeReference(null, true), false);
  assert.equal(f.runtime.state.phase, "complete"); assert.equal(f.requests.length, requests); noOutput(f);
});

test("ordinary new Image setup still renders editable controls on the first microtask", async t => {
  const response = await guestContextResponse(), dom = installGuestContextDom(t);
  let requests = 0;
  const runtime = new ExperienceIntakeRuntime(response.plan.release, async () => { requests++; throw Error("setup must not fetch"); });
  const view = new ExperienceView(dom.root, runtime);
  t.after(() => { view.dispose(); runtime.dispose(); });
  assert.equal(dom.createdTags.includes("TEXTAREA"), false);
  await Promise.resolve();
  assert.equal(runtime.state.phase, "setup"); assert.equal(runtime.contextOnly, false);
  assert.ok(dom.root.querySelector("textarea"));
  assert.equal(dom.root.querySelectorAll("button").some(button => button.textContent === "Review"), true);
  assert.equal(runtime.change("subject", "An ordinary new Image"), true);
  assert.equal(runtime.state.draft.values.subject.value, "An ordinary new Image"); assert.equal(requests, 0);
});

for (const mode of ["document", "global"]) test(`claimed-context Edit preserves progress-report via ${mode} location`, async t => {
  const path = "https://forma.example/experiences/image?progress-report=untrusted-value&draft=unused";
  const f = await fixture(t, mode === "document" ? { href: path } : { href: null, globalHref: path });
  const edit = findLink(f.root, "Edit in Forma"); assert.ok(edit);
  const url = new URL(edit.href, "https://forma.example");
  assert.equal(url.pathname, f.response.custody.documentRoute); assert.equal(url.searchParams.has("progress-report"), true);
  assert.equal(url.searchParams.get("progress-report"), "");
  assert.equal(url.searchParams.has("draft"), false); noOutput(f);
});

test("a saved-draft resume creates no setup controls while its read is pending", async t => {
  const f = await fixture(t, { pending: true });
  await settle();
  assert.equal(f.runtime.state.phase, "preparing");
  assert.equal(f.createdTags.includes("TEXTAREA"), false, "setup controls must never be created during route resume");
  assert.equal(findLink(f.root, "Edit in Forma"), undefined); noOutput(f);
  f.resolve(); await f.started; await settle();
  assert.equal(f.runtime.state.phase, "complete"); assert.equal(f.createdTags.includes("TEXTAREA"), false); noOutput(f);
});

test("invalid claimed-context receipt never offers an Edit or generation link", async t => {
  const response = await guestContextResponse(); response.custody.documentRoute = "/document/different";
  const f = await fixture(t, { response });
  assert.equal(f.runtime.state.phase, "uncertain"); assert.equal(f.runtime.contextOnly, true);
  assert.equal(f.runtime.contextReceipt, undefined); assert.equal(f.runtime.committedPlan, undefined);
  assert.equal(findLink(f.root, "Edit in Forma"), undefined); assert.equal(f.root.querySelectorAll("a").length, 0);
  assert.equal(f.root.all().some(element => element.tagName === "BUTTON" && element.textContent === "Retry original"), false);
  assert.equal(f.runtime.canRetry, false);
  const requests = f.requests.length;
  await f.runtime.prepare(); await f.runtime.submit(); f.runtime.back();
  assert.equal(f.runtime.state.phase, "uncertain"); assert.equal(f.requests.length, requests); noOutput(f);
});

test("disposing claimed context withdraws its link and ignores a late read", async t => {
  const f = await fixture(t, { pending: true });
  f.view.dispose(); f.runtime.dispose();
  assert.equal(f.root.children.length, 0); assert.equal(f.requests[0].init.signal.aborted, true);
  f.resolve(); await f.started; await settle();
  assert.equal(f.root.children.length, 0); assert.equal(findLink(f.root, "Edit in Forma"), undefined); noOutput(f);
});

test("disposing a completed claimed context removes its saved settings and Edit link", async t => {
  const f = await fixture(t), edit = findLink(f.root, "Edit in Forma"); assert.ok(edit);
  f.view.dispose(); assert.equal(f.root.children.length, 0);
  assert.equal(f.root.all().includes(edit), false); noOutput(f);
});

test("failed context revalidation withdraws the old link and saved private values before settling", async t => {
  const f = await fixture(t); assert.ok(findLink(f.root, "Edit in Forma"));
  f.respond({ error: "forbidden" }, 403);
  const recovery = f.runtime.recover();
  assert.equal(findLink(f.root, "Edit in Forma"), undefined);
  assert.equal(f.root.textContent.includes("A copper lamp beside a window"), false);
  assert.equal(f.runtime.contextReceipt, undefined); assert.equal(f.runtime.documentRoute, undefined);
  await recovery; await settle();
  assert.equal(f.runtime.state.phase, "uncertain"); assert.equal(f.runtime.contextOnly, true);
  assert.equal(f.runtime.contextReceipt, undefined); assert.equal(f.runtime.committedPlan, undefined);
  assert.equal(f.runtime.canRetry, false); assert.equal(findLink(f.root, "Edit in Forma"), undefined);
  assert.equal(f.root.textContent.includes("A copper lamp beside a window"), false);
  assert.deepEqual(f.root.querySelectorAll("button").map(button => button.textContent), ["Check status"]);
  assert.equal(f.requests.at(-1).path, `/api/experiences/drafts/${f.response.plan.draftId}/receipt`);
  const requests = f.requests.length;
  await f.runtime.prepare(); await f.runtime.submit(); f.runtime.back();
  assert.equal(f.runtime.state.phase, "uncertain"); assert.equal(f.requests.length, requests); noOutput(f);
});

test("Check status restores only the same context after a failed authority read", async t => {
  const f = await fixture(t);
  f.respond({ error: "forbidden" }, 403); await f.runtime.recover();
  assert.equal(findLink(f.root, "Edit in Forma"), undefined);
  f.respond(f.response); await f.runtime.recover(); await settle();
  assert.equal(f.runtime.state.phase, "complete", JSON.stringify(f.runtime.state.issues));
  assert.equal(f.runtime.receipt, undefined); assert.equal(f.runtime.canRetry, false);
  assert.equal(findLink(f.root, "Edit in Forma")?.href, f.response.custody.documentRoute);
  assert.match(f.root.querySelector(".experience-saved-details").textContent, /A copper lamp beside a window/);
  assert.equal(f.requests.length, 3);
  assert.ok(f.requests.slice(1).every(({ path }) => path === `/api/experiences/drafts/${f.response.plan.draftId}/receipt`)); noOutput(f);
});
