import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
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
function eventProof(event: EventRow, f: GuestImageAdmissionFrame): Proof {
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

async function collect(request: Request, env: WorkerEnv, input: GuestImageOutputInput, ownerDeadline?:number):Promise<GuestImageAdmissionAuthority> {
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
