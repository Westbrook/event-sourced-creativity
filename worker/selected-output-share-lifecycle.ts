import { parseSelectedOutputShareAnyApproval, parseSelectedOutputShareAnySelection, projectSelectedOutputShareCandidate,
  projectSelectedOutputShareMediaCandidate, selectedOutputShareNativeMediaSelection,
  SELECTED_OUTPUT_SHARE_PURPOSE, type SelectedOutputShareAnySelection } from "../src/model/selected-output-share.ts";
import { hostedIdentity, readNativeRetainedTextCustody, nativeRetainedTextCustodySnapshot,
  type NativeRetainedIdentity } from "./native-retained-text-custody.ts";
import { readSelectedOutputShareAuthority, readSelectedOutputShareMediaAuthority, readSelectedOutputShareStableAudioAuthority, selectedOutputShareAuthoritySnapshot,
  selectedOutputShareAuthorityAssertion } from "./selected-output-share-authority.ts";
import { readNativeRetainedMediaCustody, nativeRetainedMediaCustodySnapshot } from "./native-retained-media-custody.ts";
import { readNativeRetainedMediaBytes, readNativeRetainedStableAudioBytes, copyCurrentNativeRetainedMediaBytes, assertNativeRetainedMediaBytesCurrent,
  NATIVE_RETAINED_MEDIA_BYTES_BUDGET_MS, type NativeRetainedMediaBytes } from "./native-retained-media-bytes.ts";
import { SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY } from "../src/model/selected-output-share-video.ts";
import { selectedOutputShareSchemaState, selectedOutputShareSchemaAssertion } from "./selected-output-share-readiness.ts";
import type { WorkerEnv } from "./runtime.ts";
import { selectedSharePredicateProof, selectedShareProofStatement, type SelectedShareProofQuery } from "./selected-output-share-proof.ts";
import { isSelectedOutputShareStableAudioSelection } from "../src/model/selected-output-share-mp3-contract.ts";
import { readNativeStableAudioRecipeProof } from "./native-stable-audio-share-proof.ts";
import type { SelectedOutputShareMp3Operation } from "./selected-output-share-mp3-operation.ts";

// The finite selected-share dispatcher exposes read/revoke only while creation
// remains closed. There is no initializer, provider or budget entry here. The
// media branch uses only opaque current native custody and bounded owned bytes.
// Every source and publication proof is freshly obtained inside the call.
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
function frame(request: Request, env: WorkerEnv, operationSignal: AbortSignal = request.signal) {
  const db = env.DB, cohort = env.FORMA_PILOT_COHORT_ID, administrators = env.FORMA_ADMIN_EMAILS;
  return () => {
    if (env.DB !== db || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== administrators || request.signal.aborted || operationSignal.aborted) fail();
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
async function command(request: Request, signal: AbortSignal) {
  if (request.method !== "POST") fail("method_not_allowed", 405);
  origin(request);
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") fail("selected_output_share_command_invalid", 400);
  const reader = request.body?.getReader();
  if (!reader) fail("selected_output_share_command_invalid", 400);
  const chunks: Uint8Array[] = []; let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) { cancel(); fail(); }
    for (;;) {
      const result = await reader.read();
      if (signal.aborted || request.signal.aborted) fail();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > 8192) { cancel(); fail("selected_output_share_command_invalid", 400); }
      chunks.push(result.value);
    }
  } finally { signal.removeEventListener("abort", cancel); try { reader.releaseLock(); } catch { /* Cancellation owns a pending read. */ } }
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
  try { return parseSelectedOutputShareAnySelection(JSON.parse(current.selection_json!)) ?? fail(); } catch { return fail(); }
}
function rowAssertion(current: Row): Assertion {
  return { sql: `EXISTS(SELECT 1 FROM selected_output_shares WHERE ${rowColumns.map(column => `${column} IS ?`).join(" AND ")})`,
    bindings: rowColumns.map(column => current[column]) };
}
function joined(...proofs: (Assertion | readonly SelectedShareProofQuery[])[]): readonly SelectedShareProofQuery[] {
  return proofs.flatMap(proof => Array.isArray(proof) ? proof : [selectedSharePredicateProof(proof as Assertion)]);
}
function future(current: Row) { if (Date.parse(current.expires_at!) <= Date.now() || current.revoked_at !== null) fail(); }
function live(current: Row, active = false, prepared = false): Assertion {
  return { sql: `EXISTS(SELECT 1 FROM selected_output_shares WHERE share_id=? AND purpose=? AND minimized_at IS NULL AND revoked_at IS NULL
    AND expires_at>${nowSql} AND source_expires_at>${nowSql} AND provenance_expires_at>${nowSql}${active ? " AND token_hash IS NOT NULL AND issued_at IS NOT NULL" : prepared ? " AND token_hash IS NULL AND issued_at IS NULL" : ""})`,
  bindings: [current.share_id, SELECTED_OUTPUT_SHARE_PURPOSE] };
}
type Mp3Operation = { proof: SelectedOutputShareMp3Operation; resources: typeof import("./selected-output-share-mp3-operation.ts") };
type OperationDeadline = Readonly<{ wallDeadline: number; monotonicDeadline: number }>;
const operationDeadline = (): OperationDeadline => Object.freeze({ wallDeadline: Date.now() + NATIVE_RETAINED_MEDIA_BYTES_BUDGET_MS,
  monotonicDeadline: performance.now() + NATIVE_RETAINED_MEDIA_BYTES_BUDGET_MS });
