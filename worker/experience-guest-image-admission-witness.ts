import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { selectImageAdapter } from "./image-adapter-selection.ts";
import { imageFormatEventFields } from "../src/model/image-format.ts";
import { normalizePromptTechnique } from "../src/model/prompt-structures.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { OutputJobBinding } from "./output-execution-control.ts";
import type { OutputNativeSettings } from "./output-document-execution.ts";
import type { ImageFormat } from "../src/model/image-format.ts";
import type { OutputConfirmedPlan, OutputPreflight } from "../src/model/output-delivery-contract.ts";
import { authoritativeCreativeContext } from "./context-authority.ts";
import { captureGuestImageStage, currentGuestImageStage, type GuestImageStageContext } from "./experience-guest-image-confirmation.ts";
import { collectRetainedGuestImageHistory, nativeBranches, unsupportedIdentityJson, boundedIdentityValue,
  eventWitness, eventColumns, bodyColumns, flatRow, commandColumns, resourceColumns, type Proof, type Row, type Value } from "./experience-guest-image-history.ts";
import { collectGuestImageStageFacts } from "./experience-guest-image-stage-facts.ts";
import { compileGuestSponsorEnvelope, type GuestImageAuthorizationV1 } from "./experience-guest-sponsor-contract.ts";
import { guestApprovedCampaignData, readApprovedGuestSponsorCampaign, type GuestApprovedCampaignWitness } from "./experience-guest-sponsor-approval.ts";
import type { GuestImageOutputInput } from "./experience-guest-image-stage-witness.ts";
import { GUEST_DB_NOW, guestFail } from "./experience-guest-session.ts";
import { uuidV7, makeEvent, type EventRow } from "./event-write-primitives.ts";
import { publicEventPayload } from "./event-privacy.ts";
import type { OutputScope, OutputSqlAssertion } from "./output-command-core.ts";
import type { OutputOperationSlot } from "./output-requirements-ledger.ts";
import { outputSchemaIsReady } from "./output-schema-state.ts";
import type { SponsorRecipe } from "./experience-sponsor-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (part: string): never => guestFail(`image_admission_${part}`);
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
const asProof = (p: OutputSqlAssertion): Proof => ({ sql: p.sql, bindings: [...p.bindings ?? []] });
const config = (env: WorkerEnv) => canonicalJson({ openai: env.OPENAI_API_KEY ?? null, model: env.OPENAI_MODEL ?? null,
  image: env.OPENAI_IMAGE_MODEL ?? null, provider: env.FORMA_IMAGE_PROVIDER ?? null, project: env.OPENAI_PROJECT ?? null,
  cohort: env.FORMA_PILOT_COHORT_ID ?? null, tokenUser: env.FORMA_USER_TOKEN_LIMIT ?? null, tokenWorkspace: env.FORMA_WORKSPACE_TOKEN_LIMIT ?? null,
  costUser: env.FORMA_USER_COST_LIMIT_USD ?? null, costWorkspace: env.FORMA_WORKSPACE_COST_LIMIT_USD ?? null });

class Lifetime {
  readonly deadline: number; readonly signal: AbortSignal; readonly configuration: string;
  readonly ctx: GuestImageStageContext;
  constructor(ctx: GuestImageStageContext, deadline?: number) {
    this.ctx = ctx;
    if (deadline !== undefined && !Number.isFinite(deadline)) fail("deadline_invalid");
    this.deadline = Math.min(performance.now() + 30_000, deadline ?? Infinity); this.signal = ctx.request.signal; this.configuration = config(ctx.env);
  }
  check() {
    currentGuestImageStage(this.ctx);
    if (this.ctx.request.signal !== this.signal || performance.now() >= this.deadline || config(this.ctx.env) !== this.configuration
      || !outputSchemaIsReady(this.ctx.db)) return fail("lifetime_changed");
  }
  async wait<T>(work: () => Promise<T>): Promise<T> {
    this.check(); let timer: ReturnType<typeof setTimeout> | undefined, stop: (() => void) | undefined;
    const ended = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("guest_image_admission_deadline")), Math.max(1, this.deadline - performance.now()));
      stop = () => reject(new Error("guest_image_admission_cancelled")); this.signal.addEventListener("abort", stop, { once: true }); if (this.signal.aborted) stop(); });
    try { const value = await Promise.race([work(), ended]); this.check(); return value; }
    finally { clearTimeout(timer); if (stop) this.signal.removeEventListener("abort", stop); }
  }
}

type History = Awaited<ReturnType<typeof collectRetainedGuestImageHistory>>;
type Facts = Awaited<ReturnType<typeof collectGuestImageStageFacts>>;
type Compiled = Awaited<ReturnType<typeof compileGuestSponsorEnvelope>>;
export type GuestImageAdmissionFrame = Readonly<{
  state: "issued" | "admitted"; actorKind: "guest"; actorUserId: string; ownerUserId: string; streamId: string;
  projectId: string; documentId: string; payerUserId: string; period: string; createdAt: string; expiresAt: string; expiresAtMs: number;
  sourceHead: number; planSourceHead: number; quoteHead: number; ownerHead: number; commandKey: string;
  scope: OutputScope; confirmedPlan: OutputConfirmedPlan; preflight: OutputPreflight; slot: OutputOperationSlot; recipe: SponsorRecipe;
  sourceEvents: readonly EventRow[]; context: ReturnType<typeof authoritativeCreativeContext>;
  target: OutputConfirmedPlan["plan"]["targets"][number]; render: { format: ImageFormat; size: `${number}x${number}` };
  /** Immutable source/payer proof only. Full graph closure is owned below. */
  assertions: readonly OutputSqlAssertion[];
}>;
export type GuestImageAdmissionBlueprint = Readonly<{ queue: EventRow; authorization: EventRow;
  commandDigest: string; payload: Record<string, unknown>; initialResult: Record<string, unknown> }>;
type Captured = { ctx: GuestImageStageContext; base: GuestImageOutputInput; life: Lifetime; approved: GuestApprovedCampaignWitness;
  history: History; facts: Facts; compiled: Compiled; issuerGrantId: string; issuerResourceId: string; frame: GuestImageAdmissionFrame;
  baseProofs: Proof[]; graphProofs: Proof[]; blueprint: GuestImageAdmissionBlueprint | null };
declare const brand: unique symbol;
export type GuestImageAdmissionAuthority = Readonly<{ [brand]: true }>;
const registry = new WeakMap<GuestImageAdmissionAuthority, Captured>();

const grantColumns = ["grant_id", "campaign_id", "policy_digest", "actor_user_id", "session_digest", "intent_key", "envelope_digest", "issued_at_ms", "expires_at_ms", "enabled"];
const issuanceColumns = ["grant_id", "campaign_id", "actor_user_id", "intent_key", "policy_digest", "driver_command_json", "command_digest", "envelope_digest", "envelope_json"];
const consumptionColumns = ["consumption_id", "grant_id", "campaign_id", "actor_user_id", "session_digest", "intent_key", "envelope_digest", "job_id", "maximum_microusd", "admitted_at_ms"];

