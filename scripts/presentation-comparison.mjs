import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { preparePresentationComparisonRequest, buildDocumentPresentationSourceContract, assessStoredPresentationCandidate, PRESENTATION_ADAPTER_VERSION } from "../worker/openai-adapter.ts";
import { buildPresentationSourceContract } from "../src/model/presentation-source.ts";
import { buildManagedProductionPlan } from "../src/model/managed-production.ts";
import { combinedSceneSnapshot, bindPresentationPageAnchors } from "../worker/managed-production.ts";
import { defaultSlidePresentation, slideCopyIssues, slideDeckCopyIssues } from "../src/model/document-artifacts.ts";
import { OPENAI_TEXT_PRICING_VERSION, readOpenAITextUsage, priceCurrentOpenAITextUsage, estimateOpenAITextCallMaximumMicrousd } from "../worker/openai-text-cost.ts";

export const VERSION = "slides-comparison-offline-v1";
export const MODELS = ["gpt-5.6-terra", "gpt-5.6-sol"];
export const EFFORTS = ["medium", "high"];
export const STAGES = Object.freeze({ A: { caseIds: ["N"], editor: false, calls: 4, ceiling: 1_500_000 }, B: { caseIds: ["N"], editor: true, calls: 4, ceiling: 1_500_000 }, C: { caseIds: ["E", "M"], editor: false, calls: 4, ceiling: 1_600_000 }, D: { caseIds: ["E", "M"], editor: true, calls: 4, ceiling: 1_600_000 } });
export const CAPS = Object.freeze({ N: 6500, E: 9600, M: 8400 });
export const FIXTURES = Object.freeze({
  N: ["presentation-forma-benefits-source.json", "e639c44f69c712e161a30dbeb8bbbd83a2fa1da1287cd4244a0caf6c41fade19"],
  E: ["presentation-executive-source.json", "fae4a897a4bbafa9374acbad6ff23332668f4eb5da9e25b90eda2e144396d16c"],
  M: ["presentation-managed-23.json", "ddbc1e855213825133b5ed2afb7281c748f74094b0b15bf581cacb19d40f3a56"],
});
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const digest = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const nativeKeys = ["provenance","actorId","actorBindingKind","documentId","sourceRevision","sourceHash","snapshotDigest","authorityReceiptRef","documentTitle","snapshot","options"];
const nativeBinding = entry => Object.fromEntries(nativeKeys.map(key => [key, entry[key]]));
const freeze = value => { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; };
const integer = value => Number.isSafeInteger(value) && value >= 0;
function requireThat(value, reason) { if (!value) throw new Error(reason); }
function ownDigest(value) { const { digest: ignored, ...body } = value; return digest(body); }

export async function loadFixtureCases() {
  const cases = {};
  for (const [id, [filename, expected]] of Object.entries(FIXTURES)) {
    const bytes = await readFile(join(root, "tests/fixtures", filename), "utf8");
    requireThat(digest(bytes) === expected, "comparison_fixture_drift");
    const fixture = JSON.parse(bytes);
    if (id === "N") {
      cases.N = { id, provenance: "sanitized-offline-companion-not-native", fixtureDigest: expected, documentTitle: "One document. More ways to use it.", snapshot: fixture.sourceSnapshot, options: { ...fixture.request, itemCount: 6, requestedSlideCount: 6 }, companionOnly: true };
      continue;
    }
    const snapshot = fixture.snapshot, total = id === "E" ? 12 : 23, start = id === "E" ? 0 : 16;
    const plan = buildManagedProductionPlan("slides", snapshot, { requestedSlideCount: total });
    requireThat(plan.scenes.length === total && plan.providerBatchSize === 8, "comparison_page_extent_drift");
    const canonical = buildPresentationSourceContract(snapshot, { requestedSlideCount: total, stylePreset: "field-notes", fidelity: "faithful" });
    const scenes = plan.scenes.slice(start, start + 8);
    // Deterministic source-derived context, explicitly NOT a prior paid generation.
    const prior = canonical.numberedOutline.slice(0, start);
    const lockedPresentation = { ...defaultSlidePresentation(), theme: "Source-faithful comparison", footerLabel: "Source-faithful comparison", stylePreset: "field-notes" };
    const page = { pageIndex: start / 8, pageCount: Math.ceil(total / 8), globalStartIndex: start, totalItems: total, phase: start ? "final" : "opening", priorSummary: prior.at(-1)?.title ?? "", priorEnding: prior.at(-1)?.content.slice(-700) ?? "", priorVisibleCopy: prior.flatMap(slide => [slide.title, slide.content]).slice(-96), authoredSlideNumbers: canonical.numberedOutline.map(slide => slide.number), ...(start ? { lockedPresentation } : {}) };
    const options = { itemCount: scenes.length, requestedSlideCount: total, presentationStyle: "field-notes", presentationFidelity: "faithful", productionMode: "managed", productionPlan: plan, productionScenes: scenes, productionPage: page };
    const scoped = combinedSceneSnapshot(snapshot, scenes);
    const contract = buildDocumentPresentationSourceContract(scoped, options);
    const anchors = [...bindPresentationPageAnchors(contract, canonical)];
    cases[id] = { id, provenance: "test-authored-representative-page", fixtureDigest: expected, documentTitle: fixture.title ?? "Twenty-three authored slides", snapshot: scoped, options, canonicalContractDigest: digest(canonical), pageAnchorMap: anchors, ...(start ? { priorContextProvenance: "synthetic-source-derived-not-paid", priorContextDigest: digest(page) } : {}) };
  }
  return cases;
}

