import { memoryBenchmarkSchemaProfile } from "./memory-benchmark/schema.ts";
import { SCENE_SOURCE_GENERATION_TABLES } from "../db/scene-source-generation-tables.ts";
import { SCENE_SOURCE_GENERATION_TRIGGERS } from "../db/scene-source-generations.ts";
import { OUTPUT_REQUIREMENTS_SCHEMA } from "./output-requirements-schema.ts";
import { OUTPUT_DURABLE_SCHEMA } from "./output-durable-schema.ts";
import { HOLD_DISPOSITION_SCHEMA } from "./budget-hold-schema.ts";
import { VIDEO_RECONCILIATION_SCHEMA } from "./managed-video-reconciliation-schema.ts";
import { SELECTED_OUTPUT_SHARE_SCHEMA } from "./selected-output-share-schema.ts";
import { GUEST_CUSTODY_SCHEMA } from "./experience-guest-session.ts";
import { GUEST_SOURCE_SCHEMA } from "./experience-guest-source.ts";
import { GUEST_IMAGE_STAGE_CUSTODY_SCHEMA } from "./experience-guest-image-stage-custody.ts";
import { GUEST_IMAGE_RESULT_COPY_SCHEMA } from "./experience-guest-image-result-copy-schema.ts";
import { GUEST_IMAGE_RESULT_COPY_COLUMNS, type GuestImageResultCopyAttemptRow } from "./experience-guest-image-result-copy-contract.ts";
import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { imageFormatEventFields, type ImageFormat } from "../src/model/image-format.ts";
import { normalizePromptTechnique } from "../src/model/prompt-structures.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import type { OutputConfirmedPlan, OutputPreflight } from "../src/model/output-delivery-contract.ts";
import type { OutputNativeSettings } from "./output-document-execution.ts";
import type { OutputOperationSlot } from "./output-requirements-ledger.ts";
import { authoritativeCreativeContext } from "./context-authority.ts";
import { collectRetainedGuestImageHistory, guestImageHistorySessionProof, current, memoryProof, nativeBranches, unsupportedIdentityJson, boundedIdentityValue,
  eventWitness, eventColumns, bodyColumns, flatRow, commandColumns, resourceColumns, type Proof, type Row, type Value } from "./experience-guest-image-history.ts";
import { collectRetainedGuestImageStageFacts } from "./experience-guest-image-stage-facts.ts";
import { compileRetainedGuestSponsorEnvelope, type GuestImageAuthorizationV1 } from "./experience-guest-sponsor-contract.ts";
import { GUEST_DB_NOW } from "./experience-guest-session.ts";
import { EVENT_WRITE_STAGE_TRIGGER_SQL, type EventRow } from "./event-write-primitives.ts";
import { PROJECT_NOTIFICATION_TRIGGER_SQL, PILOT_OWNER_REVOCATION_TRIGGER_SQL, PILOT_PARTICIPANT_OWNER_REVOCATION_TRIGGER_SQL, PILOT_OWNER_DELETION_TRIGGER_SQL, PILOT_PARTICIPANT_OWNER_DELETION_TRIGGER_SQL, PILOT_COHORT_DELETION_TRIGGER_SQL } from "./runtime.ts";
import { publicEventPayload } from "./event-privacy.ts";
import { createRetainedSponsorImageFormat } from "./experience-sponsor-image-format.ts";
import type { SponsorRecipe } from "./experience-sponsor-policy.ts";

/** Historical raw facts only. No execution authority, live quote, provider
 * access, media reader, ownership transfer or completed inventory is created.
 * The inventory owner must atomically prove every returned part before use. */
const fail = (part: string): never => { throw new Error(`guest_image_result_${part}`); };
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const own = (value: unknown, key: PropertyKey): unknown => {
  if (!value || typeof value !== "object") return undefined;
  const d = Object.getOwnPropertyDescriptor(value, key); return d && Object.hasOwn(d, "value") ? d.value : undefined;
};
const acknowledgement = (value: unknown): boolean => {
  if (own(value, "success") !== true || !value || typeof value !== "object") return false;
  if (!("error" in value)) return true;
  const error = Object.getOwnPropertyDescriptor(value, "error");
  return !!error && Object.hasOwn(error, "value") && error.value === undefined;
};
const iso = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const objectSql = (columns: readonly string[], alias = "") => {
  const first = columns.slice(0, 15), rest = columns.slice(15);
  const base = `json_object(${first.flatMap(k => [`'${k}'`, `${alias}${k}`]).join(",")})`;
  return rest.length ? `json_set(${base},${rest.flatMap(k => [`'$.${k}'`, `${alias}${k}`]).join(",")})` : base;
};
type History = Awaited<ReturnType<typeof collectRetainedGuestImageHistory>>;
type Facts = Awaited<ReturnType<typeof collectRetainedGuestImageStageFacts>>;
type Compiled = Awaited<ReturnType<typeof compileRetainedGuestSponsorEnvelope>>;
type Frame = {
  actorUserId:string; ownerUserId:string; streamId:string; projectId:string; documentId:string; payerUserId:string;
  period:string; createdAt:string; expiresAt:string; expiresAtMs:number; sourceHead:number; planSourceHead:number; quoteHead:number;
  commandKey:string; scope:{key:string}; confirmedPlan:OutputConfirmedPlan; preflight:OutputPreflight;
  slot:OutputOperationSlot; recipe:SponsorRecipe; sourceEvents:EventRow[]; context:ReturnType<typeof authoritativeCreativeContext>;
  target:OutputConfirmedPlan["plan"]["targets"][number]; render:{format:ImageFormat;size:`${number}x${number}`};
};
type Blueprint={queue:EventRow;authorization:EventRow;commandDigest:string;payload:Record<string,unknown>;initialResult:Record<string,unknown>};
type Captured={ctx:History["ctx"];history:History;facts:Facts;compiled:Compiled;issuerGrantId:string;issuerResourceId:string;frame:Frame;
  life:{wait<T>(work:()=>Promise<T>):Promise<T>};optionalTables:Set<string>;blueprint:Blueprint|null};
type RunRows={job:Row;grant:Row;slot:Row;token:Row;cost:Row;consumption:Row;active:Row|null;calls:Row[];storage:Row[];content:Row[]};
type RunCapture={admission:Captured;runKey:string;runCommand:Row;runEvent:EventRow;events:EventRow[];rows:RunRows;settings:OutputNativeSettings;phase:string};
declare const claimFactsBrand: unique symbol;
/** Producer provenance for inert source facts only. This is not a lease,
 * inventory, reserved successor or dispatch capability. */
export type GuestImageResultClaimFacts = Readonly<{ [claimFactsBrand]: true }>;
const publishedContextColumns = ["session_id", "destination_user_id", "lease_id", "request_id", "manifest_digest", "lineage_json", "lineage_digest", "created_at_ms"] as const;
const publishedSaveColumns = ["session_id", "destination_user_id", "lease_id", "request_id", "manifest_digest", "context_lineage_digest", "lineage_json", "lineage_digest", "created_at_ms"] as const;
const publishedStageColumns = ["session_id", "destination_user_id", "lease_id", "request_id", "manifest_digest", "context_lineage_digest", "save_lineage_digest", "lineage_json", "lineage_digest", "created_at_ms"] as const;
const publishedResultColumns = ["custody_id", "session_id", "destination_user_id", "lease_id", "lease_acquisition", "request_id", "manifest_digest", "native_snapshot_digest", "context_lineage_digest", "save_lineage_digest", "stage_lineage_digest", "claim_event_id", "claim_event_sequence", "original_completion_event_id", "generation_id", "output_id", "copy_attempt_id", "lineage_json", "lineage_digest", "created_at_ms", "canonical_expires_at"] as const;
const publishedStageCopyColumns = ["session_id", "role", "content_id", "original_digest", "byte_length", "created_at", "expires_at"] as const;
const publishedResultCopyColumns = ["custody_id", "role", "content_id", "original_content_id", "original_kind", "original_digest", "byte_length", "created_at", "expires_at"] as const;
const publishedReceiptColumns = ["stream_id", "client_event_id", "event_id", "sequence", "created_at"] as const;
const publishedLeaseColumns = ["session_id", "lease_id", "destination_user_id", "manifest_digest", "request_id", "request_ids_json", "acquisitions", "created_at_ms", "expires_at_ms"] as const;
type PublishedGraphRow<C extends readonly string[]> = Readonly<Record<C[number], Value>>;
/** Full proposed rows, never a claim capability. The genuine claim owner binds
 * this closed graph to its original ready successor before requesting proofs. */
export type GuestImageResultPublishedGraph = Readonly<{
  version: 1; revokedAtMs: number;
  contextMapping: PublishedGraphRow<typeof publishedContextColumns>;
  saveMapping: PublishedGraphRow<typeof publishedSaveColumns>;
  stageMapping: PublishedGraphRow<typeof publishedStageColumns>;
  resultMapping: PublishedGraphRow<typeof publishedResultColumns>;
  stageCopies: readonly [PublishedGraphRow<typeof publishedStageCopyColumns>, PublishedGraphRow<typeof publishedStageCopyColumns>, PublishedGraphRow<typeof publishedStageCopyColumns>];
  resultCopies: readonly [PublishedGraphRow<typeof publishedResultCopyColumns>, PublishedGraphRow<typeof publishedResultCopyColumns>];
  eventEnvelopes: readonly Readonly<{ event: Readonly<Row>; envelope: Readonly<Row> }>[];
  eventClientReceipts: readonly PublishedGraphRow<typeof publishedReceiptColumns>[];
  saveCommand: Readonly<Row>; privateContents: readonly Readonly<Row>[];
  publishedAttempt: GuestImageResultCopyAttemptRow;
}>;
type ClaimFactsCapture = Readonly<{
  scope: Readonly<Record<string, Value>>; scopeJson: string; resultCopySchemaInstalled: boolean;
  publicationSchemaInstalled: boolean; closureRows: readonly (readonly [string, string])[];
}>;
type PublishedFactsCapture = Readonly<{
  immutable: readonly Proof[]; session: Readonly<Row>; sourceHead: number;
  completionEventId: string; generationId: string; outputId: string;
}>;
const claimFactsCaptures = new WeakMap<GuestImageResultClaimFacts, ClaimFactsCapture>();
const publishedFactsCaptures = new WeakMap<GuestImageResultClaimFacts, PublishedFactsCapture>();
const reservedAttemptColumns = Object.freeze([...GUEST_IMAGE_RESULT_COPY_COLUMNS]);
const grantColumns = ["grant_id", "campaign_id", "policy_digest", "actor_user_id", "session_digest", "intent_key", "envelope_digest", "issued_at_ms", "expires_at_ms", "enabled"];
const issuanceColumns = ["grant_id", "campaign_id", "actor_user_id", "intent_key", "policy_digest", "driver_command_json", "command_digest", "envelope_digest", "envelope_json"];
const consumptionColumns = ["consumption_id", "grant_id", "campaign_id", "actor_user_id", "session_digest", "intent_key", "envelope_digest", "job_id", "maximum_microusd", "admitted_at_ms"];

const jobColumns=["job_id","owner_id","stream_id","document_id","kind","status","source_surface","correlation_id","requested_sequence","request_json","result_json","scene_source_version_json","scene_source_protocol","error_message","attempt_count","requested_at","started_at","completed_at","lease_expires_at","notified_at","expires_at","updated_at"];
const nativeGrantColumns=["scope_key","grant_id","plan_revision_id","actor_user_id","payer_user_id","context_id","preflight_id","authorization_event_id","maximum_microusd","maximum_calls","status","expires_at","created_at"];
const slotColumns=["scope_key","slot_id","grant_id","plan_revision_id","target_id","target_contract_digest","source_digest","provider","model","route_digest","job_id","cost_reservation_id","token_reservation_id","maximum_microusd","maximum_calls","maximum_tokens","attempt_ordinal","previous_slot_id","status","outcome_event_id","created_at","updated_at"];
const tokenColumns=["reservation_id","owner_id","stream_id","correlation_id","operation","period","reserved_tokens","used_tokens","status","settlement_reason","created_at","settled_at","updated_at"];
const costColumns=["reservation_id","owner_id","workspace_id","stream_id","correlation_id","operation","period","reserved_microusd","used_microusd","status","allow_user_overage","created_at","settled_at","updated_at"];
const callColumns=["scope_key","slot_id","call_key","client_request_id","request_digest","stage_key","provider","model","reserved_microusd","used_microusd","status","provider_response_id","created_at","settled_at"];
const storageColumns=["scope_key","slot_id","storage_key","content_sha256","status","write_acknowledged","publication_event_id","created_at","updated_at"];
const contentColumns=["content_id","owner_id","kind","content","created_at","expires_at","redacted_at"];
const nonnegative=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
function equal(actual: unknown, expected: unknown) { if (canonicalJson(actual) !== canonicalJson(expected)) return fail("receipt_changed"); }
function eventFrom(value: Facts["tails"][number]): EventRow {
  if (!value.payload || value.row.redacted_at !== null) return fail("private_source_unavailable");
  const r = value.row; return { eventId: value.eventId, streamId: String(r.stream_id), sequence: Number(r.sequence), occurredAt: String(r.occurred_at),
    recordedAt: String(r.recorded_at), actor: String(r.actor), clientId: String(r.client_id), correlationId: String(r.correlation_id),
    causationId: null, compensatesEventId: null, schemaVersion: 1, type: String(r.type), payload: structuredClone(value.payload) };
}
function nativeRow(raw: unknown, columns: readonly string[], maximumBytes: number): Row {
  if (typeof raw !== "string" || bytes(raw)>maximumBytes) return fail("row_size");
  let value: unknown; try { value=JSON.parse(raw); } catch { return fail("row_invalid"); }
  if (!flatRow(value,columns) || Object.values(value).some(item=>typeof item==="string"&&(bytes(item)>131072||item.includes("\u0000")))) return fail("row_invalid");
  return value;
}
const id = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v);
function json(raw: unknown) { if (typeof raw !== "string" || bytes(raw) > 131072) return fail("json_invalid");
  let value: unknown; try { value = JSON.parse(raw); } catch { return fail("json_invalid"); }
  if (!record(value) || jsonIssues(value).length) return fail("json_invalid"); return value; }
