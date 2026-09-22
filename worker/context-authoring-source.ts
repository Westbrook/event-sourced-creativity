import { foldCanvasEvents } from "../src/canvas/model.ts";
import { foldEvents, type CreativeEvent, type CreativeProjection } from "../src/model/events.ts";
import { canonicalConsent, consentHash, type ConsequentialBinding } from "./consequential-consent.ts";
import { AUTHORING_EVENT_COLUMNS, AUTHORING_SIDECAR_COLUMNS, authoringEventRowsProof, authoringSidecarProof } from "./authoring-event-proof.ts";
import { contextSourceHash } from "./context-authoring-authority.ts";
import type { BudgetReservationGuard, PilotUser } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";
type AuthoringSourceAuthority={principal:PilotUser;binding:ConsequentialBinding;events:CreativeEvent[];projection:CreativeProjection};
function fail(code:string):never{throw new Error(code);}
/** Keep the original authority predicate at the statement's own level. Each remaining
 * private/source predicate is materialized independently in that SAME statement. */
export function packAuthoringSourceProof(...proofs:readonly BudgetReservationGuard[]):BudgetReservationGuard{
  if(!proofs.length)fail("authoring_guard_invalid");
  for(const proof of proofs)if((proof.sql.match(/\?/gu)??[]).length!==proof.bindings.length)fail("authoring_guard_invalid");
  if(new TextEncoder().encode(JSON.stringify(proofs.flatMap(proof=>proof.bindings))).byteLength>1_900_000)fail("authoring_payload_too_large");
  const[direct,...remaining]=proofs;if(!remaining.length)return direct!;
  let alias="authoring_source_params",suffix=0;
  while(proofs.some(proof=>proof.sql.includes(alias)))alias="authoring_source_params_"+(++suffix);
  let index=0;const bindings=remaining.flatMap(proof=>proof.bindings);
  const clauses=remaining.map(proof=>proof.sql.replace(/\?/gu,()=>"json_extract("+alias+".value,'$["+(index++)+"]')"));
  const serialized=JSON.stringify(bindings);if(new TextEncoder().encode(serialized).byteLength>1_900_000)fail("authoring_payload_too_large");
  const checks=clauses.map((sql,position)=>alias+"_proof_"+position+" AS MATERIALIZED(SELECT 1 FROM "+alias+" WHERE "+sql+")");
  return{sql:"("+direct!.sql+") AND EXISTS(WITH "+alias+" AS MATERIALIZED(SELECT ? AS value),"+checks.join(",")+" SELECT 1 FROM "+
    clauses.map((_,position)=>alias+"_proof_"+position).join(" CROSS JOIN ")+")",bindings:[...direct!.bindings,serialized]};
}
/** The exact native inputs of contextSourceHash; Output ledgers are independent state. */
const nativeSourceTypes = new Set([
  "ProjectCreated", "ProjectOpened", "ProjectRenamed", "ProjectStateChanged",
  "DocumentCreated", "DocumentForked", "DocumentRenamed", "DocumentOpened", "DocumentRemoved", "DocumentRestored",
  "BlockDocumentAttached", "BlockDocumentDetached", "BlockCreated", "BlockRenamed", "BlockPropertyEdited", "BlockWeightSet", "BlockLocked", "BlockUnlocked", "BlockRemoved", "BlockRestored", "BlockRehomed",
  "BlockRelationAdded", "BlockRelationRemoved", "ChipEdited", "ExtractionRequested", "ExtractionCompleted", "ExtractionFailed",
  "ImageFocalPointCalculated", "ReferenceIngested", "RightsAsserted", "CanvasCreated", "CanvasRemoved", "CanvasRestored",
]);
const canvasSourceTypes = new Set([
  "CanvasCreated", "CanvasRenamed", "CanvasRemoved", "CanvasRestored", "CanvasItemPlaced", "CanvasReferenceCreated",
  "CanvasItemRemoved", "CanvasItemRestored", "CanvasRegisterSet", "CanvasTextApplied",
  "CanvasLockAcquired", "CanvasLockReleased", "CanvasLockOverridden", "StrokeAdded", "StrokeErased",
]);
const sourceGuards = (guards: readonly BudgetReservationGuard[]): BudgetReservationGuard => {
  const join = (first: number, end: number): string => {
    if (end - first === 1) return "(" + guards[first]!.sql + ")";
    const middle = first + Math.floor((end - first) / 2);
    return "(" + join(first, middle) + " AND " + join(middle, end) + ")";
  };
  return { sql: guards.length ? join(0, guards.length) : "1", bindings: guards.flatMap((guard) => guard.bindings) };
};

