import { store } from "/src/state/store.ts";
import { setFormaLocale } from "/src/components/design-system/localization.ts";
import { withDocumentInRoute } from "/src/model/routes.ts";
import { classifyTestRequest } from "./browser/helpers/read-only-network.mjs";

// Same source-module / public-Store-signal seam as the retained isolated E5
// fixture. These declarations never become a real account, event or API write.
const parameters = new URLSearchParams(location.search);
const surface = parameters.get("surface"), locale = parameters.get("locale") ?? "en-US";
const surfaces = ["memory", "sessions", "collection", "taste", "workspace", "settings-projects", "settings-activity"];
if (!surfaces.includes(surface) || !["en-US", "fr", "ar", "ja"].includes(locale)
  || [...parameters.keys()].some(key => !["surface", "locale", "container", "baseline"].includes(key))
  || parameters.has("baseline") && parameters.get("baseline") !== "1"
  || parameters.has("container") && parameters.get("container") !== "narrow") throw new Error("Invalid E6 fixture entry");
const root = document.querySelector("#e6-root");
if (parameters.has("container")) root.dataset.container = "narrow";
if (parameters.has("baseline")) {
  // Root serves only the independently pinned pre-E6 file at this exact path.
  // Same component, fixture data, actions and membership; only the CSS changes.
  const stylesheet = document.querySelector("#e6-foundation");
  await new Promise((resolve, reject) => {
    stylesheet.addEventListener("load", resolve, { once: true });
    stylesheet.addEventListener("error", () => reject(new Error("Pinned E6 baseline CSS unavailable")), { once: true });
    stylesheet.href = "/__e6_baseline-responsive-foundation.css";
  });
}
const now = "2026-09-03T12:00:00.000Z", principal = "e6-synthetic-principal";
const syntheticImageURL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='60'%3E%3Crect width='80' height='60' fill='%23dce7da'/%3E%3C/svg%3E";
const projectId = "22222222-2222-4222-8222-222222222222", documentId = "11111111-1111-4111-8111-111111111111";
const organizationId = "e6-synthetic-organization", accessId = "e6-synthetic-project-access";
const permissions = ["workspace.member.read", "workspace.project.read", "workspace.project.manage", "workspace.audit.read"];
const organization = { organizationId, name: "Synthetic workspace — مساحة تجريبية — 作業領域", role: "owner", permissions };
const project = { project_access_id: accessId, project_id: projectId, project_name: "Synthetic project with complete contextual ownership",
  owner_user_id: principal, status: "active" };
const member = { membership_id: "e6-synthetic-member", user_id: "e6-synthetic-colleague", display_name: "Synthetic colleague — زميل — 同僚",
  email: "e6-colleague@example.invalid", role: "editor", status: "active", canvas_access: 0, review_access: 0 };
const session = {
  user: { userId: principal, email: "e6@example.invalid", displayName: "Synthetic E6 principal", role: "creator", consentVersion: "fixture", consentedAt: now },
  impersonation: null, audience: "creative", permissionEpoch: "e6-synthetic-epoch",
  capabilities: ["project.read", "project.author", ...permissions], organizations: [organization], projects: [],
  policy: { version: "fixture", accepted: true, passiveCapture: false, externalAssetsRequireAssertion: true, retentionDays: 30, sharing: "fixture-only" },
  canvas: { version: "fixture", mode: "internal", pilotAvailable: false, access: false, accessReason: "fixture-not-enabled", blockedBy: [], requirements: [] },
  provider: { name: "No provider", model: "fixture", configured: false, plannerConfigured: false, videoConfigured: false, audioConfigured: false },
  budgets: { period: "fixture", user: { used: 0, reserved: 0, limit: 0 }, workspace: { used: 0, reserved: 0, limit: 0 } },
};
const seed = [];
const appendSeed = (type, payload) => seed.push({ type, payload, eventId: "e6-synthetic-event-" + (seed.length + 1),
  streamId: "creative:" + principal, sequence: seed.length + 1, occurredAt: now, recordedAt: now,
  actor: "user:" + principal, clientId: "e6-fixture", correlationId: "e6-fixture", causationId: null, compensatesEventId: null, schemaVersion: 1 });