/** Metadata lookup and command parsing precede knowledge of the source branch.
 * Race those awaits too. A derivative body owns the actual request signal and
 * these same deadlines, so clearing this transient wrapper cannot renew it or
 * abort its successful handoff. Late unhanded bodies are cancelled. */
async function withOperationBudget(request: Request,
  action: (signal: AbortSignal, deadline: OperationDeadline) => Promise<Response>): Promise<Response> {
  const deadline = operationDeadline(), controller = new AbortController();
  if (request.signal.aborted) return rejected(new Refusal("selected_output_share_unavailable", 404));
  let timer: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | undefined, accepting = true;
  const stopped = new Promise<never>((_, reject) => {
    cancel = () => { controller.abort(); reject(new Refusal("selected_output_share_unavailable", 404)); };
    request.signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(cancel, Math.max(0, Math.min(deadline.wallDeadline - Date.now(), deadline.monotonicDeadline - performance.now())));
    if (request.signal.aborted) cancel();
  });
  const pending = Promise.resolve().then(() => action(controller.signal, deadline));
  void pending.then(response => { if (!accepting) void response.body?.cancel().catch(() => {}); }, () => {});
  try { return await Promise.race([pending, stopped]); }
  catch (error) { return rejected(error); }
  finally {
    accepting = false; clearTimeout(timer);
    if (cancel) request.signal.removeEventListener("abort", cancel);
    controller.abort(); void pending.catch(() => {});
  }
}
async function beginMp3(selection: SelectedOutputShareAnySelection, signal: AbortSignal,
  deadline?: OperationDeadline): Promise<Mp3Operation | null> {
  if (!isSelectedOutputShareStableAudioSelection(selection)) return null;
  const resources = await import("./selected-output-share-mp3-operation.ts");
  const proof = resources.acquireSelectedOutputShareMp3Operation(signal, deadline);
  if (!proof) fail();
  return { proof, resources };
}
const during = <T>(operation: Mp3Operation | null, thunk: () => Promise<T>, disposeLate?: (result: T) => void | Promise<void>): Promise<T> =>
  operation ? operation.resources.runSelectedOutputShareMp3Operation(operation.proof, thunk, disposeLate) : thunk();
