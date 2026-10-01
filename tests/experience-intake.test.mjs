import assert from "node:assert/strict";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { experienceIds, initialValues, registeredExperience } from "../src/experiences/intake.ts";
import { foldEvents } from "../src/model/events.ts";
import { readWorkspaceEvents, sweepExpiredPrivateContent } from "../worker/runtime.ts";
import { providerFacingRenderingContext } from "../src/model/prompt-policy.ts";
import { loadPrivateContent } from "../worker/pilot-policy.ts";
import { documentIdFromRoute } from "../src/model/routes.ts";
import { ExperienceIntakeRuntime } from "../src/experiences/intake-runtime.ts";
import { definitions } from "../src/experiences/catalog.ts";
import { authoritativeCreativeContext } from "../worker/context-authority.ts";

const options = { concurrency: false, timeout: 45000 };
const json = body => ({ method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });
async function fixture(t, anotherOwner = false) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No provider/network request in intake"));
  const x = await createSceneCostFixture(1);
  if (anotherOwner) {
    x.setScopedHeaders({ "oai-authenticated-user-id": "another-owner", "oai-authenticated-user-email": "another@example.test" });
    await x.request("/api/session"); x.sqlite.prepare("UPDATE users SET consent_version='pilot-2026-08-10'").run();
    x.setScopedHeaders({});
  }
  const financial = x.counts();
  t.after(() => { assert.deepEqual(x.counts(), financial); x.close(); });
  const send = async (route, init) => { const response = await x.request(route, init); return { status: response.status, body: await response.json(), response }; };
  return { ...x, send };
}
async function requestFor(id = "image") {
  const release = await registeredExperience(id), values = initialValues(release);
  for (const decision of release.definition.decisions) {
    const interaction = release.interactions[decision.id], entry = values[decision.id];
    if (interaction.kind === "source") entry.value = "Retained " + decision.id;
    else if (interaction.kind === "relationship") entry.value = Object.fromEntries(interaction.fields.map(field => [field.id, "Retained " + field.label]));
    else if (interaction.kind === "order") entry.value = entry.value.map(item => ({ ...item, text: "Evidence " + item.id }));
    else continue;
    entry.provenance = "authored";
  }
  return { intentId: crypto.randomUUID(), experienceId: id, releaseHash: release.releaseHash, values };
}
const save = (x, body) => x.send("/api/experiences/drafts", json(body));
const commit = (x, plan) => x.send(`/api/experiences/drafts/${plan.draftId}/commit`, json({ draftHash: plan.draftHash }));
const inspect = (x, plan) => x.send(`/api/experiences/drafts/${plan.draftId}/receipt`);
const total = x => x.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n;
const rootBatch = statements => statements.some(item => item.sql.includes("VALUES(?,?,CASE WHEN") && item.sql.includes("event_client_receipts"));

for (const id of experienceIds) test(`${id}: retained draft creates one canonical Document with typed context and no generation`, options, async t => {
  const x = await fixture(t), request = await requestFor(id), before = total(x), saved = await save(x, request);
  assert.equal(saved.status, 200, JSON.stringify(saved.body)); assert.equal(total(x), before);
  const plan = saved.body.plan;
  assert.equal((await loadPrivateContent(x.env, x.owner))[plan.draftId], undefined, "draft stays out of main/private/Memory hydration");
  const completed = await commit(x, plan);
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.status, "complete"); assert.equal(completed.body.generation, "unavailable");
  assert.equal(documentIdFromRoute(completed.body.documentRoute), plan.documentId);
  const canonicalEvents = await readWorkspaceEvents(x.env, x.streamId);
  const projection = foldEvents(canonicalEvents, Infinity, plan.documentId, plan.projectId);
  assert.equal(projection.documents.filter(item => item.id === plan.documentId).length, 1);
  const blocks = projection.libraryBlocks.filter(item => item.documentId === plan.documentId);
  assert.equal(blocks.length, Object.keys(request.values).length + 1);
  for (const [slot, entry] of Object.entries(request.values)) {
    const block = blocks.find(item => item.properties.experience_binding === slot);
    assert.equal(block.scope, "document"); assert.deepEqual(block.properties.experience_value, entry.value);
    assert.equal(block.properties.experience_origin, entry.provenance);
    assert.equal(block.properties.authority, entry.provenance === "authored" ? "authored" : "inferred");
  }
  if (id === "scene") assert.equal(blocks.find(item => item.properties.experience_binding === "knowledge").properties.text, "Secret known by: Participant A");
  if (id === "storyboard") assert.equal(blocks.find(item => item.properties.experience_binding === "revealFrame").properties.text, "Reveal frame: 2");
  const provider = providerFacingRenderingContext({ facts: blocks.map(block => ({ block_id: block.id, type: block.type, properties: block.properties })) });
  assert.equal(provider.facts.length, blocks.length, "all text-only directions remain active, including Audio");
  assert.doesNotMatch(JSON.stringify(provider), /experience_|sha256:/);
  if (id === "audio") {
    const native = authoritativeCreativeContext(canonicalEvents, { documentId: plan.documentId, projectId: plan.projectId });
    const rendered = providerFacingRenderingContext(native.snapshot);
    assert.equal(rendered.facts.length, blocks.length);
    assert.ok(rendered.facts.some(fact => fact.properties.text.startsWith("Audio · Moment:")));
    assert.ok(rendered.facts.some(fact => fact.properties.text === "Audio · Instrument: Piano"));
  }
  const count = total(x), repeated = await commit(x, plan), checked = await inspect(x, plan);
  assert.equal(total(x), count); assert.deepEqual(repeated.body.appended, completed.body.appended); assert.deepEqual(checked.body.appended, completed.body.appended);
  assert.equal(checked.response.headers.get("cache-control"), "private, no-store");
});

