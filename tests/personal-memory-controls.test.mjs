// Bounded component fixtures only: actual class, real Lit template values and client,
// finite Store/host/dialog/HTTP ports. No Store, Worker, full app, native lifecycle,
// provider, persistence or live account is imported or evaluated. This is not a DOM
// rendering, trusted-click, keyboard, focus, Escape, zoom or narrow-layout check.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { before } from "node:test";
import { fileURLToPath } from "node:url";
import { html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import ts from "typescript";
import { createLiveMemoryClient, MemoryClientError, MEMORY_POLICY, MEMORY_TIMING, MEMORY_WRITE_CONTRACT } from "../src/state/live-memory-client.ts";
import { createDocumentProfileClient, DocumentProfileClientError, DOCUMENT_PROFILE_CONTROL_VERSION, DOCUMENT_PROFILE_POLICY, NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE } from "../src/state/document-profile-client.ts";
import { createMemoryDerivationClient, MemoryDerivationClientError, MEMORY_DERIVATION_CONTROL, MEMORY_DERIVATION_POLICY } from "../src/state/memory-derivation-client.ts";
import { parseMemoryAnswerPresentation } from "../src/model/memory-answer.ts";
import { createMemoryElapsed } from "../src/model/memory-lifetime.ts";
import { ASSISTANT_CONTEXT_LIMITS } from "../src/model/conversation-context.ts";
import { parseMemoryCustody } from "../src/model/memory-custody.ts";
import { memoryConsumptionWindows } from "../src/model/memory-consumption-v2.ts";
import { liveConversationDigest } from "../src/model/memory-conversation.ts";
import { rollingLiveMemoryConsumption, memoryEventAction } from "../src/model/memory-observations.ts";
import { FORMA_PERSONAL_MEMORY_MESSAGES, personalMemoryMessage } from "../src/components/design-system/locales/personal-memory-messages.ts";
import { assistantInteractionForSurface, assistantSurfaceForRoute } from "../src/model/assistant-route-policy.ts";

const componentPath = new URL("../src/components/forma-personal-memory.ts", import.meta.url);
const componentBytes = readFileSync(componentPath);
const componentProof = { path: fileURLToPath(componentPath), sha256: createHash("sha256").update(componentBytes).digest("hex"), bytes: componentBytes.byteLength };
before(() => { process.stdout.write(`# fixture-component-source ${JSON.stringify(componentProof)}\n`); });
const source = ts.createSourceFile("forma-personal-memory.ts", componentBytes.toString("utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const componentClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FormaPersonalMemory");
assert.ok(componentClass, "exercise the actual memory component class, not a rewritten controller");
const compiled = ts.transpileModule(componentClass.getText(source).replace(/^export /u, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, useDefineForClassFields: false },
}).outputText;

const fixtureId = value => value.toString(16).padStart(64, "0");
const now = () => new Date().toISOString();
const future = days => new Date(Date.now() + days * 86_400_000).toISOString();
const personalSession = () => ({ user: { userId: "fixture-user" }, policy: { accepted: true }, projects: [] });
const fixtureDocument = (overrides = {}) => ({ id: "fixture-document", projectId: "fixture-project", title: "Fixture document",
  createdSequence: 1, sourceEvents: ["fixture-document-created"], ...overrides });
function invalidFutureCalendarDate() {
  const today = new Date();
  for (let offset = 1; offset <= 12; offset++) {
    const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
    if (new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate() < 31)
      return `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}-31`;
  }
  throw new Error("calendar fixture requires a short month");
}
const contract = () => ({ timing: MEMORY_TIMING, preferredLocalWindow: { startHour: 1, endHour: 5 },
  freshDaytimeCatchUpAllowed: true, savedPagesMayContinueOutsideWindow: true, strictlyOvernight: false, deliverySlaVerified: false });
const enrollment = (overrides = {}) => ({ id: fixtureId(1), projectId: "fixture-project", documentId: "fixture-document", organizationId: null,
  revision: 1, learn: true, recall: true, background: true, retentionDays: 30, timeZone: "UTC", expiresAt: future(30), policyVersion: MEMORY_POLICY,
  lastAdmittedAt: null, throughSequence: 10, cutoffSequence: null, backlog: false, nextDueAt: now(), attempts: 0, status: "ready", ...overrides });
const settings = (enrollments = [], overrides = {}) => ({ enabled: true, policyVersion: MEMORY_POLICY, writeContractVersion: MEMORY_WRITE_CONTRACT, reviewContract: contract(),
  enrollments, nextAfter: null, ...overrides });
const saved = draft => ({ enrollment: enrollment({ ...Object.fromEntries(["projectId", "documentId", "learn", "recall", "background",
  "retentionDays", "timeZone", "expiresAt", "policyVersion"].map(key => [key, draft[key]])), revision: draft.revision + 1 }),
  reviewContract: contract(), historyStartsAt: now(), priorMemoryCleared: true, uiChanged: false });
const forgotten = () => ({ erased: true, reEnrollmentRequired: true, otherDevicesAndBackupsPurged: false });
function referenceExport(item, capturedAt = now()) {
  const recordedAt = capturedAt, retentionExpiresAt = new Date(Math.min(Date.parse(item.expiresAt), Date.parse(recordedAt) + 86_400_000)).toISOString();
  return { format: "forma-memory-reference-export-v1", capturedAt,
    enrollment: { id: item.id, revision: item.revision, policyVersion: item.policyVersion, retentionDays: item.retentionDays, expiresAt: item.expiresAt },
    scope: { organizationId: item.organizationId, projectId: item.projectId, documentId: item.documentId },
    treatment: "untrusted-historical-evidence", method: "descriptive-source-references", deadlineSemantics: "retention-upper-bounds-not-an-access-lease",
    coverage: { since: capturedAt, throughSequence: item.throughSequence, remainingThroughSequence: item.cutoffSequence,
      completeFromStart: false, bounded: true, sourceLimit: 64, sourceCount: 1, moreEligibleSources: false },
    sources: [{ eventId: "reference-event", sequence: item.throughSequence, type: "DocumentOpened", blockId: null,
      recordedAt, retentionExpiresAt, action: "encounter" }],
    includes: { prose: false, vectors: false, inferredPreferences: false, completeHistory: false } };
}
function recall(item, marker = "Synthetic private excerpt", { leaseMs = 60_000, checkedAt = now() } = {}) {
  const recordedAt = checkedAt;
  const validUntil = new Date(Math.min(Date.parse(checkedAt) + leaseMs, Date.parse(item.expiresAt))).toISOString();
  return { mode: "live-reference-memory", scope: { organizationId: item.organizationId, projectId: item.projectId, documentId: item.documentId },
    lifetime: { version: "memory-recall-lifetime-v1", checkedAt, validUntil },
    treatment: "untrusted-historical-evidence", method: "extractive-not-semantic", consumption: { conversation: 1 },
    rollingConversation: { summary: [], recent: [{ sourceEventId: "fixture-event", recordedAt, user: marker, assistant: "Synthetic historical response" }], completeFromStart: false },
    coverage: { since: recordedAt, throughSequence: 10, remainingThroughSequence: null, bounded: true, sourceCount: 1 },
    sources: [{ eventId: "fixture-event", type: "AssistantReasoned", blockId: null, recordedAt, validUntil }],
    note: "Observed actions are not inferred preferences; excerpts are truncated and access-filtered." };
}
function activityRecall(item, { checkedAt = now(), leaseMs = 60_000, sinceDays = 30, remaining = null,
  entries = [["DocumentOpened", 1, null], ["BlockPropertyEdited", 2, "private-block-a"],
    ["ObjectSaved", 8, "private-block-a"], ["BlockRemoved", 9, "private-block-b"]] } = {}) {
  const body = recall(item, "", { checkedAt, leaseMs });
  body.rollingConversation = { summary: [], recent: [], completeFromStart: false };
  body.sources = entries.map(([type, daysAgo, blockId], index) => ({ eventId: `activity-${index}`, type, blockId,
    recordedAt: new Date(Date.parse(checkedAt) - daysAgo * 86_400_000).toISOString(), validUntil: body.lifetime.validUntil }));
  body.consumption = {};
  for (const source of body.sources) { const action = memoryEventAction(source.type); if (action) body.consumption[action] = (body.consumption[action] ?? 0) + 1; }
  body.coverage = { ...body.coverage, since: new Date(Date.parse(checkedAt) - sinceDays * 86_400_000).toISOString(),
    sourceCount: body.sources.length, remainingThroughSequence: remaining };
  body.rollingConsumption = rollingLiveMemoryConsumption(body.sources, body.lifetime, body.coverage.since, item.retentionDays);
  return body;
}
function outcomesRecall(item, { checkedAt = now(), leaseMs = 60_000, empty = false } = {}) {
  const body = recall(item, "", { checkedAt, leaseMs }), until = body.lifetime.validUntil;
  const decisionAt = new Date(Date.parse(checkedAt) - 2_000).toISOString();
  const mutationAt = new Date(Date.parse(checkedAt) - 1_000).toISOString();
  body.sources = empty ? [] : [
    { eventId: "assisted-decision-a", type: "ProposalAccepted", blockId: null, recordedAt: decisionAt, validUntil: until },
    { eventId: "assisted-change-a", type: "BlockPropertyEdited", blockId: "private-assisted-block", recordedAt: mutationAt, validUntil: until },
    { eventId: "assisted-decision-b", type: "ProposalRejected", blockId: null, recordedAt: checkedAt, validUntil: until },
  ];
  body.consumption = empty ? {} : { accept: 1, edit: 1, reject: 1 };
  body.rollingConversation = { summary: [], recent: [], completeFromStart: false };
  body.coverage = { ...body.coverage, since: decisionAt, sourceCount: body.sources.length };
  body.assistedOutcomes = { version: "native-assisted-outcomes-v1", treatment: "descriptive-assisted-decisions",
    exposure: "not-measured", inferredPreferences: false,
    coverage: { selectedSourceCount: body.sources.length, selectedDecisionCount: empty ? 0 : 2,
      certifiedOutcomeCount: empty ? 0 : 2, completeHistory: false, bounded: true, freeAssistantOnly: true },
    outcomes: empty ? [] : [
      { proposalId: "private-assisted-proposal-a", turnId: "private-assisted-turn-a", status: "accepted", actionKind: "context.edit",
        origin: "assistant-assisted", independentEvidence: false, decision: { sourceIndex: 0 },
        mutation: { sourceIndex: 1, type: "BlockPropertyEdited", blockIds: ["private-assisted-block"], relationId: null }, recordedAt: decisionAt },
      { proposalId: "private-assisted-proposal-b", turnId: "private-assisted-turn-b", status: "rejected", actionKind: "context.remove",
        origin: "assistant-assisted", independentEvidence: false, decision: { sourceIndex: 2 }, mutation: null, recordedAt: checkedAt },
    ] };
  return body;
}
function savedOutputsRecall(item, { checkedAt = now(), leaseMs = 60_000, empty = false, partial = false } = {}) {
  const body = recall(item, "", { checkedAt, leaseMs }), generatedAt = new Date(Date.parse(checkedAt) - 4_000).toISOString();
  const types = empty ? ["DocumentOpened"] : ["ObjectSaved", "ObjectPinned", "ObjectExported", ...(partial ? ["ObjectSaved"] : [])];
  body.sources = types.map((type, index) => ({ eventId: "private-retention-event-" + index, type, blockId: "private-retention-block",
    recordedAt: new Date(Date.parse(checkedAt) - 3_000 + index * 1_000).toISOString(), validUntil: body.lifetime.validUntil }));
  body.rollingConversation = { summary: [], recent: [], completeFromStart: false }; body.consumption = {};
  for (const source of body.sources) { const action = memoryEventAction(source.type); if (action) body.consumption[action] = (body.consumption[action] ?? 0) + 1; }
  body.coverage = { ...body.coverage, since: generatedAt, sourceCount: body.sources.length };
  body.savedOutputs = { version: "native-saved-outputs-v1", treatment: "descriptive-output-retention", inferredPreferences: false,
    coverage: { selectedSourceCount: body.sources.length, selectedRetentionActionCount: empty ? 0 : body.sources.length,
      certifiedOutputCount: empty ? 0 : 1, completeHistory: false, bounded: true, nativeImageJobsOnly: true },
    outputs: empty ? [] : [{ sourceIndexes: [0, 1, 2], origin: "native-generated-output", independentEvidence: false, generatedAt }] };
  return body;
}
function rollingRecall(item, earlier, options = {}) {
  const value = recall(item, "unused", options), { checkedAt, validUntil } = value.lifetime;
  const clips = [...earlier, { user: "Recent request one stays exact", assistant: "Recent answer one stays exact" },
    { user: "Recent request two stays exact", assistant: "Recent answer two stays exact" }]
    .map((clip, index) => ({ sourceEventId: `rolling-fixture-event-${index}`, recordedAt: checkedAt, ...clip }));
  value.rollingConversation = { summary: clips.slice(0, -2), recent: clips.slice(-2), completeFromStart: false };
  value.consumption = { conversation: clips.length }; value.coverage.sourceCount = clips.length;
  value.sources = clips.map(clip => ({ eventId: clip.sourceEventId, type: "AssistantReasoned", blockId: null, recordedAt: checkedAt, validUntil }));
  return value;
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
/** A real pending Response with a producer that observes native stream cancellation. */
function delayedJson(value) {
  let controller, released = false, cancellations = 0;
  const response = new Response(new ReadableStream({
    start(value) { controller = value; },
    cancel() { cancellations++; },
  }), { headers: { "content-type": "application/json" } });
  return { response, get cancellations() { return cancellations; }, release() {
    assert.equal(released, false, "the fixture producer is released only once"); released = true;
    // Do not enqueue into a stream the real reader has cancelled. Unknown closure
    // errors still propagate; only the observed underlying cancel permits a no-op.
    if (cancellations) return "cancelled";
    controller.enqueue(new TextEncoder().encode(JSON.stringify(value))); controller.close(); return "delivered";
  } };
}
const flush = async () => { for (let i = 0; i < 2; i++) await new Promise(resolve => setImmediate(resolve)); };

function* templates(value) {
  if (Array.isArray(value)) { for (const item of value) yield* templates(item); return; }
  if (value?._$litDirective$ === keyed("", null)._$litDirective$) { yield* templates(value.values[1]); return; }
  if (!value || typeof value !== "object" || !Array.isArray(value.strings) || !Array.isArray(value.values)) return;
  yield value;
  for (const item of value.values) yield* templates(item);
}
function templateText(value) {
  if (Array.isArray(value)) return value.map(templateText).join("");
  if (value?._$litDirective$ === keyed("", null)._$litDirective$) return templateText(value.values[1]);
  if (value && typeof value === "object" && Array.isArray(value.strings))
    return value.strings.map((part, index) => part + templateText(value.values[index])).join("");
  return ["string", "number"].includes(typeof value) ? String(value) : "";
}
function controls(root) {
  const found = [];
  for (const template of templates(root)) {
    const markup = template.strings.map((part, index) => part + (index < template.values.length ? `__LIT_VALUE_${index}__` : "")).join("");
    const stack = [];
    for (const tag of markup.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/giu)) {
      const name = tag[2].toLowerCase();
      if (tag[1]) { if (stack.at(-1)?.name === name) stack.pop(); continue; }
      const attributes = new Map();
      for (const attribute of tag[3].matchAll(/([@.?]?[\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu)) {
        const raw = attribute[2] ?? attribute[3] ?? attribute[4] ?? true;
        const marker = typeof raw === "string" ? /^__LIT_VALUE_(\d+)__$/u.exec(raw) : null;
        attributes.set(attribute[1], marker ? template.values[Number(marker[1])] : raw);
      }
      const disabled = Boolean(attributes.get("?disabled") || attributes.has("disabled")
        || stack.some(parent => parent.name === "fieldset" && parent.disabled));
      if (["input", "select", "button", "form", "a", "span", "h2", "details", "article"].includes(name)) {
        const end = markup.indexOf(`</${name}>`, tag.index + tag[0].length);
        const body = name === "input" || end < 0 ? "" : markup.slice(tag.index + tag[0].length, end);
        const label = body.replace(/__LIT_VALUE_(\d+)__/gu, (_, index) => templateText(template.values[Number(index)])).replace(/<[^>]*>/gu, "").trim();
        found.push({ tag: name, attributes, disabled, label, inRecallSubtree: stack.some(parent => parent.recallSubtree),
          inProfileSubtree: stack.some(parent => parent.profileSubtree) });
      }
      if (!["input", "br", "hr", "img", "meta", "link"].includes(name)) stack.push({ name, disabled,
        profileSubtree: attributes.has("data-memory-profile-view") || attributes.has("data-memory-profile-choice"),
        recallSubtree: typeof attributes.get("class") === "string" && attributes.get("class").split(/\s+/u).includes("personal-memory-excerpts") });
    }
  }
  return found;
}

function fixture(t, { initial = settings(), route = "/memory", session: initialSession, locale = "en", localized = false, connected = true } = {}) {
  const calls = [], responses = [initial], dialogs = [], confirmations = [], navigations = [], unexpected = [];
  const subscriptions = new Set(), listeners = new Map(), documentListeners = new Map(), timers = new Map(), guardedCalls = [];
  const focusEvents = [], focusLeases = [], dialogRestorations = [], recallReceipts = [], profileReceipts = [];
  const downloadUrls = new Map(), downloads = [], revokedDownloadUrls = [], downloadLinks = [];
  let downloadSequence = 0, throwDownload = false;
  let focusEpoch = 0, dialogOpen = false, updateBoundary = Promise.resolve(true), renderCalls = 0;
  const clock = { now: Date.now(), monotonic: 0 }; let timerSequence = 0;
  class FixtureDate extends Date {
    constructor(...values) { if (values.length) super(...values); else super(clock.now); }
    static now() { return clock.now; }
  }
  const state = { session: initialSession ?? personalSession(),
    route, projection: { projectId: "fixture-project", documentId: "fixture-document",
      documents: [fixtureDocument()] }, events: [], content: {},
    authorization: 1, source: 1, cookieGeneration: 1, sessionGeneration: 1 };
  const expiryCurrent = value => value === null || Number.isFinite(Date.parse(value)) && Date.parse(value) > clock.now;
  const store = {
    session: { get: () => state.session }, route: { get: () => state.route }, projection: { get: () => state.projection },
    events: { get: () => state.events }, content: { get: () => state.content },
    subscribe(callback) { subscriptions.add(callback); return () => subscriptions.delete(callback); },
    captureAuthorizationScope: () => state.session ? { key: JSON.stringify([state.authorization, state.session.user.userId]), generation: state.authorization, actor: state.session.user.userId } : null,
    authorizationScopeActive: captured => captured?.generation === state.authorization && captured?.actor === state.session?.user.userId,
    captureSourceOwnership: () => ({ generation: state.source, projectId: state.projection.projectId, documentId: state.projection.documentId,
      expiresAt: state.session?.projectContext?.expiresAt ?? null }),
    sourceOwnershipActive: captured => captured?.generation === state.source && captured?.projectId === state.projection.projectId
      && captured?.documentId === state.projection.documentId && expiryCurrent(captured.expiresAt)
      && expiryCurrent(state.session?.projectContext?.expiresAt ?? null),
    // Finite contract port, not the Store implementation. Match its cookie barrier
    // and ownership/authorization checks before dispatch and after response headers.
    async guardedFetch(input, init, action, controls) {
      assert.equal(typeof controls?.current, "function", "the actual component supplies an owner-bound current callback");
      guardedCalls.push({ input, init, action, controls });
      const check = () => { if (state.cookieGeneration !== state.sessionGeneration || !controls.current()) throw new Error("fixture owner/cookie boundary"); };
      check(); const authorization = store.captureAuthorizationScope();
      const pending = transport(input, init); controls.onDispatch?.();
      const response = await pending; check();
      if (!store.authorizationScopeActive(authorization)) throw new Error("fixture authorization boundary");
      return response;
    },
  };
  const windowPort = {
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    setTimeout(callback, delay) { const id = ++timerSequence; timers.set(id, { callback, delay, due: clock.now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const documentPort = {
    visibilityState: "visible",
    activeElement: null,
    body: { isConnected: true, fixtureBody: true, closest: () => null },
    addEventListener(name, callback) { if (!documentListeners.has(name)) documentListeners.set(name, new Set()); documentListeners.get(name).add(callback); },
    removeEventListener(name, callback) { documentListeners.get(name)?.delete(callback); },
    querySelector(selector) { assert.equal(selector, "dialog[open]", "only the reviewed modal guard is represented"); return dialogOpen ? { isConnected: true } : null; },
    createElement(name) {
      assert.equal(name, "a", "export creates only a detached download anchor");
      const link = { href: "", download: "", rel: "", removed: false,
        click() {
          assert.ok(downloadUrls.has(this.href), "download uses its live fixture Blob URL");
          if (throwDownload) throw new Error("Synthetic download unavailable");
          downloads.push({ filename: this.download, rel: this.rel, blob: downloadUrls.get(this.href) });
        }, remove() { this.removed = true; } };
      downloadLinks.push(link); return link;
    },
  };
  class FormaElement {
    store = store;
    isConnected = true;
    ownerDocument = documentPort;
    i18n = { locale, direction: locale === "ar" ? "rtl" : "ltr", t: (key, _fallback, values = {}) => localized
      ? (FORMA_PERSONAL_MEMORY_MESSAGES[locale][key] ?? key).replace(/\{(\w+)\}/gu, (_, name) => String(values[name] ?? `{${name}}`))
      : key + Object.values(values).map(value => ` [${value}]`).join(""),
      number: value => String(value), date: value => value.toISOString() };
    connectedCallback() {}
    disconnectedCallback() {}
    requestUpdate() {}
    contains(target) { return target?.fixtureOwner === this && target.isConnected; }
    get updateComplete() { return updateBoundary; }
    querySelector(selector) { return queryControl(selector); }
  }
  async function transport(url, init) {
    calls.push({ url, init, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    if (!responses.length) { unexpected.push({ url, method: init.method }); throw new Error("unexpected fixture request"); }
    let response = responses.shift();
    if (typeof response === "function") response = await response(url, init);
    if (response instanceof Error) throw response;
    return response instanceof Response ? response : Response.json(response);
  }
  const ports = { FormaElement, html, nothing, createMemoryDerivationClient, MemoryDerivationClientError, MEMORY_DERIVATION_CONTROL, MEMORY_DERIVATION_POLICY, createMemoryElapsed, DocumentProfileClientError, DOCUMENT_PROFILE_CONTROL_VERSION, DOCUMENT_PROFILE_POLICY, NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE, MemoryClientError, MEMORY_POLICY, MEMORY_TIMING, MEMORY_WRITE_CONTRACT, parseMemoryCustody, liveConversationDigest, memoryConsumptionWindows,
    personalMemoryMessage: localized ? personalMemoryMessage
      : (_locale, key, values = {}) => key + Object.values(values).map(value => ` [${value}]`).join(""),
    window: windowPort, document: documentPort, Date: FixtureDate, performance: { now: () => clock.monotonic },
    URL: { createObjectURL(blob) {
      assert.ok(blob instanceof Blob, "the actual export body is a real Blob");
      const url = "blob:synthetic-memory-export-" + ++downloadSequence; downloadUrls.set(url, blob); return url;
    }, revokeObjectURL(url) { assert.ok(downloadUrls.delete(url), "every fixture URL is revoked exactly once"); revokedDownloadUrls.push(url); } },
    // Only the actual client's explicit clock port is controlled. Ambient Date,
    // performance, transports and the production lease implementation are not replaced.
    createLiveMemoryClient: suppliedTransport => {
      assert.equal(typeof suppliedTransport, "function");
      const client = createLiveMemoryClient(suppliedTransport, () => ({ wall: clock.now, monotonic: clock.monotonic }));
      return { ...client, async recall(...args) {
        const lease = await client.recall(...args), receipt = { retireCalls: 0 };
        recallReceipts.push(receipt);
        // An observation-only wrapper around the actual client lease. Reading
        // this counter never invokes remaining(), a clock, or component.render().
        return Object.freeze({ value: lease.value, remaining: lease.remaining,
          retire() { receipt.retireCalls++; lease.retire(); } });
      } };
    },
    createDocumentProfileClient: suppliedTransport => {
      const client = createDocumentProfileClient(suppliedTransport, () => ({ wall: clock.now, monotonic: clock.monotonic }));
      return { ...client, async inspect(...args) {
        const lease = await client.inspect(...args), receipt = { retireCalls: 0 }; profileReceipts.push(receipt);
        return Object.freeze({ ...lease, retire() { receipt.retireCalls++; lease.retire(); } });
      } };
    },
    requestDialogConfirmation: async options => { dialogs.push(options);
      assert.equal(options.current(), true, "confirmation starts with current ownership");
      assert.equal(confirmations.length > 0, true, "each dialog requires an explicit fixture answer");
      const modal = { isConnected: true, fixtureDialog: true, closest: () => null }, openedAt = focusEpoch;
      dialogOpen = true; documentPort.activeElement = modal;
      try { return await confirmations.shift(); }
      finally {
        const ownsFocus = documentPort.activeElement === modal && focusEpoch === openedAt;
        dialogOpen = false; modal.isConnected = false;
        if (ownsFocus) {
          documentPort.activeElement = documentPort.body;
          const fresh = currentDialogInvoker(options);
          if (fresh) {
            // Model closing back to this same enabled invoker, not a replacement
            // node and not the stale disabled flag captured before the dialog.
            options.invoker.control = fresh; options.invoker.disabled = fresh.disabled;
            documentPort.activeElement = options.invoker; dialogRestorations.push(options.invoker);
          }
        }
      } },
    // Finite focus ownership port only. Native focus events, layout and the actual
    // captureOutputNavigationFocus implementation are not qualified by this fixture.
    captureOutputNavigationFocus(ownerDocument) {
      assert.equal(ownerDocument, documentPort); const captured = focusEpoch;
      const lease = { disposed: false,
        current: () => !lease.disposed && captured === focusEpoch && component.isConnected,
        run(target, action) { return lease.current() && target.isConnected && action() && lease.current(); },
        dispose() { lease.disposed = true; } };
      focusLeases.push(lease); return lease;
    },
    navigateInApp: async (origin, run) => { assert.equal(origin, component); run({ route: path => { navigations.push(path); return true; } }); return true; },
  };
  const Component = new Function(...Object.keys(ports), `${compiled}\nreturn FormaPersonalMemory;`)(...Object.values(ports));
  const component = new Component();
  const render = () => { renderCalls++; return component.render(); };
  const all = () => controls(render());
  function currentDialogInvoker(options) {
    const invoker = options.invoker;
    if (options.signal.aborted || !options.current() || !component.isConnected || !invoker?.isConnected
      || options.owner !== component || !component.contains(invoker) || invoker.closest("forma-personal-memory") !== component) return null;
    const identity = invoker.control.attributes.get("aria-label");
    if (typeof identity !== "string") return null;
    const matches = all().filter(control => control.tag === invoker.control.tag && control.attributes.get("aria-label") === identity);
    return matches.length === 1 && !matches[0].disabled && options.current() ? matches[0] : null;
  }
  function one(predicate, label) {
    const matches = all().filter(predicate); assert.equal(matches.length, 1, `one ${label}`); return matches[0];
  }
  const field = name => one(control => ["input", "select"].includes(control.tag) && control.attributes.get("name") === name, name);
  const action = key => one(control => ["button", "a"].includes(control.tag) && control.label === `memory.live.${key}`, key);
  const recallRegion = { fixtureOwner: component, isConnected: true, closest: name => name === "forma-personal-memory" ? component : null };
  const profileRegion = { fixtureOwner: component, isConnected: true, closest: name => name === "forma-personal-memory" ? component : null };
  const target = control => ({ fixtureOwner: component, isConnected: true, disabled: control.disabled, control,
    closest: name => name === "forma-personal-memory" ? component : name === ".personal-memory-excerpts" && control.inRecallSubtree ? recallRegion
      : name === "[data-memory-profile-view]" && control.inProfileSubtree ? profileRegion : null,
    checked: control.attributes.get(".checked"), value: control.attributes.get(".value"),
    matches(selector) {
      if (selector === '[data-memory-focus="heading"]') return control.attributes.get("data-memory-focus") === "heading";
      assert.equal(selector, ":disabled"); return this.disabled;
    },
    focus(options) { documentPort.activeElement = this; focusEvents.push({ control, options }); } });
  function queryControl(selector) {
    const parts = [...selector.matchAll(/\[([a-z-]+)="([^"]*)"\]/gu)];
    assert.ok(parts.length >= 1 && parts.length <= 2 && parts.map(part => part[0]).join("") === selector, `reviewed finite attribute selector: ${selector}`);
    const matches = all().filter(control => parts.every(part => control.attributes.get(part[1]) === part[2]));
    assert.ok(matches.length <= 1, "focus destinations are unambiguous within this fixture"); return matches.length ? target(matches[0]) : null;
  }
  function invoke(control, handlerName, extra = {}) {
    const handler = control.attributes.get(handlerName); assert.equal(typeof handler, "function");
    const event = { currentTarget: target(control), button: 0, preventDefault() { this.defaultPrevented = true; }, ...extra };
    // Direct callback probes during a modal are not native gestures and cannot
    // move focus out of the modal just because their handler is being tested.
    if (!dialogOpen) { focusEpoch++; documentPort.activeElement = event.currentTarget; }
    return { event, result: handler.call(component, event) };
  }
  function click(key, extra = {}) {
    const control = action(key); if (control.disabled) return false;
    return invoke(control, "@click", extra).result;
  }
  function change(name, value) {
    const control = field(name); if (control.disabled) return false;
    const input = target(control); input.value = value; input.checked = value === true;
    focusEpoch++; documentPort.activeElement = input;
    const handler = control.attributes.get("@change") ?? control.attributes.get("@input");
    assert.equal(typeof handler, "function"); handler.call(component, { currentTarget: input }); return true;
  }
  function move(patch, eventName) {
    if (Object.hasOwn(patch, "route")) state.route = patch.route;
    if (Object.hasOwn(patch, "actor")) { state.session = { ...state.session, user: { userId: patch.actor } }; state.authorization++; }
    if (Object.hasOwn(patch, "policy")) { state.session = { ...state.session, policy: { accepted: patch.policy } }; state.authorization++; }
    if (Object.hasOwn(patch, "organization")) { state.session = { ...state.session, projectContext: { organizationId: patch.organization } }; state.authorization++; }
    if (Object.hasOwn(patch, "project") || Object.hasOwn(patch, "document")) {
      state.projection = { ...state.projection, projectId: patch.project ?? state.projection.projectId, documentId: patch.document ?? state.projection.documentId };
      state.projection.documents = [fixtureDocument({ id: state.projection.documentId, projectId: state.projection.projectId, title: "Current fixture document" })]; state.source++;
    }
    if (patch.retireSource) state.source++;
    if (eventName) for (const callback of listeners.get(eventName) ?? []) callback();
    else for (const callback of subscriptions) callback();
  }
  function disconnect() { if (component.isConnected) { component.isConnected = false; component.disconnectedCallback(); } }
  async function select(documentId = "fixture-document", page = initial) {
    assert.equal(page instanceof Response, false, "selection requires a new explicitly supplied settings body");
    responses.push(page); assert.equal(change("memory-document", documentId), true); await flush();
    assert.equal(field("memory-document").attributes.get(".value"), documentId);
  }
  t.after(() => { disconnect(); assert.deepEqual(unexpected, [], "no unplanned HTTP requests or hidden automatic retries");
    assert.equal(subscriptions.size, 0); assert.ok([...listeners.values(), ...documentListeners.values()].every(values => values.size === 0));
    assert.equal(timers.size, 0, "the component releases every owned fixture timer");
    assert.ok(focusLeases.every(lease => lease.disposed), "component-owned focus ports are disposed");
    assert.equal(downloadUrls.size, 0, "no fixture Blob URL survives a request");
    assert.ok(downloadLinks.every(link => link.removed), "download anchors are removed even on failure"); });
  if (connected) component.connectedCallback(); else component.isConnected = false;
  return { component, store, state, calls, guardedCalls, dialogs, confirmations, navigations, render, all, field, action, target, invoke, click, change, move, disconnect, select,
    focusEvents, focusLeases, dialogRestorations, recallReceipts, profileReceipts, downloads, downloadUrls, revokedDownloadUrls, downloadLinks,
    failDownload() { throwDownload = true; }, renderCount: () => renderCalls,
    focused: () => documentPort.activeElement?.control ?? null,
    focus(control) { focusEpoch++; documentPort.activeElement = target(control); },
    stealFocus() { focusEpoch++; documentPort.activeElement = { isConnected: true, fixtureOutside: true, closest: () => null }; },
    setDialogOpen(value) { dialogOpen = value; },
    holdUpdates() { const boundary = deferred(); updateBoundary = boundary.promise; return boundary.resolve; },
    timers, clock, advance: milliseconds => { clock.now += milliseconds; clock.monotonic += milliseconds; },
    fireTimer(id = timers.keys().next().value) { const timer = timers.get(id); assert.ok(timer, "an owned timer exists"); timers.delete(id); timer.callback(); },
    notify() { for (const callback of subscriptions) callback(); },
    dispatchWindow(name, detail) { for (const callback of listeners.get(name) ?? []) callback({ detail }); },
    visibility(value = "visible") { documentPort.visibilityState = value; for (const callback of documentListeners.get("visibilitychange") ?? []) callback(); },
    enqueue: response => responses.push(response), text: () => templateText(render()),
    submit: () => invoke(one(control => control.tag === "form", "memory form"), "@submit").result,
    mutations: () => calls.filter(call => call.init.method !== "GET"),
    connect() { assert.equal(component.isConnected, false); component.isConnected = true; component.connectedCallback(); },
    windowPort, documentPort, DatePort: FixtureDate };
}
function chooseConsent(h) {
  h.change("memory-learn", true); h.change("memory-recall", true); h.change("memory-background", true);
  h.change("memory-consent", true);
}

// Actual assistant host + actual memory class. This extends the existing finite
// component ports; explicit commit() models mount/unmount, not a native DOM.
const hostPath = new URL("../src/components/forma-creative-assistant.ts", import.meta.url);
const hostBytes = readFileSync(hostPath);
const hostSource = ts.createSourceFile("forma-creative-assistant.ts", hostBytes.toString("utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const hostClass = hostSource.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FormaCreativeAssistant");
assert.ok(hostClass);
const hostCompiled = ts.transpileModule(hostClass.getText(hostSource).replace(/^export /u, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, useDefineForClassFields: false },
}).outputText;
before(() => { process.stdout.write(`# fixture-host-source ${JSON.stringify({ path: fileURLToPath(hostPath), bytes: hostBytes.length,
  sha256: createHash("sha256").update(hostBytes).digest("hex") })}\n`); });
function binding(root, name) {
  const matches = [];
  for (const template of templates(root)) template.strings.forEach((part, index) => {
    if (part.trimEnd().endsWith(name + "=")) matches.push(template.values[index]);
  });
  assert.equal(matches.length, 1, "one actual template binding " + name); return matches[0];
}
function hostFixture(t, options = {}) {
  const cleanup = [];
  const session = { ...personalSession(), capabilities: ["project.read", "project.author"],
    assistant: { enabled: true, phase: "guidance", capabilities: [] }, provider: { configured: false } };
  const h = fixture({ after: callback => cleanup.push(callback) }, {
    ...options, route: "/document/fixture-document/original", session, connected: false,
  });
  const assistantCalls = [], assistantResponses = [], assistantReads = [], assistantUnexpected = [], resolutions = [];
  const panel = { isConnected: true, open: false, draft: "", blocked: false,
    get navigationBlocked() { return this.blocked || Boolean(this.draft); },
    clearConversationDrafts() { this.draft = ""; },
    resolveGuidanceRequest(accepted, message) {
      resolutions.push({ accepted, message });
      if (accepted && this.draft === message) this.draft = "";
      else if (!accepted && !this.draft) this.draft = message;
    } };
  async function assistantTransport(input, init, responseQueue) {
    const url = new URL(input); assert.equal(url.origin, "https://forma.invalid"); assert.equal(url.pathname, "/api/assistant");
    const call = { url, init, body: init.body === undefined ? undefined : JSON.parse(init.body) }; assistantCalls.push(call);
    let response = responseQueue.shift();
    if (response === undefined && (init.method ?? "GET") === "GET") response = { context: null, turns: [], tasks: [] };
    if (response === undefined) { assistantUnexpected.push(call); throw new Error("unplanned assistant POST"); }
    if (typeof response === "function") response = await response(call);
    if (response instanceof Error) throw response;
    return response instanceof Response ? response : Response.json(response);
  }
  const memoryFetch = h.store.guardedFetch;
  h.store.guardedFetch = async (input, init, action, controls) => {
    if (!String(input).includes("/api/assistant")) return memoryFetch(input, init, action, controls);
    assert.equal(init.method, "POST");
    const current = () => {
      if (controls && !controls.current()) throw new Error("assistant fixture owner boundary");
    };
    current(); const response = await assistantTransport(input, init, assistantResponses); current(); return response;
  };
  const originalSourceActive = h.store.sourceOwnershipActive;
  h.state.sourceAvailable = true;
  Object.assign(h.store, {
    sourceOwnershipActive: source => h.state.sourceAvailable && originalSourceActive(source),
    sourceOwnershipScopeActive: source => source?.projectId === h.state.projection.projectId,
    routeDataReady: () => true, planningConsent: { get: () => null }, documentJobActive: () => false,
    adaptiveStructureFor: () => null, adaptiveSuggestionSetsFor: () => [],
  });
  h.documentPort.querySelectorAll = () => [];
  class HostElement {
    store = h.store; i18n = h.component.i18n; isConnected = true; ownerDocument = h.documentPort;
    connectedCallback() {}
    disconnectedCallback() {}
    requestUpdate() {}
    querySelector(selector) { return selector === "forma-assistant-panel" ? panel : null; }
    querySelectorAll(selector) {
      assert.equal(selector, "forma-personal-memory");
      return h.component.isConnected ? [h.component] : [];
    }
  }
  const ports = { FormaElement: HostElement, html, nothing, keyed, assistantInteractionForSurface, assistantSurfaceForRoute,
    personalMemoryMessage, parseMemoryAnswerPresentation, createMemoryElapsed, ASSISTANT_CONTEXT_LIMITS,
    Date: h.DatePort, performance: { now: () => h.clock.monotonic },
    document: h.documentPort, window: h.windowPort, location: { origin: "https://forma.invalid" },
    // Existing next-action computation is an explicit finite presentation port,
    // not a rewritten memory host or a claim to qualify that separate feature.
    nextActionFacts: () => ({ canRead: true }),
    creativeNextActions: () => [],
    renderLifecycleNextActionCards: () => html`<p data-existing-next-action>Existing next action</p>`,
    fetch: (input, init) => assistantTransport(input, init, assistantReads),
  };
  const Host = new Function(...Object.keys(ports), hostCompiled + "\nreturn FormaCreativeAssistant;")(...Object.values(ports));
  const host = new Host();
  const disclosure = { isConnected: true, open: false, closest: selector => selector === "forma-creative-assistant" ? host : null };
  const view = () => host.render();
  let mountedKey;
  function memoryKey(result) {
    for (const template of templates(result)) for (const value of template.values)
      if (value?._$litDirective$ === keyed("", null)._$litDirective$ && templateText(value).includes("<forma-personal-memory>")) return value.values[0];
    return undefined;
  }
  function commit() {
    const result = view(), mounted = templateText(result).includes("<forma-personal-memory>"), key = memoryKey(result);
    if (h.component.isConnected && mountedKey !== key) h.disconnect();
    if (mounted && !h.component.isConnected) h.connect();
    else if (!mounted && h.component.isConnected) h.disconnect();
    mountedKey = key;
    return result;
  }
  function assistant(open, commitNow = true) {
    panel.open = open; binding(view(), "@forma-assistant-toggle")({ detail: { open } });
    if (commitNow) commit();
  }
  function disclose(open, commitNow = true) {
    disclosure.open = open; binding(view(), "@toggle")({ currentTarget: disclosure });
    if (commitNow) commit();
  }
  host.connectedCallback();
  t.after(() => { host.isConnected = false; host.disconnectedCallback(); for (const callback of cleanup) callback();
    assert.deepEqual(assistantUnexpected, [], "no unplanned assistant writes"); });
  function recallControl() {
    const matches = controls(view()).filter(control => control.attributes.has("data-assistant-memory-recall"));
    assert.equal(matches.length, 1); return matches[0];
  }
  function recallRequest(control = recallControl(), disabled = control.disabled) {
    control.attributes.get("@click")({ currentTarget: { isConnected: true,
      closest: selector => selector === "forma-creative-assistant" ? host : null,
      matches: selector => { assert.equal(selector, ":disabled"); return disabled; } } });
  }
  return { ...h, host, view, commit, assistant, disclose, disclosure, assistantCalls, panel, resolutions,
    recallControl, recallRequest, assistantPost: value => assistantResponses.push(value), assistantGet: value => assistantReads.push(value),
    messages: () => binding(view(), ".messages"), context: () => binding(view(), ".context"), tasks: () => binding(view(), ".tasks"),
    send: detail => binding(view(), "@forma-assistant-message")({ detail }),
    recover: action => binding(view(), "@forma-assistant-guidance-recovery")({ detail: { action } }),
    specialist: detail => binding(view(), "@forma-assistant-specialist-review")({ detail }),
    delivery: () => binding(view(), ".guidanceDelivery"),
    memoryKey: () => memoryKey(view()),
    memoryMarkup: () => templateText(view()).includes("<forma-personal-memory>") };
}

test("assistant memory mount: explicit disclosure only; next actions and default-off consent stay intact", async t => {
  const h = hostFixture(t); h.commit(); await flush();
  assert.equal(h.calls.length, 0); assert.equal(h.memoryMarkup(), false);
  h.assistant(true); await flush();
  assert.ok(templateText(h.view()).includes("data-existing-next-action"));
  assert.ok(templateText(h.view()).includes("<summary>Personal memory</summary>"));
  assert.equal(h.calls.length, 0, "opening the assistant does not read memory settings");
  h.disclose(true); await flush(); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, "/api/memory/settings");
  await h.select();
  for (const field of ["memory-learn", "memory-recall", "memory-background", "memory-consent"])
    assert.equal(h.field(field).attributes.get(".checked"), false);
  assert.equal(h.mutations().length, 0); assert.equal(h.downloads.length, 0);
  assert.ok(h.calls.every(call => call.url === "/api/memory/settings"), "mount/selection never inspect, export or enroll");
});

test("assistant memory mount: close synchronously suspends stalled Inspect before unmount", async t => {
  const item = enrollment(), h = hostFixture(t, { initial: settings([item]) });
  h.assistant(true); h.disclose(true); await flush(); await h.select();
  const delayed = delayedJson(recall(item, "Never return after host close")); h.enqueue(delayed.response);
  const inspecting = h.click("inspect"); await flush(); const request = h.calls.at(-1);
  h.assistant(false, false);
  assert.equal(h.component.isConnected, true, "the component has not been removed by the simulated commit yet");
  assert.equal(h.component.render(), nothing, "the suspended renderer yields no presentation");
  assert.equal(request.init.signal.aborted, true); await flush();
  assert.equal(delayed.cancellations, 1); delayed.release(); await inspecting;
  h.commit(); h.assistant(true); await flush();
  assert.equal(h.memoryMarkup(), false); assert.equal(h.calls.length, 3, "reopening assistant does not reopen memory");
  h.enqueue(settings([item])); h.disclose(true); await flush();
  assert.equal(h.calls.length, 4); assert.equal(h.text().includes("Never return after host close"), false);
  assert.equal(h.mutations().length, 0);
});

test("assistant memory mount: closing the disclosure cancels export without requesting a download", async t => {
  const item = enrollment(), h = hostFixture(t, { initial: settings([item]) });
  h.assistant(true); h.disclose(true); await flush(); await h.select();
  const delayed = delayedJson(referenceExport(item, new Date(h.clock.now).toISOString())); h.enqueue(delayed.response);
  const exporting = h.click("export"); await flush(); const request = h.calls.at(-1);
  h.disclose(false, false);
  assert.equal(request.init.signal.aborted, true); assert.equal(h.component.render(), nothing);
  await flush(); assert.equal(delayed.cancellations, 1); delayed.release(); await exporting; h.commit();
  assert.equal(h.downloads.length, 0); assert.equal(h.memoryMarkup(), false);
});

test("assistant memory mount: hidden pages retire inspected bytes and require fresh disclosure", async t => {
  const item = enrollment(), h = hostFixture(t, { initial: settings([item]) });
  h.assistant(true); h.disclose(true); await flush(); await h.select();
  h.enqueue(recall(item, "Private host-owned excerpt")); await h.click("inspect");
  assert.ok(h.text().includes("Private host-owned excerpt"));
  h.visibility("hidden");
  assert.equal(h.component.render(), nothing); assert.ok(h.recallReceipts[0].retireCalls > 0);
  h.commit(); h.visibility("visible"); h.commit(); await flush();
  assert.equal(h.memoryMarkup(), false); assert.equal(h.calls.length, 3);
});

for (const change of ["route", "actor", "project", "source", "locale"]) {
  test("assistant memory mount: " + change + " change closes old scope without automatic memory recall", async t => {
    const item = enrollment(), h = hostFixture(t, { initial: settings([item]) });
    h.assistant(true); h.disclose(true); await flush(); await h.select();
    h.enqueue(recall(item, "Old scope private excerpt")); await h.click("inspect");
    if (change === "route") h.state.route = "/document/fixture-document/renamed";
    if (change === "actor") { h.state.session.user = { userId: "other-actor" }; h.state.authorization++; }
    if (change === "project") h.state.projection = { ...h.state.projection, projectId: "other-project" };
    if (change === "source") h.state.source++;
    if (change === "locale") { h.component.i18n.locale = "fr"; h.component.i18n.direction = "ltr"; }
    // The host's own store subscriber precedes the later child mount. Locale
    // changes are delivered through each element's normal render invalidation.
    if (change !== "locale") h.notify();
    h.commit(); await flush();
    assert.equal(h.memoryMarkup(), false); assert.equal(h.component.isConnected, false);
    assert.equal(h.calls.length, 3); assert.ok(h.recallReceipts[0].retireCalls > 0);
  });
}

test("assistant memory mount: current source denial synchronously closes controls", async t => {
  const item = enrollment(), h = hostFixture(t, { initial: settings([item]) });
  h.assistant(true); h.disclose(true); await flush(); await h.select();
  h.enqueue(recall(item, "Denied source private excerpt")); await h.click("inspect");
  const source = h.store.captureSourceOwnership(); h.state.sourceAvailable = false;
  h.dispatchWindow("forma-event-source-retired", { source, generation: source.generation, status: 403 });
  assert.equal(h.component.render(), nothing); h.commit(); await flush();
  assert.equal(h.calls.length, 3); assert.equal(templateText(h.view()).includes("data-assistant-memory"), false);
  h.state.sourceAvailable = true; h.notify(); h.commit();
  assert.equal(h.memoryMarkup(), false);
});

test("assistant memory mount: disabled backend is unavailable with no write or automatic Inspect", async t => {
  const h = hostFixture(t, { initial: settings([], { enabled: false }) });
  h.assistant(true); h.disclose(true); await flush(); await h.select();
  assert.ok(h.text().includes("memory.live.unavailable"));
  for (const field of ["memory-learn", "memory-recall", "memory-background", "memory-consent"]) assert.equal(h.field(field).disabled, true);
  assert.equal(h.mutations().length, 0); assert.equal(h.downloads.length, 0);
});

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("assistant memory mount: component-owned " + locale + " copy and direction without global registration", async t => {
    const h = hostFixture(t, { locale, localized: true }); h.assistant(true); h.disclose(true); await flush();
    assert.ok(templateText(h.view()).includes(FORMA_PERSONAL_MEMORY_MESSAGES[locale]["memory.live.heading"]));
    const body = h.text(); assert.ok(body.includes(FORMA_PERSONAL_MEMORY_MESSAGES[locale]["memory.live.intro"]));
    assert.ok(body.includes('dir=' + (locale === "ar" ? "rtl" : "ltr")));
    assert.equal(body.includes("memory.live."), false);
    assert.equal(personalMemoryMessage(locale + "-XX", "memory.live.heading"), FORMA_PERSONAL_MEMORY_MESSAGES[locale]["memory.live.heading"]);
    assert.equal(personalMemoryMessage(locale, "memory.live.activityWindow", { days: 7 }).includes("{days}"), false);
  });
}

test("assistant memory mount: stale disclosure callbacks cannot mount after closure or scope change", async t => {
  const h = hostFixture(t); h.assistant(true);
  const stale = binding(h.view(), "@toggle");
  h.assistant(false); h.disclosure.open = true; stale({ currentTarget: h.disclosure }); h.commit();
  assert.equal(h.calls.length, 0); assert.equal(h.memoryMarkup(), false);
  h.assistant(true); const previous = binding(h.view(), "@toggle"); h.state.source++; h.disclosure.open = true;
  previous({ currentTarget: h.disclosure }); h.commit();
  assert.equal(h.calls.length, 0); assert.equal(h.memoryMarkup(), false);
});

test("assistant memory mount: close/reopen before an intervening commit still creates a fresh lifetime", async t => {
  const item = enrollment(), h = hostFixture(t, { initial: settings([item]) });
  h.assistant(true); h.disclose(true); await flush(); await h.select();
  h.enqueue(recall(item, "Previous mounted lifetime")); await h.click("inspect");
  const previousKey = h.memoryKey();
  h.disclose(false, false); assert.equal(h.component.render(), nothing);
  h.disclose(true, false);
  assert.notEqual(h.memoryKey(), previousKey, "the existing keyed composition requires a new child instance");
  h.enqueue(settings([item])); h.commit(); await flush();
  assert.equal(h.calls.length, 4); assert.equal(h.text().includes("Previous mounted lifetime"), false);
  assert.equal(h.field("memory-document").attributes.get(".value"), "", "reopened lifetime requires explicit document selection");
});

// These are consumer-host request/lifetime fixtures, not native DOM or backend tests.
function answerDescriptor(h, horizon = 60_000) {
  return { version: "native-memory-answer-v1", method: "extractive-not-semantic",
    checkedAt: new Date(h.clock.now).toISOString(), validUntil: new Date(h.clock.now + horizon).toISOString() };
}
function answerPayload(h, call, marker = "Bounded private memory answer", overrides = {}) {
  const id = call.body.turnId;
  return { context: { recentTurns: [{ id: id + ":user", text: call.body.message }, { id: id + ":assistant", text: marker }] },
    turn: { id, user: call.body.message, reply: { text: marker }, proposal: null, memory: answerDescriptor(h), ...overrides } };
}
const ordinaryTurn = () => ({ id: "ordinary-turn", user: "Ordinary request", reply: { text: "Ordinary answer" }, proposal: null,
  originalRequest: { schema: 1, turnId: "ordinary-turn", projectId: "fixture-project", documentId: "fixture-document",
    canvasId: null, route: "/document/fixture-document/original", selectedItemIds: [] } });
async function openRecall(h) { h.assistant(true); await flush(); h.disclose(true); await flush(); }
const assistantPosts = h => h.assistantCalls.filter(call => call.init.method === "POST");
const hostText = h => JSON.stringify(h.messages());

test("assistant recall: disclosures never POST; separate native button requests only explicit recall", async t => {
  const h = hostFixture(t); await openRecall(h);
  assert.equal(assistantPosts(h).length, 0);
  assert.equal(h.recallControl().tag, "button"); assert.equal(h.recallControl().attributes.get("type"), "button");
  assert.ok(h.recallControl().label); assert.equal(h.recallControl().disabled, false);
  h.disclose(false); h.enqueue(settings()); h.disclose(true); await flush();
  assert.equal(assistantPosts(h).length, 0, "reopening disclosure is not recall consent");
  h.assistantPost(call => answerPayload(h, call)); h.recallRequest(); await flush();
  const [request] = assistantPosts(h);
  assert.deepEqual(Object.keys(request.body).sort(), ["locale", "memoryMode", "message", "turnId"]);
  assert.equal(request.body.memoryMode, "recall"); assert.equal(request.body.locale, "en");
  assert.equal(request.body.message, personalMemoryMessage("en", "memory.live.assistantRecallPrompt"));
  assert.equal(request.init.signal.aborted, false);
  const reply = h.messages().find(message => message.role === "assistant");
  assert.ok(reply.text.includes("historical excerpts")); assert.ok(reply.text.includes("Bounded private memory answer"));
  assert.equal(reply.canReviewSpecialist, false); assert.deepEqual(binding(h.view(), ".proposals"), []);
  assert.deepEqual(h.context().recentTurns, [], "memory answers never enter ordinary context presentation");
  assert.equal(h.resolutions.length, 0); assert.equal(h.mutations().length, 0); assert.equal(h.downloads.length, 0);
  assert.ok(h.calls.every(call => call.url === "/api/memory/settings"));
});

test("assistant recall: inherited fieldset/draft disabling cannot be bypassed by a stale callback", async t => {
  const h = hostFixture(t); await openRecall(h); const enabled = h.recallControl();
  h.panel.draft = "Keep my unsent ordinary request";
  assert.equal(h.recallControl().disabled, true);
  h.recallRequest(enabled, false); assert.equal(assistantPosts(h).length, 0);
  h.panel.draft = ""; h.recallRequest(enabled, true); assert.equal(assistantPosts(h).length, 0, "native inherited disabled state is also checked");
  h.panel.blocked = true; h.recallRequest(enabled, false); assert.equal(assistantPosts(h).length, 0);
  assert.equal(h.resolutions.length, 0);
});

for (const draft of ["A newer ordinary draft", personalMemoryMessage("en", "memory.live.assistantRecallPrompt")]) {
  test("assistant recall: successful delivery preserves newer draft " + JSON.stringify(draft), async t => {
    const h = hostFixture(t); await openRecall(h); const gate = deferred(); let request;
    h.assistantPost(async call => { request = call; return gate.promise; }); h.recallRequest(); await flush();
    h.panel.draft = draft; gate.resolve(answerPayload(h, request)); await flush();
    assert.equal(h.panel.draft, draft); assert.equal(h.resolutions.length, 0); assert.equal(h.delivery(), "");
    h.advance(60_000); h.dispatchWindow("focus");
    assert.equal(hostText(h).includes("Bounded private memory answer"), false); assert.equal(h.panel.draft, draft);
    h.disclose(false); h.enqueue(settings()); h.disclose(true); await flush();
    assert.equal(h.panel.draft, draft); assert.equal(assistantPosts(h).length, 1);
  });
}

test("assistant recall: explicit retry retains request identity, mode, locale and original prompt", async t => {
  const h = hostFixture(t, { locale: "fr" }); await openRecall(h);
  h.assistantPost(new Error("synthetic response loss")); h.recallRequest(); await flush();
  assert.equal(h.delivery(), "uncertain"); assert.equal(h.resolutions.length, 0);
  const first = assistantPosts(h)[0]; h.panel.draft = "Newer draft after uncertain response";
  h.assistantPost(call => answerPayload(h, call)); h.recover("retry"); await flush();
  const second = assistantPosts(h)[1]; assert.deepEqual(second.body, first.body); assert.equal(first.body.memoryMode, "recall");
  assert.equal(first.body.locale, "fr"); assert.equal(h.panel.draft, "Newer draft after uncertain response");
  assert.equal(h.delivery(), ""); assert.equal(h.resolutions.length, 0);
});

test("assistant recall: ordinary send omits mode even if an event supplies it; original composer ownership is unchanged", async t => {
  const h = hostFixture(t); await openRecall(h); h.panel.draft = "Ordinary draft";
  h.assistantPost(call => ({ context: null, turn: { id: call.body.turnId, user: call.body.message, reply: { text: "Ordinary reply" }, proposal: null } }));
  h.send({ message: "Ordinary draft", memoryMode: "recall" }); await flush();
  assert.equal(Object.hasOwn(assistantPosts(h)[0].body, "memoryMode"), false);
  assert.equal(h.panel.draft, ""); assert.deepEqual(h.resolutions, [{ accepted: true, message: "Ordinary draft" }]);
  assert.ok(hostText(h).includes("Ordinary reply"));
});

const invalidAnswers = {
  missing: () => undefined, unknownKey: h => ({ ...answerDescriptor(h), sourceId: "must-not-pass" }),
  wrongVersion: h => ({ ...answerDescriptor(h), version: "unknown" }), wrongMethod: h => ({ ...answerDescriptor(h), method: "semantic" }),
  invalidIso: h => ({ ...answerDescriptor(h), checkedAt: new Date(h.clock.now).toISOString().replace(".000Z", "Z") + "bad" }),
  futureChecked: h => ({ ...answerDescriptor(h), checkedAt: new Date(h.clock.now + 1).toISOString() }),
  expired: h => ({ ...answerDescriptor(h), validUntil: new Date(h.clock.now).toISOString() }),
  overHorizon: h => answerDescriptor(h, 60_001), null: () => null,
};
for (const [name, value] of Object.entries(invalidAnswers)) {
  test("assistant recall: invalid " + name + " descriptor retires bytes and cannot resurrect from later history", async t => {
    const h = hostFixture(t); await openRecall(h); let call;
    h.assistantPost(request => { call = request; const result = answerPayload(h, request, "Rejected private bytes", { memory: value(h) });
      if (name === "missing") delete result.turn.memory; return result; });
    h.recallRequest(); h.panel.draft = "New unsent work"; await flush();
    assert.equal(hostText(h).includes("Rejected private bytes"), false); assert.equal(h.delivery(), "");
    assert.equal(h.panel.draft, "New unsent work"); assert.equal(h.resolutions.length, 0);
    h.assistantGet({ ...answerPayload(h, call), turns: [answerPayload(h, call).turn], tasks: [] }); h.recover("check"); await flush();
    assert.equal(hostText(h).includes("Bounded private memory answer"), false);
    assert.equal(JSON.stringify(h.context()).includes("Rejected private bytes"), false);
  });
}

for (const contamination of ["originalRequest", "proposal", "proposals"]) {
  test("assistant recall: " + contamination + " cannot convert a marked reply into specialist/action authority", async t => {
    const h = hostFixture(t); h.state.session.capabilities.push("project.output.request"); await openRecall(h);
    let call; h.assistantPost(request => { call = request; return answerPayload(h, request, "Rejected actionable memory", {
      [contamination]: contamination === "proposals" ? [{ id: "unsafe", turnId: request.body.turnId }]
        : contamination === "proposal" ? { id: "unsafe", turnId: request.body.turnId } : ordinaryTurn().originalRequest }); });
    h.recallRequest(); await flush(); assert.equal(hostText(h).includes("Rejected actionable memory"), false);
    h.specialist({ turnId: call.body.turnId }); await flush();
    assert.equal(assistantPosts(h).length, 1); assert.deepEqual(binding(h.view(), ".proposals"), []);
  });
}

test("assistant recall: deadline removes only memory while ordinary transcript, tasks and specialist eligibility remain", async t => {
  const h = hostFixture(t); h.state.session.capabilities.push("project.output.request");
  const task = { id: "ordinary-task", turnId: "ordinary-turn", status: "completed" };
  h.assistantGet({ context: null, turns: [ordinaryTurn()], tasks: [task] }); await openRecall(h);
  assert.equal(h.messages().find(message => message.savedTurnId === "ordinary-turn").canReviewSpecialist, true);
  h.assistantPost(call => answerPayload(h, call)); h.recallRequest(); await flush();
  const pendingTimer = [...h.timers].find(([, timer]) => timer.delay === 60_000); assert.ok(pendingTimer);
  h.advance(60_000); h.fireTimer(pendingTimer[0]);
  assert.equal(hostText(h).includes("Bounded private memory answer"), false); assert.ok(hostText(h).includes("Ordinary answer"));
  assert.deepEqual(h.tasks(), [task]); assert.equal(h.resolutions.length, 0);
  const call = assistantPosts(h)[0]; h.assistantGet({ context: null, turns: [ordinaryTurn(), answerPayload(h, call, "Late renewed answer").turn], tasks: [task] });
  h.recover("check"); await flush(); assert.equal(hostText(h).includes("Late renewed answer"), false);
  assert.equal(h.messages().find(message => message.savedTurnId === "ordinary-turn").canReviewSpecialist, true);
});

for (const invalidation of ["hidden", "disclosure", "assistant", "source", "locale", "wallRollback", "monotonicRollback", "elapsed"]) {
  test("assistant recall: " + invalidation + " retires the display before any late positive can return", async t => {
    const h = hostFixture(t); await openRecall(h); let call;
    h.assistantPost(request => { call = request; return answerPayload(h, request); }); h.recallRequest(); await flush();
    assert.ok(hostText(h).includes("Bounded private memory answer")); h.panel.draft = "Keep later draft";
    if (invalidation === "hidden") h.visibility("hidden");
    if (invalidation === "disclosure") h.disclose(false, false);
    if (invalidation === "assistant") h.assistant(false, false);
    if (invalidation === "source") { h.state.source++; h.notify(); }
    if (invalidation === "locale") { h.component.i18n.locale = "ja"; h.commit(); }
    if (invalidation === "wallRollback") h.clock.now--;
    if (invalidation === "monotonicRollback") h.clock.monotonic--;
    if (invalidation === "elapsed") h.clock.monotonic += 60_000;
    h.dispatchWindow("focus");
    assert.equal(hostText(h).includes("Bounded private memory answer"), false);
    assert.equal(call.init.signal.aborted, true); assert.equal(h.resolutions.length, 0);
    assert.equal(h.panel.draft, "Keep later draft");
    if (invalidation === "hidden") h.visibility("visible");
    h.assistantGet({ context: null, turns: [answerPayload(h, call, "Late positive private answer").turn], tasks: [] });
    h.recover("check"); await flush(); assert.equal(hostText(h).includes("Late positive private answer"), false);
  });
}

test("assistant recall: active background history cannot renew the original descriptor or replace text", async t => {
  const h = hostFixture(t); await openRecall(h); let call;
  h.assistantPost(request => { call = request; return answerPayload(h, request); }); h.recallRequest(); await flush();
  h.advance(30_000);
  h.assistantGet({ context: null, turns: [answerPayload(h, call, "A newer historical copy").turn], tasks: [] }); h.recover("check"); await flush();
  assert.ok(hostText(h).includes("Bounded private memory answer")); assert.equal(hostText(h).includes("A newer historical copy"), false);
  h.advance(30_000); h.dispatchWindow("focus"); assert.equal(hostText(h).includes("Bounded private memory answer"), false);
});

test("assistant recall: marked GET is hidden without an explicit request and cannot be downgraded to ordinary", async t => {
  const h = hostFixture(t); const call = { body: { turnId: "unsolicited-memory", message: "No user request" } };
  h.assistantGet({ context: null, turns: [answerPayload(h, call).turn], tasks: [] }); await openRecall(h);
  assert.equal(h.messages().length, 0); assert.equal(assistantPosts(h).length, 0);
  const downgraded = answerPayload(h, call).turn; delete downgraded.memory;
  h.assistantGet({ context: null, turns: [downgraded], tasks: [] }); h.recover("check"); await flush();
  assert.equal(h.messages().length, 0);
});

test("assistant recall: even an exact task recovery entry cannot start specialist work for a marked turn", async t => {
  const h = hostFixture(t); h.state.session.capabilities.push("project.output.request"); await openRecall(h);
  let call; h.assistantPost(request => { call = request; return answerPayload(h, request); }); h.recallRequest(); await flush();
  const task = { id: "marked-task", turnId: call.body.turnId, executionId: "marked-execution", status: "completed" };
  h.assistantGet({ context: null, turns: [answerPayload(h, call).turn], tasks: [task] }); h.recover("check"); await flush();
  h.specialist({ turnId: call.body.turnId, task }); await flush();
  assert.equal(binding(h.view(), ".specialist"), null); assert.equal(assistantPosts(h).length, 1);
});

test("assistant recall: closing pending request aborts ownership; a delayed POST cannot restore it", async t => {
  const h = hostFixture(t); await openRecall(h); const gate = deferred(); let call;
  h.assistantPost(async request => { call = request; return gate.promise; }); h.recallRequest(); await flush();
  h.panel.draft = "Draft while recall pending"; h.disclose(false); assert.equal(call.init.signal.aborted, true);
  h.enqueue(settings()); h.disclose(true); await flush();
  gate.resolve(answerPayload(h, call)); await flush();
  assert.equal(hostText(h).includes("Bounded private memory answer"), false); assert.equal(h.delivery(), "");
  assert.equal(h.panel.draft, "Draft while recall pending"); assert.equal(h.resolutions.length, 0);
});

test("assistant recall: exact pending GET may acknowledge, but a late terminal negative still removes that answer", async t => {
  const h = hostFixture(t); await openRecall(h); const gate = deferred(); let call;
  h.assistantPost(async request => { call = request; return gate.promise; }); h.recallRequest(); await flush();
  h.panel.draft = "Newer draft must survive either receipt";
  h.assistantGet({ context: null, turns: [answerPayload(h, call).turn], tasks: [] }); h.recover("check"); await flush();
  assert.ok(hostText(h).includes("Bounded private memory answer")); assert.equal(h.delivery(), "");
  gate.resolve(Response.json({ error: "assistant_turn_unavailable", noAutomaticRetry: true, messageNotSaved: false }, { status: 409 })); await flush();
  assert.equal(hostText(h).includes("Bounded private memory answer"), false); assert.equal(h.panel.draft, "Newer draft must survive either receipt");
  assert.equal(h.resolutions.length, 0);
});

test("assistant recall: an acknowledged GET can be closed while its POST still hangs without blocking fresh explicit recall", async t => {
  const h = hostFixture(t); await openRecall(h); const gate = deferred(); let old;
  h.assistantPost(async request => { old = request; return gate.promise; }); h.recallRequest(); await flush();
  h.assistantGet({ context: null, turns: [answerPayload(h, old).turn], tasks: [] }); h.recover("check"); await flush();
  h.disclose(false); h.enqueue(settings()); h.disclose(true); await flush();
  assert.equal(binding(h.view(), ".pending"), 0); assert.equal(h.recallControl().disabled, false);
  h.assistantPost(call => answerPayload(h, call, "Fresh explicitly requested reply")); h.recallRequest(); await flush();
  assert.notEqual(assistantPosts(h)[1].body.turnId, old.body.turnId);
  gate.resolve(answerPayload(h, old, "Old private reply")); await flush();
  assert.ok(hostText(h).includes("Fresh explicitly requested reply")); assert.equal(hostText(h).includes("Old private reply"), false);
});

for (const status of [400, 401, 403, 404, 409, 410]) {
  test("assistant recall: terminal HTTP " + status + " preserves newer draft without ordinary composer resolution", async t => {
    const h = hostFixture(t); await openRecall(h);
    h.assistantPost(Response.json({ error: "unavailable" }, { status })); h.recallRequest(); h.panel.draft = "After dispatch"; await flush();
    assert.equal(h.delivery(), ""); assert.equal(h.panel.draft, "After dispatch"); assert.equal(h.resolutions.length, 0);
    assert.equal(h.messages().length, 0);
  });
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("assistant recall: complete " + locale + " owned copy and placeholder parity", async t => {
    const keys = Object.keys(FORMA_PERSONAL_MEMORY_MESSAGES.en).filter(key => key.startsWith("memory.live.assistantRecall"));
    for (const key of keys) {
      const value = FORMA_PERSONAL_MEMORY_MESSAGES[locale][key]; assert.equal(typeof value, "string"); assert.ok(value.length);
      assert.deepEqual(value.match(/\{\w+\}/gu) ?? [], FORMA_PERSONAL_MEMORY_MESSAGES.en[key].match(/\{\w+\}/gu) ?? []);
    }
    const h = hostFixture(t, { locale, localized: true }); await openRecall(h);
    h.assistantPost(call => answerPayload(h, call)); h.recallRequest(); await flush();
    assert.equal(assistantPosts(h)[0].body.message, FORMA_PERSONAL_MEMORY_MESSAGES[locale]["memory.live.assistantRecallPrompt"]);
    assert.ok(hostText(h).includes(FORMA_PERSONAL_MEMORY_MESSAGES[locale]["memory.live.assistantRecallHistorical"]));
    assert.equal(templateText(h.view()).includes("{until}"), false);
  });
}

test("reference export UI: click-only bounded file preserves an inspected view and cleans download handles", async t => {
  const item = enrollment(), h = fixture(t, { initial: settings([item]) }); await flush(); await h.select();
  assert.equal(h.calls.length, 2); assert.equal(h.downloads.length, 0);
  h.enqueue(recall(item, "Keep the existing inspected excerpt")); await h.click("inspect"); await flush();
  const body = referenceExport(item, new Date(h.clock.now).toISOString()); h.enqueue(body);
  await h.click("export"); await flush();
  const call = h.calls.at(-1);
  assert.equal(call.url, "/api/memory/export?id=" + item.id + "&revision=" + item.revision);
  assert.equal(call.init.method, "GET"); assert.equal(call.init.cache, "no-store"); assert.equal(call.init.credentials, "same-origin");
  assert.equal(h.downloads.length, 1); assert.equal(h.downloads[0].filename, "forma-memory-references.json");
  assert.equal(h.downloads[0].rel, "noopener"); assert.ok(h.downloads[0].blob.size <= 65_536);
  const text = await h.downloads[0].blob.text(); assert.deepEqual(JSON.parse(text), body);
  assert.equal(text.includes("Keep the existing inspected excerpt"), false);
  assert.ok(h.text().includes("Keep the existing inspected excerpt"));
  assert.ok(h.text().includes("memory.live.exportRequested")); assert.equal(h.revokedDownloadUrls.length, 1);
  assert.equal(h.downloadUrls.size, 0); assert.equal(h.mutations().length, 0);
});

test("reference export UI: editing cancels a stalled export without replacing the draft or inspection", async t => {
  const item = enrollment(), h = fixture(t, { initial: settings([item]) }); await flush(); await h.select();
  h.enqueue(recall(item, "Retained inspection during editing")); await h.click("inspect");
  const delayed = delayedJson(referenceExport(item, new Date(h.clock.now).toISOString())); h.enqueue(delayed.response);
  const exporting = h.click("export"); await flush(); const request = h.calls.at(-1);
  assert.equal(h.action("export").disabled, true); assert.equal(h.field("memory-retention").disabled, false);
  assert.equal(h.change("memory-retention", "17"), true); await flush();
  assert.equal(request.init.signal.aborted, true); assert.equal(delayed.cancellations, 1);
  assert.equal(h.field("memory-retention").attributes.get(".value"), "17");
  assert.ok(h.text().includes("Retained inspection during editing")); assert.equal(h.action("export").disabled, true);
  assert.equal(delayed.release(), "cancelled"); await exporting; await flush();
  assert.equal(h.downloads.length, 0); assert.equal(h.calls.length, 4); assert.equal(h.mutations().length, 0);
});

test("reference export UI: a newer Inspect retires a stalled export and remains authoritative", async t => {
  const item = enrollment(), h = fixture(t, { initial: settings([item]) }); await flush(); await h.select();
  const delayed = delayedJson(referenceExport(item, new Date(h.clock.now).toISOString())); h.enqueue(delayed.response);
  const exporting = h.click("export"); await flush();
  h.enqueue(recall(item, "Newer inspection survives")); await h.click("inspect"); await flush();
  assert.equal(delayed.cancellations, 1); assert.equal(delayed.release(), "cancelled"); await exporting;
  assert.ok(h.text().includes("Newer inspection survives")); assert.equal(h.downloads.length, 0);
  assert.equal(h.calls.filter(call => call.url.startsWith("/api/memory/export")).length, 1);
});

test("reference export UI: explicit settings refresh retires an old revision without replacing newer settings", async t => {
  const item = enrollment(), h = fixture(t, { initial: settings([item]) }); await flush(); await h.select();
  const staleButton = h.action("export"), delayed = delayedJson(referenceExport(item, new Date(h.clock.now).toISOString())); h.enqueue(delayed.response);
  const exporting = h.click("export"); await flush();
  await h.invoke(staleButton, "@click").result;
  assert.equal(h.calls.filter(call => call.url.startsWith("/api/memory/export")).length, 1, "a captured enabled button cannot duplicate the active request");
  const newer = { ...item, revision: 2, retentionDays: 17 }; h.enqueue(settings([newer])); await h.click("reload"); await flush();
  assert.equal(delayed.cancellations, 1); delayed.release(); await exporting;
  assert.equal(h.field("memory-retention").attributes.get(".value"), "17"); assert.equal(h.downloads.length, 0);
  h.enqueue(referenceExport(newer, new Date(h.clock.now).toISOString())); await h.click("export");
  assert.equal(h.calls.at(-1).url, "/api/memory/export?id=" + item.id + "&revision=2"); assert.equal(h.downloads.length, 1);
});

for (const transition of ["actor", "route", "source", "events", "content"]) test("reference export UI: changed " + transition + " prevents a late download", async t => {
  const item = enrollment(), h = fixture(t, { initial: settings([item]) }); await flush(); await h.select();
  const delayed = delayedJson(referenceExport(item, new Date(h.clock.now).toISOString())); h.enqueue(delayed.response);
  const exporting = h.click("export"); await flush(); const request = h.calls.at(-1);
  if (transition === "events" || transition === "content") { h.state[transition] = transition === "events" ? [] : {}; h.notify(); }
  else {
    h.enqueue(settings([item]));
    h.move(transition === "actor" ? { actor: "different-actor" } : transition === "route" ? { route: "/different-page" } : { retireSource: true });
  }
  await flush(); assert.equal(request.init.signal.aborted, true); assert.equal(delayed.cancellations, 1);
  delayed.release(); await exporting; assert.equal(h.downloads.length, 0); assert.equal(h.mutations().length, 0);
});

for (const transition of ["hidden", "expired", "disconnect"]) test("reference export UI: " + transition + " retires a pending body without downloading", async t => {
  const item = enrollment({ expiresAt: new Date(Date.now() + 20_000).toISOString() }), h = fixture(t, { initial: settings([item]) }); await flush(); await h.select();
  const delayed = delayedJson(referenceExport(item, new Date(h.clock.now).toISOString())); h.enqueue(delayed.response);
  const exporting = h.click("export"); await flush(); const request = h.calls.at(-1), count = h.calls.length;
  if (transition === "hidden") h.visibility("hidden");
  else if (transition === "disconnect") h.disconnect();
  else { h.advance(25_000); h.fireTimer(); }
  await flush(); assert.equal(request.init.signal.aborted, true); assert.equal(delayed.cancellations, 1);
  delayed.release(); await exporting; assert.equal(h.downloads.length, 0); assert.equal(h.calls.length, count);
});

for (const status of [403, 409, 503]) test("reference export UI: " + status + " fails safely without clearing choices or retrying", async t => {
  const item = enrollment(), h = fixture(t, { initial: settings([item]) }); await flush(); await h.select();
  h.enqueue(recall(item, "Previous eligible inspection")); await h.click("inspect");
  const before = h.field("memory-retention").attributes.get(".value"), count = h.calls.length;
  h.enqueue(Response.json({ error: status === 409 ? "memory_revision_changed" : status === 403 ? "memory_export_unavailable" : "memory_schema_unavailable" }, { status }));
  await h.click("export"); await flush();
  assert.equal(h.downloads.length, 0); assert.equal(h.calls.length, count + 1); assert.equal(h.mutations().length, 0);
  assert.equal(h.field("memory-retention").attributes.get(".value"), before);
  assert.ok(h.text().includes("memory.live." + (status === 409 ? "exportChanged" : status === 403 ? "exportDenied" : "exportFailed")));
  assert.equal(h.text().includes("Previous eligible inspection"), status === 503, "denial/conflict retires only the still-owned old view");
  const newer = { ...item, revision: 2 }; h.enqueue(settings([newer])); await h.click("reload"); await flush();
  assert.equal(h.text().includes("memory.live.exportChanged"), false);
  assert.equal(h.text().includes("memory.live.exportDenied"), false);
  assert.equal(h.text().includes("memory.live.exportFailed"), false);
  assert.equal(h.action("export").disabled, false, "explicit successful refresh restores the export control without a stale alert");
  assert.equal(h.calls.length, count + 2); assert.equal(h.downloads.length, 0); assert.equal(h.mutations().length, 0);
});

test("reference export UI: malformed private fields and failed download both leave no live URL", async t => {
  const item = enrollment(), h = fixture(t, { initial: settings([item]) }); await flush(); await h.select();
  h.enqueue({ ...referenceExport(item, new Date(h.clock.now).toISOString()), privateText: "MUST_NOT_DOWNLOAD" });
  await h.click("export"); assert.equal(h.downloads.length, 0); assert.equal(h.revokedDownloadUrls.length, 0);
  h.enqueue(referenceExport(item, new Date(h.clock.now).toISOString())); h.failDownload(); await h.click("export");
  assert.equal(h.downloads.length, 0); assert.equal(h.revokedDownloadUrls.length, 1); assert.equal(h.downloadUrls.size, 0);
  assert.ok(h.text().includes("memory.live.exportFailed")); assert.equal(h.text().includes("MUST_NOT_DOWNLOAD"), false);
});

for (const locale of ["en", "fr", "ar", "ja"]) test("reference export UI: explicit localized control and scope warnings in " + locale, async t => {
  const item = enrollment(), h = fixture(t, { initial: settings([item]), locale, localized: true }); await flush();
  h.enqueue(settings([item])); assert.equal(h.change("memory-document", item.documentId), true); await flush();
  const messages = FORMA_PERSONAL_MEMORY_MESSAGES[locale], control = h.all().find(control => control.attributes.get("data-memory-action") === "export");
  assert.ok(control && !control.disabled); assert.equal(control.label, messages["memory.live.export"]);
  assert.ok(h.text().includes(messages["memory.live.exportHelp"]));
  h.enqueue(referenceExport(item, new Date(h.clock.now).toISOString())); await h.invoke(control, "@click").result;
  assert.ok(h.text().includes(messages["memory.live.exportRequested"])); assert.equal(h.downloads.length, 1);
});

test("mounting and unchecked consent never enroll; edits themselves never PUT", async t => {
  const h = fixture(t); await flush();
  assert.deepEqual(h.calls.map(call => call.init.method), ["GET"]);
  assert.equal(h.field("memory-document").attributes.get(".value"), "");
  assert.equal(h.all().some(control => control.tag === "form"), false, "recent active document is not implicitly selected");
  await h.select(); assert.deepEqual(h.calls.map(call => call.init.method), ["GET", "GET"]);
  for (const name of ["memory-learn", "memory-recall", "memory-background", "memory-consent"])
    assert.equal(h.field(name).attributes.get(".checked"), false);
  await h.submit(); assert.equal(h.mutations().length, 0);
  chooseConsent(h); assert.equal(h.action("save").disabled, false);
  assert.equal(h.mutations().length, 0, "consent is submitted only by the explicit form action");
});

test("rollout-off and schema-unavailable are not represented as activation", async t => {
  const h = fixture(t, { initial: settings([], { enabled: false }) }); await flush();
  await h.select();
  assert.ok(h.text().includes("memory.live.unavailable")); assert.equal(h.field("memory-consent").disabled, true);
  await h.submit(); assert.equal(h.mutations().length, 0);
  h.enqueue(Response.json({ error: "memory_schema_unavailable" }, { status: 503 })); h.click("reload"); await flush();
  assert.ok(h.text().includes("memory.live.schemaUnavailable")); assert.equal(h.all().some(control => control.tag === "form"), false);
  assert.equal(h.component.captureCommandDeparture().blocked(), false, "read failures do not trap navigation");
  h.enqueue(settings([], { enabled: false })); h.click("reload"); await flush();
  assert.ok(h.text().includes("memory.live.unavailable")); assert.equal(h.mutations().length, 0);
});

test("explicit save sends exact V2 scope, revision, choices and timing once then refreshes", async t => {
  const h = fixture(t); await flush(); await h.select();
  const expiry = future(20).slice(0, 10);
  chooseConsent(h); h.change("memory-retention", "45"); h.change("memory-expiry", expiry);
  h.change("memory-timezone", "America/New_York"); h.change("memory-consent", true);
  let acknowledgement;
  h.enqueue((_url, init) => { acknowledgement = saved(JSON.parse(init.body)); return acknowledgement; });
  h.enqueue(() => settings([acknowledgement.enrollment]));
  await h.submit(); await flush();
  assert.deepEqual(h.calls.map(call => call.init.method), ["GET", "GET", "PUT", "GET"]);
  assert.deepEqual(h.mutations()[0].body, { projectId: "fixture-project", documentId: "fixture-document", learn: true, recall: true,
    background: true, retentionDays: 45, expiresAt: expiry + "T23:59:59.000Z", timeZone: "America/New_York", revision: 0,
    confirmation: "ENABLE_PERSONAL_MEMORY", policyVersion: "personal-memory-v2", reviewTiming: "daily-with-daytime-catch-up", expectedCustody: { kind: "personal" } });
  assert.equal(h.field("memory-consent").attributes.get(".checked"), false);
  assert.ok(h.text().includes("memory.live.savedMessage")); assert.ok(h.text().includes("memory.live.waiting"));
});

test("any changed preference clears consent; clear draft discards dirty state", async t => {
  const h = fixture(t); await flush(); await h.select(); const departure = h.component.captureCommandDeparture();
  chooseConsent(h); h.change("memory-retention", "31");
  assert.equal(h.field("memory-consent").attributes.get(".checked"), false); assert.equal(h.action("save").disabled, true);
  assert.equal(departure.current(), false); assert.equal(h.component.captureCommandDeparture().blocked(), true);
  await h.submit(); assert.equal(h.mutations().length, 0);
  h.click("clearDraft"); assert.equal(h.field("memory-retention").attributes.get(".value"), "30");
  assert.equal(h.field("memory-consent").attributes.get(".checked"), false);
  assert.equal(h.component.captureCommandDeparture().blocked(), false);
});

test("account settings cannot implicitly consent to or reveal the recently selected document", async t => {
  const h = fixture(t, { initial: settings([enrollment()]), route: "/settings?panel=memory" }); await flush();
  assert.equal(h.all().some(control => control.tag === "form"), false);
  assert.equal(h.all().some(control => ["memory.live.inspect", "memory.live.stop"].includes(control.label)), false);
  assert.equal(h.action("forget").disabled, false); assert.equal(h.action("openSetup").attributes.get("href"), "/memory");
  h.click("openSetup", { ctrlKey: true }); assert.deepEqual(h.navigations, []);
  h.click("openSetup"); assert.deepEqual(h.navigations, ["/memory"]); assert.equal(h.mutations().length, 0);
  assert.equal(h.field("memory-document").attributes.get(".value"), "");
  await h.select(); assert.equal(h.all().some(control => control.tag === "form"), true);
  assert.equal(h.field("memory-consent").attributes.get(".checked"), false); assert.equal(h.mutations().length, 0);
});

test("document choice refuses a foreign id and binds save to an explicitly chosen non-active document", async t => {
  const h = fixture(t); await flush();
  h.state.projection.documents.push(fixtureDocument({ id: "second-fixture-document", title: "Second fixture document", createdSequence: 2, sourceEvents: ["second-created"] }));
  h.change("memory-document", "foreign-document"); assert.equal(h.calls.length, 1);
  assert.equal(h.field("memory-document").attributes.get(".value"), "");
  await h.select("second-fixture-document"); chooseConsent(h);
  assert.equal(h.field("memory-document").disabled, true, "dirty choices cannot silently change scope");
  let acknowledgement; h.enqueue((_url, init) => { acknowledgement = saved(JSON.parse(init.body)); return acknowledgement; });
  h.enqueue(() => settings([acknowledgement.enrollment])); await h.submit();
  assert.equal(h.mutations()[0].body.documentId, "second-fixture-document");
  assert.equal(h.state.projection.documentId, "fixture-document", "the selected memory scope need not be the active document");
});

test("forget cancellation sends no DELETE and a pending dialog cannot dispatch twice", async t => {
  const h = fixture(t, { initial: settings([enrollment()]) }); await flush(); await h.select();
  const answer = deferred(); h.confirmations.push(answer.promise);
  const original = h.action("forget"), stop = h.action("stop"), inspect = h.action("inspect"), pending = h.invoke(original, "@click").result;
  assert.equal(h.dialogs.length, 1); assert.equal(h.dialogs[0].requireTrustedConfirmation, true);
  assert.equal(h.dialogs[0].owner, h.component); assert.equal(h.dialogs[0].signal.aborted, false);
  assert.equal(h.component.captureCommandDeparture().blocked(), true);
  await h.invoke(original, "@click").result; assert.equal(h.dialogs.length, 1);
  assert.equal(h.action("stop").disabled, true); assert.equal(h.action("inspect").disabled, true);
  await h.invoke(stop, "@click").result; await h.invoke(inspect, "@click").result;
  assert.equal(h.calls.length, 2, "captured stop/reveal callbacks are refused while confirmation owns the component");
  h.change("memory-consent", true); assert.equal(h.field("memory-consent").attributes.get(".checked"), false);
  answer.resolve(false); await pending; assert.equal(h.mutations().length, 0);
  assert.equal(h.component.captureCommandDeparture().blocked(), false);
});

test("explicit forget remains available with rollout off and an older-policy enrollment", async t => {
  const row = enrollment({ policyVersion: "personal-memory-v1", documentId: "older-fixture-document", revision: 7 });
  const h = fixture(t, { initial: settings([row], { enabled: false }) }); await flush();
  assert.equal(h.action("forget").disabled, false); h.confirmations.push(true);
  h.enqueue(forgotten()); h.enqueue(settings([], { enabled: false })); await h.click("forget"); await flush();
  assert.deepEqual(h.calls.map(call => call.init.method), ["GET", "DELETE", "GET"]);
  assert.equal(h.mutations()[0].url, "/api/memory/settings?id=" + row.id);
  assert.deepEqual(h.mutations()[0].body, { revision: 7, confirmation: "FORGET_MY_MEMORY" });
  assert.ok(h.text().includes("memory.live.forgot")); assert.ok(h.text().includes("memory.live.unavailable"));
});

test("a positive dialog answer after account departure cannot forget the former account", async t => {
  const h = fixture(t, { initial: settings([enrollment()]) }); await flush();
  const answer = deferred(); h.confirmations.push(answer.promise); const pending = h.click("forget");
  const dialog = h.dialogs[0]; h.enqueue(settings()); h.move({ actor: "other-fixture-user" }, "forma-authorization-changed"); await flush();
  assert.equal(dialog.signal.aborted, true); assert.equal(dialog.current(), false);
  answer.resolve(true); await pending; assert.equal(h.mutations().length, 0);
  assert.equal(h.dialogRestorations.length, 0); assert.equal(h.focusEvents.length, 0, "withdrawn ownership cannot restore either focus stage");
});

test("harmless dialog rerender preserves only the confirming Forget invoker and completed erasure returns to Refresh", async t => {
  const row = enrollment(), other = enrollment({ id: fixtureId(2), documentId: "other-fixture-document" });
  const h = fixture(t, { initial: settings([row, other]) }); await flush(); await h.select();
  const forgetFor = id => h.all().find(control => control.tag === "button" && control.label === "memory.live.forget"
    && control.attributes.get("aria-label").includes(id));
  const original = forgetFor(row.id), sibling = forgetFor(other.id), answer = deferred(); h.confirmations.push(answer.promise);
  const pending = h.invoke(original, "@click").result, invoker = h.dialogs[0].invoker;
  assert.equal(h.focused(), null, "the finite modal port moves focus off its invoker");
  h.notify(); h.render();
  assert.equal(forgetFor(row.id).disabled, false, "the exact confirming row remains eligible for native close restoration");
  assert.equal(forgetFor(other.id).disabled, true, "another row does not inherit the focus exception");
  await h.invoke(original, "@click").result; await h.invoke(sibling, "@click").result;
  assert.equal(h.dialogs.length, 1); assert.equal(h.mutations().length, 0, "focus eligibility never bypasses the duplicate handler guard");
  h.enqueue(forgotten()); h.enqueue(settings([other])); answer.resolve(true); await pending;
  assert.equal(h.mutations().length, 1); assert.equal(h.mutations()[0].init.method, "DELETE");
  assert.equal(h.dialogRestorations.length, 1); assert.equal(h.dialogRestorations[0], invoker, "close restores the exact invoker, not a new row node");
  assert.equal(h.focusEvents.length, 1); assert.equal(h.focused().attributes.get("data-memory-action"), "refresh");
});

test("accepted Forget does not steal focus moved away while its dialog was pending", async t => {
  const h = fixture(t, { initial: settings([enrollment()]) }); await flush(); await h.select();
  const answer = deferred(); h.confirmations.push(answer.promise); const pending = h.click("forget");
  h.notify(); h.render(); h.stealFocus(); h.enqueue(forgotten()); h.enqueue(settings()); answer.resolve(true); await pending;
  assert.equal(h.mutations().length, 1); assert.ok(h.text().includes("memory.live.forgot"));
  assert.equal(h.dialogRestorations.length, 0); assert.equal(h.focusEvents.length, 0);
});

for (const [name, failure, expected] of [
  ["revision conflict", () => Response.json({ error: "memory_revision_changed" }, { status: 409 }), "conflict"],
  ["unknown network outcome", () => new Error("synthetic transport failure"), "unknown"],
  ["unknown server outcome", () => Response.json({ error: "memory_unavailable" }, { status: 503 }), "unknown"],
]) test(`${name} does not retry, and explicit reload discards consent before reconciling`, async t => {
  const h = fixture(t); await flush(); await h.select(); chooseConsent(h); h.enqueue(failure()); await h.submit(); await flush();
  assert.equal(h.mutations().length, 1); assert.equal(h.calls.length, 3);
  assert.ok(h.text().includes(`memory.live.${expected}`)); assert.equal(h.action("save").disabled, true);
  assert.equal(h.action("reload").disabled, false); assert.equal(h.field("memory-consent").attributes.get(".checked"), false);
  const blocked = h.component.captureCommandDeparture(); assert.equal(blocked.blocked(), true);
  const delayed = delayedJson(settings([enrollment({ revision: 4, learn: false, background: false })])); h.enqueue(delayed.response);
  h.click("reload"); assert.equal(blocked.current(), false); assert.equal(h.component.captureCommandDeparture().blocked(), false);
  assert.equal(delayed.cancellations, 0); assert.equal(delayed.release(), "delivered");
  await flush(); assert.equal(h.calls.length, 4); assert.equal(h.mutations().length, 1);
  assert.equal(h.field("memory-consent").attributes.get(".checked"), false); assert.equal(h.field("memory-learn").attributes.get(".checked"), false);
});

test("cross-user denial and withdrawn account consent cannot enable memory", async t => {
  const h = fixture(t, { initial: Response.json({ error: "context_project_denied" }, { status: 403 }) }); await flush();
  assert.ok(h.text().includes("memory.live.denied")); assert.equal(h.all().some(control => control.tag === "form"), false);
  h.enqueue(settings()); h.move({ policy: false }, "forma-authorization-changed"); await flush();
  await h.select("fixture-document", settings());
  assert.ok(h.text().includes("memory.live.accountConsent")); assert.equal(h.field("memory-consent").disabled, true);
  await h.submit(); assert.equal(h.mutations().length, 0);
});

test("impersonated sessions issue no memory reads or mutations", async t => {
  const h = fixture(t, { session: { user: { userId: "fixture-user" }, policy: { accepted: true }, impersonation: { fixture: true } } }); await flush();
  assert.deepEqual(h.calls, []); assert.ok(h.text().includes("memory.live.impersonation"));
  assert.equal(h.all().some(control => control.tag === "form"), false);
  assert.equal(h.component.captureCommandDeparture().blocked(), false);
});

const transitions = [
  ["route", { route: "/other-fixture-route" }, { route: "/memory" }],
  ["account", { actor: "other-fixture-user" }, { actor: "fixture-user" }],
  ["project", { project: "other-fixture-project" }, { project: "fixture-project" }],
  ["document", { document: "other-fixture-document" }, { document: "fixture-document" }],
];
for (const [name, away, back] of transitions) test(`delayed settings JSON cannot survive ${name} A→B→A ownership`, async t => {
  const delayed = delayedJson(settings([enrollment({ documentId: "stale-private-document" })]));
  const h = fixture(t, { initial: delayed.response }); await flush();
  const first = h.calls[0], lease = h.component.captureCommandDeparture();
  h.enqueue(settings()); h.move(away); await flush(); h.enqueue(settings([], { enabled: false })); h.move(back); await flush();
  assert.equal(first.init.signal.aborted, true); assert.equal(lease.current(), false);
  assert.equal(delayed.cancellations, 1); assert.equal(delayed.release(), "cancelled");
  await flush(); assert.equal(h.calls.length, 3); assert.equal(h.mutations().length, 0);
  assert.equal(h.text().includes("stale-private-document"), false); assert.ok(h.text().includes("memory.live.unavailable"));
  assert.equal(h.field("memory-document").attributes.get(".value"), "");
  assert.equal(h.all().some(control => control.tag === "form"), false);
});

for (const [name, away, back] of transitions) test(`a delayed save acknowledgement cannot publish success or refresh after ${name} A→B→A`, async t => {
  const h = fixture(t); await flush(); await h.select(); chooseConsent(h);
  let delayed;
  h.enqueue((_url, init) => { delayed = delayedJson(saved(JSON.parse(init.body))); return delayed.response; });
  const pending = h.submit(); await flush(); const mutation = h.mutations()[0];
  h.enqueue(settings()); h.move(away); await flush(); h.enqueue(settings([], { enabled: false })); h.move(back); await flush();
  assert.equal(delayed.cancellations, 1); assert.equal(delayed.release(), "cancelled"); await pending; await flush();
  assert.equal(mutation.init.signal.aborted, true); assert.equal(h.mutations().length, 1);
  assert.equal(h.calls.length, 5, "the abandoned mutation does not dispatch a post-save refresh");
  assert.equal(h.text().includes("memory.live.savedMessage"), false); assert.ok(h.text().includes("memory.live.unavailable"));
  assert.equal(h.field("memory-document").attributes.get(".value"), "");
});

test("recall requires explicit reveal and is cleared by hide and reload", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.all().some(control => control.label === "memory.live.inspect"), false);
  await h.select(); assert.equal(h.calls.length, 2); assert.equal(h.text().includes("Synthetic private excerpt"), false);
  h.enqueue(recall(row)); await h.click("inspect"); assert.equal(h.calls.at(-1).url, "/api/memory/recall?id=" + row.id + "&outcomes=native-assisted-outcomes-v1&savedOutputs=native-saved-outputs-v1");
  assert.ok(h.text().includes("Synthetic private excerpt")); assert.ok(h.text().includes("memory.live.extractive"));
  h.click("hide"); assert.equal(h.text().includes("Synthetic private excerpt"), false); assert.equal(h.calls.length, 3);
  h.enqueue(recall(row)); await h.click("inspect"); const delayed = delayedJson(settings([row])); h.enqueue(delayed.response);
  h.click("reload"); assert.equal(h.text().includes("Synthetic private excerpt"), false);
  assert.equal(delayed.cancellations, 0); assert.equal(delayed.release(), "delivered"); await flush(); assert.equal(h.calls.length, 5);
});

test("non-chat activity is revealed explicitly with document counts and historical block subsets", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  assert.equal(h.text().includes("data-memory-activity-window"), false);
  const body = activityRecall(row, { checkedAt: new Date(h.clock.now).toISOString() });
  body.sources.push({ ...body.sources[1], eventId: "repeated-edit" });
  body.consumption.edit++;
  body.coverage.sourceCount++;
  body.rollingConsumption = rollingLiveMemoryConsumption(body.sources, body.lifetime, body.coverage.since, row.retentionDays);
  h.enqueue(body); await h.click("inspect");
  const root = h.render(), text = templateText(root);
  const windows = [...templates(root)].filter(value => value.strings.some(part => part.includes("data-memory-activity-window=")));
  assert.equal(windows.length, 2);
  assert.ok(templateText(windows[0]).includes("activityAction.edit"));
  assert.equal(templateText(windows[0]).includes("activityAction.commit"), false);
  assert.ok(templateText(windows[1]).includes("activityAction.commit"));
  const facts = [...templates(root)].filter(value => value.strings.some(part => part.includes("data-memory-activity-counts")));
  assert.equal(facts.length, 5, "two document totals and their one/two block subsets");
  const totals = facts.map(group => group.values[0].map(entry => entry.values));
  assert.deepEqual(totals, [
    [["memory.live.activityAction.encounter", "1"], ["memory.live.activityAction.edit", "2"]],
    [["memory.live.activityAction.edit", "2"]],
    [["memory.live.activityAction.encounter", "1"], ["memory.live.activityAction.edit", "2"], ["memory.live.activityAction.commit", "1"], ["memory.live.activityAction.remove", "1"]],
    [["memory.live.activityAction.edit", "2"], ["memory.live.activityAction.commit", "1"]],
    [["memory.live.activityAction.remove", "1"]],
  ]);
  assert.ok(text.includes("private-block-a") && text.includes("private-block-b"));
  for (const key of ["activityBasis", "activityOverlap", "activityHistorical"]) assert.ok(text.includes(`memory.live.${key}`));
  assert.equal(text.includes("memory.live.extractive"), false, "action-only evidence is not labelled conversation excerpts");
  assert.equal(h.calls.length, 3); assert.equal(h.mutations().length, 0); assert.deepEqual(h.navigations, []);
});

test("unavailable activity differs from an authorized empty selection", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  h.enqueue(recall(row)); await h.click("inspect");
  assert.ok(h.text().includes("memory.live.activityUnavailable")); assert.equal(h.text().includes("memory.live.activityEmpty"), false);
  await h.click("hide");
  h.enqueue(activityRecall(row, { entries: [], remaining: row.throughSequence, checkedAt: new Date(h.clock.now).toISOString() })); await h.click("inspect");
  assert.equal(h.text().includes("memory.live.activityUnavailable"), false);
  assert.equal(h.text().split("memory.live.activityEmpty").length - 1, 2);
  assert.equal(h.text().includes("personal-memory-activity-blocks"), false);
  assert.equal(h.text().includes("memory.live.activityBacklog"), false, "an already reached cutoff does not imply unprocessed activity");
});

test("shortened activity windows show actual bounds and disclose capped selection and pending review", async t => {
  const row = enrollment({ retentionDays: 2 }), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const body = activityRecall(row, { checkedAt: new Date(h.clock.now).toISOString(), sinceDays: 1, remaining: 20,
    entries: Array.from({ length: 64 }, (_, i) => ["ObjectViewed", .5, `selected-block-${i}`]) });
  h.enqueue(body); await h.click("inspect");
  const text = h.text();
  assert.equal(text.split("memory.live.activityRange [" + body.coverage.since + "]").length - 1, 2);
  assert.ok(text.includes("memory.live.activityLimit [64]")); assert.ok(text.includes("memory.live.activityBacklog"));
  assert.equal(text.split("memory.live.activityBlocks [64]").length - 1, 2);
  assert.ok(text.includes("memory.live.activityWindow [7]") && text.includes("memory.live.activityWindow [30]"));
});

test("block identifiers remain text-bound and isolated, never links or current-title lookups", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const blockId = 'كتلة-<img src=x onerror=alert(1)>-' + '界'.repeat(200);
  h.enqueue(activityRecall(row, { checkedAt: new Date(h.clock.now).toISOString(), entries: [["BlockPropertyEdited", 1, blockId]] }));
  await h.click("inspect");
  const bound = [...templates(h.render())].filter(value => value.values.includes(blockId));
  assert.equal(bound.length, 2);
  for (const value of bound) {
    assert.ok(value.strings.some(part => part.includes('<bdi dir="auto">')));
    assert.ok(value.strings.every(part => !part.includes(blockId) && !part.includes("href=") && !part.includes("onerror=")));
  }
  assert.equal(h.calls.length, 3); assert.deepEqual(h.navigations, []);
});

for (const transition of ["hide", "expiry", "background", "content", "events", "source", "document"]) {
  test(`activity and block references retire on ${transition} without another recall`, async t => {
    const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
    h.enqueue(activityRecall(row, { checkedAt: new Date(h.clock.now).toISOString(), leaseMs: 1_000 })); await h.click("inspect");
    assert.ok(h.text().includes("private-block-a"));
    if (transition === "hide") await h.click("hide");
    if (transition === "expiry") { h.advance(1_000); h.fireTimer(); }
    if (transition === "background") { h.visibility("hidden"); h.visibility("visible"); }
    if (transition === "content") { h.state.content = {}; h.notify(); }
    if (transition === "events") { h.state.events = []; h.notify(); }
    if (transition === "source") { h.enqueue(settings([row])); h.move({ retireSource: true }, "forma-event-source-retired"); await flush(); }
    if (transition === "document") { h.enqueue(settings([row])); h.move({ document: "another-document" }); await flush(); }
    assert.equal(h.text().includes("private-block-a"), false); assert.equal(h.text().includes("data-memory-activity-window"), false);
    assert.equal(h.calls.filter(call => call.url.startsWith("/api/memory/recall")).length, 1);
    assert.equal(h.mutations().length, 0);
  });
}

test("activity messages have complete locale and placeholder coverage", () => {
  const activity = value => Object.keys(value).filter(key => key.startsWith("memory.live.activity")).sort();
  const english = FORMA_PERSONAL_MEMORY_MESSAGES.en, keys = activity(english);
  const placeholders = value => [...value.matchAll(/\{(\w+)\}/gu)].map(match => match[1]).sort();
  for (const dictionary of Object.values(FORMA_PERSONAL_MEMORY_MESSAGES)) {
    assert.deepEqual(activity(dictionary), keys);
    for (const key of keys) { assert.ok(dictionary[key].trim()); assert.deepEqual(placeholders(dictionary[key]), placeholders(english[key])); }
  }
});

for (const locale of Object.keys(FORMA_PERSONAL_MEMORY_MESSAGES)) {
  test(`activity renders localized labels and coverage in ${locale}`, async t => {
    const row = enrollment(), h = fixture(t, { initial: settings([row]), locale, localized: true }); await flush(); await h.select();
    h.enqueue(activityRecall(row, { checkedAt: new Date(h.clock.now).toISOString() }));
    const inspect = h.all().find(control => control.attributes.get("data-memory-action") === "inspect");
    await h.invoke(inspect, "@click").result;
    const text = h.text(), dictionary = FORMA_PERSONAL_MEMORY_MESSAGES[locale];
    assert.ok(text.includes(dictionary["memory.live.activityHeading"])); assert.ok(text.includes(dictionary["memory.live.activityAction.edit"]));
    assert.equal(text.includes("memory.live.activity"), false); assert.equal(/\{(?:since|until|days|count|limit)\}/u.test(text), false);
  });
}

test("assisted outcomes: explicit Inspect counts one acceptance and linked mutation as one outcome", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  assert.equal(h.text().includes("data-memory-assisted-outcomes"), false);
  const body = outcomesRecall(row, { checkedAt: new Date(h.clock.now).toISOString() }); h.enqueue(body); await h.click("inspect");
  const groups = [...templates(h.render())].filter(value => value.strings.some(part => part.includes("data-memory-outcome-counts")));
  assert.equal(groups.length, 1); assert.deepEqual(groups[0].values.slice(1, 5), ["memory.live.outcomesAccepted", "1", "memory.live.outcomesRejected", "1"]);
  const detail = h.all().find(control => control.attributes.has("data-memory-outcome-references")); assert.ok(detail);
  assert.equal(detail.attributes.has("open"), false); assert.equal(detail.attributes.has("?open"), false);
  assert.equal(detail.attributes.has("@toggle"), false, "opening source references has no request handler");
  assert.ok(detail.label.includes("memory.live.outcomesDetails [2]"));
  assert.equal(h.all().filter(control => control.attributes.has("data-memory-assisted-outcome")).length, 2);
  const text = h.text();
  for (const key of ["outcomesBasis", "outcomesGrouping", "outcomesLimits"]) assert.ok(text.includes("memory.live." + key));
  for (const id of ["private-assisted-proposal-a", "private-assisted-proposal-b", "private-assisted-turn-a", "private-assisted-turn-b", "private-assisted-block",
    "assisted-decision-a", "assisted-decision-b", "assisted-change-a"]) assert.equal(text.includes(id), false);
  assert.ok(detail.label.includes("memory.live.outcomesDecision [1]"));
  assert.ok(detail.label.includes("memory.live.outcomesMutation [2]"));
  assert.ok(detail.label.includes("memory.live.outcomesDecision [3]"));
  for (const source of body.sources) assert.ok(detail.label.includes(source.recordedAt));
  assert.equal(h.calls.length, 3); assert.equal(h.mutations().length, 0); assert.deepEqual(h.navigations, []); assert.equal(h.downloads.length, 0);
});

test("assisted outcomes: absent breakdown is unavailable, distinct from certified bounded empty", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  h.enqueue(recall(row)); await h.click("inspect");
  assert.ok(h.text().includes("memory.live.outcomesUnavailable"));
  assert.equal(h.text().includes("data-memory-outcome-counts"), false); assert.equal(h.text().includes("memory.live.outcomesEmpty"), false);
  await h.click("hide");
  const selected = outcomesRecall(row, { checkedAt: new Date(h.clock.now).toISOString() });
  selected.assistedOutcomes.outcomes = []; selected.assistedOutcomes.coverage.certifiedOutcomeCount = 0;
  h.enqueue(selected); await h.click("inspect");
  const group = [...templates(h.render())].find(value => value.strings.some(part => part.includes("data-memory-outcome-counts")));
  assert.deepEqual(group.values.slice(1, 5), ["memory.live.outcomesAccepted", "0", "memory.live.outcomesRejected", "0"]);
  assert.ok(h.text().includes("memory.live.outcomesEmpty")); assert.ok(h.text().includes("memory.live.outcomesLimits"));
  assert.equal(h.text().includes("memory.live.outcomesUnavailable"), false); assert.equal(h.text().includes("data-memory-outcome-references"), false);
});

for (const invalid of ["unknownVersion", "badDecisionIndex", "badMutationIndex", "independentEvidence", "inferredPreferences", "exposure", "completeHistory"]) {
  test("assisted outcomes: supplied " + invalid + " rejects the whole recall instead of showing derived positives", async t => {
    const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
    const body = outcomesRecall(row, { checkedAt: new Date(h.clock.now).toISOString() }), value = body.assistedOutcomes;
    if (invalid === "unknownVersion") value.version = "future-unknown-version";
    if (invalid === "badDecisionIndex") value.outcomes[0].decision.sourceIndex = body.sources.length;
    if (invalid === "badMutationIndex") value.outcomes[0].mutation.sourceIndex = -1;
    if (invalid === "independentEvidence") value.outcomes[0].independentEvidence = true;
    if (invalid === "inferredPreferences") value.inferredPreferences = true;
    if (invalid === "exposure") value.exposure = "measured";
    if (invalid === "completeHistory") value.coverage.completeHistory = true;
    h.enqueue(body); await h.click("inspect");
    assert.equal(h.text().includes("data-memory-assisted-outcomes"), false); assert.equal(h.text().includes("memory.live.outcomesEmpty"), false);
    assert.equal(h.text().includes("personal-memory-excerpts"), false);
    assert.equal(h.calls.length, 3); assert.equal(h.mutations().length, 0);
  });
}

for (const transition of ["hide", "expiry", "background", "content", "events", "source", "document", "locale", "actor"]) {
  test("assisted outcomes: parent recall " + transition + " retires all counts and references without independent renewal", async t => {
    const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
    h.enqueue(outcomesRecall(row, { checkedAt: new Date(h.clock.now).toISOString(), leaseMs: 1_000 })); await h.click("inspect");
    assert.ok(h.text().includes("data-memory-assisted-outcomes"));
    if (transition === "hide") await h.click("hide");
    if (transition === "expiry") { h.advance(1_000); h.fireTimer(); }
    if (transition === "background") { h.visibility("hidden"); h.visibility("visible"); }
    if (transition === "content") { h.state.content = {}; h.notify(); }
    if (transition === "events") { h.state.events = []; h.notify(); }
    if (transition === "source") { h.enqueue(settings([row])); h.move({ retireSource: true }, "forma-event-source-retired"); await flush(); }
    if (transition === "document") { h.enqueue(settings([row])); h.move({ document: "another-document" }); await flush(); }
    if (transition === "locale") { h.enqueue(settings([row])); h.component.i18n.locale = "fr"; h.render(); await flush(); }
    if (transition === "actor") { h.enqueue(settings([row])); h.move({ actor: "replacement-actor" }); await flush(); }
    assert.equal(h.text().includes("data-memory-assisted-outcomes"), false); assert.equal(h.text().includes("data-memory-outcome-references"), false);
    assert.ok(h.recallReceipts[0].retireCalls > 0); assert.equal(h.calls.filter(call => call.url.startsWith("/api/memory/recall")).length, 1);
    assert.equal(h.mutations().length, 0);
  });
}

test("assisted outcomes: closing the assistant suspends the entire inspected outcome view before unmount", async t => {
  const row = enrollment(), h = hostFixture(t, { initial: settings([row]) }); h.assistant(true); h.disclose(true); await flush(); await h.select();
  h.enqueue(outcomesRecall(row, { checkedAt: new Date(h.clock.now).toISOString() })); await h.click("inspect");
  assert.ok(h.text().includes("data-memory-assisted-outcomes")); h.assistant(false, false);
  assert.equal(h.component.render(), nothing); assert.ok(h.recallReceipts[0].retireCalls > 0);
  h.commit(); h.assistant(true); await flush(); assert.equal(h.memoryMarkup(), false);
  assert.equal(h.calls.filter(call => call.url.startsWith("/api/memory/recall")).length, 1);
});

test("assisted outcomes: a delayed old inspection cannot restore counts after hiding the page", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const delayed = delayedJson(outcomesRecall(row, { checkedAt: new Date(h.clock.now).toISOString() }));
  h.enqueue(delayed.response); const inspecting = h.click("inspect"); await flush();
  h.visibility("hidden"); await flush(); assert.equal(delayed.cancellations, 1);
  h.visibility("visible"); delayed.release(); await inspecting;
  assert.equal(h.text().includes("data-memory-assisted-outcomes"), false); assert.equal(h.calls.length, 3);
});