function operationCurrent(operation: Mp3Operation | null) { operation?.resources.assertSelectedOutputShareMp3OperationCurrent(operation.proof); }
function finishMp3(operation: Mp3Operation | null) { operation?.resources.finishSelectedOutputShareMp3Operation(operation.proof); }
async function fresh(env: WorkerEnv, principal: NativeRetainedIdentity, selection: SelectedOutputShareAnySelection,
  review: unknown, signal: AbortSignal, operation: Mp3Operation | null = null) {
  if (selection.output === "audio" || selection.output === "video" || selection.output === "model3d") {
    const nativeSelection = selectedOutputShareNativeMediaSelection(selection);
    if (!nativeSelection) fail();
    const derivative = isSelectedOutputShareStableAudioSelection(nativeSelection);
    if (derivative && !operation || !derivative && operation) fail();
    const actualSignal = operation ? operation.resources.selectedOutputShareMp3OperationSignal(operation.proof) : signal;
    const custody = await during(operation, () => readNativeRetainedMediaCustody(env, principal, nativeSelection, actualSignal));
    const source = nativeRetainedMediaCustodySnapshot(custody, env);
    const recipe = derivative ? await during(operation, () => readNativeStableAudioRecipeProof(env, principal, {
      output: "audio", documentId: nativeSelection.documentId, artifactId: nativeSelection.artifactId,
      revision: nativeSelection.revision, contentSha256: nativeSelection.contentSha256, mediaSha256: nativeSelection.mediaSha256,
      sourceProfile: nativeSelection.sourceProfile, projectionPolicy: nativeSelection.projectionPolicy,
    }, actualSignal)) : null;
    const authority = await during(operation, () => recipe
      ? readSelectedOutputShareStableAudioAuthority(env, custody, recipe) : readSelectedOutputShareMediaAuthority(env, custody));
    const provenance = selectedOutputShareAuthoritySnapshot(authority, env);
    const media = recipe && operation ? await during(operation, () => readNativeRetainedStableAudioBytes(custody, recipe, env, operation.proof))
      : await readNativeRetainedMediaBytes(custody, env);
    const disclosure = source.dto.output === "audio"
      ? { watermark: source.dto.content.synthIdWatermarked === true ? "synthid-declared" : "not-declared" }
      : source.dto.output === "video" ? { encoderDeclaration: nativeSelection.policy === SELECTED_OUTPUT_SHARE_VIDEO_X264_POLICY ? "x264-163-r3060" : null } : {};
    const candidate = await during(operation, () => projectSelectedOutputShareMediaCandidate(selection,
      { descriptor: media.descriptor, sourceExpiresAt: source.expiresAt, disclosure }, review));
    if (!candidate || candidate.publicOutput.expiresAt > provenance.expiresAt) fail();
    return { source, provenance, candidate, media, sourceExpiry: candidate.sourceExpiresAt,
      authHash: await during(operation, () => hash(source.authSnapshot)), proof: selectedOutputShareAuthorityAssertion(authority, env) };
  }
  const custody = await readNativeRetainedTextCustody(env, principal, selection);
  const source = nativeRetainedTextCustodySnapshot(custody, env);
  const authority = await readSelectedOutputShareAuthority(env, custody);
  const provenance = selectedOutputShareAuthoritySnapshot(authority, env);
  const candidate = await projectSelectedOutputShareCandidate(selection, source.dto, review);
  if (!candidate || candidate.publicOutput.expiresAt > provenance.expiresAt) fail();
  return { source, provenance, candidate, media: null, sourceExpiry: source.sourceExpiresAt, authHash: await hash(source.authSnapshot),
    // The authority witness includes this exact native custody assertion.
    proof: selectedOutputShareAuthorityAssertion(authority, env) };
}
function matches(current: Row, value: Awaited<ReturnType<typeof fresh>>) {
  if (current.candidate_sha256 !== value.candidate.candidateSha256 || current.issuer_authority_sha256 !== value.authHash
    || current.owner_id !== value.source.identity.userId || current.owner_email !== value.source.identity.email
    || current.project_id !== value.source.projectId || current.job_id !== value.provenance.jobId
    || current.completion_event_id !== value.source.completionId || current.completion_event_id !== value.provenance.completionId
    || current.source_expires_at !== value.sourceExpiry || current.provenance_expires_at !== value.provenance.expiresAt
    || current.selection_json !== JSON.stringify(value.candidate.selection) || current.review_title !== value.candidate.publicOutput.title
    || current.expires_at !== value.candidate.publicOutput.expiresAt) fail();
}
async function finalProof(env: WorkerEnv, assertion: readonly SelectedShareProofQuery[], media: NativeRetainedMediaBytes | null) {
  const proof = selectedShareProofStatement(joined(selectedOutputShareSchemaAssertion(), assertion), media ? "balanced" : "linear");
  const result = await env.DB.prepare(`${proof.withSql} SELECT 1 AS permitted WHERE ${proof.sql}`).bind(...proof.bindings).first<{ permitted: number }>();
  if (result?.permitted !== 1) fail();
  if (media) assertNativeRetainedMediaBytesCurrent(media, env);
}
const shareMetadata = (current: Row) => ({ shareId: current.share_id, expiresAt: current.expires_at, active: true as const });

/** Authenticated preparation stores only identity and explicit review choices,
 * never a copy of the native output. It cannot activate a public read token. */
