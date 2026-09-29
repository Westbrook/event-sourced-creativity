// Full mounted Shell/Workspace and original Store methods. A real Worker
// admission Response is delayed, never replaced. Optional background execution
// is omitted at the existing Worker handler boundary; no answer is generated.
// The existing scene host also fences its foreground /run transport. These
// finite native ports establish component behavior, not physical keyboard/AT.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { setTimeout as deadline, clearTimeout as clearDeadline } from "node:timers";
import { createCalmFullPage, calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { createSceneStoreHost, sceneDeferred } from "./helpers/scene-cost-store-host.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { installImageFormatNativeLifetime } from "./helpers/image-format-native-lifetime.mjs";
import { withDocumentInRoute, withProjectTaskDocumentInRoute } from "../src/model/routes.ts";
const { handleDocumentJobs } = await import("../worker/document-jobs-api.ts");

const PREFIX = "full mounted fallback Ask preserves original admission ";
const PROMPT = "  Explain the current harbor direction without generating an image.  ";
const NEXT = "  A newer unsent question — سؤال جديد\n";
const classed = (node, name) => String(node?.attributes?.class ?? "").split(/\s+/u).includes(name);
const inside = (node, parent) => {
  for (let current = node; current; current = current.parent) if (current.port === parent.port) return true;
  return false;
};
async function registerActualRouteDefinitions(f, tags = ["forma-chat-studio", "forma-library", "forma-activity"]) {
  const root = new URL("../", import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL("custom-elements.json", root), "utf8"));
  const definitions = new Map(manifest.modules.flatMap(module => (module.declarations ?? [])
    .filter(declaration => declaration.tagName)
    .map(declaration => [declaration.tagName, { file: module.path, name: declaration.name }])));
  const visited = new Set();
  async function register(tag) {
    if (visited.has(tag)) return;
    visited.add(tag);
    const definition = definitions.get(tag);
    assert.ok(definition, "Actual destination component " + tag);
    const module = await ports.loadActual(definition.file), Constructor = module[definition.name];
    assert.equal(typeof Constructor, "function", tag);
    if (f.renderer.registry[tag]) assert.equal(f.renderer.registry[tag], Constructor, "Existing actual definition " + tag);
    else f.renderer.registry[tag] = Constructor;
    const source = fs.readFileSync(new URL(definition.file, root), "utf8");
    for (const child of new Set([...source.matchAll(/<(forma-[\w-]+)(?=[\s>])/gu)].map(match => match[1]))) {
      await register(child);
    }
  }
  // Reuse assigned-review-navigation's real CEM/loadActual registration seam.
  // The finite route-loader records completion without importing side-effect
  // definitions. Install the three exercised route trees before native focus
  // can inspect their first markup; do not weaken the strict full-page census,
  // set a loaded-route flag, or replace any mounted component or Store method.
  for (const tag of tags) await register(tag);
}
async function join(promise, label, milliseconds = 10_000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = deadline(() => reject(new Error("Prerequisite deadline: " + label)), milliseconds);
    })]);
  } finally { clearDeadline(timer); }
}
function money(worker) {
  return Object.fromEntries(["budget_reservations", "budget_counters", "cost_budget_reservations", "cost_budget_counters",
    "output_provider_calls", "output_operation_slots", "consequential_executions", "consequential_execution_steps"]
    .map(table => [table, worker.sqlite.prepare('SELECT * FROM "' + table + '" ORDER BY rowid').all()]));
}
function originalAdmission(worker, jobId) {
  const row = worker.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(jobId);
  assert.ok(row, "the original queue row exists in the same actual Worker database");
  const payload = JSON.parse(row.request_json);
  const privateInput = worker.sqlite.prepare("SELECT content_id,owner_id,kind,content,redacted_at FROM private_content WHERE content_id=?")
    .get(payload.jobInputRef);
  assert.ok(privateInput, "the actual original input is privately retained, not reconstructed from the UI");
  assert.equal(privateInput.kind, "chat-user");
  assert.equal(privateInput.owner_id, row.owner_id);
  assert.equal(privateInput.content, PROMPT.trim());
  assert.equal(privateInput.redacted_at, null);
  assert.equal(row.kind, "chat");
  assert.equal(row.source_surface, "chat");
  assert.equal(row.status, "queued");
  assert.equal(row.attempt_count, 0, "neither the background nor foreground runner executes");
  return { row, privateInput };
}
async function mountedFallback(t, locale, { prepare } = {}) {
  const h = await createSceneStoreHost({ count: 1, exposeSceneTestAccessors: false });
  t.after(() => h.close());
  const transportHeaders = prepare ? await prepare(h) : {};
  const worker = h.worker, actualSession = h.store.session.get();
  assert.ok(actualSession.provider.plannerConfigured, "the fixture's non-secret dummy configuration exposes Ask");
  assert.ok(actualSession.capabilities.includes("project.output.request"));
  const original = { events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get() };
  const entered = sceneDeferred(), release = sceneDeferred();
  const admissions = [], pendingReads = new Set();
  let delivered = 0, externalAttempts = 0;
  h.transport = request => {
    const method = request.init.method ?? "GET", url = new URL(request.url, "http://localhost");
    const admission = url.pathname === "/api/document-jobs" && method === "POST";
    const readOnlyResume = url.pathname === "/api/workspace/quick-edit" && method === "POST" && request.body?.action === "resume";
    assert.ok(method === "GET" || readOnlyResume || admission && request.body?.kind === "chat",
      "only existing reads, the local-review resume, and one explicitly submitted chat admission are allowed");
    const pending = (async () => {
      // The actual handler's OPTIONAL execution context is deliberately absent.
      // worker.request() would eagerly schedule chat execution in waitUntil.
      // All admission validation, private storage, SQL and Response remain real.
      const response = url.pathname === "/api/document-jobs" || url.pathname.startsWith("/api/document-jobs/")
        ? await handleDocumentJobs(new Request(url, { ...request.init,
          headers: { ...transportHeaders, ...Object.fromEntries(new Headers(request.init.headers)) } }), worker.env,
          url.pathname === "/api/document-jobs" ? "" : url.pathname.slice("/api/document-jobs/".length))
        : await worker.request(request.url, request.init);
      if (admission) {
        const body = await response.clone().json();
        assert.equal(response.status, 202, JSON.stringify(body));
        assert.equal(body.accepted, true);
        assert.ok(body.job?.jobId);
        assert.equal(body.job.kind, "chat");
        assert.equal(body.job.documentId, worker.documentId);
        assert.equal(request.body.payload.message, PROMPT.trim());
        assert.equal(request.body.payload.livePreview, false);
        const retained = originalAdmission(worker, body.job.jobId);
        admissions.push({ body, retained });
        entered.resolve(admissions.at(-1));
        await release.promise;
        delivered++;
      }
      return response;
    })();
    if (!admission) {
      pendingReads.add(pending);
      void pending.then(() => pendingReads.delete(pending), () => pendingReads.delete(pending));
    }
    return pending;
  };
  t.mock.method(globalThis, "fetch", (input, init = {}) => {
    const url = new URL(String(input), "http://localhost");
    if (!["http://localhost", "https://fixture.invalid"].includes(url.origin) || !url.pathname.startsWith("/api/")) {
      externalAttempts++; throw new Error("No external/provider transport in fallback Ask ownership test");
    }
    return h.fetch(url.pathname + url.search, init);
  });
  const previousHistory = globalThis.history;
  const updateLocation = route => {
    const url = new URL(route, "http://localhost");
    Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash });
  };
  globalThis.history = {
    pushState(_state, _title, route) { updateLocation(route); },
    replaceState(_state, _title, route) { updateLocation(route); },
  };
  t.after(() => { globalThis.history = previousHistory; });
  const f = await createCalmFullPage(t, { locale, assistant: false, storeHost: h });
  // The existing helper supplies the assistant-inactive UI configuration. Keep
  // that one feature flag, but restore original Worker content and all genuine
  // session rights/budgets. This is not a claim that assistant is off for every
  // deployed account, nor a fabricated permission or an impersonation flow.
  h.store.events.set(original.events); h.store.head.set(original.head); h.store.content.set(original.content);
  h.store.session.set({ ...actualSession, assistant: undefined });
  updateLocation(h.store.route.get());
  const dispatch = h.window.dispatchEvent;
  h.window.dispatchEvent = function (event) {
    const result = dispatch.call(this, event);
    for (const handler of [...(f.listeners.get(event.type) ?? [])]) handler(event);
    return result;
  };
  t.after(() => { h.window.dispatchEvent = dispatch; });
  await f.settle(); await join(Promise.all([...pendingReads]), "initial actual reads"); await f.settle();
  const workspace = f.components().find(component => component.tag === "forma-workspace");
  assert.ok(workspace?.isConnected);
  assert.equal(f.components().some(component => component.tag === "forma-creative-assistant"), false);
  assert.ok(h.store.routeDataReady());
  assert.deepEqual(h.store.events.get(), original.events);
  await registerActualRouteDefinitions(f);
  const native = installOutputNavigationFocusNative(t, f, ports);
  await f.settle();
  const field = () => f.find("textarea", node => node.owner === workspace && node.attributes.id === "creative-command");
  const pane = () => f.tree().nodes.find(node => node.owner === workspace && Object.hasOwn(node.attributes, "data-workbench-mode"))?.attributes["data-workbench-mode"] ?? null;
  const route = h.store.route.get(), source = h.store.captureSourceOwnership();
  const beforeMoney = money(worker), beforeEvents = worker.sqlite.prepare("SELECT * FROM events ORDER BY sequence").all();
  const listenerCounts = () => ["pointerdown", "keydown", "focusin"].map(type => native.listeners(type));
  const listenersBefore = listenerCounts(), requestStart = h.requests.length;
  t.after(() => release.resolve());
  return { h, f, worker, workspace, native, field, pane, route, source, admissions, entered, release,
    beforeMoney, beforeEvents, listenersBefore, listenerCounts, requestStart,
    get delivered() { return delivered; }, get externalAttempts() { return externalAttempts; } };
}
async function submitOriginal(x, beforeAdmission) {
  const field = x.field(); field.port.value = PROMPT;
  x.native.focus(field.port); await x.f.act(field, "input");
  const button = x.f.find("button", node => node.owner === x.workspace && classed(node, "ask"));
  const form = x.f.find("form", node => node.owner === x.workspace && classed(node, "composer-command"));
  assert.ok(button.port.isConnected && form.port.isConnected && inside(button, form));
  assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
  // Deliver the current native submit port to the current rendered form. This
  // does not purport to certify physical Enter/default-click behavior.
  x.native.emit("pointerdown", button.port); x.native.focus(button.port);
  await x.f.act(form, "submit", { submitter: button.port });
  if (beforeAdmission) await beforeAdmission(x);
  await join(x.entered.promise, "real original queue admission held before acknowledgement");
  assert.equal(x.admissions.length, 1); assert.equal(x.delivered, 0);
  assert.equal(x.field().properties.value, PROMPT);
  assert.equal(x.pane(), "write"); assert.equal(x.h.store.route.get(), x.route);
  assert.equal(x.h.store.documentJobs.get().some(job => job.jobId === x.admissions[0].body.job.jobId), false);
}
const cases = [
  ["en", "none"], ["en", "draft"], ["en", "pane"], ["en", "focus"],
  ["en", "route"], ["en", "authority"], ["en", "modal"],
  ["ar", "none"], ["ar", "draft"], ["ar", "pane"],
];
for (const [locale, interruption] of cases) test(PREFIX + JSON.stringify({ locale, interruption }),
  { timeout: 30_000, concurrency: false }, async t => {
    const x = await mountedFallback(t, locale), { h, f, native } = x;
    try {
      await submitOriginal(x);
      if (interruption === "draft") {
        const field = x.field(); native.emit("keydown", field.port); native.focus(field.port);
        field.port.value = NEXT; await f.act(field, "input");
        assert.equal(x.field().properties.value, NEXT, "newer raw draft is editable while A awaits acknowledgement");
      } else if (interruption === "pane") {
        const button = f.find("button", node => node.owner === x.workspace && node.attributes["data-workbench-pane"] === "result");
        native.emit("pointerdown", button.port); native.focus(button.port); await f.act(button);
        assert.equal(x.pane(), "result");
      } else if (interruption === "focus") {
        const select = f.find("select", node => node.owner?.tag === "forma-ui-language-picker");
        native.emit("keydown", select.port); native.focus(select.port);
      } else if (interruption === "route") {
        h.store.setRoute("/library"); await f.settle();
        assert.equal(h.store.route.get(), withProjectTaskDocumentInRoute("/library", x.worker.documentId),
          "Library preserves the existing exact Document task address");
        assert.equal(x.workspace.isConnected, false);
      } else if (interruption === "authority") {
        // Public current-session input port, not a simulated server revocation.
        // Existing Store authority checks already make this a healthy negative.
        h.store.session.set({ ...h.store.session.get(), permissionEpoch: "newer-fixture-authority" });
        await f.settle(); assert.equal(h.store.sourceOwnershipActive(x.source), false);
      } else if (interruption === "modal") {
        x.workspace.openContextComposer(); await f.settle();
        assert.ok(f.tree().visible("dialog").some(node => classed(node, "block-composer-dialog") && node.port?.open));
      }
      const before = { route: h.store.route.get(), pane: x.pane(),
        draft: f.tree().visible("textarea").find(node => node.owner === x.workspace && node.attributes.id === "creative-command")?.properties.value ?? null,
        focusCount: native.nativeFocus.length };
      const original = x.admissions[0];
      x.release.resolve(); await f.settle();
      assert.equal(x.delivered, 1);
      assert.deepEqual(originalAdmission(x.worker, original.body.job.jobId), original.retained,
        "the accepted original request and original private input survive every presentation interruption");
      assert.deepEqual(money(x.worker), x.beforeMoney, "no provider execution or financial row change");
      assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM events ORDER BY sequence").all(), x.beforeEvents);
      const requests = h.requests.slice(x.requestStart), posts = requests.filter(row => (row.init.method ?? "GET") !== "GET");
      assert.equal(posts.filter(row => row.url === "/api/document-jobs").length, 1, "no automatic second Ask");
      assert.ok(posts.every(row => row.url === "/api/document-jobs" && row.body?.kind === "chat"
        || row.url === "/api/workspace/quick-edit" && row.body?.action === "resume"
        || row.url === "/api/document-jobs/" + encodeURIComponent(original.body.job.jobId) + "/run"),
      "only original admission, existing free resume and the existing fenced runner port");
      assert.equal(x.externalAttempts, 0);
      if (interruption === "none") {
        assert.equal(h.store.route.get(), withDocumentInRoute("/studio/chat", x.worker.documentId, h.store.projection.get().documentTitle),
          "unchanged Ask retains its original actor-private Chat handoff");
        assert.ok(h.store.documentJobs.get().some(job => job.jobId === original.body.job.jobId));
        h.store.setRoute(x.route); await f.settle();
        const currentWorkspace = f.components().find(component => component.tag === "forma-workspace");
        assert.equal(f.find("textarea", node => node.owner === currentWorkspace && node.attributes.id === "creative-command").properties.value, "",
          "deliberate Document re-entry has no stale submitted draft");
      } else {
        assert.equal(h.store.route.get(), before.route, "late admission must not overwrite newer navigation/presentation");
        assert.equal(x.pane(), before.pane);
        const draft = f.tree().visible("textarea").find(node => node.owner === x.workspace && node.attributes.id === "creative-command")?.properties.value ?? null;
        const expectedDraft = ["draft", "route", "authority"].includes(interruption) ? before.draft : "";
        assert.equal(draft, expectedDraft, "retire only unchanged submitted A; preserve newer B and retired-source state");
        assert.equal(native.nativeFocus.length, before.focusCount, "late admission supplies no new focus grant");
        if (interruption !== "authority") assert.ok(h.store.documentJobs.get().some(job => job.jobId === original.body.job.jobId));
        if (interruption === "modal") assert.ok(f.tree().visible("dialog").some(node => classed(node, "block-composer-dialog") && node.port?.open));
      }
      if (["draft", "pane", "focus", "modal"].includes(interruption)) assert.equal(h.store.ui.toast,
        `${f.i18n.t("activity.kind.chat")} · ${f.i18n.t("activity.inProgress")} · ${f.i18n.t("shell.navigation.activity")}`,
        "acknowledged original work remains honestly discoverable without taking over the current pane");
      if (["draft", "pane", "focus"].includes(interruption)) assert.deepEqual(x.listenerCounts(), x.listenersBefore, "the Ask lease is disposed after delivery");
    } finally { x.release.resolve(); }
  });

