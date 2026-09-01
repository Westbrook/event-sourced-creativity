import type { CreativeBlock, CreativeEvent, CreativeOutput } from "./events.ts";
import type { DocumentArtifact } from "./document-artifacts.ts";
import { DOCUMENT_ARTIFACT_KINDS, documentArtifactRevision, type DocumentArtifactKind } from "./document-artifacts.ts";
import { documentGenerationRevision, documentJobCanRecoverPresentation, documentJobCanRecoverProviderRender,
  documentJobFailure, documentJobHasNoBudgetHold, planningStopBudget, type DocumentJob } from "./document-jobs.ts";
import type { ArtifactDeliveryAction, ArtifactDeliveryIntent } from "./artifact-delivery.ts";
import type { OutputNavigationReference, OutputNavigationSection } from "./output-navigation.ts";
import { unfinishedIntentTrajectories } from "./intent-trajectories.ts";
import { promptFactIsActive } from "./prompt-policy.ts";

export type CreativeMedium = "image" | DocumentArtifactKind;
export type CreativeActionScope = {
  projectId: string; documentId: string; canvasId: string | null; authorityKey: string;
  /** Included by the lifecycle adapter; retirement cannot be undone by an equal projection. */
  sourceGeneration?: number;
};
export type CreativeAssignedReviewFact = {
  reviewId: string; organizationId: string; projectAccessId: string; artifactId: string;
  revision: number; contentSha256: string; title: string; createdAt: string;
};
export type CreativeArtifactDeliveryFact = {
  artifactId: string; sequence: number; revision: number; sourceEventId: string; contentRef: string | null;
  action: ArtifactDeliveryAction; intent: ArtifactDeliveryIntent; proof: string; title: string;
  reviewStatus: "unverified" | "draft" | "in-review" | "approved" | "changes-requested" | "stale";
};
export type CreativeCanonicalOutputFact = {
  reference: OutputNavigationReference; section: OutputNavigationSection; refresh: boolean;
  urgency: "source" | "original" | "review" | "owed" | "delivery";
  title: string; labelKey: string; label: string; reasonKey: string; reason: string;
};
export type CreativeLifecycleFacts = {
  /** Current blocking existing sources, never a suggestion to add unrelated context. */
  sourceBlockIds: readonly string[];
  reviews: readonly CreativeAssignedReviewFact[];
  deliveries: readonly CreativeArtifactDeliveryFact[];
  output: {
    state: "loading" | "ready" | "refreshing" | "unavailable";
    /** Null/false is unknown scope, not a zero owed count. No inferred count is provided. */
    scopeKnown: boolean | null;
    requirementBlockIds: readonly string[];
    choices: readonly CreativeCanonicalOutputFact[];
  };
};
export type CreativeNextTarget = CreativeActionScope & (
  | { kind: "context"; sourceRevision: string }
  | { kind: "configure"; medium: CreativeMedium | null; sourceRevision: string }
  | { kind: "output"; outputId: string }
  | { kind: "artifact"; artifactId: string; sequence: number; revision: number }
  | { kind: "job"; jobId: string; continuation?: "progress" | "recover" | "unknown" | "inspect" }
  | { kind: "compare"; outputIds: readonly [string, string] }
  | { kind: "source-block"; blockId: string; sourceRevision: string }
  | { kind: "assigned-review"; reviewId: string; organizationId: string; projectAccessId: string;
      artifactId: string; revision: number; contentSha256: string }
  | { kind: "artifact-delivery"; artifactId: string; sequence: number; revision: number;
      sourceEventId: string; contentRef: string | null; intent: ArtifactDeliveryIntent; proof: string }
  | { kind: "canonical-output"; reference: OutputNavigationReference; section: OutputNavigationSection; refresh: boolean }
  | { kind: "output-requirement"; blockId: string; sourceRevision: string; refresh: true }
);
export type CreativeNextActionId = "add-context" | "configure-output" | "open-output" | "read-draft"
  | "compare-images" | "check-job" | "inspect-job" | "recover-job" | "check-original-job"
  | "inspect-source" | "assigned-review" | "artifact-delivery" | "canonical-output" | "inspect-output-requirement";
