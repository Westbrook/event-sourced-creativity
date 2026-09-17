import { parseSelectedOutputShareApproval, parseSelectedOutputShareSelection, projectSelectedOutputShareCandidate,
  SELECTED_OUTPUT_SHARE_PURPOSE, type SelectedOutputShareSelection } from "../src/model/selected-output-share.ts";
import { hostedIdentity, readNativeRetainedTextCustody, nativeRetainedTextCustodySnapshot,
  type NativeRetainedIdentity } from "./native-retained-text-custody.ts";
import { readSelectedOutputShareAuthority, selectedOutputShareAuthoritySnapshot,
  selectedOutputShareAuthorityAssertion } from "./selected-output-share-authority.ts";
import { selectedOutputShareSchemaState, selectedOutputShareSchemaAssertion } from "./selected-output-share-readiness.ts";
import type { WorkerEnv } from "./runtime.ts";
import { selectedSharePredicateProof, selectedShareProofStatement, type SelectedShareProofQuery } from "./selected-output-share-proof.ts";

// The finite selected-share dispatcher exposes read/revoke only while creation
// remains closed. No initializer, provider, budget or private-media entry is
// imported here. Every source proof is freshly obtained inside the call.
const encoder = new TextEncoder();
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const rowColumns = ["share_id", "purpose", "replay_key", "owner_id", "owner_email", "intent_key", "project_id", "job_id", "completion_event_id",
  "selection_json", "review_title", "source_expires_at", "provenance_expires_at", "expires_at", "candidate_sha256",
  "issuer_authority_sha256", "created_at", "token_hash", "issued_at", "revoked_at", "minimized_at"] as const;