// Exact companion to the original ten cases: actual Store-created budget DOM,
// actual Shell confirmation handlers, and actual Worker impersonation checks.
// No confirmation response or Store method is replaced. Fixture account rows
// are seeded only in RAM using the existing replay/impersonation schema.
const { appendAuditEvent } = await import("../worker/runtime.ts");
const { untilScene } = await import("./helpers/scene-cost-store-host.mjs");
async function prepareConfirmation(h, kind) {
  const worker = h.worker, principalId = h.store.session.get().user.userId;
  const headers = {}, now = new Date().toISOString();
  if (kind !== "budget") {
    const userId = "fallback-ask-fictional", personaId = "fallback-ask-persona", impersonationId = "fallback-ask-impersonation";
    worker.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(userId, "fallback-ask@example.test", "Fictional Ask author", "creator", h.store.session.get().policy.version, now, now, now);
    worker.sqlite.prepare("INSERT INTO replay_personas(persona_id,session_id,owner_id,fictional_user_id,fictional_stream_id,display_name,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(personaId, "fallback-ask-replay", principalId, userId, "creative:" + userId, "Fictional Ask author", "ready", now, now);
    worker.sqlite.prepare("INSERT INTO impersonation_sessions(impersonation_id,actor_user_id,persona_id,fictional_user_id,replay_session_id,status,started_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(impersonationId, principalId, personaId, userId, "fallback-ask-replay", "active", now, new Date(Date.now() + 3_600_000).toISOString());
    headers.cookie = "forma_impersonation=" + impersonationId;
    worker.setScopedHeaders(headers);
    const stream = "creative:" + userId;
    await appendAuditEvent(worker.env, stream, "user:" + userId, "ProjectCreated", { project_id: worker.projectId, name: "Fictional Ask project" });
    await appendAuditEvent(worker.env, stream, "user:" + userId, "DocumentCreated", { project_id: worker.projectId, document_id: worker.documentId, title: "Fictional Ask document" });
    await appendAuditEvent(worker.env, stream, "user:" + userId, "BlockCreated", {
      project_id: worker.projectId, document_id: worker.documentId, block_id: "fallback-ask-direction", type: "direction",
      handle: "direction/fallback-ask", position: "a", properties: { text: "A quiet harbor with warm light.", intent: "include", weight: 1 },
    });
  }
  if (kind !== "impersonation") {
    const updated = worker.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=CAST(hard_limit_microusd*0.61 AS INTEGER) WHERE scope='user' AND scope_id=? AND period=?")
      .run(principalId, now.slice(0, 7));
    assert.equal(Number(updated.changes), 1, "only the RAM fixture principal's actual current budget is seeded");
  }
  const sessionResponse = await worker.request("/api/session"); assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  if (kind !== "budget") {
    assert.equal(session.impersonation?.actor.userId, principalId);
    assert.equal(session.user.userId, "fallback-ask-fictional");
    assert.equal(session.assistant, undefined, "the actual impersonated session naturally exposes fallback Ask");
  }
  if (kind !== "impersonation") assert.ok(session.costBudgets.user.usedMicrousd / session.costBudgets.user.limitMicrousd > 0.60);
  const response = await worker.request("/api/events?after=0&limit=2000&content=1"); assert.equal(response.status, 200);
  const body = await response.json();
  h.store.session.set(session); h.store.events.set(body.events); h.store.head.set(body.head); h.store.content.set(body.content ?? {});
  return headers; // Cookie only. The confirmation header must come from guardedFetch.
}
function confirmationModal(x) {
  return x.f.tree().visible("dialog").find(node => classed(node, "impersonation-confirm-dialog"));
}
async function clickImpersonation(x, approved) {
  await untilScene(() => x.h.store.ui.impersonationConfirmOpen, "actual current impersonation confirmation");
  await x.f.settle();
  const modal = confirmationModal(x); assert.ok(modal?.port?.open, "current named Shell modal exists");
  assert.equal(modal.attributes["aria-labelledby"], "impersonation-confirm-title");
  const button = x.f.find("button", node => inside(node, modal) && classed(node, approved ? "primary" : "ghost"));
  x.native.emit("pointerdown", button.port); x.native.focus(button.port);
  await x.f.act(button); assert.equal(x.h.store.ui.impersonationConfirmOpen, false);
}
async function confirmBudget(x) {
  await untilScene(() => x.h.dialog()?.open, "the actual Store budget dialog, before any admission POST");
  const modal = x.h.dialog();
  assert.ok(modal.getAttribute("aria-labelledby"), "Store-generated budget dialog keeps its actual name");
  const card = modal.children[0], footer = card.children.find(node => node.tag === "footer");
  const button = footer.children.find(node => node.tag === "button" && String(node.className).split(/\s+/u).includes("primary"));
  assert.ok(button, "the actual imperative Continue control, independent of translated wording");
  // This existing Store native port is not part of the Lit renderer. Deliver
  // the newer pointer to its exact attached button, then its original listener.
  // Do not forge positive Store results or call a private confirmation method.
  x.native.emit("pointerdown", button); button.dispatchEvent({ type: "click" });
  await x.f.settle(); assert.equal(modal.open, false);
  // The shared finite body port uses parentElement, while this older imperative
  // port's remove() uses parent. Remove only this closed fixture node so it
  // cannot become the next test's lookup target; no application behavior changes.
  x.native.document.body.children = x.native.document.body.children.filter(node => node !== modal);
}
for (const kind of ["budget", "impersonation", "both"]) for (const nextDraft of [false, true]) {
  const locale = kind === "impersonation" ? "ar" : "en";
  test("full mounted fallback Ask owns real confirmation " + JSON.stringify({ kind, locale, nextDraft }),
    { timeout: 30_000, concurrency: false }, async t => {
      const x = await mountedFallback(t, locale, { prepare: h => prepareConfirmation(h, kind) });
      try {
        // Mounting an impersonated Workspace can itself ask to resume its local
        // review. Cancel that separate actual modal before entering A; it must
        // not be mistaken for permission to submit this later chat request.
        if (x.h.store.ui.impersonationConfirmOpen) {
          assert.ok(!x.h.store.ui.impersonationAction.includes("start chat"));
          await clickImpersonation(x, false); await x.f.settle();
        }
        const beforeRequests = x.h.requests.length;
        await submitOriginal(x, async () => {
          assert.equal(x.h.requests.slice(beforeRequests).filter(row => row.url === "/api/document-jobs").length, 0);
          if (kind !== "impersonation") {
            await confirmBudget(x);
            if (kind === "both") assert.equal(x.h.requests.slice(beforeRequests).filter(row => row.url === "/api/document-jobs").length, 0,
              "budget acknowledgement cannot bypass the separate impersonation confirmation");
          }
          if (kind !== "budget") {
            assert.equal(x.h.store.ui.impersonationAction, "start chat");
            await clickImpersonation(x, true);
          }
        });
        const admission = x.admissions[0];
        const sent = x.h.requests.slice(beforeRequests).filter(row => row.url === "/api/document-jobs");
        assert.equal(sent.length, 1);
        if (kind !== "budget") {
          assert.equal(new Headers(sent[0].init.headers).get("x-forma-impersonation-confirmation"), "I understand, continue");
          assert.equal(admission.retained.row.owner_id, "fallback-ask-fictional");
          assert.equal(admission.retained.row.stream_id, "creative:fallback-ask-fictional");
          assert.notEqual(admission.retained.row.owner_id, x.h.store.session.get().impersonation.actor.userId);
        }
        if (kind !== "impersonation") assert.equal(sent[0].body.payload.budgetAcknowledged, true);
        if (nextDraft) {
          const field = x.field(); x.native.emit("keydown", field.port); x.native.focus(field.port);
          field.port.value = NEXT; await x.f.act(field, "input");
          const result = x.f.find("button", node => node.owner === x.workspace && node.attributes["data-workbench-pane"] === "result");
          x.native.emit("pointerdown", result.port); x.native.focus(result.port); await x.f.act(result);
        }
        const focusBefore = x.native.nativeFocus.length, paneBefore = x.pane();
        x.release.resolve(); await x.f.settle();
        assert.equal(x.delivered, 1);
        assert.equal(x.h.store.route.get(), x.route, "the actual confirmation gesture does not renew automatic navigation ownership");
        assert.equal(x.pane(), paneBefore); assert.equal(x.native.nativeFocus.length, focusBefore);
        assert.equal(x.field().properties.value, nextDraft ? NEXT : "", "clear only exact submitted A, never newer raw B");
        assert.equal(x.h.store.ui.toast, `${x.f.i18n.t("activity.kind.chat")} · ${x.f.i18n.t("activity.inProgress")} · ${x.f.i18n.t("shell.navigation.activity")}`);
        assert.deepEqual(originalAdmission(x.worker, admission.body.job.jobId), admission.retained);
        assert.ok(x.h.store.documentJobs.get().some(job => job.jobId === admission.body.job.jobId));
        assert.deepEqual(money(x.worker), x.beforeMoney);
        assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM events ORDER BY sequence").all(), x.beforeEvents);
        // Deliberate navigation only after verifying the untouched current UI.
        // The full Activity renders this genuine queued request, not a stand-in.
        x.h.store.setRoute("/activity?document=" + encodeURIComponent(x.worker.documentId)); await x.f.settle();
        const cards = x.f.tree().visible("article").filter(node => classed(node, "forma-activity-card--job")
          && node.attributes["data-activity-status"] === "queued" && node.text.includes(x.f.i18n.t("activity.kind.chat")));
        assert.equal(cards.length, 1, "the original actor-private request is discoverable in actual Activity");
        assert.ok(x.f.tree().visible("button").some(node => inside(node, cards[0]) && node.text.includes(x.f.i18n.t("activity.openDocument"))));
        assert.equal(x.h.requests.slice(beforeRequests).filter(row => row.url === "/api/document-jobs" && row.init.method === "POST").length, 1);
        assert.deepEqual(originalAdmission(x.worker, admission.body.job.jobId), admission.retained);
        assert.deepEqual(money(x.worker), x.beforeMoney); assert.equal(x.externalAttempts, 0);
      } finally { x.release.resolve(); }
    });
}

// A different current question must not be acknowledged by an older active
// chat's reuse receipt. These additive cases retain the full original fixture,
// Worker admission Responses, current rendered callbacks and provider fences.
// They do not run the queue, replace Store.chat, seed a fabricated job or ACK,
// or certify native pointer/keyboard behavior or provider billing.
async function enterDifferentAsk(x) {
  const field = x.field();
  assert.ok(field?.port?.isConnected, "the actual current Document Ask remains mounted");
  x.native.emit("keydown", field.port); x.native.focus(field.port);
  field.port.value = NEXT; await x.f.act(field, "input");
  assert.equal(x.field().properties.value, NEXT);
}
async function submitCurrentDifferentAsk(x, { required = false } = {}) {
  const button = x.f.find("button", node => node.owner === x.workspace && classed(node, "ask"));
  const form = x.f.find("form", node => node.owner === x.workspace && classed(node, "composer-command"));
  assert.ok(button?.port?.isConnected && form?.port?.isConnected && inside(button, form));
  if (Object.hasOwn(button.attributes, "disabled")) {
    assert.equal(required, false, "no original active job exists at the raced client's current submit check");
    return false; // A truthful active-job disabled control is a valid known-winner repair.
  }
  x.native.emit("pointerdown", button.port); x.native.focus(button.port);
  await x.f.act(form, "submit", { submitter: button.port });
  return true;
}
function observeDifferentAskReuse(x, { race = false, locale = "en" } = {}) {
  const priorTransport = x.h.transport, delivered = sceneDeferred(), rows = [];
  let winner = race ? null : x.admissions[0], winnerPrivateRows = null, winnerJobs = null;
  const privateRows = () => x.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all();
  const jobs = () => x.worker.sqlite.prepare("SELECT * FROM document_jobs ORDER BY rowid").all();
  if (winner) { winnerPrivateRows = privateRows(); winnerJobs = jobs(); }
  x.h.transport = async request => {
    const url = new URL(request.url, "http://localhost"), method = request.init.method ?? "GET";
    if (url.pathname !== "/api/document-jobs" || method !== "POST" || request.body?.kind !== "chat"
        || request.body.payload?.message !== NEXT.trim()) return priorTransport(request);
    try {
      assert.equal(request.body.documentId, x.worker.documentId);
      assert.equal(request.body.payload.livePreview, false);
      if (race) {
        assert.equal(winner, null, "only one actual competing admission is created");
        assert.equal(x.h.store.documentJobActive("chat"), false,
          "B passed the current client check before A won in the Worker");
        assert.equal(jobs().length, 0, "there is no seeded or already-published chat winner");
        // Model the other current client at the exact transport boundary after
        // B's real synchronous submit/check. This actual same-owner admission
        // has no optional execution context; no background model is scheduled.
        const originalResponse = await handleDocumentJobs(new Request("http://localhost/api/document-jobs", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "chat", documentId: x.worker.documentId, sourceSurface: "chat",
            payload: { message: PROMPT.trim(), documentId: x.worker.documentId, livePreview: false, locale,
              promptTechnique: x.h.store.promptTechniquePreference().technique } }),
        }), x.worker.env, "");
        const originalBody = await originalResponse.clone().json();
        assert.equal(originalResponse.status, 202, JSON.stringify(originalBody));
        assert.equal(originalBody.accepted, true); assert.ok(originalBody.job?.jobId);
        winner = { body: originalBody, retained: originalAdmission(x.worker, originalBody.job.jobId) };
        winnerPrivateRows = privateRows(); winnerJobs = jobs();
        assert.equal(x.h.store.documentJobActive("chat"), false,
          "the competing receipt has not been injected into B's Store");
      }
      assert.ok(winner);
      // Preserve B's original Request and the current Worker's existing active
      // reuse contract; never manufacture a successful/failed acknowledgment.
      const response = await handleDocumentJobs(new Request(url, request.init), x.worker.env, "");
      const body = await response.clone().json();
      assert.equal(response.status, 202, JSON.stringify(body));
      assert.equal(body.reused, true); assert.equal(body.accepted, undefined);
      assert.equal(body.job?.jobId, winner.body.job.jobId);
      assert.equal(body.job.documentId, x.worker.documentId); assert.equal(body.job.kind, "chat");
      rows.push({ body, status: response.status });
      delivered.resolve(); return response;
    } catch (error) { delivered.reject(error); throw error; }
  };
  return { rows, delivered, get winner() { return winner; },
    assertOriginalUnchanged() {
      assert.ok(winner);
      assert.deepEqual(originalAdmission(x.worker, winner.body.job.jobId), winner.retained);
      assert.deepEqual(jobs(), winnerJobs, "B has not created or altered any original job");
      assert.deepEqual(privateRows(), winnerPrivateRows, "B was not stored as an admitted private message");
      assert.equal(x.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='chat-user' AND content=?")
        .get(NEXT.trim()).n, 0);
      assert.deepEqual(money(x.worker), x.beforeMoney, "all eight fiscal tables remain exactly unchanged");
      assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM events ORDER BY sequence").all(), x.beforeEvents);
      assert.equal(x.externalAttempts, 0);
    },
  };
}
function assertDifferentAskStillOwned(x, observed) {
  // Check durable consequences before the desired UI invariant so a failing
  // baseline still records that this is draft/acknowledgment loss, not spend.
  observed.assertOriginalUnchanged();
  const posts = x.h.requests.slice(x.requestStart).filter(row => row.url === "/api/document-jobs"
    && (row.init.method ?? "GET") === "POST");
  assert.ok(posts.filter(row => row.body?.payload?.message === NEXT.trim()).length <= 1,
    "no automatic replacement or second B request");
  assert.equal(x.h.store.route.get(), x.route, "A's receipt cannot navigate as if the different B was accepted");
  assert.ok(x.workspace.isConnected, "B's current composer is retained");
  assert.equal(x.field().properties.value, NEXT, "the exact current unsent B survives A's reused acknowledgment");
}
for (const locale of ["en", "ar"]) {
  test("full mounted fallback Ask keeps different B after acknowledged active A " + locale,
    { timeout: 30_000, concurrency: false }, async t => {
      const x = await mountedFallback(t, locale);
      try {
        await submitOriginal(x); await enterDifferentAsk(x);
        x.release.resolve(); await x.f.settle();
        assert.equal(x.delivered, 1); assert.equal(x.h.store.route.get(), x.route);
        assert.equal(x.field().properties.value, NEXT);
        assert.equal(x.h.store.documentJobActive("chat"), true);
        const observed = observeDifferentAskReuse(x, { locale });
        const submitted = await submitCurrentDifferentAsk(x);
        if (submitted) await join(observed.delivered.promise, "actual reused A response to the current different B");
        await x.f.settle();
        assert.equal(observed.rows.length, Number(submitted));
        assert.equal(x.admissions.length, 1, "original admission is never replaced");
        assertDifferentAskStillOwned(x, observed);
      } finally { x.release.resolve(); }
    });
  test("full mounted fallback Ask keeps B when actual A wins after B's client check " + locale,
    { timeout: 30_000, concurrency: false }, async t => {
      const x = await mountedFallback(t, locale);
      try {
        assert.equal(x.h.store.documentJobActive("chat"), false);
        await enterDifferentAsk(x);
        const observed = observeDifferentAskReuse(x, { race: true, locale });
        assert.equal(await submitCurrentDifferentAsk(x, { required: true }), true);
        await join(observed.delivered.promise, "actual concurrent A admission and B reuse response");
        await x.f.settle();
        assert.equal(observed.rows.length, 1);
        assert.equal(x.admissions.length, 0, "B did not pass through the fixture's original A client admission");
        assertDifferentAskStillOwned(x, observed);
      } finally { x.release.resolve(); }
    });
}

