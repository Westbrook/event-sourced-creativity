import type { CanvasProjection } from "../canvas/model.ts";
import type { FormaCapability } from "../platform/capabilities.ts";
import { assistantSurfaceForRoute, assistantPlaybookForSurface, type AssistantSurface } from "./assistant-route-policy.ts";
import { blockIntentFor } from "./block-types.ts";
import type { CreativeBlock, CreativeEvent, CreativeProjection } from "./events.ts";
import { unfinishedIntentTrajectories } from "./intent-trajectories.ts";
import { promptFactIsActive } from "./prompt-policy.ts";

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
export type AssistantDecisionAtom = { id: string; type: string; text: string; intent: string; locked: boolean; focused: boolean; version: number; immutable: boolean; providerEligible: boolean };
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
  totals: { decisions: number; outputs: number; outputsByKind: Record<string, number> };
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
const protectedDecision = (block: CreativeBlock) => block.locked || block.type === "exclusion" || blockIntentFor(block.type, block.properties) === "prohibit";
const displayText = (block: CreativeBlock) => clip(block.properties.text ?? block.properties.label ?? block.handle, ASSISTANT_CONTEXT_LIMITS.decisionChars);
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
    Number(protectedDecision(right)) - Number(protectedDecision(left))
      || Number(right.id === focusedBlockId) - Number(left.id === focusedBlockId)
      || right.sourceEvents.length - left.sourceEvents.length,
  );
  const outputOwnedBlockIds = new Set(input.projection.libraryBlockRelations
    .filter((relation) => !relation.removed && relation.kind === "artifact_contains")
    .flatMap((relation) => [relation.fromBlockId, relation.toBlockId]));
  const decisionAtoms = prioritizedBlocks.slice(0, ASSISTANT_CONTEXT_LIMITS.decisions).map((block) => ({
    id: block.id,
    type: block.type,
    text: displayText(block),
    intent: blockIntentFor(block.type, block.properties),
    locked: block.locked,
    focused: block.id === focusedBlockId,
    version: block.sourceEvents.length,
    immutable: Boolean(block.properties.source_evidence_hash || block.properties.organization_context_package_binding_id || block.properties.organization_context_package_id
      || block.properties.source_artifact_id || block.properties.source_artifact_item_id || block.properties.context_set_root_id || outputOwnedBlockIds.has(block.id)),
    providerEligible: promptFactIsActive(block),
  }));
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
    .map((output) => ({ id: output.id, kind: "image", title: "image", documentId: output.documentId, status: "ready", sequence: output.sequence }));
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
      outputs: artifacts.length + images.length,
      outputsByKind: Object.fromEntries(ASSISTANT_OUTPUT_KINDS.map((kind) => [kind, [...artifacts, ...images].filter((output) => output.kind === kind).length])),
    },
    capabilities: [...(input.capabilities ?? [])],
    playbook: assistantPlaybookForSurface(surface),
    evidence: { head: input.head ?? Math.max(0, ...visibleEvents.map((event) => event.sequence)), eventIds: recentActions.slice(-4).map((event) => event.id) },
    truncated: scopedBlocks.length > decisionAtoms.length || visibleEvents.length > recentActions.length + recentTurns.length,
  };

  // The history may grow without ever growing the provider-facing context.
  while (new TextEncoder().encode(JSON.stringify(context)).byteLength > ASSISTANT_CONTEXT_LIMITS.maxBytes) {
    if (context.recentTurns.length > 1) context.recentTurns.shift();
    else if (context.recentActions.length > 1) context.recentActions.shift();
    else if (context.decisionAtoms.length > 1 && !context.decisionAtoms.at(-1)?.locked && context.decisionAtoms.at(-1)?.intent !== "prohibit") context.decisionAtoms.pop();
    else if (context.availableOutputs.length) context.availableOutputs.pop();
    else break;
    context.truncated = true;
  }
  return context;
}