function exact(table: string, values: Row): Proof { const columns = Object.keys(values); return { sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${objectSql(columns)}=?)`, bindings: [JSON.stringify(values)] }; }
function eventProof(event: EventRow, f: {ownerUserId:string;projectId:string|null;documentId:string|null}): Proof {
  const split = publicEventPayload(event.eventId, event.payload, true);
  const expected = {event_id:event.eventId,stream_id:event.streamId,sequence:event.sequence,occurred_at:event.occurredAt,recorded_at:event.recordedAt,
    actor:event.actor,client_id:event.clientId,correlation_id:event.correlationId,causation_id:event.causationId,compensates_event_id:event.compensatesEventId,
    schema_version:event.schemaVersion,type:event.type,payload:JSON.stringify(split.payload),owner_id:f.ownerUserId,project_id:f.projectId,document_id:f.documentId,
    private_json:split.privateJson,created_at:event.recordedAt,redacted_at:null};
  return {sql:`EXISTS(SELECT 1 FROM events e JOIN event_private_payloads body ON body.private_event_id=e.event_id WHERE ${eventWitness}=?)`,bindings:[JSON.stringify(expected)]};
}
function reference(f: Frame) { const s=f.slot;return {scopeKey:s.scopeKey,grantId:s.grantId,slotId:s.slotId,planRevisionId:s.planRevisionId,targetId:s.targetId,targetContractDigest:s.targetContractDigest,sourceDigest:s.sourceDigest}; }
function eventSkeleton(streamId:string,sequence:number,actor:string,clientId:string,correlationId:string,type:string,payload:Record<string,unknown>):EventRow {
  return {eventId:"",streamId,sequence,actor,clientId,correlationId,type,payload,occurredAt:"",recordedAt:"",causationId:null,compensatesEventId:null,schemaVersion:1};
}
function queue(f: Frame, eventId: string): EventRow { const event=eventSkeleton(f.streamId,f.quoteHead+1,f.actorUserId,"server:guest-output",f.commandKey,"OutputOperationJobQueued",
  {job_id:f.slot.jobId,document_id:f.documentId,kind:"generate",output_slot_id:f.slot.slotId,output_grant_id:f.slot.grantId,project_id:f.projectId,actor_user_id:f.actorUserId});
  return {...event,eventId,occurredAt:f.createdAt,recordedAt:f.createdAt}; }
function resultShape(f: Frame, plannerModel: string) { const s=f.slot, settings=f.preflight.targets[0]!.settings as {payload:Record<string,unknown>};return {artifactKind:String(settings.payload.artifactKind??""),generationReceipt:{artifact_kind:"image",provider:"openai",model:plannerModel,
  reservation_microusd:s.maximumMicrousd,settled_cost_microusd:0,reservation_status:"active",source_transmission_status:"not_transmitted",provider_request_status:"not_submitted",output_slot_id:s.slotId,output_grant_id:s.grantId},
  stage:"queued",progressMessage:"The accepted generation and its private source receipt are safely recorded.",reservationId:s.tokenReservationId,costReservationId:s.costReservationId,
  costReservationPeriod:f.period,costReservationMicrousd:s.maximumMicrousd,outputExecution:reference(f),providerSubmissionProtocol:1}; }
function validatePayload(f: Frame, value: Record<string, unknown>) {
  const settings=f.preflight.targets[0]!.settings as {payload:Record<string,unknown>};
  const expected={...structuredClone(settings.payload),snapshot:structuredClone(f.context.snapshot),sourceBlockVersions:structuredClone(f.context.sourceBlockVersions),documentRevision:f.context.documentRevision,
    outputExecution:reference(f),preflightId:value.preflightId,preflightVersion:value.preflightVersion,preflightAcknowledged:value.preflightAcknowledged};
  if(typeof value.preflightId!=="string"||!id(value.preflightId)||value.preflightVersion!=="generation-readiness-v1"||typeof value.preflightAcknowledged!=="boolean")return fail("job_readiness_invalid");
  equal(value,expected);
}
async function blueprint(c: Captured, slot: OutputOperationSlot, createdAt: string, period: string, queueId: string, eventId: string, payload: Record<string,unknown>, initialResult: Record<string,unknown>) {
  const f={...c.frame,slot,createdAt,period};validatePayload(f,payload);equal(initialResult,resultShape(f,(f.preflight.targets[0]!.settings as OutputNativeSettings).calls[0]!.model));
  const marker={version:1,issuerGrantId:c.issuerGrantId,driverCommandDigest:c.history.saved.driver.commandDigest,sourceRevision:f.quoteHead,planSourceHead:f.planSourceHead,period,slot,queueEventId:queueId,payload,initialResult};
  const envelope={action:"authorize",documentId:f.documentId,expectedRevision:`output:${f.quoteHead}`,clientMutationId:f.commandKey,preflightId:f.preflight.id,planRevisionId:f.confirmedPlan.revisionId,
    termsDigest:f.preflight.termsDigest,maximumMicrousd:f.recipe.maximumMicrousd,targetIds:[f.target.id],explicitAuthorization:true,
    sponsor_entitlement:{consumption_id:c.compiled.envelope.consumptionId,envelope_digest:c.compiled.envelopeDigest,policy_digest:c.compiled.policyDigest},guest_image_admission:marker};
  const commandDigest=(await c.life.wait(()=>digest(envelope))).slice(7);
  const authorization=eventSkeleton(f.streamId,f.quoteHead+2,f.actorUserId,"server:guest-output",f.commandKey,"OutputExecutionAuthorized",
    {grant_id:slot.grantId,preflight_id:f.preflight.id,plan_revision_id:slot.planRevisionId,maximum_microusd:slot.maximumMicrousd,maximum_calls:slot.maximumCalls,authorized_targets:[{target_id:slot.targetId,operation_slot_id:slot.slotId,job_id:slot.jobId,route_digest:slot.routeDigest}],source_digest:slot.sourceDigest,
      output_command_envelope:envelope,project_id:f.projectId,document_id:f.documentId,actor_user_id:f.actorUserId});
  const result=freeze({queue:queue(f,queueId),authorization:{...authorization,eventId,occurredAt:createdAt,recordedAt:createdAt},commandDigest,payload:structuredClone(payload),initialResult:structuredClone(initialResult)});
  // Do not commit a receipt that the bounded original reader cannot recover.
  // Test exactly the serialization and limits used by readNative, before any write.
  for(const event of [result.queue,result.authorization]){
    const split=publicEventPayload(event.eventId,event.payload,true);
    if(bytes(JSON.stringify(split.payload))>65536||typeof split.privateJson!=="string"||bytes(split.privateJson)>131072
      ||bytes(String(eventProof(event,f).bindings[0]))>131072)return fail("native_receipt_size");
  }
  return result;
}
function slotFrom(c: Pick<Captured,"facts"|"compiled">, scopeKey:string, ids:{grantId:string;slotId:string;jobId:string;costReservationId:string;tokenReservationId:string}):OutputOperationSlot {
  const q=c.facts.quote!,p=c.facts.confirmed!,t=q.targets[0]!;
  if(q.targets.length!==1||!t.available||typeof t.provider!=="string"||!t.provider||typeof t.model!=="string"||!t.model)return fail("native_route_invalid");
  return {scopeKey,grantId:ids.grantId,slotId:ids.slotId,jobId:ids.jobId,costReservationId:ids.costReservationId,tokenReservationId:ids.tokenReservationId,
    planRevisionId:p.revisionId,targetId:t.targetId,targetContractDigest:p.targetContractDigests[t.targetId]!,sourceDigest:q.sourceDigest,provider:t.provider,model:t.model,routeDigest:c.compiled.envelope.recipe.routeDigest.slice(7),maximumMicrousd:t.maximumMicrousd,
    maximumCalls:t.maximumCalls,maximumTokens:t.maximumTokens,status:"authorized",attemptOrdinal:0,previousSlotId:null};
}

async function nativeRows(c:Captured,table:string,columns:readonly string[],where:string,bindings:Value[],maximum:number):Promise<Row[]>{
  const bounded=columns.map(k=>`(${k} IS NULL OR typeof(${k}) IN('integer','real') OR typeof(${k})='text' AND length(CAST(${k} AS BLOB))<=131072 AND instr(${k},char(0))=0)`).join(" AND ");
  const result=await c.life.wait(()=>c.ctx.db.prepare(`SELECT CASE WHEN ${bounded} THEN ${objectSql(columns)} ELSE NULL END AS witness FROM ${table} WHERE ${where} LIMIT ${maximum+1}`).bind(...bindings).all<{witness:string}>());
  const values=own(result,"results");if(!acknowledgement(result)||!Array.isArray(values)||values.length>maximum)return fail("run_rows_unavailable");
  const found:Row[]=[];for(let i=0;i<values.length;i++){if(!Object.hasOwn(values,i))return fail("run_rows_unavailable");found.push(nativeRow(own(values[i],"witness"),columns,262144));}return found;
}
function observedProofs(table:string,columns:readonly string[],where:string,bindings:Value[],rows:readonly Row[]):Proof[]{
  return [{sql:`(SELECT COUNT(*) FROM ${table} WHERE ${where})=?`,bindings:[...bindings,rows.length]},...rows.map(value=>exact(table,Object.fromEntries(columns.map(key=>[key,value[key]!]))))];
}
function runCommandValue(c:Captured,runKey:string){const f=c.frame;return {action:"run",documentId:f.documentId,expectedRevision:`output:${f.quoteHead+2}`,clientMutationId:runKey,grantId:f.slot.grantId};}
function runEventValue(c:Captured,runKey:string,eventId:string,createdAt:string):EventRow{
  const f=c.frame;return {...eventSkeleton(f.streamId,f.quoteHead+3,f.actorUserId,"server:guest-output",runKey,"OutputExecutionRunRequested",
    {grant_id:f.slot.grantId,job_ids:[f.slot.jobId],existing_jobs_only:true,output_command_envelope:runCommandValue(c,runKey),project_id:f.projectId,document_id:f.documentId,actor_user_id:f.actorUserId}),eventId,occurredAt:createdAt,recordedAt:createdAt};
}
function progressEventProof(event:EventRow,c:Captured):Proof{
  const f=c.frame,p=event.payload;
  return eventProof(event,{...f,projectId:String(p.project_id??"")||null,documentId:String(p.document_id??"")||null});
}
async function progressEvents(c:Captured):Promise<EventRow[]>{
  const f=c.frame,result=await c.life.wait(()=>c.ctx.db.prepare(`SELECT CASE WHEN length(CAST(body.private_json AS BLOB))<=131072 AND length(CAST(e.payload AS BLOB))<=65536 THEN ${eventWitness} ELSE NULL END AS witness
    FROM events e LEFT JOIN event_private_payloads body ON body.private_event_id=e.event_id WHERE e.stream_id=? AND e.sequence>? ORDER BY e.sequence LIMIT 13`).bind(f.streamId,f.quoteHead+2).all<{witness:string}>());
  const values=own(result,"results");if(!acknowledgement(result)||!Array.isArray(values)||values.length>12)return fail("run_events_unavailable");
  return values.map((value,index)=>{const entry=nativeRow(own(value,"witness"),[...eventColumns,...bodyColumns],131072),payload=json(entry.private_json);
    if(entry.stream_id!==f.streamId||entry.sequence!==f.quoteHead+3+index||!id(entry.event_id)||!iso(entry.occurred_at)||entry.recorded_at!==entry.occurred_at||entry.created_at!==entry.recorded_at
      ||Date.parse(entry.recorded_at)<Date.parse(f.createdAt)||Date.parse(entry.recorded_at)>=f.expiresAtMs||entry.owner_id!==f.ownerUserId||entry.redacted_at!==null
      ||entry.schema_version!==1||entry.compensates_event_id!==null||entry.project_id!==(String(payload.project_id??"")||null)||entry.document_id!==(String(payload.document_id??"")||null)
      ||entry.payload!==JSON.stringify(publicEventPayload(String(entry.event_id),payload,true).payload))return fail("run_event_changed");
    return {eventId:String(entry.event_id),streamId:f.streamId,sequence:Number(entry.sequence),occurredAt:String(entry.occurred_at),recordedAt:String(entry.recorded_at),actor:String(entry.actor),clientId:String(entry.client_id),correlationId:String(entry.correlation_id),causationId:entry.causation_id as string|null,compensatesEventId:null,schemaVersion:1,type:String(entry.type),payload};});
}

/** Fixed negative reference projections for the two closed result contracts.
 * No exported selector/parser, positive authority or caller SQL is accepted. */
function resultClaimAssociationSql(kind: "attempt" | "custody"): string {
  const column = kind === "attempt" ? "d.descriptor_json" : "d.lineage_json";
  const maximumBytes = kind === "attempt" ? 65536 : 262144, maximumNodes = kind === "attempt" ? 4096 : 8192;
  const scalar: Array<[string, string, string, number]> = [];
  const constants: Array<[string, string | number, number]> = [];
  const arrays: Array<[string, number, number, string]> = [];
  const publics: Array<[string, string[], number, string[] | null, string]> = [];
  const required = new Map<string, { type: string; minimumEvents: number }>();
  const requireNode = (path: string, type: string, minimumEvents = 0) => {
    const prior = required.get(path);
    if (prior && prior.type !== type) return fail("result_claim_projection_invalid");
    required.set(path, { type, minimumEvents: Math.min(prior?.minimumEvents ?? minimumEvents, minimumEvents) });
    const tokens = path.slice(1).match(/\.[A-Za-z_][A-Za-z_0-9]*|\[\d+\]/gu) ?? [];
    let parent = "$";
    for (const token of tokens) {
      const parentType = token.startsWith("[") ? "array" : "object", existing = required.get(parent);
      if (existing && existing.type !== parentType) return fail("result_claim_projection_invalid");
      required.set(parent, { type: parentType, minimumEvents: Math.min(existing?.minimumEvents ?? minimumEvents, minimumEvents) });
      parent += token;
    }
  };
  const identity = (path: string, target: string, type = "text", minimumEvents = 0) => {
    scalar.push([path, target, type, minimumEvents]); requireNode(path, type, minimumEvents);
  };
  const array = (path: string, minimum: number, maximum: number, type: string) => {
    arrays.push([path, minimum, maximum, type]); requireNode(path, "array");
  };
  const envelope = (path: string, keys: string[], minimumEvents = 0, exactKeys: string[] | null = null, mode = "prefix") => {
    publics.push([path, keys, minimumEvents, exactKeys, mode]); requireNode(path, "text", minimumEvents);
  };
  const constant = (path: string, value: string | number, minimumEvents = 0) => {
    constants.push([path, value, minimumEvents]); requireNode(path, typeof value === "number" ? "integer" : "text", minimumEvents);
  };
  constant("$.version", 1); constant("$.kind", kind === "attempt" ? "guest-image-result-copy" : "original-image-result-custody");
  const prefix = kind === "attempt" ? "$.manifest" : "$.copy.manifest";
  constant(`${prefix}.version`, 1); constant(`${prefix}.kind`, "original-image-completed-result");
  for (const [key, target] of [["sessionId","sessionId"],["guestSubject","guest"],["projectId","project"],["documentId","document"],
    ["generationId","generated"],["completionEventId","ids"],["usageEventId","ids"]]) identity(`${prefix}.${key}`, target!);
  array(`${prefix}.sourceEventIds`, 3, 16, "text");
  for (const [key, target] of [["scopeKey","scope"],["jobId","job"],["slotId","slot"],["executionGrantId","grant"],["issuerGrantId","issuer"],
    ["consumptionId","consumption"],["planRevisionId","plan"]]) identity(`${prefix}.nativeIdentity.${key}`, target!);
  // These native IDs are scoped, not standalone cross-owner associations.
  requireNode(`${prefix}.nativeIdentity.targetId`, "text"); requireNode(`${prefix}.nativeIdentity.preflightId`, "text");
  identity(`${prefix}.financialReceipt.tokenReservationId`, "token"); identity(`${prefix}.financialReceipt.costReservationId`, "cost");
  array(`${prefix}.privateContents`, 2, 2, "object");
  for (let index = 0; index < 2; index++) identity(`${prefix}.privateContents[${index}].contentId`, "bodyIds");
  identity(`${prefix}.object.storageKey`, "storageKeys"); identity(`${prefix}.object.publicationEventId`, "ids");
  const copy = kind === "attempt" ? "$" : "$.copy";
  identity(`${copy}.leaseSnapshot.session_id`, "sessionId");
  identity(`${copy}.destinationMetadata.generationId`, "generated"); identity(`${copy}.destinationMetadata.outputId`, "generated");
  const selectedArrays: Array<[string, string]> = [[`${prefix}.sourceEventIds`, "ids"]];
  if (kind === "custody") {
    constant("$.copy.version", 1); constant("$.copy.kind", "guest-image-result-copy");
    constant("$.contextLineage.version", 1);
    constant("$.saveLineage.version", 1); constant("$.saveLineage.kind", "first-image-save");
    constant("$.stageLineage.version", 1); constant("$.stageLineage.kind", "original-image-stage-custody");
    constant("$.stageLineage.source.state", "quoted");
    for (const root of ["contextLineage", "saveLineage", "stageLineage"]) {
      for (const [key, target] of [["sessionId","sessionId"],["guestSubject","guest"],["projectId","project"],["documentId","document"]])
        identity(`$.${root}.${key}`, target!);
    }
    identity("$.contextLineage.lease.session_id", "sessionId"); identity("$.saveLineage.draftId", "draft");
    array("$.contextLineage.sourceEventIds", 3, 16, "text"); selectedArrays.push(["$.contextLineage.sourceEventIds", "ids"]);
    array("$.saveLineage.source.eventIds", 3, 16, "text"); selectedArrays.push(["$.saveLineage.source.eventIds", "ids"]);
    identity("$.saveLineage.source.save.id", "ids"); identity("$.saveLineage.target.id", "ids");
    identity("$.saveLineage.target.requirementId", "blocks"); requireNode("$.saveLineage.target.commandKey", "text");
    const command = (path: string) => {
      identity(`${path}.scope_key`, "scope"); identity(`${path}.actor_user_id`, "guest");
      requireNode(`${path}.command_key`, "text"); identity(`${path}.event_id`, "ids");
    };
    const resource = (path: string) => { identity(`${path}.resource_id`, "resources"); identity(`${path}.actor_user_id`, "guest"); };
    command("$.saveLineage.source.command"); resource("$.saveLineage.source.resource");
    identity("$.stageLineage.source.saveEventId", "ids"); identity("$.stageLineage.source.confirmation.id", "ids");
    command("$.stageLineage.source.confirmationCommand"); resource("$.stageLineage.source.confirmationResource");
    identity("$.stageLineage.source.quote.id", "ids"); requireNode("$.stageLineage.source.quote.preflightId", "text");
    identity("$.stageLineage.source.quote.planRevisionId", "plan"); command("$.stageLineage.source.quoteCommand");
    identity("$.stageLineage.source.construction.driverId", "driver"); resource("$.stageLineage.source.construction.resource");
    identity("$.originalCompletion.eventId", "ids"); identity("$.originalCompletion.objectId", "generated");
    identity("$.canonical.eventId", "ids"); identity("$.canonical.streamId", "stream");
    array("$.resultCopies", 2, 2, "object");
    for (let index = 0; index < 2; index++) {
      identity(`$.resultCopies[${index}].content_id`, "bodyIds"); identity(`$.resultCopies[${index}].original_content_id`, "bodyIds");
    }
    array("$.stageCopies", 3, 3, "object"); array("$.stageLineage.copies", 3, 3, "object");
    for (let index = 0; index < 3; index++) {
      identity(`$.stageCopies[${index}].session_id`, "sessionId"); identity(`$.stageCopies[${index}].content_id`, "bodyIds");
      identity(`$.stageLineage.copies[${index}].contentId`, "bodyIds");
    }
    array("$.contextLineage.events", 3, 16, "object");
    for (let index = 0; index < 16; index++) {
      const path = `$.contextLineage.events[${index}]`, minimumEvents = index + 1;
      constant(`${path}.type`, ["ProjectCreated", "DocumentCreated", "EmptyCanvasChosen"][index] ?? "BlockCreated", minimumEvents);
      requireNode(`${path}.key`, "text", minimumEvents);
      identity(`${path}.id`, "ids", "text", minimumEvents); identity(`${path}.project`, "project", "text", minimumEvents);
      identity(`${path}.document`, "document", index === 0 ? "null" : "text", minimumEvents);
      envelope(`${path}.public`, ["_private_ref", "project_id", "client_event_id", ...(index === 0 ? [] : ["document_id"]), ...(index >= 3 ? ["block_id"] : [])], minimumEvents, null, index === 0 ? "prefix-project" : "prefix");
    }
    const saveKeys = ["_private_ref", "block_id", "project_id", "document_id", "actor_user_id"];
    envelope("$.saveLineage.source.save.public", saveKeys, 0, [...saveKeys, "type", "scope"], "save");
    envelope("$.saveLineage.target.public", saveKeys, 0, [...saveKeys, "type", "scope"], "save");
    const confirmationKeys = ["_private_ref", "plan_revision_id", "project_id", "document_id", "actor_user_id"];
    envelope("$.stageLineage.source.confirmation.public", confirmationKeys, 0, confirmationKeys);
    const quoteKeys = ["_private_ref", "preflight_id", "plan_revision_id", "project_id", "document_id", "actor_user_id"];
    envelope("$.stageLineage.source.quote.public", quoteKeys, 0, quoteKeys);
  }
  const literal = (value: string) => `'${value.replace(/'/gu, "''")}'`;
  // Native json_tree quotes underscore-bearing property names in fullkey/path.
  // Project only the first, compiler-owned path cell of these fixed rows; no
  // retained JSON, proof binding, identity value or caller selector is changed.
  const nativePath = (path: string) => path.replace(/\.([A-Za-z_][A-Za-z_0-9]*)/gu,
    (_segment, key: string) => key.includes("_") ? `."${key}"` : `.${key}`);
  const tuples = (rows: readonly (readonly (string | number)[])[]) => rows.map(row => `(${row.map((value, index) =>
    typeof value === "number" ? value : literal(index === 0 ? nativePath(value) : value)).join(",")})`).join(",");
  const listTargets = new Set(["generated", "ids", "bodyIds", "storageKeys", "commands", "resources", "blocks"]);
  const targets = [...new Set([...scalar.map(([, target]) => target), ...selectedArrays.map(([, target]) => target)])];
  // Preserve each fixed predicate and its order while bounding expression
  // depth; a left-associated OR chain exceeds the existing native SQL limit.
  const balancedOr = (terms: readonly string[]): string => {
    if (terms.length === 1) return terms[0]!;
    const middle = Math.floor(terms.length / 2);
    return `(${balancedOr(terms.slice(0, middle))} OR ${balancedOr(terms.slice(middle))})`;
  };
  const matches = (selector: string, atom: string) => balancedOr(targets.map(target => `${selector}=${literal(target)} AND ${atom}${listTargets.has(target) ? ` IN(SELECT value FROM json_each(s.${target}))` : `=s.${target}`}`).map(value => `(${value})`));
  const publicTargets = [["_private_ref","ids"],["project_id","project"],["document_id","document"],["block_id","blocks"],
    ["actor_user_id","guest"],["plan_revision_id","plan"]];
  const publicMatch = balancedOr(publicTargets.map(([key, target]) => `(field.key=${literal(key!)} AND field.value${listTargets.has(target!)
    ? ` IN(SELECT value FROM json_each(s.${target}))` : `=s.${target}`})`));
  const publicKeys = [...publicTargets.map(([key]) => key!), "client_event_id", "preflight_id"].map(literal).join(",");
  const publicClause = kind === "attempt" ? "0" : `EXISTS(SELECT 1 FROM result_identity_public selected
    JOIN result_identity_nodes body ON body.fullkey=selected.fullkey WHERE selected.minimum_events<=(SELECT count FROM result_identity_context)
    AND CASE WHEN body.type='text' AND length(CAST(body.atom AS BLOB)) BETWEEN 2 AND 8192 AND instr(body.atom,char(0))=0 THEN CASE WHEN json_valid(body.atom)
      THEN CASE WHEN json_type(body.atom)='object' THEN
        (selected.exact_keys<>'null' AND ((SELECT COUNT(*) FROM json_each(body.atom))<>json_array_length(selected.exact_keys)
          OR (SELECT COUNT(DISTINCT key) FROM json_each(body.atom))<>json_array_length(selected.exact_keys)
          OR EXISTS(SELECT 1 FROM json_each(body.atom) field WHERE field.type<>'text' OR field.key NOT IN(SELECT value FROM json_each(selected.exact_keys)))))
        OR (selected.mode='save' AND (json_extract(body.atom,'$.type') IS NOT 'output' OR json_extract(body.atom,'$.scope') IS NOT 'document'))
        OR (selected.mode='prefix-project' AND EXISTS(SELECT 1 FROM json_each(body.atom) field WHERE field.key='document_id' AND field.type<>'null'))
        OR EXISTS(SELECT 1 FROM json_each(body.atom) field WHERE field.key IN(${publicKeys}) GROUP BY field.key
          HAVING COUNT(*)<>1 OR SUM(CASE WHEN field.type='text' OR selected.mode='prefix-project' AND field.key='document_id' AND field.type='null' THEN 1 ELSE 0 END)<>1)
        OR EXISTS(SELECT 1 FROM json_each(selected.required_keys) expected WHERE
          (SELECT COUNT(*) FROM json_each(body.atom) field WHERE field.key=expected.value AND field.type='text')<>1)
        OR EXISTS(SELECT 1 FROM json_each(body.atom) field WHERE field.type='text' AND (${publicMatch}))
      ELSE 1 END ELSE 1 END ELSE 1 END)`;
  return `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB)) BETWEEN 2 AND ${maximumBytes}
    THEN CASE WHEN json_valid(${column}) THEN CASE WHEN json_type(${column})='object' THEN EXISTS(
      WITH result_identity_nodes AS MATERIALIZED(SELECT parent,key,fullkey,path,type,atom FROM json_tree(${column})),
      result_identity_context(count) AS(SELECT COUNT(*) FROM result_identity_nodes WHERE path='$.contextLineage.events'),
      result_identity_required(fullkey,expected_type,minimum_events) AS(VALUES ${tuples([...required].map(([path, value]) => [path,value.type,value.minimumEvents]))}),
      result_identity_scalars(fullkey,target,expected_type,minimum_events) AS(VALUES ${tuples(scalar)}),
      result_identity_constants(fullkey,expected_atom,minimum_events) AS(VALUES ${tuples(constants)}),
      result_identity_arrays(fullkey,minimum_count,maximum_count,element_type) AS(VALUES ${tuples(arrays)}),
      result_identity_selected_arrays(fullkey,target) AS(VALUES ${tuples(selectedArrays)})${kind === "custody"
        ? `,result_identity_public(fullkey,required_keys,minimum_events,exact_keys,mode) AS(VALUES ${tuples(publics.map(([path, keys, minimum, exactKeys, mode]) => [path,JSON.stringify(keys),minimum,JSON.stringify(exactKeys),mode]))})` : ""}
      SELECT 1 WHERE (SELECT COUNT(*) FROM result_identity_nodes)>${maximumNodes}
        OR EXISTS(SELECT 1 FROM result_identity_nodes WHERE typeof(key)='text' GROUP BY parent,key HAVING COUNT(*)<>1)
        OR EXISTS(SELECT 1 FROM result_identity_constants expected JOIN result_identity_nodes found ON found.fullkey=expected.fullkey WHERE expected.minimum_events<=(SELECT count FROM result_identity_context) AND found.atom IS NOT expected.expected_atom)
        OR EXISTS(SELECT 1 FROM result_identity_required expected LEFT JOIN result_identity_nodes found ON found.fullkey=expected.fullkey
          WHERE expected.minimum_events<=(SELECT count FROM result_identity_context) GROUP BY expected.fullkey,expected.expected_type
          HAVING COUNT(found.fullkey)<>1 OR SUM(CASE WHEN found.type=expected.expected_type THEN 1 ELSE 0 END)<>1)
        OR EXISTS(SELECT 1 FROM result_identity_arrays expected WHERE
          (SELECT COUNT(*) FROM result_identity_nodes child WHERE child.path=expected.fullkey) NOT BETWEEN expected.minimum_count AND expected.maximum_count
          OR EXISTS(SELECT 1 FROM result_identity_nodes child WHERE child.path=expected.fullkey AND child.type<>expected.element_type))
        OR EXISTS(SELECT 1 FROM result_identity_scalars selected JOIN result_identity_nodes identity ON identity.fullkey=selected.fullkey
          WHERE identity.type='text' AND selected.minimum_events<=(SELECT count FROM result_identity_context) AND (${matches("selected.target", "identity.atom")}))
        OR EXISTS(SELECT 1 FROM result_identity_selected_arrays selected JOIN result_identity_nodes identity ON identity.path=selected.fullkey
          WHERE identity.type='text' AND (${matches("selected.target", "identity.atom")})) OR ${publicClause})
    ELSE 1 END ELSE 1 END ELSE 1 END`;
}

/** Fixed inert proof construction only. The genuine claim owner must first
 * validate and capture the complete row under its original lifetime, bind it to
 * its own descriptor/lease/manifest/IDs, and include this predicate in the full
 * source and destination proof. A row or this returned SQL never grants a
 * reserved successor or permission to dispatch. No database operation occurs. */