export type CreativeNextAction = {
  id: CreativeNextActionId; label: string; reason: string; title: string; priority: number; evidence: number;
  target: CreativeNextTarget;
  /** Existing Output/delivery copy keys stay intact; new resolver copy uses next.exact.<id> by default. */
  labelKey?: string; reasonKey?: string;
  /** Read-safe summary for colliding original-job labels only; never navigation or recovery authority. */
  jobDisplay?: { kind: DocumentJob["kind"]; artifactKind: DocumentArtifactKind | null; requestedAt: string };
};
export type CreativeWorkspaceFacts = {
  blocks: readonly CreativeBlock[]; outputs: readonly CreativeOutput[]; artifacts: readonly DocumentArtifact[];
  jobs?: readonly DocumentJob[]; events?: readonly CreativeEvent[]; documentId: string; projectId: string; canvasId?: string | null;
  authorityKey: string; canRead: boolean; canAuthor: boolean; canConfigure: boolean; requestedMedium?: CreativeMedium | null;
  sourceGeneration?: number; lifecycle?: CreativeLifecycleFacts;
};
export type ProposedCreativeChange = { type: string; payload: Record<string, unknown> };

const readableLabel = (value: unknown) => String(value ?? "creative decision")
  .replace(/[_-]+/g, " ")
  .replace(/([a-z])([A-Z])/g, "$1 $2")
  .trim()
  .toLocaleLowerCase();

/** Explain an unaccepted mutation using authored meaning instead of event names or IDs. */
export function describeCreativeProposal(changes: readonly ProposedCreativeChange[]): string[] {
  return changes.map(({ type, payload }) => {
    const properties = payload.properties && typeof payload.properties === "object" && !Array.isArray(payload.properties)
      ? payload.properties as Record<string, unknown>
      : {};
    if (type === "BlockCreated") {
      const label = readableLabel(payload.type);
      const value = String(properties.text ?? properties.label ?? "").trim();
      return value ? `Add ${label}: “${value}”` : `Add a ${label}`;
    }
    if (type === "BlockPropertyEdited") {
      const property = readableLabel(payload.property_path);
      const before = String(payload.old_value ?? "").trim();
      const after = String(payload.new_value ?? "").trim();
      return before && after ? `Change ${property} from ${before} to ${after}` : after ? `Set ${property} to ${after}` : `Update ${property}`;
    }
    if (type === "BlockRemoved") return "Remove a creative decision";
    if (type === "BlockReordered") return "Reorder the creative decisions";
    return `Update ${readableLabel(type.replace(/(?:Created|Edited|Removed|Changed|Updated)$/, ""))}`;
  });
}

const medium=(value:unknown):CreativeMedium|null=>value==="image"||DOCUMENT_ARTIFACT_KINDS.includes(value as DocumentArtifactKind)?value as CreativeMedium:null;
const sourceBlocks=(facts:CreativeWorkspaceFacts)=>facts.blocks.filter((block)=>block.projectId===facts.projectId&&block.documentId===facts.documentId&&!block.removed);
const scopedOutputs=(facts:CreativeWorkspaceFacts)=>facts.outputs.filter((output)=>output.documentId===facts.documentId&&!output.discarded&&output.provider!=="simulation"&&Boolean(output.mediaUrl)&&(!facts.canvasId||!output.canvasId||output.canvasId===facts.canvasId));
const scopedArtifacts=(facts:CreativeWorkspaceFacts)=>facts.artifacts.filter((artifact)=>artifact.documentId===facts.documentId);
const scopedJobs=(facts:CreativeWorkspaceFacts)=>(facts.jobs??[]).filter((job)=>job.documentId===facts.documentId&&(!job.canvasId?job.sourceSurface!=="canvas":job.canvasId===(facts.canvasId??null)));
export const creativeActionSourceRevision=(facts:CreativeWorkspaceFacts)=>documentGenerationRevision({projectId:facts.projectId,documentId:facts.documentId,canvasId:facts.canvasId??null,blocks:sourceBlocks(facts)});

