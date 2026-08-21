import type { CreativeEvent } from "./events.ts";

export type IntentOutputKind = "image" | "short_story" | "scene" | "slides" | "storyboard" | "video" | "context";

export type IntentTrajectoryStatus =
  | "initiated"
  | "in_progress"
  | "pending"
  | "blocked"
  | "failed"
  | "interrupted"
  | "resumed"
  | "ready"
  | "completed"
  | "abandoned"
  | "superseded";

export type IntentTrajectoryStep = {
  eventId: string;
  sequence: number;
  type: string;
  status: IntentTrajectoryStatus;
  actor: string;
};

export type IntentNextAction = {
  id: string;
  label: string;
  reason: string;
  route: string;
  documentId: string;
  requiresApproval: boolean;
  priority: number;
  evidenceEventIds: string[];
};

export type IntentTrajectory = {
  id: string;
  workflowId: string;
  streamId: string;
  projectId: string;
  documentId: string;
  expectedOutputKind: IntentOutputKind;
  status: IntentTrajectoryStatus;
  authority: "explicit" | "authored" | "inferred";
  confidence: number;
  title: string;
  sourceContextId: string | null;
  contextFingerprint: string | null;
  contextRevision: string | null;
  generationIds: string[];
  artifactIds: string[];
  sourceEventIds: string[];
  steps: IntentTrajectoryStep[];
  startedSequence: number;
  lastSequence: number;
  interrupted: boolean;
  resumed: boolean;
  suppressed: boolean;
  blocker: string | null;
  nextAction: IntentNextAction | null;
};

type MutableTrajectory = Omit<IntentTrajectory, "generationIds" | "artifactIds" | "sourceEventIds" | "nextAction"> & {
  generationIds: Set<string>;
  artifactIds: Set<string>;
  sourceEventIds: Set<string>;
  declarationRef: string;
  requestEventId: string;
  parentIntentId: string;
  retryable: boolean;
  approvalRequired: boolean;
  suppressedAt: number;
};

const text = (value: unknown) => String(value ?? "").trim();
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const humanActor = (event: CreativeEvent) => event.actor === "user" || event.actor.startsWith("user:");
const terminal = new Set<IntentTrajectoryStatus>(["completed", "abandoned", "superseded"]);
const directProgress = new Set(["BlockCreated", "BlockPropertyEdited", "BlockLocked", "ChipEdited", "ChatMessageSent", "CanvasInteractionRecorded", "ContextSetFormalized", "IdeationPromoted", "PromptFanOutputPromoted", "DocumentOpened"]);
const formatLabels: Record<IntentOutputKind, string> = {
  image: "image",
  short_story: "short story",
  scene: "scene",
  slides: "presentation",
  storyboard: "storyboard",
  video: "video",
  context: "creative direction",
};

function outputKind(value: unknown): IntentOutputKind {
  const kind = text(value);
  return kind === "image" || kind === "short_story" || kind === "scene" || kind === "slides" || kind === "storyboard" || kind === "video" ? kind : "context";
}

function scopedDocumentId(event: CreativeEvent) {
  const payload = event.payload;
  return text(payload.document_id ?? payload.scope_ref ?? record(payload.snapshot_ref).document_id ?? record(payload.destination).document_id);
}

function scopeKey(streamId: string, projectId: string, documentId: string) {
  return `${streamId}:${projectId || "project"}:${documentId}`;
}

function eventTitle(event: CreativeEvent, kind: IntentOutputKind) {
  const brief = record(event.payload.output_brief);
  return text(brief.title ?? event.payload.title) || (kind === "context" ? "Shape the creative direction" : `Finish the ${formatLabels[kind]}`);
}