async function prepare(request: Request, env: WorkerEnv, operationSignal: AbortSignal, deadline: OperationDeadline): Promise<Response> {
  let operation: Mp3Operation | null = null;
  try {
    const frameCurrent = frame(request, env, operationSignal);
    const stable = () => { frameCurrent(); operationCurrent(operation); };
    const principal = identity(request), input = await command(request, operationSignal); stable();
    if (!exact(input, ["intentKey", "selection", "review"]) || !id(input.intentKey)) fail("selected_output_share_command_invalid", 400);
    const selection = parseSelectedOutputShareAnySelection(input.selection);
    if (!selection) fail("selected_output_share_command_invalid", 400);
    operation = await beginMp3(selection, request.signal, deadline);
    await during(operation, () => ready(env)); stable();
    const intent = await during(operation, () => replayKey(principal.userId, input.intentKey as string)); stable();
    let existing = await during(operation, () => env.DB.prepare(`SELECT ${rowColumns.join(",")} FROM selected_output_shares WHERE replay_key=?`)
      .bind(intent).first()); stable();
    if (existing) row(existing); // A minimized intent remains consumed without reading source content.
    const value = await fresh(env, principal, selection, input.review, operationSignal, operation); stable();
    let replayed = Boolean(existing);
    if (!existing) {
      const current: Row = { share_id: crypto.randomUUID(), purpose: SELECTED_OUTPUT_SHARE_PURPOSE, replay_key: intent, owner_id: principal.userId,
        owner_email: principal.email, intent_key: input.intentKey, project_id: value.source.projectId, job_id: value.provenance.jobId,
        completion_event_id: value.source.completionId, selection_json: JSON.stringify(value.candidate.selection),
        review_title: value.candidate.publicOutput.title, source_expires_at: value.sourceExpiry,
        provenance_expires_at: value.provenance.expiresAt, expires_at: value.candidate.publicOutput.expiresAt,
        candidate_sha256: value.candidate.candidateSha256, issuer_authority_sha256: value.authHash, created_at: new Date().toISOString(),
        token_hash: null, issued_at: null, revoked_at: null, minimized_at: null };
      stable();
      try {
        const proof = selectedShareProofStatement(joined(selectedOutputShareSchemaAssertion(), value.proof), value.media ? "balanced" : "linear");
        const inserted = await during(operation, () => env.DB.prepare(`${proof.withSql} INSERT INTO selected_output_shares(${rowColumns.join(",")})
          SELECT ${rowColumns.map(() => "?").join(",")} WHERE (${proof.sql}) AND ?>${nowSql}`)
          .bind(...proof.bindings, ...rowColumns.map(column => current[column]), current.expires_at).run());
        stable(); if (Number(inserted.meta.changes ?? 0) !== 1) fail();
        existing = current;
      } catch (error) {
        stable();
        existing = await during(operation, () => env.DB.prepare(`SELECT ${rowColumns.join(",")} FROM selected_output_shares WHERE replay_key=?`)
          .bind(intent).first());
        if (!existing) throw error;
        replayed = true;
      }
    }
    const current = row(existing); future(current); matches(current, value);
    if (current.issued_at !== null) fail("selected_output_share_already_issued", 409);
    stable(); await during(operation, () => finalProof(env, joined(value.proof, rowAssertion(current), live(current)), value.media)); stable(); future(current);
    return json({ candidateId: current.share_id, candidate: value.candidate, replayed });
  } catch (error) { return rejected(error); }
  finally { finishMp3(operation); }
}
export function prepareSelectedOutputShare(request: Request, env: WorkerEnv): Promise<Response> {
  return withOperationBudget(request, (signal, deadline) => prepare(request, env, signal, deadline));
}

/** Deliberate approval consumes one candidate exactly once. A lost response is
 * retried as metadata only: hashes never recover or rotate the original secret. */