test("assisted outcomes: every supported locale has matching labels and placeholders", () => {
  const selected = dictionary => Object.keys(dictionary).filter(key => key.startsWith("memory.live.outcomes")).sort();
  const english = FORMA_PERSONAL_MEMORY_MESSAGES.en, keys = selected(english);
  const placeholders = value => [...value.matchAll(/\{(\w+)\}/gu)].map(match => match[1]).sort();
  for (const dictionary of Object.values(FORMA_PERSONAL_MEMORY_MESSAGES)) {
    assert.deepEqual(selected(dictionary), keys);
    for (const key of keys) { assert.ok(dictionary[key].trim()); assert.deepEqual(placeholders(dictionary[key]), placeholders(english[key])); }
  }
});
for (const locale of Object.keys(FORMA_PERSONAL_MEMORY_MESSAGES)) {
  test("assisted outcomes: localized bounded counts and reference dates in " + locale, async t => {
    const row = enrollment(), h = fixture(t, { initial: settings([row]), locale, localized: true }); await flush(); await h.select();
    h.enqueue(outcomesRecall(row, { checkedAt: new Date(h.clock.now).toISOString() }));
    const inspect = h.all().find(control => control.attributes.get("data-memory-action") === "inspect"); await h.invoke(inspect, "@click").result;
    const text = h.text(), dictionary = FORMA_PERSONAL_MEMORY_MESSAGES[locale];
    for (const key of ["outcomesHeading", "outcomesAccepted", "outcomesRejected", "outcomesGrouping", "outcomesLimits"])
      assert.ok(text.includes(dictionary["memory.live." + key]));
    assert.equal(text.includes("memory.live.outcomes"), false); assert.equal(/\{(?:index|count|at)\}/u.test(text), false);
  });
}

