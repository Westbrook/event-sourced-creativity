/** Original milestone-create intent and acknowledgment; never a mutable decision revision. */
export type DeliveryCreateIntent = {
  title: string; audience: string; status: string; ownerUserId: string; evidence: string; dependencyIds: string[];
};
export type DeliveryCreateDecision = DeliveryCreateIntent & {
  decisionId: string; owner: string; createdAt: string; updatedAt: string;
};
export type DeliveryCreateReceipt = {
  version: 1; requestId: string; actorUserId: string; requestDigest: string;
  decisionId: string; eventId: string; sequence: number; acknowledgmentDigest: string;
};
export const deliveryCreateRequestId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const digestPattern = /^[0-9a-f]{64}$/;

/** Fixed ordered fields avoid object-key ordering as an authority or identity decision. */
export const deliveryCreateIntentValue = (value: DeliveryCreateIntent) =>
  [value.title, value.audience, value.status, value.ownerUserId, value.evidence, value.dependencyIds];
const acknowledgmentValue = (value: DeliveryCreateDecision) =>
  [value.decisionId, ...deliveryCreateIntentValue(value), value.owner, value.createdAt, value.updatedAt];
export async function deliveryCreateDigest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
export const deliveryCreateIntentDigest = (value: DeliveryCreateIntent) => deliveryCreateDigest(deliveryCreateIntentValue(value));
export const deliveryCreateAcknowledgmentDigest = (value: DeliveryCreateDecision) => deliveryCreateDigest(acknowledgmentValue(value));

/** Strict original receipt decoding. Callers must recheck ownership after these digest awaits. */
export async function readDeliveryCreateReceipt(value: unknown, expected: {
  requestId: string; actorUserId: string; requestDigest: string; intent: DeliveryCreateIntent;
}): Promise<{ decision: DeliveryCreateDecision; receipt: DeliveryCreateReceipt } | null> {
  const body = record(value), raw = record(body?.decision), receipt = record(body?.receipt);
  if (!raw || !receipt || receipt.version !== 1 || receipt.requestId !== expected.requestId
    || receipt.actorUserId !== expected.actorUserId || receipt.requestDigest !== expected.requestDigest
    || !deliveryCreateRequestId(raw.decisionId) || receipt.decisionId !== raw.decisionId
    || !deliveryCreateRequestId(receipt.eventId) || !Number.isSafeInteger(receipt.sequence) || Number(receipt.sequence) < 1
    || typeof receipt.acknowledgmentDigest !== "string" || !digestPattern.test(receipt.acknowledgmentDigest)
    || [raw.title, raw.audience, raw.status, raw.ownerUserId, raw.evidence].some((field) => typeof field !== "string")
    || typeof raw.owner !== "string" || !raw.owner.trim() || typeof raw.createdAt !== "string"
    || !Number.isFinite(Date.parse(raw.createdAt)) || raw.updatedAt !== raw.createdAt
    || !Array.isArray(raw.dependencyIds) || raw.dependencyIds.some((id) => typeof id !== "string")) return null;
  const decision: DeliveryCreateDecision = {
    decisionId: raw.decisionId, title: String(raw.title), audience: String(raw.audience), status: String(raw.status),
    ownerUserId: String(raw.ownerUserId), evidence: String(raw.evidence), dependencyIds: [...raw.dependencyIds] as string[],
    owner: raw.owner, createdAt: raw.createdAt, updatedAt: raw.createdAt,
  };
  if (JSON.stringify(deliveryCreateIntentValue(decision)) !== JSON.stringify(deliveryCreateIntentValue(expected.intent))
    || await deliveryCreateAcknowledgmentDigest(decision) !== receipt.acknowledgmentDigest) return null;
  return { decision, receipt: { version: 1, requestId: expected.requestId, actorUserId: expected.actorUserId,
    requestDigest: expected.requestDigest, decisionId: decision.decisionId, eventId: receipt.eventId,
    sequence: Number(receipt.sequence), acknowledgmentDigest: receipt.acknowledgmentDigest } };
}
