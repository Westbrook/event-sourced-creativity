import { blockEffectFor, blockIntentFor } from "../src/model/block-types.ts";
import { combinedContextGroups } from "../src/model/combined-context.ts";
import { artifactReviewState } from "../src/model/context-health.ts";
import { DOCUMENT_ARTIFACT_KINDS, parseDocumentArtifactContent, type DocumentArtifact, type DocumentArtifactDraft } from "../src/model/document-artifacts.ts";
import { foldEvents, type CreativeEvent, type CreativeOutput } from "../src/model/events.ts";
import { artifactContextEvents, imageOutputContextEvents } from "../src/model/output-context.ts";
import {
  MAX_PRODUCTION_WORKFLOW_SOURCES,
  productionWorkflows,
  productionWorkflowSourcesForStage,
  productionWorkflowSourceIdentity,
  productionWorkflowStageStates,
  type ProductionWorkflowSource,
} from "../src/model/production-workflow.ts";
import type { ProjectExecutionScope } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

const SOURCE_FIELDS = new Set([
  "outputKind", "outputId", "format", "documentId", "sourceEventId", "revision", "contentSha256", "approvalRequired", "allowTextGuidance",
]);

const contentHoldSql = (content: string, artifact: string) => `EXISTS(SELECT 1 FROM organization_legal_holds hold
    WHERE hold.organization_id=${artifact}.organization_id AND hold.status='active'
      AND(hold.scope_kind='organization' OR hold.scope_kind='project' AND hold.resource_id=${artifact}.project_access_id
        OR hold.scope_kind='artifact' AND hold.resource_id=${artifact}.resource_id
        OR hold.scope_kind='content' AND hold.resource_id=${content}.content_id))
  OR EXISTS(SELECT 1 FROM organization_retention_policies policy JOIN private_content_retention_scopes retention
      ON retention.organization_id=policy.organization_id AND retention.content_id=${content}.content_id
        AND retention.project_access_id=${artifact}.project_access_id AND retention.classification='governed-evidence'
    WHERE policy.organization_id=${artifact}.organization_id AND policy.legal_hold=1)`;

const sha256 = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");

export class ProductionWorkflowContextError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "ProductionWorkflowContextError";
  }
}

function normalizedSources(raw: unknown, documentId: string): ProductionWorkflowSource[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_PRODUCTION_WORKFLOW_SOURCES) {
    throw new ProductionWorkflowContextError("workflow_sources_invalid", "Choose a limited set of exact production inputs before continuing.", 400);
  }
  const unique = new Set<string>();
  return raw.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ProductionWorkflowContextError("workflow_source_invalid", "A production input is malformed.", 400);
    }
    const source = value as Record<string, unknown>;
    if (Object.keys(source).some((key) => !SOURCE_FIELDS.has(key))) {
      throw new ProductionWorkflowContextError("workflow_source_untrusted", "Production inputs cannot supply media, creative text, or provider permissions.", 400);
    }
    const outputKind = source.outputKind;
    const format = source.format;
    const outputId = source.outputId;
    const sourceEventId = source.sourceEventId;
    if ((outputKind !== "artifact" && outputKind !== "image")
      || (outputKind === "image" ? format !== "image" : !DOCUMENT_ARTIFACT_KINDS.includes(format as typeof DOCUMENT_ARTIFACT_KINDS[number]))
      || typeof outputId !== "string" || !outputId || outputId.length > 240
      || typeof sourceEventId !== "string" || !sourceEventId || sourceEventId.length > 240
      || source.documentId !== documentId
      || !Number.isSafeInteger(source.revision) || Number(source.revision) < 0
      || typeof source.approvalRequired !== "boolean"
      || typeof source.allowTextGuidance !== "boolean"
      || outputKind === "artifact" && (typeof source.contentSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(source.contentSha256))
      || outputKind === "image" && (source.revision !== 0 || source.approvalRequired || source.contentSha256 !== undefined)
      || format !== "audio" && source.allowTextGuidance) {
      throw new ProductionWorkflowContextError("workflow_source_invalid", "A production input is not an exact, document-owned output revision.", 400);
    }
    const identity = `${outputKind}:${outputId}`;
    if (unique.has(identity)) throw new ProductionWorkflowContextError("workflow_source_duplicated", "Choose each production input only once.", 400);
    unique.add(identity);
    return source as ProductionWorkflowSource;
  });
}