export function guestImageResultReservedAttemptProof(facts: GuestImageResultClaimFacts, row: GuestImageResultCopyAttemptRow): Proof {
  const captured = facts && typeof facts === "object" ? claimFactsCaptures.get(facts) : undefined;
  if (!captured || !captured.resultCopySchemaInstalled || !row || typeof row !== "object"
    || Object.getPrototypeOf(row) !== Object.prototype) return fail("claim_attempt_facts_unavailable");
  const descriptors = Object.getOwnPropertyDescriptors(row), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== reservedAttemptColumns.length || keys.some(key => typeof key !== "string"
    || !reservedAttemptColumns.some(column => column === key))) return fail("claim_attempt_row_invalid");
  const values: Value[] = [], observed: Record<string, Value> = {};
  for (const column of reservedAttemptColumns) {
    const descriptor = descriptors[column];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return fail("claim_attempt_row_invalid");
    const value: unknown = descriptor.value;
    if (value !== null && (typeof value === "string" ? !value.isWellFormed() || bytes(value) > 65536
      : typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0) || value < 0)) return fail("claim_attempt_row_invalid");
    observed[column] = value as Value; values.push(value as Value);
  }
  if (observed.session_id !== captured.scope.sessionId || observed.state !== "reserved" || observed.row_version !== 0
    || observed.put_outcome !== "pending" || observed.updated_at_ms !== observed.created_at_ms
    || ["put_started_at_ms", "put_settled_at_ms", "verified_at_ms", "published_at_ms", "published_claim_digest"].some(column => observed[column] !== null))
    return fail("claim_attempt_row_invalid");
  const scopeCte = `input(value) AS(VALUES(?)),s AS(SELECT ${Object.keys(captured.scope).map(key => `json_extract(value,'$.${key}') AS ${key}`).join(",")} FROM input)`;
  const exactRow = `json_array(${reservedAttemptColumns.map(column => `d.${column}`).join(",")})=expected.row_json`;
  const related = `d.session_id=s.sessionId OR (${resultClaimAssociationSql("attempt")})`;
  return freeze({ sql: `EXISTS(WITH ${scopeCte},expected_result_attempt(row_json) AS(VALUES(?))
    SELECT 1 FROM s,expected_result_attempt expected WHERE
      EXISTS(SELECT 1 FROM experience_guest_image_result_copy_attempts d WHERE d.session_id=s.sessionId AND ${exactRow})
      AND NOT EXISTS(SELECT 1 FROM experience_guest_image_result_copy_attempts d WHERE (${related}) AND (${exactRow}) IS NOT TRUE))`,
    bindings: [captured.scopeJson, JSON.stringify(values)] });
}

type SuccessorAttemptCapture = Readonly<{
  facts: ClaimFactsCapture; values: readonly Value[]; observed: Readonly<Record<string, Value>>;
}>;

/** Capture the closed tuple without reading accessors. This is deliberately
 * separate from reserved-v0 qualification and grants no transition authority. */
function captureSuccessorAttempt(facts: GuestImageResultClaimFacts, row: GuestImageResultCopyAttemptRow): SuccessorAttemptCapture {
  const captured = facts && typeof facts === "object" ? claimFactsCaptures.get(facts) : undefined;
  if (!captured || !captured.resultCopySchemaInstalled || !row || typeof row !== "object"
    || Object.getPrototypeOf(row) !== Object.prototype) return fail("claim_attempt_facts_unavailable");
  const descriptors = Object.getOwnPropertyDescriptors(row), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== reservedAttemptColumns.length || keys.some(key => typeof key !== "string"
    || !reservedAttemptColumns.some(column => column === key))) return fail("claim_attempt_row_invalid");
  const values: Value[] = [], observed: Record<string, Value> = {};
  for (const column of reservedAttemptColumns) {
    const descriptor = descriptors[column];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return fail("claim_attempt_row_invalid");
    const value: unknown = descriptor.value;
    if (value !== null && (typeof value === "string" ? !value.isWellFormed() || bytes(value) > 65536
      : typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0) || value < 0)) return fail("claim_attempt_row_invalid");
    observed[column] = value as Value; values.push(value as Value);
  }
  const created = observed.created_at_ms, updated = observed.updated_at_ms, expires = observed.source_expires_at_ms;
  const started = observed.put_started_at_ms, settled = observed.put_settled_at_ms, verified = observed.verified_at_ms;
  const outcome = observed.put_outcome, settledOutcome = outcome === "success" || outcome === "conditional-null";
  if (observed.session_id !== captured.scope.sessionId || typeof observed.row_version !== "number" || observed.row_version < 1
    || typeof created !== "number" || created < 1 || typeof updated !== "number" || updated < created
    || typeof expires !== "number" || expires <= created
    || !["pending", "unknown", "success", "conditional-null"].includes(String(outcome))
    || observed.published_at_ms !== null || observed.published_claim_digest !== null) return fail("claim_attempt_row_invalid");
  if (started === null ? outcome !== "pending" || settled !== null || verified !== null
    : typeof started !== "number" || started < created || started > updated || started >= expires) return fail("claim_attempt_row_invalid");
  if (settledOutcome !== (settled !== null)
    || settled !== null && (typeof settled !== "number" || typeof started !== "number" || settled < started || settled > updated)
    || verified !== null && (typeof verified !== "number" || outcome !== "success" || typeof settled !== "number"
      || verified < settled || verified > updated || verified >= expires)) return fail("claim_attempt_row_invalid");
  return { facts: captured, values, observed };
}

function successorAttemptProof(captured: SuccessorAttemptCapture): Proof {
  const { facts, values } = captured;
  const scopeCte = `input(value) AS(VALUES(?)),s AS(SELECT ${Object.keys(facts.scope).map(key => `json_extract(value,'$.${key}') AS ${key}`).join(",")} FROM input)`;
  const exactRow = `json_array(${reservedAttemptColumns.map(column => `d.${column}`).join(",")})=expected.row_json`;
  const related = `d.session_id=s.sessionId OR (${resultClaimAssociationSql("attempt")})`;
  return freeze({ sql: `EXISTS(WITH ${scopeCte},expected_result_attempt(row_json) AS(VALUES(?))
    SELECT 1 FROM s,expected_result_attempt expected WHERE
      EXISTS(SELECT 1 FROM experience_guest_image_result_copy_attempts d WHERE d.session_id=s.sessionId AND ${exactRow})
      AND NOT EXISTS(SELECT 1 FROM experience_guest_image_result_copy_attempts d WHERE (${related}) AND (${exactRow}) IS NOT TRUE))`,
    bindings: [facts.scopeJson, JSON.stringify(values)] });
}

/** Inert exact writing-row fact. The claim owner still supplies complete
 * descriptor validation, original lease/currentness and actual PUT knowledge. */
export function guestImageResultWritingAttemptProof(facts: GuestImageResultClaimFacts, row: GuestImageResultCopyAttemptRow): Proof {
  const captured = captureSuccessorAttempt(facts, row), { observed } = captured;
  if (observed.state !== "writing" || observed.put_started_at_ms === null || observed.verified_at_ms !== null)
    return fail("claim_attempt_row_invalid");
  return successorAttemptProof(captured);
}

/** A ready tuple describes recorded success and separate verification, never
 * a fresh byte observation, completed custody or permission to publish. */
export function guestImageResultReadyAttemptProof(facts: GuestImageResultClaimFacts, row: GuestImageResultCopyAttemptRow): Proof {
  const captured = captureSuccessorAttempt(facts, row), { observed } = captured;
  if (observed.state !== "ready" || observed.put_outcome !== "success" || observed.verified_at_ms === null)
    return fail("claim_attempt_row_invalid");
  return successorAttemptProof(captured);
}

/** Closed cleanup-only facts. Neither matching metadata nor this tuple may
 * settle an unknown PUT, authorize DELETE or reverse the publication fence. */
export function guestImageResultCleanupAttemptProof(facts: GuestImageResultClaimFacts, row: GuestImageResultCopyAttemptRow): Proof {
  const captured = captureSuccessorAttempt(facts, row), { observed } = captured;
  if (observed.state !== "cleanup_pending" && observed.state !== "deleted"
    || observed.state === "deleted" && (observed.put_outcome === "unknown"
      || observed.put_started_at_ms !== null && observed.put_outcome !== "success" && observed.put_outcome !== "conditional-null"))
    return fail("claim_attempt_row_invalid");
  return successorAttemptProof(captured);
}

/** Admission observation only. Optional absent families remain supported for
 * ordinary inventory, but an atomic publication requires every captured family. */
export function guestImageResultClaimPublicationAvailable(facts: GuestImageResultClaimFacts): void {
  const captured = facts && typeof facts === "object" ? claimFactsCaptures.get(facts) : undefined;
  if (!captured?.publicationSchemaInstalled || !publishedFactsCaptures.has(facts)) return fail("claim_publication_schema_unavailable");
}

// These are closed native rows, including lineage strings larger than the
// compiler's ordinary JSON-string bound. Inspect descriptors before property
// reads, including Array prototypes; this helper neither parses authority nor
// calls caller-supplied serialization/accessor methods.
function publishedGraphData(value: unknown): void {
  const seen = new Set<object>(); let nodes = 0, totalBytes = 0;
  function visit(item: unknown, depth: number): void {
    if (++nodes > 32768 || depth > 6) return fail("published_graph_invalid");
    if (item === null) return;
    if (typeof item === "string") {
      const length = bytes(item); totalBytes += length;
      if (!item.isWellFormed() || item.includes("\0") || length > 262144 || totalBytes > 4194304) return fail("published_graph_invalid");
      return;
    }
    if (typeof item === "number") {
      if (!Number.isSafeInteger(item) || Object.is(item, -0) || item < 0) return fail("published_graph_invalid");
      return;
    }
    if (!item || typeof item !== "object" || seen.has(item)
      || Object.getPrototypeOf(item) !== (Array.isArray(item) ? Array.prototype : Object.prototype)) return fail("published_graph_invalid");
    seen.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== "string")) return fail("published_graph_invalid");
    const array = Array.isArray(item), length = array ? descriptors.length?.value : undefined;
    if (array && (!Number.isSafeInteger(length) || length < 0 || length > 102 || keys.length !== length + 1)) return fail("published_graph_invalid");
    for (const key of keys as string[]) {
      if (array && key === "length") continue;
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value") || ["__proto__", "constructor", "prototype"].includes(key)
        || array && (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= length)) return fail("published_graph_invalid");
      visit(descriptor.value, depth + 1);
    }
  }
  visit(value, 0);
}

function publishedRow(value: unknown, columns: readonly string[]): Row {
  if (!record(value) || !exactKeys(value, columns) || !flatRow(value, columns)) return fail("published_graph_row_invalid");
  return Object.fromEntries(columns.map(column => [column, value[column] as Value]));
}

/** Fixed producer-owned after-state. This does not acquire a lease, validate a
 * ready capability, observe bytes, authorize SQL dispatch or recover a claim.
 * The claim owner must bind every input row to its private candidate first.
 * Each allowed row is both a full-tuple closure exception and a required fact;
 * all other aliases, malformed records and NULL-sensitive guards stay intact. */
