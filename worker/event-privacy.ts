import { OUTPUT_REQUIREMENT_EVENT_TYPES } from "../src/model/output-requirement-events.ts";
import { safePresentationCandidateIssues } from "../src/model/presentation-candidates.ts";

const SAFE_SCALAR_FIELDS = new Set([
  "requirements_digest", "source_digest", "target_contract_digest", "request_digest", "terms_digest", "route_digest",
  "type", "kind", "role", "scope", "state", "status", "operation", "period", "provider", "model", "quality", "purpose",
  "surface", "context", "capture_version", "terminal_type", "terminal_ref", "property_path", "format", "rights_class",
  "authority", "visibility", "polarity", "decision", "phase", "rank", "index", "revision", "artifact_revision", "restored_from_revision", "revision_action", "content_sha256", "version", "sequence", "head",
  "simulation", "synthetic", "retryable", "active", "locked", "removed", "confirmed", "paid_media_confirmed",
  "project_owned", "preserve_project_ideas", "live_preview", "preview_generated", "preview_queued", "preview_suppressed", "used_reference_pixels", "media_inspected",
  "friction_score", "outcome_weight", "weight", "relativity", "threshold", "width", "height", "actor", "source_surface",
  "artifact_kind", "job_kind", "source_type", "assertion_method", "trigger_kind", "presentation_mode", "viewer_kind",
  "mock_data_source", "error_category", "error_code", "error_class", "prompt_technique", "technique", "view", "created_from", "interaction", "study", "used_uploaded_reference_pixels", "used_locked_study_pixels",
  "production_mode", "source_head", "expected_sequence", "requested_sequence", "created_sequence", "provider_milestone_index",
  "reserved_tokens", "released_tokens", "used_tokens", "input_tokens", "output_tokens", "total_tokens", "reserved_microusd",
  "released_microusd", "used_microusd", "cost_microusd", "estimated_cost_microusd", "latency_ms", "active_ms", "idle_ms",
]);

export const SAFE_SQL_EVENT_FIELDS = [...SAFE_SCALAR_FIELDS] as readonly string[];
const SAFE_IDENTIFIER_FIELDS=new Set("scope_key plan_id plan_revision_id slot_id asset_id result_id acceptance_id manifest_id id ids actor_user_id adapter_id annotation_id approval_id approved_by_user_id arrangement_id artifact_id artifact_source_event_id assigned_reviewer_user_id batch_id block_id branch_id brief_id candidate_object_id canvas_id chip_id client_event_id cohort_id collection_id comparison_id compile_event_id condition_id content_id context_set_id context_set_root_id continued_session_id copied_from_block_id copied_from_relation_id correlation_id corresponding_region_id cost_reservation_id created_by_user_id credential_id decision_id document_id draft_event_id draft_generation_id draft_object_id edited_by_user_id embedding_model_id end_user_id episode_id evaluation_id event_id exemplar_id fallback_document_id family_id fictional_user_id forked_from_block_id forked_from_relation_id from_block_id from_collection_id from_project_id full_generation_id generation_id grant_id group_id group_move_id history_action_id history_owner_id history_owner_user_id hold_id holder_id image_format_block_id impersonation_id intent_id interaction_id invitation_id invited_by_user_id item_id job_id key_id membership_id model_id new_document_id new_event_id new_generation_id object_id observation_id organization_action_id organization_context_package_binding_id organization_context_package_id organization_context_package_version_id organization_context_source_block_id organization_id original_fixture_document_id output_id owner_id owner_user_id parent_collection_id parent_intent_id participant_id participant_user_id persona_id persona_milestone_id planner_model_id planner_response_id preference_id preflight_id presentation_action_id presentation_receipt_id previous_document_id previous_event_id previous_holder_id previous_object_id previous_owner_user_id previous_preflight_id previous_project_id principal_user_id probe_id project_access_id project_id promoted_from_generation_id promoted_from_object_id promotion_id prompt_adapter_id prompt_fan_id proposal_event_id proposal_id provider_job_id provider_request_id provider_response_id reality_id ref_id reference_asset_id reference_generation_id reference_id reference_item_id reference_preview_event_id reference_set_id relation_id repair_response_id replaces_relation_id replay_session_id request_id requested_by_user_id requirement_id reservation_id resource_id response_id resumed_intent_id reviewer_user_id revision_id run_id scene_id scope_id session_id share_id snapshot_id source_artifact_id source_artifact_item_id source_block_id source_canvas_id source_chat_turn_id source_condition_event_id source_context_id source_document_id source_event_id source_fan_id source_generation_id source_id source_object_id source_output_id source_reference_block_id source_reference_id source_replay_event_id source_session_id source_stream_id starting_object_id stream_id subject_block_id subject_user_id superseded_by_job_id sweep_id target_block_id target_id to_block_id to_collection_id turn_id user_id version_id view_id workflow_id workflow_stage_id workspace_id".split(" "));
export const SAFE_SQL_IDENTIFIER_FIELDS=[...SAFE_IDENTIFIER_FIELDS] as readonly string[];

