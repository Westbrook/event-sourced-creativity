import type { CreativeEvent } from "../src/model/events.ts";
import type { OutputAssetInspection } from "../src/model/output-asset-inspection.ts";
import type { OutputAssetRow, OutputConfirmedPlan, OutputGrantRow, OutputPreflight, OutputResultRow } from "../src/model/output-delivery-contract.ts";
import type { WorkerEnv } from "./runtime.ts";
import { OutputConflictError, type OutputScope, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import { outputAssetDocumentPrefix } from "./output-asset-storage-identity.ts";

/** A limit makes the read unavailable; it never changes the authored assignment. */
export const MAX_OUTPUT_READ_ROWS = 4_096;
export const MAX_OUTPUT_READ_PLANS = 128;
export const MAX_OUTPUT_READ_PRIVATE_BYTES = 16 * 1024 * 1024;
export const MAX_OUTPUT_READ_QUERY_PRIVATE_BYTES = 4 * 1024 * 1024;
export const MAX_OUTPUT_CUSTODY_LIST_PAGES = 8;
export const OUTPUT_CUSTODY_LIST_PAGE_SIZE = 1_000;
export const MAX_OUTPUT_LEGACY_CUSTODY_READS = 8;
export const MAX_OUTPUT_DELIVERY_PART_READS = 16;

type Row = Record<string, unknown>;
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const string = (value: unknown) => typeof value === "string" ? value : "";
const number = (value: unknown) => Number(value ?? 0);

export type OutputListedAsset = {
  key: string; size?: number; customMetadata?: Record<string, string>; httpMetadata?: { contentType?: string };
};
export type OutputCustodyInventory = {
  complete: boolean; reasonCodes: string[]; listPages: number; legacyReads: number;
  objects: Map<string, OutputListedAsset>; observedKeys: Set<string>;
};
export type OutputBulkAssetEvidence = {
  row: Row; asset: Row; origin: Row; name: string; inspection: OutputAssetInspection; available: boolean;
};
export type OutputReadModel = {
  complete: boolean; reasonCodes: string[]; databaseBindingCalls: number; listPages: number; legacyReads: number;
  confirmedPlan: OutputConfirmedPlan | null; plans: Map<string, OutputConfirmedPlan>;
  assets: OutputAssetRow[]; assetEvidence: Map<string, OutputBulkAssetEvidence>;
  results: OutputResultRow[]; grants: OutputGrantRow[];
  /** Membership is independent of historical approval. Both are checked before release. */
  fulfillments: Map<string, Map<string, string>>;
  custody: OutputCustodyInventory;
};
export type OutputReadModelOptions = {
  /** Records exact raw JSON in the request's retained-private-body transaction proof. */
  rememberPrivateBody: (eventId: string, raw: string) => Row;
  reviewEligibility: (resultAuthor: string, assetAuthor: string, origin: Row) => { reviewAllowed: boolean; independentReviewBlocked: boolean };
  /** Only the exact new Document prefix is allowed; never an owner-wide scan. */
  storagePrefixes: (rows: readonly Row[]) => string[];
  /** The caller supplies only known keys matching the strict legacy identity policy. */
  legacyStorageKeys?: (rows: readonly Row[]) => string[];
  /** Reuses the authoritative current/legacy key policy, in addition to metadata checks below. */
  storageIdentityMatches: (row: Row, inspection: OutputAssetInspection, object: OutputListedAsset) => boolean;
  maxRows?: number; maxPlans?: number; maxPrivateBytes?: number; maxListPages?: number;
};

/**
 * R2 may return fewer than the requested limit when metadata is included. Only
 * its cursor/truncated contract or finding every expected key proves coverage.
 * A missing cursor, repeated cursor, page limit, or transport failure is unknown.
 */
export async function readOutputCustodyInventory(env: Pick<WorkerEnv, "MEDIA">, scope: OutputScope, expectedKeys: readonly string[], prefixes: readonly string[], options: { maximumPages?: number; legacyKeys?: readonly string[] } = {}): Promise<OutputCustodyInventory> {
  const objects = new Map<string, OutputListedAsset>(), observedKeys = new Set<string>(), reasons = new Set<string>();
  const expected = new Set(expectedKeys), documentPrefix = outputAssetDocumentPrefix(scope);
  const boundedPrefixes = [...new Set(prefixes)].filter((prefix) => prefix === documentPrefix);
  const maximumPages = options.maximumPages ?? MAX_OUTPUT_CUSTODY_LIST_PAGES;
  let listPages = 0, legacyReads = 0;
  if (boundedPrefixes.length !== new Set(prefixes).size || boundedPrefixes.length > 1 || !Number.isSafeInteger(maximumPages) || maximumPages < 1 || maximumPages > MAX_OUTPUT_CUSTODY_LIST_PAGES) reasons.add("output_custody_inventory_incomplete");
  const covered = new Set<string>();
  for (const prefix of boundedPrefixes.slice(0, 1)) {
    const relevant = new Set([...expected].filter((key) => key.startsWith(prefix)));
    if (!relevant.size) continue;
    let cursor: string | undefined;
    const cursors = new Set<string>();
    let done = false;
    while (listPages < maximumPages && !done) {
      let page: { objects: OutputListedAsset[]; truncated: boolean; cursor?: string };
      try {
        page = await env.MEDIA.list({ prefix, ...(cursor ? { cursor } : {}), limit: OUTPUT_CUSTODY_LIST_PAGE_SIZE, include: ["customMetadata", "httpMetadata"] });
        listPages++;
      } catch { listPages++; reasons.add("output_custody_inventory_unavailable"); break; }
      if (!Array.isArray(page.objects) || page.objects.length > OUTPUT_CUSTODY_LIST_PAGE_SIZE || typeof page.truncated !== "boolean") { reasons.add("output_custody_inventory_incomplete"); break; }
      for (const item of page.objects) {
        if (!item || typeof item.key !== "string" || !item.key.startsWith(prefix)) { reasons.add("output_custody_inventory_incomplete"); continue; }
        if (!relevant.has(item.key)) continue;
        const previous = objects.get(item.key);
        if (previous && JSON.stringify(previous) !== JSON.stringify(item)) reasons.add("output_custody_inventory_changed");
        objects.set(item.key, item); observedKeys.add(item.key);
      }
      if (!page.truncated || [...relevant].every((key) => observedKeys.has(key))) { done = true; for (const key of relevant) covered.add(key); break; }
      if (!page.cursor || cursors.has(page.cursor) || page.cursor === cursor) { reasons.add("output_custody_inventory_incomplete"); break; }
      cursors.add(page.cursor); cursor = page.cursor;
    }
    if (!done) reasons.add("output_custody_inventory_incomplete");
  }
  const legacy = [...new Set(options.legacyKeys ?? [])].filter((key) => expected.has(key) && !key.startsWith(documentPrefix));
  // Leave room for the authoritative source/rights checks and up to sixteen
  // exact file GETs. Listing and legacy HEADs share one eight-call budget.
  const remainingLegacyReads = Math.min(MAX_OUTPUT_LEGACY_CUSTODY_READS, MAX_OUTPUT_CUSTODY_LIST_PAGES - listPages);
  if (legacy.length !== new Set(options.legacyKeys ?? []).size || legacy.length > remainingLegacyReads) reasons.add("output_legacy_custody_recheck_required");
  else for (const key of legacy) {
    try {
      legacyReads++;
      const object = await env.MEDIA.head(key);
      if (object) {
        const headers = new Headers(); object.writeHttpMetadata(headers);
        objects.set(key, { key, size: object.size, customMetadata: object.customMetadata, httpMetadata: { contentType: headers.get("content-type") ?? undefined } });
        observedKeys.add(key);
      }
      covered.add(key);
    } catch { reasons.add("output_legacy_custody_recheck_required"); }
  }
  if ([...expected].some((key) => !covered.has(key))) reasons.add("output_custody_inventory_incomplete");
  return { complete: reasons.size === 0, reasonCodes: [...reasons], listPages, legacyReads, objects, observedKeys };
}

function scopedPrivateJoin(alias: string, id: string) {
  return `LEFT JOIN event_private_payloads ${alias} ON ${alias}.private_event_id=${id}
    AND ${alias}.owner_id=? AND ${alias}.project_id=? AND ${alias}.document_id=? AND ${alias}.redacted_at IS NULL`;
}

/** Bound private text in SQL, before D1 returns it into the Worker's memory. */
function boundedPrivateColumns(columns: Array<[string, string]>, order: string) {
  const bytes = columns.map(([alias]) => `COALESCE(length(CAST(${alias}.private_json AS BLOB)),0)`).join("+");
  const cumulative = `SUM(${bytes}) OVER(ORDER BY ${order} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`;
  return [...columns.map(([alias, name]) => `CASE WHEN ${cumulative}<=${MAX_OUTPUT_READ_QUERY_PRIVATE_BYTES} THEN ${alias}.private_json ELSE NULL END AS ${name}`),
    `CASE WHEN ${cumulative}>${MAX_OUTPUT_READ_QUERY_PRIVATE_BYTES} THEN 1 ELSE 0 END AS private_read_incomplete`].join(",");
}

/** Six scoped queries share one D1 binding call, independent of the number of targets. */
export async function readOutputReadModel(env: WorkerEnv, scope: OutputScope, events: readonly CreativeEvent[], options: OutputReadModelOptions): Promise<OutputReadModel> {
  const maximumRows = Math.max(1, Math.min(MAX_OUTPUT_READ_ROWS, options.maxRows ?? MAX_OUTPUT_READ_ROWS));
  const maximumPlans = Math.max(1, Math.min(MAX_OUTPUT_READ_PLANS, options.maxPlans ?? MAX_OUTPUT_READ_PLANS));
  const maximumPrivateBytes = Math.max(1, Math.min(MAX_OUTPUT_READ_PRIVATE_BYTES, options.maxPrivateBytes ?? MAX_OUTPUT_READ_PRIVATE_BYTES));
  const privateScope = [scope.ownerUserId, scope.projectId, scope.documentId];
  const documentScope = [scope.key, scope.documentId, scope.projectId, scope.ownerUserId];
  const queries = [
    env.DB.prepare(`SELECT plan.*,${boundedPrivateColumns([["body", "plan_private_json"]], "plan.revision DESC")} FROM output_plan_revisions plan
      ${scopedPrivateJoin("body", "plan.confirmed_event_id")}
      WHERE plan.scope_key=? AND plan.document_id=? AND plan.project_id=? AND plan.owner_user_id=? ORDER BY plan.revision DESC LIMIT ?`)
      .bind(...privateScope, ...documentScope, maximumPlans + 1),
    env.DB.prepare(`SELECT asset.*,${boundedPrivateColumns([["body", "asset_private_json"]], "asset.created_at DESC,asset.asset_id DESC")} FROM output_assets asset
      ${scopedPrivateJoin("body", "asset.created_event_id")}
      WHERE asset.scope_key=? AND asset.document_id=? AND asset.owner_user_id=? AND asset.redacted_at IS NULL ORDER BY asset.created_at DESC,asset.asset_id DESC LIMIT ?`)
      .bind(...privateScope, scope.key, scope.documentId, scope.ownerUserId, maximumRows + 1),
    env.DB.prepare(`WITH ranked_acceptances AS (
        SELECT acceptance.*,ROW_NUMBER() OVER(PARTITION BY acceptance.scope_key,acceptance.result_id ORDER BY acceptance.created_at DESC,acceptance.acceptance_id DESC) AS rank
        FROM output_target_acceptances acceptance WHERE acceptance.scope_key=?)
      SELECT result.*,acceptance.acceptance_id,acceptance.approval_event_id,
        ${boundedPrivateColumns([["body", "result_private_json"], ["approval", "approval_private_json"]], "result.created_at DESC,result.result_id DESC")} FROM output_results result
      JOIN output_plan_revisions plan ON plan.scope_key=result.scope_key AND plan.plan_revision_id=result.plan_revision_id
      ${scopedPrivateJoin("body", "result.bound_event_id")}
      LEFT JOIN ranked_acceptances acceptance ON acceptance.scope_key=result.scope_key AND acceptance.result_id=result.result_id AND acceptance.rank=1
      ${scopedPrivateJoin("approval", "acceptance.approval_event_id")}
      WHERE result.scope_key=? AND result.document_id=? AND plan.project_id=? AND plan.owner_user_id=? ORDER BY result.created_at DESC,result.result_id DESC LIMIT ?`)
      .bind(scope.key, ...privateScope, ...privateScope, ...documentScope, maximumRows + 1),
    env.DB.prepare(`WITH costs AS (SELECT slot.scope_key,slot.grant_id,
        COALESCE(SUM(calls.used_microusd),0) AS grant_used,
        COALESCE(SUM(CASE WHEN calls.used_microusd IS NULL THEN calls.reserved_microusd ELSE 0 END),0) AS grant_exposed,
        COUNT(calls.call_key) AS grant_used_calls,
        COALESCE(SUM(CASE WHEN calls.call_key IS NOT NULL AND (calls.used_microusd IS NULL OR calls.status IN('pending','uncertain')) THEN 1 ELSE 0 END),0) AS grant_pending_calls
      FROM output_operation_slots slot JOIN output_plan_revisions scoped_plan ON scoped_plan.scope_key=slot.scope_key AND scoped_plan.plan_revision_id=slot.plan_revision_id
      LEFT JOIN output_provider_calls calls ON calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id
      WHERE slot.scope_key=? AND scoped_plan.document_id=? AND scoped_plan.project_id=? AND scoped_plan.owner_user_id=? GROUP BY slot.scope_key,slot.grant_id)
      SELECT grant_row.*,costs.grant_used,costs.grant_exposed,costs.grant_used_calls,costs.grant_pending_calls,
        preflight.event_id AS preflight_event_id,
        ${boundedPrivateColumns([["body", "preflight_private_json"], ["authorization", "authorization_private_json"]], "grant_row.created_at DESC,grant_row.grant_id DESC")} FROM output_execution_grants grant_row
      JOIN output_plan_revisions plan ON plan.scope_key=grant_row.scope_key AND plan.plan_revision_id=grant_row.plan_revision_id
      LEFT JOIN costs ON costs.scope_key=grant_row.scope_key AND costs.grant_id=grant_row.grant_id
      LEFT JOIN output_preflights preflight ON preflight.scope_key=grant_row.scope_key AND preflight.preflight_id=grant_row.preflight_id
      ${scopedPrivateJoin("body", "preflight.event_id")}
      ${scopedPrivateJoin("authorization", "grant_row.authorization_event_id")}
      WHERE grant_row.scope_key=? AND plan.document_id=? AND plan.project_id=? AND plan.owner_user_id=? ORDER BY grant_row.created_at DESC,grant_row.grant_id DESC LIMIT ?`)
      .bind(...documentScope, ...privateScope, ...privateScope, ...documentScope, maximumRows + 1),
    env.DB.prepare(`SELECT slot.*,COALESCE(SUM(calls.used_microusd),0) AS used,
        COALESCE(SUM(CASE WHEN calls.used_microusd IS NULL THEN calls.reserved_microusd ELSE 0 END),0) AS exposed,
        COUNT(calls.call_key) AS used_calls,
        COALESCE(SUM(CASE WHEN calls.call_key IS NOT NULL AND (calls.used_microusd IS NULL OR calls.status IN('pending','uncertain')) THEN 1 ELSE 0 END),0) AS pending_calls
      FROM output_operation_slots slot JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
      LEFT JOIN output_provider_calls calls ON calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id
      WHERE slot.scope_key=? AND plan.document_id=? AND plan.project_id=? AND plan.owner_user_id=?
      GROUP BY slot.scope_key,slot.slot_id ORDER BY slot.created_at DESC,slot.slot_id DESC LIMIT ?`)
      .bind(...documentScope, maximumRows + 1),
    env.DB.prepare(`SELECT fulfillment.*,${boundedPrivateColumns([["body", "eligibility_private_json"]], "plan.revision DESC,fulfillment.target_id")} FROM output_plan_fulfillments fulfillment
      JOIN output_plan_revisions plan ON plan.scope_key=fulfillment.scope_key AND plan.plan_revision_id=fulfillment.plan_revision_id
      ${scopedPrivateJoin("body", "fulfillment.eligibility_event_id")}
      WHERE fulfillment.scope_key=? AND plan.document_id=? AND plan.project_id=? AND plan.owner_user_id=? ORDER BY plan.revision DESC,fulfillment.target_id LIMIT ?`)
      .bind(...privateScope, ...documentScope, maximumRows + 1),
  ];
  const batches = await env.DB.batch<Row>(queries);
  if (batches.length !== queries.length || batches.some((batch) => batch.success === false || !Array.isArray(batch.results))) throw new OutputConflictError("output_read_model_unavailable", 503);
  const reasons = new Set<string>();
  const rowSets = batches.map((batch, index) => {
    const limit = index === 0 ? maximumPlans : maximumRows;
    if (batch.results.length > limit) reasons.add("output_read_model_rows_incomplete");
    if (batch.results.some((row) => number(row.private_read_incomplete) > 0)) reasons.add("output_read_model_private_evidence_incomplete");
    return batch.results.slice(0, limit);
  });
  let privateBytes = 0;
  const remembered = new Map<string, { raw: string; body: Row }>();
  const body = (id: unknown, raw: unknown): Row | null => {
    if (typeof id !== "string" || typeof raw !== "string") return null;
    const previous = remembered.get(id);
    if (previous) {
      if (previous.raw !== raw) throw new OutputConflictError("output_private_evidence_changed", 409);
      return previous.body;
    }
    privateBytes += new TextEncoder().encode(raw).byteLength;
    if (privateBytes > maximumPrivateBytes) { reasons.add("output_read_model_private_evidence_incomplete"); return null; }
    const parsed = options.rememberPrivateBody(id, raw);
    remembered.set(id, { raw, body: parsed });
    return parsed;
  };
  const plans = new Map<string, OutputConfirmedPlan>();
  for (const [index, row] of rowSets[0].entries()) {
    const saved = body(row.confirmed_event_id, row.plan_private_json);
    if (!saved) { if (index === 0) throw new OutputConflictError("output_private_evidence_unavailable", 410); continue; }
    const plan = record(saved.confirmed_plan);
    if (!plan.plan || plan.revisionId !== row.plan_revision_id || plan.sourceDigest !== row.source_digest || plan.requirementsDigest !== row.requirements_digest) throw new OutputConflictError("output_plan_evidence_mismatch", 409);
    plans.set(string(row.plan_revision_id), plan as OutputConfirmedPlan);
  }
  const assetEvidence = new Map<string, OutputBulkAssetEvidence>();
  for (const row of rowSets[1]) {
    const saved = body(row.created_event_id, row.asset_private_json);
    if (!saved) continue;
    const asset = record(saved.asset), inspection = record(asset.inspection) as OutputAssetInspection;
    if (asset.id !== row.asset_id || inspection.status !== "inspected" || inspection.sha256 !== row.content_sha256 || inspection.byteLength !== row.byte_length || inspection.mimeType !== row.mime_type) continue;
    assetEvidence.set(string(row.asset_id), { row, asset, origin: record(asset.origin), name: string(asset.name), inspection, available: false });
  }
  const retainedRows = [...assetEvidence.values()].map((evidence) => evidence.row);
  const custody = await readOutputCustodyInventory(env, scope, retainedRows.map((row) => string(row.storage_key)), options.storagePrefixes(retainedRows), { maximumPages: options.maxListPages, legacyKeys: options.legacyStorageKeys?.(retainedRows) });
  for (const reason of custody.reasonCodes) reasons.add(reason);
  const assets: OutputAssetRow[] = [];
  for (const evidence of assetEvidence.values()) {
    const { row, asset, inspection } = evidence, object = custody.objects.get(string(row.storage_key)), metadata = object?.customMetadata;
    evidence.available = Boolean(custody.complete && object && object.key === row.storage_key && object.size === row.byte_length
      && metadata?.outputRequirementAsset === "1" && metadata.ownerId === scope.ownerUserId && metadata.scopeKey === scope.key
      && metadata.assetId === row.asset_id && metadata.documentId === scope.documentId && metadata.sha256 === row.content_sha256
      && object.httpMetadata?.contentType === row.mime_type && options.storageIdentityMatches(row, inspection, object));
    assets.push({ id: string(row.asset_id), name: string(asset.name) || "Output file", mimeType: string(row.mime_type), mediaKind: row.media_kind as OutputAssetRow["mediaKind"], byteLength: number(row.byte_length), sha256: string(row.content_sha256), sourceDigest: string(row.source_digest), createdByUserId: string(row.created_by_user_id), createdAt: string(row.created_at), inspection,
      downloadUrl: `/api/output-requirements/assets/${encodeURIComponent(string(row.asset_id))}?documentId=${encodeURIComponent(scope.documentId)}`, available: evidence.available });
  }
  const lastReviews = new Map<string, CreativeEvent>();
  for (const event of events) if (["OutputTargetAccepted", "OutputTargetChangesRequested"].includes(event.type) && event.payload.document_id === scope.documentId) lastReviews.set(string(event.payload.result_id), event);
  const results: OutputResultRow[] = [];
  for (const row of rowSets[2]) {
    const saved = body(row.bound_event_id, row.result_private_json);
    if (!saved) continue;
    const candidate = record(saved.result), review = lastReviews.get(string(row.result_id));
    if (candidate.id !== row.result_id || candidate.assetId !== row.asset_id || candidate.targetId !== row.target_id || candidate.sha256 !== row.content_sha256 || candidate.resultRevision !== row.result_revision || candidate.targetContractDigest !== row.target_contract_digest || candidate.sourceDigest !== row.source_digest) continue;
    const approval = body(row.approval_event_id, row.approval_private_json);
    const approved = Boolean(approval && row.acceptance_id && review?.type === "OutputTargetAccepted" && review.eventId === row.approval_event_id
      && approval.result_id === row.result_id && approval.target_id === row.target_id && approval.acceptance_id === row.acceptance_id
      && approval.content_sha256 === row.content_sha256 && approval.result_revision === row.result_revision
      && approval.target_contract_digest === row.target_contract_digest && approval.source_digest === row.source_digest
      && approval.reviewed_coverage === true && approval.reviewed_rights === true);
    const evidence = assetEvidence.get(string(row.asset_id));
    const eligibility = evidence ? options.reviewEligibility(string(row.created_by_user_id), string(evidence.row.created_by_user_id), evidence.origin) : { reviewAllowed: false, independentReviewBlocked: scope.kind === "project" };
    results.push({ id: string(row.result_id), targetId: string(row.target_id), planRevisionId: string(row.plan_revision_id), assetId: string(row.asset_id), resultRevision: string(row.result_revision), targetContractDigest: string(row.target_contract_digest), sourceDigest: string(row.source_digest), sha256: string(row.content_sha256), checksStatus: row.checks_status as OutputResultRow["checksStatus"], checks: Array.isArray(candidate.checks) ? candidate.checks.map(String) : [], problems: Array.isArray(candidate.problems) ? candidate.problems.map(String) : [], createdByUserId: string(row.created_by_user_id), createdAt: string(row.created_at), review: approved ? "approved" : review?.type === "OutputTargetChangesRequested" ? "changes_requested" : "pending", acceptanceId: approved ? string(row.acceptance_id) : null, ...eligibility });
  }
  const slotsByGrant = new Map<string, Row[]>();
  for (const row of rowSets[4]) { const id = string(row.grant_id), slots = slotsByGrant.get(id) ?? []; slots.push(row); slotsByGrant.set(id, slots); }
  const grants: OutputGrantRow[] = [];
  for (const row of rowSets[3]) {
    const disclosed = body(row.preflight_event_id, row.preflight_private_json);
    body(row.authorization_event_id, row.authorization_private_json);
    const disclosure = disclosed ? record(disclosed.preflight) as OutputPreflight : null;
    const plan = plans.get(string(row.plan_revision_id));
    const labels = new Map((plan?.plan.targets ?? []).map((target) => [target.id, target.label]));
    const operations = (slotsByGrant.get(string(row.grant_id)) ?? []).map((slot) => ({ id: string(slot.slot_id), targetId: string(slot.target_id), targetLabel: labels.get(string(slot.target_id)) ?? null, jobId: string(slot.job_id), status: string(slot.status), maximumMicrousd: number(slot.maximum_microusd), maximumCalls: number(slot.maximum_calls), usedMicrousd: number(slot.used), exposedMicrousd: number(slot.exposed), usedCalls: number(slot.used_calls), pendingCalls: number(slot.pending_calls) }));
    // Costs aggregate the complete scoped ledger, even if the bounded operation
    // inventory is unavailable. A partial list must never look like lower spend.
    grants.push({ id: string(row.grant_id), planRevisionId: string(row.plan_revision_id), actorUserId: string(row.actor_user_id), payerUserId: string(row.payer_user_id), status: row.status as OutputGrantRow["status"], maximumMicrousd: number(row.maximum_microusd), maximumCalls: number(row.maximum_calls), usedMicrousd: number(row.grant_used), exposedMicrousd: number(row.grant_exposed), usedCalls: number(row.grant_used_calls), pendingCalls: number(row.grant_pending_calls), expiresAt: string(row.expires_at), disclosure, operations });
  }
  const fulfillments = new Map<string, Map<string, string>>();
  for (const row of rowSets[5]) {
    const eligibility = body(row.eligibility_event_id, row.eligibility_private_json);
    if (!eligibility || eligibility.target_id !== row.target_id || eligibility.acceptance_id !== row.acceptance_id || eligibility.plan_revision_id !== row.plan_revision_id) continue;
    const membership = fulfillments.get(string(row.plan_revision_id)) ?? new Map<string, string>();
    membership.set(string(row.target_id), string(row.acceptance_id)); fulfillments.set(string(row.plan_revision_id), membership);
  }
  if (reasons.size) for (const result of results) result.reviewAllowed = false;
  return { complete: reasons.size === 0, reasonCodes: [...reasons], databaseBindingCalls: 1, listPages: custody.listPages, legacyReads: custody.legacyReads, confirmedPlan: plans.values().next().value ?? null, plans, assets, assetEvidence, results, grants, fulfillments, custody };
}

export type OutputDeliveryEntryIdentity = { targetId: string; assetId: string; acceptanceId: string; resultId: string; resultRevision: string; sha256: string; targetContractDigest: string };

/** One set-based assertion retains every pinned member, not just this ZIP part. */
export function outputBulkDeliveryAssertion(scope: OutputScope, planRevisionId: string, sourceDigest: string, validationPolicy: string, entries: readonly OutputDeliveryEntryIdentity[]): OutputSqlAssertion {
  return { sql: `NOT EXISTS(SELECT 1 FROM json_each(?) expected
    LEFT JOIN output_plan_fulfillments fulfillment ON fulfillment.scope_key=? AND fulfillment.plan_revision_id=? AND fulfillment.target_id=json_extract(expected.value,'$.targetId')
    LEFT JOIN output_target_acceptances acceptance ON acceptance.scope_key=fulfillment.scope_key AND acceptance.acceptance_id=fulfillment.acceptance_id
    LEFT JOIN output_results result ON result.scope_key=acceptance.scope_key AND result.result_id=acceptance.result_id
    LEFT JOIN output_assets asset ON asset.scope_key=result.scope_key AND asset.asset_id=result.asset_id AND asset.document_id=? AND asset.owner_user_id=? AND asset.redacted_at IS NULL
    LEFT JOIN event_private_payloads review_body ON review_body.private_event_id=acceptance.approval_event_id AND review_body.owner_id=? AND review_body.project_id=? AND review_body.document_id=? AND review_body.redacted_at IS NULL
    LEFT JOIN event_private_payloads result_body ON result_body.private_event_id=result.bound_event_id AND result_body.owner_id=? AND result_body.project_id=? AND result_body.document_id=? AND result_body.redacted_at IS NULL
    LEFT JOIN event_private_payloads asset_body ON asset_body.private_event_id=asset.created_event_id AND asset_body.owner_id=? AND asset_body.project_id=? AND asset_body.document_id=? AND asset_body.redacted_at IS NULL
    LEFT JOIN event_private_payloads eligibility_body ON eligibility_body.private_event_id=fulfillment.eligibility_event_id AND eligibility_body.owner_id=? AND eligibility_body.project_id=? AND eligibility_body.document_id=? AND eligibility_body.redacted_at IS NULL
    WHERE fulfillment.acceptance_id IS NULL OR fulfillment.acceptance_id<>json_extract(expected.value,'$.acceptanceId')
      OR acceptance.result_id IS NULL OR acceptance.result_id<>json_extract(expected.value,'$.resultId')
      OR acceptance.result_revision<>json_extract(expected.value,'$.resultRevision') OR acceptance.content_sha256<>json_extract(expected.value,'$.sha256')
      OR acceptance.target_contract_digest<>json_extract(expected.value,'$.targetContractDigest') OR acceptance.target_id<>json_extract(expected.value,'$.targetId')
      OR acceptance.source_digest<>? OR acceptance.validation_policy<>? OR result.checks_status<>'passed' OR result.document_id<>?
      OR result.asset_id<>json_extract(expected.value,'$.assetId') OR result.content_sha256<>acceptance.content_sha256
      OR asset.asset_id IS NULL OR asset.content_sha256<>acceptance.content_sha256
      OR review_body.private_event_id IS NULL OR result_body.private_event_id IS NULL OR asset_body.private_event_id IS NULL OR eligibility_body.private_event_id IS NULL)`,
    bindings: [JSON.stringify(entries), scope.key, planRevisionId, scope.documentId, scope.ownerUserId,
      scope.ownerUserId, scope.projectId, scope.documentId, scope.ownerUserId, scope.projectId, scope.documentId,
      scope.ownerUserId, scope.projectId, scope.documentId, scope.ownerUserId, scope.projectId, scope.documentId,
      sourceDigest, validationPolicy, scope.documentId] };
}
