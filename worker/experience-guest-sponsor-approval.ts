import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { compileGuestSponsorApprovalProposal, GuestSponsorContractError } from "./experience-guest-sponsor-contract.ts";
import { readExistingPrincipalRequest } from "./principal-request-core.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { outputAssertionStatements, type OutputSqlAssertion } from "./output-command-core.ts";
import type { WorkerEnv } from "./runtime.ts";

// Dormant payer approval only. No route, schema installer, guest issuer or
// native execution path imports this module. Existing v1/v2 stay unchanged.
const maximumBytes = 131072, maximumChunks = 4096;
const clock = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const columns = ["user_id", "role", "consent_version", "updated_at", "permission_epoch", "grants_json", "organizations_json", "projects_json", "identity_policies_json", "approved_canvas_requirements"];
const fail = (part: string): never => { throw new GuestSponsorContractError(`guest_sponsor_approval_${part}`); };
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value)
  && !/^forma-guest-(session|claim)-v1\./u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const instant = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 8_000_000_000_000;
const bounded = (column: string) => `CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${maximumBytes} AND instr(${column},char(0))=0 THEN ${column} END`;
type Context = Readonly<{ request: Request; env: WorkerEnv; db: WorkerEnv["DB"]; origin: string; headers: string; url: string }>;
type Payer = Readonly<{ userId: string; email: string; displayName: string; authorityJson: string }>;
type ApprovalCommand = Readonly<{ version: 1; action: "approve-guest-sponsor-campaign"; approvalId: string;
  proposal: unknown; reviewedTermsDigest: string; confirmation: "APPROVE_GUEST_SPONSOR_CAMPAIGN" }>;
type RevokeCommand = Readonly<{ version: 1; action: "revoke-guest-sponsor-campaign"; campaignId: string;
  policyDigest: string; confirmation: "REVOKE_GUEST_SPONSOR_CAMPAIGN" }>;
type Compiled = Awaited<ReturnType<typeof compileGuestSponsorApprovalProposal>>;
type Approval = Readonly<{ command: ApprovalCommand; commandJson: string; compiled: Compiled; resourceJson: string; resourceDigest: string }>;
type Original = { approval_id: string; campaign_id: string; payer_user_id: string; terms_digest: string; terms_json: string;
  policy_digest: string; policy_json: string; approved_by_user_id: string; payer_authority_json: string;
  approval_command_json: string; approved_at_ms: number; revoked_at_ms: number | null };
type Query = { sql: string; bindings: (string | number | null)[] };
export type GuestSponsorApprovalReceipt = Readonly<{ version: 1; status: "approved" | "revoked"; approvalId: string;
  campaignId: string; termsDigest: string; policyDigest: string; replayed: boolean; generationAvailable: false }>;