test("saved outputs: explicit Inspect groups save/pin/export references once without rendering content or controls", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  assert.equal(h.text().includes("data-memory-saved-outputs>"), false);
  const body = savedOutputsRecall(row, { checkedAt: new Date(h.clock.now).toISOString() }); h.enqueue(body); await h.click("inspect");
  const section = [...templates(h.render())].find(value => value.strings.some(part => part.includes("data-memory-saved-outputs>")));
  assert.ok(section); assert.deepEqual(section.values.slice(1, 3), ["memory.live.savedOutputsCount", "1"]);
  const text = templateText(section);
  for (const key of ["savedOutputsGrouping", "savedOutputsLimits", "savedOutputsMeaning"]) assert.ok(text.includes("memory.live." + key));
  for (const number of [1, 2, 3]) assert.ok(text.includes("memory.live.savedOutputsSource [" + number + "]"));
  assert.ok(text.includes(body.savedOutputs.outputs[0].generatedAt));
  for (const source of body.sources) { assert.equal(text.includes(source.eventId), false); assert.equal(text.includes(source.blockId), false); }
  assert.equal(controls(section).filter(control => ["a", "button", "input", "select", "details", "form"].includes(control.tag)).length, 0);
  for (const template of templates(section)) assert.ok(template.strings.every(part => !/\b(?:src|href)=|<(?:img|video|audio)\b/u.test(part)));
  assert.equal(h.calls.length, 3); assert.equal(h.mutations().length, 0); assert.equal(h.downloads.length, 0); assert.deepEqual(h.navigations, []);
});