test("immutable draft retries recover the original and changed intent conflicts", options, async t => {
  const x = await fixture(t), request = await requestFor(), first = await save(x, request), retry = await save(x, request);
  assert.deepEqual(retry.body, first.body);
  const changed = structuredClone(request); changed.values.subject.value = "Changed";
  assert.equal((await save(x, changed)).body.error, "experience_intent_conflict");
  const restored = await x.send(`/api/experiences/drafts/${first.body.plan.draftId}`);
  assert.deepEqual(restored.body.plan, first.body.plan);
});
test("concurrent commits and lost acknowledgement inspection retain exact canonical IDs", options, async t => {
  const x = await fixture(t), { body: { plan } } = await save(x, await requestFor()), before = total(x);
  const [a, b] = await Promise.all([commit(x, plan), commit(x, plan)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.deepEqual(a.body.appended, b.body.appended);
  assert.equal(total(x) - before, plan.events.length);
  const writes = x.sqlite.prepare("SELECT total_changes() AS n").get().n;
  const recovered = await inspect(x, plan);
  assert.deepEqual(recovered.body.appended, a.body.appended);
  assert.equal(x.sqlite.prepare("SELECT total_changes() AS n").get().n, writes);
});
test("stale review and caller events, authority, incomplete values and forged defaults are rejected", options, async t => {
  const x = await fixture(t), request = await requestFor(), before = total(x);
  for (const mutate of [body => { body.events = []; }, body => { body.approved = true; }, body => { body.values.subject.value = ""; }, body => { body.values.subject.provenance = "default"; }, body => { body.releaseHash = "sha256:" + "0".repeat(64); }]) {
    const body = structuredClone(request); mutate(body); assert.equal((await save(x, body)).status, 400);
  }
  const { body: { plan } } = await save(x, request);
  assert.equal((await x.send(`/api/experiences/drafts/${plan.draftId}/commit`, json({ draftHash: "changed" }))).status, 409);
  assert.equal((await x.send(`/api/experiences/drafts/${plan.draftId}/commit`, json({ draftHash: plan.draftHash, events: plan.events }))).status, 400);
  assert.equal(total(x), before);
});
for (const mutation of ["redact", "expire"]) test(`${mutation}: draft identity cannot be resurrected or committed`, options, async t => {
  const x = await fixture(t), request = await requestFor(), { body: { plan } } = await save(x, request), before = total(x);
  x.sqlite.prepare(mutation === "redact" ? "UPDATE private_content SET content='',redacted_at='2026-01-01' WHERE content_id=?" : "UPDATE private_content SET expires_at='2026-01-01' WHERE content_id=?").run(plan.draftId);
  assert.equal((await save(x, request)).status, 409); assert.equal((await commit(x, plan)).status, 404); assert.equal(total(x), before);
});
test("transaction-time role loss rolls back all events and receipts", options, async t => {
  const x = await fixture(t), { body: { plan } } = await save(x, await requestFor()), before = total(x);
  let reached = false;
  x.controls.beforeBatch = async statements => { if (rootBatch(statements)) { reached = true; x.controls.beforeBatch = null; x.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(x.owner); } };
  const response = await commit(x, plan);
  assert.equal(reached, true); assert.equal(response.status, 403); assert.equal(total(x), before);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM event_client_receipts WHERE client_event_id LIKE 'experience-intake:%'").get().n, 0);
});
test("transaction-time draft erasure rolls back the complete operation", options, async t => {
  const x = await fixture(t), { body: { plan } } = await save(x, await requestFor()), before = total(x);
  x.controls.beforeBatch = async statements => { if (rootBatch(statements)) { x.controls.beforeBatch = null; x.sqlite.prepare("UPDATE private_content SET content='',redacted_at='2026-01-01' WHERE content_id=?").run(plan.draftId); } };
  assert.equal((await commit(x, plan)).status, 403); assert.equal(total(x), before);
});
test("other owners cannot inspect drafts; selected project and cross-origin requests cannot create", options, async t => {
  const x = await fixture(t, true), { body: { plan } } = await save(x, await requestFor()), before = total(x);
  x.setScopedHeaders({ "oai-authenticated-user-id": "another-owner", "oai-authenticated-user-email": "another@example.test" });
  assert.notEqual((await x.send(`/api/experiences/drafts/${plan.draftId}`)).status, 200);
  x.setScopedHeaders({ cookie: "forma_project_context=unissued-context" });
  assert.equal((await save(x, await requestFor())).status, 403);
  x.setScopedHeaders({});
  const init = json(await requestFor()); init.headers.origin = "https://unrelated.test";
  assert.equal((await x.send("/api/experiences/drafts", init)).status, 403); assert.equal(total(x), before);
});
test("body limits, content type and methods fail before draft creation", options, async t => {
  const x = await fixture(t);
  assert.equal((await x.send("/api/experiences/drafts")).status, 405);
  assert.equal((await x.send("/api/experiences/drafts", { method: "POST", body: "{}" })).status, 400);
  assert.equal((await save(x, { oversized: "x".repeat(32768) })).status, 400);
});
test("experience routes derive from registered outputs and reject unknown paths without SPA fallback", options, async t => {
  const x = await fixture(t), requested = [];
  x.env.ASSETS.fetch = async request => { requested.push(new URL(request.url).pathname); return new Response("experience entry"); };
  for (const path of ["/make", "/make/", ...experienceIds.map(id => `/make/${id}`)]) {
    const response = await x.request(path);
    assert.equal(response.status, 200); assert.equal(response.headers.get("x-forma-route-family"), "experience");
    assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(await response.text(), "experience entry");
  }
  assert.ok(requested.every(path => path === "/experiences"));
  const before = requested.length;
  assert.equal((await x.request("/make/unknown")).status, 404);
  assert.equal((await x.request("/make/image/extra")).status, 404);
  assert.equal((await x.request("/make/image", { method: "POST" })).status, 405);
  assert.equal(requested.length, before);
  assert.equal(await (await x.request("/make/image", { method: "HEAD" })).text(), "");
});

async function controller(x, transform = async response => response) {
  const release = await registeredExperience("image"), calls = [];
  const runtime = new ExperienceIntakeRuntime(release, async (path, init) => {
    calls.push({ path, method: init?.method ?? "GET" });
    return transform(await x.request(path, init), path);
  });
  runtime.change("subject", "Retained controller subject");
  return { runtime, calls, release };
}
test("controller saves, submits once, resumes by exact receipt and preserves same-Document handoff", options, async t => {
  const x = await fixture(t), { runtime, calls, release } = await controller(x);
  await Promise.all([runtime.prepare(), runtime.prepare()]);
  assert.equal(runtime.state.phase, "review"); assert.equal(calls.filter(call => call.method === "POST").length, 1);
  await Promise.all([runtime.submit(), runtime.submit()]);
  assert.equal(runtime.state.phase, "complete"); assert.equal(calls.filter(call => call.path.endsWith("/commit")).length, 1);
  assert.equal(runtime.change("subject", "Later"), false);
  const restored = new ExperienceIntakeRuntime(release, (path, init) => x.request(path, init));
  const count = total(x); await restored.resume(runtime.draftId);
  assert.equal(restored.state.phase, "complete"); assert.equal(restored.documentRoute, runtime.documentRoute); assert.equal(total(x), count);
  runtime.dispose(); restored.dispose();
});
for (const stage of ["save", "commit"]) test(`controller recovers lost ${stage} acknowledgement with read-only inspection`, options, async t => {
  const x = await fixture(t); let dropped = false;
  const { runtime, calls } = await controller(x, async (response, path) => {
    if (!dropped && response.ok && (stage === "save" ? path === "/api/experiences/drafts" : path.endsWith("/commit"))) { dropped = true; throw new Error("response_lost"); }
    return response;
  });
  await runtime.prepare(); if (stage === "commit") await runtime.submit();
  assert.equal(runtime.state.phase, "uncertain");
  const posts = calls.filter(call => call.method === "POST").length, count = total(x);
  await runtime.recover(); assert.equal(calls.filter(call => call.method === "POST").length, posts); assert.equal(total(x), count);
  if (stage === "save") { assert.equal(runtime.state.phase, "uncertain"); await runtime.submit(); }
  assert.equal(runtime.state.phase, "complete"); runtime.dispose();
});
test("controller rejects a mismatched completed Document instead of navigating", options, async t => {
  const x = await fixture(t);
  const { runtime } = await controller(x, async (response, path) => {
    if (!path.endsWith("/commit")) return response;
    const body = await response.json(); body.documentRoute = "/document/another";
    return Response.json(body);
  });
  await runtime.prepare(); await runtime.submit();
  assert.equal(runtime.state.phase, "uncertain"); assert.equal(runtime.documentRoute, undefined); runtime.dispose();
});
test("detached controller discards a late committed response without erasing the original", options, async t => {
  const x = await fixture(t); let runtime;
  ({ runtime } = await controller(x, async (response, path) => { if (path.endsWith("/commit")) runtime.dispose(); return response; }));
  await runtime.prepare(); await runtime.submit();
  assert.notEqual(runtime.state.phase, "complete"); assert.equal(runtime.documentRoute, undefined);
  assert.equal((await x.send(`/api/experiences/drafts/${runtime.draftId}/receipt`)).body.status, "complete");
});
for (const byIntent of [false, true]) test(`failed initial resume preserves ${byIntent ? "intent" : "draft"} identity for read-only recovery`, options, async t => {
  const x = await fixture(t), { runtime, release } = await controller(x);
  await runtime.prepare(); await runtime.submit();
  let failed = false; const calls = [];
  const restored = new ExperienceIntakeRuntime(release, async (path, init) => { calls.push({ path, method: init?.method ?? "GET" }); if (!failed) { failed = true; throw new Error("offline"); } return x.request(path, init); });
  const id = byIntent ? runtime.intentId : runtime.draftId, observed = [];
  restored.subscribe(() => observed.push(byIntent ? restored.intentId : restored.draftId));
  await restored.resume(id, byIntent);
  assert.equal(restored.state.phase, "uncertain"); assert.equal(restored.canRetry, false);
  assert.equal(byIntent ? restored.intentId : restored.draftId, id); assert.ok(observed.every(value => value === id));
  await restored.recover(); assert.equal(restored.state.phase, "complete"); assert.equal(restored.documentRoute, runtime.documentRoute);
  assert.ok(calls.every(call => call.method === "GET"));
  runtime.dispose(); restored.dispose();
});
test("existing bounded retention sweep physically erases expired drafts without freeing their identity", options, async t => {
  const x = await fixture(t), request = await requestFor(), { body: { plan } } = await save(x, request);
  x.sqlite.prepare("UPDATE private_content SET expires_at='2026-01-01' WHERE content_id=?").run(plan.draftId);
  assert.ok(await sweepExpiredPrivateContent(x.env, 1) <= 1);
  const row = x.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(plan.draftId);
  assert.equal(row.content, ""); assert.ok(row.redacted_at); assert.equal((await save(x, request)).status, 409);
});
test("native personal erasure removes draft bodies and canonical private inputs", options, async t => {
  const x = await fixture(t), request = await requestFor(), { body: { plan } } = await save(x, request);
  await commit(x, plan);
  const erased = await x.send("/api/privacy/events", json({ action: "erase-personal-authored-context", confirmation: "ERASE_MY_PERSONAL_AUTHORED_CONTEXT" }));
  assert.equal(erased.status, 200, JSON.stringify(erased.body));
  const row = x.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id=?").get(plan.draftId);
  assert.equal(row.content, ""); assert.ok(row.redacted_at);
  assert.equal((await inspect(x, plan)).status, 404); assert.equal((await save(x, request)).status, 409);
});
test("updated interface registration permits original receipt recovery but blocks new admission", options, async t => {
  const x = await fixture(t), { runtime } = await controller(x);
  await runtime.prepare(); await runtime.submit(); const route = runtime.documentRoute, original = runtime.release;
  const { body: { plan: uncommitted } } = await save(x, await requestFor()), count = total(x);
  const definition = definitions.find(item => item.id === "image"), previous = definition.revision;
  try {
    definition.revision++;
    const current = await registeredExperience("image"); assert.notEqual(current.releaseHash, original.releaseHash);
    const restored = new ExperienceIntakeRuntime(current, (path, init) => x.request(path, init));
    await restored.resume(runtime.draftId);
    assert.equal(restored.state.phase, "complete"); assert.equal(restored.documentRoute, route);
    assert.equal(restored.release.releaseHash, original.releaseHash); assert.equal(restored.canRetry, false);
    restored.dispose();
    assert.equal((await commit(x, uncommitted)).body.error, "experience_release_changed");
    const calls = [], pending = new ExperienceIntakeRuntime(current, (path, init) => { calls.push(init?.method ?? "GET"); return x.request(path, init); });
    await pending.resume(uncommitted.draftId);
    assert.equal(pending.state.phase, "uncertain"); assert.equal(pending.canRetry, false);
    await pending.submit(); assert.equal(pending.state.issues[0].code, "experience_release_changed");
    assert.ok(calls.every(method => method === "GET")); assert.equal(total(x), count); pending.dispose();
  } finally { definition.revision = previous; runtime.dispose(); }
});
for (const fault of ["eventId", "uuid", "actor", "stream", "sequence", "compensation", "rejection"]) test(`malformed ${fault} receipt never exposes Document handoff`, options, async t => {
  const x = await fixture(t);
  const { runtime } = await controller(x, async (response, path) => {
    if (!path.endsWith("/commit")) return response;
    const body = await response.json(), event = body.appended[0];
    if (fault === "eventId") event.eventId = {};
    else if (fault === "uuid") event.eventId = "-".repeat(36);
    else if (fault === "actor") event.actor = "model";
    else if (fault === "stream") event.streamId = "creative:another";
    else if (fault === "sequence") event.sequence = -1;
    else if (fault === "compensation") event.compensatesEventId = "other";
    else body.rejected = ["partial"];
    return Response.json(body);
  });
  await runtime.prepare(); await runtime.submit(); assert.equal(runtime.state.phase, "uncertain"); assert.equal(runtime.documentRoute, undefined); runtime.dispose();
});

// The complete production view emits real Lit templates. Reuse the established
// finite template/native ports, without mounting an app or exercising held jobs.
// This proves summary text/escaping, not browser layout or assistive technology.
async function renderedSummary(runtime) {
  const { calmFullPageNativePorts: ports } = await import("./helpers/calm-full-page-fixture.mjs");
  const { FormaExperienceSurface } = await ports.loadActual("src/experiences/view.ts");
  const f = { locale: "en", requested: false }, messages = { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs.en };
  f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() { f.requested = true; }, dispatchEvent(event) {
    event.callback({ locale: "en", formatLocale: "en", direction: "ltr", timeZone: "UTC", messages, revision: 1 }, () => {}); return true;
  } });
  f.i18n.hostConnected(); ports.bindFixture(f);
  let markup;
  try {
    const host = new FormaExperienceSurface(); host.runtime = runtime;
    markup = new ports.RendererPort(f, {}).value(host.render(), host, "experience-summary-test");
  } finally { f.i18n.hostDisconnected(); }
  const summaries = [...markup.matchAll(/<dl class="experience-summary">([\s\S]*?)<\/dl>/gu)];
  assert.equal(summaries.length, 1, "one actual review/completed summary, not the repeating direction stage");
  assert.match(summaries[0][1], /&lt;reference&gt; &amp; "quoted"/u, "authored markup is escaped before decoding for text comparison");
  assert.doesNotMatch(summaries[0][1], /<reference>/u);
  const decode = value => value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  return [...summaries[0][1].matchAll(/<div><dt>([\s\S]*?)<\/dt><dd dir="auto">([\s\S]*?)<\/dd><\/div>/gu)].map(([, label, value]) => [decode(label), decode(value)]);
}
for (const id of experienceIds) test(`${id}: actual review, completion and restored summaries preserve authored text and registered labels/order`, options, async t => {
  const x = await fixture(t), release = await registeredExperience(id), values = {};
  const source = '  X-ray / ISO-9001 / 2026-09-02\nsoft-light → <reference> & "quoted"  ';
  for (const decision of release.definition.decisions) {
    const interaction = release.interactions[decision.id];
    values[decision.id] = interaction.kind === "source" ? source
      : interaction.options ? (interaction.options.find(option => option.value.includes("-")) ?? interaction.options.at(-1)).value
      : interaction.kind === "order" ? [3, 1, 2].map(index => ({ id: `e${index}`, text: `${index}: ${source}` }))
      : Object.fromEntries([...interaction.fields].reverse().map((field, index) => [field.id, interaction.kind === "relationship" ? `${field.id}: ${source}` : interaction.minimum + index]));
  }
  const expected = release.definition.decisions.map(decision => {
    const interaction = release.interactions[decision.id], value = values[decision.id];
    return [release.copy[decision.labelKey], interaction.kind === "source" ? source
      : interaction.options ? interaction.options.find(option => option.value === value).label
      : interaction.kind === "order" ? [3, 1, 2].map(index => `${index}: ${source}`).join(" → ")
      : interaction.fields.map(field => `${field.label}: ${value[field.id]}`).join(" · ")];
  });
  const runtime = new ExperienceIntakeRuntime(release, (path, init) => x.request(path, init)); t.after(() => runtime.dispose());
  for (const [decision, value] of Object.entries(values)) assert.equal(runtime.change(decision, value), true);
  await runtime.prepare(); assert.equal(runtime.state.phase, "review");
  assert.deepEqual(await renderedSummary(runtime), expected);
  await runtime.submit(); assert.equal(runtime.state.phase, "complete");
  assert.deepEqual(await renderedSummary(runtime), expected);
  const restored = new ExperienceIntakeRuntime(release, (path, init) => x.request(path, init)); t.after(() => restored.dispose());
  await restored.resume(runtime.draftId); assert.equal(restored.state.phase, "complete");
  assert.deepEqual(await renderedSummary(restored), expected, "canonical JSON key order cannot reorder registered fields");
});