const requestHeaders = (request: Request) => JSON.stringify(Array.from(request.headers));
function current(ctx: Context, expectedOrigin = ctx.origin) {
  const { request, env } = ctx, url = new URL(request.url), site = request.headers.get("sec-fetch-site");
  if (env.DB !== ctx.db) return fail("database_changed");
  if (request.signal.aborted || request.method !== "POST" || request.url !== ctx.url || requestHeaders(request) !== ctx.headers
    || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.origin !== expectedOrigin
    || request.headers.get("origin") !== expectedOrigin || site !== null && site !== "same-origin" && site !== "none"
    || env.FORMA_PILOT_COHORT_ID?.trim()
    || (request.headers.get("cookie") ?? "").split(";").some(part => ["forma_project_context", "forma_impersonation"].includes(part.split("=", 1)[0]!.trim()))) return fail("request_unavailable");
}
function context(request: Request, env: WorkerEnv): Context {
  if (!(request instanceof Request)) return fail("request_unavailable");
  const headers = requestHeaders(request);
  if (bytes(headers) > 32768) return fail("request_unavailable");
  const ctx = { request, env, db: env.DB, origin: new URL(request.url).origin, url: request.url, headers };
  current(ctx); return ctx;
}
async function commandBody(ctx: Context): Promise<unknown> {
  current(ctx);
  const { request } = ctx, type = request.headers.get("content-type") ?? "", lengthHeader = request.headers.get("content-length"), encoding = request.headers.get("content-encoding");
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/iu.test(type) || encoding !== null && !/^identity$/iu.test(encoding)
    || lengthHeader !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(lengthHeader) || Number(lengthHeader) > maximumBytes)) return fail("body_invalid");
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try { reader = request.body?.getReader(); } catch { return fail("body_invalid"); }
  if (!reader) return fail("body_invalid");
  const cancel = () => { try { void reader.cancel().catch(() => undefined); } catch { /* Cancellation never blocks refusal. */ } };
  const chunks: Uint8Array[] = []; let length = 0, count = 0;
  let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("body_deadline")), 5000);
    abort = () => reject(new Error("body_aborted"));
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
  });
  try {
    for (;;) {
      const item = await Promise.race([reader.read(), stopped]); current(ctx);
      if (item.done) break;
      count++; length += item.value.byteLength;
      if (length > maximumBytes || count > maximumChunks) return fail("body_invalid");
      chunks.push(item.value);
    }
    const buffer = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
    if (text.charCodeAt(0) === 0xfeff) return fail("body_invalid");
    const raw: unknown = JSON.parse(text);
    if (jsonIssues(raw).length) return fail("body_invalid");
    return freeze(raw);
  } catch { cancel(); current(ctx); return fail("body_invalid"); }
  finally { clearTimeout(timer); if (abort) request.signal.removeEventListener("abort", abort); try { reader.releaseLock(); } catch { /* Already released or cancelled. */ } }
}
function approvalCommand(raw: unknown): ApprovalCommand {
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["version", "action", "approvalId", "proposal", "reviewedTermsDigest", "confirmation"])
    || raw.version !== 1 || raw.action !== "approve-guest-sponsor-campaign" || !id(raw.approvalId)
    || !hash(raw.reviewedTermsDigest) || raw.confirmation !== "APPROVE_GUEST_SPONSOR_CAMPAIGN") return fail("command_invalid");
  return freeze(JSON.parse(canonicalJson(raw)) as ApprovalCommand);
}
function revokeCommand(raw: unknown): RevokeCommand {
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["version", "action", "campaignId", "policyDigest", "confirmation"])
    || raw.version !== 1 || raw.action !== "revoke-guest-sponsor-campaign" || !id(raw.campaignId)
    || !hash(raw.policyDigest) || raw.confirmation !== "REVOKE_GUEST_SPONSOR_CAMPAIGN") return fail("command_invalid");
  return freeze(JSON.parse(canonicalJson(raw)) as RevokeCommand);
}
async function compile(ctx: Context, command: ApprovalCommand): Promise<Approval> {
  const compiled = await compileGuestSponsorApprovalProposal(command.proposal); current(ctx, compiled.policy.guestAdmission.origin);
  if (command.reviewedTermsDigest !== compiled.termsDigest) return fail("terms_not_reviewed");
  const resourceJson = canonicalJson(compiled.policy.resources), resourceDigest = await digest(compiled.policy.resources); current(ctx);
  return freeze({ command, commandJson: canonicalJson(command), compiled, resourceJson, resourceDigest });
}
async function payer(ctx: Context): Promise<Payer> {
  const auth = await readExistingPrincipalRequest(ctx.request, ctx.env, "creator", { account: "principal" }); current(ctx);
  if ("kind" in auth || auth.response || !auth.user || auth.user.fictional || auth.user.projectExecution || auth.impersonation
    || auth.user.billingUserId && auth.user.billingUserId !== auth.user.userId || auth.user.consentVersion !== POLICY_VERSION
    || !["creator", "admin"].includes(auth.user.role) || auth.user.userId.startsWith("guest:") || !auth.user.authorizationSnapshot) return fail("canonical_payer_required");
  // Capture the authenticated facts before observing the second native row.
  const identity = freeze({ userId: auth.user.userId, email: auth.user.email, displayName: auth.user.displayName,
    role: auth.user.role, consentVersion: auth.user.consentVersion, snapshot: { ...auth.user.authorizationSnapshot } });
  const row = await ctx.db.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(identity.userId).first<Record<string, unknown>>(); current(ctx);
  const snapshot = identity.snapshot;
  if (!row || row.user_id !== identity.userId || row.email !== identity.email || row.display_name !== identity.displayName
    || row.role !== identity.role || row.consent_version !== identity.consentVersion || String(row.updated_at ?? "") !== snapshot.updatedAt
    || String(row.permission_epoch ?? "") !== snapshot.rawEpoch || String(row.grants_json ?? "[]") !== snapshot.grants
    || String(row.organizations_json ?? "[]") !== snapshot.organizations || String(row.projects_json ?? "[]") !== snapshot.projects
    || String(row.identity_policies_json ?? "[]") !== snapshot.identityPolicies || Number(row.approved_canvas_requirements ?? 0) !== snapshot.canvasRequirements) return fail("payer_changed");
  const authorityJson = JSON.stringify(columns.map(column => row[column] ?? null));
  if (bytes(authorityJson) > maximumBytes) return fail("payer_unavailable");
  return freeze({ userId: identity.userId, email: identity.email, displayName: identity.displayName, authorityJson });
}
function payerMatch(value: Payer): Query {
  return { sql: `json_array(${columns.map(column => `payer.${column}`).join(",")})=?
    AND payer.email=? AND payer.display_name=? AND payer.role IN('creator','admin') AND payer.consent_version=?
    AND NOT EXISTS(SELECT 1 FROM pilot_participants participant JOIN pilot_cohorts cohort ON cohort.cohort_id=participant.cohort_id
      WHERE (participant.user_id=? OR participant.email_normalized=?) AND participant.status='active' AND participant.revoked_at IS NULL AND cohort.status IN('active','paused','closed'))`,
  bindings: [value.authorityJson, value.email, value.displayName, POLICY_VERSION, value.userId, value.email] };
}
function payerProof(value: Payer): OutputSqlAssertion {
  const match = payerMatch(value);
  return { sql: `EXISTS(WITH approval_current_payer AS MATERIALIZED (${PRINCIPAL_WITH_ACCESS_SQL}) SELECT 1 FROM approval_current_payer payer WHERE ${match.sql})`,
    bindings: [value.userId, ...match.bindings] };
}
const statements = (ctx: Context, proofs: OutputSqlAssertion[]) => proofs.flatMap(proof => outputAssertionStatements(ctx.env, proof));
function acknowledgement(results: D1Result<unknown>[], expected: number, inserted: number[]) {
  if (!Array.isArray(results) || results.length !== expected || results.some(result => !result || result.success !== true)
    || inserted.some(index => results[index]?.meta?.changes !== 1)) return fail("acknowledgement_unavailable");
}
function receipt(approval: Approval, status: "approved" | "revoked", replayed: boolean): GuestSponsorApprovalReceipt {
  return Object.freeze({ version: 1, status, approvalId: approval.command.approvalId, campaignId: approval.compiled.policy.campaignId,
    termsDigest: approval.compiled.termsDigest, policyDigest: approval.compiled.policyDigest, replayed, generationAvailable: false });
}
function approvedQuery(approval: Approval, value: Payer): Query {
  const { command, compiled, commandJson, resourceJson, resourceDigest } = approval, { policy } = compiled, match = payerMatch(value);
  // Sibling relations keep the native principal expression below D1's depth
  // limit, including when this SELECT is nested in an atomic CHECK.
  return { sql: `WITH approval_current_record AS MATERIALIZED (
    SELECT approval.approved_at_ms FROM experience_sponsor_approvals approval
    JOIN experience_sponsor_campaigns campaign ON campaign.campaign_id=approval.campaign_id
    JOIN experience_sponsor_resource_policies resources ON resources.campaign_id=approval.campaign_id
    WHERE approval.approval_id=? AND approval.campaign_id=? AND approval.payer_user_id=? AND approval.approved_by_user_id=?
      AND approval.terms_digest=? AND approval.terms_json=? AND approval.policy_digest=? AND approval.policy_json=?
      AND approval.payer_authority_json=? AND approval.approval_command_json=? AND approval.revoked_at_ms IS NULL
      AND typeof(approval.approved_at_ms)='integer' AND approval.approved_at_ms>=? AND approval.approved_at_ms<?
      AND campaign.enabled=1 AND campaign.policy_digest=approval.policy_digest AND campaign.policy_json=approval.policy_json
      AND resources.enabled=1 AND resources.limits_digest=? AND resources.limits_json=?),
    approval_current_payer AS MATERIALIZED (${PRINCIPAL_WITH_ACCESS_SQL})
    SELECT approved.approved_at_ms FROM approval_current_record approved CROSS JOIN approval_current_payer payer
    WHERE ${match.sql} AND ${clock}>=? AND ${clock}<?`,
  bindings: [command.approvalId, policy.campaignId, value.userId, value.userId, compiled.termsDigest, compiled.termsJson, compiled.policyDigest,
    compiled.policyJson, value.authorityJson, commandJson, policy.startsAtMs, policy.expiresAtMs, resourceDigest, resourceJson,
    value.userId, ...match.bindings, policy.startsAtMs, policy.expiresAtMs] };
}
async function finishApproval(ctx: Context, approval: Approval, value: Payer, replayed: boolean) {
  current(ctx); const proof = approvedQuery(approval, value);
  const row = await ctx.db.prepare(proof.sql).bind(...proof.bindings).first<{ approved_at_ms: number }>(); current(ctx);
  if (!row || !instant(row.approved_at_ms)) return fail("original_unavailable");
  return receipt(approval, "approved", replayed);
}

