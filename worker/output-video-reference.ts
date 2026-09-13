import { parseVideoOutputContract } from "../src/model/output-video-contract.ts";
import { continueOutputTrustedContext } from "./output-trusted-context.ts";
import { readVideoReferenceCustody } from "./video-reference-custody.ts";
import type { OutputBridgeTargetInput } from "./output-requirements-api.ts";
import type { OutputVideoHookLease } from "./output-video-execution.ts";
import type { VideoReference } from "./openai-adapter.ts";
/** Read the original selected still, never a copied destination reference or
 * nearest available image. Execution owns the live original-source SQL proof. */
export async function readOutputVideoReference(input: OutputBridgeTargetInput, lease: OutputVideoHookLease, assertSource: () => Promise<void>): Promise<VideoReference> {
  lease.assertCurrent(); await assertSource(); lease.assertCurrent();
  const contract = parseVideoOutputContract(input.target.video_contract);
  if (!contract || input.scope.kind !== "personal" || input.principal.userId !== input.scope.ownerUserId) throw new Error("output_video_reference_unavailable");
  const auth = { user: input.principal, principal: input.principal, impersonation: null };
  const request = new Request(input.request, { signal: lease.signal });
  const trusted = await continueOutputTrustedContext(request, input.env, contract.reference.sourceDocumentId, "read", auth);
  lease.assertCurrent();
  if (trusted instanceof Response) throw new Error("output_video_reference_unavailable");
  const { image, inspection } = await readVideoReferenceCustody(trusted, auth, contract.reference);
  lease.assertCurrent(); await assertSource(); lease.assertCurrent();
  if (inspection.content.sha256 !== contract.reference.sha256) throw new Error("output_video_reference_changed");
  const block = trusted.projection.libraryBlocks.find(value => value.id === contract.reference.sourceBlockId);
  return { bytes: new Uint8Array(image.bytes), mimeType: image.mimeType, blockId: contract.reference.sourceBlockId, referenceId: contract.reference.referenceId,
    label: String(block?.properties.label ?? "Image").slice(0, 240), mode: "inspiration", sequence: null, shotDirection: "", cameraDirection: "", framePrompt: "",
    sourceArtifactId: null, sourceArtifactItemId: null, sourceArtifactKind: null, storyboardTitle: "", contextGroups: [] };
}
