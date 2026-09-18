import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { experienceDocumentRoute, experienceDraftId, isDraftId, isIntentId, receiptPrefix, registeredExperience, type ExperiencePlan } from "../src/experiences/intake.ts";
import { continueExperienceAuthorization, readDraft, retainedGuard } from "./experience-intake-read.ts";
import { loadApprovedSponsorCampaign, sponsorApprovalAssertion } from "./experience-sponsor-approval.ts";
import { SponsorEntitlementError, readSponsorPolicy } from "./experience-sponsor-policy.ts";
import { SPONSOR_IMAGE_INTAKE_READ_OPERATIONS, type SponsorImageIntakeReadOperation, type SponsorImageIntakeReadOperationV1 } from "./experience-sponsor-intake-read-policy.ts";
import { reserveSponsorIntakeReadAttempt, takeSponsorIntakeReadAttempt, type SponsorIntakeReadAttempt } from "./experience-sponsor-intake-read-attempts.ts";
import { packSponsorIntakeReadQuery } from "./experience-sponsor-intake-read-sql.ts";
import { readExistingPrincipalRequest, identityFromRequest } from "./principal-request-core.ts";
import { PLATFORM_PRINCIPAL_WITH_ACCESS_SQL, principalAccessFromRow } from "./access-policy.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { classifySponsorIntakeDraft } from "./experience-sponsor-intake-classification.ts";
import { intakeGuard, projectIntakeAuthority, type AtomicIntakeOptions, type ProjectIntakeAuthorization } from "./intake-authority.ts";
import { commitAtomicIntake } from "./project-intake.ts";
import { readSponsorIntakeCommand } from "./experience-sponsor-intake-command.ts";
import type { ProjectIntake } from "../src/model/project-intake.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";
import type { ExperienceIntakeReceipt } from "../src/experiences/native-host.ts";
import { createSponsorImageConfirmationNativeEnvironment } from "./experience-sponsor-image-confirmation-native.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^sha256:[a-f0-9]{64}$/u.test(v);
const join = (...proofs: BudgetReservationGuard[]): BudgetReservationGuard => ({ sql: proofs.map(p => `(${p.sql})`).join(" AND "), bindings: proofs.flatMap(p => p.bindings) });
// Only exact guards created here have a privately captured decomposition.
// Unregistered/spread/cloned guards remain complete opaque predicates.
const composedPostGuards = new WeakMap<BudgetReservationGuard, readonly BudgetReservationGuard[]>();
function capturePostGuard(proof: BudgetReservationGuard): BudgetReservationGuard {
  const captured = freeze({ sql: proof.sql, bindings: [...proof.bindings] });
  const children = composedPostGuards.get(proof);
  if (children) composedPostGuards.set(captured, children);
  return captured;
}
function expandPostGuard(proof: BudgetReservationGuard): BudgetReservationGuard[] {
  const children = composedPostGuards.get(proof);
  return children ? children.flatMap(expandPostGuard) : [proof];
}
function distinctPostGuards(proofs: BudgetReservationGuard[]): BudgetReservationGuard[] {
  return proofs.filter((proof, index) => !proofs.slice(0, index).some(previous => previous.sql === proof.sql
    && previous.bindings.length === proof.bindings.length
    && previous.bindings.every((value, at) => Object.is(value, proof.bindings[at]))));
}
/** Preserve the existing conjunction text/vector exactly while privately
 * capturing its immutable children for the finite optional POST adapters. */
export function composeSponsorIntakePostGuards(...proofs: BudgetReservationGuard[]): BudgetReservationGuard {
  if (!proofs.length) return fail("sponsor_intake_post_read_unavailable");
  const children = freeze(proofs.map(capturePostGuard)), combined = freeze(join(...children));
  composedPostGuards.set(combined, children);
  return combined;
}
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
// Separate metadata capabilities can reserve the existing bootstrap allowance,
// but never enter the native private-read authority map.
type MetadataState = { request: Request; env: WorkerEnv; db: WorkerEnv["DB"]; actorUserId: string;
  campaignId: string; policyDigest: string; resourceKey: string; assertions: readonly BudgetReservationGuard[]; current(): void };
const metadataAuthorities = new WeakMap<SponsorIntakeReadAuthority, MetadataState>();

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
  if (jsonIssues(raw).length || !record(raw) || !SPONSOR_IMAGE_INTAKE_READ_OPERATIONS.includes(raw.operation as SponsorImageIntakeReadOperationV1)) return fail("sponsor_intake_read_request_invalid");
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
  if (!state) {
    const metadata = metadataAuthorities.get(authority);
    if (!metadata || metadata.request !== request || metadata.env !== env || metadata.db !== env.DB)
      return fail("sponsor_intake_read_authority_unavailable");
    metadata.current();
    return { actorUserId: metadata.actorUserId, campaignId: metadata.campaignId, policyDigest: metadata.policyDigest,
      resourceKey: metadata.resourceKey, operation: "image-intake-bootstrap" as const, assertions: structuredClone(metadata.assertions) };
  }
  if (!state || state.request !== request || state.env !== env || state.db !== env.DB) return fail("sponsor_intake_read_authority_unavailable");
  return { actorUserId: state.auth.user.userId, campaignId: state.campaignId, policyDigest: state.policyDigest,
    resourceKey: state.resourceKey, operation: state.operation, assertions: structuredClone(state.assertions) };
}

class Lifetime {
  used = 0; queries = 0;
  readonly maximum: number; readonly deadline: number;
  readonly authorityCurrent: () => void;
  readonly signal?: AbortSignal;
  readonly maximumQueries: number;
  constructor(maximum: number, deadline: number, authorityCurrent: () => void, signal?: AbortSignal, maximumQueries = 12) {
    this.maximum = maximum; this.deadline = deadline; this.authorityCurrent = authorityCurrent; this.signal = signal;
    this.maximumQueries = maximumQueries;
  }
  check() { this.authorityCurrent(); if (this.signal?.aborted) fail("sponsor_intake_post_read_cancelled"); if (performance.now() >= this.deadline) fail("sponsor_intake_read_deadline"); }
  remaining() { this.check(); return Math.max(0, this.maximum - this.used); }
  account(value: unknown) { this.check(); this.used += new TextEncoder().encode(JSON.stringify(value)).byteLength; if (this.used > this.maximum) fail("sponsor_intake_read_byte_limit"); }
  accountSerialized(value: string) { this.check(); this.used += new TextEncoder().encode(value).byteLength; if (this.used > this.maximum) fail("sponsor_intake_read_byte_limit"); }
  async run<T>(work: () => Promise<T>): Promise<T> {
    this.check(); if (++this.queries > this.maximumQueries) fail("sponsor_intake_read_query_limit");
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
    try {
      const cancelled = new Promise<never>((_, reject) => {
        if (!this.signal) return;
        abort = () => reject(new SponsorEntitlementError("sponsor_intake_post_read_cancelled"));
        this.signal.addEventListener("abort", abort, { once: true });
        if (this.signal.aborted) abort();
      });
      const result = await Promise.race([work(), cancelled, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SponsorEntitlementError("sponsor_intake_read_deadline")), Math.max(1, this.deadline - performance.now()));
      })]);
      this.check(); return result;
    } finally { if (timer !== undefined) clearTimeout(timer); if (abort) this.signal?.removeEventListener("abort", abort); }
  }
}

const eventColumns = ["event_id", "stream_id", "sequence", "occurred_at", "recorded_at", "actor", "client_id", "correlation_id", "causation_id", "compensates_event_id", "schema_version", "type", "payload"];
const nativeReceiptColumns = ["requested_key", "receipt_key", ...eventColumns, "private_json", "receipt_total", "current_head"];
type NativeReceiptProof = { full: BudgetReservationGuard;
  parts: readonly Readonly<{ sql: string; bindings: readonly (string | number | null)[] }>[];
  prefixBindings: readonly (string | number | null)[]; expandPostComposition?: true };
// Private confirmation-only decomposition. A row witness is never authority:
// every captured support predicate must accompany it in the same statement.
type ConfirmationReceiptSnapshot = { support: BudgetReservationGuard[]; stable: BudgetReservationGuard;
  full: BudgetReservationGuard; stableRows: string };

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
  // Recognition above uses the ACTUAL original transport vector, including a
  // packed guard's one JSON value. Only afterward may privately compiled POST
  // compositions expand to their captured equivalent predicates and raw binds.
  const parts = proof.expandPostComposition ? distinctPostGuards(proof.parts.flatMap(part =>
    expandPostGuard(part as BudgetReservationGuard))) : proof.parts;
  const gates = parts.map((part, index) => ({ name: `${prefix}_${index}`, sql: part.sql }));
  const suffix = `\n    WHERE ${proof.full.sql} ORDER BY CAST(expected.key AS INTEGER)`;
  const native = sql.slice(0, -suffix.length) + `\n    CROSS JOIN ${gates.map(gate => gate.name).join(" CROSS JOIN ")}`
    + " ORDER BY CAST(expected.key AS INTEGER)";
  return { sql: native, ctes: gates.map(gate => `${gate.name} AS MATERIALIZED (SELECT 1 WHERE ${gate.sql})`).join(","),
    bindings: [...parts.flatMap(part => [...part.bindings]), ...proof.prefixBindings],
    rowSql: sql.slice(0, -suffix.length) + " ORDER BY CAST(expected.key AS INTEGER)",
    rowBindings: proof.prefixBindings, support: parts };
}

type PostDraftProof = { env: WorkerEnv; auth: ProjectIntakeAuthorization; draftId: string; base: BudgetReservationGuard;
  additional: BudgetReservationGuard; content?: string };
/** Only the two actual native draft-reader statements may use this optional
 * POST adapter. Full original text and vector recognition precedes lifting
 * the privately captured additional proof; native predicates stay intact. */
function gatedPostDraft(sql: string, bindings: unknown[], proof: PostDraftProof) {
  let expected: string, expectedBindings: unknown[], native: BudgetReservationGuard, data: (from: string) => string;
  if (sql.startsWith("SELECT content,expires_at FROM private_content")) {
    const before = "SELECT content,expires_at FROM private_content";
    const where = ` WHERE content_id=? AND owner_id=? AND kind='experience-draft'
    AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (${proof.base.sql})`;
    expected = `${before}${where} AND (${proof.additional.sql})`;
    expectedBindings = [proof.draftId, proof.auth.user.userId, ...proof.base.bindings, ...proof.additional.bindings];
    native = { sql: proof.base.sql, bindings: [proof.draftId, proof.auth.user.userId, ...proof.base.bindings] };
    data = from => `${before} CROSS JOIN ${from}${where}`;
  } else {
    if (proof.content === undefined) return fail("sponsor_intake_read_native_query_changed");
    let plan: ExperiencePlan;
    try { plan = JSON.parse(proof.content) as ExperiencePlan; } catch { return fail("sponsor_intake_read_native_query_changed"); }
    // The actual native parser has already validated this same captured body
    // before constructing its final statement; it remains authoritative.
    native = join(projectIntakeAuthority(proof.env, proof.auth, plan), retainedGuard(proof.auth, plan, proof.content));
    const full = join(native, proof.additional);
    expected = `SELECT 1 AS current WHERE ${full.sql}`; expectedBindings = full.bindings;
    data = from => `SELECT 1 AS current FROM ${from} WHERE ${native.sql}`;
  }
  if (sql !== expected || !sameBindings(bindings, expectedBindings)
    || !compiledPostWrites.has(proof.additional) && !compiledConfirmationGuards.has(proof.additional))
    return fail("sponsor_intake_read_native_query_changed");
  const parts = distinctPostGuards(expandPostGuard(proof.additional));
  let prefix = "sponsor_intake_post_draft_gate";
  const source = sql.toLowerCase(); while (source.includes(prefix)) prefix += "_";
  const gates = parts.map((part, index) => ({ name: `${prefix}_${index}`, sql: part.sql }));
  return { sql: data(gates.map(gate => gate.name).join(" CROSS JOIN ")),
    ctes: gates.map(gate => `${gate.name} AS MATERIALIZED (SELECT 1 WHERE ${gate.sql})`).join(","),
    bindings: [...parts.flatMap(part => part.bindings), ...native.bindings] };
}

