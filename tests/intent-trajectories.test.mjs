import assert from "node:assert/strict";
import test from "node:test";
import { briefEligibility, composeReentryBrief } from "../src/model/brief.ts";
import { deriveIntentTrajectories, intentDeclarationIsPrivate, sanitizeIntentDeclarationPayload, summarizeIntentTrajectories, unfinishedIntentTrajectories } from "../src/model/intent-trajectories.ts";
import { evaluateReplayCoverage } from "../src/model/replay-coverage.ts";
import { buildComprehensiveScenario, buildReplayScenario, SCENARIOS, SCENARIO_EVENT_TYPES } from "../src/model/scenarios.ts";

function event(sequence, type, payload = {}, options = {}) {
  const occurredAt = new Date(Date.UTC(2026, 0, 5, 9, 0, sequence)).toISOString();
  return {
    eventId: options.eventId ?? `intent-event-${sequence}`,
    streamId: options.streamId ?? "creative:owner",
    sequence,
    occurredAt,
    recordedAt: occurredAt,
    actor: options.actor ?? (/^(GenerationCompleted|DocumentRenderCompleted|DocumentRenderFailed)$/.test(type) ? "worker:renderer" : "user"),
    clientId: "test:intent",
    correlationId: `intent-correlation-${sequence}`,
    causationId: null,
    compensatesEventId: options.compensatesEventId ?? null,
    schemaVersion: 1,
    type,
    payload,
  };
}

test("separates simultaneous goals and waits for exact creator consumption", () => {
  const scope = { project_id: "project-a", document_id: "document-a", workflow_id: "workflow-a" };
  const history = [
    event(1, "ProjectCreated", { project_id: "project-a" }),
    event(2, "DocumentCreated", scope),
    event(3, "IntentDeclared", { ...scope, intent_id: "image-a", scope_ref: "document-a", statement_ref: "private:a", expected_output_kind: "image" }),
    event(4, "GenerationRequested", { ...scope, intent_id: "image-a", generation_id: "generation-a" }),
    event(5, "IntentDeclared", { ...scope, intent_id: "image-b", scope_ref: "document-a", statement_ref: "private:b", expected_output_kind: "image" }),
    event(6, "GenerationRequested", { ...scope, intent_id: "image-b", generation_id: "generation-b" }),
    event(7, "GenerationCompleted", { ...scope, intent_id: "image-a", generation_id: "generation-a", object_ids: ["object-a"] }, { actor: "worker:generator" }),
  ];

  const ready = deriveIntentTrajectories(history);
  assert.equal(ready.find((trajectory) => trajectory.id === "image-a")?.status, "ready");
  assert.equal(ready.find((trajectory) => trajectory.id === "image-b")?.status, "pending");
  assert.equal(unfinishedIntentTrajectories(history)[0].nextAction.label, "Review your ready image");

  const unrelatedReview = [...history, event(8, "ObjectViewed", { object_id: "object-other" })];
  assert.equal(deriveIntentTrajectories(unrelatedReview).find((trajectory) => trajectory.id === "image-a")?.status, "ready");

  const reviewed = [...history, event(8, "ObjectViewed", { object_id: "object-a" })];
  assert.equal(deriveIntentTrajectories(reviewed).find((trajectory) => trajectory.id === "image-a")?.status, "completed");
  assert.equal(deriveIntentTrajectories(reviewed).find((trajectory) => trajectory.id === "image-b")?.status, "pending");

  const machineRequested = reviewed.map((item) => item.type === "GenerationRequested" && item.payload.intent_id === "image-a" ? { ...item, actor: "worker:renderer" } : item);
  assert.equal(deriveIntentTrajectories(machineRequested).find((trajectory) => trajectory.id === "image-a")?.status, "initiated");
});

