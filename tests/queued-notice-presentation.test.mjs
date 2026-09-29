import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { withDocumentInRoute } from "../src/model/routes.ts";

// Complete production Store and Shell, using the existing finite HTTP, timer
// and TemplateResult ports. Queue responses below are authored transport, not
// Worker/provider admission. No component lifecycle, browser, CSS, focus or
// assistive-technology observation is claimed by the disconnected Shell check.
const OPTIONS = { concurrency: false, timeout: 20_000 };
const OWNER = "queued-notice-owner", PROJECT = "queued-notice-project", DOCUMENT = "queued-notice-document";
const AT = "2026-09-09T00:00:00.000Z";

function transport() {
  const inputs = [
    { type: "ProjectCreated", payload: { project_id: PROJECT, name: "Notice controls" } },
    { type: "DocumentCreated", payload: { project_id: PROJECT, document_id: DOCUMENT, title: "Notice controls" } },
    { type: "BlockCreated", payload: { project_id: PROJECT, document_id: DOCUMENT, block_id: "notice-direction", type: "direction",
      handle: "direction/notice", position: "a", properties: { text: "A harbor keeper returns a lost compass.", weight: 1 } } },
  ];
  const events = inputs.map((input, index) => ({ ...input, eventId: `notice-event-${index + 1}`, sequence: index + 1,
    streamId: `creative:${OWNER}`, occurredAt: AT, recordedAt: AT, actor: "user", clientId: "notice-fixture",
    correlationId: `notice-correlation-${index + 1}`, causationId: null, compensatesEventId: null, schemaVersion: 1 }));
  const session = { user: { userId: OWNER, email: "notice@example.test", displayName: "Notice author", role: "creator" },
    impersonation: null, policy: { version: "notice-policy", accepted: true }, permissionEpoch: "notice-epoch",
    capabilities: ["project.read", "project.author", "project.output.request"], provider: { model3dConfigured: true } };
  return { owner: OWNER, projectId: PROJECT, documentId: DOCUMENT, requestId: "unused-scene-request", payload: {}, events,
    async request(url, init = {}) {
      if (url === "/api/session") return Response.json(session);
      if (url.startsWith("/api/events?") && (!init.method || init.method === "GET"))
        return Response.json({ events, head: events.length, content: {} });
      assert.fail(`Unexpected notice fixture HTTP ${init.method ?? "GET"} ${url}`);
    }, close() {} };
}

async function host(t) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No external transport in notice controls"));
  const h = await createSceneStoreHost({ workerFixture: transport(), exposeSceneTestAccessors: false });
  t.after(() => h.close());
  h.store.route.set(withDocumentInRoute("/", DOCUMENT, "Notice controls"));
  h.store.loading.set(false);
  assert.equal(h.store.projection.get().documentId, DOCUMENT);
  assert.ok(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()));
  return h;
}

function noticeTimers(h) { return [...h.timers].filter(([, timer]) => timer.delay === 2800); }
function currentTimer(h) {
  const rows = noticeTimers(h);
  assert.equal(rows.length, 1, "exactly one current notice expiry");
  return { id: rows[0][0], ...rows[0][1] };
}
function notice(h, text, presentation) {
  assert.equal(h.store.ui.toast, text);
  assert.equal(h.store.ui.toastPresentation, presentation);
}
function expire(h, timer) {
  assert.ok(h.timers.has(timer.id), "deliver the currently scheduled timeout");
  h.timers.delete(timer.id); timer.callback();
}