test("saved outputs: unverified retention references are unavailable, not certified zero", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const unavailable = savedOutputsRecall(row, { checkedAt: new Date(h.clock.now).toISOString() }); delete unavailable.savedOutputs;
  h.enqueue(unavailable); await h.click("inspect");
  assert.ok(h.text().includes("memory.live.savedOutputsUnavailable")); assert.equal(h.text().includes("data-memory-saved-output-count"), false);
  assert.equal(h.text().includes("memory.live.savedOutputsEmpty"), false);
  await h.click("hide"); h.enqueue(savedOutputsRecall(row, { empty: true, checkedAt: new Date(h.clock.now).toISOString() })); await h.click("inspect");
  const section = [...templates(h.render())].find(value => value.strings.some(part => part.includes("data-memory-saved-output-count")));
  assert.deepEqual(section.values.slice(1, 3), ["memory.live.savedOutputsCount", "0"]);
  assert.ok(h.text().includes("memory.live.savedOutputsEmpty")); assert.ok(h.text().includes("memory.live.savedOutputsLimits"));
  assert.equal(h.text().includes("memory.live.savedOutputsUnavailable"), false); assert.equal(h.text().includes("data-memory-saved-output-references"), false);
});

test("saved outputs: partial certification counts included outputs, not every retention source", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  h.enqueue(savedOutputsRecall(row, { partial: true, checkedAt: new Date(h.clock.now).toISOString() })); await h.click("inspect");
  const section = [...templates(h.render())].find(value => value.strings.some(part => part.includes("data-memory-saved-output-count")));
  assert.deepEqual(section.values.slice(1, 3), ["memory.live.savedOutputsCount", "1"]);
  assert.ok(templateText(section).includes("memory.live.savedOutputsLimits"));
  assert.equal(templateText(section).includes("memory.live.savedOutputsSource [4]"), false);
});

for (const invalid of ["unknownVersion", "outsideIndex", "duplicateIndex", "origin", "independentEvidence", "preferences", "completeHistory", "generationTime", "falseZero", "rawContent"]) {
  test("saved outputs: malformed " + invalid + " rejects the recall without derived positives", async t => {
    const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
    const body = savedOutputsRecall(row, { checkedAt: new Date(h.clock.now).toISOString() }), value = body.savedOutputs;
    if (invalid === "unknownVersion") value.version = "unknown-version";
    if (invalid === "outsideIndex") value.outputs[0].sourceIndexes = [body.sources.length];
    if (invalid === "duplicateIndex") value.outputs[0].sourceIndexes = [0, 0];
    if (invalid === "origin") value.outputs[0].origin = "independent-user-output";
    if (invalid === "independentEvidence") value.outputs[0].independentEvidence = true;
    if (invalid === "preferences") value.inferredPreferences = true;
    if (invalid === "completeHistory") value.coverage.completeHistory = true;
    if (invalid === "generationTime") value.outputs[0].generatedAt = new Date(Date.parse(body.lifetime.checkedAt) + 1_000).toISOString();
    if (invalid === "falseZero") { value.outputs = []; value.coverage.certifiedOutputCount = 0; }
    if (invalid === "rawContent") value.outputs[0].text = "Private content must not enter the display";
    h.enqueue(body); await h.click("inspect");
    assert.equal(h.text().includes("personal-memory-excerpts"), false); assert.equal(h.text().includes("data-memory-saved-output-count"), false);
    assert.equal(h.text().includes("Private content must not enter the display"), false); assert.equal(h.calls.length, 3);
  });
}

for (const transition of ["hide", "expiry", "background", "content", "events", "source", "document", "locale", "actor"]) {
  test("saved outputs: " + transition + " retires counts and references under the existing parent lease", async t => {
    const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
    h.enqueue(savedOutputsRecall(row, { checkedAt: new Date(h.clock.now).toISOString(), leaseMs: 1_000 })); await h.click("inspect");
    assert.ok(h.text().includes("data-memory-saved-output-count"));
    if (transition === "hide") await h.click("hide");
    if (transition === "expiry") { h.advance(1_000); h.fireTimer(); }
    if (transition === "background") { h.visibility("hidden"); h.visibility("visible"); }
    if (transition === "content") { h.state.content = {}; h.notify(); }
    if (transition === "events") { h.state.events = []; h.notify(); }
    if (transition === "source") { h.enqueue(settings([row])); h.move({ retireSource: true }, "forma-event-source-retired"); await flush(); }
    if (transition === "document") { h.enqueue(settings([row])); h.move({ document: "another-document" }); await flush(); }
    if (transition === "locale") { h.enqueue(settings([row])); h.component.i18n.locale = "fr"; h.render(); await flush(); }
    if (transition === "actor") { h.enqueue(settings([row])); h.move({ actor: "replacement-actor" }); await flush(); }
    assert.equal(h.text().includes("data-memory-saved-output-count"), false); assert.equal(h.text().includes("data-memory-saved-output-references"), false);
    assert.ok(h.recallReceipts[0].retireCalls > 0); assert.equal(h.calls.filter(call => call.url.startsWith("/api/memory/recall")).length, 1);
    assert.equal(h.mutations().length, 0);
  });
}

test("saved outputs: host closure suspends the displayed group before child unmount", async t => {
  const row = enrollment(), h = hostFixture(t, { initial: settings([row]) }); h.assistant(true); h.disclose(true); await flush(); await h.select();
  h.enqueue(savedOutputsRecall(row, { checkedAt: new Date(h.clock.now).toISOString() })); await h.click("inspect");
  assert.ok(h.text().includes("data-memory-saved-output-count")); h.assistant(false, false);
  assert.equal(h.component.render(), nothing); assert.ok(h.recallReceipts[0].retireCalls > 0);
  h.commit(); h.assistant(true); await flush(); assert.equal(h.memoryMarkup(), false);
  assert.equal(h.calls.filter(call => call.url.startsWith("/api/memory/recall")).length, 1);
});

test("saved outputs: delayed inspection cannot restore its group after page hiding", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const delayed = delayedJson(savedOutputsRecall(row, { checkedAt: new Date(h.clock.now).toISOString() })); h.enqueue(delayed.response);
  const inspecting = h.click("inspect"); await flush(); h.visibility("hidden"); await flush();
  assert.equal(delayed.cancellations, 1); h.visibility("visible"); delayed.release(); await inspecting;
  assert.equal(h.text().includes("data-memory-saved-output-count"), false); assert.equal(h.calls.length, 3);
});

test("saved outputs: all locale keys and placeholders match", () => {
  const selected = dictionary => Object.keys(dictionary).filter(key => key.startsWith("memory.live.savedOutputs")).sort();
  const english = FORMA_PERSONAL_MEMORY_MESSAGES.en, keys = selected(english);
  const placeholders = value => [...value.matchAll(/\{(\w+)\}/gu)].map(match => match[1]).sort();
  for (const dictionary of Object.values(FORMA_PERSONAL_MEMORY_MESSAGES)) {
    assert.deepEqual(selected(dictionary), keys);
    for (const key of keys) { assert.ok(dictionary[key].trim()); assert.deepEqual(placeholders(dictionary[key]), placeholders(english[key])); }
  }
});
for (const locale of Object.keys(FORMA_PERSONAL_MEMORY_MESSAGES)) {
  test("saved outputs: localized count, references and limitation copy in " + locale, async t => {
    const row = enrollment(), h = fixture(t, { initial: settings([row]), locale, localized: true }); await flush(); await h.select();
    h.enqueue(savedOutputsRecall(row, { checkedAt: new Date(h.clock.now).toISOString() }));
    const inspect = h.all().find(control => control.attributes.get("data-memory-action") === "inspect"); await h.invoke(inspect, "@click").result;
    const text = h.text(), dictionary = FORMA_PERSONAL_MEMORY_MESSAGES[locale];
    for (const key of ["savedOutputsHeading", "savedOutputsCount", "savedOutputsGrouping", "savedOutputsLimits", "savedOutputsMeaning"])
      assert.ok(text.includes(dictionary["memory.live." + key]));
    assert.equal(text.includes("memory.live.savedOutputs"), false); assert.equal(/\{(?:at|index)\}/u.test(text), false);
  });
}

test("local conversation quotes and activity appear only after Inspect and keep original clips and recent two unchanged", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const earlier = [{ user: "Do not publish! Keep the exact wording.", assistant: "I could suggest a draft." }];
  assert.equal(h.text().includes("data-memory-local-quote"), false);
  const body = rollingRecall(row, earlier, { checkedAt: new Date(h.clock.now).toISOString() });
  const activity = activityRecall(row, { checkedAt: body.lifetime.checkedAt });
  body.sources.push(...activity.sources); body.consumption = { ...body.consumption, ...activity.consumption };
  body.coverage.since = activity.coverage.since; body.coverage.sourceCount = body.sources.length;
  body.rollingConsumption = rollingLiveMemoryConsumption(body.sources, body.lifetime, body.coverage.since, row.retentionDays);
  h.enqueue(body); await h.click("inspect");
  assert.ok(h.text().includes("data-memory-activity-window"));
  const quotes = h.all().filter(control => control.attributes.has("data-memory-local-quote"));
  assert.deepEqual(quotes.map(control => control.attributes.get("data-memory-local-quote")), ["user", "user", "assistant"]);
  assert.deepEqual(quotes.map(control => control.label), ["memory.live.youDo not publish!", "memory.live.youKeep the exact wording.", "memory.live.assistantI could suggest a draft."]);
  const originals = h.all().find(control => control.attributes.has("data-memory-original-excerpts"));
  assert.equal(originals.attributes.get("?open"), false);
  assert.ok(originals.label.includes("memory.live.earlier")); assert.ok(originals.label.includes("memory.live.extractive"));
  assert.ok(originals.label.includes(earlier[0].user)); assert.ok(originals.label.includes(earlier[0].assistant));
  for (const clip of body.rollingConversation.recent) {
    assert.ok(h.text().includes(clip.user)); assert.ok(h.text().includes(clip.assistant));
    assert.ok(quotes.every(control => !control.label.includes(clip.user) && !control.label.includes(clip.assistant)));
  }
  assert.equal(h.calls.length, 3); assert.equal(h.mutations().length, 0);
});

test("unsupported local digest text remains visibly excerpt-only with the existing localized disclaimer", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const earlier = [{ user: "لا تنشر بعد", assistant: "const selected = `draft`;" }];
  h.enqueue(rollingRecall(row, earlier, { checkedAt: new Date(h.clock.now).toISOString() })); await h.click("inspect");
  assert.equal(h.all().some(control => control.attributes.has("data-memory-local-quote")), false);
  const originals = h.all().find(control => control.attributes.has("data-memory-original-excerpts"));
  assert.equal(originals.attributes.get("?open"), true);
  assert.ok(originals.label.includes("memory.live.earlier")); assert.ok(originals.label.includes("memory.live.extractive"));
  assert.ok(originals.label.includes(earlier[0].user)); assert.ok(originals.label.includes(earlier[0].assistant));
  assert.ok(h.text().includes("Recent request two stays exact")); assert.equal(h.calls.length, 3);
});

test("deduplicated local quotes leave the original blue-red-blue chronology open", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const earlier = ["Use blue.", "Use red.", "Use blue."].map((user, index) => ({ user, assistant: `Suggestion ${index}.` }));
  h.enqueue(rollingRecall(row, earlier, { checkedAt: new Date(h.clock.now).toISOString() })); await h.click("inspect");
  const originals = h.all().find(control => control.attributes.has("data-memory-original-excerpts"));
  assert.equal(originals.attributes.get("?open"), true);
  const first = originals.label.indexOf("Use blue."), middle = originals.label.indexOf("Use red."), last = originals.label.lastIndexOf("Use blue.");
  assert.ok(first >= 0 && first < middle && middle < last);
  assert.equal(h.all().filter(control => control.attributes.get("data-memory-local-quote") === "user").length, 2);
});

test("hide and the existing lease retire local quotes and original disclosures without another request", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const earlier = [{ user: "Private local quotation.", assistant: "Private local suggestion." }];
  h.enqueue(rollingRecall(row, earlier, { leaseMs: 1_000, checkedAt: new Date(h.clock.now).toISOString() })); await h.click("inspect");
  assert.ok(h.text().includes("data-memory-local-quote")); await h.click("hide");
  assert.equal(h.text().includes("Private local"), false); assert.equal(h.text().includes("data-memory-original-excerpts"), false);
  h.enqueue(rollingRecall(row, earlier, { leaseMs: 1_000, checkedAt: new Date(h.clock.now).toISOString() })); await h.click("inspect");
  assert.ok(h.text().includes("Private local quotation.")); h.advance(1_000); h.fireTimer();
  assert.equal(h.recallReceipts.at(-1).retireCalls, 1);
  assert.equal(h.text().includes("Private local"), false); assert.equal(h.text().includes("data-memory-local-quote"), false);
  assert.equal(h.text().includes("data-memory-original-excerpts"), false); assert.ok(h.text().includes("memory.live.viewExpired"));
  assert.equal(h.calls.length, 4); assert.equal(h.mutations().length, 0);
});

for (const [name, away, back] of transitions) test(`delayed recall JSON cannot reappear after ${name} A→B→A`, async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const delayed = delayedJson(recall(row, "Stale recall must remain private")); h.enqueue(delayed.response);
  const pending = h.click("inspect"); await flush(); const request = h.calls.at(-1);
  h.enqueue(settings()); h.move(away); await flush(); h.enqueue(settings([row])); h.move(back); await flush();
  assert.equal(delayed.cancellations, 1); assert.equal(delayed.release(), "cancelled"); await pending; await flush();
  assert.equal(request.init.signal.aborted, true); assert.equal(h.text().includes("Stale recall must remain private"), false);
  assert.equal(h.field("memory-document").attributes.get(".value"), "");
  assert.equal(h.calls.filter(call => call.url.startsWith("/api/memory/recall")).length, 1, "no automatic re-reveal in the renewed scope");
});

test("a disconnected host clears ownership without publishing a delayed body", async t => {
  const delayed = delayedJson(settings([enrollment({ documentId: "disconnected-private-document" })]));
  const h = fixture(t, { initial: delayed.response }); await flush(); const lease = h.component.captureCommandDeparture();
  h.disconnect(); assert.equal(delayed.cancellations, 1); assert.equal(delayed.release(), "cancelled"); await flush();
  assert.equal(h.calls[0].init.signal.aborted, true); assert.equal(lease.current(), false);
  assert.equal(h.text().includes("disconnected-private-document"), false); assert.equal(h.calls.length, 1);
});

test("source retirement invalidates an unchanged project/document selection and pending recall", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const delayed = delayedJson(recall(row, "Retired source excerpt")); h.enqueue(delayed.response);
  const pending = h.click("inspect"); await flush(); const request = h.calls.at(-1);
  h.enqueue(settings([row])); h.move({ retireSource: true }, "forma-event-source-retired"); await flush();
  assert.equal(delayed.cancellations, 1); assert.equal(delayed.release(), "cancelled"); await pending;
  assert.equal(request.init.signal.aborted, true); assert.equal(h.field("memory-document").attributes.get(".value"), "");
  assert.equal(h.text().includes("Retired source excerpt"), false);
});

test("pagination never treats an incomplete first page as proof of no enrollment", async t => {
  const rows = Array.from({ length: 50 }, (_, index) => enrollment({ id: fixtureId(index + 1), documentId: `other-fixture-document-${index}` }));
  const h = fixture(t, { initial: settings(rows, { nextAfter: fixtureId(50) }) }); await flush(); await h.select();
  assert.ok(h.text().includes("memory.live.moreNeeded")); assert.equal(h.text().includes("memory.live.notEnrolled"), false);
  assert.equal(h.field("memory-consent").disabled, true); await h.submit(); assert.equal(h.mutations().length, 0);
  const selected = enrollment({ id: fixtureId(51), revision: 3 }); h.enqueue(settings([selected])); h.click("more"); await flush();
  assert.equal(h.calls.at(-1).url, "/api/memory/settings?after=" + fixtureId(50));
  assert.equal(h.text().includes("memory.live.notEnrolled"), false); assert.equal(h.field("memory-learn").attributes.get(".checked"), true);
  assert.equal(h.all().some(control => control.label === "memory.live.more"), false);
});

test("a failed later settings page keeps absence unproven and requires explicit refresh", async t => {
  const rows = Array.from({ length: 50 }, (_, index) => enrollment({ id: fixtureId(index + 1), documentId: `other-fixture-document-${index}` }));
  const h = fixture(t, { initial: settings(rows, { nextAfter: fixtureId(50) }) }); await flush(); await h.select();
  h.enqueue(settings([enrollment({ id: fixtureId(51) })], { enabled: false })); h.click("more"); await flush();
  assert.ok(h.text().includes("memory.live.conflict")); assert.ok(h.text().includes("memory.live.moreNeeded"));
  assert.equal(h.text().includes("memory.live.notEnrolled"), false); assert.equal(h.action("more").disabled, true);
  assert.equal(h.action("reload").disabled, false); assert.equal(h.mutations().length, 0);
});

test("ambiguous enrollment identity is review-needed, not a new enrollment or an implicit reveal", async t => {
  const rows = [enrollment(), enrollment({ id: fixtureId(2) })];
  const h = fixture(t, { initial: settings(rows) }); await flush(); await h.select(); chooseConsent(h);
  assert.ok(h.text().includes("memory.live.reviewNeeded")); assert.equal(h.text().includes("memory.live.notEnrolled"), false);
  assert.equal(h.action("save").disabled, true); assert.equal(h.all().some(control => control.label === "memory.live.inspect"), false);
  await h.submit(); assert.equal(h.mutations().length, 0);
});

test("stop learning narrows an existing enrollment once without claiming to forget it", async t => {
  const row = enrollment({ revision: 6 }), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  let acknowledgement; h.enqueue((_url, init) => { acknowledgement = { ...saved(JSON.parse(init.body)), priorMemoryCleared: false }; return acknowledgement; });
  h.enqueue(() => settings([acknowledgement.enrollment])); await h.click("stop");
  assert.equal(h.mutations().length, 1); assert.equal(h.mutations()[0].init.method, "PUT");
  assert.deepEqual(h.mutations()[0].body, { projectId: row.projectId, documentId: row.documentId, learn: false, recall: true, background: false,
    retentionDays: row.retentionDays, timeZone: row.timeZone, expiresAt: row.expiresAt, revision: 6,
    confirmation: "ENABLE_PERSONAL_MEMORY", policyVersion: MEMORY_POLICY, reviewTiming: MEMORY_TIMING, expectedCustody: { kind: "personal" } });
  assert.ok(h.text().includes("memory.live.stopMessage")); assert.ok(h.text().includes("memory.live.paused"));
  assert.equal(h.text().includes("memory.live.forgot"), false);
});

test("command departure tracks dirty and mutating work but not a disposable pending read", async t => {
  const delayed = delayedJson(settings()), h = fixture(t, { initial: delayed.response }); await flush();
  assert.equal(h.component.captureCommandDeparture().blocked(), false);
  assert.equal(delayed.cancellations, 0); assert.equal(delayed.release(), "delivered"); await flush();
  await h.select("fixture-document", settings());
  chooseConsent(h); const dirty = h.component.captureCommandDeparture(); assert.equal(dirty.current(), true); assert.equal(dirty.blocked(), true);
  const reply = deferred(); let acknowledgement;
  h.enqueue(async (_url, init) => { acknowledgement = saved(JSON.parse(init.body)); await reply.promise; return acknowledgement; });
  h.enqueue(() => settings([acknowledgement.enrollment])); const pending = h.submit();
  assert.equal(h.component.captureCommandDeparture().blocked(), true); reply.resolve(); await pending;
  assert.equal(dirty.current(), false); assert.equal(h.component.captureCommandDeparture().blocked(), false);
});

test("invalid dates, missing learning consent and invalid retention never reach HTTP", async t => {
  const h = fixture(t); await flush(); await h.select();
  h.change("memory-learn", true); h.change("memory-consent", true); await h.submit(); assert.equal(h.mutations().length, 0);
  const validExpiry = future(20).slice(0, 10);
  for (const [name, value] of [["memory-retention", "0"], ["memory-retention", "366"], ["memory-retention", "1.5"],
    ["memory-expiry", "2000-01-01"], ["memory-expiry", invalidFutureCalendarDate()], ["memory-timezone", "Not/AZone"]]) {
    h.change("memory-retention", "30"); h.change("memory-expiry", validExpiry); h.change("memory-timezone", "UTC");
    h.change("memory-background", true); h.change(name, value); h.change("memory-consent", true);
    await h.submit(); assert.equal(h.mutations().length, 0, `${name}=${value} is rejected before HTTP`);
  }
});

test("dirty preferences block Forget, including an already captured callback", async t => {
  const h = fixture(t, { initial: settings([enrollment()]) }); await flush(); await h.select();
  const original = h.action("forget"); h.change("memory-retention", "31");
  assert.equal(h.action("forget").disabled, true); await h.invoke(original, "@click").result;
  assert.equal(h.dialogs.length, 0); assert.equal(h.mutations().length, 0);
  h.click("clearDraft"); assert.equal(h.action("forget").disabled, false);
});

function sharedSession(overrides = {}) {
  return { ...personalSession(), projects: [{ projectId: "fixture-project", organizationId: "fixture-org", projectAccessId: "fixture-access", ownerUserId: "fixture-owner" }],
    projectContext: { projectId: "fixture-project", organizationId: "fixture-org", projectAccessId: "fixture-access", ownerUserId: "fixture-owner", expiresAt: future(20) }, ...overrides };
}

test("Forget names the exact selected document, project, organization and enrollment", async t => {
  const row = enrollment({ organizationId: "fixture-org" }), h = fixture(t, { initial: settings([row]), session: sharedSession() });
  await flush(); await h.select(); const control = h.action("forget"); h.confirmations.push(false); await h.click("forget");
  const message = h.dialogs[0].message;
  for (const identity of ["Fixture document", row.documentId, row.projectId, row.organizationId]) assert.ok(message.includes(identity), identity);
  assert.ok(message.replaceAll(" ", "").includes(row.id));
  assert.ok(control.attributes.get("aria-label").includes(row.documentId)); assert.ok(control.attributes.get("aria-label").includes(row.id));
  assert.equal(h.mutations().length, 0);
});

for (const [name, overrides] of [
  ["older policy", { policyVersion: "personal-memory-v1" }], ["non-ready", { status: "revoked", learn: false, recall: false, background: false }],
  ["expired", { expiresAt: new Date(Date.now() - 1000).toISOString() }],
]) test(`quick stop is absent for an ${name} enrollment`, async t => {
  const h = fixture(t, { initial: settings([enrollment(overrides)]) }); await flush(); await h.select();
  assert.equal(h.all().some(control => control.label === "memory.live.stop"), false); assert.equal(h.action("forget").disabled, false);
  assert.equal(h.mutations().length, 0);
});

test("stop learning reports cleared prior memory when the acknowledgement says it was cleared", async t => {
  const h = fixture(t, { initial: settings([enrollment()]) }); await flush(); await h.select(); let acknowledgement;
  h.enqueue((_url, init) => { acknowledgement = saved(JSON.parse(init.body)); return acknowledgement; });
  h.enqueue(() => settings([acknowledgement.enrollment])); await h.click("stop");
  assert.ok(h.text().includes("memory.live.clearedMessage")); assert.equal(h.text().includes("memory.live.stopMessage"), false);
});

for (const [name, patch] of [["organization", { organizationId: "foreign-organization" }], ["enrollment", { id: fixtureId(9) }]])
  test(`stop acknowledgement from another ${name} remains unknown and is not automatically refreshed`, async t => {
    const h = fixture(t, { initial: settings([enrollment()]) }); await flush(); await h.select();
    h.enqueue((_url, init) => { const value = saved(JSON.parse(init.body)); Object.assign(value.enrollment, patch); return value; });
    await h.click("stop"); assert.equal(h.mutations().length, 1); assert.equal(h.calls.length, 3);
    assert.ok(h.text().includes("memory.live.unknown")); assert.equal(h.text().includes("memory.live.stopMessage"), false);
  });

for (const [name, session] of [
  ["unknown project list", { user: { userId: "fixture-user" }, policy: { accepted: true } }],
  ["listed organization without active context", (() => { const value = sharedSession(); delete value.projectContext; return value; })()],
  ["context for another project", sharedSession({ projectContext: { ...sharedSession().projectContext, projectId: "other-project" } })],
  ["organization mismatch", sharedSession({ projectContext: { ...sharedSession().projectContext, organizationId: "other-org" } })],
  ["access mismatch", sharedSession({ projectContext: { ...sharedSession().projectContext, projectAccessId: "other-access" } })],
  ["ambiguous project listing", sharedSession({ projects: [...sharedSession().projects, ...sharedSession().projects] })],
]) test(`${name} fails closed before offering document consent`, async t => {
  const h = fixture(t, { session }); await flush(); await h.select();
  assert.ok(h.text().includes("memory.live.scopeRequired")); assert.equal(h.all().some(control => control.tag === "form"), false);
  assert.equal(h.mutations().length, 0);
});

test("matching explicit organization context permits the scoped form through the guarded client", async t => {
  const h = fixture(t, { session: sharedSession() }); await flush(); await h.select(); chooseConsent(h); let acknowledgement;
  h.enqueue((_url, init) => { acknowledgement = saved(JSON.parse(init.body)); acknowledgement.enrollment.organizationId = "fixture-org"; return acknowledgement; });
  h.enqueue(() => settings([acknowledgement.enrollment])); await h.submit();
  assert.equal(h.mutations().length, 1); assert.equal(h.mutations()[0].body.projectId, "fixture-project");
  assert.deepEqual(h.mutations()[0].body.expectedCustody, { kind: "organization", organizationId: "fixture-org", projectAccessId: "fixture-access", ownerUserId: "fixture-owner" });
  assert.equal(h.guardedCalls.length, h.calls.length); assert.ok(h.guardedCalls.every(call => call.action === "memory.live.heading"));
  assert.ok(h.text().includes("memory.live.savedMessage"));
});

test("cookie reconciliation blocks dispatch and is checked again after response headers", async t => {
  const h = fixture(t); await flush(); assert.equal(h.guardedCalls.length, 1);
  h.state.cookieGeneration++; h.click("reload"); await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.guardedCalls.length, 2); assert.ok(h.text().includes("memory.live.error"));
  h.state.sessionGeneration = h.state.cookieGeneration; const headers = deferred();
  h.enqueue(async () => { await headers.promise; return settings([enrollment({ documentId: "unreconciled-private-document" })]); });
  h.click("reload"); await flush(); h.state.cookieGeneration++; headers.resolve(); await flush();
  assert.equal(h.calls.length, 2); assert.equal(h.text().includes("unreconciled-private-document"), false);
  assert.ok(h.text().includes("memory.live.error")); assert.equal(h.mutations().length, 0);
});

for (const mode of ["remove then restore", "restored revision before notification"]) test(`non-active selected document ${mode} invalidates delayed recall`, async t => {
  const row = enrollment({ documentId: "second-fixture-document" }), h = fixture(t, { initial: settings([row]) }); await flush();
  const document = fixtureDocument({ id: row.documentId, createdSequence: 2, sourceEvents: ["second-created"] });
  h.state.projection.documents = [...h.state.projection.documents, document]; await h.select(row.documentId);
  const delayed = delayedJson(recall(row, "Removed non-active document excerpt")); h.enqueue(delayed.response);
  const pending = h.click("inspect"); await flush(); const previous = h.component.captureCommandDeparture();
  h.state.projection.documents = h.state.projection.documents.filter(item => item.id !== row.documentId);
  if (mode === "remove then restore") { h.enqueue(settings([row])); h.notify(); await flush(); }
  h.state.projection.documents = [...h.state.projection.documents, { ...document, sourceEvents: ["second-created", "second-restored"] }];
  if (mode !== "remove then restore") h.enqueue(settings([row])); h.notify(); await flush();
  assert.equal(delayed.cancellations, 1); assert.equal(delayed.release(), "cancelled"); await pending;
  assert.equal(h.state.projection.documentId, "fixture-document"); assert.equal(previous.current(), false);
  assert.equal(h.field("memory-document").attributes.get(".value"), ""); assert.equal(h.text().includes("Removed non-active document excerpt"), false);
});

for (const kind of ["events", "content"]) test(`an erased ${kind} snapshot clears both pending and previously revealed recall`, async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const delayed = delayedJson(recall(row, "Pending erased evidence")); h.enqueue(delayed.response); const pending = h.click("inspect"); await flush();
  h.state[kind] = kind === "events" ? [] : {}; h.notify();
  assert.equal(delayed.cancellations, 0, "snapshot fencing is exercised with a real non-cancelled late body");
  assert.equal(delayed.release(), "delivered"); await pending;
  assert.equal(h.text().includes("Pending erased evidence"), false); assert.equal(h.field("memory-document").attributes.get(".value"), row.documentId);
  h.enqueue(recall(row, "Revealed erased evidence")); await h.click("inspect"); assert.ok(h.text().includes("Revealed erased evidence"));
  h.state[kind] = kind === "events" ? [] : {}; h.notify(); assert.equal(h.text().includes("Revealed erased evidence"), false);
  assert.equal(h.calls.length, 4, "erasure does not implicitly fetch/re-reveal another snapshot");
});

for (const wake of ["timer", "visibility", "focus", "render"]) test(`${wake} retires an expired recall lease without resetting consent or fetching`, async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  h.enqueue(recall(row, "Short-lived private view", { leaseMs: 1_000, checkedAt: new Date(h.clock.now).toISOString() }));
  await h.click("inspect"); h.change("memory-consent", true);
  assert.ok(h.text().includes("Short-lived private view")); assert.ok(h.text().includes("memory.live.coverage [1]"));
  assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, 1_000, "Inspect immediately arms the relative recall deadline");
  const receipt = h.recallReceipts.at(-1), renders = h.renderCount();
  assert.equal(receipt.retireCalls, 0);
  h.advance(1_000);
  if (wake === "timer") h.fireTimer(); else if (wake === "visibility") h.visibility(); else if (wake === "focus") h.dispatchWindow("focus");
  assert.equal(h.renderCount(), renders, "dispatch itself is witnessed before any render fallback");
  assert.equal(receipt.retireCalls, wake === "render" ? 0 : 1, "lifecycle callbacks must retire the real lease before rendering");
  const text = h.text();
  assert.equal(receipt.retireCalls, 1, "the separate render-only case also retires the real lease");
  assert.equal(text.includes("Short-lived private view"), false); assert.equal(text.includes("memory.live.coverage"), false);
  assert.equal(text.includes("memory.live.extractive"), false); assert.ok(text.includes("memory.live.viewExpired"));
  assert.equal(h.all().some(control => control.label === "memory.live.hide"), false);
  assert.equal(h.field("memory-consent").attributes.get(".checked"), true, "view expiry does not withdraw the separate consent draft");
  assert.equal(h.action("inspect").disabled, false); assert.equal(h.action("save").disabled, false);
  h.visibility(); h.dispatchWindow("focus"); h.notify();
  assert.equal(h.calls.length, 3, "timer and lifecycle checks do not reload settings or automatically re-Inspect");
  assert.equal(h.mutations().length, 0); assert.equal(h.focusEvents.length, 0, "privacy retirement cannot steal focus");
});

