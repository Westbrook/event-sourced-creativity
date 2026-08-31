import { artifactReviewState } from "./context-health.ts";
import { artifactReviewBindingMatches, artifactReviewParticipants } from "./artifact-delivery.ts";
import { DOCUMENT_ARTIFACT_KINDS, documentArtifactRevision, type DocumentArtifact, type DocumentArtifactKind } from "./document-artifacts.ts";
import type { CreativeEvent, CreativeOutput, CreativeProjection } from "./events.ts";
import type { ProductionFormat } from "./managed-production.ts";
import { createSceneConfiguration, isSceneMedium, type SceneConfiguration, type SceneMedium } from "./scene-configuration.ts";

export const DOCUMENT_PRODUCTION_WORKFLOW_EVENT = "DocumentProductionWorkflowConfigured";
export const MAX_PRODUCTION_WORKFLOW_STAGES = 12;
export const MAX_PRODUCTION_WORKFLOW_SOURCES = 12;

export type ProductionWorkflowSource = {
  outputKind: "artifact" | "image";
  outputId: string;
  format: ProductionFormat;
  documentId: string;
  sourceEventId: string;
  revision: number;
  contentSha256?: string;
  approvalRequired: boolean;
  allowTextGuidance: boolean;
};

export type ProductionWorkflowStage = {
  id: string;
  format: ProductionFormat;
  dependsOn: string[];
  optional: boolean;
  enabled: boolean;
  final: boolean;
  approvalRequired: boolean;
  source: ProductionWorkflowSource | null;
  sceneMedium?: "auto" | SceneMedium;
};

export type ProductionWorkflow = {
  id: string;
  documentId: string;
  projectId: string;
  target: ProductionFormat;
  approvalRequired: boolean;
  stages: ProductionWorkflowStage[];
};

export type ProductionWorkflowStageStatus =
  | "ready"
  | "missing"
  | "selected"
  | "approved"
  | "in-review"
  | "needs-review"
  | "changes-requested"
  | "stale"
  | "blocked"
  | "running"
  | "complete"
  | "skipped";

export type ProductionWorkflowStageState = {
  stage: ProductionWorkflowStage;
  status: ProductionWorkflowStageStatus;
  inputFreshness: "current" | "changed" | null;
  artifact: DocumentArtifact | null;
  image: CreativeOutput | null;
  dependencies: ProductionWorkflowStageState[];
  actionable: boolean;
};

type StageRecipe = { format: ProductionFormat; optional?: boolean; dependsOn?: ProductionFormat[] };

const PRODUCTION_WORKFLOW_RECIPES: Record<ProductionFormat, readonly StageRecipe[]> = {
  // The dedicated 3D adapter is a single explicit generation; no planner stages are implied.
  model3d: [],
  image: [
    { format: "short_story", optional: true },
    { format: "scene", optional: true, dependsOn: ["short_story"] },
    { format: "storyboard", optional: true, dependsOn: ["scene"] },
    { format: "audio", optional: true, dependsOn: ["scene"] },
  ],
  short_story: [],
  scene: [{ format: "short_story", optional: true }],
  slides: [{ format: "short_story", optional: true }, { format: "image", optional: true }],
  storyboard: [
    { format: "short_story", optional: true },
    { format: "scene", optional: true, dependsOn: ["short_story"] },
    { format: "image", optional: true },
  ],
  video: [
    { format: "short_story", optional: true },
    { format: "scene", optional: true, dependsOn: ["short_story"] },
    { format: "image", optional: true },
    { format: "storyboard", optional: true, dependsOn: ["scene", "image"] },
    { format: "audio", optional: true, dependsOn: ["scene"] },
  ],
  audio: [
    { format: "short_story", optional: true },
    { format: "scene", optional: true, dependsOn: ["short_story"] },
    { format: "image", optional: true },
  ],
};

const validFormat = (value: unknown): value is ProductionFormat =>
  value === "image" || DOCUMENT_ARTIFACT_KINDS.includes(value as DocumentArtifactKind);

