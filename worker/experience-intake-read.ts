import { isExperienceContextOutput, experienceDraftId, isDraftId, type ExperiencePlan } from "../src/experiences/intake.ts";
import { digest } from "../src/experiences/compiler.ts";
import { requireConsent } from "./principal-request-core.ts";
import { readProjectRequestContext } from "./project-request-context.ts";
import { projectIntakeAuthority, type ProjectIntakeAuthorization } from "./intake-authority.ts";
import type { requireUser, BudgetReservationGuard } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
const denied = (error = "experience_unavailable", status = 409) => reply({ error }, status);
// Only explicitly registered verified-user context-authoring outputs are accepted.
// Neither this allowlist nor Document receipt completion grants generation.
const activeOutput = (plan: ExperiencePlan) => isExperienceContextOutput(plan.release.output.output);
const join = (a: BudgetReservationGuard, b: BudgetReservationGuard): BudgetReservationGuard => ({ sql: `(${a.sql}) AND (${b.sql})`, bindings: [...a.bindings, ...b.bindings] });

export async function continueExperienceAuthorization(
  request: Request,
  env: WorkerEnv,
  auth: Awaited<ReturnType<typeof requireUser>>,
): Promise<ProjectIntakeAuthorization | Response> {
  if (auth.response || !auth.user) return auth.response ?? denied("authentication_required", 401);
  const consent = requireConsent(auth.user); if (consent) return consent;
  const selected = await readProjectRequestContext(request, env, auth.user);
  if (selected.response) return selected.response;
  if (selected.context || auth.user.projectExecution || auth.user.fictional || !auth.user.access.capabilities.includes("project.author")) return denied("personal_author_required", 403);
  return { user: auth.user, principal: auth.user, impersonation: null };
}

function retainedGuard(auth: ProjectIntakeAuthorization, plan: ExperiencePlan, content: string): BudgetReservationGuard {
  return { sql: `EXISTS(SELECT 1 FROM private_content draft WHERE draft.content_id=? AND draft.owner_id=? AND draft.kind='experience-draft'
    AND draft.content=? AND draft.redacted_at IS NULL AND draft.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=draft.content_id)
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=draft.content_id))
    AND NOT EXISTS(SELECT 1 FROM organization_projects project WHERE project.project_id=?)
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='document' AND resource.resource_id=?)
    AND NOT EXISTS(SELECT 1 FROM events removed WHERE removed.stream_id=? AND removed.type IN('DocumentRemoved','ProjectRemoved')
      AND (removed.type='DocumentRemoved' AND json_extract(removed.payload,'$.document_id')=? OR removed.type='ProjectRemoved' AND json_extract(removed.payload,'$.project_id')=?))`,
  bindings: [plan.draftId, auth.user.userId, content, plan.projectId, plan.documentId, auth.user.streamId, plan.documentId, plan.projectId] };
}
async function readDraft(env: WorkerEnv, auth: ProjectIntakeAuthorization, id: string, additionalGuard?: BudgetReservationGuard) {
  const database = env.DB;
  const additional = additionalGuard ? { sql: additionalGuard.sql, bindings: [...additionalGuard.bindings] } : undefined;
  const base = projectIntakeAuthority(env, auth, { projectId: "", documentId: "" });
  const row = await (additional ? database : env.DB).prepare(`SELECT content,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind='experience-draft'
    AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (${base.sql})${additional ? ` AND (${additional.sql})` : ""}`)
    .bind(id, auth.user.userId, ...base.bindings, ...(additional?.bindings ?? [])).first<{ content: string; expires_at: string }>();
  if (!row || additional && env.DB !== database) return null;
  let plan: ExperiencePlan;
  try {
    plan = JSON.parse(row.content) as ExperiencePlan;
    const { draftHash, ...basePlan } = plan;
    if (!activeOutput(plan) || plan.version !== 1 || plan.draftId !== id || plan.streamId !== auth.user.streamId || !isDraftId(id) || await experienceDraftId(auth.user.userId, plan.request.intentId) !== id || await digest(basePlan) !== draftHash) return null;
  } catch { return null; }
  if (additional && env.DB !== database) return null;
  const native = join(projectIntakeAuthority(env, auth, plan), retainedGuard(auth, plan, row.content));
  const guard = additional ? join(native, additional) : native;
  // Last await: private bytes, custody, retention and current authority in one snapshot.
  if (!await (additional ? database : env.DB).prepare(`SELECT 1 AS current WHERE ${guard.sql}`).bind(...guard.bindings).first()
    || additional && env.DB !== database) return null;
  return { plan, content: row.content, expiresAt: row.expires_at };
}

export { reply, denied, join, retainedGuard, readDraft };