const CHAT_REUSE_NOTICE = "A question is already in progress for this document. No additional question was queued; your draft remains in the message field.";
async function currentChatReuseCaller(x, kind) {
  if (kind === "studio") {
    x.h.store.setRoute(withDocumentInRoute("/studio/chat", x.worker.documentId,
      x.h.store.projection.get().documentTitle));
    await x.f.settle();
    const owner = x.f.components().find(component => component.tag === "forma-chat-studio");
    assert.ok(owner?.isConnected, "the actual ChatStudio route is mounted");
    // Preserve this caller's actual checkbox behavior rather than rewriting the
    // request in transport. The fixture must not request a follow-on image.
    const preview = x.f.find("input", node => node.owner === owner && node.attributes.type === "checkbox"
      && classed(node.parent, "chat-live-preview"));
    if (!Object.hasOwn(preview.attributes, "disabled")) {
      preview.port.checked = false;
      x.native.emit("pointerdown", preview.port); x.native.focus(preview.port);
      await x.f.act(preview, "change");
    }
    return { kind, owner, route: x.h.store.route.get(),
      form: () => x.f.find("form", node => node.owner === owner && classed(node, "chat-composer")),
      field: () => x.f.find("textarea", node => node.attributes.id === "creative-chat-message"),
      expectedDraft: NEXT };
  }
  assert.equal(kind, "assistant");
  // The existing fallback fixture intentionally removes only the assistant
  // feature. Restore the fresh actual Worker session for this caller instead
  // of inventing capabilities, enrollment, a source, or a successful response.
  await registerActualRouteDefinitions(x.f, ["forma-creative-assistant"]);
  const response = await x.worker.request("/api/session");
  assert.equal(response.status, 200);
  const session = await response.json(), before = x.h.store.session.get();
  assert.equal(session.user.userId, before.user.userId);
  assert.equal(session.permissionEpoch, before.permissionEpoch);
  assert.deepEqual(session.capabilities, before.capabilities);
  assert.equal(session.policy.accepted, true);
  assert.equal(session.assistant?.enabled, true, "the actual current account offers CreativeAssistant");
  x.h.store.session.set(session); await x.f.settle();
  const owner = x.f.components().find(component => component.tag === "forma-creative-assistant");
  assert.ok(owner?.isConnected);
  const panel = x.f.components().find(component => component.tag === "forma-assistant-panel"
    && component.parentElement === owner);
  assert.ok(panel?.isConnected, "the actual bound assistant panel is mounted");
  const launcher = x.f.find("button", node => node.owner === panel && classed(node, "forma-assistant-launcher"));
  x.native.emit("pointerdown", launcher.port); x.native.focus(launcher.port); await x.f.act(launcher);
  assert.equal(panel.open, true);
  const mode = x.f.find("button", node => node.owner === panel && classed(node, "forma-assistant-mode")
    && node.text === x.f.i18n.t("assistant.mode.creativeChat"));
  x.native.emit("pointerdown", mode.port); x.native.focus(mode.port); await x.f.act(mode);
  assert.equal(x.f.find("button", node => node.owner === panel && classed(node, "forma-assistant-mode")
    && node.text === x.f.i18n.t("assistant.mode.creativeChat")).attributes["aria-pressed"], "true");
  return { kind, owner, panel, route: x.h.store.route.get(),
    form: () => x.f.find("form", node => node.owner === panel && classed(node, "forma-assistant-composer")),
    field: () => x.f.find("textarea", node => classed(node, "forma-assistant-input")),
    // The existing false-result handler retains the normalized submitted
    // message. This supplement does not change or claim raw-whitespace parity.
    expectedDraft: NEXT.trim() };
}
for (const locale of ["en", "ar"]) for (const kind of ["studio", "assistant"]) {
  test("actual shared chat caller retains B after a late original winner " + JSON.stringify({ locale, kind }),
    { timeout: 30_000, concurrency: false }, async t => {
      const x = await mountedFallback(t, locale);
      try {
        const caller = await currentChatReuseCaller(x, kind);
        assert.deepEqual(money(x.worker), x.beforeMoney, "caller setup uses current reads, not fiscal mutation");
        assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM events ORDER BY sequence").all(), x.beforeEvents);
        const source = x.h.store.captureSourceOwnership(), authority = x.h.store.captureAuthorizationScope();
        assert.ok(x.h.store.sourceOwnershipActive(source));
        assert.equal(x.h.store.documentJobActive("chat"), false);
        const field = caller.field(); assert.ok(field.port.isConnected);
        assert.equal(Object.hasOwn(field.attributes, "disabled"), false);
        x.native.emit("keydown", field.port); x.native.focus(field.port);
        field.port.value = NEXT; await x.f.act(field, "input");
        assert.equal(caller.field().properties.value, NEXT,
          "the actual nested conversation composer propagated the current input to its real parent");
        const observed = observeDifferentAskReuse(x, { race: true, locale });
        const form = caller.form(), submitter = x.f.find("button", node => node.attributes.type === "submit"
          && classed(node, "forma-conversation-submit") && inside(node, form));
        assert.equal(Object.hasOwn(submitter.attributes, "disabled"), false);
        x.native.emit("pointerdown", submitter.port); x.native.focus(submitter.port);
        // Invoke the current attached native form, not Store.chat, a private
        // host method, the assistant's callback directly, or a forged result.
        const submission = x.f.act(form, "submit", { submitter: submitter.port });
        await join(observed.delivered.promise, "actual server winner after this caller's active-job check");
        await submission; await x.f.settle();
        assert.equal(observed.rows.length, 1);
        observed.assertOriginalUnchanged();
        assert.ok(x.h.store.documentJobs.get().some(job => job.jobId === observed.winner.body.job.jobId),
          "the real original winner remains in the current Store");
        assert.equal(x.h.store.documentJobActive("chat"), true);
        assert.equal(x.h.store.route.get(), caller.route, "an unrelated winner does not acquire a navigation grant");
        assert.ok(caller.owner.isConnected);
        assert.equal(caller.field().properties.value, caller.expectedDraft,
          "the real false-result handler keeps the current question instead of acknowledging A as B");
        if (caller.panel) assert.equal(caller.panel.open, true);
        assert.ok(x.h.store.sourceOwnershipActive(source));
        assert.ok(x.h.store.authorizationScopeActive(authority));
        const notice = x.f.tree().nodes.filter(node => node.tag === "div" && classed(node, "toast")
          && node.owner === x.f.host && node.attributes.role === "status");
        assert.equal(notice.length, 1, "the actual Shell presents the current Store notice");
        const translatedNotice = x.f.i18n.t("chat.activeRequestUnsent");
        assert.equal(x.f.i18n.system(CHAT_REUSE_NOTICE), translatedNotice);
        if (locale !== "en") assert.notEqual(translatedNotice, CHAT_REUSE_NOTICE, "the actual locale catalog is loaded");
        assert.equal(notice[0].text, translatedNotice);
        assert.equal(x.f.i18n.system(x.h.store.ui.toast), translatedNotice);
        const requests = x.h.requests.slice(x.requestStart), admissions = requests.filter(row =>
          row.url === "/api/document-jobs" && (row.init.method ?? "GET") === "POST");
        assert.equal(admissions.length, 1); assert.equal(admissions[0].body.payload.message, NEXT.trim());
        assert.equal(admissions[0].body.payload.livePreview, false);
        assert.ok(requests.filter(row => (row.init.method ?? "GET") !== "GET").every(row =>
          row.url === "/api/document-jobs" || row.url === "/api/workspace/quick-edit" && row.body?.action === "resume"
          || row.url === "/api/document-jobs/" + encodeURIComponent(observed.winner.body.job.jobId) + "/run"),
        "no extra question, assistant specialist, paid generation, cancellation or retry is submitted");
        assert.equal(x.externalAttempts, 0);
      } finally { x.release.resolve(); }
    });
}

