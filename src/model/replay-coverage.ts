import { BLOCK_TYPES } from "./block-types.ts";
import { DOCUMENT_JOB_KINDS } from "./document-jobs.ts";
import { DOCUMENT_VIEWS } from "./document-view-signals.ts";
import type { CreativeEvent } from "./events.ts";
import { PROMPT_TECHNIQUES } from "./prompt-structures.ts";
import { normalizeSpatialScope } from "./spatial-scope.ts";

export const REPLAY_COVERAGE_CONTRACT_VERSION = 2;

export const REPLAY_CAPABILITIES = [
  { key:"event-vocabulary", label:"Every admitted event family is rehearsed", evidence:["event registry"] },
  { key:"context-vocabulary", label:"Every authored block type is exercised", evidence:["BlockCreated"] },
  { key:"document-view-workflow", label:"Every document view and Focus mode appear", evidence:["DocumentViewVisited"] },
  { key:"job-vocabulary", label:"Every durable asynchronous job kind appears", evidence:["GenerationRequested","ChatMessageSent","AssistantReasoned","ExtractionRequested"] },
  { key:"chat-resolution", label:"Multi-turn Chat changes intent with and without Live preview", evidence:["ChatMessageSent","AssistantReasoned","BlockCreated","BlockPropertyEdited"] },
  { key:"draft-promotion", label:"Draft selection becomes a full-quality visual handoff", evidence:["IdeationPreviewCompleted","IdeationPromoted","GenerationCompleted"] },
  { key:"prompt-fan", label:"Four distinct prompt structures stay grouped and reviewable", evidence:["GenerationRequested","ContextCompiled","GenerationCompleted","ComparisonOpened"] },
  { key:"prompt-fan-judgment", label:"Fan members can be promoted and their technique preferred", evidence:["PromptFanOutputPromoted","PromptTechniquePreferred","PromptTechniquePreferenceRevoked"] },
  { key:"spatial-vocabulary", label:"Document, region, rectangle, subject, and path scopes appear", evidence:["BlockCreated","BlockPropertyEdited"] },
  { key:"spatial-editing", label:"Rectangle handles and clipping-path points are actually edited", evidence:["BlockPropertyEdited"] },
  { key:"reference-realities", label:"Reference mood, composition, material, light, space, and palette are extracted", evidence:["ExtractionCompleted","ChipEdited"] },
  { key:"reference-pixel-handoff", label:"Rights-aware pixels reach preview and full image edits", evidence:["RightsAsserted","BlockPropertyEdited","ContextCompiled","GenerationCompleted"] },
  { key:"connected-context", label:"Typed reusable-block relationships survive compilation", evidence:["BlockRelationAdded","BlockRelationRemoved","ContextCompiled"] },
  { key:"revision-queue", label:"Overlapping revisions, recovery, and out-of-order completion stay legible", evidence:["GenerationRequested","JobAttemptInterrupted","GenerationCompleted"] },
  { key:"quality-media", label:"Draft and full outputs retain quality, media, and focal-point receipts", evidence:["IdeationPreviewCompleted","GenerationCompleted","ImageFocalPointCalculated"] },
  { key:"human-judgment", label:"Comparison, critique, selection, saving, and export are witnessed", evidence:["ComparisonOpened","ObjectCritiqued","ObjectPinned","AddedToLibrary","ObjectExported"] },
  { key:"taste-memory", label:"Taste, conditions, resurfacing, revocation, and forgetting stay reversible", evidence:["TasteModelVersioned","PreferenceAuthored","ConditionFired","FactRetracted"] },
  { key:"attention-friction", label:"Visible, bounded weak signals can be used and erased", evidence:["AttentionEpisodeObserved","AttentionSignalsForgotten"] },
  { key:"session-reentry", label:"A session boundary produces a useful, human-accepted return", evidence:["SessionClosed","BriefComposed","BriefItemAccepted","SessionOpened"] },
  { key:"bounded-agency", label:"Scout works in report space under a visible budget", evidence:["ScoutRunStarted","ScoutObserved","ObservationJudged","ScoutBudgetExhausted"] },
  { key:"document-lifecycle", label:"Project, document, collection, and reusable-block lifecycles appear", evidence:["ProjectCreated","DocumentForked","DocumentRemoved","CollectionCreated"] },
  { key:"operations", label:"Provider, retry, budget, validation, and retention failures remain inspectable", evidence:["BudgetReserved","JobAttemptInterrupted","BudgetReleased","ValidationFailed","RetentionSweepCompleted"] },
] as const;

