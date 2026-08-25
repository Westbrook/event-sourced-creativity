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
  "root_block_id",
  "rootBlockId",
  "parent_block_id",
  "parentBlockId",
  "ancestor_block_ids",
  "ancestorBlockIds",
  "parent_group_id",
  "parentGroupId",
  "root_group_id",
  "rootGroupId",
  "context_path_ids",
  "contextPathIds",
  "relation_path_ids",
  "relationPathIds",
  "artifact_markdown",
  "artifactMarkdown",
  "source_document_id",
  "sourceDocumentId",
  "source_claim_ref",
  "sourceClaimRef",
  "source_ref",
  "sourceRef",
  "source_url",
  "sourceUrl",
  "source_uri",
  "sourceUri",
  "source_path",
  "sourcePath",
  "media_url",
  "mediaUrl",
  "content_hash",
  "contentHash",
  "source_content_hash",
  "sourceContentHash",
  "source_evidence_hash",
  "sourceEvidenceHash",
  "source_fingerprint",
  "sourceFingerprint",
  "context_fingerprint",
  "contextFingerprint",
  "parent_context_fingerprint",
  "parentContextFingerprint",
  "sha256",
  "source_aliases",
  "sourceAliases",
  "source_alias_map",
  "sourceAliasMap",
  "presentation_source_contract",
  "presentationSourceContract",
  "authorization",
  "api_key",
  "apiKey",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "client_secret",
  "clientSecret",
  "credentials",
  "password",
  "private_content",
  "privateContent",
  "private_content_ref",
  "privateContentRef",
  "private_input",
  "privateInput",
  "private_inputs",
  "privateInputs",
  "input_receipt",
  "inputReceipt",
  "provider_input",
  "providerInput",
  "inform_generation",
  "include_in_output",
  "allow_provider_audio_transfer",
  "source_mime_type",
  "rights_class",
  "provider_media_url",
  "providerMediaUrl",
  "frozen_inputs",
  "frozenInputs",
  "organization_context_source_block_id",
  "organizationContextSourceBlockId",
  "organization_context_package_id",
  "organizationContextPackageId",
  "organization_context_package_version_id",
  "organizationContextPackageVersionId",
  "organization_context_package_binding_id",
  "organizationContextPackageBindingId",
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
  "source_event_id",
  "sourceEventId",
  "event_ids",
  "eventIds",
  "sourceEventIds",
]);

const RENDERING_IDENTIFIER_KEYS = new Set([
  "id", "block_id", "blockId", "document_id", "documentId", "project_id", "projectId",
  "relation_id", "relationId", "preference_id", "preferenceId", "event_id", "eventId",
  "generation_id", "generationId", "artifact_id", "artifactId", "canvas_id", "canvasId",
  "session_id", "sessionId", "request_id", "requestId", "owner_id", "ownerId",
  "user_id", "userId", "actor_id", "actorId", "account_id", "accountId",
  "actor_user_id", "actorUserId", "owner_user_id", "ownerUserId",
  "organization_id", "organizationId", "tenant_id", "tenantId", "workspace_id", "workspaceId",
  "workflow_id", "workflowId", "intent_id", "intentId", "parent_intent_id", "parentIntentId",
  "source_context_id", "sourceContextId", "resource_id", "resourceId",
  "stream_id", "streamId", "position", "source_surface", "sourceSurface",
  "requiredBlockIds", "required_block_ids", "sourceBlockIds", "source_block_ids",
  "sourceClaimIds", "source_claim_ids", "referenceIds", "reference_ids",
  "source_id", "sourceId", "source_ids", "sourceIds", "source_block_id", "sourceBlockId",
  "block_ids", "blockIds", "claim_id", "claimId", "claim_ids", "claimIds",
  "source_claim_id", "sourceClaimId", "evidence_id", "evidenceId", "source_evidence_id", "sourceEvidenceId",
  "from_block_id", "fromBlockId", "to_block_id", "toBlockId",
  "root_block_id", "rootBlockId", "parent_block_id", "parentBlockId",
  "ancestor_block_ids", "ancestorBlockIds", "parent_group_id", "parentGroupId",
  "root_group_id", "rootGroupId", "context_path_ids", "contextPathIds",
  "relation_path_ids", "relationPathIds",
  "group_id", "groupId", "private_group_id", "privateGroupId", "context_group_id", "contextGroupId",
  "contextGroupIds", "context_group_ids", "sourceArtifactItemIds", "source_artifact_item_ids",
  "context_set_ids", "contextSetIds", "source_block_versions", "sourceBlockVersions",
  "sourceEventRefs", "source_event_refs", "evidenceRefs", "evidence_refs",
  "source_key", "sourceKey", "source_group_keys", "sourceGroupKeys",
  "source_claim_keys", "sourceClaimKeys", "source_block_key", "sourceBlockKey",
  "target_id", "targetId",
]);

