import { createOfficeArchive } from "./office-documents.ts";
import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES, outputAssetSha256, validOutputAssetName, type OutputAssetFacts, type OutputAssetKind } from "./output-asset-inspection.ts";
import { evaluateOutputDeliveryScope, evaluateOutputDeliveryHistory, type OutputDeliveryScopeInput, type OutputDeliveryScopeManifest, type OutputDeliveryScopeSummary, type OutputDeliveryMissingWork, type OutputDeliveryScopeHistoryInput, type OutputDeliveryScopeHistoryManifest } from "./output-delivery-manifest.ts";
export { outputDeliveryScopeForPlan } from "./output-delivery-manifest.ts";
export type { OutputDeliveryScopeInput, OutputDeliveryStatus, OutputDeliveryCompletionStatus, OutputDeliveryScopeAmendmentInput } from "./output-delivery-manifest.ts";

/** These limits cover the complete in-memory ZIP, not a metadata-only preview. */
export const MAX_OUTPUT_DELIVERY_PAYLOAD_BYTES = 32 * 1024 * 1024;
export const MAX_OUTPUT_DELIVERY_FILES = 64;
/** Runtime default leaves room for current authorization and metadata binding calls. */
export const MAX_OUTPUT_DELIVERY_DEFAULT_PART_FILES = 16;
export const MAX_OUTPUT_DELIVERY_TARGETS = 1024;
export const MAX_OUTPUT_DELIVERY_MANIFEST_BYTES = 4 * 1024 * 1024;
const ZIP_OVERHEAD_RESERVE_BYTES = 128 * 1024;
const PART_FILE_PAYLOAD_BYTES = MAX_OUTPUT_DELIVERY_PAYLOAD_BYTES - MAX_OUTPUT_DELIVERY_MANIFEST_BYTES - ZIP_OVERHEAD_RESERVE_BYTES;
export type OutputDeliveryFile = { id: string; name: string; bytes: Uint8Array; expectedSha256: string };
export type OutputDeliveryPart = { index: number; fileIds: string[]; payloadByteLength: number };
export type OutputDeliveryManifestInput = OutputDeliveryScopeHistoryInput & {
  schemaVersion: 1;
  deliveryId?: string;
  planId: string;
  planRevision: string;
  createdAt: string;
  targets: Array<{ targetId: string; fileId: string; acceptanceId: string }>;
  scope?: OutputDeliveryScopeInput;
  packagePart?: { index: number; parts: OutputDeliveryPart[] };
};
export type OutputDeliveryManifest = Omit<OutputDeliveryManifestInput, "scope" | "packagePart" | "scopeHistoryComplete" | "scopeAmendments"> & OutputDeliveryScopeHistoryManifest & {
  format: "forma-output-delivery";
  deliveryStatusScope: "entire_delivery_package";
  scope: OutputDeliveryScopeManifest;
  summary: OutputDeliveryScopeSummary;
  missingWork: OutputDeliveryMissingWork[];
  packagePart: { index: number; count: number; containsCompletePackage: boolean; fileIds: string[]; parts: OutputDeliveryPart[] };
  validationScope: string;
  files: Array<{
    id: string; name: string; path: string; sha256: string; byteLength: number;
    kind: OutputAssetKind; mimeType: string; facts: OutputAssetFacts; checks: string[]; limitations: string[]; limitationCodes: string[];
  }>;
};
const encoder = new TextEncoder();
const fileId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value)
  && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(value);
const referenceId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u.test(value);
function requireValue(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }

/** Quote every field and neutralize spreadsheet formula syntax, including fullwidth forms. */
function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+@-]/u.test(text.normalize("NFKC").trimStart()) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function manifestCsv(manifest: OutputDeliveryManifest): string {
  const headers = ["record_type", "delivery_status", "inventory_complete", "package_part", "package_parts", "part_contains_complete_package", "scope_id", "requirement_id", "group_id", "obligation_id", "target_id", "label", "required", "selected", "delivery_state", "count", "reason_codes", "reasons", "file_id", "file_path", "original_name", "sha256", "mime_type", "bytes", "width_px", "height_px", "duration_seconds", "slide_count", "acceptance_id", "delivery_id", "plan_id", "plan_revision", "current_scope_status", "scope_history_complete", "completion_qualification", "amendment_id", "previous_plan_revision_id", "amended_plan_revision_id", "amendment_occurred_at", "actor_role", "amendment_reason"];
  const files = new Map(manifest.files.map(file => [file.id, file]));
  const partByFile = new Map(manifest.packagePart.parts.flatMap(part => part.fileIds.map(id => [id, part.index] as const)));
  const acceptedByTarget = new Map(manifest.targets.map(target => [target.targetId, target]));
  const common = { delivery_status: manifest.deliveryStatus, inventory_complete: manifest.scope.inventoryComplete, package_part: manifest.packagePart.index, package_parts: manifest.packagePart.count, part_contains_complete_package: manifest.packagePart.containsCompletePackage, current_scope_status: manifest.currentScopeStatus, scope_history_complete: manifest.scopeHistoryComplete, completion_qualification: manifest.completionQualification };
  const state = manifest.completionExplanation;
  const transport = manifest.packagePart.count > 1 ? ` This ZIP is part ${manifest.packagePart.index} of ${manifest.packagePart.count}; all parts are needed for the complete file inventory.` : " This ZIP contains the entire package file inventory.";
  const rows: Array<Record<string, unknown>> = [{ record_type: "delivery", delivery_id: manifest.deliveryId, plan_id: manifest.planId, plan_revision: manifest.planRevision, label: state + transport }];
  for (const amendment of manifest.scopeAmendments) {
    rows.push({ record_type: "scope_amendment", scope_id: amendment.id, amendment_id: amendment.id, previous_plan_revision_id: amendment.previousPlanRevisionId, amended_plan_revision_id: amendment.planRevisionId, amendment_occurred_at: amendment.occurredAt, actor_role: amendment.actorRole, amendment_reason: amendment.reason, label: "Scope withdrawal record; withdrawn entries are not evidence of completion.", count: amendment.withdrawnObligations.length + amendment.withdrawnTargets.length });
    for (const obligation of amendment.withdrawnObligations) rows.push({ record_type: "withdrawn_obligation", amendment_id: amendment.id, scope_id: obligation.id, obligation_id: obligation.id, label: obligation.label, delivery_state: obligation.disposition });
    for (const target of amendment.withdrawnTargets) rows.push({ record_type: "withdrawn_target", amendment_id: amendment.id, scope_id: target.id, target_id: target.id, label: target.label, delivery_state: target.disposition });
  }
  const summaryLabels: Record<string, string> = { requiredGroups: "Required groups", fulfilledRequiredGroups: "Fulfilled required groups", requiredObligations: "Required obligations", fulfilledRequiredObligations: "Fulfilled required obligations", selectedOptionalObligations: "Selected optional obligations", fulfilledSelectedOptionalObligations: "Fulfilled selected optional obligations", optionalOffObligations: "Optional obligations not selected", owedTargets: "Owed finite targets", includedOwedTargets: "Owed targets included across the whole package", missingOwedTargets: "Owed targets missing from the whole package", unresolvedRequiredGroups: "Unresolved required groups", unresolvedSelectedOptionalGroups: "Unresolved selected optional groups" };
  for (const [key, value] of Object.entries(manifest.summary)) if (key !== "inventoryComplete") rows.push({ record_type: "summary", scope_id: key, label: summaryLabels[key] ?? key, count: value });
  for (const group of manifest.scope.groups) rows.push({ record_type: "group", scope_id: group.id, requirement_id: group.requirementId, group_id: group.id, label: group.label, required: group.required, delivery_state: group.deliveryState });
  for (const obligation of manifest.scope.obligations) rows.push({ record_type: "obligation", scope_id: obligation.id, requirement_id: obligation.requirementId, group_id: obligation.deliverableId, obligation_id: obligation.id, label: obligation.label, required: obligation.required, selected: obligation.selected, delivery_state: obligation.deliveryState, count: obligation.targetIds.length });
  for (const target of manifest.scope.targets) {
    const obligation = manifest.scope.obligations.find(obligation => obligation.id === target.obligationId)!;
    const accepted = acceptedByTarget.get(target.id), part = accepted ? partByFile.get(accepted.fileId) : undefined;
    rows.push({ record_type: "target", scope_id: target.id, requirement_id: obligation.requirementId, group_id: obligation.deliverableId, obligation_id: obligation.id, target_id: target.id, label: target.label, required: obligation.required, selected: obligation.selected, delivery_state: target.deliveryState === "included" && part !== manifest.packagePart.index ? "included_in_other_part" : target.deliveryState, reason_codes: target.reasonCodes.join("; "), reasons: target.reasons.join(" "), ...(part ? { package_part: part } : {}) });
  }
  for (const group of manifest.scope.unresolvedGroups) rows.push({ record_type: "unresolved_group", scope_id: group.id, requirement_id: group.requirementId, group_id: group.deliverableId, obligation_id: group.obligationId, label: group.label, required: group.required, selected: group.selected, delivery_state: group.deliveryState, reason_codes: group.reasonCodes.join("; "), reasons: group.reasons.join(" ") });
  for (const missing of manifest.missingWork) rows.push({ record_type: "missing_work", scope_id: missing.id, requirement_id: missing.requirementId, group_id: missing.deliverableId, obligation_id: missing.obligationId, target_id: missing.targetId, label: missing.label, required: missing.required, selected: missing.selected, delivery_state: missing.kind, reason_codes: missing.reasonCodes.join("; "), reasons: missing.reasons.join(" ") });
  for (const target of manifest.targets) {
    const file = files.get(target.fileId), part = partByFile.get(target.fileId)!;
    rows.push({ record_type: file ? "file" : "file_in_other_part", target_id: target.targetId, file_id: target.fileId, package_part: part, delivery_state: file ? "included_in_this_part" : "included_in_other_part", file_path: file?.path, original_name: file?.name, sha256: file?.sha256, mime_type: file?.mimeType, bytes: file?.byteLength, width_px: file?.facts.width, height_px: file?.facts.height, duration_seconds: file?.facts.durationSeconds, slide_count: file?.facts.slideCount, acceptance_id: target.acceptanceId });
  }
  return [headers.map(csvCell).join(","), ...rows.map(row => { const record = { ...common, ...row }; return headers.map(key => csvCell(record[key as keyof typeof record])).join(","); })].join("\r\n") + "\r\n";
}

