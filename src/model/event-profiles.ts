import { OUTPUT_REQUIREMENT_EVENT_TYPES } from "./output-requirement-events.ts";
import { isPhantomAttentionEpisode } from "./attention.ts";

export const EVENT_PROFILE_ORDER = ["projects", "workspace", "memory", "scout", "sessions", "full"] as const;

export type EventProfile = typeof EVENT_PROFILE_ORDER[number];
export type ScopedEventProfile = Exclude<EventProfile, "full">;

/** Project cards need structural and output receipts, not account-wide telemetry. */
export const PROJECT_BOOTSTRAP_EVENT_TYPES = [
  ...OUTPUT_REQUIREMENT_EVENT_TYPES,
  "ProjectCreated", "ProjectOpened", "ProjectRenamed", "ProjectStateChanged",
  "DocumentCreated", "DocumentForked", "DocumentOpened", "DocumentRenamed",
  "DocumentRemoved", "DocumentRestored", "BlockCreated", "BlockRemoved",
  "BlockRestored", "BlockRehomed", "CollectionCreated", "CollectionRemoved",
  "CollectionRestored", "IdeationPreviewCompleted", "GenerationCompleted", "GuestImageResultClaimed",
  "DocumentRenderCompleted", "DocumentArtifactEdited", "GeneratedImageEdited", "OutputRenamed", "ArtifactReviewRequested", "ArtifactApproved", "ArtifactChangesRequested", "ObjectDiscarded", "ObjectPinned", "ObjectUnpinned",
  "ObjectSaved", "AddedToLibrary", "RemovedFromLibrary", "PromptFanOutputPromoted",
  "ImageFocalPointCalculated",
] as const;

/** Each successive profile contains every event needed by the profiles before it. */
export const PROFILE_EXCLUDED_EVENT_TYPES: Record<Exclude<ScopedEventProfile, "projects">, readonly string[]> = {
  workspace: [
    "AttentionEpisodeObserved", "ApplicationViewVisited", "CanvasInteractionRecorded",
    "DocumentViewVisited", "ObjectViewed", "ComparisonOpened",
    "GenerationPreflightRequested", "GenerationPreflightCompleted", "ValidationFailed",
  ],
  memory: [
    "ApplicationViewVisited", "CanvasInteractionRecorded", "ObjectViewed", "ComparisonOpened",
    "GenerationPreflightRequested", "GenerationPreflightCompleted", "ValidationFailed",
  ],
  scout: [
    "ApplicationViewVisited", "GenerationPreflightRequested",
    "GenerationPreflightCompleted", "ValidationFailed",
  ],
  sessions: ["ApplicationViewVisited", "GenerationPreflightRequested"],
};

export const SCOPED_EVENT_PROFILES = EVENT_PROFILE_ORDER.filter((profile): profile is ScopedEventProfile => profile !== "full");

export function isScopedEventProfile(value: string | null): value is ScopedEventProfile {
  return value !== null && SCOPED_EVENT_PROFILES.includes(value as ScopedEventProfile);
}

export function eventProfileRank(profile: EventProfile) {
  return EVENT_PROFILE_ORDER.indexOf(profile);
}

export function eventMatchesProfile(profile: EventProfile, eventType: string, payload?: Record<string, unknown>) {
  if (profile === "full") return true;
  if (profile === "projects") return (PROJECT_BOOTSTRAP_EVENT_TYPES as readonly string[]).includes(eventType);
  if (eventType === "AttentionEpisodeObserved" && isPhantomAttentionEpisode(payload)) return false;
  return !PROFILE_EXCLUDED_EVENT_TYPES[profile].includes(eventType);
}