test("requires every scoped reference permission and excludes foreign or synthetic evidence", () => {
  const scope = { project_id: "project-a", document_id: "document-a", workflow_id: "workflow-a" };
  const history = [
    event(1, "ProjectCreated", { project_id: "project-a" }),
    event(2, "DocumentCreated", scope),
    event(3, "ReferenceIngested", { ...scope, reference_id: "reference-a" }),
    event(4, "ReferenceIngested", { ...scope, reference_id: "reference-b" }),
    event(5, "IntentDeclared", { ...scope, intent_id: "image-a", scope_ref: "document-a", statement_ref: "private:a", expected_output_kind: "image" }),
    event(6, "GenerationRequested", { ...scope, intent_id: "image-a", generation_id: "generation-a", reference_rights_required: true }),
  ];
  assert.equal(unfinishedIntentTrajectories(history)[0].blocker, "reference-rights");

  const foreignRights = [...history, event(7, "RightsAsserted", { ...scope, project_id: "another-project", reference_id: "reference-a" }, { streamId: "creative:another-owner" })];
  assert.equal(unfinishedIntentTrajectories(foreignRights, { streamId: "creative:owner" })[0].blocker, "reference-rights");
  const workerRights = [...history, event(7, "RightsAsserted", { ...scope, reference_id: "reference-a" }, { actor: "worker:renderer" }), event(8, "RightsAsserted", { ...scope, reference_id: "reference-b" }, { actor: "worker:renderer" })];
  assert.equal(unfinishedIntentTrajectories(workerRights)[0].blocker, "reference-rights");
  const unsafeRemediation = [...history, event(7, "GenerationRemediationApplied", { ...scope, intent_id: "image-a" }, { actor: "worker:policy" })];
  assert.equal(unfinishedIntentTrajectories(unsafeRemediation)[0].blocker, "reference-rights");
  const forgedCompletion = [...history, event(7, "GenerationCompleted", { ...scope, intent_id: "image-a", generation_id: "generation-a", object_id: "object-a" }, { actor: "worker:generator" }), event(8, "ObjectViewed", { ...scope, intent_id: "image-a", object_id: "object-a" })];
  assert.equal(unfinishedIntentTrajectories(forgedCompletion)[0].blocker, "reference-rights");
  const machineDismissed = [...history, event(7, "BriefItemIgnored", { ...scope, item_id: "intent:image-a" }, { actor: "worker:brief" })];
  assert.equal(unfinishedIntentTrajectories(machineDismissed)[0].suppressed, false);
  assert.equal(unfinishedIntentTrajectories(history, { projectId: "another-project" }).length, 0);

  const oneReceipt = [...history, event(7, "RightsAsserted", { ...scope, reference_id: "reference-a" })];
  assert.equal(unfinishedIntentTrajectories(oneReceipt)[0].blocker, "reference-rights");
  const bothReceipts = [...oneReceipt, event(8, "RightsAsserted", { ...scope, reference_id: "reference-b" })];
  assert.equal(unfinishedIntentTrajectories(bothReceipts)[0].status, "pending");

  const synthetic = history.map((item) => ({ ...item, payload: { ...item.payload, origin: { synthetic: true } } }));
  assert.equal(deriveIntentTrajectories(synthetic).length, 0);
  assert.ok(deriveIntentTrajectories(synthetic, { includeSynthetic: true }).length > 0);
});