/** Trusted, request-local source mapping. Durable values must never be serialized. */
export type ProviderFacingSourceAlias = {
  alias: string;
  sourceId: string;
  sourceKind: "block" | "claim" | "context-group";
  blockId?: string;
  contextGroupIds?: readonly string[];
  label?: string;
};

type ProviderFacingSourceAliasLookup = {
  blocks: ReadonlyMap<string, string>;
  groups: ReadonlyMap<string, string>;
  claims: ReadonlyMap<string, { alias: string; blockId: string | null }>;
  claimsByBlock: ReadonlyMap<string, readonly string[]>;
  groupsByBlock: ReadonlyMap<string, readonly string[]>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const AUDIO_REFERENCE_METADATA_KEY = /(?:^|_)(?:asset|bytes|content|credentials?|file|fingerprint|hash|include|input|licen[cs]e|lyrics?|media|mime|output|provenance|provider|references?|rights?|samples?|secrets?|sources?|tokens?|tracks?|transcripts?|transfer|uploads?|uri|url|waveforms?)(?:_|$)/i;

function hasAudioReferenceMetadata(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasAudioReferenceMetadata);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) =>
    AUDIO_REFERENCE_METADATA_KEY.test(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2"))
    || hasAudioReferenceMetadata(item));
}

/** One deterministic definition of whether a retained decision can influence an output. */
export function promptFactIsActive(value: unknown): boolean {
  if (!isRecord(value)) return true;
  if (value.active === false || value.removed === true) return false;
  const properties = isRecord(value.properties) ? value.properties : null;
  if (properties?.active === false) return false;
  const audioSource=value.type==="audio"||value.role==="audio"
    ||Boolean(properties&&[properties.source_mime_type,properties.media_type].some((mime)=>String(mime??"").toLowerCase().startsWith("audio/")))
    ||Boolean(properties?.media_url&&properties?.audio_role);
  if (audioSource && properties?.inform_generation !== true) {
    const authoredTextOnly = properties !== null
      && typeof properties.text === "string"
      && properties.text.trim().length > 0
      && !Object.hasOwn(value, "inform_generation")
      && !Object.hasOwn(properties, "inform_generation")
      && !hasAudioReferenceMetadata(value);
    if (!authoredTextOnly) return false;
  }
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

const aliasPatternFor = (kind: ProviderFacingSourceAlias["sourceKind"]) =>
  kind === "block" ? /^blk_\d{3,}$/ : kind === "claim" ? /^clm_\d{3,}$/ : /^grp_\d{3,}$/;

/** Reject malformed, duplicate, and conflicting aliases instead of guessing their source. */
function providerFacingSourceAliasLookup(sources: readonly ProviderFacingSourceAlias[]): ProviderFacingSourceAliasLookup {
  const valid = sources.filter((source) => source && typeof source === "object"
    && (source.sourceKind === "block" || source.sourceKind === "claim" || source.sourceKind === "context-group")
    && typeof source.alias === "string" && aliasPatternFor(source.sourceKind).test(source.alias)
    && typeof source.sourceId === "string" && source.sourceId.length > 0);
  const aliasCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  for (const source of valid) {
    aliasCounts.set(source.alias, (aliasCounts.get(source.alias) ?? 0) + 1);
    const key = `${source.sourceKind}\u0000${source.sourceId}`;
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
  }

  const blocks = new Map<string, string>();
  const groups = new Map<string, string>();
  const claims = new Map<string, { alias: string; blockId: string | null }>();
  const claimsByBlock = new Map<string, string[]>();
  const groupsByBlock = new Map<string, string[]>();
  for (const source of valid) {
    if (aliasCounts.get(source.alias) !== 1 || sourceCounts.get(`${source.sourceKind}\u0000${source.sourceId}`) !== 1) continue;
    if (source.sourceKind === "block") {
      blocks.set(source.sourceId, source.alias);
      if (Array.isArray(source.contextGroupIds)) groupsByBlock.set(source.sourceId, source.contextGroupIds.filter((id): id is string => typeof id === "string"));
      continue;
    }
    if (source.sourceKind === "context-group") {
      groups.set(source.sourceId, source.alias);
      continue;
    }
    claims.set(source.sourceId, { alias: source.alias, blockId: typeof source.blockId === "string" && source.blockId ? source.blockId : null });
    if (typeof source.blockId === "string" && source.blockId) {
      const existing = claimsByBlock.get(source.blockId) ?? [];
      existing.push(source.alias);
      claimsByBlock.set(source.blockId, existing);
    }
  }

  for (const aliases of claimsByBlock.values()) aliases.sort();
  return { blocks, groups, claims, claimsByBlock, groupsByBlock };
}

const stringValues = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
  : typeof value === "string" && value.length > 0 ? [value] : [];

function factSourceGroupIds(fact: Record<string, unknown>): string[] {
  const properties = isRecord(fact.properties) ? fact.properties : {};
  const memberships = [fact.combined_context_memberships, fact.combinedContextMemberships,
    properties.combined_context_memberships, properties.combinedContextMemberships]
    .flatMap((value) => Array.isArray(value) ? value : [])
    .filter(isRecord)
    .flatMap((membership) => stringValues(membership.context_set_id ?? membership.contextSetId
      ?? membership.context_group_id ?? membership.contextGroupId ?? membership.group_id ?? membership.groupId));
  return [...new Set([
    ...stringValues(fact.context_group_ids), ...stringValues(fact.contextGroupIds),
    ...stringValues(properties.context_group_ids), ...stringValues(properties.contextGroupIds),
    ...memberships,
  ])];
}

function factSourceClaimIds(fact: Record<string, unknown>): string[] {
  const properties = isRecord(fact.properties) ? fact.properties : {};
  const claims = [fact.claims, properties.claims]
    .flatMap((value) => Array.isArray(value) ? value : [])
    .filter(isRecord)
    .flatMap((claim) => stringValues(claim.claim_id ?? claim.claimId ?? claim.source_claim_id ?? claim.sourceClaimId ?? claim.id));
  return [...new Set([
    ...stringValues(fact.source_claim_ids), ...stringValues(fact.sourceClaimIds),
    ...stringValues(properties.source_claim_ids), ...stringValues(properties.sourceClaimIds),
    ...stringValues(fact.claim_ids), ...stringValues(fact.claimIds),
    ...stringValues(properties.claim_ids), ...stringValues(properties.claimIds),
    ...claims,
  ])];
}

/** Rendering providers receive request-local semantic references, never durable account IDs. */
export function providerFacingRenderingContext(value: unknown, sources?: readonly ProviderFacingSourceAlias[]): unknown {
  const context = providerFacingCreativeContext(value);
  if (!isRecord(context)) return context;
  const facts = Array.isArray(context.facts) ? context.facts.filter(isRecord) : [];
  const aliases = new Map(facts.map((fact, index) => [String(fact.block_id ?? fact.id ?? ""), `decision_${index + 1}`]));
  aliases.delete("");
  const descriptions = new Map(facts.map((fact) => [String(fact.block_id ?? fact.id ?? ""), factDescription(fact)]));
  const sourceAliases = providerFacingSourceAliasLookup(sources ?? []);
  const rawFacts = isRecord(value) && Array.isArray(value.facts)
    ? value.facts.filter(promptFactIsActive).filter(isRecord)
    : [];
  const factsById = new Map(rawFacts.map((fact) => [String(fact.block_id ?? fact.id ?? ""), fact]));
  const normalized = removeRenderingIdentifiers(context, aliases) as Record<string, unknown>;
  if (Array.isArray(context.facts)) normalized.facts = facts.map((fact, index) => {
    const blockId = String(fact.block_id ?? fact.id ?? "");
    const sourceKey = sourceAliases.blocks.get(blockId);
    const rawFact = factsById.get(blockId);
    const groupKeys = sourceKey && rawFact
      ? [...new Set([...factSourceGroupIds(rawFact), ...(sourceAliases.groupsByBlock.get(blockId) ?? [])]
        .map((groupId) => sourceAliases.groups.get(groupId)).filter((alias): alias is string => Boolean(alias)))]
      : [];
    const claimKeys = sourceKey && rawFact
      ? [...new Set([...(sourceAliases.claimsByBlock.get(blockId) ?? []), ...factSourceClaimIds(rawFact)
        .map((claimId) => {
          const claim = sourceAliases.claims.get(claimId);
          return claim && (!claim.blockId || claim.blockId === blockId) ? claim.alias : undefined;
        }).filter((alias): alias is string => Boolean(alias))])].sort()
      : [];
    return {
      decision_key: `decision_${index + 1}`,
      ...(sourceKey ? { source_key: sourceKey } : {}),
      ...(groupKeys.length ? { source_group_keys: groupKeys } : {}),
      ...(claimKeys.length ? { source_claim_keys: claimKeys } : {}),
      ...removeRenderingIdentifiers(fact, aliases) as Record<string, unknown>,
      order: index + 1,
    };
  });
  if (sources && Array.isArray(context.blocks)) {
    const blocks = isRecord(value) && Array.isArray(value.blocks) ? value.blocks.filter(promptFactIsActive).filter(isRecord) : [];
    normalized.blocks = blocks.flatMap((block) => {
      const blockId = String(block.block_id ?? block.blockId ?? block.id ?? "");
      const sourceKey = sourceAliases.blocks.get(blockId);
      if (!sourceKey) return [];
      return [{
        source_key: sourceKey,
        ...removeRenderingIdentifiers(providerFacingCreativeContext(block), aliases) as Record<string, unknown>,
      }];
    });
  }
  if (sources && Array.isArray(context.claims)) {
    const claims = isRecord(value) && Array.isArray(value.claims) ? value.claims.filter(promptFactIsActive).filter(isRecord) : [];
    normalized.claims = claims.flatMap((claim) => {
      const claimId = String(claim.claim_id ?? claim.claimId ?? claim.source_claim_id ?? claim.sourceClaimId ?? claim.id ?? "");
      const source = sourceAliases.claims.get(claimId);
      if (!source) return [];
      const claimedBlockId = String(claim.block_id ?? claim.blockId ?? claim.source_block_id ?? claim.sourceBlockId ?? "");
      const blockId = source.blockId ?? claimedBlockId;
      const blockAlias = blockId ? sourceAliases.blocks.get(blockId) : undefined;
      if (!blockAlias || (rawFacts.length > 0 && !factsById.has(blockId)) || (claimedBlockId && claimedBlockId !== blockId)) return [];
      return [{
        source_key: source.alias,
        source_block_key: blockAlias,
        ...removeRenderingIdentifiers(providerFacingCreativeContext(claim), aliases) as Record<string, unknown>,
      }];
    });
  }
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
  "Preserve complete authored numbered slide outlines, their original order and section boundaries, and every protected stakeholder quotation with its exact wording, speaker, and role.",
  "Retain every labeled numerical fact without changing precision or confusing exact values with rounded display values; preserve authored destinations, work modes, device postures, roadmap durations, and requested terminology.",
  "Ground attributed claims only in explicitly supplied request-local source aliases; never invent, expose, or infer a durable source identifier.",
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
