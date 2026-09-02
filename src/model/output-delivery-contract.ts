import type { OutputIssue, OutputRequirementSpec } from "./output-requirements.ts";
import type { OutputPlan, OutputPlanOptions, OutputPlanSummary, OutputTargetState } from "./output-plan.ts";
import type { OutputAssetInspection } from "./output-asset-inspection.ts";

/** Per availability/cost check, not a limit on the complete delivery assignment. */
export const OUTPUT_PREFLIGHT_TARGET_MAX_COUNT = 256;

export type OutputRequirementRow = {
  blockId: string; subtype: string; content: string; locked: boolean;
  status: "valid" | "invalid" | "unsupported" | "draft";
  spec: OutputRequirementSpec | null; preserved: unknown; issues: OutputIssue[];
  planSuggestions: OutputPlanSuggestions;
};
export type OutputConfirmedPlan = {
  id: string; revisionId: string; revision: number; confirmedAt: string;
  requirementsDigest: string; sourceDigest: string; plan: OutputPlan;
  targetContractDigests: Record<string, string>;
  confirmationOptions: OutputConfirmationOptions;
};
export type OutputAssetRow = {
  id: string; name: string; mimeType: string; mediaKind: "image" | "slides" | "audio" | "video" | "document";
  byteLength: number; sha256: string; sourceDigest: string; createdByUserId: string; createdAt: string;
  inspection: OutputAssetInspection; downloadUrl: string; available: boolean;
};
export type OutputResultRow = {
  id: string; targetId: string; planRevisionId: string; assetId: string; resultRevision: string;
  targetContractDigest: string; sourceDigest: string; sha256: string;
  checksStatus: "passed" | "failed" | "unavailable"; checks: string[]; problems: string[];
  createdByUserId: string; createdAt: string; review: "pending" | "approved" | "changes_requested";
  acceptanceId: string | null;
  reviewAllowed: boolean; independentReviewBlocked: boolean;
};
export type OutputNativeTargetPreflight = {
  targetId: string; available: boolean; reason: string;
  reasonCode?: string; reasonValues?: Record<string, string | number>; transferCode?: string;
  provider: string | null; model: string | null; route: string | null;
  maximumMicrousd: number; maximumCalls: number; maximumTokens: number;
  settings: Record<string, unknown>; transferDescription: string;
};
export type OutputPreflight = {
  id: string; planRevisionId: string; termsDigest: string; sourceDigest: string; requirementsDigest: string;
  targets: OutputNativeTargetPreflight[]; maximumMicrousd: number; maximumCalls: number;
  expiresAt: string; createdAt: string;
  operationAttempts: Record<string, { ordinal: number; previousSlotId: string | null }>;
};
export type OutputGrantRow = {
  id: string; planRevisionId: string; actorUserId: string; payerUserId: string;
  status: "authorized" | "active" | "completed" | "revoked" | "exceeded";
  maximumMicrousd: number; maximumCalls: number; usedMicrousd: number; exposedMicrousd: number; usedCalls: number; pendingCalls: number; expiresAt: string;
  disclosure: OutputPreflight | null;
  operations: Array<{ id: string; targetId: string; targetLabel: string | null; jobId: string; status: string; maximumMicrousd: number; maximumCalls: number; usedMicrousd: number; exposedMicrousd: number; usedCalls: number; pendingCalls: number }>;
};
export type OutputRequirementsSnapshot = {
  schemaVersion: 1; documentId: string; projectId: string;
  scope: { kind: "personal" | "project"; organizationId: string | null; projectAccessId: string | null; actorUserId: string };
  revision: string; requirementRevision: string; sourceRevision: string;
  sourceVerification: {
    status: "verified" | "unavailable"; reasonCodes: string[];
    capacity: { referenceCount: number; distinctObjectCount: number; countsComplete: boolean; ownedReadLimit: number; nativeLimit: number;
      sources: Array<{ blockId: string; label: string }>; sourcesComplete: boolean };
    /** Display metadata only. The limit counts proof capture batches, not packages or sources. */
    governance?: { captureBatchLimit: number; sources: Array<{ blockId: string; label: string }>; sourcesComplete: boolean };
  };
  requirements: OutputRequirementRow[]; confirmedPlan: OutputConfirmedPlan | null;
  targetStates: OutputTargetState[]; summary: OutputPlanSummary | null; requirementSummaries: Record<string, OutputPlanSummary>; requirementFileCounts: Record<string, number | null>;
  assets: OutputAssetRow[]; results: OutputResultRow[]; grants: OutputGrantRow[];
  scopeAmendments: Array<{ eventId: string; previousPlanRevisionId: string; planRevisionId: string; actorUserId: string; occurredAt: string; reason: string; withdrawnTargetIds: string[]; withdrawnObligationIds: string[] }>;
  permissions: { canAuthor: boolean; canRequest: boolean; canReview: boolean; canDownload: boolean; independentReview: boolean };
  capabilities: { nativeGeneration: boolean; ownedFileAdoption: boolean; supportedFileExtensions: string[]; limitations: string[]; limitationCodes?: string[] };
};
export type OutputConfirmationOptions = Pick<OutputPlanOptions, "selected_optional_ids" | "selected_target_ids" | "count_policies" | "suggested_counts">;
export type OutputPlanSuggestions = Pick<OutputConfirmationOptions, "count_policies" | "suggested_counts">;
export type OutputCommandBase = { documentId: string; expectedRevision: string; clientMutationId: string };
export type OutputRequirementCommand = OutputCommandBase & (
  | { action: "save"; blockId: string; spec: unknown; planSuggestions?: OutputPlanSuggestions; amendmentReason?: string }
  | { action: "remove"; blockId: string }
  | { action: "confirm"; options?: OutputConfirmationOptions; amendmentReason?: string }
  | { action: "preflight"; planRevisionId: string; targetIds?: string[]; alternativeOfSlotId?: string }
  | { action: "authorize"; preflightId: string; termsDigest: string; maximumMicrousd: number; explicitAuthorization: true }
  | { action: "run"; grantId: string }
  | { action: "bind"; planRevisionId: string; targetId: string; assetId: string; nativeJobId?: never }
  | { action: "bind"; planRevisionId: string; targetId: string; nativeJobId: string; assetId?: never }
  | { action: "bind"; planRevisionId: string; targetId: string; acceptanceId: string; assetId?: never; nativeJobId?: never }
  | { action: "review"; resultId: string; decision: "approve" | "changes_requested"; reviewedCoverage: boolean; reviewedRights: boolean; note?: string }
  | { action: "export"; planRevisionId: string; allowPartial?: boolean }
);
export type OutputCommandResponse = {
  ok: true; replayed: boolean;
  command: { action: string; eventId: string; planRevisionId?: string; preflight?: OutputPreflight; grantId?: string; assetId?: string; resultId?: string; acceptanceId?: string; manifestId?: string; downloadUrl?: string; downloadUrls?: string[]; partCount?: number };
  /** Root can project these without automatic mutation rebasing, or reload its normal event stream. */
  appended: Array<{ eventId: string; streamId: string; sequence: number; occurredAt: string; recordedAt: string; actor: string; clientId: string; correlationId: string; causationId: string | null; compensatesEventId: string | null; schemaVersion: number; type: string; payload: Record<string, unknown> }>;
  snapshot: OutputRequirementsSnapshot;
};