async function commit(request: Request, env: WorkerEnv, operationSignal: AbortSignal, deadline: OperationDeadline): Promise<Response> {
  let operation: Mp3Operation | null = null;
  try {
    const frameCurrent = frame(request, env, operationSignal);
    const stable = () => { frameCurrent(); operationCurrent(operation); };
    const principal = identity(request), input = await command(request, operationSignal); stable();
    if (!exact(input, ["candidateId", "approval"]) || !id(input.candidateId)) fail("selected_output_share_command_invalid", 400);
    await ready(env); stable();
    const current = row(await env.DB.prepare(`SELECT ${rowColumns.join(",")} FROM selected_output_shares WHERE share_id=? AND owner_id=?`)
      .bind(input.candidateId, principal.userId).first()); stable(); future(current);
    const selection = selectionOf(current); operation = await beginMp3(selection, request.signal, deadline);
    const value = await fresh(env, principal, selection, { title: current.review_title, expiresAt: current.expires_at }, operationSignal, operation);
    stable(); matches(current, value);
    if (!parseSelectedOutputShareAnyApproval(input.approval, value.candidate)) fail("selected_output_share_approval_required", 400);
    if (current.issued_at !== null) {
      await during(operation, () => finalProof(env, joined(value.proof, rowAssertion(current), live(current, true)), value.media)); stable(); future(current);
      return json({ share: shareMetadata(current), replayed: true });
    }
    const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replaceAll("+", "-").replaceAll("/", "_");
    const token = await during(operation, () => tokenHash(secret)), issuedAt = new Date().toISOString(); stable();
    const proof = selectedShareProofStatement(joined(selectedOutputShareSchemaAssertion(), value.proof, rowAssertion(current), live(current)),
      value.media ? "balanced" : "linear");
    const issued = await during(operation, () => env.DB.prepare(`${proof.withSql} UPDATE selected_output_shares SET token_hash=?,issued_at=?
      WHERE share_id=? AND minimized_at IS NULL AND token_hash IS NULL AND issued_at IS NULL AND revoked_at IS NULL AND (${proof.sql}) AND ?>=${nowSql}`)
      // The database deadline is the reviewed expiry, not a prepared wall-clock snapshot.
      .bind(...proof.bindings, token, issuedAt, current.share_id, current.expires_at).run()); stable();
    if (Number(issued.meta.changes ?? 0) !== 1) {
      const observed = row(await during(operation, () => env.DB.prepare(`SELECT ${rowColumns.join(",")} FROM selected_output_shares WHERE share_id=? AND owner_id=?`)
        .bind(current.share_id, principal.userId).first())); stable(); future(observed); matches(observed, value);
      if (observed.issued_at === null) fail();
      await during(operation, () => finalProof(env, joined(value.proof, rowAssertion(observed), live(observed, true)), value.media)); stable(); future(observed);
      return json({ share: shareMetadata(observed), replayed: true });
    }
    future(current);
    if (value.media) assertNativeRetainedMediaBytesCurrent(value.media, env);
    return json({ share: { ...shareMetadata(current), token: secret }, replayed: false });
  } catch (error) { return rejected(error); }
  finally { finishMp3(operation); }
}
export function commitSelectedOutputShare(request: Request, env: WorkerEnv): Promise<Response> {
  return withOperationBudget(request, (signal, deadline) => commit(request, env, signal, deadline));
}

/** The token supplies only a selected-output read scope. Its bound stored
 * canonical principal is checked directly; no authenticated headers are forged. */
async function readPublic(request: Request, env: WorkerEnv, rawToken: string, file: boolean,
  operationSignal: AbortSignal = request.signal, deadline: OperationDeadline = operationDeadline()): Promise<Response> {
  let operation: Mp3Operation | null = null;
  try {
    if (request.method !== "GET") fail("method_not_allowed", 405);
    if (typeof rawToken !== "string" || !/^[A-Za-z0-9_-]{32}$/u.test(rawToken)) fail();
    const frameCurrent = frame(request, env, operationSignal);
    const stable = () => { frameCurrent(); operationCurrent(operation); }; stable();
    await ready(env); stable();
    const token = await tokenHash(rawToken); stable();
    const current = row(await env.DB.prepare(`SELECT ${rowColumns.map(column => `share.${column}`).join(",")} FROM selected_output_shares share
      JOIN users owner ON owner.user_id=share.owner_id AND owner.email=share.owner_email
      WHERE share.token_hash=? AND share.purpose=? AND share.minimized_at IS NULL AND share.issued_at IS NOT NULL AND share.revoked_at IS NULL AND share.expires_at>${nowSql}`)
      .bind(token, SELECTED_OUTPUT_SHARE_PURPOSE).first()); stable(); future(current);
    const selection = selectionOf(current);
    if (file && selection.output !== "audio" && selection.output !== "video" && selection.output !== "model3d") fail();
    operation = await beginMp3(selection, request.signal, deadline);
    const principal: NativeRetainedIdentity = { userId: current.owner_id!, email: current.owner_email!, source: "openai-workspace" };
    const value = await fresh(env, principal, selection, { title: current.review_title, expiresAt: current.expires_at }, operationSignal, operation);
    stable(); matches(current, value);
    const serialized = JSON.stringify(value.candidate.publicOutput);
    // Obtain a locally owned complete buffer after its own current custody
    // check; never expose an R2 stream, key, redirect or caller-selected asset.
    const fileBytes = file && value.media ? await copyCurrentNativeRetainedMediaBytes(value.media, env) : null;
    if (file && !fileBytes) fail();
    await during(operation, () => finalProof(env, joined(value.proof, rowAssertion(current), live(current, true)), value.media)); stable(); future(current);
    if (fileBytes && value.media) {
      const descriptor = value.media.descriptor;
      const filename = descriptor.kind === "audio" ? "forma-audio.wav" : descriptor.kind === "video" ? "forma-video.mp4" : "forma-3d.glb";
      const init = { status: 200, headers: {
        ...headers, "content-type": descriptor.mimeType, "content-length": String(fileBytes.byteLength),
        "content-disposition": `attachment; filename="${filename}"`,
        "content-security-policy": "default-src 'none'; sandbox",
      } };
      if (operation) {
        operation.resources.retireSelectedOutputShareMp3Projection(operation.proof);
        return operation.resources.selectedOutputShareMp3Response(operation.proof, fileBytes, init);
      }
      return new Response(fileBytes, init);
    }
    return new Response(serialized, { status: 200, headers });
  } catch (error) { return rejected(error); }
  finally { finishMp3(operation); }
}