/** Only an explicit structured medium or an unsubmitted declared intent selects a format.
 * Ambiguous prose and lists of sibling formats open a choice, never an image-first purchase. */
export function requestedCreativeMedium(facts:CreativeWorkspaceFacts):CreativeMedium|null{
  if(facts.requestedMedium!==undefined)return medium(facts.requestedMedium);
  const declared=new Set(sourceBlocks(facts).filter(promptFactIsActive).filter((block)=>!["exclusion","boundary","constraint","audience"].includes(block.type)&&!["avoid","prohibit","exclude"].includes(String(block.properties.intent??""))).flatMap((block)=>[block.properties.output_kind,block.properties.artifact_kind,block.properties.requested_medium].map(medium).filter((value):value is CreativeMedium=>Boolean(value))));
  if(!declared.size&&!facts.canvasId&&facts.events)for(const intent of unfinishedIntentTrajectories(facts.events,{projectId:facts.projectId,documentId:facts.documentId})){
    if(intent.authority==="explicit"&&intent.status==="initiated"&&!intent.generationIds.length&&!intent.artifactIds.length){const value=medium(intent.expectedOutputKind);if(value)declared.add(value);}
  }
  return declared.size===1?[...declared][0]!:null;
}

const scopeFor = (facts: CreativeWorkspaceFacts): CreativeActionScope => ({
  projectId: facts.projectId, documentId: facts.documentId, canvasId: facts.canvasId ?? null, authorityKey: facts.authorityKey,
  ...(facts.sourceGeneration === undefined ? {} : { sourceGeneration: facts.sourceGeneration }),
});
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const originalJobUnresolved = (job: DocumentJob): boolean => {
  const receipt = object(job.result?.generationReceipt);
  const originalPlanning = job.kind === "structure_adaptive" && job.planningExecutionId === job.jobId;
  return originalPlanning && !documentJobHasNoBudgetHold(planningStopBudget(job.result))
    || receipt?.provider_request_status === "submission_unknown"
    || receipt?.provider_request_status === "submitted"
    || ["executing", "reserved", "retained", "unknown"].includes(String(receipt?.reservation_status ?? ""));
};

