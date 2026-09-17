import { readExperienceBody as boundedBody } from "./experience-intake-body.ts";
import { readGuestContextPlan } from "./experience-guest-plan-custody.ts";
import { classifySponsorIntakeDraft } from "./experience-sponsor-intake-classification.ts";
import { readSponsorImageIntake } from "./experience-sponsor-intake-reads.ts";
import { SponsorIntakeReadLimitError } from "./experience-sponsor-intake-read-attempts.ts";
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
  const database = env.DB;
  if (lookup) id = await experienceDraftId(auth.user.userId, url.searchParams.get("intentId")!);
  if (!id) {
    let value: unknown; try { value = await boundedBody(request); } catch { return denied("request_invalid", 400); }
    const validated = await validateIntakeRequest(value); if (!validated) return denied("experience_request_invalid", 400);
    if (!isExperienceContextOutput(validated.release.output.output)) return denied("experience_request_invalid", 400);
    const draftId = await experienceDraftId(auth.user.userId, validated.request.intentId);
    if (env.DB !== database) return denied("experience_draft_unavailable", 404);
    const classification = await classifySponsorIntakeDraft(env, draftId);
    if (env.DB !== database || classification.kind === "unavailable") return denied("experience_draft_unavailable", 404);
    if (classification.kind === "sponsored") return denied("sponsor_intake_internal_only", 403);
    const saveEnv = { ...env, DB: database };
    let source;
    try { if (validated.request.reference) source = validated.release.output.output === "video"
      ? await prepareExperienceVideoReference(request, saveEnv, auth, validated.request.reference)
      : await prepareExperienceModel3dReference(request, saveEnv, auth, readModel3dReferenceIntent(validated.request.reference)!); }
    catch { return denied(`${validated.release.output.output}_reference_source_unavailable`); }
    const plan = await buildExperiencePlan(auth.user.userId, validated.request, validated.release, source?.reference), content = canonicalJson(plan);
    const authority = projectIntakeAuthority(saveEnv, auth, plan);
    const storageLimit = experienceDraftStorageGuard(auth.user.userId);
    let saveGuard = join(join(authority, storageLimit), classification.guard);
    if (source) {
      saveGuard = join(saveGuard, { sql: `(${source.guard.sql}) AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?`, bindings: [...source.guard.bindings, auth.user.streamId, source.head] });
      if (saveGuard.bindings.length > 80 || new TextEncoder().encode(saveGuard.sql).byteLength > 80_000) return denied(`${validated.release.output.output}_reference_commit_proof_too_large`, 413);
    }
    if (env.DB !== database) return denied("experience_draft_unavailable", 404);
    try { await storePrivateContent(saveEnv, auth.user.userId, "experience-draft", content, undefined, saveGuard, undefined, { contentId: plan.draftId }); }
    catch { /* Resolve duplicate, lost acknowledgment or denied write from the retained original only. */ }
    if (env.DB !== database) return denied("experience_draft_unavailable", 404);
    const saved = await readDraft(saveEnv, auth, plan.draftId, classification.guard);
    if (!saved || env.DB !== database) return denied("experience_save_unconfirmed");
    if (saved.content !== content) return denied("experience_intent_conflict");
    return reply({ status: "prepared", plan: saved.plan, expiresAt: saved.expiresAt });
  }
  if (env.DB !== database) return denied("experience_draft_unavailable", 404);
  const classification = await classifySponsorIntakeDraft(env, id);
  if (env.DB !== database || classification.kind === "unavailable") return denied("experience_draft_unavailable", 404);
  if (classification.kind === "sponsored") {
    if (request.method !== "GET") return denied("sponsor_intake_internal_only", 403);
    try {
      return await readSponsorImageIntake(request, env, { operation: action === "receipt" ? "image-intake-receipt" : "image-intake-draft", draftId: id });
    } catch (cause) {
      if (cause instanceof SponsorIntakeReadLimitError) return new Response(JSON.stringify({ error: cause.code }), {
        status: 429, headers: { "content-type": "application/json", "cache-control": "private, no-store", "retry-after": String(Math.max(1, Math.ceil(cause.retryAfterMs / 1000))) },
      });
      return denied("experience_draft_unavailable", 404);
    }
  }
  let approvedHash: string | undefined;
  if (action === "commit") {
    let body: unknown; try { body = await boundedBody(request); } catch { return denied("request_invalid", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("draftHash" in body) || typeof body.draftHash !== "string") return denied("request_invalid", 400);
    approvedHash = body.draftHash;
  }
  if (env.DB !== database) return denied("experience_draft_unavailable", 404);
  const retained = await readDraft(env, auth, id, classification.guard);
  if (env.DB !== database) return denied("experience_draft_unavailable", 404);
  if (!retained) {
    // A negative-guard failure is not an ordinary missing draft and must never
    // select the separate claimed-guest fallback below.
    if (!await database.prepare(`SELECT 1 AS current WHERE ${classification.guard.sql}`).bind(...classification.guard.bindings).first()
      || env.DB !== database) return denied("experience_draft_unavailable", 404);
    // An explicit original draft-ID GET may reopen already claimed context.
    // This tagged read never grants generation or fabricates ordinary receipts,
    // and never retains a missing plan, installs schema or commits any events.
    if (request.method === "GET" && !lookup) {
      const claimedDb = env.DB;
      try {
        const claimed = await readGuestContextPlan(request, env, { draftId: id });
        if (env.DB !== claimedDb) return denied("experience_draft_unavailable", 404);
        if (claimed) return reply(claimed);
      }
      catch { return denied("experience_draft_unavailable", 404); }
    }
    return denied("experience_draft_unavailable", 404);
  }
  if (!action) return reply({ status: "prepared", plan: retained.plan, expiresAt: retained.expiresAt });
  const plan = retained.plan;
  // A marker only refuses ordinary mutation; it never supplies sponsor authority.
  // Existing owner reads and original receipt recovery remain native operations.
  if (action === "commit" && Object.hasOwn(plan, "sponsor_intake")) return denied("sponsor_intake_internal_only", 403);
  if (action === "commit" && approvedHash !== plan.draftHash) return denied("experience_review_stale");
  // Changed registrations block new intake, but never replace or reinterpret the old receipt.
  if (action === "commit" && (await registeredExperience(plan.request.experienceId))?.releaseHash !== plan.release.releaseHash) return denied("experience_release_changed");
  if (env.DB !== database) return denied("experience_draft_unavailable", 404);
  const nativeEnv = { ...env, DB: database };
  const intake = { projectId: plan.projectId, documentId: plan.documentId, events: structuredClone(plan.events) as ExperiencePlan["events"][number][] };
  const options = {
    receiptPrefix: receiptPrefix(id), clientId: "web:experience-intake", correlationPrefix: "experience-intake:", guard: join(retainedGuard(auth, plan, retained.content), classification.guard),
  };
  let sourceOptions = {};
  if (plan.request.reference && action === "commit") {
    // A retained original receipt is recovery, not another transfer or generation.
    const original = await commitAtomicIntake(nativeEnv, auth, intake, "check", options);
    const recorded = await original.json() as Record<string, unknown>;
    if (env.DB !== database) return denied("experience_draft_unavailable", 404);
    if (recorded.status === "complete") return intakeResult(recorded, original.status, id, plan);
    try {
      if (plan.release.output.output === "video") {
        const source = await prepareExperienceVideoReference(request, nativeEnv, auth, plan.request.reference);
        sourceOptions = videoReferenceCommitGuard(nativeEnv, auth, plan, source, options.guard);
      } else {
        const selection = readModel3dReferenceIntent(plan.request.reference);
        if (!selection) throw new Error("model3d_reference_selection_invalid");
        const source = await prepareExperienceModel3dReference(request, nativeEnv, auth, selection);
        sourceOptions = model3dReferenceCommitGuard(nativeEnv, auth, plan, source, options.guard);
      }
    } catch { return denied(`${plan.release.output.output}_reference_source_changed`); }
  }
  if (env.DB !== database) return denied("experience_draft_unavailable", 404);
  const response = await commitAtomicIntake(nativeEnv, auth, intake, action === "commit" ? "commit" : "check", { ...options, ...sourceOptions });
  const result = await response.json() as Record<string, unknown>;
  if (env.DB !== database) return denied("experience_draft_unavailable", 404);
  return intakeResult(result, response.status, id, plan);
}

function intakeResult(result: Record<string, unknown>, status: number, id: string, plan: ExperiencePlan) {
  return reply({ ...result, draftId: id, draftHash: plan.draftHash, generation: "unavailable", ...(result.status === "complete" ? { documentRoute: experienceDocumentRoute(plan) } : {}) }, status);
}

// Internal re-entry adapters reuse the same principal, bounded body and retained custody checks.
export { authorize as authorizeExperienceIntake, readDraft as readExperienceDraft, retainedGuard as experienceDraftGuard, boundedBody as readExperienceBody };

/** Reuse the existing ordinary storage ceiling without changing its predicate. */
export function experienceDraftStorageGuard(ownerId: string): BudgetReservationGuard {
  return { sql: `(SELECT COUNT(*) FROM private_content WHERE owner_id=? AND kind='experience-draft' AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))<50`, bindings: [ownerId] };
}