/** Deterministic source-faithful fixture recipe, extending tests/presentation-source.test.mjs. Never a paid/native result. */
export function representativeEditorCase(entry) {
  requireThat(["E", "M"].includes(entry.id), "comparison_representative_editor_case_required");
  const contract = buildDocumentPresentationSourceContract(entry.snapshot, entry.options);
  const assigned = new Set(entry.options.productionScenes.map(scene => scene.sourceOutlineOrder));
  const outline = contract.numberedOutline.filter(slide => assigned.has(slide.number));
  const groups = contract.sources.filter(source => source.sourceKind === "context-group");
  const items = outline.map((source, index) => {
    const quotes = contract.protectedQuotes.filter(quote => quote.slideNumber === source.number);
    let body = source.content.replace(source.title, "").trim();
    const sentences = body.split(/(?<=[.!?])\s+|\n+/).map(value => value.trim()).filter(Boolean);
    let visualValue = sentences.pop() ?? source.title;
    body = body.replace(visualValue, "").trim();
    const originalQuote = quotes[0];
    const quote = originalQuote ? { text: originalQuote.text, speaker: originalQuote.speaker, role: originalQuote.role, source_id: originalQuote.sourceAlias, citation: originalQuote.role } : null;
    if (quote) body = body.replace(quote.text, "").trim();
    // These two declared choices keep the target's complete factual claim in body;
    // its later visual.value substitution therefore cannot remove unique evidence.
    if (entry.id === "E" && source.number === 4) visualValue = originalQuote.role;
    if (entry.id === "M" && source.number === 20) { body = source.content.replace(source.title, "").replace(/^:\s*/, ""); visualValue = "4–6"; }
    const quoteVisual = quote && !(entry.id === "E" && source.number === 4);
    return { title: source.title, body, notes: `[Sources] ${source.section ?? source.title}\n${source.content}`, image_prompt: "", context_group_ids: source.contextGroupIds.map(id => `context_group_${groups.findIndex(group => group.sourceId === id) + 1}`), slide: { layout: index === 0 && entry.id === "E" ? "cover" : source.number === 23 ? "closing" : "statement", kicker: "", bullets: [], quote, section: source.section, source_ids: [source.sourceAlias], source_order: source.number, citations: [{ source_id: source.sourceAlias, label: source.section ?? source.title, anchor: `Slide ${source.number}`, excerpt: source.content.split(/(?<=[.!?])\s+/)[0] }], visual: { kind: quoteVisual ? "quote" : "hero-type", label: "", value: quoteVisual ? "" : visualValue, exact_value: null, display_value: null, unit: null, data: [] } } };
  });
  const theme = entry.options.productionPage.lockedPresentation ?? { ...defaultSlidePresentation(), footerLabel: "Source comparison", stylePreset: "field-notes" };
  const envelope = { title: entry.documentTitle, summary: "Source comparison", content_markdown: outline.map(source => source.content).join("\n\n"), presentation: { aspect_ratio: theme.aspectRatio, theme: theme.theme, footer_label: theme.footerLabel, style_preset: theme.stylePreset, mode: theme.mode, palette: theme.palette }, items };
  const baselineCandidateRaw = JSON.stringify(envelope);
  requireThat(assessStoredPresentationCandidate(baselineCandidateRaw, entry.snapshot, entry.options).issues.length === 0 && items.flatMap(slideCopyIssues).length === 0, "comparison_editor_baseline_invalid");
  const target = items.find(item => item.slide.source_order === (entry.id === "E" ? 4 : 20));
  requireThat(target?.body.trim(), "comparison_editor_target_has_no_visible_body");
  target.slide.visual.value = target.body;
  const candidateRaw = JSON.stringify(envelope), copyIssues = items.flatMap((item, index) => slideCopyIssues(item).map(issue => ({ index, ...issue })));
  requireThat(copyIssues.length === 1 && copyIssues[0].secondPath === "slide.visual.value" && copyIssues[0].index === 3, "comparison_editor_defect_not_isolated");
  requireThat(assessStoredPresentationCandidate(candidateRaw, entry.snapshot, entry.options).issues.every(issue => issue.code === "duplicate_slide_copy"), "comparison_editor_defect_changed_source");
  return { ...structuredClone(entry), candidateProvenance: "test-authored-source-faithful-controlled-duplicate-not-paid", baselineCandidateRaw, baselineCandidateDigest: digest(baselineCandidateRaw), candidateRaw, candidateDigest: digest(candidateRaw), controlledDefect: { path: "items.3.slide.visual.value", globalSlide: entry.id === "E" ? 4 : 20, rawCopyIssues: copyIssues } };
}