/** A finite read-only adapter around the ACTUAL native draft/receipt readers.
 * SQLite bounds the complete approved row JSON before bytes cross into the
 * Worker. Unknown query shapes refuse; extra schema columns are not projected.
 * Exact receipt rows are retained as final scalar SQL proof, not reauthored. */
function boundedNativeEnvironment(env: WorkerEnv, life: Lifetime, proofs: BudgetReservationGuard[], receiptProof?: NativeReceiptProof,
  draftProof?: PostDraftProof, confirmationSnapshots?: ConfirmationReceiptSnapshot[]): WorkerEnv {
  const DB = { prepare(sql: string) {
    const columns = sql.startsWith("SELECT content,expires_at FROM private_content") ? ["content", "expires_at"]
      : sql.startsWith("SELECT 1 AS current WHERE") ? ["current"]
      : sql.startsWith("SELECT expected.value AS requested_key") ? nativeReceiptColumns : fail("sponsor_intake_read_native_query_changed");
    const receipt = columns === nativeReceiptColumns, maximumRows = receipt ? 64 : 1;
    function statement(bindings: unknown[]): D1PreparedStatement {
      const execute = async (kind: "first" | "all") => {
        const remaining = life.remaining();
        // The confirmation-only factor must cover the exact full predicate
        // before any private SELECT runs, in addition to native SQL/vector
        // recognition performed immediately below. Existing callers omit it.
        if (confirmationSnapshots && (!receipt || !receiptProof
          || receiptProof.full.sql !== receiptProof.parts.map(part => `(${part.sql})`).join(" AND ")))
          return fail("sponsor_intake_read_native_query_changed");
        const native = receipt ? receiptProof ? gatedNativeReceipt(sql, bindings, receiptProof)
          : fail("sponsor_intake_read_native_query_changed") : draftProof ? gatedPostDraft(sql, bindings, draftProof) : { sql, bindings, ctes: "" };
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
        if (draftProof && columns[0] === "content" && result.results.length === 1) {
          const content = result.results[0]!.content;
          if (typeof content !== "string") return fail("sponsor_intake_read_native_query_changed");
          draftProof.content = content;
        }
        if (receipt) {
          proofs.push({ sql: `(WITH ${native.ctes} SELECT json_group_array(json_array(${columns.map(c => `row.${c}`).join(",")})) FROM (${native.sql}) row)=?`,
            bindings: [...native.bindings as (string | number | null)[], JSON.stringify(result.results.map(row => columns.map(c => row[c] ?? null)))] });
          if (confirmationSnapshots) {
            // Both recognitions happened before this read. All support remains
            // mandatory alongside these private data-only witnesses.
            if (!("rowSql" in native)) return fail("sponsor_intake_read_native_query_changed");
            const stableColumns = columns.filter(column => column !== "current_head");
            const rows = (selected: readonly string[]) => JSON.stringify(result.results.map(row => selected.map(column => row[column] ?? null)));
            const witness = (selected: readonly string[]): BudgetReservationGuard => ({
              sql: `(SELECT json_group_array(json_array(${selected.map(column => `row.${column}`).join(",")})) FROM (${native.rowSql}) row)=?`,
              bindings: [...native.rowBindings, rows(selected)],
            });
            confirmationSnapshots.push(freeze({
              support: native.support.map(part => capturePostGuard({ sql: part.sql, bindings: [...part.bindings] })),
              stable: witness(stableColumns), full: witness(columns), stableRows: rows(stableColumns),
            }));
          }
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
  // Metadata cannot enter a private sink, even before consuming its ticket.
  if (!authorities.has(authority)) return fail("sponsor_intake_read_authority_unavailable");
  requireSponsorIntakeReadAuthority(authority, request, env);
  const ticket = await takeSponsorIntakeReadAttempt(attempt, authority, request, env), state = authorities.get(authority)!;
  if (ticket.operation !== state.operation) return fail("sponsor_intake_read_operation_changed");
  const life = new Lifetime(ticket.maximumBytes, ticket.monotonicDeadline, () => { requireSponsorIntakeReadAuthority(authority, request, env); }, request.signal);
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

/** One actual POST owns one immutable read charge and one shared lifetime. The
 * capability never crosses a Request, environment, DB or authenticated actor. */
declare const postReadAllowance: unique symbol;
export type SponsorIntakePostReadAllowance = Readonly<{ [postReadAllowance]: true }>;
declare const postNativeReceipt: unique symbol;
export type SponsorIntakePostNativeReceipt = Readonly<{ [postNativeReceipt]: true }>;
type PostAction = "prepare-sponsored-image-draft" | "commit-sponsored-image-draft";
type PostSaved = NonNullable<Awaited<ReturnType<typeof readDraft>>> & { receipt: IntakeReceipt };
type PostState = { request: Request; env: WorkerEnv; db: WorkerEnv["DB"]; authority: SponsorIntakeReadAuthority;
  command: Readonly<Record<string, unknown>>; auth: ProjectIntakeAuthorization; draftId: string; bodyDigest: string;
  campaignId: string; policyDigest: string; action: PostAction; original: IntakeReceipt | null;
  ticket: Awaited<ReturnType<typeof takeSponsorIntakeReadAttempt>>; life: Lifetime;
  retained: BudgetReservationGuard[]; saved: PostSaved | null; receiptProof?: BudgetReservationGuard;
  closed: boolean; finishing: boolean; reading: boolean; nativeReads: number };
type PostNativeState = { allowance: SponsorIntakePostReadAllowance; post: PostState; env: WorkerEnv; db: WorkerEnv["DB"];
  auth: ProjectIntakeAuthorization; intake: ProjectIntake; intakeJson: string; options: AtomicIntakeOptions;
  proof: NativeReceiptProof; calls: number; reading: boolean };
const postAllowances = new WeakMap<SponsorIntakePostReadAllowance, PostState>();
const postReceipts = new WeakMap<SponsorIntakePostNativeReceipt, PostNativeState>();
const postRequests = new WeakSet<Request>();
type PostWriteComposition = { state: PostState; ctes: string; gates: readonly string[]; bindings: readonly (string | number | null)[] };
const compiledPostWrites = new WeakMap<BudgetReservationGuard, PostWriteComposition>();

function postState(cap: SponsorIntakePostReadAllowance, request?: Request, env?: WorkerEnv, allowFinishing = false): PostState {
  const state = postAllowances.get(cap);
  if (!state || state.closed || state.finishing && !allowFinishing || request && state.request !== request
    || env && state.env !== env || state.db !== state.env.DB) return fail("sponsor_intake_post_read_unavailable");
  requireSponsorIntakeReadAuthority(state.authority, state.request, state.env);
  if (state.request.signal.aborted) return fail("sponsor_intake_post_read_cancelled");
  return state;
}
function validPostReceipt(row: IntakeReceipt | null): row is IntakeReceipt {
  return !!row && id(row.campaign_id) && hash(row.policy_digest) && hash(row.content_digest)
    && hash(row.source_digest) && hash(row.draft_hash) && hash(row.body_digest) && Number.isSafeInteger(row.content_bytes);
}
async function postSource(db: WorkerEnv["DB"], auth: ProjectIntakeAuthorization, draftId: string) {
  return db.prepare(`SELECT ${receiptColumns.map(c => `intake.${c}`).join(",")} ${originalFrom}`)
    .bind(draftId, auth.user.userId).first<IntakeReceipt>();
}
function postLineage(auth: ProjectIntakeAuthorization, row: IntakeReceipt): BudgetReservationGuard {
  return { sql: `EXISTS(SELECT 1 ${originalFrom} AND json_array(${receiptColumns.map(c => `intake.${c}`).join(",")})=?)`,
    bindings: [row.draft_id, auth.user.userId, JSON.stringify(receiptColumns.map(c => row[c]))] };
}
function postCustody(auth: ProjectIntakeAuthorization, row: IntakeReceipt): BudgetReservationGuard {
  return { sql: `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='experience-draft'
    AND redacted_at IS NULL AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?)
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=?)
    AND NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND type IN('DocumentRemoved','ProjectRemoved')
      AND (type='DocumentRemoved' AND json_extract(payload,'$.document_id')=? OR type='ProjectRemoved' AND json_extract(payload,'$.project_id')=?))`,
  bindings: [row.draft_id, auth.user.userId, row.expires_at, row.draft_id, row.draft_id, auth.user.streamId, row.document_id, row.project_id] };
}
function postAssertions(state: PostState): BudgetReservationGuard[] {
  const assertions = [...state.ticket.assertions.map(proof => ({ sql: proof.sql, bindings: [...proof.bindings] })),
    ...state.retained.map(proof => ({ sql: proof.sql, bindings: [...proof.bindings] })),
    { sql: `${clock}<?`, bindings: [state.ticket.deadlineAtMs] }];
  // Retained reads can capture exactly the same immutable lineage/custody
  // predicate already held by their ticket. Keep its complete first instance.
  return distinctPostGuards(assertions);
}

/** Parse and bind the ORIGINAL bounded POST exactly once. Only indexed,
 * source-free lineage is selected before the new request's read reservation. */
export async function createSponsorIntakePostReadAllowance(request: Request, env: WorkerEnv,
  freshCampaignId: string | null): Promise<SponsorIntakePostReadAllowance> {
  if (postRequests.has(request) || request.method !== "POST" || env.FORMA_PILOT_COHORT_ID?.trim()
    || freshCampaignId !== null && !id(freshCampaignId)) return fail("sponsor_intake_post_read_unavailable");
  postRequests.add(request);
  const database = env.DB;
  const unchanged = () => {
    if (env.DB !== database) return fail("sponsor_intake_post_read_unavailable");
    if (request.signal.aborted) return fail("sponsor_intake_post_read_cancelled");
  };
  unchanged();
  const command = await readSponsorIntakeCommand(request); unchanged();
  const preparing = exactKeys(command, ["action", "campaignId", "request"]) && command.action === "prepare-sponsored-image-draft"
    && id(command.campaignId) && record(command.request) && isIntentId(command.request.intentId)
    && command.request.experienceId === "image" && !Object.hasOwn(command.request, "reference");
  const committing = exactKeys(command, ["action", "campaignId", "draftId", "draftHash"]) && command.action === "commit-sponsored-image-draft"
    && id(command.campaignId) && typeof command.draftId === "string" && isDraftId(command.draftId) && hash(command.draftHash);
  if (!preparing && !committing) return fail("sponsor_intake_request_invalid");
  const principal = await readExistingPrincipalRequest(request, env, "creator", { account: "principal" }); unchanged();
  if ("kind" in principal || principal.response || !principal.user || principal.user.billingUserId && principal.user.billingUserId !== principal.user.userId)
    return fail("sponsor_intake_read_actor_unavailable");
  const authorized = await continueExperienceAuthorization(request, env, principal); unchanged();
  if (authorized instanceof Response) return fail("sponsor_intake_read_actor_unavailable");
  const auth = freeze(structuredClone(authorized));
  const action = command.action as PostAction;
  const intentId = preparing ? (command.request as Record<string, unknown>).intentId as string : null;
  const draftId = preparing ? await experienceDraftId(auth.user.userId, intentId!) : command.draftId as string;
  const bodyDigest = await digest(command); unchanged();
  const selected = await postSource(database, auth, draftId); unchanged();
  if (selected && !validPostReceipt(selected)) return fail("sponsor_intake_read_original_unavailable");
  const original = selected ? freeze({ ...selected }) : null;
  let authorityState: State;
  const operation: SponsorImageIntakeReadOperation = preparing ? "image-intake-draft" : "image-intake-receipt";
  if (original) {
    if (original.campaign_id !== command.campaignId || preparing && (original.native_intent_id !== intentId || original.body_digest !== bodyDigest)
      || committing && original.draft_hash !== command.draftHash) return fail("sponsor_intake_intent_conflict");
    authorityState = { request, env, db: database, auth, operation, campaignId: original.campaign_id, policyDigest: original.policy_digest,
      resourceKey: `draft:${draftId}`, original, assertions: [projectIntakeAuthority(env, auth,
        { projectId: original.project_id, documentId: original.document_id }), postLineage(auth, original), postCustody(auth, original)] };
  } else {
    const existing = await database.prepare("SELECT 1 AS present FROM experience_sponsor_intakes WHERE draft_id=?").bind(draftId).first(); unchanged();
    if (existing || !preparing) return fail("sponsor_intake_read_original_unavailable");
    if (!freshCampaignId || freshCampaignId !== command.campaignId) return fail("sponsor_intake_read_fresh_unavailable");
    const approved = await loadApprovedSponsorCampaign(request, env, freshCampaignId); unchanged();
    const release = await registeredExperience("image"); unchanged();
    if (approved.actor.userId !== auth.user.userId || approved.policy.resources.version !== 2 || !release
      || !approved.policy.templates.some(t => t.appId === "image" && t.releaseDigest === release.releaseHash)) return fail("sponsor_intake_read_fresh_unavailable");
    // This proof survives only the authorized absent -> exact same-command
    // winner transition. An ordinary/orphan/other-campaign identity is refused.
    const identity: BudgetReservationGuard = { sql: `((NOT EXISTS(SELECT 1 FROM experience_sponsor_intakes WHERE draft_id=?)
      AND NOT EXISTS(SELECT 1 FROM private_content WHERE content_id=?)) OR EXISTS(SELECT 1 ${originalFrom}
      AND intake.campaign_id=? AND intake.policy_digest=? AND intake.native_intent_id=? AND intake.body_digest=?
      AND EXISTS(SELECT 1 FROM private_content body WHERE body.content_id=intake.draft_id AND body.owner_id=intake.actor_user_id
        AND body.kind='experience-draft' AND body.redacted_at IS NULL AND body.expires_at=intake.expires_at
        AND body.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))`,
    bindings: [draftId, draftId, draftId, auth.user.userId, freshCampaignId, approved.policyDigest, intentId!, bodyDigest] };
    authorityState = { request, env, db: database, auth, operation, campaignId: freshCampaignId, policyDigest: approved.policyDigest,
      resourceKey: `draft:${draftId}`, release, assertions: [projectIntakeAuthority(env, auth, { projectId: "", documentId: "" }),
        ...approved.assertions.map(proof => ({ sql: proof.sql, bindings: [...(proof.bindings ?? [])] })), identity] };
  }
  unchanged();
  const authority = Object.freeze({}) as SponsorIntakeReadAuthority;
  authorities.set(authority, authorityState);
  const attempt = await reserveSponsorIntakeReadAttempt(authority, request, env, operation); unchanged();
  const ticket = await takeSponsorIntakeReadAttempt(attempt, authority, request, env); unchanged();
  const cap = Object.freeze({}) as SponsorIntakePostReadAllowance;
  const life = new Lifetime(ticket.maximumBytes, ticket.monotonicDeadline, () => { postState(cap, request, env, true); }, request.signal);
  postAllowances.set(cap, { request, env, db: database, authority, command, auth, draftId, bodyDigest,
    campaignId: authorityState.campaignId, policyDigest: authorityState.policyDigest, action, original, ticket, life,
    retained: [], saved: null, closed: false, finishing: false, reading: false, nativeReads: 0 });
  life.check();
  return cap;
}

export function requireSponsorIntakePostReadAllowance(cap: SponsorIntakePostReadAllowance, request: Request, env: WorkerEnv,
  expectedAction?: PostAction) {
  const state = postState(cap, request, env); state.life.check();
  if (expectedAction !== undefined && expectedAction !== state.action) return fail("sponsor_intake_post_read_unavailable");
  return freeze({ command: state.command, auth: state.auth, draftId: state.draftId, bodyDigest: state.bodyDigest, campaignId: state.campaignId });
}

/** Every original/winner probe uses the same actual native draft reader and
 * lifetime. Null is fresh only if both retained identity namespaces are absent. */
export async function readSponsorIntakePostDraft(cap: SponsorIntakePostReadAllowance, env: WorkerEnv,
  auth: ProjectIntakeAuthorization, draftId: string): Promise<PostSaved | null> {
  const state = postState(cap, undefined, env); state.life.check();
  if (state.auth !== auth || state.draftId !== draftId || state.reading) return fail("sponsor_intake_post_read_unavailable");
  state.reading = true;
  try {
    const additional = composeSponsorIntakePostWriteGuard(cap, state.request, env);
    const draftProof: PostDraftProof = { env, auth, draftId, additional, base: projectIntakeAuthority(env, auth, { projectId: "", documentId: "" }) };
    const saved = await readDraft(boundedNativeEnvironment(env, state.life, [], undefined, draftProof), auth, draftId, additional);
    state.life.check();
    if (!saved) {
      const present = await state.life.run(() => state.db.prepare(`SELECT 1 AS present WHERE
        EXISTS(SELECT 1 FROM private_content WHERE content_id=?) OR EXISTS(SELECT 1 FROM experience_sponsor_intakes WHERE draft_id=?)`)
        .bind(draftId, draftId).first());
      state.life.account(present);
      if (present || state.original || state.saved || state.action !== "prepare-sponsored-image-draft") return fail("sponsor_intake_read_original_unavailable");
      return null;
    }
    const receipt = await state.life.run(() => postSource(state.db, auth, draftId)); state.life.account(receipt);
    const plan = saved.plan, marker = (plan as unknown as Row).sponsor_intake;
    if (!validPostReceipt(receipt) || receipt.campaign_id !== state.campaignId || receipt.policy_digest !== state.policyDigest
      || receipt.actor_user_id !== auth.user.userId || receipt.draft_id !== draftId || plan.release.output.output !== "image"
      || Object.hasOwn(plan, "reference") || Object.hasOwn(plan.request, "reference") || !record(marker)
      || !exactKeys(marker, ["version", "receiptId"]) || marker.version !== 1 || marker.receiptId !== receipt.receipt_id
      || receipt.native_intent_id !== plan.request.intentId || receipt.project_id !== plan.projectId || receipt.document_id !== plan.documentId
      || receipt.draft_hash !== plan.draftHash || receipt.expires_at !== saved.expiresAt || receipt.content_digest !== await digest(saved.content)
      || receipt.source_digest !== await digest(plan.events) || receipt.content_bytes !== new TextEncoder().encode(saved.content).byteLength
      || receipt.receipt_id !== `sponsor-intake-${(await digest({ campaignId: state.campaignId, actor: auth.user.userId, intent: plan.request.intentId })).slice(7)}`
      || state.action === "prepare-sponsored-image-draft" && receipt.body_digest !== state.bodyDigest
      || state.action === "commit-sponsored-image-draft" && plan.draftHash !== state.command.draftHash
      || state.original && canonicalJson(receipt) !== canonicalJson(state.original)
      || state.saved && saved.content !== state.saved.content) return fail("sponsor_intake_read_original_changed");
    state.life.check();
    state.original ??= freeze({ ...receipt });
    state.retained = freeze([postLineage(auth, receipt), postCustody(auth, receipt), retainedGuard(auth, plan, saved.content)]);
    state.saved = freeze({ ...saved, receipt: { ...receipt } });
    return state.saved;
  } finally { state.reading = false; }
}

/** Complete proof for the native storage/commit statement; observed receipt
 * snapshots are excluded because an authorized commit advances that snapshot. */
export function sponsorIntakePostGuard(cap: SponsorIntakePostReadAllowance, request: Request, env: WorkerEnv) {
  const state = postState(cap, request, env); state.life.check();
  const assertions = freeze(postAssertions(state));
  const combined = composeSponsorIntakePostGuards(...assertions);
  const result = freeze({ ...combined, assertions });
  composedPostGuards.set(result, freeze([combined]));
  return result;
}

/** A native write keeps all supplied proof and the complete current ticket in
 * the same statement. Packing only transports its captured scalar bindings;
 * its private provenance separately retains every equivalent full predicate. */
export function composeSponsorIntakePostWriteGuard(cap: SponsorIntakePostReadAllowance, request: Request, env: WorkerEnv,
  ...proofs: BudgetReservationGuard[]): BudgetReservationGuard {
  const state = postState(cap, request, env); state.life.check();
  const leaves = freeze(distinctPostGuards([...proofs.map(capturePostGuard).flatMap(expandPostGuard),
    ...postAssertions(state).map(capturePostGuard)]));
  let prefix = "sponsor_intake_post_write";
  const source = leaves.map(proof => proof.sql).join("\n").toLowerCase();
  while (source.includes(prefix)) prefix += "_";
  const gates = leaves.map((proof, index) => ({ name: `${prefix}_${index}`, sql: proof.sql }));
  const tail = `\n    SELECT 1 FROM ${gates.map(gate => gate.name).join(" CROSS JOIN ")}`;
  const packed = packSponsorIntakeReadQuery(`WITH ${gates.map(gate => `${gate.name} AS MATERIALIZED (SELECT 1 AS passed WHERE ${gate.sql})`).join(",")}${tail}`,
    leaves.flatMap(proof => proof.bindings));
  if (!packed.sql.endsWith(tail)) return fail("sponsor_intake_read_native_query_changed");
  const result = freeze({ sql: `EXISTS(${packed.sql})`, bindings: [...packed.bindings] });
  composedPostGuards.set(result, leaves);
  compiledPostWrites.set(result, { state, ctes: packed.sql.slice(0, -tail.length), gates: freeze(gates.map(gate => gate.name)), bindings: result.bindings });
  return result;
}

// Native code reuses this exact input after awaited receipt reads. Visit every
// descendant even when a caller shallow-froze its parent, without invoking any
// getters/toJSON hooks. Only plain, finite JSON values may enter the seal.
function freezePostIntake(value: unknown, active = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return;
  if (!value || typeof value !== "object" || active.has(value)) return fail("sponsor_intake_post_read_unavailable");
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return fail("sponsor_intake_post_read_unavailable");
  active.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== "string")) return fail("sponsor_intake_post_read_unavailable");
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (array && key === "length") continue;
    if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable
      || array && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length)) return fail("sponsor_intake_post_read_unavailable");
    freezePostIntake(descriptor.value, active);
  }
  if (array && Object.keys(descriptors).length !== value.length + 1) return fail("sponsor_intake_post_read_unavailable");
  active.delete(value); Object.freeze(value);
}

/** Seal one exact native call. The original supplied guard is copied in full
 * and the complete charged read guard is added; neither can be waived. */
export function sealSponsorIntakePostNativeReceipt(cap: SponsorIntakePostReadAllowance, request: Request, env: WorkerEnv,
  auth: ProjectIntakeAuthorization, intake: ProjectIntake, options: AtomicIntakeOptions): AtomicIntakeOptions {
  const state = postState(cap, request, env); state.life.check();
  if (state.action !== "commit-sponsored-image-draft" || state.auth !== auth || !state.saved || state.reading || options.sponsorIntakeRead)
    return fail("sponsor_intake_post_read_unavailable");
  const plan = state.saved.plan;
  const expected = { projectId: plan.projectId, documentId: plan.documentId, events: plan.events };
  freezePostIntake(intake);
  if (canonicalJson(intake) !== canonicalJson(expected) || options.receiptPrefix !== receiptPrefix(plan.draftId)
    || options.clientId !== "web:experience-intake" || options.correlationPrefix !== "experience-intake:") return fail("sponsor_intake_post_read_unavailable");
  // The native core receives this exact object after its awaited receipt read.
  // Freeze it too, so a caller cannot change the event grammar between checks.
  const originalGuard = capturePostGuard(options.guard);
  const token = Object.freeze({}) as SponsorIntakePostNativeReceipt;
  const sealed = freeze({ ...options, guard: composeSponsorIntakePostWriteGuard(cap, request, env, originalGuard), sponsorIntakeRead: token });
  const native = projectIntakeAuthority(env, auth, intake), full = intakeGuard(env, auth, intake, sealed);
  const prefix = sealed.receiptPrefix, stream = auth.user.streamId;
  postReceipts.set(token, { allowance: cap, post: state, env, db: env.DB, auth, intake,
    intakeJson: canonicalJson(intake), options: sealed, calls: 0, reading: false,
    proof: freeze({ full, parts: [native, sealed.guard], expandPostComposition: true as const,
      prefixBindings: [stream, prefix.length, prefix, stream, JSON.stringify(intake.events.map(event => String(event.payload.client_event_id))), stream, auth.user.userId] }) });
  return sealed;
}

/** Called only by the optional native readOriginal seam. It consumes the exact
 * SQL/bindings generated by that reader, with a request-bound immutable seal. */
export async function readSponsorIntakePostNativeReceipt(token: SponsorIntakePostNativeReceipt, env: WorkerEnv,
  auth: ProjectIntakeAuthorization, intake: ProjectIntake, options: AtomicIntakeOptions, sql: string, bindings: unknown[]): Promise<D1Result<Row>> {
  const sealed = postReceipts.get(token);
  if (!sealed) return fail("sponsor_intake_post_read_unavailable");
  const state = postState(sealed.allowance, undefined, env); state.life.check();
  if (state.action !== "commit-sponsored-image-draft" || sealed.post !== state || sealed.env !== env || sealed.db !== env.DB || sealed.auth !== auth || state.auth !== auth
    || sealed.intake !== intake || sealed.options !== options || options.sponsorIntakeRead !== token
    || canonicalJson(intake) !== sealed.intakeJson || sealed.reading || state.reading || sealed.calls >= 2)
    return fail("sponsor_intake_post_read_unavailable");
  sealed.reading = true; state.reading = true; sealed.calls++; state.nativeReads++;
  try {
    const observed: BudgetReservationGuard[] = [];
    const bounded = boundedNativeEnvironment(env, state.life, observed, sealed.proof);
    const result = await bounded.DB.prepare(sql).bind(...bindings).all<Row>();
    state.life.check();
    if (sealed.intake !== intake || sealed.options !== options || sealed.db !== env.DB
      || canonicalJson(intake) !== sealed.intakeJson) return fail("sponsor_intake_post_read_unavailable");
    if (observed.length !== 1) return fail("sponsor_intake_post_read_unavailable");
    // Only this sealed native path may supersede a pending receipt observation.
    // Its bytes stay charged and every immutable/body/ticket proof remains.
    state.receiptProof = freeze(observed[0]!);
    return result;
  } finally { sealed.reading = false; state.reading = false; }
}

/** One final disclosure from one captured, accounted string. Claim closure
 * before the final await so concurrent callers cannot disclose twice. */
export async function finishSponsorIntakePostRead(cap: SponsorIntakePostReadAllowance, request: Request, env: WorkerEnv,
  body: unknown, status = 200): Promise<Response> {
  const state = postState(cap, request, env); state.life.check();
  if (state.reading || !state.saved || state.action === "commit-sponsored-image-draft" && !state.receiptProof
    || !Number.isInteger(status) || status < 200 || status > 599) return fail("sponsor_intake_post_read_unavailable");
  state.finishing = true;
  try {
    const serialized = JSON.stringify(body);
    if (typeof serialized !== "string") return fail("sponsor_intake_post_read_unavailable");
    state.life.accountSerialized(serialized);
    const final = [...postAssertions(state), ...(state.receiptProof ? [state.receiptProof] : [])];
    let prefix = "sponsor_intake_post_final";
    const source = final.map(proof => proof.sql).join("\n").toLowerCase();
    while (source.includes(prefix)) prefix += "_";
    const gates = final.map((proof, index) => ({ name: `${prefix}_${index}`, sql: proof.sql }));
    const sql = `WITH ${gates.map(gate => `${gate.name} AS MATERIALIZED (SELECT 1 WHERE ${gate.sql})`).join(",")}
      SELECT 1 AS current FROM ${gates.map(gate => gate.name).join(" CROSS JOIN ")}`;
    const packed = packSponsorIntakeReadQuery(sql, final.flatMap(proof => [...proof.bindings]));
    if (!await state.life.run(() => state.db.prepare(packed.sql).bind(...packed.bindings).first())) return fail("sponsor_intake_read_custody_changed");
    state.life.account({ current: 1 }); state.life.check();
    return new Response(serialized, { status, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } finally { state.closed = true; }
}

const sameBindings = (actual: readonly unknown[], expected: readonly unknown[]) => actual.length === expected.length
  && actual.every((value, index) => Object.is(value, expected[index]));
function currentPostWrite(state: PostState, guard: BudgetReservationGuard) {
  state.life.check();
  const compiled = compiledPostWrites.get(guard);
  if (!compiled || compiled.state !== state || !sameBindings(compiled.bindings, guard.bindings)) return fail("sponsor_intake_post_read_unavailable");
  return compiled;
}
function preparePostWrite(env: WorkerEnv, compiled: PostWriteComposition, insert: string, values: string, bindings: readonly unknown[]) {
  const from = ` FROM (SELECT 1) sponsor_intake_write_row ${compiled.gates.map(name => `LEFT JOIN ${name} ON 1`).join(" ")}`;
  // LEFT JOIN keeps a failure row. A false/NULL complete predicate must still
  // drive the original CASE into CHECK/NOT NULL failure and roll back the batch.
  return env.DB.prepare(`${insert} ${compiled.ctes} SELECT ${values}${from}`).bind(...compiled.bindings, ...bindings);
}
function postWriteGate(compiled: PostWriteComposition) {
  return `(${compiled.gates.map(name => `${name}.passed IS NOT NULL`).join(" AND ")})`;
}
const storageWitnessInsert = "INSERT INTO experience_sponsor_intake_assertions(receipt_id,passed)";
const storageWitnessValues = (live: BudgetReservationGuard) => `?,CASE WHEN EXISTS(SELECT 1 FROM private_content body
        JOIN experience_sponsor_intakes intake ON intake.draft_id=body.content_id JOIN experience_sponsor_resource_receipts resource ON resource.resource_id=intake.resource_id
        WHERE intake.receipt_id=? AND body.owner_id=? AND body.kind='experience-draft' AND body.content=? AND body.redacted_at IS NULL AND body.expires_at=?
          AND intake.expires_at=body.expires_at AND intake.content_digest=? AND intake.content_bytes=? AND resource.operation='image-text-draft-storage'
          AND resource.payload_digest=intake.content_digest AND resource.text_bytes=intake.content_bytes
          AND resource.campaign_id=intake.campaign_id AND resource.actor_user_id=intake.actor_user_id AND resource.policy_digest=intake.policy_digest
          AND resource.limits_digest=intake.limits_digest AND resource.session_digest=intake.session_digest AND resource.intent_key=intake.native_intent_id)
        AND (${live.sql}) THEN 1 ELSE 0 END`;
const nativeRootInsert = "INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at)";
const nativeRootValues = (guard: BudgetReservationGuard) => `?,?,CASE WHEN ${guard.sql}
          AND (SELECT COUNT(*) FROM json_each(?) expected JOIN events saved
            ON saved.event_id=json_extract(expected.value,'$.id') AND saved.stream_id=? AND saved.actor='user'
              AND saved.type=json_extract(expected.value,'$.type') AND saved.sequence=json_extract(expected.value,'$.sequence')
            JOIN event_private_payloads secret ON secret.private_event_id=saved.event_id AND secret.owner_id=?
              AND secret.redacted_at IS NULL AND secret.private_json=json_extract(expected.value,'$.payload'))=?
          AND (SELECT COUNT(*) FROM json_each(?) expected JOIN event_client_receipts receipt
            ON receipt.stream_id=? AND receipt.client_event_id=json_extract(expected.value,'$.key')
              AND receipt.event_id=json_extract(expected.value,'$.id') AND receipt.sequence=json_extract(expected.value,'$.sequence')
            WHERE CAST(expected.key AS INTEGER)>0)=?
          AND NOT EXISTS(SELECT 1 FROM events prior WHERE prior.stream_id=? AND prior.type IN('ProjectCreated','DocumentCreated','DocumentForked','BlockCreated','ReferenceIngested')
            AND (json_extract(prior.payload,'$.project_id') IN(SELECT value FROM json_each(?)) AND prior.type='ProjectCreated'
              OR json_extract(prior.payload,'$.document_id') IN(SELECT value FROM json_each(?)) AND prior.type IN('DocumentCreated','DocumentForked')
              OR json_extract(prior.payload,'$.block_id') IN(SELECT value FROM json_each(?)) AND prior.type='BlockCreated'
              OR json_extract(prior.payload,'$.reference_id') IN(SELECT value FROM json_each(?)) AND prior.type='ReferenceIngested')
            AND prior.event_id NOT IN(SELECT json_extract(value,'$.id') FROM json_each(?)))
          THEN ? ELSE NULL END,?,?`;

/** Exactly the existing native storage CHECK witness, in the same transaction.
 * Only an opaque current POST's compiler-created guard can supply these gates. */
export function prepareSponsorIntakePostStorageWitness(cap: SponsorIntakePostReadAllowance, request: Request, env: WorkerEnv,
  live: BudgetReservationGuard, sql: string, bindings: readonly unknown[]): D1PreparedStatement {
  const state = postState(cap, request, env), compiled = currentPostWrite(state, live);
  if (state.action !== "prepare-sponsored-image-draft" || sql !== `${storageWitnessInsert} VALUES(${storageWitnessValues(live)})`
    || bindings.length !== 7 + live.bindings.length || !sameBindings(bindings.slice(7), live.bindings)
    || bindings[0] !== bindings[1] || bindings[2] !== state.auth.user.userId) return fail("sponsor_intake_read_native_query_changed");
  const values = storageWitnessValues({ sql: postWriteGate(compiled), bindings: [] });
  return preparePostWrite(env, compiled, storageWitnessInsert, values, bindings.slice(0, 7));
}

/** Optional native root-receipt seam. Recognize the entire unchanged template
 * and its actual captured guard vector before moving its privately compiled
 * guard to statement-level gates. No caller metadata authorizes decomposition. */
export function prepareSponsorIntakePostRootReceipt(token: SponsorIntakePostNativeReceipt, env: WorkerEnv,
  auth: ProjectIntakeAuthorization, intake: ProjectIntake, options: AtomicIntakeOptions, sql: string, bindings: readonly unknown[]): D1PreparedStatement {
  const sealed = postReceipts.get(token);
  if (!sealed) return fail("sponsor_intake_post_read_unavailable");
  const state = postState(sealed.allowance, undefined, env); state.life.check();
  if (state.action !== "commit-sponsored-image-draft" || sealed.post !== state || sealed.env !== env || sealed.db !== env.DB
    || sealed.auth !== auth || sealed.intake !== intake || sealed.options !== options || options.sponsorIntakeRead !== token
    || canonicalJson(intake) !== sealed.intakeJson || sealed.reading || state.reading) return fail("sponsor_intake_post_read_unavailable");
  const compiled = currentPostWrite(state, options.guard), full = sealed.proof.full;
  const at = 2 + full.bindings.length, tail = bindings.slice(at), stream = auth.user.streamId;
  if (sql !== `${nativeRootInsert}\n        VALUES(${nativeRootValues(full)})` || bindings.length !== at + 16
    || bindings[0] !== stream || bindings[1] !== String(intake.events[0]?.payload.client_event_id)
    || !sameBindings(bindings.slice(2, at), full.bindings)
    || tail[0] !== tail[4] || tail[0] !== tail[12] || tail[1] !== stream || tail[2] !== auth.user.userId
    || tail[3] !== intake.events.length || tail[5] !== stream || tail[6] !== intake.events.length - 1 || tail[7] !== stream
    || tail[8] !== tail[9] || tail[8] !== tail[10] || tail[8] !== tail[11]) return fail("sponsor_intake_read_native_query_changed");
  // The native outer authority stays complete and byte-identical; only the
  // exact compiler-created options guard is represented by all required gates.
  const native = sealed.proof.parts[0]!;
  const values = nativeRootValues({ sql: `(${native.sql}) AND (${postWriteGate(compiled)})`, bindings: [] });
  return preparePostWrite(env, compiled, nativeRootInsert, values, [...bindings.slice(0, 2), ...native.bindings, ...tail]);
}

/** The prepared-result scalar is part of the same charged request lifetime.
 * Its supplied native/source proof is additive to the complete captured read
 * ticket; no callback or caller-provided predicate can waive that ticket. */
export async function verifySponsorIntakePostPrepared(cap: SponsorIntakePostReadAllowance, request: Request, env: WorkerEnv,
  proof: BudgetReservationGuard): Promise<void> {
  const state = postState(cap, request, env); state.life.check();
  if (state.action !== "prepare-sponsored-image-draft" || !state.saved || state.reading)
    return fail("sponsor_intake_post_read_unavailable");
  const guard = composeSponsorIntakePostWriteGuard(cap, request, env, proof), compiled = currentPostWrite(state, guard);
  state.reading = true;
  try {
    const sql = `${compiled.ctes} SELECT 1 AS current FROM ${compiled.gates.join(" CROSS JOIN ")}`;
    const current = await state.life.run(() => state.db.prepare(sql).bind(...compiled.bindings).first<{ current: number }>());
    state.life.account(current); state.life.check();
    if (current?.current !== 1) return fail("sponsor_intake_original_unavailable");
  } finally { state.reading = false; }
}

/** A separate capability for the actual confirmation GET/POST. Its V2 read
 * operation does not inherit draft/commit permission or generation authority. */
declare const imageConfirmationAllowance: unique symbol;
export type SponsorImageConfirmationAllowance = Readonly<{ [imageConfirmationAllowance]: true }>;
type ConfirmationState = {
  request: Request; env: WorkerEnv; db: WorkerEnv["DB"]; authority: SponsorIntakeReadAuthority;
  auth: ProjectIntakeAuthorization; draftId: string; draftHash: string; mode: "read" | "confirm";
  original: IntakeReceipt; ticket: Awaited<ReturnType<typeof takeSponsorIntakeReadAttempt>>; life: Lifetime;
  saved: PostSaved | null; nativeReceipt: ExperienceIntakeReceipt | null; receiptProof?: BudgetReservationGuard;
  stableReceipt?: ConfirmationReceiptSnapshot;
  retained: BudgetReservationGuard[]; live: BudgetReservationGuard[] | null; nativeEnv?: WorkerEnv;
  reading: boolean; finishing: boolean; closed: boolean;
};
const confirmationAllowances = new WeakMap<SponsorImageConfirmationAllowance, ConfirmationState>();
const confirmationRequests = new WeakSet<Request>();
const compiledConfirmationGuards = new WeakSet<BudgetReservationGuard>();
function confirmationState(cap: SponsorImageConfirmationAllowance, request: Request, env: WorkerEnv, finishing = false) {
  const state = confirmationAllowances.get(cap);
  if (!state || state.request !== request || state.env !== env || state.db !== env.DB || state.closed
    || state.finishing && !finishing) return fail("sponsor_confirmation_unavailable");
  requireSponsorIntakeReadAuthority(state.authority, request, env);
  if (request.signal.aborted) return fail("sponsor_intake_post_read_cancelled");
  return state;
}
function confirmationAssertions(state: ConfirmationState): BudgetReservationGuard[] {
  return distinctPostGuards([...state.ticket.assertions.map(proof => ({ sql: proof.sql, bindings: [...proof.bindings] })),
    ...state.retained.map(capturePostGuard),
    ...(state.stableReceipt ? [...state.stableReceipt.support, state.stableReceipt.stable].map(capturePostGuard) : []),
    { sql: `${clock}<?`, bindings: [state.ticket.deadlineAtMs] }]);
}
function confirmationGuard(state: ConfirmationState): BudgetReservationGuard {
  const result = composeSponsorIntakePostGuards(...confirmationAssertions(state));
  compiledConfirmationGuards.add(result);
  return result;
}
function confirmationCompleteAssertions(state: ConfirmationState): BudgetReservationGuard[] {
  if (!state.saved || !state.nativeReceipt || !state.receiptProof || !state.stableReceipt) return fail("sponsor_confirmation_original_unavailable");
  return distinctPostGuards([...confirmationAssertions(state), capturePostGuard(state.receiptProof), ...(state.live ?? []).map(capturePostGuard)]);
}

/** The source-free original selects the historical campaign before admission.
 * Current generation eligibility is deliberately deferred to the write gate. */
export async function createSponsorImageConfirmationAllowance(request: Request, env: WorkerEnv,
  draftId: string): Promise<SponsorImageConfirmationAllowance> {
  if (confirmationRequests.has(request) || postRequests.has(request) || !isDraftId(draftId)
    || !["GET", "POST"].includes(request.method) || env.FORMA_PILOT_COHORT_ID?.trim()) return fail("sponsor_confirmation_request_invalid");
  confirmationRequests.add(request);
  const database = env.DB;
  const unchanged = () => {
    if (database !== env.DB) return fail("sponsor_confirmation_unavailable");
    if (request.signal.aborted) return fail("sponsor_intake_post_read_cancelled");
  };
  // This finite transport bound covers principal/control awaits before the
  // separately approved read ticket exists; it grants no private read budget.
  const transport = new Lifetime(65_536, performance.now() + 5_000, unchanged, request.signal);
  let draftHash: string | null = null;
  if (request.method === "POST") {
    const command = await transport.run(() => readSponsorIntakeCommand(request));
    if (!exactKeys(command, ["draftHash", "explicitRequirementsConfirmation"])
      || !hash(command.draftHash) || command.explicitRequirementsConfirmation !== true) return fail("sponsor_confirmation_request_invalid");
    draftHash = command.draftHash;
  } else if (request.body !== null) return fail("sponsor_confirmation_request_invalid");
  const principal = await transport.run(() => readExistingPrincipalRequest(request, env, "creator", { account: "principal" }));
  if ("kind" in principal || principal.response || !principal.user
    || principal.user.billingUserId && principal.user.billingUserId !== principal.user.userId) return fail("sponsor_intake_read_actor_unavailable");
  const authorized = await transport.run(() => continueExperienceAuthorization(request, env, principal));
  if (authorized instanceof Response) return fail("sponsor_intake_read_actor_unavailable");
  const auth = freeze(structuredClone(authorized));
  const original = await transport.run(() => postSource(database, auth, draftId)); transport.account(original);
  if (!validPostReceipt(original) || original.actor_user_id !== auth.user.userId || original.draft_id !== draftId)
    return fail("sponsor_intake_read_original_unavailable");
  if (draftHash !== null && draftHash !== original.draft_hash) return fail("sponsor_intake_intent_conflict");
  const authority = Object.freeze({}) as SponsorIntakeReadAuthority;
  authorities.set(authority, { request, env, db: database, auth, operation: "image-output-confirmation",
    campaignId: original.campaign_id, policyDigest: original.policy_digest, resourceKey: `draft:${draftId}`,
    original: freeze({ ...original }), assertions: [projectIntakeAuthority(env, auth,
      { projectId: original.project_id, documentId: original.document_id }), postLineage(auth, original), postCustody(auth, original)] });
  const attempt = await transport.run(() => reserveSponsorIntakeReadAttempt(authority, request, env, "image-output-confirmation"));
  const ticket = await transport.run(() => takeSponsorIntakeReadAttempt(attempt, authority, request, env));
  const cap = Object.freeze({}) as SponsorImageConfirmationAllowance;
  // Confirmation is a closed multi-stage native composition, with a separate
  // finite ceiling. Existing V1 readers retain their original twelve calls.
  const life = new Lifetime(ticket.maximumBytes, ticket.monotonicDeadline,
    () => { confirmationState(cap, request, env, true); }, request.signal, 128);
  confirmationAllowances.set(cap, { request, env, db: database, authority, auth, draftId, draftHash: original.draft_hash,
    mode: request.method === "POST" ? "confirm" : "read", original: freeze({ ...original }), ticket, life,
    saved: null, nativeReceipt: null, retained: [], live: null, reading: false, finishing: false, closed: false });
  life.check(); return cap;
}

export function requireSponsorImageConfirmationAllowance(cap: SponsorImageConfirmationAllowance, request: Request, env: WorkerEnv) {
  const state = confirmationState(cap, request, env); state.life.check();
  return freeze({ mode: state.mode, auth: state.auth, draftId: state.draftId, draftHash: state.draftHash, campaignId: state.original.campaign_id });
}

async function readConfirmationReceipt(state: ConfirmationState): Promise<ExperienceIntakeReceipt> {
  if (!state.saved) return fail("sponsor_confirmation_original_unavailable");
  const plan = state.saved.plan, stream = state.auth.user.streamId, prefix = receiptPrefix(plan.draftId);
  const intake = { projectId: plan.projectId, documentId: plan.documentId, events: structuredClone(plan.events) as ExperiencePlan["events"][number][] };
  const guard = confirmationGuard(state), options = { receiptPrefix: prefix, clientId: "web:experience-intake", correlationPrefix: "experience-intake:", guard };
  const native = projectIntakeAuthority(state.env, state.auth, intake), full = intakeGuard(state.env, state.auth, intake, options);
  const proof: NativeReceiptProof = { full, parts: [native, guard], expandPostComposition: true,
    prefixBindings: [stream, prefix.length, prefix, stream, JSON.stringify(intake.events.map(event => String(event.payload.client_event_id))), stream, state.auth.user.userId] };
  const observed: BudgetReservationGuard[] = [], snapshots: ConfirmationReceiptSnapshot[] = [];
  const response = await state.life.run(() => commitAtomicIntake(boundedNativeEnvironment(state.env, state.life, observed, proof, undefined, snapshots), state.auth, intake, "check", options));
  const body: unknown = await state.life.run(() => response.json());
  if (response.status !== 200 || !record(body) || body.status !== "complete" || body.projectId !== plan.projectId
    || body.documentId !== plan.documentId || !Array.isArray(body.appended) || body.appended.length !== plan.events.length
    || !Array.isArray(body.rejected) || body.rejected.length || !Number.isSafeInteger(body.head) || observed.length !== 1 || snapshots.length !== 1)
    return fail("sponsor_confirmation_original_unavailable");
  const snapshot = snapshots[0]!;
  if (state.stableReceipt && snapshot.stableRows !== state.stableReceipt.stableRows)
    return fail("sponsor_confirmation_original_changed");
  state.life.account(body); state.life.check();
  const receipt = freeze({ ...body, generation: "unavailable", draftId: plan.draftId, draftHash: plan.draftHash,
    documentRoute: experienceDocumentRoute(plan) }) as ExperienceIntakeReceipt;
  // Preserve the first exact mapping/body witness forever. Refreshing an own
  // output head never recaptures changed original bytes or nests prior proofs.
  // All support predicates accompanying the new head witness are already exact
  // members of the current mandatory conjunction, or must be retained here.
  const current = confirmationAssertions(state);
  if (state.stableReceipt && snapshot.support.some(proof => !current.some(existing => existing.sql === proof.sql
    && sameBindings(existing.bindings, proof.bindings)))) return fail("sponsor_confirmation_original_changed");
  state.stableReceipt ??= snapshot;
  state.receiptProof = capturePostGuard(snapshot.full); state.nativeReceipt = receipt;
  return receipt;
}

/** Read the exact marked draft through the existing native parser, then the
 * actual completed native receipt. Both are bounded before private bytes exit. */
export async function readSponsorImageConfirmationOriginal(cap: SponsorImageConfirmationAllowance, request: Request, env: WorkerEnv) {
  const state = confirmationState(cap, request, env); state.life.check();
  if (state.reading) return fail("sponsor_confirmation_unavailable");
  state.reading = true;
  try {
    const additional = confirmationGuard(state);
    const draftProof: PostDraftProof = { env, auth: state.auth, draftId: state.draftId, additional,
      base: projectIntakeAuthority(env, state.auth, { projectId: "", documentId: "" }) };
    const saved = await state.life.run(() => readDraft(boundedNativeEnvironment(env, state.life, [], undefined, draftProof), state.auth, state.draftId, additional));
    if (!saved) return fail("sponsor_confirmation_original_unavailable");
    const plan = saved.plan, original = state.original, marker = (plan as unknown as Row).sponsor_intake;
    if (plan.release.definition.id !== "image" || plan.release.output.output !== "image"
      || Object.hasOwn(plan, "reference") || Object.hasOwn(plan.request, "reference") || !record(marker)
      || !exactKeys(marker, ["version", "receiptId"]) || marker.version !== 1 || marker.receiptId !== original.receipt_id
      || original.native_intent_id !== plan.request.intentId || original.project_id !== plan.projectId || original.document_id !== plan.documentId
      || original.draft_hash !== plan.draftHash || original.expires_at !== saved.expiresAt
      || original.content_digest !== await state.life.run(() => digest(saved.content))
      || original.source_digest !== await state.life.run(() => digest(plan.events))
      || original.content_bytes !== new TextEncoder().encode(saved.content).byteLength
      || original.receipt_id !== `sponsor-intake-${(await state.life.run(() => digest({ campaignId: original.campaign_id,
        actor: state.auth.user.userId, intent: plan.request.intentId }))).slice(7)}`
      || state.saved && state.saved.content !== saved.content) return fail("sponsor_intake_read_original_changed");
    state.life.check();
    state.saved = freeze({ ...saved, receipt: original });
    state.retained = freeze([retainedGuard(state.auth, plan, saved.content)]);
    const nativeReceipt = await readConfirmationReceipt(state);
    return freeze({ ...state.saved, auth: state.auth, nativeReceipt });
  } finally { state.reading = false; }
}

export function sponsorImageConfirmationAssertions(cap: SponsorImageConfirmationAllowance, request: Request, env: WorkerEnv): OutputSqlAssertion[] {
  const state = confirmationState(cap, request, env); state.life.check();
  return confirmationCompleteAssertions(state).map(proof => ({ sql: proof.sql, bindings: [...proof.bindings] }));
}

/** Called only for a missing native save/confirm stage. Exact completed replay
 * does not acquire this prospective generation-campaign eligibility proof. */
export async function requireSponsorImageConfirmationWrite(cap: SponsorImageConfirmationAllowance, request: Request, env: WorkerEnv): Promise<OutputSqlAssertion[]> {
  const state = confirmationState(cap, request, env); state.life.check();
  if (state.mode !== "confirm" || state.reading || !state.saved || !state.nativeReceipt) return fail("sponsor_confirmation_write_unavailable");
  const approved = await state.life.run(() => loadApprovedSponsorCampaign(request, env, state.original.campaign_id));
  const release = await state.life.run(() => registeredExperience("image"));
  state.life.check();
  if (approved.actor.userId !== state.auth.user.userId || approved.policyDigest !== state.original.policy_digest
    || approved.policy.resources.version !== 2 || !release || canonicalJson(release) !== canonicalJson(state.saved.plan.release)
    || !approved.policy.templates.some(template => template.appId === "image" && template.releaseDigest === release.releaseHash))
    return fail("sponsor_confirmation_write_unavailable");
  state.live = freeze(approved.assertions.map(proof => ({ sql: proof.sql, bindings: [...(proof.bindings ?? [])] })));
  return confirmationCompleteAssertions(state).map(proof => ({ sql: proof.sql, bindings: [...proof.bindings] }));
}

export function sponsorImageConfirmationEnvironment(cap: SponsorImageConfirmationAllowance, request: Request, env: WorkerEnv): WorkerEnv {
  const state = confirmationState(cap, request, env); state.life.check();
  if (!state.saved || !state.nativeReceipt) return fail("sponsor_confirmation_original_unavailable");
  return state.nativeEnv ??= createSponsorImageConfirmationNativeEnvironment(env, {
    auth: state.auth, plan: state.saved.plan,
    check: () => { confirmationState(cap, request, env); state.life.check(); }, remaining: () => state.life.remaining(),
    account: value => state.life.account(value), run: work => state.life.run(work),
    assertions: () => confirmationAssertions(state), nativeAssertions: () => confirmationCompleteAssertions(state),
    allowWrite: () => {
      confirmationState(cap, request, env); state.life.check();
      if (state.mode !== "confirm" || !state.live || !state.nativeReceipt || !state.receiptProof)
        return fail("sponsor_confirmation_write_unavailable");
    },
  });
}

/** Only the current_head observation is replaced after a native stage; all
 * original marked bytes, custody, ticket and read approval remain mandatory. */
export async function refreshSponsorImageConfirmationReceipt(cap: SponsorImageConfirmationAllowance, request: Request, env: WorkerEnv) {
  const state = confirmationState(cap, request, env); state.life.check();
  if (state.mode !== "confirm" || !state.live || state.reading || !state.saved) return fail("sponsor_confirmation_write_unavailable");
  state.reading = true;
  try { return await readConfirmationReceipt(state); }
  finally { state.reading = false; }
}

/** Additive final output/source evidence cannot replace any mandatory ticket,
 * original native receipt, body, custody, read-policy or deadline predicate. */
export async function finishSponsorImageConfirmation(cap: SponsorImageConfirmationAllowance, request: Request, env: WorkerEnv,
  body: unknown, status = 200, extraAssertions: readonly OutputSqlAssertion[] = []): Promise<Response> {
  const state = confirmationState(cap, request, env); state.life.check();
  if (state.reading || !Number.isInteger(status) || status < 200 || status > 599) return fail("sponsor_confirmation_unavailable");
  const extra = extraAssertions.map(proof => ({ sql: proof.sql, bindings: [...(proof.bindings ?? [])] }));
  const final = distinctPostGuards([...confirmationCompleteAssertions(state), ...extra]);
  state.finishing = true;
  try {
    const serialized = JSON.stringify(body);
    if (typeof serialized !== "string") return fail("sponsor_confirmation_unavailable");
    state.life.accountSerialized(serialized);
    let prefix = "sponsor_image_confirmation_final";
    while (final.some(proof => proof.sql.toLowerCase().includes(prefix))) prefix += "_";
    const gates = final.map((proof, index) => ({ name: `${prefix}_${index}`, sql: proof.sql }));
    const packed = packSponsorIntakeReadQuery(`WITH ${gates.map(gate => `${gate.name} AS MATERIALIZED (SELECT 1 WHERE ${gate.sql})`).join(",")}
      SELECT 1 AS current FROM ${gates.map(gate => gate.name).join(" CROSS JOIN ")}`, final.flatMap(proof => [...proof.bindings]));
    const current = await state.life.run(() => state.db.prepare(packed.sql).bind(...packed.bindings).first<{ current: number }>());
    state.life.account(current); state.life.check();
    if (current?.current !== 1) return fail("sponsor_intake_read_custody_changed");
    return new Response(serialized, { status, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  } finally { state.closed = true; }
}

type EntryModeSelector = Readonly<{ kind: "fresh" }> | Readonly<{ draftId: string }> | Readonly<{ intentId: string }>;
type EntryModeSelection = Readonly<{ enabled: boolean; campaignId: string | null; selector: EntryModeSelector }>;
const metadataActorColumns = ["user_id", "email", "display_name", "role", "consent_version", "consented_at", "updated_at",
  "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements"] as const;
const modeBytes = (value: string) => new TextEncoder().encode(value).byteLength;
const modeError = (): never => fail("sponsor_image_entry_mode_unavailable");
// Inspect ACK data without invoking accessors or accepting inherited fields.
// These checks acknowledge only this fixed metadata facade, not new authority.
const modeOwnData = (value: unknown, key: PropertyKey): unknown => {
  if (!value || typeof value !== "object") return modeError();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) return modeError();
  return descriptor.value;
};
const modeExactData = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return modeError();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== "string" || !keys.includes(key))) return modeError();
  return Object.fromEntries(keys.map(key => [key, modeOwnData(value, key)]));
};
const modeDenseData = (value: unknown, length: number): unknown[] => {
  if (!Array.isArray(value) || modeOwnData(value, "length") !== length) return modeError();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.some(key => key !== "length"
    && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) return modeError();
  return Array.from({ length }, (_, index) => modeOwnData(value, String(index)));
};
const modeAuthorized = (value: unknown) => modeExactData(value, ["authorized"]).authorized === 1;
const metadataJson = (columns: readonly string[], qualifier = "") => {
  let expression = "json_object()";
  for (let at = 0; at < columns.length; at += 15) expression = `json_set(${expression},${columns.slice(at, at + 15)
    .map(column => `'$.${column}',${qualifier}"${column}"`).join(",")})`;
  return expression;
};
const metadataActorJson = metadataJson(metadataActorColumns);

/** Fixed control-plane projection only. Approval receipts are the expressly
 * retained exception: they may contain copied payer project names before debit.
 * They never enter the browser DTO. No creative body query is accepted here.
 * A local timeout stops further work/disclosure, not an already submitted D1 query. */
class EntryModeScope {
  readonly env: WorkerEnv;
  readonly database: WorkerEnv["DB"];
  readonly request: Request;
  readonly original: WorkerEnv;
  deadline = performance.now() + 5000;
  bytes = 0;
  queries = 0;
  private readonly headerSnapshot: string;
  private readonly projections = new Map<string, readonly string[]>();
  private readonly statements = new WeakMap<object, { sql: string; bindings: readonly (string | number | null)[]; columns: readonly string[] | null }>();
  constructor(request: Request, env: WorkerEnv) {
    this.request = request; this.original = env; this.database = env.DB;
    this.headerSnapshot = this.identityHeaders();
    const prepare = (sql: string) => {
      this.check();
      const columns = this.projections.get(sql) ?? this.ledgerProjection(sql);
      const statement = (bindings: readonly (string | number | null)[]): object => {
        const value = {
          bind: (...next: (string | number | null)[]) => statement([...next]),
          first: async (column?: string) => {
            if (column !== undefined) return modeError();
            const result = await this.execute(value);
            return result.results[0] ?? null;
          },
          all: () => this.execute(value),
          run: () => modeError(), raw: () => modeError(),
        };
        this.statements.set(value, { sql, bindings: Object.freeze([...bindings]), columns });
        return value;
      };
      return statement([]);
    };
    const DB = { prepare, exec: () => modeError(), batch: async (values: object[]) => {
      this.check();
      if (values.length !== 2) return modeError();
      const captured = values.map(value => this.statements.get(value));
      if (!captured[0] || captured[0].columns !== null || !captured[1] || captured[1].columns === null
        || !captured[1].sql.startsWith("SELECT attempt_id,campaign_id,sponsor_policy_digest,read_policy_digest,actor_user_id,resource_key,")) return modeError();
      const compiled = captured.map(value => this.compile(value!));
      const results = modeDenseData(await this.wait(() => this.database.batch(compiled), values.length), 2);
      if (modeOwnData(results[0], "success") !== true) return modeError();
      const changes = modeOwnData(modeOwnData(results[0], "meta"), "changes");
      if (changes !== 0 && changes !== 1) return modeError();
      // Never pass an unchecked native ACK into the unchanged allowance ledger.
      // A malformed ACK after a durable INSERT retains the charge and discloses nothing.
      // Preserve the native zero-row quota denial so the ledger keeps its 429 path.
      return [{ success: true, meta: { changes }, results: [] }, this.decode(results[1], captured[1].columns)];
    } } as unknown as WorkerEnv["DB"];
    this.env = { ...env, DB }; this.capturedFacade = DB;
  }
  check() {
    if (this.original.DB !== this.database || this.env && this.env.DB !== this.capturedFacade) return modeError();
    if (this.identityHeaders() !== this.headerSnapshot) return modeError();
    if (this.request.signal.aborted) return fail("sponsor_intake_post_read_cancelled");
    if (performance.now() >= this.deadline) return fail("sponsor_intake_read_deadline");
  }
  // The facade identity is captured once after construction, never looked up
  // from an externally replaceable binding during a disclosure check.
  private capturedFacade?: WorkerEnv["DB"];
  private identityHeaders() {
    return JSON.stringify(["oai-authenticated-user-id", "oai-authenticated-user-email", "oai-authenticated-user-full-name",
      "oai-authenticated-user-full-name-encoding", "cookie"].map(name => this.request.headers.get(name)));
  }
  async wait<T>(work: () => Promise<T>, count = 0): Promise<T> {
    this.check(); if ((this.queries += count) > 12) return fail("sponsor_intake_read_query_limit");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(new SponsorEntitlementError("sponsor_intake_post_read_cancelled"));
        this.request.signal.addEventListener("abort", abort, { once: true });
        if (this.request.signal.aborted) abort();
      });
      this.check();
      const result = await Promise.race([work(), cancelled, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SponsorEntitlementError("sponsor_intake_read_deadline")), Math.max(1, this.deadline - performance.now()));
      })]);
      this.check(); return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) this.request.signal.removeEventListener("abort", abort);
    }
  }
  register(sql: string, columns: readonly string[]) {
    if (!columns.length || columns.some(value => !/^[a-z_][a-z0-9_]*$/u.test(value))) return modeError();
    this.projections.set(sql, Object.freeze([...columns])); return sql;
  }
  private ledgerProjection(sql: string): readonly string[] | null {
    // These are the five fixed control statements in the unchanged approved
    // policy/reservation/take functions. Their predicates/bind vectors remain
    // untouched; the adapter only closes and bounds the returned row shape.
    if (sql.startsWith("SELECT policy.campaign_id,policy.sponsor_policy_digest,policy.read_policy_digest,"))
      return ["campaign_id", "sponsor_policy_digest", "read_policy_digest", "policy_json", "review_receipt_digest", "approval_id",
        "original_approval_id", "payer_user_id", "terms_digest", "terms_json", "review_receipt_json", "approval_command_json", "original_terms_digest", "payer_authority_json"];
    if (sql.startsWith("INSERT INTO experience_sponsor_intake_read_attempts(attempt_id,campaign_id,sponsor_policy_digest,read_policy_digest,")) return null;
    if (sql.startsWith("SELECT attempt_id,campaign_id,sponsor_policy_digest,read_policy_digest,actor_user_id,resource_key,"))
      return ["attempt_id", "campaign_id", "sponsor_policy_digest", "read_policy_digest", "actor_user_id", "resource_key", "operation", "maximum_bytes", "admitted_at_ms", "deadline_at_ms", "charged_through_ms"];
    if (sql.startsWith(`SELECT ${clock} AS now_ms,`)) return ["now_ms", "campaign_requests", "campaign_bytes", "actor_requests", "actor_bytes", "retry_at_ms"];
    if (sql.startsWith("WITH sponsor_intake_sample_gate") && sql.includes(`SELECT 1 AS available,${clock} AS now_ms`)) return ["available", "now_ms"];
    return modeError();
  }
  private compile(value: { sql: string; bindings: readonly (string | number | null)[]; columns: readonly string[] | null }) {
    this.check();
    let sql = value.sql;
    if (sql === "SELECT type,sql FROM sqlite_master WHERE lower(name)=? AND type IN('table','view')")
      sql = "SELECT type,CASE WHEN typeof(sql)='text' AND length(CAST(sql AS BLOB))<=32768 THEN sql END AS sql FROM sqlite_master WHERE lower(name)=? AND type IN('table','view')";
    if (value.columns !== null) {
      const remaining = Math.max(0, 1048576 - this.bytes);
      sql = `WITH mode_original AS MATERIALIZED (${sql}),mode_rows AS MATERIALIZED (
        SELECT ${metadataJson(value.columns)} AS mode_json FROM mode_original),mode_aggregate AS (
        SELECT COUNT(*) AS mode_count,json_group_array(json(mode_json)) AS mode_body FROM mode_rows)
        SELECT mode_count,length(CAST(mode_body AS BLOB)) AS mode_bytes,
          CASE WHEN mode_count<=1 AND length(CAST(mode_body AS BLOB))<=${remaining} THEN mode_body END AS mode_body FROM mode_aggregate`;
    }
    const packed = packSponsorIntakeReadQuery(sql, value.bindings);
    return this.database.prepare(packed.sql).bind(...packed.bindings);
  }
  private decode(result: unknown, columns: readonly string[]) {
    this.check();
    if (modeOwnData(result, "success") !== true) return modeError();
    const [metadata] = modeDenseData(modeOwnData(result, "results"), 1);
    const row = modeExactData(metadata, ["mode_count", "mode_bytes", "mode_body"]);
    if (row.mode_count !== 0 && row.mode_count !== 1
      || !Number.isSafeInteger(row.mode_bytes) || Number(row.mode_bytes) < 0
      || typeof row.mode_body !== "string" || modeBytes(row.mode_body) !== row.mode_bytes
      || this.bytes + Number(row.mode_bytes) > 1048576) return modeError();
    this.bytes += Number(row.mode_bytes);
    const parsed = modeDenseData(JSON.parse(row.mode_body), row.mode_count);
    const rows = parsed.map(value => {
      const data = modeExactData(value, columns);
      if (Object.values(data).some(cell => cell !== null && typeof cell !== "string"
        && (typeof cell !== "number" || !Number.isFinite(cell)))) return modeError();
      return data;
    });
    return { success: true as const, results: rows };
  }
  private async execute(statement: object) {
    const value = this.statements.get(statement);
    if (!value || value.columns === null) return modeError();
    const native = this.compile(value), result = await this.wait(() => native.all(), 1);
    return this.decode(result, value.columns);
  }
  async first(sql: string, bindings: readonly (string | number | null)[], columns: readonly string[]) {
    return this.env.DB.prepare(this.register(sql, columns)).bind(...bindings).first<Row>();
  }
}

