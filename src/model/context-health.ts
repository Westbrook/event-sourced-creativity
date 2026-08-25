import { blockIntentFor, blockTypeDefinition } from "./block-types.ts";
import type { DocumentArtifact } from "./document-artifacts.ts";
import type { CreativeBlock, CreativeEvent, CreativeProjection } from "./events.ts";
import { audioRightsAllowed } from "./audio.ts";

export type ContextHealthIssue = {
  id: string;
  severity: "blocking" | "warning" | "suggestion";
  label: string;
  detail: string;
  blockIds: string[];
};

export type ContextHealthReport = {
  score: number;
  state: "ready" | "needs-attention" | "incomplete";
  issues: ContextHealthIssue[];
  coveredAreas: number;
  verifiedSources: number;
};

const normalizedDecision = (block: CreativeBlock) =>
  String(block.properties.text ?? block.properties.label ?? "")
    .toLocaleLowerCase()
    .replace(/\b(?:never|avoid|exclude|without|do not|don't|include|show|use|reveal|disclose|share|mention|display|expose)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Actionable readiness is derived from durable evidence, never a decorative score. */
export function assessCreativeContext(projection: Pick<CreativeProjection, "blocks">, events: CreativeEvent[], now = Date.now()): ContextHealthReport {
  const blocks = projection.blocks.filter((block) => !block.removed && Number(block.properties.weight ?? .5) > 0);
  const issues: ContextHealthIssue[] = [];
  const byType = (type: string) => blocks.filter((block) => block.type === type);

  if (!byType("direction").length) issues.push({ id: "missing-direction", severity: "warning", label: "Define the objective", detail: "Explain the change or outcome this work must produce.", blockIds: [] });
  if (!byType("audience").length) issues.push({ id: "missing-audience", severity: "warning", label: "Identify the audience", detail: "Name who needs to use, approve, or understand the result.", blockIds: [] });
  if (!byType("format").length) issues.push({ id: "missing-deliverable", severity: "suggestion", label: "Name the deliverable", detail: "Record the intended channel, form, or production requirements.", blockIds: [] });
  if (!blocks.some((block) => block.type === "exclusion" || blockIntentFor(block.type, block.properties) === "prohibit")) {
    issues.push({ id: "missing-boundary", severity: "suggestion", label: "Set an explicit boundary", detail: "Capture any brand, safety, legal, or accuracy failure that must never appear.", blockIds: [] });
  }

  const rights = new Set(events.filter((event) => event.type === "RightsAsserted" || event.type === "ReferenceIngested" && ["owned", "owned_or_licensed", "account-generated"].includes(String(event.payload.rights_class ?? ""))).map((event) => String(event.payload.reference_id ?? "")));
  const audioRights = new Set(events.filter((event) => (event.type === "RightsAsserted" || event.type === "ReferenceIngested") && audioRightsAllowed(event.payload.rights_class)).map((event) => String(event.payload.reference_id ?? "")));
  let verifiedSources = 0;
  for(const decision of blocks.filter((block)=>block.type!=="reference")){
    const expires=Date.parse(String(decision.properties.license_expires_at??decision.properties.rights_expires_at??""));
    if(Number.isFinite(expires)&&expires<=now)issues.push({id:`decision-rights-expired-${decision.id}`,severity:"blocking",label:"Replace expired licensed context",detail:`The approved rights for “${String(decision.properties.label??decision.handle)}” have expired.`,blockIds:[decision.id]});
  }
  for (const source of [...byType("reference"),...byType("audio").filter((block)=>Boolean(block.properties.media_url)&&(block.properties.inform_generation===true||block.properties.include_in_output===true||block.properties.allow_provider_audio_transfer===true))]) {
    const referenceId = String(source.properties.reference_id ?? "");
    if (!referenceId || !(source.type === "audio" ? audioRights : rights).has(referenceId)) {
      issues.push({ id: `source-rights-${source.id}`, severity: "blocking", label: "Verify source rights", detail: `“${String(source.properties.label ?? source.handle)}” does not have a matching rights receipt.`, blockIds: [source.id] });
    } else verifiedSources += 1;

    const expires = Date.parse(String(source.properties.source_expires_at ?? source.properties.license_expires_at ?? source.properties.rights_expires_at ?? ""));
    if (Number.isFinite(expires) && expires <= now) issues.push({ id: `source-expired-${source.id}`, severity: "blocking", label: "Replace an expired source", detail: `The rights or freshness window for “${String(source.properties.label ?? source.handle)}” has expired.`, blockIds: [source.id] });
    const mime = String(source.properties.source_mime_type ?? "").toLowerCase();
    if ((mime === "application/pdf" || mime.includes("officedocument")) && !String(source.properties.text ?? "").trim()) {
      issues.push({ id: `source-excerpt-${source.id}`, severity: "warning", label: "Add a readable source excerpt", detail: String(source.properties.extraction_message ?? "This document is safely attached, but its text could not be extracted into generation context."), blockIds: [source.id] });
    }
  }

  if (!byType("reference").length) issues.push({ id: "missing-evidence", severity: "suggestion", label: "Attach grounding evidence", detail: "Add a licensed source document, pasted excerpt, or image when evidence is important.", blockIds: [] });

  const decisions = new Map<string, CreativeBlock[]>();
  for (const block of blocks) {
    const text = normalizedDecision(block);
    if (text.length < 4) continue;
    decisions.set(text, [...(decisions.get(text) ?? []), block]);
  }
  for (const [text, matching] of decisions) {
    const prohibited = matching.filter((block) => blockIntentFor(block.type, block.properties) === "prohibit");
    const included = matching.filter((block) => ["include", "prefer"].includes(blockIntentFor(block.type, block.properties)));
    if (prohibited.length && included.length) issues.push({ id: `contradiction-${text.replaceAll(" ", "-")}`, severity: "blocking", label: "Resolve contradictory decisions", detail: "The same decision is both required and prohibited.", blockIds: [...prohibited, ...included].map((block) => block.id) });
  }

  const penalty = issues.reduce((total, issue) => total + (issue.severity === "blocking" ? 24 : issue.severity === "warning" ? 12 : 6), 0);
  const score = Math.max(0, 100 - penalty);
  const coveredAreas = new Set(blocks.map((block) => blockTypeDefinition(block.type)?.group).filter(Boolean)).size;
  return { score, state: issues.some((issue) => issue.severity === "blocking") ? "incomplete" : issues.length ? "needs-attention" : "ready", issues, coveredAreas, verifiedSources };
}

export type ArtifactReviewState = {
  status: "unverified" | "draft" | "in-review" | "approved" | "changes-requested" | "stale";
  label: string;
  changedBlockIds: string[];
  reviewedAt: string | null;
  reviewer: string | null;
};

/** Existing artifacts immediately lose freshness and approval when their exact inputs change. */
export function artifactSourceVersions(artifactId:string,events:CreativeEvent[]){
  const source=[...events].reverse().find((event)=>["DocumentRenderCompleted","DocumentRenderRequested"].includes(event.type)&&String(event.payload.artifact_id??"")===artifactId&&Array.isArray(event.payload.source_block_versions));
  return source&&Array.isArray(source.payload.source_block_versions)?source.payload.source_block_versions.map((value)=>value&&typeof value==="object"?value as Record<string,unknown>:{}).filter((value)=>String(value.block_id??"")) : null;
}

export function artifactReviewState(artifact: Pick<DocumentArtifact, "id" | "documentId" | "sequence">, blocks: CreativeBlock[], events: CreativeEvent[]): ArtifactReviewState {
  return artifactReviewStateFromSources(artifact,blocks,events,new Set<string>());
}

function artifactReviewStateFromSources(artifact: Pick<DocumentArtifact, "id" | "documentId" | "sequence">, blocks: CreativeBlock[], events: CreativeEvent[], visited:Set<string>): ArtifactReviewState {
  if(visited.has(artifact.id))return{status:"unverified",label:"Input revision unavailable",changedBlockIds:[`output:${artifact.id}`],reviewedAt:null,reviewer:null};
  const ancestors=new Set([...visited,artifact.id]);
  const versions = artifactSourceVersions(artifact.id,events);
  if(!versions)return{status:"unverified",label:"Input revision unavailable",changedBlockIds:[],reviewedAt:null,reviewer:null};
  const documentBlocks=blocks.filter((block)=>block.documentId===artifact.documentId);
  const changedBlockIds = versions.map((value) => value && typeof value === "object" ? value as Record<string, unknown> : {})
    .filter((version) => {
      const block = documentBlocks.find((candidate) => candidate.id === String(version.block_id ?? ""));
      return !block || block.removed || block.sourceEvents.length !== Number(version.version ?? 0);
    }).map((version) => String(version.block_id ?? ""));
  const known=new Set(versions.map((version)=>String(version.block_id??"")));
  for(const block of documentBlocks)if(!block.removed&&!known.has(block.id))changedBlockIds.push(block.id);

  const completed=[...events].reverse().find((event)=>event.type==="DocumentRenderCompleted"&&String(event.payload.artifact_id??"")===artifact.id&&String(event.payload.document_id??"")===artifact.documentId);
  const settings=completed?.payload.settings&&typeof completed.payload.settings==="object"&&!Array.isArray(completed.payload.settings)?completed.payload.settings as Record<string,unknown>:null;
  const workflow=settings?.production_workflow&&typeof settings.production_workflow==="object"&&!Array.isArray(settings.production_workflow)?settings.production_workflow as Record<string,unknown>:null;
  const workflowSources=Array.isArray(workflow?.sources)?workflow.sources.filter((source):source is Record<string,unknown>=>Boolean(source)&&typeof source==="object"&&!Array.isArray(source)):[];
  for(const source of workflowSources){
    const sourceId=String(source.outputId??"");
    const sourceEvent=events.find((event)=>event.eventId===String(source.sourceEventId??""));
    if(!sourceId||String(source.documentId??"")!==artifact.documentId){changedBlockIds.push(`output:${sourceId||"unknown"}`);continue;}
    if(source.outputKind==="artifact"){
      const exact=sourceEvent?.type==="DocumentRenderCompleted"&&String(sourceEvent.payload.artifact_id??"")===sourceId&&String(sourceEvent.payload.document_id??"")===artifact.documentId;
      const revision=events.filter((event)=>event.type==="DocumentArtifactEdited"&&String(event.payload.artifact_id??"")===sourceId).length;
      if(!exact||revision!==Number(source.revision??-1)){changedBlockIds.push(`output:${sourceId}`);continue;}
      const upstream=artifactReviewStateFromSources({id:sourceId,documentId:artifact.documentId,sequence:sourceEvent.sequence},blocks,events,ancestors);
      if(upstream.status==="stale"||upstream.status==="unverified"||upstream.status==="changes-requested"||source.approvalRequired===true&&upstream.status!=="approved")changedBlockIds.push(`output:${sourceId}`);
    }else if(source.outputKind==="image"){
      const exact=sourceEvent?.type==="GenerationCompleted"&&String(sourceEvent.payload.document_id??"")===artifact.documentId&&Array.isArray(sourceEvent.payload.object_ids)&&sourceEvent.payload.object_ids.map(String).includes(sourceId);
      const discarded=events.some((event)=>event.type==="ObjectDiscarded"&&String(event.payload.object_id??"")===sourceId&&event.sequence>(sourceEvent?.sequence??0));
      if(!exact||discarded)changedBlockIds.push(`output:${sourceId}`);
    }else changedBlockIds.push(`output:${sourceId}`);
  }

  const review = [...events].reverse().find((event) =>
    ["ArtifactReviewRequested", "ArtifactApproved", "ArtifactChangesRequested", "DocumentArtifactEdited"].includes(event.type)
    && String(event.payload.artifact_id ?? "") === artifact.id
    && event.sequence > artifact.sequence,
  );
  if (changedBlockIds.length) return { status: "stale", label: review?.type === "ArtifactApproved" ? "Approval expired · context changed" : "Context changed · review again", changedBlockIds, reviewedAt: review?.occurredAt ?? null, reviewer: review?.actor ?? null };
  if (review?.type === "ArtifactApproved") return { status: "approved", label: "Approved", changedBlockIds, reviewedAt: review.occurredAt, reviewer: review.actor };
  if (review?.type === "ArtifactChangesRequested") return { status: "changes-requested", label: "Changes requested", changedBlockIds, reviewedAt: review.occurredAt, reviewer: review.actor };
  if (review?.type === "ArtifactReviewRequested") return { status: "in-review", label: "In review", changedBlockIds, reviewedAt: review.occurredAt, reviewer: review.actor };
  if (review?.type === "DocumentArtifactEdited") return { status: "draft", label: "Edited · review again", changedBlockIds, reviewedAt: review.occurredAt, reviewer: review.actor };
  return { status: "draft", label: "Review not requested", changedBlockIds, reviewedAt: null, reviewer: null };
}
