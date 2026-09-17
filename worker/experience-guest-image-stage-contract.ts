import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import type { OutputConfirmedPlan, OutputPreflight, OutputNativeTargetPreflight } from "../src/model/output-delivery-contract.ts";
import { guestFail } from "./experience-guest-session.ts";
import { matchSponsorImageTemplate } from "./experience-sponsor-campaign.ts";
import type { SponsorRecipe } from "./experience-sponsor-policy.ts";
import type { EventRow } from "./event-write-primitives.ts";
import { outputNativeImageDisclosure, providerInputInstructions } from "./output-image-slides-preflight.ts";

/** Ordinary original-stage values, never live authority or a historical proof.
 * Each helper accepts only the subset it uses, so erased history need not invent
 * a target, plan, private body or captured live clock to check surviving rows. */
export type GuestImageStageContract = Readonly<{
  scopeKey: string; actorUserId: string; projectId: string; documentId: string; streamId: string;
  sourceHead: number; sourceEventIds: readonly string[]; savedEventId: string; savedCreatedAt: string;
  campaignId: string; sessionDigest: string; sourceDigest: string; requirementsDigest: string;
  compiledPlan: OutputConfirmedPlan["plan"]; target: OutputConfirmedPlan["plan"]["targets"][number];
  targetId: string; contractDigest: string; confirmationOptions: OutputConfirmedPlan["confirmationOptions"];
  releaseRevision: number; releaseHash: string; approvedTemplate: unknown;
  driver: Readonly<{ driverId: string; intentKey: string; commandJson: string; commandDigest: string }>;
  confirmationTextBytes: number;
}>;
type Identity = Pick<GuestImageStageContract, "actorUserId" | "projectId" | "documentId">;
type Scope = Pick<GuestImageStageContract, "scopeKey" | "actorUserId">;
type Digests = Pick<GuestImageStageContract, "sourceDigest" | "requirementsDigest">;
const fail = (part: string): never => guestFail(`image_output_${part}`);
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const iso = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);

export function guestImageStageNativePayload(identity: Identity, envelope: Record<string, unknown>, values: Record<string, unknown>) {
  return { ...values, output_command_envelope: structuredClone(envelope), project_id: identity.projectId,
    document_id: identity.documentId, actor_user_id: identity.actorUserId };
}
export function guestImageStageConfirmedPlan(data: Digests & Pick<GuestImageStageContract,
  "documentId" | "compiledPlan" | "targetId" | "contractDigest" | "confirmationOptions">, revisionId: string, recordedAt: string): OutputConfirmedPlan {
  return { id: data.documentId, revisionId, revision: 1, confirmedAt: recordedAt,
    requirementsDigest: data.requirementsDigest, sourceDigest: data.sourceDigest, plan: data.compiledPlan,
    targetContractDigests: { [data.targetId]: data.contractDigest }, confirmationOptions: data.confirmationOptions };
}
/** The caller supplies its actual ceiling. Live callers retain their stronger
 * request-local ceiling; historical callers can prove only persisted deadlines. */