test("recovers a directly requested unfinished goal on the first return without generic suggestions", () => {
  const scope = { project_id: "project-a", document_id: "document-a", workflow_id: "workflow-a" };
  const history = [
    event(1, "ProjectCreated", { project_id: "project-a", name: "Mars greenhouse" }),
    event(2, "DocumentCreated", { ...scope, title: "Launch direction" }),
    event(3, "BlockCreated", { ...scope, block_id: "direction-a", type: "direction", handle: "direction/mars", position: "a0", properties: { text: "Launch a Mars greenhouse", authority: "authored" } }),
    event(4, "DocumentRenderRequested", { ...scope, artifact_id: "presentation-a", artifact_kind: "slides" }),
    event(5, "SessionClosed", { session_id: "session-a", snapshot_ref: { ...scope, head: 4 } }),
  ];
  const eligibility = briefEligibility(history);
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.requiredClosedSessions, 1);

  const composed = composeReentryBrief(history, "brief-a");
  assert.equal(composed.eligible, true);
  assert.deepEqual(composed.payload.items.map((item) => item.item_type), ["intent"]);
  assert.match(composed.payload.items[0].title, /presentation/i);
  assert.equal(composed.payload.items[0].destination.view, "document");

  const ignored = [...history, event(6, "BriefItemIgnored", { ...scope, item_id: composed.payload.items[0].item_id })];
  assert.equal(briefEligibility(ignored).requiredClosedSessions, 3);
  assert.equal(briefEligibility(ignored).eligible, false);

  const providerMock = history.map((item) => ({ ...item, payload: { ...item.payload, mock_data_source: "openai-provider" } }));
  assert.equal(briefEligibility(providerMock).requiredClosedSessions, 3);
});

test("ready presentations deep-link to the exact artifact and consumed goals disappear", () => {
  const scope = { project_id: "project-a", document_id: "document-a", workflow_id: "workflow-a" };
  const history = [
    event(1, "ProjectCreated", { project_id: "project-a", name: "Mars greenhouse" }),
    event(2, "DocumentCreated", { ...scope, title: "Launch direction" }),
    event(3, "DocumentRenderRequested", { ...scope, artifact_id: "presentation-a", artifact_kind: "slides" }),
    event(4, "SessionClosed", { session_id: "session-a", snapshot_ref: { ...scope, head: 3 } }),
    event(5, "DocumentRenderCompleted", { ...scope, artifact_id: "presentation-a", artifact_kind: "slides", title: "Greenhouse launch" }),
  ];
  const composed = composeReentryBrief(history, "brief-ready");
  assert.equal(composed.eligible, true);
  assert.match(composed.payload.items[0].title, /review your ready presentation/i);
  assert.match(composed.payload.items[0].destination.route, /\/library\/artifact\/presentation-a/);
  const consumed = [...history, event(6, "DocumentArtifactViewed", { ...scope, artifact_id: "presentation-a", artifact_kind: "slides" })];
  assert.equal(unfinishedIntentTrajectories(consumed).length, 0);
});

const artifactScope = { project_id: "project-a", document_id: "document-a", workflow_id: "workflow-a",
  artifact_id: "presentation-a", artifact_kind: "slides" };
const artifactHash = "a".repeat(64), revisedArtifactHash = "b".repeat(64);
function artifactIntentHistory(completion = {}) {
  return [event(1, "ProjectCreated", { project_id: "project-a" }), event(2, "DocumentCreated", artifactScope),
    event(3, "DocumentRenderRequested", artifactScope), event(4, "DocumentRenderCompleted", { ...artifactScope, ...completion })];
}
const artifactIntentStatus = history => deriveIntentTrajectories(history).find(row => row.id === "presentation-a")?.status;

test("versioned artifact consumption requires the current exact revision and bytes", () => {
  const history = artifactIntentHistory({ artifact_revision: 0, content_sha256: artifactHash });
  for (const type of ["DocumentArtifactViewed", "DocumentArtifactExported", "ObjectViewed"]) {
    const exact = { ...artifactScope, artifact_revision: 0, content_sha256: artifactHash };
    assert.equal(artifactIntentStatus([...history, event(5, type, exact)]), "completed", type);
    for (const patch of [
      { artifact_revision: undefined }, { artifact_revision: "0" }, { artifact_revision: -1 },
      { artifact_revision: 1 }, { artifact_revision: 0.5 }, { artifact_revision: Number.MAX_SAFE_INTEGER + 1 },
      { content_sha256: undefined }, { content_sha256: revisedArtifactHash }, { content_sha256: "not-a-hash" },
      { content_sha256: "A".repeat(64) }, { document_id: "another-document" }, { project_id: "another-project" },
      { workflow_id: "another-workflow" }, { destination_kind: "soundtrack-companion" },
    ]) assert.equal(artifactIntentStatus([...history, event(5, type, { ...exact, ...patch })]), "ready", `${type}: ${JSON.stringify(patch)}`);
    assert.equal(artifactIntentStatus([...history, event(5, type, artifactScope)]), "ready", "missing exact receipt");
  }
});