appendSeed("ProjectCreated", { project_id: projectId, name: "Synthetic E6 project", state: "active" });
appendSeed("DocumentCreated", { project_id: projectId, document_id: documentId, title: "Synthetic E6 document" });
appendSeed("DocumentOpened", { project_id: projectId, document_id: documentId });
appendSeed("BlockCreated", { project_id: projectId, document_id: documentId, block_id: "e6-source", type: "direction",
  handle: "direction/synthetic", properties: { label: "Synthetic retained source", text: "  Preserve this synthetic source exactly.  " } });
appendSeed("CollectionCreated", { project_id: projectId, collection_id: "e6-collection", handle: "Synthetic collection", parent_collection_id: null, position: "a0" });
if (surface === "memory") appendSeed("TasteModelVersioned", { version_id: "e6-synthetic-taste", beliefs: [{
  beliefId: "e6-belief", claimRef: "taste:e6-synthetic", axis: "style", value: "Complete readable source labels",
  polarity: "affirm", authority: "inferred", confidence: .8, evidenceCount: 1, evidenceRefs: ["e6-source"], validFrom: now, recordedAt: now, freshness: 1,
}] });
if (surface === "sessions") {
  appendSeed("BriefComposed", { brief_id: "e6-synthetic-brief", input_receipt: { fixture: true }, composition: { fixture: true }, items: [{
    item_id: "e6-synthetic-brief-item", item_type: "thread", ref_id: "e6-source", title: "Synthetic unfinished thread",
    summary: "A fixture suggestion, never a live recommendation.", rank: 1, rationale_ref: "event:e6-synthetic-event-4", source_event_refs: ["e6-synthetic-event-4"],
    destination: { route: "/", view: "context-block", ref_id: "e6-source", document_id: documentId, document_view: "document" },
  }] });
  appendSeed("PhaseGateReviewed", { phase: 6, decision: "advance", fixture: true });
}
if (surface === "taste") appendSeed("GenerationCompleted", { project_id: projectId, document_id: documentId,
  object_ids: ["e6-synthetic-output"], generation_id: "e6-synthetic-generation", title: "Synthetic retained output",
  provider: "fixture", model_id: "fixture", latency_ms: 0, quality: "high", purpose: "final",
  media_url: syntheticImageURL,
  media_type: "image/svg+xml", image_width: 80, image_height: 60 });

