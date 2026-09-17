import { jsonIssues, record } from "../src/experiences/compiler.ts";
import { readExistingPrincipalRequest, requireConsent } from "./principal-request-core.ts";
import { projectIntakeAuthority } from "./intake-authority.ts";
import { guestContextInventoryData, type GuestContextInventory } from "./experience-guest-context-inventory.ts";
import { guestImageSaveInventoryData, type GuestImageSaveInventory } from "./experience-guest-image-claim-inventory.ts";
import { guestImageStageClaimInventoryData, guestImageStageClaimLeaseRowProof, guestImageStageClaimProof,
  readGuestImageStageClaimLeaseRow, type GuestImageStageClaimInventory, type GuestImageStageClaimLeaseRow } from "./experience-guest-image-stage-claim-inventory.ts";
import { outputAssertionStatements } from "./output-command-core.ts";
import { GUEST_DB_NOW, guestFail, guestHash, guestId, guestSession, type GuestClaimProof } from "./experience-guest-session.ts";
import type { WorkerEnv } from "./runtime.ts";

export type GuestClaimLeaseRequest = Readonly<{ proof: GuestClaimProof; requestId: string; manifestDigest: string }>;
export type GuestContextClaimLeaseRequest = Readonly<{ proof: GuestClaimProof; requestId: string; inventory: GuestContextInventory }>;
type LeaseRow = { session_id: string; lease_id: string; destination_user_id: string; manifest_digest: string; request_id: string;
  acquisitions: number; created_at_ms: number; expires_at_ms: number };
export type GuestImageSaveClaimLeaseRequest = Readonly<{ proof: GuestClaimProof; requestId: string; inventory: GuestImageSaveInventory }>;
export type GuestImageStageClaimLeaseRequest = Readonly<{ proof: GuestClaimProof; requestId: string; inventory: GuestImageStageClaimInventory }>;
type ContextLease = { inventory: GuestContextInventory | GuestImageSaveInventory;
  data: ReturnType<typeof guestContextInventoryData> | ReturnType<typeof guestImageSaveInventoryData>; current: () => void };

/** Internal dormant lease only. manifestDigest is an untrusted immutable intent
 * commitment, not proof of source completeness or asset custody. This abstract
 * primitive is unregistered; context claims must use the guarded entry below. */
export async function acquireGuestClaimLease(request: Request, env: WorkerEnv, input: GuestClaimLeaseRequest) {
  if (jsonIssues(input).length || !record(input) || Object.keys(input).sort().join() !== "manifestDigest,proof,requestId"
    || !guestId(input.requestId) || !guestHash(input.manifestDigest)) return guestFail("lease_invalid");
  return acquireLease(request, env, structuredClone(input));
}

/** Original-context lease only. The opaque inventory supplies the manifest and
 * complete native proof; object identity alone is never a freshness check. */
export async function acquireGuestContextClaimLease(request: Request, env: WorkerEnv, input: GuestContextClaimLeaseRequest) {
  return acquireInventoryLease(request, env, input, "context");
}

/** First-SAVE custody only. The new opaque inventory proves precisely N+1,
 * preserving the stricter original-context entry and abstract lease behavior. */
export async function acquireGuestImageSaveClaimLease(request: Request, env: WorkerEnv, input: GuestImageSaveClaimLeaseRequest) {
  return acquireInventoryLease(request, env, input, "first-save");
}

async function acquireInventoryLease(request: Request, env: WorkerEnv,
  input: GuestContextClaimLeaseRequest | GuestImageSaveClaimLeaseRequest, kind: "context" | "first-save") {
  if (jsonIssues(input).length || !record(input) || Object.keys(input).sort().join() !== "inventory,proof,requestId"
    || !guestId(input.requestId) || !(request instanceof Request)) return guestFail("lease_invalid");
  const db = env.DB, url = request.url, method = request.method, headers = JSON.stringify(Array.from(request.headers)), signal = request.signal;
  const cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS, parsed = new URL(url), site = request.headers.get("sec-fetch-site");
  if (method !== "POST" || parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash
    || request.headers.get("origin") !== parsed.origin || site !== null && site !== "same-origin" && site !== "none"
    || new TextEncoder().encode(headers).byteLength > 32768) return guestFail("origin_required");
  const current = () => {
    if (env.DB !== db) guestFail("database_changed");
    if (request.signal !== signal || signal.aborted) guestFail("lease_aborted");
    if (request.url !== url || request.method !== method || JSON.stringify(Array.from(request.headers)) !== headers
      || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== admins) guestFail("lease_authority_changed");
  };
  current();
  const inventory = input.inventory, data = kind === "context"
    ? guestContextInventoryData(env, inventory as GuestContextInventory)
    : guestImageSaveInventoryData(env, inventory as GuestImageSaveInventory);
  const captured = { proof: structuredClone(input.proof), requestId: input.requestId, manifestDigest: inventory.manifestDigest };
  if (!record(captured.proof) || captured.proof.sessionId !== inventory.sessionId) return guestFail("lease_invalid");
  const result = await acquireLease(request, env, captured, { inventory, data, current });
  current();
  return result;
}