test("artifact-derived objects cannot bypass exact review through an object ID", () => {
  for (const mapped of [{ object_id: "artifact-object" }, { object_ids: ["artifact-object"] }]) {
    const history = [...artifactIntentHistory({ ...mapped, artifact_revision: 0, content_sha256: artifactHash }),
      event(5, "DocumentArtifactEdited", { ...artifactScope, revision: 1, content_sha256: revisedArtifactHash })];
    for (const type of ["ObjectViewed", "ObjectSaved", "DocumentArtifactViewed"]) {
      const exact = { ...artifactScope, object_id: "artifact-object", artifact_revision: 1, content_sha256: revisedArtifactHash };
      assert.equal(artifactIntentStatus([...history, event(6, type, exact)]), "completed");
      assert.equal(artifactIntentStatus([...history, event(6, type, { ...exact, artifact_id: undefined })]), "completed", "native object mapping retains artifact identity");
      for (const patch of [{ artifact_revision: 0, content_sha256: artifactHash }, { artifact_revision: undefined },
        { content_sha256: undefined }, { artifact_id: "different-artifact" }, { destination_kind: "soundtrack-companion" }])
        assert.equal(artifactIntentStatus([...history, event(6, type, { ...exact, ...patch })]), "ready", type + JSON.stringify(patch));
    }
  }
  const legacy = artifactIntentHistory({ object_id: "artifact-object" });
  assert.equal(artifactIntentStatus([...legacy, event(5, "ObjectViewed", { object_id: "artifact-object" })]), "completed");
  const partial = [...legacy, event(5, "ObjectViewed", { object_id: "artifact-object", artifact_revision: 0 })];
  assert.equal(artifactIntentStatus([...partial, event(6, "ObjectViewed", { object_id: "artifact-object" })]), "ready", "partial exact object receipt cannot fall back to legacy");
});

test("initial renders without a hash accept a new exact witness while wholly unversioned history remains compatible", () => {
  const history = artifactIntentHistory(), exact = { ...artifactScope, artifact_revision: 0, content_sha256: artifactHash };
  assert.equal(artifactIntentStatus([...history, event(5, "DocumentArtifactViewed", exact)]), "completed");
  assert.equal(artifactIntentStatus([...history, event(5, "DocumentArtifactViewed", artifactScope)]), "completed", "historical identity-only receipt");
  for (const partial of [{ artifact_revision: 0 }, { content_sha256: artifactHash }]) {
    const observed = [...history, event(5, "DocumentArtifactViewed", { ...artifactScope, ...partial })];
    assert.equal(artifactIntentStatus(observed), "ready");
    assert.equal(artifactIntentStatus([...observed, event(6, "DocumentArtifactViewed", artifactScope)]), "ready", "version evidence cannot fall back to legacy");
  }
  const reviewRequested = [...history, event(5, "ArtifactReviewRequested", exact)];
  assert.equal(artifactIntentStatus([...reviewRequested, event(6, "DocumentArtifactViewed", artifactScope)]), "ready");
  const completed = [...history, event(5, "DocumentArtifactViewed", exact)];
  assert.equal(artifactIntentStatus([...completed, event(6, "DocumentArtifactEdited", {
    ...artifactScope, revision: 1, content_sha256: revisedArtifactHash,
  })]), "completed", "later editing does not retroactively reopen a completed goal");
});

