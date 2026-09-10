import { classifyTestRequest, localTestOrigin } from "./read-only-network.mjs";

export const SYNTHETIC_NETWORK_MARKER = "e6-full-pc-r1";
export const SYNTHETIC_NETWORK_ORIGIN = "http://127.0.0.1:4186";
export const syntheticNetworkProvenance = Object.freeze({
  mode: "finite-synthetic-network", version: SYNTHETIC_NETWORK_MARKER,
  authority: "Synthetic personal-author declarations, not authentication or permission evidence",
  canvasPremise: "For the E6 native PC premise only: declared creator/pilot eligibility exposes the original three PC header peers and other existing Canvas navigation controls. Canvas activation and live governance or permission approval remain unobserved.",
  application: "Whole-application journeys retain index.html → main.ts → Shell → Store; calibration and isolated E5/E6 retain their separately labeled fixture entries. This transport itself injects no Store state or fetch override",
  effects: "Only immutable responses in the owned fresh browser; no API request reaches a server, DB, account or provider",
  browserLocalState: "Actual Store may cache these declarations in the disposable browser profile",
  limits: "Renderer, geometry and native behavior only. Organization tasks, live data, source verification, providers and production remain unobserved. The retained Library archive is separately genuine and remains unchanged.",
});

export function syntheticNetworkEnabled(baseURL) {
  const flag = process.env.FORMA_A11Y_SYNTHETIC_NETWORK;
  if (flag === undefined || flag === "0") return false;
  if (flag !== "1") throw new Error("FORMA_A11Y_SYNTHETIC_NETWORK must be unset, 0 or 1");
  if (localTestOrigin(baseURL) !== SYNTHETIC_NETWORK_ORIGIN) {
    throw new Error("Finite synthetic transport requires the exclusive source preview on 127.0.0.1:4186");
  }
  return true;
}

const actorUserId = "e6-network-synthetic-principal";
const projectId = "project-atmosphere", documentId = "doc-atmosphere";
const documentPath = "/document/doc-atmosphere/atmosphere-studies";
const now = "2026-09-03T12:00:00.000Z";
const capabilities = ["self.profile.read", "self.privacy.manage", "self.usage.read", "self.share.manage",
  "project.read", "project.author", "project.canvas.use", "project.library.manage", "project.output.request", "project.assistant.read"];
const cost = { usedMicrousd: 0, reservedMicrousd: 0, limitMicrousd: 0, remainingMicrousd: 0 };
const session = {
  user: { userId: actorUserId, email: "e6-network@example.invalid", displayName: "Synthetic E6 principal", role: "creator",
    consentVersion: "synthetic-fixture", consentedAt: now },
  impersonation: null, audience: "creative", permissionEpoch: "synthetic-e6-full-pc-r1", capabilities,
  organizations: [], projects: [],
  policy: { version: "synthetic-fixture", accepted: true, passiveCapture: false,
    attentionCapture: { available: false, defaultOn: false, retentionDays: 14, rawInputCapture: false },
    externalAssetsRequireAssertion: true, retentionDays: 30, sharing: "synthetic-fixture-only" },
  // Declared creator/pilot renderer fixture; no live governance approval is asserted.
  canvas: { version: "synthetic-fixture", mode: "pilot", pilotAvailable: true, access: true,
    accessReason: "pilot-approved", blockedBy: [], requirements: [] },
  provider: { name: "No provider", model: "synthetic-fixture", configured: false,
    plannerConfigured: false, videoConfigured: false, audioConfigured: false, model3dConfigured: false },
  budgets: { period: "synthetic-fixture", user: { used: 0, reserved: 0, limit: 0 }, workspace: { used: 0, reserved: 0, limit: 0 } },
  costBudgets: { period: "synthetic-fixture", currency: "USD", user: cost, workspace: cost },
  assistant: { enabled: true, phase: "read-only", capabilities: ["project.assistant.read"], models: [] },
};