function actionFor(trajectory: MutableTrajectory): IntentNextAction | null {
  if (terminal.has(trajectory.status) || trajectory.suppressed || !trajectory.documentId) return null;
  const label = formatLabels[trajectory.expectedOutputKind];
  const route = `/document/${encodeURIComponent(trajectory.documentId)}`;
  const evidenceEventIds = [...trajectory.sourceEventIds].slice(-4);
  const base = { id: `intent:${trajectory.id}`, route, documentId: trajectory.documentId, evidenceEventIds };

  if (trajectory.blocker === "video-approval") {
    return { ...base, label: "Review the video plan", reason: "The treatment is ready; rendering video requires a separate, explicit approval.", requiresApproval: true, priority: 94 };
  }
  if (trajectory.blocker === "reference-rights") {
    return { ...base, label: "Choose reference usage rights", reason: `Confirm that the selected reference may be used before continuing the ${label}.`, requiresApproval: true, priority: 99 };
  }
  if (trajectory.blocker === "provider") {
    return { ...base, label: `Reconnect the provider before finishing the ${label}`, reason: "A previous request was blocked before paid work; resolve the provider issue before retrying.", requiresApproval: false, priority: 98 };
  }
  if (trajectory.blocker === "budget" || trajectory.blocker === "approval") {
    return { ...base, label: `Review approval for the ${label}`, reason: "A cost or permission decision must be reviewed before any additional provider work begins.", requiresApproval: true, priority: 97 };
  }
  if (trajectory.status === "ready") {
    return { ...base, label: `Review your ready ${label}`, reason: "The result finished after you started it, but no matching review, save, or export has been recorded.", requiresApproval: false, priority: 95 };
  }
  if (trajectory.status === "failed") {
    return { ...base, label: `Review what interrupted the ${label}`, reason: trajectory.retryable ? "The earlier request did not finish. Review its evidence before choosing whether to retry." : "The earlier request cannot be retried until its blocking condition has been resolved.", requiresApproval: trajectory.approvalRequired, priority: 96 };
  }
  if (trajectory.status === "interrupted" || trajectory.interrupted) {
    return { ...base, label: trajectory.expectedOutputKind === "context" ? "Continue shaping your direction" : `Finish your ${label}`, reason: "You started this work before leaving, and no matching finished result has been recorded.", requiresApproval: trajectory.approvalRequired, priority: 92 };
  }
  if (trajectory.status === "pending") {
    return { ...base, label: `Check on your ${label}`, reason: "A request for this exact result is still open; another document or output cannot complete it.", requiresApproval: trajectory.approvalRequired, priority: 84 };
  }
  if (trajectory.expectedOutputKind === "context") {
    return { ...base, label: "Continue shaping your direction", reason: "Your recent authored decisions describe work that has not yet reached a chosen result.", requiresApproval: false, priority: trajectory.authority === "explicit" ? 70 : 45 };
  }
  return { ...base, label: `Continue the ${label}`, reason: "Your earlier choices point to a result that has not been completed yet.", requiresApproval: trajectory.approvalRequired, priority: trajectory.authority === "explicit" ? 78 : 60 };
}

/**
 * Reconstruct user goals from witnessed events only. Private intent statements,
 * chat bodies, dwell samples, and provider prompts are never read or copied.
 */
export type IntentTrajectoryOptions = { streamId?: string; projectId?: string; documentId?: string; includeSynthetic?: boolean };

const SAFE_INTENT_DECLARATION_FIELDS = new Set([
  "scope_ref", "statement_ref", "content_expires_at", "deadline", "intent_id", "parent_intent_id", "target_intent_id", "expected_output_kind",
  "project_id", "document_id", "workflow_id", "source_context_id", "context_fingerprint", "context_revision", "source_block_versions", "surface",
  "narrative_scenario", "experience_area", "narrative_position", "narrative_length", "chapter_cycle", "primary_facet", "workflow_mode",
  "reverse_target_kind", "reverse_engineered", "source_artifact_kind", "inferred_history", "mock_data_source", "replay_session_id", "experience_profile",
  "development_stage_kind", "development_stage_sequence", "development_stage_total", "study", "provider_milestone_index", "fixture_cycle",
  "target_event_count", "durable_media_backed", "provider_call_backed", "external_asset_backed", "fixture_asset_reused",
]);

function safeSourceBlockVersions(value: unknown) {
  return Array.isArray(value) && value.every((entry) => {
    const version = record(entry);
    return Boolean(text(version.block_id)) && Object.keys(version).every((key) => key === "block_id" || key === "version") && (version.version === undefined || typeof version.version === "number");
  });
}

/** Durable goal declarations contain only opaque references and non-sensitive lifecycle metadata. */
export function sanitizeIntentDeclarationPayload(payload: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(payload).filter(([key, value]) => SAFE_INTENT_DECLARATION_FIELDS.has(key) && (key === "source_block_versions" ? safeSourceBlockVersions(value) : key === "statement_ref" ? typeof value === "string" && /^[A-Za-z0-9._:-]{1,256}$/.test(value) : value === null || ["string", "number", "boolean"].includes(typeof value))));
}