/** Exact payer review, with no provider, native guest command or financial
 * effect. Ambiguous acknowledgements resolve only the original complete row. */
export async function approveGuestSponsorCampaign(request: Request, env: WorkerEnv): Promise<GuestSponsorApprovalReceipt> {
  const ctx = context(request, env), raw = await commandBody(ctx); current(ctx);
  const input = approvalCommand(raw), approval = await compile(ctx, input); current(ctx);
  const value = await payer(ctx); current(ctx);
  const { compiled } = approval, { policy } = compiled;
  if (value.userId !== policy.payerUserId) return fail("payer_required");
  const exists = await ctx.db.prepare("SELECT 1 AS present FROM experience_sponsor_approvals WHERE approval_id=? OR campaign_id=? LIMIT 1")
    .bind(input.approvalId, policy.campaignId).first(); current(ctx);
  if (exists) { const result = await finishApproval(ctx, approval, value, true); current(ctx); return result; }
  const proof = approvedQuery(approval, value);
  const batch = [
    ...statements(ctx, [payerProof(value), { sql: `${clock}>=? AND ${clock}<?`, bindings: [policy.startsAtMs, policy.expiresAtMs] }]),
    ctx.db.prepare("INSERT INTO experience_sponsor_campaigns(campaign_id,policy_digest,policy_json,enabled) VALUES(?,?,?,1)")
      .bind(policy.campaignId, compiled.policyDigest, compiled.policyJson),
    ctx.db.prepare("INSERT INTO experience_sponsor_resource_policies(campaign_id,limits_digest,limits_json,enabled) VALUES(?,?,?,1)")
      .bind(policy.campaignId, approval.resourceDigest, approval.resourceJson),
    ctx.db.prepare(`INSERT INTO experience_sponsor_approvals(approval_id,campaign_id,payer_user_id,terms_digest,terms_json,policy_digest,policy_json,
      approved_by_user_id,payer_authority_json,approval_command_json,approved_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,${clock})`)
      .bind(input.approvalId, policy.campaignId, value.userId, compiled.termsDigest, compiled.termsJson, compiled.policyDigest,
        compiled.policyJson, value.userId, value.authorityJson, approval.commandJson),
    ...statements(ctx, [{ sql: `EXISTS(${proof.sql})`, bindings: proof.bindings }]),
  ];
  current(ctx);
  try { const results = await ctx.db.batch(batch); current(ctx); acknowledgement(results, batch.length, [4, 5, 6]); }
  catch (error) {
    current(ctx);
    try { const result = await finishApproval(ctx, approval, value, true); current(ctx); return result; }
    catch { current(ctx); throw error; }
  }
  const result = await finishApproval(ctx, approval, value, false); current(ctx); return result;
}