export function guestImageResultPublishedGraphProofs(facts: GuestImageResultClaimFacts,
  input: GuestImageResultPublishedGraph): readonly Proof[] {
  guestImageResultClaimPublicationAvailable(facts);
  const captured = claimFactsCaptures.get(facts)!, source = publishedFactsCaptures.get(facts)!;
  publishedGraphData(input);
  if (!record(input) || !exactKeys(input, ["version", "revokedAtMs", "contextMapping", "saveMapping", "stageMapping", "resultMapping",
    "stageCopies", "resultCopies", "eventEnvelopes", "eventClientReceipts", "saveCommand", "privateContents", "publishedAttempt"])
    || input.version !== 1 || !nonnegative(input.revokedAtMs) || input.revokedAtMs < 1 || input.revokedAtMs > 8_000_000_000_000) return fail("published_graph_invalid");
  const context = publishedRow(input.contextMapping, publishedContextColumns), save = publishedRow(input.saveMapping, publishedSaveColumns);
  const stage = publishedRow(input.stageMapping, publishedStageColumns), result = publishedRow(input.resultMapping, publishedResultColumns);
  const attempt = publishedRow(input.publishedAttempt, reservedAttemptColumns), command = publishedRow(input.saveCommand, commandColumns);
  if (!Array.isArray(input.stageCopies) || input.stageCopies.length !== 3 || !Array.isArray(input.resultCopies) || input.resultCopies.length !== 2
    || !Array.isArray(input.privateContents) || input.privateContents.length !== 5
    || !Array.isArray(input.eventEnvelopes) || input.eventEnvelopes.length !== source.sourceHead + 2
    || !Array.isArray(input.eventClientReceipts) || input.eventClientReceipts.length !== source.sourceHead) return fail("published_graph_invalid");
  const stageCopies = input.stageCopies.map(row => publishedRow(row, publishedStageCopyColumns));
  const resultCopies = input.resultCopies.map(row => publishedRow(row, publishedResultCopyColumns));
  const contents = input.privateContents.map(row => publishedRow(row, contentColumns));
  const receipts = input.eventClientReceipts.map(row => publishedRow(row, publishedReceiptColumns));
  const envelopeColumns = ["private_event_id", ...bodyColumns];
  const pairs = input.eventEnvelopes.map(pair => {
    if (!record(pair) || !exactKeys(pair, ["event", "envelope"])) return fail("published_graph_invalid");
    return { event: publishedRow(pair.event, eventColumns), envelope: publishedRow(pair.envelope, envelopeColumns) };
  });
  const t = input.revokedAtMs, at = new Date(t).toISOString(), destination = result.destination_user_id;
  if (typeof destination !== "string" || !destination || destination.startsWith("guest:") || destination === captured.scope.guest
    || [context, save, stage, result].some(row => row.session_id !== captured.scope.sessionId || row.destination_user_id !== destination
      || row.lease_id !== attempt.lease_id || row.request_id !== attempt.request_id || row.manifest_digest !== attempt.manifest_digest || row.created_at_ms !== t)
    || save.context_lineage_digest !== context.lineage_digest || stage.context_lineage_digest !== context.lineage_digest
    || stage.save_lineage_digest !== save.lineage_digest || result.context_lineage_digest !== context.lineage_digest
    || result.save_lineage_digest !== save.lineage_digest || result.stage_lineage_digest !== stage.lineage_digest
    || result.original_completion_event_id !== source.completionEventId || result.generation_id !== source.generationId || result.output_id !== source.outputId
    || result.custody_id !== attempt.custody_id || result.copy_attempt_id !== attempt.attempt_id
    || result.lease_acquisition !== attempt.lease_acquisition || attempt.session_id !== captured.scope.sessionId || attempt.destination_user_id !== destination
    || attempt.state !== "published" || attempt.put_outcome !== "success" || typeof attempt.row_version !== "number" || attempt.row_version < 1
    || attempt.published_at_ms !== t || attempt.updated_at_ms !== t || attempt.published_claim_digest !== result.lineage_digest)
    return fail("published_graph_identity_invalid");
  const times = [attempt.created_at_ms, attempt.put_started_at_ms, attempt.put_settled_at_ms, attempt.verified_at_ms, t];
  if (times.some((value, index) => typeof value !== "number" || value < 1 || index > 0 && value < Number(times[index - 1]))
    || typeof attempt.source_expires_at_ms !== "number" || t >= attempt.source_expires_at_ms) return fail("published_graph_time_invalid");
  let parsedLease: unknown;
  try { parsedLease = JSON.parse(String(attempt.lease_snapshot_json)); } catch { return fail("published_graph_lease_invalid"); }
  publishedGraphData(parsedLease);
  const lease = publishedRow(parsedLease, publishedLeaseColumns);
  if (publishedLeaseColumns.slice(0, 5).some(column => lease[column] !== attempt[column]) || lease.acquisitions !== attempt.lease_acquisition
    || typeof lease.created_at_ms !== "number" || lease.created_at_ms > Number(attempt.created_at_ms)
    || typeof lease.expires_at_ms !== "number" || t >= lease.expires_at_ms) return fail("published_graph_lease_invalid");
  const sourceIds = new Set(JSON.parse(String(captured.scope.generated)) as Value[]), eventIds = new Set<Value>(), bodyIds = new Set<Value>();
  const stream = `creative:${destination}`, firstSequence = pairs[0]!.event.sequence;
  if (typeof firstSequence !== "number" || firstSequence < 1) return fail("published_graph_event_invalid");
  for (const [index, pair] of pairs.entries()) {
    const event = pair.event, envelope = pair.envelope;
    if (typeof event.event_id !== "string" || !id(event.event_id) || sourceIds.has(event.event_id) || eventIds.has(event.event_id)
      || event.stream_id !== stream || event.actor !== (index < source.sourceHead ? "user" : `user:${destination}`) || event.sequence !== firstSequence + index
      || event.schema_version !== 1 || event.occurred_at !== at || event.recorded_at !== at
      || envelope.private_event_id !== event.event_id || envelope.owner_id !== destination
      || envelope.project_id !== captured.scope.project || envelope.document_id !== (index === 0 ? null : captured.scope.document)
      || envelope.created_at !== at || envelope.redacted_at !== null || typeof envelope.private_json !== "string"
      || typeof event.payload !== "string" || bytes(event.payload) > 65536 || bytes(envelope.private_json) > 131072)
      return fail("published_graph_event_invalid");
    eventIds.add(event.event_id);
    if (index < source.sourceHead) {
      const receipt = receipts[index]!;
      if (receipt.stream_id !== stream || receipt.event_id !== event.event_id || receipt.sequence !== event.sequence || receipt.created_at !== at
        || receipt.client_event_id !== `guest-context-adoption:v1:${captured.scope.sessionId}:${index}`) return fail("published_graph_receipt_invalid");
    }
  }
  const claimEvent = pairs.at(-1)!.event, saveEvent = pairs[source.sourceHead]!.event;
  if (claimEvent.event_id !== result.claim_event_id || claimEvent.sequence !== result.claim_event_sequence || claimEvent.type !== "GuestImageResultClaimed"
    || command.scope_key !== `personal:${destination}:${captured.scope.project}` || command.actor_user_id !== destination
    || command.action !== "save" || command.event_id !== saveEvent.event_id || command.created_at !== at)
    return fail("published_graph_event_invalid");
  for (const [index, copy] of [...stageCopies, ...resultCopies].entries()) {
    const body = contents[index]!, stageCopy = index < 3;
    if (stageCopy ? copy.session_id !== captured.scope.sessionId || copy.role !== ["confirmation", "quote", "construction"][index]
      : copy.custody_id !== result.custody_id || copy.role !== ["planner", "prompt"][index - 3]) return fail("published_graph_copy_invalid");
    if (typeof copy.content_id !== "string" || sourceIds.has(copy.content_id) || bodyIds.has(copy.content_id)
      || body.content_id !== copy.content_id || body.owner_id !== destination || body.kind !== (stageCopy ? "guest-image-stage-history" : "guest-image-result-history")
      || body.redacted_at !== null || typeof body.content !== "string" || bytes(body.content) !== copy.byte_length
      || body.created_at !== copy.created_at || body.expires_at !== copy.expires_at || !iso(copy.created_at) || !iso(copy.expires_at)
      || Date.parse(copy.created_at) < lease.created_at_ms || copy.created_at > at || copy.expires_at <= at) return fail("published_graph_copy_invalid");
    bodyIds.add(copy.content_id);
  }
  if (!iso(result.canonical_expires_at) || result.canonical_expires_at !== resultCopies.map(row => String(row.expires_at)).sort()[0])
    return fail("published_graph_time_invalid");
  const expected: Record<string, { columns: readonly string[]; rows: Row[] }> = {
    experience_guest_context_adoptions: { columns: publishedContextColumns, rows: [context] },
    experience_guest_image_claims: { columns: publishedSaveColumns, rows: [save] },
    experience_guest_image_stage_custodies: { columns: publishedStageColumns, rows: [stage] },
    experience_guest_image_stage_copies: { columns: publishedStageCopyColumns, rows: stageCopies },
    experience_guest_image_result_custodies: { columns: publishedResultColumns, rows: [result] },
    experience_guest_image_result_copies: { columns: publishedResultCopyColumns, rows: resultCopies },
    events: { columns: eventColumns, rows: pairs.map(pair => pair.event) },
    event_private_payloads: { columns: envelopeColumns, rows: pairs.map(pair => pair.envelope) },
    event_client_receipts: { columns: publishedReceiptColumns, rows: receipts },
    output_commands: { columns: commandColumns, rows: [command] }, private_content: { columns: contentColumns, rows: contents },
  };
  const expectedJson = JSON.stringify(Object.fromEntries(Object.entries(expected).map(([table, value]) =>
    [table, value.rows.map(row => value.columns.map(column => row[column]))])));
  const exactAllowed = (table: string) => `EXISTS(SELECT 1 FROM expected_graph,json_each(expected_graph.value,'$.${table}') expected_row WHERE json_array(${expected[table]!.columns.map(column => `d.${column}`).join(",")})=expected_row.value)`;
  const scopeCte = `input(value) AS(VALUES(?)),s AS(SELECT ${Object.keys(captured.scope).map(key => `json_extract(value,'$.${key}') AS ${key}`).join(",")} FROM input),expected_graph(value) AS(VALUES(?))`;
  const rows = captured.closureRows.map(([table, predicate]) => [table,
    Object.hasOwn(expected, table) ? `(${predicate}) AND (${exactAllowed(table)}) IS NOT TRUE` : predicate]);
  const groups = Array.from({ length: Math.ceil(rows.length / 4) }, (_, i) => rows.slice(i * 4, i * 4 + 4));
  const common: Proof = { sql: `NOT EXISTS(WITH ${scopeCte},
    ${groups.map((group, index) => `bad${index} AS MATERIALIZED(${group.map(([table, predicate]) => `SELECT 1 FROM ${table} d,s WHERE ${predicate}`).join(" UNION ALL ")} LIMIT 1)`).join(",")}
    SELECT 1 WHERE ${groups.map((_, index) => `EXISTS(SELECT 1 FROM bad${index})`).join(" OR ")})`, bindings: [captured.scopeJson, expectedJson] };
  const attemptRelated = `d.session_id=s.sessionId OR (${resultClaimAssociationSql("attempt")})`;
  const custodyRelated = `d.session_id=s.sessionId OR d.original_completion_event_id IN(SELECT value FROM json_each(s.ids))
    OR d.claim_event_id IN(SELECT value FROM json_each(s.ids)) OR d.generation_id IN(SELECT value FROM json_each(s.generated))
    OR d.output_id IN(SELECT value FROM json_each(s.generated)) OR (${resultClaimAssociationSql("custody")})
    OR d.copy_attempt_id IN(SELECT attempt_id FROM result_related_attempts)`;
  const family: Proof = { sql: `NOT EXISTS(WITH ${scopeCte},
    result_related_attempts AS MATERIALIZED(SELECT d.attempt_id,d.custody_id FROM experience_guest_image_result_copy_attempts d,s WHERE ${attemptRelated}),
    result_related_custodies AS MATERIALIZED(SELECT ${publishedResultColumns.map(column => `d.${column}`).join(",")} FROM experience_guest_image_result_custodies d,s WHERE ${custodyRelated})
    SELECT 1 FROM result_related_custodies d WHERE (${exactAllowed("experience_guest_image_result_custodies")}) IS NOT TRUE
    UNION ALL
    SELECT 1 FROM experience_guest_image_result_copies d,s WHERE
        (d.original_content_id IN(SELECT value FROM json_each(s.bodyIds)) OR d.content_id IN(SELECT value FROM json_each(s.bodyIds))
          OR d.custody_id IN(SELECT custody_id FROM result_related_attempts) OR d.custody_id IN(SELECT custody_id FROM result_related_custodies))
        AND (${exactAllowed("experience_guest_image_result_copies")}) IS NOT TRUE LIMIT 1)`, bindings: [captured.scopeJson, expectedJson] };
  const positive = Object.entries(expected).flatMap(([table, value]) => value.rows.map(row => exact(table, row)));
  return freeze([...structuredClone(source.immutable), guestImageHistorySessionProof({ session: { ...source.session } }, { revokedAtMs: t }),
    exact("experience_guest_claim_leases", lease), successorAttemptProof({ facts: captured, values: reservedAttemptColumns.map(column => attempt[column]!), observed: attempt }),
    common, family, ...positive,
    { sql: `(SELECT COUNT(*) FROM experience_guest_image_stage_copies WHERE session_id=?)=3
      AND (SELECT COUNT(*) FROM experience_guest_image_result_copies WHERE custody_id=?)=2
      AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
      AND NOT EXISTS(SELECT 1 FROM event_write_stage WHERE event_id IN(SELECT value FROM json_each(?)))
      AND ${GUEST_DB_NOW}>=? AND ${GUEST_DB_NOW}<? AND ${GUEST_DB_NOW}<?
      AND NOT EXISTS(SELECT 1 FROM json_each(?) expiration WHERE expiration.value<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      bindings: [captured.scope.sessionId!, result.custody_id!, stream, result.claim_event_sequence!, JSON.stringify([...eventIds]),
        t, attempt.source_expires_at_ms!, lease.expires_at_ms!, JSON.stringify(contents.map(row => row.expires_at))] }]);
}

function runClosure(r:RunCapture): Readonly<{ common: Proof; familyCommon: Proof; leaseAbsent: Proof; attemptAbsent: Proof; resultCopySchemaInstalled: boolean; claimSourceFacts: GuestImageResultClaimFacts }> {
  const c=r.admission,{frame:f,history:h,facts}=c,blueprint=c.blueprint!,admitted=true;
  const ids = [...h.original.eventIds, ...facts.tails.map(t => t.eventId), blueprint.queue.eventId,blueprint.authorization.eventId,...r.events.map(event=>event.eventId)];
  const scope = { ...facts.scope, blocks: JSON.stringify([...h.original.blockIds, h.saved.requirementId]), ids: JSON.stringify(ids), commands: JSON.stringify([h.saved.commandKey, String(facts.rows.command.command_key), String(facts.rows.preflightCommand!.command_key), f.commandKey,...(r.runCommand?[r.runKey]:[])]),
    resources: JSON.stringify([...facts.resources.map(r => r.resource_id), c.issuerResourceId]), issuer: c.issuerGrantId, admitted: admitted ? 1 : 0,
    grant: f.slot.grantId, slot: f.slot.slotId, job: f.slot.jobId, token: f.slot.tokenReservationId, cost: f.slot.costReservationId, consumption: c.compiled.envelope.consumptionId, bodyIds:JSON.stringify(r.rows.content.map(row=>row.content_id)), callKeys:JSON.stringify(r.rows.calls.map(row=>row.call_key)), callIds:JSON.stringify(r.rows.calls.map(row=>row.client_request_id)), storageKeys:JSON.stringify(r.rows.storage.map(row=>row.storage_key)), correlation:String(r.rows.job.correlation_id),
    generated:JSON.stringify([h.original.draftId,f.documentId,f.slot.jobId,...ids,...r.rows.content.map(body=>body.content_id),...r.rows.storage.map(storage=>storage.storage_key),
      ...r.rows.storage.map(storage=>`/api/media/${encodeURIComponent(String(storage.storage_key))}`),
      ...r.events.filter(event=>event.type==="GenerationCompleted").flatMap(event=>[event.payload.generation_id,event.payload.object_id,`generated-image/${Array.from(new TextEncoder().encode(String(event.payload.object_id)),byte=>byte.toString(16).padStart(2,"0")).join("")}`])]) };
  const allowed: Record<string, string> = {
    private_content:"d.owner_id=s.guest AND d.content_id IN(SELECT value FROM json_each(s.bodyIds))",
    output_provider_calls:"d.scope_key=s.scope AND d.slot_id=s.slot AND d.call_key IN(SELECT value FROM json_each(s.callKeys))",
    output_native_storage_writes:"d.scope_key=s.scope AND d.slot_id=s.slot AND d.storage_key IN(SELECT value FROM json_each(s.storageKeys))",
    output_commands: "d.scope_key=s.scope AND d.actor_user_id=s.guest AND d.command_key IN(SELECT value FROM json_each(s.commands))",
    output_plan_revisions: "d.scope_key=s.scope AND d.plan_revision_id=s.plan", output_plan_targets: "d.scope_key=s.scope AND d.plan_revision_id=s.plan AND d.target_id=s.target",
    output_preflights: "d.scope_key=s.scope AND d.preflight_id=s.quote", output_execution_grants: "s.admitted=1 AND d.scope_key=s.scope AND d.grant_id=s.grant",
    output_operation_slots: "s.admitted=1 AND d.scope_key=s.scope AND d.slot_id=s.slot", output_operation_routes: "s.admitted=1 AND d.scope_key=s.scope AND d.slot_id=s.slot",
    document_jobs: "s.admitted=1 AND d.job_id=s.job", budget_reservations: "s.admitted=1 AND d.reservation_id=s.token", cost_budget_reservations: "s.admitted=1 AND d.reservation_id=s.cost",
  };
  const rows = nativeBranches.map(([table, predicate]) => [table!, allowed[table!] ? `(${predicate}) AND (${allowed[table!]}) IS NOT TRUE` : predicate!]);
  // Custody edges come from native identity columns and qualified typed
  // reference records. Exact original public/private envelopes are proved
  // separately; an incidental copied ID/URL in unrelated prose is not a
  // custody edge. Do not enumerate arbitrary foreign retained content.
  rows.push(["project_resource_scopes","d.resource_id IN(SELECT value FROM json_each(s.generated)) OR d.source_event_id IN(SELECT value FROM json_each(s.ids)) OR d.actor_user_id=s.guest"]);
  rows.push(["private_content_retention_scopes","d.content_id IN(SELECT value FROM json_each(s.bodyIds)) OR d.actor_user_id=s.guest"]);
  // Legacy shared media requires both the owner namespace and matching R2
  // owner metadata. Owner/project/resource scope is authoritative here; a
  // foreign share's copied media-list string does not confer guest custody.
  rows.push(["share_scopes","d.resource_id IN(SELECT value FROM json_each(s.generated))"]);
  rows.push(["artifact_revisions","d.artifact_id IN(SELECT value FROM json_each(s.generated)) OR d.created_by_user_id=s.guest"]);
  rows.push(["output_assets","d.storage_key IN(SELECT value FROM json_each(s.storageKeys)) OR d.asset_id IN(SELECT value FROM json_each(s.generated)) OR d.created_event_id IN(SELECT value FROM json_each(s.ids))"]);
  rows.push(["output_asset_storage_writes","d.storage_key IN(SELECT value FROM json_each(s.storageKeys)) OR d.publication_event_id IN(SELECT value FROM json_each(s.ids))"]);
  rows.push(["output_results","d.plan_revision_id=s.plan OR d.asset_id IN(SELECT value FROM json_each(s.generated)) OR d.bound_event_id IN(SELECT value FROM json_each(s.ids))"]);
  rows.push(["output_target_acceptances","d.approval_event_id IN(SELECT value FROM json_each(s.ids)) OR d.result_id IN(SELECT value FROM json_each(s.generated))"]);
  rows.push(["output_plan_fulfillments","d.plan_revision_id=s.plan OR d.eligibility_event_id IN(SELECT value FROM json_each(s.ids))"]);
  rows.push(["output_delivery_manifests","d.plan_revision_id=s.plan OR d.event_id IN(SELECT value FROM json_each(s.ids))"]);
  rows.push(["output_plan_targets","d.plan_revision_id=s.plan AND (d.scope_key=s.scope AND d.target_id=s.target) IS NOT TRUE"]);
  rows.push(["output_preflights","d.plan_revision_id=s.plan AND (d.scope_key=s.scope AND d.preflight_id=s.quote) IS NOT TRUE"]);
  rows.push(["event_private_payloads","d.private_event_id NOT IN(SELECT value FROM json_each(s.ids)) AND (d.project_id=s.project OR d.document_id=s.document)"]);
  rows.push(["project_budget_reservation_scopes","d.reservation_id IN(s.token,s.cost) OR d.actor_user_id=s.guest"]);
  rows.push(["pilot_cost_reservation_scopes","d.reservation_id=s.cost OR d.actor_user_id=s.guest"]);
  rows.push(["output_execution_grants", "d.grant_id=s.grant AND NOT(s.admitted=1 AND d.scope_key=s.scope AND d.grant_id=s.grant)"]);
  rows.push(["output_operation_slots", "(d.slot_id=s.slot OR d.grant_id=s.grant OR d.job_id=s.job OR d.token_reservation_id=s.token OR d.cost_reservation_id=s.cost) AND NOT(s.admitted=1 AND d.scope_key=s.scope AND d.slot_id=s.slot)"]);
  rows.push(["output_operation_routes", "d.slot_id=s.slot AND NOT(s.admitted=1 AND d.scope_key=s.scope AND d.slot_id=s.slot)"]);
  rows.push(["output_provider_calls","(d.slot_id=s.slot OR d.client_request_id IN(SELECT value FROM json_each(s.callIds))) AND NOT(d.scope_key=s.scope AND d.slot_id=s.slot AND d.call_key IN(SELECT value FROM json_each(s.callKeys)))"]);
  rows.push(["output_native_storage_writes","(d.slot_id=s.slot OR d.storage_key IN(SELECT value FROM json_each(s.storageKeys))) AND NOT(d.scope_key=s.scope AND d.slot_id=s.slot AND d.storage_key IN(SELECT value FROM json_each(s.storageKeys)))"]);
  rows.push(["events","(d.stream_id=s.stream OR d.correlation_id=s.correlation OR d.causation_id IN(SELECT value FROM json_each(s.ids)) OR d.compensates_event_id IN(SELECT value FROM json_each(s.ids))) AND d.event_id NOT IN(SELECT value FROM json_each(s.ids))"]);
  // Scene's retained job witness is a known cross-owner alias surface; its
  // operational generation counters themselves are not result custody.
  rows.push(["document_jobs",`d.scene_source_version_json IS NOT NULL AND CASE WHEN typeof(d.scene_source_version_json)='text'
    AND length(CAST(d.scene_source_version_json AS BLOB)) BETWEEN 1 AND 16384 THEN CASE WHEN json_valid(d.scene_source_version_json)
      THEN json_type(d.scene_source_version_json)<>'object' OR EXISTS(SELECT 1 FROM json_tree(d.scene_source_version_json) reference
        WHERE reference.type='text' AND (reference.value IN(SELECT value FROM json_each(s.generated))
          OR reference.key IN('ownerId','actorId') AND reference.value=s.guest OR reference.key='streamId' AND reference.value=s.stream
          OR reference.key='projectId' AND reference.value=s.project OR reference.key='scopeKey' AND reference.value=s.scope
          OR reference.key='slotId' AND reference.value=s.slot OR reference.key='grantId' AND reference.value=s.grant
          OR reference.key='planRevisionId' AND reference.value=s.plan OR reference.key='correlationId' AND reference.value=s.correlation))
      ELSE 1 END ELSE 1 END`]);
  const add = (table: string, predicate: string) => { if (h.sponsor.tables.has(table)||c.optionalTables.has(table)) rows.push([table, predicate]); };
  add("experience_sponsor_resource_receipts", "(d.actor_user_id=s.guest OR d.session_digest=s.session OR d.issued_grant_id=s.issuer) AND d.resource_id NOT IN(SELECT value FROM json_each(s.resources))");
  add("experience_sponsor_grants", "(d.actor_user_id=s.guest OR d.session_digest=s.session) AND d.grant_id<>s.issuer");
  add("experience_sponsor_consumptions", "(d.actor_user_id=s.guest OR d.session_digest=s.session OR d.grant_id=s.issuer OR d.job_id=s.job) AND NOT(s.admitted=1 AND d.consumption_id=s.consumption)");
  add("experience_sponsor_active_jobs", "(d.actor_user_id=s.guest OR d.consumption_id=s.consumption OR d.job_id=s.job OR EXISTS(SELECT 1 FROM experience_sponsor_consumptions used WHERE used.consumption_id=d.consumption_id AND (used.actor_user_id=s.guest OR used.session_digest=s.session))) AND NOT(s.admitted=1 AND d.actor_user_id=s.guest AND d.consumption_id=s.consumption AND d.job_id=s.job)");
  const relatedIssuance = `${unsupportedIdentityJson("d.driver_command_json")} OR ${unsupportedIdentityJson("d.envelope_json", ["documentId", "projectId", "ownerUserId", "actorUserId", "payerUserId", "sessionDigest"])} OR d.actor_user_id=s.guest OR EXISTS(SELECT 1 FROM experience_sponsor_grants issued WHERE issued.grant_id=d.grant_id AND (issued.actor_user_id=s.guest OR issued.session_digest=s.session))
    OR ${boundedIdentityValue("d.driver_command_json", "documentId")}=s.document OR ${boundedIdentityValue("d.envelope_json", "documentId")}=s.document
    OR ${boundedIdentityValue("d.envelope_json", "projectId")}=s.project OR ${boundedIdentityValue("d.envelope_json", "ownerUserId")}=s.guest
    OR ${boundedIdentityValue("d.envelope_json", "actorUserId")}=s.guest OR ${boundedIdentityValue("d.envelope_json", "payerUserId")}=s.guest
    OR ${boundedIdentityValue("d.envelope_json", "sessionDigest")}=s.session`;
  add("experience_sponsor_issuances", `(${relatedIssuance}) AND d.grant_id<>s.issuer`);
  add("experience_sponsor_driver_intents", `(${unsupportedIdentityJson("d.command_json")} OR d.actor_user_id=s.guest OR d.session_digest=s.session OR d.document_id=s.document OR ${boundedIdentityValue("d.command_json", "documentId")}=s.document) AND d.driver_id<>s.driver`);
  add("experience_sponsor_driver_stages", `(${unsupportedIdentityJson("d.command_json")} OR d.driver_id=s.driver OR EXISTS(SELECT 1 FROM experience_sponsor_driver_intents intent WHERE intent.driver_id=d.driver_id AND (intent.actor_user_id=s.guest OR intent.session_digest=s.session OR intent.document_id=s.document)) OR ${boundedIdentityValue("d.command_json", "documentId")}=s.document) AND NOT(d.driver_id=s.driver AND d.stage='preflight')`);
  add("experience_sponsor_intakes", "d.actor_user_id=s.guest OR d.session_digest=s.session OR d.draft_id=s.draft OR d.project_id=s.project OR d.document_id=s.document");
  add("experience_sponsor_read_attempts", "d.actor_user_id=s.guest OR d.job_id=s.job");
  add("experience_sponsor_intake_read_attempts", "d.actor_user_id=s.guest OR d.resource_key='draft:'||s.draft");
  for (const t of ["experience_guest_context_adoptions", "experience_guest_image_claims"]) add(t, `${unsupportedIdentityJson("d.lineage_json", ["sessionId", "guestSubject", "projectId", "documentId"])} OR d.session_id=s.sessionId OR ${boundedIdentityValue("d.lineage_json", "sessionId")}=s.sessionId OR ${boundedIdentityValue("d.lineage_json", "guestSubject")}=s.guest OR ${boundedIdentityValue("d.lineage_json", "documentId")}=s.document OR ${boundedIdentityValue("d.lineage_json", "projectId")}=s.project`);
  add("experience_guest_plan_custodies", "d.session_id=s.sessionId OR d.draft_id=s.draft OR d.content_id=s.draft");
  for (const t of h.memory.registries) rows.push([t, "d.user_event_id IN(SELECT value FROM json_each(s.ids)) OR d.answer_event_id IN(SELECT value FROM json_each(s.ids))"]);
  for(const entry of rows){const at=entry[1]!.lastIndexOf(" AND NOT(");
    if(at>=0&&entry[1]!.endsWith(")"))entry[1]=`${entry[1]!.slice(0,at)} AND (${entry[1]!.slice(at+9,-1)}) IS NOT TRUE`;}
  add("output_durable_jobs","d.job_id=s.job OR d.scope_key=s.scope OR d.slot_id=s.slot OR d.grant_id=s.grant OR d.actor_user_id=s.guest OR d.stream_id=s.stream OR d.document_id=s.document OR d.run_event_id IN(SELECT value FROM json_each(s.ids))");
  for(const table of ["budget_hold_dispositions","managed_video_reconciliations"])add(table,"d.job_id=s.job OR d.correlation_id=s.correlation OR d.token_reservation_id=s.token OR d.cost_reservation_id=s.cost");
  add("budget_hold_dispositions","d.event_id IN(SELECT value FROM json_each(s.ids))");
  add("selected_output_shares","d.owner_id=s.guest OR d.project_id=s.project OR d.job_id=s.job OR d.completion_event_id IN(SELECT value FROM json_each(s.ids))");
  add("experience_guest_image_stage_custodies","d.session_id=s.sessionId");add("experience_guest_image_stage_copies","d.session_id=s.sessionId");
  // Benchmark receipts are not guest result custody. Reject guest-linked principals
  // and any reuse of this result's financial reservation, even under another actor.
  const fixed:Record<string,string>={principal_id:"guest",payer_id:"guest",token_id:"token",cost_id:"cost",actor_user_id:"guest",owner_user_id:"guest",project_id:"project",document_id:"document",event_stream_id:"stream",stream_id:"stream",job_id:"job"};
  const memoryBodyReferences=new Set(["current_body_ref","body_ref","ledger_body_ref"]);
  for(const [table,columns] of Object.entries(memoryColumns)){
    const predicates=columns.flatMap(column=>fixed[column]?[`d.${column}=s.${fixed[column]}`]
      :memoryBodyReferences.has(column)||/(?:event_id|content_id|content_ref|resource_id)$/u.test(column)?[`d.${column} IN(SELECT value FROM json_each(s.generated))`]:[]);
    if(predicates.length)add(table,predicates.join(" OR "));
  }
  // These two retained Memory JSON formats preserve references after their
  // associated source/dependency rows may have been removed. Inspect only the
  // known native columns, at their native limits, including duplicate keys.
  add("memory_live_conversation_segments",`CASE WHEN typeof(d.members_json)='text' AND length(d.members_json)<=8192 THEN
    CASE WHEN json_valid(d.members_json) THEN json_type(d.members_json)<>'array' OR json_array_length(d.members_json) NOT BETWEEN 1 AND 8
      OR json_array_length(d.members_json)<>d.member_count OR EXISTS(SELECT 1 FROM json_each(d.members_json) member WHERE CASE WHEN member.type='object' THEN
        (SELECT COUNT(*) FROM json_each(member.value))<>3 OR (SELECT COUNT(DISTINCT key) FROM json_each(member.value))<>3
        OR EXISTS(SELECT 1 FROM json_each(member.value) field WHERE field.key NOT IN('eventId','sequence','turnId')
          OR CASE WHEN field.key='sequence' THEN field.type<>'integer' OR field.value<1 ELSE field.type<>'text' OR field.value IN(SELECT value FROM json_each(s.generated)) END)
        ELSE 1 END) ELSE 1 END ELSE 1 END`);
  add("memory_document_job_origin_retirement_progress",`CASE WHEN typeof(d.evidence_json)='text' AND length(CAST(d.evidence_json AS BLOB)) BETWEEN 1 AND 524288 THEN
    CASE WHEN json_valid(d.evidence_json) THEN json_type(d.evidence_json)<>'object'
      OR (SELECT COUNT(*) FROM json_each(d.evidence_json))<>6 OR (SELECT COUNT(DISTINCT key) FROM json_each(d.evidence_json))<>6
      OR EXISTS(SELECT 1 FROM json_each(d.evidence_json) field WHERE field.key NOT IN('header','header_sha256','selectors','ledgerHead','derived','custody'))
      OR json_type(d.evidence_json,'$.header') IS NOT 'object' OR json_type(d.evidence_json,'$.header_sha256') IS NOT 'text'
      OR json_type(d.evidence_json,'$.selectors') IS NOT 'array' OR json_array_length(d.evidence_json,'$.selectors') NOT BETWEEN 1 AND 513
      OR json_array_length(d.evidence_json,'$.selectors')<>d.selector_count
      OR json_type(d.evidence_json,'$.ledgerHead') NOT IN('null','object') OR json_type(d.evidence_json,'$.derived') IS NOT 'array'
      OR json_array_length(d.evidence_json,'$.derived')<>2 OR json_type(d.evidence_json,'$.custody') IS NOT 'array'
      OR json_array_length(d.evidence_json,'$.custody') NOT BETWEEN 1 AND 517
      OR EXISTS(SELECT 1 FROM json_tree(d.evidence_json) reference WHERE reference.type='text'
        AND (reference.value IN(SELECT value FROM json_each(s.generated))
          OR reference.key IN('actor_user_id','owner_user_id','owner_id') AND reference.value=s.guest
          OR reference.key='project_id' AND reference.value=s.project
          OR reference.key IN('event_stream_id','stream_id') AND reference.value=s.stream))
      ELSE 1 END ELSE 1 END`);
  const groups = Array.from({ length: Math.ceil(rows.length / 4) }, (_, i) => rows.slice(i * 4, i * 4 + 4));
  const common: Proof = { sql: `NOT EXISTS(WITH input(value) AS(VALUES(?)),s AS(SELECT ${Object.keys(scope).map(k => `json_extract(value,'$.${k}') AS ${k}`).join(",")} FROM input),
    ${groups.map((g, i) => `bad${i} AS MATERIALIZED(${g.map(([t, p]) => `SELECT 1 FROM ${t} d,s WHERE ${p}`).join(" UNION ALL ")} LIMIT 1)`).join(",")}
    SELECT 1 WHERE ${groups.map((_, i) => `EXISTS(SELECT 1 FROM bad${i})`).join(" OR ")})`, bindings: [JSON.stringify(scope)] };
  const leaseAbsent: Proof = { sql: "NOT EXISTS(SELECT 1 FROM experience_guest_claim_leases WHERE session_id=?)", bindings: [facts.sessionId] };
  // The exact family is all-or-none at qualification; this flag is observed
  // producer data, not a caller-selected phase or permission to install tables.
  const resultCopySchemaInstalled = c.optionalTables.has("experience_guest_image_result_copy_attempts");
  const capturedScope = freeze(structuredClone(scope));
  const claimSourceFacts = Object.freeze({}) as GuestImageResultClaimFacts;
  const publicationSchemaInstalled = resultCopySchemaInstalled
    && ["experience_guest_context_adoptions", "experience_guest_image_claims"].every(table => h.sponsor.tables.has(table))
    && ["experience_guest_image_stage_custodies", "experience_guest_image_stage_copies", "experience_guest_image_result_custodies", "experience_guest_image_result_copies"].every(table => c.optionalTables.has(table));
  claimFactsCaptures.set(claimSourceFacts, freeze({ scope: capturedScope, scopeJson: JSON.stringify(capturedScope), resultCopySchemaInstalled,
    publicationSchemaInstalled, closureRows: rows.map(([table, predicate]) => [table!, predicate!] as [string, string]) }));
  if (!resultCopySchemaInstalled) return freeze({ common, leaseAbsent, resultCopySchemaInstalled, claimSourceFacts,
    familyCommon: { sql: "1", bindings: [] }, attemptAbsent: { sql: "1", bindings: [] } });
  const scopeCte = `input(value) AS(VALUES(?)),s AS(SELECT ${Object.keys(scope).map(k => `json_extract(value,'$.${k}') AS ${k}`).join(",")} FROM input)`;
  const attemptRelated = `d.session_id=s.sessionId OR (${resultClaimAssociationSql("attempt")})`;
  const custodyRelated = `d.session_id=s.sessionId OR d.original_completion_event_id IN(SELECT value FROM json_each(s.ids))
    OR d.claim_event_id IN(SELECT value FROM json_each(s.ids)) OR d.generation_id IN(SELECT value FROM json_each(s.generated))
    OR d.output_id IN(SELECT value FROM json_each(s.generated)) OR (${resultClaimAssociationSql("custody")})
    OR d.copy_attempt_id IN(SELECT attempt_id FROM result_related_attempts)`;
  // Related attempts are only an identity relation here. Their presence alone
  // does not fail common currentness; only a custody/copy edge does. This keeps
  // reserve from invalidating its own common proof.
  const familyCommon: Proof = { sql: `NOT EXISTS(WITH ${scopeCte},
    result_related_attempts AS MATERIALIZED(SELECT d.attempt_id,d.custody_id FROM experience_guest_image_result_copy_attempts d,s WHERE ${attemptRelated}),
    result_related_custodies AS MATERIALIZED(SELECT d.custody_id FROM experience_guest_image_result_custodies d,s WHERE ${custodyRelated})
    SELECT 1 WHERE EXISTS(SELECT 1 FROM result_related_custodies)
      OR EXISTS(SELECT 1 FROM experience_guest_image_result_copies d,s WHERE
        d.original_content_id IN(SELECT value FROM json_each(s.bodyIds)) OR d.content_id IN(SELECT value FROM json_each(s.bodyIds))
        OR d.custody_id IN(SELECT custody_id FROM result_related_attempts) OR d.custody_id IN(SELECT custody_id FROM result_related_custodies)))`,
    bindings: [JSON.stringify(scope)] };
  const attemptAbsent: Proof = { sql: `NOT EXISTS(WITH ${scopeCte}
    SELECT 1 FROM experience_guest_image_result_copy_attempts d,s WHERE ${attemptRelated})`, bindings: [JSON.stringify(scope)] };
  return freeze({ common, familyCommon, leaseAbsent, attemptAbsent, resultCopySchemaInstalled, claimSourceFacts });
}


async function validateRunEvents(r:RunCapture){
  const c=r.admission,f=c.frame,s=f.slot,job=r.rows.job,events=r.events.slice(1),settings=r.settings;
  if(!r.runEvent){if(r.events.length||events.length)return fail("run_event_without_command");return;}
  if(!events.length)return;
  if(job.attempt_count!==1)return fail("run_events_without_claim");
  const transport=c.facts.transport;
  if(!record(transport)||!record(transport.image)||transport.image.adapterId!=="openai-image"||transport.image.adapterVersion!=="v5")return fail("adapter_history_unsupported");
  const reason=events[1]?.payload.selection_reason;
  if(reason!=="configured OpenAI image adapter"&&reason!=="Fal is not configured")return fail("adapter_reason_unsupported");
  const planner=settings.calls[0]!,image=settings.calls[1]!,selection={providerName:"openai",model:image.model,adapterId:transport.image.adapterId,adapterVersion:transport.image.adapterVersion,reason,capabilities:["image-generation","image-editing","private-asset-output","context-snapshot","quality-levels","reference-pixel-input","multiple-image-input","custom-image-size","block-level-image-format","streaming-previews"]};
  if(selection.providerName!=="openai"||selection.model!==s.model)return fail("run_image_route_changed");
  const registryPayloads:Array<[string,Record<string,unknown>]>=[
    ["ModelRegistered",{model_id:image.model,planner_model_id:planner.model,provider:"openai",status:"human-gated"}],
    ["AdapterVersioned",{adapter_id:selection.adapterId,version:selection.adapterVersion,contract_version:7,selection_reason:selection.reason,reference_handoff:selection.capabilities.includes("reference-pixel-input"),multiple_image_input:selection.capabilities.includes("multiple-image-input"),block_level_reference_policy:true,block_level_image_format:true,streaming_previews:selection.capabilities.includes("streaming-previews")}],
    ["CapabilityDeclared",{model_id:image.model,capabilities:selection.capabilities}],
  ];
  let offset=0;
  for(const [type,payload] of registryPayloads){const event=events[offset];
    // The retained guest source protocol contains no registry events. The first
    // native Image batch therefore records this complete trio exactly once.
    if(event?.type!==type||event.actor!=="worker:registry"||event.causationId!==null)return fail("run_registry_changed");equal(event.payload,payload);offset++;}
  const [requested,compiled,budget,...terminal]=events.slice(offset);
  if(!requested||!compiled||!budget||requested.type!=="GenerationRequested"||compiled.type!=="ContextCompiled"||budget.type!=="BudgetReserved"
    ||requested.actor!==f.actorUserId||compiled.actor!=="worker:compiler"||budget.actor!=="worker:policy"||requested.causationId!==null||compiled.causationId!==requested.eventId||budget.causationId!==requested.eventId)return fail("run_generation_sequence");
  const generation=requested.payload.generation_id;if(!id(generation))return fail("run_generation_identity");
  for(const event of events)if(event.clientId!=="server:guest-output"||event.correlationId!==job.correlation_id||Date.parse(event.recordedAt)<Date.parse(String(job.started_at)))return fail("run_generation_identity");
  const common={generation_id:generation,document_id:f.documentId,canvas_id:null,context_set_id:null,quality:"high",purpose:"final",
    ...imageFormatEventFields(f.render.format,"full",null),provider_render_size:f.render.size,size:f.render.size,source_surface:"outputs",promotion_id:null,reference_preview_event_id:null,
    prompt_technique:normalizePromptTechnique(settings.payload.promptTechnique),prompt_fan_id:null,reference_input_count:0,reference_inputs:[],used_ideation_preview_pixels:false,used_uploaded_reference_pixels:false};
  equal(requested.payload,{...common,stream_id:f.streamId,model_ids:[planner.model,image.model],document_version:f.quoteHead+3,requested_output:"image",
    preflight_id:c.blueprint!.payload.preflightId,preflight_version:c.blueprint!.payload.preflightVersion,preflight_risk_acknowledged:c.blueprint!.payload.preflightAcknowledged});
  const snapshot={...f.context.snapshot,document:{id:f.documentId,title:f.context.projection.documentTitle},standing_constraints:[],reference_inputs:[]};
  // Match the native Image core's existing stable serializer, including its
  // historical object terminator. This is receipt reconstruction, not a new hash.
  const stable=(v:unknown):string=>Array.isArray(v)?`[${v.map(stable).join(",")}]`:v&&typeof v==="object"?`{${Object.entries(v).sort(([a],[b])=>a.localeCompare(b,"en-US")).map(([k,item])=>`${JSON.stringify(k)}:${stable(item)}`).join(",")}}`:JSON.stringify(v);
  const hash=await c.life.wait(async()=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(stable(snapshot)))),byte=>byte.toString(16).padStart(2,"0")).join(""));
  equal(compiled.payload,{...common,project_id:f.projectId,model_id:image.model,planner_model_id:planner.model,provider:"openai",adapter_version:`${selection.adapterId}-${selection.adapterVersion}`,adapter_selection_reason:selection.reason,compiled_snapshot:snapshot,context_hash:hash,source_block_versions:f.context.sourceBlockVersions});
  equal(budget.payload,{generation_id:generation,reservation_id:s.tokenReservationId,cost_reservation_id:s.costReservationId,reserved_tokens:s.maximumTokens,reserved_microusd:s.maximumMicrousd,period:f.period,operation:"image-generation"});
  if(terminal.length>2)return fail("run_terminal_extra");
  const done=terminal[0],usage=terminal[1];if(!done)return;
  if(done.actor!=="worker:generator"||done.causationId!==compiled.eventId||done.payload.generation_id!==generation||done.payload.document_id!==f.documentId
    ||done.payload.model_id!==image.model||done.payload.planner_model_id!==planner.model||done.payload.quality!=="high"||done.payload.purpose!=="final"||done.payload.source_surface!=="outputs"
    ||!["GenerationCompleted","GenerationFailed"].includes(done.type))return fail("run_terminal_changed");
  if(done.type==="GenerationFailed"){if(usage)return fail("run_terminal_extra");if(done.payload.prompt_ref!=null&&!r.rows.content.some(row=>row.kind==="prompt"&&row.content_id===done.payload.prompt_ref))return fail("run_failure_prompt_changed");return;}
  if(!usage||usage.type!=="GenerationUsageRecorded"||usage.actor!=="worker:policy"||usage.causationId!==done.eventId||usage.payload.generation_id!==generation||usage.payload.document_id!==f.documentId
    ||usage.payload.reservation_id!==s.tokenReservationId||usage.payload.cost_reservation_id!==s.costReservationId||usage.payload.reserved_tokens!==s.maximumTokens||usage.payload.reserved_microusd!==s.maximumMicrousd
    ||usage.payload.operation!=="image-generation"||usage.payload.total_tokens!==r.rows.token.used_tokens||usage.payload.cost_microusd!==r.rows.cost.used_microusd)return fail("run_usage_changed");
  equal(usage.payload.model_ids,[planner.model,image.model]);
  const p=done.payload,stored=r.rows.storage[0],output=r.rows.content.find(row=>row.kind==="provider-output"),prompt=r.rows.content.find(row=>row.kind==="prompt");
  if(p.provider!=="openai"||p.simulation!==false||p.object_id!==`object-${generation.slice(-8)}`||p.context_hash!==hash||p.planning_source!=="provider"||p.planning_cache_hit!==false
    ||p.reference_input_count!==0||p.used_ideation_preview_pixels!==false||p.used_uploaded_reference_pixels!==false||p.media_type!=="image/png"||!stored||stored.status!=="written"||stored.write_acknowledged!==1
    ||stored.publication_event_id!==done.eventId||p.media_url!==`/api/media/${encodeURIComponent(String(stored.storage_key))}`||p.source_content_hash!==stored.content_sha256
    ||p.output_ref!==output?.content_id||p.prompt_ref!==prompt?.content_id||p.content_expires_at!==output?.expires_at||r.rows.content.length!==2
    ||p.image_width!==Number(f.render.size.split("x")[0])||p.image_height!==Number(f.render.size.split("x")[1]))return fail("run_completion_changed");
  equal(p.object_ids,[p.object_id]);equal(p.reference_inputs,[]);
  const planned=json(output!.content);
  if(p.title!==String(planned.title??f.context.projection.documentTitle).trim())return fail("run_completion_title_changed");
  const planCall=r.rows.calls.find(row=>row.stage_key===planner.stage),imageCall=r.rows.calls.find(row=>row.stage_key===image.stage);
  const format={...imageFormatEventFields(f.render.format,"full",null),provider_render_size:f.render.size,size:f.render.size};
  const timing=[p.latency_ms,p.planning_latency_ms,p.image_latency_ms];
  if(!timing.every(nonnegative)||p.latency_ms!==Number(p.planning_latency_ms)+Number(p.image_latency_ms)
    ||p.provider_created_at!==null&&!nonnegative(p.provider_created_at))return fail("completion_timing_invalid");
  equal(p,{generation_id:generation,document_id:f.documentId,canvas_id:null,context_set_id:null,model_id:image.model,planner_model_id:planner.model,
    provider:"openai",provider_request_id:imageCall?.provider_response_id,provider_submission_id:imageCall?.client_request_id,planner_response_id:planCall?.provider_response_id,
    provider_created_at:p.provider_created_at,object_id:`object-${generation.slice(-8)}`,object_ids:[`object-${generation.slice(-8)}`],
    title:String(planned.title??f.context.projection.documentTitle).trim(),output_ref:output!.content_id,prompt_ref:prompt!.content_id,
    prompt_technique:normalizePromptTechnique(settings.payload.promptTechnique),prompt_fan_id:null,content_expires_at:output!.expires_at,
    media_url:`/api/media/${encodeURIComponent(String(stored.storage_key))}`,media_type:"image/png",source_content_hash:stored.content_sha256,
    image_width:Number(f.render.size.split("x")[0]),image_height:Number(f.render.size.split("x")[1]),quality:"high",purpose:"final",...format,
    source_surface:"outputs",promotion_id:null,reference_preview_event_id:null,promoted_from_generation_id:null,promoted_from_object_id:null,promotion_outcome:null,
    context_hash:hash,planning_source:"provider",planning_cache_hit:false,reference_input_count:0,reference_inputs:[],used_ideation_preview_pixels:false,used_uploaded_reference_pixels:false,
    latency_ms:p.latency_ms,planning_latency_ms:p.planning_latency_ms,image_latency_ms:p.image_latency_ms,adapter_version:"openai-image-v5",simulation:false});
  const u=usage.payload,breakdown=u.cost_breakdown_microusd,submissions=json(job.result_json).providerSubmissions;
  if(!record(submissions)||!planCall||!imageCall)return fail("usage_receipts_missing");
  const planning=submissions[String(planCall.client_request_id)],imaging=submissions[String(imageCall.client_request_id)];
  if(!record(planning)||!record(imaging)||!record(breakdown)||!exactKeys(breakdown,["text_input_microusd","text_output_microusd","image_text_input_microusd","image_input_microusd","image_output_microusd"])
    ||!Object.values(breakdown).every(nonnegative)||Object.values(breakdown).reduce<number>((sum,value)=>sum+Number(value),0)!==u.cost_microusd
    ||typeof u.pricing_version!=="string"||!u.pricing_version||u.cost_precision!=="provider-receipt-or-published-rate"||u.image_cost_precision!=="provider-token-receipt"
    ||![u.image_text_input_tokens,u.image_input_tokens].every(nonnegative))return fail("usage_breakdown_invalid");
  equal(u,{generation_id:generation,document_id:f.documentId,reservation_id:s.tokenReservationId,cost_reservation_id:s.costReservationId,
    input_tokens:Number(planning.inputTokens)+Number(imaging.inputTokens),output_tokens:Number(planning.outputTokens)+Number(imaging.outputTokens),
    total_tokens:r.rows.token.used_tokens,planner_tokens:planning.totalTokens,image_tokens:imaging.totalTokens,planner_input_tokens:planning.inputTokens,planner_output_tokens:planning.outputTokens,
    image_text_input_tokens:u.image_text_input_tokens,image_input_tokens:u.image_input_tokens,image_output_tokens:imaging.outputTokens,
    reserved_tokens:s.maximumTokens,reserved_microusd:s.maximumMicrousd,model_ids:[planner.model,image.model],operation:"image-generation",quality:"high",promotion_id:null,
    image_cost_precision:"provider-token-receipt",pricing_version:u.pricing_version,cost_microusd:r.rows.cost.used_microusd,cost_breakdown_microusd:breakdown,cost_precision:"provider-receipt-or-published-rate"});
  const result=json(job.result_json);
  if(!exactKeys(result,["artifactKind","generationReceipt","stage","progressMessage","reservationId","costReservationId","costReservationPeriod","costReservationMicrousd","outputExecution","providerSubmissionProtocol",
    "providerSubmissions","plannerModel","plannerResponseId","plannerResponseIds","plannerUsage","head","appendedEventIds","previewed","previewQueued","previewSuppressed","promoted"])
    ||result.artifactKind!==c.blueprint!.initialResult.artifactKind)return fail("completed_checkpoint_shape");
  equal(result.generationReceipt,{...(c.blueprint!.initialResult.generationReceipt as Record<string,unknown>),provider:"openai",model:image.model,
    actual_provider_call_count:2,settled_cost_microusd:r.rows.cost.used_microusd,reservation_status:r.rows.cost.status,source_transmission_status:"transmitted",provider_request_status:"completed"});
  if(result.stage!=="completed"||result.progressMessage!=="The operation finished."||result.plannerModel!==planner.model
    ||result.plannerResponseId!==String(planCall.provider_response_id??""))return fail("completed_checkpoint_invalid");
  equal(result.plannerResponseIds,planCall.provider_response_id?[planCall.provider_response_id]:[]);
  equal(result.plannerUsage,{inputTokens:planning.inputTokens,outputTokens:planning.outputTokens,totalTokens:planning.totalTokens});
  if(r.rows.calls.length!==2||!planCall||!imageCall||planCall.status!=="settled"||imageCall.status!=="settled"||p.planner_response_id!==planCall.provider_response_id||p.provider_request_id!==imageCall.provider_response_id||p.provider_submission_id!==imageCall.client_request_id)return fail("run_completion_call_changed");
}

function validateRunRows(r:RunCapture){
  const c=r.admission,f=c.frame,s=f.slot,b=c.blueprint!,{job,grant,slot,token,cost,calls,storage,content,active,consumption}=r.rows;
  const claimed=job.attempt_count===1,terminal=["completed","failed","canceled"].includes(String(job.status)),correlation=claimed?`${s.jobId}:attempt:1`:s.jobId;
  if(job.attempt_count!==0&&job.attempt_count!==1||!r.runEvent&&claimed||job.correlation_id!==correlation)return fail("run_job_attempt_changed");
  equal(Object.fromEntries(["job_id","owner_id","stream_id","document_id","kind","source_surface","requested_sequence","request_json","scene_source_version_json","scene_source_protocol","requested_at","expires_at"].map(key=>[key,job[key]])),
    {job_id:s.jobId,owner_id:f.ownerUserId,stream_id:f.streamId,document_id:f.documentId,kind:"generate",source_surface:"outputs",requested_sequence:f.quoteHead+1,request_json:JSON.stringify(b.payload),scene_source_version_json:null,scene_source_protocol:0,requested_at:f.createdAt,expires_at:f.expiresAt});
  for(const value of [job.updated_at,slot.updated_at])if(!iso(value)||Date.parse(value)<Date.parse(f.createdAt)||Date.parse(value)>=f.expiresAtMs)return fail("run_time_changed");
  if(!claimed){if(job.status!=="queued"||job.started_at!==null||job.completed_at!==null||job.lease_expires_at!==null||job.error_message!==null||job.notified_at!==null||job.updated_at!==f.createdAt||job.result_json!==JSON.stringify(b.initialResult))return fail("run_unclaimed_job_changed");}
  else{
    if(!r.runEvent||!iso(job.started_at)||Date.parse(job.started_at)<Date.parse(r.runEvent.recordedAt)||Date.parse(job.started_at)>Date.parse(String(job.updated_at))
      ||!["running","committing","completed","failed","canceled"].includes(String(job.status)))return fail("run_claim_changed");
    if(terminal){if(!iso(job.completed_at)||job.lease_expires_at!==null||Date.parse(job.completed_at)<Date.parse(job.started_at)||Date.parse(job.completed_at)>Date.parse(String(job.updated_at)))return fail("run_terminal_job_changed");}
    else if(!iso(job.lease_expires_at)||Date.parse(job.lease_expires_at)>f.expiresAtMs||Date.parse(job.lease_expires_at)<=Date.parse(job.started_at)||job.completed_at!==null||job.error_message!==null)return fail("run_job_lease_changed");
    if(job.notified_at!==null&&(!iso(job.notified_at)||!terminal))return fail("run_notification_changed");
  }
  const result=json(job.result_json);
  if(result.reservationId!==s.tokenReservationId||result.costReservationId!==s.costReservationId||result.costReservationPeriod!==f.period||result.costReservationMicrousd!==s.maximumMicrousd||result.providerSubmissionProtocol!==1)return fail("run_job_reservations_changed");
  equal(result.outputExecution,reference(f));
  if(!record(result.generationReceipt)||result.generationReceipt.artifact_kind!=="image"||result.generationReceipt.output_slot_id!==s.slotId||result.generationReceipt.output_grant_id!==s.grantId||result.generationReceipt.reservation_microusd!==s.maximumMicrousd)return fail("run_job_receipt_changed");
  equal({...grant,status:"authorized"},{scope_key:f.scope.key,grant_id:s.grantId,plan_revision_id:s.planRevisionId,actor_user_id:f.actorUserId,payer_user_id:f.payerUserId,context_id:null,preflight_id:f.preflight.id,authorization_event_id:b.authorization.eventId,maximum_microusd:s.maximumMicrousd,maximum_calls:s.maximumCalls,status:"authorized",expires_at:f.expiresAt,created_at:f.createdAt});
  if(!r.runEvent&&grant.status!=="authorized"||r.runEvent&&!(["active","exceeded",...(terminal?["completed"]:[])].includes(String(grant.status))))return fail("run_grant_phase_changed");
  equal({...slot,status:"authorized",outcome_event_id:null,updated_at:f.createdAt},{scope_key:s.scopeKey,slot_id:s.slotId,grant_id:s.grantId,plan_revision_id:s.planRevisionId,target_id:s.targetId,target_contract_digest:s.targetContractDigest,source_digest:s.sourceDigest,provider:s.provider,model:s.model,route_digest:s.routeDigest,job_id:s.jobId,cost_reservation_id:s.costReservationId,token_reservation_id:s.tokenReservationId,maximum_microusd:s.maximumMicrousd,maximum_calls:s.maximumCalls,maximum_tokens:s.maximumTokens,attempt_ordinal:0,previous_slot_id:null,status:"authorized",outcome_event_id:null,created_at:f.createdAt,updated_at:f.createdAt});
  if(!r.runEvent&&slot.status!=="authorized"||r.runEvent&&!claimed&&slot.status!=="queued"||claimed&&!(["queued","running","uncertain",...(terminal?["succeeded","failed","cancelled"]:[])].includes(String(slot.status))))return fail("run_slot_phase_changed");
  const end=r.events.find(event=>["GenerationCompleted","GenerationFailed"].includes(event.type));
  if(slot.outcome_event_id!==null&&slot.outcome_event_id!==end?.eventId||slot.status==="succeeded"&&(job.status!=="completed"||end?.type!=="GenerationCompleted")||slot.status==="failed"&&job.status!=="failed"||slot.status==="cancelled"&&job.status!=="canceled")return fail("run_outcome_changed");
  const tokenFixed={reservation_id:s.tokenReservationId,owner_id:f.payerUserId,stream_id:f.streamId,correlation_id:correlation,operation:"image-generation",period:f.period,reserved_tokens:s.maximumTokens,created_at:f.createdAt};
  for(const [key,value] of Object.entries(tokenFixed))if(token[key]!==value)return fail("run_token_changed");
  const costFixed={reservation_id:s.costReservationId,owner_id:f.payerUserId,workspace_id:"forma",stream_id:f.streamId,correlation_id:correlation,operation:"image-generation",period:f.period,reserved_microusd:s.maximumMicrousd,allow_user_overage:0};
  for(const [key,value] of Object.entries(costFixed))if(cost[key]!==value)return fail("run_cost_changed");
  for(const receipt of [token,cost])if(!iso(receipt.created_at)||!iso(receipt.updated_at)||Date.parse(receipt.created_at)<Date.parse(f.createdAt)||Date.parse(receipt.updated_at)<Date.parse(receipt.created_at)||Date.parse(receipt.updated_at)>=f.expiresAtMs)return fail("run_financial_time_changed");
  if(!nonnegative(token.used_tokens)||!nonnegative(cost.used_microusd))return fail("run_financial_usage_changed");
  const held=token.status==="active"&&["active","executing"].includes(String(cost.status));
  const settled=["settled","released"].includes(String(token.status))&&["settled","released"].includes(String(cost.status));
  if(!held&&!settled||!claimed&&!held||!claimed&&(cost.status!=="active"||token.used_tokens!==0||cost.used_microusd!==0))return fail("run_financial_phase_changed");
  if(held&&(token.settled_at!==null||cost.settled_at!==null||token.settlement_reason!==null||token.used_tokens!==0||cost.used_microusd!==0))return fail("run_financial_hold_changed");
  if(settled&&(!iso(token.settled_at)||!iso(cost.settled_at)||token.settled_at!==token.updated_at||cost.settled_at!==cost.updated_at||token.status!==(token.used_tokens>0?"settled":"released")||cost.status!==(cost.used_microusd>0?"settled":"released")))return fail("run_financial_settlement_changed");
  const e=c.compiled.envelope;
  equal({...consumption,admitted_at_ms:0},{consumption_id:e.consumptionId,grant_id:c.issuerGrantId,campaign_id:e.campaignId,actor_user_id:f.actorUserId,session_digest:e.sessionDigest,intent_key:e.intentKey,envelope_digest:c.compiled.envelopeDigest,job_id:s.jobId,maximum_microusd:s.maximumMicrousd,admitted_at_ms:0});
  if(!nonnegative(consumption.admitted_at_ms)||consumption.admitted_at_ms<Date.parse(f.createdAt)||consumption.admitted_at_ms>=f.expiresAtMs)return fail("run_consumption_changed");
  if(active)equal(active,{actor_user_id:f.actorUserId,consumption_id:e.consumptionId,job_id:s.jobId});else if(!terminal||!settled||!["succeeded","failed","cancelled"].includes(String(slot.status)))return fail("run_active_job_missing");
  const submissions=result.providerSubmissions??{};if(!record(submissions)||Object.keys(submissions).length>2)return fail("run_submissions_invalid");
  if(!claimed&&(calls.length||storage.length||content.length||r.events.length>Number(!!r.runEvent)))return fail("run_unclaimed_descendants");
  if(new Set(calls.map(row=>row.stage_key)).size!==calls.length||new Set(calls.map(row=>row.client_request_id)).size!==calls.length)return fail("run_duplicate_provider_call");
  let knownCost=0,knownTokens=0;
  for(const call of calls){
    const route=r.settings.calls.find(route=>route.stage===call.stage_key);
    if(!route||call.scope_key!==s.scopeKey||call.slot_id!==s.slotId||call.call_key!==route.stage||call.provider!==route.provider||call.model!==route.model||call.reserved_microusd!==route.maximumMicrousd
      ||typeof call.client_request_id!=="string"||!call.client_request_id||typeof call.request_digest!=="string"||!/^[a-f0-9]{64}$/u.test(call.request_digest)||!iso(call.created_at)||Date.parse(call.created_at)<Date.parse(String(job.started_at))||Date.parse(call.created_at)>=f.expiresAtMs)return fail("run_provider_call_changed");
    if(!["pending","uncertain","settled","rejected"].includes(String(call.status)))return fail("run_provider_call_changed");
    const known=call.status==="settled"||call.status==="rejected";
    if(known?(!nonnegative(call.used_microusd)||!iso(call.settled_at)||Date.parse(call.settled_at)<Date.parse(call.created_at)||call.status==="rejected"&&call.used_microusd!==0):(call.used_microusd!==null||call.settled_at!==null))return fail("run_provider_cost_changed");
    const receipt=submissions[String(call.client_request_id)];
    if(receipt!==undefined){if(!record(receipt)||receipt.clientRequestId!==call.client_request_id||receipt.provider!==call.provider||receipt.model!==call.model||receipt.operation!==(call.stage_key==="planning:initial"?"planning":"image")||!["pending","accepted","completed","rejected"].includes(String(receipt.status))||receipt.requestDigest!==undefined&&receipt.requestDigest!==call.request_digest||(known||call.provider_response_id!==null)&&(receipt.providerRequestId??null)!==call.provider_response_id)return fail("run_provider_receipt_changed");
      if(call.status==="settled"&&(receipt.status!=="completed"||receipt.costMicrousd!==call.used_microusd||![receipt.inputTokens,receipt.outputTokens,receipt.totalTokens].every(nonnegative))||call.status==="rejected"&&receipt.status!=="rejected")return fail("run_provider_receipt_changed");
      if(receipt.status==="completed"&&nonnegative(receipt.totalTokens))knownTokens+=receipt.totalTokens;
    }else if(known)return fail("run_provider_receipt_missing");
    if(known)knownCost+=Number(call.used_microusd);
  }
  for(const key of Object.keys(submissions))if(!calls.some(call=>call.client_request_id===key))return fail("run_foreign_submission");
  const imageCall=calls.find(row=>row.stage_key==="image:initial"),planCall=calls.find(row=>row.stage_key==="planning:initial");
  if(imageCall&&(!planCall||planCall.status!=="settled"||String(planCall.settled_at)>String(imageCall.created_at)))return fail("run_provider_order_changed");
  const exposure=calls.reduce((sum,call)=>sum+Number(call.used_microusd??call.reserved_microusd),0),exceeded=exposure>s.maximumMicrousd;
  if(!Number.isSafeInteger(exposure)||!Number.isSafeInteger(knownCost)||!Number.isSafeInteger(knownTokens)||exceeded!==(grant.status==="exceeded")
    ||held&&calls.length>0&&cost.status!=="executing"||grant.status==="completed"&&(["queued","running","uncertain"].includes(String(slot.status))||calls.some(row=>!["settled","rejected"].includes(String(row.status))))
    ||settled&&(calls.some(row=>!["settled","rejected"].includes(String(row.status)))||knownCost!==cost.used_microusd||knownTokens!==token.used_tokens))return fail("run_total_usage_changed");
  const generation=r.events.find(event=>event.type==="GenerationRequested")?.payload.generation_id;
  if((calls.length||storage.length||content.length)&&!id(generation))return fail("run_generation_missing");
  if((storage.length||content.length)&&job.status!=="committing"&&!terminal)return fail("run_storage_phase_changed");
  if(storage.length&&(!planCall||planCall.status!=="settled"||!imageCall||imageCall.status!=="settled"))return fail("run_storage_ancestry");
  for(const stored of storage){if(stored.scope_key!==s.scopeKey||stored.slot_id!==s.slotId||stored.storage_key!==`${ownerMediaNamespace(f.ownerUserId)}/generated/${generation}.png`
    ||typeof stored.content_sha256!=="string"||!/^[a-f0-9]{64}$/u.test(stored.content_sha256)||!["writing","written","cleanup_pending","deleted"].includes(String(stored.status))||stored.write_acknowledged!==0&&stored.write_acknowledged!==1
    ||stored.status==="writing"&&stored.write_acknowledged!==0||["written","deleted"].includes(String(stored.status))&&stored.write_acknowledged!==1||stored.publication_event_id!==null&&stored.publication_event_id!==end?.eventId
    ||!iso(stored.created_at)||!iso(stored.updated_at)||Date.parse(stored.created_at)<Date.parse(String(job.started_at))||Date.parse(stored.updated_at)<Date.parse(stored.created_at)||Date.parse(stored.updated_at)>=f.expiresAtMs)return fail("run_storage_changed");}
  if(new Set(content.map(row=>row.kind)).size!==content.length)return fail("run_private_body_extra");
  if(content.some(body=>body.kind==="provider-output")&&(!planCall||planCall.status!=="settled"||!imageCall||imageCall.status!=="settled"||storage.length!==1||storage[0]!.status!=="written"||storage[0]!.write_acknowledged!==1))return fail("run_private_output_ancestry");
  if(content.length&&!calls.length)return fail("run_private_body_ancestry");
  for(const body of content){if(!id(body.content_id)||body.owner_id!==f.ownerUserId||!["provider-output","prompt"].includes(String(body.kind))||typeof body.content!=="string"||!body.content||bytes(body.content)>65536||body.redacted_at!==null
    ||!iso(body.created_at)||!iso(body.expires_at)||Date.parse(body.created_at)<Date.parse(String(job.started_at))||Date.parse(body.created_at)>=f.expiresAtMs||Date.parse(body.expires_at)<=Date.now())return fail("run_private_body_changed");}
  if(job.status==="completed"&&(end?.type!=="GenerationCompleted"||!settled))return fail("run_terminal_mismatch");
  // A local terminal-write failure may follow the genuine success event. Keep
  // that historical failure; the output event never authorizes another Run.
  if(terminal&&end&&(job.status==="completed"||result.appendedEventIds!==undefined)){equal(result.appendedEventIds,r.events.slice(1).map(event=>event.eventId));if(result.head!==r.events.at(-1)!.sequence||result.previewed!==false||result.previewQueued!==false||result.previewSuppressed!==false||result.promoted!==false)return fail("run_terminal_result_changed");}
  r.phase=!r.runEvent?"admitted":!claimed?"queued":job.status==="canceled"||job.status==="failed"&&end?.type!=="GenerationFailed"||exceeded||knownTokens>s.maximumTokens?"interrupted":String(job.status);
}


// Source-derived fingerprints of the exact optional Memory migration families.
const baselineGuardDefinitions=["CREATE TRIGGER IF NOT EXISTS organization_context_package_version_immutable BEFORE UPDATE ON organization_context_package_versions WHEN OLD.status='published' AND (NEW.version_id<>OLD.version_id OR NEW.status<>OLD.status OR NEW.package_id<>OLD.package_id OR NEW.organization_id<>OLD.organization_id OR NEW.version<>OLD.version OR NEW.content_sha256<>OLD.content_sha256 OR NEW.source_project_access_id<>OLD.source_project_access_id OR NEW.source_document_id<>OLD.source_document_id OR NEW.created_by_user_id<>OLD.created_by_user_id OR COALESCE(NEW.approved_by_user_id,'')<>COALESCE(OLD.approved_by_user_id,'') OR COALESCE(NEW.published_at,'')<>COALESCE(OLD.published_at,'')) BEGIN SELECT RAISE(ABORT,'published_context_package_is_immutable'); END","CREATE TRIGGER IF NOT EXISTS organization_context_package_content_immutable BEFORE UPDATE OF content_json ON organization_context_package_contents WHEN EXISTS(SELECT 1 FROM organization_context_package_versions version WHERE version.version_id=OLD.version_id AND version.organization_id=OLD.organization_id AND version.status='published') AND NEW.content_json<>OLD.content_json BEGIN SELECT RAISE(ABORT,'published_context_package_content_is_immutable'); END","CREATE TRIGGER IF NOT EXISTS organization_context_package_source_immutable BEFORE UPDATE ON organization_context_package_sources WHEN EXISTS(SELECT 1 FROM organization_context_package_versions version WHERE version.version_id=OLD.version_id AND version.organization_id=OLD.organization_id AND version.status='published') BEGIN SELECT RAISE(ABORT,'published_context_package_source_is_immutable'); END","CREATE TRIGGER IF NOT EXISTS organization_context_package_source_delete_guard BEFORE DELETE ON organization_context_package_sources WHEN EXISTS(SELECT 1 FROM organization_context_package_versions version WHERE version.version_id=OLD.version_id AND version.organization_id=OLD.organization_id AND version.status='published') AND NOT EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=OLD.organization_id AND deletion.status='processing') BEGIN SELECT RAISE(ABORT,'published_context_package_source_is_immutable'); END","CREATE TRIGGER IF NOT EXISTS organization_context_package_version_delete_guard BEFORE DELETE ON organization_context_package_versions WHEN OLD.status='published' AND NOT EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=OLD.organization_id AND deletion.status='processing') BEGIN SELECT RAISE(ABORT,'published_context_package_is_immutable'); END","CREATE TRIGGER IF NOT EXISTS organization_legal_hold_during_deletion_guard BEFORE INSERT ON organization_legal_holds WHEN NEW.status='active' AND(NOT EXISTS(SELECT 1 FROM organizations governed WHERE governed.organization_id=NEW.organization_id AND governed.status='active') OR EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=NEW.organization_id AND deletion.status IN('pending','partial','processing','completed'))) BEGIN SELECT RAISE(ABORT,'organization_deletion_in_progress'); END","CREATE TRIGGER IF NOT EXISTS organization_deletion_active_hold_guard BEFORE INSERT ON organization_deletion_jobs WHEN EXISTS(SELECT 1 FROM organization_legal_holds hold WHERE hold.organization_id=NEW.organization_id AND hold.status='active') OR EXISTS(SELECT 1 FROM organization_retention_policies policy WHERE policy.organization_id=NEW.organization_id AND policy.legal_hold=1) OR EXISTS(SELECT 1 FROM organization_recovery_snapshots recovery WHERE recovery.organization_id=NEW.organization_id AND recovery.status='staging') OR EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=NEW.organization_id AND deletion.status IN('pending','partial','processing')) BEGIN SELECT RAISE(ABORT,'organization_deletion_blocked'); END","CREATE TRIGGER IF NOT EXISTS organization_retention_hold_during_deletion_guard BEFORE UPDATE OF legal_hold ON organization_retention_policies WHEN NEW.legal_hold=1 AND(NOT EXISTS(SELECT 1 FROM organizations governed WHERE governed.organization_id=NEW.organization_id AND governed.status='active') OR EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=NEW.organization_id AND deletion.status IN('pending','partial','processing','completed'))) BEGIN SELECT RAISE(ABORT,'organization_deletion_in_progress'); END","CREATE TRIGGER IF NOT EXISTS organization_retention_hold_insert_during_deletion_guard BEFORE INSERT ON organization_retention_policies WHEN NEW.legal_hold=1 AND(NOT EXISTS(SELECT 1 FROM organizations governed WHERE governed.organization_id=NEW.organization_id AND governed.status='active') OR EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=NEW.organization_id AND deletion.status IN('pending','partial','processing','completed'))) BEGIN SELECT RAISE(ABORT,'organization_deletion_in_progress'); END","CREATE TRIGGER IF NOT EXISTS organization_audit_block_update BEFORE UPDATE ON organization_audit_events BEGIN SELECT RAISE(ABORT,'organization audit is append-only'); END","CREATE TRIGGER IF NOT EXISTS organization_audit_block_delete BEFORE DELETE ON organization_audit_events BEGIN SELECT RAISE(ABORT,'organization audit is append-only'); END"] as const;
const memoryProfiles=[{"source":"0025_memory_live_base","names":["idx_memory_live_actor","idx_memory_live_due","idx_memory_live_expiry","idx_memory_live_organization","idx_memory_live_runs_started","idx_memory_live_source_page","memory_live_enrollments","memory_live_runs","memory_live_sources"],"tables":["memory_live_enrollments","memory_live_runs","memory_live_sources"],"digest":"sha256:78664dee9906c24d184a883eec71f7622b2dcb5eaeeff6251e0da885bcdff1b1","count":9},{"source":"0026_memory_live_conversation","names":["idx_memory_live_conversation_page","memory_live_conversation_segments"],"tables":["memory_live_conversation_segments"],"digest":"sha256:1e9b2a6c2a0d16b38caff8d33163bbc4a3db1d7fe3bdeba3cca24ccae3858f9a","count":2},{"source":"0027_memory_native_origins","names":["idx_memory_native_origin_actor","idx_memory_native_origin_answer_content","idx_memory_native_origin_enrollment","idx_memory_native_origin_source","idx_memory_native_origin_user_content","memory_native_answer_dependencies","memory_native_answer_dependencies_origin_id_event_id_unique","memory_native_answer_dependencies_origin_id_source_sequence_unique","memory_native_answer_origins","memory_native_answer_origins_actor_user_id_scope_key_turn_id_unique","memory_native_answer_origins_answer_content_id_unique","memory_native_answer_origins_answer_event_id_unique","memory_native_answer_origins_user_content_id_unique","memory_native_answer_origins_user_event_id_unique","memory_native_dependency_delete_active","memory_native_dependency_immutable","memory_native_origin_delete_active","memory_native_origin_immutable","memory_native_origin_user_immutable"],"tables":["memory_native_answer_dependencies","memory_native_answer_origins"],"digest":"sha256:91fa9fed66f63dbbc096747004cc0c1002d2e18217bd03a09fc1bc65c6a15590","count":19},{"source":"0028_memory_document_profile","names":["idx_document_profile_grants_actor","idx_document_profile_grants_enrollment","idx_document_profile_grants_organization","memory_document_profile_grants","memory_document_profile_suppressions"],"tables":["memory_document_profile_grants","memory_document_profile_suppressions"],"digest":"sha256:715ed54171572da551ad69e2f50b3e1a9e0dc1bf1b7cfb59b394dd10dee3baff","count":5},{"source":"0032_memory_structured_conversation_ledger","names":["idx_memory_structured_heads_cleanup","idx_memory_structured_heads_enrollment","idx_memory_structured_heads_organization","idx_memory_structured_heads_personal","idx_memory_structured_heads_shared","idx_memory_structured_revisions_body","idx_memory_structured_revisions_expiry","memory_structured_conversation_heads","memory_structured_conversation_revisions"],"tables":["memory_structured_conversation_heads","memory_structured_conversation_revisions"],"digest":"sha256:0cf1990603cb219475c5f7cbdaa0d6e8db7bce87becdd1eb44b15ec2b23f9f11","count":9},{"source":"0033_memory_structured_answer_provenance","names":["idx_memory_structured_origin_actor","idx_memory_structured_origin_answer_content","idx_memory_structured_origin_answer_event","idx_memory_structured_origin_enrollment","idx_memory_structured_origin_ledger","idx_memory_structured_origin_manifest","idx_memory_structured_origin_revision","idx_memory_structured_origin_revision_body","idx_memory_structured_origin_revision_content","idx_memory_structured_origin_revision_ledger","idx_memory_structured_origin_turn","idx_memory_structured_origin_user_content","idx_memory_structured_origin_user_event","idx_memory_structured_original_body","idx_memory_structured_original_content","idx_memory_structured_original_event","idx_memory_structured_original_sequence","idx_memory_structured_original_source","idx_memory_structured_original_turn_role","memory_structured_answer_ledger_revisions","memory_structured_answer_originals","memory_structured_answer_origins","memory_structured_origin_immutable","memory_structured_origin_insert","memory_structured_origin_no_delete","memory_structured_origin_revision_immutable","memory_structured_origin_revision_insert","memory_structured_origin_revision_withdrawn_delete","memory_structured_original_immutable","memory_structured_original_insert","memory_structured_original_withdrawn_delete"],"tables":["memory_structured_answer_ledger_revisions","memory_structured_answer_originals","memory_structured_answer_origins"],"digest":"sha256:c3a07d0f3cbb3f8c14f54447e90dd9ba458927f2dde006f09eef55a12c8d57d5","count":31},{"source":"0034_memory_document_job_origins","names":["idx_memory_document_job_origin_actor","idx_memory_document_job_origin_answer_content_id","idx_memory_document_job_origin_answer_event_id","idx_memory_document_job_origin_dependency","idx_memory_document_job_origin_enrollment","idx_memory_document_job_origin_expiry","idx_memory_document_job_origin_job_id","idx_memory_document_job_origin_manifest_content_ref","idx_memory_document_job_origin_scope","idx_memory_document_job_origin_turn","idx_memory_document_job_origin_user_content_id","idx_memory_document_job_origin_user_event_id","memory_document_job_answer_origins","memory_document_job_origin_dependencies"],"tables":["memory_document_job_answer_origins","memory_document_job_origin_dependencies"],"digest":"sha256:caecedd6398c666e6acb11bd56be087b9865373207b46d8418286ce45b6e3d48","count":14},{"source":"0035_memory_document_job_origin_retirement_progress","names":["memory_document_job_origin_retirement_delete","memory_document_job_origin_retirement_insert","memory_document_job_origin_retirement_progress","memory_document_job_origin_retirement_update"],"tables":["memory_document_job_origin_retirement_progress"],"digest":"sha256:f60c68d28f589d97f77dcf9136bd592ae4896f963070408b791f284887ae81d8","count":4},memoryBenchmarkSchemaProfile] as const;
// Native runtime column contracts; additional identity columns need qualification.
const memoryColumns:Record<string,readonly string[]>={"memory_document_job_origin_retirement_progress":["origin_id","schema_version","evidence_json","selector_count","selector_cursor","phase","revision","answer_redacted_at","manifest_redacted_at","created_at","updated_at"],"memory_structured_conversation_heads":["ledger_id","actor_user_id","owner_user_id","organization_id","project_access_id","project_id","document_id","enrollment_id","enrollment_revision","permission_epoch","policy_version","storage_revision","current_body_ref","current_body_hash","annotation_count","coverage_after_sequence","coverage_through_sequence","state","first_terminal_at","cleanup_turn","expires_at","created_at","updated_at"],"memory_structured_conversation_revisions":["ledger_id","revision","predecessor_revision","predecessor_hash","body_ref","body_hash","schema_version","recipe_version","annotation_count","coverage_after_sequence","coverage_through_sequence","created_at","expires_at"],"memory_live_conversation_segments":["enrollment_id","enrollment_revision","recipe_version","first_sequence","last_sequence","member_count","members_json","created_at","expires_at"],"memory_document_profile_grants":["grant_id","actor_user_id","owner_user_id","organization_id","project_access_id","project_id","document_id","permission_epoch","policy_version","recipe_version","revision","enrollment_id","enrollment_revision","infer_enabled","inspect_enabled","background_enabled","source_after_sequence","consented_at","expires_at","retention_days","revoked_at"],"memory_document_profile_suppressions":["grant_id","grant_revision","claim_key","revision","state","created_at","expires_at"],"memory_native_answer_dependencies":["origin_id","ordinal","event_stream_id","event_id","source_sequence","event_type","recorded_at","block_id","turn_id","user_content_id","assistant_content_id","source_retention_ceiling","consumed","segment_enrollment_id","segment_revision","segment_recipe","segment_first_sequence","segment_last_sequence","segment_member_count","segment_ordinal","segment_created_at","segment_retention_ceiling"],"memory_native_answer_origins":["origin_id","schema_version","recipe_version","actor_user_id","owner_user_id","organization_id","project_access_id","project_id","document_id","scope_key","turn_id","user_event_id","user_content_id","user_source_sequence","answer_event_id","answer_content_id","answer_source_sequence","answer_expires_at","enrollment_id","enrollment_revision","policy_version","permission_epoch","enrolled_at","enrollment_expires_at","retention_days","selection_cursor","source_retention_ceiling","dependency_count","created_at","status","withdrawn_at","withdrawal_reason"],"memory_document_job_answer_origins":["origin_id","schema_version","recipe_version","actor_user_id","scope_key","job_id","turn_id","user_event_id","user_content_id","answer_event_id","answer_content_id","manifest_content_ref","owner_user_id","stream_id","organization_id","project_access_id","project_id","document_id","attempt_count","correlation_id","input_content_ref","input_expires_at","job_requested_at","job_started_at","job_lease_expires_at","job_expires_at","requested_sequence","source_head","project_source_head","user_source_sequence","answer_source_sequence","answer_expires_at","mode","renderer_recipe","locale","enrollment_id","enrollment_revision","permission_epoch","policy_version","enrolled_at","enrollment_expires_at","retention_days","selection_cursor","source_count","ledger_revision_count","selector_count","manifest_expires_at","proof_valid_until","source_retention_ceiling","created_at","status","withdrawn_at","withdrawal_reason"],"memory_document_job_origin_dependencies":["origin_id","resource_kind","resource_id"],"memory_structured_answer_origins":["origin_id","schema_version","recipe_version","actor_user_id","owner_user_id","organization_id","project_access_id","project_id","document_id","scope_key","turn_id","user_event_id","user_content_id","user_source_sequence","answer_event_id","answer_content_id","answer_source_sequence","answer_expires_at","enrollment_id","enrollment_revision","permission_epoch","policy_version","enrolled_at","enrollment_expires_at","retention_days","source_head","ledger_id","ledger_storage_revision","ledger_body_ref","source_count","ledger_revision_count","manifest_content_ref","manifest_expires_at","source_retention_ceiling","created_at","status","withdrawn_at","withdrawal_reason"],"memory_structured_answer_originals":["origin_id","ordinal","event_stream_id","event_id","source_sequence","event_type","role","turn_id","content_id","recorded_at","source_retention_ceiling","retained_by_ledger","presented_in_context"],"memory_structured_answer_ledger_revisions":["origin_id","ordinal","ledger_id","storage_revision","predecessor_revision","predecessor_hash","body_ref","body_hash","created_at","expires_at"],"memory_live_enrollments":["enrollment_id","actor_user_id","owner_user_id","organization_id","project_access_id","project_id","document_id","permission_epoch","policy_version","revision","learn_enabled","recall_enabled","background_enabled","retention_days","time_zone","enrolled_at","expires_at","cursor_sequence","cutoff_sequence","last_local_day","last_admitted_at","next_due_at","lease_token","lease_expires_at","attempts","failure_code"],"memory_live_runs":["run_id","trigger_kind","status","started_at","finished_at","scopes","processed","erased","failed"],"memory_live_sources":["enrollment_id","event_id","sequence","expires_at"],"memory_benchmark_assertions":["passed"],"memory_benchmark_experiments":["experiment_id","singleton","plan_hash","principal_id","payer_id","period","maximum_micro_usd","spent_micro_usd","reserved_micro_usd","status","next_ordinal","expires_at","created_at","updated_at","halt_reason"],"memory_benchmark_native_assertions":["passed"],"memory_benchmark_native_dispositions":["binding_id","kind","principal_id","authority_sha256","token_was_present","cost_was_present","recorded_at"],"memory_benchmark_native_grants":["experiment_id","singleton","principal_id","payer_id","plan_hash","qualification_id","period","maximum_micro_usd","created_at","expires_at","revoked_at"],"memory_benchmark_native_operations":["binding_id","experiment_id","operation_id","request_hash","principal_id","payer_id","period","model","maximum_tokens","maximum_micro_usd","token_id","cost_id","verified_tokens","verified_micro_usd","usage_receipt_json"],"memory_benchmark_native_qualifications":["qualification_id","plan_hash","source_sha256","evidence_sha256","origin","status","qualified_at","expires_at","model_access_verified","pricing_verified","retention_verified","token_bounds_verified","native_accounting_verified","hold_reconciliation_verified","cleanup_verified"],"memory_benchmark_operations":["experiment_id","operation_id","request_hash","ordinal","reservation_token","dispatch_claimed_at","dispatch_claim_token","maximum_micro_usd","actual_micro_usd","state","result_json","payload_purged_at","created_at","updated_at"]};
const coreColumns:Record<string,readonly string[]>={"event_private_payloads":["private_event_id","owner_id","project_id","document_id","private_json","created_at","redacted_at"],"event_write_stage":["event_id","stream_id","sequence","occurred_at","recorded_at","actor","client_id","correlation_id","causation_id","compensates_event_id","schema_version","type","payload","owner_id","project_id","document_id","private_json"],"event_client_receipts":["stream_id","client_event_id","event_id","sequence","created_at"],"external_content":["content_id","owner_id","content","created_at"],"private_content":["content_id","owner_id","kind","content","created_at","expires_at","redacted_at"],"budget_reservations":["reservation_id","owner_id","stream_id","correlation_id","operation","period","reserved_tokens","used_tokens","status","settlement_reason","created_at","settled_at","updated_at"],"cost_budget_reservations":["reservation_id","owner_id","workspace_id","stream_id","correlation_id","operation","period","reserved_microusd","used_microusd","status","allow_user_overage","created_at","settled_at","updated_at"],"consequential_executions":["execution_id","actor_user_id","stream_id","project_id","document_id","organization_id","project_access_id","operation","intent_hash","binding_hash","consent_ref","result_ref","status","error_code","created_at","expires_at","updated_at"],"authoring_commits":["preview_id","actor_user_id","operation","project_id","document_id","block_id","canvas_id","organization_id","project_access_id","approval_hash","result_json","last_event_id","verified","created_at"],"shares":["share_id","token_hash","owner_id","stream_id","expires_at","revoked_at","created_at"],"share_scopes":["share_id","owner_id","resource_kind","resource_id","project_id","media_keys_json","created_at"],"document_jobs":["job_id","owner_id","stream_id","document_id","kind","status","source_surface","correlation_id","requested_sequence","request_json","result_json","scene_source_version_json","scene_source_protocol","error_message","attempt_count","requested_at","started_at","completed_at","lease_expires_at","notified_at","expires_at","updated_at"],"generation_preflights":["preflight_id","owner_id","stream_id","document_id","request_key","status","result_json","created_at","expires_at"],"organization_projects":["project_access_id","project_id","organization_id","owner_user_id","status","created_at","updated_at"],"project_event_scopes":["event_id","project_access_id","organization_id","project_id","owner_user_id","source_stream_id","source_sequence","project_sequence","actor_user_id","created_at"],"project_resource_scopes":["project_access_id","resource_kind","resource_id","organization_id","project_id","owner_user_id","visibility","source_event_id","actor_user_id","created_at"],"project_budget_reservation_scopes":["reservation_kind","reservation_id","organization_id","project_access_id","actor_user_id","workspace_scope_id","created_at"],"pilot_cost_reservation_scopes":["reservation_id","cohort_id","organization_id","actor_user_id","created_at"],"private_content_retention_scopes":["content_id","organization_id","project_access_id","project_id","actor_user_id","classification","policy_version","assigned_expires_at","created_at"],"artifact_revisions":["revision_id","owner_id","organization_id","project_access_id","project_id","document_id","artifact_id","revision","content_json","content_sha256","created_by_user_id","created_at","expires_at","redacted_at"],"project_context_package_bindings":["binding_id","organization_id","project_access_id","project_id","document_id","package_id","version_id","update_mode","status","pending_version_id","created_by_user_id","created_at","updated_at"],"project_review_tasks":["task_id","project_access_id","organization_id","project_id","artifact_id","document_id","request_event_id","requested_by_user_id","assigned_user_id","artifact_revision","content_sha256","status","due_at","created_at","resolved_at","resolved_by_user_id"]};

async function required(c:Captured, parts:Proof[], table:string, columns:readonly string[], where:string, bindings:Value[]):Promise<Row>{
  const rows=await nativeRows(c,table,columns,where,bindings,1);
  if(rows.length!==1)return fail("row_missing");
  parts.push(...observedProofs(table,columns,where,bindings,rows));return rows[0]!;
}

/** Collect one complete retained native Image graph. These facts have no
 * authority until the calling inventory atomically proves all returned parts. */
export async function collectGuestImageResultFacts(history:History) {
  const {ctx,original:o,saved:h}=history;current(ctx);
  const wait=async<T>(work:()=>Promise<T>):Promise<T>=>{current(ctx);const value=await work();current(ctx);return value;};
  if(!o.plan)return fail("retained_release_required");
  const format=await wait(()=>createRetainedSponsorImageFormat(o.plan!.release,o.policy.releaseHash));
  const facts=await wait(()=>collectRetainedGuestImageStageFacts(history,format));
  if(!o.plan||facts.stageState!=="quoted"||!facts.quote||!facts.transport||!facts.rows.preflightCommand||facts.tails.length!==3||facts.tails.some(t=>!t.payload))return fail("quote_required");
  const quote=facts.quote,actor=String(o.session.guest_subject),policy=h.approval.policy,commandKey=h.driver.stageKeys.authorize;
  if(!actor.startsWith("guest:")||policy.payerUserId.startsWith("guest:")||actor===policy.payerUserId)return fail("identity_invalid");
  const hash=(await wait(()=>digest({campaignId:policy.campaignId,actorUserId:actor,intentKey:commandKey}))).slice(7);
  const issuerGrantId=`sponsor-issued-${hash}`,issuerResourceId=`sponsor-resource-issue-${hash}`;
  const parts:Proof[]=[...o.parts,...history.currentGuards,history.sponsor.proof,history.memory.proof,
    ...facts.stageParts,...facts.tailProofs,facts.blockCustodyProof,facts.recordedTimeProof];
  // Producer-owned sections: the ordinary proof below retains its original
  // ordering. Publication replaces only the two live session observations and
  // the custody closures; it never inspects or filters arbitrary SQL strings.
  const originalSectionEnd = parts.length;
  const publishedSourcePrefix: Proof[] = [...o.associationParts, history.currentPolicyProof,
    history.sponsor.proof, history.memory.proof, ...facts.stageParts, ...facts.tailProofs,
    facts.blockCustodyProof, facts.recordedTimeProof];
  // The read helpers need only the captured request/DB check. They do not mint
  // the live admission or Run capability and inspect no provider credentials.
  const c={ctx,history,facts,issuerGrantId,issuerResourceId,life:{wait},optionalTables:new Set<string>(),blueprint:null} as Captured;
  c.optionalTables=await qualifyResultSchema(c,parts);
  const issuerGrant=await required(c,parts,"experience_sponsor_grants",grantColumns,"grant_id=?",[issuerGrantId]);
  const issuance=await required(c,parts,"experience_sponsor_issuances",issuanceColumns,"grant_id=?",[issuerGrantId]);
  const resource=await required(c,parts,"experience_sponsor_resource_receipts",resourceColumns,"resource_id=?",[issuerResourceId]);
  const authorization:GuestImageAuthorizationV1={version:1,purpose:"authorize-guest-sponsored-image",sessionDigest:h.sessionDigest,guestSourceDigest:h.driver.command.guestSourceDigest,
    policyDigest:h.approval.policyDigest,termsDigest:quote.termsDigest,maximumMicrousd:quote.maximumMicrousd,preflightId:quote.id,explicitAuthorization:true};
  const sourceEvents=[...o.contextEvents,...facts.tails.map(eventFrom)],context=authoritativeCreativeContext(sourceEvents,{documentId:o.documentId,projectId:o.projectId});
  c.compiled=await wait(()=>compileRetainedGuestSponsorEnvelope(policy,json(issuance.envelope_json),{sessionBinding:h.sessionBinding.binding,authorization,
    native:{sourceRevision:facts.sourceHead+3,preflight:quote,contextSnapshot:context.snapshot,transport:facts.transport}},format));
  const e=c.compiled.envelope;
  const clock=await wait(()=>ctx.db.prepare(`SELECT ${GUEST_DB_NOW} AS now_ms`).first<{now_ms:number}>());
  if(!clock||!nonnegative(clock.now_ms))return fail("clock_unavailable");
  const maximum=Math.min(h.maximum,Date.parse(quote.expiresAt),e.issuedAtMs+policy.maximumGrantLifetimeMs);
  if(e.issuedAtMs<Date.parse(quote.createdAt)||e.issuedAtMs>clock.now_ms||e.expiresAtMs!==maximum||c.compiled.policyDigest!==h.approval.policyDigest
    ||e.consumptionId!==`sponsor-consume-${hash}`||issuerGrant.enabled!==0&&issuerGrant.enabled!==1)return fail("issuance_changed");
  equal(issuerGrant,{grant_id:issuerGrantId,campaign_id:policy.campaignId,policy_digest:h.approval.policyDigest,actor_user_id:actor,session_digest:h.sessionDigest,
    intent_key:commandKey,envelope_digest:c.compiled.envelopeDigest,issued_at_ms:e.issuedAtMs,expires_at_ms:e.expiresAtMs,enabled:issuerGrant.enabled});
  equal(issuance,{grant_id:issuerGrantId,campaign_id:policy.campaignId,actor_user_id:actor,intent_key:commandKey,policy_digest:h.approval.policyDigest,
    driver_command_json:h.driver.commandJson,command_digest:e.guestAuthorizationDigest,envelope_digest:c.compiled.envelopeDigest,envelope_json:c.compiled.envelopeJson});
  equal(resource,{resource_id:issuerResourceId,campaign_id:policy.campaignId,policy_digest:h.approval.policyDigest,limits_digest:h.limitsDigest,actor_user_id:actor,session_digest:h.sessionDigest,
    operation:"issuance",intent_key:commandKey,payload_digest:c.compiled.envelopeDigest,text_bytes:bytes(canonicalJson(context.snapshot)),issued_grant_id:issuerGrantId,recorded_at_ms:resource.recorded_at_ms});
  if(!nonnegative(resource.recorded_at_ms)||resource.recorded_at_ms<e.issuedAtMs||resource.recorded_at_ms>clock.now_ms||resource.recorded_at_ms>=e.expiresAtMs)return fail("issuance_time_changed");
  const nativeAuthorization=await required(c,parts,"output_commands",commandColumns,"scope_key=? AND actor_user_id=? AND command_key=?",[h.scopeKey,actor,commandKey]);
  if(nativeAuthorization.action!=="authorize"||!id(nativeAuthorization.event_id)||!iso(nativeAuthorization.created_at)
    ||Date.parse(nativeAuthorization.created_at)<e.issuedAtMs||Date.parse(nativeAuthorization.created_at)>=e.expiresAtMs)return fail("authorization_changed");
  const raw=await wait(()=>ctx.db.prepare(`SELECT CASE WHEN length(CAST(body.private_json AS BLOB))<=131072 AND length(CAST(e.payload AS BLOB))<=65536 THEN ${eventWitness} ELSE NULL END AS witness
    FROM events e JOIN event_private_payloads body ON body.private_event_id=e.event_id WHERE e.event_id=? LIMIT 2`).bind(nativeAuthorization.event_id).all<{witness:string}>());
  if(!acknowledgement(raw)||!Array.isArray(raw.results)||raw.results.length!==1)return fail("authorization_unavailable");
  const observed=nativeRow(own(raw.results[0],"witness"),[...eventColumns,...bodyColumns],131072),authPayload=json(observed.private_json),envelope=authPayload.output_command_envelope;
  if(!record(envelope)||!record(envelope.guest_image_admission))return fail("marker_invalid");
  const m=envelope.guest_image_admission;
  if(!exactKeys(m,["version","issuerGrantId","driverCommandDigest","sourceRevision","planSourceHead","period","slot","queueEventId","payload","initialResult"])
    ||m.version!==1||m.issuerGrantId!==issuerGrantId||m.driverCommandDigest!==h.driver.commandDigest||m.sourceRevision!==facts.sourceHead+3||m.planSourceHead!==facts.sourceHead+1
    ||typeof m.period!=="string"||m.period!==nativeAuthorization.created_at.slice(0,7)||!record(m.slot)||!id(m.queueEventId)||!record(m.payload)||!record(m.initialResult))return fail("marker_invalid");
  const ids=m.slot;
  if(![ids.grantId,ids.slotId,ids.jobId,ids.costReservationId,ids.tokenReservationId].every(id)
    ||new Set([ids.grantId,ids.slotId,ids.jobId,ids.costReservationId,ids.tokenReservationId,m.queueEventId,nativeAuthorization.event_id]).size!==7)return fail("native_identity_invalid");
  const slot=slotFrom(c,h.scopeKey,ids as {grantId:string;slotId:string;jobId:string;costReservationId:string;tokenReservationId:string});equal(m.slot,slot);
  const settings=structuredClone(quote.targets[0]!.settings) as OutputNativeSettings;
  if(settings.kind!=="generate"||settings.payload.productionMode!=="manual"||!settings.imageRender||settings.calls.length!==2||settings.calls[0]?.stage!=="planning:initial"
    ||settings.calls[1]?.stage!=="image:initial"||settings.calls.some(route=>route.provider!=="openai")||slot.provider!=="openai")return fail("recipe_unsupported");
  equal(settings.executionPolicy,OUTPUT_NATIVE_EXECUTION_POLICY);
  c.frame={actorUserId:actor,ownerUserId:actor,streamId:`creative:${actor}`,projectId:o.projectId,documentId:o.documentId,payerUserId:policy.payerUserId,
    period:m.period,createdAt:nativeAuthorization.created_at,expiresAt:new Date(e.expiresAtMs).toISOString(),expiresAtMs:e.expiresAtMs,
    sourceHead:facts.sourceHead,planSourceHead:facts.sourceHead+1,quoteHead:facts.sourceHead+3,commandKey,scope:{key:h.scopeKey},confirmedPlan:facts.confirmed,
    preflight:quote,slot,recipe:e.recipe,sourceEvents,context,target:facts.confirmed.plan.targets[0]!,render:settings.imageRender};
  c.blueprint=await blueprint(c,slot,nativeAuthorization.created_at,m.period,m.queueEventId,nativeAuthorization.event_id,m.payload,m.initialResult);
  if(nativeAuthorization.request_digest!==c.blueprint.commandDigest)return fail("authorization_digest_changed");equal(authPayload,c.blueprint.authorization.payload);
  parts.push(eventProof(c.blueprint.queue,c.frame),eventProof(c.blueprint.authorization,c.frame));
  const runKey=h.driver.stageKeys.run,runCommand=await required(c,parts,"output_commands",commandColumns,"scope_key=? AND actor_user_id=? AND command_key=?",[h.scopeKey,actor,runKey]);
  if(!id(runCommand.event_id)||!iso(runCommand.created_at)||Date.parse(runCommand.created_at)<Date.parse(c.frame.createdAt)||Date.parse(runCommand.created_at)>=e.expiresAtMs)return fail("run_command_changed");
  equal(runCommand,{scope_key:h.scopeKey,actor_user_id:actor,command_key:runKey,request_digest:(await wait(()=>digest(runCommandValue(c,runKey)))).slice(7),action:"run",event_id:runCommand.event_id,created_at:runCommand.created_at});
  const runEvent=runEventValue(c,runKey,runCommand.event_id,runCommand.created_at),events=await progressEvents(c);equal(events[0],runEvent);
  // N+6 Run, registry trio, requested/compiled/budget, completed/usage: no
  // permissive terminal or partial-progress variant belongs to this inventory.
  if(events.length!==9||events[7]?.type!=="GenerationCompleted"||events[8]?.type!=="GenerationUsageRecorded")return fail("completed_graph_required");
  const s=slot;
  const rows:RunRows={
    job:await required(c,parts,"document_jobs",jobColumns,"job_id=?",[s.jobId]),
    grant:await required(c,parts,"output_execution_grants",nativeGrantColumns,"scope_key=? AND grant_id=?",[s.scopeKey,s.grantId]),
    slot:await required(c,parts,"output_operation_slots",slotColumns,"scope_key=? AND slot_id=?",[s.scopeKey,s.slotId]),
    token:await required(c,parts,"budget_reservations",tokenColumns,"reservation_id=?",[s.tokenReservationId]),
    cost:await required(c,parts,"cost_budget_reservations",costColumns,"reservation_id=?",[s.costReservationId]),
    consumption:await required(c,parts,"experience_sponsor_consumptions",consumptionColumns,"consumption_id=?",[e.consumptionId]),
    active:null,calls:await nativeRows(c,"output_provider_calls",callColumns,"scope_key=? AND slot_id=?",[s.scopeKey,s.slotId],2),
    storage:await nativeRows(c,"output_native_storage_writes",storageColumns,"scope_key=? AND slot_id=?",[s.scopeKey,s.slotId],1),
    content:await nativeRows(c,"private_content",contentColumns,"owner_id=? AND content_id<>?",[actor,o.draftId],2),
  };
  const active=await nativeRows(c,"experience_sponsor_active_jobs",["actor_user_id","consumption_id","job_id"],"actor_user_id=? OR consumption_id=? OR job_id=?",[actor,e.consumptionId,s.jobId],0);
  if(active.length||rows.job.status!=="completed"||rows.job.attempt_count!==1||rows.job.error_message!==null||rows.slot.status!=="succeeded"||rows.slot.outcome_event_id!==events[7]!.eventId
    ||rows.grant.status!=="completed"||rows.token.settlement_reason!=="provider_usage_recorded"||rows.calls.length!==2||rows.calls.some(call=>call.status!=="settled")||rows.storage.length!==1||rows.content.length!==2)return fail("completed_graph_required");
  const r:RunCapture={admission:c,runKey,runCommand,runEvent,events,rows,settings,phase:"completed"};
  validateRunRows(r);await validateRunEvents(r);if(r.phase!=="completed")return fail("completed_graph_required");
  const routes=await nativeRows(c,"output_operation_routes",["scope_key","slot_id","stage_key","provider","model","maximum_calls"],"scope_key=? AND slot_id=?",[s.scopeKey,s.slotId],2);
  if(routes.length!==2)return fail("routes_changed");
  for(const route of settings.calls)equal(routes.find(value=>value.stage_key===route.stage),{scope_key:s.scopeKey,slot_id:s.slotId,stage_key:route.stage,provider:route.provider,model:route.model,maximum_calls:1});
  rows.calls.sort((a,b)=>String(a.stage_key).localeCompare(String(b.stage_key)));routes.sort((a,b)=>String(a.stage_key).localeCompare(String(b.stage_key)));
  rows.content.sort((a,b)=>a.kind==="provider-output"?-1:b.kind==="provider-output"?1:0);
  const allEvents=[...sourceEvents,c.blueprint.queue,c.blueprint.authorization,...events],allIds=allEvents.map(event=>event.eventId);
  if(new Set(allIds).size!==allIds.length||allEvents.length!==facts.sourceHead+14)return fail("event_identity_changed");
  const completion=events[7]!,usage=events[8]!,completedAt=String(rows.job.completed_at);
  if(Date.parse(completion.recordedAt)>Date.parse(completedAt)||Date.parse(usage.recordedAt)>Date.parse(completedAt))return fail("completion_after_terminal_job");
  const expiresAt=new Date(Math.min(Date.parse(facts.expiresAt),...rows.content.map(body=>Date.parse(String(body.expires_at))))).toISOString();
  if(Date.parse(expiresAt)<=clock.now_ms||completedAt>=expiresAt)return fail("retention_expired");
  const timestamps=[resource.recorded_at_ms,rows.consumption.admitted_at_ms,...allEvents.map(event=>Date.parse(event.recordedAt)),
    ...[rows.job,rows.slot,rows.token,rows.cost,...rows.calls,...rows.storage,...rows.content].flatMap(value=>["created_at","requested_at","started_at","completed_at","updated_at","settled_at","notified_at"].filter(key=>value[key]!==undefined&&value[key]!==null).map(key=>Date.parse(String(value[key]))))];
  if(timestamps.some(value=>!nonnegative(value)||value>clock.now_ms))return fail("historical_time_invalid");
  const closure = runClosure(r);
  parts.push(...events.map(event=>progressEventProof(event,c)),
    ...observedProofs("output_operation_routes",["scope_key","slot_id","stage_key","provider","model","maximum_calls"],"scope_key=? AND slot_id=?",[s.scopeKey,s.slotId],routes),
    ...observedProofs("experience_sponsor_active_jobs",["actor_user_id","consumption_id","job_id"],"actor_user_id=? OR consumption_id=? OR job_id=?",[actor,e.consumptionId,s.jobId],[]),
    ...observedProofs("output_provider_calls",callColumns,"scope_key=? AND slot_id=?",[s.scopeKey,s.slotId],rows.calls),
    ...observedProofs("output_native_storage_writes",storageColumns,"scope_key=? AND slot_id=?",[s.scopeKey,s.slotId],rows.storage),
    ...observedProofs("private_content",contentColumns,"owner_id=? AND content_id<>?",[actor,o.draftId],rows.content),
    {sql:"(SELECT COUNT(*) FROM events WHERE stream_id=?)=? AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND (SELECT COUNT(*) FROM event_client_receipts WHERE stream_id=?)=?",bindings:[c.frame.streamId,allEvents.length,c.frame.streamId,allEvents.length,c.frame.streamId,facts.sourceHead]},
    {sql:`?>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM json_each(?) observed WHERE observed.value>${GUEST_DB_NOW})`,bindings:[expiresAt,JSON.stringify(timestamps)]});
  const publishedSourceParts: Proof[] = [...publishedSourcePrefix, ...parts.slice(originalSectionEnd)];
  parts.push(closure.common,closure.familyCommon);
  for(const body of rows.content){const memory=await memoryProof(ctx,String(body.content_id));current(ctx);equal(memory.registries,history.memory.registries);parts.push(memory.proof);publishedSourceParts.push(memory.proof);}
  publishedFactsCaptures.set(closure.claimSourceFacts, freeze({ immutable: structuredClone(publishedSourceParts),
    session: structuredClone(o.session), sourceHead: facts.sourceHead, completionEventId: completion.eventId,
    generationId: String(completion.payload.generation_id), outputId: String(completion.payload.object_id) }));
  // Raw fact sections carry no authority. Ordinary inventory always receives
  // the full common + no-lease + no-attempt conjunction. Later genuine owners
  // must supply their fixed exact successors, never parse or filter this SQL.
  const claimSourceProofs = freeze({ common: structuredClone(parts), leaseAbsent: closure.leaseAbsent,
    attemptAbsent: closure.attemptAbsent, resultCopySchemaInstalled: closure.resultCopySchemaInstalled });
  parts.push(closure.leaseAbsent, closure.attemptAbsent);
  // Revocation controls are proved exactly above but are not historical result
  // identity. Enabled is the issuer's recorded production permission bit.
  const historicalApproval={...h.approval.row};delete historicalApproval.revoked_at_ms;
  const historicalIssuer={...issuerGrant};delete historicalIssuer.enabled;
  const immutableSnapshot={source:o.source,session:o.session,sourcePolicy:o.policy,custodyTerms:o.terms,prefix:o.prefixWitnesses,
    approval:historicalApproval,tails:facts.tails.map(t=>t.observed),resources:[...facts.resources,resource],stageRows:facts.rows,
    issuerGrant:historicalIssuer,issuance,authorization:nativeAuthorization,runCommand,events:allEvents,rows,routes};
  current(ctx);
  return {ctx,history,stage:facts,parts,claimSourceProofs,claimSourceFacts:closure.claimSourceFacts,immutableSnapshot,
    identity:{guestSubject:actor,payerUserId:policy.payerUserId,projectId:o.projectId,documentId:o.documentId,scopeKey:h.scopeKey,
      sourceHead:facts.sourceHead,saveHead:facts.sourceHead+1,quoteHead:facts.sourceHead+3,runHead:facts.sourceHead+6,resultHead:allEvents.length,
      expiresAt,generationId:String(completion.payload.generation_id),completionEventId:completion.eventId,usageEventId:usage.eventId,completedAt},
    rows:{issuerGrant,issuance,resource,consumption:rows.consumption,authorization:nativeAuthorization,runCommand,grant:rows.grant,slot:rows.slot,job:rows.job,
      token:rows.token,cost:rows.cost,calls:rows.calls,storage:rows.storage,privateContents:rows.content},events:allEvents,sourceEvents:allEvents.slice(0,facts.sourceHead+6),completion,usage};
}

// Exact journal spellings retained by native CREATE IF NOT EXISTS; no broad DDL normalization.
const journalGuardVariants:Record<string,string>={"events_block_update":"CREATE TRIGGER `events_block_update`\nBEFORE UPDATE ON `events` BEGIN\n\tSELECT RAISE(ABORT, 'events are append-only');\nEND;","events_block_delete":"CREATE TRIGGER `events_block_delete`\nBEFORE DELETE ON `events` BEGIN\n\tSELECT RAISE(ABORT, 'events are append-only');\nEND;","organization_audit_block_update":"CREATE TRIGGER IF NOT EXISTS `organization_audit_block_update`\nBEFORE UPDATE ON `organization_audit_events`\nBEGIN SELECT RAISE(ABORT,'organization audit is append-only'); END;","organization_audit_block_delete":"CREATE TRIGGER IF NOT EXISTS `organization_audit_block_delete`\nBEFORE DELETE ON `organization_audit_events`\nBEGIN SELECT RAISE(ABORT,'organization audit is append-only'); END;","organization_context_package_source_immutable":"CREATE TRIGGER IF NOT EXISTS `organization_context_package_source_immutable`\nBEFORE UPDATE ON `organization_context_package_sources`\nWHEN EXISTS(SELECT 1 FROM organization_context_package_versions version WHERE version.version_id=OLD.version_id AND version.organization_id=OLD.organization_id AND version.status='published')\nBEGIN SELECT RAISE(ABORT,'published_context_package_source_is_immutable'); END;","organization_context_package_source_delete_guard":"CREATE TRIGGER IF NOT EXISTS `organization_context_package_source_delete_guard`\nBEFORE DELETE ON `organization_context_package_sources`\nWHEN EXISTS(SELECT 1 FROM organization_context_package_versions version WHERE version.version_id=OLD.version_id AND version.organization_id=OLD.organization_id AND version.status='published')\n  AND NOT EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=OLD.organization_id AND deletion.status='processing')\nBEGIN SELECT RAISE(ABORT,'published_context_package_source_is_immutable'); END;","organization_context_package_version_delete_guard":"CREATE TRIGGER IF NOT EXISTS `organization_context_package_version_delete_guard`\nBEFORE DELETE ON `organization_context_package_versions`\nWHEN OLD.status='published' AND NOT EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=OLD.organization_id AND deletion.status='processing')\nBEGIN SELECT RAISE(ABORT,'published_context_package_is_immutable'); END;"};

type SchemaItem={type:string;name:string;table:string;sql:string};
const ddl=(sql:string)=>sql.trim().replace(/;$/u,"").replace(/^CREATE (TABLE|INDEX|UNIQUE INDEX|TRIGGER) IF NOT EXISTS /u,"CREATE $1 ");
function schemaItem(sql:string):SchemaItem {
  const text=ddl(sql),match=/^CREATE (TABLE|UNIQUE INDEX|INDEX|TRIGGER) [`"]?([A-Za-z0-9_]+)/u.exec(text);
  if(!match)return fail("schema_definition_invalid");
  const type=match[1]!.toLowerCase().replace("unique ",""),name=match[2]!;
  const table=type==="table"?name:/\bON\s+[`"]?([A-Za-z0-9_]+)/u.exec(text)?.[1];
  if(!table)return fail("schema_definition_invalid");return {type,name,table,sql:text};
}
/** This is a closed owned-graph schema boundary, not a database-wide catalog.
 * Unrelated application tables are outside it unless they declare a dependency
 * on a watched native parent. New guest/sponsor/output/Memory families require
 * explicit qualification here before this result inventory can use them. */
async function qualifyResultSchema(c:Captured,parts:Proof[]):Promise<Set<string>> {
  const families=[
    {required:true,definitions:OUTPUT_REQUIREMENTS_SCHEMA},
    {required:true,definitions:GUEST_CUSTODY_SCHEMA},
    {required:true,definitions:GUEST_SOURCE_SCHEMA},
    {required:true,definitions:[...baselineGuardDefinitions,PILOT_OWNER_REVOCATION_TRIGGER_SQL,PILOT_PARTICIPANT_OWNER_REVOCATION_TRIGGER_SQL,PILOT_OWNER_DELETION_TRIGGER_SQL,PILOT_PARTICIPANT_OWNER_DELETION_TRIGGER_SQL,PILOT_COHORT_DELETION_TRIGGER_SQL,EVENT_WRITE_STAGE_TRIGGER_SQL,PROJECT_NOTIFICATION_TRIGGER_SQL,
      "CREATE TRIGGER events_block_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END",
      "CREATE TRIGGER events_block_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'events are append-only'); END"]},
    {required:false,definitions:OUTPUT_DURABLE_SCHEMA},
    {required:false,definitions:HOLD_DISPOSITION_SCHEMA},
    {required:false,definitions:VIDEO_RECONCILIATION_SCHEMA},
    {required:false,definitions:SELECTED_OUTPUT_SHARE_SCHEMA},
    {required:false,definitions:GUEST_IMAGE_STAGE_CUSTODY_SCHEMA},
    {required:false,definitions:GUEST_IMAGE_RESULT_COPY_SCHEMA},
    {required:false,definitions:[...SCENE_SOURCE_GENERATION_TABLES,...SCENE_SOURCE_GENERATION_TRIGGERS].map(item=>item.sql)},
  ].map(family=>({...family,items:family.definitions.map(schemaItem)}));
  const tableNames=new Set([...families.flatMap(f=>f.items.filter(item=>item.type==="table").map(item=>item.name)),...c.history.sponsor.tables,
    ...memoryProfiles.flatMap(profile=>[...profile.tables])]);
  const explicitNames=new Set([...families.flatMap(f=>f.items.map(item=>item.name)),...memoryProfiles.flatMap(profile=>[...profile.names])]);
  // Existing sponsor qualification supplies exact supported family variants.
  const sponsor:unknown=JSON.parse(c.history.sponsor.snapshot);
  if(!Array.isArray(sponsor))return fail("sponsor_schema_invalid");
  for(const item of sponsor){if(!record(item)||typeof item.name!=="string")return fail("sponsor_schema_invalid");explicitNames.add(item.name);}
  const sql=`SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE lower(name) GLOB 'experience_guest_*' OR lower(tbl_name) GLOB 'experience_guest_*'
    OR lower(name) GLOB 'experience_sponsor_*' OR lower(tbl_name) GLOB 'experience_sponsor_*' OR lower(name) GLOB 'output_*' OR lower(tbl_name) GLOB 'output_*'
    OR lower(name) GLOB 'memory_*' OR lower(tbl_name) GLOB 'memory_*' OR name IN(SELECT value FROM json_each(?)) OR tbl_name IN(SELECT value FROM json_each(?)) ORDER BY name,type LIMIT 513`;
  const bindings:Value[]=[JSON.stringify([...explicitNames]),JSON.stringify([...tableNames])];
  const read=await c.life.wait(()=>c.ctx.db.prepare(sql).bind(...bindings).all<Record<string,unknown>>());
  if(!acknowledgement(read)||!Array.isArray(read.results)||read.results.length>512)return fail("schema_unavailable");
  const observed:SchemaItem[]=[],rawRows:Record<string,unknown>[]=[];
  for(let index=0;index<read.results.length;index++){
    const value=own(read.results,index);
    if(!record(value)||!exactKeys(value,["type","name","tbl_name","sql"])||typeof value.name!=="string"||typeof value.tbl_name!=="string"
      ||!['table','index','trigger'].includes(String(value.type))||value.sql!==null&&(typeof value.sql!=="string"||bytes(value.sql)>32768))return fail("schema_unavailable");
    rawRows.push({type:value.type,name:value.name,tbl_name:value.tbl_name,sql:value.sql});
    if(value.sql===null){if(value.type!=="index"||!tableNames.has(value.tbl_name)||!value.name.startsWith(`sqlite_autoindex_${value.tbl_name}_`)
      ||!/^\d+$/u.test(value.name.slice(`sqlite_autoindex_${value.tbl_name}_`.length)))return fail("schema_unknown");continue;}
    if(!explicitNames.has(value.name))return fail("schema_unknown");
    observed.push({type:String(value.type),name:value.name,table:value.tbl_name,sql:ddl(String(value.sql))});
  }
  const present=new Set(observed.filter(item=>item.type==="table").map(item=>item.name));
  for(const family of families){
    const names=new Set(family.items.map(item=>item.name)),found=observed.filter(item=>names.has(item.name));
    if(!found.length&&!family.required)continue;
    if(found.length!==family.items.length)return fail("schema_partial");
    for(const expected of family.items){const actual=found.find(item=>item.name===expected.name);
      if(!actual)return fail("schema_partial");
      // Native 3D upgrade renames exactly these two rebuilt tables, which
      // SQLite stores with a quoted table identifier. Inner DDL is unchanged.
      const alternate=expected.type==="table"&&["output_plan_targets","output_assets","output_asset_storage_writes"].includes(expected.name)
        ?{...expected,sql:expected.sql.replace(`CREATE TABLE ${expected.name}(`,`CREATE TABLE "${expected.name}"(`)}:expected;
      const journal=journalGuardVariants[expected.name];
      if(canonicalJson(actual)!==canonicalJson(expected)&&canonicalJson(actual)!==canonicalJson(alternate)
        &&(!journal||canonicalJson(actual)!==canonicalJson(schemaItem(journal))))return fail("schema_changed");
    }
  }
  // Migration0026 adds a column to0025's source table as well as its own
  // two objects. Only the complete exact0026 family selects that one native
  // post-ALTER base fingerprint; raw, missing and partial hybrids refuse.
  const conversationProfile=memoryProfiles[1],conversationNames=new Set<string>(conversationProfile.names);
  const conversationFound=observed.filter(item=>conversationNames.has(item.name)),conversationInstalled=conversationFound.length>0;
  if(conversationInstalled&&(conversationFound.length!==conversationProfile.count
    ||await c.life.wait(()=>digest(conversationFound))!==conversationProfile.digest))return fail("memory_schema_changed");
  for(const profile of memoryProfiles){const names=new Set<string>(profile.names),found=observed.filter(item=>names.has(item.name));
    const alteredBase=conversationInstalled&&profile.source==="0025_memory_live_base";
    if(!found.length){if(alteredBase)return fail("memory_schema_changed");continue;}
    const expected=alteredBase?"sha256:644e656e4552770a5f7900e543e412f0f8f8817fe01d7f6b3c6861badd522bb6":profile.digest;
    const actual=await c.life.wait(()=>digest(found));
    // Only the complete reviewed reference-only ledger rebuild is compatible.
    // Exact row/reference closure below is unchanged, including zero declarations.
    const referenceLedger=profile.source==="0032_memory_structured_conversation_ledger"
      && actual==="sha256:b862536ea89bab8480972ec79279bb07e04171a59b0717017903eaf0477fb5fa";
    if(found.length!==profile.count||actual!==expected&&!referenceLedger)return fail("memory_schema_changed");
  }
  const schemaSnapshot=`(SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql)) FROM(${sql.replace(' LIMIT 513','')}))`;
  parts.push({sql:`${schemaSnapshot}=?`,bindings:[...bindings,JSON.stringify(rawRows)]},
    {sql:"NOT EXISTS(SELECT 1 FROM temp.sqlite_schema)",bindings:[]});
  for(const [table,columns] of Object.entries({...coreColumns,events:eventColumns})){
    const expression="(SELECT json_group_array(json_object('name',name,'hidden',hidden)) FROM(SELECT name,hidden FROM pragma_table_xinfo(?,'main') ORDER BY cid))";
    // These column-qualified native tables have no foreign keys in either
    // their runtime definitions or retained migrations. Pin that exact empty
    // edge set: being a known table must not exempt a newly declared edge.
    const noForeignKeys="NOT EXISTS(SELECT 1 FROM pragma_foreign_key_list(?,'main'))";
    const found=await c.life.wait(()=>c.ctx.db.prepare(`SELECT ${expression} AS witness,${noForeignKeys} AS noForeignKeys`).bind(table,table).first<{witness:string;noForeignKeys:number}>());
    if(!found||typeof found.witness!=="string"||found.noForeignKeys!==1)return fail("native_schema_unavailable");
    let parsed:unknown;try{parsed=JSON.parse(found.witness);}catch{return fail("native_schema_unavailable");}
    if(!Array.isArray(parsed)||parsed.length!==columns.length||parsed.some(item=>!record(item)||!exactKeys(item,["name","hidden"])||item.hidden!==0||!columns.includes(String(item.name)))
      ||new Set(parsed.map(item=>String(item.name))).size!==columns.length)return fail("native_schema_changed");
    parts.push({sql:`${expression}=? AND ${noForeignKeys}`,bindings:[table,found.witness,table]});
  }
  // A new declared inbound relationship changes the closed graph even when
  // empty. Protected D1 engine tables without REFERENCES are not inspected.
  const watched=[...tableNames,...Object.keys(coreColumns),"events"],children=JSON.stringify(watched);
  parts.push({sql:`NOT EXISTS(SELECT 1 FROM main.sqlite_schema child,pragma_foreign_key_list(child.name,'main') fk
    WHERE child.type='table' AND instr(lower(child.sql),'references')>0
      AND lower(fk.[table]) IN(SELECT value FROM json_each(?)) AND child.name NOT IN(SELECT value FROM json_each(?)))`,bindings:[children,children]},
    {sql:`NOT EXISTS(SELECT 1 FROM main.sqlite_schema dependency WHERE dependency.type IN('view','trigger')
      AND (lower(dependency.tbl_name) IN(SELECT value FROM json_each(?)) OR EXISTS(SELECT 1 FROM json_each(?) watched WHERE instr(lower(dependency.sql),watched.value)>0))
      AND dependency.name NOT IN(SELECT value FROM json_each(?)))`,bindings:[children,children,JSON.stringify([...explicitNames])]});
  return present;
}
