import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { compileSponsorApprovalProposal, sponsorApprovalAssertion } from "./experience-sponsor-approval.ts";
import { readSponsorAudioIntakePolicy, SPONSOR_AUDIO_INTAKE_POLICY_SCHEMA, type SponsorAudioIntakePolicyV1 } from "./experience-sponsor-audio-intake-policy.ts";
import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { readExistingPrincipalRequest } from "./principal-request-core.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";
import { uuidV7 } from "./event-write-primitives.ts";
import { readSponsorIntakeCommand } from "./experience-sponsor-intake-command.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (code: string): never => { throw new SponsorEntitlementError(code); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const boundedJson = (column: string, maximumBytes: number) => `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${maximumBytes} AND instr(${column},char(0))=0 THEN ${column} END`;
const clock = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
export type SponsorAudioIntakeApprovalProposal = {
  version: 1; family: "canonical-audio-initial-intake@1"; campaignId: string; sponsorPolicyDigest: string; intakePolicy: SponsorAudioIntakePolicyV1;
};
type OriginalApproval = { approval_id: string; campaign_id: string; payer_user_id: string; terms_json: string; terms_digest: string;
  policy_json: string; policy_digest: string; payer_authority_json: string; approval_command_json: string };

/** Dormant initial-context allocation: no initializer, registered route or launch
 * policy. Both new rows are installed together by the actual original V8 payer.
 * Neither a detached policy nor its digest is authority. */
export const SPONSOR_AUDIO_INTAKE_APPROVAL_SCHEMA = Object.freeze([
  `CREATE TABLE experience_sponsor_audio_intake_approvals(
    approval_id TEXT PRIMARY KEY NOT NULL,campaign_id TEXT NOT NULL,sponsor_policy_digest TEXT NOT NULL,
    original_approval_id TEXT NOT NULL REFERENCES experience_sponsor_approvals(approval_id),payer_user_id TEXT NOT NULL,
    intake_policy_digest TEXT NOT NULL,terms_json TEXT NOT NULL,terms_digest TEXT NOT NULL,
    review_receipt_json TEXT NOT NULL,review_receipt_digest TEXT UNIQUE NOT NULL,
    approval_command_json TEXT NOT NULL,approved_by_user_id TEXT NOT NULL,approved_at_ms INTEGER NOT NULL,
    UNIQUE(campaign_id,sponsor_policy_digest),CHECK(approved_by_user_id=payer_user_id),
    CHECK(typeof(approved_at_ms)='integer' AND approved_at_ms>=0),
    FOREIGN KEY(campaign_id,sponsor_policy_digest) REFERENCES experience_sponsor_audio_intake_policies(campaign_id,sponsor_policy_digest)
      DEFERRABLE INITIALLY DEFERRED) WITHOUT ROWID`,
  ...["UPDATE", "DELETE"].map(action => `CREATE TRIGGER experience_sponsor_audio_intake_approvals_no_${action.toLowerCase()}
    BEFORE ${action} ON experience_sponsor_audio_intake_approvals BEGIN SELECT RAISE(ABORT,'sponsor_audio_intake_approval_immutable'); END`),
  `CREATE TRIGGER experience_sponsor_audio_intake_approvals_no_replace BEFORE INSERT ON experience_sponsor_audio_intake_approvals
    WHEN EXISTS(SELECT 1 FROM main.experience_sponsor_audio_intake_approvals old WHERE old.approval_id=NEW.approval_id
      OR (old.campaign_id=NEW.campaign_id AND old.sponsor_policy_digest=NEW.sponsor_policy_digest)
      OR old.review_receipt_digest=NEW.review_receipt_digest)
    BEGIN SELECT RAISE(ABORT,'sponsor_audio_intake_approval_exists'); END`,
]);

function proposal(raw: unknown): Readonly<SponsorAudioIntakeApprovalProposal> {
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["version", "family", "campaignId", "sponsorPolicyDigest", "intakePolicy"])
    || raw.version !== 1 || raw.family !== "canonical-audio-initial-intake@1" || !id(raw.campaignId) || !hash(raw.sponsorPolicyDigest)) return fail("sponsor_audio_intake_approval_terms_invalid");
  return freeze({ version: 1, family: "canonical-audio-initial-intake@1", campaignId: raw.campaignId, sponsorPolicyDigest: raw.sponsorPolicyDigest,
    intakePolicy: readSponsorAudioIntakePolicy(raw.intakePolicy) });
}