/** A private binding is supplied by the authorized operator; this function proves identity, not access authority. */
export function bindNativeCase(binding, expectedDigest) {
  requireThat(digest(binding) === expectedDigest && binding.provenance === "authorized-private-native-source", "comparison_native_binding_mismatch");
  requireThat([binding.actorId, binding.documentId, binding.sourceRevision, binding.sourceHash, binding.authorityReceiptRef].every(value => typeof value === "string" && value.length), "comparison_native_binding_incomplete");
  requireThat(["authenticated-email", "internal-user-id"].includes(binding.actorBindingKind), "comparison_actor_binding_kind_required");
  requireThat(binding.snapshotDigest === digest(binding.snapshot) && /^[a-f0-9]{64}$/.test(binding.sourceHash) && binding.sourceHash === binding.snapshotDigest, "comparison_native_snapshot_digest_mismatch");
  requireThat(Object.keys(binding).every(key => nativeKeys.includes(key)), "comparison_native_binding_unknown_fields");
  requireThat(binding.options.requestedSlideCount === 6 && (!binding.options.slideCountPolicy || binding.options.slideCountPolicy.kind === "exact" && binding.options.slideCountPolicy.value === 6) && !binding.options.presentationModelRoutes, "comparison_native_count_or_route_changed");
  requireThat(binding.documentTitle === "One document. More ways to use it." && binding.options.itemCount === 6 && !binding.options.productionPage && [undefined, null, "manual"].includes(binding.options.productionMode), "comparison_native_extent_mismatch");
  return { ...structuredClone(binding), id: "N", bindingDigest: expectedDigest, companionOnly: false };
}