test("an early recall timer retains only the remaining lease and cannot extend the view", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  h.enqueue(recall(row, "Early timer view", { leaseMs: 1_000, checkedAt: new Date(h.clock.now).toISOString() })); await h.click("inspect");
  h.advance(250); h.fireTimer();
  assert.ok(h.text().includes("Early timer view")); assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, 750);
  h.dispatchWindow("focus"); assert.equal([...h.timers.values()][0].delay, 750, "rescheduling does not reset the original budget");
  h.advance(750); h.fireTimer();
  assert.equal(h.text().includes("Early timer view"), false); assert.ok(h.text().includes("memory.live.viewExpired"));
  assert.equal(h.calls.length, 3); assert.equal(h.focusEvents.length, 0);
});

test("backgrounding clears the entire revealed view and requires a fresh explicit Inspect", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  h.enqueue(recall(row, "Backgrounded private view")); await h.click("inspect"); h.change("memory-consent", true);
  const receipt = h.recallReceipts.at(-1), renders = h.renderCount();
  h.visibility("hidden");
  assert.equal(receipt.retireCalls, 1, "hidden callback retires before any render can help");
  assert.equal(h.renderCount(), renders);
  h.visibility("visible"); h.dispatchWindow("focus");
  assert.equal(h.renderCount(), renders, "hide and show are dispatched with no intervening render");
  assert.equal(receipt.retireCalls, 1);
  assert.equal(h.text().includes("Backgrounded private view"), false); assert.equal(h.text().includes("memory.live.coverage"), false);
  assert.equal(h.text().includes("memory.live.viewExpired"), false, "background retirement does not invent a server expiry result");
  assert.equal(h.text().includes("Backgrounded private view"), false); assert.equal(h.calls.length, 3);
  assert.equal(h.field("memory-consent").attributes.get(".checked"), true); assert.equal(h.focusEvents.length, 0);
  h.enqueue(recall(row, "Fresh explicit view")); await h.click("inspect");
  assert.ok(h.text().includes("Fresh explicit view")); assert.equal(h.calls.length, 4); assert.equal(h.mutations().length, 0);
});

test("a captured Inspect callback cannot dispatch while its page is backgrounded", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const inspect = h.action("inspect"); h.visibility("hidden");
  await h.invoke(inspect, "@click").result;
  assert.equal(h.calls.length, 2); assert.equal(h.text().includes("memory.live.coverage"), false);
  h.visibility("visible"); assert.equal(h.calls.length, 2, "visibility alone never becomes a fresh Inspect gesture");
  assert.equal(h.focusEvents.length, 0);
});

test("hide/show retires a pending real recall body without cancelling the settings owner", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select(); h.change("memory-consent", true);
  const delayed = delayedJson(recall(row, "Hidden pending body")); h.enqueue(delayed.response);
  const pending = h.click("inspect"); await flush(); const request = h.calls.at(-1);
  const renders = h.renderCount();
  h.visibility("hidden"); h.visibility("visible");
  assert.equal(h.renderCount(), renders, "pending identity retires without a render fallback");
  assert.equal(request.init.signal.aborted, true); assert.equal(delayed.cancellations, 1);
  assert.equal(delayed.release(), "cancelled"); await pending; await flush();
  assert.equal(h.text().includes("Hidden pending body"), false); assert.equal(h.text().includes("memory.live.error"), false);
  assert.equal(h.field("memory-document").attributes.get(".value"), row.documentId);
  assert.equal(h.field("memory-consent").attributes.get(".checked"), true); assert.equal(h.action("save").disabled, false);
  assert.equal(h.calls.length, 3); assert.equal(h.focusEvents.length, 0);
  h.enqueue(recall(row, "Explicit view after pending retirement")); await h.click("inspect");
  assert.ok(h.text().includes("Explicit view after pending retirement")); assert.equal(h.calls.length, 4);
});

test("an old hidden header response cannot finish or reveal over a newer explicit Inspect", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const headers = deferred(); h.enqueue(async () => { await headers.promise; return recall(row, "Old hidden header view"); });
  const oldPending = h.click("inspect"); await flush(); const oldRequest = h.calls.at(-1);
  h.visibility("hidden"); h.visibility("visible");
  assert.equal(oldRequest.init.signal.aborted, true); assert.equal(h.calls.length, 3);
  const fresh = delayedJson(recall(row, "New explicit pending view")); h.enqueue(fresh.response);
  const freshPending = h.click("inspect"); await flush(); headers.resolve(); await oldPending;
  assert.equal(h.action("inspect").disabled, true, "the old finally handler does not clear the new request's busy ownership");
  assert.equal(h.text().includes("Old hidden header view"), false); assert.equal(h.text().includes("memory.live.error"), false);
  assert.equal(fresh.cancellations, 0); assert.equal(fresh.release(), "delivered"); await freshPending;
  assert.ok(h.text().includes("New explicit pending view")); assert.equal(h.calls.length, 4); assert.equal(h.focusEvents.length, 0);
});

for (const phase of ["headers", "body"]) test(`a recall lease exhausted during delayed ${phase} never reaches the view`, async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select(); h.change("memory-consent", true);
  const value = recall(row, "Expired in flight", { leaseMs: 1_000, checkedAt: new Date(h.clock.now).toISOString() });
  const headers = deferred(), body = phase === "body" ? delayedJson(value) : null;
  h.enqueue(body ? body.response : async () => { await headers.promise; return value; });
  const pending = h.click("inspect"); await flush(); h.advance(1_000);
  if (body) { assert.equal(body.cancellations, 0); assert.equal(body.release(), "delivered"); } else headers.resolve();
  await pending;
  assert.equal(h.text().includes("Expired in flight"), false); assert.equal(h.text().includes("memory.live.coverage"), false);
  assert.equal(h.field("memory-consent").attributes.get(".checked"), true); assert.equal(h.action("inspect").disabled, false);
  assert.equal(h.calls.length, 3); assert.equal(h.mutations().length, 0); assert.equal(h.focusEvents.length, 0);
});

for (const clock of ["now", "monotonic"]) test(`a ${clock} regression permanently retires the shown recall lease`, async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  h.enqueue(recall(row, "Regressed-clock view")); await h.click("inspect"); assert.ok(h.text().includes("Regressed-clock view"));
  const receipt = h.recallReceipts.at(-1), renders = h.renderCount();
  h.clock[clock] -= 1; h.dispatchWindow("focus");
  assert.equal(receipt.retireCalls, 1, "focus callback must observe and retire during the regression");
  assert.equal(h.renderCount(), renders);
  h.clock[clock] += 1; h.visibility();
  assert.equal(h.renderCount(), renders, "clocks recover before any rendering, so render cannot detect the earlier regression");
  assert.equal(receipt.retireCalls, 1); assert.equal(h.text().includes("Regressed-clock view"), false);
  assert.equal(h.calls.length, 3); assert.equal(h.focusEvents.length, 0);
});

test("an empty recall result has the same bounded view lifetime and is not cached indefinitely", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const value = recall(row, "unused", { leaseMs: 1_000, checkedAt: new Date(h.clock.now).toISOString() });
  value.sources = []; value.rollingConversation.recent = []; value.consumption = {};
  value.coverage.sourceCount = 0;
  h.enqueue(value); await h.click("inspect");
  assert.ok(h.text().includes("memory.live.coverage [0]")); assert.ok(h.text().includes("memory.live.noRecall"));
  h.advance(1_000); h.fireTimer();
  assert.equal(h.text().includes("memory.live.coverage"), false); assert.equal(h.text().includes("memory.live.noRecall"), false);
  assert.equal(h.calls.length, 3); assert.equal(h.focusEvents.length, 0);
});

for (const wake of ["timer", "visibility", "focus"]) test(`${wake} enrollment expiry retires a stalled Inspect before its body settles`, async t => {
  const row = enrollment({ expiresAt: new Date(Date.now() + 60_000).toISOString() }), h = fixture(t, { initial: settings([row]) });
  await flush(); await h.select();
  const ownerSignal = h.calls.at(-1).init.signal, projection = h.state.projection;
  const readDraft = () => Object.fromEntries([
    ["memory-learn", ".checked"], ["memory-recall", ".checked"], ["memory-background", ".checked"],
    ["memory-retention", ".value"], ["memory-expiry", ".value"], ["memory-timezone", ".value"], ["memory-consent", ".checked"],
  ].map(([name, attribute]) => [name, h.field(name).attributes.get(attribute)]));
  const draft = readDraft();
  const delayed = delayedJson(recall(row, "Expired pending body", { checkedAt: new Date(h.clock.now).toISOString() }));
  h.enqueue(delayed.response); const pending = h.click("inspect"); await flush(); const request = h.calls.at(-1);
  assert.equal(delayed.cancellations, 0); assert.equal(request.init.signal.aborted, false);
  const renders = h.renderCount(); h.advance(61_000);
  if (wake === "timer") h.fireTimer(); else if (wake === "visibility") h.visibility(); else h.dispatchWindow("focus");
  assert.equal(h.renderCount(), renders, "the lifecycle callback retires the request before render or response settlement");
  assert.equal(request.init.signal.aborted, true); assert.equal(delayed.cancellations, 1);
  assert.equal(ownerSignal.aborted, false, "expiry cancels only Inspect, not the settings owner");
  assert.equal(h.action("reload").disabled, false); assert.equal(h.action("forget").disabled, false);
  assert.equal(h.action("inspect").disabled, true); assert.equal(h.timers.size, 0);
  assert.equal(h.field("memory-document").attributes.get(".value"), row.documentId);
  assert.equal(h.state.projection, projection); assert.deepEqual(readDraft(), draft);
  assert.equal(h.calls.length, 3, "expiry does not fetch settings, enroll or automatically re-Inspect");
  assert.equal(delayed.release(), "cancelled", "the late producer cannot deliver retired private bytes");
  await pending; await flush();
  assert.equal(delayed.cancellations, 1); assert.equal(h.recallReceipts.length, 0);
  assert.equal(h.text().includes("Expired pending body"), false); assert.equal(h.text().includes("memory.live.coverage"), false);
  assert.equal(h.text().includes("memory.live.error"), false); assert.equal(h.text().includes("memory.live.busy"), false);
  assert.equal(h.action("reload").disabled, false); assert.equal(h.action("forget").disabled, false);
  assert.deepEqual(readDraft(), draft); assert.equal(h.field("memory-document").attributes.get(".value"), row.documentId);
  assert.equal(h.calls.length, 3); assert.equal(h.mutations().length, 0); assert.equal(h.focusEvents.length, 0);
});

for (const wake of ["timer", "visibility", "focus"]) test(`${wake} expiry clears prior consent and recall; fresh future-date consent can renew`, async t => {
  const row = enrollment({ expiresAt: new Date(Date.now() + 60_000).toISOString() }), h = fixture(t, { initial: settings([row]) });
  await flush(); await h.select(); h.enqueue(recall(row, "Expired consent excerpt")); await h.click("inspect");
  h.change("memory-consent", true); assert.equal(h.field("memory-consent").attributes.get(".checked"), true);
  h.advance(61_000);
  if (wake === "timer") h.fireTimer(); else if (wake === "visibility") h.visibility(); else h.dispatchWindow("focus");
  assert.equal(h.field("memory-consent").attributes.get(".checked"), false); assert.equal(h.text().includes("Expired consent excerpt"), false);
  assert.equal(h.action("inspect").disabled, true); assert.equal(h.all().some(control => control.label === "memory.live.stop"), false);
  h.change("memory-expiry", new Date(h.clock.now + 20 * 86_400_000).toISOString().slice(0, 10)); h.change("memory-consent", true);
  h.visibility(); assert.equal(h.field("memory-consent").attributes.get(".checked"), true, "expiry is latched, not a ban on fresh renewal consent");
  assert.equal(h.action("save").disabled, false); assert.equal(h.mutations().length, 0);
});

for (const wake of ["timer", "visibility"]) test(`${wake} access expiry retires private recall and consent even with unchanged actor/project`, async t => {
  const session = sharedSession(); session.projectContext.expiresAt = new Date(Date.now() + 60_000).toISOString();
  const row = enrollment({ organizationId: "fixture-org" }), h = fixture(t, { initial: settings([row]), session }); await flush(); await h.select();
  h.enqueue(recall(row, "Expired organization access excerpt")); await h.click("inspect"); h.change("memory-consent", true);
  const before = h.component.captureCommandDeparture(); h.advance(61_000);
  if (wake === "timer") { h.enqueue(settings([row])); h.fireTimer(); await flush(); } else h.visibility();
  assert.equal(h.text().includes("Expired organization access excerpt"), false); assert.equal(before.current(), false);
  assert.equal(h.all().some(control => control.tag === "form"), false); assert.equal(h.mutations().length, 0);
});

test("long privacy deadlines are clamped and an early timer does not expire valid consent", async t => {
  const row = enrollment({ expiresAt: future(100) }), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  h.change("memory-consent", true); assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, 2_147_483_647);
  h.advance(2_147_483_647); h.fireTimer();
  assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, 2_147_483_647);
  assert.equal(h.field("memory-consent").attributes.get(".checked"), true); assert.equal(h.calls.length, 2);
  h.advance(Date.parse(row.expiresAt) - h.clock.now + 1); h.fireTimer();
  assert.equal(h.field("memory-consent").attributes.get(".checked"), false); assert.equal(h.timers.size, 0);
});

for (const advertised of ["missing", "unknown"]) test(`${advertised} write-contract advertisement blocks PUT but preserves own metadata and Forget`, async t => {
  const page = settings([enrollment()]);
  if (advertised === "missing") delete page.writeContractVersion; else page.writeContractVersion = "memory-settings-custody-v99";
  const h = fixture(t, { initial: page }); await flush(); await h.select();
  assert.ok(h.text().includes("Fixture document")); assert.equal(h.action("save").disabled, true);
  assert.equal(h.field("memory-consent").disabled, true);
  await h.submit(); assert.equal(h.mutations().length, 0, "form submission never invents support for the custody contract");
  const stop = h.all().find(control => control.label === "memory.live.stop");
  if (stop) { assert.equal(stop.disabled, true); await h.invoke(stop, "@click").result; }
  assert.equal(h.mutations().length, 0); assert.equal(h.action("forget").disabled, false);
  h.confirmations.push(true); h.enqueue(forgotten()); h.enqueue({ ...page, enrollments: [] }); await h.click("forget");
  assert.deepEqual(h.mutations().map(call => call.init.method), ["DELETE"]);
  assert.deepEqual(h.mutations()[0].body, { revision: 1, confirmation: "FORGET_MY_MEMORY" });
  assert.ok(h.text().includes("memory.live.forgot"));
});

for (const field of ["organizationId", "projectAccessId", "ownerUserId"]) test(`same-session ${field} change discards local selection and consent without a source generation bump`, async t => {
  const row = enrollment({ organizationId: "fixture-org" }), h = fixture(t, { initial: settings([row]), session: sharedSession() });
  await flush(); await h.select(); chooseConsent(h);
  const previous = h.component.captureCommandDeparture(), source = h.state.source, authorization = h.state.authorization, session = h.state.session;
  h.state.session.projectContext[field] = "changed-" + field; h.state.session.projects[0][field] = "changed-" + field;
  h.enqueue(settings([row])); h.notify(); await flush();
  assert.equal(h.state.session, session); assert.equal(h.state.source, source); assert.equal(h.state.authorization, authorization);
  assert.equal(previous.current(), false); assert.equal(h.field("memory-document").attributes.get(".value"), "");
  assert.equal(h.all().some(control => control.tag === "form"), false); assert.equal(h.mutations().length, 0);
});

for (const field of ["organizationId", "projectAccessId", "ownerUserId"]) test(`pending PUT cannot publish under changed ${field} with unchanged actor/source generation`, async t => {
  const row = enrollment({ organizationId: "fixture-org" }), h = fixture(t, { initial: settings([row]), session: sharedSession() });
  await flush(); await h.select(); chooseConsent(h); let delayed;
  h.enqueue((_url, init) => { const value = saved(JSON.parse(init.body)); value.enrollment.organizationId = "fixture-org";
    delayed = delayedJson(value); return delayed.response; });
  const pending = h.submit(); await flush(); const oldRequest = h.mutations()[0], source = h.state.source, authorization = h.state.authorization;
  h.state.session.projectContext[field] = "changed-" + field; h.state.session.projects[0][field] = "changed-" + field;
  h.enqueue(settings([row])); h.notify(); await flush();
  assert.equal(delayed.cancellations, 1); assert.equal(delayed.release(), "cancelled"); await pending; await flush();
  assert.equal(h.state.source, source); assert.equal(h.state.authorization, authorization); assert.equal(oldRequest.init.signal.aborted, true);
  assert.deepEqual(oldRequest.body.expectedCustody, { kind: "organization", organizationId: "fixture-org", projectAccessId: "fixture-access", ownerUserId: "fixture-owner" });
  assert.equal(h.calls.length, 4, "superseded custody does not dispatch a post-PUT refresh or retry");
  assert.equal(h.mutations().length, 1); assert.equal(h.text().includes("memory.live.savedMessage"), false);
  assert.equal(h.text().includes("memory.live.savedCleared"), false);
  assert.equal(h.field("memory-document").attributes.get(".value"), "");
});

test("personal-to-organization adoption in the same session invalidates personal consent", async t => {
  const h = fixture(t); await flush(); await h.select(); chooseConsent(h); const previous = h.component.captureCommandDeparture();
  const source = h.state.source, authorization = h.state.authorization, session = h.state.session, shared = sharedSession();
  h.state.session.projects = shared.projects; h.state.session.projectContext = shared.projectContext;
  h.enqueue(settings()); h.notify(); await flush();
  assert.equal(h.state.session, session); assert.equal(h.state.source, source); assert.equal(h.state.authorization, authorization);
  assert.equal(previous.current(), false); assert.equal(h.field("memory-document").attributes.get(".value"), "");
  assert.equal(h.mutations().length, 0);
  await h.select(); chooseConsent(h); let acknowledgement;
  h.enqueue((_url, init) => { acknowledgement = saved(JSON.parse(init.body)); acknowledgement.enrollment.organizationId = "fixture-org"; return acknowledgement; });
  h.enqueue(() => settings([acknowledgement.enrollment])); await h.submit();
  assert.deepEqual(h.mutations()[0].body.expectedCustody, { kind: "organization", organizationId: "fixture-org", projectAccessId: "fixture-access", ownerUserId: "fixture-owner" });
});

for (const action of ["save", "stop"]) test(`${action} custody conflict retires selection and requires explicit refresh, reselection and consent`, async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  if (action === "save") chooseConsent(h);
  h.enqueue(Response.json({ error: "memory_custody_changed" }, { status: 409 }));
  await (action === "save" ? h.submit() : h.click("stop")); await flush();
  assert.equal(h.calls.length, 3); assert.equal(h.mutations().length, 1); assert.ok(h.text().includes("memory.live.custodyChanged"));
  assert.equal(h.all().some(control => control.tag === "form" || control.attributes.get("name") === "memory-document"), false);
  assert.equal(h.action("reload").disabled, false); assert.equal(h.component.captureCommandDeparture().blocked(), false);
  assert.equal(h.focusEvents.length, 0, "the former mutation owner cannot restore focus after custody reset");
  h.enqueue(settings([row])); h.click("reload"); await flush(); assert.equal(h.calls.length, 4);
  assert.equal(h.field("memory-document").attributes.get(".value"), ""); assert.equal(h.mutations().length, 1);
  await h.select(); assert.equal(h.field("memory-consent").attributes.get(".checked"), false); assert.equal(h.action("save").disabled, true);
  chooseConsent(h); let acknowledgement;
  h.enqueue((_url, init) => { acknowledgement = saved(JSON.parse(init.body)); return acknowledgement; });
  h.enqueue(() => settings([acknowledgement.enrollment])); await h.submit();
  assert.equal(h.mutations().length, 2, "only the renewed explicit action sends another PUT");
  assert.deepEqual(h.mutations()[1].body.expectedCustody, { kind: "personal" });
});

test("missing organization owner identity cannot become an inferred personal consent", async t => {
  const session = sharedSession(); delete session.projectContext.ownerUserId;
  const h = fixture(t, { session, initial: settings([enrollment({ organizationId: "fixture-org" })]) }); await flush(); await h.select();
  assert.equal(h.all().some(control => control.tag === "form"), false); assert.equal(h.mutations().length, 0);
  assert.equal(h.action("forget").disabled, false, "an incomplete write tuple does not disable actor-owned erasure");
});

for (const [existing, priorMemoryCleared, notice] of [[true, true, "savedCleared"], [true, false, "savedMessage"], [false, true, "savedMessage"]])
  test(`${existing ? "existing" : "fresh"} Save with priorMemoryCleared=${priorMemoryCleared} uses an honest acknowledgement`, async t => {
    const h = fixture(t, { initial: settings(existing ? [enrollment()] : []) }); await flush(); await h.select(); chooseConsent(h); let acknowledgement;
    h.enqueue((_url, init) => { acknowledgement = { ...saved(JSON.parse(init.body)), priorMemoryCleared }; return acknowledgement; });
    h.enqueue(() => settings([acknowledgement.enrollment])); await h.submit();
    assert.ok(h.text().includes(`memory.live.${notice}`));
    assert.equal(h.text().includes(`memory.live.${notice === "savedCleared" ? "savedMessage" : "savedCleared"}`), false);
    assert.equal(h.mutations().length, 1);
  });

for (const action of ["save", "stop", "forget"]) test(`successful ${action} refresh restores through the finite focus lease to Refresh settings`, async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  if (action === "forget") { h.confirmations.push(true); h.enqueue(forgotten()); h.enqueue(settings()); await h.click("forget"); }
  else {
    if (action === "save") chooseConsent(h);
    let acknowledgement; h.enqueue((_url, init) => { acknowledgement = saved(JSON.parse(init.body)); return acknowledgement; });
    h.enqueue(() => settings([acknowledgement.enrollment])); await (action === "save" ? h.submit() : h.click("stop"));
  }
  assert.equal(h.focusEvents.length, 1); assert.equal(h.focused().attributes.get("data-memory-action"), "refresh");
  assert.deepEqual(h.focusEvents[0].options, { preventScroll: true }); assert.ok(h.focusLeases.every(lease => lease.disposed));
});

test("Hide restores through the finite focus lease to Inspect for the same enrollment", async t => {
  const row = enrollment(), other = enrollment({ id: fixtureId(2), documentId: "other-document" });
  const h = fixture(t, { initial: settings([row, other]) }); await flush(); await h.select();
  h.enqueue(recall(row)); await h.click("inspect"); await h.click("hide");
  assert.equal(h.focusEvents.length, 1); assert.equal(h.focused().attributes.get("data-memory-action"), "inspect");
  assert.equal(h.focused().attributes.get("data-memory-enrollment"), row.id); assert.equal(h.calls.length, 3);
  assert.equal(h.text().includes("Synthetic private excerpt"), false);
});

for (const wake of ["timer", "visibility", "focus", "render"]) test(`${wake} expiry restores owned focus from Hide to the same enrollment Inspect`, async t => {
  const row = enrollment(), other = enrollment({ id: fixtureId(2), documentId: "other-document" });
  const h = fixture(t, { initial: settings([row, other]) }); await flush(); await h.select();
  h.enqueue(recall(row, "Focused expiring view", { leaseMs: 1_000, checkedAt: new Date(h.clock.now).toISOString() })); await h.click("inspect");
  const hide = h.action("hide"); assert.equal(hide.inRecallSubtree, true); h.focus(hide);
  const finishUpdate = h.holdUpdates(), receipt = h.recallReceipts.at(-1), renders = h.renderCount();
  h.advance(1_000);
  if (wake === "timer") h.fireTimer(); else if (wake === "visibility") h.visibility(); else if (wake === "focus") h.dispatchWindow("focus"); else h.render();
  assert.equal(receipt.retireCalls, 1);
  assert.equal(h.renderCount(), renders + (wake === "render" ? 1 : 0), "foreground event cleanup does not depend on rendering");
  assert.equal(h.focusLeases.length, 1, "only the disappearing subtree acquires a continuity lease");
  assert.equal(h.focusEvents.length, 0, "focus waits for updateComplete instead of targeting old markup");
  finishUpdate(); await flush();
  assert.equal(h.focusEvents.length, 1); assert.equal(h.focused().attributes.get("data-memory-action"), "inspect");
  assert.equal(h.focused().attributes.get("data-memory-enrollment"), row.id);
  assert.deepEqual(h.focusEvents[0].options, { preventScroll: true }); assert.ok(h.focusLeases.every(lease => lease.disposed));
  assert.equal(h.text().includes("Focused expiring view"), false); assert.equal(h.calls.length, 3); assert.equal(h.mutations().length, 0);
});

for (const boundary of ["joint expiry", "enrollment expiry during update", "enrollment expiry before lease expiry"])
  test(`${boundary} restores owned focus to enabled Refresh without requesting anything`, async t => {
    const row = enrollment({ expiresAt: new Date(Date.now() + 10_000).toISOString() });
    const h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
    const enrollmentBudget = Date.parse(row.expiresAt) - h.clock.now;
    assert.ok(enrollmentBudget > 0);
    const serverOffset = boundary === "enrollment expiry before lease expiry" ? -5_000 : 0;
    const leaseMs = boundary === "enrollment expiry during update" ? Math.floor(enrollmentBudget / 2) : enrollmentBudget - serverOffset;
    h.enqueue(recall(row, "Enrollment-ending view", { leaseMs, checkedAt: new Date(h.clock.now + serverOffset).toISOString() }));
    await h.click("inspect"); h.focus(h.action("hide"));
    assert.equal([...h.timers.values()][0].delay, Math.min(enrollmentBudget, leaseMs));
    const finishUpdate = h.holdUpdates(), receipt = h.recallReceipts.at(-1), renders = h.renderCount();
    h.advance(Math.min(enrollmentBudget, leaseMs)); h.fireTimer();
    assert.equal(receipt.retireCalls, 1); assert.equal(h.renderCount(), renders, "deadline retirement is observed before rendering");
    assert.equal(h.focusLeases.length, 1); assert.equal(h.focusEvents.length, 0);
    if (boundary === "enrollment expiry during update") h.advance(enrollmentBudget - leaseMs);
    finishUpdate(); await flush();
    assert.equal(h.focusEvents.length, 1); assert.equal(h.focused().attributes.get("data-memory-action"), "refresh");
    assert.equal(h.focused().disabled, false); assert.equal(h.action("inspect").disabled, true);
    assert.equal(h.text().includes("Enrollment-ending view"), false); assert.equal(h.text().includes("memory.live.coverage"), false);
    assert.deepEqual(h.focusEvents[0].options, { preventScroll: true }); assert.ok(h.focusLeases.every(lease => lease.disposed));
    assert.equal(h.calls.length, 3, "restoring to Refresh does not activate it or fetch settings"); assert.equal(h.mutations().length, 0);
  });

for (const interruption of ["another focus owner", "another open dialog", "hide then show", "event replacement", "content replacement", "authorization replacement"])
  test(`joint-expiry Refresh continuity does not override ${interruption}`, async t => {
    const row = enrollment({ expiresAt: new Date(Date.now() + 10_000).toISOString() });
    const h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
    const budget = Date.parse(row.expiresAt) - h.clock.now; assert.ok(budget > 0);
    h.enqueue(recall(row, "Interrupted enrollment-ending view", { leaseMs: budget, checkedAt: new Date(h.clock.now).toISOString() }));
    await h.click("inspect"); h.focus(h.action("hide"));
    const finishUpdate = h.holdUpdates(), receipt = h.recallReceipts.at(-1);
    h.advance(budget); h.fireTimer(); assert.equal(receipt.retireCalls, 1); assert.equal(h.focusLeases.length, 1);
    const renders = h.renderCount();
    if (interruption === "another focus owner") h.stealFocus();
    else if (interruption === "another open dialog") h.setDialogOpen(true);
    else if (interruption === "hide then show") { h.visibility("hidden"); h.visibility("visible"); }
    else if (interruption === "event replacement") { h.state.events = []; h.notify(); }
    else if (interruption === "content replacement") { h.state.content = {}; h.notify(); }
    else h.state.authorization++;
    assert.equal(h.renderCount(), renders);
    finishUpdate(); await flush(); h.setDialogOpen(false);
    assert.equal(h.focusEvents.length, 0); assert.ok(h.focusLeases.every(lease => lease.disposed));
    assert.equal(h.calls.length, 3); assert.equal(h.mutations().length, 0);
  });

test("joint expiry with a dirty draft restores to the existing heading without resetting or submitting the draft", async t => {
  const row = enrollment({ expiresAt: new Date(Date.now() + 10_000).toISOString() });
  const h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const budget = Date.parse(row.expiresAt) - h.clock.now; assert.ok(budget > 0);
  h.enqueue(recall(row, "Dirty-draft expiring view", { leaseMs: budget, checkedAt: new Date(h.clock.now).toISOString() }));
  await h.click("inspect");
  const renewalDate = new Date(h.clock.now + 20 * 86_400_000).toISOString().slice(0, 10);
  h.change("memory-retention", "45"); h.change("memory-expiry", renewalDate);
  assert.equal(h.action("reload").disabled, true); assert.equal(h.component.captureCommandDeparture().blocked(), true);
  h.focus(h.action("hide")); const finishUpdate = h.holdUpdates(), receipt = h.recallReceipts.at(-1), renders = h.renderCount();
  h.advance(budget); h.fireTimer();
  assert.equal(receipt.retireCalls, 1); assert.equal(h.renderCount(), renders); assert.equal(h.focusEvents.length, 0);
  finishUpdate(); await flush();
  assert.equal(h.focusEvents.length, 1); assert.equal(h.focused().tag, "h2");
  assert.equal(h.focused().attributes.get("data-memory-focus"), "heading");
  assert.equal(h.focused().attributes.get("tabindex"), "-1", "the existing heading is programmatically focusable, not a new sequential tab stop");
  assert.deepEqual(h.focusEvents[0].options, { preventScroll: true }, "ordinary memory heading fallback keeps its existing scroll policy");
  assert.equal(h.focused().attributes.has("@click"), false); assert.equal(h.focused().disabled, false);
  assert.equal(h.action("inspect").disabled, true); assert.equal(h.action("reload").disabled, true);
  assert.equal(h.field("memory-retention").attributes.get(".value"), "45");
  assert.equal(h.field("memory-expiry").attributes.get(".value"), renewalDate);
  assert.equal(h.component.captureCommandDeparture().blocked(), true, "the unsaved draft still blocks departure");
  assert.equal(h.field("memory-consent").attributes.get(".checked"), false, "expiry does not grant fresh consent");
  assert.equal(h.text().includes("Dirty-draft expiring view"), false); assert.equal(h.calls.length, 3); assert.equal(h.mutations().length, 0);
  assert.ok(h.focusLeases.every(lease => lease.disposed));
});

for (const location of ["outside", "consent field", "Inspect button"]) test(`expiry does not move focus from the ${location}`, async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  h.enqueue(recall(row, "Unfocused expiring view", { leaseMs: 1_000, checkedAt: new Date(h.clock.now).toISOString() })); await h.click("inspect");
  if (location === "outside") h.stealFocus(); else h.focus(location === "consent field" ? h.field("memory-consent") : h.action("inspect"));
  const receipt = h.recallReceipts.at(-1), renders = h.renderCount(); h.advance(1_000); h.fireTimer();
  assert.equal(receipt.retireCalls, 1); assert.equal(h.renderCount(), renders); assert.equal(h.focusLeases.length, 0);
  await flush(); assert.equal(h.focusEvents.length, 0); assert.equal(h.calls.length, 3);
});

for (const interruption of ["another focus owner", "another open dialog", "background", "hide then show", "source replacement", "authorization replacement", "disconnect"])
  test(`expiry focus continuity retires after ${interruption} before update completion`, async t => {
    const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
    h.enqueue(recall(row, "Interrupted expiry view", { leaseMs: 1_000, checkedAt: new Date(h.clock.now).toISOString() })); await h.click("inspect");
    h.focus(h.action("hide")); const finishUpdate = h.holdUpdates(), receipt = h.recallReceipts.at(-1);
    h.advance(1_000); h.fireTimer(); assert.equal(receipt.retireCalls, 1); assert.equal(h.focusLeases.length, 1);
    const renders = h.renderCount();
    if (interruption === "another focus owner") h.stealFocus();
    else if (interruption === "another open dialog") h.setDialogOpen(true);
    else if (interruption === "background" || interruption === "hide then show") {
      h.visibility("hidden"); if (interruption === "hide then show") h.visibility("visible");
    } else if (interruption === "source replacement") { h.state.events = []; h.notify(); }
    else if (interruption === "authorization replacement") h.state.authorization++;
    else h.disconnect();
    assert.equal(h.renderCount(), renders, "interruption is observed without render fallback");
    finishUpdate(); await flush(); h.setDialogOpen(false);
    assert.equal(h.focusEvents.length, 0); assert.ok(h.focusLeases.every(lease => lease.disposed));
    assert.equal(h.calls.length, 3); assert.equal(h.mutations().length, 0);
  });

for (const kind of ["events", "content"]) test(`simultaneous ${kind} withdrawal and expiry cannot capture recall focus`, async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  h.enqueue(recall(row, "Withdrawn focused view", { leaseMs: 1_000, checkedAt: new Date(h.clock.now).toISOString() })); await h.click("inspect");
  h.focus(h.action("hide")); const receipt = h.recallReceipts.at(-1), renders = h.renderCount();
  h.advance(1_000); h.state[kind] = kind === "events" ? [] : {}; h.notify();
  assert.equal(receipt.retireCalls, 1); assert.equal(h.renderCount(), renders); assert.equal(h.focusLeases.length, 0);
  await flush(); assert.equal(h.focusEvents.length, 0); assert.equal(h.calls.length, 3);
});

test("background retirement of focused recall never captures or restores focus", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  h.enqueue(recall(row, "Focused background view")); await h.click("inspect"); h.focus(h.action("hide"));
  const receipt = h.recallReceipts.at(-1), renders = h.renderCount();
  h.visibility("hidden"); h.visibility("visible");
  assert.equal(receipt.retireCalls, 1); assert.equal(h.renderCount(), renders); assert.equal(h.focusLeases.length, 0);
  await flush(); assert.equal(h.focusEvents.length, 0); assert.equal(h.calls.length, 3);
});

for (const interruption of ["another focus owner", "another open dialog"]) test(`mutation completion does not steal focus from ${interruption}`, async t => {
  const h = fixture(t); await flush(); await h.select(); chooseConsent(h); const response = deferred(); let acknowledgement;
  h.enqueue(async (_url, init) => { acknowledgement = saved(JSON.parse(init.body)); await response.promise; return acknowledgement; });
  h.enqueue(() => settings([acknowledgement.enrollment])); const pending = h.submit(); await flush();
  if (interruption === "another focus owner") h.stealFocus(); else h.setDialogOpen(true);
  response.resolve(); await pending; h.setDialogOpen(false);
  assert.equal(h.mutations().length, 1); assert.ok(h.text().includes("memory.live.savedMessage"));
  assert.equal(h.focusEvents.length, 0); assert.ok(h.focusLeases.every(lease => lease.disposed));
});