export type SponsorAudioIntakeReadLimits = {
  current: () => void; monotonicDeadline: number; signal: AbortSignal;
};
type Scalar = string | number | boolean | null;
const encoder = new TextEncoder();
function ownData(value: unknown, key: PropertyKey): unknown {
  if (!value || typeof value !== "object") return fail("sponsor_audio_intake_acknowledgement_missing");
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value"))
    return fail("sponsor_audio_intake_acknowledgement_missing");
  return descriptor.value;
}
type JsonBudget = { nodes: number; bytes: number; maximum: number };
function charge(budget: JsonBudget, bytes: number) {
  budget.bytes += bytes;
  if (!Number.isSafeInteger(budget.bytes) || budget.bytes > budget.maximum) return fail("sponsor_audio_intake_control_limit");
}
/** Count the exact JSON UTF-8 bytes before copying/serializing the envelope.
 * Escaped controls and lone surrogates cannot hide behind input string length. */
function chargeString(value: string, budget: JsonBudget) {
  if (value.length > 2_097_152) return fail("sponsor_audio_intake_control_limit");
  charge(budget, 2);
  let rawBytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    let raw = code < 0x80 ? 1 : code < 0x800 ? 2 : 3, serialized = raw;
    if (code === 0x22 || code === 0x5c) serialized = 2;
    else if (code < 0x20) serialized = [8, 9, 10, 12, 13].includes(code) ? 2 : 6;
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      raw = serialized = 4; index++;
    } else if (code >= 0xd800 && code <= 0xdfff) serialized = 6;
    rawBytes += raw;
    if (rawBytes > 2_097_152) return fail("sponsor_audio_intake_control_limit");
    charge(budget, serialized);
  }
}
/** Copy only dense, own enumerable data. No raw object's toJSON, accessor or
 * inherited field can execute. One shared budget bounds the complete batch. */
function copyJson(value: unknown, budget: JsonBudget, depth = 0): unknown {
  if (++budget.nodes > 4096 || depth > 8) return fail("sponsor_audio_intake_acknowledgement_missing");
  if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) {
    charge(budget, JSON.stringify(value).length); return value;
  }
  if (typeof value === "string") { chargeString(value, budget); return value; }
  if (!value || typeof value !== "object") return fail("sponsor_audio_intake_acknowledgement_missing");
  if (Array.isArray(value)) {
    if (value.length > 1024 || Reflect.ownKeys(value).length !== value.length + 1) return fail("sponsor_audio_intake_acknowledgement_missing");
    charge(budget, 2 + Math.max(0, value.length - 1));
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index++) result.push(copyJson(ownData(value, index), budget, depth + 1));
    return result;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > 64) return fail("sponsor_audio_intake_acknowledgement_missing");
  charge(budget, 2 + Math.max(0, keys.length - 1));
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string" || key.length > 200) return fail("sponsor_audio_intake_acknowledgement_missing");
    chargeString(key, budget); charge(budget, 1);
    result[key] = copyJson(ownData(value, key), budget, depth + 1);
  }
  return result;
}
function acknowledged(raw: unknown, budget: JsonBudget): Record<string, unknown> {
  if (ownData(raw, "success") !== true || "error" in (raw as object) || !Array.isArray(ownData(raw, "results")))
    return fail("sponsor_audio_intake_acknowledgement_missing");
  return copyJson(raw, budget) as Record<string, unknown>;
}

/** A caller's optional check/deadline can only narrow this captured lifetime.
 * It supplies no payer, actor or database authority. SQL consumers must still
 * prove each recorded receipt and current native custody at their final batch. */
