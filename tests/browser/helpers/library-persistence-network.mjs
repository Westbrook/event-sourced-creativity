import { isDeepStrictEqual } from "node:util";
import { localTestOrigin } from "./read-only-network.mjs";
import { SYNTHETIC_NETWORK_ORIGIN, syntheticNetworkEnabled } from "./synthetic-network.mjs";

// Separate opt-in RAM transport. The retained read-only transport and F44 cases
// remain byte-for-byte unchanged. No route in this module continues an API write.
export const LIBRARY_BLOCK_ID = "f-library-persistence-block";
export const ORIGINAL_TEXT = "  Existing Library persistence source — Café e\u0301 العربية 日本語.\nKeep this line.  ";
export const EDITED_TEXT = "  Edited Library persistence source — Café e\u0301 العربية 日本語.\nPreserve this exact second line.  ";
export const ORIGINAL_WEIGHT = 0.65;
export const EDITED_WEIGHT = 0.8;
export const LIBRARY_ROUTE = "/library?document=doc-atmosphere";
export const EDITOR_ROUTE = "/library/blocks/editor/" + LIBRARY_BLOCK_ID + "?document=doc-atmosphere";
export const persistenceProvenance = Object.freeze({
  mode: "finite-library-persistence-ram-r1",
  authority: "One synthetic personal principal and one independent Library seed block; no live authorization evidence",
  effects: "One exact two-event Save is committed only to this disposable test's RAM event array and fulfilled locally; zero API writes reach a server, database or provider",
  application: "Retained whole application and Store request/acknowledgement/folding paths; no Store setter, private callback, DOM value injection or fetch replacement",
  limits: "Back retains an unsaved draft. No Cancel/discard surface is exercised. Readback establishes disposable RAM transport continuity, not database durability, reload focus restoration, AT, release or whole-F acceptance",
});
const actorUserId = "e6-network-synthetic-principal";
const projectId = "project-atmosphere", documentId = "doc-atmosphere";
const now = "2026-09-03T12:00:00.000Z";
// Exact retained 23 demonstration declarations plus its fourth-decision declaration.
// Only the independent Library block appended below is new in this fixture.
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
seedSpecs.push(["user", "BlockCreated", { project_id: projectId, scope: "library", block_id: LIBRARY_BLOCK_ID, type: "direction", handle: "direction/library-persistence", properties: { text: ORIGINAL_TEXT, subtype: "Campaign goal", intent: "include", weight: ORIGINAL_WEIGHT, authority: "authored" }, position: "l000025" }]);
const originalEvents = seedSpecs.map(([actor, type, payload], index) => ({
  eventId: index < 24 ? `e6-network-event-${index + 1}` : "f-library-persistence-seed-25",
  streamId: `creative:${actorUserId}`, sequence: index + 1,
  occurredAt: now, recordedAt: now, actor,
  clientId: index < 24 ? "e6-finite-network" : "f-library-persistence-ram-r1",
  correlationId: index < 24 ? "e6-finite-network" : "f-library-persistence-seed",
  causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload,
}));
const expectedInputs = [
  { type: "BlockPropertyEdited", payload: { block_id: LIBRARY_BLOCK_ID, property_path: "text",
    old_value: ORIGINAL_TEXT, new_value: EDITED_TEXT, source_surface: "library-block-editor" } },
  { type: "BlockWeightSet", payload: { block_id: LIBRARY_BLOCK_ID,
    previous_weight: ORIGINAL_WEIGHT, weight: EDITED_WEIGHT, source_surface: "library-block-editor" } },
];
const projectEventTypes = new Set(["ProjectCreated", "DocumentCreated", "BlockCreated", "CollectionCreated", "GenerationCompleted", "ObjectPinned"]);
const initialHead = originalEvents.length, committedHead = initialHead + expectedInputs.length;
const allowedQueries = new Map();
for (const after of [0, initialHead, committedHead]) {
  for (const content of ["0", "1"]) for (const profile of ["full", "workspace", "projects"]) {
    const query = `?after=${after}&limit=${profile === "full" ? 5000 : 6500}&content=${content}${profile === "full" ? "" : "&profile=" + profile}`;
    allowedQueries.set(query, { after, content, profile });
  }
  if (after) allowedQueries.set(`?after=${after}&limit=1&content=1`, { after, content: "1", profile: "full" });
}

