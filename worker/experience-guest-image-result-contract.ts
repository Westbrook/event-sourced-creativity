import { canonicalJson, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";

/** These values describe retained history. Parsing them never creates custody,
 * execution, purchase, media-read or claim authority. */
export type GuestImageResultContent = Readonly<{
  contentId: string; kind: "provider-output" | "prompt"; contentDigest: string;
  bytes: number; createdAt: string; expiresAt: string;
}>;
export type GuestImageResultObject = Readonly<{
  storageKey: string; contentSha256: string; mimeType: "image/png"; width: number; height: number;
  publicationEventId: string; recordedDescriptorOnly: true;
}>;
export type GuestImageResultManifest = Readonly<{
  version: 1; kind: "original-image-completed-result";
  sessionId: string; guestSubject: string; projectId: string; documentId: string;
  sourceHead: number; sourceSaveHead: number; quoteHead: number; runHead: number; resultHead: number;
  expiresAt: string; draftHash: string; contentDigest: string; sourceEventIds: readonly string[];
  originalPayerUserId: string; generationId: string; completionEventId: string; usageEventId: string; completedAt: string;
  nativeIdentity: Readonly<{
    scopeKey: string; jobId: string; slotId: string; executionGrantId: string; issuerGrantId: string;
    consumptionId: string; planRevisionId: string; targetId: string; preflightId: string;
  }>;
  financialReceipt: Readonly<{
    period: string; tokenReservationId: string; costReservationId: string; usedTokens: number; usedMicrousd: number;
  }>;
  privateContents: readonly [GuestImageResultContent, GuestImageResultContent];
  object: GuestImageResultObject; nativeSnapshotDigest: string;
}>;

const fail = (): never => { throw new Error("guest_image_result_manifest_invalid"); };
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const iso = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isSafeInteger(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/u.test(value)
  && !/^forma-guest-(session|claim)-v1\./u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && value >= min && value <= max;
const manifestKeys = ["version", "kind", "sessionId", "guestSubject", "projectId", "documentId", "sourceHead", "sourceSaveHead", "quoteHead", "runHead", "resultHead",
  "expiresAt", "draftHash", "contentDigest", "sourceEventIds", "originalPayerUserId", "generationId", "completionEventId", "usageEventId", "completedAt",
  "nativeIdentity", "financialReceipt", "privateContents", "object", "nativeSnapshotDigest"] as const;
const nativeKeys = ["scopeKey", "jobId", "slotId", "executionGrantId", "issuerGrantId", "consumptionId", "planRevisionId", "targetId", "preflightId"] as const;
const contentKeys = ["contentId", "kind", "contentDigest", "bytes", "createdAt", "expiresAt"] as const;
const objectKeys = ["storageKey", "contentSha256", "mimeType", "width", "height", "publicationEventId", "recordedDescriptorOnly"] as const;
const nativeIdentity = (value: unknown): boolean => record(value) && exactKeys(value, nativeKeys) && Object.values(value).every(id);

export function readGuestImageResultContent(value: unknown): GuestImageResultContent {
  if (jsonIssues(value).length || !record(value) || !exactKeys(value, contentKeys)
    || !id(value.contentId) || !["provider-output", "prompt"].includes(String(value.kind)) || !digest(value.contentDigest)
    || !integer(value.bytes, 1, 65536) || !iso(value.createdAt) || !iso(value.expiresAt) || value.createdAt >= value.expiresAt) return fail();
  return freeze(structuredClone(value)) as GuestImageResultContent;
}

export function readGuestImageResultObject(value: unknown): GuestImageResultObject {
  if (jsonIssues(value).length || !record(value) || !exactKeys(value, objectKeys)
    || typeof value.storageKey !== "string" || bytes(value.storageKey) > 1024 || !/^u-[a-f0-9]+\/generated\/[a-f0-9-]{36}\.png$/u.test(value.storageKey)
    || !hash(value.contentSha256) || value.mimeType !== "image/png" || !integer(value.width, 1, 8192) || !integer(value.height, 1, 8192)
    || !uuid(value.publicationEventId) || value.recordedDescriptorOnly !== true) return fail();
  return freeze(structuredClone(value)) as GuestImageResultObject;
}

/** Closed JSON plus native value associations. The returned value is not the
 * opaque inventory and cannot be supplied as proof of a database read. */
export function readGuestImageResultManifest(value: unknown): GuestImageResultManifest {
  if (jsonIssues(value).length || !record(value) || !exactKeys(value, manifestKeys) || bytes(canonicalJson(value)) > 16384
    || value.version !== 1 || value.kind !== "original-image-completed-result"
    || !id(value.sessionId) || typeof value.guestSubject !== "string" || !value.guestSubject.startsWith("guest:") || !uuid(value.guestSubject.slice(6))
    || !id(value.projectId) || !id(value.documentId) || !id(value.originalPayerUserId) || value.originalPayerUserId.startsWith("guest:")
    || !integer(value.sourceHead, 3, 16) || value.sourceSaveHead !== value.sourceHead + 1 || value.quoteHead !== value.sourceHead + 3
    || value.runHead !== value.sourceHead + 6 || value.resultHead !== value.sourceHead + 14
    || !iso(value.expiresAt) || !iso(value.completedAt) || value.completedAt >= value.expiresAt
    || !digest(value.draftHash) || !digest(value.contentDigest) || !digest(value.nativeSnapshotDigest)
    || !uuid(value.generationId) || !uuid(value.completionEventId) || !uuid(value.usageEventId) || value.completionEventId === value.usageEventId
    || !Array.isArray(value.sourceEventIds) || value.sourceEventIds.length !== value.sourceHead || value.sourceEventIds.some(eventId => !uuid(eventId))
    || new Set([...value.sourceEventIds, value.completionEventId, value.usageEventId]).size !== value.sourceHead + 2
    || !nativeIdentity(value.nativeIdentity)
    || !record(value.financialReceipt) || !exactKeys(value.financialReceipt, ["period", "tokenReservationId", "costReservationId", "usedTokens", "usedMicrousd"])
    || typeof value.financialReceipt.period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(value.financialReceipt.period)
    || !id(value.financialReceipt.tokenReservationId) || !id(value.financialReceipt.costReservationId)
    || value.financialReceipt.tokenReservationId === value.financialReceipt.costReservationId
    || !integer(value.financialReceipt.usedTokens, 0, Number.MAX_SAFE_INTEGER) || !integer(value.financialReceipt.usedMicrousd, 0, Number.MAX_SAFE_INTEGER)
    || !Array.isArray(value.privateContents) || value.privateContents.length !== 2) return fail();
  const output = readGuestImageResultContent(value.privateContents[0]), prompt = readGuestImageResultContent(value.privateContents[1]);
  const object = readGuestImageResultObject(value.object);
  if (output.kind !== "provider-output" || prompt.kind !== "prompt" || output.contentId === prompt.contentId
    || output.createdAt > value.completedAt || prompt.createdAt > value.completedAt
    || value.expiresAt > output.expiresAt || value.expiresAt > prompt.expiresAt
    || object.storageKey !== `${ownerMediaNamespace(value.guestSubject)}/generated/${value.generationId}.png`
    || object.publicationEventId !== value.completionEventId) return fail();
  return freeze(structuredClone(value)) as GuestImageResultManifest;
}