export function guestImageStageEvent(data: Pick<GuestImageStageContract,
  "actorUserId" | "streamId" | "sourceHead" | "sourceEventIds" | "savedEventId" | "savedCreatedAt">,
  raw: EventRow, kind: "confirm" | "preflight", payload: Record<string, unknown>,
  expected: Readonly<{ commandKey: string; expiresAtMs: number; confirmEvent?: Pick<EventRow, "eventId" | "recordedAt"> }>) {
  const offset = kind === "confirm" ? 2 : 3;
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["eventId", "streamId", "sequence", "occurredAt", "recordedAt", "actor", "clientId", "correlationId", "causationId", "compensatesEventId", "schemaVersion", "type", "payload"])
    || !uuid(raw.eventId) || [...data.sourceEventIds, data.savedEventId].includes(raw.eventId)
    || kind === "preflight" && (!expected.confirmEvent || raw.eventId === expected.confirmEvent.eventId)
    || raw.streamId !== data.streamId || raw.sequence !== data.sourceHead + offset
    || raw.actor !== data.actorUserId || raw.clientId !== "server:guest-output" || raw.correlationId !== expected.commandKey
    || raw.causationId !== null || raw.compensatesEventId !== null || raw.schemaVersion !== 1
    || raw.type !== (kind === "confirm" ? "OutputPlanConfirmed" : "OutputPlanPreflighted")
    || !iso(raw.recordedAt) || raw.occurredAt !== raw.recordedAt || Date.parse(raw.recordedAt) >= expected.expiresAtMs
    || raw.recordedAt < (kind === "confirm" ? data.savedCreatedAt : expected.confirmEvent!.recordedAt)
    || JSON.stringify(raw.payload) !== JSON.stringify(payload) || bytes(JSON.stringify(payload)) > 65536) return fail("successor_invalid");
  return freeze(structuredClone(raw));
}
export function guestImageStageCommandRow(data: Scope, event: Pick<EventRow, "correlationId" | "eventId" | "recordedAt">,
  action: "confirm" | "preflight", requestDigest: string) {
  return { scope_key: data.scopeKey, actor_user_id: data.actorUserId, command_key: event.correlationId,
    request_digest: requestDigest, action, event_id: event.eventId, created_at: event.recordedAt };
}
export function guestImageStagePlanRows(data: Scope & Identity & Digests & Pick<GuestImageStageContract, "sourceHead" | "targetId" | "contractDigest">,
  confirmed: Pick<OutputConfirmedPlan, "revisionId" | "id">, event: Pick<EventRow, "eventId" | "recordedAt">) {
  return {
    plan: { scope_key: data.scopeKey, scope_kind: "personal", owner_user_id: data.actorUserId,
      project_id: data.projectId, document_id: data.documentId, organization_id: null, project_access_id: null,
      plan_revision_id: confirmed.revisionId, plan_id: confirmed.id, revision: 1, confirmed_event_id: event.eventId,
      requirements_digest: data.requirementsDigest, source_digest: data.sourceDigest, resolver_version: "output-plan-v1",
      source_head: data.sourceHead + 1, target_count: 1, created_at: event.recordedAt },
    target: { scope_key: data.scopeKey, plan_revision_id: confirmed.revisionId, target_id: data.targetId,
      target_contract_digest: data.contractDigest, media_kind: "image", required: 1, selected: 1, ordinal: 0 },
  };
}
export function guestImageStageIntentRow(data: Digests & Pick<GuestImageStageContract,
  "actorUserId" | "campaignId" | "sessionDigest" | "documentId" | "driver" | "confirmationTextBytes">, createdAtMs: number) {
  return { driver_id: data.driver.driverId, campaign_id: data.campaignId, actor_user_id: data.actorUserId,
    session_digest: data.sessionDigest, intent_key: data.driver.intentKey, document_id: data.documentId,
    command_json: data.driver.commandJson, command_digest: data.driver.commandDigest, source_digest: data.sourceDigest,
    requirements_digest: data.requirementsDigest, source_text_bytes: data.confirmationTextBytes, created_at_ms: createdAtMs };
}
export function guestImageStageQuoteRow(data: Scope, quote: Pick<OutputPreflight, "id" | "planRevisionId" | "termsDigest" | "expiresAt" | "createdAt">,
  event: Pick<EventRow, "eventId">) {
  return { scope_key: data.scopeKey, preflight_id: quote.id, plan_revision_id: quote.planRevisionId,
    actor_user_id: data.actorUserId, terms_digest: quote.termsDigest, event_id: event.eventId,
    expires_at: quote.expiresAt, created_at: quote.createdAt };
}
/** Shape and original fixed-time associations only. The caller must separately
 * verify termsDigest and the native recipe; this does not authorize the quote. */