/** Presentation classification of an existing job, not retry permission or a billing verdict. */
export function creativeOriginalJobContinuation(job: DocumentJob): "progress" | "recover" | "unknown" | "inspect" | null {
  if (job.dismissedAt) return null;
  if (["queued", "running", "committing"].includes(job.status)) return "progress";
  const failure = documentJobFailure({ ...job, members: job.members ?? [] });
  // A provider safety refusal is never advertised as recoverable, even with an old retained-candidate flag.
  const safety = failure?.category === "safety";
  if (!safety && (documentJobCanRecoverPresentation(job)
    || documentJobCanRecoverProviderRender({ ...job, members: job.members ?? [] }))) return "recover";
  if (["failed", "partial", "canceled"].includes(job.status)) {
    if (originalJobUnresolved(job) && !safety) return "unknown";
    return "inspect";
  }
  return null;
}
const artifactDeliveryTarget = (scope: CreativeActionScope, row: CreativeArtifactDeliveryFact): Extract<CreativeNextTarget, { kind: "artifact-delivery" }> => ({
  ...scope, kind: "artifact-delivery", artifactId: row.artifactId, sequence: row.sequence, revision: row.revision,
  sourceEventId: row.sourceEventId, contentRef: row.contentRef, intent: row.intent, proof: row.proof,
});
const canonicalTarget = (scope: CreativeActionScope, row: CreativeCanonicalOutputFact): Extract<CreativeNextTarget, { kind: "canonical-output" }> => ({
  ...scope, kind: "canonical-output", reference: row.reference, section: row.section, refresh: row.refresh,
});
const assignedTarget = (scope: CreativeActionScope, row: CreativeAssignedReviewFact): Extract<CreativeNextTarget, { kind: "assigned-review" }> => ({
  ...scope, kind: "assigned-review", reviewId: row.reviewId, organizationId: row.organizationId,
  projectAccessId: row.projectAccessId, artifactId: row.artifactId, revision: row.revision, contentSha256: row.contentSha256,
});
const deliveryLabels: Record<ArtifactDeliveryAction, string> = {
  inspect: "Inspect exact output", assign: "Assign exact review", review: "Review assigned output",
  reviewPersonal: "Review required output", changes: "Review requested changes", sources: "Inspect changed sources",
  export: "Export approved output", exportPersonal: "Export output", exportDraft: "Export unreviewed draft",
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A recommendation is a scoped navigation/configuration capability, never permission to execute.
 * One priority policy: current source blockers, original work, review, owed Output,
 * saved-work/creation/delivery, then comparison. Object pages retain the complete obligation lists. */
export function creativeNextActions(facts: CreativeWorkspaceFacts): CreativeNextAction[] {
  // Until a surface opts in and wires every exact target, preserve the existing
  // shared policy and its complete action objects byte-for-byte in meaning.
  if (!facts.lifecycle) {
    if(!facts.canRead||!facts.authorityKey||!facts.projectId||!facts.documentId)return[];
    const scope:CreativeActionScope={projectId:facts.projectId,documentId:facts.documentId,canvasId:facts.canvasId??null,authorityKey:facts.authorityKey};
    const active=sourceBlocks(facts).filter(promptFactIsActive),outputs=scopedOutputs(facts),artifacts=scopedArtifacts(facts),jobs=scopedJobs(facts).filter((job)=>!job.dismissedAt);
    const actions:CreativeNextAction[]=[],requested=requestedCreativeMedium(facts),sourceRevision=creativeActionSourceRevision(facts);
    const existing=[...outputs.map((output)=>({sequence:output.sequence,title:output.title??"Image",draft:output.quality==="low"||output.purpose==="ideate",format:"image" as CreativeMedium,target:{...scope,kind:"output" as const,outputId:output.id}})),...artifacts.map((artifact)=>({sequence:artifact.sequence,title:artifact.title,draft:false,format:artifact.kind,target:{...scope,kind:"artifact" as const,artifactId:artifact.id,sequence:artifact.sequence,revision:documentArtifactRevision(facts.events??[],artifact.id)}}))].sort((a,b)=>Number(b.format===requested)-Number(a.format===requested)||b.sequence-a.sequence);
    const result=existing[0];
    if(result)actions.push({id:result.draft?"read-draft":"open-output",label:result.draft?"Review this image draft":"Open saved result",reason:"Inspect this exact saved output without starting another generation.",title:result.title,priority:90,evidence:1,target:result.target});
    const running=jobs.filter((job)=>["queued","running","committing"].includes(job.status)).sort((a,b)=>b.requestedAt.localeCompare(a.requestedAt))[0];
    if(running)actions.push({id:"check-job",label:"Check this work in progress",reason:"Open the existing request. A new request is not needed to check progress.",title:running.jobId,priority:85,evidence:1,target:{...scope,kind:"job",jobId:running.jobId}});
    if(!active.length&&facts.canAuthor)actions.push({id:"add-context",label:"Describe the direction",reason:"Add a deliberate creative decision to this document.",title:"",priority:80,evidence:0,target:{...scope,kind:"context",sourceRevision}});
    const comparable=outputs.filter((output)=>!output.promptFanId||output.standalone).sort((a,b)=>b.sequence-a.sequence);
    if(comparable.length>=2)actions.push({id:"compare-images",label:"Compare these images",reason:"Inspect these two saved alternatives side by side.",title:"",priority:75,evidence:2,target:{...scope,kind:"compare",outputIds:[comparable[0]!.id,comparable[1]!.id]}});
    const failed=jobs.filter((job)=>["failed","partial"].includes(job.status)).sort((a,b)=>b.requestedAt.localeCompare(a.requestedAt))[0];
    if(failed)actions.push({id:"inspect-job",label:"Inspect the previous attempt",reason:"Review retained evidence and partial work. Independent outputs can continue.",title:failed.jobId,priority:result||running?40:70,evidence:1,target:{...scope,kind:"job",jobId:failed.jobId}});
    if(active.length&&facts.canConfigure)actions.push({id:"configure-output",label:"Prepare an output",reason:"Choose and review this document’s output settings. Nothing is generated yet.",title:requested??"",priority:60,evidence:active.length,target:{...scope,kind:"configure",medium:requested,sourceRevision}});
    return actions.sort((a,b)=>b.priority-a.priority).slice(0,3);
  }
  if (!facts.canRead || !facts.authorityKey || !facts.projectId || !facts.documentId) return [];
  const scope = scopeFor(facts), lifecycle = facts.lifecycle;
  const active = sourceBlocks(facts).filter(promptFactIsActive), outputs = scopedOutputs(facts), artifacts = scopedArtifacts(facts);
  const jobs = scopedJobs(facts).filter(job => !job.dismissedAt), sourceRevision = creativeActionSourceRevision(facts);
  const actions: CreativeNextAction[] = [], requested = requestedCreativeMedium(facts);
  for (const blockId of lifecycle?.sourceBlockIds ?? []) {
    const block = sourceBlocks(facts).find(value => value.id === blockId);
    if (block) actions.push({ id: "inspect-source", label: "Inspect this source", reason: "Resolve this exact current source or rights blocker before continuing.",
      title: String(block.properties.label ?? block.handle), priority: 1000, evidence: 1,
      target: { ...scope, kind: "source-block", blockId, sourceRevision } });
  }
  for (const job of [...jobs].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))) {
    const continuation = creativeOriginalJobContinuation(job);
    if (!continuation) continue;
    const priority = continuation === "recover" ? 930 : continuation === "unknown" ? 925 : continuation === "progress" ? 920 : originalJobUnresolved(job) ? 915 : 55;
    const id = continuation === "recover" ? "recover-job" : continuation === "unknown" ? "check-original-job"
      : continuation === "progress" ? "check-job" : "inspect-job";
    const artifactKind = job.result?.artifactKind;
    actions.push({ id, priority, evidence: 1, title: job.jobId, target: { ...scope, kind: "job", jobId: job.jobId, continuation },
      jobDisplay: { kind: job.kind, artifactKind: DOCUMENT_ARTIFACT_KINDS.includes(artifactKind as DocumentArtifactKind)
        ? artifactKind as DocumentArtifactKind : null, requestedAt: job.requestedAt },
      label: continuation === "recover" ? "Review recovery of this original attempt" : continuation === "unknown" ? "Check this original attempt"
        : continuation === "progress" ? "Check this work in progress" : "Inspect the previous attempt",
      reason: continuation === "recover" ? "Inspect the saved work and its existing recovery controls. No replacement request is started."
        : continuation === "unknown" ? "Submission or accounting remains unresolved. Inspect the original request before considering another."
        : continuation === "progress" ? "Open the existing request. A new request is not needed to check progress."
        : "Review retained evidence and partial work. This action does not retry the request." });
  }
  for (const row of [...(lifecycle?.reviews ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.reviewId.localeCompare(b.reviewId))) {
    if (![row.reviewId, row.organizationId, row.projectAccessId, row.artifactId].every(value => Boolean(value))
      || !Number.isSafeInteger(row.revision) || row.revision < 0 || !/^[a-f0-9]{64}$/.test(row.contentSha256)) continue;
    actions.push({ id: "assigned-review", label: "Review assigned output",
      labelKey: "artifact.delivery.action.review", reason: "Open this exact assigned review, revision and content. Approval remains a separate action.",
      title: row.title, priority: 820, evidence: 1, target: assignedTarget(scope, row) });
  }
  for (const row of [...(lifecycle?.deliveries ?? [])].sort((a, b) => b.sequence - a.sequence)) {
    const review = ["assign", "review", "reviewPersonal", "changes", "sources"].includes(row.action);
    actions.push({ id: "artifact-delivery", label: deliveryLabels[row.action], labelKey: "artifact.delivery.action." + row.action,
      reason: "Inspect this exact saved output without starting another generation.", reasonKey: "next.exact.open-output.reason",
      title: row.title, priority: review ? row.action === "changes" || row.reviewStatus === "stale" ? 810 : 800 : 65,
      evidence: 1, target: artifactDeliveryTarget(scope, row) });
  }
  for (const row of lifecycle?.output.choices ?? []) actions.push({
    id: "canonical-output", label: row.label, labelKey: row.labelKey, reason: row.reason, reasonKey: row.reasonKey, title: row.title,
    priority: { source: 990, original: 915, review: 805, owed: 700, delivery: 66 }[row.urgency], evidence: 1,
    target: canonicalTarget(scope, row),
  });
  // A missing/refreshing read cannot be converted into "nothing owed". Only known
  // authored Output IDs may open their existing controller without a snapshot.
  if (lifecycle && (lifecycle.output.state !== "ready" || lifecycle.output.scopeKnown !== true)) {
    for (const blockId of lifecycle.output.requirementBlockIds) {
      const block = sourceBlocks(facts).find(value => value.id === blockId && value.type === "output");
      if (block) actions.push({ id: "inspect-output-requirement", label: "Check current Output requirements",
        reason: "Output scope is not confirmed by a current read. Inspect this requirement and refresh before acting.",
        title: String(block.properties.label ?? block.handle), priority: 690, evidence: 1,
        target: { ...scope, kind: "output-requirement", blockId, sourceRevision, refresh: true } });
    }
  }
  const delivered = new Set((lifecycle?.deliveries ?? []).map(row => row.artifactId));
  const existing = [...outputs.map(output => ({ sequence: output.sequence, title: output.title ?? "Image",
    draft: output.quality === "low" || output.purpose === "ideate", format: "image" as CreativeMedium,
    target: { ...scope, kind: "output" as const, outputId: output.id } })),
  ...artifacts.filter(artifact => !delivered.has(artifact.id)).map(artifact => ({ sequence: artifact.sequence, title: artifact.title,
    draft: false, format: artifact.kind, target: { ...scope, kind: "artifact" as const, artifactId: artifact.id,
      sequence: artifact.sequence, revision: documentArtifactRevision(facts.events ?? [], artifact.id) } }))]
    .sort((a, b) => Number(b.format === requested) - Number(a.format === requested) || b.sequence - a.sequence);
  const result = existing[0];
  if (result) actions.push({ id: result.draft ? "read-draft" : "open-output",
    label: result.draft ? "Review this image draft" : "Open saved result",
    reason: "Inspect this exact saved output without starting another generation.", title: result.title,
    priority: 65, evidence: 1, target: result.target });
  if (!active.length && facts.canAuthor) actions.push({ id: "add-context", label: "Describe the direction",
    reason: "Add a deliberate creative decision to this document.", title: "", priority: 60, evidence: 0,
    target: { ...scope, kind: "context", sourceRevision } });
  if (active.length && facts.canConfigure) actions.push({ id: "configure-output", label: "Prepare an output",
    reason: "Choose and review this document’s output settings. Nothing is generated yet.", title: requested ?? "",
    priority: 50, evidence: active.length, target: { ...scope, kind: "configure", medium: requested, sourceRevision } });
  const comparable = outputs.filter(output => !output.promptFanId || output.standalone).sort((a, b) => b.sequence - a.sequence);
  if (comparable.length >= 2) actions.push({ id: "compare-images", label: "Compare these images",
    reason: "Inspect these two saved alternatives side by side.", title: "", priority: 20, evidence: 2,
    target: { ...scope, kind: "compare", outputIds: [comparable[0]!.id, comparable[1]!.id] } });
  // One promoted continuation per exact subject; a job and its Output operation
  // must not occupy two cards for the same original request.
  const seen = new Set<string>();
  return actions.sort((a, b) => b.priority - a.priority).filter(action => {
    if (!creativeNextTargetAvailable(action.target, facts)) return false;
    const target = action.target, key = target.kind === "job" ? "job:" + target.jobId
      : target.kind === "canonical-output" && target.reference.jobId ? "job:" + target.reference.jobId
      : target.kind === "canonical-output" ? "output-target:" + (target.reference.targetId ?? target.reference.blockId ?? target.reference.id)
      : target.kind === "artifact-delivery" || target.kind === "assigned-review" || target.kind === "artifact" ? "artifact:" + target.artifactId
      : target.kind === "source-block" || target.kind === "output-requirement" ? "block:" + target.blockId
      : target.kind + ":" + JSON.stringify(target);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 3);
}

/** Missing, changed, or unauthorized exact targets fail closed. Never replace them with the first available object. */
export function creativeActionScopeAvailable(target:CreativeActionScope,facts:CreativeWorkspaceFacts):boolean{
  return facts.canRead&&Boolean(target.authorityKey)&&target.authorityKey===facts.authorityKey&&target.projectId===facts.projectId&&target.documentId===facts.documentId&&target.canvasId===(facts.canvasId??null) && (target.sourceGeneration === undefined || target.sourceGeneration === facts.sourceGeneration);
}
export function creativeNextTargetAvailable(target:CreativeNextTarget,facts:CreativeWorkspaceFacts):boolean{
  if(!creativeActionScopeAvailable(target,facts))return false;
  if(target.kind==="context")return facts.canAuthor&&target.sourceRevision===creativeActionSourceRevision(facts);
  if(target.kind==="configure")return facts.canConfigure&&target.sourceRevision===creativeActionSourceRevision(facts);
  if(target.kind==="output")return scopedOutputs(facts).some((output)=>output.id===target.outputId);
  if(target.kind==="artifact")return scopedArtifacts(facts).some((artifact)=>artifact.id===target.artifactId&&artifact.sequence===target.sequence&&documentArtifactRevision(facts.events??[],artifact.id)===target.revision);
  if(target.kind==="job")return scopedJobs(facts).some((job)=>job.jobId===target.jobId
    &&(target.continuation===undefined||!job.dismissedAt&&target.continuation===creativeOriginalJobContinuation(job)));
  const scope=scopeFor(facts),lifecycle=facts.lifecycle;
  if(target.kind==="source-block")return Boolean(lifecycle?.sourceBlockIds.includes(target.blockId)
    &&sourceBlocks(facts).some(block=>block.id===target.blockId)&&target.sourceRevision===creativeActionSourceRevision(facts));
  if(target.kind==="assigned-review")return lifecycle?.reviews.filter(row=>same(assignedTarget(scope,row),target)).length===1;
  if(target.kind==="artifact-delivery")return Boolean(scopedArtifacts(facts).some(artifact=>artifact.id===target.artifactId
    &&artifact.sequence===target.sequence&&artifact.sourceEventId===target.sourceEventId&&(artifact.contentRef??null)===target.contentRef
    &&documentArtifactRevision(facts.events??[],artifact.id)===target.revision)
    &&lifecycle?.deliveries.some(row=>same(artifactDeliveryTarget(scope,row),target)));
  if(target.kind==="canonical-output")return Boolean(target.reference.authorizationScopeKey===facts.authorityKey
    &&target.reference.projectId===facts.projectId&&target.reference.documentId===facts.documentId
    &&lifecycle?.output.choices.some(row=>same(canonicalTarget(scope,row),target)));
  if(target.kind==="output-requirement")return Boolean(lifecycle&&(lifecycle.output.state!=="ready"||lifecycle.output.scopeKnown!==true)
    &&lifecycle.output.requirementBlockIds.includes(target.blockId)
    &&sourceBlocks(facts).some(block=>block.id===target.blockId&&block.type==="output")
    &&target.sourceRevision===creativeActionSourceRevision(facts));
  return new Set(target.outputIds).size===2&&target.outputIds.every((id)=>scopedOutputs(facts).some((output)=>output.id===id&&(!output.promptFanId||output.standalone)));
}

type ExistingCreativeTargetKind = "context" | "configure" | "output" | "artifact" | "job" | "compare";
export type CreativeNextPorts = {
  [Kind in ExistingCreativeTargetKind]: (target: Extract<CreativeNextTarget, { kind: Kind }>) => unknown | Promise<unknown>;
} & {
  [Kind in Exclude<CreativeNextTarget["kind"], ExistingCreativeTargetKind>]?: (target: Extract<CreativeNextTarget, { kind: Kind }>) => unknown | Promise<unknown>;
};
export function creativePreparationChoice(target:Extract<CreativeNextTarget,{kind:"configure"}>|null,medium:CreativeMedium,facts:CreativeWorkspaceFacts):Extract<CreativeNextTarget,{kind:"configure"}>|null{
  return target&&creativeNextTargetAvailable(target,facts)?{...target,medium}:null;
}
export type CreativePreparationStage="opening"|"editing";
export type CreativePreparationGuard=(()=>boolean)&{beginEditing:()=>boolean};
export function creativePreparationTargetAvailable(target:Extract<CreativeNextTarget,{kind:"configure"}>,facts:CreativeWorkspaceFacts,stage:CreativePreparationStage="opening"):boolean{
  return stage==="opening"?creativeNextTargetAvailable(target,facts):creativeActionScopeAvailable(target,facts)&&facts.canConfigure;
}
/** Keep opening exact, then allow settings edits within the same authorized document.
 * This session is not paid consent; execution must quote and validate current inputs. */
export function retainCreativePreparation(current:()=>CreativeWorkspaceFacts,required:(stage:CreativePreparationStage)=>boolean=()=>true):CreativePreparationGuard{
  const facts=current(),target:Extract<CreativeNextTarget,{kind:"configure"}>={...scopeFor(facts),kind:"configure",sourceRevision:creativeActionSourceRevision(facts),medium:null};
  let stage:CreativePreparationStage="opening";
  const guard=()=>required(stage)&&creativePreparationTargetAvailable(target,current(),stage);
  return Object.assign(guard,{beginEditing:()=>{if(!guard())return false;stage="editing";return true;}});
}
export async function followCreativeNextTarget(target:CreativeNextTarget,current:()=>CreativeWorkspaceFacts,ports:CreativeNextPorts):Promise<boolean>{
  if(!creativeNextTargetAvailable(target,current()))return false;
  switch(target.kind){
    case"context":return await ports.context(target)!==false;
    case"configure":return await ports.configure(target)!==false;
    case"output":return await ports.output(target)!==false;
    case"artifact":return await ports.artifact(target)!==false;
    case"job":return await ports.job(target)!==false;
    case"compare":return await ports.compare(target)!==false;
    case"source-block":return ports["source-block"] ? await ports["source-block"](target)!==false : false;
    case"assigned-review":return ports["assigned-review"] ? await ports["assigned-review"](target)!==false : false;
    case"artifact-delivery":return ports["artifact-delivery"] ? await ports["artifact-delivery"](target)!==false : false;
    case"canonical-output":return ports["canonical-output"] ? await ports["canonical-output"](target)!==false : false;
    case"output-requirement":return ports["output-requirement"] ? await ports["output-requirement"](target)!==false : false;
  }
}
