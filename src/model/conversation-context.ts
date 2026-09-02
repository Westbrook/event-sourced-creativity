import type { CanvasProjection } from "../canvas/model.ts";
import type { FormaCapability } from "../platform/capabilities.ts";
import { assistantSurfaceForRoute, assistantPlaybookForSurface, type AssistantSurface } from "./assistant-route-policy.ts";
import { blockIntentFor } from "./block-types.ts";
import type { CreativeBlock, CreativeEvent, CreativeProjection } from "./events.ts";
import { unfinishedIntentTrajectories } from "./intent-trajectories.ts";
import { promptFactIsActive } from "./prompt-policy.ts";
import { creativeContextRightsIssue } from "./context-health.ts";

export const ASSISTANT_CONTEXT_LIMITS = {
  turns: 6,
  actions: 12,
  decisions: 16,
  relationships: 8,
  selectedItems: 8,
  intents: 4,
  outputs: 7,
  turnChars: 1_200,
  decisionChars: 320,
  actionChars: 160,
  maxBytes: 16_384,
} as const;

export const ASSISTANT_OUTPUT_KINDS = ["image", "short_story", "scene", "slides", "storyboard", "video", "audio"] as const;

export type AssistantConversationTurn = { id: string; role: "user" | "assistant"; text: string; sequence: number };
export type AssistantDecisionAtom = { id: string; type: string; text: string; intent: string; locked: boolean; focused: boolean; version: number; immutable: boolean; providerEligible: boolean; protected?:boolean; providerVisibility?:"editable"|"governed"|"restricted" };
export type AssistantSelectedItem = { id: string; kind: string; sourceId: string; title: string; documentId: string | null };
export type AssistantRecentAction = { id: string; type: string; sequence: number; documentId: string | null };
export type AssistantOutputSummary = { id: string; kind: string; title: string; documentId: string; status: string };

export type AssistantContext = {
  surface: AssistantSurface;
  scope: { actorUserId: string; organizationId: string | null; projectAccessId: string | null; projectId: string | null; documentId: string | null };
  documentTitle: string | null;
  selectedItems: AssistantSelectedItem[];
  recentTurns: AssistantConversationTurn[];
  recentActions: AssistantRecentAction[];
  decisionAtoms: AssistantDecisionAtom[];
  relationships: Array<{ id: string; from: string; to: string; kind: string }>;
  unfinishedIntents: Array<{ id: string; kind: string; status: string; nextAction: string | null; route: string | null }>;
  availableOutputs: AssistantOutputSummary[];
  availableOutputKinds: readonly string[];
  platformSignals?: Array<{ kind: string; status: string; count: number }>;
  totals: { decisions: number; outputs: number; outputsByKind: Record<string, number>; protectedDecisions?:number; unsafeRightsDecisions?:number; truncatedProtectedDecisions?:number };
  capabilities: readonly FormaCapability[];
  playbook: readonly string[];
  evidence: { head: number; eventIds: string[] };
  truncated: boolean;
};

type AssistantContextInput = {
  route: string;
  events: readonly CreativeEvent[];
  projection: CreativeProjection;
  canvasProjection?: CanvasProjection | null;
  actorUserId: string;
  actorContent?: Readonly<Record<string, string>>;
  capabilities?: readonly FormaCapability[];
  organizationId?: string | null;
  projectAccessId?: string | null;
  projectId?: string | null;
  selectedItemIds?: readonly string[];
  focusedBlockId?: string | null;
  head?: number;
};

const clip = (value: unknown, max: number) => String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);
const actorMatches = (event: CreativeEvent, actorUserId: string) => event.actor === "user" || event.actor === `user:${actorUserId}`;
export const protectedAssistantDecision = (block: CreativeBlock) => block.locked || block.type === "exclusion" || blockIntentFor(block.type, block.properties) === "prohibit"
  ||Boolean(String(block.properties.exact_text??"").trim())
  ||Array.isArray(block.properties.protected_phrases)&&block.properties.protected_phrases.some((phrase)=>typeof phrase==="string"?Boolean(phrase.trim()):Boolean(phrase&&typeof phrase==="object"&&String((phrase as Record<string,unknown>).text??"").trim()))
  ||Array.isArray(block.properties.exact_placements)&&block.properties.exact_placements.length>0;