export function guestImageStageQuoteShape(data: Digests & Pick<GuestImageStageContract, "targetId">, value: unknown,
  expected: Readonly<{ revisionId: string; recordedAt: string; expiresAtMs: number }>): OutputPreflight {
  if (jsonIssues(value).length || !record(value) || !exactKeys(value, ["id", "planRevisionId", "sourceDigest", "requirementsDigest", "targets", "operationAttempts", "maximumMicrousd", "maximumCalls", "expiresAt", "createdAt", "termsDigest"])
    || !uuid(value.id) || value.planRevisionId !== expected.revisionId || value.sourceDigest !== data.sourceDigest || value.requirementsDigest !== data.requirementsDigest
    || !Array.isArray(value.targets) || value.targets.length !== 1 || !record(value.targets[0]) || value.targets[0].targetId !== data.targetId
    || canonicalJson(value.operationAttempts) !== canonicalJson({ [data.targetId]: { ordinal: 0, previousSlotId: null } })
    || value.maximumMicrousd !== value.targets[0].maximumMicrousd || value.maximumCalls !== value.targets[0].maximumCalls
    || value.createdAt !== expected.recordedAt || !iso(value.expiresAt) || !iso(value.createdAt) || value.expiresAt <= value.createdAt
    || Date.parse(value.expiresAt) > Math.min(expected.expiresAtMs, Date.parse(value.createdAt) + 15 * 60_000)) return fail("quote_invalid");
  return value as unknown as OutputPreflight;
}
/** Validate actual retained native offer and transport, with no provider call,
 * current configuration read or substitution of policy for offer evidence. */
export async function guestImageStageQuoteRecipe(data: Pick<GuestImageStageContract, "target" | "releaseRevision" | "releaseHash" | "approvedTemplate">,
  offered: OutputNativeTargetPreflight, transport: unknown): Promise<SponsorRecipe> {
  const disclosure = outputNativeImageDisclosure();
  if (jsonIssues(offered).length || jsonIssues(transport).length || bytes(canonicalJson({ offered, transport })) > 49152
    || offered.targetId !== data.target.id || offered.available !== true || offered.provider !== "openai" || typeof offered.model !== "string"
    || offered.reason !== disclosure.reason || offered.transferDescription !== disclosure.transferDescription
    || !record(offered.reasonValues) || canonicalJson(offered.reasonValues) !== canonicalJson(disclosure.reasonValues)
    || ![offered.maximumCalls, offered.maximumMicrousd, offered.maximumTokens].every(value => Number.isSafeInteger(value) && value > 0)
    || !record(offered.settings.payload) || offered.settings.payload.outputTargetInstructions !== providerInputInstructions({ target: data.target })
    || !record(offered.settings.imageRender) || !record(offered.settings.imageRender.format) || !record(offered.settings.imageRender.format.dimensions)
    || !Array.isArray(offered.settings.calls) || offered.settings.calls.length !== offered.maximumCalls
    || offered.settings.calls.some(call => !record(call) || typeof call.stage !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(call.stage)
      || !Number.isSafeInteger(call.maximumMicrousd) || Number(call.maximumMicrousd) <= 0)
    || new Set(offered.settings.calls.map(call => record(call) ? call.stage : null)).size !== offered.maximumCalls) return fail("quote_invalid");
  const dimensions = offered.settings.imageRender.format.dimensions;
  const recipe: SponsorRecipe = { appId: "image", recipeVersion: `image@${data.releaseRevision}`,
    releaseDigest: data.releaseHash, outputKind: "image", provider: offered.provider, model: offered.model,
    routeDigest: await digest(offered), settingsDigest: await digest(offered.settings), outputCount: 1, durationMs: 0,
    width: Number(dimensions.width), height: Number(dimensions.height), calls: { parsing: 0, planning: 1, render: 1, repair: 0 },
    maximumTokens: offered.maximumTokens, maximumMicrousd: offered.maximumMicrousd };
  if (!matchSponsorImageTemplate(data.approvedTemplate, { recipe, offered, transport })) return fail("quote_template_mismatch");
  return recipe;
}