function metadataCurrentProof(proofs: readonly BudgetReservationGuard[], label: "ordinary" | "final") {
  const names = proofs.map((_, index) => `entry_mode_gate_${index}`);
  return { sql: `/* sponsor-image-entry-mode-${label} */ WITH ${proofs.map((proof, index) =>
    `${names[index]} AS MATERIALIZED (SELECT 1 WHERE ${proof.sql})`).join(",")} SELECT 1 AS authorized FROM ${names.join(" CROSS JOIN ")}`,
    bindings: proofs.flatMap(proof => proof.bindings) };
}

/** Bootstrap metadata is nonauthorizing. Its private map can consume only the
 * existing exact bootstrap ledger. No retained plan/event/receipt body is read. */
export async function readSponsorImageEntryMode(request: Request, env: WorkerEnv, input: EntryModeSelection): Promise<Response> {
  if (request.method !== "GET" || request.body || jsonIssues(input).length || !record(input)
    || !exactKeys(input, ["enabled", "campaignId", "selector"]) || typeof input.enabled !== "boolean"
    || input.campaignId !== null && !id(input.campaignId) || !record(input.selector)) return modeError();
  const selected = freeze(structuredClone(input.selector)) as unknown as Row;
  const fresh = exactKeys(selected, ["kind"]) && selected.kind === "fresh";
  if (!fresh && !(exactKeys(selected, ["draftId"]) && typeof selected.draftId === "string" && isDraftId(selected.draftId))
    && !(exactKeys(selected, ["intentId"]) && isIntentId(selected.intentId))) return modeError();
  const reply = (mode: "ordinary" | "sponsor-image", actorUserId?: string) => {
    const body = JSON.stringify({ version: 1, mode, ...(actorUserId ? { actorUserId } : {}), selector: selected });
    if (modeBytes(body) > 1024) return modeError();
    return new Response(body, { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  };
  if (request.signal.aborted) return fail("sponsor_intake_post_read_cancelled");
  if (fresh && !input.enabled) return reply("ordinary");
  const scope = new EntryModeScope(request, env), identity = identityFromRequest(request);
  if (!identity || modeBytes(identity.userId) > 240 || modeBytes(identity.email) > 320 || modeBytes(identity.displayName) > 1024
    || [...identity.userId + identity.email].some(character => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127)) return modeError();
  const draftId = fresh ? null : "draftId" in selected ? String(selected.draftId) : await scope.wait(() => experienceDraftId(identity.userId, String(selected.intentId)));
  if (draftId) {
    // Register only the exact existing classification SELECTs. The native
    // classifier keeps its same final negative proof, including schema absence.
    scope.register("SELECT type,sql FROM sqlite_master WHERE lower(name)=? AND type IN('table','view')", ["type", "sql"]);
    scope.register("SELECT 1 AS sponsored FROM experience_sponsor_intakes WHERE draft_id=? LIMIT 1", ["sponsored"]);
    scope.register("SELECT 1 AS sponsored FROM private_content WHERE content_id=? AND (CASE WHEN json_valid(content) THEN json_type(content,'$.sponsor_intake') IS NOT NULL ELSE 0 END) LIMIT 1", ["sponsored"]);
    const classification = await scope.wait(() => classifySponsorIntakeDraft(scope.env, draftId));
    scope.check();
    if (classification.kind === "unavailable") return modeError();
    if (classification.kind === "ordinary") {
      const final = metadataCurrentProof([classification.guard], "ordinary");
      if (!modeAuthorized(await scope.first(final.sql, final.bindings, ["authorized"]))) return modeError();
      scope.check(); return reply("ordinary");
    }
  }
  if (!input.enabled || fresh && !input.campaignId || env.FORMA_PILOT_COHORT_ID?.trim()
    || modeBytes(request.headers.get("cookie") ?? "") > 8192 || (request.headers.get("cookie") ?? "").split(";")
      .some(part => /^(?:forma_impersonation|forma_project_context)(?:=|$)/u.test(part.trim()))) return modeError();
  const actorQuery = `WITH entry_mode_principal AS MATERIALIZED (${PLATFORM_PRINCIPAL_WITH_ACCESS_SQL})
    SELECT ${metadataActorJson} AS auth_json FROM entry_mode_principal
    WHERE length(CAST(${metadataActorJson} AS BLOB))<=131072`;
  const actorRow = await scope.first(actorQuery, [identity.userId], ["auth_json"]);
  if (!actorRow || typeof actorRow.auth_json !== "string") return modeError();
  const actor = JSON.parse(actorRow.auth_json) as Row;
  if (actor.user_id !== identity.userId || actor.email !== identity.email || actor.display_name !== identity.displayName
    || !["creator", "admin"].includes(String(actor.role)) || actor.consent_version !== POLICY_VERSION) return modeError();
  const access = await scope.wait(() => principalAccessFromRow(actor, String(actor.role), {
    email: identity.email, source: identity.source, subject: identity.userId,
  }));
  if (access.identityPolicyDeniedCustody || !access.capabilities.includes("project.author")) return modeError();
  const actorProof: BudgetReservationGuard = { sql: `EXISTS(WITH entry_mode_principal AS MATERIALIZED (${PLATFORM_PRINCIPAL_WITH_ACCESS_SQL})
    SELECT 1 FROM entry_mode_principal WHERE ${metadataActorJson}=?)`, bindings: [identity.userId, actorRow.auth_json] };
  let campaignId: string, policyDigest: string, resourceKey: string;
  const assertions: BudgetReservationGuard[] = [actorProof];
  if (draftId) {
    const sql = `SELECT ${receiptColumns.map(column => `intake.${column}`).join(",")} ${originalFrom}`;
    const original = await scope.first(sql, [draftId, identity.userId], receiptColumns) as IntakeReceipt | null;
    if (!original || !id(original.campaign_id) || !hash(original.policy_digest) || !hash(original.content_digest)
      || !hash(original.source_digest) || !hash(original.draft_hash) || !Number.isSafeInteger(original.content_bytes)) return modeError();
    campaignId = original.campaign_id; policyDigest = original.policy_digest; resourceKey = `draft:${draftId}`;
    assertions.push({ sql: `EXISTS(SELECT 1 ${originalFrom} AND json_array(${receiptColumns.map(column => `intake.${column}`).join(",")})=?)`,
      bindings: [draftId, identity.userId, JSON.stringify(receiptColumns.map(column => original[column]))] },
    { sql: `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='experience-draft'
        AND redacted_at IS NULL AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=?)
      AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=?)
      AND NOT EXISTS(SELECT 1 FROM organization_projects WHERE project_id=?)
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='document' AND resource_id=?)
      AND NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND type IN('DocumentRemoved','ProjectRemoved')
        AND (type='DocumentRemoved' AND json_extract(payload,'$.document_id')=? OR type='ProjectRemoved' AND json_extract(payload,'$.project_id')=?))`,
      bindings: [draftId, identity.userId, original.expires_at, draftId, draftId, original.project_id,
        original.document_id, `creative:${identity.userId}`, original.document_id, original.project_id] });
  } else {
    campaignId = input.campaignId!;
    const campaign = await scope.first(`SELECT CASE WHEN length(CAST(policy_json AS BLOB))<=131072 THEN policy_json END AS policy_json,
      policy_digest FROM experience_sponsor_campaigns WHERE campaign_id=? AND enabled=1`, [campaignId], ["policy_json", "policy_digest"]);
    if (!campaign || typeof campaign.policy_json !== "string" || typeof campaign.policy_digest !== "string") return modeError();
    const policy = readSponsorPolicy(JSON.parse(campaign.policy_json)), release = await scope.wait(() => registeredExperience("image"));
    if (policy.mode !== "candidate" || policy.version !== 2 || policy.campaignId !== campaignId || policy.resources.version !== 2
      || !release || !policy.templates.some(template => template.appId === "image" && template.releaseDigest === release.releaseHash)
      || canonicalJson(policy) !== campaign.policy_json || await scope.wait(() => digest(policy)) !== campaign.policy_digest) return modeError();
    policyDigest = campaign.policy_digest; resourceKey = `bootstrap:${campaignId}`;
    const approved = sponsorApprovalAssertion(policy, identity.userId, true);
    assertions.push({ sql: approved.sql, bindings: [...(approved.bindings ?? [])] },
      { sql: `NOT EXISTS(SELECT 1 FROM pilot_participants participant JOIN pilot_cohorts cohort ON cohort.cohort_id=participant.cohort_id
        WHERE participant.user_id IN(?,?) AND participant.status='active' AND participant.revoked_at IS NULL AND cohort.status IN('active','paused','closed'))`,
        bindings: [identity.userId, policy.payerUserId] },
      { sql: `EXISTS(SELECT 1 FROM experience_sponsor_campaigns WHERE campaign_id=? AND enabled=1 AND policy_digest=? AND policy_json=?)
        AND ${clock}>=? AND ${clock}<?`, bindings: [campaignId, policyDigest, campaign.policy_json, policy.startsAtMs, policy.expiresAtMs] },
      { sql: `NOT EXISTS(SELECT 1 FROM organization_projects WHERE owner_user_id=? AND project_id='')
        AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE owner_user_id=? AND resource_kind='document' AND resource_id='')`,
        bindings: [identity.userId, identity.userId] });
  }
  scope.check();
  const authority = Object.freeze({}) as SponsorIntakeReadAuthority;
  metadataAuthorities.set(authority, { request, env: scope.env, db: scope.env.DB, actorUserId: identity.userId,
    campaignId, policyDigest, resourceKey, assertions: freeze(assertions), current: () => scope.check() });
  const attempt = await scope.wait(() => reserveSponsorIntakeReadAttempt(authority, request, scope.env, "image-intake-bootstrap"));
  const ticket = await scope.wait(() => takeSponsorIntakeReadAttempt(attempt, authority, request, scope.env));
  scope.deadline = Math.min(scope.deadline, ticket.monotonicDeadline);
  const response = reply("sponsor-image", identity.userId);
  if (modeBytes(JSON.stringify({ version: 1, mode: "sponsor-image", actorUserId: identity.userId, selector: selected })) > ticket.maximumBytes) return modeError();
  const final = metadataCurrentProof([...ticket.assertions.map(proof => ({ sql: proof.sql, bindings: [...proof.bindings] })),
    { sql: `${clock}<?`, bindings: [ticket.deadlineAtMs] }], "final");
  if (!modeAuthorized(await scope.first(final.sql, final.bindings, ["authorized"]))) return modeError();
  scope.check(); requireSponsorIntakeReadAuthority(authority, request, scope.env);
  return response;
}