// The 23 literal public demonstration specs from worker/events-api.ts seedIfEmpty.
// No worker import, seedIfEmpty call, DB handle or generated account is involved.
const seedSpecs = [
    ["user","ProjectCreated",{project_id:"project-atmosphere",name:"Studio launch",state:"active"}],
    ["user","DocumentCreated",{document_id:"doc-atmosphere",handle:"atmosphere-studies",title:"Atmosphere studies"}],
    ["worker:registry","ModelRegistered",{model_id:"gpt-image-2",planner_model_id:"gpt-5.6-terra",provider:"openai",status:"human-gated"}],
    ["worker:registry","AdapterVersioned",{adapter_id:"openai-image",version:"v1",contract_version:3}],
    ["worker:registry","CapabilityDeclared",{model_id:"gpt-image-2",capabilities:["image-generation","private-asset-output","context-snapshot"]}],
    ["user","SessionOpened",{session_id:"session-today",snapshot_ref:null}],
    ["user","BlockCreated",{block_id:"block-direction",type:"direction",handle:"direction/nocturne",properties:{text:"A quiet interior that feels held between dusk and night.",weight:.92,authority:"authored"},position:"a0"}],
    ["user","ReferenceIngested",{reference_id:"ref-window-light",source_type:"upload",source_ref:"seed://window-light",content_hash:"seed-window-light",rights_class:"owned"}],
    ["user","BlockCreated",{block_id:"block-reference",type:"reference",handle:"reference/window-light",properties:{reference_id:"ref-window-light",label:"Window light",weight:.78,authority:"authored"},position:"a1"}],
    ["user","BlockCreated",{block_id:"block-palette",type:"palette",handle:"palette/dusk-warm",properties:{colors:["#27252B","#E9A073","#E8D7BD","#8A6571"],weight:.84,authority:"inferred",confidence:.86},position:"a2"}],
    ["worker:extractor","ExtractionCompleted",{block_id:"block-palette",extractor_name:"palette-kmeans-v1",chips:[{chip_id:"chip-palette",property:"colors",value:["#27252B","#E9A073","#E8D7BD","#8A6571"],confidence:.86}]}],
    ["user","CollectionCreated",{collection_id:"collection-studio",handle:"studio-launch",parent_collection_id:null,source_claim_ref:null,position:"a0"}],
    ["user","CollectionCreated",{collection_id:"collection-client",handle:"client-work",parent_collection_id:null,source_claim_ref:null,position:"a1"}],
    ["user","CollectionCreated",{collection_id:"collection-acme",handle:"acme",parent_collection_id:"collection-client",source_claim_ref:null,position:"a0"}],
    ["user","CollectionItemAdded",{collection_id:"collection-studio",item_ref:{document_id:"doc-atmosphere"},position:"a0"}],
    ["worker:indexer","FamilyDeclared",{family_id:"family-warm-nocturnes",label:"Warm nocturnes",confidence:.81,evidence_refs:["event:11"]}],
    ["worker:compiler","ContextCompiled",{generation_id:"generation-01",model_id:"seed-simulation-v1",adapter_version:"seed-v1",compiled_snapshot:{facts:["direction/nocturne","reference/window-light","palette/dusk-warm"],pins:["block-direction"],tail:[],as_of:{head:16,lag:0}},source_block_versions:[{block_id:"block-direction",version:1},{block_id:"block-reference",version:1},{block_id:"block-palette",version:1}]}],
    ["worker:generator","GenerationCompleted",{generation_id:"generation-01",model_id:"seed-simulation-v1",provider:"simulation",object_ids:["object-nocturne-01"],latency_ms:1820,variant:0,simulation:true}],
    ["worker:compiler","ContextCompiled",{generation_id:"generation-02",model_id:"seed-simulation-v1",adapter_version:"seed-v1",compiled_snapshot:{facts:["direction/nocturne","reference/window-light","palette/dusk-warm"],pins:["block-direction"],tail:[],as_of:{head:18,lag:0}},source_block_versions:[{block_id:"block-direction",version:1},{block_id:"block-reference",version:1},{block_id:"block-palette",version:1}]}],
    ["worker:generator","GenerationCompleted",{generation_id:"generation-02",model_id:"seed-simulation-v1",provider:"simulation",object_ids:["object-nocturne-02"],latency_ms:1450,variant:1,simulation:true}],
    ["user","ObjectPinned",{object_id:"object-nocturne-01",scope:"project"}],
    ["user","ComparisonOpened",{object_ids:["object-nocturne-01","object-nocturne-02"],source_surface:"studio"}],
    ["user","ConditionSet",{condition_id:"condition-palette-3",condition_ref:"three-new-generations",scope:"project"}],
  ];
