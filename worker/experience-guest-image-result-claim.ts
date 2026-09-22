import { canonicalJson, digest, exactKeys, freeze, record } from "../src/experiences/compiler.ts";
import { eventWriteBindings, makeEvent, uuidV7, type EventRow } from "./event-write-primitives.ts";
import { guestImageCopyCommandKey, guestImageCopyLineage, guestImageCopyOriginalSource, guestImageCopyPrefixEventInput,
  guestImageCopyPrefixLineage, guestImageCopySaveEnvelope, guestImageCopySaveEventInput,
  type GuestImageClaimLineage, type GuestImageCopyCommand, type GuestImageCopyResource } from "./experience-guest-image-copy-contract.ts";
import { guestImageStageHistoryIdentity, guestImageStageHistoryStorageValue,
  type GuestImageStageClaimLineage, type GuestImageStageCopyRow, type GuestImageStageHistoryRole } from "./experience-guest-image-stage-custody.ts";
import { validateGuestImageResultCopyDescriptor, guestImageResultOriginalOutputId,
  type GuestImageResultCopyDescriptor } from "./experience-guest-image-result-copy-contract.ts";
import { guestImageResultClaimRows, guestImageResultHistoryIdentity, readGuestImageResultClaimEventOrigin,
  type GuestImageResultClaimLineage, type GuestImageResultHistoryCopy } from "./experience-guest-image-result-claim-contract.ts";
import type { GuestImageResultClaimSeedSnapshot } from "./experience-guest-image-result-inventory.ts";
import type { GuestImageResultPublishedGraph } from "./experience-guest-image-result-facts.ts";

/** Candidate values only. These constructors perform no database, bucket or
 * provider operation and mint no source, ready-copy or completed authority.
 * The fixed claim core owns currentness, native preparations and publication. */
export type GuestImageResultClaimBody = Readonly<{
  role: GuestImageStageHistoryRole | "planner" | "prompt";
  kind: "guest-image-stage-history" | "guest-image-result-history";
  contentId: string; content: string; digest: string; bytes: number;
}>;
export type GuestImageResultClaimRetentionReceipt = Readonly<{ contentId: string; createdAt: string; expiresAt: string }>;
type Five<T> = readonly [T, T, T, T, T];
type Presentation = Readonly<{
  title: string; model_id: "gpt-image-2" | "gpt-image-2.5-sunburst"; planner_model_id: "gpt-5.6-terra"; provider: "openai";
  prompt_technique: "prose" | "bullets" | "json" | "xml"; quality: "high"; purpose: "final"; source_surface: "outputs";
  latency_ms: number; source_block_versions: readonly Readonly<{ block_id: string; version: number }>[]; source_rights_digest: string;
}>;
export type GuestImageResultClaimCandidateDraft = Readonly<{
  version: 1; kind: "inert-guest-image-result-claim-candidate"; descriptor: GuestImageResultCopyDescriptor;
  destinationHead: number; eventIds: readonly string[]; contextEvents: readonly Pick<EventRow, "type" | "payload">[];
  draftId: string; draftHash: string; origin: string; requirementId: string;
  source: GuestImageClaimLineage["source"]; sourceSavePayload: Record<string, unknown>;
  sourceSaveEnvelope: Readonly<{ spec: unknown; planSuggestions: unknown }>;
  stageSource: GuestImageStageClaimLineage["source"]; stageNativeSnapshotDigest: string;
  originalCompletion: GuestImageResultClaimLineage["originalCompletion"]; presentation: Presentation;
  bodies: Five<GuestImageResultClaimBody>;
}>;
export type GuestImageResultClaimCandidate = Readonly<{
  lineage: GuestImageResultClaimLineage; lineageDigest: string;
  completedReview: Awaited<ReturnType<typeof guestImageResultClaimRows>>["completedReview"];
  events: readonly EventRow[]; prefixBodies: readonly string[]; saveBody: string; claimBody: string;
  stageBodies: readonly [string, string, string]; resultBodies: readonly [string, string];
  afterGraph: Omit<GuestImageResultPublishedGraph, "publishedAttempt">;
}>;
const fail = (): never => { throw new Error("guest_image_result_claim_candidate_invalid"); };
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const integer = (value: unknown, minimum = 0, maximum = 8_000_000_000_000): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum && value <= maximum;
const iso = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** The producer snapshot contains shared inert subobjects. Inspect descriptors
 * without invoking accessors, then detach the complete input before any await. */