export function createSponsorAudioIntakeReadBoundary(request: Request, env: WorkerEnv, limits?: SponsorAudioIntakeReadLimits) {
  const database = env.DB, cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS;
  const method = request.method, url = request.url, signal = request.signal, headers = JSON.stringify([...request.headers]);
  const extraCurrent = limits?.current, extraSignal = limits?.signal;
  const deadline = Math.min(performance.now() + 30_000, limits?.monotonicDeadline ?? Infinity);
  let controlBytes = 0;
  if (!Number.isFinite(deadline) || encoder.encode(headers).byteLength > 32_768) return fail("sponsor_audio_intake_control_limit");
  const check = () => {
    extraCurrent?.();
    if (env.DB !== database || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== admins
      || request.method !== method || request.url !== url || request.signal !== signal || signal.aborted || extraSignal?.aborted
      || JSON.stringify([...request.headers]) !== headers || performance.now() >= deadline)
      return fail("sponsor_audio_intake_authority_changed");
  };
  const wait = async <T>(operation: () => Promise<T>): Promise<T> => {
    check();
    let timer: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | undefined;
    try {
      const result = await Promise.race([operation(), new Promise<never>((_, reject) => {
        cancel = () => reject(new SponsorEntitlementError("sponsor_audio_intake_authority_changed"));
        signal.addEventListener("abort", cancel, { once: true });
        extraSignal?.addEventListener("abort", cancel, { once: true });
        if (signal.aborted || extraSignal?.aborted) cancel();
        timer = setTimeout(cancel, Math.max(0, deadline - performance.now()));
      })]);
      check(); return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (cancel) { signal.removeEventListener("abort", cancel); extraSignal?.removeEventListener("abort", cancel); }
      check();
    }
  };
  const account = (budget: JsonBudget) => {
    controlBytes += budget.bytes;
    if (!Number.isSafeInteger(controlBytes) || controlBytes > 4_194_304) return fail("sponsor_audio_intake_control_limit");
  };
  const query = async <T extends object>(sql: string, bindings: readonly (string | number | null)[], fields: readonly string[], maximum = 1): Promise<T[]> => {
    const raw = await wait(() => database.prepare(sql).bind(...bindings).all());
    const budget = { nodes: 0, bytes: 0, maximum: 4_194_304 - controlBytes };
    const safe = acknowledged(raw, budget), rows = safe.results as unknown[];
    if (rows.length > maximum) return fail("sponsor_audio_intake_acknowledgement_missing");
    const result: T[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row) || Reflect.ownKeys(row).length !== fields.length)
        return fail("sponsor_audio_intake_acknowledgement_missing");
      const copy = Object.create(null) as Record<string, Scalar>;
      for (const field of fields) {
        const value = ownData(row, field);
        if (value !== null && typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value)))
          return fail("sponsor_audio_intake_acknowledgement_missing");
        copy[field] = value as Scalar;
      }
      result.push(copy as T);
    }
    account(budget); check(); return result;
  };
  const assertions = (items: readonly OutputSqlAssertion[]) => {
    check(); return items.flatMap(item => {
      // Preserve the native helper's complete predicate, ordered bindings and
      // token semantics, with this new leaf's sink explicitly in main. The
      // existing shared helper remains unchanged for all other consumers.
      const token = uuidV7();
      return [database.prepare(`INSERT INTO main.output_atomic_assertions(token,passed) VALUES(?,CASE WHEN (${item.sql}) THEN 1 ELSE 0 END)`)
        .bind(token, ...(item.bindings ?? [])), database.prepare("DELETE FROM main.output_atomic_assertions WHERE token=?").bind(token)];
    });
  };
  const batch = async (statements: D1PreparedStatement[]) => {
    const receipts = await wait(() => database.batch(statements));
    if (!Array.isArray(receipts) || receipts.length !== statements.length || Reflect.ownKeys(receipts).length !== receipts.length + 1)
      return fail("sponsor_audio_intake_acknowledgement_missing");
    const budget = { nodes: 0, bytes: 0, maximum: 4_194_304 - controlBytes };
    charge(budget, 2 + Math.max(0, receipts.length - 1));
    for (let index = 0; index < receipts.length; index++) acknowledged(ownData(receipts, index), budget);
    account(budget); check(); return receipts;
  };
  check(); return { database, check, wait, assertions, batch, query, get controlBytes() { check(); return controlBytes; } };
}
const boundary = (env: WorkerEnv, request: Request, limits?: SponsorAudioIntakeReadLimits) => createSponsorAudioIntakeReadBoundary(request, env, limits);
type Boundary = ReturnType<typeof boundary>;

