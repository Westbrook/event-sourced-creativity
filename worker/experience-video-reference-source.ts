import { canonicalJson } from "../src/experiences/compiler.ts";
import { readVideoReferenceIntent } from "../src/experiences/video-reference.ts";
import { readVideoReferencePlan, type VideoReferencePlan } from "../src/experiences/video-reference-plan.ts";
import { creativeContextRightsValidity } from "../src/model/context-health.ts";
import { inspectVideoReferenceCustody } from "./video-reference-custody.ts";
import { continueOutputTrustedContext } from "./output-trusted-context.ts";
import { projectIntakeAuthority, type ProjectIntakeAuthorization } from "./intake-authority.ts";
import { outputActiveSourceDeadlineAssertions } from "./output-disclosure-proof.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

function fail(code: string, status = 409): never { throw Object.assign(new Error(code), { code, status }); }
export type PreparedVideoReferenceSource = Readonly<{ reference: VideoReferencePlan; head: number; guard: BudgetReservationGuard }>;

/** Always a fresh server read. Neither a prior inspection response nor its
 * sourceDigest can authorize a save. Shared intake owns atomic persistence. */
export async function prepareExperienceVideoReference(request: Request, env: WorkerEnv,
  auth: ProjectIntakeAuthorization, value: unknown): Promise<PreparedVideoReferenceSource> {
  const selection = readVideoReferenceIntent(value);
  if (!selection) fail("video_reference_selection_invalid", 400);
  // Reuse the already authenticated principal. Background native jobs carry
  // this principal, not a fabricated HTTP credential. The continuation still
  // checks current consent, scope/capabilities and complete disclosure custody.
  if (auth.user !== auth.principal || auth.impersonation) fail("video_reference_scope_unavailable", 403);
  const trusted = await continueOutputTrustedContext(request, env, selection.sourceDocumentId, "read", auth);
  if (trusted instanceof Response) fail("video_reference_source_unavailable", trusted.status);
  const inspection = await inspectVideoReferenceCustody(trusted, auth, selection);
  const block = trusted.projection.libraryBlocks.find(candidate => candidate.id === selection.sourceBlockId);
  const reference = readVideoReferencePlan({ version: 1, selection, sourceDigest: inspection.sourceDigest,
    properties: block?.properties }, selection);
  if (!reference || !trusted.context) fail("video_reference_copy_unavailable");
  const latestRights = [...trusted.events].sort((a, b) => a.sequence - b.sequence).findLast(event =>
    ["RightsAsserted", "ReferenceIngested"].includes(event.type) && event.payload.reference_id === selection.referenceId);
  if (!latestRights) fail("video_reference_rights_required", 403);
  const validity = creativeContextRightsValidity(latestRights.payload);
  if (validity.issue) fail("video_reference_rights_required", 403);
  const assertions = [projectIntakeAuthority(env, auth, { projectId: selection.sourceProjectId, documentId: selection.sourceDocumentId }),
    ...trusted.sourceAssertions, ...outputActiveSourceDeadlineAssertions(trusted.context),
    // A latest rights-event deadline may not be materialized on the block. Keep
    // that boundary in the atomic save guard as well as checking it during reads.
    ...(validity.validUntil ? [{ sql: "? > strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [validity.validUntil] }] : [])];
  const guard = { sql: assertions.map(item => `(${item.sql})`).join(" AND "), bindings: assertions.flatMap(item => [...item.bindings ?? []]) };
  request.signal.throwIfAborted();
  return Object.freeze({ reference, head: trusted.ownerHead, guard });
}

/** Same shared source-plan and expected-head protocol as reference intake.
 * The eventual caller must apply this guard inside the existing atomic receipt
 * transaction, not merely run a separate SELECT before the write. */
export function videoReferenceCommitGuard(env: WorkerEnv, auth: ProjectIntakeAuthorization,
  plan: { projectId: string; documentId: string; reference?: unknown },
  source: PreparedVideoReferenceSource, retained: BudgetReservationGuard) {
  if (!readVideoReferencePlan(plan.reference, source.reference.selection)
    || canonicalJson(source.reference) !== canonicalJson(plan.reference)
    || !Number.isSafeInteger(source.head) || source.head < 0) fail("video_reference_source_changed");
  const guard = { sql: `(${retained.sql}) AND (${source.guard.sql})`, bindings: [...retained.bindings, ...source.guard.bindings] };
  const destination = projectIntakeAuthority(env, auth, plan);
  // Shared root receipt needs18 additional bindings; no proof truncation or
  // multi-transaction fallback when the existing D1 limits are exceeded.
  if (guard.bindings.length + destination.bindings.length + 18 > 100
    || new TextEncoder().encode(guard.sql).byteLength > 80_000
    || guard.bindings.some(value => typeof value === "string" && new TextEncoder().encode(value).byteLength > 2_000_000))
    fail("video_reference_commit_proof_too_large", 413);
  return { guard, expectedHead: source.head };
}