function snapshot<T>(input: T): T {
  const seen = new Set<object>(), active = new Set<object>(); let count = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++count > 100_000 || depth > 40) return fail();
    if (value === null || value === undefined || typeof value === "boolean") return;
    if (typeof value === "number") { if (!Number.isFinite(value)) return fail(); return; }
    if (typeof value === "string") { if (!value.isWellFormed() || bytes(value) > 2_097_152) return fail(); return; }
    if (typeof value !== "object" || (Array.isArray(value) ? Object.getPrototypeOf(value) !== Array.prototype : !record(value))) return fail();
    if (active.has(value)) return fail();
    if (seen.has(value)) return; seen.add(value); active.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string")) return fail();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === "length") continue;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value") || ["__proto__", "constructor", "prototype"].includes(key)
        || Array.isArray(value) && !/^(0|[1-9]\d*)$/u.test(key)) return fail();
      visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(value)) {
      if (value.length > 4096 || Object.keys(value).length !== value.length) return fail();
      for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return fail();
    }
    active.delete(value);
  };
  visit(input, 0); return structuredClone(input);
}
function object(raw: unknown, maximum = 65_536): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.isWellFormed() || bytes(raw) < 1 || bytes(raw) > maximum) return fail();
  let value: unknown; try { value = JSON.parse(raw); } catch { return fail(); }
  if (!record(value)) return fail(); return snapshot(value);
}
function body(event: EventRow): string {
  const value = eventWriteBindings(event)[16];
  if (typeof value !== "string" || bytes(value) > 65_536) return fail(); return value;
}
function at(event: EventRow, eventId: string, time: string): EventRow {
  return { ...event, eventId, occurredAt: time, recordedAt: time };
}
function withoutRevocation(row: object) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "revoked_at_ms"));
}

/** Captures one immutable intent and deterministic body identities. No clock is
 * selected here: native retention receipts must exist before final claim T. */