// The retained ordinary native journey explicitly requires four creative decisions.
// The source demo has three; this fourth declaration is visibly synthetic, not a
// claim to be the retained account's missing event. All 23 original specs stay intact.
seedSpecs.push(["user", "BlockCreated", { project_id: projectId, document_id: documentId,
  block_id: "e6-network-fourth-decision", type: "direction", handle: "direction/synthetic-custody",
  properties: { text: "  Synthetic fourth decision. Preserve this exact source wording.  ", weight: .5, authority: "authored" }, position: "a3" }]);
const events = seedSpecs.map(([actor, type, payload], index) => ({
  eventId: `e6-network-event-${index + 1}`, streamId: `creative:${actorUserId}`, sequence: index + 1,
  occurredAt: now, recordedAt: now, actor, clientId: "e6-finite-network", correlationId: "e6-finite-network",
  causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload,
}));
const head = events.length;
const projectEventTypes = new Set(["ProjectCreated", "DocumentCreated", "BlockCreated", "CollectionCreated", "GenerationCompleted", "ObjectPinned"]);
const eventPages = new Map();
for (const after of [0, head]) {
  for (const content of ["0", "1"]) {
    for (const profile of ["full", "workspace", "projects"]) {
      const query = `?after=${after}&limit=${profile === "full" ? 5000 : 6500}&content=${content}${profile === "full" ? "" : "&profile=" + profile}`;
      const rows = events.filter(event => event.sequence > after
        && (profile === "full" || profile === "workspace" && event.type !== "ComparisonOpened"
          || profile === "projects" && projectEventTypes.has(event.type)));
      eventPages.set(query, { events: rows, head, nextAfter: head, hasMore: false, ...(content === "1" ? { content: {} } : {}) });
    }
  }
}
// Actual Store's private-content hydration request. There are no private refs.
eventPages.set(`?after=${head}&limit=1&content=1`, { events: [], head, nextAfter: head, hasMore: false, content: {} });