for (const [field, invalid, valid, message] of [["retention", "0", "30", "invalidRetention"],
  ["expiry", invalidFutureCalendarDate(), future(20).slice(0, 10), "invalidExpiry"], ["timezone", "Not/AZone", "UTC", "invalidTimeZone"]])
  test(`${field} validation is associated with the specific field and clears on edit`, async t => {
    const h = fixture(t); await flush(); await h.select(); chooseConsent(h); h.change("memory-" + field, invalid); h.change("memory-consent", true);
    assert.equal(h.all().find(item => item.tag === "form").attributes.has("novalidate"), true,
      "browser constraint bubbles must not prevent the localized submit validation from running");
    await h.submit(); const control = h.field("memory-" + field), description = control.attributes.get("aria-describedby");
    assert.equal(control.attributes.get("aria-invalid"), "true"); assert.equal(typeof description, "string"); assert.notEqual(description, "");
    const errors = h.all().filter(item => item.tag === "span" && item.attributes.get("id") === description);
    assert.equal(errors.length, 1); assert.equal(errors[0].attributes.get("role"), "alert"); assert.equal(errors[0].label, "memory.live." + message);
    assert.equal(h.focused().attributes.get("name"), "memory-" + field); assert.equal(h.mutations().length, 0);
    h.change("memory-" + field, valid); assert.equal(h.field("memory-" + field).attributes.get("aria-invalid"), "false");
    assert.equal(h.field("memory-" + field).attributes.get("aria-describedby"), nothing);
    assert.equal(h.all().some(item => item.attributes.get("id") === description), false);
    assert.equal(h.field("memory-consent").attributes.get(".checked"), false);
  });

test("invalid-field focus waits for update completion and does not override intervening focus", async t => {
  const h = fixture(t); await flush(); await h.select(); chooseConsent(h); h.change("memory-timezone", "Not/AZone"); h.change("memory-consent", true);
  const finishUpdate = h.holdUpdates(), pending = h.submit(); h.stealFocus(); finishUpdate(); await pending;
  assert.equal(h.field("memory-timezone").attributes.get("aria-invalid"), "true"); assert.equal(h.focusEvents.length, 0);
  assert.equal(h.mutations().length, 0); assert.ok(h.focusLeases.every(lease => lease.disposed));
});

// Separately consented palette controls: real strict client/kernel, finite HTTP and DOM ports.
function paletteGrant(item, overrides = {}) {
  return { grantId: "private-palette-grant", revision: 1, organizationId: item.organizationId, projectAccessId: null,
    ownerUserId: "fixture-user", projectId: item.projectId, documentId: item.documentId, enrollmentId: item.id,
    enrollmentRevision: item.revision, policyVersion: DOCUMENT_PROFILE_POLICY, recipeVersion: NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE,
    infer: true, inspect: true, background: false, sourceAfterSequence: 10,
    consentedAt: new Date(Date.now() - 86_400_000).toISOString(), expiresAt: item.expiresAt, retentionDays: item.retentionDays,
    revokedAt: null, ...overrides };
}
function paletteSettings(item, grant = paletteGrant(item), overrides = {}) {
  return { version: DOCUMENT_PROFILE_CONTROL_VERSION, enabled: true, policyVersion: DOCUMENT_PROFILE_POLICY,
    recipeVersion: NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE, purpose: "authored-palette-organization", backgroundSupported: false,
    scope: { projectId: item.projectId, documentId: item.documentId, custody: { kind: "personal" } },
    parent: { enrollmentId: item.id, enrollmentRevision: item.revision, expiresAt: item.expiresAt, retentionDays: item.retentionDays },
    grant, grantCurrent: grant !== null, ...overrides };
}
function paletteProfile(h, grant, { leaseMs = 60_000, empty = false } = {}) {
  const at = new Date(h.clock.now).toISOString();
  const evidence = (index, intent, lineage) => ({ blockId: "private-palette-block-" + index, intent, lineage, independentEvidence: false,
    sources: [{ eventId: "private-palette-event-" + index, sequence: 11 + index, type: "ChipEdited", recordedAt: at }] });
  return { version: DOCUMENT_PROFILE_CONTROL_VERSION, profile: { version: NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE,
    treatment: "document-authored-palette-choices", inferredPreferences: false, independentEvidence: false,
    scope: { organizationId: grant.organizationId, projectAccessId: grant.projectAccessId, projectId: grant.projectId, documentId: grant.documentId },
    grant: { id: grant.grantId, revision: grant.revision }, lifetime: { checkedAt: at,
      validUntil: new Date(Math.min(h.clock.now + leaseMs, Date.parse(grant.expiresAt))).toISOString() },
    coverage: { bounded: true, completeHistory: false, blockLimit: 16, sourceLimit: 128, selectedBlockCount: empty ? 0 : 3, eligibleChoiceCount: empty ? 0 : 1 },
    choices: empty ? [] : [{ claimKey: fixtureId(904), colors: ["#123abc", "#ffffff", "#123abc"], status: "conflicted",
      supports: [evidence(0, "prefer", "unknown")], counterevidence: [evidence(1, "avoid", "assisted"), evidence(2, "prohibit", "copy")] }] } };
}
const profileActions = h => h.calls.filter(call => String(call.url).startsWith("/api/memory/document-profile/"));
function profileAction(h, key) {
  const label = h.component.i18n.locale === "en" ? personalMemoryMessage("en", "memory.live." + key) : personalMemoryMessage(h.component.i18n.locale, "memory.live." + key);
  const matches = h.all().filter(control => control.tag === "button" && ["memory.live." + key, label].includes(control.label));
  assert.equal(matches.length, 1, "one explicit " + key); return matches[0];
}
const profileClick = (h, key) => { const control = profileAction(h, key); return control.disabled ? false : h.invoke(control, "@click").result; };
function profileToggle(h, open) {
  const details = h.all().find(control => control.attributes.has("data-memory-profile")); assert.ok(details);
  return h.invoke(details, "@toggle", { currentTarget: { ...h.target(details), open } }).result;
}
function profileSubmit(h) {
  const form = h.all().find(control => control.attributes.has("data-memory-profile-form")); assert.ok(form);
  return h.invoke(form, "@submit").result;
}
function profileConsent(h) {
  h.change("memory-profile-organize", true); h.change("memory-profile-inspect", true); h.change("memory-profile-consent", true);
}
async function profileFixture(t, { item = enrollment(), grant = paletteGrant(item), control, locale = "en", localized = false } = {}) {
  const h = fixture(t, { initial: settings([item]), locale, localized }); await flush(); await h.select(item.documentId);
  profileToggle(h, true); h.enqueue(control ?? paletteSettings(item, grant)); await profileClick(h, "profileLoad");
  return { h, item, grant };
}

test("palette mount, document selection and disclosure opening do not load or enroll a profile", async t => {
  const item = enrollment(), h = fixture(t, { initial: settings([item]) }); await flush();
  assert.equal(profileActions(h).length, 0); await h.select(); profileToggle(h, true);
  assert.equal(profileActions(h).length, 0); assert.match(h.text(), /memory.live.profileNotLoaded/u);
  assert.equal(h.all().some(control => control.attributes.has("data-memory-profile-form")), false);
  h.enqueue(paletteSettings(item, null)); await profileClick(h, "profileLoad");
  assert.equal(profileActions(h).length, 1); assert.equal(profileActions(h)[0].init.method, "GET");
  assert.equal(profileActions(h)[0].url, "/api/memory/document-profile/settings?projectId=fixture-project&documentId=fixture-document");
  for (const field of ["organize", "inspect", "consent"]) assert.equal(h.field("memory-profile-" + field).attributes.get(".checked"), false);
  assert.equal(profileAction(h, "profileEnable").disabled, true); assert.equal(h.mutations().length, 0);
});

test("palette confirmation is separate, exact and manual; successful save does not inspect", async t => {
  const { h, item } = await profileFixture(t, { grant: null });
  await profileSubmit(h); assert.equal(h.mutations().length, 0);
  h.change("memory-profile-consent", true); await profileSubmit(h); assert.equal(h.mutations().length, 0);
  h.change("memory-profile-organize", true); assert.equal(h.field("memory-profile-consent").attributes.get(".checked"), false);
  h.change("memory-profile-inspect", true); await profileSubmit(h); assert.equal(h.mutations().length, 0);
  h.change("memory-profile-consent", true);
  h.enqueue((_url, init) => { const draft = JSON.parse(init.body), grant = paletteGrant(item, { consentedAt: new Date(h.clock.now).toISOString() });
    assert.deepEqual(draft, { version: DOCUMENT_PROFILE_CONTROL_VERSION, policyVersion: DOCUMENT_PROFILE_POLICY,
      recipeVersion: NATIVE_DOCUMENT_PALETTE_CHOICE_RECIPE, projectId: item.projectId, documentId: item.documentId,
      enrollmentId: item.id, enrollmentRevision: item.revision, revision: 0, expectedCustody: { kind: "personal" },
      infer: true, inspect: true, background: false, retentionDays: item.retentionDays, expiresAt: item.expiresAt,
      confirmation: "ENABLE_DOCUMENT_PALETTE_PROFILE" });
    return { version: DOCUMENT_PROFILE_CONTROL_VERSION, grant, historyStartsAfterSequence: grant.sourceAfterSequence }; });
  await profileSubmit(h); assert.match(h.text(), /memory.live.profileSaved/u);
  assert.equal(profileActions(h).length, 2); assert.equal(profileAction(h, "profileInspect").disabled, false);
  assert.equal(h.field("memory-consent").attributes.get(".checked"), false);
  assert.equal(h.field("memory-profile-consent").attributes.get(".checked"), false);
});

test("palette save preserves a newer palette draft and never changes the reference draft", async t => {
  const { h, item } = await profileFixture(t, { grant: null }); profileConsent(h);
  const response = deferred(); h.enqueue(() => response.promise); const pending = profileSubmit(h); await flush();
  profileConsent(h); h.change("memory-profile-organize", false); h.change("memory-consent", true);
  const grant = paletteGrant(item); response.resolve({ version: DOCUMENT_PROFILE_CONTROL_VERSION, grant, historyStartsAfterSequence: grant.sourceAfterSequence });
  await pending; assert.match(h.text(), /memory.live.profileSaved/u);
  assert.equal(h.field("memory-profile-organize").attributes.get(".checked"), false);
  assert.equal(h.field("memory-profile-inspect").attributes.get(".checked"), true);
  assert.equal(h.field("memory-profile-consent").attributes.get(".checked"), false);
  assert.equal(h.field("memory-consent").attributes.get(".checked"), true);
});

for (const mode of ["disabled", "stale", "expired-grant", "expired-parent", "learn-only", "parent-null"]) test(`palette ${mode} settings never authorize inspection and preserve explicit revoke`, async t => {
  const item = enrollment(mode === "expired-parent" ? { expiresAt: new Date(Date.now() - 1_000).toISOString() }
    : mode === "learn-only" ? { recall: false } : mode === "stale" ? { revision: 2 } : {});
  const grant = paletteGrant(item, mode === "expired-grant" ? { expiresAt: new Date(Date.now() - 1_000).toISOString() }
    : mode === "stale" ? { enrollmentRevision: 1 } : {});
  const control = paletteSettings(item, grant, { grantCurrent: false, enabled: mode !== "disabled",
    ...(mode === "expired-parent" || mode === "learn-only" || mode === "parent-null" ? { parent: null } : {}) });
  const { h } = await profileFixture(t, { item, grant, control });
  if (mode === "parent-null") { assert.match(h.text(), /memory.live.profileError/u); assert.equal(h.all().some(c => c.label === "memory.live.profileInspect"), false); return; }
  assert.equal(profileAction(h, "profileInspect").disabled, true); assert.equal(profileAction(h, "profileRevoke").disabled, false);
  await h.invoke(profileAction(h, "profileInspect"), "@click").result; assert.equal(profileActions(h).length, 1);
  h.enqueue({ version: DOCUMENT_PROFILE_CONTROL_VERSION, revoked: true, grantId: grant.grantId, revision: grant.revision + 1, reEnrollmentRequired: true });
  await profileClick(h, "profileRevoke"); assert.equal(profileActions(h).at(-1).init.method, "DELETE");
  assert.deepEqual(profileActions(h).at(-1).body, { version: DOCUMENT_PROFILE_CONTROL_VERSION, revision: grant.revision, confirmation: "REVOKE_DOCUMENT_PALETTE_PROFILE" });
  assert.match(h.text(), /memory.live.profileRevoked/u);
});

test("expired palette grant can be re-enabled only with freshly loaded parent and a new explicit confirmation", async t => {
  const item = enrollment(), grant = paletteGrant(item, { expiresAt: new Date(Date.now() - 1_000).toISOString() });
  const { h } = await profileFixture(t, { item, grant, control: paletteSettings(item, grant, { grantCurrent: false }) });
  profileConsent(h); assert.equal(profileAction(h, "profileEnable").disabled, false);
  h.enqueue((_url, init) => { const draft = JSON.parse(init.body); assert.equal(draft.revision, grant.revision);
    const next = paletteGrant(item, { revision: grant.revision + 1 }); return { version: DOCUMENT_PROFILE_CONTROL_VERSION, grant: next, historyStartsAfterSequence: next.sourceAfterSequence }; });
  await profileSubmit(h); assert.match(h.text(), /memory.live.profileSaved/u); assert.equal(profileAction(h, "profileInspect").disabled, false);
});

test("palette inspection shows only safe colors and descriptive lineage references, never raw private identifiers", async t => {
  const { h, grant } = await profileFixture(t); const payload = paletteProfile(h, grant); h.enqueue(payload); await profileClick(h, "profileInspect");
  const text = h.text(); assert.match(text, /data-memory-profile-view/u); assert.match(text, /<code dir="ltr">#123abc<\/code>/u);
  for (const key of ["profileStatus.conflicted", "profileSupports", "profileCounterevidence", "profileLineage.unknown", "profileLineage.assisted", "profileLineage.copy", "profileIntent.prefer", "profileIntent.avoid", "profileIntent.prohibit", "profileLimits", "profileEvidenceMeaning"]) assert.ok(text.includes("memory.live." + key));
  for (const privateValue of [grant.grantId, payload.profile.choices[0].claimKey, "private-palette-block-", "private-palette-event-"]) assert.equal(text.includes(privateValue), false);
  assert.match(text, /memory.live.profileSource \[11\]/u); assert.equal(h.downloads.length, 0);
  assert.equal(profileActions(h).at(-1).init.method, "GET"); assert.equal(profileActions(h).length, 2);
});

test("valid empty palette is bounded empty, unlike unloaded or rejected inspection", async t => {
  const { h, grant } = await profileFixture(t); assert.equal(h.text().includes("data-memory-profile-empty"), false);
  h.enqueue(paletteProfile(h, grant, { empty: true })); await profileClick(h, "profileInspect");
  assert.match(h.text(), /data-memory-profile-empty/u); assert.match(h.text(), /memory.live.profileLimits/u);
  assert.equal(h.all().some(c => c.label === "memory.live.profileSuppress"), false);
});

for (const malformed of ["unknown-version", "html-color", "future-source", "independent", "wrong-grant", "wrong-document", "wrong-count", "missing-profile"]) test(`palette rejects ${malformed} before displaying positive data`, async t => {
  const { h, grant } = await profileFixture(t), body = paletteProfile(h, grant);
  if (malformed === "unknown-version") body.profile.version = "future";
  if (malformed === "html-color") body.profile.choices[0].colors = ["<img src=x onerror=alert(1)>"];
  if (malformed === "future-source") body.profile.choices[0].supports[0].sources[0].recordedAt = future(1);
  if (malformed === "independent") body.profile.independentEvidence = true;
  if (malformed === "wrong-grant") body.profile.grant.revision++;
  if (malformed === "wrong-document") body.profile.scope.documentId = "foreign-document";
  if (malformed === "wrong-count") body.profile.coverage.eligibleChoiceCount++;
  if (malformed === "missing-profile") delete body.profile;
  h.enqueue(body); await profileClick(h, "profileInspect"); assert.match(h.text(), /memory.live.profileError/u);
  assert.equal(h.text().includes("data-memory-profile-view"), false); assert.equal(h.text().includes("data-memory-profile-empty"), false);
  assert.equal(profileAction(h, "profileInspect").disabled, true); assert.equal(profileAction(h, "profileRevoke").disabled, false);
});

function retirePalette(h, cause) {
  if (cause === "close") profileToggle(h, false);
  else if (cause === "hidden") h.visibility("hidden");
  else if (cause === "content") { h.state.content = {}; h.notify(); }
  else if (cause === "events") { h.state.events = []; h.notify(); }
  else if (cause === "locale") { h.enqueue(settings()); h.component.i18n.locale = "fr"; h.notify(); }
  else if (cause === "actor") { h.enqueue(settings()); h.move({ actor: "next-actor" }); }
  else if (cause === "document") { h.enqueue(settings()); h.move({ document: "next-document" }); }
  else if (cause === "source") { h.enqueue(settings()); h.move({ retireSource: true }); }
  else if (cause === "custody") { h.enqueue(settings()); h.move({ organization: "next-organization" }); }
  else if (cause === "closure") h.component.suspendPresentation();
  else if (cause === "disconnect") h.disconnect();
  else throw new Error("unreviewed palette retirement cause");
}
for (const cause of ["close", "hidden", "content", "events", "locale", "actor", "document", "source", "custody", "closure", "disconnect"]) test(`palette display and stale Hide callback retire on ${cause}`, async t => {
  const { h, grant } = await profileFixture(t); h.enqueue(paletteProfile(h, grant)); await profileClick(h, "profileInspect");
  const stale = profileAction(h, "profileSuppress"), receipt = h.profileReceipts.at(-1), count = profileActions(h).length;
  retirePalette(h, cause); await flush(); assert.equal(receipt.retireCalls, 1);
  assert.equal(h.text().includes("#123abc"), false); await h.invoke(stale, "@click").result;
  assert.equal(profileActions(h).length, count); if (cause === "hidden") { h.visibility(); assert.equal(h.text().includes("#123abc"), false); }
});
for (const cause of ["close", "hidden", "content", "events", "locale", "actor", "document", "source", "custody", "closure", "disconnect"]) test(`delayed palette Inspect cannot resurrect after ${cause}`, async t => {
  const { h, grant } = await profileFixture(t), body = delayedJson(paletteProfile(h, grant)); h.enqueue(body.response);
  const pending = profileClick(h, "profileInspect"); await flush(); const call = profileActions(h).at(-1);
  retirePalette(h, cause); await flush(); body.release(); await pending;
  assert.equal(call.init.signal.aborted, true); assert.equal(body.cancellations, 1); assert.equal(h.text().includes("#123abc"), false);
  if (cause === "hidden") { h.visibility(); assert.equal(h.text().includes("#123abc"), false); }
});

test("palette display expiry retires bytes and old Hide, but only a fresh explicit Inspect can replace it", async t => {
  const { h, grant } = await profileFixture(t); h.enqueue(paletteProfile(h, grant, { leaseMs: 1_000 })); await profileClick(h, "profileInspect");
  const stale = profileAction(h, "profileSuppress"), receipt = h.profileReceipts.at(-1), count = profileActions(h).length;
  h.advance(1_000); h.fireTimer(); assert.equal(receipt.retireCalls, 1); assert.equal(h.text().includes("#123abc"), false);
  assert.equal(profileActions(h).length, count); assert.equal(profileAction(h, "profileInspect").disabled, false);
  h.clock.now -= 500; await h.invoke(stale, "@click").result; assert.equal(profileActions(h).length, count);
  h.enqueue(paletteProfile(h, grant)); await profileClick(h, "profileInspect"); assert.match(h.text(), /#123abc/u);
  await h.invoke(stale, "@click").result; assert.equal(profileActions(h).length, count + 1);
});
for (const expired of ["grant", "parent"]) test(`palette ${expired} deadline disables Inspect irreversibly while keeping Revoke`, async t => {
  const item = enrollment(expired === "parent" ? { expiresAt: new Date(Date.now() + 1_000).toISOString() } : {});
  const grant = paletteGrant(item, expired === "grant" ? { expiresAt: new Date(Date.now() + 1_000).toISOString() } : {});
  const { h } = await profileFixture(t, { item, grant }); h.enqueue(paletteProfile(h, grant)); await profileClick(h, "profileInspect");
  h.advance(1_000); h.fireTimer(); assert.equal(h.text().includes("#123abc"), false);
  assert.equal(profileAction(h, "profileInspect").disabled, true); assert.equal(profileAction(h, "profileRevoke").disabled, false);
  h.clock.now -= 1_000; assert.equal(profileAction(h, "profileInspect").disabled, true);
  h.enqueue({ version: DOCUMENT_PROFILE_CONTROL_VERSION, revoked: true, grantId: grant.grantId, revision: 2, reEnrollmentRequired: true });
  await profileClick(h, "profileRevoke"); assert.match(h.text(), /memory.live.profileRevoked/u);
});

test("palette Hide sends only exact certified claim identity and clears bytes before awaiting acknowledgment", async t => {
  const { h, grant } = await profileFixture(t); h.enqueue(paletteProfile(h, grant)); await profileClick(h, "profileInspect");
  const reply = deferred(); h.enqueue(() => reply.promise); const pending = profileClick(h, "profileSuppress"); await flush();
  assert.equal(h.text().includes("#123abc"), false); const call = profileActions(h).at(-1);
  assert.equal(call.url, "/api/memory/document-profile/suppress"); assert.equal(call.init.method, "PUT");
  assert.deepEqual(call.body, { version: DOCUMENT_PROFILE_CONTROL_VERSION, grantId: grant.grantId, grantRevision: grant.revision,
    claimKey: fixtureId(904), revision: 0, confirmation: "SUPPRESS_DOCUMENT_PALETTE_CLAIM" });
  reply.resolve({ version: DOCUMENT_PROFILE_CONTROL_VERSION, suppression: { grantId: grant.grantId, grantRevision: grant.revision,
    claimKey: fixtureId(904), revision: 1, state: "active", createdAt: new Date(h.clock.now).toISOString(), expiresAt: grant.expiresAt } });
  await pending; assert.match(h.text(), /memory.live.profileSuppressed/u); assert.equal(profileActions(h).length, 3);
});
for (const cause of ["deadline", "close", "hidden", "content"]) test(`pending palette Hide cannot outlive inspected ${cause} boundary`, async t => {
  const { h, item, grant } = await profileFixture(t); profileConsent(h); h.enqueue(paletteProfile(h, grant, { leaseMs: 1_000 })); await profileClick(h, "profileInspect");
  const response = delayedJson({ version: DOCUMENT_PROFILE_CONTROL_VERSION, suppression: { grantId: grant.grantId, grantRevision: grant.revision,
    claimKey: fixtureId(904), revision: 1, state: "active", createdAt: new Date(h.clock.now).toISOString(), expiresAt: grant.expiresAt } });
  h.enqueue(response.response); const pending = profileClick(h, "profileSuppress"); await flush(); const call = profileActions(h).at(-1);
  if (cause === "deadline") {
    h.advance(1_000); h.fireTimer();
    assert.match(h.text(), /memory.live.profileUnknown/u, "same-scope dispatched retirement latches recovery synchronously");
    assert.equal(profileAction(h, "profileLoad").disabled, false);
    for (const key of ["profileInspect", "profileEnable", "profileRevoke"]) assert.equal(profileAction(h, key).disabled, true);
    for (const field of ["organize", "inspect", "consent"]) assert.equal(h.field("memory-profile-" + field).attributes.get(".checked"), true);
  } else retirePalette(h, cause);
  await flush(); response.release(); await pending; assert.equal(call.init.signal.aborted, true);
  assert.equal(h.text().includes("memory.live.profileSuppressed"), false); assert.equal(h.text().includes("#123abc"), false);
  assert.equal(profileActions(h).length, 3, "retirement never starts a recovery request automatically");
  if (cause === "deadline") {
    for (const key of ["profileInspect", "profileRevoke"]) await h.invoke(profileAction(h, key), "@click").result;
    await profileSubmit(h); assert.equal(profileActions(h).length, 3);
    h.enqueue(paletteSettings(item, grant)); await profileClick(h, "profileLoad");
    assert.equal(profileAction(h, "profileInspect").disabled, false); assert.equal(profileAction(h, "profileRevoke").disabled, false);
    assert.equal(h.field("memory-profile-consent").attributes.get(".checked"), false);
  } else {
    assert.equal(h.text().includes("memory.live.profileUnknown"), false);
    assert.equal(h.all().some(c => c.label === "memory.live.profileRevoke"), false, "lost-scope metadata is discarded");
    if (cause === "hidden") h.visibility();
    profileToggle(h, true); assert.match(h.text(), /memory.live.profileNotLoaded/u);
  }
});

test("palette mutation uncertainty never retries or authorizes a new change without settings reload", async t => {
  const { h } = await profileFixture(t, { grant: null }); profileConsent(h); h.enqueue(new Error("private transport details"));
  await profileSubmit(h); assert.match(h.text(), /memory.live.profileUnknown/u); assert.equal(h.text().includes("private transport"), false);
  profileConsent(h); await profileSubmit(h); assert.equal(profileActions(h).length, 2);
  assert.equal(profileAction(h, "profileEnable").disabled, true);
});

test("stale palette settings callbacks cannot target a reopened disclosure", async t => {
  const { h, item } = await profileFixture(t, { grant: null }), stale = profileAction(h, "profileLoad");
  profileToggle(h, false); profileToggle(h, true); const count = profileActions(h).length;
  await h.invoke(stale, "@click").result; assert.equal(profileActions(h).length, count);
  h.enqueue(paletteSettings(item, null)); await profileClick(h, "profileLoad"); assert.equal(profileActions(h).length, count + 1);
});

test("palette native inherited disabled semantics block synthetic direct actions", async t => {
  const { h } = await profileFixture(t, { grant: null }), button = profileAction(h, "profileLoad"), count = profileActions(h).length;
  await h.invoke(button, "@click", { currentTarget: { ...h.target(button), matches: () => true } }).result;
  assert.equal(profileActions(h).length, count);
});

for (const locale of ["en", "fr", "ar", "ja"]) test(`palette copy and view are complete in ${locale}`, async t => {
  const english = FORMA_PERSONAL_MEMORY_MESSAGES.en, localized = FORMA_PERSONAL_MEMORY_MESSAGES[locale];
  const keys = Object.keys(english).filter(key => key.startsWith("memory.live.profile"));
  assert.deepEqual(Object.keys(localized).filter(key => key.startsWith("memory.live.profile")).sort(), keys.sort());
  for (const key of keys) { assert.ok(localized[key].trim()); assert.deepEqual([...localized[key].matchAll(/\{(\w+)\}/gu)].map(x => x[1]).sort(), [...english[key].matchAll(/\{(\w+)\}/gu)].map(x => x[1]).sort()); }
  const { h, grant } = await profileFixture(t, { locale, localized: true }); h.enqueue(paletteProfile(h, grant)); await profileClick(h, "profileInspect");
  assert.equal(h.text().includes("memory.live.profile"), false); assert.match(h.text(), /#123abc/u); assert.ok(h.text().includes(localized["memory.live.profileEvidenceMeaning"]));
  assert.equal(h.component.i18n.direction, locale === "ar" ? "rtl" : "ltr");
});

for (const operation of ["settings", "enable", "revoke"]) for (const cause of ["close", "hidden", "content", "actor"]) test(`delayed palette ${operation} cannot apply after ${cause}`, async t => {
  const { h, item, grant } = await profileFixture(t);
  const body = operation === "settings" ? paletteSettings(item, grant)
    : operation === "enable" ? { version: DOCUMENT_PROFILE_CONTROL_VERSION, grant: { ...grant, revision: 2 }, historyStartsAfterSequence: grant.sourceAfterSequence }
      : { version: DOCUMENT_PROFILE_CONTROL_VERSION, revoked: true, grantId: grant.grantId, revision: 2, reEnrollmentRequired: true };
  const response = delayedJson(body); h.enqueue(response.response); if (operation === "enable") profileConsent(h);
  const pending = operation === "enable" ? profileSubmit(h) : profileClick(h, operation === "settings" ? "profileLoad" : "profileRevoke");
  await flush(); const call = profileActions(h).at(-1); retirePalette(h, cause); await flush(); response.release(); await pending;
  assert.equal(call.init.signal.aborted, true); assert.equal(response.cancellations, 1);
  assert.equal(h.text().includes("memory.live.profileSaved"), false); assert.equal(h.text().includes("memory.live.profileRevoked"), false);
  assert.equal(h.text().includes("memory.live.profileGrantActive"), false);
});

test("palette settings refresh preserves a newer independent consent draft", async t => {
  const { h, item, grant } = await profileFixture(t), reply = deferred(); h.enqueue(() => reply.promise);
  const pending = profileClick(h, "profileLoad"); await flush(); profileConsent(h);
  reply.resolve(paletteSettings(item, grant)); await pending;
  for (const name of ["organize", "inspect", "consent"]) assert.equal(h.field("memory-profile-" + name).attributes.get(".checked"), true);
  assert.equal(h.field("memory-consent").attributes.get(".checked"), false);
});

test("reference enrollment revision change retires palette settings and current display", async t => {
  const { h, item, grant } = await profileFixture(t); h.enqueue(paletteProfile(h, grant)); await profileClick(h, "profileInspect");
  const old = profileAction(h, "profileRevoke"), count = profileActions(h).length;
  h.enqueue(settings([enrollment({ revision: item.revision + 1 })])); await h.click("reload");
  assert.equal(h.profileReceipts.at(-1).retireCalls, 1); assert.equal(h.text().includes("#123abc"), false);
  await h.invoke(old, "@click").result; assert.equal(profileActions(h).length, count);
});

test("profile UI rejects foreign personal grant ownership despite structurally personal custody", async t => {
  const item = enrollment(), grant = paletteGrant(item, { ownerUserId: "foreign-owner" });
  const { h } = await profileFixture(t, { item, grant }); assert.match(h.text(), /memory.live.profileError/u);
  assert.equal(h.all().some(c => c.label === "memory.live.profileRevoke"), false); assert.equal(profileActions(h).length, 1);
});

test("foreign personal enable response is unconfirmed and never creates Inspect or Revoke controls", async t => {
  const { h, item } = await profileFixture(t, { grant: null }); profileConsent(h);
  const grant = paletteGrant(item, { ownerUserId: "foreign-owner" }); h.enqueue({ version: DOCUMENT_PROFILE_CONTROL_VERSION, grant, historyStartsAfterSequence: grant.sourceAfterSequence });
  await profileSubmit(h); assert.match(h.text(), /memory.live.profileUnknown/u);
  assert.equal(h.all().some(c => ["memory.live.profileInspect", "memory.live.profileRevoke"].includes(c.label)), false);
});

test("an unconfirmed revoke retains metadata but requires explicit settings reload before another mutation", async t => {
  const { h, item, grant } = await profileFixture(t); h.enqueue(new Error("opaque failure")); await profileClick(h, "profileRevoke");
  assert.match(h.text(), /memory.live.profileUnknown/u); assert.equal(profileAction(h, "profileRevoke").disabled, true);
  const count = profileActions(h).length; await h.invoke(profileAction(h, "profileRevoke"), "@click").result; assert.equal(profileActions(h).length, count);
  h.enqueue(paletteSettings(item, grant)); await profileClick(h, "profileLoad"); assert.equal(profileAction(h, "profileRevoke").disabled, false);
});

test("explicit local palette close retires display without suppressing or changing permissions", async t => {
  const { h, grant } = await profileFixture(t); h.enqueue(paletteProfile(h, grant)); await profileClick(h, "profileInspect");
  const count = profileActions(h).length; await profileClick(h, "profileHideView");
  assert.equal(h.profileReceipts.at(-1).retireCalls, 1); assert.equal(h.text().includes("#123abc"), false);
  assert.equal(profileActions(h).length, count); assert.equal(profileAction(h, "profileInspect").disabled, false);
});

test("palette inspection and enable require account consent without removing the current-scope revoke action", async t => {
  const { h } = await profileFixture(t); h.state.session = { ...h.state.session, policy: { accepted: false } };
  assert.equal(profileAction(h, "profileInspect").disabled, true); assert.equal(profileAction(h, "profileEnable").disabled, true);
  assert.equal(profileAction(h, "profileRevoke").disabled, false);
});

test("organization palette grant binds the exact current organization, access and owner", async t => {
  const item = enrollment({ organizationId: "fixture-org" }), grant = paletteGrant(item, { projectAccessId: "fixture-access", ownerUserId: "fixture-owner" });
  const h = fixture(t, { initial: settings([item]), session: sharedSession() }); await flush(); await h.select(); profileToggle(h, true);
  h.enqueue(paletteSettings(item, grant, { scope: { projectId: item.projectId, documentId: item.documentId,
    custody: { kind: "organization", organizationId: "fixture-org", projectAccessId: "fixture-access", ownerUserId: "fixture-owner" } } }));
  await profileClick(h, "profileLoad"); assert.equal(profileAction(h, "profileInspect").disabled, false);
  h.enqueue(paletteProfile(h, grant)); await profileClick(h, "profileInspect"); assert.match(h.text(), /#123abc/u);
  h.enqueue(settings()); h.state.session = { ...h.state.session, projectContext: { ...h.state.session.projectContext, projectAccessId: "replaced-access" } };
  h.notify(); await flush(); assert.equal(h.text().includes("#123abc"), false); assert.equal(h.all().some(c => c.label === "memory.live.profileRevoke"), false);
});

test("same-scope palette suppression expiring before dispatch does not latch mutation uncertainty", async t => {
  const { h, grant } = await profileFixture(t); profileConsent(h);
  h.enqueue(paletteProfile(h, grant, { leaseMs: 1_000 })); await profileClick(h, "profileInspect");
  const dispatchGate = deferred(), guardedFetch = h.store.guardedFetch;
  h.store.guardedFetch = async (...args) => { if (args[0] === "/api/memory/document-profile/suppress") await dispatchGate.promise; return guardedFetch(...args); };
  const pending = profileClick(h, "profileSuppress"); await flush(); assert.equal(profileActions(h).length, 2);
  h.advance(1_000); h.fireTimer(); dispatchGate.resolve(); await pending;
  assert.equal(profileActions(h).length, 2, "the pre-dispatch guard rejects the expired request before transport");
  assert.equal(h.text().includes("memory.live.profileUnknown"), false);
  assert.equal(profileAction(h, "profileInspect").disabled, false); assert.equal(profileAction(h, "profileRevoke").disabled, false);
  assert.equal(profileAction(h, "profileEnable").disabled, false); assert.equal(h.text().includes("#123abc"), false);
});

for (const responseKind of ["acknowledgment", "transport-error"]) test(`late palette suppression ${responseKind} without timer wake latches recovery`, async t => {
  const { h, grant } = await profileFixture(t); profileConsent(h);
  h.enqueue(paletteProfile(h, grant, { leaseMs: 1_000 })); await profileClick(h, "profileInspect");
  const reply = deferred(), body = { version: DOCUMENT_PROFILE_CONTROL_VERSION, suppression: { grantId: grant.grantId, grantRevision: grant.revision,
    claimKey: fixtureId(904), revision: 1, state: "active", createdAt: new Date(h.clock.now).toISOString(), expiresAt: grant.expiresAt } };
  const streamed = responseKind === "acknowledgment" ? delayedJson(body) : null;
  h.enqueue(streamed ? streamed.response : () => reply.promise); const pending = profileClick(h, "profileSuppress"); await flush();
  h.advance(1_000); if (streamed) streamed.release(); else reply.resolve(new Error("Synthetic late failure")); await pending;
  assert.match(h.text(), /memory.live.profileUnknown/u); assert.equal(profileAction(h, "profileLoad").disabled, false);
  for (const key of ["profileInspect", "profileEnable", "profileRevoke"]) assert.equal(profileAction(h, key).disabled, true);
  assert.equal(h.text().includes("memory.live.profileSuppressed"), false); assert.equal(profileActions(h).length, 3);
});

test("expired palette mutation settling after fresh Load cannot relatch recovery or clear newer work", async t => {
  const { h, item, grant } = await profileFixture(t); h.enqueue(paletteProfile(h, grant, { leaseMs: 1_000 })); await profileClick(h, "profileInspect");
  const oldReply = deferred(); h.enqueue(() => oldReply.promise); const oldPending = profileClick(h, "profileSuppress"); await flush();
  h.advance(1_000); h.fireTimer(); assert.match(h.text(), /memory.live.profileUnknown/u);
  h.enqueue(paletteSettings(item, grant)); await profileClick(h, "profileLoad"); profileConsent(h);
  const newReply = deferred(); h.enqueue(() => newReply.promise); const newPending = profileClick(h, "profileLoad"); await flush(); profileConsent(h);
  oldReply.resolve(new Error("Synthetic abandoned mutation response")); await oldPending;
  assert.equal(h.text().includes("memory.live.profileUnknown"), false); assert.equal(profileAction(h, "profileLoad").disabled, true, "new request still owns busy state");
  newReply.resolve(paletteSettings(item, grant)); await newPending;
  assert.equal(profileAction(h, "profileInspect").disabled, false); assert.equal(profileAction(h, "profileRevoke").disabled, false);
  for (const field of ["organize", "inspect", "consent"]) assert.equal(h.field("memory-profile-" + field).attributes.get(".checked"), true);
});

test("same-scope parent expiry after dispatched palette enable requires reload even though revoke normally survives expiry", async t => {
  const item = enrollment({ expiresAt: new Date(Date.now() + 1_000).toISOString() }), grant = paletteGrant(item);
  const { h } = await profileFixture(t, { item, grant }); profileConsent(h); const reply = deferred(); h.enqueue(() => reply.promise);
  const pending = profileSubmit(h); await flush(); h.advance(1_000); h.fireTimer();
  assert.match(h.text(), /memory.live.profileUnknown/u); assert.equal(profileAction(h, "profileRevoke").disabled, true);
  reply.resolve({ version: DOCUMENT_PROFILE_CONTROL_VERSION, grant: { ...grant, revision: 2 }, historyStartsAfterSequence: grant.sourceAfterSequence }); await pending;
  assert.equal(h.text().includes("memory.live.profileSaved"), false); assert.equal(profileActions(h).length, 2);
});

for (const bytes of [509, 510, 511, 512]) test(`native recall ${bytes}-byte multibyte tail remains original-only at the clipping boundary`, async t => {
  const item = enrollment(), prefix = "Earlier sentence! ", tail = "文".repeat(160) + "x".repeat(bytes - new TextEncoder().encode(prefix).length - 480 - 1) + "!";
  const user = prefix + tail; assert.equal(new TextEncoder().encode(user).byteLength, bytes); assert.ok(Array.from(user).length < 512);
  const h = fixture(t, { initial: settings([item]) }); await flush(); await h.select(); h.enqueue(rollingRecall(item, [{ user, assistant: "Historical response." }])); await h.click("inspect");
  const root = h.render(), local = h.all().filter(control => control.attributes.has("data-memory-local-quote"));
  assert.ok(local.some(control => control.label.includes(prefix.trim()))); assert.equal(local.some(control => control.label.includes(tail)), false);
  const original = h.all().find(control => control.attributes.has("data-memory-original-excerpts")); assert.ok(original); assert.equal(original.attributes.get("?open"), true);
  assert.ok(templateText(root).includes(user)); assert.equal(h.text().includes("memory.live.readFailed"), false);
});

test("legacy code-point-bounded recall over512bytes renders only original excerpts without throwing or weaker clipping", async t => {
  const item = enrollment(), user = "文".repeat(220) + "。", assistant = "Legacy original response.";
  assert.ok(new TextEncoder().encode(user).byteLength > 512); assert.ok(Array.from(user).length <= 512);
  const h = fixture(t, { initial: settings([item]) }); await flush(); await h.select(); h.enqueue(rollingRecall(item, [{ user, assistant }])); await h.click("inspect");
  const root = h.render(); assert.ok(templateText(root).includes(user)); assert.ok(templateText(root).includes(assistant));
  assert.equal(h.all().some(control => control.attributes.has("data-memory-local-quote")), false, "no code-point fallback promotes legacy bytes into quotes");
  assert.equal(h.all().find(control => control.attributes.has("data-memory-original-excerpts")).attributes.get("?open"), true);
  await h.click("hide"); assert.equal(h.text().includes(user), false, "the fallback remains inside the parent lease");
});

function visitsRecall(item, { checkedAt = now(), leaseMs = 60_000, empty = false, marker = "Fresh parent conversation" } = {}) {
  const body = recall(item, marker, { checkedAt, leaseMs }), until = body.lifetime.validUntil;
  body.sources.push(...["DocumentViewVisited", "DocumentOpened", "DocumentViewVisited"].map((type, index) => ({
    eventId: "private-visit-event-" + index, type, blockId: null, recordedAt: checkedAt, validUntil: until,
  })));
  body.consumption.encounter = 3; body.coverage.sourceCount = body.sources.length;
  const indexes = empty ? [] : [1, 3];
  body.consumptionEpisodes = { version: "memory-consumption-episodes-v5", treatment: "descriptive-consumption", validUntil: until,
    sources:indexes.map(sourceIndex=>{const {eventId,type,recordedAt,validUntil}=body.sources[sourceIndex];return{eventId,type,recordedAt,validUntil,target:{kind:"document",documentId:item.documentId}};}),
    episodes: indexes.map((_sourceIndex,sourceIndex) => ({ episodeId: null,
      observations: [{ sourceIndex, kind: "visit" }],
      firstRecordedAt: checkedAt, lastRecordedAt: checkedAt, validUntil: until, independentEvidence: false })),
    coverage: { eligibleSourceCount: indexes.length, observationCount: indexes.length, unavailableArtifactSourceCount:0,unavailableBlockSourceCount:0,
      completeHistory: false, bounded: true, truncated:false },
    attention: "not-measured", comprehension: "not-measured", inferredPreferences: false };
  return body;
}

async function openVisitAction(h, row, { leaseMs = 60_000 } = {}) {
  await flush(); await h.select();
  h.enqueue(recall(row, "Prior parent conversation", { checkedAt: new Date(h.clock.now).toISOString(), leaseMs }));
  await h.click("inspect");
  return h.action("visitsInclude");
}

test("recorded visits: mounting and ordinary Inspect never request the projection or display unavailable visit counts", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush();
  assert.equal(h.text().includes("memory.live.visits"), false);
  await h.select(); assert.equal(h.text().includes("memory.live.visits"), false);
  h.enqueue(recall(row)); await h.click("inspect");
  assert.equal(h.calls.at(-1).url, "/api/memory/recall?id=" + row.id + "&outcomes=native-assisted-outcomes-v1&savedOutputs=native-saved-outputs-v1");
  const action = h.action("visitsInclude"); assert.equal(action.attributes.get("data-memory-action"), "visits");
  assert.equal(action.attributes.get("data-memory-enrollment"), row.id);
  assert.match(action.attributes.get("aria-describedby"), /-visits-help$/u);
  assert.ok(h.text().includes("memory.live.visitsIncludeHelp"));
  assert.equal(h.text().includes("memory.live.visitsUnavailable"), false); assert.equal(h.text().includes("data-memory-visit-count"), false);
  h.render(); h.visibility(); h.dispatchWindow("focus"); assert.equal(h.calls.length, 3); assert.equal(h.mutations().length, 0);
});

test("recorded visits: explicit action replaces the complete receipt and shows only bounded source ordinals and dates", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await openVisitAction(h, row);
  const oldReceipt = h.recallReceipts[0], body = visitsRecall(row, { checkedAt: new Date(h.clock.now).toISOString() });
  const delayed = delayedJson(body); h.enqueue(delayed.response); const pending = h.click("visitsInclude"); await flush();
  assert.ok(oldReceipt.retireCalls > 0); assert.equal(h.text().includes("Prior parent conversation"), false);
  assert.equal(h.text().includes("personal-memory-excerpts"), false);
  assert.equal(h.calls.at(-1).url, "/api/memory/recall?id=" + row.id
    + "&outcomes=native-assisted-outcomes-v1&savedOutputs=native-saved-outputs-v1&consumptionEpisodes=memory-consumption-episodes-v5");
  assert.equal(h.focusLeases.length, 1); assert.equal(h.focusLeases[0].disposed, false);
  delayed.release(); await pending;
  const root = h.render(), section = [...templates(root)].find(value => value.strings.some(part => part.includes("data-memory-visits>")));
  assert.ok(section); const text = templateText(section);
  const count = [...templates(section)].find(value => value.strings.some(part => part.includes("data-memory-visit-count")));
  assert.deepEqual(count.values.slice(1, 3), ["memory.live.visitsCount", "2"]);
  for (const key of ["visitsHeading", "visitsMeaning", "visitsLineage", "visitsLimits"]) assert.ok(text.includes("memory.live." + key));
  const detail = controls(section).find(control => control.attributes.has("data-memory-visit-references"));
  assert.ok(detail); assert.equal(detail.attributes.has("open"), false); assert.equal(detail.attributes.has("?open"), false);
  assert.equal(detail.attributes.has("@toggle"), false); assert.ok(detail.label.includes("memory.live.visitsDetails [2]"));
  assert.ok(detail.label.includes("memory.live.visitsSource [1]")); assert.ok(detail.label.includes("memory.live.visitsSource [2]"));
  assert.equal(detail.label.includes("memory.live.visitsSource [3]"), false);
  assert.ok(text.includes(body.lifetime.checkedAt));
  for (const privateValue of [row.documentId, row.projectId, row.id, "Fresh parent conversation", "Synthetic historical response", ...body.sources.map(source => source.eventId)])
    assert.equal(text.includes(privateValue), false, "visit detail does not copy private IDs or parent prose");
  assert.equal(controls(section).filter(control => ["a", "button", "input", "select", "form"].includes(control.tag)).length, 0);
  for (const template of templates(section)) assert.ok(template.strings.every(part => !/\b(?:src|href)=|<(?:img|video|audio)\b/u.test(part)));
  assert.ok(h.text().includes("Fresh parent conversation"), "unrelated authorized parent excerpts keep their original behavior");
  assert.equal(h.text().includes("memory.live.visitsInclude"), false);
  assert.equal(h.focusLeases[0].disposed, true); assert.equal(h.focusEvents.length, 1);
  assert.equal(h.focused().attributes.get("data-memory-action"), "inspect");
  assert.equal(h.focused().attributes.get("data-memory-enrollment"), row.id);
  assert.equal(h.calls.length, 4); assert.equal(h.mutations().length, 0); assert.equal(h.downloads.length, 0); assert.deepEqual(h.navigations, []);
});

test("recorded visits: old-server omission is unavailable only for that opted-in receipt; selected visit sources may yield bounded empty", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await openVisitAction(h, row);
  h.enqueue(recall(row)); await h.click("visitsInclude");
  assert.ok(h.text().includes("memory.live.visitsUnavailable")); assert.equal(h.text().includes("memory.live.visitsEmpty"), false);
  assert.equal(h.text().includes("data-memory-visit-count"), false);
  h.enqueue(recall(row)); await h.click("inspect");
  assert.equal(h.calls.at(-1).url.includes("consumptionEpisodes"), false);
  assert.equal(h.text().includes("memory.live.visitsUnavailable"), false); assert.ok(h.action("visitsInclude"));
  const body = visitsRecall(row, { empty: true, checkedAt: new Date(h.clock.now).toISOString() });
  assert.equal(body.sources.filter(source => source.type === "DocumentViewVisited").length, 2);
  h.enqueue(body); await h.click("visitsInclude");
  const count = [...templates(h.render())].find(value => value.strings.some(part => part.includes("data-memory-visit-count")));
  assert.deepEqual(count.values.slice(1, 3), ["memory.live.visitsCount", "0"]);
  assert.ok(h.text().includes("memory.live.visitsEmpty")); assert.ok(h.text().includes("memory.live.visitsLimits"));
  assert.equal(h.text().includes("memory.live.visitsUnavailable"), false); assert.equal(h.text().includes("data-memory-visit-references"), false);
  await h.click("hide"); assert.equal(h.text().includes("memory.live.visits"), false);
  assert.equal(h.calls.length, 6); assert.equal(h.mutations().length, 0);
});

for (const transition of ["replacement", "hide", "hidden then visible", "account", "source", "expiry", "events", "content"]) {
  test("recorded visits: retained optional action cannot dispatch after " + transition, async t => {
    const row = enrollment(), h = fixture(t, { initial: settings([row]) });
    const action = await openVisitAction(h, row, { leaseMs: 1_000 });
    if (transition === "replacement") { h.enqueue(recall(row)); await h.click("inspect"); }
    if (transition === "hide") await h.click("hide");
    if (transition === "hidden then visible") { h.visibility("hidden"); h.visibility("visible"); }
    if (transition === "account") { h.enqueue(settings([row])); h.move({ actor: "another-actor" }); await flush(); }
    if (transition === "source") { h.enqueue(settings([row])); h.move({ retireSource: true }); await flush(); }
    if (transition === "expiry") h.advance(1_000);
    if (transition === "events") { h.state.events = []; h.notify(); }
    if (transition === "content") { h.state.content = {}; h.notify(); }
    const count = h.calls.length;
    await h.invoke(action, "@click").result;
    assert.equal(h.calls.length, count, "even a retained connected callback must own the exact current receipt");
    assert.equal(h.calls.some(call => call.url.includes("consumptionEpisodes=")), false);
    assert.equal(h.mutations().length, 0);
  });
}

for (const transition of ["hidden", "source", "account", "document", "events", "content", "enrollment expiry", "disconnect"]) {
  test("recorded visits: " + transition + " synchronously disposes optional focus while headers remain stalled", async t => {
    const row = enrollment({ expiresAt: new Date(Date.now() + 60_000).toISOString() }), h = fixture(t, { initial: settings([row]) });
    await openVisitAction(h, row);
    const headers = deferred(); h.enqueue(async () => { await headers.promise; return visitsRecall(row, { checkedAt: new Date(h.clock.now).toISOString() }); });
    const pending = h.click("visitsInclude"); await flush(); const request = h.calls.at(-1), focus = h.focusLeases.at(-1);
    assert.equal(focus.disposed, false); assert.equal(request.init.signal.aborted, false);
    if (transition === "hidden") { h.visibility("hidden"); h.visibility("visible"); }
    if (transition === "source") { h.enqueue(settings([row])); h.move({ retireSource: true }); }
    if (transition === "account") { h.enqueue(settings([row])); h.move({ actor: "other-actor" }); }
    if (transition === "document") { h.enqueue(settings([row])); h.move({ document: "other-document" }); }
    if (transition === "events") { h.state.events = []; h.notify(); }
    if (transition === "content") { h.state.content = {}; h.notify(); }
    if (transition === "enrollment expiry") { h.advance(61_000); h.dispatchWindow("focus"); }
    if (transition === "disconnect") h.disconnect();
    assert.equal(focus.disposed, true, "retirement does not wait for eventual headers/finally");
    assert.equal(request.init.signal.aborted, true); assert.equal(h.focusEvents.length, 0);
    headers.resolve(); await pending; await flush();
    assert.equal(h.text().includes("data-memory-visits>"), false); assert.equal(h.text().includes("memory.live.visitsUnavailable"), false);
    assert.equal(h.calls.filter(call => call.url.includes("consumptionEpisodes=")).length, 1);
    assert.equal(h.focusEvents.length, 0); assert.equal(h.mutations().length, 0);
  });
}

test("recorded visits: hidden pending body is cancelled and cannot overwrite a newer ordinary Inspect", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await openVisitAction(h, row);
  const delayed = delayedJson(visitsRecall(row, { checkedAt: new Date(h.clock.now).toISOString() }));
  h.enqueue(delayed.response); const pending = h.click("visitsInclude"); await flush(); const focus = h.focusLeases.at(-1);
  h.visibility("hidden"); h.visibility("visible");
  assert.equal(focus.disposed, true); assert.equal(delayed.cancellations, 1);
  h.enqueue(recall(row, "New ordinary receipt")); await h.click("inspect"); delayed.release(); await pending;
  assert.ok(h.text().includes("New ordinary receipt")); assert.equal(h.text().includes("data-memory-visits>"), false);
  assert.equal(h.text().includes("memory.live.visitsUnavailable"), false); assert.ok(h.action("visitsInclude"));
  assert.equal(h.focusEvents.length, 0); assert.equal(h.calls.length, 5);
});