test("artifact edits advance the scoped revision and require their own current hash", () => {
  const history = artifactIntentHistory({ artifact_revision: 0, content_sha256: artifactHash });
  const edit = event(5, "DocumentArtifactEdited", { ...artifactScope, revision: 1, content_sha256: revisedArtifactHash });
  const reviewed = event(6, "DocumentArtifactViewed", { ...artifactScope, artifact_revision: 1, content_sha256: revisedArtifactHash });
  assert.equal(artifactIntentStatus([...history, edit, reviewed]), "completed");
  for (const patch of [{ artifact_revision: 0, content_sha256: artifactHash }, { artifact_revision: 2 }, { content_sha256: artifactHash }])
    assert.equal(artifactIntentStatus([...history, edit, { ...reviewed, payload: { ...reviewed.payload, ...patch } }]), "ready");
  for (const patch of [{ revision: 2 }, { revision: undefined }, { content_sha256: undefined }, { content_sha256: "malformed" }])
    assert.equal(artifactIntentStatus([...history, { ...edit, payload: { ...edit.payload, ...patch } }, reviewed]), "ready", JSON.stringify(patch));
  for (const patch of [{ document_id: "other-document" }, { project_id: "other-project" }, { workflow_id: "other-workflow" }])
    assert.equal(artifactIntentStatus([...history, { ...edit, payload: { ...edit.payload, ...patch } },
      event(6, "DocumentArtifactViewed", { ...artifactScope, artifact_revision: 0, content_sha256: artifactHash })]), "completed", "foreign edit cannot alter this artifact");
  assert.equal(artifactIntentStatus([...history, { ...edit, streamId: "creative:other" },
    event(6, "DocumentArtifactViewed", { ...artifactScope, artifact_revision: 0, content_sha256: artifactHash })]), "completed");
});

test("compensated artifact observations cannot complete a goal and compensating edits still advance revision", () => {
  const history = artifactIntentHistory({ artifact_revision: 0, content_sha256: artifactHash });
  const viewed = event(5, "DocumentArtifactViewed", { ...artifactScope, artifact_revision: 0, content_sha256: artifactHash });
  const undo = event(6, "DocumentArtifactViewed", viewed.payload, { compensatesEventId: viewed.eventId });
  assert.equal(artifactIntentStatus([...history, viewed, undo]), "ready", "withdraw both original and compensating observation");
  assert.equal(artifactIntentStatus([...history, { ...viewed, compensatesEventId: "earlier-observation" }]), "ready");
  assert.equal(artifactIntentStatus([...history, viewed, { ...undo, streamId: "creative:other" }]), "completed", "compensation cannot cross streams");
  assert.equal(artifactIntentStatus([...history, viewed, undo, event(7, "DocumentArtifactViewed", viewed.payload)]), "completed", "a new independent review remains usable");
  const forward = event(5, "DocumentArtifactViewed", viewed.payload, { compensatesEventId: "intent-event-6" });
  assert.equal(artifactIntentStatus([...history, forward, event(6, "DocumentArtifactViewed", viewed.payload)]), "completed", "forward compensation cannot suppress a future review");
  const edited = [...history, event(5, "DocumentArtifactEdited", { ...artifactScope, revision: 1, content_sha256: revisedArtifactHash }),
    event(6, "DocumentArtifactEdited", { ...artifactScope, revision: 2, content_sha256: artifactHash }, { compensatesEventId: "intent-event-5" })];
  assert.equal(artifactIntentStatus([...edited, event(7, "DocumentArtifactViewed", { ...artifactScope, artifact_revision: 2, content_sha256: artifactHash })]), "completed");
});

test("normalizes every isolated capability study without inventing cross-workflow history", () => {
  for (const scenario of SCENARIOS) {
    const stream = buildReplayScenario(scenario.key, 1_000);
    const check = evaluateReplayCoverage(stream, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === "workflow-causal-integrity");
    assert.equal(stream.length, 1_000, scenario.key);
    assert.deepEqual(new Set(stream.map((item) => item.payload.narrative_scenario)), new Set([scenario.key]));
    assert.equal(check?.passed, true, `${scenario.key}: ${check?.summary}`);
  }
});

