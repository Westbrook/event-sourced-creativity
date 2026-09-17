import { freeze } from "../src/experiences/compiler.ts";
import { denseGuestImageAcknowledgement } from "./experience-guest-image-confirmation.ts";
import { current, eventWitness, iso, together, type Proof } from "./experience-guest-image-history.ts";
import { collectDueGuestImageStageHistory } from "./experience-guest-image-stage-inventory.ts";
import { outputAssertionStatements } from "./output-command-core.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail = (): never => { throw new Error("guest_image_stage_retirement_unavailable"); };
export type GuestImageStageRetirementReceipt = Readonly<{
  status: "retired"; scope: "unclaimed-original-image-stage-private-bodies";
  sessionId: string; documentId: string; stageHead: number;
  stageState: "confirmed" | "preflight-claimed-unknown" | "quoted";
  tails: readonly Readonly<{ eventId: string; redactedAt: string; replayed: boolean }>[]; replayed: boolean;
}>;

/** Dormant original-tail cleanup only. It never creates a quote, acquires a
 * lease, changes a resource receipt, claims custody, or erases source bodies. */
export async function retireExpiredUnclaimedGuestImageStages(env: WorkerEnv, input: { sessionId: string }): Promise<GuestImageStageRetirementReceipt> {
  const data = await collectDueGuestImageStageHistory(env, input), { ctx, tails } = data;
  current(ctx);
  // Exact original native association survives; only these two private fields
  // may change. A tombstone cannot certify the erased historical bytes.
  const originals = JSON.stringify(tails.map(tail => tail.observed));
  const afterTails: Proof = { sql: `(SELECT COUNT(*) FROM json_each(?) expected
    JOIN events e ON e.event_id=json_extract(expected.value,'$.event_id')
    JOIN event_private_payloads body ON body.private_event_id=e.event_id
    WHERE json_set(${eventWitness},'$.private_json',json_extract(expected.value,'$.private_json'),
      '$.redacted_at',json_extract(expected.value,'$.redacted_at'))=expected.value
      AND body.private_json='' AND typeof(body.redacted_at)='text' AND length(body.redacted_at)=24
      AND body.redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ',body.redacted_at)
      AND body.redacted_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND (json_extract(expected.value,'$.redacted_at') IS NULL
        AND body.redacted_at>=? OR body.redacted_at=json_extract(expected.value,'$.redacted_at')))=?`,
    bindings: [originals, data.expiresAt, tails.length] };
  const after = together([data.commonProof, afterTails]);
  let uncertain = false;
  const pending = tails.filter(tail => tail.row.redacted_at === null);
  if (pending.length) {
    const statements = [...outputAssertionStatements(env, data.proof)], indexes: number[] = [];
    for (const tail of pending) {
      indexes.push(statements.length);
      statements.push(ctx.db.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE private_event_id=? AND redacted_at IS NULL").bind(tail.eventId));
    }
    statements.push(...outputAssertionStatements(env, after)); current(ctx);
    try { uncertain = !denseGuestImageAcknowledgement(await ctx.db.batch(statements), statements.length, indexes); }
    catch { uncertain = true; }
    current(ctx);
  }
  // A lost acknowledgement gets one exact read of the original postcondition;
  // no second mutation and no reconstructed construction permission.
  const result = await ctx.db.prepare(`SELECT body.private_event_id AS eventId,body.redacted_at AS redactedAt
    FROM json_each(?) expected JOIN event_private_payloads body ON body.private_event_id=json_extract(expected.value,'$.event_id')
    WHERE (${after.sql}) ORDER BY CAST(expected.key AS INTEGER)`)
    .bind(originals, ...after.bindings).all<{ eventId: string; redactedAt: string }>();
  current(ctx);
  if (result.success !== true || !Array.isArray(result.results) || result.results.length !== tails.length) return fail();
  const retired = tails.map((tail, index) => {
    if (!Object.hasOwn(result.results, index)) return fail();
    const row = result.results[index];
    if (!row || row.eventId !== tail.eventId || !iso(row.redactedAt)) return fail();
    return { eventId: tail.eventId, redactedAt: row.redactedAt, replayed: tail.row.redacted_at !== null || uncertain };
  });
  current(ctx);
  return freeze({ status: "retired", scope: "unclaimed-original-image-stage-private-bodies", sessionId: data.sessionId,
    documentId: data.documentId, stageHead: data.stageHead, stageState: data.stageState, tails: retired,
    replayed: uncertain || pending.length !== tails.length });
}