type Row = Record<typeof rowColumns[number], string | null>;
type Assertion = { sql: string; bindings: (string | number | null)[] };
class Refusal extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}
function fail(code = "selected_output_share_unavailable", status = 404): never { throw new Refusal(code, status); }
const headers = { "cache-control": "private, no-store", "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
const rejected = (error: unknown) => error instanceof Refusal ? json({ error: error.code }, error.status) : json({ error: "selected_output_share_unavailable" }, 404);
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
const tokenHash = (value: string) => hash(`${SELECTED_OUTPUT_SHARE_PURPOSE}\0${value}`);
const replayKey = (owner: string, intent: string) => hash(`selected-output-replay-v1\0${JSON.stringify([SELECTED_OUTPUT_SHARE_PURPOSE, owner, intent])}`);
async function ready(env: WorkerEnv) { if (await selectedOutputShareSchemaState(env) !== "ready") fail(); }
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function frame(request: Request, env: WorkerEnv) {
  const db = env.DB, cohort = env.FORMA_PILOT_COHORT_ID, administrators = env.FORMA_ADMIN_EMAILS;
  return () => {
    if (env.DB !== db || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== administrators || request.signal.aborted) fail();
  };
}
function origin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site"
    || request.headers.has("origin") && request.headers.get("origin") !== new URL(request.url).origin) fail("selected_output_share_same_origin_required", 403);
}
function identity(request: Request): NativeRetainedIdentity {
  let value: NativeRetainedIdentity | null;
  try { value = hostedIdentity(request); } catch { return fail("selected_output_share_personal_principal_required", 403); }
  return value ?? fail("selected_output_share_authentication_required", 401);
}
async function command(request: Request) {
  if (request.method !== "POST") fail("method_not_allowed", 405);
  origin(request);
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") fail("selected_output_share_command_invalid", 400);
  const reader = request.body?.getReader();
  if (!reader) fail("selected_output_share_command_invalid", 400);
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const result = await reader.read(); if (result.done) break;
    length += result.value.byteLength;
    if (length > 8192 || request.signal.aborted) { void reader.cancel().catch(() => {}); fail("selected_output_share_command_invalid", 400); }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { return fail("selected_output_share_command_invalid", 400); }
}
function row(value: unknown): Row {
  if (!exact(value, [...rowColumns])) fail();
  if (encoder.encode(JSON.stringify(value)).length > 8192 || rowColumns.some(key => value[key] !== null && typeof value[key] !== "string")) fail();
  const result = value as Row;
  if (result.minimized_at !== null || !digest(result.replay_key) || result.purpose !== SELECTED_OUTPUT_SHARE_PURPOSE || ![result.share_id, result.intent_key, result.project_id, result.job_id, result.completion_event_id].every(id)
    || !result.owner_id || encoder.encode(result.owner_id).length > 240 || !result.owner_email || encoder.encode(result.owner_email).length > 320
    || !digest(result.candidate_sha256) || !digest(result.issuer_authority_sha256)
    || ![result.created_at, result.source_expires_at, result.provenance_expires_at, result.expires_at].every(timestamp)
    || result.token_hash !== null && !digest(result.token_hash) || result.issued_at !== null && !timestamp(result.issued_at)
    || result.revoked_at !== null && !timestamp(result.revoked_at) || (result.token_hash === null) !== (result.issued_at === null)
    || !result.selection_json || !result.review_title) fail();
  if (result.created_at! >= result.expires_at! || result.expires_at! > result.source_expires_at! || result.expires_at! > result.provenance_expires_at!
    || result.issued_at !== null && (result.issued_at < result.created_at! || result.issued_at >= result.expires_at!)
    || result.revoked_at !== null && result.revoked_at < result.created_at!) fail();
  return result;
}
function selectionOf(current: Row) {
  try { return parseSelectedOutputShareSelection(JSON.parse(current.selection_json!)) ?? fail(); } catch { return fail(); }
}
function rowAssertion(current: Row): Assertion {
  return { sql: `EXISTS(SELECT 1 FROM selected_output_shares WHERE ${rowColumns.map(column => `${column} IS ?`).join(" AND ")})`,
    bindings: rowColumns.map(column => current[column]) };
}
function joined(...proofs: (Assertion | readonly SelectedShareProofQuery[])[]): readonly SelectedShareProofQuery[] {
  return proofs.flatMap(proof => Array.isArray(proof) ? proof : [selectedSharePredicateProof(proof as Assertion)]);
}
function future(current: Row) { if (Date.parse(current.expires_at!) <= Date.now() || current.revoked_at !== null) fail(); }
function live(current: Row, active = false): Assertion {
  return { sql: `EXISTS(SELECT 1 FROM selected_output_shares WHERE share_id=? AND purpose=? AND minimized_at IS NULL AND revoked_at IS NULL
    AND expires_at>${nowSql} AND source_expires_at>${nowSql} AND provenance_expires_at>${nowSql}${active ? " AND token_hash IS NOT NULL AND issued_at IS NOT NULL" : ""})`,
  bindings: [current.share_id, SELECTED_OUTPUT_SHARE_PURPOSE] };
}
async function fresh(env: WorkerEnv, principal: NativeRetainedIdentity, selection: SelectedOutputShareSelection, review: unknown) {
  const custody = await readNativeRetainedTextCustody(env, principal, selection);
  const source = nativeRetainedTextCustodySnapshot(custody, env);
  const authority = await readSelectedOutputShareAuthority(env, custody);
  const provenance = selectedOutputShareAuthoritySnapshot(authority, env);
  const candidate = await projectSelectedOutputShareCandidate(selection, source.dto, review);
  if (!candidate || candidate.publicOutput.expiresAt > provenance.expiresAt) fail();
  return { source, provenance, candidate, authHash: await hash(source.authSnapshot),
    // The authority witness includes this exact native custody assertion.
    proof: selectedOutputShareAuthorityAssertion(authority, env) };
}
function matches(current: Row, value: Awaited<ReturnType<typeof fresh>>) {
  if (current.candidate_sha256 !== value.candidate.candidateSha256 || current.issuer_authority_sha256 !== value.authHash
    || current.owner_id !== value.source.identity.userId || current.owner_email !== value.source.identity.email
    || current.project_id !== value.source.projectId || current.job_id !== value.provenance.jobId
    || current.completion_event_id !== value.source.completionId || current.completion_event_id !== value.provenance.completionId
    || current.source_expires_at !== value.source.sourceExpiresAt || current.provenance_expires_at !== value.provenance.expiresAt
    || current.selection_json !== JSON.stringify(value.candidate.selection) || current.review_title !== value.candidate.publicOutput.title
    || current.expires_at !== value.candidate.publicOutput.expiresAt) fail();
}
async function finalProof(env: WorkerEnv, assertion: readonly SelectedShareProofQuery[]) {
  const proof = selectedShareProofStatement(joined(selectedOutputShareSchemaAssertion(), assertion));
  const result = await env.DB.prepare(`${proof.withSql} SELECT 1 AS permitted WHERE ${proof.sql}`).bind(...proof.bindings).first<{ permitted: number }>();
  if (result?.permitted !== 1) fail();
}
const shareMetadata = (current: Row) => ({ shareId: current.share_id, expiresAt: current.expires_at, active: true as const });

/** Authenticated preparation stores only identity and explicit review choices,
 * never a copy of the native output. It cannot activate a public read token. */