async function row(life: Lifetime, table: string, columns: readonly string[], where: string, bindings: Value[], optional = false) {
  const bounded = columns.map(k => `(${k} IS NULL OR typeof(${k}) IN('integer','real') OR typeof(${k})='text' AND length(CAST(${k} AS BLOB))<=131072 AND instr(${k},char(0))=0)`).join(" AND ");
  const results = await life.wait(() => life.ctx.db.prepare(`SELECT CASE WHEN ${bounded} THEN ${objectSql(columns)} ELSE NULL END AS witness FROM ${table} WHERE ${where} LIMIT 2`).bind(...bindings).all<{ witness: string }>());
  if (!acknowledgement(results) || !Array.isArray(own(results, "results"))) return fail("row_ack");
  const rows = results.results;
  if (rows.length === 0) { if (optional) return null; return fail("row_missing"); }
  if (rows.length !== 1 || !Object.hasOwn(rows, 0) || typeof own(rows[0], "witness") !== "string") return fail("row_ambiguous");
  const raw = rows[0]!.witness; if (bytes(raw) > 262144) return fail("row_size");
  const parsed = nativeRow(raw, columns, 262144);
  return { value: parsed, proof: { sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${where} AND ${objectSql(columns)}=?)`, bindings: [...bindings, raw] } };
}
function equal(actual: unknown, expected: unknown) { if (canonicalJson(actual) !== canonicalJson(expected)) return fail("receipt_changed"); }
function eventFrom(value: Facts["tails"][number]): EventRow {
  if (!value.payload || value.row.redacted_at !== null) return fail("private_source_unavailable");
  const r = value.row; return { eventId: value.eventId, streamId: String(r.stream_id), sequence: Number(r.sequence), occurredAt: String(r.occurred_at),
    recordedAt: String(r.recorded_at), actor: String(r.actor), clientId: String(r.client_id), correlationId: String(r.correlation_id),
    causationId: null, compensatesEventId: null, schemaVersion: 1, type: String(r.type), payload: structuredClone(value.payload) };
}
function state(request: Request, env: WorkerEnv, authority: GuestImageAdmissionAuthority) {
  const captured = authority && typeof authority === "object" ? registry.get(authority) : undefined;
  if (!captured || captured.ctx.request !== request || captured.ctx.env !== env) return fail("capability_unavailable");
  captured.life.check(); guestApprovedCampaignData(request, env, captured.approved);
  if (Date.now() >= captured.frame.expiresAtMs || new Date().toISOString().slice(0, 7) !== captured.frame.period) return fail("expired");
  return captured;
}
export function requireGuestImageAdmissionFrame(request: Request, env: WorkerEnv, authority: GuestImageAdmissionAuthority) { return state(request, env, authority).frame; }

/** Every SELECT belongs to one atomic native read batch; false/null/sparse and
 * inherited/accessor acknowledgements cannot turn an absence into authority. */
async function prove(c: Captured, parts: readonly Proof[]) {
  c.life.check();
  const result = await c.life.wait(() => c.ctx.db.batch(parts.map(p => c.ctx.db.prepare(`SELECT CASE WHEN (${p.sql}) THEN 1 ELSE 0 END AS current`).bind(...p.bindings))));
  if (!Array.isArray(result) || result.length !== parts.length) return fail("proof_ack");
  for (let i = 0; i < result.length; i++) { const r = own(result, i), rows = own(r, "results");
    if (!acknowledgement(r) || !Array.isArray(rows) || rows.length !== 1 || own(own(rows, 0), "current") !== 1) return fail("proof_unavailable"); }
  c.life.check();
}

/** New complete native closure. Structural relation definitions are public
 * incomplete facts; no existing closed witness or SQL assertion is weakened. */
function closure(c: Captured, blueprint: GuestImageAdmissionBlueprint | null): Proof {
  const { frame: f, history: h, facts } = c, admitted = blueprint !== null;
  const ids = [...h.original.eventIds, ...facts.tails.map(t => t.eventId), ...(blueprint ? [blueprint.queue.eventId, blueprint.authorization.eventId] : [])];
  const scope = { ...facts.scope, ids: JSON.stringify(ids), commands: JSON.stringify([h.saved.commandKey, String(facts.rows.command.command_key), String(facts.rows.preflightCommand!.command_key), ...(admitted ? [f.commandKey] : [])]),
    resources: JSON.stringify([...facts.resources.map(r => r.resource_id), c.issuerResourceId]), issuer: c.issuerGrantId, admitted: admitted ? 1 : 0,
    grant: f.slot.grantId, slot: f.slot.slotId, job: f.slot.jobId, token: f.slot.tokenReservationId, cost: f.slot.costReservationId, consumption: c.compiled.envelope.consumptionId };
  const allowed: Record<string, string> = {
    output_commands: "d.scope_key=s.scope AND d.actor_user_id=s.guest AND d.command_key IN(SELECT value FROM json_each(s.commands))",
    output_plan_revisions: "d.scope_key=s.scope AND d.plan_revision_id=s.plan", output_plan_targets: "d.scope_key=s.scope AND d.plan_revision_id=s.plan AND d.target_id=s.target",
    output_preflights: "d.scope_key=s.scope AND d.preflight_id=s.quote", output_execution_grants: "s.admitted=1 AND d.scope_key=s.scope AND d.grant_id=s.grant",
    output_operation_slots: "s.admitted=1 AND d.scope_key=s.scope AND d.slot_id=s.slot", output_operation_routes: "s.admitted=1 AND d.scope_key=s.scope AND d.slot_id=s.slot",
    document_jobs: "s.admitted=1 AND d.job_id=s.job", budget_reservations: "s.admitted=1 AND d.reservation_id=s.token", cost_budget_reservations: "s.admitted=1 AND d.reservation_id=s.cost",
  };
  const rows = nativeBranches.map(([table, predicate]) => [table!, allowed[table!] ? `(${predicate}) AND NOT(${allowed[table!]})` : predicate!]);
  rows.push(["output_execution_grants", "d.grant_id=s.grant AND NOT(s.admitted=1 AND d.scope_key=s.scope AND d.grant_id=s.grant)"]);
  rows.push(["output_operation_slots", "(d.slot_id=s.slot OR d.grant_id=s.grant OR d.job_id=s.job OR d.token_reservation_id=s.token OR d.cost_reservation_id=s.cost) AND NOT(s.admitted=1 AND d.scope_key=s.scope AND d.slot_id=s.slot)"]);
  rows.push(["output_operation_routes", "d.slot_id=s.slot AND NOT(s.admitted=1 AND d.scope_key=s.scope AND d.slot_id=s.slot)"]);
  const add = (table: string, predicate: string) => { if (h.sponsor.tables.has(table)) rows.push([table, predicate]); };
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
  for (const t of ["experience_guest_context_adoptions", "experience_guest_image_claims"]) add(t, `${unsupportedIdentityJson("d.lineage_json", ["sessionId", "guestSubject", "projectId", "documentId"])} OR d.session_id=s.sessionId OR ${boundedIdentityValue("d.lineage_json", "guestSubject")}=s.guest OR ${boundedIdentityValue("d.lineage_json", "documentId")}=s.document OR ${boundedIdentityValue("d.lineage_json", "projectId")}=s.project`);
  add("experience_guest_plan_custodies", "d.session_id=s.sessionId OR d.draft_id=s.draft OR d.content_id=s.draft");
  rows.push(["experience_guest_claim_leases", "d.session_id=s.sessionId"]);
  for (const t of h.memory.registries) rows.push([t, "d.user_event_id IN(SELECT value FROM json_each(s.ids)) OR d.answer_event_id IN(SELECT value FROM json_each(s.ids))"]);
  const groups = Array.from({ length: Math.ceil(rows.length / 4) }, (_, i) => rows.slice(i * 4, i * 4 + 4));
  return { sql: `NOT EXISTS(WITH input(value) AS(VALUES(?)),s AS(SELECT ${Object.keys(scope).map(k => `json_extract(value,'$.${k}') AS ${k}`).join(",")} FROM input),
    ${groups.map((g, i) => `bad${i} AS MATERIALIZED(${g.map(([t, p]) => `SELECT 1 FROM ${t} d,s WHERE ${p}`).join(" UNION ALL ")} LIMIT 1)`).join(",")}
    SELECT 1 WHERE ${groups.map((_, i) => `EXISTS(SELECT 1 FROM bad${i})`).join(" OR ")})`, bindings: [JSON.stringify(scope)] };
}

/** Native SQL wrappers contain serialized private JSON, not UI strings. The
 * nested source is still validated separately by its closed structured parser. */
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
function head(c: Captured, admitted: boolean): Proof { const f = c.frame, n = f.quoteHead + (admitted ? 2 : 0);
  return { sql: `(SELECT COUNT(*) FROM events WHERE stream_id=?)=? AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
    AND (SELECT COUNT(*) FROM event_client_receipts WHERE stream_id=?)=?`, bindings: [f.streamId,n,f.streamId,n,f.streamId,f.sourceHead] }; }
function exact(table: string, values: Row): Proof { const columns = Object.keys(values); return { sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${objectSql(columns)}=?)`, bindings: [JSON.stringify(values)] }; }
function eventProof(event: EventRow, f: {ownerUserId:string;projectId:string|null;documentId:string|null}): Proof {
  const split = publicEventPayload(event.eventId, event.payload, true);
  const expected = {event_id:event.eventId,stream_id:event.streamId,sequence:event.sequence,occurred_at:event.occurredAt,recorded_at:event.recordedAt,
    actor:event.actor,client_id:event.clientId,correlation_id:event.correlationId,causation_id:event.causationId,compensates_event_id:event.compensatesEventId,
    schema_version:event.schemaVersion,type:event.type,payload:JSON.stringify(split.payload),owner_id:f.ownerUserId,project_id:f.projectId,document_id:f.documentId,
    private_json:split.privateJson,created_at:event.recordedAt,redacted_at:null};
  return {sql:`EXISTS(SELECT 1 FROM events e JOIN event_private_payloads body ON body.private_event_id=e.event_id WHERE ${eventWitness}=?)`,bindings:[JSON.stringify(expected)]};
}
function reference(f: GuestImageAdmissionFrame) { const s=f.slot;return {scopeKey:s.scopeKey,grantId:s.grantId,slotId:s.slotId,planRevisionId:s.planRevisionId,targetId:s.targetId,targetContractDigest:s.targetContractDigest,sourceDigest:s.sourceDigest}; }
function queue(f: GuestImageAdmissionFrame, eventId: string): EventRow { const event=makeEvent(f.streamId,f.quoteHead+1,f.actorUserId,"server:guest-output",f.commandKey,"OutputOperationJobQueued",
  {job_id:f.slot.jobId,document_id:f.documentId,kind:"generate",output_slot_id:f.slot.slotId,output_grant_id:f.slot.grantId,project_id:f.projectId,actor_user_id:f.actorUserId});
  return {...event,eventId,occurredAt:f.createdAt,recordedAt:f.createdAt}; }