export type ReplayCoverageCheck = {
  key: typeof REPLAY_CAPABILITIES[number]["key"];
  label: string;
  passed: boolean;
  summary: string;
  evidenceEventIds: string[];
};

const text = (value: unknown) => String(value ?? "");
const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown) => Array.isArray(value) ? value : [];
const eventIds = (events: CreativeEvent[]) => events.slice(0, 12).map((event) => event.eventId);

export function evaluateReplayCoverage(events: CreativeEvent[], expectedEventTypes: readonly string[] = []) {
  const types = new Set(events.map((event) => event.type));
  const blockEvents = events.filter((event) => event.type === "BlockCreated");
  const blockTypes = new Set(blockEvents.map((event) => text(event.payload.type)));
  const viewEvents = events.filter((event) => event.type === "DocumentViewVisited");
  const views = new Set(viewEvents.map((event) => text(event.payload.view)));
  const scopes = events.flatMap((event) => {
    if (event.type === "BlockCreated") return [normalizeSpatialScope(record(event.payload.properties).spatial_scope)];
    if (event.type === "BlockPropertyEdited" && event.payload.property_path === "spatial_scope") return [normalizeSpatialScope(event.payload.new_value)];
    return [];
  });
  const scopeKinds = new Set(scopes.map((scope) => scope.kind));
  const chats = events.filter((event) => event.type === "ChatMessageSent");
  const assistantEvents = events.filter((event) => event.type === "AssistantReasoned");
  const generated = events.filter((event) => event.type === "GenerationCompleted" && event.actor === "worker:generator");
  const previews = events.filter((event) => event.type === "IdeationPreviewCompleted");
  const focal = events.filter((event) => event.type === "ImageFocalPointCalculated");
  const fanEvents = generated.filter((event) => text(event.payload.prompt_fan_id));
  const fanGroups = new Map<string, CreativeEvent[]>();
  for (const event of fanEvents) {
    const id = text(event.payload.prompt_fan_id); fanGroups.set(id, [...(fanGroups.get(id) ?? []), event]);
  }
  const completeFan = [...fanGroups.values()].find((group) => {
    const techniques = new Set(group.map((event) => text(event.payload.prompt_technique)));
    const generationIds = new Set(group.map((event) => text(event.payload.generation_id)));
    const objects = new Set(group.flatMap((event) => list(event.payload.object_ids).map(text)));
    const media = new Set(group.map((event) => text(event.payload.media_url)).filter(Boolean));
    return PROMPT_TECHNIQUES.every((technique) => techniques.has(technique)) && generationIds.size >= 4 && objects.size >= 4 && media.size >= 4;
  }) ?? [];
  const requests = events.filter((event) => event.type === "GenerationRequested" && text(event.payload.requested_output) !== "report-candidate");
  const requestDocuments = new Set(requests.map((event) => text(event.payload.document_id)).filter(Boolean));
  let overlapping: CreativeEvent[] = []; let revisions = new Set<string>();
  for (const documentId of requestDocuments) {
    const documentRequests = requests.filter((event) => text(event.payload.document_id) === documentId);
    const firstCompletionIndex = events.findIndex((event) => event.type === "GenerationCompleted" && event.actor === "worker:generator" && text(event.payload.document_id) === documentId);
    const beforeCompletion = firstCompletionIndex > 0 ? documentRequests.filter((request) => events.indexOf(request) < firstCompletionIndex) : [];
    const documentRevisions = new Set(documentRequests.map((event) => text(event.payload.document_revision)).filter(Boolean));
    if (beforeCompletion.length >= 2 && documentRevisions.size >= 2) { overlapping = beforeCompletion; revisions = documentRevisions; break; }
  }
  const editedScopes = events.filter((event) => event.type === "BlockPropertyEdited" && event.payload.property_path === "spatial_scope" && ["aabb","path"].includes(normalizeSpatialScope(event.payload.new_value).kind) && /spatial-preview|scope-dialog/.test(text(event.payload.source_surface)));
  const extraction = events.filter((event) => event.type === "ExtractionCompleted");
  const findings = new Set(extraction.flatMap((event) => list(event.payload.chips).flatMap((chip) => list(record(chip).value).map((finding) => text(record(finding).kind))).filter(Boolean)));
  const paletteFound = extraction.some((event) => list(event.payload.chips).some((chip) => text(record(chip).property) === "colors"));
  const compiled = events.filter((event) => event.type === "ContextCompiled");
  const relationshipsCompiled = compiled.some((event) => list(record(event.payload.compiled_snapshot).relationships).length > 0);
  const pixelCompiled = compiled.some((event) => event.payload.used_uploaded_reference_pixels === true);
  const jobKinds = new Set(events.flatMap((event) => {
    const explicit = text(event.payload.job_kind); if (explicit) return [explicit];
    if (event.type === "GenerationRequested") return [event.payload.quality === "low" ? "preview" : "generate"];
    return [];
  }));
  const providerBacked = events.some((event) => event.payload.mock_data_source === "openai-provider");
  const providerFanValid = !providerBacked || completeFan.every((event) => text(event.payload.media_url).startsWith("/api/media/"));

  const matching = (...names: string[]) => events.filter((event) => names.includes(event.type));
  const checksByKey: Record<string, { passed: boolean; summary: string; evidence: CreativeEvent[] }> = {
    "event-vocabulary": { passed: expectedEventTypes.every((type) => types.has(type)), summary: `${types.size} event types; ${expectedEventTypes.filter((type) => !types.has(type)).length} expected types missing`, evidence: events },
    "context-vocabulary": { passed: BLOCK_TYPES.every((definition) => blockTypes.has(definition.type)), summary: `${blockTypes.size}/${BLOCK_TYPES.length} block types`, evidence: blockEvents },
    "document-view-workflow": { passed: DOCUMENT_VIEWS.every((view) => views.has(view)) && viewEvents.some((event) => event.payload.focused === true) && viewEvents.some((event) => event.payload.focused === false), summary: `${views.size}/${DOCUMENT_VIEWS.length} views with focused and standard visits`, evidence: viewEvents },
    "job-vocabulary": { passed: DOCUMENT_JOB_KINDS.every((kind) => jobKinds.has(kind)), summary: `${jobKinds.size}/${DOCUMENT_JOB_KINDS.length} durable job kinds`, evidence: events.filter((event) => text(event.payload.job_kind) || event.type === "GenerationRequested") },
    "chat-resolution": { passed: chats.length >= 3 && chats.some((event) => event.payload.live_preview_requested === true) && chats.some((event) => event.payload.live_preview_requested === false) && assistantEvents.length >= 3 && matching("BlockCreated","BlockPropertyEdited","BlockRemoved").length > 0, summary: `${chats.length} user turns, ${assistantEvents.length} model replies, Live preview on and off`, evidence: [...chats,...assistantEvents] },
    "draft-promotion": { passed: previews.some((event) => event.payload.quality === "low") && types.has("IdeationPromoted") && generated.some((event) => text(event.payload.promoted_from_object_id)), summary: "A low-quality draft has an explicit intent and full-quality outcome chain", evidence: matching("IdeationPreviewCompleted","IdeationPromoted","GenerationCompleted") },
    "prompt-fan": { passed: completeFan.length === 4 && providerFanValid && events.some((event) => event.type === "ComparisonOpened" && event.payload.comparison_kind === "prompt_fan" && list(event.payload.object_ids).length >= 4), summary: completeFan.length === 4 ? "Four unique prompt-technique outputs share one comparison" : `${completeFan.length}/4 distinct fan outputs`, evidence: completeFan },
    "prompt-fan-judgment": { passed: types.has("PromptFanOutputPromoted") && types.has("PromptTechniquePreferred") && types.has("PromptTechniquePreferenceRevoked"), summary: "Promotion, scoped preference, and revocation are all reversible", evidence: matching("PromptFanOutputPromoted","PromptTechniquePreferred","PromptTechniquePreferenceRevoked") },
    "spatial-vocabulary": { passed: (["document","region","aabb","subject","path"] as const).every((kind) => scopeKinds.has(kind)), summary: `${scopeKinds.size}/5 targeting methods`, evidence: events.filter((event) => event.type === "BlockCreated" || event.payload.property_path === "spatial_scope") },
    "spatial-editing": { passed: editedScopes.some((event) => normalizeSpatialScope(event.payload.new_value).kind === "aabb") && editedScopes.some((event) => normalizeSpatialScope(event.payload.new_value).kind === "path"), summary: `${editedScopes.length} handle- or point-driven spatial edits`, evidence: editedScopes },
    "reference-realities": { passed: ["mood","composition","material","lighting","spatial"].every((kind) => findings.has(kind)) && paletteFound && types.has("ChipEdited"), summary: `${findings.size} extracted reality classes plus palette and authored correction`, evidence: matching("ExtractionCompleted","ChipEdited") },
    "reference-pixel-handoff": { passed: types.has("RightsAsserted") && events.some((event) => event.type === "BlockPropertyEdited" && event.payload.property_path === "pixel_reference_mode" && event.payload.new_value !== "context_only") && pixelCompiled && [...previews,...generated].some((event) => event.payload.used_uploaded_reference_pixels === true), summary: "Rights, explicit pixel mode, compile receipt, and image edit agree", evidence: matching("RightsAsserted","BlockPropertyEdited","ContextCompiled","GenerationCompleted") },
    "connected-context": { passed: types.has("BlockRelationAdded") && types.has("BlockRelationRemoved") && relationshipsCompiled, summary: "Relationship changes are retained in a compiled snapshot", evidence: matching("BlockRelationAdded","BlockRelationRemoved","ContextCompiled") },
    "revision-queue": { passed: overlapping.length >= 2 && revisions.size >= 2 && types.has("JobAttemptInterrupted") && generated.length >= 2, summary: `${overlapping.length} overlapping requests across ${revisions.size} document revisions`, evidence: matching("GenerationRequested","JobAttemptInterrupted","GenerationCompleted") },
    "quality-media": { passed: previews.some((event) => text(event.payload.media_url) && event.payload.quality === "low") && generated.some((event) => text(event.payload.media_url) && event.payload.quality === "high") && focal.some((event) => event.payload.target_kind === "reference") && focal.some((event) => event.payload.target_kind === "generation"), summary: "Draft and full media have quality tiers and content-aware crop evidence", evidence: [...previews,...generated,...focal] },
    "human-judgment": { passed: ["ComparisonOpened","ObjectCritiqued","ObjectPinned","AddedToLibrary","ObjectExported"].every((type) => types.has(type)), summary: "Review and downstream commitment actions are represented", evidence: matching("ComparisonOpened","ObjectCritiqued","ObjectPinned","AddedToLibrary","ObjectExported") },
    "taste-memory": { passed: ["TasteModelVersioned","PreferenceAuthored","ConditionFired","Resurfaced","PreferenceRevoked","FactRetracted"].every((type) => types.has(type)), summary: "Ranking, promotion, trigger, resurfacing, revocation, and forgetting appear", evidence: matching("TasteModelVersioned","PreferenceAuthored","ConditionFired","Resurfaced","PreferenceRevoked","FactRetracted") },
    "attention-friction": { passed: types.has("AttentionEpisodeObserved") && types.has("AttentionSignalsForgotten"), summary: "Weak attention evidence is both usable and erasable", evidence: matching("AttentionEpisodeObserved","AttentionSignalsForgotten") },
    "session-reentry": { passed: ["SessionClosed","BriefComposed","BriefItemAccepted","SessionOpened"].every((type) => types.has(type)), summary: "Closed session, brief, human acceptance, and return form one chain", evidence: matching("SessionClosed","BriefComposed","BriefItemAccepted","SessionOpened") },
    "bounded-agency": { passed: ["ScoutRunStarted","ScoutObserved","ObservationJudged","ScoutBudgetExhausted"].every((type) => types.has(type)), summary: "Scout produces report-space evidence under a hard envelope", evidence: matching("ScoutRunStarted","ScoutObserved","ObservationJudged","ScoutBudgetExhausted") },
    "document-lifecycle": { passed: ["ProjectCreated","DocumentCreated","DocumentForked","DocumentRemoved","DocumentRestored","CollectionCreated","CollectionRemoved","CollectionRestored"].every((type) => types.has(type)), summary: "Project, document, collection, and reusable context history are exercised", evidence: matching("ProjectCreated","DocumentCreated","DocumentForked","DocumentRemoved","CollectionCreated") },
    "operations": { passed: ["BudgetReserved","JobAttemptInterrupted","BudgetReleased","BudgetExceeded","ValidationFailed","GenerationFailed","RetentionSweepCompleted"].every((type) => types.has(type)), summary: "Budget, recovery, validation, provider failure, and retention receipts appear", evidence: matching("BudgetReserved","JobAttemptInterrupted","BudgetReleased","ValidationFailed","GenerationFailed","RetentionSweepCompleted") },
  };
  const checks: ReplayCoverageCheck[] = REPLAY_CAPABILITIES.map((capability) => ({ key:capability.key, label:capability.label, passed:checksByKey[capability.key].passed, summary:checksByKey[capability.key].summary, evidenceEventIds:eventIds(checksByKey[capability.key].evidence) }));
  const missingEventTypes = expectedEventTypes.filter((type) => !types.has(type));
  return { contractVersion:REPLAY_COVERAGE_CONTRACT_VERSION, passed:checks.every((check) => check.passed), passedCount:checks.filter((check) => check.passed).length, total:checks.length, checks, eventTypes:types.size, blockTypes:blockTypes.size, allEventTypes:types, allBlockTypes:BLOCK_TYPES.every((definition) => blockTypes.has(definition.type)), missingEventTypes };
}