export function intentDeclarationIsPrivate(payload: Record<string, unknown>) {
  return Boolean(text(payload.scope_ref) && text(payload.statement_ref)) && (!text(payload.document_id) || text(payload.scope_ref) === text(payload.document_id)) && Object.keys(payload).length === Object.keys(sanitizeIntentDeclarationPayload(payload)).length;
}

const isSyntheticIntentEvent = (event: CreativeEvent) => event.payload.mock_data_source === "openai-provider" || record(event.payload.origin).synthetic === true;

export function deriveIntentTrajectories(events: readonly CreativeEvent[], options: IntentTrajectoryOptions = {}): IntentTrajectory[] {
  const ordered = [...events]
    .filter((event) => (!options.streamId || event.streamId === options.streamId) && (options.includeSynthetic || !isSyntheticIntentEvent(event)))
    .sort((left, right) => left.streamId.localeCompare(right.streamId) || left.sequence - right.sequence);
  const documents = new Map<string, string>();
  const trajectories = new Map<string, MutableTrajectory>();
  const byIntent = new Map<string, MutableTrajectory>();
  const byGeneration = new Map<string, MutableTrajectory>();
  const byArtifact = new Map<string, MutableTrajectory>();
  const byObject = new Map<string, MutableTrajectory>();
  const byScope = new Map<string, MutableTrajectory[]>();
  const pendingRights = new Map<string, Set<string>>();
  const reopenedStreams = new Set<string>();
  const activeProjects = new Map<string, string>();

  const register = (event: CreativeEvent, documentId: string, projectId: string, id: string, kind: IntentOutputKind, authority: MutableTrajectory["authority"]) => {
    const declaredWorkflow = text(event.payload.workflow_id);
    const key = `${scopeKey(event.streamId, projectId, documentId)}:${declaredWorkflow || "workflow"}:${id}`;
    const existing = trajectories.get(key);
    if (existing) return existing;
    const payload = event.payload;
    const trajectory: MutableTrajectory = {
      id,
      workflowId: text(payload.workflow_id) || `${event.streamId}:${documentId}:${id}`,
      streamId: event.streamId,
      projectId,
      documentId,
      expectedOutputKind: kind,
      status: "initiated",
      authority,
      confidence: authority === "explicit" ? .98 : authority === "authored" ? .82 : .58,
      title: eventTitle(event, kind),
      sourceContextId: text(payload.source_context_id ?? payload.context_set_id) || null,
      contextFingerprint: text(payload.context_fingerprint) || null,
      contextRevision: text(payload.context_revision ?? payload.document_revision) || null,
      generationIds: new Set(),
      artifactIds: new Set(),
      sourceEventIds: new Set(),
      steps: [],
      startedSequence: event.sequence,
      lastSequence: event.sequence,
      interrupted: false,
      resumed: false,
      suppressed: false,
      blocker: null,
      declarationRef: text(payload.statement_ref),
      requestEventId: "",
      parentIntentId: text(payload.parent_intent_id),
      retryable: false,
      approvalRequired: false,
      suppressedAt: 0,
    };
    trajectories.set(key, trajectory);
    const scope = scopeKey(event.streamId, projectId, documentId);
    byScope.set(scope, [...(byScope.get(scope) ?? []), trajectory]);
    byIntent.set(`${scope}:${id}`, trajectory);
    byIntent.set(`${event.streamId}:${documentId}:${id}`, trajectory);
    byIntent.set(`${scope}:${trajectory.workflowId}:${id}`, trajectory);
    byIntent.set(`${event.streamId}:${documentId}:${trajectory.workflowId}:${id}`, trajectory);
    if (trajectory.declarationRef) {
      byIntent.set(`${scope}:${trajectory.declarationRef}`, trajectory);
      byIntent.set(`${event.streamId}:${documentId}:${trajectory.declarationRef}`, trajectory);
      byIntent.set(`${scope}:${trajectory.workflowId}:${trajectory.declarationRef}`, trajectory);
      byIntent.set(`${event.streamId}:${documentId}:${trajectory.workflowId}:${trajectory.declarationRef}`, trajectory);
    }
    return trajectory;
  };

  const intentFor = (streamId: string, documentId: string, projectId: string, id: string, workflowId = "") => {
    const scope = scopeKey(streamId, projectId, documentId);
    if (workflowId) return byIntent.get(`${scope}:${workflowId}:${id}`) ?? byIntent.get(`${streamId}:${documentId}:${workflowId}:${id}`);
    return byIntent.get(`${scope}:${id}`) ?? byIntent.get(`${streamId}:${documentId}:${id}`);
  };

  const advance = (trajectory: MutableTrajectory, event: CreativeEvent, status: IntentTrajectoryStatus) => {
    if (terminal.has(trajectory.status) && status !== "superseded") return;
    trajectory.status = status;
    trajectory.lastSequence = event.sequence;
    trajectory.sourceEventIds.add(event.eventId);
    trajectory.steps.push({ eventId: event.eventId, sequence: event.sequence, type: event.type, status, actor: event.actor });
    const payload = event.payload;
    trajectory.sourceContextId ||= text(payload.source_context_id ?? payload.context_set_id) || null;
    trajectory.contextFingerprint ||= text(payload.context_fingerprint) || null;
    trajectory.contextRevision ||= text(payload.context_revision ?? payload.document_revision) || null;
    const title = eventTitle(event, trajectory.expectedOutputKind);
    if (text(record(payload.output_brief).title ?? payload.title)) trajectory.title = title;
  };

  const candidatesFor = (event: CreativeEvent, documentId: string, projectId: string) => {
    const exactScope = scopeKey(event.streamId, projectId, documentId);
    const workflowId = text(event.payload.workflow_id);
    const inWorkflow = (trajectory: MutableTrajectory) => !workflowId || !trajectory.workflowId || trajectory.workflowId === workflowId;
    const exact = (byScope.get(exactScope) ?? []).filter(inWorkflow);
    if (exact.length || !documentId) return exact;
    return [...trajectories.values()].filter((trajectory) => trajectory.streamId === event.streamId && trajectory.documentId === documentId && (!projectId || !trajectory.projectId || trajectory.projectId === projectId) && inWorkflow(trajectory));
  };

  const resolve = (event: CreativeEvent, documentId: string, projectId: string, kind: IntentOutputKind, requireRequest = false) => {
    const payload = event.payload;
    const sameWorkflow = (trajectory: MutableTrajectory) => !text(payload.workflow_id) || trajectory.workflowId === text(payload.workflow_id);
    const intentId = text(payload.intent_id ?? payload.target_intent_id ?? payload.statement_ref);
    if (intentId) {
      const found = intentFor(event.streamId, documentId, projectId, intentId, text(payload.workflow_id));
      if (found && (!requireRequest || Boolean(found.requestEventId)) && sameWorkflow(found) && (!documentId || found.documentId === documentId) && (!projectId || !found.projectId || found.projectId === projectId)) return found;
    }
    const generationId = text(payload.generation_id ?? payload.full_generation_id ?? payload.draft_generation_id);
    if (generationId) {
      const found = byGeneration.get(`${event.streamId}:${generationId}`);
      if (found && (!requireRequest || Boolean(found.requestEventId)) && sameWorkflow(found) && (!documentId || found.documentId === documentId) && (!projectId || !found.projectId || found.projectId === projectId)) return found;
    }
    const artifactId = text(payload.artifact_id);
    if (artifactId) {
      const found = byArtifact.get(`${event.streamId}:${artifactId}`);
      if (found && (!requireRequest || Boolean(found.requestEventId)) && sameWorkflow(found) && (!documentId || found.documentId === documentId) && (!projectId || !found.projectId || found.projectId === projectId)) return found;
    }
    if (requireRequest) return undefined;
    return [...candidatesFor(event, documentId, projectId)].reverse().find((trajectory) => !terminal.has(trajectory.status) && (trajectory.expectedOutputKind === kind || trajectory.expectedOutputKind === "context"));
  };

  for (const event of ordered) {
    const payload = event.payload;
    if (event.type === "ProjectCreated" || event.type === "ProjectOpened") activeProjects.set(event.streamId, text(payload.project_id) || activeProjects.get(event.streamId) || "");
    const documentId = scopedDocumentId(event);
    const projectId = text(payload.project_id ?? record(payload.snapshot_ref).project_id) || documents.get(`${event.streamId}:${documentId}`) || activeProjects.get(event.streamId) || "";
    if (event.type === "DocumentCreated" && documentId) documents.set(`${event.streamId}:${documentId}`, projectId);
    const kind = outputKind(payload.expected_output_kind ?? payload.desired_output_kind ?? payload.artifact_kind ?? payload.requested_output);
    const scope = scopeKey(event.streamId, projectId, documentId);

    if (event.type === "SessionOpened") {
      reopenedStreams.add(event.streamId);
      continue;
    }

    if (event.type === "IntentDeclared" && documentId) {
      if (!humanActor(event) || !intentDeclarationIsPrivate(payload)) continue;
      const id = text(payload.intent_id ?? payload.statement_ref) || event.eventId;
      const trajectory = register(event, documentId, projectId, id, kind, "explicit");
      trajectory.authority = "explicit";
      trajectory.confidence = trajectory.authority === "explicit" ? .98 : trajectory.confidence;
      advance(trajectory, event, "initiated");
      continue;
    }

    if (event.type === "ReferenceIngested" && documentId) {
      const referenceId = text(payload.reference_id);
      if (referenceId && payload.rights_confirmed !== true) pendingRights.set(scope, new Set([...(pendingRights.get(scope) ?? []), referenceId]));
      continue;
    }

    if (event.type === "RightsAsserted") {
      if (!humanActor(event)) continue;
      const referenceId = text(payload.reference_id);
      const scopedMatches = documentId ? [[scope, pendingRights.get(scope)] as const] : [...pendingRights.entries()].filter(([candidate, references]) => candidate.startsWith(`${event.streamId}:`) && (!projectId || candidate.startsWith(`${event.streamId}:${projectId}:`)) && references.has(referenceId));
      for (const [, references] of scopedMatches) references?.delete(referenceId);
      const affected = documentId ? candidatesFor(event, documentId, projectId) : [...trajectories.values()].filter((trajectory) => trajectory.streamId === event.streamId && (!projectId || trajectory.projectId === projectId) && scopedMatches.some(([candidate]) => candidate === scopeKey(trajectory.streamId, trajectory.projectId, trajectory.documentId)));
      for (const trajectory of affected) {
        if (trajectory.blocker === "reference-rights" && !(pendingRights.get(scopeKey(trajectory.streamId, trajectory.projectId, trajectory.documentId))?.size ?? 0)) {
          trajectory.blocker = null;
          advance(trajectory, event, trajectory.requestEventId ? "pending" : "in_progress");
        }
      }
      continue;
    }

    if (event.type === "SessionClosed") {
      for (const trajectory of trajectories.values()) {
        if (trajectory.streamId !== event.streamId || terminal.has(trajectory.status) || (documentId && trajectory.documentId !== documentId) || (projectId && trajectory.projectId && trajectory.projectId !== projectId)) continue;
        trajectory.interrupted = true;
        if (trajectory.status === "blocked" || trajectory.status === "failed" || trajectory.status === "ready") {
          trajectory.sourceEventIds.add(event.eventId);
          trajectory.steps.push({ eventId: event.eventId, sequence: event.sequence, type: event.type, status: "interrupted", actor: event.actor });
          trajectory.lastSequence = event.sequence;
        } else advance(trajectory, event, "interrupted");
      }
      reopenedStreams.delete(event.streamId);
      continue;
    }

    if (event.type === "BriefItemIgnored" || event.type === "ProposalRejected" || event.type === "ProposalDeclined" || event.type === "BriefDismissed") {
      if (!humanActor(event)) continue;
      const reference = text(payload.intent_id ?? payload.target_intent_id ?? payload.item_id ?? payload.ref_id).replace(/^intent:/, "");
      const workflowId=text(payload.workflow_id);
      const rejected = intentFor(event.streamId,documentId,projectId,reference,workflowId) ?? [...trajectories.values()].find((trajectory) => trajectory.streamId === event.streamId && (!documentId || trajectory.documentId === documentId) && (!projectId || !trajectory.projectId || trajectory.projectId === projectId) && (!workflowId || trajectory.workflowId === workflowId) && (trajectory.id === reference || trajectory.artifactIds.has(reference) || trajectory.generationIds.has(reference)));
      if (rejected) {
        rejected.suppressed = true;
        rejected.suppressedAt = event.sequence;
        rejected.sourceEventIds.add(event.eventId);
      }
      continue;
    }

    if (event.type === "BranchAbandoned" || event.type === "JobCanceled" || event.type === "JobForceFailed") {
      const trajectory = resolve(event, documentId, projectId, kind);
      if (trajectory) advance(trajectory, event, event.type === "BranchAbandoned" || event.type === "JobCanceled" ? "abandoned" : "failed");
      continue;
    }

    if (event.type === "GenerationRequested" || event.type === "DocumentRenderRequested") {
      if (!documentId || !humanActor(event) || payload.report_space) continue;
      const expected = event.type === "GenerationRequested" ? "image" : kind;
      const stableId = text(payload.intent_id ?? payload.artifact_id ?? payload.generation_id ?? payload.workflow_id) || event.eventId;
      const exactIntent = text(payload.intent_id);
      const candidateById = exactIntent ? intentFor(event.streamId,documentId,projectId,exactIntent,text(payload.workflow_id)) : undefined;
      const existingById = candidateById && (!text(payload.workflow_id) || candidateById.workflowId === text(payload.workflow_id)) ? candidateById : undefined;
      const directRequestId = text(payload.artifact_id ?? payload.generation_id);
      const candidateRequest = directRequestId ? event.type === "GenerationRequested" ? byGeneration.get(`${event.streamId}:${directRequestId}`) : byArtifact.get(`${event.streamId}:${directRequestId}`) : undefined;
      const exactRequest = candidateRequest && (!text(payload.workflow_id) || candidateRequest.workflowId === text(payload.workflow_id)) ? candidateRequest : undefined;
      const candidates = [...candidatesFor(event, documentId, projectId)].reverse();
      const declared = candidates.find((candidate) => !candidate.requestEventId && !terminal.has(candidate.status) && candidate.expectedOutputKind === expected && candidate.authority === "explicit")
        ?? candidates.find((candidate) => !candidate.requestEventId && !terminal.has(candidate.status) && (candidate.expectedOutputKind === expected || candidate.expectedOutputKind === "context"));
      const trajectory = exactIntent ? existingById ?? register(event, documentId, projectId, stableId, expected, humanActor(event) ? "authored" : "inferred") : exactRequest ?? declared ?? register(event, documentId, projectId, stableId, expected, humanActor(event) ? "authored" : "inferred");
      trajectory.expectedOutputKind = expected;
      trajectory.title = eventTitle(event, expected);
      trajectory.requestEventId = event.eventId;
      trajectory.parentIntentId ||= text(payload.parent_intent_id);
      trajectory.approvalRequired = payload.paid_media_confirmed === false || payload.approval_required === true;
      if (trajectory.suppressed && humanActor(event) && event.sequence > trajectory.suppressedAt) trajectory.suppressed = false;
      const generationId = text(payload.generation_id);
      const artifactId = text(payload.artifact_id);
      if (generationId) {
        trajectory.generationIds.add(generationId);
        byGeneration.set(`${event.streamId}:${generationId}`, trajectory);
      }
      if (artifactId) {
        trajectory.artifactIds.add(artifactId);
        byArtifact.set(`${event.streamId}:${artifactId}`, trajectory);
      }
      if (trajectory.interrupted && reopenedStreams.has(event.streamId)) {
        trajectory.resumed = true;
        advance(trajectory, event, "resumed");
      }
      if ((pendingRights.get(scope)?.size ?? 0) > 0 && payload.reference_rights_required === true) {
        trajectory.blocker = "reference-rights";
        advance(trajectory, event, "blocked");
      } else if (trajectory.approvalRequired) {
        trajectory.blocker = "approval";
        advance(trajectory, event, "blocked");
      } else advance(trajectory, event, "pending");
      continue;
    }

    if (event.type === "GenerationPreflightCompleted" && payload.status === "blocked" || event.type === "GenerationBlockedBeforeProvider" || event.type === "BudgetExceeded") {
      const trajectory = resolve(event, documentId, projectId, "image") ?? (documentId && event.type !== "BudgetExceeded" ? register(event, documentId, projectId, text(payload.request_key ?? payload.preflight_id) || event.eventId, "image", "authored") : undefined);
      if (trajectory) {
        const providerBlocked = text(payload.provider_status).includes("credit") || (Array.isArray(payload.blocking_probes) && payload.blocking_probes.some((probe) => /provider|credit/i.test(text(probe))));
        const rightsBlocked = /rights|license/i.test(text(payload.reason)) || Array.isArray(payload.blocking_probes) && payload.blocking_probes.some((probe) => /rights|license/i.test(text(probe)));
        trajectory.blocker = event.type === "BudgetExceeded" ? "budget" : rightsBlocked ? "reference-rights" : providerBlocked ? "provider" : "approval";
        advance(trajectory, event, "blocked");
      }
      continue;
    }

    if (event.type === "GenerationRemediationApplied" || event.type === "GenerationRiskAcknowledged") {
      const trajectory = resolve(event, documentId, projectId, "image");
      if (trajectory) {
        if (trajectory.blocker === "reference-rights" && (pendingRights.get(scopeKey(trajectory.streamId, trajectory.projectId, trajectory.documentId))?.size ?? 0) > 0) continue;
        trajectory.blocker = null;
        trajectory.approvalRequired = false;
        advance(trajectory, event, "resumed");
        trajectory.resumed = true;
      }
      continue;
    }

    if (event.type === "GenerationCompleted" || event.type === "DocumentRenderCompleted") {
      if (payload.report_space || event.actor.startsWith("worker:scout")) continue;
      const expected = event.type === "GenerationCompleted" ? "image" : kind;
      const trajectory = resolve(event, documentId, projectId, expected, true);
      if (trajectory && trajectory.expectedOutputKind === expected) {
        if (trajectory.blocker === "reference-rights" && (pendingRights.get(scopeKey(trajectory.streamId, trajectory.projectId, trajectory.documentId))?.size ?? 0) > 0) continue;
        trajectory.blocker = null;
        trajectory.approvalRequired = false;
        for (const objectId of [text(payload.object_id), ...(Array.isArray(payload.object_ids) ? payload.object_ids.map(text) : [])]) if (objectId) byObject.set(`${event.streamId}:${objectId}`, trajectory);
        advance(trajectory, event, "ready");
      }
      continue;
    }

    if (humanActor(event) && /^(ObjectViewed|ObjectSaved|ObjectExported|ObjectPinned|ObjectCritiqued|AddedToLibrary|DocumentArtifactViewed|DocumentArtifactExported)$/.test(event.type)) {
      const objectId = text(payload.object_id);
      const artifactId = text(payload.artifact_id);
      const trajectory = objectId ? byObject.get(`${event.streamId}:${objectId}`) : artifactId ? byArtifact.get(`${event.streamId}:${artifactId}`) : undefined;
      const providedIntent = text(payload.intent_id ?? payload.target_intent_id);
      const providedWorkflow = text(payload.workflow_id);
      if (trajectory && trajectory.status === "ready" && (!documentId || trajectory.documentId === documentId) && (!projectId || !trajectory.projectId || trajectory.projectId === projectId) && (!providedIntent || trajectory.id === providedIntent) && (!providedWorkflow || trajectory.workflowId === providedWorkflow)) {
        advance(trajectory, event, "completed");
        const parentIntentId = text(payload.parent_intent_id) || trajectory.parentIntentId;
        const parent = parentIntentId ? intentFor(trajectory.streamId,trajectory.documentId,trajectory.projectId,parentIntentId,trajectory.workflowId) : undefined;
        if (parent && parent.expectedOutputKind === "context" && parent.authority === "explicit" && !terminal.has(parent.status)) advance(parent, event, "completed");
      }
      continue;
    }

    if (event.type === "ObjectDiscarded" && humanActor(event)) {
      const trajectory = byObject.get(`${event.streamId}:${text(payload.object_id)}`);
      if (trajectory && !terminal.has(trajectory.status) && (!documentId || trajectory.documentId === documentId) && (!projectId || !trajectory.projectId || trajectory.projectId === projectId) && (!text(payload.workflow_id) || trajectory.workflowId === text(payload.workflow_id))) advance(trajectory, event, "abandoned");
      continue;
    }

    if (event.type === "GenerationFailed" || event.type === "DocumentRenderFailed" || event.type === "JobAttemptInterrupted") {
      const trajectory = resolve(event, documentId, projectId, event.type === "DocumentRenderFailed" ? kind : "image", event.type !== "JobAttemptInterrupted");
      if (trajectory) {
        trajectory.retryable = payload.retryable === true;
        if (payload.video_mock_boundary === true || text(payload.error_code).includes("not_approved")) {
          trajectory.blocker = "video-approval";
          trajectory.approvalRequired = true;
          advance(trajectory, event, "blocked");
        } else if (event.type === "JobAttemptInterrupted") {
          trajectory.interrupted = true;
          advance(trajectory, event, "interrupted");
        } else advance(trajectory, event, "failed");
      }
      continue;
    }

    if (!documentId || !directProgress.has(event.type) || !humanActor(event)) continue;
    const related = resolve(event, documentId, projectId, kind);
    const workflowId = text(payload.workflow_id);
    const trajectory = related ?? register(event, documentId, projectId, `context:${documentId}${workflowId ? `:${workflowId}` : ""}`, "context", "authored");
    if (trajectory.suppressed && event.sequence > trajectory.suppressedAt && /^(BlockPropertyEdited|ChatMessageSent|ContextSetFormalized)$/.test(event.type)) trajectory.suppressed = false;
    if (event.type === "ContextSetFormalized" && trajectory.expectedOutputKind === "context" && trajectory.authority === "explicit") {
      advance(trajectory, event, "completed");
    } else if (trajectory.interrupted && reopenedStreams.has(event.streamId)) {
      trajectory.resumed = true;
      advance(trajectory, event, "resumed");
    } else if (!terminal.has(trajectory.status)) advance(trajectory, event, trajectory.requestEventId ? "pending" : "in_progress");
  }

  return [...trajectories.values()]
    .filter((trajectory) => !options.projectId || trajectory.projectId === options.projectId)
    .filter((trajectory) => !options.documentId || trajectory.documentId === options.documentId)
    .map((trajectory) => {
      return {
        id: trajectory.id,
        workflowId: trajectory.workflowId,
        streamId: trajectory.streamId,
        projectId: trajectory.projectId,
        documentId: trajectory.documentId,
        expectedOutputKind: trajectory.expectedOutputKind,
        status: trajectory.status,
        authority: trajectory.authority,
        confidence: trajectory.confidence,
        title: trajectory.title,
        sourceContextId: trajectory.sourceContextId,
        contextFingerprint: trajectory.contextFingerprint,
        contextRevision: trajectory.contextRevision,
        generationIds: [...trajectory.generationIds],
        artifactIds: [...trajectory.artifactIds],
        sourceEventIds: [...trajectory.sourceEventIds],
        steps: trajectory.steps,
        startedSequence: trajectory.startedSequence,
        lastSequence: trajectory.lastSequence,
        interrupted: trajectory.interrupted,
        resumed: trajectory.resumed,
        suppressed: trajectory.suppressed,
        blocker: trajectory.blocker,
        nextAction: actionFor(trajectory),
      } satisfies IntentTrajectory;
    })
    .sort((left, right) => right.lastSequence - left.lastSequence || left.id.localeCompare(right.id));
}