/** Suggest useful artistic handoffs without turning every format into a mandatory waterfall. */
export function recommendProductionWorkflow(input: {
  id: string;
  documentId: string;
  projectId: string;
  target: ProductionFormat;
  approvalRequired?: boolean;
}): ProductionWorkflow {
  const recipes = PRODUCTION_WORKFLOW_RECIPES[input.target];
  const stages: ProductionWorkflowStage[] = recipes.map((recipe, index) => ({
    id: `${recipe.format}-${index + 1}`,
    format: recipe.format,
    dependsOn: (recipe.dependsOn ?? [])
      .map((format) => recipes.findIndex((candidate, candidateIndex) => candidateIndex < index && candidate.format === format))
      .filter((position) => position >= 0)
      .map((position) => `${recipes[position]!.format}-${position + 1}`),
    optional: recipe.optional !== false,
    enabled: false,
    final: false,
    approvalRequired: recipe.format !== "image" && input.approvalRequired === true,
    source: null,
    ...(recipe.format === "scene" ? { sceneMedium: "auto" as const } : {}),
  }));
  stages.push({
    id: `${input.target}-final`,
    format: input.target,
    dependsOn: stages.map((stage) => stage.id),
    optional: false,
    enabled: true,
    final: true,
    approvalRequired: false,
    source: null,
    ...(input.target === "scene" ? { sceneMedium: "auto" as const } : {}),
  });
  return { id: input.id, documentId: input.documentId, projectId: input.projectId, target: input.target, approvalRequired: input.approvalRequired === true, stages };
}

/** Follow enabled handoffs while retaining the final goal for a later alternate scene render. */
export function productionWorkflowSceneConfiguration(
  workflow: ProductionWorkflow,
  stageId: string,
  requestedMedium?: SceneMedium,
): SceneConfiguration | null {
  const stageIndex = workflow.stages.findIndex((stage) => stage.id === stageId && stage.format === "scene");
  if (stageIndex < 0) return null;

  const stage = workflow.stages[stageIndex]!;
  const reachableStages = new Set([stage.id]);
  const downstreamFormats: ProductionFormat[] = [];

  for (const candidate of workflow.stages.slice(stageIndex + 1)) {
    if (!candidate.enabled || !candidate.dependsOn.some((dependency) => reachableStages.has(dependency))) continue;
    reachableStages.add(candidate.id);
    if (!downstreamFormats.includes(candidate.format)) downstreamFormats.push(candidate.format);
  }

  if (!downstreamFormats.includes(workflow.target)) downstreamFormats.push(workflow.target);

  const explicitMedium = isSceneMedium(requestedMedium)
    ? requestedMedium
    : isSceneMedium(stage.sceneMedium)
      ? stage.sceneMedium
      : null;
  const directionalFormats = downstreamFormats.filter((format) =>
    format === "audio" || format === "image" || format === "storyboard" || format === "video" || format === "slides",
  );
  const inferredMedium: SceneMedium = directionalFormats.at(-1) === "audio" ? "audio" : "visual";

  return createSceneConfiguration(explicitMedium ?? inferredMedium, {
    source: explicitMedium ? "manual" : "production-path",
    targetFormat: workflow.target,
    downstreamFormats,
  });
}

