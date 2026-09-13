import type { OutputExecutionBridge } from "./output-requirements-api.ts";

type Dispatch = Parameters<OutputExecutionBridge["dispatch"]>[0];
type RunExistingJob = (env: Dispatch["env"], principal: Dispatch["principal"], jobId: string) => Promise<unknown>;

/** Experience Run already committed its immutable command and queued one slot.
 * The general Output UI uses a recent-job driver; this surface must wake only
 * its original job. The native runner rechecks live authority, source, leases,
 * cancellation and provider receipts. This adapter grants none of those rights.
 * Await foreground execution: no queue sweep or short-lived background tail.
 * A lost response is uncertain, never permission for an automatic retry.
 */
export function withExperienceOutputDispatch(base: OutputExecutionBridge, run: RunExistingJob): OutputExecutionBridge {
  return {
    ...base,
    async dispatch({ request, env, principal, scope, slots }) {
      const url = new URL(request.url), slot = slots[0];
      if (request.method !== "POST" || url.search || !/^\/api\/experiences\/drafts\/experience-draft-[a-f0-9]{64}\/output\/run$/u.test(url.pathname)
        || scope.kind !== "personal" || scope.actorUserId !== scope.ownerUserId || principal.userId !== scope.actorUserId
        || principal.streamId !== `creative:${scope.ownerUserId}` || principal.projectExecution || principal.fictional
        || scope.organizationId !== null || scope.projectAccessId !== null || scope.contextId !== null
        || slots.length !== 1 || !slot || slot.scopeKey !== scope.key || !["queued", "running"].includes(slot.status)
        || slot.attemptOrdinal !== 0 || slot.previousSlotId !== null
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(slot.jobId)) {
        throw Object.assign(new Error("experience_output_dispatch_unavailable"), { status: 409 });
      }
      // Duplicate explicit Run requests retain this exact job. Native atomic
      // claims, not an in-memory lock, arbitrate across requests and isolates.
      await run(env, principal, slot.jobId);
    },
  };
}