function resultShape(f: GuestImageAdmissionFrame, env: WorkerEnv) { const s=f.slot, settings=f.preflight.targets[0]!.settings as {payload:Record<string,unknown>};return {artifactKind:String(settings.payload.artifactKind??""),generationReceipt:{artifact_kind:"image",provider:"openai",model:env.OPENAI_MODEL??"gpt-5.6-terra",
  reservation_microusd:s.maximumMicrousd,settled_cost_microusd:0,reservation_status:"active",source_transmission_status:"not_transmitted",provider_request_status:"not_submitted",output_slot_id:s.slotId,output_grant_id:s.grantId},
  stage:"queued",progressMessage:"The accepted generation and its private source receipt are safely recorded.",reservationId:s.tokenReservationId,costReservationId:s.costReservationId,
  costReservationPeriod:f.period,costReservationMicrousd:s.maximumMicrousd,outputExecution:reference(f),providerSubmissionProtocol:1}; }
function validatePayload(f: GuestImageAdmissionFrame, value: Record<string, unknown>) {
  const settings=f.preflight.targets[0]!.settings as {payload:Record<string,unknown>};
  const expected={...structuredClone(settings.payload),snapshot:structuredClone(f.context.snapshot),sourceBlockVersions:structuredClone(f.context.sourceBlockVersions),documentRevision:f.context.documentRevision,
    outputExecution:reference(f),preflightId:value.preflightId,preflightVersion:value.preflightVersion,preflightAcknowledged:value.preflightAcknowledged};
  if(typeof value.preflightId!=="string"||!id(value.preflightId)||value.preflightVersion!=="generation-readiness-v1"||typeof value.preflightAcknowledged!=="boolean")return fail("job_readiness_invalid");
  equal(value,expected);
}
async function blueprint(c: Captured, slot: OutputOperationSlot, createdAt: string, period: string, queueId: string, eventId: string, payload: Record<string,unknown>, initialResult: Record<string,unknown>) {
  const f={...c.frame,slot,createdAt,period};validatePayload(f,payload);equal(initialResult,resultShape(f,c.ctx.env));
  const marker={version:1,issuerGrantId:c.issuerGrantId,driverCommandDigest:c.history.saved.driver.commandDigest,sourceRevision:f.quoteHead,planSourceHead:f.planSourceHead,period,slot,queueEventId:queueId,payload,initialResult};
  const envelope={action:"authorize",documentId:f.documentId,expectedRevision:`output:${f.quoteHead}`,clientMutationId:f.commandKey,preflightId:f.preflight.id,planRevisionId:f.confirmedPlan.revisionId,
    termsDigest:f.preflight.termsDigest,maximumMicrousd:f.recipe.maximumMicrousd,targetIds:[f.target.id],explicitAuthorization:true,
    sponsor_entitlement:{consumption_id:c.compiled.envelope.consumptionId,envelope_digest:c.compiled.envelopeDigest,policy_digest:c.compiled.policyDigest},guest_image_admission:marker};
  const commandDigest=(await c.life.wait(()=>digest(envelope))).slice(7);
  const authorization=makeEvent(f.streamId,f.quoteHead+2,f.actorUserId,"server:guest-output",f.commandKey,"OutputExecutionAuthorized",
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
function nativeProofs(c: Captured, b: GuestImageAdmissionBlueprint): Proof[] {
  const f=c.frame,s=f.slot,e=c.compiled.envelope;const routes=(f.preflight.targets[0]!.settings as {calls:Array<{stage:string;provider:string;model:string;maximumMicrousd:number}>}).calls;
  const parts:Proof[]=[eventProof(b.queue,f),eventProof(b.authorization,f),
    exact("output_commands",{scope_key:f.scope.key,actor_user_id:f.actorUserId,command_key:f.commandKey,request_digest:b.commandDigest,action:"authorize",event_id:b.authorization.eventId,created_at:f.createdAt}),
    exact("output_execution_grants",{scope_key:f.scope.key,grant_id:s.grantId,plan_revision_id:s.planRevisionId,actor_user_id:f.actorUserId,payer_user_id:f.payerUserId,context_id:null,preflight_id:f.preflight.id,
      authorization_event_id:b.authorization.eventId,maximum_microusd:s.maximumMicrousd,maximum_calls:s.maximumCalls,status:"authorized",expires_at:f.expiresAt,created_at:f.createdAt}),
    exact("output_operation_slots",{scope_key:s.scopeKey,slot_id:s.slotId,grant_id:s.grantId,plan_revision_id:s.planRevisionId,target_id:s.targetId,target_contract_digest:s.targetContractDigest,source_digest:s.sourceDigest,
      provider:s.provider,model:s.model,route_digest:s.routeDigest,job_id:s.jobId,cost_reservation_id:s.costReservationId,token_reservation_id:s.tokenReservationId,maximum_microusd:s.maximumMicrousd,maximum_calls:s.maximumCalls,
      maximum_tokens:s.maximumTokens,attempt_ordinal:0,previous_slot_id:null,status:"authorized",outcome_event_id:null,created_at:f.createdAt,updated_at:f.createdAt}),
    exact("document_jobs",{job_id:s.jobId,owner_id:f.ownerUserId,stream_id:f.streamId,document_id:f.documentId,kind:"generate",status:"queued",source_surface:"outputs",correlation_id:s.jobId,requested_sequence:f.quoteHead+1,
      request_json:JSON.stringify(b.payload),result_json:JSON.stringify(b.initialResult),scene_source_version_json:null,scene_source_protocol:0,error_message:null,attempt_count:0,requested_at:f.createdAt,started_at:null,completed_at:null,lease_expires_at:null,notified_at:null,expires_at:f.expiresAt,updated_at:f.createdAt}),
    {sql:`(SELECT COUNT(*) FROM output_operation_routes WHERE scope_key=? AND slot_id=?)=?`,bindings:[s.scopeKey,s.slotId,routes.length]},
    ...routes.map(r=>exact("output_operation_routes",{scope_key:s.scopeKey,slot_id:s.slotId,stage_key:r.stage,provider:r.provider,model:r.model,maximum_calls:1})),
    {sql:`EXISTS(SELECT 1 FROM budget_reservations t JOIN cost_budget_reservations c ON c.owner_id=t.owner_id AND c.stream_id=t.stream_id AND c.correlation_id=t.correlation_id AND c.operation=t.operation AND c.period=t.period
      WHERE t.reservation_id=? AND c.reservation_id=? AND t.owner_id=? AND t.stream_id=? AND t.correlation_id=? AND t.operation='image-generation' AND t.period=?
      AND t.reserved_tokens=? AND c.reserved_microusd=? AND t.used_tokens=0 AND c.used_microusd=0 AND t.status='active' AND c.status='active' AND c.allow_user_overage=0
      AND t.settled_at IS NULL AND t.settlement_reason IS NULL AND c.settled_at IS NULL AND c.workspace_id='forma' AND t.created_at=? AND t.updated_at=t.created_at AND c.created_at>=? AND c.created_at=c.updated_at AND c.created_at< ? AND c.created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      bindings:[s.tokenReservationId,s.costReservationId,f.payerUserId,f.streamId,s.jobId,f.period,s.maximumTokens,s.maximumMicrousd,f.createdAt,f.createdAt,f.expiresAt]},
    {sql:`EXISTS(SELECT 1 FROM experience_sponsor_consumptions WHERE consumption_id=? AND grant_id=? AND campaign_id=? AND actor_user_id=? AND session_digest=? AND intent_key=? AND envelope_digest=? AND job_id=? AND maximum_microusd=?
      AND typeof(admitted_at_ms)='integer' AND admitted_at_ms>=? AND admitted_at_ms<=${GUEST_DB_NOW} AND admitted_at_ms<?)`,bindings:[e.consumptionId,c.issuerGrantId,e.campaignId,f.actorUserId,e.sessionDigest,e.intentKey,c.compiled.envelopeDigest,s.jobId,s.maximumMicrousd,Date.parse(f.createdAt),f.expiresAtMs]},
    exact("experience_sponsor_active_jobs",{actor_user_id:f.actorUserId,consumption_id:e.consumptionId,job_id:s.jobId}),
    ...["user","workspace"].flatMap(kind=>[{sql:`EXISTS(SELECT 1 FROM budget_counters WHERE scope=? AND scope_id=? AND period=? AND reserved_tokens>=? AND used_tokens>=0 AND used_tokens+reserved_tokens<=hard_limit_tokens)`,bindings:[kind,kind==="user"?f.payerUserId:"forma",f.period,s.maximumTokens]},
      {sql:`EXISTS(SELECT 1 FROM cost_budget_counters WHERE scope=? AND scope_id=? AND period=? AND reserved_microusd>=? AND used_microusd>=0 AND used_microusd+reserved_microusd<=hard_limit_microusd)`,bindings:[kind,kind==="user"?f.payerUserId:"forma",f.period,s.maximumMicrousd]}])];
  return parts;
}
function slotFrom(c: Pick<Captured,"facts"|"compiled">, scopeKey:string, ids?:{grantId:string;slotId:string;jobId:string;costReservationId:string;tokenReservationId:string}):OutputOperationSlot {
  const q=c.facts.quote!,p=c.facts.confirmed!,t=q.targets[0]!;
  if(q.targets.length!==1||!t.available||typeof t.provider!=="string"||!t.provider||typeof t.model!=="string"||!t.model)return fail("native_route_invalid");
  return {scopeKey,grantId:ids?.grantId??uuidV7(),slotId:ids?.slotId??uuidV7(),jobId:ids?.jobId??uuidV7(),costReservationId:ids?.costReservationId??uuidV7(),tokenReservationId:ids?.tokenReservationId??uuidV7(),
    planRevisionId:p.revisionId,targetId:t.targetId,targetContractDigest:p.targetContractDigests[t.targetId]!,sourceDigest:q.sourceDigest,provider:t.provider,model:t.model,routeDigest:c.compiled.envelope.recipe.routeDigest.slice(7),maximumMicrousd:t.maximumMicrousd,
    maximumCalls:t.maximumCalls,maximumTokens:t.maximumTokens,status:"authorized",attemptOrdinal:0,previousSlotId:null};
}

async function captureAdmission(request: Request, env: WorkerEnv, input: GuestImageOutputInput, ownerDeadline?:number):Promise<Captured> {
  const {ctx,base}=captureGuestImageStage(request,env,input),life=new Lifetime(ctx,ownerDeadline);life.check();
  const approved=await life.wait(()=>readApprovedGuestSponsorCampaign(request,env,{campaignId:base.campaignId,policyDigest:base.policyDigest}));
  const approval=guestApprovedCampaignData(request,env,approved);
  const history=await life.wait(()=>collectRetainedGuestImageHistory(request,env,{proof:base.proof}));
  const {original:o,saved:h}=history;
  if(o.source.draft_hash!==base.draftHash||h.approval.policyDigest!==base.policyDigest||h.approval.policy.campaignId!==base.campaignId
    ||h.approval.row.approval_id!==approval.approvalId||h.approval.termsDigest!==approval.termsDigest||!o.plan)return fail("source_changed");
  equal(approval.policy,h.approval.policy);
  const facts=await life.wait(()=>collectGuestImageStageFacts(history));
  if(facts.stageState!=="quoted"||!facts.quote||!facts.confirmed||!facts.transport||!facts.rows.preflightCommand||facts.tails.length!==3||facts.tails.some(t=>!t.payload))return fail("quote_required");
  const quote=facts.quote,confirmed=facts.confirmed,actor=String(o.session.guest_subject),commandKey=h.driver.stageKeys.authorize;
  if(!actor.startsWith("guest:")||approval.policy.payerUserId.startsWith("guest:")||actor===approval.policy.payerUserId)return fail("identity_invalid");
  const hash=(await life.wait(()=>digest({campaignId:base.campaignId,actorUserId:actor,intentKey:commandKey}))).slice(7);
  const issuerGrantId=`sponsor-issued-${hash}`,issuerResourceId=`sponsor-resource-issue-${hash}`;
  const issued=await row(life,"experience_sponsor_grants",grantColumns,"grant_id=?",[issuerGrantId]);
  const issuance=await row(life,"experience_sponsor_issuances",issuanceColumns,"grant_id=?",[issuerGrantId]);
  const resource=await row(life,"experience_sponsor_resource_receipts",resourceColumns,"resource_id=?",[issuerResourceId]);
  if(!issued||!issuance||!resource)return fail("issuance_required");
  const authorization:GuestImageAuthorizationV1={version:1,purpose:"authorize-guest-sponsored-image",sessionDigest:h.sessionDigest,guestSourceDigest:h.driver.command.guestSourceDigest,
    policyDigest:approval.policyDigest,termsDigest:quote.termsDigest,maximumMicrousd:quote.maximumMicrousd,preflightId:quote.id,explicitAuthorization:true};
  const sourceEvents=[...o.contextEvents,...facts.tails.map(eventFrom)],context=authoritativeCreativeContext(sourceEvents,{documentId:o.documentId,projectId:o.projectId});
  const compiled=await life.wait(()=>compileGuestSponsorEnvelope(approval.policy,json(issuance.value.envelope_json),{sessionBinding:h.sessionBinding.binding,authorization,
    native:{sourceRevision:facts.sourceHead+3,preflight:quote,contextSnapshot:context.snapshot,transport:facts.transport}}));
  const e=compiled.envelope;
  const clock=await life.wait(()=>ctx.db.prepare(`SELECT ${GUEST_DB_NOW} AS now_ms`).first<{now_ms:number}>());
  if(!clock||!Number.isSafeInteger(clock.now_ms)||clock.now_ms<0)return fail("clock_unavailable");
  const maximum=Math.min(h.maximum,Date.parse(quote.expiresAt),e.issuedAtMs+approval.policy.maximumGrantLifetimeMs);
  if(e.issuedAtMs<Date.parse(quote.createdAt)||e.issuedAtMs>clock.now_ms||e.expiresAtMs!==maximum||e.expiresAtMs<=clock.now_ms||compiled.policyDigest!==base.policyDigest||e.consumptionId!==`sponsor-consume-${hash}`)return fail("issuance_time_changed");
  equal(issued.value,{grant_id:issuerGrantId,campaign_id:base.campaignId,policy_digest:base.policyDigest,actor_user_id:actor,session_digest:h.sessionDigest,intent_key:commandKey,envelope_digest:compiled.envelopeDigest,issued_at_ms:e.issuedAtMs,expires_at_ms:e.expiresAtMs,enabled:1});
  equal(issuance.value,{grant_id:issuerGrantId,campaign_id:base.campaignId,actor_user_id:actor,intent_key:commandKey,policy_digest:base.policyDigest,driver_command_json:h.driver.commandJson,command_digest:e.guestAuthorizationDigest,envelope_digest:compiled.envelopeDigest,envelope_json:compiled.envelopeJson});
  equal(resource.value,{resource_id:issuerResourceId,campaign_id:base.campaignId,policy_digest:base.policyDigest,limits_digest:h.limitsDigest,actor_user_id:actor,session_digest:h.sessionDigest,operation:"issuance",intent_key:commandKey,
    payload_digest:compiled.envelopeDigest,text_bytes:bytes(canonicalJson(context.snapshot)),issued_grant_id:issuerGrantId,recorded_at_ms:resource.value.recorded_at_ms});
  if(!Number.isSafeInteger(resource.value.recorded_at_ms)||Number(resource.value.recorded_at_ms)<e.issuedAtMs||Number(resource.value.recorded_at_ms)>clock.now_ms||Number(resource.value.recorded_at_ms)>=e.expiresAtMs)return fail("issuance_resource_time_changed");
  const scope:OutputScope={kind:"personal",key:h.scopeKey,ownerUserId:actor,actorUserId:actor,projectId:o.projectId,documentId:o.documentId,organizationId:null,projectAccessId:null,contextId:null};
  const baseProofs=[...o.parts,...history.currentGuards,history.sponsor.proof,history.memory.proof,...facts.stageParts,...facts.tailProofs,facts.blockCustodyProof,facts.recordedTimeProof,
    asProof(approval.assertion),issued.proof,issuance.proof,resource.proof,
    {sql:`EXISTS(SELECT 1 FROM experience_guest_source_policies WHERE policy_id=? AND revoked_at_ms IS NULL) AND ${GUEST_DB_NOW}>=? AND ${GUEST_DB_NOW}<? AND strftime('%Y-%m','now')=?`,bindings:[o.source.policy_id,e.issuedAtMs,e.expiresAtMs,new Date(clock.now_ms).toISOString().slice(0,7)]}];
  const settings=quote.targets[0]!.settings as {imageRender:GuestImageAdmissionFrame["render"]};
  const frame:GuestImageAdmissionFrame=freeze({state:"issued",actorKind:"guest",actorUserId:actor,ownerUserId:actor,streamId:`creative:${actor}`,projectId:o.projectId,documentId:o.documentId,payerUserId:approval.policy.payerUserId,
    period:new Date(clock.now_ms).toISOString().slice(0,7),createdAt:new Date(clock.now_ms).toISOString(),expiresAt:new Date(e.expiresAtMs).toISOString(),expiresAtMs:e.expiresAtMs,
    sourceHead:facts.sourceHead,planSourceHead:facts.sourceHead+1,quoteHead:facts.sourceHead+3,ownerHead:facts.sourceHead+3,commandKey,scope,confirmedPlan:confirmed,preflight:quote,
    slot:slotFrom({facts,compiled},scope.key),recipe:e.recipe,sourceEvents,context,target:confirmed.plan.targets[0]!,render:settings.imageRender,assertions:structuredClone(baseProofs)});
  const c:Captured={ctx,base,life,approved,history,facts,compiled,issuerGrantId,issuerResourceId,frame,baseProofs,graphProofs:[],blueprint:null};
  const command=await row(life,"output_commands",commandColumns,"scope_key=? AND actor_user_id=? AND command_key=?",[scope.key,actor,commandKey],true);
  if(command)await readNative(c,command.value);
  return c;
}

// The original admission API still proves the exact strict issued/admitted graph.
async function collect(request: Request, env: WorkerEnv, input: GuestImageOutputInput, ownerDeadline?:number):Promise<GuestImageAdmissionAuthority> {
  const c=await captureAdmission(request,env,input,ownerDeadline),{life,approved}=c;
  c.graphProofs=freeze([...c.baseProofs,head(c,c.blueprint!==null),closure(c,c.blueprint),...(c.blueprint?nativeProofs(c,c.blueprint):[])]);
  await prove(c,c.graphProofs);life.check();guestApprovedCampaignData(request,env,approved);
  const authority=Object.freeze(Object.create(null)) as GuestImageAdmissionAuthority;registry.set(authority,c);state(request,env,authority);return authority;
}

async function readNative(c:Captured,command:Row) {
  const original=c.frame;
  if(command.action!=="authorize"||!id(command.event_id)||!iso(command.created_at)||Date.parse(command.created_at)<c.compiled.envelope.issuedAtMs||Date.parse(command.created_at)>=original.expiresAtMs)return fail("native_command_invalid");
  const found=await c.life.wait(()=>c.ctx.db.prepare(`SELECT CASE WHEN length(CAST(body.private_json AS BLOB))<=131072 AND length(CAST(e.payload AS BLOB))<=65536 THEN ${eventWitness} ELSE NULL END AS witness
    FROM events e JOIN event_private_payloads body ON body.private_event_id=e.event_id WHERE e.event_id=? LIMIT 2`).bind(command.event_id).all<{witness:string}>());
  const rows=own(found,"results");
  if(!acknowledgement(found)||!Array.isArray(rows)||rows.length!==1||typeof own(own(rows,0),"witness")!=="string")return fail("native_event_unavailable");
  const event=nativeRow(own(own(rows,0),"witness"),[...eventColumns,...bodyColumns],131072),payload=json(event.private_json);
  const envelope=payload.output_command_envelope;
  if(!record(envelope)||!record(envelope.guest_image_admission))return fail("native_marker_invalid");
  const m=envelope.guest_image_admission;
  if(!exactKeys(m,["version","issuerGrantId","driverCommandDigest","sourceRevision","planSourceHead","period","slot","queueEventId","payload","initialResult"])||m.version!==1
    ||m.issuerGrantId!==c.issuerGrantId||m.driverCommandDigest!==c.history.saved.driver.commandDigest||m.sourceRevision!==original.quoteHead||m.planSourceHead!==original.planSourceHead
    ||m.period!==original.period||!record(m.slot)||!id(m.queueEventId)||!record(m.payload)||!record(m.initialResult))return fail("native_marker_invalid");
  const slot=m.slot;
  if(![slot.grantId,slot.slotId,slot.jobId,slot.costReservationId,slot.tokenReservationId].every(id)
    ||new Set([slot.grantId,slot.slotId,slot.jobId,slot.costReservationId,slot.tokenReservationId,m.queueEventId,command.event_id]).size!==7)return fail("native_identity_invalid");
  const expected=slotFrom(c,original.scope.key,slot as {grantId:string;slotId:string;jobId:string;costReservationId:string;tokenReservationId:string});equal(slot,expected);
  c.frame=freeze({...original,state:"admitted",slot:expected,createdAt:command.created_at,ownerHead:original.quoteHead+2});
  const b=await blueprint(c,expected,command.created_at,original.period,m.queueEventId,command.event_id,m.payload,m.initialResult);
  if(command.request_digest!==b.commandDigest)return fail("native_digest_changed");
  equal(payload,b.authorization.payload);c.blueprint=b;
  // These exact observed financial receipts join the semantic proof below.
  // Preparation time belongs to the unchanged native cost primitive.
  const tokenColumns=["reservation_id","owner_id","stream_id","correlation_id","operation","period","reserved_tokens","used_tokens","status","settlement_reason","created_at","settled_at","updated_at"];
  const costColumns=["reservation_id","owner_id","workspace_id","stream_id","correlation_id","operation","period","reserved_microusd","used_microusd","status","allow_user_overage","created_at","settled_at","updated_at"];
  for(const [table,columns,key,value] of [["budget_reservations",tokenColumns,"reservation_id",expected.tokenReservationId],["cost_budget_reservations",costColumns,"reservation_id",expected.costReservationId],
    ["experience_sponsor_consumptions",consumptionColumns,"consumption_id",c.compiled.envelope.consumptionId]] as const){
    const observed=await row(c.life,table,columns,`${key}=?`,[value]);if(!observed)return fail("native_receipt_missing");c.baseProofs.push(observed.proof);
  }
}

/** A separate dormant native protocol. It never weakens the four-state or
 * issuer witness and cannot be used by a canonical PilotUser entry. */
export function createGuestImageAdmissionAuthority(request:Request,env:WorkerEnv,base:GuestImageOutputInput,ownerDeadline?:number) {
  return collect(request,env,base,ownerDeadline);
}
export function guestImageAdmissionInternal(request:Request,env:WorkerEnv,authority:GuestImageAdmissionAuthority) {
  const c=state(request,env,authority);
  return {base:c.base,deadline:c.life.deadline,compiled:c.compiled,issuerGrantId:c.issuerGrantId,beforeAssertions:c.graphProofs,
    blueprint:c.blueprint,wait:<T>(work:()=>Promise<T>)=>c.life.wait(work),check:()=>{state(request,env,authority);}};
}
export async function prepareGuestImageAdmissionBlueprint(request:Request,env:WorkerEnv,authority:GuestImageAdmissionAuthority,
  job:import("./document-jobs-api.ts").PreparedGuestImageDocumentJob):Promise<GuestImageAdmissionBlueprint> {
  const c=state(request,env,authority),f=c.frame,s=f.slot;
  if(f.state!=="issued"||c.blueprint||job.jobId!==s.jobId||job.documentId!==f.documentId||job.kind!=="generate"||job.sourceHead!==f.quoteHead||job.budgetOwnerId!==f.payerUserId
    ||job.createdAt!==f.createdAt||job.expiresAt!==f.expiresAt||job.maximumTokens!==s.maximumTokens||job.maximumCalls!==s.maximumCalls)return fail("prepared_job_changed");
  equal(job.identity,{actorKind:"guest",actorUserId:f.actorUserId,ownerUserId:f.ownerUserId,streamId:f.streamId});
  const {providerSubmissionProtocol: protocol,...nativeInitial}=structuredClone(job.initialResult);
  if(protocol!==1)return fail("prepared_job_changed");
  const initialResult={...nativeInitial,reservationId:s.tokenReservationId,costReservationId:s.costReservationId,costReservationPeriod:f.period,costReservationMicrousd:s.maximumMicrousd,
    outputExecution:reference(f),generationReceipt:{...(job.initialResult.generationReceipt as Record<string,unknown>),reservation_status:"active",reservation_microusd:s.maximumMicrousd,output_slot_id:s.slotId,output_grant_id:s.grantId},providerSubmissionProtocol:1};
  const b=await blueprint(c,s,f.createdAt,f.period,uuidV7(),uuidV7(),job.payload,initialResult);state(request,env,authority);return b;
}
export async function guestImageAdmissionSuccessor(request:Request,env:WorkerEnv,authority:GuestImageAdmissionAuthority,b:GuestImageAdmissionBlueprint):Promise<OutputSqlAssertion[]> {
  const c=state(request,env,authority),f=c.frame;
  if(f.state!=="issued"||c.blueprint||jsonIssues(b).length||!id(b.queue?.eventId)||!id(b.authorization?.eventId))return fail("successor_unavailable");
  const expected=await blueprint(c,f.slot,f.createdAt,f.period,b.queue.eventId,b.authorization.eventId,b.payload,b.initialResult);state(request,env,authority);equal(b,expected);
  return freeze([...c.baseProofs,head(c,true),closure(c,b),...nativeProofs(c,b)]);
}
export function guestImageAdmissionReceipt(request:Request,env:WorkerEnv,authority:GuestImageAdmissionAuthority,replayed:boolean) {
  const c=state(request,env,authority),f=c.frame;if(f.state!=="admitted"||!c.blueprint)return fail("original_unavailable");
  const result=freeze({status:"admitted" as const,documentId:f.documentId,preflightId:f.preflight.id,grantId:f.slot.grantId,sponsorGrantId:c.issuerGrantId,
    consumptionId:c.compiled.envelope.consumptionId,jobId:f.slot.jobId,slotId:f.slot.slotId,commandKey:f.commandKey,eventId:c.blueprint.authorization.eventId,expiresAt:f.expiresAt,replayed,
    nativeAuthorizationCommitted:true,admissionCommitted:true,generationAvailable:false,custodyTransferred:false});state(request,env,authority);return result;
}

/** The Run continuation is a different capability. The admission capability
 * above continues to reject every Run or provider descendant. */
declare const runBrand: unique symbol;
export type GuestImageRunWitness=Readonly<{[runBrand]:true}>;
export type GuestImageRunPhase="admitted"|"queued"|"running"|"committing"|"completed"|"failed"|"interrupted";
type RunRows={job:Row;grant:Row;slot:Row;token:Row;cost:Row;consumption:Row;active:Row|null;calls:Row[];storage:Row[];content:Row[]};
type RunCapture={admission:Captured;phase:GuestImageRunPhase;runKey:string;runCommand:Row|null;runEvent:EventRow|null;
  events:EventRow[];rows:RunRows;proofs:Proof[];sourceProofs:Proof[];settings:OutputNativeSettings};
const runRegistry=new WeakMap<GuestImageRunWitness,RunCapture>();
/** Preparation still has the admission reader's 30-second bound. Only a proven
 * native Run receives this distinct transport lifetime, never beyond its first
 * Request deadline or the unchanged original issuer/source expiry. */
class RunLifetime extends Lifetime {
  override readonly deadline:number;
  constructor(ctx:GuestImageStageContext,deadline:number){super(ctx,deadline);this.deadline=deadline;}
}
const jobColumns=["job_id","owner_id","stream_id","document_id","kind","status","source_surface","correlation_id","requested_sequence","request_json","result_json","scene_source_version_json","scene_source_protocol","error_message","attempt_count","requested_at","started_at","completed_at","lease_expires_at","notified_at","expires_at","updated_at"];
const nativeGrantColumns=["scope_key","grant_id","plan_revision_id","actor_user_id","payer_user_id","context_id","preflight_id","authorization_event_id","maximum_microusd","maximum_calls","status","expires_at","created_at"];
const slotColumns=["scope_key","slot_id","grant_id","plan_revision_id","target_id","target_contract_digest","source_digest","provider","model","route_digest","job_id","cost_reservation_id","token_reservation_id","maximum_microusd","maximum_calls","maximum_tokens","attempt_ordinal","previous_slot_id","status","outcome_event_id","created_at","updated_at"];
const tokenColumns=["reservation_id","owner_id","stream_id","correlation_id","operation","period","reserved_tokens","used_tokens","status","settlement_reason","created_at","settled_at","updated_at"];
const costColumns=["reservation_id","owner_id","workspace_id","stream_id","correlation_id","operation","period","reserved_microusd","used_microusd","status","allow_user_overage","created_at","settled_at","updated_at"];
const callColumns=["scope_key","slot_id","call_key","client_request_id","request_digest","stage_key","provider","model","reserved_microusd","used_microusd","status","provider_response_id","created_at","settled_at"];
const storageColumns=["scope_key","slot_id","storage_key","content_sha256","status","write_acknowledged","publication_event_id","created_at","updated_at"];
const contentColumns=["content_id","owner_id","kind","content","created_at","expires_at","redacted_at"];
const nonnegative=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
function runState(request:Request,env:WorkerEnv,witness:GuestImageRunWitness){
  const r=witness&&typeof witness==="object"?runRegistry.get(witness):undefined;
  if(!r||r.admission.ctx.request!==request||r.admission.ctx.env!==env)return fail("run_capability_unavailable");
  const c=r.admission;c.life.check();guestApprovedCampaignData(request,env,c.approved);
  if(Date.now()>=c.frame.expiresAtMs||new Date().toISOString().slice(0,7)!==c.frame.period)return fail("expired");
  return r;
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
  const f=c.frame;return {...makeEvent(f.streamId,f.quoteHead+3,f.actorUserId,"server:guest-output",runKey,"OutputExecutionRunRequested",
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

/** Complete Run graph closure. It grants no exceptions to the admission closure. */
function runClosure(r:RunCapture):Proof {
  const c=r.admission,{frame:f,history:h,facts}=c,blueprint=c.blueprint!,admitted=true;
  const ids = [...h.original.eventIds, ...facts.tails.map(t => t.eventId), blueprint.queue.eventId,blueprint.authorization.eventId,...r.events.map(event=>event.eventId)];
  const scope = { ...facts.scope, ids: JSON.stringify(ids), commands: JSON.stringify([h.saved.commandKey, String(facts.rows.command.command_key), String(facts.rows.preflightCommand!.command_key), f.commandKey,...(r.runCommand?[r.runKey]:[])]),
    resources: JSON.stringify([...facts.resources.map(r => r.resource_id), c.issuerResourceId]), issuer: c.issuerGrantId, admitted: admitted ? 1 : 0,
    grant: f.slot.grantId, slot: f.slot.slotId, job: f.slot.jobId, token: f.slot.tokenReservationId, cost: f.slot.costReservationId, consumption: c.compiled.envelope.consumptionId, bodyIds:JSON.stringify(r.rows.content.map(row=>row.content_id)), callKeys:JSON.stringify(r.rows.calls.map(row=>row.call_key)), callIds:JSON.stringify(r.rows.calls.map(row=>row.client_request_id)), storageKeys:JSON.stringify(r.rows.storage.map(row=>row.storage_key)), correlation:String(r.rows.job.correlation_id) };
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
  const rows = nativeBranches.map(([table, predicate]) => [table!, allowed[table!] ? `(${predicate}) AND NOT(${allowed[table!]})` : predicate!]);
  rows.push(["output_execution_grants", "d.grant_id=s.grant AND NOT(s.admitted=1 AND d.scope_key=s.scope AND d.grant_id=s.grant)"]);
  rows.push(["output_operation_slots", "(d.slot_id=s.slot OR d.grant_id=s.grant OR d.job_id=s.job OR d.token_reservation_id=s.token OR d.cost_reservation_id=s.cost) AND NOT(s.admitted=1 AND d.scope_key=s.scope AND d.slot_id=s.slot)"]);
  rows.push(["output_operation_routes", "d.slot_id=s.slot AND NOT(s.admitted=1 AND d.scope_key=s.scope AND d.slot_id=s.slot)"]);
  rows.push(["output_provider_calls","(d.slot_id=s.slot OR d.client_request_id IN(SELECT value FROM json_each(s.callIds))) AND NOT(d.scope_key=s.scope AND d.slot_id=s.slot AND d.call_key IN(SELECT value FROM json_each(s.callKeys)))"]);
  rows.push(["output_native_storage_writes","(d.slot_id=s.slot OR d.storage_key IN(SELECT value FROM json_each(s.storageKeys))) AND NOT(d.scope_key=s.scope AND d.slot_id=s.slot AND d.storage_key IN(SELECT value FROM json_each(s.storageKeys)))"]);
  rows.push(["events","d.correlation_id=s.correlation AND d.event_id NOT IN(SELECT value FROM json_each(s.ids))"]);
  const add = (table: string, predicate: string) => { if (h.sponsor.tables.has(table)) rows.push([table, predicate]); };
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
  for (const t of ["experience_guest_context_adoptions", "experience_guest_image_claims"]) add(t, `${unsupportedIdentityJson("d.lineage_json", ["sessionId", "guestSubject", "projectId", "documentId"])} OR d.session_id=s.sessionId OR ${boundedIdentityValue("d.lineage_json", "guestSubject")}=s.guest OR ${boundedIdentityValue("d.lineage_json", "documentId")}=s.document OR ${boundedIdentityValue("d.lineage_json", "projectId")}=s.project`);
  add("experience_guest_plan_custodies", "d.session_id=s.sessionId OR d.draft_id=s.draft OR d.content_id=s.draft");
  rows.push(["experience_guest_claim_leases", "d.session_id=s.sessionId"]);
  for (const t of h.memory.registries) rows.push([t, "d.user_event_id IN(SELECT value FROM json_each(s.ids)) OR d.answer_event_id IN(SELECT value FROM json_each(s.ids))"]);
  const groups = Array.from({ length: Math.ceil(rows.length / 4) }, (_, i) => rows.slice(i * 4, i * 4 + 4));
  return { sql: `NOT EXISTS(WITH input(value) AS(VALUES(?)),s AS(SELECT ${Object.keys(scope).map(k => `json_extract(value,'$.${k}') AS ${k}`).join(",")} FROM input),
    ${groups.map((g, i) => `bad${i} AS MATERIALIZED(${g.map(([t, p]) => `SELECT 1 FROM ${t} d,s WHERE ${p}`).join(" UNION ALL ")} LIMIT 1)`).join(",")}
    SELECT 1 WHERE ${groups.map((_, i) => `EXISTS(SELECT 1 FROM bad${i})`).join(" OR ")})`, bindings: [JSON.stringify(scope)] };
}


async function validateRunEvents(r:RunCapture){
  const c=r.admission,f=c.frame,s=f.slot,job=r.rows.job,events=r.events.slice(1),settings=r.settings;
  if(!r.runEvent){if(r.events.length||events.length)return fail("run_event_without_command");return;}
  if(!events.length)return;
  if(job.attempt_count!==1)return fail("run_events_without_claim");
  const planner=settings.calls[0]!,image=settings.calls[1]!,selection=selectImageAdapter(c.ctx.env,{quality:"high",size:f.render.size,references:[]});
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
      ||typeof call.client_request_id!=="string"||!call.client_request_id||typeof call.request_digest!=="string"||!call.request_digest||!iso(call.created_at)||Date.parse(call.created_at)<Date.parse(String(job.started_at))||Date.parse(call.created_at)>=f.expiresAtMs)return fail("run_provider_call_changed");
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
  for(const body of content){if(!id(body.content_id)||body.owner_id!==f.ownerUserId||!["provider-output","prompt"].includes(String(body.kind))||typeof body.content!=="string"||!body.content||body.redacted_at!==null
    ||!iso(body.created_at)||!iso(body.expires_at)||Date.parse(body.created_at)<Date.parse(String(job.started_at))||Date.parse(body.created_at)>=f.expiresAtMs||Date.parse(body.expires_at)<=Date.now())return fail("run_private_body_changed");}
  if(job.status==="completed"&&(end?.type!=="GenerationCompleted"||!settled))return fail("run_terminal_mismatch");
  // A local terminal-write failure may follow the genuine success event. Keep
  // that historical failure; the output event never authorizes another Run.
  if(terminal&&end&&(job.status==="completed"||result.appendedEventIds!==undefined)){equal(result.appendedEventIds,r.events.slice(1).map(event=>event.eventId));if(result.head!==r.events.at(-1)!.sequence||result.previewed!==false||result.previewQueued!==false||result.previewSuppressed!==false||result.promoted!==false)return fail("run_terminal_result_changed");}
  r.phase=!r.runEvent?"admitted":!claimed?"queued":job.status==="canceled"||job.status==="failed"&&end?.type!=="GenerationFailed"||exceeded||knownTokens>s.maximumTokens?"interrupted":job.status as GuestImageRunPhase;
}

function immutableAdmissionProofs(c:Captured):Proof[]{
  const f=c.frame,s=f.slot,b=c.blueprint!,routes=(f.preflight.targets[0]!.settings as OutputNativeSettings).calls;
  return [...f.assertions.map(asProof),eventProof(b.queue,f),eventProof(b.authorization,f),
    exact("output_commands",{scope_key:f.scope.key,actor_user_id:f.actorUserId,command_key:f.commandKey,request_digest:b.commandDigest,action:"authorize",event_id:b.authorization.eventId,created_at:f.createdAt}),
    exact("output_execution_grants",{scope_key:f.scope.key,grant_id:s.grantId,plan_revision_id:s.planRevisionId,actor_user_id:f.actorUserId,payer_user_id:f.payerUserId,context_id:null,preflight_id:f.preflight.id,authorization_event_id:b.authorization.eventId,maximum_microusd:s.maximumMicrousd,maximum_calls:s.maximumCalls,expires_at:f.expiresAt,created_at:f.createdAt}),
    {sql:"(SELECT COUNT(*) FROM output_operation_routes WHERE scope_key=? AND slot_id=?)=?",bindings:[s.scopeKey,s.slotId,routes.length]},
    ...routes.map(route=>exact("output_operation_routes",{scope_key:s.scopeKey,slot_id:s.slotId,stage_key:route.stage,provider:route.provider,model:route.model,maximum_calls:1}))];
}
function runGraphProofs(r:RunCapture):Proof[]{
  const c=r.admission,f=c.frame,s=f.slot,values=r.rows,n=f.quoteHead+2+r.events.length;
  const entries:Array<[string,Row]>=[["document_jobs",values.job],["output_execution_grants",values.grant],["output_operation_slots",values.slot],["budget_reservations",values.token],["cost_budget_reservations",values.cost],["experience_sponsor_consumptions",values.consumption]];
  return [...r.sourceProofs,...entries.map(([table,value])=>exact(table,value)),
    ...observedProofs("experience_sponsor_active_jobs",["actor_user_id","consumption_id","job_id"],"actor_user_id=? OR consumption_id=? OR job_id=?",[f.actorUserId,c.compiled.envelope.consumptionId,s.jobId],values.active?[values.active]:[]),
    ...observedProofs("output_provider_calls",callColumns,"scope_key=? AND slot_id=?",[s.scopeKey,s.slotId],values.calls),
    ...observedProofs("output_native_storage_writes",storageColumns,"scope_key=? AND slot_id=?",[s.scopeKey,s.slotId],values.storage),
    ...observedProofs("private_content",contentColumns,"owner_id=? AND content_id<>?",[f.ownerUserId,String(c.history.original.source.draft_id)],values.content),
    ...r.events.map(event=>progressEventProof(event,c)),...(r.runCommand?[exact("output_commands",r.runCommand)]:[]),
    {sql:"(SELECT COUNT(*) FROM events WHERE stream_id=?)=? AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND (SELECT COUNT(*) FROM event_client_receipts WHERE stream_id=?)=?",bindings:[f.streamId,n,f.streamId,n,f.streamId,f.sourceHead]},
    ...["user","workspace"].flatMap(kind=>[
      {sql:"EXISTS(SELECT 1 FROM budget_counters WHERE scope=? AND scope_id=? AND period=? AND reserved_tokens>=? AND used_tokens>=? )",bindings:[kind,kind==="user"?f.payerUserId:"forma",f.period,values.token.status==="active"?s.maximumTokens:0,Number(values.token.used_tokens)]},
      {sql:"EXISTS(SELECT 1 FROM cost_budget_counters WHERE scope=? AND scope_id=? AND period=? AND reserved_microusd>=? AND used_microusd>=? )",bindings:[kind,kind==="user"?f.payerUserId:"forma",f.period,["active","executing"].includes(String(values.cost.status))?s.maximumMicrousd:0,Number(values.cost.used_microusd)]}]),runClosure(r)];
}
async function captureRun(request:Request,env:WorkerEnv,base:GuestImageOutputInput,deadline?:number):Promise<GuestImageRunWitness>{
  if(deadline!==undefined&&!Number.isFinite(deadline))return fail("run_deadline_invalid");
  const runDeadline=Math.min(performance.now()+OUTPUT_NATIVE_EXECUTION_POLICY.maximumMilliseconds,deadline??Infinity);
  const c=await captureAdmission(request,env,base,runDeadline),f=c.frame,s=f.slot;
  if(f.state!=="admitted"||!c.blueprint)return fail("run_admission_required");
  const settings=structuredClone(f.preflight.targets[0]!.settings) as OutputNativeSettings;
  if(settings.kind!=="generate"||settings.payload.productionMode!=="manual"||!settings.imageRender||settings.calls.length!==2||settings.calls[0]?.stage!=="planning:initial"||settings.calls[1]?.stage!=="image:initial"||settings.calls.some(route=>route.provider!=="openai")||s.provider!=="openai")return fail("run_recipe_unsupported");
  equal(settings.executionPolicy,OUTPUT_NATIVE_EXECUTION_POLICY);
  c.life.check();c.life=new RunLifetime(c.ctx,Math.min(runDeadline,performance.now()+Math.max(0,f.expiresAtMs-Date.now())));c.life.check();
  const runKey=c.history.saved.driver.stageKeys.run,command=await row(c.life,"output_commands",commandColumns,"scope_key=? AND actor_user_id=? AND command_key=?",[f.scope.key,f.actorUserId,runKey],true);
  const events=await progressEvents(c);let runEvent:EventRow|null=null;
  if(command){
    if(!id(command.value.event_id)||!iso(command.value.created_at)||Date.parse(command.value.created_at)<Date.parse(f.createdAt)||Date.parse(command.value.created_at)>=f.expiresAtMs)return fail("run_command_changed");
    const commandDigest=(await c.life.wait(()=>digest(runCommandValue(c,runKey)))).slice(7);
    equal(command.value,{scope_key:f.scope.key,actor_user_id:f.actorUserId,command_key:runKey,request_digest:commandDigest,action:"run",event_id:command.value.event_id,created_at:command.value.created_at});
    runEvent=runEventValue(c,runKey,String(command.value.event_id),String(command.value.created_at));equal(events[0],runEvent);
  }else if(events.length)return fail("run_command_missing");
  const required=async(table:string,columns:readonly string[],where:string,bindings:Value[])=>{const found=await row(c.life,table,columns,where,bindings);if(!found)return fail("run_native_row_missing");return found.value;};
  const rows:RunRows={
    job:await required("document_jobs",jobColumns,"job_id=?",[s.jobId]),grant:await required("output_execution_grants",nativeGrantColumns,"scope_key=? AND grant_id=?",[s.scopeKey,s.grantId]),
    slot:await required("output_operation_slots",slotColumns,"scope_key=? AND slot_id=?",[s.scopeKey,s.slotId]),token:await required("budget_reservations",tokenColumns,"reservation_id=?",[s.tokenReservationId]),
    cost:await required("cost_budget_reservations",costColumns,"reservation_id=?",[s.costReservationId]),consumption:await required("experience_sponsor_consumptions",consumptionColumns,"consumption_id=?",[c.compiled.envelope.consumptionId]),
    active:(await row(c.life,"experience_sponsor_active_jobs",["actor_user_id","consumption_id","job_id"],"actor_user_id=? OR consumption_id=? OR job_id=?",[f.actorUserId,c.compiled.envelope.consumptionId,s.jobId],true))?.value??null,
    calls:await nativeRows(c,"output_provider_calls",callColumns,"scope_key=? AND slot_id=?",[s.scopeKey,s.slotId],2),
    storage:await nativeRows(c,"output_native_storage_writes",storageColumns,"scope_key=? AND slot_id=?",[s.scopeKey,s.slotId],1),
    content:await nativeRows(c,"private_content",contentColumns,"owner_id=? AND content_id<>?",[f.ownerUserId,String(c.history.original.source.draft_id)],2),
  };
  const r:RunCapture={admission:c,phase:"admitted",runKey,runCommand:command?.value??null,runEvent,events,rows,proofs:[],sourceProofs:immutableAdmissionProofs(c),settings};
  validateRunRows(r);await validateRunEvents(r);
  // No Run means the original strict admitted graph, without a second authority
  // or relaxed closure. A malformed native descendant cannot request Run.
  if(!runEvent)await prove(c,[...c.baseProofs,head(c,true),closure(c,c.blueprint),...nativeProofs(c,c.blueprint)]);
  r.proofs=freeze(runGraphProofs(r));await prove(c,r.proofs);c.life.check();guestApprovedCampaignData(request,env,c.approved);
  const witness=Object.freeze(Object.create(null)) as GuestImageRunWitness;runRegistry.set(witness,r);runState(request,env,witness);return witness;
}
export function createGuestImageRunWitness(request:Request,env:WorkerEnv,base:GuestImageOutputInput,deadline?:number){return captureRun(request,env,base,deadline);}
export function requireGuestImageRunWitness(request:Request,env:WorkerEnv,witness:GuestImageRunWitness){
  const r=runState(request,env,witness),c=r.admission,f=c.frame;
  const job=freeze({...r.rows.job,output_slot_id:f.slot.slotId,output_durable_owner:0}) as DocumentJobRow;
  const binding:OutputJobBinding=freeze({scope:f.scope,slot:{...f.slot,status:String(r.rows.slot.status)},sponsored:true,payerUserId:f.payerUserId,retentionPolicy:null});
  const sourceEvents=freeze([...f.sourceEvents,c.blueprint!.queue,c.blueprint!.authorization,...(r.runEvent?[r.runEvent]:[])]);
  return Object.freeze({frame:f,phase:r.phase,base:c.base,deadline:c.life.deadline,runKey:r.runKey,runCommand:r.runCommand?freeze(structuredClone(r.runCommand)):null,runEvent:r.runEvent?freeze(structuredClone(r.runEvent)):null,
    job,binding,generationCompleted:r.events.some(event=>event.type==="GenerationCompleted"),generationFailed:r.events.some(event=>event.type==="GenerationFailed"),sourceEvents,sourceHead:f.quoteHead+(r.runEvent?3:2),sourceAssertions:freeze([...r.sourceProofs,...(r.runEvent?[progressEventProof(r.runEvent,c),exact("output_commands",r.runCommand!)]:[])]),beforeAssertions:r.proofs,settings:freeze(structuredClone(r.settings)),
    expectedFinancialIdentity:freeze({actorUserId:f.actorUserId,ownerUserId:f.ownerUserId,payerUserId:f.payerUserId,scopeKey:f.scope.key,grantId:f.slot.grantId,slotId:f.slot.slotId,jobId:f.slot.jobId,streamId:f.streamId,documentId:f.documentId,projectId:f.projectId,
      tokenReservationId:f.slot.tokenReservationId,costReservationId:f.slot.costReservationId,period:f.period,consumptionId:c.compiled.envelope.consumptionId,issuerGrantId:c.issuerGrantId,campaignId:c.compiled.envelope.campaignId,policyDigest:c.compiled.policyDigest,envelopeDigest:c.compiled.envelopeDigest}),
    check:()=>{runState(request,env,witness);},wait:<T>(work:()=>Promise<T>)=>c.life.wait(work)});
}
/** Existing immutable descendants cannot be rewritten during one request. A
 * fresh request still reconstructs and proves the complete original graph. */
function assertRunContinuation(previous:RunCapture,next:RunCapture){
  const p=previous.rows,n=next.rows;
  if(previous.events.length>next.events.length)return fail("run_history_regressed");
  previous.events.forEach((event,index)=>equal(event,next.events[index]));
  if(p.job.attempt_count===1&&(n.job.attempt_count!==1||n.job.started_at!==p.job.started_at||n.job.correlation_id!==p.job.correlation_id||["running","committing"].includes(String(n.job.status))&&n.job.lease_expires_at!==p.job.lease_expires_at))return fail("run_claim_rewritten");
  const phases:Record<string,string[]>={queued:["queued","running","committing","completed","failed","canceled"],running:["running","committing","completed","failed","canceled"],committing:["committing","completed","failed","canceled"],completed:["completed"],failed:["failed"],canceled:["canceled"]};
  if(!phases[String(p.job.status)]?.includes(String(n.job.status)))return fail("run_job_regressed");
  for(const old of p.calls){const current=n.calls.find(row=>row.call_key===old.call_key);if(!current)return fail("run_call_removed");
    for(const key of ["scope_key","slot_id","call_key","client_request_id","request_digest","stage_key","provider","model","reserved_microusd","created_at"])if(old[key]!==current[key])return fail("run_call_rewritten");
    if(old.provider_response_id!==null&&current.provider_response_id!==old.provider_response_id)return fail("run_call_rewritten");
    if(["settled","rejected"].includes(String(old.status)))equal(old,current);else if(old.status==="uncertain"&&current.status==="pending")return fail("run_call_regressed");}
  for(const old of p.content){const current=n.content.find(row=>row.content_id===old.content_id);if(!current)return fail("run_private_body_removed");equal(old,current);}
  for(const old of p.storage){const current=n.storage.find(row=>row.storage_key===old.storage_key);if(!current)return fail("run_storage_removed");
    for(const key of ["scope_key","slot_id","storage_key","content_sha256","created_at"])if(old[key]!==current[key])return fail("run_storage_rewritten");
    if(Number(current.write_acknowledged)<Number(old.write_acknowledged)||old.publication_event_id!==null&&old.publication_event_id!==current.publication_event_id)return fail("run_storage_regressed");}
  for(const [old,current] of [[p.token,n.token],[p.cost,n.cost]]){if(old!.created_at!==current!.created_at)return fail("run_reservation_rewritten");if(["settled","released"].includes(String(old!.status)))equal(old,current);}
}
export async function refreshGuestImageRunWitness(request:Request,env:WorkerEnv,witness:GuestImageRunWitness){
  const previous=runState(request,env,witness),next=await captureRun(request,env,previous.admission.base,previous.admission.life.deadline);
  runState(request,env,witness);assertRunContinuation(previous,runState(request,env,next));return next;
}
export async function prepareGuestImageRunTransition(request:Request,env:WorkerEnv,witness:GuestImageRunWitness){
  const r=runState(request,env,witness),c=r.admission,f=c.frame;if(r.phase!=="admitted"||r.runEvent||r.runCommand)return fail("run_already_recorded");
  const createdAt=new Date().toISOString(),event=runEventValue(c,r.runKey,uuidV7(),createdAt),command=runCommandValue(c,r.runKey),commandDigest=(await c.life.wait(()=>digest(command))).slice(7);
  const nativeCommand:Row={scope_key:f.scope.key,actor_user_id:f.actorUserId,command_key:r.runKey,request_digest:commandDigest,action:"run",event_id:event.eventId,created_at:createdAt};
  const next:RunCapture={...r,phase:"queued",runCommand:nativeCommand,runEvent:event,events:[event],rows:{...r.rows,grant:{...r.rows.grant,status:"active"},slot:{...r.rows.slot,status:"queued",updated_at:createdAt}}};
  const split=publicEventPayload(event.eventId,event.payload,true);if(bytes(JSON.stringify(split.payload))>65536||typeof split.privateJson!=="string"||bytes(split.privateJson)>131072)return fail("run_receipt_size");
  runState(request,env,witness);return freeze({event,commandDigest,command,nativeCommand,createdAt,beforeAssertions:r.proofs,afterAssertions:runGraphProofs(next)});
}
/** The exact native first claim and both unchanged paired-hold handoffs must be
 * committed together. This helper never issues a job, lease, call, or purchase. */
export function guestImageRunJobClaimAssertions(request:Request,env:WorkerEnv,witness:GuestImageRunWitness,claimedJob:DocumentJobRow):readonly OutputSqlAssertion[]{
  const r=runState(request,env,witness),c=r.admission,f=c.frame;if(r.phase!=="queued"||!r.runEvent)return fail("run_claim_unavailable");
  const actual:Row=Object.fromEntries(jobColumns.map(key=>[key,claimedJob[key as keyof DocumentJobRow] as Value]));
  const started=actual.started_at,lease=actual.lease_expires_at;
  if(!iso(started)||!iso(lease)||actual.updated_at!==started||Date.parse(started)<Date.parse(r.runEvent.recordedAt)||Date.parse(lease)>f.expiresAtMs||Date.parse(lease)<=Date.parse(started)
    ||Date.parse(lease)>Date.parse(started)+Number(r.settings.executionPolicy?.maximumMilliseconds??0))return fail("run_claim_lease_changed");
  const expected={...r.rows.job,status:"running",attempt_count:1,correlation_id:`${f.slot.jobId}:attempt:1`,started_at:started,lease_expires_at:lease,updated_at:started,
    result_json:JSON.stringify({...c.blueprint!.initialResult,stage:"preparing",progressMessage:"Preparing the document context."})};
  equal(actual,expected);
  const next:RunCapture={...r,phase:"running",rows:{...r.rows,job:actual,token:{...r.rows.token,correlation_id:actual.correlation_id!,updated_at:started},cost:{...r.rows.cost,correlation_id:actual.correlation_id!,status:"active",updated_at:started}}};
  validateRunRows(next);runState(request,env,witness);
  return freeze([...runGraphProofs(next),{sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[lease]}]);
}