const approvalSchemaObjects = [...SPONSOR_AUDIO_INTAKE_POLICY_SCHEMA, ...SPONSOR_AUDIO_INTAKE_APPROVAL_SCHEMA].map(sql => {
  const match = /^CREATE (TABLE|INDEX|TRIGGER) ([a-z0-9_]+)/u.exec(sql)!;
  return [match[1]!.toLowerCase(), match[2]!, sql] as const;
}).sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
const approvalSchemaSnapshot = JSON.stringify(approvalSchemaObjects);
const approvalSchemaQuery = `WITH selected AS MATERIALIZED (
    SELECT type,name,sql FROM main.sqlite_schema
    WHERE tbl_name IN('experience_sponsor_audio_intake_policies','experience_sponsor_audio_intake_approvals') AND sql IS NOT NULL
    ORDER BY name COLLATE BINARY LIMIT ${approvalSchemaObjects.length + 1}), packed AS (
    SELECT COUNT(*) AS total,json_group_array(json_array(type,name,sql)) AS snapshot FROM selected)
  SELECT CASE WHEN total=${approvalSchemaObjects.length} AND length(CAST(snapshot AS BLOB))<=65536 THEN snapshot END AS snapshot FROM packed`;
async function approvalSchema(bound: Boundary): Promise<OutputSqlAssertion> {
  const rows = await bound.query<{ snapshot: string }>(approvalSchemaQuery, [], ["snapshot"]);
  if (rows.length !== 1 || rows[0]!.snapshot !== approvalSchemaSnapshot) return fail("sponsor_audio_intake_approval_schema_unavailable");
  return { sql: `EXISTS(SELECT 1 FROM (${approvalSchemaQuery}) WHERE snapshot=?)`, bindings: [approvalSchemaSnapshot] };
}

async function originalProof(original: OriginalApproval, campaignId: string, sponsorPolicyDigest: string, bound: Boundary) {
  if (![original.terms_json, original.policy_json, original.payer_authority_json, original.approval_command_json].every(value => typeof value === "string")
    || !id(original.approval_id) || !id(original.payer_user_id) || !hash(original.terms_digest)) return fail("sponsor_audio_intake_original_approval_unavailable");
  let originalTerms: unknown; try { originalTerms = JSON.parse(original.terms_json); } catch { return fail("sponsor_audio_intake_original_approval_unavailable"); }
  const compiled = await bound.wait(() => compileSponsorApprovalProposal(originalTerms));
  if (!record(originalTerms) || !Array.isArray(originalTerms.issuerUserIds) || !id(originalTerms.issuerUserIds[0])
    || compiled.policy.version !== 8 || compiled.policy.family !== "canonical-instrumental-cue@1"
    || original.campaign_id !== campaignId || original.policy_digest !== sponsorPolicyDigest
    || compiled.policy.campaignId !== campaignId || compiled.policy.payerUserId !== original.payer_user_id
    || compiled.policyDigest !== sponsorPolicyDigest || original.policy_json !== compiled.policyJson
    || original.terms_json !== compiled.termsJson || original.terms_digest !== compiled.termsDigest
    || original.approval_command_json !== canonicalJson({ action: "approve-sponsor-campaign", approvalId: original.approval_id,
      proposal: originalTerms, confirmation: "APPROVE_SPONSOR_CAMPAIGN", reviewedTermsDigest: compiled.termsDigest })) return fail("sponsor_audio_intake_original_approval_unavailable");
  return { compiled, issuerUserId: originalTerms.issuerUserIds[0] };
}
const termsFor = (input: Readonly<SponsorAudioIntakeApprovalProposal>, original: OriginalApproval) => freeze({
  purpose: "sponsor-audio-initial-intake-policy" as const, proposal: input, payerUserId: original.payer_user_id,
  originalApprovalId: original.approval_id, originalTermsDigest: original.terms_digest,
});
const originalFields = ["approval_id", "campaign_id", "payer_user_id", "terms_json", "terms_digest", "policy_digest", "policy_json", "payer_authority_json", "approval_command_json"] as const;
const originalSelect = (alias: string) => [
  ["approval_id", 200], ["campaign_id", 200], ["payer_user_id", 200], ["terms_json", 131072], ["terms_digest", 71],
  ["policy_digest", 71], ["policy_json", 262144], ["payer_authority_json", 131072], ["approval_command_json", 131072],
].map(([column, limit]) => `${boundedJson(`${alias}.${column}`, Number(limit))} AS ${column}`).join(",");