// Actual same-route gestures while a genuine Worker admission/reuse Response is
// in flight. These cases add no result substitute, job seed or provider runner.
async function beginCurrentChatCaller(x, caller, message) {
  assert.equal(x.h.store.documentJobActive("chat"), false);
  const field = caller.field(); assert.ok(field.port.isConnected);
  assert.equal(Object.hasOwn(field.attributes, "disabled"), false);
  x.native.emit("keydown", field.port); x.native.focus(field.port);
  field.port.value = message; await x.f.act(field, "input");
  assert.equal(caller.field().properties.value, message);
  const form = caller.form(), submitter = x.f.find("button", node => node.attributes.type === "submit"
    && classed(node, "forma-conversation-submit") && inside(node, form));
  assert.equal(Object.hasOwn(submitter.attributes, "disabled"), false);
  x.native.emit("pointerdown", submitter.port); x.native.focus(submitter.port);
  const completion = x.f.act(form, "submit", { submitter: submitter.port });
  // Keep a pending actual async form alive without replacing its result. The
  // owning test awaits completion after releasing the real Response.
  void completion.catch(() => {});
  return { completion };
}
function currentChatCallerPane(x, caller) {
  return caller.kind === "studio"
    ? x.f.find("div", node => node.owner === caller.owner && classed(node, "chat-workspace")).attributes["data-result-open"]
    : x.pane();
}
async function interruptCurrentChatCaller(x, caller, interruption) {
  assert.equal(x.f.tree().visible("dialog").some(node => node.port?.open), false,
    "no modal prevents the ordinary current gesture");
  if (caller.panel) assert.equal(x.f.find("section", node => node.owner === caller.panel
    && classed(node, "forma-assistant-panel")).attributes["aria-modal"], "false");
  if (interruption === "focus") {
    const select = x.f.find("select", node => node.owner?.tag === "forma-ui-language-picker");
    assert.equal(Object.hasOwn(select.attributes, "disabled"), false);
    // An ordinary focus gesture, without changing locale, route or source.
    x.native.emit("keydown", select.port); x.native.focus(select.port);
  } else if (interruption === "pane") {
    const button = caller.kind === "studio"
      ? x.f.find("button", node => node.owner === caller.owner && classed(node, "chat-result-toggle"))
      : x.f.find("button", node => node.owner === x.workspace && node.attributes["data-workbench-pane"] === "result");
    assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
    x.native.emit("pointerdown", button.port); x.native.focus(button.port); await x.f.act(button);
    assert.equal(currentChatCallerPane(x, caller), caller.kind === "studio" ? "true" : "result");
  } else assert.equal(interruption, "none");
  assert.equal(x.h.store.route.get(), caller.route, "the ordinary gesture did not change route");
  return { route: caller.route, pane: currentChatCallerPane(x, caller),
    focusCount: x.native.nativeFocus.length, scrollCount: x.native.nativeScroll.length };
}
function assertChatCallerRequestBoundary(x, jobId, message) {
  const requests = x.h.requests.slice(x.requestStart), posts = requests.filter(row => (row.init.method ?? "GET") !== "GET");
  const admissions = posts.filter(row => row.url === "/api/document-jobs");
  assert.equal(admissions.length, 1); assert.equal(admissions[0].body.kind, "chat");
  assert.equal(admissions[0].body.payload.message, message.trim());
  assert.equal(admissions[0].body.payload.livePreview, false);
  assert.ok(posts.every(row => row.url === "/api/document-jobs" && row.body?.kind === "chat"
    || row.url === "/api/workspace/quick-edit" && row.body?.action === "resume"
    || row.url === "/api/document-jobs/" + encodeURIComponent(jobId) + "/run"),
  "only the one admitted question, existing free read and original fenced runner port are requested");
  assert.equal(x.externalAttempts, 0);
}
for (const kind of ["studio", "assistant"]) for (const interruption of ["none", "focus", "pane"]) {
  test("actual shared chat original admission respects current presentation " + JSON.stringify({ kind, interruption }),
    { timeout: 30_000, concurrency: false }, async t => {
      const x = await mountedFallback(t, "en");
      let completion = Promise.resolve();
      try {
        const caller = await currentChatReuseCaller(x, kind);
        const source = x.h.store.captureSourceOwnership(), authority = x.h.store.captureAuthorizationScope();
        ({ completion } = await beginCurrentChatCaller(x, caller, PROMPT));
        await join(Promise.race([x.entered.promise, completion.then(() => x.entered.promise)]),
          "this actual caller's new Worker admission held before acknowledgment");
        await x.f.settle();
        assert.equal(x.admissions.length, 1); assert.equal(x.delivered, 0);
        const original = x.admissions[0];
        const jobs = x.worker.sqlite.prepare("SELECT * FROM document_jobs ORDER BY rowid").all();
        const privateInputs = x.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all();
        assert.equal(caller.field().properties.value, PROMPT);
        assert.equal(x.h.store.documentJobActive("chat"), false, "the original receipt has not reached the Store");
        const before = await interruptCurrentChatCaller(x, caller, interruption);
        assert.ok(x.h.store.sourceOwnershipActive(source));
        assert.ok(x.h.store.authorizationScopeActive(authority));
        x.release.resolve(); await completion; await x.f.settle();
        assert.equal(x.delivered, 1);
        // Check durable effects before the intended presentation assertion, so
        // a baseline failure is not misreported as loss or duplicate spending.
        assert.deepEqual(originalAdmission(x.worker, original.body.job.jobId), original.retained);
        assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM document_jobs ORDER BY rowid").all(), jobs);
        assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(), privateInputs);
        assert.deepEqual(money(x.worker), x.beforeMoney);
        assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM events ORDER BY sequence").all(), x.beforeEvents);
        assert.ok(x.h.store.documentJobs.get().some(job => job.jobId === original.body.job.jobId));
        assertChatCallerRequestBoundary(x, original.body.job.jobId, PROMPT);
        if (interruption === "none") {
          assert.equal(x.h.store.route.get(), withDocumentInRoute("/studio/chat", x.worker.documentId,
            x.h.store.projection.get().documentTitle), "the uninterrupted real admission retains its deliberate handoff");
          if (kind === "studio") {
            assert.equal(caller.field().properties.value, "");
            assert.equal(x.native.nativeScroll.slice(before.scrollCount)
              .filter(entry => classed(entry.node, "chat-thread-end")).length, 1,
            "uninterrupted ChatStudio keeps its existing thread scroll");
          }
        } else {
          assert.equal(x.h.store.route.get(), before.route, "a late original receipt does not override the newer same-route gesture");
          assert.ok(caller.owner.isConnected);
          assert.equal(currentChatCallerPane(x, caller), before.pane);
          assert.equal(caller.field().properties.value, "", "the unchanged admitted original may retire without taking over presentation");
          assert.equal(x.native.nativeFocus.length, before.focusCount, "the admission grants no new focus after the newer gesture");
          assert.equal(x.native.nativeScroll.length, before.scrollCount, "the admission grants no new scroll after the newer gesture");
        }
      } finally { x.release.resolve(); await completion.catch(() => {}); }
    });
}
for (const interruption of ["none", "focus"]) {
  test("actual assistant reused receipt respects newer focus " + interruption,
    { timeout: 30_000, concurrency: false }, async t => {
      const x = await mountedFallback(t, "en"), held = sceneDeferred(), release = sceneDeferred();
      let completion = Promise.resolve();
      try {
        const caller = await currentChatReuseCaller(x, "assistant");
        const observed = observeDifferentAskReuse(x, { race: true, locale: "en" });
        const actualTransport = x.h.transport;
        x.h.transport = async request => {
          const response = await actualTransport(request);
          if (request.url === "/api/document-jobs" && (request.init.method ?? "GET") === "POST"
              && request.body?.kind === "chat" && request.body.payload?.message === NEXT.trim()) {
            held.resolve(); await release.promise;
          }
          return response; // Delay the exact genuine reused-A Response, never replace it.
        };
        ({ completion } = await beginCurrentChatCaller(x, caller, NEXT));
        await join(Promise.all([observed.delivered.promise, held.promise]), "real reused receipt held before the assistant false handler");
        await x.f.settle(); observed.assertOriginalUnchanged();
        assert.equal(caller.field().properties.value, NEXT);
        const source = x.h.store.captureSourceOwnership(), authority = x.h.store.captureAuthorizationScope();
        const before = await interruptCurrentChatCaller(x, caller, interruption);
        release.resolve(); await completion; await x.f.settle();
        observed.assertOriginalUnchanged();
        assert.equal(observed.rows.length, 1); assert.equal(x.admissions.length, 0);
        assertChatCallerRequestBoundary(x, observed.winner.body.job.jobId, NEXT);
        assert.equal(x.h.store.route.get(), before.route); assert.ok(caller.owner.isConnected && caller.panel.open);
        assert.ok(x.h.store.sourceOwnershipActive(source)); assert.ok(x.h.store.authorizationScopeActive(authority));
        assert.equal(caller.field().properties.value, NEXT.trim());
        assert.equal(Object.hasOwn(caller.field().attributes, "disabled"), false,
          "Assistant re-enables this field before deferred refocus; this is not disabled-input focus behavior");
        const responseFocus = x.native.nativeFocus.slice(before.focusCount);
        if (interruption === "none") assert.ok(responseFocus.some(entry => classed(entry.node, "forma-assistant-input")),
          "the uninterrupted false result keeps its existing retry-field focus");
        else {
          assert.equal(responseFocus.length, 0, "the deferred false-result focus cannot steal the newer ordinary focus");
          assert.equal(x.native.nativeScroll.length, before.scrollCount);
        }
      } finally { release.resolve(); x.release.resolve(); await completion.catch(() => {}); }
    });
}