export function productionWorkflowIssues(workflow: ProductionWorkflow): string[] {
  const issues: string[] = [];
  if (!workflow.id || !workflow.documentId || !workflow.projectId) issues.push("workflow_scope_missing");
  if (!validFormat(workflow.target)) issues.push("workflow_target_invalid");
  if (typeof workflow.approvalRequired !== "boolean") issues.push("workflow_approval_invalid");
  if (!Array.isArray(workflow.stages) || !workflow.stages.length || workflow.stages.length > MAX_PRODUCTION_WORKFLOW_STAGES) {
    return [...new Set([...issues, "workflow_stage_count_invalid"])];
  }
  if (workflow.stages.some((stage) => !stage || typeof stage !== "object" || Array.isArray(stage))) {
    return [...new Set([...issues, "workflow_stage_shape_invalid"])];
  }
  const finals = workflow.stages.filter((stage) => stage.final);
  if (finals.length !== 1 || finals[0]?.format !== workflow.target || workflow.stages.at(-1)?.id !== finals[0]?.id) {
    issues.push("workflow_final_output_invalid");
  }
  const seen = new Set<string>();
  let sourceCount = 0;
  for (const stage of workflow.stages) {
    if (typeof stage.id !== "string" || !stage.id || stage.id.length > 120 || seen.has(stage.id)) issues.push("workflow_stage_identity_invalid");
    if (!validFormat(stage.format)) issues.push("workflow_stage_format_invalid");
    if (stage.sceneMedium !== undefined && (stage.format !== "scene" || stage.sceneMedium !== "auto" && !isSceneMedium(stage.sceneMedium))) {
      issues.push("workflow_scene_medium_invalid");
    }
    if (stage.final && (stage.optional || !stage.enabled || stage.source)) issues.push("workflow_final_output_invalid");
    if (typeof stage.optional !== "boolean" || typeof stage.enabled !== "boolean" || typeof stage.final !== "boolean" || typeof stage.approvalRequired !== "boolean") {
      issues.push("workflow_stage_shape_invalid");
    }
    if (!Array.isArray(stage.dependsOn) || stage.dependsOn.some((dependency) => typeof dependency !== "string" || dependency === stage.id || !seen.has(dependency)) || new Set(stage.dependsOn).size !== stage.dependsOn.length) {
      issues.push("workflow_dependency_invalid");
    }
    if (stage.source) {
      sourceCount += 1;
      if (typeof stage.source !== "object" || Array.isArray(stage.source)) {
        issues.push("workflow_source_shape_invalid");
      } else {
        if (stage.source.format !== stage.format || stage.source.documentId !== workflow.documentId) issues.push("workflow_source_scope_invalid");
        if (stage.source.outputKind !== (stage.format === "image" ? "image" : "artifact")) issues.push("workflow_source_kind_invalid");
        if (typeof stage.source.outputId !== "string" || !stage.source.outputId || stage.source.outputId.length > 240
          || typeof stage.source.sourceEventId !== "string" || !stage.source.sourceEventId || stage.source.sourceEventId.length > 240
          || !Number.isSafeInteger(stage.source.revision) || stage.source.revision < 0
          || typeof stage.source.approvalRequired !== "boolean" || typeof stage.source.allowTextGuidance !== "boolean"
          || stage.source.contentSha256 !== undefined && !/^[a-f0-9]{64}$/u.test(stage.source.contentSha256)) {
          issues.push("workflow_source_shape_invalid");
        }
      }
    }
    seen.add(stage.id);
  }
  if (sourceCount > MAX_PRODUCTION_WORKFLOW_SOURCES) issues.push("workflow_source_count_invalid");
  return [...new Set(issues)];
}

export function productionWorkflows(events: readonly CreativeEvent[], documentId: string, projectId = ""): ProductionWorkflow[] {
  const workflows = new Map<string, ProductionWorkflow>();
  for (const event of events) {
    if (event.type !== DOCUMENT_PRODUCTION_WORKFLOW_EVENT || String(event.payload.document_id ?? "") !== documentId) continue;
    if (projectId && String(event.payload.project_id ?? "") !== projectId) continue;
    const workflow = event.payload.workflow;
    if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) continue;
    const candidate = workflow as ProductionWorkflow;
    if (candidate.id !== String(event.payload.workflow_id ?? "") || candidate.documentId !== documentId) continue;
    if (projectId && candidate.projectId !== projectId) continue;
    if (!Array.isArray(candidate.stages) || productionWorkflowIssues(candidate).length) continue;
    workflows.set(candidate.id, candidate);
  }
  return [...workflows.values()];
}

const recordedSceneMedium = (value: unknown): SceneMedium | null =>
  value === undefined || value === null ? "visual" : isSceneMedium(value) ? value : null;

const completedSceneMedium = (event: CreativeEvent): SceneMedium | null => {
  const settings = event.payload.settings;
  const configured = settings && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as Record<string, unknown>).scene_medium
    : undefined;
  return recordedSceneMedium(configured ?? event.payload.scene_medium);
};