export async function prepareSelectedOutputShare(request: Request, env: WorkerEnv): Promise<Response> {
  try {
    const stable = frame(request, env), principal = identity(request), input = await command(request); stable();
    if (!exact(input, ["intentKey", "selection", "review"]) || !id(input.intentKey)) fail("selected_output_share_command_invalid", 400);
    const selection = parseSelectedOutputShareSelection(input.selection);
    if (!selection) fail("selected_output_share_command_invalid", 400);
    await ready(env); stable();
    const intent = await replayKey(principal.userId, input.intentKey); stable();
    let existing = await env.DB.prepare(`SELECT ${rowColumns.join(",")} FROM selected_output_shares WHERE replay_key=?`)
      .bind(intent).first(); stable();
    if (existing) row(existing); // A minimized intent remains consumed without reading source content.
    const value = await fresh(env, principal, selection, input.review); stable();
    let replayed = Boolean(existing);
    if (!existing) {
      const current: Row = { share_id: crypto.randomUUID(), purpose: SELECTED_OUTPUT_SHARE_PURPOSE, replay_key: intent, owner_id: principal.userId,
        owner_email: principal.email, intent_key: input.intentKey, project_id: value.source.projectId, job_id: value.provenance.jobId,
        completion_event_id: value.source.completionId, selection_json: JSON.stringify(value.candidate.selection),
        review_title: value.candidate.publicOutput.title, source_expires_at: value.source.sourceExpiresAt,
        provenance_expires_at: value.provenance.expiresAt, expires_at: value.candidate.publicOutput.expiresAt,
        candidate_sha256: value.candidate.candidateSha256, issuer_authority_sha256: value.authHash, created_at: new Date().toISOString(),
        token_hash: null, issued_at: null, revoked_at: null, minimized_at: null };
      stable();
      try {
        const proof = selectedShareProofStatement(joined(selectedOutputShareSchemaAssertion(), value.proof));
        const inserted = await env.DB.prepare(`${proof.withSql} INSERT INTO selected_output_shares(${rowColumns.join(",")})
          SELECT ${rowColumns.map(() => "?").join(",")} WHERE (${proof.sql}) AND ?>${nowSql}`)
          .bind(...proof.bindings, ...rowColumns.map(column => current[column]), current.expires_at).run();
        stable(); if (Number(inserted.meta.changes ?? 0) !== 1) fail();
        existing = current;
      } catch (error) {
        stable();
        existing = await env.DB.prepare(`SELECT ${rowColumns.join(",")} FROM selected_output_shares WHERE replay_key=?`)
          .bind(intent).first();
        if (!existing) throw error;
        replayed = true;
      }
    }
    const current = row(existing); future(current); matches(current, value);
    if (current.issued_at !== null) fail("selected_output_share_already_issued", 409);
    stable(); await finalProof(env, joined(value.proof, rowAssertion(current), live(current))); stable(); future(current);
    return json({ candidateId: current.share_id, candidate: value.candidate, replayed });
  } catch (error) { return rejected(error); }
}

/** Deliberate approval consumes one candidate exactly once. A lost response is
 * retried as metadata only: hashes never recover or rotate the original secret. */
export async function commitSelectedOutputShare(request: Request, env: WorkerEnv): Promise<Response> {
  try {
    const stable = frame(request, env), principal = identity(request), input = await command(request); stable();
    if (!exact(input, ["candidateId", "approval"]) || !id(input.candidateId)) fail("selected_output_share_command_invalid", 400);
    await ready(env); stable();
    const current = row(await env.DB.prepare(`SELECT ${rowColumns.join(",")} FROM selected_output_shares WHERE share_id=? AND owner_id=?`)
      .bind(input.candidateId, principal.userId).first()); stable(); future(current);
    const value = await fresh(env, principal, selectionOf(current), { title: current.review_title, expiresAt: current.expires_at });
    stable(); matches(current, value);
    if (!parseSelectedOutputShareApproval(input.approval, value.candidate)) fail("selected_output_share_approval_required", 400);
    if (current.issued_at !== null) {
      await finalProof(env, joined(value.proof, rowAssertion(current), live(current, true))); stable(); future(current);
      return json({ share: shareMetadata(current), replayed: true });
    }
    const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replaceAll("+", "-").replaceAll("/", "_");
    const token = await tokenHash(secret), issuedAt = new Date().toISOString(); stable();
    const proof = selectedShareProofStatement(joined(selectedOutputShareSchemaAssertion(), value.proof, rowAssertion(current), live(current)));
    const issued = await env.DB.prepare(`${proof.withSql} UPDATE selected_output_shares SET token_hash=?,issued_at=?
      WHERE share_id=? AND minimized_at IS NULL AND token_hash IS NULL AND issued_at IS NULL AND revoked_at IS NULL AND (${proof.sql}) AND ?>=${nowSql}`)
      // The database deadline is the reviewed expiry, not a prepared wall-clock snapshot.
      .bind(...proof.bindings, token, issuedAt, current.share_id, current.expires_at).run(); stable();
    if (Number(issued.meta.changes ?? 0) !== 1) {
      const observed = row(await env.DB.prepare(`SELECT ${rowColumns.join(",")} FROM selected_output_shares WHERE share_id=? AND owner_id=?`)
        .bind(current.share_id, principal.userId).first()); stable(); future(observed); matches(observed, value);
      if (observed.issued_at === null) fail();
      await finalProof(env, joined(value.proof, rowAssertion(observed), live(observed, true))); stable(); future(observed);
      return json({ share: shareMetadata(observed), replayed: true });
    }
    future(current);
    return json({ share: { ...shareMetadata(current), token: secret }, replayed: false });
  } catch (error) { return rejected(error); }
}

