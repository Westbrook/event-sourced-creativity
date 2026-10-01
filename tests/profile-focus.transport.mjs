// Fixture transport only. No app/Worker import, original fetch call, live grant
// or persistence. Literal envelopes are adapted from personal-memory-controls.
export const PROFILE_FOCUS_CASES = Object.freeze(["hide-clean", "hide-dirty", "expiry", "suppress"]);
export const PROFILE_FOCUS_DOCUMENT = "fixture-document";
export const PROFILE_FOCUS_PROJECT = "fixture-project";
export const PROFILE_FOCUS_ACTOR = "fixture-user";
export const PROFILE_FOCUS_ENTRY = "/tests/profile-focus.fixture.html";
const version = "document-profile-control-v1";
const policy = "document-profile-v1";
const recipe = "native-document-palette-choice-v1";
const claimKey = (904).toString(16).padStart(64, "0");
const id = (1).toString(16).padStart(64, "0");

export function installProfileFocusTransport(caseId) {
  if (!PROFILE_FOCUS_CASES.includes(caseId) || location.protocol !== "http:"
    || !["127.0.0.1", "localhost"].includes(location.hostname)
    || location.pathname !== PROFILE_FOCUS_ENTRY || location.search !== "?case=" + caseId || location.hash) {
    throw new Error("Undeclared Profile fixture entry");
  }
  const origin = location.origin, scopeId = crypto.randomUUID(), started = Date.now();
  const at = new Date(started).toISOString(), expiresAt = new Date(started + 30 * 86_400_000).toISOString();
  const enrollment = { id, projectId: PROFILE_FOCUS_PROJECT, documentId: PROFILE_FOCUS_DOCUMENT, organizationId: null,
    revision: 1, learn: true, recall: true, background: false, retentionDays: 30, timeZone: "UTC", expiresAt,
    policyVersion: "personal-memory-v2", lastAdmittedAt: null, throughSequence: 10, cutoffSequence: null,
    backlog: false, nextDueAt: at, attempts: 0, status: "ready" };
  const grant = { grantId: "private-palette-grant-" + scopeId, revision: 1, organizationId: null, projectAccessId: null,
    ownerUserId: PROFILE_FOCUS_ACTOR, projectId: PROFILE_FOCUS_PROJECT, documentId: PROFILE_FOCUS_DOCUMENT,
    enrollmentId: id, enrollmentRevision: 1, policyVersion: policy, recipeVersion: recipe,
    infer: true, inspect: true, background: false, sourceAfterSequence: 10,
    consentedAt: new Date(started - 86_400_000).toISOString(), expiresAt, retentionDays: 30, revokedAt: null };
  const memorySettings = { enabled: true, policyVersion: "personal-memory-v2", writeContractVersion: "memory-settings-custody-v1",
    reviewContract: { timing: "daily-with-daytime-catch-up", preferredLocalWindow: { startHour: 1, endHour: 5 },
      freshDaytimeCatchUpAllowed: true, savedPagesMayContinueOutsideWindow: true, strictlyOvernight: false, deliverySlaVerified: false },
    enrollments: [enrollment], nextAfter: null };
  const profileSettings = { version, enabled: true, policyVersion: policy, recipeVersion: recipe,
    purpose: "authored-palette-organization", backgroundSupported: false,
    scope: { projectId: PROFILE_FOCUS_PROJECT, documentId: PROFILE_FOCUS_DOCUMENT, custody: { kind: "personal" } },
    parent: { enrollmentId: id, enrollmentRevision: 1, expiresAt, retentionDays: 30 }, grant, grantCurrent: true };
  const settingsPath = "/api/memory/document-profile/settings?projectId=" + PROFILE_FOCUS_PROJECT + "&documentId=" + PROFILE_FOCUS_DOCUMENT;
  const inspectPath = "/api/memory/document-profile/inspect?grantId=" + grant.grantId + "&version=" + version;
  const suppressionBody = { version, grantId: grant.grantId, grantRevision: 1, claimKey, revision: 0,
    confirmation: "SUPPRESS_DOCUMENT_PALETTE_CLAIM" };
  const steps = [
    ["GET", "/api/memory/settings"], ["GET", "/api/memory/settings"],
    ["GET", settingsPath], ["GET", inspectPath],
    ...(caseId === "suppress" ? [["PUT", "/api/memory/document-profile/suppress"]] : []),
  ];
  const requests = [], denied = [];
  let position = 0, closed = false, poisoned = false, pending = null, inspection = null, released = false, deniedOverflow = 0;
  const response = value => new Response(JSON.stringify(value), { status: 200,
    headers: { "content-type": "application/json", "cache-control": "private, no-store",
      "x-forma-isolated-fixture": "profile-focus-native-r1" } });
  const reject = (method, path, reason) => {
    poisoned = true;
    if (denied.length < 32) denied.push({ method, path, reason }); else deniedOverflow++;
    throw new TypeError("Undeclared Profile fixture request: " + reason);
  };
  const paletteProfile = () => {
    const checkedAt = new Date().toISOString();
    // Same configurable lease branch as paletteProfile; ten real seconds allow
    // native keyboard preparation, unlike the finite fixture's 1-second clock.
    const leaseMs = caseId === "expiry" ? 10_000 : 60_000;
    const validUntil = new Date(Math.min(Date.parse(checkedAt) + leaseMs, Date.parse(expiresAt))).toISOString();
    const evidence = (index, intent, lineage) => ({ blockId: "private-palette-block-" + index, intent, lineage,
      independentEvidence: false, sources: [{ eventId: "private-palette-event-" + index, sequence: 11 + index,
        type: "ChipEdited", recordedAt: checkedAt }] });
    inspection = { checkedAt, validUntil, leaseMs, grantId: grant.grantId, grantRevision: 1, claimKey };
    return { version, profile: { version: recipe, treatment: "document-authored-palette-choices",
      inferredPreferences: false, independentEvidence: false,
      scope: { organizationId: null, projectAccessId: null, projectId: PROFILE_FOCUS_PROJECT, documentId: PROFILE_FOCUS_DOCUMENT },
      grant: { id: grant.grantId, revision: 1 }, lifetime: { checkedAt, validUntil },
      coverage: { bounded: true, completeHistory: false, blockLimit: 16, sourceLimit: 128, selectedBlockCount: 3, eligibleChoiceCount: 1 },
      choices: [{ claimKey, colors: ["#123abc", "#ffffff", "#123abc"], status: "conflicted",
        supports: [evidence(0, "prefer", "unknown")],
        counterevidence: [evidence(1, "avoid", "assisted"), evidence(2, "prohibit", "copy")] }] } };
  };
  const fetchSink = async (input, init) => {
    const request = input instanceof Request ? new Request(input, init) : new Request(new URL(String(input), origin), init);
    const url = new URL(request.url), path = url.pathname + url.search;
    if (closed || poisoned) return reject(request.method, path, "closed-or-failed-case");
    if (request.signal.aborted) throw new DOMException("Fixture request already aborted", "AbortError");
    if (url.origin !== origin || url.username || url.password || url.hash) return reject(request.method, path, "origin-or-url");
    const expected = steps[position];
    if (!expected || request.method !== expected[0] || path !== expected[1]
      || request.method === "GET" && request.body !== null) return reject(request.method, path, "method-path-query-order-or-count");
    if (request.method === "PUT") {
      const body = await request.text();
      if (body !== JSON.stringify(suppressionBody) || pending || released || caseId !== "suppress"
        || !inspection || Date.now() >= Date.parse(inspection.validUntil)) return reject(request.method, path, "body-or-suppression-ownership");
      const record = { method: request.method, path, body: suppressionBody, outcome: "held" };
      requests.push(record); position++;
      return new Promise((resolve, rejectPromise) => {
        const held = { resolve, reject: rejectPromise, record, signal: request.signal, abort: null };
        held.abort = () => {
          if (pending !== held) return;
          pending = null; held.signal.removeEventListener("abort", held.abort);
          record.outcome = "aborted"; rejectPromise(new DOMException("Profile fixture request aborted", "AbortError"));
        };
        pending = held; request.signal.addEventListener("abort", held.abort, { once: true });
        if (request.signal.aborted) held.abort();
      });
    }
    const value = position < 2 ? memorySettings : position === 2 ? profileSettings : paletteProfile();
    requests.push({ method: request.method, path, outcome: "responded" }); position++;
    return response(value);
  };
  // Installed before any Store/localization/component import. There is no
  // original-fetch escape hatch: all undeclared JS transport stays local.
  globalThis.fetch = fetchSink;
  return Object.freeze({
    caseId, scopeId, at, projectId: PROFILE_FOCUS_PROJECT, documentId: PROFILE_FOCUS_DOCUMENT, actor: PROFILE_FOCUS_ACTOR,
    snapshot: () => structuredClone({ caseId, scopeId, installed: globalThis.fetch === fetchSink, closed, poisoned,
      expected: steps, requests, denied, deniedOverflow, pending: pending !== null, released, inspection,
      fixtureOnly: true, networkRequestsForwarded: 0, enrollment, grant }),
    releaseSuppression() {
      const held = pending;
      if (closed || poisoned || caseId !== "suppress" || !held || released || held.signal.aborted
        || Date.now() >= Date.parse(inspection.validUntil)) throw new Error("No current owned synthetic suppression acknowledgment");
      pending = null; released = true; held.signal.removeEventListener("abort", held.abort); held.record.outcome = "acknowledged";
      held.resolve(response({ version, suppression: { grantId: grant.grantId, grantRevision: 1, claimKey, revision: 1,
        state: "active", createdAt: new Date().toISOString(), expiresAt } }));
    },
    dispose() {
      if (closed) return;
      closed = true;
      if (pending) {
        const held = pending; pending = null; held.signal.removeEventListener("abort", held.abort);
        held.record.outcome = "disposed"; held.reject(new DOMException("Profile fixture closed", "AbortError"));
      }
      // Keep the closed sink, never restore network access before context close.
    },
  });
}