test("notice defaults, replacement directions and current expiry retain one owner", OPTIONS, async t => {
  const h = await host(t);
  notice(h, "", "overlay");
  h.store.toast("ordinary first"); notice(h, "ordinary first", "overlay");
  const ordinary = currentTimer(h);
  h.store.toast("inline second", "inline"); notice(h, "inline second", "inline");
  const inline = currentTimer(h);
  assert.notEqual(inline.id, ordinary.id); assert.equal(h.timers.has(ordinary.id), false);
  ordinary.callback(); notice(h, "inline second", "inline");
  assert.equal(currentTimer(h).id, inline.id, "a canceled old callback cannot retire its successor");
  h.store.toast("ordinary third"); notice(h, "ordinary third", "overlay");
  const last = currentTimer(h);
  assert.equal(h.timers.has(inline.id), false);
  inline.callback(); notice(h, "ordinary third", "overlay");
  assert.equal(currentTimer(h).id, last.id);
  expire(h, last); notice(h, "", "overlay"); assert.deepEqual(noticeTimers(h), []);
  h.store.toast("inline expiry", "inline");
  expire(h, currentTimer(h)); notice(h, "", "overlay"); assert.deepEqual(noticeTimers(h), []);
});

for (const interleave of [false, true]) test("same-text stale expiry is inert" + (interleave ? " through A→B→A" : " through A→A"), OPTIONS, async t => {
  const h = await host(t), stale = [];
  h.store.toast("same queued notice", "inline"); stale.push(currentTimer(h));
  if (interleave) { h.store.toast("other notice"); stale.push(currentTimer(h)); }
  h.store.toast("same queued notice", "inline");
  const current = currentTimer(h);
  for (const old of stale) {
    assert.equal(h.timers.has(old.id), false);
    old.callback(); notice(h, "same queued notice", "inline");
    assert.equal(currentTimer(h).id, current.id);
  }
  expire(h, current); notice(h, "", "overlay"); assert.deepEqual(noticeTimers(h), []);
});

test("synchronous subscriber replacement owns the surviving timer", OPTIONS, async t => {
  const h = await host(t); let replaced = false, first;
  const unsubscribe = h.store.subscribe(() => {
    if (replaced || h.store.ui.toast !== "outer notice") return;
    replaced = true; first = currentTimer(h);
    h.store.toast("subscriber notice", "inline");
  });
  t.after(unsubscribe);
  h.store.toast("outer notice");
  assert.equal(replaced, true); notice(h, "subscriber notice", "inline");
  const current = currentTimer(h);
  assert.notEqual(current.id, first.id); assert.equal(h.timers.has(first.id), false);
  first.callback(); notice(h, "subscriber notice", "inline");
  assert.equal(currentTimer(h).id, current.id);
  expire(h, current); notice(h, "", "overlay"); assert.deepEqual(noticeTimers(h), []);
});

test("actual owned-source refusal retires both notice fields and its timer", OPTIONS, async t => {
  const h = await host(t);
  // This timer control has no Canvas IndexedDB port. Retire an authenticated
  // personal source without a projected project so an unrelated offline-queue
  // storage failure does not correctly replace the notice under observation.
  h.store.events.set([]); h.store.head.set(0);
  assert.equal(Boolean(h.store.projection.get().projectId), false);
  const source = h.store.captureSourceOwnership();
  assert.ok(h.store.sourceOwnershipActive(source));
  h.store.toast("private queued notice", "inline"); const old = currentTimer(h);
  const before = h.requests.length;
  h.intercept = request => request.url.startsWith("/api/events?") && (request.init.method ?? "GET") === "GET"
    ? Response.json({ error: "source_withdrawn" }, { status: 403 }) : undefined;
  await assert.rejects(h.store.refreshEvents({ readOnly: true, current: () => h.store.sourceOwnershipActive(source) }), /403/u);
  assert.equal(h.store.sourceOwnershipActive(source), false);
  assert.ok(h.requests.slice(before).some(row => row.url.startsWith("/api/events?")), "actual refused source read was dispatched");
  notice(h, "", "overlay"); assert.deepEqual(noticeTimers(h), []);
  old.callback(); notice(h, "", "overlay"); assert.deepEqual(noticeTimers(h), []);
});