/** Existing JSON delivery remains the finite reviewed public projection. */
export function readSelectedOutputShare(request: Request, env: WorkerEnv, rawToken: string): Promise<Response> {
  return withOperationBudget(request, (signal, deadline) => readPublic(request, env, rawToken, false, signal, deadline));
}
/** Full-file delivery only, from the exact current qualified native buffer. */
export function readSelectedOutputShareMediaFile(request: Request, env: WorkerEnv, rawToken: string): Promise<Response> {
  return withOperationBudget(request, (signal, deadline) => readPublic(request, env, rawToken, true, signal, deadline));
}

/** Owner-only exact prepared derivative. Candidate IDs are row selectors, never
 * bearer credentials. The production dispatcher keeps this route closed while
 * creation is disabled; no original MP3 or caller-selected URL is returned. */
async function readPrepared(request: Request, env: WorkerEnv, candidateId: string,
  operationSignal: AbortSignal, deadline: OperationDeadline): Promise<Response> {
  let operation: Mp3Operation | null = null;
  try {
    const frameCurrent = frame(request, env, operationSignal);
    const stable = () => { frameCurrent(); operationCurrent(operation); };
    if (request.method !== "GET") fail("method_not_allowed", 405);
    if (request.headers.get("sec-fetch-site") !== "same-origin"
      || request.headers.has("origin") && request.headers.get("origin") !== new URL(request.url).origin)
      fail("selected_output_share_same_origin_required", 403);
    if (!id(candidateId)) fail();
    const principal = identity(request); stable(); await ready(env); stable();
    const current = row(await env.DB.prepare(`SELECT ${rowColumns.join(",")} FROM selected_output_shares WHERE share_id=? AND owner_id=?`)
      .bind(candidateId, principal.userId).first()); stable(); future(current);
    if (current.issued_at !== null || current.token_hash !== null) fail();
    const selection = selectionOf(current);
    if (!isSelectedOutputShareStableAudioSelection(selection)) fail();
    operation = await beginMp3(selection, request.signal, deadline);
    if (!operation) fail();
    const value = await fresh(env, principal, selection, { title: current.review_title, expiresAt: current.expires_at }, operationSignal, operation);
    stable(); matches(current, value);
    if (!value.media || value.media.descriptor.kind !== "audio") fail();
    const fileBytes = await copyCurrentNativeRetainedMediaBytes(value.media, env);
    await during(operation, () => finalProof(env, joined(value.proof, rowAssertion(current), live(current, false, true)), value.media));
    stable(); future(current);
    operation.resources.retireSelectedOutputShareMp3Projection(operation.proof);
    return operation.resources.selectedOutputShareMp3Response(operation.proof, fileBytes, { status: 200, headers: {
      ...headers, "content-type": "audio/wav", "content-length": String(fileBytes.byteLength),
      "content-disposition": 'attachment; filename="forma-audio.wav"', "content-security-policy": "default-src 'none'; sandbox",
    } });
  } catch (error) { return rejected(error); }
  finally { finishMp3(operation); }
}
export function readPreparedSelectedOutputShareMediaFile(request: Request, env: WorkerEnv, candidateId: string): Promise<Response> {
  return withOperationBudget(request, (signal, deadline) => readPrepared(request, env, candidateId, signal, deadline));
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