async function scopedArtifactContent(env: WorkerEnv, artifact: DocumentArtifact, ownerId: string, scope?: ProjectExecutionScope) {
  const now = new Date().toISOString();
  if (!artifact.contentRef) throw new ProductionWorkflowContextError("workflow_source_unavailable", "The selected output no longer has readable retained content.", 404);
  const scopeGuard = scope
    ? ` AND EXISTS(SELECT 1 FROM project_resource_scopes artifact JOIN project_resource_scopes retained
        ON retained.project_access_id=artifact.project_access_id AND retained.organization_id=artifact.organization_id AND retained.project_id=artifact.project_id
          AND retained.owner_user_id=artifact.owner_user_id AND retained.resource_kind='content' AND retained.resource_id=private_content.content_id AND retained.visibility='collaborative_output'
        WHERE artifact.project_access_id=? AND artifact.organization_id=? AND artifact.project_id=? AND artifact.owner_user_id=?
          AND artifact.resource_kind='artifact' AND artifact.resource_id=?
          AND(private_content.expires_at>? OR ${contentHoldSql("private_content", "artifact")}))`
    : " AND private_content.expires_at>?";
  const retained = await env.DB.prepare(`SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact' AND redacted_at IS NULL${scopeGuard}`)
    .bind(artifact.contentRef, ownerId, ...(scope
      ? [scope.projectAccessId, scope.organizationId, scope.projectId, ownerId, artifact.id, now]
      : [now])).first<{ content: string }>();
  if (!retained) throw new ProductionWorkflowContextError("workflow_source_unavailable", "The selected output is unavailable or is not authorized for this project.", 404);
  const parsed = parseDocumentArtifactContent(retained.content);
  if (!parsed) throw new ProductionWorkflowContextError("workflow_source_invalid", "The selected output cannot be safely read.", 409);
  return { content: parsed, digest: await sha256(retained.content) };
}

async function scopedImageDirection(env: WorkerEnv, output: CreativeOutput, ownerId: string, scope?: ProjectExecutionScope) {
  if (scope) {
    const allowed = await env.DB.prepare(`SELECT 1 AS present FROM project_resource_scopes
      WHERE project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=?
        AND resource_kind='output' AND resource_id=? AND visibility='collaborative_output' LIMIT 1`)
      .bind(scope.projectAccessId, scope.organizationId, scope.projectId, ownerId, output.id).first();
    if (!allowed) throw new ProductionWorkflowContextError("workflow_source_unauthorized", "The selected image is not authorized for this project.", 403);
    // A shared image never grants another creator access to its actor-private planner receipt.
    // Its original creator may still reuse their own already-authorized written direction.
    if (!output.contentRef) return null;
    const own = await env.DB.prepare(`SELECT content FROM private_content
      WHERE content_id=? AND owner_id=? AND kind='provider-output' AND redacted_at IS NULL AND expires_at>? LIMIT 1`)
      .bind(output.contentRef, scope.actorUserId, new Date().toISOString()).first<{ content: string }>();
    if (!own) return null;
    try { const parsed = JSON.parse(own.content) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; }
    catch { return null; }
  }
  if (!output.contentRef) return null;
  const retained = await env.DB.prepare(`SELECT content FROM private_content
    WHERE content_id=? AND owner_id=? AND kind='provider-output' AND redacted_at IS NULL AND expires_at>? LIMIT 1`)
    .bind(output.contentRef, ownerId, new Date().toISOString()).first<{ content: string }>();
  if (!retained) return null;
  try {
    const parsed = JSON.parse(retained.content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

type ResolvedProductionSource = {
  source: ProductionWorkflowSource;
  artifact?: DocumentArtifact;
  content?: DocumentArtifactDraft;
  image?: CreativeOutput;
  direction?: Record<string, unknown> | null;
};

const PRIVATE_MEDIA_FIELDS = new Set([
  "media_url", "mediaUrl", "provider_media_url", "providerMediaUrl", "source_ref", "sourceRef", "reference_id", "referenceId",
  "source_artifact_input_ref", "source_artifact_content_ref", "source_output_content_ref", "source_output_prompt_ref",
  "source_content_hash", "content_hash", "source_mime_type",
]);

function withoutPrivateMedia(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPrivateMedia);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !PRIVATE_MEDIA_FIELDS.has(key))
    .map(([key, nested]) => [key, withoutPrivateMedia(nested)]));
}