export async function prepareStage({ stage, cases, actorId, commonEffort, selectionReceiptRef, codeRevision }) {
  const definition = STAGES[stage];
  requireThat(definition && typeof actorId === "string" && actorId && /^[a-f0-9]{40}$/.test(codeRevision), "comparison_manifest_identity_invalid");
  if (["C", "D"].includes(stage)) requireThat(EFFORTS.includes(commonEffort) && typeof selectionReceiptRef === "string" && selectionReceiptRef, "comparison_common_effort_not_selected");
  const arms = [], frozenCases = {};
  for (const id of definition.caseIds) {
    const entry = structuredClone(cases[id]);
    requireThat(entry?.id === id && !entry.options?.presentationModelRoutes, "comparison_case_missing_or_routes_not_independent");
    if (id === "N" && !entry.companionOnly) requireThat(entry.actorId === actorId && entry.bindingDigest, "comparison_native_actor_mismatch");
    if (definition.editor) requireThat(typeof entry.candidateRaw === "string" && entry.candidateRaw && entry.candidateProvenance && entry.candidateDigest === digest(entry.candidateRaw), "comparison_editor_candidate_unbound");
    frozenCases[id] = entry;
    const effortList = ["C", "D"].includes(stage) ? [commonEffort] : EFFORTS;
    for (const model of MODELS) for (const effort of effortList) {
      const routes = { OPENAI_SLIDES_COMPOSITION_MODEL: model, OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT: effort, OPENAI_SLIDES_REPAIR_MODEL: model, OPENAI_SLIDES_REPAIR_REASONING_EFFORT: effort };
      const prepared = await preparePresentationComparisonRequest(routes, actorId, { documentTitle: entry.documentTitle, snapshot: entry.snapshot, options: entry.options }, definition.editor ? entry.candidateRaw : undefined);
      requireThat(prepared.maximumInputTokens <= 64_000, "comparison_full_wire_input_exceeds_bound");
      requireThat(prepared.maximumOutputTokens === CAPS[id], "comparison_output_cap_drift");
      const input = JSON.parse(JSON.parse(prepared.requestBody).input);
      if (definition.editor) requireThat(input.original_artifact === entry.candidateRaw && input.validation_issues.length > 0, "comparison_editor_candidate_changed_by_redaction");
      arms.push({ id: `${stage}-${id}-${model}-${effort}`, caseId: id, model, effort, phase: prepared.phase, requestBody: prepared.requestBody, requestDigest: prepared.requestDigest, comparisonDigest: prepared.comparisonDigest, maximumInputTokens: 64_000, completeWireInputBound: prepared.maximumInputTokens, maximumOutputTokens: CAPS[id], maximumMicrousd: estimateOpenAITextCallMaximumMicrousd(model, 64_000, CAPS[id]), candidateDigest: prepared.candidateDigest, candidateIssues: prepared.candidateIssues });
    }
    requireThat(new Set(arms.filter(arm => arm.caseId === id).map(arm => arm.comparisonDigest)).size === 1, "comparison_arms_not_identical");
  }
  const manifest = { version: VERSION, stage, codeRevision, adapterVersion: PRESENTATION_ADAPTER_VERSION, pricingVersion: OPENAI_TEXT_PRICING_VERSION, actorId, ...(commonEffort ? { commonEffort, selectionReceiptRef } : {}), offlinePrepared: true, paidOperations: 0, nativeArtifactWrites: 0, automaticRetries: 0, automaticRepairs: 0, ceilingMicrousd: definition.ceiling, maximumCalls: definition.calls, totalMaximumMicrousd: arms.reduce((sum, arm) => sum + arm.maximumMicrousd, 0), cases: frozenCases, arms };
  requireThat(arms.length === definition.calls && manifest.totalMaximumMicrousd <= definition.ceiling, "comparison_stage_cap_invalid");
  return { ...manifest, digest: digest(manifest) };
}

async function durableDirectory(path, recursive = false) {
  const absolute = resolve(path);
  const firstCreated = await mkdir(absolute, { mode: 0o700, recursive });
  if (recursive && firstCreated === undefined) return;
  const stop = dirname(recursive ? firstCreated : absolute);
  for (let parent = dirname(absolute);; parent = dirname(parent)) {
    const handle = await open(parent, "r");
    try { await handle.sync(); } finally { await handle.close(); }
    if (parent === stop) break;
  }
}

