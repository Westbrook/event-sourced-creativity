import { OUTPUT_REQUIREMENT_EVENT_TYPES } from "./output-requirement-events.ts";

/** Semantic state needed to reconstruct an exact creative resource; activity noise is a separate view. */
export const ASSISTANT_STATE_EVENT_TYPES = [
  ...OUTPUT_REQUIREMENT_EVENT_TYPES,
  "ProjectCreated", "ProjectOpened", "ProjectRenamed", "ProjectStateChanged",
  "DocumentCreated", "DocumentForked", "DocumentRenamed", "DocumentRemoved", "DocumentRestored", "DocumentProductionWorkflowConfigured",
  "BlockCreated", "BlockRenamed", "BlockPropertyEdited", "BlockWeightSet", "BlockLocked", "BlockUnlocked", "BlockRemoved", "BlockRestored", "BlockRehomed",
  "BlockRelationAdded", "BlockRelationRemoved", "ChipEdited", "ReferenceIngested", "RightsAsserted", "ExtractionRequested", "ExtractionCompleted", "ExtractionFailed", "ImageFocalPointCalculated",
  "GenerationCompleted", "IdeationPreviewCompleted", "IdeationPromoted", "DocumentRenderCompleted", "DocumentArtifactEdited", "OutputRenamed",
  "IntentDeclared", "GenerationRequested", "DocumentRenderRequested", "GenerationFailed", "DocumentRenderFailed",
  "GenerationPreflightCompleted", "GenerationBlockedBeforeProvider", "GenerationRemediationApplied", "GenerationRiskAcknowledged", "BudgetExceeded",
  "JobAttemptInterrupted", "JobCanceled", "JobForceFailed", "BranchAbandoned", "ProposalRejected", "ProposalDeclined", "BriefItemIgnored", "BriefDismissed",
  "SessionOpened", "SessionClosed", "ObjectViewed", "DocumentArtifactViewed", "DocumentArtifactExported", "ObjectCritiqued",
  "ArtifactReviewRequested", "ArtifactApproved", "ArtifactChangesRequested", "ObjectSaved", "ObjectDiscarded", "ObjectPinned", "ObjectUnpinned", "AddedToLibrary", "RemovedFromLibrary",
  "CanvasCreated", "CanvasRenamed", "CanvasRemoved", "CanvasRestored", "CanvasItemPlaced", "CanvasReferenceCreated", "CanvasItemRemoved", "CanvasItemRestored",
  "CanvasRegisterSet", "CanvasTextApplied", "CanvasArrangementCreated", "CanvasArrangementRemoved", "CanvasArrangementRestored", "ContextSetFormalized",
] as const;

/** Every value is a static source literal, never user input. */
export const ASSISTANT_STATE_EVENT_SQL = ASSISTANT_STATE_EVENT_TYPES.map((type) => `'${type}'`).join(",");