function appendSourceContext(snapshot: Record<string, unknown>, resolved: readonly ResolvedProductionSource[], workflowId: string, stageId: string) {
  const facts = Array.isArray(snapshot.facts) ? [...snapshot.facts] : [];
  const relationships = Array.isArray(snapshot.relationships) ? [...snapshot.relationships] : [];
  for (const [sourceIndex, entry] of resolved.entries()) {
    if (entry.source.format === "audio" && !entry.source.allowTextGuidance) continue;
    let next = 0;
    const idFactory = () => `workflow:${workflowId}:${stageId}:${sourceIndex}:${next++}`;
    const options = {
      documentId: entry.source.documentId,
      projectId: "",
      sourceSurface: "production-workflow",
      positionStart: facts.length,
      positionPrefix: "w",
      idFactory,
    };
    const materialized = entry.artifact
      ? artifactContextEvents(entry.artifact, { ...options, content: entry.content })
      : entry.image
        ? imageOutputContextEvents(entry.image, { ...options, content: entry.direction })
        : { events: [] };
    for (const candidate of materialized.events) {
      if (candidate.type === "BlockCreated") {
        const payload = candidate.payload;
        const original = payload.properties && typeof payload.properties === "object" ? payload.properties as Record<string, unknown> : {};
        const properties = withoutPrivateMedia(original) as Record<string, unknown>;
        if (payload.type === "reference") properties.pixel_reference_mode = "context_only";
        if (payload.type === "audio") {
          properties.inform_generation = entry.source.allowTextGuidance;
          properties.include_in_output = false;
          properties.allow_provider_audio_transfer = false;
        }
        facts.push({
          block_id: String(payload.block_id ?? ""),
          document_id: entry.source.documentId,
          type: String(payload.type ?? "message"),
          role: String(payload.type ?? "message"),
          intent: blockIntentFor(String(payload.type ?? "message"), properties),
          handle: String(payload.handle ?? ""),
          position: String(payload.position ?? ""),
          locked: false,
          active: true,
          effect: blockEffectFor(String(payload.type ?? "message"), properties),
          properties,
          authority: "authored",
          source_event_refs: [entry.source.sourceEventId],
        });
      } else if (candidate.type === "BlockRelationAdded") {
        const payload = candidate.payload;
        relationships.push({
          relation_id: String(payload.relation_id ?? ""),
          from_block_id: String(payload.from_block_id ?? ""),
          to_block_id: String(payload.to_block_id ?? ""),
          kind: String(payload.kind ?? "artifact_contains"),
          properties: payload.properties && typeof payload.properties === "object" ? payload.properties : {},
          source_event_refs: [entry.source.sourceEventId],
        });
      }
      // ReferenceIngested is deliberately ignored: selection never grants pixel/audio transfer rights.
    }
  }
  return { ...snapshot, facts, relationships, context_groups: combinedContextGroups({ facts, relationships }) };
}