async function acquireLease(request: Request, env: WorkerEnv, captured: GuestClaimLeaseRequest, context?: ContextLease) {
  const db = env.DB, current = () => { context?.current(); };
  current();
  // Refuse even stale context/impersonation cookies: adoption must be explicit
  // personal canonical custody, not an effective or selected workspace account.
  if (/(?:^|;\s*)(?:forma_project_context|forma_impersonation)=/u.test(request.headers.get("cookie") ?? "")) return guestFail("personal_principal_required");
  const session = await guestSession(env, request, captured.proof);
  current();
  if (context && (context.inventory.sessionId !== session.row.session_id || context.inventory.guestSubject !== session.row.guest_subject
    || context.inventory.projectId !== session.row.project_id || context.inventory.documentId !== session.row.document_id
    || context.data.session.row.expires_at_ms !== session.row.expires_at_ms)) return guestFail("lease_invalid");
  const auth = await readExistingPrincipalRequest(request, env, "creator", { account: "principal" });
  current();
  if ("kind" in auth || auth.response || !auth.user || requireConsent(auth.user) || auth.user.fictional || auth.user.projectExecution
    || !auth.user.access.capabilities.includes("project.author") || auth.user.userId.startsWith("guest:")) return guestFail("destination_unavailable");
  const destination = auth.user.userId, native = projectIntakeAuthority(env, { user: auth.user, principal: auth.user, impersonation: null },
    { projectId: session.row.project_id, documentId: session.row.document_id });
  if (env.DB !== db) return guestFail("database_changed");
  const guard = `(${session.guard.sql}) AND (${native.sql})`, bindings = [...session.guard.bindings, ...native.bindings];
  const active = await db.prepare(`SELECT * FROM experience_guest_claim_leases WHERE session_id=? AND (${guard})`)
    .bind(session.row.session_id, ...bindings).first<LeaseRow>();
  current();
  if (active && (active.destination_user_id !== destination || active.manifest_digest !== captured.manifestDigest)) return guestFail("lease_conflict");
  const leaseId = active?.lease_id ?? crypto.randomUUID();
  let mutation: D1PreparedStatement | null = null;
  if (active) {
    // Exact replay never refreshes a lease or consumes another acquisition.
    if (active.request_id !== captured.requestId) {
      mutation = db.prepare(`UPDATE experience_guest_claim_leases SET request_id=?,request_ids_json=json_insert(request_ids_json,'$[#]',?),acquisitions=acquisitions+1,
        expires_at_ms=MIN(${GUEST_DB_NOW}+?,?) WHERE session_id=? AND destination_user_id=? AND manifest_digest=?
        AND request_id=? AND acquisitions=? AND acquisitions<? AND NOT EXISTS(SELECT 1 FROM json_each(request_ids_json) WHERE value=?) AND expires_at_ms<=${GUEST_DB_NOW} AND (${guard})`)
        .bind(captured.requestId, captured.requestId, session.policy.terms.leaseLifetimeMs, session.row.expires_at_ms, session.row.session_id, destination,
          captured.manifestDigest, active.request_id, active.acquisitions, session.policy.terms.maximumLeaseAcquisitions, captured.requestId, ...bindings);
    }
  } else {
    // A concurrent insert wins once. This intentional conflict handling cannot
    // turn a competitor or a changed manifest into a successful replay.
    mutation = db.prepare(`INSERT INTO experience_guest_claim_leases(session_id,lease_id,destination_user_id,manifest_digest,request_id,request_ids_json,acquisitions,created_at_ms,expires_at_ms)
      SELECT ?,?,?,?,?,json_array(?),1,${GUEST_DB_NOW},MIN(${GUEST_DB_NOW}+?,?) WHERE NOT EXISTS(SELECT 1 FROM experience_guest_claim_leases WHERE session_id=?) AND (${guard})`)
      .bind(session.row.session_id, leaseId, destination, captured.manifestDigest, captured.requestId, captured.requestId,
        session.policy.terms.leaseLifetimeMs, session.row.expires_at_ms, session.row.session_id, ...bindings);
  }
  const retainedSql = `session_id=? AND destination_user_id=? AND manifest_digest=? AND request_id=? AND expires_at_ms>${GUEST_DB_NOW}`;
  const retainedBindings = [session.row.session_id, destination, captured.manifestDigest, captured.requestId];
  if (mutation) {
    if (context) {
      // Separate native assertions keep each proof shallow under D1 limits.
      // The complete original inventory deliberately permits this lease, but
      // rejects a SAVE which won the serialized transaction first.
      const authority = { sql: guard, bindings };
      const statements = [...outputAssertionStatements(env, context.data.proof), ...outputAssertionStatements(env, authority), mutation,
        ...outputAssertionStatements(env, context.data.proof), ...outputAssertionStatements(env, authority),
        ...outputAssertionStatements(env, { sql: `EXISTS(SELECT 1 FROM experience_guest_claim_leases WHERE ${retainedSql})`, bindings: retainedBindings })];
      current();
      try { await db.batch(statements); }
      catch { /* An uncertain acknowledgement permits only the exact final read below. */ }
      current();
    } else {
      // Preserve the legacy abstract primitive's mutation/error semantics.
      await mutation.run();
    }
  }
  // Last snapshot is the sole return authority. Lost acknowledgements can retry
  // the same identity; revoked principal/session/policy cannot read a lease.
  if (env.DB !== db) return guestFail("database_changed");
  current();
  const retained = context
    ? await db.prepare(`WITH context_lease_inventory AS MATERIALIZED(SELECT 1 WHERE ${context.data.proof.sql}),
        context_lease_authority AS MATERIALIZED(SELECT 1 WHERE ${guard})
        SELECT lease.* FROM experience_guest_claim_leases lease,context_lease_inventory,context_lease_authority WHERE ${retainedSql}`)
      .bind(...context.data.proof.bindings, ...bindings, ...retainedBindings).first<LeaseRow>()
    : await db.prepare(`SELECT * FROM experience_guest_claim_leases WHERE session_id=? AND destination_user_id=? AND manifest_digest=?
      AND request_id=? AND expires_at_ms>${GUEST_DB_NOW} AND (${guard})`)
      .bind(...retainedBindings, ...bindings).first<LeaseRow>();
  current();
  if (!retained) return guestFail("lease_unavailable");
  return Object.freeze({ version: 1 as const, status: "claiming" as const, leaseId: retained.lease_id, acquisition: retained.acquisitions,
    destinationUserId: destination, guestSubject: session.row.guest_subject, projectId: session.row.project_id, documentId: session.row.document_id,
    manifestDigest: retained.manifest_digest, expiresAtMs: retained.expires_at_ms, custodyTransferred: false as const });
}