/** Read an output's exact production inputs; malformed declared lineage fails closed. */
export function productionWorkflowRecordedSources(event: CreativeEvent): ProductionWorkflowSource[] | null {
  const settings = event.payload.settings && typeof event.payload.settings === "object" && !Array.isArray(event.payload.settings)
    ? event.payload.settings as Record<string, unknown>
    : null;
  const hasWorkflow = settings !== null && Object.hasOwn(settings, "production_workflow");
  if (hasWorkflow && (!settings.production_workflow || typeof settings.production_workflow !== "object"
    || Array.isArray(settings.production_workflow))) return null;
  const workflow = hasWorkflow ? settings!.production_workflow as Record<string, unknown> : null;
  if (workflow && (!Object.hasOwn(workflow, "sources")
    || event.payload.workflow_id !== undefined && String(workflow.id ?? "") !== String(event.payload.workflow_id)
    || event.payload.workflow_stage_id !== undefined && String(workflow.stage_id ?? "") !== String(event.payload.workflow_stage_id))) return null;

  const allowedFields = new Set([
    "outputKind", "outputId", "format", "documentId", "sourceEventId", "revision", "contentSha256", "approvalRequired", "allowTextGuidance",
  ]);
  const validate = (recorded: unknown): ProductionWorkflowSource[] | null => {
    if (!Array.isArray(recorded) || recorded.length > MAX_PRODUCTION_WORKFLOW_SOURCES) return null;
    const unique = new Set<string>();
    for (const candidate of recorded) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
      const source = candidate as Record<string, unknown>;
      if (Object.keys(source).some((key) => !allowedFields.has(key))
        || source.outputKind !== "artifact" && source.outputKind !== "image"
        || (source.outputKind === "image" ? source.format !== "image" : !DOCUMENT_ARTIFACT_KINDS.includes(source.format as DocumentArtifactKind))
        || typeof source.outputId !== "string" || !source.outputId || source.outputId.length > 240
        || typeof source.sourceEventId !== "string" || !source.sourceEventId || source.sourceEventId.length > 240
        || source.documentId !== String(event.payload.document_id ?? "")
        || !Number.isSafeInteger(source.revision) || Number(source.revision) < 0
        || typeof source.approvalRequired !== "boolean" || typeof source.allowTextGuidance !== "boolean"
        || source.outputKind === "artifact" && (typeof source.contentSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(source.contentSha256))
        || source.outputKind === "image" && (source.revision !== 0 || source.approvalRequired || source.contentSha256 !== undefined)
        || source.format !== "audio" && source.allowTextGuidance) return null;
      const identity = `${source.outputKind}:${source.outputId}`;
      if (unique.has(identity)) return null;
      unique.add(identity);
    }
    return recorded as ProductionWorkflowSource[];
  };

  const eventSources = event.payload.workflow_sources !== undefined ? validate(event.payload.workflow_sources) : undefined;
  const durableSources = workflow ? validate(workflow.sources) : undefined;
  if (eventSources === null || durableSources === null) return null;
  if (eventSources !== undefined && durableSources !== undefined
    && JSON.stringify(productionWorkflowSourceIdentity(eventSources))
      !== JSON.stringify(productionWorkflowSourceIdentity(durableSources))) return null;
  return eventSources ?? durableSources ?? [];
}

const dependencySatisfied = (status: ProductionWorkflowStageStatus) =>
  status === "selected" || status === "approved" || status === "complete" || status === "skipped";

