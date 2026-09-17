import { jsonIssues, record } from "../src/experiences/compiler.ts";
import { readExistingPrincipalRequest, requireConsent } from "./principal-request-core.ts";
import { projectIntakeAuthority } from "./intake-authority.ts";
import { GUEST_DB_NOW, guestFail, guestHash, guestId, guestSession, type GuestClaimProof } from "./experience-guest-session.ts";
import type { WorkerEnv } from "./runtime.ts";

export type GuestClaimLeaseRequest = Readonly<{ proof: GuestClaimProof; requestId: string; manifestDigest: string }>;
type LeaseRow = { session_id: string; lease_id: string; destination_user_id: string; manifest_digest: string; request_id: string;
  acquisitions: number; created_at_ms: number; expires_at_ms: number };

/** Internal dormant lease only. manifestDigest is an untrusted immutable intent
 * commitment, not proof of source completeness or asset custody. There is no
 * completion operation until a native atomic custody witness is implemented. */
export async function acquireGuestClaimLease(request: Request, env: WorkerEnv, input: GuestClaimLeaseRequest) {
  if (jsonIssues(input).length || !record(input) || Object.keys(input).sort().join() !== "manifestDigest,proof,requestId"
    || !guestId(input.requestId) || !guestHash(input.manifestDigest)) return guestFail("lease_invalid");
  const captured = structuredClone(input), db = env.DB;
  // Refuse even stale context/impersonation cookies: adoption must be explicit
  // personal canonical custody, not an effective or selected workspace account.
  if (/(?:^|;\s*)(?:forma_project_context|forma_impersonation)=/u.test(request.headers.get("cookie") ?? "")) return guestFail("personal_principal_required");
  const session = await guestSession(env, request, captured.proof);
  const auth = await readExistingPrincipalRequest(request, env, "creator", { account: "principal" });
  if ("kind" in auth || auth.response || !auth.user || requireConsent(auth.user) || auth.user.fictional || auth.user.projectExecution
    || !auth.user.access.capabilities.includes("project.author") || auth.user.userId.startsWith("guest:")) return guestFail("destination_unavailable");
  const destination = auth.user.userId, native = projectIntakeAuthority(env, { user: auth.user, principal: auth.user, impersonation: null },
    { projectId: session.row.project_id, documentId: session.row.document_id });
  if (env.DB !== db) return guestFail("database_changed");
  const guard = `(${session.guard.sql}) AND (${native.sql})`, bindings = [...session.guard.bindings, ...native.bindings];
  const active = await db.prepare(`SELECT * FROM experience_guest_claim_leases WHERE session_id=? AND (${guard})`)
    .bind(session.row.session_id, ...bindings).first<LeaseRow>();
  if (active && (active.destination_user_id !== destination || active.manifest_digest !== captured.manifestDigest)) return guestFail("lease_conflict");
  const leaseId = active?.lease_id ?? crypto.randomUUID();
  if (active) {
    // Exact replay never refreshes a lease or consumes another acquisition.
    if (active.request_id !== captured.requestId) {
      await db.prepare(`UPDATE experience_guest_claim_leases SET request_id=?,request_ids_json=json_insert(request_ids_json,'$[#]',?),acquisitions=acquisitions+1,
        expires_at_ms=MIN(${GUEST_DB_NOW}+?,?) WHERE session_id=? AND destination_user_id=? AND manifest_digest=?
        AND request_id=? AND acquisitions=? AND acquisitions<? AND NOT EXISTS(SELECT 1 FROM json_each(request_ids_json) WHERE value=?) AND expires_at_ms<=${GUEST_DB_NOW} AND (${guard})`)
        .bind(captured.requestId, captured.requestId, session.policy.terms.leaseLifetimeMs, session.row.expires_at_ms, session.row.session_id, destination,
          captured.manifestDigest, active.request_id, active.acquisitions, session.policy.terms.maximumLeaseAcquisitions, captured.requestId, ...bindings).run();
    }
  } else {
    // A concurrent insert wins once. This intentional conflict handling cannot
    // turn a competitor or a changed manifest into a successful replay.
    await db.prepare(`INSERT INTO experience_guest_claim_leases(session_id,lease_id,destination_user_id,manifest_digest,request_id,request_ids_json,acquisitions,created_at_ms,expires_at_ms)
      SELECT ?,?,?,?,?,json_array(?),1,${GUEST_DB_NOW},MIN(${GUEST_DB_NOW}+?,?) WHERE NOT EXISTS(SELECT 1 FROM experience_guest_claim_leases WHERE session_id=?) AND (${guard})`)
      .bind(session.row.session_id, leaseId, destination, captured.manifestDigest, captured.requestId, captured.requestId,
        session.policy.terms.leaseLifetimeMs, session.row.expires_at_ms, session.row.session_id, ...bindings).run();
  }
  // Last snapshot is the sole return authority. Lost acknowledgements can retry
  // the same identity; revoked principal/session/policy cannot read a lease.
  if (env.DB !== db) return guestFail("database_changed");
  const retained = await db.prepare(`SELECT * FROM experience_guest_claim_leases WHERE session_id=? AND destination_user_id=? AND manifest_digest=?
    AND request_id=? AND expires_at_ms>${GUEST_DB_NOW} AND (${guard})`)
    .bind(session.row.session_id, destination, captured.manifestDigest, captured.requestId, ...bindings).first<LeaseRow>();
  if (!retained) return guestFail("lease_unavailable");
  return Object.freeze({ version: 1 as const, status: "claiming" as const, leaseId: retained.lease_id, acquisition: retained.acquisitions,
    destinationUserId: destination, guestSubject: session.row.guest_subject, projectId: session.row.project_id, documentId: session.row.document_id,
    manifestDigest: retained.manifest_digest, expiresAtMs: retained.expires_at_ms, custodyTransferred: false as const });
}
