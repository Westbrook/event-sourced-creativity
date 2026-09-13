import { EXPERIENCE_VIDEO_INTENT, readVideoReferenceIntent } from "../src/experiences/video-reference.ts";
import { sendsReferencePixels } from "../src/model/block-types.ts";
import { promptFactIsActive } from "../src/model/prompt-policy.ts";
import { audioRightsAllowed } from "../src/model/audio.ts";
import { creativeContextRightsIssue } from "../src/model/context-health.ts";
import { VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { projectIntakeAuthority, type ProjectIntakeAuthorization } from "./intake-authority.ts";
import { outputActiveSourceDeadlineAssertions, verifyOutputSourceRead } from "./output-disclosure-proof.ts";
import { readOwnedImageReferenceCustody } from "./owned-image-reference-custody.ts";
import type { OutputTrustedContext } from "./output-requirements-api.ts";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function fail(code: string, status = 409): never { throw Object.assign(new Error(code), { code, status }); }

/** Read-only first step for one ordinary still. Not a persisted intake, quote,
 * media transfer, source adoption or permission to generate. Save must reread. */
export async function inspectVideoReferenceCustody(trusted: OutputTrustedContext, auth: ProjectIntakeAuthorization, value: unknown) {
  const selection = readVideoReferenceIntent(value);
  if (!selection) fail("video_reference_selection_invalid", 400);
  const { scope, env } = trusted;
  if (scope.kind !== "personal" || scope.organizationId || scope.projectAccessId || scope.contextId || trusted.projectContext
    || scope.ownerUserId !== scope.actorUserId || scope.actorUserId !== auth.user.userId
    || auth.principal.userId !== auth.user.userId || auth.impersonation || auth.user.fictional || auth.user.projectExecution
    || trusted.principal.userId !== auth.user.userId || trusted.principal.fictional || trusted.principal.projectExecution
    || trusted.principal.streamId !== `creative:${auth.user.userId}`
    || scope.documentId !== selection.sourceDocumentId || scope.projectId !== selection.sourceProjectId)
    fail("video_reference_scope_unavailable", 403);
  if (!trusted.context || trusted.sourceProblems.length || !trusted.sourcePrivateCaptured || !trusted.sourceDigest
    || !Number.isSafeInteger(trusted.ownerHead) || trusted.ownerHead < 0 || !trusted.sourceAssertions.length)
    fail("video_reference_source_unavailable");
  const blocks = trusted.projection.libraryBlocks.filter(block => block.id === selection.sourceBlockId);
  const facts = (Array.isArray(trusted.context.snapshot.facts) ? trusted.context.snapshot.facts : []).map(record)
    .filter(fact => fact.block_id === selection.sourceBlockId);
  if (blocks.length !== 1 || facts.length !== 1) fail("video_reference_source_unavailable");
  const block = blocks[0]!, fact = facts[0]!, properties = record(fact.properties);
  if (block.removed || block.type !== "reference" || fact.type !== "reference" || block.scope !== "document"
    || block.documentId !== scope.documentId || block.projectId !== scope.projectId
    || !promptFactIsActive(fact) || !sendsReferencePixels(properties.pixel_reference_mode)
    || !(Number(properties.weight ?? .5) > 0)) fail("video_reference_pixel_permission_required", 403);
  // Authored permission never repairs a mismatched server block/snapshot.
  for (const key of ["reference_id", "source_content_hash", "media_url", "media_type", "pixel_reference_mode", "context_reference_kind", "likeness_transfer_consent"])
    if (block.properties[key] !== properties[key]) fail("video_reference_source_changed");
  const rightsCurrent = () => {
    const latest = [...trusted.events].sort((a, b) => a.sequence - b.sequence).findLast(event =>
      ["RightsAsserted", "ReferenceIngested"].includes(event.type) && event.payload.reference_id === selection.referenceId);
    if (!latest || !audioRightsAllowed(latest.payload.rights_class) || creativeContextRightsIssue(latest.payload)
      || creativeContextRightsIssue(block.properties) || creativeContextRightsIssue(properties)) fail("video_reference_rights_required", 403);
    if (properties.context_reference_kind === "character_identity" && properties.pixel_reference_mode === "preserve_subject"
      && properties.likeness_transfer_consent !== true) fail("video_reference_likeness_permission_required", 403);
  };
  rightsCurrent();
  const captured = () => JSON.stringify({ scope: trusted.scope, principal: trusted.principal, auth,
    digest: trusted.sourceDigest, head: trusted.ownerHead, blocks: trusted.projection.libraryBlocks,
    snapshot: trusted.context?.snapshot, events: trusted.events, sourceAssertions: trusted.sourceAssertions,
    sourceProblems: trusted.sourceProblems, sourcePrivateCaptured: trusted.sourcePrivateCaptured });
  const before = captured(), sourceDigest = trusted.sourceDigest, ownerHead = trusted.ownerHead;
  const assertions = [projectIntakeAuthority(env, auth, { projectId: scope.projectId, documentId: scope.documentId }),
    ...trusted.sourceAssertions, ...outputActiveSourceDeadlineAssertions(trusted.context)]
    .map(assertion => ({ ...assertion, bindings: [...(assertion.bindings ?? [])] }));
  const image = await readOwnedImageReferenceCustody({ env, ownerId: scope.ownerUserId, blockId: block.id,
    referenceId: selection.referenceId, sha256: selection.sha256, properties, sourceEvents: trusted.events,
    maximumBytes: VIDEO_ADAPTER_CONTRACT.maxReferenceBytes,
    mimeTypes: VIDEO_ADAPTER_CONTRACT.supportedReferenceMimeTypes, signal: trusted.request.signal });
  if (captured() !== before) fail("video_reference_source_changed");
  rightsCurrent(); trusted.request.signal.throwIfAborted();
  await verifyOutputSourceRead(env, scope, ownerHead, assertions);
  if (captured() !== before) fail("video_reference_source_changed");
  rightsCurrent(); trusted.request.signal.throwIfAborted();
  return Object.freeze({ version: 1, qualification: "read-only-reference-inspection", selection, sourceDigest,
    intent: EXPERIENCE_VIDEO_INTENT,
    content: Object.freeze({ sha256: image.sha256, byteLength: image.bytes.byteLength, mimeType: image.mimeType }) });
}
