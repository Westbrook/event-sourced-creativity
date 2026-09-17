import { digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { experienceDocumentRoute, experienceDraftId, isDraftId, isIntentId, receiptPrefix, registeredExperience, type ExperiencePlan } from "../src/experiences/intake.ts";
import { continueExperienceAuthorization, readDraft, retainedGuard } from "./experience-intake-read.ts";
import { loadApprovedSponsorCampaign } from "./experience-sponsor-approval.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { SPONSOR_IMAGE_INTAKE_READ_OPERATIONS, type SponsorImageIntakeReadOperation } from "./experience-sponsor-intake-read-policy.ts";
import { reserveSponsorIntakeReadAttempt, takeSponsorIntakeReadAttempt, type SponsorIntakeReadAttempt } from "./experience-sponsor-intake-read-attempts.ts";
import { packSponsorIntakeReadQuery } from "./experience-sponsor-intake-read-sql.ts";
import { readExistingPrincipalRequest } from "./principal-request-core.ts";
import { intakeGuard, projectIntakeAuthority, type ProjectIntakeAuthorization } from "./intake-authority.ts";
import { commitAtomicIntake } from "./project-intake.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^sha256:[a-f0-9]{64}$/u.test(v);
const join = (...proofs: BudgetReservationGuard[]): BudgetReservationGuard => ({ sql: proofs.map(p => `(${p.sql})`).join(" AND "), bindings: proofs.flatMap(p => p.bindings) });
const clock = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const receiptColumns = ["receipt_id", "resource_id", "campaign_id", "policy_digest", "limits_digest", "actor_user_id", "session_digest", "native_intent_id", "draft_id", "project_id", "document_id", "draft_hash", "body_digest", "content_digest", "source_digest", "content_bytes", "expires_at"] as const;
type IntakeReceipt = Record<Exclude<typeof receiptColumns[number], "content_bytes">, string> & { content_bytes: number };
type Row = Record<string, unknown>;
type Selector = { operation: SponsorImageIntakeReadOperation } & ({ campaignId: string } | { draftId: string } | { intentId: string });
declare const intakeReadAuthority: unique symbol;
export type SponsorIntakeReadAuthority = Readonly<{ [intakeReadAuthority]: true }>;
type State = { request: Request; env: WorkerEnv; db: WorkerEnv["DB"]; auth: ProjectIntakeAuthorization;
  operation: SponsorImageIntakeReadOperation; campaignId: string; policyDigest: string; resourceKey: string;
  assertions: BudgetReservationGuard[]; original?: IntakeReceipt; release?: ExperiencePlan["release"] };
const authorities = new WeakMap<SponsorIntakeReadAuthority, State>();

// Source-free indexed lineage only. No private draft text, canonical event
// payload, provider result or job is read before resource admission.
const originalFrom = `FROM experience_sponsor_intakes intake JOIN experience_sponsor_resource_receipts resource ON resource.resource_id=intake.resource_id
  WHERE intake.draft_id=? AND intake.actor_user_id=?
  AND resource.campaign_id=intake.campaign_id AND resource.policy_digest=intake.policy_digest AND resource.limits_digest=intake.limits_digest
  AND resource.actor_user_id=intake.actor_user_id AND resource.session_digest=intake.session_digest AND resource.intent_key=intake.native_intent_id
  AND resource.operation='image-text-draft-storage' AND resource.payload_digest=intake.content_digest AND resource.text_bytes=intake.content_bytes
  AND (${receiptColumns.filter(c => c !== "content_bytes").map(c => `(typeof(intake.${c})='text' AND length(CAST(intake.${c} AS BLOB))<=200)`).join(" AND ")})
  AND typeof(intake.content_bytes)='integer' AND intake.content_bytes>0`;

function selector(raw: unknown): Selector {
  if (jsonIssues(raw).length || !record(raw) || !SPONSOR_IMAGE_INTAKE_READ_OPERATIONS.includes(raw.operation as SponsorImageIntakeReadOperation)) return fail("sponsor_intake_read_request_invalid");
  const fresh = exactKeys(raw, ["operation", "campaignId"]) && raw.operation === "image-intake-bootstrap" && id(raw.campaignId);
  const saved = exactKeys(raw, ["operation", "draftId"]) && typeof raw.draftId === "string" && isDraftId(raw.draftId)
    || exactKeys(raw, ["operation", "intentId"]) && typeof raw.intentId === "string" && isIntentId(raw.intentId);
  if (!fresh && !saved) return fail("sponsor_intake_read_request_invalid");
  return freeze(structuredClone(raw)) as Selector;
}

/** Internal GET composition only. A fresh campaign ID must come from a future
 * trusted entry configuration; this function supplies no route or selection
 * policy. Saved aliases derive their original campaign, never today's default. */
export async function identifySponsorIntakeRead(request: Request, env: WorkerEnv, raw: unknown): Promise<SponsorIntakeReadAuthority> {
  const selected = selector(raw);
  if (request.method !== "GET" || env.FORMA_PILOT_COHORT_ID?.trim()) return fail("sponsor_intake_read_request_invalid");
  const principal = await readExistingPrincipalRequest(request, env, "creator", { account: "principal" });
  if ("kind" in principal || principal.response || !principal.user || principal.user.billingUserId && principal.user.billingUserId !== principal.user.userId)
    return fail("sponsor_intake_read_actor_unavailable");
  const auth = await continueExperienceAuthorization(request, env, principal);
  if (auth instanceof Response) return fail("sponsor_intake_read_actor_unavailable");
  let state: State;
  if ("campaignId" in selected) {
    const approved = await loadApprovedSponsorCampaign(request, env, selected.campaignId), release = await registeredExperience("image");
    if (approved.actor.userId !== auth.user.userId || approved.policy.resources.version !== 2 || !release
      || !approved.policy.templates.some(t => t.appId === "image" && t.releaseDigest === release.releaseHash)) return fail("sponsor_intake_read_fresh_unavailable");
    state = { request, env, db: env.DB, auth, operation: selected.operation, campaignId: selected.campaignId, policyDigest: approved.policyDigest,
      resourceKey: `bootstrap:${selected.campaignId}`, release, assertions: [projectIntakeAuthority(env, auth, { projectId: "", documentId: "" }),
        ...approved.assertions.map(a => ({ sql: a.sql, bindings: [...(a.bindings ?? [])] }))] };
  } else {
    const draftId = "draftId" in selected ? selected.draftId : await experienceDraftId(auth.user.userId, selected.intentId);
    const original = await env.DB.prepare(`SELECT ${receiptColumns.map(c => `intake.${c}`).join(",")} ${originalFrom}`)
      .bind(draftId, auth.user.userId).first<IntakeReceipt>();
    if (!original || !id(original.campaign_id) || !hash(original.policy_digest) || !hash(original.content_digest)
      || !hash(original.source_digest) || !hash(original.draft_hash) || !Number.isSafeInteger(original.content_bytes)) return fail("sponsor_intake_read_original_unavailable");
    const native = projectIntakeAuthority(env, auth, { projectId: original.project_id, documentId: original.document_id });
    const lineage: BudgetReservationGuard = { sql: `EXISTS(SELECT 1 ${originalFrom} AND json_array(${receiptColumns.map(c => `intake.${c}`).join(",")})=?)`,
      bindings: [draftId, auth.user.userId, JSON.stringify(receiptColumns.map(c => original[c]))] };
    const custody: BudgetReservationGuard = { sql: `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='experience-draft'
      AND redacted_at IS NULL AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?)
      AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=?)
      AND NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND type IN('DocumentRemoved','ProjectRemoved')
        AND (type='DocumentRemoved' AND json_extract(payload,'$.document_id')=? OR type='ProjectRemoved' AND json_extract(payload,'$.project_id')=?))`,
    bindings: [draftId, auth.user.userId, original.expires_at, draftId, draftId, auth.user.streamId, original.document_id, original.project_id] };
    state = { request, env, db: env.DB, auth, operation: selected.operation, campaignId: original.campaign_id, policyDigest: original.policy_digest,
      resourceKey: `draft:${draftId}`, original: freeze({ ...original }), assertions: [native, lineage, custody] };
  }
  const authority = Object.freeze({}) as SponsorIntakeReadAuthority;
  authorities.set(authority, state);
  return authority;
}

export function requireSponsorIntakeReadAuthority(authority: SponsorIntakeReadAuthority, request: Request, env: WorkerEnv) {
  const state = authorities.get(authority);
  if (!state || state.request !== request || state.env !== env || state.db !== env.DB) return fail("sponsor_intake_read_authority_unavailable");
  return { actorUserId: state.auth.user.userId, campaignId: state.campaignId, policyDigest: state.policyDigest,
    resourceKey: state.resourceKey, operation: state.operation, assertions: structuredClone(state.assertions) };
}

class Lifetime {
  used = 0; queries = 0;
  readonly maximum: number; readonly deadline: number;
  readonly authorityCurrent: () => void;
  constructor(maximum: number, deadline: number, authorityCurrent: () => void) {
    this.maximum = maximum; this.deadline = deadline; this.authorityCurrent = authorityCurrent;
  }
  check() { this.authorityCurrent(); if (performance.now() >= this.deadline) fail("sponsor_intake_read_deadline"); }
  remaining() { this.check(); return Math.max(0, this.maximum - this.used); }
  account(value: unknown) { this.check(); this.used += new TextEncoder().encode(JSON.stringify(value)).byteLength; if (this.used > this.maximum) fail("sponsor_intake_read_byte_limit"); }
  async run<T>(work: () => Promise<T>): Promise<T> {
    this.check(); if (++this.queries > 12) fail("sponsor_intake_read_query_limit");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SponsorEntitlementError("sponsor_intake_read_deadline")), Math.max(1, this.deadline - performance.now()));
      })]);
      this.check(); return result;
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
}