function snapshotManifestInput(input: OutputDeliveryManifestInput): Pick<OutputDeliveryManifestInput, "schemaVersion" | "deliveryId" | "planId" | "planRevision" | "createdAt" | "targets"> {
  requireValue(input && input.schemaVersion === 1 && referenceId(input.planId) && referenceId(input.planRevision), "invalid_output_delivery_plan");
  requireValue(input.deliveryId === undefined || referenceId(input.deliveryId), "invalid_output_delivery_id");
  requireValue(typeof input.createdAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.createdAt)
    && Number.isFinite(Date.parse(input.createdAt)) && new Date(input.createdAt).toISOString() === input.createdAt, "invalid_output_delivery_date");
  requireValue(Array.isArray(input.targets) && input.targets.length > 0 && input.targets.length <= MAX_OUTPUT_DELIVERY_TARGETS, "invalid_output_delivery_target_count");
  const targets = input.targets.map(target => {
    requireValue(target && referenceId(target.targetId) && fileId(target.fileId) && referenceId(target.acceptanceId), "invalid_output_delivery_target");
    return { targetId: target.targetId, fileId: target.fileId, acceptanceId: target.acceptanceId };
  });
  requireValue(new Set(targets.map(target => target.targetId)).size === targets.length, "duplicate_output_delivery_target");
  return { schemaVersion: 1, ...(input.deliveryId === undefined ? {} : { deliveryId: input.deliveryId }), planId: input.planId, planRevision: input.planRevision, createdAt: input.createdAt, targets };
}
function packagePartFor(input: OutputDeliveryManifestInput["packagePart"], currentFiles: Array<{ id: string; byteLength: number }>, targets: OutputDeliveryManifestInput["targets"]): OutputDeliveryManifest["packagePart"] {
  const total = currentFiles.reduce((sum, file) => sum + file.byteLength, 0);
  const raw = input ?? { index: 1, parts: [{ index: 1, fileIds: currentFiles.map(file => file.id).sort(), payloadByteLength: total }] };
  requireValue(raw && Array.isArray(raw.parts) && raw.parts.length > 0 && raw.parts.length <= MAX_OUTPUT_DELIVERY_TARGETS && Number.isInteger(raw.index) && raw.index >= 1 && raw.index <= raw.parts.length, "invalid_output_delivery_part");
  const seen = new Set<string>(), exactIds = new Set<string>();
  const parts = raw.parts.map((part, index) => {
    requireValue(part && part.index === index + 1 && Array.isArray(part.fileIds) && part.fileIds.length > 0 && part.fileIds.length <= MAX_OUTPUT_DELIVERY_FILES && Number.isSafeInteger(part.payloadByteLength) && part.payloadByteLength > 0 && part.payloadByteLength <= MAX_OUTPUT_DELIVERY_PAYLOAD_BYTES, "invalid_output_delivery_part");
    const fileIds = part.fileIds.map(value => { requireValue(fileId(value) && !seen.has(value.toLowerCase()), "duplicate_output_delivery_part_file"); seen.add(value.toLowerCase()); exactIds.add(value); return value; });
    return { index: index + 1, fileIds, payloadByteLength: part.payloadByteLength };
  });
  const expected = new Set(targets.map(target => target.fileId));
  requireValue(exactIds.size === expected.size && [...expected].every(id => exactIds.has(id)), "output_delivery_package_mapping_mismatch");
  const part = parts[raw.index - 1]!;
  requireValue(part.fileIds.length === currentFiles.length && currentFiles.every(file => part.fileIds.includes(file.id)) && total === part.payloadByteLength, "output_delivery_part_file_mismatch");
  return { index: raw.index, count: parts.length, containsCompletePackage: parts.length === 1, fileIds: [...part.fileIds], parts };
}