const displayText = (block: CreativeBlock) => protectedAssistantDecision(block)
  ?String(block.properties.text??block.properties.label??block.handle).trim().slice(0,ASSISTANT_CONTEXT_LIMITS.decisionChars)
  :clip(block.properties.text??block.properties.label??block.handle,ASSISTANT_CONTEXT_LIMITS.decisionChars);
const eventDocument = (event: CreativeEvent) => String(event.payload.document_id ?? "") || null;

/** Compile small, explicitly scoped views. Never forward payload maps, media URLs, or raw streams. */
export function compileAssistantContext(input: AssistantContextInput): AssistantContext {
  const surface = assistantSurfaceForRoute(input.route);
  const authorizedProjectId = input.projectId ?? input.projection.projectId ?? null;
  const documentId = surface.documentId;
  const document = documentId ? input.projection.documents.find((candidate) => candidate.id === documentId && candidate.projectId === authorizedProjectId && !candidate.removed) : undefined;
  const authorizedDocumentId = document?.id ?? null;
  const focusedBlockId = input.focusedBlockId ?? surface.focusedBlockId;
  const authorizedDocumentIds = new Set(input.projection.documents.filter((candidate) => !candidate.removed && candidate.projectId === authorizedProjectId).map((candidate) => candidate.id));

  const visibleEvents = input.events.filter((event) => {
    if (event.type === "ProjectResourceRestricted") return false;
    const eventProjectId = String(event.payload.project_id ?? "");
    if (authorizedProjectId && eventProjectId && eventProjectId !== authorizedProjectId) return false;
    if (authorizedDocumentId && eventDocument(event) && eventDocument(event) !== authorizedDocumentId) return false;
    return true;
  });

  const recentTurns = visibleEvents.filter((event) =>
    (event.type === "ChatMessageSent" && actorMatches(event, input.actorUserId))
      || (event.type === "AssistantReasoned" && event.payload.operation === "creative-chat" && (!event.payload.actor_user_id || event.payload.actor_user_id === input.actorUserId)),
  ).map((event) => {
    const contentRef = String(event.payload.content_ref ?? event.payload.response_ref ?? "");
    const text = clip(input.actorContent?.[contentRef] ?? "", ASSISTANT_CONTEXT_LIMITS.turnChars);
    return { id: event.eventId, role: event.type === "ChatMessageSent" ? "user" as const : "assistant" as const, text, sequence: event.sequence };
  }).filter((turn) => turn.text).slice(-ASSISTANT_CONTEXT_LIMITS.turns);

  const recentActions = visibleEvents.filter((event) => event.type !== "ChatMessageSent" && event.type !== "AssistantReasoned" && (actorMatches(event, input.actorUserId) || event.actor.startsWith("worker:")))
    .slice(-ASSISTANT_CONTEXT_LIMITS.actions)
    .map((event) => ({ id: event.eventId, type: clip(event.type, ASSISTANT_CONTEXT_LIMITS.actionChars), sequence: event.sequence, documentId: eventDocument(event) }));

  const scopedBlocks = authorizedDocumentId
    ? input.projection.blocks.filter((block) => !block.removed && block.projectId === authorizedProjectId && block.documentId === authorizedDocumentId)
    : surface.focusedBlockId
      ? input.projection.libraryBlocks.filter((block) => !block.removed && block.projectId === authorizedProjectId && block.id === surface.focusedBlockId)
      : [];
  const prioritizedBlocks = [...scopedBlocks].sort((left, right) =>
    Number(promptFactIsActive(right)&&protectedAssistantDecision(right))-Number(promptFactIsActive(left)&&protectedAssistantDecision(left))
      ||Number(promptFactIsActive(right))-Number(promptFactIsActive(left))
      || Number(right.id === focusedBlockId) - Number(left.id === focusedBlockId)
      || right.sourceEvents.length - left.sourceEvents.length,
  );
  const activeRightsIssue=(block:CreativeBlock)=>{
    if(creativeContextRightsIssue(block.properties))return true;
    const referenceId=String(block.properties.reference_id??"");
    if(!referenceId)return false;
    const latest=[...visibleEvents].reverse().find((event)=>["RightsAsserted","ReferenceIngested"].includes(event.type)
      &&String(event.payload.reference_id??"")===referenceId);
    return !latest||!(["owned","owned_or_licensed","account-generated"].includes(String(latest.payload.rights_class??"")));
  };
  const outputOwnedBlockIds = new Set(input.projection.libraryBlockRelations
    .filter((relation) => !relation.removed && relation.kind === "artifact_contains")
    .flatMap((relation) => [relation.fromBlockId, relation.toBlockId]));
  const decisionAtoms = prioritizedBlocks.slice(0, ASSISTANT_CONTEXT_LIMITS.decisions).map((block) => {
    const governed=Boolean(block.properties.organization_context_package_binding_id||block.properties.organization_context_package_id);
    const immutable=Boolean(block.properties.source_evidence_hash||governed||block.properties.source_artifact_id
      ||block.properties.source_artifact_item_id||block.properties.context_set_root_id||outputOwnedBlockIds.has(block.id));
    const providerVisibility:AssistantDecisionAtom["providerVisibility"]=block.type==="reference"||block.type==="audio"&&immutable
      ?"restricted":governed?"governed":immutable?"restricted":"editable";
    return{
      id:block.id,type:block.type,text:displayText(block),intent:blockIntentFor(block.type,block.properties),locked:block.locked,protected:protectedAssistantDecision(block),
      focused:block.id===focusedBlockId,version:block.sourceEvents.length,immutable,
      providerEligible:promptFactIsActive(block)&&!activeRightsIssue(block),providerVisibility,
    };
  });
  const visibleBlockIds = new Set(decisionAtoms.map((block) => block.id));
  const relationships = (authorizedDocumentId ? input.projection.blockRelations : input.projection.libraryBlockRelations)
    .filter((relation) => !relation.removed && visibleBlockIds.has(relation.fromBlockId) && visibleBlockIds.has(relation.toBlockId))
    .slice(0, ASSISTANT_CONTEXT_LIMITS.relationships)
    .map((relation) => ({ id: clip(relation.id, 160), from: relation.fromBlockId, to: relation.toBlockId, kind: clip(relation.kind, 64) }));

  const selectedIds = new Set((input.selectedItemIds ?? []).slice(0, ASSISTANT_CONTEXT_LIMITS.selectedItems));
  const selectedItems = (input.canvasProjection?.items ?? [])
    .filter((item) => selectedIds.has(item.id) && !item.removed && item.visible && item.projectId === authorizedProjectId && item.canvasId === surface.canvasId)
    .slice(0, ASSISTANT_CONTEXT_LIMITS.selectedItems)
    .map((item) => ({
      id: item.id,
      kind: item.sourceKind,
      sourceId: item.sourceId,
      title: clip(item.title, ASSISTANT_CONTEXT_LIMITS.actionChars),
      documentId: item.sourceKind === "document" ? item.sourceId : null,
    }));

  const trajectories = unfinishedIntentTrajectories([...visibleEvents], {
    ...(authorizedDocumentId ? { documentId: authorizedDocumentId } : {}),
    ...(authorizedProjectId ? { projectId: authorizedProjectId } : {}),
  }).slice(0, ASSISTANT_CONTEXT_LIMITS.intents).map((intent) => ({
    id: intent.id,
    kind: intent.expectedOutputKind,
    status: intent.status,
    nextAction: intent.nextAction?.label ?? null,
    route: intent.nextAction?.route ?? null,
  }));

  const artifacts = (authorizedDocumentId ? input.projection.artifacts : input.projection.libraryArtifacts)
    .filter((artifact) => authorizedDocumentIds.has(artifact.documentId) && (!authorizedDocumentId || artifact.documentId === authorizedDocumentId))
    .map((artifact) => ({ id: artifact.id, kind: artifact.kind, title: clip(artifact.title, ASSISTANT_CONTEXT_LIMITS.actionChars), documentId: artifact.documentId, status: "ready", sequence: artifact.sequence }));
  const images = (authorizedDocumentId ? input.projection.outputs : input.projection.libraryOutputs)
    .filter((output) => !output.discarded && authorizedDocumentIds.has(output.documentId) && (!authorizedDocumentId || output.documentId === authorizedDocumentId))
    .map((output) => ({ id: output.id, kind: "image", title: clip(output.title?.trim() || "image", ASSISTANT_CONTEXT_LIMITS.actionChars), documentId: output.documentId, status: "ready", sequence: output.sequence }));
  const availableOutputs = [...artifacts, ...images].sort((left, right) => right.sequence - left.sequence)
    .slice(0, ASSISTANT_CONTEXT_LIMITS.outputs)
    .map(({ sequence: _sequence, ...output }) => output);

  const context: AssistantContext = {
    surface,
    scope: { actorUserId: input.actorUserId, organizationId: input.organizationId ?? null, projectAccessId: input.projectAccessId ?? null, projectId: authorizedProjectId, documentId: authorizedDocumentId },
    documentTitle: document ? clip(document.title, ASSISTANT_CONTEXT_LIMITS.actionChars) : null,
    selectedItems,
    recentTurns,
    recentActions,
    decisionAtoms,
    relationships,
    unfinishedIntents: trajectories,
    availableOutputs,
    availableOutputKinds: ASSISTANT_OUTPUT_KINDS,
    totals: {
      decisions: scopedBlocks.length,
      protectedDecisions:scopedBlocks.filter((block)=>promptFactIsActive(block)&&protectedAssistantDecision(block)).length,
      unsafeRightsDecisions:scopedBlocks.filter((block)=>promptFactIsActive(block)&&activeRightsIssue(block)).length,
      truncatedProtectedDecisions:scopedBlocks.filter((block)=>promptFactIsActive(block)&&protectedAssistantDecision(block)&&String(block.properties.text??block.properties.label??block.handle).trim().length>ASSISTANT_CONTEXT_LIMITS.decisionChars).length,
      outputs: artifacts.length + images.length,
      outputsByKind: Object.fromEntries(ASSISTANT_OUTPUT_KINDS.map((kind) => [kind, [...artifacts, ...images].filter((output) => output.kind === kind).length])),
    },
    capabilities: [...(input.capabilities ?? [])],
    playbook: assistantPlaybookForSurface(surface),
    evidence: { head: input.head ?? Math.max(0, ...visibleEvents.map((event) => event.sequence)), eventIds: recentActions.slice(-4).map((event) => event.id) },
    truncated: scopedBlocks.length > decisionAtoms.length || visibleEvents.length > recentActions.length + recentTurns.length,
  };

  return boundAssistantContext(context);
}

/** Apply the byte boundary again whenever authoritative private conversation history is hydrated. */
export function boundAssistantContext(context:AssistantContext){
  // The history may grow without ever growing the provider-facing context.
  while (new TextEncoder().encode(JSON.stringify(context)).byteLength > ASSISTANT_CONTEXT_LIMITS.maxBytes) {
    if (context.recentTurns.length) context.recentTurns.shift();
    else if (context.recentActions.length) context.recentActions.shift();
    else if (context.decisionAtoms.length > 1 && !context.decisionAtoms.at(-1)?.protected && !context.decisionAtoms.at(-1)?.locked && context.decisionAtoms.at(-1)?.intent !== "prohibit")context.decisionAtoms.pop();
    else if (context.availableOutputs.length) context.availableOutputs.pop();
    else if(context.decisionAtoms.length){const removed=context.decisionAtoms.pop();context.relationships=context.relationships.filter((relation)=>relation.from!==removed?.id&&relation.to!==removed?.id);}
    else break;
    context.truncated = true;
  }
  return context;
}