/** The token supplies only a selected-output read scope. Its bound stored
 * canonical principal is checked directly; no authenticated headers are forged. */
export async function readSelectedOutputShare(request: Request, env: WorkerEnv, rawToken: string): Promise<Response> {
  try {
    if (request.method !== "GET") fail("method_not_allowed", 405);
    if (typeof rawToken !== "string" || !/^[A-Za-z0-9_-]{32}$/u.test(rawToken)) fail();
    const stable = frame(request, env);
    await ready(env); stable();
    const token = await tokenHash(rawToken); stable();
    const current = row(await env.DB.prepare(`SELECT ${rowColumns.map(column => `share.${column}`).join(",")} FROM selected_output_shares share
      JOIN users owner ON owner.user_id=share.owner_id AND owner.email=share.owner_email
      WHERE share.token_hash=? AND share.purpose=? AND share.minimized_at IS NULL AND share.issued_at IS NOT NULL AND share.revoked_at IS NULL AND share.expires_at>${nowSql}`)
      .bind(token, SELECTED_OUTPUT_SHARE_PURPOSE).first()); stable(); future(current);
    const principal: NativeRetainedIdentity = { userId: current.owner_id!, email: current.owner_email!, source: "openai-workspace" };
    const value = await fresh(env, principal, selectionOf(current), { title: current.review_title, expiresAt: current.expires_at });
    stable(); matches(current, value);
    const serialized = JSON.stringify(value.candidate.publicOutput);
    await finalProof(env, joined(value.proof, rowAssertion(current), live(current, true))); stable(); future(current);
    return new Response(serialized, { status: 200, headers });
  } catch (error) { return rejected(error); }
}

/** Revocation only removes access. Source expiry, loss of creator role and
 * generation consent do not prevent the authenticated canonical owner doing so. */
export async function revokeSelectedOutputShare(request: Request, env: WorkerEnv, shareId: string): Promise<Response> {
  try {
    if (request.method !== "DELETE") fail("method_not_allowed", 405);
    origin(request);
    if (!id(shareId)) fail();
    const stable = frame(request, env), principal = identity(request); stable();
    await ready(env); stable();
    const schema = selectedOutputShareSchemaAssertion();
    const proof = `EXISTS(SELECT 1 FROM users WHERE user_id=? AND email=?)`;
    await env.DB.prepare(`UPDATE selected_output_shares SET revoked_at=${nowSql}
      WHERE share_id=? AND owner_id=? AND purpose=? AND minimized_at IS NULL AND revoked_at IS NULL AND (${proof}) AND (${schema.sql})`)
      .bind(shareId, principal.userId, SELECTED_OUTPUT_SHARE_PURPOSE, principal.userId, principal.email, ...schema.bindings).run(); stable();
    const revoked = await env.DB.prepare(`SELECT 1 AS revoked FROM selected_output_shares WHERE share_id=? AND owner_id=?
      AND purpose=? AND minimized_at IS NULL AND revoked_at IS NOT NULL AND (${proof}) AND (${schema.sql})`)
      .bind(shareId, principal.userId, SELECTED_OUTPUT_SHARE_PURPOSE, principal.userId, principal.email, ...schema.bindings).first<{ revoked: number }>(); stable();
    if (revoked?.revoked !== 1) fail();
    return json({ ok: true });
  } catch (error) { return rejected(error); }
}