// Append-only current-control semantics. All four cases retain the existing
// full Shell/Workspace/Store/Worker fixture and its actual delayed admission.
// The public Store subscription only observes one emitted render; no Store
// method, response, field, private state or existing fixture default is replaced.
// Native attributes/template ports are not physical keyboard, AT or geometry.
const FALLBACK_ASK_CONTROL_COPY = {
  en: { asking: "Asking Forma…", wait: "Wait for reply", quick: "Quick edit",
    unsent: "A question is already in progress for this document. No additional question was queued; your draft remains in the message field." },
  fr: { asking: "Question adressée à Forma…", wait: "Attendre la réponse", quick: "Modification rapide",
    unsent: "Une question est déjà en cours pour ce document. Aucune question supplémentaire n’a été mise en attente ; votre brouillon reste dans la zone de saisie." },
  ar: { asking: "جارٍ سؤال Forma…", wait: "انتظر الرد", quick: "تعديل سريع",
    unsent: "تجري معالجة سؤال لهذا المستند بالفعل. لم يُضف سؤال آخر إلى قائمة الانتظار؛ وتبقى مسودتك في حقل الكتابة." },
  ja: { asking: "Forma に質問しています…", wait: "返信を待つ", quick: "クイック編集",
    unsent: "このドキュメントでは質問を処理中です。質問は追加されていません。下書きは入力欄に残っています。" },
};
function fallbackAskControlSnapshot(x) {
  const tree = x.f.tree(), forms = tree.visible("form").filter(node => node.owner === x.workspace && classed(node, "composer-command"));
  const form = forms[0], current = node => node.owner === x.workspace && form && inside(node, form);
  const describe = node => ({ tag: node.tag, text: node.text, attributes: { ...node.attributes },
    value: node.properties.value, readOnly: node.properties.readOnly, connected: Boolean(node.port?.isConnected),
    hasClick: typeof node.handlers.click === "function" });
  return {
    forms: forms.length,
    ask: tree.visible("button").filter(node => current(node) && classed(node, "ask")).map(describe),
    fields: tree.visible("textarea").filter(node => current(node) && node.attributes.id === "creative-command").map(describe),
    quick: tree.visible("button").filter(node => current(node) && node.attributes.type === "button"
      && node.attributes.title === x.f.i18n.t("assistant.mode.quickEditDetail")).map(describe),
    status: tree.nodes.filter(node => node.attributes.id === "creative-command-status")
      .map(node => ({ ...describe(node), current: Boolean(current(node)) })),
    paragraphs: tree.visible("p").filter(node => form && inside(node, form)).length,
  };
}
function assertFallbackAskControlState(snapshot, copy, draft, waiting) {
  assert.equal(snapshot.forms, 1);
  assert.equal(snapshot.ask.length, 1); assert.equal(snapshot.fields.length, 1); assert.equal(snapshot.quick.length, 1);
  const ask = snapshot.ask[0], field = snapshot.fields[0], quick = snapshot.quick[0];
  assert.equal(ask.connected, true); assert.equal(field.connected, true); assert.equal(quick.connected, true);
  assert.equal(ask.attributes.type, "submit"); assert.equal(Object.hasOwn(ask.attributes, "disabled"), true);
  assert.equal(ask.text, waiting ? copy.wait : copy.asking, "pending admission must not be labelled as an acknowledged active request");
  assert.equal(field.value, draft, "authored whitespace, Unicode and the unsent draft remain exact");
  assert.equal(Object.hasOwn(field.attributes, "disabled"), false);
  assert.equal(Object.hasOwn(field.attributes, "readonly"), false); assert.notEqual(field.readOnly, true);
  // This inherited ElementPort omits the production template-localization
  // wrapper. Check the real explicit localized title/independent native action;
  // do not turn its static Quick edit text into a false four-locale DOM oracle.
  assert.equal(quick.attributes.type, "button"); assert.ok(quick.text.trim()); assert.equal(quick.hasClick, true);
  assert.equal(Object.hasOwn(quick.attributes, "disabled"), !waiting,
    "Quick edit is independent of the acknowledged chat, but not of the still-pending Ask handler");
  assert.equal(snapshot.paragraphs, 0, "status must not introduce a paragraph in the fixed composer row");
  if (waiting) {
    assert.equal(snapshot.status.length, 1, "one stable description, without duplicate IDs elsewhere in the full shell");
    const status = snapshot.status[0];
    assert.equal(status.tag, "span"); assert.equal(status.current, true); assert.equal(status.connected, true);
    assert.equal(String(status.attributes.class).split(/\s+/u).includes("sr-only"), true);
    assert.equal(status.text, copy.unsent);
    assert.equal(field.attributes["aria-describedby"], "creative-command-status");
    assert.equal(ask.attributes["aria-describedby"], "creative-command-status");
    assert.equal(ask.attributes.title, copy.unsent);
  } else {
    assert.equal(snapshot.status.length, 0, "an unsettled original request must not claim that its current draft is unsent");
    assert.equal(field.attributes["aria-describedby"], undefined); assert.equal(ask.attributes["aria-describedby"], undefined);
    assert.notEqual(ask.attributes.title, copy.unsent);
  }
}
for (const [locale, copy] of Object.entries(FALLBACK_ASK_CONTROL_COPY)) {
  test("full mounted fallback Ask current control semantics " + locale,
    { timeout: 30_000, concurrency: false }, async t => {
      const x = await mountedFallback(t, locale);
      let unsubscribe = () => {};
      try {
        assert.equal(x.f.i18n.system("Asking Forma…"), copy.asking);
        assert.equal(x.f.i18n.t("chat.waitForReply"), copy.wait);
        assert.equal(x.f.i18n.t("chat.activeRequestUnsent"), copy.unsent);
        assert.equal(x.f.i18n.system("Quick edit"), copy.quick, "catalog availability only; static rendered label is not certified by this port");
        await submitOriginal(x);
        assertFallbackAskControlState(fallbackAskControlSnapshot(x), copy, PROMPT, false);
        await enterDifferentAsk(x);
        assertFallbackAskControlState(fallbackAskControlSnapshot(x), copy, NEXT, false);
        const admission = x.admissions[0];
        let observed = false, publication = null, observationError = null;
        unsubscribe = x.h.store.subscribe(() => {
          if (observed || !x.h.store.documentJobs.get().some(job => job.jobId === admission.body.job.jobId)) return;
          observed = true;
          // The real Store publishes the original job before its awaited Ask
          // handler settles. Observe that state with the existing full renderer.
          // Never throw assertions through production notify()/chat(), which
          // would change the result being tested; assertions run after delivery.
          try { x.f.draw(); publication = fallbackAskControlSnapshot(x); }
          catch (error) { observationError = error; }
        });
        const focusBefore = x.native.nativeFocus.length;
        x.release.resolve(); await x.f.settle(); unsubscribe(); unsubscribe = () => {};
        assert.equal(x.delivered, 1); assert.equal(observed, true); assert.equal(observationError, null);
        assertFallbackAskControlState(publication, copy, NEXT, false);
        assert.equal(x.h.store.route.get(), x.route); assert.equal(x.workspace.isConnected, true);
        assert.equal(x.native.nativeFocus.length, focusBefore, "acknowledgement cannot take focus from newer B");
        assert.equal(x.h.store.documentJobActive("chat", x.worker.documentId), true);
        assertFallbackAskControlState(fallbackAskControlSnapshot(x), copy, NEXT, true);
        const field = x.field(), revised = NEXT + "  Revised locally — تعديل محلي  ";
        x.native.emit("keydown", field.port); x.native.focus(field.port); field.port.value = revised;
        await x.f.act(field, "input");
        assertFallbackAskControlState(fallbackAskControlSnapshot(x), copy, revised, true);
        assert.deepEqual(originalAdmission(x.worker, admission.body.job.jobId), admission.retained);
        assert.equal(x.admissions.length, 1);
        const posts = x.h.requests.slice(x.requestStart).filter(row => row.url === "/api/document-jobs" && row.init.method === "POST");
        assert.equal(posts.length, 1, "no automatic second Ask or request from inspecting/editing the controls");
        assert.equal(posts[0].body.payload.message, PROMPT.trim());
        assert.equal(x.h.requests.slice(x.requestStart).some(row => row.url === "/api/workspace/quick-edit"
          && ["preview", "apply"].includes(row.body?.action)), false, "Quick edit is available, not automatically run");
        assert.deepEqual(money(x.worker), x.beforeMoney);
        assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM events ORDER BY sequence").all(), x.beforeEvents);
        assert.equal(x.externalAttempts, 0);
      } finally { unsubscribe(); x.release.resolve(); }
    });
}