const delivery = {
  schemaVersion: 1, documentId, projectId,
  scope: { kind: "personal", organizationId: null, projectAccessId: null, actorUserId },
  revision: "synthetic-delivery-r1", requirementRevision: "synthetic-requirements-r1", sourceRevision: "synthetic-source-r1",
  sourceVerification: { status: "unavailable", reasonCodes: ["synthetic_source_not_verified"],
    capacity: { referenceCount: 0, distinctObjectCount: 0, countsComplete: false, ownedReadLimit: 0, nativeLimit: 0,
      sources: [], sourcesComplete: false } },
  requirements: [], confirmedPlan: null, targetStates: [], summary: null,
  requirementSummaries: {}, requirementFileCounts: {}, assets: [], results: [], grants: [], scopeAmendments: [],
  permissions: { canAuthor: true, canRequest: false, canReview: false, canDownload: false, independentReview: true },
  capabilities: { nativeGeneration: false, ownedFileAdoption: false, supportedFileExtensions: [],
    limitations: ["Synthetic renderer fixture; no verified source, delivery or provider evidence"], limitationCodes: [] },
};
const applicationPaths = new Set(["/", documentPath, documentPath + "/focus", "/projects", "/studio/project", "/library?document=doc-atmosphere", "/settings/workspaces"]);
const sourceBlocks = events.filter(event => event.type === "BlockCreated").map(event => ({
  id: event.payload.block_id, type: event.payload.type, text: String(event.payload.properties.text ?? event.payload.properties.label ?? event.payload.handle),
  intent: "include", locked: false, focused: false, version: 1, immutable: false, providerEligible: false, providerVisibility: "restricted",
}));
const sourceOutputs = events.filter(event => event.type === "GenerationCompleted").flatMap(event => event.payload.object_ids.map(id => ({
  id, kind: "image", title: "image", documentId, status: "ready",
})));
const assistantReads = new Map();
for (const route of applicationPaths) {
  const page = route.startsWith("/settings") ? "workspace" : route.startsWith("/library") ? "library"
    : ["/projects", "/studio/project"].includes(route) ? "projects" : "document";
  const selectedDocument = page === "document" ? documentId : null;
  const query = new URLSearchParams({ route, projectId }).toString();
  assistantReads.set("?" + query, { context: {
    surface: { route, canonicalFamily: page === "document" ? "document" : page, application: "creative", host: "creator", page,
      documentId: selectedDocument, canvasId: null, focusedBlockId: null, focusedResourceId: null, requiredCapabilities: ["project.read"], available: true },
    scope: { actorUserId, organizationId: null, projectAccessId: null, projectId, documentId: selectedDocument },
    documentTitle: selectedDocument ? "Atmosphere studies" : null,
    selectedItems: [], recentTurns: [], recentActions: [], decisionAtoms: selectedDocument ? sourceBlocks : [],
    relationships: [], unfinishedIntents: [], availableOutputs: sourceOutputs,
    availableOutputKinds: ["image"], totals: { decisions: selectedDocument ? 4 : 0, outputs: sourceOutputs.length, outputsByKind: { image: sourceOutputs.length } },
    capabilities: ["project.assistant.read"], playbook: [], evidence: { head, eventIds: [] }, truncated: true,
  }, turns: [], tasks: [] });
}
const exactReads = new Map([
  ["/api/session", session],
  ["/api/workspaces", { organizations: [], projects: [], invitations: [] }],
  ["/api/workspaces/reviews", { tasks: [] }],
  ["/api/document-jobs", { jobs: [] }],
  ["/api/document-jobs?scope=active", { jobs: [] }],
  ["/api/document-jobs?document=" + documentId, { jobs: [] }],
  ["/api/document-jobs/presentation-candidates?document=" + documentId, { documentId, jobs: [] }],
  ["/api/output-requirements?documentId=" + documentId, delivery],
]);
// Capture fixed serialized bytes once. No browser action changes this transport.
const readBodies = new Map([...exactReads].map(([key, value]) => [key, JSON.stringify(value)]));
for (const [query, value] of eventPages) readBodies.set("/api/events" + query, JSON.stringify(value));
for (const [query, value] of assistantReads) readBodies.set("/api/assistant" + query, JSON.stringify(value));

// Focused renderer variants may derive their own explicitly declared immutable
// response from these retained bytes. This exposes no mutable catalogue and
// does not admit an additional request to the existing transport.
export function syntheticReadBody(path) {
  const body = readBodies.get(path);
  if (typeof body !== "string") throw new Error("No declared synthetic read body: " + path);
  return body;
}
const resumeBody = JSON.stringify({ action: "resume", projectId, documentId });
const responseHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store",
  "x-forma-synthetic-network": SYNTHETIC_NETWORK_MARKER };

/** Install after the retained guard and before any page navigation. Last route
 * runs first; fallback delegates only approved static/browser/font traffic. */