export async function draftGuestImageResultClaimCandidate(input: {
  source: GuestImageResultClaimSeedSnapshot["source"]; descriptor: GuestImageResultCopyDescriptor; destinationHead: number;
}): Promise<GuestImageResultClaimCandidateDraft> {
  const captured = snapshot(input);
  if (!record(captured) || !exactKeys(captured, ["source", "descriptor", "destinationHead"]) || !integer(captured.destinationHead)) return fail();
  const copy = await validateGuestImageResultCopyDescriptor(captured.descriptor), m = copy.manifest;
  const { history, stage, result } = captured.source, original = history.original, saved = history.saved, plan = original.plan;
  if (!plan || plan.events.length !== m.sourceHead || original.projectId !== m.projectId || original.documentId !== m.documentId
    || !same(original.eventIds, m.sourceEventIds) || plan.draftHash !== m.draftHash || stage.stageState !== "quoted"
    || stage.sourceHead !== m.sourceHead || stage.sourceSaveHead !== m.sourceSaveHead || stage.stageHead !== m.quoteHead
    || !stage.rows.quoteIndex || !stage.rows.stage || !stage.rows.preflightCommand || stage.tails.length !== 3
    || result.completion.eventId !== m.completionEventId || result.completion.sequence !== m.resultHead - 1
    || result.completion.payload.generation_id !== m.generationId || result.rows.privateContents.length !== 2
    || await digest(result.immutableSnapshot) !== m.nativeSnapshotDigest) return fail();
  const sourceSavePayload = object(saved.tail.private_json), envelope = sourceSavePayload.output_command_envelope;
  if (!record(envelope) || !record(envelope.guestSponsorPreparation) || !record(envelope.guestSponsorPreparation.source)) return fail();
  const session = history.liveSource.session;
  const source = guestImageCopyOriginalSource({ head: m.sourceHead, eventIds: [...m.sourceEventIds], expiresAt: stage.expiresAt,
    sessionPolicyId: session.row.policy_id, sessionTermsDigest: session.row.terms_digest, sessionExpiresAtMs: session.row.expires_at_ms,
    releaseHash: plan.release.releaseHash }, { event: { eventId: saved.eventId, sequence: Number(saved.tail.sequence),
      occurredAt: String(saved.tail.occurred_at), recordedAt: String(saved.tail.recorded_at) },
    command: saved.command as GuestImageCopyCommand, resource: saved.resource as GuestImageCopyResource },
  sourceSavePayload, envelope.guestSponsorPreparation.source, await digest(saved.tail.private_json));
  const bodies: GuestImageResultClaimBody[] = [];
  for (const role of ["confirmation", "quote", "construction"] as const) {
    const raw = role === "confirmation" ? stage.tails[1].row.private_json : role === "quote" ? stage.tails[2].row.private_json
      : canonicalJson({ stage: stage.rows.stage, resource: stage.resources[2] });
    const content = guestImageStageHistoryStorageValue(role, raw), originalDigest = await digest(content);
    const contentId = await guestImageStageHistoryIdentity({ sessionId: m.sessionId, destinationUserId: copy.destinationUserId,
      manifestDigest: copy.manifestDigest, role, originalDigest });
    bodies.push({ role, kind: "guest-image-stage-history", contentId, content, digest: originalDigest, bytes: bytes(content) });
  }
  for (const [index, role] of (["planner", "prompt"] as const).entries()) {
    const originalBody = m.privateContents[index], rows = result.rows.privateContents.filter(row => row.content_id === originalBody.contentId);
    if (rows.length !== 1) return fail();
    const row = rows[0], content = row.content;
    if (typeof content !== "string" || !content.isWellFormed() || !bytes(content) || bytes(content) > 65_536
      || row.kind !== originalBody.kind || row.owner_id !== m.guestSubject || row.redacted_at !== null
      || row.created_at !== originalBody.createdAt || row.expires_at !== originalBody.expiresAt || bytes(content) !== originalBody.bytes
      || await digest(content) !== originalBody.contentDigest) return fail();
    const contentId = await guestImageResultHistoryIdentity({ sessionId: m.sessionId, destinationUserId: copy.destinationUserId,
      manifestDigest: copy.manifestDigest, role, originalDigest: originalBody.contentDigest });
    bodies.push({ role, kind: "guest-image-result-history", contentId, content, digest: originalBody.contentDigest, bytes: bytes(content) });
  }
  const stageEvent = (row: Record<string, unknown>, privateDigest: string) => ({ id: String(row.event_id), sequence: Number(row.sequence),
    occurred: String(row.occurred_at), recorded: String(row.recorded_at), public: String(row.payload), privateDigest });
  const q = stage.rows.quoteIndex;
  const stageSource: GuestImageStageClaimLineage["source"] = { head: m.sourceHead, saveHead: m.sourceSaveHead, stageHead: m.quoteHead,
    state: "quoted", expiresAt: stage.expiresAt, originalPayerUserId: history.saved.approval.policy.payerUserId, saveEventId: saved.eventId,
    confirmation: stageEvent(stage.tails[1].row, bodies[0].digest), confirmationCommand: stage.rows.command as unknown as GuestImageCopyCommand,
    confirmationResource: stage.resources[1] as unknown as GuestImageCopyResource, quote: { ...stageEvent(stage.tails[2].row, bodies[1].digest),
      preflightId: String(q.preflight_id), planRevisionId: String(q.plan_revision_id), expiresAt: String(q.expires_at), termsDigest: String(q.terms_digest) },
    quoteCommand: stage.rows.preflightCommand as unknown as GuestImageCopyCommand, construction: { driverId: String(stage.rows.stage.driver_id),
      commandDigest: String(stage.rows.stage.command_digest), resource: stage.resources[2] as unknown as GuestImageCopyResource } };
  const stageNativeSnapshotDigest = await digest({ source: original.source, session: withoutRevocation(original.session), sourcePolicy: original.policy,
    custodyTerms: original.terms, prefix: original.prefixWitnesses, approval: withoutRevocation(saved.approval.row),
    tails: stage.tails.map(value => value.observed), resources: stage.resources, rows: stage.rows });
  const completed = result.completion, p = completed.payload, compiled = result.events.filter(event => event.type === "ContextCompiled");
  const issuance = object(result.rows.issuance.envelope_json), blockIds = new Set([
    ...plan.events.flatMap(event => typeof event.payload.block_id === "string" ? [event.payload.block_id] : []), saved.requirementId]);
  if (compiled.length !== 1 || typeof p.title !== "string" || p.title.length > 8192 || !p.title.isWellFormed()
    || (p.model_id !== "gpt-image-2" && p.model_id !== "gpt-image-2.5-sunburst") || p.planner_model_id !== "gpt-5.6-terra" || p.provider !== "openai"
    || !["prose", "bullets", "json", "xml"].includes(String(p.prompt_technique)) || p.quality !== "high" || p.purpose !== "final"
    || p.source_surface !== "outputs" || !integer(p.latency_ms, 0, Number.MAX_SAFE_INTEGER) || !hash(issuance.rightsDigest)
    || p.model_id !== copy.source.producerMetadata.model || p.provider !== copy.source.producerMetadata.provider
    || p.adapter_version !== copy.source.producerMetadata.adapter || (p.provider_request_id ?? "") !== copy.source.producerMetadata.providerRequestId) return fail();
  const versions = compiled[0].payload.source_block_versions;
  if (!Array.isArray(versions) || versions.length < 1 || versions.length > 19 || versions.some(version => !record(version)
    || !exactKeys(version, ["block_id", "version"]) || typeof version.block_id !== "string" || !blockIds.has(version.block_id)
    || !integer(version.version, 1, 19)) || new Set(versions.map(version => version.block_id)).size !== versions.length) return fail();
  const presentation: Presentation = { title: p.title, model_id: p.model_id, planner_model_id: p.planner_model_id, provider: p.provider,
    prompt_technique: p.prompt_technique as Presentation["prompt_technique"], quality: p.quality, purpose: p.purpose, source_surface: p.source_surface,
    latency_ms: p.latency_ms, source_block_versions: versions as Presentation["source_block_versions"], source_rights_digest: issuance.rightsDigest };
  const originalCompletion = { eventId: completed.eventId, sequence: completed.sequence, occurredAt: completed.occurredAt,
    recordedAt: completed.recordedAt, privateDigest: await digest(body(completed)), objectId: guestImageResultOriginalOutputId(m.generationId),
    ...copy.source.producerMetadata };
  return freeze({ version: 1, kind: "inert-guest-image-result-claim-candidate", descriptor: copy, destinationHead: captured.destinationHead,
    eventIds: Array.from({ length: m.sourceHead + 2 }, () => uuidV7()), contextEvents: plan.events.map(event => ({ type: event.type, payload: event.payload })),
    draftId: plan.draftId, draftHash: plan.draftHash, origin: session.policy.terms.origin, requirementId: saved.requirementId,
    source, sourceSavePayload, sourceSaveEnvelope: { spec: envelope.spec, planSuggestions: envelope.planSuggestions }, stageSource,
    stageNativeSnapshotDigest, originalCompletion, presentation, bodies: bodies as unknown as Five<GuestImageResultClaimBody> });
}