// Extra case-local browser boundary, installed before navigation. The retained
// read-only guard remains underneath. Browser-local Profile responses never
// travel through this boundary; any actual API request or socket is a failure.
export async function installProfileFocusBrowserBoundary(context, baseURL, caseId) {
  const base = new URL(baseURL);
  if (!PROFILE_FOCUS_CASES.includes(caseId) || base.protocol !== "http:"
    || !["127.0.0.1", "localhost"].includes(base.hostname) || base.username || base.password
    || base.pathname !== "/" || base.search || base.hash) throw new Error("Profile fixture requires an owned plain loopback origin");
  const record = { caseId, forbidden: [], overflow: 0, actualApiRequests: 0 };
  const note = value => { if (record.forbidden.length < 32) record.forbidden.push(value); else record.overflow++; };
  await context.routeWebSocket("**/*", async socket => {
    const url = new URL(socket.url()); note({ method: "WEBSOCKET", origin: url.origin, path: url.pathname });
    await socket.close({ code: 1008, reason: "No sockets in Profile fixture" });
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { path = "/api/invalid-encoding"; }
    const api = /^\/api(?:\/|$)/i.test(path);
    if (api) record.actualApiRequests++;
    if (api || ["fetch", "xhr", "eventsource"].includes(request.resourceType())
      || !["GET", "HEAD"].includes(request.method())
      || request.resourceType() === "document" && (url.origin !== base.origin
        || url.pathname !== PROFILE_FOCUS_ENTRY || url.search !== "?case=" + caseId || url.hash)) {
      note({ method: request.method(), origin: url.origin, path: url.pathname });
      await route.abort("blockedbyclient"); return;
    }
    await route.fallback(); // Existing origin/static/public-font policy still applies.
  });
  return record;
}