const eventColumns = ["event_id", "stream_id", "sequence", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id", "causation_id", "compensates_event_id", "schema_version", "type", "payload"];
const nativeReceiptColumns = ["requested_key", "receipt_key", ...eventColumns, "private_json", "receipt_total", "current_head"];
type NativeReceiptProof = { full: BudgetReservationGuard;
  parts: readonly Readonly<{ sql: string; bindings: readonly (string | number | null)[] }>[];
  prefixBindings: readonly (string | number | null)[] };

/** Recognize this one native reader exactly before changing its expression
 * shape. All complete predicates move to mandatory zero/one-row gates in the
 * SAME SELECT; its projection, LEFT JOINs, order and bindings are preserved.
 * A changed native query or binding vector must be reviewed, never guessed. */
function gatedNativeReceipt(sql: string, bindings: unknown[], proof: NativeReceiptProof) {
  const expected = `SELECT expected.value AS requested_key,receipt.client_event_id AS receipt_key,
      event.*,secret.private_json,
      (SELECT COUNT(*) FROM event_client_receipts counted WHERE counted.stream_id=? AND substr(counted.client_event_id,1,?)=?) AS receipt_total,
      (SELECT COALESCE(MAX(sequence),0) FROM events head WHERE head.stream_id=?) AS current_head
    FROM json_each(?) expected
    LEFT JOIN event_client_receipts receipt ON receipt.stream_id=? AND receipt.client_event_id=expected.value
    LEFT JOIN events event ON event.event_id=receipt.event_id AND event.stream_id=receipt.stream_id AND event.sequence=receipt.sequence
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL
    WHERE ${proof.full.sql} ORDER BY CAST(expected.key AS INTEGER)`;
  const expectedBindings = [...proof.prefixBindings, ...proof.full.bindings];
  const partBindings = proof.parts.flatMap(part => [...part.bindings]);
  if (sql !== expected || bindings.length !== expectedBindings.length
    || bindings.some((value, index) => !Object.is(value, expectedBindings[index]))
    || partBindings.length !== proof.full.bindings.length
    || partBindings.some((value, index) => !Object.is(value, proof.full.bindings[index]))) return fail("sponsor_intake_read_native_query_changed");
  let prefix = "sponsor_intake_receipt_gate";
  while (sql.toLowerCase().includes(prefix)) prefix += "_";
  const gates = proof.parts.map((part, index) => ({ name: `${prefix}_${index}`, sql: part.sql }));
  const suffix = `\n    WHERE ${proof.full.sql} ORDER BY CAST(expected.key AS INTEGER)`;
  const native = sql.slice(0, -suffix.length) + `\n    CROSS JOIN ${gates.map(gate => gate.name).join(" CROSS JOIN ")}`
    + " ORDER BY CAST(expected.key AS INTEGER)";
  return { sql: native, ctes: gates.map(gate => `${gate.name} AS MATERIALIZED (SELECT 1 WHERE ${gate.sql})`).join(","),
    bindings: [...partBindings, ...proof.prefixBindings] };
}

/** A finite read-only adapter around the ACTUAL native draft/receipt readers.
 * SQLite bounds the complete approved row JSON before bytes cross into the
 * Worker. Unknown query shapes refuse; extra schema columns are not projected.
 * Exact receipt rows are retained as final scalar SQL proof, not reauthored. */
function boundedNativeEnvironment(env: WorkerEnv, life: Lifetime, proofs: BudgetReservationGuard[], receiptProof?: NativeReceiptProof): WorkerEnv {
  const DB = { prepare(sql: string) {
    const columns = sql.startsWith("SELECT content,expires_at FROM private_content") ? ["content", "expires_at"]
      : sql.startsWith("SELECT 1 AS current WHERE") ? ["current"]
      : sql.startsWith("SELECT expected.value AS requested_key") ? nativeReceiptColumns : fail("sponsor_intake_read_native_query_changed");
    const receipt = columns === nativeReceiptColumns, maximumRows = receipt ? 64 : 1;
    function statement(bindings: unknown[]): D1PreparedStatement {
      const execute = async (kind: "first" | "all") => {
        const remaining = life.remaining();
        const native = receipt ? receiptProof ? gatedNativeReceipt(sql, bindings, receiptProof)
          : fail("sponsor_intake_read_native_query_changed") : { sql, bindings, ctes: "" };
        // D1 permits at most32 function arguments. json_set retains explicit
        // NULL keys (merge-patch would silently remove them from the budget).
        let object = "'{}'";
        for (let offset = 0; offset < columns.length; offset += 15)
          object = `json_set(${object},${columns.slice(offset, offset + 15).map(c => `'$.${c}',row.${c}`).join(",")})`;
        const boundedSql = `WITH ${native.ctes ? native.ctes + "," : ""} sponsor_intake_read_rows AS (${native.sql}) SELECT ${columns.join(",")} FROM sponsor_intake_read_rows
          WHERE (SELECT COUNT(*) FROM sponsor_intake_read_rows)<=${maximumRows}
          AND (SELECT COALESCE(SUM(length(CAST(${object} AS BLOB))),0)+COUNT(*)+2 FROM sponsor_intake_read_rows row)<=${remaining}`;
        const packed = packSponsorIntakeReadQuery(boundedSql, native.bindings);
        const result = await life.run(() => env.DB.prepare(packed.sql).bind(...packed.bindings).all<Row>());
        if (!result.success || result.results.some(row => Object.keys(row).some(key => !columns.includes(key)))) return fail("sponsor_intake_read_native_query_changed");
        life.account(result.results);
        if (receipt) {
          proofs.push({ sql: `(WITH ${native.ctes} SELECT json_group_array(json_array(${columns.map(c => `row.${c}`).join(",")})) FROM (${native.sql}) row)=?`,
            bindings: [...native.bindings as (string | number | null)[], JSON.stringify(result.results.map(row => columns.map(c => row[c] ?? null)))] });
        }
        return kind === "all" ? result : result.results[0] ?? null;
      };
      return { bind: (...next: unknown[]) => statement(next), first: () => execute("first"), all: () => execute("all"),
        run: () => fail("sponsor_intake_read_write_forbidden"), raw: () => fail("sponsor_intake_read_native_query_changed") } as D1PreparedStatement;
    }
    return statement([]);
  }, batch: () => fail("sponsor_intake_read_write_forbidden"), exec: () => fail("sponsor_intake_read_write_forbidden") } as unknown as WorkerEnv["DB"];
  return { ...env, DB };
}

/** A reserved request resolves once. Retained reads depend on current actor and
 * native custody, not generation eligibility, old sessions or live campaign
 * limits. The response preserves the original native marked plan/receipt. */
export async function resolveSponsorIntakeRead(authority: SponsorIntakeReadAuthority, attempt: SponsorIntakeReadAttempt, request: Request, env: WorkerEnv): Promise<Response> {
  requireSponsorIntakeReadAuthority(authority, request, env);
  const ticket = await takeSponsorIntakeReadAttempt(attempt, authority, request, env), state = authorities.get(authority)!;
  if (ticket.operation !== state.operation) return fail("sponsor_intake_read_operation_changed");
  const life = new Lifetime(ticket.maximumBytes, ticket.monotonicDeadline, () => { requireSponsorIntakeReadAuthority(authority, request, env); });
  // reserve copies and freezes every assertion from this exact opaque
  // authority; take's full ticket assertion includes those same assertions,
  // the payer-approved read policy, and the immutable attempt/deadline. Keep
  // that complete conjunction once, rather than repeating its strict subset
  // state.assertions and exceeding D1's SQL/binding limits. The native receipt
  // still uses this FULL proof plus the exact retained body; no authority,
  // custody, lineage, policy or attempt predicate is omitted.
  const proofs: BudgetReservationGuard[] = [{ sql: ticket.assertion.sql, bindings: [...ticket.assertion.bindings] }];
  let body: unknown, status = 200;
  if (!state.original) {
    body = { version: 1, kind: "sponsor-image-intake", mode: "fresh", actorUserId: state.auth.user.userId,
      campaignId: state.campaignId, release: state.release, generation: "unavailable" };
  } else {
    const nativeEnv = boundedNativeEnvironment(env, life, proofs), original = state.original;
    const saved = await life.run(() => readDraft(nativeEnv, state.auth, original.draft_id));
    if (!saved) return fail("sponsor_intake_read_original_unavailable");
    const plan = saved.plan, marker = (plan as unknown as Row).sponsor_intake;
    if (plan.release.output.output !== "image" || Object.hasOwn(plan, "reference") || Object.hasOwn(plan.request, "reference")
      || !record(marker) || !exactKeys(marker, ["version", "receiptId"]) || marker.version !== 1 || marker.receiptId !== original.receipt_id
      || marker.receiptId !== `sponsor-intake-${(await digest({ campaignId: state.campaignId, actor: state.auth.user.userId, intent: plan.request.intentId })).slice(7)}`
      || original.project_id !== plan.projectId || original.document_id !== plan.documentId || original.native_intent_id !== plan.request.intentId
      || original.draft_hash !== plan.draftHash || original.expires_at !== saved.expiresAt || original.content_digest !== await digest(saved.content)
      || original.source_digest !== await digest(plan.events) || original.content_bytes !== new TextEncoder().encode(saved.content).byteLength) return fail("sponsor_intake_read_original_changed");
    proofs.push(retainedGuard(state.auth, plan, saved.content));
    if (state.operation === "image-intake-bootstrap") body = { version: 1, kind: "sponsor-image-intake", mode: "retained", actorUserId: state.auth.user.userId,
      campaignId: state.campaignId, release: plan.release, draftId: plan.draftId, draftHash: plan.draftHash, generation: "unavailable" };
    else if (state.operation === "image-intake-draft") body = { status: "prepared", plan, expiresAt: saved.expiresAt };
    else {
      const intake = { projectId: plan.projectId, documentId: plan.documentId, events: structuredClone(plan.events) as ExperiencePlan["events"][number][] };
      const prefix = receiptPrefix(plan.draftId), stream = state.auth.user.streamId;
      const options = { receiptPrefix: prefix, clientId: "web:experience-intake", correlationPrefix: "experience-intake:", guard: join(...proofs) };
      const native = projectIntakeAuthority(env, state.auth, intake), full = intakeGuard(env, state.auth, intake, options);
      const receiptEnv = boundedNativeEnvironment(env, life, proofs, freeze({ full,
        parts: [native, ...ticket.assertions, ...proofs.slice(1)],
        prefixBindings: [stream, prefix.length, prefix, stream, JSON.stringify(intake.events.map(event => String(event.payload.client_event_id))), stream, state.auth.user.userId] }));
      const response = await life.run(() => commitAtomicIntake(receiptEnv, state.auth, intake, "check", options));
      const receipt = await response.json() as Row; status = response.status;
      body = { ...receipt, draftId: plan.draftId, draftHash: plan.draftHash, generation: "unavailable",
        ...(receipt.status === "complete" ? { documentRoute: experienceDocumentRoute(plan) } : {}) };
    }
  }
  // Serialize/account before the last custody check. No caller callback or
  // future transport may expand this already-bounded private response body.
  const serialized = JSON.stringify(body); life.account(body);
  // Lift every primitive of the FULL ticket, plus all later native proofs and
  // the final deadline, into the same statement. Each gate has zero/one rows;
  // their join preserves the full conjunction without D1's deep expression
  // nesting. The native receipt above still receives its complete guard.
  const final = [...ticket.assertions, ...proofs.slice(1), { sql: `${clock}<?`, bindings: [ticket.deadlineAtMs] }];
  let prefix = "sponsor_intake_final_gate";
  const source = final.map(proof => proof.sql).join("\n").toLowerCase();
  while (source.includes(prefix)) prefix += "_";
  const gates = final.map((proof, index) => ({ name: `${prefix}_${index}`, sql: proof.sql }));
  const sql = `WITH ${gates.map(gate => `${gate.name} AS MATERIALIZED (SELECT 1 WHERE ${gate.sql})`).join(",")}
    SELECT 1 AS current FROM ${gates.map(gate => gate.name).join(" CROSS JOIN ")}`;
  const packed = packSponsorIntakeReadQuery(sql, final.flatMap(proof => [...proof.bindings]));
  if (!await life.run(() => env.DB.prepare(packed.sql).bind(...packed.bindings).first())) return fail("sponsor_intake_read_custody_changed");
  life.account({ current: 1 }); life.check();
  return new Response(serialized, { status, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
}

/** Complete internal composition; no registered HTTP/queue call or schema loader. */
export async function readSponsorImageIntake(request: Request, env: WorkerEnv, raw: unknown) {
  const authority = await identifySponsorIntakeRead(request, env, raw);
  const selected = requireSponsorIntakeReadAuthority(authority, request, env);
  const attempt = await reserveSponsorIntakeReadAttempt(authority, request, env, selected.operation);
  return resolveSponsorIntakeRead(authority, attempt, request, env);
}
