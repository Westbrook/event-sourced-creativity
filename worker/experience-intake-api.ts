import { prepareExperienceVideoReference, videoReferenceCommitGuard } from "./experience-video-reference-source.ts";
import { readModel3dReferenceIntent } from "../src/experiences/model3d-reference.ts";
import { handleExperienceModel3dReference } from "./experience-model3d-reference.ts";
import { prepareExperienceModel3dReference, model3dReferenceCommitGuard } from "./experience-model3d-reference-source.ts";
import { listExperienceModel3dReferences } from "./experience-model3d-reference-list.ts";
import { isExperienceContextOutput, buildExperiencePlan, experienceDocumentRoute, experienceDraftId, experienceIds, isIntentId, receiptPrefix, registeredExperience, validateIntakeRequest, type ExperiencePlan } from "../src/experiences/intake.ts";
import { canonicalJson } from "../src/experiences/compiler.ts";
import { requireUser, storePrivateContent, type BudgetReservationGuard } from "./pilot-policy.ts";
import { commitAtomicIntake, projectIntakeAuthority, type ProjectIntakeAuthorization } from "./project-intake.ts";
import { continueExperienceAuthorization, reply, denied, join, retainedGuard, readDraft } from "./experience-intake-read.ts";
import type { WorkerEnv } from "./runtime.ts";

async function boundedBody(request: Request) {
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get("content-type") ?? "")) throw new Error("content_type");
  if (Number(request.headers.get("content-length") ?? 0) > 32768) throw new Error("body_limit");
  const reader = request.body?.getReader(); if (!reader) throw new Error("body_required");
  const chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const item = await reader.read(); if (item.done) break; length += item.value.byteLength; if (length > 32768) { void reader.cancel().catch(() => undefined); throw new Error("body_limit"); } chunks.push(item.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}
async function authorize(request: Request, env: WorkerEnv): Promise<ProjectIntakeAuthorization | Response> {
  // Principal mode explicitly refuses impersonation; never silently rebind a persona's work.
  const auth = await requireUser(request, env, "creator", { account: "principal" });
  return continueExperienceAuthorization(request, env, auth);
}

/** Authenticated context creation only. No provider, job, sponsor or guest authority. */
export async function handleExperienceIntake(request: Request, env: WorkerEnv) {
  const url = new URL(request.url), path = url.pathname;
  if (path === "/api/experiences/model3d/reference/inspect") return handleExperienceModel3dReference(request, env);
  if (path === "/api/experiences/video/references") return listExperienceModel3dReferences(request, env, "video");
  if (path === "/api/experiences/model3d/references") return listExperienceModel3dReferences(request, env);
  if (path === "/api/experiences/catalog" && request.method === "GET") {
    const releases = await Promise.all(experienceIds.map(registeredExperience));
    return reply({ version: 1, generation: "unavailable", experiences: releases.filter(release => release && isExperienceContextOutput(release.output.output)) });
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
    if (!isExperienceContextOutput(validated.release.output.output)) return denied("experience_request_invalid", 400);
    let source;
    try { if (validated.request.reference) source = validated.release.output.output === "video"
      ? await prepareExperienceVideoReference(request, env, auth, validated.request.reference)
      : await prepareExperienceModel3dReference(request, env, auth, readModel3dReferenceIntent(validated.request.reference)!); }
    catch { return denied(`${validated.release.output.output}_reference_source_unavailable`); }
    const plan = await buildExperiencePlan(auth.user.userId, validated.request, validated.release, source?.reference), content = canonicalJson(plan);
    const authority = projectIntakeAuthority(env, auth, plan);
    const storageLimit: BudgetReservationGuard = { sql: `(SELECT COUNT(*) FROM private_content WHERE owner_id=? AND kind='experience-draft' AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))<50`, bindings: [auth.user.userId] };
    let saveGuard = join(authority, storageLimit);
    if (source) {
      saveGuard = join(saveGuard, { sql: `(${source.guard.sql}) AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?`, bindings: [...source.guard.bindings, auth.user.streamId, source.head] });
      if (saveGuard.bindings.length > 80 || new TextEncoder().encode(saveGuard.sql).byteLength > 80_000) return denied(`${validated.release.output.output}_reference_commit_proof_too_large`, 413);
    }
    try { await storePrivateContent(env, auth.user.userId, "experience-draft", content, undefined, saveGuard, undefined, { contentId: plan.draftId }); }
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
  const intake = { projectId: plan.projectId, documentId: plan.documentId, events: structuredClone(plan.events) as ExperiencePlan["events"][number][] };
  const options = {
    receiptPrefix: receiptPrefix(id), clientId: "web:experience-intake", correlationPrefix: "experience-intake:", guard: retainedGuard(auth, plan, retained.content),
  };
  let sourceOptions = {};
  if (plan.request.reference && action === "commit") {
    // A retained original receipt is recovery, not another transfer or generation.
    const original = await commitAtomicIntake(env, auth, intake, "check", options);
    const recorded = await original.json() as Record<string, unknown>;
    if (recorded.status === "complete") return intakeResult(recorded, original.status, id, plan);
    try {
      if (plan.release.output.output === "video") {
        const source = await prepareExperienceVideoReference(request, env, auth, plan.request.reference);
        sourceOptions = videoReferenceCommitGuard(env, auth, plan, source, options.guard);
      } else {
        const selection = readModel3dReferenceIntent(plan.request.reference);
        if (!selection) throw new Error("model3d_reference_selection_invalid");
        const source = await prepareExperienceModel3dReference(request, env, auth, selection);
        sourceOptions = model3dReferenceCommitGuard(env, auth, plan, source, options.guard);
      }
    } catch { return denied(`${plan.release.output.output}_reference_source_changed`); }
  }
  const response = await commitAtomicIntake(env, auth, intake, action === "commit" ? "commit" : "check", { ...options, ...sourceOptions });
  const result = await response.json() as Record<string, unknown>;
  return intakeResult(result, response.status, id, plan);
}

function intakeResult(result: Record<string, unknown>, status: number, id: string, plan: ExperiencePlan) {
  return reply({ ...result, draftId: id, draftHash: plan.draftHash, generation: "unavailable", ...(result.status === "complete" ? { documentRoute: experienceDocumentRoute(plan) } : {}) }, status);
}

// Internal re-entry adapters reuse the same principal, bounded body and retained custody checks.
export { authorize as authorizeExperienceIntake, readDraft as readExperienceDraft, retainedGuard as experienceDraftGuard, boundedBody as readExperienceBody };