// Append-only lost-response receipt truth. Reuse the complete mounted current
// Workspace/Store and actual Worker database. The first genuine 202 is lost at
// the existing finite transport AFTER its admission; the deliberate second
// request receives the genuine reused 202. No job/feed/private state is seeded
// or removed and no Store method is replaced. Timers stay under the existing
// fixture's control: this is the interval before scheduled feed discovery, not
// a physical-network/timing or provider-execution claim.
function observeLostChatAdmissionRetry(x, retryMessage) {
  const originalTransport = x.h.transport, firstLost = sceneDeferred(), reused = sceneDeferred();
  let requests = 0, lostReceipt = null, reuseReceipt = null;
  x.h.transport = async request => {
    const url = new URL(request.url, "http://localhost"), method = request.init.method ?? "GET";
    if (url.pathname !== "/api/document-jobs" || method !== "POST" || request.body?.kind !== "chat") {
      return originalTransport(request);
    }
    const attempt = ++requests;
    if (attempt === 1) {
      const response = await originalTransport(request);
      const body = await response.clone().json();
      assert.equal(response.status, 202, JSON.stringify(body));
      assert.equal(body.accepted, true); assert.equal(body.reused, undefined);
      assert.equal(body.job?.jobId, x.admissions[0].body.job.jobId);
      lostReceipt = { status: response.status, body };
      firstLost.resolve();
      throw new Error("Fixture connection lost after the original actual chat admission");
    }
    try {
      assert.equal(attempt, 2, "exactly one deliberate retry, not an automatic admission loop");
      assert.equal(request.body.payload?.message, retryMessage.trim());
      assert.equal(request.body.payload.livePreview, false);
      assert.equal(request.body.documentId, x.worker.documentId);
      assert.equal(x.h.store.documentJobActive("chat"), false,
        "the ordinary current caller has not discovered the first original receipt");
      const response = await handleDocumentJobs(new Request(url, request.init), x.worker.env, "");
      const body = await response.clone().json();
      assert.equal(response.status, 202, JSON.stringify(body));
      assert.equal(body.reused, true); assert.equal(body.accepted, undefined);
      assert.equal(body.job?.jobId, lostReceipt.body.job.jobId);
      assert.equal(body.job.documentId, x.worker.documentId); assert.equal(body.job.kind, "chat");
      reuseReceipt = { status: response.status, body };
      reused.resolve(); return response;
    } catch (error) { reused.reject(error); throw error; }
  };
  return { firstLost, reused, get requests() { return requests; },
    get lostReceipt() { return lostReceipt; }, get reuseReceipt() { return reuseReceipt; } };
}
for (const variant of ["same-question", "modified-B"]) {
  test("actual fallback chat reused receipt after original lost response " + variant,
    { timeout: 30_000, concurrency: false }, async t => {
      const x = await mountedFallback(t, "en");
      const retryMessage = variant === "same-question" ? PROMPT : NEXT;
      const observed = observeLostChatAdmissionRetry(x, retryMessage);
      try {
        await submitOriginal(x);
        const original = x.admissions[0], authority = x.h.store.captureAuthorizationScope();
        const jobs = x.worker.sqlite.prepare("SELECT * FROM document_jobs ORDER BY rowid").all();
        const privateRows = x.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all();
        const beforeResponseLoss = x.h.requests.length;
        assert.deepEqual(money(x.worker), x.beforeMoney);
        assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM events ORDER BY sequence").all(), x.beforeEvents);
        x.release.resolve();
        await join(observed.firstLost.promise, "genuine accepted receipt is lost after admission");
        await x.f.settle();
        assert.equal(observed.requests, 1); assert.equal(x.admissions.length, 1);
        assert.equal(x.field().properties.value, PROMPT, "failed transport retains the actual submitted draft");
        assert.equal(x.h.store.documentJobActive("chat"), false);
        assert.equal(x.h.store.documentJobs.get().some(job => job.jobId === original.body.job.jobId), false,
          "no receipt or feed publication is injected to create this pre-discovery retry window");
        assert.equal(x.h.requests.slice(beforeResponseLoss).some(row => (row.init.method ?? "GET") === "GET"
          && new URL(row.url, "http://localhost").pathname === "/api/document-jobs"), false,
        "the existing fixture has not dispatched a scheduled feed read before the user's retry");
        if (variant === "modified-B") await enterDifferentAsk(x);
        assert.equal(x.field().properties.value, retryMessage);
        assert.equal(await submitCurrentDifferentAsk(x, { required: true }), true,
          "use the current enabled visible Ask form; do not call Store.chat directly");
        await join(observed.reused.promise, "actual original reused receipt on deliberate retry");
        await x.f.settle();

        // Reach every durable/authority control before the desired copy guard.
        assert.equal(observed.requests, 2); assert.equal(x.admissions.length, 1);
        assert.equal(observed.lostReceipt.body.job.jobId, original.body.job.jobId);
        assert.equal(observed.reuseReceipt.body.job.jobId, original.body.job.jobId);
        assert.deepEqual(originalAdmission(x.worker, original.body.job.jobId), original.retained);
        assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM document_jobs ORDER BY rowid").all(), jobs);
        assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(), privateRows);
        assert.deepEqual(money(x.worker), x.beforeMoney, "all eight fiscal tables remain byte/value unchanged");
        assert.deepEqual(x.worker.sqlite.prepare("SELECT * FROM events ORDER BY sequence").all(), x.beforeEvents);
        assert.equal(x.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='chat-user' AND content=?")
          .get(NEXT.trim()).n, 0, "a modified B is never admitted as the original A");
        assert.equal(x.h.store.route.get(), x.route); assert.equal(x.pane(), "write");
        assert.ok(x.workspace.isConnected && x.h.store.sourceOwnershipActive(x.source));
        assert.ok(x.h.store.authorizationScopeActive(authority));
        assert.equal(x.field().properties.value, retryMessage, "reusing the receipt does not discard the current draft");
        assert.equal(x.h.store.documentJobActive("chat"), true);
        assert.ok(x.h.store.documentJobs.get().some(job => job.jobId === original.body.job.jobId));
        const posts = x.h.requests.slice(x.requestStart).filter(row => row.url === "/api/document-jobs"
          && (row.init.method ?? "GET") === "POST");
        assert.deepEqual(posts.map(row => row.body.payload.message), [PROMPT.trim(), retryMessage.trim()]);
        assert.ok(posts.every(row => row.body.payload.livePreview === false));
        assert.equal(x.externalAttempts, 0);
        const notice = x.f.tree().nodes.filter(node => node.tag === "div" && classed(node, "toast")
          && node.owner === x.f.host && node.attributes.role === "status");
        assert.equal(notice.length, 1); assert.ok(notice[0].text.trim());
        const controls = fallbackAskControlSnapshot(x);
        assert.equal(controls.status.length, 1); assert.equal(controls.ask.length, 1);
        assert.equal(controls.status[0].current, true);
        assert.equal(controls.status[0].text, x.f.i18n.t("chat.activeRequestUnsent"));
        t.diagnostic(JSON.stringify({ variant, originalAccepted: observed.lostReceipt.status,
          reused: observed.reuseReceipt.status, sameOriginalId: true, admissions: 1, deliberatePosts: 2,
          privateJobEventsUnchanged: true, fiscalTablesUnchanged: 8, externalCalls: 0 }));
        if (variant === "same-question") {
          for (const text of [notice[0].text, controls.status[0].text, controls.ask[0].attributes.title]) {
            assert.doesNotMatch(String(text), /Your current draft has not been sent\./u,
              "a reused receipt proves no new admission by this attempt, not that the same original draft was never sent");
          }
        }
      } finally { x.release.resolve(); }
    });
}