function queueTransport(h, { error = false } = {}) {
  const submitted = [];
  h.intercept = request => {
    if (request.url !== "/api/document-jobs" || request.init.method !== "POST") return undefined;
    submitted.push(request);
    if (error) return Response.json({ error: "notice fixture refused this queue" }, { status: 409 });
    const body = request.body;
    return Response.json({ reused: false, job: { jobId: `notice-job-${submitted.length}`, documentId: body.documentId,
      kind: body.kind, status: "queued", sourceSurface: body.sourceSurface, productionMode: body.payload.productionMode,
      documentRevision: body.payload.documentRevision, requestKey: body.payload.requestKey, requestedSequence: 3,
      requestedAt: AT, updatedAt: AT, members: [], result: { artifactKind: body.payload.artifactKind } } }, { status: 202 });
  };
  return submitted;
}
const manualOptions = kind => kind === "model3d"
  ? { productionMode: "manual", paidMediaConfirmed: true, model3dPrompt: "A simple clay compass on a square base." }
  : { productionMode: "manual" };

for (const kind of ["video", "model3d"]) test(`actual manual ${kind} fresh and exact reused queue use inline notice`, OPTIONS, async t => {
  const h = await host(t), submitted = queueTransport(h), settings = manualOptions(kind);
  assert.equal(await h.store.renderDocumentArtifact(kind, settings), true);
  assert.equal(submitted.length, 1); assert.equal(submitted[0].body.payload.artifactKind, kind);
  assert.equal(submitted[0].body.payload.productionMode, "manual");
  const first = kind === "model3d" ? "3D model queued. You can keep working while it is prepared."
    : "video queued. You can keep working while it is prepared.";
  notice(h, first, "inline"); const stale = currentTimer(h);
  const job = h.store.documentJobs.get()[0];
  assert.equal(await h.store.renderDocumentArtifact(kind, settings), true);
  assert.equal(submitted.length, 1, "actual local exact-request reuse does not submit a second job");
  assert.equal(h.store.documentJobs.get()[0].jobId, job.jobId);
  const reused = kind === "model3d" ? "This exact 3D request is already in progress." : "This exact video is already in progress.";
  notice(h, reused, "inline"); const current = currentTimer(h);
  stale.callback(); notice(h, reused, "inline"); assert.equal(currentTimer(h).id, current.id);
});

for (const kind of ["short_story", "slides", "storyboard", "audio"]) test(`actual manual ${kind} queue remains overlay`, OPTIONS, async t => {
  const h = await host(t), submitted = queueTransport(h), label = kind.replaceAll("_", " ");
  h.store.toast("previous inline", "inline");
  assert.equal(await h.store.renderDocumentArtifact(kind, { productionMode: "manual" }), true);
  assert.equal(submitted.length, 1); assert.equal(submitted[0].body.payload.artifactKind, kind);
  notice(h, `${label} queued. You can keep working while it is prepared.`, "overlay");
  assert.equal(await h.store.renderDocumentArtifact(kind, { productionMode: "manual" }), true);
  assert.equal(submitted.length, 1);
  notice(h, `This exact ${label} is already in progress.`, "overlay");
});

test("actual managed Video fresh and reused notices remain overlay", OPTIONS, async t => {
  const h = await host(t), submitted = queueTransport(h);
  h.store.toast("previous inline", "inline");
  assert.equal(await h.store.renderDocumentArtifact("video", { productionMode: "managed" }), true);
  assert.equal(submitted.length, 1); assert.equal(submitted[0].body.payload.productionMode, "managed");
  notice(h, "Your film production team is working on the complete document.", "overlay");
  assert.equal(await h.store.renderDocumentArtifact("video", { productionMode: "managed" }), true);
  assert.equal(submitted.length, 1); notice(h, "This exact video is already in progress.", "overlay");
});

