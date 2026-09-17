import { identifySponsorImageRead, resolveSponsorImageRead } from './experience-sponsor-read-image.ts';
import { reserveSponsorImageReadAttempt, SponsorReadLimitError } from './experience-sponsor-read-attempts.ts';
import { SponsorEntitlementError } from './experience-sponsor-policy.ts';
import { SponsorNativeImageReadBudget, sponsorImageResponseBody } from './experience-sponsor-native-image-budget.ts';
import type { PilotUser } from './pilot-policy.ts';
import type { WorkerEnv } from './runtime.ts';

type Actor = Pick<PilotUser, 'userId' | 'streamId' | 'projectExecution'>;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value);
const headers = { 'cache-control': 'private, no-store', 'content-type': 'application/json', 'x-content-type-options': 'nosniff' };

/** Classification returns no creative data and never treats a different payer
 * in an organization/project as campaign sponsorship. Retained consumption is
 * also checked independently, so a damaged slot cannot erase known lineage.
 * Missing dormant read-policy/attempt tables affect only a classified job. */
export async function sponsorJobReadPredicate(env: WorkerEnv, actor: Actor, alias: 'document_jobs' = 'document_jobs') {
  const tables = await env.DB.prepare(`SELECT name FROM sqlite_schema WHERE type='table'
    AND name IN('output_operation_slots','output_execution_grants','output_plan_revisions','experience_sponsor_consumptions') LIMIT 4`).all<{ name: string }>();
  if (!tables.success) throw new SponsorEntitlementError('sponsor_job_read_configuration');
  const names = new Set(tables.results.map(row => row.name));
  const consumed = names.has('experience_sponsor_consumptions') ? `EXISTS(SELECT 1 FROM experience_sponsor_consumptions used
    WHERE used.job_id=${alias}.job_id AND used.actor_user_id=${alias}.owner_id)` : '0';
  const marker = ['output_operation_slots', 'output_execution_grants', 'output_plan_revisions'].every(name => names.has(name))
    ? `EXISTS(SELECT 1 FROM output_operation_slots slot
      JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
      JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
      JOIN event_private_payloads body ON body.private_event_id=grant_row.authorization_event_id
      WHERE slot.job_id=${alias}.job_id AND plan.scope_kind='personal' AND plan.owner_user_id=${alias}.owner_id
        AND plan.document_id=${alias}.document_id AND plan.organization_id IS NULL AND plan.project_access_id IS NULL
        AND body.owner_id=plan.owner_user_id AND body.project_id=plan.project_id AND body.document_id=plan.document_id
        AND CASE WHEN typeof(body.private_json)='text' AND length(CAST(body.private_json AS BLOB))<=131072
          THEN CASE WHEN json_valid(body.private_json) THEN json_type(body.private_json,'$.output_command_envelope.sponsor_entitlement') END END IS NOT NULL)`
    : '0';
  // Server-owned aliases only. There are no client SQL fragments or payer hints.
  return `(${alias}.owner_id=${sqlText(actor.userId)} AND ${alias}.stream_id=${sqlText(actor.streamId)} AND (${consumed} OR ${marker}))`;
}
function sqlText(value: string) { return `'${value.replaceAll("'", "''")}'`; }

export function sponsorJobReadFailure(error: unknown): Response | null {
  if (!(error instanceof SponsorEntitlementError)) return null;
  const rate = error instanceof SponsorReadLimitError;
  return Response.json({ error: error.code }, { status: rate ? 429 : 403, headers: { ...headers,
    ...(rate ? { 'retry-after': String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))) } : {}) } });
}

/** An explicitly selected one-job status read, never a recovery or Run. Generic
 * lists intentionally omit these jobs; they cannot silently debit campaigns.
 * The wire response discloses only facts certified by the native read resolver.
 * Detailed provider inputs/diagnostics are outside this status operation. */
export async function readSponsorJobStatus(request: Request, env: WorkerEnv, actor: Actor, jobId: string,
  options: { selected: boolean; documentId?: string } = { selected: false }): Promise<Response | null> {
  if (request.method !== 'GET' || actor.projectExecution || !id(jobId))
    return options.selected ? Response.json({ error: 'sponsor_job_selection_invalid' }, { status: 400, headers }) : null;
  try {
    const control = new SponsorNativeImageReadBudget(0, performance.now() + 30_000, request.signal);
    const predicate = await control.wait(sponsorJobReadPredicate(env, actor));
    const classified = await control.wait(env.DB.prepare(`SELECT 1 AS present FROM document_jobs
      WHERE job_id=? AND owner_id=? AND stream_id=? AND ${predicate} LIMIT 1`).bind(jobId, actor.userId, actor.streamId).first());
    if (!classified) return options.selected ? Response.json({ error: 'sponsor_job_not_found' }, { status: 404, headers }) : null;
    const authority = await control.wait(identifySponsorImageRead(request, env, { jobId }));
    const attempt = await control.wait(reserveSponsorImageReadAttempt(authority, request, env, 'image-status'));
    const current = await control.wait(resolveSponsorImageRead(authority, attempt, request, env));
    if (options.documentId && current.documentId !== options.documentId)
      throw new SponsorEntitlementError('sponsor_job_document_changed');
    const budget = new SponsorNativeImageReadBudget(current.remainingBytes, Math.min(current.monotonicDeadline, control.monotonicDeadline), request.signal);
    const job = { jobId: current.jobId, documentId: current.documentId, kind: 'generate', sourceSurface: 'outputs',
      status: current.status, updatedAt: current.updatedAt, stage: current.status, result: null,
      sponsoredRead: { version: 1, operation: 'image-status', passive: true } };
    const bytes = new TextEncoder().encode(JSON.stringify(options.selected ? { jobs: [job] } : { job }));
    return new Response(sponsorImageResponseBody(bytes, budget), { headers });
  } catch (error) {
    const response = sponsorJobReadFailure(error); if (response) return response;
    // A classified resource never falls through to ordinary unmetered access
    // when its dormant policy tables have not been provisioned.
    if (/no such table: experience_sponsor_(?:read_policies|read_attempts)/u.test(String(error)))
      return Response.json({ error: 'sponsor_read_policy_unavailable' }, { status: 403, headers });
    throw error;
  }
}