export const PRIVATE_AUTHORED_EVENT_TYPES = new Set([
  ...OUTPUT_REQUIREMENT_EVENT_TYPES,
  "ProjectCreated", "ProjectRenamed", "DocumentCreated", "DocumentRenamed", "OutputRenamed", "BlockCreated", "BlockRenamed", "BlockPropertyEdited",
  "ReferenceIngested", "ContextCompiled", "DocumentRenderCompleted", "MutationProposed", "ProposalIssued", "ProposalAccepted",
  "CanvasCreated", "CanvasItemPlaced", "CanvasReferenceCreated", "CanvasTextApplied", "CanvasRegisterSet", "CanvasArrangementCreated",
  "ContextSetFormalized", "BriefComposed", "ScoutObserved", "AnnotationAdded", "ObjectCritiqued", "GenerationFailed", "DocumentRenderFailed",
]);

const SAFE_IDENTIFIER = /^[\p{L}\p{N}_:./@%+-]{1,240}$/u;
const scalarKey = (key: string) => SAFE_SCALAR_FIELDS.has(key)||SAFE_IDENTIFIER_FIELDS.has(key)
  || /(?:^|_)(?:count|tokens|microusd|ms|seconds|version|index|sequence|head|kind|type|status|mode|surface|scope|expires_at|created_at|updated_at|recorded_at|occurred_at|completed_at|fired_at|content_ref|input_ref|prompt_ref|note_ref|direction_ref|response_ref|statement_ref|condition_ref|object_ref|target_ref)$/.test(key);

/** Immutable rows carry only operational identifiers; authored payloads remain separately erasable. */
export function publicEventPayload(eventId: string, payload: Record<string, unknown>, forcePrivateEnvelope = false): { payload: Record<string, unknown>; privateJson: string | null } {
  const visible: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "validation_issues" && Array.isArray(value)) {
      visible[key] = value.slice(0, 512).flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
        const issue = candidate as Record<string, unknown>;
        const pageIndex = Number(issue.pageIndex), pageCount = Number(issue.pageCount), providerAttempt = Number(issue.providerAttempt);
        if (![pageIndex, pageCount, providerAttempt].every(Number.isSafeInteger)
          || pageIndex < 0 || pageCount < 1 || pageCount > 100 || pageIndex >= pageCount
          || providerAttempt < 1 || providerAttempt > 128 || !["initial", "repair"].includes(String(issue.stage))) return [];
        const path = typeof issue.path === "string" ? issue.path : "$";
        const localPosition = /^items\.(\d+)(?:\.|$)/u.exec(path);
        const globalSlide = Number(issue.globalSlideIndex);
        const globalStartIndex = localPosition && Number.isSafeInteger(globalSlide) && globalSlide > Number(localPosition[1])
          ? globalSlide - Number(localPosition[1]) - 1
          : 0;
        if (globalStartIndex > 100) return [];
        return safePresentationCandidateIssues([{ code: typeof issue.code === "string" ? issue.code : "presentation_validation_failed", path, message: "" }], {
          pageIndex, pageCount, globalStartIndex, providerAttempt, stage: issue.stage as "initial" | "repair",
        });
      });
      continue;
    }
    if (key === "source_block_versions" && Array.isArray(value)) {
      visible[key] = value.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const version = candidate as Record<string, unknown>;
        return typeof version.block_id === "string" && SAFE_IDENTIFIER.test(version.block_id) && Number.isFinite(Number(version.version))
          ? [{ block_id: version.block_id, version: Number(version.version) }]
          : [];
      });
      continue;
    }
    if (["object_ids", "visible_refs", "block_ids", "model_ids", "changed_fields"].includes(key) && Array.isArray(value)) {
      visible[key] = value.filter((candidate): candidate is string => typeof candidate === "string" && SAFE_IDENTIFIER.test(candidate));
      continue;
    }
    if (key === "origin" && value && typeof value === "object" && typeof (value as Record<string, unknown>).synthetic === "boolean") {
      visible.origin = { synthetic: (value as Record<string, unknown>).synthetic };
      continue;
    }
    if (!scalarKey(key)) continue;
    if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) visible[key] = value;
    else if (typeof value === "string" && SAFE_IDENTIFIER.test(value)) visible[key] = value;
  }
  const original = JSON.stringify(payload);
  if (!forcePrivateEnvelope && JSON.stringify(visible) === original) return { payload, privateJson: null };
  return { payload: { ...visible, _private_ref: eventId }, privateJson: original };
}
