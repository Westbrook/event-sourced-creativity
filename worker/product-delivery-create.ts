import type { PilotUser } from "./pilot-policy.ts";
import { productDeliveryAuthority as createAuthority } from "./product-delivery-authority.ts";
import { appendEvents, makeEvent, uuidV7, type WorkerEnv } from "./runtime.ts";
import { publicEventPayload } from "./event-privacy.ts";
import { deliveryCreateAcknowledgmentDigest, deliveryCreateDigest, deliveryCreateIntentDigest, deliveryCreateRequestId,
  readDeliveryCreateReceipt, type DeliveryCreateDecision, type DeliveryCreateIntent } from "../src/platform/delivery-create-receipt.ts";

const stream = "platform:product-delivery";
const headers = { "cache-control": "private, no-store" };
const failure = (error: string, status = 409) => Response.json({ error }, { status, headers });
type Owner = { user_id: string; display_name: string };
type OriginalRow = Record<string, unknown> & { client_event_id: string | null; private_json: string | null };

/** A receipt with a missing/redacted original is not an absent request and must never create again. */
async function originalCreate(env: WorkerEnv, authority: ReturnType<typeof createAuthority>, key: string,
  expected: { requestId: string; actorUserId: string; requestDigest: string; intent: DeliveryCreateIntent }) {
  const row = await env.DB.prepare(`SELECT receipt.client_event_id,receipt.event_id AS receipt_event_id,receipt.sequence AS receipt_sequence,
      event.event_id,event.stream_id,event.sequence,event.type,event.actor,event.client_id,event.correlation_id,event.payload,
      secret.private_json,secret.owner_id,secret.redacted_at,
      EXISTS(SELECT 1 FROM events orphan WHERE orphan.stream_id=? AND orphan.correlation_id=?) AS original_event_exists
    FROM(SELECT 1 WHERE ${authority.sql}) admitted
    LEFT JOIN event_client_receipts receipt ON receipt.stream_id=? AND receipt.client_event_id=?
    LEFT JOIN events event ON event.event_id=receipt.event_id
    LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id`)
    .bind(stream, key, ...authority.bindings, stream, key).first<OriginalRow>();
  if (!row) return { response: failure("access_denied", 403), absent: false };
  const unavailable = () => ({ response: failure("delivery_create_receipt_unavailable"), absent: false });
  if (row.client_event_id === null) return row.original_event_exists ? unavailable() : { response: null, absent: true };
  if (row.stream_id !== stream || row.type !== "ProductDeliveryDecisionCreated" || row.actor !== "user"
    || row.client_id !== "product-delivery-create:v1" || row.correlation_id !== key || row.owner_id !== stream
    || row.redacted_at !== null || typeof row.private_json !== "string" || typeof row.payload !== "string"
    || row.receipt_event_id !== row.event_id || row.receipt_sequence !== row.sequence) return unavailable();
  let privateBody: Record<string, unknown>, publicBody: Record<string, unknown>;
  try { privateBody = JSON.parse(row.private_json); publicBody = JSON.parse(row.payload); }
  catch { return unavailable(); }
  if (!privateBody || Array.isArray(privateBody) || !publicBody || Array.isArray(publicBody)
    || publicBody._private_ref !== row.event_id || privateBody.actor_user_id !== expected.actorUserId
    || privateBody.request_id !== expected.requestId || privateBody.request_digest !== publicBody.request_digest
    || privateBody.content_sha256 !== publicBody.content_sha256
    || JSON.stringify(publicEventPayload(String(row.event_id), privateBody, true).payload) !== row.payload) return unavailable();
  if (publicBody.request_digest !== expected.requestDigest) return { response: failure("delivery_create_intent_conflict"), absent: false };
  if (JSON.stringify(privateBody.create_request) !== JSON.stringify(expected.intent)) return unavailable();
  const decoded = await readDeliveryCreateReceipt({ decision: privateBody.create_acknowledgment, receipt: {
    version: 1, requestId: privateBody.request_id, actorUserId: privateBody.actor_user_id, requestDigest: privateBody.request_digest,
    decisionId: privateBody.decision_id, eventId: row.event_id, sequence: row.sequence, acknowledgmentDigest: privateBody.content_sha256,
  } }, expected);
  if (!decoded || privateBody.decision_id !== decoded.decision.decisionId
    || privateBody.owner_user_id !== decoded.decision.ownerUserId || privateBody.audience !== decoded.decision.audience
    || privateBody.status !== decoded.decision.status || privateBody.dependency_count !== decoded.decision.dependencyIds.length) return unavailable();
  // Digest verification awaited: re-prove the exact retained bytes and live admission now.
  const current = await env.DB.prepare(`SELECT 1 AS current FROM event_client_receipts receipt
    JOIN events event ON event.event_id=receipt.event_id
    JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    WHERE receipt.stream_id=? AND receipt.client_event_id=? AND receipt.event_id=? AND receipt.sequence=?
      AND event.stream_id=? AND event.sequence=receipt.sequence AND event.type='ProductDeliveryDecisionCreated'
      AND event.actor='user' AND event.client_id='product-delivery-create:v1' AND event.correlation_id=? AND event.payload=?
      AND secret.owner_id=? AND secret.redacted_at IS NULL AND secret.private_json=? AND ${authority.sql}`)
    .bind(stream, key, row.event_id as string, Number(row.sequence), stream, key, row.payload, stream, row.private_json, ...authority.bindings).first();
  if (!current) return { response: failure("delivery_create_receipt_unavailable"), absent: false };
  return { response: Response.json(decoded, { status: 201, headers }), absent: false };
}