/** Native authentication supplies the actual caller. The original issuer is
 * only a witness to that recorded approval, never an impersonated payer. */
async function review(request: Request, env: WorkerEnv, raw: unknown, bound: Boundary) {
  const input = proposal(raw);
  const schema = await approvalSchema(bound);
  const auth = await bound.wait(() => readExistingPrincipalRequest(request, env, "creator", { account: "principal" }));
  if ("kind" in auth || auth.response || !auth.user || auth.user.fictional || auth.user.projectExecution
    || auth.user.billingUserId && auth.user.billingUserId !== auth.user.userId || auth.user.consentVersion !== POLICY_VERSION
    || env.FORMA_PILOT_COHORT_ID?.trim()) return fail("sponsor_canonical_principal_required");
  const original = (await bound.query<OriginalApproval>(`SELECT ${originalSelect("approval")}
    FROM main.experience_sponsor_approvals approval WHERE approval.campaign_id=? AND approval.policy_digest=? LIMIT 2`,
    [input.campaignId, input.sponsorPolicyDigest], originalFields))[0];
  if (!original || original.payer_user_id !== auth.user.userId) return fail("sponsor_audio_intake_payer_approval_required");
  const { compiled, issuerUserId } = await originalProof(original, input.campaignId, input.sponsorPolicyDigest, bound);
  const assertions: OutputSqlAssertion[] = [
    schema,
    sponsorApprovalAssertion(compiled.policy, issuerUserId, true),
    { sql: `EXISTS(SELECT 1 FROM main.experience_sponsor_campaigns campaign JOIN main.experience_sponsor_approvals approval
        ON approval.campaign_id=campaign.campaign_id WHERE campaign.campaign_id=? AND campaign.enabled=1
        AND campaign.policy_digest=? AND campaign.policy_json=? AND approval.approval_id=? AND approval.terms_json=?
        AND approval.terms_digest=? AND approval.policy_digest=? AND approval.payer_authority_json=? AND approval.approval_command_json=?)
        AND ${clock}>=? AND ${clock}<?`,
      bindings: [input.campaignId, compiled.policyDigest, compiled.policyJson, original.approval_id, compiled.termsJson,
        compiled.termsDigest, compiled.policyDigest, original.payer_authority_json, original.approval_command_json,
        compiled.policy.startsAtMs, compiled.policy.expiresAtMs] },
    { sql: `NOT EXISTS(SELECT 1 FROM pilot_participants participant JOIN pilot_cohorts cohort ON cohort.cohort_id=participant.cohort_id
      WHERE (participant.user_id=? OR participant.email_normalized=?) AND participant.status='active' AND participant.revoked_at IS NULL AND cohort.status IN('active','paused','closed'))`,
      bindings: [auth.user.userId, auth.user.email] },
    { sql: "EXISTS(SELECT 1 FROM users WHERE user_id=? AND email=?)", bindings: [auth.user.userId, auth.user.email] },
  ];
  const terms = termsFor(input, original), termsJson = canonicalJson(terms);
  const termsDigest = await bound.wait(() => digest(terms)), intakePolicyDigest = await bound.wait(() => digest(input.intakePolicy));
  return { input, original, assertions, terms, termsJson, termsDigest, intakePolicyDigest, policyJson: canonicalJson(input.intakePolicy) };
}

/** Payer-authenticated preparation retains no policy, approval or business state.
 * Native assertion rows are checked and removed in one transaction. The returned
 * digest describes a review, never a capability or substitute for commit proof. */
export async function prepareSponsorAudioIntakeApproval(request: Request, env: WorkerEnv) {
  const bound = boundary(env, request);
  const raw = await bound.wait(() => readSponsorIntakeCommand(request));
  if (!record(raw) || !exactKeys(raw, ["action", "proposal"]) || raw.action !== "prepare-sponsor-audio-intake-policy") return fail("sponsor_explicit_command_required");
  const checked = await review(request, env, raw.proposal, bound);
  await bound.batch(bound.assertions(checked.assertions));
  bound.check();
  return freeze({ terms: checked.terms, termsDigest: checked.termsDigest, intakePolicyDigest: checked.intakePolicyDigest });
}

