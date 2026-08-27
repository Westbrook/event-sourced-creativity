import { blockIntentFor, blockTypeDefinition, isNegativeIntent } from "./block-types.ts";
import { documentArtifactRevision, type DocumentArtifact } from "./document-artifacts.ts";
import { inferDocumentArtifactKind } from "./document-output-intent.ts";
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

const placeholderDecision = /^(?:t\.?b\.?d\.?|t\.?b\.?a\.?|to[- ]?do|n\/?a|none|null|undefined|untitled(?: document)?|lorem ipsum(?:\b[\s\S]*)?|(?:add|enter|write|type)(?: (?:a|an|the|your))? (?:message|objective|direction|audience|deliverable|format)|(?:message|objective|direction|audience|deliverable|format))$/iu;

const meaningfulDecision = (value: unknown): value is string => typeof value === "string"
  && /[\p{L}\p{N}]/u.test(value)
  && !placeholderDecision.test(value.trim());

const authoredDecision = (block: CreativeBlock) => [
  block.properties.text,
  block.properties.description,
  block.properties.content,
  block.properties.label,
].find(meaningfulDecision)?.trim() ?? "";

const structuredDeliverable = (block: CreativeBlock, narrative: boolean) => [
  block.properties.artifact_kind,
  block.properties.output_kind,
  block.properties.medium,
  block.properties.deliverable,
  block.properties.channel,
].some(meaningfulDecision) || !narrative && Boolean(
  block.properties.image_format
  && typeof block.properties.image_format === "object"
  && !Array.isArray(block.properties.image_format),
);

const narrativeDeliveryKind = (kind: string | null) => kind === "slides"
  || kind === "short_story"
  || kind === "scene"
  || kind === "storyboard";

const allowedProtectedPlacement = (value: unknown) => value === "opening"
  || value === "closing"
  || value === "opening_and_closing";

/** Every declared license boundary is authoritative; malformed metadata never widens rights. */
export function creativeContextRightsValidity(properties: Record<string, unknown>, now = Date.now()): {issue:"revoked"|"invalid"|"expired"|null;validUntil:string|null} {
  if (properties.rights_revoked === true || properties.source_rights_revoked === true
    || ["revoked", "denied", "unlicensed"].includes(String(properties.rights_class ?? "").trim().toLowerCase())
    || ["revoked", "denied"].includes(String(properties.rights_status ?? "").trim().toLowerCase())) return {issue:"revoked",validUntil:null};
  let validUntil:number|null=null;
  for (const field of ["source_expires_at", "license_expires_at", "rights_expires_at"] as const) {
    const value = properties[field];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return {issue:"invalid",validUntil:null};
    const deadline=Date.parse(value);
    if (deadline <= now) return {issue:"expired",validUntil:null};
    validUntil=validUntil===null?deadline:Math.min(validUntil,deadline);
  }
  return {issue:null,validUntil:validUntil===null?null:new Date(validUntil).toISOString()};
}

export function creativeContextRightsIssue(properties: Record<string, unknown>, now = Date.now()): "revoked" | "invalid" | "expired" | null {
  return creativeContextRightsValidity(properties,now).issue;
}