/** Recheck complete current native rows and custody at the final atomic receipt. */
export async function prepareAuthoringSourceProof(env: WorkerEnv, authority: AuthoringSourceAuthority, options:{coalesceCustody?:boolean;deferFinalReplay?:boolean}={}): Promise<BudgetReservationGuard> {
  const { binding, projection } = authority;
  const events = authority.events.filter((event) => nativeSourceTypes.has(event.type) || Boolean(binding.canvasId) && canvasSourceTypes.has(event.type));
  const rebuilt = foldEvents(events, Infinity, binding.documentId, binding.projectId);
  const nativeHash = await contextSourceHash(binding.projectId, binding.documentId, undefined, rebuilt, events);
  const canvas = binding.canvasId ? foldCanvasEvents(events, binding.projectId, binding.canvasId) : null;
  const sourceHash = canvas ? await consentHash({ sourceHash: nativeHash, canvas: canvas.canvases.find((item) => item.id === binding.canvasId) ?? null, items: canvas.items }) : nativeHash;
  // A new projection dependency fails closed until this capture is updated; no hash scope is silently redefined.
  if (sourceHash !== binding.sourceHash) fail("authoring_source_changed");
  const expected = new Map(events.map((event) => [event.eventId, event]));
  const scope = binding.scope, owner = scope?.ownerUserId ?? authority.principal.userId, ids = JSON.stringify([...expected.keys()]);
  const resources = new Map<string, { kind: string; id: string }>(), add = (kind: string, id: string) => resources.set(kind + ":" + id, { kind, id });
  for (const document of projection.documents) add("document", document.id);
  for (const block of projection.libraryBlocks) {
    add("block", block.id);
    if (block.documentId) add("document", block.documentId);
    if (block.canvasId) add("canvas", block.canvasId);
    if (typeof block.properties.reference_id === "string" && block.properties.reference_id) add("reference", block.properties.reference_id);
  }
  for (const relation of projection.libraryBlockRelations) add("relation", relation.id);
  if (binding.canvasId && canvas) {
    add("canvas", binding.canvasId);
    for (const item of canvas.items) add("canvas_item", item.id);
  }
  const required = JSON.stringify([...resources.values()]);
  type Row = Record<string, string | number | null>;
  // Image acceptance captures the same complete rows together. This is a
  // native atomic read, never a saved access decision; all resulting exact
  // predicates still replay at the final authoring transaction.
  const sourceRead=env.DB.prepare(`SELECT event.*,secret.owner_id,secret.project_id,secret.document_id,secret.private_json,secret.redacted_at
    FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    WHERE event.stream_id=? AND event.event_id IN(SELECT value FROM json_each(?))`).bind(binding.streamId, ids);
  const reads=options.coalesceCustody&&scope?[sourceRead,env.DB.prepare(`SELECT * FROM project_event_scopes
      WHERE project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=?
        AND event_id IN(SELECT value FROM json_each(?))`).bind(scope.projectAccessId, scope.organizationId, scope.projectId, owner, ids),env.DB.prepare(`SELECT resource.* FROM project_resource_scopes resource JOIN json_each(?) required
      ON(resource.resource_kind,resource.resource_id)=(json_extract(required.value,'$.kind'),json_extract(required.value,'$.id'))
      WHERE(resource.project_access_id,resource.organization_id,resource.project_id,resource.owner_user_id,resource.visibility)=(?,?,?,?,'collaborative_output')`)
      .bind(required, scope.projectAccessId, scope.organizationId, scope.projectId, owner)]:null;
  const database=env.DB,observed=reads?structuredClone(await database.batch<Row>(reads)):null;
  if(observed&&(env.DB!==database||observed.length!==3||observed.some(row=>!row||row.success!==true||('error' in row&&row.error!==undefined)||!Array.isArray(row.results))))fail('authoring_source_unavailable');
  const rows=observed?observed[0]!.results:(await sourceRead.all<Row>()).results;
  if (rows.length !== expected.size) fail("authoring_source_unavailable");
  for (const row of rows) {
    if (row.redacted_at !== null || row.private_json !== null && row.owner_id !== owner) fail("authoring_source_unavailable");
    let payload: unknown;
    try { payload = JSON.parse(String(row.private_json ?? row.payload)); } catch { fail("authoring_source_unavailable"); }
    if (payload && typeof payload === "object" && "_private_ref" in payload
      || canonicalConsent(payload) !== canonicalConsent(expected.get(String(row.event_id))?.payload)) fail("authoring_source_changed");
  }
  const proofs: BudgetReservationGuard[] = [];
  const exactRows = rows.map((row) => [
    ...AUTHORING_EVENT_COLUMNS.map((column) => row[column] ?? null), row.owner_id ?? null,
    row.project_id ?? null, row.document_id ?? null, row.private_json ?? null,
  ]);
  for (let first = 0; first < exactRows.length; first += 128) proofs.push(authoringEventRowsProof(exactRows.slice(first, first + 128), true));

  if (scope) {
    const custody = observed?observed[1]!.results:(await env.DB.prepare(`SELECT * FROM project_event_scopes
      WHERE project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=?
        AND event_id IN(SELECT value FROM json_each(?))`).bind(scope.projectAccessId, scope.organizationId, scope.projectId, owner, ids).all<Row>()).results;
    const visibleIds = new Set([...projection.documents, ...projection.libraryBlocks, ...projection.libraryBlockRelations].flatMap((item) => item.sourceEvents));
    if (canvas) {
      canvas.canvases.find((item) => item.id === binding.canvasId)?.sourceEvents.forEach((id) => visibleIds.add(id));
      canvas.items.forEach((item) => item.sourceEvents.forEach((id) => visibleIds.add(id)));
    }
    const retained = new Set(custody.map((row) => String(row.event_id)));
    if (events.some((event) => (visibleIds.has(event.eventId) || event.payload.project_id === binding.projectId) && !retained.has(event.eventId))) fail("authoring_source_custody_changed");
    const custodyRows = custody.map((row) => AUTHORING_SIDECAR_COLUMNS.project_event_scopes.map((column) => row[column] ?? null));
    for (let first = 0; first < custodyRows.length; first += 128) proofs.push(authoringSidecarProof("project_event_scopes", custodyRows.slice(first, first + 128)));

    const scopedResources = observed?observed[2]!.results:(await env.DB.prepare(`SELECT resource.* FROM project_resource_scopes resource JOIN json_each(?) required
      ON(resource.resource_kind,resource.resource_id)=(json_extract(required.value,'$.kind'),json_extract(required.value,'$.id'))
      WHERE(resource.project_access_id,resource.organization_id,resource.project_id,resource.owner_user_id,resource.visibility)=(?,?,?,?,'collaborative_output')`)
      .bind(required, scope.projectAccessId, scope.organizationId, scope.projectId, owner).all<Row>()).results;
    if (scopedResources.length !== resources.size) fail("authoring_source_custody_changed");
    const resourceRows = scopedResources.map((row) => AUTHORING_SIDECAR_COLUMNS.project_resource_scopes.map((column) => row[column] ?? null));
    for (let first = 0; first < resourceRows.length; first += 128) proofs.push(authoringSidecarProof("project_resource_scopes", resourceRows.slice(first, first + 128)));
  } else proofs.push({
    sql: `NOT EXISTS(SELECT 1 FROM json_each(?) required JOIN project_resource_scopes resource
      ON(resource.resource_kind,resource.resource_id)=(json_extract(required.value,'$.kind'),json_extract(required.value,'$.id')) WHERE resource.owner_user_id=?)`,
    bindings: [required, owner],
  });
  const proof = sourceGuards(proofs);
  // A composed consumer may replay this exact predicate in its immediately
  // following guarded read/write transaction; this function grants no access.
  if (!options.deferFinalReplay&&!await env.DB.prepare("SELECT 1 AS authoring_source_retained WHERE " + proof.sql).bind(...proof.bindings).first()) fail("authoring_source_custody_changed");
  return proof;
}
