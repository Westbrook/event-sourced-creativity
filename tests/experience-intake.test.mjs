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
  const host = new FormaExperienceSurface(); host.runtime = runtime;
  const markup = new ports.RendererPort({}, {}).value(host.render(), host, "experience-summary-test");
  const summaries = [...markup.matchAll(/<dl class="experience-summary">([\s\S]*?)<\/dl>/gu)];
  assert.equal(summaries.length, 1, "one actual review/completed summary, not the repeating direction stage");
  assert.match(summaries[0][1], /&lt;reference&gt; &amp; "quoted"/u, "authored markup is escaped before decoding for text comparison");
  assert.doesNotMatch(summaries[0][1], /<reference>/u);
  const decode = value => value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  return [...summaries[0][1].matchAll(/<div><dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/gu)].map(([, label, value]) => [decode(label), decode(value)]);
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
  const release = await registeredExperience(id), f = { trace: [], listeners: new Map(), changed: new Map(), requested: false, requests: 0, waits: [], hold: false };
  f.runtime = new ExperienceIntakeRuntime(release, async () => { f.requests++; assert.fail("Invalid Review cannot save, commit or call a provider"); });
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
    f.runtime.dispose(); assert.equal(f.requests, 0);
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