/** Full-stage leases use a separate exact transition. The original context,
 * first-SAVE and abstract paths above retain their native behavior unchanged. */
export async function acquireGuestImageStageClaimLease(request: Request, env: WorkerEnv, input: GuestImageStageClaimLeaseRequest) {
  if (jsonIssues(input).length || !record(input) || Object.keys(input).sort().join() !== "inventory,proof,requestId"
    || !guestId(input.requestId) || !(request instanceof Request)) return guestFail("lease_invalid");
  const db = env.DB, url = request.url, method = request.method, headers = JSON.stringify(Array.from(request.headers)), signal = request.signal;
  const cohort = env.FORMA_PILOT_COHORT_ID, admins = env.FORMA_ADMIN_EMAILS, parsed = new URL(url), site = request.headers.get("sec-fetch-site");
  if (method !== "POST" || parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash
    || request.headers.get("origin") !== parsed.origin || site !== null && site !== "same-origin" && site !== "none"
    || new TextEncoder().encode(headers).byteLength > 32768) return guestFail("origin_required");
  if (/(?:^|;\s*)(?:forma_project_context|forma_impersonation)=/u.test(request.headers.get("cookie") ?? "")) return guestFail("personal_principal_required");
  const requestCurrent = () => {
    if (env.DB !== db) guestFail("database_changed");
    if (request.signal !== signal || signal.aborted) guestFail("lease_aborted");
    if (request.url !== url || request.method !== method || JSON.stringify(Array.from(request.headers)) !== headers
      || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== admins) guestFail("lease_authority_changed");
  };
  requestCurrent();
  const inventory = input.inventory, data = guestImageStageClaimInventoryData(env, inventory);
  const captured = { proof: structuredClone(input.proof), requestId: input.requestId, manifestDigest: inventory.manifestDigest };
  const current = () => { requestCurrent(); guestImageStageClaimInventoryData(env, inventory); };
  if (!record(captured.proof) || captured.proof.sessionId !== inventory.sessionId) return guestFail("lease_invalid");
  const session = await guestSession(env, request, captured.proof); current();
  if (inventory.sessionId !== session.row.session_id || inventory.guestSubject !== session.row.guest_subject
    || inventory.projectId !== session.row.project_id || inventory.documentId !== session.row.document_id
    || data.session.row.expires_at_ms !== session.row.expires_at_ms) return guestFail("lease_invalid");
  const auth = await readExistingPrincipalRequest(request, env, "creator", { account: "principal" }); current();
  if ("kind" in auth || auth.response || !auth.user || requireConsent(auth.user) || auth.user.fictional || auth.user.projectExecution
    || !auth.user.access.capabilities.includes("project.author") || auth.user.userId.startsWith("guest:")
    || inventory.destinationUserId !== auth.user.userId) return guestFail("destination_unavailable");
  const destination = auth.user.userId, native = projectIntakeAuthority(env, { user: auth.user, principal: auth.user, impersonation: null },
    { projectId: session.row.project_id, documentId: session.row.document_id });
  const authority = { sql: `(${session.guard.sql}) AND (${native.sql})`, bindings: [...session.guard.bindings, ...native.bindings] };
  type Proof = ReturnType<typeof guestImageStageClaimLeaseRowProof>;
  const sourceProof = guestImageStageClaimProof([data.proof, authority]);
  const columns = ["session_id", "lease_id", "destination_user_id", "manifest_digest", "request_id", "request_ids_json", "acquisitions", "created_at_ms", "expires_at_ms"];
  const object = `json_object(${columns.flatMap(key => [`'${key}'`, key]).join(",")})`;
  // Observe the native clock and the entire actual row together. An oversized
  // or malformed existing row is not silently treated as an absent lease.
  const read = async (proof: Proof) => {
    const row = await db.prepare(`SELECT ${GUEST_DB_NOW} AS now,
      (SELECT CASE WHEN typeof(request_ids_json)='text' AND length(CAST(request_ids_json AS BLOB))<=32768
        AND length(CAST(${object} AS BLOB))<=65536 THEN ${object} ELSE NULL END FROM experience_guest_claim_leases WHERE session_id=?) AS lease_json,
      EXISTS(SELECT 1 FROM experience_guest_claim_leases WHERE session_id=?) AS present WHERE ${proof.sql}`)
      .bind(inventory.sessionId, inventory.sessionId, ...proof.bindings).first<{ now: number; lease_json: string | null; present: number }>(); current();
    if (!row || !Number.isSafeInteger(row.now) || row.now < data.session.row.created_at_ms || row.present !== 0 && row.present !== 1
      || row.present === 1 && typeof row.lease_json !== "string" || row.present === 0 && row.lease_json !== null) return guestFail("lease_unavailable");
    let value: unknown = null;
    if (row.lease_json !== null) { try { value = JSON.parse(row.lease_json); } catch { return guestFail("lease_invalid"); } }
    const lease = value === null ? null : readGuestImageStageClaimLeaseRow(value, data.session, destination, captured.manifestDigest);
    if (lease && (lease.created_at_ms > row.now
      || lease.expires_at_ms > Math.min(row.now + session.policy.terms.leaseLifetimeMs, session.row.expires_at_ms))) return guestFail("lease_invalid");
    return { lease, now: row.now };
  };
  const observed = await read(sourceProof); current();
  const original = data.lease, sameRequest = original?.request_id === captured.requestId;
  const previousRequests: string[] = original ? JSON.parse(original.request_ids_json) : [];
  if (original && !sameRequest && (original.acquisitions >= session.policy.terms.maximumLeaseAcquisitions
    || previousRequests.includes(captured.requestId))) return guestFail("lease_unavailable");
  const expected = { session_id: inventory.sessionId, destination_user_id: destination, manifest_digest: captured.manifestDigest,
    request_id: captured.requestId, request_ids_json: sameRequest ? original!.request_ids_json : JSON.stringify([...previousRequests, captured.requestId]),
    acquisitions: sameRequest ? original!.acquisitions : (original?.acquisitions ?? 0) + 1 };
  const fixedColumns = Object.keys(expected), fixed = JSON.stringify(Object.values(expected));
  const lifetime = session.policy.terms.leaseLifetimeMs, sessionExpiry = session.row.expires_at_ms;
  const exact = (left: GuestImageStageClaimLeaseRow | null, right: GuestImageStageClaimLeaseRow | null) => JSON.stringify(left) === JSON.stringify(right);
  const nativeTransition = (minimumTime: number, leaseId: string | null): Proof => {
    const parts = [`json_array(${fixedColumns.join(",")})=?`, `expires_at_ms>${GUEST_DB_NOW}`, `created_at_ms<=${GUEST_DB_NOW}`];
    const bindings: (string | number | null)[] = [fixed];
    if (leaseId !== null) { parts.push("lease_id=?"); bindings.push(leaseId); }
    if (original) {
      parts.push("lease_id=?", "created_at_ms=?"); bindings.push(original.lease_id, original.created_at_ms);
      if (sameRequest) { parts.push("expires_at_ms=?"); bindings.push(original.expires_at_ms); }
      else {
        parts.push(`expires_at_ms>=MIN(?+?,?)`, `expires_at_ms<=MIN(${GUEST_DB_NOW}+?,?)`);
        bindings.push(minimumTime, lifetime, sessionExpiry, lifetime, sessionExpiry);
      }
    } else {
      parts.push("created_at_ms>=?", "expires_at_ms=MIN(created_at_ms+?,?)");
      bindings.push(minimumTime, lifetime, sessionExpiry);
    }
    return { sql: `EXISTS(SELECT 1 FROM experience_guest_claim_leases WHERE ${parts.join(" AND ")})`, bindings };
  };
  let transition: Proof;
  if (observed.lease && !exact(observed.lease, original)) {
    // Original inventory objects can replay their own completed transition.
    // This is a fresh read of one exact same-intent native successor, never a
    // renewal or authority inferred from a stale absence snapshot.
    transition = nativeTransition(original ? Math.max(original.expires_at_ms, data.leaseObservedAtMs) : data.leaseObservedAtMs, null);
  } else if (original && sameRequest) {
    transition = nativeTransition(original.created_at_ms, original.lease_id);
  } else {
    if (!exact(observed.lease, original) || original && original.expires_at_ms > observed.now) return guestFail("lease_unavailable");
    const leaseId = original?.lease_id ?? crypto.randomUUID();
    transition = nativeTransition(observed.now, original?.lease_id ?? null);
    const mutation = original
      ? db.prepare(`UPDATE experience_guest_claim_leases SET request_id=?,request_ids_json=?,acquisitions=?,
          expires_at_ms=MIN(${GUEST_DB_NOW}+?,?) WHERE session_id=? AND (${data.leaseBeforeProof.sql})
          AND expires_at_ms<=${GUEST_DB_NOW} AND (${authority.sql})`)
        .bind(expected.request_id, expected.request_ids_json, expected.acquisitions, lifetime, sessionExpiry, inventory.sessionId,
          ...data.leaseBeforeProof.bindings, ...authority.bindings)
      : db.prepare(`INSERT INTO experience_guest_claim_leases(${columns.join(",")})
          SELECT ?,?,?,?,?,?,1,${GUEST_DB_NOW},MIN(${GUEST_DB_NOW}+?,?) WHERE (${data.leaseBeforeProof.sql}) AND (${authority.sql})`)
        .bind(inventory.sessionId, leaseId, destination, captured.manifestDigest, captured.requestId, expected.request_ids_json,
          lifetime, sessionExpiry, ...data.leaseBeforeProof.bindings, ...authority.bindings);
    const after = nativeTransition(observed.now, leaseId);
    const statements = [...outputAssertionStatements(env, data.beforeProof), ...outputAssertionStatements(env, authority), mutation,
      ...outputAssertionStatements(env, data.proof), ...outputAssertionStatements(env, authority), ...outputAssertionStatements(env, after)];
    current();
    try { await db.batch(statements); }
    catch { /* A lost or malformed ACK allows only the exact successor read below. */ }
    current();
  }
  const retained = await read(guestImageStageClaimProof([sourceProof, transition])); current();
  if (!retained.lease) return guestFail("lease_unavailable");
  const proof = guestImageStageClaimProof([sourceProof, transition, guestImageStageClaimLeaseRowProof(retained.lease)]);
  // After parsing, pin all nine actual row fields in one final current source +
  // canonical authority read. No return follows a mutation retry or stale DTO.
  const final = await db.prepare(`SELECT 1 AS current WHERE ${proof.sql}`).bind(...proof.bindings).first<{ current: number }>(); current();
  if (final?.current !== 1) return guestFail("lease_unavailable");
  return Object.freeze({ version: 1 as const, status: "claiming" as const, leaseId: retained.lease.lease_id, acquisition: retained.lease.acquisitions,
    destinationUserId: destination, guestSubject: session.row.guest_subject, projectId: session.row.project_id, documentId: session.row.document_id,
    manifestDigest: retained.lease.manifest_digest, expiresAtMs: retained.lease.expires_at_ms, custodyTransferred: false as const });
}