/** Recompute every checkpoint from real outputs and approvals; a workflow event never grants approval. */
export function productionWorkflowStageStates(
  workflow: ProductionWorkflow,
  projection: Pick<CreativeProjection, "blocks" | "libraryBlocks" | "artifacts" | "libraryArtifacts" | "outputs" | "libraryOutputs">,
  events: CreativeEvent[],
  runningStageIds: ReadonlySet<string> = new Set(),
): ProductionWorkflowStageState[] {
  const states = new Map<string, ProductionWorkflowStageState>();
  for (const stage of workflow.stages) {
    const expectedSceneMedium = stage.format === "scene"
      ? productionWorkflowSceneConfiguration(workflow, stage.id)?.medium ?? "visual"
      : null;
    const dependencies = stage.dependsOn.map((dependency) => states.get(dependency)).filter((value): value is ProductionWorkflowStageState => Boolean(value));
    const activeDependencies = dependencies.filter((dependency) => dependency.stage.enabled);
    const currentSources = activeDependencies.flatMap((dependency) =>
      dependency.stage.source && dependencySatisfied(dependency.status)
        ? [{ ...dependency.stage.source, approvalRequired: dependency.stage.approvalRequired || dependency.stage.source.approvalRequired }]
        : []);
    const completion = stage.final ? [...events].reverse().find((event) => {
      if (event.type !== (stage.format === "image" ? "GenerationCompleted" : "DocumentRenderCompleted")
        || String(event.payload.workflow_id ?? "") !== workflow.id
        || String(event.payload.workflow_stage_id ?? "") !== stage.id
        || String(event.payload.document_id ?? "") !== workflow.documentId
        || stage.format === "scene" && completedSceneMedium(event) !== expectedSceneMedium) return false;
      const recorded = productionWorkflowRecordedSources(event);
      return recorded !== null
        && JSON.stringify(productionWorkflowSourceIdentity(recorded))
          === JSON.stringify(productionWorkflowSourceIdentity(currentSources));
    }) : undefined;
    const completedArtifactId = stage.final && completion ? String(completion.payload.artifact_id ?? "") : "";
    const completedImageId = stage.final && completion ? String(Array.isArray(completion.payload.object_ids) ? completion.payload.object_ids[0] ?? "" : "") : "";
    const artifact = completedArtifactId
      ? projection.libraryArtifacts.find((candidate) => candidate.id === completedArtifactId && candidate.documentId === workflow.documentId && candidate.kind === stage.format) ?? null
      : stage.source?.outputKind === "artifact"
      ? projection.libraryArtifacts.find((candidate) => candidate.id === stage.source?.outputId && candidate.documentId === workflow.documentId && candidate.kind === stage.format) ?? null
      : null;
    const image = completedImageId
      ? projection.libraryOutputs.find((candidate) => candidate.id === completedImageId && candidate.documentId === workflow.documentId && !candidate.discarded) ?? null
      : stage.source?.outputKind === "image"
      ? projection.libraryOutputs.find((candidate) => candidate.id === stage.source?.outputId && candidate.documentId === workflow.documentId && !candidate.discarded) ?? null
      : null;
    const selectedCompletion = stage.enabled && !stage.final && stage.source && (artifact || image)
      ? events.find((event) => event.eventId === stage.source?.sourceEventId
        && String(event.payload.document_id ?? "") === workflow.documentId
        && (stage.source?.outputKind === "artifact"
          ? event.type === "DocumentRenderCompleted" && String(event.payload.artifact_id ?? "") === stage.source.outputId
            && event.payload.artifact_kind === stage.format
          : ["GenerationCompleted", "IdeationPreviewCompleted"].includes(event.type)
            && (Array.isArray(event.payload.object_ids)
              ? event.payload.object_ids.some((id) => String(id) === stage.source?.outputId)
              : String(event.payload.object_id ?? "") === stage.source?.outputId))) ?? null
      : null;
    const recordedSources = selectedCompletion ? productionWorkflowRecordedSources(selectedCompletion) : null;
    const inputFreshness: ProductionWorkflowStageState["inputFreshness"] = !selectedCompletion
      ? null
      : recordedSources !== null
        && JSON.stringify(productionWorkflowSourceIdentity(recordedSources))
          === JSON.stringify(productionWorkflowSourceIdentity(currentSources))
        ? "current"
        : "changed";
    let status: ProductionWorkflowStageStatus;
    if (!stage.enabled && stage.optional) status = "skipped";
    else if (activeDependencies.some((dependency) => !dependencySatisfied(dependency.status))) status = "blocked";
    else if (stage.final && (artifact || image)) {
      if (!artifact) status = "complete";
      else {
        const review = artifactReviewState(artifact, projection.libraryBlocks, events);
        status = review.status === "approved" && (!workflow.approvalRequired || artifactReviewBindingMatches(
          artifact, events, documentArtifactRevision(events, artifact.id), artifactReviewParticipants(artifact, events).latest?.payload.content_sha256,
        )) ? "approved"
          : review.status === "stale" || review.status === "unverified" ? "stale"
          : review.status === "changes-requested" ? "changes-requested"
          : review.status === "in-review" ? "in-review"
          : workflow.approvalRequired ? "needs-review"
          : "complete";
      }
    } else if (stage.final) status = runningStageIds.has(`${workflow.id}:${stage.id}`) ? "running" : "ready";
    else if (runningStageIds.has(`${workflow.id}:${stage.id}`) && !stage.source) status = "running";
    else if (!stage.source) status = "missing";
    else if (inputFreshness === "changed") status = "stale";
    else if (stage.source.outputKind === "image") {
      status = image && image.sourceEventId === stage.source.sourceEventId ? "selected" : "stale";
    } else if (!artifact || artifact.sourceEventId !== stage.source.sourceEventId || documentArtifactRevision(events, artifact.id) !== stage.source.revision
      || stage.format === "scene" && recordedSceneMedium(artifact.settings.scene_medium) !== expectedSceneMedium) {
      status = "stale";
    } else {
      const review = artifactReviewState(artifact, projection.libraryBlocks, events);
      if (review.status === "stale" || review.status === "unverified") status = "stale";
      else if (review.status === "changes-requested") status = "changes-requested";
      else if (stage.approvalRequired || stage.source.approvalRequired) {
        status = review.status === "approved" && artifactReviewBindingMatches(artifact, events, stage.source.revision, stage.source.contentSha256)
          ? "approved" : review.status === "in-review" ? "in-review" : "needs-review";
      } else status = review.status === "approved" ? "approved" : "selected";
    }
    states.set(stage.id, {
      stage,
      status,
      inputFreshness,
      artifact,
      image,
      dependencies,
      actionable: stage.enabled && ["missing", "needs-review", "in-review", "changes-requested", "stale", "ready"].includes(status),
    });
  }
  return [...states.values()];
}