test("keeps recovered evidence and preview handoffs inside their own creator workflow", () => {
  for (const scenario of ["creative-loop", "intent-recovery", "output-workbench"]) {
    const stream = buildReplayScenario(scenario, 1_000);
    const byId = new Map(stream.map((item) => [item.eventId, item]));
    for (const item of stream) {
      for (const key of ["draft_event_id", "reference_preview_event_id"]) {
        const reference = item.payload[key];
        if (!reference) continue;
        const source = byId.get(reference);
        assert.ok(source && source.sequence < item.sequence, `${scenario}:${key}:${reference}`);
        assert.equal(source.payload.workflow_id, item.payload.workflow_id, `${scenario}:${key}`);
        if (key === "draft_event_id") assert.equal(item.payload.draft_sequence, source.sequence);
      }
      if (item.type !== "BriefComposed") continue;
      for (const suggestion of item.payload.items ?? []) for (const reference of suggestion.source_event_refs ?? []) assert.ok(byId.has(reference), `${scenario}:${reference}`);
    }
  }
});

test("isolates duplicate goal identifiers across simultaneous workflows", () => {
  const base = { project_id: "project-a", document_id: "document-a" };
  const history = [
    event(1, "ProjectCreated", { project_id: "project-a" }),
    event(2, "DocumentCreated", base),
    event(3, "IntentDeclared", { ...base, workflow_id: "workflow-a", intent_id: "same-goal", scope_ref: "document-a", statement_ref: "private:a", expected_output_kind: "image" }),
    event(4, "GenerationRequested", { ...base, workflow_id: "workflow-a", intent_id: "same-goal", generation_id: "generation-a" }),
    event(5, "IntentDeclared", { ...base, workflow_id: "workflow-b", intent_id: "same-goal", scope_ref: "document-a", statement_ref: "private:b", expected_output_kind: "image" }),
    event(6, "GenerationRequested", { ...base, workflow_id: "workflow-b", intent_id: "same-goal", generation_id: "generation-b" }),
    event(7, "GenerationCompleted", { ...base, workflow_id: "workflow-a", intent_id: "same-goal", generation_id: "generation-a", object_id: "object-a" }, { actor: "worker:generator" }),
    event(8, "GenerationCompleted", { ...base, workflow_id: "workflow-b", intent_id: "same-goal", generation_id: "generation-b", object_id: "object-b" }, { actor: "worker:generator" }),
  ];
  const wrong = [...history, event(9, "ObjectViewed", { ...base, workflow_id: "workflow-a", intent_id: "same-goal", object_id: "object-b" })];
  assert.equal(deriveIntentTrajectories(wrong).filter((trajectory) => trajectory.status === "ready").length, 2);

  const completed = [...history, event(9, "ObjectViewed", { ...base, workflow_id: "workflow-b", intent_id: "same-goal", object_id: "object-b" })];
  assert.equal(deriveIntentTrajectories(completed).find((trajectory) => trajectory.workflowId === "workflow-b")?.status, "completed");
  assert.equal(deriveIntentTrajectories(completed).find((trajectory) => trajectory.workflowId === "workflow-a")?.status, "ready");
});