/** Optional receipt protocol for one explicit create. Legacy POST and all PATCH policy stay separate. */
export async function createDeliveryWithReceipt(request: Request, env: WorkerEnv, actor: PilotUser, requestId: unknown,
  intent: DeliveryCreateIntent, prepare: () => Promise<Owner | Response>) {
  if (!deliveryCreateRequestId(requestId)) return Response.json({ error: "invalid_delivery_create_request", createDisposition: "rejected_before_write" }, { status: 400, headers });
  const authority = createAuthority(request, env, actor), requestDigest = await deliveryCreateIntentDigest(intent);
  const key = `product-delivery:create:v1:${await deliveryCreateDigest(actor.userId)}:${requestId}`;
  const expected = { requestId, actorUserId: actor.userId, requestDigest, intent };
  const existing = await originalCreate(env, authority, key, expected);
  if (!existing.absent) return existing.response!;
  const owner = await prepare();
  if (owner instanceof Response) {
    const body = await owner.json() as Record<string, unknown>;
    return Response.json({ ...body, createDisposition: "rejected_before_write" }, { status: owner.status, headers });
  }
  const decisionId = uuidV7(), now = new Date().toISOString();
  const decision: DeliveryCreateDecision = { decisionId, ...intent, owner: owner.display_name, createdAt: now, updatedAt: now };
  const acknowledgmentDigest = await deliveryCreateAcknowledgmentDigest(decision);
  const event = makeEvent(stream, 0, "user", "product-delivery-create:v1", key, "ProductDeliveryDecisionCreated", {
    decision_id: decisionId, actor_user_id: actor.userId, owner_user_id: owner.user_id, audience: intent.audience,
    status: intent.status, dependency_count: intent.dependencyIds.length, request_id: requestId, request_digest: requestDigest,
    content_sha256: acknowledgmentDigest, create_request: intent, create_acknowledgment: decision,
  });
  const privateJson = JSON.stringify(event.payload), dependencies = JSON.stringify(intent.dependencyIds);
  try {
    await appendEvents(env, [event], { retries: 1, prepareSidecars: ([assigned]) => [
      env.DB.prepare(`INSERT INTO delivery_decisions
        (decision_id,title,audience,status,owner_user_id,owner_display_name,evidence,dependency_ids_json,created_by_user_id,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND sequence=?)`)
        .bind(decisionId, intent.title, intent.audience, intent.status, owner.user_id, owner.display_name, intent.evidence,
          dependencies, actor.userId, now, now, assigned.eventId, stream, assigned.sequence),
      // A failed proof or unique-key collision aborts this entire existing D1 transaction.
      env.DB.prepare(`INSERT INTO event_client_receipts(stream_id,client_event_id,event_id,sequence,created_at)
        VALUES(?,?,CASE WHEN ${authority.sql}
          AND EXISTS(SELECT 1 FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
            WHERE event.event_id=? AND event.stream_id=? AND event.sequence=? AND event.type='ProductDeliveryDecisionCreated'
              AND event.actor='user' AND event.client_id='product-delivery-create:v1' AND event.correlation_id=?
              AND json_extract(event.payload,'$._private_ref')=event.event_id AND secret.owner_id=?
              AND secret.redacted_at IS NULL AND secret.private_json=?)
          AND NOT EXISTS(SELECT 1 FROM events earlier WHERE earlier.stream_id=? AND earlier.correlation_id=? AND earlier.event_id!=?)
          AND EXISTS(SELECT 1 FROM delivery_decisions decision WHERE decision.decision_id=? AND decision.title=? AND decision.audience=?
            AND decision.status=? AND decision.owner_user_id=? AND decision.owner_display_name=? AND decision.evidence=?
            AND decision.dependency_ids_json=? AND decision.created_by_user_id=? AND decision.created_at=? AND decision.updated_at=?)
          AND EXISTS(SELECT 1 FROM users owner WHERE owner.user_id=? AND owner.display_name=? AND (owner.role='admin' OR EXISTS(
            SELECT 1 FROM capability_grants grant_row WHERE grant_row.user_id=owner.user_id AND grant_row.capability='product.delivery.manage'
              AND grant_row.scope_type='platform' AND grant_row.status='active' AND grant_row.revoked_at IS NULL
              AND (grant_row.expires_at IS NULL OR grant_row.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))))
          AND NOT EXISTS(SELECT 1 FROM json_each(?) expected_dependency WHERE NOT EXISTS(
            SELECT 1 FROM delivery_decisions dependency WHERE dependency.decision_id=expected_dependency.value))
          THEN ? ELSE NULL END,?,?)`)
        .bind(stream, key, ...authority.bindings, assigned.eventId, stream, assigned.sequence, key, stream, privateJson, stream, key, assigned.eventId,
          decisionId, intent.title, intent.audience, intent.status, owner.user_id, owner.display_name, intent.evidence,
          dependencies, actor.userId, now, now, owner.user_id, owner.display_name, dependencies, assigned.eventId, assigned.sequence, now),
    ] });
  } catch { /* Commit acknowledgment may be lost; only the original canonical receipt can settle it. */ }
  const settled = await originalCreate(env, authority, key, expected);
  return settled.absent ? failure("delivery_create_unknown", 503) : settled.response!;
}