async function validationHost(t, id = "scene") {
  const { calmFullPageNativePorts: ports, fullPageTree } = await import("./helpers/calm-full-page-fixture.mjs");
  const { installOutputNavigationFocusNative } = await import("./helpers/output-navigation-focus-native.mjs");
  const { FormaExperienceSurface } = await ports.loadActual("src/experiences/view.ts");
  const { FormaUiField, FormaUiButton } = await ports.loadActual("src/components/design-primitives.ts");
  const release = await registeredExperience(id), f = { locale: "en", trace: [], listeners: new Map(), changed: new Map(), requested: false, requests: 0, waits: [], hold: false };
  f.runtime = new ExperienceIntakeRuntime(release, async () => { f.requests++; assert.fail("Invalid Review cannot save, commit or call a provider"); });
  const messages = { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs.en };
  f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() { f.requested = true; }, dispatchEvent(event) {
    event.callback({ locale: "en", formatLocale: "en", direction: "ltr", timeZone: "UTC", messages, revision: 1 }, () => {}); return true;
  } });
  f.i18n.hostConnected();
  const inputDescriptor = Object.getOwnPropertyDescriptor(globalThis, "HTMLInputElement");
  Object.defineProperty(globalThis, "HTMLInputElement", { configurable: true, value: class { static [Symbol.hasInstance](node) { return node instanceof ports.ElementPort && node.tag === "input"; } } });
  ports.bindFixture(f);
  f.host = new FormaExperienceSurface(); f.host.tag = "forma-experience"; f.host.runtime = f.runtime; f.host.attributes = {}; f.host.isConnected = true;
  f.renderer = new ports.RendererPort(f, { "forma-ui-field": FormaUiField, "forma-ui-button": FormaUiButton });
  f.tree = () => fullPageTree(f);
  f.native = installOutputNavigationFocusNative(t, f, ports);
  const query = f.renderer.query.bind(f.renderer);
  f.renderer.query = (owner, selector) => {
    const found = query(owner, selector);
    if (f.renderer.updatingOwner || !selector.includes("[")) return found;
    // Native attribute queries return custom element instances in DOM order,
    // not the renderer's extra literal wrapper ports or collection order.
    const selected = new Set(found);
    return f.tree().nodes.filter(row => selected.has(row.port) || selected.has(row.component)).map(row => row.component ?? row.port);
  };
  f.draw = () => {
    ports.bindFixture(f); if (!f.host.isConnected) return;
    f.requested = false; f.renderer.draw(f.host);
    for (const row of f.tree().nodes) if (row.component) row.component.attributes = { ...row.attributes };
  };
  f.tick = async owner => { await Promise.resolve(); f.draw(); if (f.hold && (!f.holdOnly || f.holdOnly === owner.tag)) await new Promise(resolve => f.waits.push(resolve)); return true; };
  f.flush = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); if (f.requested) f.draw(); } await new Promise(setImmediate); if (f.requested) f.draw(); };
  f.inputs = () => f.tree().visible("input").map(row => row.port);
  f.act = async button => { f.native.emit("pointerdown", button); f.native.focus(button); button.click(); await f.flush(); };
  f.review = () => f.act(f.tree().visible("button").find(row => row.text === "Review").port);
  f.release = async () => { f.hold = false; for (const resolve of f.waits.splice(0)) resolve(); await f.flush(); };
  f.host.connectedCallback(); f.draw();
  t.after(async () => {
    f.host.isConnected = false; f.host.disconnectedCallback(); await f.release();
    f.runtime.dispose(); f.i18n.hostDisconnected(); assert.equal(f.requests, 0);
    assert.equal(f.native.listeners("pointerdown"), 0); assert.equal(f.native.listeners("keydown"), 0); assert.equal(f.native.listeners("focusin"), 0);
    if (inputDescriptor) Object.defineProperty(globalThis, "HTMLInputElement", inputDescriptor); else delete globalThis.HTMLInputElement;
  });
  return f;
}
for (const id of experienceIds) test(`${id}: assembled Review marks required fields, associates each error and focuses the first invalid input`, options, async t => {
  const f = await validationHost(t, id);
  for (const input of f.inputs()) if (input.attributes.type !== "range") assert.ok(Object.hasOwn(input.attributes, "required"));
  await f.review(); assert.equal(f.runtime.state.phase, "setup");
  const inputs = f.inputs(), invalid = inputs.filter(input => input.attributes["aria-invalid"] === "true");
  assert.ok(invalid.length > 0); assert.deepEqual(invalid.map(input => input.attributes.name), f.runtime.state.issues.map(issue => issue.path));
  for (const input of invalid) {
    const reference = input.attributes["aria-errormessage"];
    assert.equal(input.attributes["aria-describedby"], reference);
    const errors = f.tree().visible("small").filter(row => row.attributes.id === reference);
    assert.equal(errors.length, 1); assert.equal(errors[0].text, "Required"); assert.equal(errors[0].owner, input.owner);
    assert.ok(f.tree().visible("label").some(row => row.attributes.for === input.attributes.id && row.owner === input.owner));
  }
  assert.equal(f.native.document.activeElement, invalid[0]);
  assert.ok(f.tree().visible("span").some(row => row.attributes.role === "status" && row.text.includes(" · Required")));
});
test("assembled relationship errors leave valid siblings valid", options, async t => {
  const f = await validationHost(t);
  f.runtime.change("conflict", { ...f.runtime.state.draft.values.conflict.value, a: "Participant A" }); f.draw();
  await f.review();
  const valid = f.inputs().find(input => input.attributes.name === "conflict.a");
  assert.equal(valid.attributes["aria-invalid"], "false"); assert.equal(valid.attributes["aria-errormessage"], undefined);
  assert.equal(f.native.document.activeElement.attributes.name, "conflict.goalA");
});
test("assembled evidence errors follow stable IDs through an actual tap reorder", options, async t => {
  const f = await validationHost(t, "slides"); f.runtime.change("claim", "Claim");
  f.runtime.change("evidence", [{ id: "e3", text: "" }, { id: "e1", text: "Evidence" }, { id: "e2", text: "" }]); f.draw();
  await f.review(); assert.equal(f.native.document.activeElement.attributes.name, "evidence.e3.text");
  await f.act(f.tree().visible("button").filter(row => row.text === "Move down")[0].port);
  await f.review();
  assert.deepEqual(f.inputs().filter(input => input.attributes.name.startsWith("evidence.")).map(input => input.attributes.name), ["evidence.e1.text", "evidence.e3.text", "evidence.e2.text"]);
  assert.equal(f.native.document.activeElement.attributes.name, "evidence.e3.text");
  const focused = f.native.document.activeElement;
  assert.ok(f.tree().visible("label").find(row => row.attributes.for === focused.attributes.id).text.startsWith("Evidence 2"));
});
test("assembled defensive error state associates group and range descriptions", options, async t => {
  const f = await validationHost(t, "audio"), original = f.runtime;
  // A declared error-state input to the production presentation interface, not
  // a successful intake or a mutation of the real controller's private state.
  const state = { ...original.state, issues: [{ code: "field_shape", path: "energy" }, { code: "range_limit", path: "energy.peak" }] };
  f.host.runtime = { mode: "intake", release: original.release, presentation: original.presentation, state,
    subscribe: () => () => {}, change: () => false, prepare: async () => {}, back() {}, submit: async () => {}, recover: async () => {} };
  f.changed = new Map([["runtime", original]]); f.draw();
  const group = f.tree().visible("fieldset").find(row => row.attributes["data-experience-invalid"] !== undefined);
  assert.equal(group.attributes.tabindex, "-1");
  assert.ok(f.tree().visible("small").some(row => row.attributes.id === group.attributes["aria-describedby"] && row.text === "Invalid value"));
  const peak = f.inputs().find(input => input.attributes.name === "energy.peak");
  assert.equal(peak.attributes["aria-invalid"], "true"); assert.equal(peak.attributes["aria-describedby"], peak.attributes["aria-errormessage"]);
  assert.ok(f.tree().visible("small").some(row => row.attributes.id === peak.attributes["aria-errormessage"] && row.text === "Range limit"));
  assert.equal(f.inputs().find(input => input.attributes.name === "energy.opening").attributes["aria-invalid"], "false");
});
for (const interruption of ["pointer", "keyboard", "focus", "input", "composition", "replacement", "disconnect"]) test(`assembled invalid-focus handoff retires on newer ${interruption}`, options, async t => {
  const f = await validationHost(t); f.hold = true; await f.review(); assert.ok(f.waits.length > 0);
  const count = f.native.nativeFocus.length;
  if (interruption === "pointer") f.native.emit("pointerdown", f.inputs().at(-1));
  else if (interruption === "keyboard") f.native.emit("keydown");
  else if (interruption === "focus") f.native.focus(f.inputs().at(-1));
  else if (interruption === "input") { const input = f.inputs()[0]; input.value = "New text"; input.handlers.input.call(input.owner, { target: input }); }
  else if (interruption === "composition") f.host.listeners.compositionstart();
  else if (interruption === "replacement") { f.host.runtime = new ExperienceIntakeRuntime(f.runtime.release, async () => assert.fail("No request")); t.after(() => f.host.runtime.dispose()); f.changed = new Map([["runtime", f.runtime]]); f.draw(); }
  else { f.host.isConnected = false; f.host.disconnectedCallback(); }
  const after = f.native.nativeFocus.length;
  await f.release(); assert.equal(f.native.nativeFocus.length, after); assert.equal(after, count + (interruption === "focus" ? 1 : 0));
});
test("assembled invalid-focus handoff pins presentation through the actual child update", options, async t => {
  const f = await validationHost(t, "short-story");
  const { ExperienceRuntime } = await import("./fixtures/experience-runtime/runtime.ts");
  const { proposePatch } = await import("../src/experiences/patches.ts");
  const { fixtureCatalog } = await import("../src/experiences/catalog.ts");
  const original = f.runtime; f.runtime = new ExperienceRuntime(original.release); original.dispose();
  f.host.runtime = f.runtime; f.changed = new Map([["runtime", original]]); f.draw();
  f.hold = true; f.holdOnly = "forma-ui-field"; await f.review(); assert.ok(f.waits.length > 0);
  const before = f.native.nativeFocus.length, draft = f.runtime.state.draft, issues = f.runtime.state.issues;
  const oldFirst = f.renderer.component("forma-ui-field");
  const proposal = await proposePatch(f.runtime.release, { schemaVersion: 1, baseReleaseHash: f.runtime.release.releaseHash,
    operations: [{ kind: "reorder-decisions", ids: f.runtime.release.definition.decisions.map(decision => decision.id).reverse() }] }, fixtureCatalog);
  assert.equal(proposal.ok, true); assert.equal(f.runtime.previewPresentation(proposal.candidate), true);
  assert.equal(f.runtime.state.draft, draft); assert.equal(f.runtime.state.issues, issues); f.draw(); assert.ok(oldFirst.isConnected);
  assert.equal(f.inputs().filter(input => input.attributes["aria-invalid"] === "true")[0].attributes.name, "causality.goal");
  await f.release(); assert.equal(f.native.nativeFocus.length, before);
});
test("assembled repeated Review leaves only the latest invalid-focus handoff active", options, async t => {
  const f = await validationHost(t); f.hold = true; await f.review(); await f.review();
  const before = f.native.nativeFocus.length; await f.release();
  assert.equal(f.native.nativeFocus.length, before + 1); assert.equal(f.native.document.activeElement.attributes.name, "conflict.a");
});