test("semantic contracts reject plaintext intent, cross-user causation, and fabricated consumption", () => {
  const baseline = buildComprehensiveScenario();
  const scoutEvidence = evaluateReplayCoverage(baseline, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === "bounded-agency")?.evidenceEventIds ?? [];
  assert.ok(scoutEvidence.some((eventId) => baseline.find((item) => item.eventId === eventId)?.type === "ScoutRunStarted"));
  assert.equal(scoutEvidence.every((eventId) => { const item = baseline.find((candidate) => candidate.eventId === eventId); return item?.type !== "GenerationRequested" || item.actor === "worker:scout"; }), true);
  const privateLeak = baseline.map((item) => item.type === "IntentDeclared" ? { ...item, payload: { ...item.payload, statement_text: "private creator goal" } } : item);
  assert.equal(evaluateReplayCoverage(privateLeak, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === "intent-vector-lifecycle")?.passed, false);

  const stolen = baseline.map((item) => item.type === "GenerationCompleted" && item.causationId ? { ...item, streamId: "creative:another-owner" } : item);
  assert.equal(evaluateReplayCoverage(stolen, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === "workflow-causal-integrity")?.passed, false);

  const fabricated = baseline.map((item) => /^(DocumentArtifactViewed|DocumentArtifactExported)$/.test(item.type) ? { ...item, payload: { ...item.payload, artifact_id: `nonexistent-${item.payload.artifact_kind}` } } : item);
  assert.equal(evaluateReplayCoverage(fabricated, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === "output-consumption")?.passed, false);
  const machineReviewed = baseline.map((item) => /^(DocumentArtifactViewed|DocumentArtifactExported|ObjectViewed|ObjectSaved|ObjectExported|ObjectPinned|ObjectCritiqued|AddedToLibrary|ComparisonOpened)$/.test(item.type) ? { ...item, actor: "worker:renderer" } : item);
  for (const key of ["output-consumption", "human-judgment", "artifact-first-reconstruction"]) assert.equal(evaluateReplayCoverage(machineReviewed, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === key)?.passed, false, key);
  const machineDeclared = baseline.map((item) => item.type === "IntentDeclared" ? { ...item, actor: "worker:renderer" } : item);
  assert.equal(evaluateReplayCoverage(machineDeclared, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === "intent-vector-lifecycle")?.passed, false);
  const machineApproved = baseline.map((item) => item.type === "RightsAsserted" ? { ...item, actor: "worker:renderer" } : item);
  assert.equal(evaluateReplayCoverage(machineApproved, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === "reference-pixel-handoff")?.passed, false);
  const machineRequested = baseline.map((item) => item.type === "GenerationRequested" && item.payload.requested_output !== "report-candidate" ? { ...item, actor: "worker:policy" } : item);
  for (const key of ["prompt-fan", "canvas-document-rendering", "revision-queue", "reference-pixel-handoff", "image-format-control", "one-context-many-outputs"]) assert.equal(evaluateReplayCoverage(machineRequested, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === key)?.passed, false, key);
  const machineRendered = baseline.map((item) => item.type === "DocumentRenderRequested" ? { ...item, actor: "worker:policy" } : item);
  assert.equal(evaluateReplayCoverage(machineRendered, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === "document-artifact-rendering")?.passed, false);
  const machinePromoted = baseline.map((item) => item.type === "IdeationPromoted" ? { ...item, actor: "worker:policy" } : item);
  assert.equal(evaluateReplayCoverage(machinePromoted, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === "draft-promotion")?.passed, false);
  for (const type of ["PromptFanOutputPromoted", "PromptTechniquePreferred", "PromptTechniquePreferenceRevoked"]) {
    const machineJudgment = baseline.map((item) => item.type === type ? { ...item, actor: "worker:policy" } : item);
    assert.equal(evaluateReplayCoverage(machineJudgment, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === "prompt-fan-judgment")?.passed, false, type);
  }
  const unmatchedRights = baseline.map((item) => item.type === "RightsAsserted" && item.payload.narrative_scenario === "creative-loop" ? { ...item, payload: { ...item.payload, reference_id: "not-the-uploaded-reference" } } : item);
  assert.equal(evaluateReplayCoverage(unmatchedRights, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === "reference-pixel-handoff")?.passed, false);
  const unsafeRecovery = baseline.map((item) => item.type === "RightsAsserted" && item.payload.narrative_scenario === "intent-recovery" ? { ...item, payload: { ...item.payload, reference_id: "not-the-blocking-reference" } } : item);
  assert.equal(evaluateReplayCoverage(unsafeRecovery, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === "unfinished-intent-recovery")?.passed, false);
  const brokenEvidence = baseline.map((item) => item.payload.reference_preview_event_id ? { ...item, payload: { ...item.payload, reference_preview_event_id: "missing-evidence-receipt" } } : item);
  assert.equal(evaluateReplayCoverage(brokenEvidence, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === "workflow-causal-integrity")?.passed, false);
  for (const type of ["ContextCompiled", "DocumentRenderCompleted", "DocumentRenderFailed"]) {
    const forgedProducer = baseline.map((item) => item.type === type ? { ...item, actor: "user" } : item);
    assert.equal(evaluateReplayCoverage(forgedProducer, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === "workflow-causal-integrity")?.passed, false, type);
  }
  for (const runId of [null, "another-scout-run"]) {
    const unboundedScout = baseline.map((item) => item.type === "GenerationRequested" && item.actor === "worker:scout" ? { ...item, payload: { ...item.payload, run_id: runId } } : item);
    for (const key of ["prompt-fan", "bounded-agency"]) assert.equal(evaluateReplayCoverage(unboundedScout, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === key)?.passed, false, `${key}:${runId}`);
  }
  const exceededScoutBudget = baseline.map((item) => item.type === "ScoutRunStarted" && item.payload.narrative_scenario === "async-return" ? { ...item, payload: { ...item.payload, envelope: { ...item.payload.envelope, max_observations: 1 } } } : item);
  assert.equal(evaluateReplayCoverage(exceededScoutBudget, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === "bounded-agency")?.passed, false);
  const machineRecovered = baseline.map((item) => item.type === "BriefItemAccepted" ? { ...item, actor: "worker:brief" } : item);
  for (const key of ["unfinished-intent-recovery", "session-reentry"]) assert.equal(evaluateReplayCoverage(machineRecovered, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === key)?.passed, false, key);
  const machineAccepted = baseline.map((item) => item.type === "ProposalAccepted" ? { ...item, actor: "worker:renderer" } : item);
  for (const key of ["canvas-report-space", "artifact-first-reconstruction"]) assert.equal(evaluateReplayCoverage(machineAccepted, SCENARIO_EVENT_TYPES).checks.find((entry) => entry.key === key)?.passed, false, key);
  assert.equal(summarizeIntentTrajectories(baseline, { includeSynthetic: true }).completed.length > 0, true);
});