for (const interruption of ["hide", "hidden then visible", "expiry", "source", "newer Inspect", "newer focus", "dialog"]) {
  test("recorded visits: focus continuity across a stalled update respects " + interruption, async t => {
    const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await openVisitAction(h, row);
    const finishUpdate = h.holdUpdates();
    h.enqueue(visitsRecall(row, { checkedAt: new Date(h.clock.now).toISOString(), leaseMs: 1_000 }));
    const pending = h.click("visitsInclude"); await flush(); const focus = h.focusLeases.at(-1);
    assert.equal(focus.disposed, false); assert.equal(h.focusEvents.length, 0);
    assert.ok(h.text().includes("data-memory-visits>"));
    let otherPending;
    if (interruption === "hide") otherPending = h.click("hide");
    if (interruption === "hidden then visible") { h.visibility("hidden"); h.visibility("visible"); }
    if (interruption === "expiry") { h.advance(1_000); h.dispatchWindow("focus"); }
    if (interruption === "source") { h.enqueue(settings([row])); h.move({ retireSource: true }); }
    if (interruption === "newer Inspect") { h.enqueue(recall(row, "Replacement receipt")); otherPending = h.click("inspect"); }
    if (interruption === "newer focus") h.stealFocus();
    if (interruption === "dialog") h.setDialogOpen(true);
    if (!["newer focus", "dialog"].includes(interruption)) assert.equal(focus.disposed, true, "retirement disposes before updateComplete resolves");
    finishUpdate(); await pending; await otherPending; await flush();
    assert.equal(focus.disposed, true);
    assert.equal(h.focusEvents.length, interruption === "hide" ? 1 : 0, "only a newer explicit Hide owns its separate focus restoration");
    assert.equal(h.calls.filter(call => call.url.includes("consumptionEpisodes=")).length, 1);
  });
}

for (const failure of ["HTTP", "expired body", "malformed projection"]) {
  test("recorded visits: " + failure + " retires the old view and focus without fallback recall or fabricated empty", async t => {
    const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await openVisitAction(h, row);
    const body = visitsRecall(row, { checkedAt: new Date(h.clock.now).toISOString(), leaseMs: 1_000 });
    if (failure === "malformed projection") body.consumptionEpisodes.attention = "measured";
    const delayed = failure === "expired body" ? delayedJson(body) : null;
    h.enqueue(delayed?.response ?? (failure === "HTTP" ? new Response("{}", { status: 503 }) : body));
    const pending = h.click("visitsInclude");
    if (delayed) { await flush(); h.advance(1_000); delayed.release(); }
    await pending;
    assert.equal(h.text().includes("personal-memory-excerpts"), false); assert.equal(h.text().includes("memory.live.visitsEmpty"), false);
    assert.equal(h.text().includes("Prior parent conversation"), false); assert.equal(h.focusLeases.at(-1).disposed, true);
    assert.equal(h.focused().attributes.get("data-memory-action"), "inspect");
    assert.equal(h.calls.length, 4); assert.equal(h.mutations().length, 0);
  });
}

for (const transition of ["hide", "expiry", "background", "content", "events", "source", "document", "locale", "actor", "disconnect"]) {
  test("recorded visits: revealed detail retires on " + transition + " under its parent lease without automatic reinspection", async t => {
    const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await openVisitAction(h, row);
    h.enqueue(visitsRecall(row, { checkedAt: new Date(h.clock.now).toISOString(), leaseMs: 1_000 })); await h.click("visitsInclude");
    assert.ok(h.text().includes("data-memory-visits>")); const receipt = h.recallReceipts.at(-1);
    if (transition === "hide") await h.click("hide");
    if (transition === "expiry") { h.advance(1_000); h.fireTimer(); }
    if (transition === "background") { h.visibility("hidden"); h.visibility("visible"); }
    if (transition === "content") { h.state.content = {}; h.notify(); }
    if (transition === "events") { h.state.events = []; h.notify(); }
    if (transition === "source") { h.enqueue(settings([row])); h.move({ retireSource: true }); await flush(); }
    if (transition === "document") { h.enqueue(settings([row])); h.move({ document: "other-document" }); await flush(); }
    if (transition === "locale") { h.enqueue(settings([row])); h.component.i18n.locale = "fr"; h.render(); await flush(); }
    if (transition === "actor") { h.enqueue(settings([row])); h.move({ actor: "other-actor" }); await flush(); }
    if (transition === "disconnect") h.disconnect();
    assert.ok(receipt.retireCalls > 0); assert.equal(h.text().includes("data-memory-visit-count"), false);
    assert.equal(h.text().includes("data-memory-visit-references"), false); assert.equal(h.text().includes("memory.live.visitsUnavailable"), false);
    assert.equal(h.calls.filter(call => call.url.includes("consumptionEpisodes=")).length, 1); assert.equal(h.mutations().length, 0);
  });
}

test("recorded visits: every supported locale has matching descriptive labels and placeholders", () => {
  const selected = dictionary => Object.keys(dictionary).filter(key => key.startsWith("memory.live.visits")).sort();
  const english = FORMA_PERSONAL_MEMORY_MESSAGES.en, keys = selected(english);
  const placeholders = value => [...value.matchAll(/\{(\w+)\}/gu)].map(match => match[1]).sort();
  assert.equal(keys.length, 22);
  for (const dictionary of Object.values(FORMA_PERSONAL_MEMORY_MESSAGES)) {
    assert.deepEqual(selected(dictionary), keys);
    for (const key of keys) { assert.ok(dictionary[key].trim()); assert.deepEqual(placeholders(dictionary[key]), placeholders(english[key])); }
  }
});

for (const locale of Object.keys(FORMA_PERSONAL_MEMORY_MESSAGES)) {
  test("recorded visits: explicit localized action and bounded detail in " + locale, async t => {
    const row = enrollment(), h = fixture(t, { initial: settings([row]), locale, localized: true }); await flush(); await h.select();
    h.enqueue(recall(row)); await h.invoke(h.all().find(control => control.attributes.get("data-memory-action") === "inspect"), "@click").result;
    const dictionary = FORMA_PERSONAL_MEMORY_MESSAGES[locale];
    assert.ok(h.text().includes(dictionary["memory.live.visitsInclude"])); assert.ok(h.text().includes(dictionary["memory.live.visitsIncludeHelp"]));
    h.enqueue(visitsRecall(row, { checkedAt: new Date(h.clock.now).toISOString() }));
    await h.invoke(h.all().find(control => control.attributes.get("data-memory-action") === "visits"), "@click").result;
    const text = h.text();
    for (const key of ["visitsHeading", "visitsCount", "visitsMeaning", "visitsLineage", "visitsLimits"]) assert.ok(text.includes(dictionary["memory.live." + key]));
    assert.equal(text.includes("memory.live.visits"), false); assert.equal(/\{(?:index|count|at)\}/u.test(text), false);
    assert.equal(h.calls.length, 4); assert.equal(h.mutations().length, 0);
  });
}

// These are the existing finite focus ports, not browser/keyboard qualification.
for (const dirty of [false, true]) test(`profile focus: local Hide restores to ${dirty ? "Load with a dirty draft" : "Inspect"}`, async t => {
  const { h, grant } = await profileFixture(t); h.enqueue(paletteProfile(h, grant)); await profileClick(h, "profileInspect");
  if (dirty) h.change("memory-retention", "45");
  const finishUpdate = h.holdUpdates(), count = h.calls.length, receipt = h.profileReceipts.at(-1);
  const pending = profileClick(h, "profileHideView");
  assert.equal(receipt.retireCalls, 1); assert.equal(h.text().includes("#123abc"), false);
  assert.equal(h.focusLeases.length, 1); assert.equal(h.focusEvents.length, 0);
  finishUpdate(); await pending;
  assert.equal(h.focusEvents.length, 1); assert.equal(h.focused().attributes.get("data-memory-profile-action"), dirty ? "load" : "inspect");
  assert.deepEqual(h.focusEvents[0].options, { preventScroll: true }); assert.ok(h.focusLeases.every(lease => lease.disposed));
  assert.equal(h.calls.length, count); assert.equal(h.mutations().length, 0);
  if (dirty) { assert.equal(h.field("memory-retention").attributes.get(".value"), "45"); assert.equal(h.component.captureCommandDeparture().blocked(), true); }
});

for (const wake of ["timer", "visibility", "focus", "render"]) test(`profile focus: ${wake} expiry restores from the disappearing view to Inspect`, async t => {
  const { h, grant } = await profileFixture(t); h.enqueue(paletteProfile(h, grant, { leaseMs: 1_000 })); await profileClick(h, "profileInspect");
  const hide = profileAction(h, "profileHideView"); assert.equal(hide.inProfileSubtree, true); h.focus(hide);
  const finishUpdate = h.holdUpdates(), receipt = h.profileReceipts.at(-1), count = h.calls.length, renders = h.renderCount();
  h.advance(1_000);
  if (wake === "timer") h.fireTimer(); else if (wake === "visibility") h.visibility(); else if (wake === "focus") h.dispatchWindow("focus"); else h.render();
  assert.equal(receipt.retireCalls, 1); assert.equal(h.renderCount(), renders + (wake === "render" ? 1 : 0));
  assert.equal(h.focusLeases.length, 1); assert.equal(h.focusEvents.length, 0);
  finishUpdate(); await flush();
  assert.equal(h.focusEvents.length, 1); assert.equal(h.focused().attributes.get("data-memory-profile-action"), "inspect");
  assert.deepEqual(h.focusEvents[0].options, { preventScroll: true });
  assert.equal(h.text().includes("#123abc"), false); assert.equal(h.calls.length, count); assert.equal(h.mutations().length, 0);
  assert.ok(h.focusLeases.every(lease => lease.disposed));
});

for (const boundary of ["grant", "parent"]) test(`profile focus: ${boundary} expiry restores to Load without reviving the grant`, async t => {
  const item = enrollment(boundary === "parent" ? { expiresAt: new Date(Date.now() + 10_000).toISOString() } : {});
  const grant = paletteGrant(item, boundary === "grant" ? { expiresAt: new Date(Date.now() + 10_000).toISOString() } : {});
  const { h } = await profileFixture(t, { item, grant }); h.enqueue(paletteProfile(h, grant)); await profileClick(h, "profileInspect");
  h.focus(profileAction(h, "profileSuppress")); const finishUpdate = h.holdUpdates(), count = h.calls.length;
  h.advance(10_000); h.fireTimer(); assert.equal(h.profileReceipts.at(-1).retireCalls, 1);
  finishUpdate(); await flush();
  assert.equal(h.focusEvents.length, 1); assert.equal(h.focused().attributes.get("data-memory-profile-action"), "load");
  assert.deepEqual(h.focusEvents[0].options, { preventScroll: true });
  assert.equal(profileAction(h, "profileInspect").disabled, true); assert.equal(profileAction(h, "profileRevoke").disabled, false);
  h.clock.now -= 10_000; assert.equal(profileAction(h, "profileInspect").disabled, true);
  assert.equal(h.text().includes("#123abc"), false); assert.equal(h.calls.length, count); assert.equal(h.mutations().length, 0);
});

for (const location of ["outside", "Inspect", "profile consent"]) test(`profile focus: expiry does not move focus from ${location}`, async t => {
  const { h, grant } = await profileFixture(t); h.enqueue(paletteProfile(h, grant, { leaseMs: 1_000 })); await profileClick(h, "profileInspect");
  if (location === "outside") h.stealFocus(); else h.focus(location === "Inspect" ? profileAction(h, "profileInspect") : h.field("memory-profile-consent"));
  const count = h.calls.length; h.advance(1_000); h.fireTimer(); await flush();
  assert.equal(h.profileReceipts.at(-1).retireCalls, 1); assert.equal(h.focusLeases.length, 0); assert.equal(h.focusEvents.length, 0);
  assert.equal(h.text().includes("#123abc"), false); assert.equal(h.calls.length, count); assert.equal(h.mutations().length, 0);
});

for (const outcome of ["acknowledgment", "transport error", "deadline"]) test(`profile focus: pending suppression uses the heading once through ${outcome}`, async t => {
  const { h, grant } = await profileFixture(t); h.enqueue(paletteProfile(h, grant, { leaseMs: 1_000 })); await profileClick(h, "profileInspect");
  const suppress = profileAction(h, "profileSuppress"); assert.equal(suppress.inProfileSubtree, true);
  const reply = deferred(); h.enqueue(() => reply.promise); const finishUpdate = h.holdUpdates(), count = h.calls.length;
  const pending = h.invoke(suppress, "@click").result; await flush();
  assert.equal(h.profileReceipts.at(-1).retireCalls, 1); assert.equal(h.text().includes("#123abc"), false);
  assert.equal(profileAction(h, "profileInspect").disabled, true); assert.equal(profileAction(h, "profileLoad").disabled, true);
  assert.equal(h.focusEvents.length, 0); finishUpdate(); await flush();
  assert.equal(h.focusEvents.length, 1); assert.equal(h.focused().attributes.get("data-memory-focus"), "heading");
  assert.equal(h.focused().attributes.get("tabindex"), "-1"); assert.deepEqual(h.focusEvents[0].options, { preventScroll: false });
  assert.ok(h.focusLeases.every(lease => lease.disposed));
  if (outcome === "deadline") { h.advance(1_000); h.fireTimer(); assert.equal(profileActions(h).at(-1).init.signal.aborted, true); }
  reply.resolve(outcome === "acknowledgment" ? { version: DOCUMENT_PROFILE_CONTROL_VERSION,
    suppression: { grantId: grant.grantId, grantRevision: grant.revision, claimKey: fixtureId(904), revision: 1,
      state: "active", createdAt: new Date(h.clock.now).toISOString(), expiresAt: grant.expiresAt } } : new Error("Synthetic suppression failure"));
  await pending;
  assert.equal(h.focusEvents.length, 1, "settlement never refocuses after the one-shot continuity lease");
  assert.equal(profileAction(h, "profileLoad").disabled, false); assert.equal(profileAction(h, "profileInspect").disabled, outcome !== "acknowledgment");
  assert.equal(h.text().includes("#123abc"), false); assert.equal(h.calls.length, count + 1); assert.equal(h.mutations().length, 1);
  assert.deepEqual(profileActions(h).at(-1).body, { version: DOCUMENT_PROFILE_CONTROL_VERSION, grantId: grant.grantId,
    grantRevision: grant.revision, claimKey: fixtureId(904), revision: 0, confirmation: "SUPPRESS_DOCUMENT_PALETTE_CLAIM" });
});

for (const action of ["Hide", "expiry", "Suppress"]) for (const interruption of ["new focus owner", "open dialog", "hidden then visible"])
  test(`profile focus: ${action} continuity cannot override ${interruption}`, async t => {
    const { h, grant } = await profileFixture(t); h.enqueue(paletteProfile(h, grant, { leaseMs: 1_000 })); await profileClick(h, "profileInspect");
    const finishUpdate = h.holdUpdates(), count = h.calls.length, reply = deferred(); let pending;
    if (action === "Hide") pending = profileClick(h, "profileHideView");
    else if (action === "Suppress") { h.enqueue(() => reply.promise); pending = profileClick(h, "profileSuppress"); }
    else { h.focus(profileAction(h, "profileHideView")); h.advance(1_000); h.fireTimer(); }
    await flush(); assert.equal(h.focusLeases.length, 1); assert.equal(h.focusEvents.length, 0);
    if (interruption === "new focus owner") h.stealFocus();
    else if (interruption === "open dialog") h.setDialogOpen(true);
    else { h.visibility("hidden"); h.visibility("visible"); }
    finishUpdate(); await flush();
    if (action === "Suppress") reply.resolve(new Error("Synthetic interrupted suppression"));
    await pending; h.setDialogOpen(false);
    assert.equal(h.focusEvents.length, 0); assert.ok(h.focusLeases.every(lease => lease.disposed));
    assert.equal(h.text().includes("#123abc"), false); assert.equal(h.calls.length, count + (action === "Suppress" ? 1 : 0));
  });

for (const boundary of ["events", "content", "authorization", "close and reopen", "disconnect"])
  test(`profile focus: expiry restoration rejects ${boundary} before update completion`, async t => {
    const { h, grant } = await profileFixture(t); h.enqueue(paletteProfile(h, grant, { leaseMs: 1_000 })); await profileClick(h, "profileInspect");
    h.focus(profileAction(h, "profileHideView")); const finishUpdate = h.holdUpdates(), count = h.calls.length;
    h.advance(1_000); h.fireTimer(); assert.equal(h.focusLeases.length, 1);
    assert.equal(h.text().includes("#123abc"), false);
    if (boundary === "events") { h.state.events = []; h.notify(); }
    else if (boundary === "content") { h.state.content = {}; h.notify(); }
    else if (boundary === "authorization") h.state.authorization++;
    else if (boundary === "close and reopen") { profileToggle(h, false); profileToggle(h, true); }
    else h.disconnect();
    finishUpdate(); await flush();
    assert.equal(h.focusEvents.length, 0); assert.ok(h.focusLeases.every(lease => lease.disposed));
    assert.equal(h.calls.length, count); assert.equal(h.mutations().length, 0);
  });

test("profile focus: a newer same-grant request invalidates Hide continuity even without a focus event", async t => {
  const { h, grant } = await profileFixture(t); h.enqueue(paletteProfile(h, grant)); await profileClick(h, "profileInspect");
  const finishUpdate = h.holdUpdates(), pending = profileClick(h, "profileHideView"), lease = h.focusLeases.at(-1), count = h.calls.length;
  // Direct finite callback invocation deliberately does not model another native
  // gesture. This isolates request identity from the focus port's epoch guard.
  const inspect = profileAction(h, "profileInspect"); h.enqueue(new Error("Synthetic replacement Inspect failure"));
  await inspect.attributes.get("@click")({ currentTarget: h.target(inspect) });
  assert.equal(lease.current(), true); assert.equal(h.text().includes("#123abc"), false);
  finishUpdate(); await pending;
  assert.equal(h.focusEvents.length, 0); assert.equal(lease.disposed, true);
  assert.equal(h.calls.length, count + 1); assert.equal(h.mutations().length, 0); assert.equal(profileAction(h, "profileLoad").disabled, false);
});


// Detached S4 privacy response controls. These cases use the existing actual-client
// fixture; they do not qualify browser rendering, native storage, or deployment.
const structuredCleanup = (state, scopeKey = fixtureId(700)) => ({ scopeKey: state === "unreported" ? null : scopeKey, state });
const pendingStructuredForget = () => ({ erased: false, memoryWithdrawn: true, physicalCleanupPending: true,
  reEnrollmentRequired: true, otherDevicesAndBackupsPurged: false });
const withdrawnStructuredRow = (row, state = "pending") => ({ ...row, revision: row.revision + 1,
  learn: false, recall: false, background: false, status: "forgotten", structuredCleanup: structuredCleanup(state) });

test("structured cleanup controls: pending GET survives remount and active enrollment replacement", async t => {
  const row = enrollment({ structuredCleanup: structuredCleanup("pending") }), page = settings([row]);
  const h = fixture(t, { initial: page }); await flush(); await h.select();
  assert.ok(h.text().includes("memory.live.cleanupPending"));
  assert.equal(h.text().includes("memory.live.forgetPending"), false, "GET state is not a new withdrawal receipt");
  h.disconnect(); h.enqueue(page); h.connect(); await flush();
  assert.ok(h.text().includes("memory.live.cleanupPending"), "the status is reconstructed from GET, not a toast");
  const replacement = enrollment({ id: fixtureId(2), revision: 1, structuredCleanup: structuredCleanup("pending") });
  await h.select("fixture-document", settings([replacement]));
  assert.ok(h.text().includes("memory.live.cleanupPending"));
  assert.equal(h.field("memory-learn").attributes.get(".checked"), true);
  assert.equal(h.field("memory-recall").attributes.get(".checked"), true);
  assert.equal(h.field("memory-consent").attributes.get(".checked"), false);
  assert.equal(h.text().includes("memory.live.forgotten"), false);
  assert.equal(h.text().includes("memory.live.forgetPending"), false);
  assert.equal(h.mutations().length, 0, "scope continuity never re-enrolls or activates memory");
});