/** Exact explicit payer review, immutable one-time policy, source-free replay.
 * Active campaign authority is required to provision/replay this command; it
 * never becomes a requirement for consuming already provisioned initial-context IO terms.
 * No grant, provider call, financial hold or read-attempt credit is created. */
export async function approveSponsorAudioIntakePolicy(request: Request, env: WorkerEnv) {
  const bound = boundary(env, request);
  const raw = await bound.wait(() => readSponsorIntakeCommand(request));
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["action", "approvalId", "proposal", "reviewedTermsDigest", "confirmation"])
    || raw.action !== "approve-sponsor-audio-intake-policy" || !id(raw.approvalId) || !hash(raw.reviewedTermsDigest)
    || raw.confirmation !== "APPROVE_SPONSOR_AUDIO_INTAKE_POLICY") return fail("sponsor_explicit_approval_required");
  const input = JSON.parse(canonicalJson(raw)) as typeof raw;
  const checked = await review(request, env, input.proposal, bound);
  if (input.reviewedTermsDigest !== checked.termsDigest) return fail("sponsor_audio_intake_terms_not_reviewed");
  const approvalId = String(input.approvalId), approvalCommandJson = canonicalJson(input);
  const receipt = freeze({ version: 1, purpose: "sponsor-audio-initial-intake-policy-approval", approvalId,
    termsDigest: checked.termsDigest, intakePolicyDigest: checked.intakePolicyDigest, approvedByUserId: checked.terms.payerUserId,
    payerAuthorityJson: checked.original.payer_authority_json, approvalCommandDigest: await bound.wait(() => digest(input)) });
  const receiptJson = canonicalJson(receipt), receiptDigest = await bound.wait(() => digest(receipt));
  const proof: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM main.experience_sponsor_audio_intake_approvals approval
    JOIN main.experience_sponsor_audio_intake_policies policy ON policy.campaign_id=approval.campaign_id AND policy.sponsor_policy_digest=approval.sponsor_policy_digest
    WHERE approval.approval_id=? AND approval.campaign_id=? AND approval.sponsor_policy_digest=? AND approval.original_approval_id=?
      AND approval.payer_user_id=? AND approval.approved_by_user_id=? AND approval.intake_policy_digest=? AND approval.terms_json=? AND approval.terms_digest=?
      AND approval.review_receipt_json=? AND approval.review_receipt_digest=? AND approval.approval_command_json=?
      AND policy.intake_policy_digest=approval.intake_policy_digest AND policy.policy_json=? AND policy.review_receipt_digest=approval.review_receipt_digest)`,
    bindings: [approvalId, checked.input.campaignId, checked.input.sponsorPolicyDigest, checked.original.approval_id,
      checked.terms.payerUserId, checked.terms.payerUserId, checked.intakePolicyDigest, checked.termsJson, checked.termsDigest,
      receiptJson, receiptDigest, approvalCommandJson, checked.policyJson] };
  const finish = async (replayed: boolean) => {
    await bound.batch(bound.assertions([...checked.assertions, proof]));
    bound.check();
    return freeze({ replayed, approvalId, campaignId: checked.input.campaignId, sponsorPolicyDigest: checked.input.sponsorPolicyDigest,
      intakePolicyDigest: checked.intakePolicyDigest, reviewReceiptDigest: receiptDigest, termsDigest: checked.termsDigest });
  };
  const exists = async () => (await bound.query<{ present: number }>(`SELECT 1 AS present FROM main.experience_sponsor_audio_intake_approvals
    WHERE approval_id=? OR (campaign_id=? AND sponsor_policy_digest=?) LIMIT 1`,
    [approvalId, checked.input.campaignId, checked.input.sponsorPolicyDigest], ["present"])).some(row => row.present === 1);
  let replayed = await exists();
  if (!replayed) {
    try {
      await bound.batch([
        ...bound.assertions(checked.assertions),
        bound.database.prepare(`INSERT INTO main.experience_sponsor_audio_intake_policies(campaign_id,sponsor_policy_digest,intake_policy_digest,policy_json,review_receipt_digest)
        VALUES(?,?,?,?,?)`).bind(checked.input.campaignId, checked.input.sponsorPolicyDigest, checked.intakePolicyDigest, checked.policyJson, receiptDigest),
        bound.database.prepare(`INSERT INTO main.experience_sponsor_audio_intake_approvals(approval_id,campaign_id,sponsor_policy_digest,original_approval_id,payer_user_id,
        intake_policy_digest,terms_json,terms_digest,review_receipt_json,review_receipt_digest,approval_command_json,approved_by_user_id,approved_at_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,${clock})`).bind(approvalId, checked.input.campaignId, checked.input.sponsorPolicyDigest, checked.original.approval_id,
          checked.terms.payerUserId, checked.intakePolicyDigest, checked.termsJson, checked.termsDigest, receiptJson, receiptDigest, approvalCommandJson, checked.terms.payerUserId),
        ...bound.assertions([...checked.assertions, proof]),
      ]);
    } catch (error) {
      bound.check();
      // Recover the exact committed row after an ambiguous acknowledgment. A
      // conflict fails the full proof; never overwrite a row or reset read usage.
      if (!await exists()) throw error;
      replayed = true;
    }
  }
  // Await the inner proof here: directly adopting its promise would leave one
  // more unguarded async continuation in this exported approval boundary.
  const result = await finish(replayed);
  bound.check();
  return result;
}

type RetainedIntakeRow = { campaign_id: string; sponsor_policy_digest: string; intake_policy_digest: string; policy_json: string;
  review_receipt_digest: string; approval_id: string; original_approval_id: string; payer_user_id: string;
  terms_json: string; terms_digest: string; review_receipt_json: string; approval_command_json: string };
const retainedFrom = `FROM main.experience_sponsor_audio_intake_policies policy
  JOIN main.experience_sponsor_audio_intake_approvals approval ON approval.campaign_id=policy.campaign_id
    AND approval.sponsor_policy_digest=policy.sponsor_policy_digest AND approval.intake_policy_digest=policy.intake_policy_digest
    AND approval.review_receipt_digest=policy.review_receipt_digest AND approval.approved_by_user_id=approval.payer_user_id
  JOIN main.experience_sponsor_approvals original ON original.approval_id=approval.original_approval_id
    AND original.campaign_id=policy.campaign_id AND original.policy_digest=policy.sponsor_policy_digest
    AND original.payer_user_id=approval.payer_user_id AND original.approved_by_user_id=original.payer_user_id`;

/** Read-only, bounded immutable provenance, never a raw read capability. Current
 * actor/custody and request/byte reservations belong to the separate consumer.
 * Revocation, expiry or changed payer consent cannot erase an owned result's
 * original allocation; no current generation predicate is used here. */
export async function readApprovedSponsorAudioIntakePolicy(request: Request, env: WorkerEnv, campaignId: string, sponsorPolicyDigest: string, limits?: SponsorAudioIntakeReadLimits) {
  const bound = boundary(env, request, limits), unavailable = () => fail("sponsor_audio_intake_policy_unavailable");
  if (!id(campaignId) || !hash(sponsorPolicyDigest)) return unavailable();
  const schema = await approvalSchema(bound);
  const projectionFields = [
    ["policy.campaign_id", "campaign_id", 200], ["policy.sponsor_policy_digest", "sponsor_policy_digest", 71],
    ["policy.intake_policy_digest", "intake_policy_digest", 71], ["policy.policy_json", "policy_json", 8192],
    ["policy.review_receipt_digest", "review_receipt_digest", 71], ["approval.approval_id", "approval_id", 200],
    ["approval.original_approval_id", "original_approval_id", 200], ["approval.payer_user_id", "payer_user_id", 200],
    ["approval.terms_json", "terms_json", 16384], ["approval.terms_digest", "terms_digest", 71],
    ["approval.review_receipt_json", "review_receipt_json", 262144], ["approval.approval_command_json", "approval_command_json", 32768],
  ] as const;
  const projections = projectionFields.map(([column, alias, maximum]) => `${boundedJson(column, maximum)} AS ${alias}`).join(",");
  const row = (await bound.query<RetainedIntakeRow>(`SELECT ${projections} ${retainedFrom}
    WHERE policy.campaign_id=? AND policy.sponsor_policy_digest=? LIMIT 2`, [campaignId, sponsorPolicyDigest], projectionFields.map(field => field[1])))[0];
  if (!row || row.campaign_id !== campaignId || row.sponsor_policy_digest !== sponsorPolicyDigest
    || ![row.intake_policy_digest, row.review_receipt_digest, row.terms_digest].every(hash)
    || ![row.approval_id, row.original_approval_id, row.payer_user_id].every(id)
    || ![row.policy_json, row.terms_json, row.review_receipt_json, row.approval_command_json].every(value => typeof value === "string")) return unavailable();
  const original = (await bound.query<OriginalApproval>(`SELECT ${originalSelect("approval")}
    FROM main.experience_sponsor_approvals approval WHERE approval.approval_id=? AND approval.campaign_id=? AND approval.policy_digest=? LIMIT 2`,
    [row.original_approval_id, campaignId, sponsorPolicyDigest], originalFields))[0];
  if (!original || original.payer_user_id !== row.payer_user_id) return unavailable();
  await originalProof(original, campaignId, sponsorPolicyDigest, bound);
  let raw: unknown; try { raw = JSON.parse(row.policy_json); } catch { return unavailable(); }
  const policy = readSponsorAudioIntakePolicy(raw);
  if (row.policy_json !== canonicalJson(policy) || row.intake_policy_digest !== await bound.wait(() => digest(policy))) return unavailable();
  const input = proposal({ version: 1, family: "canonical-audio-initial-intake@1", campaignId, sponsorPolicyDigest, intakePolicy: policy });
  const terms = termsFor(input, original);
  if (row.terms_json !== canonicalJson(terms) || row.terms_digest !== await bound.wait(() => digest(terms))) return unavailable();
  const command = { action: "approve-sponsor-audio-intake-policy", approvalId: row.approval_id, proposal: input,
    reviewedTermsDigest: row.terms_digest, confirmation: "APPROVE_SPONSOR_AUDIO_INTAKE_POLICY" };
  const receipt = { version: 1, purpose: "sponsor-audio-initial-intake-policy-approval", approvalId: row.approval_id,
    termsDigest: row.terms_digest, intakePolicyDigest: row.intake_policy_digest, approvedByUserId: row.payer_user_id,
    payerAuthorityJson: original.payer_authority_json, approvalCommandDigest: await bound.wait(() => digest(command)) };
  if (row.approval_command_json !== canonicalJson(command) || row.review_receipt_json !== canonicalJson(receipt)
    || row.review_receipt_digest !== await bound.wait(() => digest(receipt))) return unavailable();
  const assertion: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 ${retainedFrom}
    WHERE policy.campaign_id=? AND policy.sponsor_policy_digest=? AND policy.intake_policy_digest=? AND policy.policy_json=?
      AND policy.review_receipt_digest=? AND approval.approval_id=? AND approval.original_approval_id=? AND approval.payer_user_id=?
      AND approval.terms_json=? AND approval.terms_digest=? AND approval.review_receipt_json=? AND approval.approval_command_json=?
      AND original.terms_json=? AND original.terms_digest=? AND original.policy_json=? AND original.payer_authority_json=?
      AND original.approval_command_json=?)`,
    bindings: [campaignId, sponsorPolicyDigest, row.intake_policy_digest, row.policy_json, row.review_receipt_digest,
      row.approval_id, row.original_approval_id, row.payer_user_id, row.terms_json, row.terms_digest, row.review_receipt_json,
      row.approval_command_json, original.terms_json, original.terms_digest, original.policy_json, original.payer_authority_json,
      original.approval_command_json] };
  bound.check();
  return freeze({ policy, intakePolicyDigest: row.intake_policy_digest, reviewReceiptDigest: row.review_receipt_digest,
    approvalId: row.approval_id, originalApprovalId: row.original_approval_id, payerUserId: row.payer_user_id,
    assertions: [schema, assertion], controlBytes: bound.controlBytes });
}