test("private goal declarations reject nested creative content and preserve only safe pointers", () => {
  const contaminated = { scope_ref: "document-a", statement_ref: "private:a", intent_id: "goal-a", locked_decisions: [{ value: "PRIVATE CREATIVE DIRECTION" }], study_lock_summary: "PRIVATE SUMMARY", metadata: { statement: "PRIVATE GOAL" }, output_brief: { purpose: "PRIVATE PURPOSE" }, source_block_versions: [{ block_id: "block-a", version: 1 }] };
  assert.equal(intentDeclarationIsPrivate(contaminated), false);
  const sanitized = sanitizeIntentDeclarationPayload(contaminated);
  assert.equal(intentDeclarationIsPrivate(sanitized), true);
  assert.equal(JSON.stringify(sanitized).includes("PRIVATE"), false);
  assert.deepEqual(sanitized.source_block_versions, [{ block_id: "block-a", version: 1 }]);
  assert.equal(intentDeclarationIsPrivate({ scope_ref: "document-a", document_id: "document-a", statement_ref: "I want a secret campaign for ACME" }), false);
  assert.equal(intentDeclarationIsPrivate({ scope_ref: "document-a", document_id: "document-a", statement_ref: "data:text/plain,SECRET" }), false);
  assert.equal(intentDeclarationIsPrivate({ scope_ref: "another-document", document_id: "document-a", statement_ref: "private:a" }), false);
});
