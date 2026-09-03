import { buildExperiencePlan, experienceDocumentRoute, experienceDraftId, experienceIds, isDraftId, isIntentId, receiptPrefix, registeredExperience, validateIntakeRequest, type ExperiencePlan } from "../src/experiences/intake.ts";
import { canonicalJson, digest } from "../src/experiences/compiler.ts";
import { requireConsent, requireUser, storePrivateContent, type BudgetReservationGuard } from "./pilot-policy.ts";
import { readProjectRequestContext } from "./project-access.ts";
import { commitAtomicIntake, projectIntakeAuthority, type ProjectIntakeAuthorization } from "./project-intake.ts";
import type { WorkerEnv } from "./runtime.ts";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
const denied = (error = "experience_unavailable", status = 409) => reply({ error }, status);
const join = (a: BudgetReservationGuard, b: BudgetReservationGuard): BudgetReservationGuard => ({ sql: `(${a.sql}) AND (${b.sql})`, bindings: [...a.bindings, ...b.bindings] });
async function boundedBody(request: Request) {
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get("content-type") ?? "")) throw new Error("content_type");
  if (Number(request.headers.get("content-length") ?? 0) > 32768) throw new Error("body_limit");
  const reader = request.body?.getReader(); if (!reader) throw new Error("body_required");
  const chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const item = await reader.read(); if (item.done) break; length += item.value.byteLength; if (length > 32768) { await reader.cancel(); throw new Error("body_limit"); } chunks.push(item.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}
async function authorize(request: Request, env: WorkerEnv): Promise<ProjectIntakeAuthorization | Response> {
  // Principal mode explicitly refuses impersonation; never silently rebind a persona's work.
  const auth = await requireUser(request, env, "creator", { account: "principal" });
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
    AND NOT EXISTS(SELECT 1 FROM events removed WHERE removed.stream_id=? AND removed.type IN('DocumentRemoved','ProjectRemoved')
      AND (removed.type='DocumentRemoved' AND json_extract(removed.payload,'$.document_id')=? OR removed.type='ProjectRemoved' AND json_extract(removed.payload,'$.project_id')=?))`,
  bindings: [plan.draftId, auth.user.userId, content, auth.user.streamId, plan.documentId, plan.projectId] };
}
async function readDraft(env: WorkerEnv, auth: ProjectIntakeAuthorization, id: string) {
  const base = projectIntakeAuthority(env, auth, { projectId: "", documentId: "" });
  const row = await env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind='experience-draft'
    AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (${base.sql})`)
    .bind(id, auth.user.userId, ...base.bindings).first<{ content: string; expires_at: string }>();
  if (!row) return null;
  let plan: ExperiencePlan;
  try {
    plan = JSON.parse(row.content) as ExperiencePlan;
    const { draftHash, ...basePlan } = plan;
    if (plan.version !== 1 || plan.draftId !== id || plan.streamId !== auth.user.streamId || !isDraftId(id) || await experienceDraftId(auth.user.userId, plan.request.intentId) !== id || await digest(basePlan) !== draftHash) return null;
  } catch { return null; }
  const guard = join(projectIntakeAuthority(env, auth, plan), retainedGuard(auth, plan, row.content));
  // Last await: private bytes, custody, retention and current authority in one snapshot.
  if (!await env.DB.prepare(`SELECT 1 AS current WHERE ${guard.sql}`).bind(...guard.bindings).first()) return null;
  return { plan, content: row.content, expiresAt: row.expires_at };
}

/** Authenticated context creation only. No provider, job, sponsor or guest authority. */
export async function handleExperienceIntake(request: Request, env: WorkerEnv) {
  const url = new URL(request.url), path = url.pathname;
  if (path === "/api/experiences/catalog" && request.method === "GET") {
    return reply({ version: 1, generation: "unavailable", experiences: await Promise.all(experienceIds.map(registeredExperience)) });
  }
  const match = path.match(/^\/api\/experiences\/drafts(?:\/(experience-draft-[a-f0-9]{64})(?:\/(commit|receipt))?)?$/u);
  if (!match) return denied("not_found", 404);
  let id = match[1]; const action = match[2];
  const lookup = !id && request.method === "GET" && url.searchParams.size === 1 && isIntentId(url.searchParams.get("intentId"));
  if (!lookup && ((!id || action === "commit") ? request.method !== "POST" : request.method !== "GET")) return denied("method_not_allowed", 405);
  if (request.method === "POST") {
    const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
    if (origin && origin !== url.origin || site === "cross-site") return denied("same_origin_required", 403);
  }
  const auth = await authorize(request, env); if (auth instanceof Response) return auth;
  if (lookup) id = await experienceDraftId(auth.user.userId, url.searchParams.get("intentId")!);
  if (!id) {
    let value: unknown; try { value = await boundedBody(request); } catch { return denied("request_invalid", 400); }
    const validated = await validateIntakeRequest(value); if (!validated) return denied("experience_request_invalid", 400);
    const plan = await buildExperiencePlan(auth.user.userId, validated.request, validated.release), content = canonicalJson(plan);
    const authority = projectIntakeAuthority(env, auth, plan);
    const storageLimit: BudgetReservationGuard = { sql: `(SELECT COUNT(*) FROM private_content WHERE owner_id=? AND kind='experience-draft' AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))<50`, bindings: [auth.user.userId] };
    try { await storePrivateContent(env, auth.user.userId, "experience-draft", content, undefined, join(authority, storageLimit), undefined, { contentId: plan.draftId }); }
    catch { /* Resolve duplicate, lost acknowledgment or denied write from the retained original only. */ }
    const saved = await readDraft(env, auth, plan.draftId);
    if (!saved) return denied("experience_save_unconfirmed");
    if (saved.content !== content) return denied("experience_intent_conflict");
    return reply({ status: "prepared", plan: saved.plan, expiresAt: saved.expiresAt });
  }
  let approvedHash: string | undefined;
  if (action === "commit") {
    let body: unknown; try { body = await boundedBody(request); } catch { return denied("request_invalid", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("draftHash" in body) || typeof body.draftHash !== "string") return denied("request_invalid", 400);
    approvedHash = body.draftHash;
  }
  const retained = await readDraft(env, auth, id); if (!retained) return denied("experience_draft_unavailable", 404);
  if (!action) return reply({ status: "prepared", plan: retained.plan, expiresAt: retained.expiresAt });
  const plan = retained.plan;
  if (action === "commit" && approvedHash !== plan.draftHash) return denied("experience_review_stale");
  // Changed registrations block new intake, but never replace or reinterpret the old receipt.
  if (action === "commit" && (await registeredExperience(plan.request.experienceId))?.releaseHash !== plan.release.releaseHash) return denied("experience_release_changed");
  const response = await commitAtomicIntake(env, auth, { projectId: plan.projectId, documentId: plan.documentId, events: structuredClone(plan.events) as ExperiencePlan["events"][number][] }, action === "commit" ? "commit" : "check", {
    receiptPrefix: receiptPrefix(id), clientId: "web:experience-intake", correlationPrefix: "experience-intake:", guard: retainedGuard(auth, plan, retained.content),
  });
  const result = await response.json() as Record<string, unknown>;
  return reply({ ...result, draftId: id, draftHash: plan.draftHash, generation: "unavailable", ...(result.status === "complete" ? { documentRoute: experienceDocumentRoute(plan) } : {}) }, response.status);
}
