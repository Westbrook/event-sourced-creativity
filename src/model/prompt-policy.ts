/** Durable platform terminology must never become model-facing creative copy. */
const INTERNAL_CREATIVE_KEYS = new Set([
  "combined_context",
  "combined_context_memberships",
  "context_group_ids",
  "contextGroupIds",
  "context_groups",
  "context_set_id",
  "contextSetId",
  "content_ref",
  "contentRef",
  "input_ref",
  "inputRef",
  "prompt_ref",
  "promptRef",
  "reference_id",
  "referenceId",
  "source_output_id",
  "sourceOutputId",
  "source_output_content_ref",
  "sourceOutputContentRef",
  "source_output_prompt_ref",
  "sourceOutputPromptRef",
  "source_generation_id",
  "sourceGenerationId",
  "source_artifact_id",
  "sourceArtifactId",
  "source_artifact_item_id",
  "sourceArtifactItemId",
  "scene_id",
  "sceneId",
  "generation_order",
  "generationOrder",
  "source_artifact_content_ref",
  "sourceArtifactContentRef",
  "source_artifact_input_ref",
  "sourceArtifactInputRef",
  "context_set_root_id",
  "contextSetRootId",
  "artifact_markdown",
  "artifactMarkdown",
  "source_document_id",
  "sourceDocumentId",
  "source_claim_ref",
  "sourceClaimRef",
  "source_ref",
  "sourceRef",
  "media_url",
  "mediaUrl",
  "content_hash",
  "contentHash",
  "source_canvas_id",
  "sourceCanvasId",
  "source_canvas_item_ids",
  "sourceCanvasItemIds",
  "copied_from_block_id",
  "copiedFromBlockId",
  "forked_from_block_id",
  "forkedFromBlockId",
  "copied_from_relation_id",
  "copiedFromRelationId",
  "forked_from_relation_id",
  "forkedFromRelationId",
  "source_event_refs",
  "sourceEventIds",
]);

const RENDERING_IDENTIFIER_KEYS = new Set([
  "id", "block_id", "blockId", "document_id", "documentId", "project_id", "projectId",
  "relation_id", "relationId", "preference_id", "preferenceId", "event_id", "eventId",
  "generation_id", "generationId", "artifact_id", "artifactId", "canvas_id", "canvasId",
  "session_id", "sessionId", "request_id", "requestId", "owner_id", "ownerId",
  "user_id", "userId", "stream_id", "streamId", "position", "source_surface", "sourceSurface",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** One deterministic definition of whether a retained decision can influence an output. */
export function promptFactIsActive(value: unknown): boolean {
  if (!isRecord(value)) return true;
  if (value.active === false || value.removed === true) return false;
  const properties = isRecord(value.properties) ? value.properties : null;
  if (properties?.active === false) return false;
  return properties?.weight === undefined || Number(properties.weight) > 0;
}

/**
 * Remove disabled decisions and application-only provenance before provider submission.
 * Combined-context meaning travels separately through its explicit authorial contract.
 */
export function providerFacingCreativeContext(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(providerFacingCreativeContext);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !INTERNAL_CREATIVE_KEYS.has(key))
      .map(([key, item]) => [
        key,
        (key === "facts" || key === "blocks") && Array.isArray(item)
          ? item.filter(promptFactIsActive).map(providerFacingCreativeContext)
          : providerFacingCreativeContext(item),
      ]),
  );
}

const factDescription = (value: unknown) => {
  const fact = isRecord(value) ? value : {};
  const properties = isRecord(fact.properties) ? fact.properties : {};
  return String(properties.text ?? properties.label ?? fact.handle ?? fact.role ?? fact.type ?? "creative decision");
};

function removeRenderingIdentifiers(value: unknown, aliases: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => removeRenderingIdentifiers(item, aliases));
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "subject_block_id" || key === "subjectBlockId") {
      const alias = aliases.get(String(item));
      if (alias) result.subject_decision = alias;
      continue;
    }
    if (RENDERING_IDENTIFIER_KEYS.has(key)) continue;
    result[key] = removeRenderingIdentifiers(item, aliases);
  }
  return result;
}

/** Rendering providers receive request-local semantic references, never durable account IDs. */
export function providerFacingRenderingContext(value: unknown): unknown {
  const context = providerFacingCreativeContext(value);
  if (!isRecord(context)) return context;
  const facts = Array.isArray(context.facts) ? context.facts.filter(isRecord) : [];
  const aliases = new Map(facts.map((fact, index) => [String(fact.block_id ?? fact.id ?? ""), `decision_${index + 1}`]));
  aliases.delete("");
  const descriptions = new Map(facts.map((fact) => [String(fact.block_id ?? fact.id ?? ""), factDescription(fact)]));
  const normalized = removeRenderingIdentifiers(context, aliases) as Record<string, unknown>;
  if (Array.isArray(context.facts)) normalized.facts = facts.map((fact, index) => ({
    decision_key: `decision_${index + 1}`,
    ...removeRenderingIdentifiers(fact, aliases) as Record<string, unknown>,
    order: index + 1,
  }));
  if (Array.isArray(context.relationships)) normalized.relationships = context.relationships.filter(isRecord).flatMap((relation) => {
    const source = String(relation.from_block_id ?? relation.fromBlockId ?? "");
    const target = String(relation.to_block_id ?? relation.toBlockId ?? "");
    if (!aliases.has(source) || !aliases.has(target)) return [];
    return [{
      from_decision: aliases.get(source),
      from_label: descriptions.get(source),
      to_decision: aliases.get(target),
      to_label: descriptions.get(target),
      kind: relation.kind,
      ...(isRecord(relation.properties) && Object.keys(relation.properties).length
        ? { properties: removeRenderingIdentifiers(providerFacingCreativeContext(relation.properties), aliases) }
        : {}),
    }];
  });
  if (Array.isArray(context.pins)) normalized.pins = context.pins.map((pin) => aliases.get(String(pin))).filter(Boolean);
  return normalized;
}

/** Shared behavior expected from all authoring or rendering prompt envelopes. */
export const CREATIVE_PROMPT_GUARDRAILS = [
  "Work only from active, authorized creative decisions.",
  "Treat include and prefer decisions as direction; avoid and prohibit decisions are exclusions, never featured subjects.",
  "Preserve named subjects, ordered reference sets, spatial scope, and combined-context isolation.",
  "Never invent an authorial decision or expose application events, identifiers, provider machinery, or internal metadata.",
  "Return complete, specific, non-repetitive content appropriate to its intended audience and output format.",
] as const;

export const creativePromptGuardrails = () => CREATIVE_PROMPT_GUARDRAILS.join(" ");

/** Evaluation may invent a fictional author, but still obeys real creative boundaries. */
export const creativeEvaluationPromptGuardrails = () => [
  "Keep synthetic identities, authored decisions, and creative provenance fictional and internally coherent.",
  CREATIVE_PROMPT_GUARDRAILS[1],
  CREATIVE_PROMPT_GUARDRAILS[2],
  CREATIVE_PROMPT_GUARDRAILS[4],
  "Never expose application events, identifiers, provider machinery, or internal metadata in user-facing output.",
].join(" ");