const reads = [], forbidden = [], suppressedTelemetry = [];
const endpoint = "/api/workspaces/" + organizationId;
const base = { organization, permissions, members: [member], projects: [project], invitations: [] };
// Exact finite read envelopes are declared here, never forwarded to a server.
const settingsReads = new Map([
  ["/api/workspaces", { organizations: [organization], projects: [], invitations: [] }],
  [endpoint, base], [endpoint + "/projects", { organization, projects: [project] }],
  [endpoint + "/audit", { organization, audit: [] }],
  [endpoint + "/context-packages", { packages: [{ id: "e6-package", name: "Synthetic organization context with a complete source label",
    description: "Synthetic", version: 1, versionId: "e6-version", publishedAt: now, blockCount: 1, bindingCount: 1 }] }],
  [endpoint + "/projects/" + accessId + "/members", { members: [member] }],
  [endpoint + "/assurance", { organizationId, retention: { pendingCount: 0, heldCount: 0, oldestExpiredAt: null },
    scheduler: { state: "not-configured", hostingScheduleVerified: false, lastScheduledAt: null },
    packages: { activeCount: 1, sourceFileCustody: "synthetic-unverified" }, reviews: { pendingCount: 0 }, controls: [], enterpriseReady: false,
    enterpriseBlockers: ["Synthetic data is not release evidence"] }],
  [endpoint + "/security", { policy: { authenticationSource: "any", allowedEmailDomains: [], encryptionMode: "fixture-only", maxSessionMinutes: 60, version: 1 },
    observedSignInSource: "synthetic", domainOwnershipVerified: false, mfaAttestationAvailable: false,
    encryption: { recoverySnapshots: "fixture-only", primaryDatabaseAndObjectStorage: "synthetic", externalCustomerManagedKeys: false } }],
  [endpoint + "/recovery", { snapshots: [{ snapshot_id: "e6-synthetic-snapshot", key_id: "e6-synthetic-key", manifest_json: "{}", status: "available", created_at: now }] }],
  [endpoint + "/security/provisioning-credentials", { credentials: [] }],
  [endpoint + "/deletion", { inventory: { projectCount: 1, mediaCount: 0, packageCount: 1, revisionCount: 0, privateEventBodyCount: 0 }, job: null }],
]);
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init), url = new URL(request.url);
  const receipt = { method: request.method, origin: url.origin, path: url.pathname };
  const classification = classifyTestRequest({ method: request.method, url: url.href,
    postData: ["GET", "HEAD"].includes(request.method) ? null : await request.clone().text(), resourceType: "fetch" }, location.origin);
  if (classification === "suppressed-telemetry") {
    suppressedTelemetry.push(receipt); throw new TypeError("Synthetic telemetry has no acknowledgment");
  }
  // The real image owner samples this exact in-memory image for focal analysis.
  // Supply its same bytes without forwarding fetch or admitting other data URLs.
  if (surface === "taste" && request.method === "GET" && url.href === new URL(syntheticImageURL).href) {
    reads.push({ ...receipt, fixture: "declared-local-synthetic-image" });
    return new Response(decodeURIComponent(syntheticImageURL.slice(syntheticImageURL.indexOf(",") + 1)), {
      status: 200, headers: { "content-type": "image/svg+xml", "cache-control": "no-store" },
    });
  }
  // The actual Workspace asks for its existing draft on connection. This is
  // the same POST-shaped read recognized by the retained read-only guard.
  // Only this exact no-operation resume receives a declared empty response.
  if (surface === "workspace" && classification === "recovery-read" && url.origin === location.origin
    && url.pathname === "/api/workspace/quick-edit" && !url.search && !url.hash
    && await request.clone().text() === JSON.stringify({ action: "resume", projectId, documentId })) {
    reads.push({ ...receipt, fixture: "declared-empty-quick-edit-read" });
    return new Response(JSON.stringify({ status: "none" }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  if (surface === "workspace" && request.method === "GET" && url.origin === location.origin
    && url.pathname === "/api/output-requirements" && url.search === `?documentId=${documentId}` && !url.hash) {
    // No delivery model is manufactured for footer geometry. The actual owner
    // renders a declared unavailable read; it is outside E6 control acceptance.
    reads.push({ ...receipt, fixture: "declared-unavailable-delivery-read", status: 503 });
    return new Response(JSON.stringify({ error: "synthetic_delivery_unavailable" }), { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  if (surface === "workspace" && request.method === "GET" && url.origin === location.origin
    && url.pathname === "/api/document-jobs/presentation-candidates" && url.search === `?document=${documentId}` && !url.hash) {
    reads.push({ ...receipt, fixture: "declared-empty-preserved-candidate-read" });
    return new Response(JSON.stringify({ documentId, jobs: [] }), { status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  if (surface.startsWith("settings-") && request.method === "GET" && url.origin === location.origin
    && !url.search && !url.hash && settingsReads.has(url.pathname)) {
    reads.push(receipt);
    return new Response(JSON.stringify(settingsReads.get(url.pathname)), { status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store", "x-forma-isolated-fixture": "e6" } });
  }
  forbidden.push(receipt); throw new TypeError("Undeclared E6 fixture request blocked before network");
};
await setFormaLocale(locale, { persist: false });
store.session.set(session); store.events.set(structuredClone(seed)); store.head.set(seed.length); store.loading.set(false);
store.route.set(surface.startsWith("settings-") ? `/settings/workspaces/${organizationId}/${surface.slice(9)}`
  : surface === "memory" ? "/memory" : surface === "sessions" ? "/sessions"
  : surface === "workspace" ? withDocumentInRoute("/", documentId, "Synthetic E6 document") : "/");
const source = store.captureSourceOwnership();
if (!store.sourceOwnershipActive(source)) throw new Error("Synthetic E6 source not admitted by actual Store");
const modules = {
  memory: ["/src/components/forma-memory.ts", "forma-memory"], sessions: ["/src/components/forma-sessions.ts", "forma-sessions"],
  collection: ["/src/components/collection-tree.ts", "forma-collection-tree"], taste: ["/src/components/output-card.ts", "forma-output-card"],
  workspace: ["/src/components/forma-workspace.ts", "forma-workspace"],
  "settings-projects": ["/src/components/forma-workspace-settings.ts", "forma-workspace-settings"],
  "settings-activity": ["/src/components/forma-workspace-settings.ts", "forma-workspace-settings"],
};
const [module, tag] = modules[surface]; await import(module);
let owner, shell = null, application = null;
if (surface === "workspace") {
  // Workspace's project rail consumes the real shell's measured posture. Let
  // the actual Creative application render its child; no shell class is copied.
  // Nonempty seeded events prevent Shell.connectedCallback from calling load().
  await import("/src/components/forma-shell.ts");
  await import("/src/apps/creative/entry.ts");
  if (!store.events.get().length || store.ui.attentionCapture) throw new Error("Synthetic Shell prerequisites unavailable");
  shell = document.createElement("forma-shell"); root.append(shell); await shell.updateComplete;
  application = shell.querySelector(".app-shell > #main-content > forma-creative-application");
  if (!application) throw new Error("Actual Creative application did not mount");
  await application.updateComplete;
  const matches = application.querySelectorAll(":scope > forma-workspace");
  if (matches.length !== 1) throw new Error("Actual Creative application did not render one Workspace");
  owner = matches[0];
} else {
  owner = document.createElement(tag);
  if (surface === "taste") owner.output = store.projection.get().libraryOutputs.find(item => item.id === "e6-synthetic-output");
  root.append(owner);
}
await owner.updateComplete;
Object.defineProperty(globalThis, "formaIsolatedE6", { value: Object.freeze({ snapshot: () => structuredClone({
  schema: "forma-isolated-e6-r1", surface, scope: "synthetic-component-only", apiIsolationBeforeOwner: true,
  foundation: document.querySelector("#e6-foundation").getAttribute("href"),
  owner: { tag, connected: owner.isConnected, actualRegistryInstance: owner instanceof customElements.get(tag), rootContainsOwner: root.contains(owner),
    ...(shell ? { actualShell: shell instanceof customElements.get("forma-shell"), shellConnected: shell.isConnected,
      actualCreativeApplication: application instanceof customElements.get("forma-creative-application"),
      applicationConnected: application.isConnected, shellContainsOwner: shell.contains(owner), applicationContainsOwner: application.contains(owner) } : {}) },
  sourceActive: store.sourceOwnershipActive(source),
  custody: { session: store.session.get(), route: store.route.get(), events: store.events.get(), optimisticEvents: store.optimisticEvents.get(),
    content: store.content.get(), head: store.head.get(), jobs: store.documentJobs.get() }, reads, forbidden, suppressedTelemetry,
  limits: ["Synthetic data, real components; no genuine authorization, account, populated workflow, API or provider evidence.",
    "No live Memory update, condition check, rights submission, grant, recovery or generation action is activated.",
    "Fresh browser profile may contain browser-local state. No production, assistive-technology or universal accessibility claim."],
}) }) });
