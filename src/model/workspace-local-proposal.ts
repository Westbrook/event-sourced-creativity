import { blockIntentFor, suggestedSubtype, type BlockKind } from "./block-types.ts";
import { creativeContextRightsValidity } from "./context-health.ts";
import type { CreativeBlock, CreativeProjection, EventInput } from "./events.ts";
import type { ContextChange } from "./context-proposal-application.ts";

export const WORKSPACE_QUICK_EDIT_VERSION = "workspace-rule-based-v1";
export type WorkspaceQuickEditIntent = { operationId: string; prompt: string; targetBlockId: string | null };
export type WorkspaceQuickEditReview = WorkspaceQuickEditIntent & {
  rule: "add-decision" | "palette-temperature"; documentTitle: string; targetLabel: string | null;
  origin: "rule-based"; providerCalls: 0; sourceHead: number;
};
export const workspaceQuickEditNeedsTarget = (prompt: string) => /\b(?:warm(?:er)?|cool(?:er)?|temperature)\b/iu.test(prompt);
export function normalizeWorkspaceQuickEditIntent(value: Record<string, unknown>): WorkspaceQuickEditIntent {
  if (typeof value.operationId !== "string" || !/^[A-Za-z0-9_-]{16,120}$/u.test(value.operationId)) throw new Error("workspace_quick_edit_operation_required");
  if (typeof value.prompt !== "string" || !value.prompt.trim() || value.prompt.length > 1200 || Array.from(value.prompt).some((character) => { const code = character.codePointAt(0)!; return code < 32 && ![9, 10, 13].includes(code) || code === 127; })) throw new Error("workspace_quick_edit_prompt_invalid");
  if (value.targetBlockId !== null && value.targetBlockId !== undefined
    && (typeof value.targetBlockId !== "string" || !value.targetBlockId || value.targetBlockId.length > 120)) throw new Error("workspace_quick_edit_target_required");
  return { operationId: value.operationId, prompt: value.prompt, targetBlockId: typeof value.targetBlockId === "string" ? value.targetBlockId : null };
}
export const workspaceQuickEditProtected = (block: CreativeBlock) => block.removed || block.locked
  || Boolean(block.properties.source_evidence_hash)
  || Object.keys(block.properties).some((key) => key.startsWith("organization_context_package_") || key === "organization_context_source_block_id")
  || Boolean(creativeContextRightsValidity(block.properties).issue);

/** This deliberately small local rule set neither calls a model nor invents a target or participants. */
export function buildWorkspaceQuickEditPlan(input: {
  projection: CreativeProjection; intent: WorkspaceQuickEditIntent; sourceHead: number; createId?: () => string;
}): { events: EventInput[]; changes: ContextChange[]; blockIds: string[]; review: WorkspaceQuickEditReview } {
  const { projection, intent, sourceHead } = input, createId = input.createId ?? (() => crypto.randomUUID());
  const document = projection.documents.find((item) => item.id === projection.documentId && item.projectId === projection.projectId && !item.removed);
  if (!document) throw new Error("workspace_quick_edit_document_unavailable");
  const scope = { project_id: projection.projectId, document_id: document.id, source_surface: "workspace-quick-edit", source_operation_id: intent.operationId };
  const blocks = projection.libraryBlocks.filter((block) => block.projectId === projection.projectId && block.documentId === document.id && block.scope === "document" && !block.removed);
  const temperature = workspaceQuickEditNeedsTarget(intent.prompt), target = intent.targetBlockId ? blocks.find((block) => block.id === intent.targetBlockId) : undefined;
  if (intent.targetBlockId && (!target || target.type !== "palette" || !temperature)) throw new Error("workspace_quick_edit_target_unavailable");
  if (temperature && !target) throw new Error("workspace_quick_edit_target_required");
  let mutation: EventInput, change: ContextChange, blockId: string, targetLabel: string | null = null;
  if (target) {
    if (workspaceQuickEditProtected(target)) throw new Error("workspace_quick_edit_target_protected");
    const warm = /\bwarm(?:er)?\b/iu.test(intent.prompt), cool = /\bcool(?:er)?\b/iu.test(intent.prompt);
    if (warm === cool) throw new Error("workspace_quick_edit_temperature_required");
    const next = cool ? "cooler" : "warmer", previous = target.properties.temperature ?? null;
    if (previous === next) throw new Error("workspace_quick_edit_no_change");
    blockId = target.id; targetLabel = String(target.properties.label ?? target.handle);
    mutation = { type: "BlockPropertyEdited", payload: { ...scope, block_id: blockId, property_path: "temperature", old_value: previous, new_value: next } };
    change = { kind: "edit", label: targetLabel, text: String(previous ?? "not set") + " → " + next, type: "palette", targetId: blockId };
  } else {
    const lower = intent.prompt.toLowerCase();
    const type: BlockKind = /avoid|exclude|without|no\s/u.test(lower) ? "exclusion"
      : /composit|framing|layout|balance/u.test(lower) ? "composition"
      : /light|shadow|dusk|daylight/u.test(lower) ? "lighting"
      : /palette|color|colour|hue/u.test(lower) ? "palette"
      : /subject|depict|show|feature/u.test(lower) ? "subject"
      : /style|texture|treatment|aesthetic/u.test(lower) ? "style" : "direction";
    blockId = createId();
    const slug = intent.prompt.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/(^-|-$)/gu, "").slice(0, 38) || "decision";
    const properties = { ...(type === "palette" ? { label: intent.prompt, colors: [] } : { text: intent.prompt }),
      subtype: suggestedSubtype(type), intent: blockIntentFor(type, {}), authority: "authored", weight: .7, created_from: WORKSPACE_QUICK_EDIT_VERSION };
    mutation = { type: "BlockCreated", payload: { ...scope, block_id: blockId, scope: "document", type, handle: type + "/" + slug, position: "z" + String(sourceHead).padStart(8, "0"), properties } };
    change = { kind: "create", label: intent.prompt, text: intent.prompt, type, targetId: blockId };
  }
  return {
    events: [{ type: "ProposalAccepted", payload: { ...scope, proposal_id: intent.operationId, expected_sequence: sourceHead, proposal_kind: WORKSPACE_QUICK_EDIT_VERSION, explicit_user_action: true } }, mutation],
    changes: [change], blockIds: [blockId],
    review: { ...intent, rule: target ? "palette-temperature" : "add-decision", documentTitle: document.title, targetLabel, origin: "rule-based", providerCalls: 0, sourceHead },
  };
}