test("exact catalog and draft API grammar dispatches without an asset fallback", options, async t => {
  const x = await fixture(t), before = total(x);
  x.env.ASSETS.fetch = async () => assert.fail("Experience API paths must not fall through to assets");
  const catalog = await x.send("/api/experiences/catalog");
  assert.equal(catalog.status, 200); assert.equal(catalog.body.version, 1);
  assert.equal(catalog.body.generation, "unavailable");
  assert.deepEqual(catalog.body.experiences.map(release => release.definition.id), experienceIds);
  assert.equal(catalog.response.headers.get("cache-control"), "private, no-store");
  const missing = "experience-draft-" + "0123456789abcdef".repeat(4);
  const draft = "/api/experiences/drafts/" + missing;
  const cases = [
    ["GET", "/api/experiences", 404, "not_found"],
    ["GET", "/api/experiences/", 404, "not_found"],
    ["GET", "/api/experiences/catalog/", 404, "not_found"],
    ["POST", "/api/experiences/catalog", 404, "not_found"],
    ["GET", "/api/experiences/drafts-extra", 404, "not_found"],
    ["GET", "/api/experiences/drafts/", 404, "not_found"],
    ["GET", draft + "0", 404, "not_found"],
    ["GET", draft.replace("abcdef", "ABCDEF"), 404, "not_found"],
    ["GET", draft + "/commit/extra", 404, "not_found"],
    ["GET", draft + "/receipt/", 404, "not_found"],
    ["GET", draft + "/COMMIT", 404, "not_found"],
    ["GET", "/api/experiences/drafts", 405, "method_not_allowed"],
    ["GET", "/api/experiences/drafts?intentId=invalid", 405, "method_not_allowed"],
    ["GET", "/api/experiences/drafts?intentId=00000000-0000-4000-8000-000000000000&extra=1", 405, "method_not_allowed"],
    ["GET", "/api/experiences/drafts?intentId=00000000-0000-4000-8000-000000000000", 404, "experience_draft_unavailable"],
    ["GET", draft, 404, "experience_draft_unavailable"],
    ["GET", draft + "/receipt", 404, "experience_draft_unavailable"],
    ["POST", draft + "/commit", 404, "experience_draft_unavailable"],
    ["POST", draft, 405, "method_not_allowed"],
    ["GET", draft + "/commit", 405, "method_not_allowed"],
    ["POST", draft + "/receipt", 405, "method_not_allowed"],
    ["GET", "/api/experience/catalog", 404, "not_found"],
  ];
  for (const [method, path, status, error] of cases) {
    const response = await x.send(path, method === "POST" ? json({ draftHash: "unretained" }) : undefined);
    assert.equal(response.status, status, method + " " + path);
    assert.equal(response.body.error, error, method + " " + path);
    assert.equal(response.response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(total(x), before);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='experience-draft'").get().n, 0);
});

test("draft reads and commits preserve owner and initial-role denial without persistence", options, async t => {
  const x = await fixture(t, true), saved = await save(x, await requestFor());
  assert.equal(saved.status, 200);
  const plan = saved.body.plan, path = "/api/experiences/drafts/" + plan.draftId;
  const before = Object.fromEntries(["private_content", "events", "event_client_receipts"].map(table => [table, x.sqlite.prepare("SELECT * FROM " + table).all()]));
  x.setScopedHeaders({ "oai-authenticated-user-id": "another-owner", "oai-authenticated-user-email": "another@example.test" });
  for (const [route, init] of [[path], [path + "/receipt"], [path + "/commit", json({ draftHash: plan.draftHash })]]) {
    const denied = await x.send(route, init);
    assert.equal(denied.status, 404); assert.equal(denied.body.error, "experience_draft_unavailable");
  }
  x.setScopedHeaders({});
  x.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(x.owner);
  for (const [route, init] of [
    ["/api/experiences/drafts", json(await requestFor())],
    [path], [path + "/receipt"], [path + "/commit", json({ draftHash: plan.draftHash })],
  ]) {
    const denied = await x.send(route, init);
    assert.equal(denied.status, 403); assert.equal(denied.body.error, "insufficient_role");
  }
  await x.drainBackground();
  for (const [table, rows] of Object.entries(before)) assert.deepEqual(x.sqlite.prepare("SELECT * FROM " + table).all(), rows, table);
});

test("experience private identities require exact primitive lowercase hashes and retain the first body", options, async t => {
  const x = await fixture(t);
  const { preparePrivateContent, storePrivateContent } = await import("../worker/pilot-policy.ts");
  const contentId = "experience-draft-" + "0123456789abcdef".repeat(4);
  let coercions = 0;
  const invalid = [
    [contentId], new String(contentId), { toString() { coercions++; return contentId; } },
    "experience-draft-" + "0123456789ABCDEF".repeat(4),
    "experience-draft-" + "a".repeat(63), "experience-draft-" + "a".repeat(65),
    "experience-draft-" + "g".repeat(64), "Experience-draft-" + "a".repeat(64),
    " " + contentId, contentId + " ", contentId + "\n",
  ];
  const bindings = x.controls.bindings.length, writes = x.controls.writes.length;
  for (const value of invalid) await assert.rejects(
    preparePrivateContent(x.env, x.owner, "experience-draft", "Not retained", undefined, undefined, undefined, { contentId: value }),
    { message: "private_content_identity_invalid" },
  );
  await assert.rejects(
    preparePrivateContent(x.env, x.owner, "prompt", "Not retained", undefined, undefined, undefined, { contentId }),
    { message: "private_content_identity_invalid" },
  );
  assert.equal(coercions, 0, "identity validation never asks an object for its string value");
  assert.equal(x.controls.bindings.length, bindings); assert.equal(x.controls.writes.length, writes);
  const first = await storePrivateContent(x.env, x.owner, "experience-draft", "Retained original", undefined, undefined, undefined, { contentId });
  assert.equal(first.contentId, contentId);
  await assert.rejects(
    storePrivateContent(x.env, x.owner, "experience-draft", "Changed retry", undefined, undefined, undefined, { contentId }),
    /UNIQUE constraint failed: private_content\.content_id/u,
  );
  const rows = x.sqlite.prepare("SELECT content_id,owner_id,kind,content FROM private_content WHERE content_id=?").all(contentId);
  assert.deepEqual(rows.map(row => ({ ...row })), [{ content_id: contentId, owner_id: x.owner, kind: "experience-draft", content: "Retained original" }]);
});

test("save-time role loss leaves private drafts, canonical events and receipts all unchanged", options, async t => {
  const x = await fixture(t), request = await requestFor();
  const before = Object.fromEntries(["private_content", "events", "event_client_receipts"].map(table => [table, x.sqlite.prepare("SELECT * FROM " + table).all()]));
  let reached = false;
  x.controls.beforeBatch = async statements => {
    if (statements.some(item => item.sql.includes("INSERT INTO private_content(") && item.values[2] === "experience-draft")) {
      reached = true; x.controls.beforeBatch = null;
      x.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(x.owner);
    }
  };
  const response = await save(x, request);
  assert.equal(reached, true); assert.equal(response.status, 409);
  assert.equal(response.body.error, "experience_save_unconfirmed");
  await x.drainBackground();
  for (const [table, rows] of Object.entries(before)) assert.deepEqual(x.sqlite.prepare("SELECT * FROM " + table).all(), rows, table);
});

test("all, chat and memory hydration exclude drafts and authoring previews while preserving ordinary content", options, async t => {
  const x = await fixture(t), saved = await save(x, await requestFor());
  assert.equal(saved.status, 200);
  const { storePrivateContent } = await import("../worker/pilot-policy.ts");
  const hidden = [saved.body.plan.draftId];
  for (const prefix of ["copy-preview-", "canvas-arrangement-preview-"]) {
    const contentId = prefix + "a".repeat(64);
    const stored = await storePrivateContent(x.env, x.owner, "authoring-preview", "Retained authoring review", undefined, undefined, undefined, { contentId });
    assert.equal(stored.contentId, contentId); hidden.push(contentId);
  }
  const controls = [];
  for (const [kind, content, scopes] of [
    ["prompt", "Ordinary prompt", ["all"]],
    ["condition", "Ordinary memory", ["all", "memory"]],
    ["chat-user", "Ordinary user chat", ["all", "chat"]],
    ["chat-assistant", "Ordinary assistant chat", ["all", "chat"]],
    ["provider-output", "Ordinary provider output", ["all"]],
    ["provider-response", "Server-only provider evidence", []],
  ]) {
    const stored = await storePrivateContent(x.env, x.owner, kind, content);
    controls.push({ ...stored, kind, content, scopes });
  }
  for (const scope of ["all", "chat", "memory"]) {
    const loaded = await loadPrivateContent(x.env, x.owner, scope);
    for (const contentId of hidden) assert.equal(Object.hasOwn(loaded, contentId), false, scope + " excludes " + contentId);
    for (const item of controls) assert.equal(loaded[item.contentId], item.scopes.includes(scope) ? item.content : undefined, scope + " " + item.kind);
    assert.equal(loaded[x.contentRef], scope === "all" ? x.content : undefined, scope + " existing document artifact");
  }
  for (const contentId of hidden) assert.ok(x.sqlite.prepare("SELECT content FROM private_content WHERE content_id=? AND redacted_at IS NULL").get(contentId)?.content, "excluded content remains retained");
});


// Primitive-provenance successor, SOURCE ONLY. The complete R1 test prefix is
// retained. These imports reuse the intake module already reached by this file;
// no new helper, loader, registry, provider or SQL implementation is introduced.
import { intakeValueIssues, validateIntakeRequest, buildExperiencePlan } from "../src/experiences/intake.ts";

test("all registered intake models reject JSON-safe nonprimitive provenance before plan construction", options, async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No network request in provenance model validation"));
  // Exact twelve-value matrix from the retained Scene correction. All are
  // expressible as JSON; no functions, getters, proxies or custom prototypes.
  const malformed = [[], ["default"], ["authored"], ["default", "authored"],
    {}, { toString: "default" }, { toString: "authored" }, null, true, false, 0, 1];
  let negativeCases = 0, authoredControls = 0, defaultControls = 0;
  for (const id of experienceIds) {
    const request = await requestFor(id), release = await registeredExperience(id), decisionId = release.definition.decisions[0].id;
    const healthy = await validateIntakeRequest(request);
    assert.ok(healthy, id + ": healthy registered request");
    assert.equal(healthy.release.releaseHash, request.releaseHash);
    assert.equal(request.values[decisionId].provenance, "authored");
    assert.deepEqual(intakeValueIssues(release, request.values), []);
    const plan = await buildExperiencePlan("provenance-model-owner", request, release);
    assert.deepEqual(await buildExperiencePlan("provenance-model-owner", request, release), plan);
    authoredControls++;
    for (const provenance of malformed) {
      const changed = structuredClone(request);
      changed.values[decisionId].provenance = structuredClone(provenance);
      const before = JSON.stringify(changed);
      assert.deepEqual(intakeValueIssues(release, changed.values), [{ code: "value_invalid", path: decisionId }], id + ": " + JSON.stringify(provenance));
      assert.equal(await validateIntakeRequest(changed), null, "Malformed provenance returns invalid instead of coercing or throwing");
      await assert.rejects(buildExperiencePlan("provenance-model-owner", changed, release),
        { name: "Error", message: "experience_request_invalid" });
      assert.equal(JSON.stringify(changed), before, "Validation preserves caller-owned JSON data");
      negativeCases++;
    }
    const defaultDecision = release.definition.decisions.find(decision => request.values[decision.id].provenance === "default");
    if (defaultDecision) {
      assert.deepEqual(request.values[defaultDecision.id].value, release.interactions[defaultDecision.id].defaultValue);
      const block = plan.events.find(event => event.type === "BlockCreated" && event.payload.properties.experience_binding === defaultDecision.bindingSlot);
      assert.equal(block.payload.properties.experience_origin, "default");
      assert.equal(block.payload.properties.authority, "inferred");
      const explicit = structuredClone(request); explicit.values[defaultDecision.id].provenance = "authored";
      assert.ok(await validateIntakeRequest(explicit));
      const authored = await buildExperiencePlan("provenance-model-owner", explicit, release);
      const authoredBlock = authored.events.find(event => event.type === "BlockCreated" && event.payload.properties.experience_binding === defaultDecision.bindingSlot);
      assert.equal(authoredBlock.payload.properties.experience_origin, "authored");
      assert.equal(authoredBlock.payload.properties.authority, "authored");
      assert.deepEqual(authoredBlock.payload.properties.experience_value, request.values[defaultDecision.id].value);
      defaultControls++;
    } else {
      assert.equal(id, "slides", "Required source/order defaults remain incomplete");
      const changed = structuredClone(request); changed.values[decisionId].provenance = "default";
      await assert.rejects(buildExperiencePlan("provenance-model-owner", changed, release),
        { name: "Error", message: "experience_request_invalid" });
    }
    if (id === "image") {
      const changed = structuredClone(request); changed.values.composition = { value: "left", provenance: "default" };
      assert.deepEqual(intakeValueIssues(release, changed.values), [{ code: "provenance_invalid", path: "composition" }]);
      assert.equal(await validateIntakeRequest(changed), null);
      await assert.rejects(buildExperiencePlan("provenance-model-owner", changed, release),
        { name: "Error", message: "experience_request_invalid" });
    }
  }
  assert.equal(negativeCases, 96); assert.equal(authoredControls, 8); assert.equal(defaultControls, 7);
});

test("routed malformed provenance returns private 400 without retained intake writes and preserves primitive controls", options, async t => {
  const x = await fixture(t), request = await requestFor("image");
  const catalog = await x.send("/api/experiences/catalog");
  assert.equal(catalog.status, 200);
  const before = Object.fromEntries(["private_content", "events", "event_client_receipts"].map(table => [table, x.sqlite.prepare("SELECT * FROM " + table).all()]));
  const malformed = [["default"], ["authored"], [["default"]], { toString: "default" },
    { toString: null }, { toString: "default", valueOf: null }, [{ toString: null }]];
  // "default" is primitive but invalid with a changed value. Keep its original
  // rejection alongside the nonprimitive cases that previously coerced/threw.
  for (const provenance of [...malformed, "default"]) {
    const changed = structuredClone(request); changed.values.composition = { value: "left", provenance: structuredClone(provenance) };
    const original = JSON.stringify(changed);
    const response = await save(x, changed);
    assert.equal(response.status, 400, JSON.stringify(provenance));
    assert.deepEqual(response.body, { error: "experience_request_invalid" });
    assert.equal(response.response.headers.get("cache-control"), "private, no-store");
    assert.equal(JSON.stringify(changed), original);
    await x.drainBackground();
    for (const [table, rows] of Object.entries(before)) assert.deepEqual(x.sqlite.prepare("SELECT * FROM " + table).all(), rows, table + ": rejected provenance");
  }
  assert.deepEqual((await x.send("/api/experiences/catalog")).body, catalog.body, "Invalid intake cannot revise the registered catalog or release identities");
  for (const [value, provenance, authority] of [["center", "default", "inferred"], ["left", "authored", "authored"]]) {
    const valid = await requestFor("image"); valid.values.composition = { value, provenance };
    const saved = await save(x, valid);
    assert.equal(saved.status, 200); assert.equal(saved.body.status, "prepared");
    assert.equal(saved.response.headers.get("cache-control"), "private, no-store");
    assert.equal(saved.body.plan.request.releaseHash, request.releaseHash);
    const block = saved.body.plan.events.find(event => event.type === "BlockCreated" && event.payload.properties.experience_binding === "composition");
    assert.equal(block.payload.properties.experience_value, value);
    assert.equal(block.payload.properties.experience_origin, provenance);
    assert.equal(block.payload.properties.authority, authority);
  }
  await x.drainBackground();
  for (const table of ["events", "event_client_receipts"]) assert.deepEqual(x.sqlite.prepare("SELECT * FROM " + table).all(), before[table], table + ": preparing valid drafts does not commit");
  // requireUser may synchronize schema/users. The negative assertions cover the
  // named retained-content/event/receipt tables, not all global SQL activity.
});


test("setup GET and HEAD select the private dedicated host without starting intake or session bootstrap", options, async t => {
  const x = await fixture(t), requested = [];
  x.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run(x.owner);
  const before = Object.fromEntries(["private_content", "events", "event_client_receipts"].map(table => [table, x.sqlite.prepare("SELECT * FROM " + table).all()]));
  const entry = "<!doctype html><html><head></head><body>Dedicated setup host</body></html>";
  x.env.ASSETS.fetch = async request => {
    requested.push({ url: request.url, method: request.method });
    // Deliberately provide a body for HEAD too: the Worker owns suppression.
    return new Response(entry, { headers: { "content-type": "text/html", "cache-control": "public, max-age=600", vary: "Accept-Encoding" } });
  };
  const draft = "experience-draft-" + "a".repeat(64), intent = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const path of ["/make", "/make/", "/make/image", "/make/scene?draft=" + draft,
    "/make/short-story?intent=" + intent, "/make/audio?%64raft=" + draft]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await x.request(path, { method });
      assert.equal(response.status, 200, method + " " + path);
      assert.equal(response.headers.get("x-forma-route-family"), "experience");
      assert.equal(response.headers.get("x-forma-application"), "creative");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const vary = response.headers.get("vary").toLowerCase().split(",").map(value => value.trim());
      for (const field of ["accept-encoding", "cookie", "oai-authenticated-user-id", "oai-authenticated-user-email", "cf-access-authenticated-user-email"]) assert.ok(vary.includes(field), field);
      assert.equal(await response.text(), method === "HEAD" ? "" : entry, "No creative session-bootstrap is injected into the setup host");
      assert.deepEqual(requested.at(-1), { url: "http://localhost/experiences", method });
    }
  }
  assert.equal(requested.length, 12);
  await x.drainBackground();
  for (const [table, rows] of Object.entries(before)) assert.deepEqual(x.sqlite.prepare("SELECT * FROM " + table).all(), rows, table);
});