test("structured cleanup controls: pending Forget is acknowledged separately and explicit reload reconciles completion", async t => {
  const row = enrollment(), pending = withdrawnStructuredRow(row);
  const h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  h.confirmations.push(true); h.enqueue(pendingStructuredForget()); h.enqueue(settings([pending]));
  await h.click("forget");
  assert.deepEqual(h.calls.map(call => call.init.method), ["GET", "GET", "DELETE", "GET"]);
  assert.ok(h.text().includes("memory.live.forgetPending")); assert.ok(h.text().includes("memory.live.cleanupPending"));
  assert.doesNotMatch(h.text(), /role="status">memory\.live\.forgot<\/p>/u);
  assert.equal(h.text().includes("memory.live.cleanupComplete"), false);
  assert.equal(h.field("memory-learn").attributes.get(".checked"), false);
  assert.equal(h.field("memory-recall").attributes.get(".checked"), false);
  assert.equal(h.field("memory-consent").attributes.get(".checked"), false);
  assert.equal(h.focused().attributes.get("data-memory-action"), "refresh");
  h.enqueue(settings([{ ...pending, structuredCleanup: structuredCleanup("complete") }]));
  await h.click("reload"); await flush();
  assert.ok(h.text().includes("memory.live.cleanupComplete"));
  assert.equal(h.text().includes("memory.live.cleanupPending"), false);
  assert.equal(h.text().includes("memory.live.forgetPending"), false, "a historical pending toast does not survive explicit reconciliation");
  assert.equal(h.mutations().length, 1, "checking cleanup does not repeat erasure or enroll the user");
});

test("structured cleanup controls: complete Forget and complete active-scope cleanup are not interchangeable", async t => {
  const row = enrollment(), complete = withdrawnStructuredRow(row, "complete");
  const h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  h.confirmations.push(true); h.enqueue(forgotten()); h.enqueue(settings([complete])); await h.click("forget");
  assert.match(h.text(), /role="status">memory\.live\.forgot<\/p>/u); assert.ok(h.text().includes("memory.live.cleanupComplete"));
  assert.equal(h.text().includes("memory.live.forgetPending"), false);
  const replacement = enrollment({ id: fixtureId(2), structuredCleanup: structuredCleanup("complete") });
  h.enqueue(settings([replacement])); await h.click("reload"); await flush();
  assert.ok(h.text().includes("memory.live.cleanupComplete"));
  assert.equal(h.field("memory-learn").attributes.get(".checked"), true);
  assert.equal(h.field("memory-recall").attributes.get(".checked"), true);
  assert.equal(h.text().includes("memory.live.forgotten"), false);
  assert.equal(h.text().includes("memory.live.forgetPending"), false);
  assert.equal(h.mutations().length, 1);
});

for (const legacy of ["missing", "unreported"]) test("structured cleanup controls: " + legacy + " status never claims physical completion", async t => {
  const row = withdrawnStructuredRow(enrollment());
  if (legacy === "missing") delete row.structuredCleanup;
  else row.structuredCleanup = structuredCleanup("unreported");
  const h = fixture(t, { initial: settings([row]) }); await flush();
  assert.ok(h.text().includes("memory.live.cleanupUnreported"));
  assert.equal(h.text().includes("memory.live.cleanupComplete"), false);
  assert.equal(h.text().includes("memory.live.cleanupPending"), false);
  assert.equal(h.mutations().length, 0);
});

for (const state of ["absent", "active"]) test("structured cleanup controls: " + state + " is not a completed cleanup", async t => {
  const h = fixture(t, { initial: settings([enrollment({ structuredCleanup: structuredCleanup(state) })]) }); await flush();
  assert.equal(h.text().includes("memory.live.cleanupComplete"), false);
  assert.equal(h.text().includes("memory.live.cleanupPending"), false);
  assert.equal(h.text().includes("memory.live.cleanupUnreported"), false);
  assert.equal(h.mutations().length, 0);
});

for (const [name, response] of [
  ["contradictory", () => ({ ...pendingStructuredForget(), erased: true })],
  ["missing withdrawal", () => ({ ...pendingStructuredForget(), memoryWithdrawn: false })],
  ["unconfirmed commit", () => Response.json({ error: "memory_write_unconfirmed" }, { status: 409 })],
  ["transport failure", () => new Error("synthetic unconfirmed erasure")],
]) test("structured cleanup controls: " + name + " does not leave success or stale complete status", async t => {
  const row = enrollment({ structuredCleanup: structuredCleanup("complete") });
  const h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  assert.ok(h.text().includes("memory.live.cleanupComplete"));
  h.confirmations.push(true); h.enqueue(response()); await h.click("forget");
  assert.equal(h.calls.length, 3, "an uncertain mutation is not automatically refreshed or retried");
  assert.equal(h.mutations().length, 1); assert.ok(h.text().includes("memory.live.unknown"));
  assert.doesNotMatch(h.text(), /role="status">memory\.live\.forgot<\/p>/u);
  assert.ok(h.text().includes("memory.live.cleanupUnreported"));
  assert.equal(h.text().includes("memory.live.cleanupComplete"), false);
  assert.equal(h.text().includes("memory.live.forgetPending"), false);
  assert.equal(h.action("save").disabled, true); assert.equal(h.action("forget").disabled, true);
  h.enqueue(settings([withdrawnStructuredRow(row)])); await h.click("reload"); await flush();
  assert.ok(h.text().includes("memory.live.cleanupPending"));
  assert.equal(h.text().includes("memory.live.unknown"), false);
  assert.equal(h.mutations().length, 1);
});

for (const departure of ["actor", "disconnect"]) test("structured cleanup controls: late pending Forget cannot publish after " + departure, async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  const delayed = delayedJson(pendingStructuredForget()); h.confirmations.push(true); h.enqueue(delayed.response);
  const pending = h.click("forget"); await flush();
  assert.equal(h.mutations().length, 1); assert.equal(delayed.cancellations, 0);
  if (departure === "actor") { h.enqueue(settings()); h.move({ actor: "other-privacy-user" }, "forma-authorization-changed"); }
  else h.disconnect();
  assert.equal(delayed.cancellations, 1); assert.equal(delayed.release(), "cancelled");
  await pending; await flush();
  assert.equal(h.text().includes("memory.live.forgetPending"), false);
  assert.equal(h.text().includes("memory.live.cleanupPending"), false);
  assert.equal(h.text().includes("memory.live.cleanupComplete"), false);
  assert.equal(h.focusEvents.length, 0, "departed ownership cannot restore focus from the mutation");
  assert.equal(h.calls.length, departure === "actor" ? 4 : 3, "only the new owner's explicit initial GET may run");
  assert.equal(h.mutations().length, 1);
});

for (const action of ["save", "stop"]) test("structured cleanup controls: " + action + " retains its active settings while old cleanup is pending", async t => {
  const row = enrollment(), h = fixture(t, { initial: settings([row]) }); await flush(); await h.select();
  if (action === "save") chooseConsent(h);
  let acknowledgement;
  h.enqueue((_url, init) => { acknowledgement = { ...saved(JSON.parse(init.body)), priorMemoryCleared: false }; return acknowledgement; });
  h.enqueue(() => settings([{ ...acknowledgement.enrollment, structuredCleanup: structuredCleanup("pending") }]));
  if (action === "save") await h.submit(); else await h.click("stop");
  assert.equal(h.mutations().length, 1); assert.equal(h.mutations()[0].init.method, "PUT");
  assert.equal(h.mutations()[0].body.learn, action === "save");
  assert.equal(h.mutations()[0].body.recall, true);
  assert.equal(h.mutations()[0].body.background, action === "save");
  assert.equal(h.field("memory-learn").attributes.get(".checked"), action === "save");
  assert.equal(h.field("memory-recall").attributes.get(".checked"), true);
  assert.equal(h.field("memory-consent").attributes.get(".checked"), false);
  assert.ok(h.text().includes(action === "save" ? "memory.live.savedMessage" : "memory.live.stopMessage"));
  assert.ok(h.text().includes("memory.live.cleanupPending"));
  assert.equal(h.text().includes("memory.live.savedCleared"), false);
  assert.equal(h.text().includes("memory.live.clearedMessage"), false);
  assert.equal(h.text().includes("memory.live.forgetPending"), false);
  assert.equal(h.text().includes("memory.live.forgotten"), false);
});

for (const locale of ["en", "fr", "ja", "ar"]) test("structured cleanup controls: " + locale + " renders localized pending, complete, unreported and unknown outcomes", async t => {
  const row = enrollment({ structuredCleanup: structuredCleanup("pending") });
  const h = fixture(t, { initial: settings([row]), locale, localized: true }); await flush();
  const text = key => personalMemoryMessage(locale, "memory.live." + key);
  assert.ok(h.text().includes(text("cleanupPending"))); assert.equal(h.text().includes("memory.live."), false);
  // The existing row action has a localized accessible label and a stable danger class.
  const forgetControl = h.all().find(control => control.tag === "button" && control.label === text("forget"));
  assert.ok(forgetControl); h.confirmations.push(true); h.enqueue(pendingStructuredForget());
  h.enqueue(settings([withdrawnStructuredRow(row)])); await h.invoke(forgetControl, "@click").result;
  assert.ok(h.text().includes(text("forgetPending"))); assert.ok(h.text().includes(text("cleanupPending")));
  assert.ok(h.dialogs[0].message.includes(text("forgetMessage")));
  const reload = () => h.all().find(control => control.attributes.get("data-memory-action") === "refresh");
  h.enqueue(settings([withdrawnStructuredRow(row, "complete")])); await h.invoke(reload(), "@click").result; await flush();
  assert.ok(h.text().includes(text("cleanupComplete"))); assert.equal(h.text().includes(text("forgetPending")), false);
  h.enqueue(settings([enrollment()])); await h.invoke(reload(), "@click").result; await flush();
  assert.ok(h.text().includes(text("cleanupUnreported"))); assert.equal(h.text().includes(text("cleanupComplete")), false);
  const latestForget = h.all().find(control => control.tag === "button" && control.label === text("forget"));
  h.confirmations.push(true); h.enqueue({ ...pendingStructuredForget(), erased: true }); await h.invoke(latestForget, "@click").result;
  assert.ok(h.text().includes(text("unknown"))); assert.equal(h.text().includes(text("forgetPending")), false);
  assert.equal(h.text().includes(text("cleanupComplete")), false); assert.equal(h.mutations().length, 2);
});


for (const conflict of ["scope identity", "cleanup state"]) test("structured cleanup controls: later-page " + conflict + " requires explicit reconciliation", async t => {
  const rows = Array.from({ length: 50 }, (_, index) => enrollment({ id: fixtureId(index + 1), documentId: "page-document-" + index,
    ...(index === 0 ? { structuredCleanup: structuredCleanup("pending") } : {}) }));
  const page = settings(rows, { nextAfter: fixtureId(50) });
  const h = fixture(t, { initial: page }); await flush();
  assert.ok(h.text().includes("memory.live.cleanupPending"));
  h.enqueue(settings([enrollment({ id: fixtureId(51), documentId: conflict === "scope identity" ? "different-scope-document" : rows[0].documentId,
    structuredCleanup: structuredCleanup(conflict === "cleanup state" ? "complete" : "pending") })]));
  h.click("more"); await flush();
  assert.ok(h.text().includes("memory.live.conflict"));
  assert.ok(h.text().includes("memory.live.cleanupUnreported"));
  assert.equal(h.text().includes("memory.live.cleanupComplete"), false);
  assert.equal(h.text().includes("memory.live.cleanupPending"), false);
  assert.equal(h.text().includes("different-scope-document"), false);
  assert.equal(h.action("more").disabled, true); assert.equal(h.action("reload").disabled, false);
  assert.equal(h.mutations().length, 0); assert.equal(h.calls.length, 2);
});

function purposeSettings(item,{grant=null,ready=false,enabled=true,financial,behavioral=false}={}){
  const terms={version:'memory-derivation-terms-v1',purpose:'rolling-summary',recipeVersion:'memory-derivation-candidates-v1',provider:'openai',model:'isolated-test-model',pricing:{inputMicroUsdPerMillion:1000000,cachedInputMicroUsdPerMillion:0,outputMicroUsdPerMillion:2000000},maximumInputTokens:1000,maximumOutputTokens:100,monthlyCapMicroUsd:100000,payer:'self-ai-allowance',providerStore:false,providerRetentionDisclosure:'Isolated synthetic qualification only; no real provider retention claim.',retentionPolicyId:'isolated-retention',evidence:Object.fromEntries(['modelAccess','pricing','retention','tokenBounds','nativeAccounting','failureRecovery','privacy','benchmark','capApproval'].map(key=>[key,'a'.repeat(64)]))};
  const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
  if(behavioral)terms.recipeVersion='memory-derivation-candidates-v2';
  const offer={qualificationId:'isolated-qualification',termsSha256:createHash('sha256').update(canonical(terms)).digest('hex'),expiresAt:item.expiresAt,terms};
  return {version:MEMORY_DERIVATION_CONTROL,enabled,available:enabled,reason:enabled?null:'disabled',policyVersion:MEMORY_DERIVATION_POLICY,
    scope:{projectId:item.projectId,documentId:item.documentId,custody:{kind:'personal'}},enrollmentId:item.id,enrollmentRevision:item.revision,
    grants:grant?[grant]:[],qualifications:enabled?[offer]:[],capScope:'payer-utc-calendar-month-all-memory-purposes',sourceWindow:enabled&&behavioral?'qualified-recipe':'future-originals',processingImplemented:ready,...(financial?{financial}:{})};
}
function purposeGrant(item,control=purposeSettings(item)){
  const offer=control.qualifications[0];return {scope:control.scope,grantId:'a'.repeat(64),revision:1,consentId:crypto.randomUUID(),purpose:'rolling-summary',enrollmentId:item.id,enrollmentRevision:item.revision,
    qualificationId:offer.qualificationId,termsSha256:offer.termsSha256,monthlyCapMicroUsd:offer.terms.monthlyCapMicroUsd,sourceAfterSequence:9,background:false,retentionDays:item.retentionDays,
    consentedAt:new Date(Date.now()-1000).toISOString(),expiresAt:item.expiresAt,revokedAt:null};
}
function purposeToggle(h,open){const details=h.all().find(control=>control.attributes.has('data-memory-purposes'));assert.ok(details);return h.invoke(details,'@toggle',{currentTarget:{...h.target(details),open}}).result;}
function purposeSubmit(h){const form=h.all().find(control=>control.attributes.has('data-memory-purpose-form'));assert.ok(form);return h.invoke(form,'@submit').result;}
const purposeActions=h=>h.calls.filter(call=>String(call.url).startsWith('/api/memory/derivation/'));
function purposeConsent(h){h.change('memory-purpose-qualification','isolated-qualification');h.change('memory-purpose-charge',true);h.change('memory-purpose-consent',true);}
async function purposeFixture(t,{ready=true,grant=false,enabled=true,locale='en',localized=false,financial,behavioral=false}={}){
  const item=enrollment(),h=fixture(t,{initial:settings([item]),locale,localized});await flush();await h.select(item.documentId);purposeToggle(h,true);
  const control=purposeSettings(item,{ready,enabled,financial,behavioral}),known=grant?purposeGrant(item):null;control.grants=known?[known]:[];
  h.enqueue(control);await profileClick(h,'purposeLoad');return{h,item,control,grant:known};
}
test('derived purpose controls never load on mount, selection or disclosure; inactive processing cannot enroll',async t=>{
  const item=enrollment(),h=fixture(t,{initial:settings([item])});await flush();await h.select(item.documentId);purposeToggle(h,true);
  assert.equal(purposeActions(h).length,0);assert.match(h.text(),/memory.live.purposeNotLoaded/u);
  h.enqueue(purposeSettings(item));await profileClick(h,'purposeLoad');assert.equal(purposeActions(h).length,1);
  purposeConsent(h);await purposeSubmit(h);assert.equal(h.mutations().length,0);assert.equal(profileAction(h,'purposeEnable').disabled,true);
});
test('derived purpose consent is explicit, allowance-specific and independent of profile/reference drafts',async t=>{
  const {h,item,control}=await purposeFixture(t);await purposeSubmit(h);assert.equal(h.mutations().length,0);
  h.change('memory-purpose-qualification','isolated-qualification');h.change('memory-purpose-consent',true);await purposeSubmit(h);assert.equal(h.mutations().length,0);
  h.change('memory-purpose-charge',true);assert.equal(h.field('memory-purpose-consent').attributes.get('.checked'),false);h.change('memory-purpose-consent',true);
  const grant=purposeGrant(item,control);h.enqueue({version:MEMORY_DERIVATION_CONTROL,grant,capScope:control.capScope,processingImplemented:true});await purposeSubmit(h);
  assert.equal(purposeActions(h).length,2);const body=purposeActions(h)[1].body;assert.equal(body.chargeMyAiAllowance,true);assert.equal(body.background,false);
  assert.equal(body.sourceWindow,'future-originals');assert.equal(body.expectedConsentId,null);assert.equal(body.monthlyCapMicroUsd,control.qualifications[0].terms.monthlyCapMicroUsd);
  assert.equal(h.field('memory-consent').attributes.get('.checked'),false);assert.equal(h.field('memory-purpose-charge').attributes.get('.checked'),false);
  assert.match(h.text(),/memory.live.purposeSaved/u);assert.equal(profileActions(h).length,0);
});
test('derived purpose uncertain enable requires explicit reload and never retries',async t=>{
  const {h}=await purposeFixture(t);purposeConsent(h);h.enqueue(new Error('fixture lost acknowledgement'));await purposeSubmit(h);
  assert.match(h.text(),/memory.live.purposeUnknown/u);const count=purposeActions(h).length;await purposeSubmit(h);assert.equal(purposeActions(h).length,count);
  assert.equal(profileAction(h,'purposeEnable').disabled,true);
});
test('derived purpose known revoke works when processing and qualification are disabled',async t=>{
  const {h,grant}=await purposeFixture(t,{grant:true,enabled:false,ready:false});
  h.enqueue({version:MEMORY_DERIVATION_CONTROL,revoked:true,grantId:grant.grantId,revision:grant.revision,consentId:grant.consentId,reEnrollmentRequired:true});
  await profileClick(h,'purposeRevoke');const sent=purposeActions(h).at(-1);assert.equal(sent.init.method,'DELETE');assert.equal(sent.body.consentId,grant.consentId);
  assert.match(h.text(),/memory.live.purposeRevoked/u);assert.equal(profileAction(h,'purposeRevoke').disabled,true);
});
test('derived purpose closing and reopening retires old callbacks and requires an explicit new load',async t=>{
  const {h}=await purposeFixture(t);purposeConsent(h);const stale=h.all().find(control=>control.attributes.has('data-memory-purpose-form'));
  purposeToggle(h,false);purposeToggle(h,true);await h.invoke(stale,'@submit').result;assert.equal(h.mutations().length,0);
  assert.match(h.text(),/memory.live.purposeNotLoaded/u);assert.equal(purposeActions(h).length,1);
});
test('derived purpose response cannot survive scope navigation',async t=>{
  const {h,item}=await purposeFixture(t);purposeConsent(h);const delayed=delayedJson({version:MEMORY_DERIVATION_CONTROL,grant:purposeGrant(item),capScope:'payer-utc-calendar-month-all-memory-purposes',processingImplemented:true});
  h.enqueue(delayed.response);const pending=purposeSubmit(h);h.enqueue(settings([item]));h.move({route:'/library'});await flush();delayed.release();await pending;
  assert.doesNotMatch(h.text(),/memory.live.purposeSaved/u);assert.equal(h.mutations().length,1);
});
for(const locale of ['en','fr','ar','ja'])test('derived purpose controls have localized inactive and consent disclosures: '+locale,async t=>{
  const {h}=await purposeFixture(t,{locale,localized:true,ready:false});assert.doesNotMatch(h.text(),/memory\.live\.purpose/u);
  assert.ok(h.text().includes(personalMemoryMessage(locale,'memory.live.purposeInactive')));
});
for(const locale of ['en','fr','ar','ja'])test('derived purpose controls disclose retained finance without enrolling: '+locale,async t=>{
  const at=new Date().toISOString(),financial={period:at.slice(0,7),checkedAt:at,capMicroUsd:100000,usedMicroUsd:580,reservedMicroUsd:1200,remainingMicroUsd:98220,retention:'independent-of-memory-erasure'};
  const {h}=await purposeFixture(t,{locale,localized:true,ready:false,financial});
  assert.ok([...templates(h.render())].some(value=>value.strings.some(part=>part.includes('data-memory-financial'))));
  assert.ok(h.text().includes(personalMemoryMessage(locale,'memory.live.purposeFinanceRetention')));assert.doesNotMatch(h.text(),/memory\.live\.purpose/u);
  assert.equal(h.mutations().length,0);assert.equal(purposeActions(h).length,1);assert.equal(profileAction(h,'purposeEnable').disabled,true);
});

function derivedReviewFixture(item){
  const scope={projectId:item.projectId,documentId:item.documentId,custody:{kind:'personal'}},jobId='1'.repeat(64),lineage='2'.repeat(64),claimKey='3'.repeat(64),scopeKey='isolated-private-native-scope';
  const validUntil=new Date(Date.now()+30_000).toISOString(),entry={jobId,purpose:'rolling-summary',scopeKey,expiresAt:item.expiresAt};
  return {entry,lineage,claimKey,list:{version:MEMORY_DERIVATION_CONTROL,scope,enrollmentId:item.id,enrollmentRevision:item.revision,results:[entry],next:null,checkedAt:new Date().toISOString(),progress:[]},
    result:{version:MEMORY_DERIVATION_CONTROL,jobId,expiresAt:item.expiresAt,controlRevisions:{[lineage]:0},candidate:{version:'memory-derivation-candidates-v1',purpose:'rolling-summary',scopeKey,manifestId:jobId,manifestRevision:1,validUntil,semanticAuthority:'model-derived-unverified',semanticCompleteness:false,independentEvidence:false,
      items:[{operation:'assert',target:null,category:'proposal',text:'Private tentative memory proposal.',supports:[{sourceIndex:0,start:0,end:8,text:'Original'}],counterevidence:[],claimKey,lineageIds:[lineage],sourceBindings:[{sourceId:'fixture-original',revision:1,contentHash:fixtureId(901)}],validUntil,citationStatus:'support-cited'}]}}};
}
async function inspectDerivedReview(t){const {h,item}=await purposeFixture(t),data=derivedReviewFixture(item);h.enqueue(data.list);await profileClick(h,'reviewLoad');h.enqueue(data.result);await profileClick(h,'reviewInspect');assert.match(h.text(),/Private tentative memory proposal/);return {h,item,data};}
test('derived review is explicit, read-only until a named user action, and does not enroll',async t=>{
  const {h,item}=await purposeFixture(t),data=derivedReviewFixture(item);assert.equal(purposeActions(h).length,1);
  h.enqueue(data.list);await profileClick(h,'reviewLoad');assert.doesNotMatch(h.text(),/Private tentative memory proposal/);
  h.enqueue(data.result);await profileClick(h,'reviewInspect');assert.match(h.text(),/Private tentative memory proposal/);assert.equal(h.mutations().length,0);
  assert.equal(profileAction(h,'reviewCorrect').disabled,true);
  h.enqueue({version:MEMORY_DERIVATION_CONTROL,jobId:data.entry.jobId,state:'withdrawn',controls:[{controlId:'4'.repeat(64),claimKey:data.claimKey,lineageId:data.lineage,revision:1,action:'suppressed',correctionText:null,expiresAt:item.expiresAt,semanticAuthority:'explicit-user-control'}]});
  await profileClick(h,'reviewSuppress');assert.equal(h.mutations().length,1);assert.equal(h.mutations()[0].body.action,'suppressed');
  assert.deepEqual(h.mutations()[0].body.expectedRevisions,{[data.lineage]:0});assert.doesNotMatch(h.text(),/Private tentative memory proposal/);assert.match(h.text(),/memory.live.reviewChanged/);
});
for(const transition of ['expiry','visibility','close','navigation'])test('derived review retires private content and stale callbacks on '+transition,async t=>{
  const {h,item}=await inspectDerivedReview(t),stale=profileAction(h,'reviewSuppress'),before=h.mutations().length;
  if(transition==='expiry'){h.advance(31_000);h.fireTimer();}
  if(transition==='visibility'){h.visibility('hidden');h.visibility('visible');}
  if(transition==='close'){purposeToggle(h,false);purposeToggle(h,true);}
  if(transition==='navigation'){h.enqueue(settings([item]));h.move({route:'/library'});await flush();}
  assert.doesNotMatch(h.text(),/Private tentative memory proposal/);await h.invoke(stale,'@click').result;assert.equal(h.mutations().length,before);
});
test('derived review uncertain mutation clears private view, requires reload, and never retries',async t=>{
  const {h}=await inspectDerivedReview(t),stale=profileAction(h,'reviewSuppress');h.enqueue(new Error('lost-review-ack'));await profileClick(h,'reviewSuppress');
  assert.match(h.text(),/memory.live.purposeUnknown/);assert.doesNotMatch(h.text(),/Private tentative memory proposal/);await h.invoke(stale,'@click').result;assert.equal(h.mutations().length,1);
});

for(const locale of ['en','fr','ar','ja'])for(const boundary of ['consent','bounded','capacity'])test('derived review discloses original-history boundary '+locale+' '+boundary,async t=>{
  const {h,item}=await purposeFixture(t,{locale,localized:true}),data=derivedReviewFixture(item);
  data.result.history={windowCount:3,originalPairs:6,boundary,afterSequence:5,throughSequence:25};
  h.enqueue(data.list);await profileClick(h,'reviewLoad');h.enqueue(data.result);await profileClick(h,'reviewInspect');
  assert.ok(h.text().includes(personalMemoryMessage(locale,'memory.live.reviewHistory.'+boundary)));
  assert.doesNotMatch(h.text(),/memory\.live\.reviewHistory/);assert.equal(h.mutations().length,0);
});
for(const fault of ['too-many-windows','too-many-pairs','reversed','unknown-boundary','extra-key'])test('derived review refuses malformed history '+fault,async t=>{
  const {h,item}=await purposeFixture(t),data=derivedReviewFixture(item);
  data.result.history={windowCount:3,originalPairs:6,boundary:'bounded',afterSequence:5,throughSequence:25};
  if(fault==='too-many-windows')data.result.history.windowCount=4;
  if(fault==='too-many-pairs')data.result.history.originalPairs=65;
  if(fault==='reversed')data.result.history.throughSequence=4;
  if(fault==='unknown-boundary')data.result.history.boundary='all-history-complete';
  if(fault==='extra-key')data.result.history.permission=true;
  h.enqueue(data.list);await profileClick(h,'reviewLoad');h.enqueue(data.result);await profileClick(h,'reviewInspect');
  assert.doesNotMatch(h.text(),/Private tentative memory proposal/);assert.equal(h.mutations().length,0);
});

for(const purpose of ['rolling-summary','profile','suggestion'])test('latest derived '+purpose+' is purpose-bound, freshly inspected and never enrolled',async t=>{
  const {h,item}=await purposeFixture(t),data=derivedReviewFixture(item);
  data.entry.purpose=purpose;data.result.candidate.purpose=purpose;data.list.purpose=purpose;
  const before=purposeActions(h).length;h.enqueue(data.list);h.enqueue(data.result);await profileClick(h,'reviewLatest.'+purpose);
  assert.equal(purposeActions(h).length,before+2);assert.ok(purposeActions(h).at(-2).url.endsWith('&purpose='+purpose));
  assert.match(h.text(),/Private tentative memory proposal/);assert.equal(h.mutations().length,0);
  h.visibility('hidden');h.visibility('visible');assert.doesNotMatch(h.text(),/Private tentative memory proposal/);
});
test('latest derived purpose refuses a mismatched inventory without loading any body',async t=>{
  const {h,item}=await purposeFixture(t),data=derivedReviewFixture(item),before=purposeActions(h).length;
  data.list.purpose='suggestion';h.enqueue(data.list);await profileClick(h,'reviewLatest.profile');
  assert.equal(purposeActions(h).length,before+1);assert.doesNotMatch(h.text(),/Private tentative memory proposal/);assert.match(h.text(),/memory.live.purposeError/);
});
test('latest derived purpose empty inventory does not load or invent a profile',async t=>{
  const {h,item}=await purposeFixture(t),data=derivedReviewFixture(item),before=purposeActions(h).length;
  data.list.purpose='profile';data.list.results=[];h.enqueue(data.list);await profileClick(h,'reviewLatest.profile');
  assert.equal(purposeActions(h).length,before+1);assert.match(h.text(),/memory.live.reviewEmpty/);assert.equal(h.mutations().length,0);
});

test('recorded visits: block inspection is descriptive and retires with its parent receipt',async t=>{
  const row=enrollment(),h=fixture(t,{initial:settings([row])});await openVisitAction(h,row);
  const body=visitsRecall(row,{checkedAt:new Date(h.clock.now).toISOString()}),p=body.consumptionEpisodes;
  p.sources[0]={...p.sources[0],type:'BlockInspected',target:{kind:'block',documentId:row.documentId,blockId:'private-inspected-block',revision:4,stateSha256:'a'.repeat(64)}};p.episodes[0].observations[0].kind='inspector-open';p.coverage.unavailableBlockSourceCount=1;
  h.enqueue(body);await h.click('visitsInclude');assert.ok(h.text().includes('memory.live.visitsBlockOpened'));assert.ok(h.text().includes('memory.live.visitsBlockUnavailable'));
  assert.equal(h.text().includes('private-inspected-block'),false);assert.equal(h.text().includes('a'.repeat(64)),false);await h.click('hide');assert.equal(h.text().includes('memory.live.visitsBlockOpened'),false);
});

test('recorded visits: rolling windows stay inside the explicit parent receipt and disclose overlap',async t=>{
  const row=enrollment(),h=fixture(t,{initial:settings([row])});await openVisitAction(h,row);
  assert.equal(h.all().some(control=>control.attributes.has('data-memory-consumption-windows')),false);
  const body=visitsRecall(row,{checkedAt:new Date(h.clock.now).toISOString()}),p=body.consumptionEpisodes;
  p.sources[0]={...p.sources[0],type:'BlockInspected',target:{kind:'block',documentId:row.documentId,blockId:'private-window-block',revision:4,stateSha256:'a'.repeat(64)}};p.episodes[0].observations[0].kind='inspector-open';
  h.enqueue(body);await h.click('visitsInclude');const detail=h.all().find(control=>control.attributes.has('data-memory-consumption-windows'));assert.ok(detail);assert.equal(detail.attributes.has('open'),false);assert.equal(detail.attributes.has('?open'),false);
  assert.ok(h.text().includes('memory.live.visitsWindowBasis'));assert.ok(h.text().includes('memory.live.visitsBlockCount'));assert.equal(h.text().includes('private-window-block'),false);
  const calls=h.calls.length;h.render();assert.equal(h.calls.length,calls);await h.click('hide');assert.equal(h.all().some(control=>control.attributes.has('data-memory-consumption-windows')),false);
});

for(const locale of ['en','fr','ar','ja'])test('behavioral purpose consent is explicit and localized '+locale,async t=>{
  const {h,item,control}=await purposeFixture(t,{behavioral:true,locale,localized:true});
  h.change('memory-purpose-qualification','isolated-qualification');assert.doesNotMatch(h.text(),/memory\.live\.purpose/);
  assert.equal(h.mutations().length,0);h.change('memory-purpose-charge',true);await purposeSubmit(h);assert.equal(h.mutations().length,0);
  h.change('memory-purpose-consent',true);const grant=purposeGrant(item,control);h.enqueue({version:MEMORY_DERIVATION_CONTROL,grant,capScope:control.capScope,processingImplemented:true});await purposeSubmit(h);
  const call=h.mutations().at(-1);assert.ok(call);assert.equal(JSON.parse(call.init.body).sourceWindow,'future-originals-and-actions');
});

test('derived export recertifies on click and downloads only the fresh private result',async t=>{
  const {h,data}=await inspectDerivedReview(t);assert.equal(h.downloads.length,0);
  const fresh=structuredClone(data.result);fresh.candidate.items[0].text='Fresh private proposal, not the cached view.';
  h.enqueue(fresh);const before=h.calls.length;await profileClick(h,'reviewExport');
  assert.equal(h.calls.length,before+1);assert.equal(h.calls.at(-1).url,'/api/memory/derivation/result?jobId='+data.entry.jobId);
  assert.equal(h.calls.at(-1).init.method,'GET');assert.equal(h.mutations().length,0);assert.equal(h.downloads.length,1);
  const download=h.downloads[0],body=JSON.parse(await download.blob.text());assert.equal(download.filename,'forma-memory-result.json');
  assert.equal(body.result.items[0].text,fresh.candidate.items[0].text);assert.equal(body.snapshotOnly,true);assert.equal(body.downloadedCopyRevocable,false);
  assert.equal(body.completeHistory,false);assert.equal(body.accessAuthority,false);assert.equal(body.treatment,'model-derived-unverified');
  assert.deepEqual(body.result.items[0].originalQuotes.supports,fresh.candidate.items[0].supports);
  assert.deepEqual(body.result.items[0].observedActions,[]);assert.equal(body.result.retentionUpperBound,data.entry.expiresAt);
  assert.doesNotMatch(await download.blob.text(),/sourceBindings|fixture-original|controlRevisions|lineageIds|scopeKey|validUntil/);
  assert.ok(h.text().includes('memory.live.reviewExportRequested'));assert.equal(h.revokedDownloadUrls.length,1);
  assert.ok(h.downloadLinks.every(link=>link.removed));
});
for(const transition of ['visibility','close','expiry','clock-backward','monotonic','events','content','navigation','actor','disconnect'])test('derived export prevents delayed download after '+transition,async t=>{
  const {h,item,data}=await inspectDerivedReview(t),delayed=delayedJson(data.result);h.enqueue(delayed.response);
  const pending=profileClick(h,'reviewExport');await flush();const request=h.calls.at(-1);
  if(transition==='visibility'){h.visibility('hidden');h.visibility('visible');}
  if(transition==='close')purposeToggle(h,false);
  if(transition==='expiry'){h.advance(31000);h.fireTimer();}
  if(transition==='clock-backward')h.clock.now-=1000;
  if(transition==='monotonic')h.clock.monotonic+=61000;
  if(transition==='events'||transition==='content'){h.state[transition]=transition==='events'?[]:{};h.notify();}
  if(transition==='navigation'||transition==='actor'){h.enqueue(settings([item]));h.move(transition==='navigation'?{route:'/library'}:{actor:'other-actor'});}
  if(transition==='disconnect')h.disconnect();
  delayed.release();await pending;await flush();assert.equal(h.downloads.length,0);assert.equal(h.mutations().length,0);
  assert.equal(request.init.method,'GET');assert.doesNotMatch(h.text(),/memory.live.purposeUnknown/);
});
for(const status of [401,403,404,409,503])test('derived export rejects native '+status+' without falling back to displayed memory',async t=>{
  const {h}=await inspectDerivedReview(t);h.enqueue(Response.json({error:'unavailable'},{status}));const before=h.calls.length;
  await profileClick(h,'reviewExport');assert.equal(h.calls.length,before+1);assert.equal(h.downloads.length,0);assert.equal(h.mutations().length,0);
  assert.doesNotMatch(h.text(),/Private tentative memory proposal/);assert.match(h.text(),/memory.live.purposeError/);
});
test('derived export releases URLs even if the download fails',async t=>{
  const {h,data}=await inspectDerivedReview(t);h.enqueue(data.result);h.failDownload();await profileClick(h,'reviewExport');
  assert.equal(h.downloads.length,0);assert.equal(h.revokedDownloadUrls.length,1);assert.ok(h.downloadLinks.every(link=>link.removed));
  assert.match(h.text(),/memory.live.purposeError/);
});
for(const locale of ['en','fr','ar','ja'])test('derived export has explicit localized copy warning in '+locale,async t=>{
  const {h,item}=await purposeFixture(t,{locale,localized:true}),data=derivedReviewFixture(item);
  h.enqueue(data.list);await profileClick(h,'reviewLoad');h.enqueue(data.result);await profileClick(h,'reviewInspect');
  assert.ok(h.text().includes(personalMemoryMessage(locale,'memory.live.reviewExportHelp')));
  h.enqueue(data.result);await profileClick(h,'reviewExport');assert.equal(h.downloads.length,1);
  assert.ok(h.text().includes(personalMemoryMessage(locale,'memory.live.reviewExportRequested')));
});
