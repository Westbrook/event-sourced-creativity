import { canonicalJson } from "../src/experiences/compiler.ts";
import { buildExperiencePlan, validateIntakeRequest } from "../src/experiences/intake.ts";
import { readVideoReferencePlan } from "../src/experiences/video-reference-plan.ts";
import { createVideoOutputContract } from "../src/model/output-video-contract.ts";
import { experienceOutputBinding } from "./experience-output-binding.ts";
import { prepareExperienceVideoReference } from "./experience-video-reference-source.ts";
import { OutputConflictError } from "./output-command-core.ts";
import type { readDraft } from "./experience-intake-read.ts";
import type { ProjectIntakeAuthorization } from "./intake-authority.ts";
import type { WorkerEnv } from "./runtime.ts";

/** Rebuild the saved intent and reread its ORIGINAL image, not merely the copied
 * destination reference. No caller DTO or prior inspection grants custody.
 * The returned guard belongs in the caller's final read/write transaction. */
export async function prepareExperienceVideoOutputSource(request: Request, env: WorkerEnv,
  auth: ProjectIntakeAuthorization, retained: NonNullable<Awaited<ReturnType<typeof readDraft>>>) {
  const { plan } = retained;
  const valid = await validateIntakeRequest(plan.request);
  const reference = readVideoReferencePlan(plan.reference, plan.request.reference);
  if (!valid || valid.request.experienceId !== "video" || valid.release.output.output !== "video" || !reference
    || canonicalJson(valid.release) !== canonicalJson(plan.release)
    || canonicalJson(await buildExperiencePlan(auth.user.userId, valid.request, valid.release, reference)) !== canonicalJson(plan))
    throw new OutputConflictError("output_video_original_unavailable", 409);
  const source = await prepareExperienceVideoReference(request, env, auth, reference.selection);
  if (canonicalJson(source.reference) !== canonicalJson(reference))
    throw new OutputConflictError("output_video_reference_changed", 409);
  const binding = await experienceOutputBinding(plan), frame = plan.request.values.frame;
  // The legacy frameSize is orientation metadata. It does not authorize 720p;
  // the immutable Video contract still requires the provider's 480p setting.
  // validateIntakeRequest already verifies default provenance against the release.
  // Preserve it: selecting the default frame is not a new authored decision.
  const frameSize = frame?.value === "landscape" ? "1280x720" : frame?.value === "portrait" ? "720x1280" : null;
  const contract = createVideoOutputContract({ source: {
    draftId: binding.draftId, draftHash: binding.draftHash, releaseHash: binding.releaseHash,
    requestHash: binding.requestHash, sourceBindingHash: binding.sourceBindingHash,
  }, reference: reference.selection, frameSize });
  if (!contract) throw new OutputConflictError("output_video_contract_unavailable", 409);
  request.signal.throwIfAborted();
  if (!Number.isSafeInteger(source.head) || source.head < 0) throw new OutputConflictError("output_video_source_changed", 409);
  return Object.freeze({ contract, guard: source.guard, head: source.head });
}