async function original(ctx: Context, input: RevokeCommand, value: Payer): Promise<{ row: Original; approval: Approval }> {
  const text = ["approval_id", "campaign_id", "payer_user_id", "terms_digest", "terms_json", "policy_digest", "policy_json",
    "approved_by_user_id", "payer_authority_json", "approval_command_json"];
  const row = await ctx.db.prepare(`SELECT ${text.map(column => `${bounded(column)} AS ${column}`).join(",")},approved_at_ms,revoked_at_ms
    FROM experience_sponsor_approvals WHERE campaign_id=? AND policy_digest=?`).bind(input.campaignId, input.policyDigest).first<Original>(); current(ctx);
  if (!row || text.some(column => typeof row[column as keyof Original] !== "string") || !instant(row.approved_at_ms)
    || row.revoked_at_ms !== null && (!instant(row.revoked_at_ms) || row.revoked_at_ms < row.approved_at_ms)
    || row.payer_user_id !== value.userId || row.approved_by_user_id !== value.userId || !id(row.approval_id)) return fail("original_unavailable");
  let raw: unknown; try { raw = JSON.parse(row.approval_command_json); } catch { return fail("original_unavailable"); }
  const approval = await compile(ctx, approvalCommand(raw)); current(ctx);
  const compiled = approval.compiled;
  if (approval.command.approvalId !== row.approval_id || approval.commandJson !== row.approval_command_json
    || compiled.policy.campaignId !== input.campaignId || compiled.policy.payerUserId !== value.userId || compiled.policyDigest !== input.policyDigest
    || compiled.termsDigest !== row.terms_digest || compiled.termsJson !== row.terms_json || compiled.policyJson !== row.policy_json
    || row.approved_at_ms < compiled.policy.startsAtMs || row.approved_at_ms >= compiled.policy.expiresAtMs) return fail("original_unavailable");
  // The original authority may have changed, but retain its exact immutable
  // bytes in the revoke predicate. Current payer authority is proved separately.
  let snapshot: unknown; try { snapshot = JSON.parse(row.payer_authority_json); } catch { return fail("original_unavailable"); }
  if (!Array.isArray(snapshot) || snapshot.length !== columns.length || snapshot[0] !== value.userId
    || JSON.stringify(snapshot) !== row.payer_authority_json) return fail("original_unavailable");
  return { row, approval };
}
function originalPredicate(row: Original): Query {
  const fields = ["approval_id", "campaign_id", "payer_user_id", "terms_digest", "terms_json", "policy_digest", "policy_json", "approved_by_user_id",
    "payer_authority_json", "approval_command_json", "approved_at_ms"] as const;
  return { sql: fields.map(field => `approval.${field}=?`).join(" AND "), bindings: fields.map(field => row[field]) };
}
function revokedQuery(row: Original, value: Payer): Query {
  const proof = originalPredicate(row), match = payerMatch(value);
  return { sql: `WITH approval_current_record AS MATERIALIZED (
    SELECT approval.revoked_at_ms FROM experience_sponsor_approvals approval WHERE ${proof.sql}
      AND typeof(approval.revoked_at_ms)='integer' AND approval.revoked_at_ms>=approval.approved_at_ms
      AND NOT EXISTS(SELECT 1 FROM experience_sponsor_campaigns WHERE campaign_id=approval.campaign_id AND enabled<>0)
      AND NOT EXISTS(SELECT 1 FROM experience_sponsor_resource_policies WHERE campaign_id=approval.campaign_id AND enabled<>0)
      AND NOT EXISTS(SELECT 1 FROM experience_sponsor_grants WHERE campaign_id=approval.campaign_id AND enabled<>0)),
    approval_current_payer AS MATERIALIZED (${PRINCIPAL_WITH_ACCESS_SQL})
    SELECT revoked.revoked_at_ms FROM approval_current_record revoked CROSS JOIN approval_current_payer payer WHERE ${match.sql}`,
  bindings: [...proof.bindings, value.userId, ...match.bindings] };
}
async function finishRevocation(ctx: Context, row: Original, approval: Approval, value: Payer, replayed: boolean) {
  current(ctx); const proof = revokedQuery(row, value);
  const stored = await ctx.db.prepare(proof.sql).bind(...proof.bindings).first<{ revoked_at_ms: number }>(); current(ctx);
  if (!stored || !instant(stored.revoked_at_ms)) return fail("revocation_unavailable");
  return receipt(approval, "revoked", replayed);
}