test("setup principal, role, consent and selected-project refusals never fetch an entry asset", options, async t => {
  const x = await fixture(t, true), requested = [];
  x.env.ASSETS.fetch = async request => { requested.push(request.url); return new Response("Unexpected setup asset"); };
  const before = Object.fromEntries(["private_content", "events", "event_client_receipts"].map(table => [table, x.sqlite.prepare("SELECT * FROM " + table).all()]));
  const path = "/make/image?intent=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const role of ["viewer", "agent"]) {
    x.sqlite.prepare("UPDATE users SET role=? WHERE user_id=?").run(role, x.owner);
    for (const method of ["GET", "HEAD"]) {
      const response = await x.request(path, { method });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.ok(response.headers.get("vary").toLowerCase().includes("cookie"));
      if (method === "HEAD") assert.equal(await response.text(), "");
      else assert.equal((await response.json()).error, "insufficient_role");
    }
  }
  x.sqlite.prepare("UPDATE users SET role='creator',consent_version=NULL WHERE user_id=?").run(x.owner);
  for (const method of ["GET", "HEAD"]) {
    const response = await x.request("/make", { method });
    assert.equal(response.status, 428); assert.equal(response.headers.get("cache-control"), "private, no-store");
    if (method === "HEAD") assert.equal(await response.text(), "");
    else assert.equal((await response.json()).error, "pilot_terms_required");
  }
  x.sqlite.prepare("UPDATE users SET role='admin',consent_version='pilot-2026-08-10' WHERE user_id=?").run(x.owner);
  const now = new Date().toISOString();
  // Existing RAM SQLite tables model an active fictional persona. The real
  // principal-only requireUser path must reject it before returning setup HTML.
  x.sqlite.prepare("INSERT INTO replay_personas(persona_id,session_id,owner_id,fictional_user_id,fictional_stream_id,display_name,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'ready',?,?)")
    .run("setup-persona", "setup-replay", x.owner, "another-owner", "creative:another-owner", "Setup persona", now, now);
  x.sqlite.prepare("INSERT INTO impersonation_sessions(impersonation_id,actor_user_id,persona_id,fictional_user_id,replay_session_id,status,started_at,expires_at) VALUES(?,?,?,?,?,'active',?,?)")
    .run("setup-impersonation", x.owner, "setup-persona", "another-owner", "setup-replay", now, "9999-12-31T23:59:59.999Z");
  x.setScopedHeaders({ cookie: "forma_impersonation=setup-impersonation" });
  for (const method of ["GET", "HEAD"]) {
    const response = await x.request(path, { method });
    assert.equal(response.status, 409); assert.equal(response.headers.get("cache-control"), "private, no-store");
    if (method === "HEAD") assert.equal(await response.text(), "");
    else assert.equal((await response.json()).error, "return_to_principal_before_internal_access");
  }
  x.setScopedHeaders({});
  await x.drainBackground();
  for (const [table, rows] of Object.entries(before)) assert.deepEqual(x.sqlite.prepare("SELECT * FROM " + table).all(), rows, table);

  // Reuse the established helper's actual selected-project setup, rather than
  // forging an auth object or treating an unissued context token as selection.
  const shared = await createSceneCostFixture(1, "visual", { shared: true }), financial = shared.counts();
  t.after(() => { assert.deepEqual(shared.counts(), financial); shared.close(); });
  shared.env.ASSETS.fetch = async request => { requested.push(request.url); return new Response("Unexpected shared setup asset"); };
  const sharedBefore = Object.fromEntries(["private_content", "events", "event_client_receipts"].map(table => [table, shared.sqlite.prepare("SELECT * FROM " + table).all()]));
  for (const method of ["GET", "HEAD"]) {
    const response = await shared.request("/make/scene", { method });
    assert.equal(response.status, 403); assert.equal(response.headers.get("cache-control"), "private, no-store");
    if (method === "HEAD") assert.equal(await response.text(), "");
    else assert.equal((await response.json()).error, "personal_author_required");
  }
  await shared.drainBackground();
  for (const [table, rows] of Object.entries(sharedBefore)) assert.deepEqual(shared.sqlite.prepare("SELECT * FROM " + table).all(), rows, table);
  assert.deepEqual(requested, []);
});