/** Actionable readiness is derived from durable evidence, never a decorative score. */
export function assessCreativeContext(projection: Pick<CreativeProjection, "blocks">, events: CreativeEvent[], now = Date.now()): ContextHealthReport {
  const blocks = projection.blocks.filter((block) => !block.removed && Number(block.properties.weight ?? .5) > 0);
  const issues: ContextHealthIssue[] = [];
  const byType = (type: string) => blocks.filter((block) => block.type === type);
  const intendedKind = inferDocumentArtifactKind(blocks);
  const needsNarrativeMessage = narrativeDeliveryKind(intendedKind);
  const affirmativeByType = (type: string) => byType(type).filter((block) => !isNegativeIntent(blockIntentFor(block.type, block.properties)));
  const meaningfulByType = (type: string) => affirmativeByType(type).filter((block) => Boolean(authoredDecision(block)));
  const directions = meaningfulByType("direction");
  const audiences = meaningfulByType("audience");
  const messages = meaningfulByType("message");
  const formats = affirmativeByType("format").filter((block) => Boolean(authoredDecision(block)) || structuredDeliverable(block, needsNarrativeMessage));

  if (!directions.length) issues.push({ id: "missing-direction", severity: "warning", label: "Define the objective", detail: "Explain the change or outcome this work must produce.", blockIds: affirmativeByType("direction").map((block) => block.id) });
  if (!audiences.length) issues.push({ id: "missing-audience", severity: "warning", label: "Identify the audience", detail: "Name who needs to use, approve, or understand the result.", blockIds: affirmativeByType("audience").map((block) => block.id) });
  if (!formats.length) issues.push({ id: "missing-deliverable", severity: "suggestion", label: "Name the deliverable", detail: "Record the intended channel, form, or production requirements.", blockIds: affirmativeByType("format").map((block) => block.id) });
  if (needsNarrativeMessage && !messages.length) {
    const medium = intendedKind === "slides" ? "presentation" : intendedKind === "storyboard" ? "storyboard" : intendedKind === "scene" ? "scene" : "story";
    issues.push({ id: "missing-message", severity: "warning", label: "Define the central message", detail: `A ${medium} needs an authored Message describing the audience takeaway, central idea, or narrative before its context is ready.`, blockIds: affirmativeByType("message").map((block) => block.id) });
  }
  if (!blocks.some((block) => block.type === "exclusion" || blockIntentFor(block.type, block.properties) === "prohibit")) {
    issues.push({ id: "missing-boundary", severity: "suggestion", label: "Set an explicit boundary", detail: "Capture any brand, safety, legal, or accuracy failure that must never appear.", blockIds: [] });
  }

  const missingProtectedMessage = new Set<string>();
  const invalidProtectedPlacement = new Set<string>();
  const ungroundedProtectedMessage = new Set<string>();
  for (const message of affirmativeByType("message")) {
    const authored = authoredDecision(message);
    const properties = message.properties;
    const exactSpecified = Object.hasOwn(properties, "exact_text");
    const exact = meaningfulDecision(properties.exact_text) ? properties.exact_text.trim() : "";
    if (exactSpecified && !exact) missingProtectedMessage.add(message.id);
    if (exact && !authored.includes(exact)) ungroundedProtectedMessage.add(message.id);

    if (Object.hasOwn(properties, "exact_placements")) {
      const placements = properties.exact_placements;
      if (!Array.isArray(placements) || placements.some((placement) => !allowedProtectedPlacement(placement))) {
        invalidProtectedPlacement.add(message.id);
      } else if (placements.length && !exact && !Array.isArray(properties.protected_phrases)) {
        missingProtectedMessage.add(message.id);
      }
    }

    if (Object.hasOwn(properties, "protected_phrases")) {
      const protectedPhrases = properties.protected_phrases;
      if (!Array.isArray(protectedPhrases)) {
        missingProtectedMessage.add(message.id);
      } else for (const candidate of protectedPhrases) {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
          missingProtectedMessage.add(message.id);
          continue;
        }
        const phrase = candidate as Record<string, unknown>;
        const text = meaningfulDecision(phrase.text) ? phrase.text.trim() : "";
        if (!text) missingProtectedMessage.add(message.id);
        else if (!authored.includes(text)) ungroundedProtectedMessage.add(message.id);
        if (Object.hasOwn(phrase, "placement") && !allowedProtectedPlacement(phrase.placement)) {
          invalidProtectedPlacement.add(message.id);
        }
      }
    }
  }
  if (missingProtectedMessage.size) issues.push({ id: "missing-protected-message", severity: "warning", label: "Add the exact protected wording", detail: "An explicitly protected message or placement needs meaningful authored wording before it can be preserved.", blockIds: [...missingProtectedMessage] });
  if (invalidProtectedPlacement.size) issues.push({ id: "invalid-protected-message-placement", severity: "warning", label: "Choose a valid protected-message placement", detail: "Protected wording can be required on the opening slide, the closing slide, or both.", blockIds: [...invalidProtectedPlacement] });
  if (ungroundedProtectedMessage.size) issues.push({ id: "protected-message-not-in-context", severity: "warning", label: "Include protected wording in the message", detail: "The exact protected wording must also appear verbatim in its authored Message so every approved output can preserve it.", blockIds: [...ungroundedProtectedMessage] });

  const rights=new Set<string>(),audioRights=new Set<string>();
  for(const event of events){
    if(event.type!=="RightsAsserted"&&event.type!=="ReferenceIngested")continue;
    const id=String(event.payload.reference_id??"");
    if(!id)continue;
    const classification=String(event.payload.rights_class??"");
    if(["owned","owned_or_licensed","account-generated"].includes(classification))rights.add(id);else rights.delete(id);
    if(audioRightsAllowed(classification))audioRights.add(id);else audioRights.delete(id);
  }
  let verifiedSources = 0;
  for(const decision of blocks.filter((block)=>block.type!=="reference")){
    const rightsIssue=creativeContextRightsIssue(decision.properties,now);
    if(rightsIssue)issues.push({id:`decision-rights-${rightsIssue}-${decision.id}`,severity:"blocking",label:"Replace expired licensed context",detail:`The approved rights for “${String(decision.properties.label??decision.handle)}” are ${rightsIssue}.`,blockIds:[decision.id]});
  }
  for (const source of [...byType("reference"),...byType("audio").filter((block)=>Boolean(block.properties.media_url)&&(block.properties.inform_generation===true||block.properties.include_in_output===true||block.properties.allow_provider_audio_transfer===true))]) {
    const referenceId = String(source.properties.reference_id ?? "");
    const rightsIssue=creativeContextRightsIssue(source.properties,now);
    const verifiedReceipt=Boolean(referenceId&&(source.type === "audio" ? audioRights : rights).has(referenceId));
    const authorizedRights=verifiedReceipt&&!rightsIssue;
    if (!verifiedReceipt) {
      issues.push({ id: `source-rights-${source.id}`, severity: "blocking", label: "Verify source rights", detail: `“${String(source.properties.label ?? source.handle)}” does not have a matching rights receipt.`, blockIds: [source.id] });
    }

    if(rightsIssue)issues.push({ id: `source-${rightsIssue}-${source.id}`, severity: "blocking", label: "Replace an expired source", detail: `The rights or freshness window for “${String(source.properties.label ?? source.handle)}” is ${rightsIssue}.`, blockIds: [source.id] });
    const mime = String(source.properties.source_mime_type ?? "").toLowerCase();
    const documentSource=mime === "application/pdf" || mime.includes("officedocument");
    const grounded=!documentSource||(Boolean(String(source.properties.text ?? "").trim())&&source.properties.extraction_status!=="unavailable");
    if(!grounded)issues.push({ id: `source-excerpt-${source.id}`, severity: "blocking", label: "Add a readable source excerpt", detail: String(source.properties.extraction_message ?? "This document is safely attached, but its text could not be extracted into generation context."), blockIds: [source.id] });
    if(authorizedRights&&grounded)verifiedSources+=1;
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
      if(!block||block.removed||block.sourceEvents.length!==Number(version.version??0))return true;
      const properties=block.properties??{};
      if(creativeContextRightsIssue(properties))return true;
      const referenceId=String(properties.reference_id??"");
      if(!referenceId)return false;
      const latest=[...events].reverse().find((event)=>["RightsAsserted","ReferenceIngested"].includes(event.type)
        &&String(event.payload.reference_id??"")===referenceId);
      return Boolean(latest&&!(["owned","owned_or_licensed","account-generated"].includes(String(latest.payload.rights_class??""))));
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
      const revision=documentArtifactRevision(events,sourceId);
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