for (const kind of ["video", "model3d"]) test(`actual ${kind} queue refusal remains overlay`, OPTIONS, async t => {
  const h = await host(t), submitted = queueTransport(h, { error: true });
  h.store.toast("previous inline", "inline");
  assert.equal(await h.store.renderDocumentArtifact(kind, manualOptions(kind)), false);
  assert.equal(submitted.length, 1);
  notice(h, "notice fixture refused this queue", "overlay");
  assert.deepEqual(h.store.documentJobs.get(), []);
});

// Observe only values emitted by actual render(). This serializer does not
// mount descendants, evaluate directives or supply expected application output.
function markup(value) {
  if (Array.isArray(value)) return value.map(markup).join("");
  if (value && Array.isArray(value.strings) && Array.isArray(value.values))
    return value.strings.map((part, index) => part + markup(value.values[index])).join("");
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

test("actual Shell emits one polite inline notice before main or its existing overlay, then neither after expiry", OPTIONS, async t => {
  const h = await host(t), f = { store: h.store, locale: "en", trace: [], requested: false };
  // The actual Shell reads the session's application-access object even on a
  // Creative route. This personal fixture does not grant Canvas access.
  h.setSession({ canvas: { access: false } });
  ports.bindFixture(f);
  const messages = { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs.en };
  f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    event.callback({ locale: "en", formatLocale: "en", direction: "ltr", timeZone: "UTC", messages, revision: 1 }, () => {}); return true;
  } });
  f.i18n.hostConnected(); t.after(() => f.i18n.hostDisconnected());
  const { FormaShell } = await ports.loadActual("src/components/forma-shell.ts");
  const shell = new FormaShell(); shell.isConnected = false; shell.tag = "forma-shell";
  const rendered = () => { ports.bindFixture(f); return markup(shell.render()); };
  const notices = html => [...html.matchAll(/<div\b[^>]*class="(?:queued-notice|toast)"[^>]*>[\s\S]*?<\/div>/gu)].map(row => row[0]);
  assert.deepEqual(notices(rendered()), []);
  h.store.toast("inline literal", "inline");
  let html = rendered(), rows = notices(html);
  assert.equal(rows.length, 1); assert.match(rows[0], /class="queued-notice"/u);
  assert.match(rows[0], /role="status"/u); assert.match(rows[0], /aria-live="polite"/u);
  assert.match(rows[0], /inline literal/u); assert.doesNotMatch(rows[0], /\bpopover(?:\s|=|>)/u);
  assert.ok(html.indexOf(rows[0]) < html.indexOf('<main id="main-content"'), "inline notice is outside and before the actual main owner");
  h.store.toast("ordinary literal");
  html = rendered(); rows = notices(html);
  assert.equal(rows.length, 1); assert.match(rows[0], /class="toast"/u);
  assert.match(rows[0], /role="status"/u); assert.match(rows[0], /aria-live="polite"/u);
  assert.match(rows[0], /popover="manual"/u); assert.match(rows[0], /ordinary literal/u);
  h.store.toast("replacement inline", "inline");
  rows = notices(rendered()); assert.equal(rows.length, 1); assert.match(rows[0], /class="queued-notice"/u);
  assert.doesNotMatch(rows[0], /\bpopover(?:\s|=|>)/u);
  expire(h, currentTimer(h)); notice(h, "", "overlay"); assert.deepEqual(notices(rendered()), []);
});

test("new queued notice pairs the semantic strong background and inverse foreground", () => {
  // Source policy only: --forest changes with appearance, so fixed white is
  // not a valid foreground contract. This is not a computed-contrast claim.
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const rules = [...css.matchAll(/(?:^|\n)\.app-shell\s*>\s*\.queued-notice\s*\{([^}]*)\}/gu)];
  assert.equal(rules.length, 1);
  assert.match(rules[0][1], /(?:^|;)\s*background:\s*var\(--forest\)\s*;/u);
  assert.match(rules[0][1], /(?:^|;)\s*color:\s*var\(--on-strong\)\s*;/u);
});