test("malformed setup queries and direct backing-entry aliases never reach assets", options, async t => {
  const x = await fixture(t), requested = [], before = total(x);
  x.env.ASSETS.fetch = async request => { requested.push(request.url); return new Response("Unexpected entry"); };
  const draft = "experience-draft-" + "a".repeat(64), intent = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const invalid = ["/make?", "/make?draft=" + draft, "/make/image?",
    "/make/image?draft=" + draft + "&", "/make/image?draft=" + draft + "&%64raft=" + draft,
    "/make/image?intent=" + intent + "&%69ntent=" + intent,
    "/make/image?draft=" + draft + "&intent=" + intent,
    "/make/short-story?artifact=a&revision=1&sha256=" + "a".repeat(64),
    "/make/image?unknown=value", "/make/image?draft=", "/make/image?intent=not-an-intent"];
  const aliases = ["/experiences", "/experiences/", "/experiences.html", "/experiences/index.html",
    "/experiences?draft=" + draft, "/EXPERIENCES.HTML", "/%65xperiences.html"];
  for (const path of [...invalid, ...aliases]) for (const method of ["GET", "HEAD"]) {
    const response = await x.request(path, { method });
    assert.equal(response.status, 404, method + " " + path);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  for (const path of ["/make", "/make/image?draft=" + draft]) {
    const response = await x.request(path, { method: "POST" });
    assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "GET, HEAD");
  }
  assert.deepEqual(requested, []); assert.equal(total(x), before);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='experience-draft'").get().n, 0);
});