// Ordinary Chat's own send, not fallback Ask: one real held 202, then the same
// queued original. The pre-existing handler omits background execution context;
// its foreground /run port is fenced. No provider response is manufactured.
test("C ordinary Chat command departure / pending send then accepted background job", { timeout: 45_000, concurrency: false }, async t => {
  const x = await mountedFallback(t, "en"), { f, h, native, worker } = x;
  const chatHref = withDocumentInRoute("/studio/chat", worker.documentId, h.store.projection.get().documentTitle);
  const link = f.find("a", node => node.owner.tag === "forma-studio-mode-nav" && node.attributes.href === chatHref);
  native.emit("pointerdown", link.port); native.focus(link.port);
  await f.act(link, "click", { button: 0 }); await f.settle();
  const owners = f.components().filter(component => component.tag === "forma-chat-studio");
  assert.equal(owners.length, 1); const owner = owners[0];
  const Constructor = f.modules.get("src/components/forma-chat-studio.ts")?.FormaChatStudio;
  assert.equal(typeof Constructor, "function"); assert.ok(owner instanceof Constructor && owner.isConnected && owner.store === h.store);
  assert.equal(h.store.route.get(), chatHref);
  assert.equal(h.store.projection.get().documentId, worker.documentId);
  assert.equal(h.store.projection.get().projectId, worker.projectId);
  assert.ok(h.store.sourceOwnershipActive(x.source));
  // This actual sibling keeps its same-template form through palette updates.
  // Reuse the existing finite native lifetime/elements port, not a clean guard.
  installImageFormatNativeLifetime({ f, h, after: callback => t.after(callback) });
  // Drain the Chat route's already-scheduled read work before the send/command
  // observation. The held admission itself is never released by this setup.
  for (let attempt = 0; attempt < 8; attempt++) {
    await f.settle();
    for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
    await new Promise(setImmediate);
  }
  await f.settle(); await worker.drainBackground();
  assert.equal([...h.timers.values()].filter(timer => timer.delay === 16).length, 0);
  const setupRequests = h.requests.length; await f.settle(); await new Promise(setImmediate);
  assert.equal(h.requests.length, setupRequests, "Setup reads settle before the ordinary Chat gesture");
  const clientReceipts = worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all();
  const controls = (raw, disabled) => {
    const tree = f.tree(), forms = tree.visible("form").filter(node => node.owner === owner && classed(node, "chat-composer"));
    const fields = tree.visible("textarea").filter(node => node.attributes.id === "creative-chat-message"
      && node.owner.tag === "forma-ui-conversation-composer" && node.owner.parentElement === owner);
    assert.equal(forms.length, 1); assert.equal(fields.length, 1);
    const field = fields[0], form = forms[0], composer = field.owner;
    const Composer = f.modules.get("src/components/design-system/conversation-composer.ts")?.FormaUiConversationComposer;
    assert.equal(typeof Composer, "function"); assert.ok(composer instanceof Composer);
    assert.ok(owner.isConnected && field.port?.isConnected && form.port?.isConnected && inside(field, form));
    assert.equal(composer.value, raw); assert.equal(field.properties.value, raw); assert.equal(field.port.value, raw);
    assert.equal(field.port.matches(":disabled"), disabled);
    return { field, form, tree };
  };
  const initial = controls("", false).field;
  native.emit("pointerdown", initial.port); native.focus(initial.port);
  initial.port.value = PROMPT; await f.act(initial, "input"); controls(PROMPT, false);
  const preview = f.find("input", node => node.owner === owner && node.attributes.type === "checkbox");
  assert.equal(preview.port.matches(":disabled"), false);
  preview.port.checked = false; await f.act(preview, "change");
  assert.equal(f.find("input", node => node.owner === owner && node.attributes.type === "checkbox").port.checked, false);
  const submit = controls(PROMPT, false);
  const buttons = submit.tree.visible("button").filter(node => node.owner.tag === "forma-ui-conversation-composer"
    && node.owner.parentElement === owner && node.attributes.type === "submit" && inside(node, submit.form));
  assert.equal(buttons.length, 1); assert.equal(buttons[0].port.matches(":disabled"), false);
  native.emit("pointerdown", buttons[0].port); native.focus(buttons[0].port);
  const pending = f.act(submit.form, "submit", { submitter: buttons[0].port });
  pending.catch(() => {});
  // Diagnostic only: retain the exact original public operations and returned
  // departure records. Do not substitute a current/blocked/focus predicate.
  const feedbackCalls = [], departures = [], commandStages = [];
  const originalToast = h.store.toast, originalDeparture = owner.captureCommandDeparture;
  t.mock.method(h.store, "toast", function (...args) {
    const record = { message: args[0], before: this.ui.toast }; feedbackCalls.push(record);
    const result = originalToast.apply(this, args); record.after = this.ui.toast; return result;
  });
  t.mock.method(owner, "captureCommandDeparture", function (...args) {
    const departure = originalDeparture.apply(this, args); departures.push(departure); return departure;
  });
  const siblingDepartures = [];
  const siblingOrigins = f.components().filter(candidate => candidate !== owner && typeof candidate.captureCommandDeparture === "function");
  for (const element of siblingOrigins) {
    const capture = element.captureCommandDeparture;
    t.mock.method(element, "captureCommandDeparture", function (...args) {
      const departure = capture.apply(this, args);
      const form = this.tag === "forma-image-format-editor" ? this.querySelector(".image-format-form") : null;
      siblingDepartures.push({ element: this, departure, form }); return departure;
    });
  }
  const diagnosticValue = read => { try { return { value: read() }; } catch (error) { return { error: String(error) }; } };
  const nativeIdentity = node => node ? { tag: node.tag ?? node.tagName,
    id: node.getAttribute?.("id") ?? node.attributes?.id ?? null,
    class: node.getAttribute?.("class") ?? node.attributes?.class ?? null,
    connected: node.isConnected, currentPort: f.renderer.nodes.includes(node) } : null;
  const commandStage = stage => commandStages.push({ stage, route: h.store.route.get(),
    toast: h.store.ui.toast, commandOpen: h.store.ui.commandOpen,
    originalSourceActive: h.store.sourceOwnershipActive(x.source),
    authorityKey: h.store.captureAuthorizationScope()?.key ?? null,
    sameChat: owner.isConnected && owner.store === h.store,
    queriedChat: [...f.host.querySelectorAll("forma-chat-studio")].map(candidate => ({ same: candidate === owner, connected: candidate.isConnected, sameStore: candidate.store === h.store })),
    actualOrigins: f.components().filter(candidate => typeof candidate.captureCommandDeparture === "function").map(candidate => candidate.tag),
    sameFocusDocument: owner.ownerDocument === native.document && f.host.ownerDocument === native.document,
    active: nativeIdentity(native.document.activeElement),
    actualDepartures: departures.map(departure => ({ sameElement: departure.element === owner,
      current: departure.current(), blocked: departure.blocked(), reason: departure.reason() })),
    siblingDepartures: siblingDepartures.map(({ element, departure, form }) => {
      const currentForm = element.tag === "forma-image-format-editor" ? element.querySelector(".image-format-form") : null;
      return { tag: element.tag, sameElement: departure.element === element, connected: element.isConnected,
        sameStore: element.store === h.store, current: diagnosticValue(() => departure.current()),
        blocked: diagnosticValue(() => departure.blocked()), reason: departure.reason(),
        capturedForm: nativeIdentity(form), currentForm: nativeIdentity(currentForm), sameForm: currentForm === form,
        namedItemPort: typeof currentForm?.elements?.namedItem };
    }),
    queuedToastExpiryTimers: [...h.timers.values()].filter(timer => timer.delay === 2800).length });
  const libraryCommand = async () => {
    const stageStart = commandStages.length, feedbackStart = feedbackCalls.length, focusStart = native.nativeFocus.length;
    commandStage("before-open");
    const trigger = f.find("button", node => node.owner === f.host && classed(node, "command-trigger"));
    native.emit("pointerdown", trigger.port); native.focus(trigger.port); await f.act(trigger);
    commandStage("after-open");
    const query = f.find("input", node => node.owner === f.host && node.attributes.id === "command-search");
    const label = f.i18n.t("command.openLibrary", "Open reusable library");
    query.port.value = label; await f.act(query, "input");
    const rows = f.tree().visible("button").filter(node => node.owner === f.host && node.attributes.role === "option"
      && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === label));
    assert.equal(rows.length, 1, "One exact existing Library command, not a first-match fallback");
    assert.ok(rows[0].port?.isConnected && f.renderer.nodes.includes(rows[0].port));
    assert.equal(rows[0].port.matches(":disabled"), false);
    native.emit("pointerdown", rows[0].port); native.focus(rows[0].port);
    commandStage("before-choice");
    await f.act(rows[0], "click", { button: 0 }); await f.settle();
    commandStage("after-choice");
    t.diagnostic("C_ORDINARY_CHAT_COMMAND_FEEDBACK " + JSON.stringify({ stages: commandStages.slice(stageStart),
      feedback: feedbackCalls.slice(feedbackStart), focus: native.nativeFocus.slice(focusStart).map(value => ({
        target: nativeIdentity(value.node), previous: nativeIdentity(value.previous), previousConnected: value.previousConnected })),
      original202Held: x.delivered === 0, diagnosticOnly: true }));
    assert.equal(h.store.ui.commandOpen, false);
  };
  try {
    await join(x.entered.promise, "ordinary Chat's actual original held 202"); await f.settle();
    assert.equal(x.admissions.length, 1); assert.equal(x.delivered, 0);
    const original = x.admissions[0];
    assert.equal(original.body.accepted, true); assert.equal(original.retained.row.status, "queued");
    assert.equal(original.retained.row.attempt_count, 0);
    controls(PROMPT, true);
    assert.equal(h.store.documentJobs.get().some(job => job.jobId === original.body.job.jobId), false,
      "The actual server admission is not yet acknowledged by Store");
    const beforeRequests = h.requests.length, source = h.store.captureSourceOwnership(), authority = h.store.captureAuthorizationScope();
    assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authority));
    await libraryCommand();
    t.diagnostic("C_ORDINARY_CHAT_PENDING_COMMAND " + JSON.stringify({ original202Held: x.delivered === 0,
      sameRoute: h.store.route.get() === chatHref, originalChatConnected: owner.isConnected,
      actualQueuedOriginal: true, independentlyIsolatedSendingLatch: false, externalAttempts: x.externalAttempts }));
    assert.equal(h.store.route.get(), chatHref, "Pending local send and its visible raw input retain the ordinary Chat owner");
    controls(PROMPT, true);
    assert.equal(h.requests.length, beforeRequests, "Pending departure refusal starts no destination request");
    assert.equal(h.store.ui.toast, f.i18n.t("next.lifecycle.currentWorkOpen"));
    assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0);
    x.release.resolve(); await pending; await f.settle();
    assert.equal(x.delivered, 1);
    assert.deepEqual(originalAdmission(worker, original.body.job.jobId), original.retained);
    assert.equal(h.store.documentJobActive("chat"), true);
    controls("", true); // Disabled by the genuine queued job, no longer by raw text or pending local send.
    const sourceAfter = h.store.captureSourceOwnership(), authorityAfter = h.store.captureAuthorizationScope();
    assert.ok(h.store.sourceOwnershipActive(sourceAfter) && h.store.authorizationScopeActive(authorityAfter));
    await libraryCommand();
    assert.equal(h.store.route.get(), withProjectTaskDocumentInRoute("/library", worker.documentId));
    assert.equal(owner.isConnected, false);
    const libraries = f.components().filter(component => component.tag === "forma-library");
    assert.equal(libraries.length, 1); assert.ok(libraries[0].isConnected && libraries[0].store === h.store);
    assert.equal(h.store.projection.get().documentId, worker.documentId);
    assert.equal(h.store.projection.get().projectId, worker.projectId);
    assert.ok(h.store.sourceOwnershipActive(sourceAfter) && h.store.authorizationScopeActive(authorityAfter));
    assert.deepEqual(originalAdmission(worker, original.body.job.jobId), original.retained);
    t.diagnostic("C_ORDINARY_CHAT_BACKGROUND_DEPARTURE " + JSON.stringify({ sameOriginalJob: original.body.job.jobId,
      accepted202Deliveries: x.delivered, rawClearedByActualSuccess: true, queuedAttemptCount: 0,
      exactLibraryArrived: true, providerExecution: false }));
  } finally {
    x.release.resolve(); await pending; await f.settle(); await worker.drainBackground();
    assert.equal(x.admissions.length, 1); assert.equal(x.delivered, 1);
    assert.deepEqual(originalAdmission(worker, x.admissions[0].body.job.jobId), x.admissions[0].retained);
    assert.deepEqual(money(worker), x.beforeMoney);
    assert.deepEqual(worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), clientReceipts);
    assert.deepEqual(worker.sqlite.prepare("SELECT * FROM events ORDER BY sequence").all(), x.beforeEvents);
    assert.equal(h.requests.filter(request => request.url === "/api/document-jobs" && request.init.method === "POST").length, 1);
    assert.equal(x.externalAttempts, 0);
  }
});