/** Only the server-owned authoring port may admit this complete two-event grammar. */
export function validWorkspaceQuickEditEvents(events: readonly { type?: string; payload?: Record<string, unknown> }[]): boolean {
  if (events.length !== 2) return false;
  const [acceptance, mutation] = events, accepted = acceptance?.payload, payload = mutation?.payload;
  if (acceptance?.type !== "ProposalAccepted" || !accepted || !payload || accepted.proposal_kind !== WORKSPACE_QUICK_EDIT_VERSION
    || accepted.explicit_user_action !== true || typeof accepted.proposal_id !== "string"
    || !/^[A-Za-z0-9_-]{16,120}$/u.test(accepted.proposal_id) || accepted.source_operation_id !== accepted.proposal_id
    || !Number.isSafeInteger(accepted.expected_sequence) || Number(accepted.expected_sequence) < 0
    || [accepted, payload].some((item) => item.source_surface !== "workspace-quick-edit" || item.source_operation_id !== accepted.proposal_id
      || item.project_id !== accepted.project_id || item.document_id !== accepted.document_id || item.canvas_id !== undefined)
    || typeof accepted.project_id !== "string" || !accepted.project_id || typeof accepted.document_id !== "string" || !accepted.document_id) return false;
  if (Object.keys(accepted).some((key) => !["project_id", "document_id", "source_surface", "source_operation_id", "proposal_id", "expected_sequence", "proposal_kind", "explicit_user_action"].includes(key))
    || typeof payload.block_id !== "string" || !payload.block_id || payload.block_id.length > 120) return false;
  if (mutation?.type === "BlockPropertyEdited") return payload.property_path === "temperature"
    && Object.keys(payload).every((key) => ["project_id", "document_id", "source_surface", "source_operation_id", "block_id", "property_path", "old_value", "new_value"].includes(key))
    && Object.hasOwn(payload, "old_value") && ["cooler", "warmer"].includes(String(payload.new_value));
  const properties = payload.properties && typeof payload.properties === "object" && !Array.isArray(payload.properties) ? payload.properties as Record<string, unknown> : null;
  return mutation?.type === "BlockCreated" && payload.scope === "document"
    && Object.keys(payload).every((key) => ["project_id", "document_id", "source_surface", "source_operation_id", "block_id", "scope", "type", "handle", "position", "properties"].includes(key))
    && ["exclusion", "composition", "lighting", "palette", "subject", "style", "direction"].includes(String(payload.type))
    && properties?.created_from === WORKSPACE_QUICK_EDIT_VERSION && properties.authority === "authored"
    && Object.keys(properties).every((key) => ["label", "colors", "text", "subtype", "intent", "authority", "weight", "created_from"].includes(key))
    && properties.subtype === suggestedSubtype(payload.type as BlockKind) && properties.intent === blockIntentFor(payload.type as BlockKind, {}) && properties.weight === .7
    && (payload.type === "palette" ? typeof properties.label === "string" && Array.isArray(properties.colors) && properties.colors.length === 0
      : typeof properties.text === "string") && typeof payload.handle === "string" && typeof payload.position === "string";
}