test("native retained selection keeps the creative reader and its existing viewer bootstrap", options, async t => {
  const x = await fixture(t), requested = [], before = total(x);
  x.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(x.owner);
  x.env.ASSETS.fetch = async request => {
    requested.push(new URL(request.url).pathname);
    return new Response("<!doctype html><html><head></head><body>Native retained reader</body></html>", { headers: { "content-type": "text/html" } });
  };
  const path = "/make/short-story?document=doc-a&artifact=artifact-a&revision=3&sha256=" + "a".repeat(64);
  const response = await x.request(path);
  assert.equal(response.status, 200); assert.equal(response.headers.get("x-forma-route-family"), "/make/short-story");
  assert.equal(response.headers.get("x-forma-application"), "creative");
  const body = await response.text();
  assert.match(body, /Native retained reader/u);
  assert.match(body, /<script id="forma-session-bootstrap" type="application\/json"/u);
  assert.deepEqual(requested, ["/creative/"]);
  await x.drainBackground(); assert.equal(total(x), before);
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='experience-draft'").get().n, 0);
});
// Document-creation provenance only: reuse the actual intake fixture/controller.
// A captured receipt is data; current ownership still requires the live getter.
test("Document receipt publishes the verified frozen plan and ordered native event projection before completion notification", options, async t => {
  const x = await fixture(t); let savedPlan, nativeResult;
  const { runtime } = await controller(x, async (response, path) => {
    if (path === "/api/experiences/drafts") savedPlan = (await response.clone().json()).plan;
    if (path.endsWith("/commit")) nativeResult = await response.clone().json();
    return response;
  });
  try {
    const notices = [];
    runtime.subscribe(() => notices.push({ phase: runtime.state.phase, receipt: runtime.documentReceipt }));
    assert.equal(runtime.documentReceipt, undefined);
    await runtime.prepare(); await runtime.submit();
    assert.equal(runtime.state.phase, "complete");
    const receipt = runtime.documentReceipt;
    assert.ok(receipt); assert.equal(runtime.documentReceipt, receipt);
    assert.deepEqual(Object.keys(receipt), ["kind", "plan", "documentRoute", "head", "appended"]);
    assert.equal(receipt.kind, "document-commit");
    assert.deepEqual(receipt.plan, savedPlan); assert.notEqual(receipt.plan, savedPlan);
    assert.equal(receipt.documentRoute, runtime.documentRoute);
    assert.equal(documentIdFromRoute(receipt.documentRoute), savedPlan.documentId);
    assert.equal(receipt.head, nativeResult.head);
    assert.deepEqual(receipt.appended, nativeResult.appended.map(({ eventId, sequence }) => ({ eventId, sequence })));
    assert.deepEqual(nativeResult.appended.map(({ type, payload }) => ({ type, payload })), savedPlan.events);
    const ids = new Set(receipt.appended.map(event => event.eventId));
    const retained = (await readWorkspaceEvents(x.env, x.streamId)).filter(event => ids.has(event.eventId));
    assert.deepEqual(receipt.appended, retained.map(({ eventId, sequence }) => ({ eventId, sequence })));
    assert.ok(notices.filter(notice => notice.phase !== "complete").every(notice => notice.receipt === undefined));
    assert.deepEqual(notices.filter(notice => notice.phase === "complete").map(notice => notice.receipt), [receipt]);
    assert.equal(notices.at(-1).receipt, receipt, "the same receipt is installed before the complete subscriber runs");
    const snapshot = structuredClone(receipt), pending = [receipt], count = total(x);
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== "object") continue;
      assert.ok(Object.isFrozen(value)); pending.push(...Object.values(value));
    }
    assert.equal(Reflect.set(receipt, "head", receipt.head + 1), false);
    assert.equal(Reflect.set(receipt.appended[0], "eventId", "changed"), false);
    assert.equal(Reflect.set(receipt.plan.request.values.subject, "value", "changed"), false);
    savedPlan.request.values.subject.value = "changed response copy";
    nativeResult.appended[0].eventId = "changed response copy";
    assert.deepEqual(receipt, snapshot); assert.equal(runtime.documentReceipt, receipt); assert.equal(total(x), count);
    runtime.dispose();
    assert.equal(runtime.documentReceipt, undefined); assert.deepEqual(receipt, snapshot, "detaching does not turn retained data into a live grant");
  } finally { runtime.dispose(); }
});