export async function installSyntheticNetwork(context, baseURL) {
  if (localTestOrigin(baseURL) !== SYNTHETIC_NETWORK_ORIGIN) throw new Error("Synthetic origin changed");
  const record = { ...syntheticNetworkProvenance, responses: [], suppressedTelemetry: [], forbidden: [],
    source: { seed: "worker/events-api.ts:seedIfEmpty literal specs", originalSpecs: 23, syntheticExtraDecisions: 1, head,
      realAccountSnapshotReused: false, organizationTasks: "UNOBSERVED: declared personal landing only" } };
  await context.routeWebSocket("**/*", async socket => {
    const url = new URL(socket.url());
    record.forbidden.push({ method: "WEBSOCKET", origin: url.origin, path: url.pathname });
    await socket.close({ code: 1008, reason: "No WebSocket transport in finite synthetic mode" });
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const input = { method: request.method(), url: url.href, resourceType: request.resourceType(), postData: request.postData() };
    const item = { method: input.method, origin: url.origin, path: url.pathname, resourceType: input.resourceType };
    const classification = classifyTestRequest(input, baseURL);
    const reject = async () => { record.forbidden.push(item); await route.abort("blockedbyclient"); };
    let decodedPath;
    try { decodedPath = decodeURIComponent(url.pathname); } catch { return reject(); }
    if (url.username || url.password || url.hash) return reject();
    if (classification === "suppressed-telemetry") {
      record.suppressedTelemetry.push(item); await route.abort("blockedbyclient"); return;
    }
    if (url.origin === SYNTHETIC_NETWORK_ORIGIN && input.method === "GET" && readBodies.has(url.pathname + url.search)) {
      record.responses.push({ ...item, status: 200, fixture: SYNTHETIC_NETWORK_MARKER });
      await route.fulfill({ status: 200, headers: responseHeaders, body: readBodies.get(url.pathname + url.search) }); return;
    }
    if (url.origin === SYNTHETIC_NETWORK_ORIGIN && classification === "recovery-read"
      && url.pathname === "/api/workspace/quick-edit" && !url.search && input.postData === resumeBody) {
      record.responses.push({ ...item, status: 200, action: "resume", fixture: SYNTHETIC_NETWORK_MARKER });
      await route.fulfill({ status: 200, headers: responseHeaders, body: '{"status":"none"}' }); return;
    }
    if (classification === "local-browser" || classification === "public-font") { await route.fallback(); return; }
    if (url.origin !== SYNTHETIC_NETWORK_ORIGIN || !["GET", "HEAD"].includes(input.method)
      || /^\/api(?:\/|$)/i.test(decodedPath) || ["fetch", "xhr", "eventsource", "websocket"].includes(input.resourceType)) return reject();
    // The isolated E5/E6 fixture entries remain their separately labeled real
    // component lanes. This opt-in never replaces or filters their test cases.
    const fixtureEntry = /^\/tests\/(?:e6-noncanvas|presentation-responsive)\.fixture\.html$/.test(url.pathname);
    if (input.resourceType === "document" && !applicationPaths.has(url.pathname + url.search) && !fixtureEntry) return reject();
    // These go only to the independently owned pure-source Vite preview, never
    // a Sites/Cloudflare preview. The retained guard still applies its origin rule.
    await route.fallback();
  });
  return record;
}

/** Only named harness metadata is relabeled. Never rewrite authored source,
 * raw drafts, IDs, assertions, nested content, archive bytes or custody results. */
export function syntheticEvidence(name, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { fixture: syntheticNetworkProvenance, observation: value };
  }
  // An existing fixture is evidence, not an available metadata slot.
  const provenanceKey = Object.hasOwn(value, "fixture") ? "syntheticTransport" : "fixture";
  if (Object.hasOwn(value, provenanceKey)) {
    throw new Error("Synthetic evidence already owns reserved provenance key: " + provenanceKey);
  }
  const result = { ...value, [provenanceKey]: syntheticNetworkProvenance };
  if (name === "view-native-coverage") {
    if (result.authority === "Actual personal account without a shared-project context") {
      result.authority = "Synthetic personal-author declaration without shared-project context; no authentication proof";
    }
    result.limits = "One synthetic Document with actual native controls. Other views/shortcuts are not activated; no live permissions, AT or production acceptance.";
  }
  if (name === "settings-native-coverage") {
    result.limits = "Synthetic personal landing only; organization tasks and real authority unobserved. No settings write, new account, popup, AT or production acceptance.";
    if (result.landing === "OBSERVED: real account, localized landing and actual permission-dependent controls; no activation or editing") {
      result.landing = "OBSERVED: synthetic personal principal, localized landing and actual controls; no activation or editing";
    }
  }
  if (name === "copy-settings-existing-scope"
    && result.premise === "Actual existing landing only; no organization task or new empty data.") {
    result.premise = "Declared synthetic personal landing only; organization tasks and live account evidence remain unobserved.";
  }
  return result;
}