/** Deterministic metadata-only partitioning; it never reads or fetches asset bytes. */
export function planOutputDeliveryParts(files: Array<{ id: string; byteLength: number }>, manifest: Omit<OutputDeliveryManifestInput, "packagePart">, options: { maxFilesPerPart?: number } = {}): OutputDeliveryPart[] {
  requireValue(options && typeof options === "object" && !Array.isArray(options), "invalid_output_delivery_part_file_limit");
  const maxFilesPerPart = options.maxFilesPerPart === undefined ? MAX_OUTPUT_DELIVERY_DEFAULT_PART_FILES : options.maxFilesPerPart;
  requireValue(Number.isInteger(maxFilesPerPart) && maxFilesPerPart >= 1 && maxFilesPerPart <= MAX_OUTPUT_DELIVERY_FILES, "invalid_output_delivery_part_file_limit");
  requireValue(Array.isArray(files) && files.length > 0 && files.length <= MAX_OUTPUT_DELIVERY_TARGETS, "invalid_output_delivery_package_file_count");
  const requested = snapshotManifestInput(manifest), coverage = evaluateOutputDeliveryScope(manifest.scope, requested.targets.map(target => target.targetId));
  const history = evaluateOutputDeliveryHistory(manifest, coverage.deliveryStatus, requested.createdAt, requested.planRevision);
  const seen = new Set<string>();
  const sorted = files.map(file => {
    requireValue(file && fileId(file.id) && !seen.has(file.id.toLowerCase()) && Number.isSafeInteger(file.byteLength) && file.byteLength > 0 && file.byteLength <= MAX_OUTPUT_ASSET_BYTES, "invalid_output_delivery_package_file");
    seen.add(file.id.toLowerCase()); return { id: file.id, byteLength: file.byteLength };
  }).sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
  const expected = new Set(requested.targets.map(target => target.fileId));
  requireValue(expected.size === sorted.length && sorted.every(file => expected.has(file.id)), "output_delivery_file_mapping_mismatch");
  const parts: OutputDeliveryPart[] = [];
  for (const file of sorted) {
    let current = parts.at(-1);
    if (!current || current.fileIds.length >= maxFilesPerPart || current.payloadByteLength + file.byteLength > PART_FILE_PAYLOAD_BYTES) { current = { index: parts.length + 1, fileIds: [], payloadByteLength: 0 }; parts.push(current); }
    current.fileIds.push(file.id); current.payloadByteLength += file.byteLength;
  }
  // The known inventory must fit even before file facts are added. The actual
  // combined JSON/CSV metadata is checked again for each archive, without truncation.
  const base: OutputDeliveryManifest = { ...requested, ...coverage, ...history, format: "forma-output-delivery", deliveryStatusScope: "entire_delivery_package", packagePart: { index: 1, count: parts.length, containsCompletePackage: parts.length === 1, fileIds: [...parts[0]!.fileIds], parts }, files: [], validationScope: "Metadata planning only; no asset bytes have been read." };
  const targetsPerFile = new Map<string, number>();
  for (const target of requested.targets) targetsPerFile.set(target.fileId, (targetsPerFile.get(target.fileId) ?? 0) + 1);
  const maximumFiles = Math.max(...parts.map(part => part.fileIds.length));
  const maximumTargets = Math.max(...parts.map(part => part.fileIds.reduce((sum, id) => sum + (targetsPerFile.get(id) ?? 0), 0)));
  // Bounded filenames, detected facts/checks, and CSV file cells fit these
  // conservative per-file/per-target reserves; plan text is already measured.
  const metadataUpperBound = encoder.encode(JSON.stringify(base, null, 2)).length + encoder.encode(manifestCsv(base)).length + 64 * 1024 + maximumFiles * 8192 + maximumTargets * 1024;
  requireValue(metadataUpperBound <= MAX_OUTPUT_DELIVERY_MANIFEST_BYTES, "output_delivery_manifest_too_large");
  return parts;
}