test("Document receipt stays unavailable through setup, review, back and cancellation before commit", options, async t => {
  const x = await fixture(t), { runtime, calls } = await controller(x), before = total(x);
  try {
    assert.equal(runtime.state.phase, "setup"); assert.equal(runtime.documentReceipt, undefined);
    await runtime.prepare(); assert.equal(runtime.state.phase, "review"); assert.equal(runtime.documentReceipt, undefined);
    runtime.back(); assert.equal(runtime.state.phase, "setup"); assert.equal(runtime.documentReceipt, undefined);
    assert.equal(runtime.change("subject", "Revised before committing"), true);
    await runtime.prepare(); assert.equal(runtime.state.phase, "review"); assert.equal(runtime.documentReceipt, undefined);
    // This runtime has no cancel mutation: disposal withdraws this review owner.
    runtime.dispose(); const requests = calls.length;
    await runtime.submit(); await runtime.recover();
    assert.equal(runtime.documentReceipt, undefined); assert.equal(calls.length, requests);
    assert.equal(calls.some(call => call.path.endsWith("/commit")), false); assert.equal(total(x), before);
  } finally { runtime.dispose(); }
});

test("Document receipt is unavailable after failed or canceled transport until verified read-only recovery", options, async t => {
  for (const stage of ["failed save", "canceled commit"]) await t.test(stage, async t => {
    const x = await fixture(t); let dropped = false;
    const { runtime, calls } = await controller(x, async (response, path) => {
      if (!dropped && (stage === "failed save" ? path === "/api/experiences/drafts" : path.endsWith("/commit"))) {
        dropped = true;
        throw stage === "failed save" ? new Error("receipt_save_response_lost") : new DOMException("receipt_commit_response_canceled", "AbortError");
      }
      return response;
    });
    try {
      await runtime.prepare(); if (stage === "canceled commit") await runtime.submit();
      assert.equal(runtime.state.phase, "uncertain"); assert.equal(runtime.documentReceipt, undefined);
      const count = total(x), beforeRecovery = calls.length;
      await runtime.recover();
      assert.ok(calls.slice(beforeRecovery).length > 0);
      assert.ok(calls.slice(beforeRecovery).every(call => call.method === "GET")); assert.equal(total(x), count);
      if (stage === "failed save") {
        assert.equal(runtime.state.phase, "uncertain"); assert.equal(runtime.documentReceipt, undefined);
      } else {
        // Losing/canceling delivery did not roll back the actual server commit.
        assert.equal(runtime.state.phase, "complete"); assert.ok(runtime.documentReceipt);
        const native = await x.send(`/api/experiences/drafts/${runtime.draftId}/receipt`);
        assert.deepEqual(runtime.documentReceipt.appended, native.body.appended.map(({ eventId, sequence }) => ({ eventId, sequence })));
      }
    } finally { runtime.dispose(); }
  });
});

test("Document receipt rejects incomplete and mismatched native completion bodies", options, async t => {
  for (const fault of ["incomplete status", "partial native events", "wrong Document", "mismatched native payload"]) await t.test(fault, async t => {
    const x = await fixture(t);
    const { runtime } = await controller(x, async (response, path) => {
      if (!path.endsWith("/commit")) return response;
      const body = await response.json();
      if (fault === "incomplete status") body.status = "pending";
      else if (fault === "partial native events") body.appended.pop();
      else if (fault === "wrong Document") body.documentId += "-different";
      else body.appended[0].payload = { ...body.appended[0].payload, receiptOnlyForgery: true };
      return Response.json(body);
    });
    try {
      await runtime.prepare(); await runtime.submit();
      assert.equal(runtime.state.phase, "uncertain"); assert.equal(runtime.state.issues[0].code, "experience_result_mismatch");
      assert.equal(runtime.documentReceipt, undefined); assert.equal(runtime.documentRoute, undefined);
      const native = await x.send(`/api/experiences/drafts/${runtime.draftId}/receipt`);
      assert.equal(native.body.status, "complete", "local refusal neither deletes nor claims the actual committed Document");
      assert.equal(runtime.documentReceipt, undefined, "an unrelated inspection does not install a controller receipt");
    } finally { runtime.dispose(); }
  });
});

test("Document receipt currentness is withdrawn when completion notification throws or disposes", options, async t => {
  for (const outcome of ["throwing recipient", "disposing recipient"]) await t.test(outcome, async t => {
    const x = await fixture(t), { runtime } = await controller(x); let captured;
    const later = [], failure = new Error("document_receipt_recipient_failed");
    try {
      runtime.subscribe(() => {
        if (runtime.state.phase !== "complete") return;
        captured = runtime.documentReceipt; assert.ok(captured);
        if (outcome === "throwing recipient") throw failure;
        runtime.dispose(); assert.equal(runtime.documentReceipt, undefined);
      });
      runtime.subscribe(() => later.push({ phase: runtime.state.phase, receipt: runtime.documentReceipt }));
      await runtime.prepare(); await runtime.submit();
      assert.ok(captured); assert.ok(Object.isFrozen(captured)); assert.equal(runtime.documentReceipt, undefined);
      if (outcome === "throwing recipient") {
        assert.equal(runtime.state.phase, "uncertain"); assert.equal(runtime.state.issues[0].code, failure.message);
        assert.equal(later.at(-1).phase, "uncertain");
      } else {
        assert.equal(runtime.state.phase, "complete"); assert.equal(later.at(-1).phase, "complete");
      }
      assert.equal(later.at(-1).receipt, undefined, "later copied listeners cannot treat a retired receipt as current");
    } finally { runtime.dispose(); }
  });
});

test("a late old committed response cannot install a Document receipt into a disposed or replacement runtime", options, async t => {
  const x = await fixture(t); let releaseCommit, reachedCommit, didReach = false, nativeResult, submission, replacement;
  const held = new Promise(resolve => { releaseCommit = resolve; }), reached = new Promise(resolve => { reachedCommit = resolve; });
  const { runtime: old } = await controller(x, async (response, path) => {
    if (path.endsWith("/commit")) {
      nativeResult = await response.clone().json(); didReach = true; reachedCommit(); await held;
    }
    return response;
  });
  try {
    await old.prepare(); assert.equal(old.state.phase, "review");
    submission = old.submit();
    await Promise.race([reached, submission]); assert.ok(didReach, "the original committed response reaches the explicit delivery hold");
    assert.equal(nativeResult.status, "complete"); assert.equal(old.documentReceipt, undefined);
    old.dispose();
    ({ runtime: replacement } = await controller(x));
    assert.equal(replacement.documentReceipt, undefined);
    await replacement.prepare(); await replacement.submit();
    const current = replacement.documentReceipt; assert.ok(current);
    assert.notEqual(current.plan.documentId, nativeResult.documentId);
    const count = total(x); releaseCommit(); await submission;
    assert.notEqual(old.state.phase, "complete"); assert.equal(old.documentReceipt, undefined);
    assert.equal(replacement.documentReceipt, current); assert.equal(total(x), count);
    const original = await x.send(`/api/experiences/drafts/${old.draftId}/receipt`);
    assert.equal(original.body.status, "complete"); assert.deepEqual(original.body.appended, nativeResult.appended);
  } finally {
    old.dispose(); replacement?.dispose(); releaseCommit();
    if (submission) await submission;
  }
});

test("Document receipt recovery keeps the original release and same Document using only GET", options, async t => {
  for (const byIntent of [false, true]) await t.test(byIntent ? "intent recovery" : "draft recovery", async t => {
    const x = await fixture(t), { runtime } = await controller(x), definition = definitions.find(item => item.id === "image"), previous = definition.revision;
    let restored;
    try {
      await runtime.prepare(); await runtime.submit();
      const original = runtime.documentReceipt; assert.ok(original); runtime.dispose();
      assert.equal(runtime.documentReceipt, undefined);
      definition.revision++;
      const current = await registeredExperience("image"); assert.notEqual(current.releaseHash, original.plan.release.releaseHash);
      const id = byIntent ? original.plan.request.intentId : original.plan.draftId, calls = [], count = total(x);
      restored = new ExperienceIntakeRuntime({ experienceId: "image", id, byIntent }, (path, init) => {
        calls.push({ path, method: init?.method ?? "GET" }); return x.request(path, init);
      });
      assert.equal(restored.documentReceipt, undefined); assert.equal(restored.release, undefined);
      assert.deepEqual(restored.state.draft.values, {});
      await restored.recover();
      assert.equal(restored.state.phase, "complete");
      const recovered = restored.documentReceipt;
      assert.ok(recovered); assert.notEqual(recovered, original); assert.deepEqual(recovered, original);
      assert.equal(recovered.plan.release.releaseHash, original.plan.release.releaseHash);
      assert.equal(restored.release.releaseHash, original.plan.release.releaseHash);
      assert.equal(documentIdFromRoute(recovered.documentRoute), original.plan.documentId);
      assert.deepEqual(calls, [
        { path: byIntent ? `/api/experiences/drafts?intentId=${id}` : `/api/experiences/drafts/${id}`, method: "GET" },
        { path: `/api/experiences/drafts/${original.plan.draftId}/receipt`, method: "GET" },
      ]);
      assert.equal(total(x), count); assert.equal(restored.documentReceipt, recovered);
    } finally { definition.revision = previous; runtime.dispose(); restored?.dispose(); }
  });
});

