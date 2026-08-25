import { artifactReviewState } from "./context-health.ts";
import { DOCUMENT_ARTIFACT_KINDS, type DocumentArtifact, type DocumentArtifactKind } from "./document-artifacts.ts";
import type { CreativeEvent, CreativeOutput, CreativeProjection } from "./events.ts";
import type { ProductionFormat } from "./managed-production.ts";

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
  artifact: DocumentArtifact | null;
  image: CreativeOutput | null;
  dependencies: ProductionWorkflowStageState[];
  actionable: boolean;
};

type StageRecipe = { format: ProductionFormat; optional?: boolean; dependsOn?: ProductionFormat[] };

const PRODUCTION_WORKFLOW_RECIPES: Record<ProductionFormat, readonly StageRecipe[]> = {
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
  });
  return { id: input.id, documentId: input.documentId, projectId: input.projectId, target: input.target, approvalRequired: input.approvalRequired === true, stages };
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

const sourceRevision = (events: readonly CreativeEvent[], artifactId: string) =>
  events.filter((event) => event.type === "DocumentArtifactEdited" && String(event.payload.artifact_id ?? "") === artifactId).length;

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
    const dependencies = stage.dependsOn.map((dependency) => states.get(dependency)).filter((value): value is ProductionWorkflowStageState => Boolean(value));
    const activeDependencies = dependencies.filter((dependency) => dependency.stage.enabled);
    const currentSources = activeDependencies.flatMap((dependency) =>
      dependency.stage.source && dependencySatisfied(dependency.status)
        ? [{ ...dependency.stage.source, approvalRequired: dependency.stage.approvalRequired || dependency.stage.source.approvalRequired }]
        : []);
    const completion = stage.final ? [...events].reverse().find((event) =>
      event.type === (stage.format === "image" ? "GenerationCompleted" : "DocumentRenderCompleted")
      && String(event.payload.workflow_id ?? "") === workflow.id
      && String(event.payload.workflow_stage_id ?? "") === stage.id
      && String(event.payload.document_id ?? "") === workflow.documentId
      && JSON.stringify(productionWorkflowSourceIdentity(Array.isArray(event.payload.workflow_sources) ? event.payload.workflow_sources as ProductionWorkflowSource[] : []))
        === JSON.stringify(productionWorkflowSourceIdentity(currentSources)),
    ) : undefined;
    const completedArtifactId = stage.final && completion ? String(completion.payload.artifact_id ?? "") : "";
    const completedImageId = stage.final && completion ? String(Array.isArray(completion.payload.object_ids) ? completion.payload.object_ids[0] ?? "" : "") : "";
    const artifact = completedArtifactId
      ? projection.libraryArtifacts.find((candidate) => candidate.id === completedArtifactId && candidate.documentId === workflow.documentId) ?? null
      : stage.source?.outputKind === "artifact"
      ? projection.libraryArtifacts.find((candidate) => candidate.id === stage.source?.outputId && candidate.documentId === workflow.documentId) ?? null
      : null;
    const image = completedImageId
      ? projection.libraryOutputs.find((candidate) => candidate.id === completedImageId && candidate.documentId === workflow.documentId && !candidate.discarded) ?? null
      : stage.source?.outputKind === "image"
      ? projection.libraryOutputs.find((candidate) => candidate.id === stage.source?.outputId && candidate.documentId === workflow.documentId && !candidate.discarded) ?? null
      : null;
    let status: ProductionWorkflowStageStatus;
    if (!stage.enabled && stage.optional) status = "skipped";
    else if (activeDependencies.some((dependency) => !dependencySatisfied(dependency.status))) status = "blocked";
    else if (stage.final && (artifact || image)) {
      if (!artifact) status = "complete";
      else {
        const review = artifactReviewState(artifact, projection.libraryBlocks, events);
        status = review.status === "approved" ? "approved"
          : review.status === "stale" || review.status === "unverified" ? "stale"
          : review.status === "changes-requested" ? "changes-requested"
          : review.status === "in-review" ? "in-review"
          : workflow.approvalRequired ? "needs-review"
          : "complete";
      }
    } else if (stage.final) status = runningStageIds.has(`${workflow.id}:${stage.id}`) ? "running" : "ready";
    else if (runningStageIds.has(`${workflow.id}:${stage.id}`) && !stage.source) status = "running";
    else if (!stage.source) status = "missing";
    else if (stage.source.outputKind === "image") {
      status = image && image.sourceEventId === stage.source.sourceEventId ? "selected" : "stale";
    } else if (!artifact || artifact.sourceEventId !== stage.source.sourceEventId || sourceRevision(events, artifact.id) !== stage.source.revision) {
      status = "stale";
    } else {
      const review = artifactReviewState(artifact, projection.libraryBlocks, events);
      if (review.status === "stale" || review.status === "unverified") status = "stale";
      else if (review.status === "changes-requested") status = "changes-requested";
      else if (stage.approvalRequired || stage.source.approvalRequired) {
        status = review.status === "approved" ? "approved" : review.status === "in-review" ? "in-review" : "needs-review";
      } else status = review.status === "approved" ? "approved" : "selected";
    }
    states.set(stage.id, {
      stage,
      status,
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