/**
 * Package original, rehashed bytes with one canonical inventory and no aliases.
 *
 * The caller MUST verify current authorization, rights and exact acceptance IDs
 * before calling. A supplied acceptanceId is not itself an authorization check.
 * Scope consistency is checked against all pinned targets, but only the server
 * can prove the inventory is the whole authoritative plan or grant acceptance.
 * No filenames or URLs are used as filesystem paths; no network is contacted.
 */
export async function createOutputDeliveryArchive(filesInput: OutputDeliveryFile[], manifestInput: OutputDeliveryManifestInput): Promise<{ bytes: Uint8Array; mimeType: "application/zip"; sha256: string; manifest: OutputDeliveryManifest }> {
  requireValue(Array.isArray(filesInput) && filesInput.length > 0 && filesInput.length <= MAX_OUTPUT_DELIVERY_FILES, "invalid_output_delivery_file_count");
  const requested = snapshotManifestInput(manifestInput);
  const coverage = evaluateOutputDeliveryScope(manifestInput.scope, requested.targets.map(target => target.targetId));
  const history = evaluateOutputDeliveryHistory(manifestInput, coverage.deliveryStatus, requested.createdAt, requested.planRevision);
  let totalBytes = 0;
  const canonicalIds = new Set<string>();
  // Validate every bound before allocating snapshots or doing asynchronous work.
  for (const file of filesInput) {
    requireValue(file && fileId(file.id) && !canonicalIds.has(file.id.toLowerCase()), "unsafe_or_duplicate_output_file_id");
    requireValue(validOutputAssetName(file.name), "unsafe_output_asset_name");
    requireValue(file.bytes instanceof Uint8Array && file.bytes.byteLength > 0 && file.bytes.byteLength <= MAX_OUTPUT_ASSET_BYTES, "invalid_output_delivery_file_size");
    requireValue(typeof file.expectedSha256 === "string" && /^[a-f0-9]{64}$/u.test(file.expectedSha256), "invalid_output_delivery_expected_hash");
    canonicalIds.add(file.id.toLowerCase()); totalBytes += file.bytes.byteLength;
  }
  requireValue(totalBytes <= MAX_OUTPUT_DELIVERY_PAYLOAD_BYTES, "output_delivery_archive_too_large");
  const packagePart = packagePartFor(manifestInput.packagePart, filesInput.map(file => ({ id: file.id, byteLength: file.bytes.byteLength })), requested.targets);
  requireValue(filesInput.every(file => requested.targets.some(target => target.fileId === file.id)), "output_delivery_file_mapping_mismatch");
  const snapshots = filesInput.map(file => ({ id: file.id, name: file.name, expectedSha256: file.expectedSha256, bytes: new Uint8Array(file.bytes) }));
  const manifest: OutputDeliveryManifest = {
    format: "forma-output-delivery", ...requested,
    deliveryStatusScope: "entire_delivery_package", ...coverage, ...history, packagePart,
    validationScope: "Exact bytes, hashes and listed structural checks apply only to files in this ZIP. Completion describes the whole pinned current delivery package, not receipt of one part or completion of withdrawn work. The authoritative server separately verifies the full plan inventory and ancestry, access, rights and target acceptance. Playback, layout and useful grounded content require review.",
    files: [],
  };
  const entries: Array<{ name: string; content: Uint8Array }> = [], hashes = new Set<string>();
  for (const file of snapshots) {
    const inspection = await inspectOutputAsset(file.bytes, file.name);
    requireValue(inspection.sha256 === file.expectedSha256, "output_delivery_hash_mismatch");
    requireValue(inspection.status === "inspected" && inspection.kind && inspection.mimeType && inspection.extension, "output_delivery_file_inspection_failed");
    requireValue(!hashes.has(inspection.sha256), "duplicate_output_delivery_file_bytes"); hashes.add(inspection.sha256);
    const path = `files/${file.id}.${inspection.extension}`;
    manifest.files.push({ id: file.id, name: file.name, path, sha256: inspection.sha256, byteLength: file.bytes.byteLength, kind: inspection.kind, mimeType: inspection.mimeType, facts: inspection.facts, checks: inspection.checks, limitations: inspection.limitations, limitationCodes: [...(inspection.limitationCodes ?? [])] });
    entries.push({ name: path, content: file.bytes });
  }
  const json = encoder.encode(JSON.stringify(manifest, null, 2) + "\n"), csv = encoder.encode(manifestCsv(manifest));
  requireValue(json.byteLength + csv.byteLength <= MAX_OUTPUT_DELIVERY_MANIFEST_BYTES, "output_delivery_manifest_too_large");
  entries.push({ name: "manifest.json", content: json });
  entries.push({ name: "manifest.csv", content: csv });
  // ZIP STORE overhead is exact for this existing writer: no compression,
  // descriptors, path comments, ZIP64 or extra fields are introduced.
  const archiveSize = entries.reduce((size, entry) => size + entry.content.byteLength + 76 + 2 * encoder.encode(entry.name).length, 22);
  requireValue(archiveSize <= MAX_OUTPUT_DELIVERY_PAYLOAD_BYTES, "output_delivery_archive_too_large");
  const bytes = createOfficeArchive(entries, { media: true });
  requireValue(bytes.byteLength === archiveSize, "output_delivery_archive_size_mismatch");
  return { bytes, mimeType: "application/zip", sha256: await outputAssetSha256(bytes), manifest };
}