export async function durableNewFile(path, value) {
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(typeof value === "string" ? value : JSON.stringify(value, null, 2)); await handle.sync(); } finally { await handle.close(); }
  const directory = await open(dirname(path), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function writePreparedStage(directory, manifest) {
  await durableDirectory(directory); // Exclusive directory: never overwrite a previous run.
  await durableNewFile(join(directory, "manifest.json"), manifest);
}

export function verifyManifest(manifest) {
  const definition = STAGES[manifest.stage];
  requireThat(definition && manifest.version === VERSION && manifest.adapterVersion === PRESENTATION_ADAPTER_VERSION && manifest.pricingVersion === OPENAI_TEXT_PRICING_VERSION && ownDigest(manifest) === manifest.digest, "comparison_manifest_changed_or_unknown");
  requireThat(manifest.maximumCalls === definition.calls && manifest.ceilingMicrousd === definition.ceiling && manifest.arms.length === definition.calls, "comparison_stage_cap_invalid");
  const expectedArms = definition.caseIds.flatMap(id => MODELS.flatMap(model => (["C", "D"].includes(manifest.stage) ? [manifest.commonEffort] : EFFORTS).map(effort => `${manifest.stage}-${id}-${model}-${effort}`)));
  requireThat(manifest.arms.map(arm => arm.id).sort().join("|") === expectedArms.sort().join("|"), "comparison_stage_matrix_changed");
  if (["C", "D"].includes(manifest.stage)) requireThat(EFFORTS.includes(manifest.commonEffort) && manifest.selectionReceiptRef, "comparison_common_effort_not_selected");
  for (const entry of Object.values(manifest.cases)) if (entry.id === "N" && !entry.companionOnly) {
    requireThat(entry.bindingDigest === digest(nativeBinding(entry)) && entry.snapshotDigest === digest(entry.snapshot), "comparison_native_binding_mismatch");
    bindNativeCase(nativeBinding(entry), entry.bindingDigest);
  }
  let total = 0;
  const ids = new Set();
  for (const arm of manifest.arms) {
    const request = JSON.parse(arm.requestBody), comparison = structuredClone(request);
    delete comparison.model; delete comparison.reasoning.effort;
    requireThat(!ids.has(arm.id) && MODELS.includes(arm.model) && EFFORTS.includes(arm.effort) && definition.caseIds.includes(arm.caseId), "comparison_arm_invalid"); ids.add(arm.id);
    requireThat(request.model === arm.model && request.reasoning.effort === arm.effort && request.service_tier === "default" && JSON.stringify(request.prompt_cache_options) === '{"mode":"explicit"}', "comparison_policy_changed");
    requireThat(digest(arm.requestBody) === arm.requestDigest && digest(comparison) === arm.comparisonDigest && Buffer.byteLength(arm.requestBody) + 4096 === arm.completeWireInputBound && arm.completeWireInputBound <= 64_000 && arm.maximumInputTokens === 64_000 && request.max_output_tokens === CAPS[arm.caseId] && arm.maximumOutputTokens === CAPS[arm.caseId], "comparison_wire_or_cap_changed");
    requireThat(arm.id === `${manifest.stage}-${arm.caseId}-${arm.model}-${arm.effort}` && arm.phase === (definition.editor ? "validation-repair" : "composition"), "comparison_arm_phase_changed");
    const input = JSON.parse(request.input), entry = manifest.cases[arm.caseId];
    if (definition.editor) requireThat(entry.candidateDigest === digest(entry.candidateRaw) && arm.candidateDigest === entry.candidateDigest && input.original_artifact === entry.candidateRaw && Array.isArray(input.validation_issues) && input.validation_issues.length, "comparison_editor_candidate_changed");
    else requireThat(arm.candidateDigest === null && input.original_artifact === undefined, "comparison_composition_has_candidate");
    const maximum = estimateOpenAITextCallMaximumMicrousd(arm.model, 64_000, arm.maximumOutputTokens);
    requireThat(arm.maximumMicrousd === maximum, "comparison_price_changed"); total += maximum;
  }
  for (const id of definition.caseIds) requireThat(new Set(manifest.arms.filter(arm => arm.caseId === id).map(arm => arm.comparisonDigest)).size === 1, "comparison_arms_not_identical");
  requireThat(total === manifest.totalMaximumMicrousd && total <= definition.ceiling, "comparison_stage_cap_invalid");
}

function verifyApproval(manifest, approval, now) {
  requireThat(approval?.manifestDigest === manifest.digest && approval.stage === manifest.stage && approval.maximumMicrousd === manifest.ceilingMicrousd && approval.approvalRef && approval.deadlineAt > now && approval.deadlineAt <= now + 30 * 60_000, "comparison_stage_not_approved");
  requireThat(approval.ledger?.receiptRef && approval.ledger.asOf <= now && approval.ledger.asOf >= now - 5 * 60_000 && approval.ledger.budgetMicrousd === 30_000_000, "comparison_fresh_original_ledger_required");
  const entries = approval.ledger.entries;
  requireThat(Array.isArray(entries) && entries.every(entry => entry.receiptRef && ["charged", "unresolved", "reserved"].includes(entry.kind) && integer(entry.microusd)), "comparison_unpriced_original_exposure");
  requireThat(new Set(entries.map(entry => entry.receiptRef)).size === entries.length, "comparison_duplicate_original_exposure");
  const exposure = entries.reduce((sum, entry) => sum + entry.microusd, 0);
  const contingency = approval.contingencyMicrousd ?? 10_000_000;
  requireThat(integer(contingency) && (contingency >= 10_000_000 || approval.contingencyOverrideRef), "comparison_contingency_not_approved");
  requireThat(integer(approval.applicationReservationMicrousd) && approval.applicationReservationMicrousd >= manifest.totalMaximumMicrousd && Math.max(approval.applicationReservationMicrousd, manifest.ceilingMicrousd) + exposure + contingency <= 30_000_000, "comparison_original_budget_exceeded");
  requireThat(approval.applicationReservationMicrousd <= manifest.ceilingMicrousd, "comparison_application_floor_requires_new_approval");
  for (const entry of Object.values(manifest.cases)) if (entry.id === "N") requireThat(!entry.companionOnly && entry.provenance === "authorized-private-native-source" && entry.actorId === manifest.actorId && entry.bindingDigest, "comparison_native_source_required");
}

/** Canonical private admission namespace, separate from per-run output paths. Never auto-release a claim. */
export function fileStageAdmitter(canonicalLedgerDirectory) {
  requireThat(canonicalLedgerDirectory && resolve(canonicalLedgerDirectory) === canonicalLedgerDirectory, "comparison_absolute_ledger_directory_required");
  return async ({ manifest, approval }) => {
    await durableDirectory(canonicalLedgerDirectory, true);
    const lockPath = join(canonicalLedgerDirectory, "admission.lock");
    const lock = await open(lockPath, "wx", 0o600); // A crash/another admission fails closed; no stale-lock guessing.
    try {
      const claimed = [];
      for (const filename of await readdir(canonicalLedgerDirectory)) if (filename.endsWith(".claim.json")) {
        const value = JSON.parse(await readFile(join(canonicalLedgerDirectory, filename), "utf8"));
        requireThat(value.schemaVersion === 1 && integer(value.reservedMicrousd) && value.approvalRef && value.manifestDigest, "comparison_unknown_claim_requires_operator");
        claimed.push(value);
      }
      requireThat(!claimed.some(claim => claim.approvalRef === approval.approvalRef), "comparison_approval_already_consumed");
      const observed = approval.ledger.entries.reduce((sum, entry) => sum + entry.microusd, 0);
      // Conservative double-counting is intentional: old claims are never silently released or netted against a fresh ledger.
      requireThat(observed + claimed.reduce((sum, claim) => sum + claim.reservedMicrousd, 0) + manifest.ceilingMicrousd + (approval.contingencyMicrousd ?? 10_000_000) <= 30_000_000, "comparison_canonical_budget_exceeded");
      const claim = { schemaVersion: 1, claimRef: `comparison-claim-${digest(approval.approvalRef)}`, approvalRef: approval.approvalRef, manifestDigest: manifest.digest, ledgerReceiptRef: approval.ledger.receiptRef, reservedMicrousd: manifest.ceilingMicrousd };
      await durableNewFile(join(canonicalLedgerDirectory, `${digest(approval.approvalRef)}.claim.json`), claim);
      return claim;
    } finally { await lock.close(); await unlink(lockPath); }
  };
}

/** Only an explicitly injected one-shot transport can dispatch. No fetch, credentials, retries, resume, or production writes are implemented here. */
export async function runApprovedStage({ manifest, approval, directory, transport, authorityStillCurrent, admitStage, now = Date.now }) {
  manifest = freeze(structuredClone(manifest)); approval = freeze(structuredClone(approval));
  verifyManifest(manifest); verifyApproval(manifest, approval, now());
  requireThat(typeof transport === "function" && typeof authorityStillCurrent === "function" && typeof admitStage === "function", "comparison_explicit_transport_authority_admission_required");
  await durableDirectory(directory); // Existing, unknown, pending, or unpriced run is NEVER replayed.
  await durableNewFile(join(directory, "manifest.json"), manifest);
  await durableNewFile(join(directory, "approval.json"), approval);
  requireThat(await authorityStillCurrent(manifest, approval, { phase: "before-admission" }) && now() < approval.deadlineAt, "comparison_authority_changed");
  const claim = await admitStage({ manifest, approval });
  requireThat(claim?.claimRef && claim.approvalRef === approval.approvalRef && claim.manifestDigest === manifest.digest && claim.reservedMicrousd === manifest.ceilingMicrousd, "comparison_atomic_admission_required");
  await durableNewFile(join(directory, "admission.json"), claim);
  const receipts = [], responseIds = new Set();
  for (const arm of manifest.arms) {
    requireThat(now() < approval.deadlineAt && await authorityStillCurrent(manifest, approval, { phase: "before-pending", armId: arm.id }) && now() < approval.deadlineAt, "comparison_authority_or_deadline_changed");
    const clientRequestId = `forma-comparison-${randomUUID()}`, pendingAt = now();
    const pending = { version: VERSION, state: "pending", manifestDigest: manifest.digest, armId: arm.id, clientRequestId, requestDigest: arm.requestDigest, phase: arm.phase, model: arm.model, requestedEffort: arm.effort, pricingVersion: manifest.pricingVersion, maximumInputTokens: arm.maximumInputTokens, maximumOutputTokens: arm.maximumOutputTokens, reservedMicrousd: arm.maximumMicrousd, pendingAt, admissionClaimRef: claim.claimRef };
    const prefix = join(directory, arm.id);
    await durableNewFile(`${prefix}.pending.json`, pending); // Durable before transport; ID is tracing, NOT idempotency.
    if (now() >= approval.deadlineAt || !await authorityStillCurrent(manifest, approval, { phase: "before-dispatch", armId: arm.id, clientRequestId }) || now() >= approval.deadlineAt) throw new Error("comparison_pending_dispatch_guard_stopped");
    verifyManifest(manifest);
    const transportStartedAt = now();
    requireThat(transportStartedAt < approval.deadlineAt, "comparison_pending_dispatch_deadline_stopped");
    let response;
    try { response = await transport({ endpoint: "https://api.openai.com/v1/responses", method: "POST", requestBody: arm.requestBody, clientRequestId, deadlineAt: approval.deadlineAt }); }
    catch { throw new Error("comparison_submission_unknown_hold_retained"); }
    response = freeze({ bodyText: response?.bodyText, status: response?.status, httpRequestId: response?.httpRequestId });
    const receivedAt = now();
    requireThat(typeof response?.bodyText === "string", "comparison_raw_response_missing_hold_retained");
    await durableNewFile(`${prefix}.response.txt`, response.bodyText); // Retain complete raw response before any parsing/validation.
    await durableNewFile(`${prefix}.response-meta.json`, { httpStatus: response.status, httpRequestId: response.httpRequestId ?? null, receivedAt, transportStartedAt, clientRequestId, requestDigest: arm.requestDigest });
    const durableAt = now(), rawResponseDigest = digest(response.bodyText);
    let terminal, financialPersisted = false;
    try {
      requireThat(response.status === 200 && typeof response.httpRequestId === "string" && response.httpRequestId, "comparison_response_identity_unconfirmed");
      const body = JSON.parse(response.bodyText);
      requireThat(typeof body.id === "string" && body.id && !responseIds.has(body.id) && body.model === arm.model && (body.service_tier === undefined || body.service_tier === "default"), "comparison_response_identity_mismatch");
      if (body.reasoning?.effort !== undefined) requireThat(body.reasoning.effort === arm.effort, "comparison_effective_effort_mismatch");
      const usage = readOpenAITextUsage(body.usage, { cachePolicy: "disabled-explicit" });
      const pricingReceipt = priceCurrentOpenAITextUsage(arm.model, usage, body.service_tier ?? "default");
      terminal = { ...pending, state: "priced", providerResponseId: body.id, httpRequestId: response.httpRequestId, effectiveModel: body.model, ...(body.reasoning?.effort ? { effectiveEffort: body.reasoning.effort } : {}), completionStatus: body.status ?? "unknown", ...(body.incomplete_details?.reason ? { incompleteReason: body.incomplete_details.reason } : {}), rawResponseDigest, rawResponseRef: `${arm.id}.response.txt`, pricingReceipt, costMicrousd: pricingReceipt.totalMicrousd, dispatchToResponseMs: receivedAt - transportStartedAt, durableCaptureMs: durableAt - receivedAt };
      await durableNewFile(`${prefix}.financial.json`, terminal); financialPersisted = true; // Actual own usage/price survives overrun or later validation failure.
      if (usage.inputTokens > arm.maximumInputTokens || usage.outputTokens > arm.maximumOutputTokens || pricingReceipt.totalMicrousd > arm.maximumMicrousd) terminal.stopReason = "usage_or_charge_exceeds_admission_no_retry";
      const raw = body.output_text ?? body.output?.flatMap(output => output.content ?? []).filter(content => content.type === "output_text").map(content => content.text ?? "").join("") ?? "";
      const refused = body.output?.some(output => output.type === "refusal" || output.content?.some(content => content.type === "refusal" || content.refusal));
      const entry = manifest.cases[arm.caseId], validationStart = now();
      const assessed = assessStoredPresentationCandidate(raw, entry.snapshot, entry.options);
      let originalItems = []; try { originalItems = JSON.parse(raw).items ?? []; } catch { /* Report malformed output via the validator. */ }
      const rawCopyIssues = originalItems.flatMap((item, index) => slideCopyIssues(item).map(issue => ({ index, ...issue })));
      const pageStart = entry.options.productionPage?.globalStartIndex ?? 0;
      const rawDeckCopy = slideDeckCopyIssues(originalItems);
      const protectedPair = issue => [ [issue.first, issue.firstSlide], [issue.second, issue.secondSlide] ].every(([text, slide]) => assessed.sourceContract.protectedMessages.some(message => message.text.trim() === text.trim() && message.slideNumber === pageStart + slide + 1));
      terminal = { ...terminal, localValidationMs: now() - validationStart, validationIssues: assessed.issues, rawCopyIssues, rawDeckCopyIssues: rawDeckCopy.filter(issue => !protectedPair(issue)), authorizedBookendCopyIssues: rawDeckCopy.filter(protectedPair), candidateDigest: digest(raw), normalizationMayChangeCopy: true, nativeViewerInspected: false, exportsInspected: false };
      responseIds.add(body.id);
      if (body.status !== "completed" || refused || !raw.trim()) terminal.stopReason = body.status === "incomplete" ? "provider_incomplete_review_cap_no_retry" : "provider_not_completed_no_retry";
    } catch (error) {
      terminal = terminal ? { ...terminal, stopReason: financialPersisted ? "local_validation_failed_no_retry" : "financial_capture_failed_no_retry", validationError: error.message } : { ...pending, state: "operator_required", httpStatus: response.status, httpRequestId: response.httpRequestId ?? null, receivedAt, rawResponseDigest, rawResponseRef: `${arm.id}.response.txt`, reason: error.message, holdRetainedMicrousd: arm.maximumMicrousd };
    }
    await durableNewFile(`${prefix}.terminal.json`, terminal); // Per-call own financial receipt before next arm, never aggregate under last model.
    receipts.push(terminal);
    if (terminal.state !== "priced" || terminal.stopReason) return { state: "stopped", receipts, providerRequestsSubmitted: receipts.length };
  }
  const report = { state: "completed", manifestDigest: manifest.digest, providerRequestsSubmitted: receipts.length, costMicrousd: receipts.reduce((sum, receipt) => sum + receipt.costMicrousd, 0), receipts, nativeArtifactWrites: 0, paidJudges: 0, inference: "One sample per arm; no production-default or stable-superiority conclusion." };
  await durableNewFile(join(directory, "report.json"), report);
  return report;
}

// CLI is OFFLINE ONLY. It never reads environment credentials or dispatches.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [command = "prepare", directory, codeRevision] = process.argv.slice(2);
  requireThat(command === "prepare" && directory && codeRevision, "usage: node --experimental-strip-types scripts/presentation-comparison.mjs prepare NEW_PRIVATE_DIRECTORY EXACT_40_CHAR_COMMIT");
  const cases = await loadFixtureCases();
  const manifest = await prepareStage({ stage: "A", cases, actorId: "offline-fixture-actor", codeRevision });
  await writePreparedStage(directory, manifest);
  console.log(JSON.stringify({ manifestDigest: manifest.digest, paidOperations: 0, providerRequestsSubmitted: 0, nativeSourceBound: false, output: directory }));
}