/** Only selected, dependency-ready sources can educate the exact explicitly requested stage. */
export function productionWorkflowSourcesForStage(
  workflow: ProductionWorkflow,
  stageId: string,
  states: readonly ProductionWorkflowStageState[],
): ProductionWorkflowSource[] {
  const stage = workflow.stages.find((candidate) => candidate.id === stageId);
  if (!stage || !stage.enabled) return [];
  return stage.dependsOn.flatMap((dependencyId) => {
    const dependency = states.find((candidate) => candidate.stage.id === dependencyId);
    if (!dependency || !dependency.stage.enabled || !dependency.stage.source || !dependencySatisfied(dependency.status)) return [];
    return [{ ...dependency.stage.source, approvalRequired: dependency.stage.approvalRequired || dependency.stage.source.approvalRequired }];
  });
}

/** Moving a stage never creates a backward dependency or moves the only final output. */
export function moveProductionWorkflowStage(workflow: ProductionWorkflow, stageId: string, direction: -1 | 1): ProductionWorkflow {
  const index = workflow.stages.findIndex((stage) => stage.id === stageId);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= workflow.stages.length - 1) return workflow;
  const reordered = [...workflow.stages];
  [reordered[index], reordered[destination]] = [reordered[destination]!, reordered[index]!];
  const candidate = { ...workflow, stages: reordered };
  return productionWorkflowIssues(candidate).length ? workflow : candidate;
}

export function productionWorkflowSourceIdentity(sources: readonly ProductionWorkflowSource[]) {
  return sources.map((source) => ({
    outputKind: source.outputKind,
    outputId: source.outputId,
    format: source.format,
    documentId: source.documentId,
    sourceEventId: source.sourceEventId,
    revision: source.revision,
    contentSha256: source.contentSha256 ?? null,
    approvalRequired: source.approvalRequired,
    allowTextGuidance: source.allowTextGuidance,
  }));
}