/** Resolve current same-document checkpoints after authoritative context, without writing any document block. */
export async function resolveProductionWorkflowContext(input: {
  env: WorkerEnv;
  events: CreativeEvent[];
  documentId: string;
  projectId: string;
  ownerId: string;
  scope?: ProjectExecutionScope;
  snapshot: Record<string, unknown>;
  workflowId?: unknown;
  workflowStageId?: unknown;
  workflowSources?: unknown;
  requestedFormat?: unknown;
}) {
  const sources = normalizedSources(input.workflowSources, input.documentId);
  if (!sources.length) {
    if (input.workflowId === undefined && input.workflowStageId === undefined) return { snapshot: input.snapshot, sources };
  }
  if (typeof input.workflowId !== "string" || !input.workflowId || input.workflowId.length > 120
    || typeof input.workflowStageId !== "string" || !input.workflowStageId || input.workflowStageId.length > 120) {
    throw new ProductionWorkflowContextError("workflow_identity_invalid", "The selected production stage is unavailable.", 400);
  }
  const projection = foldEvents(input.events, Number.POSITIVE_INFINITY, input.documentId, input.projectId);
  const document = projection.documents.find((candidate) => candidate.id === input.documentId && candidate.projectId === input.projectId);
  if (!document) throw new ProductionWorkflowContextError("workflow_document_unavailable", "The selected production document is unavailable.", 404);
  const workflow = productionWorkflows(input.events, document.id, document.projectId).find((candidate) => candidate.id === input.workflowId);
  const stage = workflow?.stages.find((candidate) => candidate.id === input.workflowStageId);
  if (!workflow || !stage || !stage.enabled || input.requestedFormat !== undefined && stage.format !== input.requestedFormat) {
    throw new ProductionWorkflowContextError("workflow_stage_unavailable", "The selected production stage has changed. Review the current production path.", 409);
  }
  const states = productionWorkflowStageStates(workflow, projection, input.events);
  const state = states.find((candidate) => candidate.stage.id === stage.id);
  if (!state || !["missing", "ready"].includes(state.status)) {
    throw new ProductionWorkflowContextError("workflow_stage_blocked", "Complete or review the required production inputs before continuing.", 409);
  }
  const expected = productionWorkflowSourcesForStage(workflow, stage.id, states);
  if (JSON.stringify(productionWorkflowSourceIdentity(sources)) !== JSON.stringify(productionWorkflowSourceIdentity(expected))) {
    throw new ProductionWorkflowContextError("workflow_sources_changed", "The selected production inputs changed. Review the current path before continuing.", 409);
  }
  const resolved: ResolvedProductionSource[] = [];
  for (const source of sources) {
    if (source.outputKind === "image") {
      const image = projection.libraryOutputs.find((candidate) => candidate.id === source.outputId && candidate.documentId === document.id && !candidate.discarded);
      if (!image || image.sourceEventId !== source.sourceEventId || !image.mediaUrl) {
        throw new ProductionWorkflowContextError("workflow_source_stale", "The selected image has changed or is no longer available.", 409);
      }
      const direction = await scopedImageDirection(input.env, image, input.ownerId, input.scope);
      resolved.push({ source, image, direction });
      continue;
    }
    const artifact = projection.libraryArtifacts.find((candidate) => candidate.id === source.outputId && candidate.documentId === document.id && candidate.kind === source.format);
    if (!artifact || artifact.sourceEventId !== source.sourceEventId) {
      throw new ProductionWorkflowContextError("workflow_source_stale", "A selected production output has changed or is no longer available.", 409);
    }
    const revision = input.events.filter((event) => event.type === "DocumentArtifactEdited" && String(event.payload.artifact_id ?? "") === artifact.id).length;
    if (revision !== source.revision) {
      throw new ProductionWorkflowContextError("workflow_source_stale", "A selected output revision changed. Review and choose its current version.", 409);
    }
    const review = artifactReviewState(artifact, projection.libraryBlocks, input.events);
    if (["stale", "unverified", "changes-requested"].includes(review.status)) {
      throw new ProductionWorkflowContextError("workflow_source_stale", "A selected output is outdated, unverifiable, or needs changes.", 409);
    }
    if ((input.scope || source.approvalRequired) && review.status !== "approved") {
      throw new ProductionWorkflowContextError("workflow_source_approval_required", "An independent current approval is required before this output can inform the next stage.", 409);
    }
    const retained = await scopedArtifactContent(input.env, artifact, input.ownerId, input.scope);
    if (retained.digest !== source.contentSha256) {
      throw new ProductionWorkflowContextError("workflow_source_stale", "A selected output's exact content changed. Review and choose it again.", 409);
    }
    resolved.push({ source: { ...source, approvalRequired: Boolean(input.scope || source.approvalRequired) }, artifact, content: retained.content });
  }
  return {
    snapshot: appendSourceContext(input.snapshot, resolved, input.workflowId, input.workflowStageId),
    sources: resolved.map((entry) => entry.source),
  };
}
