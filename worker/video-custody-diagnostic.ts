// Fixed codes only. Never emit source data, credentials, SQL or arbitrary errors.
const codes = new Set([
  "video_reference_scope_unavailable", "video_reference_source_unavailable", "video_reference_pixel_permission_required",
  "video_reference_source_changed", "video_reference_rights_required", "video_reference_likeness_permission_required",
  "video_reference_snapshot_unavailable", "owned_image_reference_hash_required", "owned_image_reference_ordinary_image_required",
  "owned_image_reference_limits_invalid", "owned_image_reference_private_media_required", "owned_image_reference_retained_hash_required",
  "owned_image_reference_media_unavailable", "owned_image_reference_image_required", "owned_image_reference_read_mismatch",
  "owned_image_reference_source_changed", "derived_reference_source_changed", "derived_reference_not_authorized",
  "derived_reference_rights_required", "derived_reference_rights_unavailable", "derived_reference_integrity_mismatch",
  "derived_reference_chain_invalid", "derived_reference_provenance_missing", "derived_reference_input_unavailable",
  "derived_reference_model_view_changed", "derived_reference_composition_changed", "derived_reference_source_unavailable",
  "output_revision_or_authority_changed", "output_source_changed_during_read", "output_source_proof_too_large",
]);
export function recordVideoCustodyFailure(error: unknown) {
  try {
    const own = (key: string) => error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, key)?.value : undefined;
    const raw = own("code") ?? own("message"), detail = own("snapshotReason");
    const code = typeof raw === "string" && codes.has(raw) ? raw : "unknown";
    const reason = code === "video_reference_snapshot_unavailable" && ["depth", "nodes", "fields", "prototype", "accessor", "primitive"].includes(detail) ? detail : "unspecified";
    console.warn("video_reference_custody_refused", { code, reason });
  } catch { /* Optional diagnostic never changes the original failure. */ }
}