function unfinishedFromTrajectories(trajectories: IntentTrajectory[], options: IntentTrajectoryOptions & { includeInferredContext?: boolean } = {}) {
  return trajectories
    .filter((trajectory) => !terminal.has(trajectory.status) && !trajectory.suppressed && trajectory.nextAction)
    .filter((trajectory) => !options.documentId || trajectory.documentId === options.documentId)
    .filter((trajectory) => !options.projectId || trajectory.projectId === options.projectId)
    .filter((trajectory) => options.includeInferredContext || trajectory.authority === "explicit" || trajectory.expectedOutputKind !== "context")
    .sort((left, right) => (right.nextAction?.priority ?? 0) - (left.nextAction?.priority ?? 0) || right.lastSequence - left.lastSequence);
}

export function unfinishedIntentTrajectories(events: readonly CreativeEvent[], options: IntentTrajectoryOptions & { includeInferredContext?: boolean } = {}) {
  return unfinishedFromTrajectories(deriveIntentTrajectories(events, options), options);
}

export function summarizeIntentTrajectories(events: readonly CreativeEvent[], options: IntentTrajectoryOptions = {}) {
  const trajectories = deriveIntentTrajectories(events, options);
  const unfinished = unfinishedFromTrajectories(trajectories, options);
  const statuses = Object.fromEntries(trajectories.reduce((counts, trajectory) => counts.set(trajectory.status, (counts.get(trajectory.status) ?? 0) + 1), new Map<IntentTrajectoryStatus, number>()));
  return {
    trajectories,
    unfinished,
    statuses,
    completed: trajectories.filter((trajectory) => trajectory.status === "completed"),
    interrupted: trajectories.filter((trajectory) => trajectory.interrupted),
    resumed: trajectories.filter((trajectory) => trajectory.resumed),
    recommendations: unfinished.flatMap((trajectory) => trajectory.nextAction ? [trajectory.nextAction] : []),
  };
}