/** Installs after the unchanged fixture routes, before navigation. Unknown traffic
 * falls through those routes and their original rejecting guard. */
export async function installLibraryPersistenceNetwork(context, baseURL, testInfo) {
  if (process.env.FORMA_LIBRARY_PERSISTENCE !== "1" || !syntheticNetworkEnabled(baseURL)
    || localTestOrigin(baseURL) !== SYNTHETIC_NETWORK_ORIGIN || testInfo.project.name !== "f-library-persistence")
    throw new Error("Require the separately coordinated Library persistence source project and explicit opt-in");
  const rows = structuredClone(originalEvents);
  const record = { ...persistenceProvenance, principal: actorUserId, projectId, documentId,
    blockId: LIBRARY_BLOCK_ID, initialHead, committedHead, originalEvents: structuredClone(rows),
    reads: [], saveAttempts: [], committed: [], forbidden: [] };
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store",
    "x-forma-synthetic-network": "finite-library-persistence-ram-r1" };
  const handler = async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== SYNTHETIC_NETWORK_ORIGIN || url.username || url.password || url.hash
      || url.pathname !== "/api/events") return route.fallback();
    const reject = async reason => {
      record.forbidden.push({ method: request.method(), path: url.pathname, reason });
      await route.abort("blockedbyclient");
    };
    if (request.method() === "GET") {
      const query = allowedQueries.get(url.search), head = rows.length;
      if (!query || query.after > head) return reject("undeclared event read");
      const events = rows.filter(event => event.sequence > query.after
        && (query.profile === "full" || query.profile === "workspace" && event.type !== "ComparisonOpened"
          || query.profile === "projects" && projectEventTypes.has(event.type)));
      const body = { events, head, nextAfter: head, hasMore: false, ...(query.content === "1" ? { content: {} } : {}) };
      record.reads.push({ query: url.search, after: query.after, profile: query.profile,
        head, eventIds: events.map(event => event.eventId), committedCount: record.committed.length });
      await route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
      return;
    }
    if (request.method() !== "POST" || url.search) return reject("undeclared event method or query");
    const raw = request.postData();
    const attempt = { method: "POST", origin: url.origin, path: url.pathname, frameURL: request.frame().url(), raw };
    record.saveAttempts.push(attempt);
    let body;
    try { body = JSON.parse(raw ?? ""); } catch { return reject("invalid Save JSON"); }
    const expectedBody = { action: "batch", event: expectedInputs[0], events: expectedInputs,
      expectedSequence: initialHead, clientId: "web:lit" };
    if (record.saveAttempts.length !== 1 || record.committed.length || rows.length !== initialHead
      || attempt.frameURL !== new URL(EDITOR_ROUTE, baseURL).href || !isDeepStrictEqual(body, expectedBody))
      return reject("Save must be the one original exact Library text and weight batch");
    const appended = expectedInputs.map((input, index) => ({
      eventId: `f-library-persistence-commit-${index + 1}`, streamId: `creative:${actorUserId}`,
      sequence: initialHead + index + 1, occurredAt: now, recordedAt: now, actor: "user",
      clientId: "web:lit", correlationId: "f-library-persistence-save-once", causationId: null,
      compensatesEventId: null, schemaVersion: 1, type: input.type, payload: structuredClone(input.payload),
    }));
    rows.push(...appended);
    record.committed.push(...structuredClone(appended));
    await route.fulfill({ status: 200, headers,
      body: JSON.stringify({ appended, head: committedHead, rejected: [] }) });
  };
  await context.route("**/*", handler);
  return { record, dispose: () => context.unroute("**/*", handler) };
}