/** The current actual payer can stop an expired or changed campaign. This does
 * not require the original authority snapshot still to grant spending, and
 * never resets usage, deletes history, releases holds or settles incurred cost. */
export async function revokeGuestSponsorCampaign(request: Request, env: WorkerEnv): Promise<GuestSponsorApprovalReceipt> {
  const ctx = context(request, env), raw = await commandBody(ctx); current(ctx);
  const input = revokeCommand(raw), value = await payer(ctx); current(ctx);
  const { row, approval } = await original(ctx, input, value); current(ctx);
  const identity = originalPredicate(row), proof = revokedQuery(row, value);
  const batch = [
    ...statements(ctx, [payerProof(value), { sql: `EXISTS(SELECT 1 FROM experience_sponsor_approvals approval WHERE ${identity.sql})`, bindings: identity.bindings }]),
    ctx.db.prepare(`UPDATE experience_sponsor_approvals SET revoked_at_ms=COALESCE(revoked_at_ms,${clock}) WHERE campaign_id=?`).bind(input.campaignId),
    ctx.db.prepare("UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?").bind(input.campaignId),
    ctx.db.prepare("UPDATE experience_sponsor_resource_policies SET enabled=0 WHERE campaign_id=?").bind(input.campaignId),
    ctx.db.prepare("UPDATE experience_sponsor_grants SET enabled=0 WHERE campaign_id=?").bind(input.campaignId),
    ...statements(ctx, [{ sql: `EXISTS(${proof.sql})`, bindings: proof.bindings }]),
  ];
  current(ctx);
  try { const results = await ctx.db.batch(batch); current(ctx); acknowledgement(results, batch.length, [4]); }
  catch (error) {
    current(ctx);
    try { const result = await finishRevocation(ctx, row, approval, value, true); current(ctx); return result; }
    catch { current(ctx); throw error; }
  }
  const result = await finishRevocation(ctx, row, approval, value, row.revoked_at_ms !== null); current(ctx); return result;
}