/** Native receipts are caller-supplied inert values here. Only the core's real
 * preparePrivateContent calls and atomic proofs can establish their provenance. */
export async function finishGuestImageResultClaimCandidate(draft: GuestImageResultClaimCandidateDraft,
  receipts: readonly GuestImageResultClaimRetentionReceipt[], claimedAtMs: number): Promise<GuestImageResultClaimCandidate> {
  const captured = snapshot({ draft, receipts, claimedAtMs }), d = captured.draft, r = captured.receipts;
  const copy = await validateGuestImageResultCopyDescriptor(d.descriptor), m = copy.manifest;
  if (d.version !== 1 || d.kind !== "inert-guest-image-result-claim-candidate" || !integer(d.destinationHead)
    || !integer(captured.claimedAtMs, 1) || d.eventIds.length !== m.sourceHead + 2 || d.eventIds.some(id => !uuid(id))
    || new Set(d.eventIds).size !== d.eventIds.length || d.contextEvents.length !== m.sourceHead || d.bodies.length !== 5 || r.length !== 5) return fail();
  const time = new Date(captured.claimedAtMs).toISOString();
  for (const [index, receipt] of r.entries()) {
    const expected = d.bodies[index];
    if (!record(receipt) || !exactKeys(receipt, ["contentId", "createdAt", "expiresAt"]) || receipt.contentId !== expected.contentId
      || expected.role !== ["confirmation", "quote", "construction", "planner", "prompt"][index]
      || expected.kind !== (index < 3 ? "guest-image-stage-history" : "guest-image-result-history")
      || !iso(receipt.createdAt) || !iso(receipt.expiresAt) || receipt.createdAt > time || receipt.expiresAt <= time
      || Date.parse(receipt.createdAt) < copy.leaseSnapshot.created_at_ms || expected.bytes !== bytes(expected.content)
      || await digest(expected.content) !== expected.digest) return fail();
  }
  const stream = `creative:${copy.destinationUserId}`, head = d.destinationHead;
  const prefixEvents = d.contextEvents.map((event, index) => at(makeEvent(...guestImageCopyPrefixEventInput(
    { destinationStreamId: stream, head, sessionId: m.sessionId }, event, index)), d.eventIds[index], time));
  const prefixBodies = prefixEvents.map(body), prefixHashes = await Promise.all(prefixBodies.map(content => digest(content)));
  const contextLineage = guestImageCopyPrefixLineage({ sessionId: m.sessionId, guestSubject: m.guestSubject, projectId: m.projectId,
    documentId: m.documentId, draftHash: m.draftHash, manifestDigest: copy.manifestDigest, sourceEventIds: m.sourceEventIds,
    sourceHead: m.sourceHead, destinationUserId: copy.destinationUserId, origin: d.origin, head }, prefixEvents, prefixHashes, structuredClone(copy.leaseSnapshot));
  const contextLineageDigest = await digest(contextLineage), key = await guestImageCopyCommandKey(m.sessionId, copy.destinationUserId, copy.manifestDigest);
  const envelope = guestImageCopySaveEnvelope({ sessionId: m.sessionId, manifestDigest: copy.manifestDigest, guestSubject: m.guestSubject,
    documentId: m.documentId, source: d.source, contextHead: contextLineage.targetHead, commandKey: key, requirementId: d.requirementId }, d.sourceSaveEnvelope);
  const requestDigest = (await digest(envelope)).slice(7);
  const saveEvent = at(makeEvent(...guestImageCopySaveEventInput({ destinationStreamId: stream, destinationUserId: copy.destinationUserId,
    contextHead: contextLineage.targetHead, commandKey: key }, d.sourceSavePayload, envelope)), d.eventIds[m.sourceHead], time);
  const saveBody = body(saveEvent), saveLineage = guestImageCopyLineage({ sessionId: m.sessionId, guestSubject: m.guestSubject,
    destinationUserId: copy.destinationUserId, projectId: m.projectId, documentId: m.documentId, draftId: d.draftId, draftHash: d.draftHash,
    manifestDigest: copy.manifestDigest, origin: d.origin, contextLineageDigest, source: d.source, commandKey: key, requestDigest,
    requirementId: d.requirementId, contextHead: contextLineage.targetHead }, saveEvent, await digest(saveBody));
  const saveLineageDigest = await digest(saveLineage);
  const stageLineage: GuestImageStageClaimLineage = { version: 1, kind: "original-image-stage-custody", sessionId: m.sessionId,
    guestSubject: m.guestSubject, destinationUserId: copy.destinationUserId, projectId: m.projectId, documentId: m.documentId,
    manifestDigest: copy.manifestDigest, nativeSnapshotDigest: d.stageNativeSnapshotDigest, contextLineageDigest, saveLineageDigest,
    source: d.stageSource, copies: d.bodies.slice(0, 3).map(value => ({ role: value.role as GuestImageStageHistoryRole,
      contentId: value.contentId, digest: value.digest, bytes: value.bytes })) };
  const stageLineageDigest = await digest(stageLineage);
  const stageCopies = d.bodies.slice(0, 3).map((value, index): GuestImageStageCopyRow => ({ session_id: m.sessionId,
    role: value.role as GuestImageStageHistoryRole, content_id: value.contentId, original_digest: value.digest, byte_length: value.bytes,
    created_at: r[index].createdAt, expires_at: r[index].expiresAt })) as [GuestImageStageCopyRow, GuestImageStageCopyRow, GuestImageStageCopyRow];
  const resultCopies = d.bodies.slice(3).map((value, index): GuestImageResultHistoryCopy => ({ custody_id: copy.custodyId,
    role: index === 0 ? "planner" : "prompt", content_id: value.contentId, original_content_id: m.privateContents[index].contentId,
    original_kind: m.privateContents[index].kind, original_digest: value.digest, byte_length: value.bytes,
    created_at: r[index + 3].createdAt, expires_at: r[index + 3].expiresAt })) as [GuestImageResultHistoryCopy, GuestImageResultHistoryCopy];
  const expiresAt = resultCopies.map(value => value.expires_at).sort()[0], claimId = d.eventIds[m.sourceHead + 1];
  const claimedOrigin = readGuestImageResultClaimEventOrigin({ version: 1, kind: "guest-image-result-event-origin-v1", custodyId: copy.custodyId,
    claimEventId: claimId, outputId: guestImageResultOriginalOutputId(m.generationId), generationId: m.generationId, manifestDigest: copy.manifestDigest });
  // Exact presentation fields only. Original financial/native execution history
  // remains in lineage; no generated native job, grant or completion is emitted.
  const p = d.presentation;
  const payload = { version: 1, project_id: m.projectId, document_id: m.documentId, custody_id: copy.custodyId,
    object_id: claimedOrigin.outputId, generation_id: m.generationId, manifest_digest: copy.manifestDigest, claimed_origin: claimedOrigin,
    original_created_at: d.originalCompletion.occurredAt, title: p.title, model_id: p.model_id, planner_model_id: p.planner_model_id,
    provider: p.provider, prompt_technique: p.prompt_technique, quality: p.quality, purpose: p.purpose, source_surface: p.source_surface,
    output_ref: resultCopies[0].content_id, prompt_ref: resultCopies[1].content_id, content_expires_at: expiresAt,
    media_url: `/api/media/${encodeURIComponent(copy.destinationKey)}`, media_type: "image/png", source_content_hash: m.object.contentSha256,
    image_width: m.object.width, image_height: m.object.height, image_byte_length: copy.source.byteLength, latency_ms: p.latency_ms,
    source_block_versions: p.source_block_versions, source_rights_digest: p.source_rights_digest };
  const claimEvent = at(makeEvent(stream, saveEvent.sequence + 1, `user:${copy.destinationUserId}`, "server:guest-image-result-claim",
    `guest-image-result-claim:v1:${copy.custodyId}`, "GuestImageResultClaimed", payload), claimId, time), claimBody = body(claimEvent);
  const lineage: GuestImageResultClaimLineage = { version: 1, kind: "original-image-result-custody", copy, contextLineage, contextLineageDigest,
    saveLineage, saveLineageDigest, stageLineage, stageLineageDigest, stageCopies, resultCopies, originalCompletion: d.originalCompletion,
    canonical: { eventId: claimId, streamId: stream, sequence: claimEvent.sequence, occurredAt: time, recordedAt: time,
      privateDigest: await digest(claimBody), expiresAt } };
  const rows = await guestImageResultClaimRows(lineage), events = [...prefixEvents, saveEvent, claimEvent];
  const base = { session_id: m.sessionId, destination_user_id: copy.destinationUserId, lease_id: copy.leaseSnapshot.lease_id,
    request_id: copy.requestId, manifest_digest: copy.manifestDigest };
  const afterGraph: Omit<GuestImageResultPublishedGraph, "publishedAttempt"> = { version: 1, revokedAtMs: captured.claimedAtMs,
    contextMapping: { ...base, lineage_json: canonicalJson(contextLineage), lineage_digest: contextLineageDigest, created_at_ms: captured.claimedAtMs },
    saveMapping: { ...base, context_lineage_digest: contextLineageDigest, lineage_json: canonicalJson(saveLineage), lineage_digest: saveLineageDigest, created_at_ms: captured.claimedAtMs },
    stageMapping: { ...base, context_lineage_digest: contextLineageDigest, save_lineage_digest: saveLineageDigest,
      lineage_json: canonicalJson(stageLineage), lineage_digest: stageLineageDigest, created_at_ms: captured.claimedAtMs },
    resultMapping: rows.custody, stageCopies, resultCopies,
    eventEnvelopes: events.map(event => { const bindings = eventWriteBindings(event); return {
      event: { event_id: event.eventId, stream_id: event.streamId, sequence: event.sequence, occurred_at: event.occurredAt,
        recorded_at: event.recordedAt, actor: event.actor, client_id: event.clientId, correlation_id: event.correlationId,
        causation_id: event.causationId, compensates_event_id: event.compensatesEventId, schema_version: event.schemaVersion,
        type: event.type, payload: String(bindings[12]) },
      envelope: { private_event_id: event.eventId, owner_id: copy.destinationUserId, project_id: bindings[14], document_id: bindings[15],
        private_json: body(event), created_at: event.recordedAt, redacted_at: null } }; }),
    eventClientReceipts: prefixEvents.map(event => ({ stream_id: stream, client_event_id: String(event.payload.client_event_id),
      event_id: event.eventId, sequence: event.sequence, created_at: time })),
    saveCommand: { scope_key: `personal:${copy.destinationUserId}:${m.projectId}`, actor_user_id: copy.destinationUserId,
      command_key: key, request_digest: requestDigest, action: "save", event_id: saveEvent.eventId, created_at: time },
    privateContents: d.bodies.map((value, index) => ({ content_id: value.contentId, owner_id: copy.destinationUserId, kind: value.kind,
      content: value.content, created_at: r[index].createdAt, expires_at: r[index].expiresAt, redacted_at: null })) };
  return freeze({ lineage, lineageDigest: rows.custody.lineage_digest, completedReview: rows.completedReview, events, prefixBodies, saveBody, claimBody,
    stageBodies: [d.bodies[0].content, d.bodies[1].content, d.bodies[2].content], resultBodies: [d.bodies[3].content, d.bodies[4].content], afterGraph });
}
