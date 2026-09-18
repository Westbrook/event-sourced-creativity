import { canonicalConsent } from "./consequential-consent.ts";
import { captureLegacyConversationOriginals, replayLegacyConversationOriginals,
  type LegacyConversationOriginalCapture, type LegacyConversationOriginalInterval,
  type LegacyConversationOriginalReceipt } from "./events-api.ts";
import { liveMemoryAuthority, type LiveMemoryEnrollment } from "./memory-live-authority.ts";
import { appendStructuredConversationLedger, liveMemoryEnabled, prepareNativeMemorySelection,
  readStructuredConversationLedger, replayNativeMemorySelection, structuredConversationLedgerSchema,
  type StructuredConversationOriginal } from "./memory-live-store.ts";
import type { WorkerEnv } from "./runtime.ts";

// A native S3 frame admits at most six complete pairs. Two frames leave space
// for the ledger's independent authority/history reads in its 32-read budget.
export const COMPLETED_CONVERSATION_CAPTURE_LIMIT = 12;
const FRAME_LIMIT = 2;
type Pair = { user_event_id: string; user_sequence: number; answer_event_id: string; answer_sequence: number; turn_id: string };
export type CompletedConversationCaptureResult = Readonly<{
  status: "disabled" | "schema-unavailable" | "no-source" | "unchanged" | "published" | "capacity" | "unavailable";
  /** Metadata only; no source text, IDs or inferred claims leave this worker. */
  originalCount?: number; revision?: number;
}>;
const reference = (row: LegacyConversationOriginalReceipt["originals"][number]): StructuredConversationOriginal => ({
  eventId: row.eventId, sequence: row.sequence, turnId: row.turnId, role: row.role, contentRef: row.contentRef, contentHash: row.contentHash,
});
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240 && value.isWellFormed();
const sequence = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const resultRows = <T>(value: D1Result<T>): T[] | null => value?.success === true
  && !Object.hasOwn(value, "error") && Array.isArray(value.results) ? value.results : null;

/** Scheduled, enrolled, reference-only capture of actual completed Chat Studio
 * pairs. S3 revalidates both original private bodies, envelope, actor, cause,
 * native custody and immutable retention. Candidate discovery is not proof.
 *
 * Ordinary assistant_turns and memory-derived answers are NOT supported source
 * contracts here. No labels, summaries, preference inference or paid calls are
 * manufactured. Existing declarations remain byte-for-byte unchanged.
 *
 * An uncertain append is never retried in this invocation. A later invocation
 * rereads native history and recognizes the exact committed references; it does
 * not reset a ledger, synthesize success, renew expiry or lose old dependencies.
 */
export async function publishCompletedConversationReferences(env: WorkerEnv, enrollment: LiveMemoryEnrollment,
  throughSequence?: number): Promise<CompletedConversationCaptureResult> {
  try {
    const db = env.DB, e = structuredClone(enrollment), key = canonicalConsent(enrollment);
    const settings = canonicalConsent([env.FORMA_MEMORY_ENABLED, env.FORMA_MEMORY_USER_IDS, env.FORMA_MEMORY_SCHEDULING_ENABLED]);
    const current = () => env.DB === db && canonicalConsent(enrollment) === key
      && canonicalConsent([env.FORMA_MEMORY_ENABLED, env.FORMA_MEMORY_USER_IDS, env.FORMA_MEMORY_SCHEDULING_ENABLED]) === settings;
    if (env.FORMA_MEMORY_SCHEDULING_ENABLED !== "true" || !liveMemoryEnabled(env, e.actor_user_id)
      || e.learn_enabled !== 1 || e.recall_enabled !== 1 || e.background_enabled !== 1) return { status: "disabled" };
    const schema = await structuredConversationLedgerSchema(env);
    if (!current()) return { status: "unavailable" };
    if (!schema.referenceCapture) return { status: "schema-unavailable" };
    const authority = await liveMemoryAuthority(env, e);
    if (!authority || !current()) return { status: "unavailable" };
    const headResult = resultRows(await db.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?")
      .bind(authority.binding.streamId).all<{ head: number }>());
    const head = headResult?.length === 1 ? headResult[0].head : null;
    if (!current() || head === null || !Number.isSafeInteger(head) || head < 0) return { status: "unavailable" };
    if (head === 0) return { status: "no-source" };
    const through = throughSequence ?? head;
    if (!Number.isSafeInteger(through) || through < 0 || through > head) return { status: "unavailable" };
    const prepared = { principal: authority.principal, binding: authority.binding, sourceHead: head };
    const selection = await prepareNativeMemorySelection(env, prepared);
    if (!selection || !current() || canonicalConsent(selection.enrollment) !== key) return { status: "unavailable" };
    // Identity-only discovery includes one overflow row. Do not truncate a large
    // or discontinuous history and then advertise the tail as complete capture.
    const pairs = resultRows(await db.prepare(`SELECT message.event_id AS user_event_id,message.sequence AS user_sequence,
      answer.event_id AS answer_event_id,answer.sequence AS answer_sequence,json_extract(answer.payload,'$.turn_id') AS turn_id
      FROM events answer JOIN events message ON message.event_id=answer.causation_id AND message.stream_id=answer.stream_id
        AND message.type='ChatMessageSent' AND message.correlation_id=answer.correlation_id
        AND json_extract(message.payload,'$.turn_id')=json_extract(answer.payload,'$.turn_id')
      WHERE answer.stream_id=? AND answer.type='AssistantReasoned' AND answer.actor='model:forma-chat' AND message.actor=?
        AND json_extract(answer.payload,'$.operation')='creative-chat' AND json_extract(answer.payload,'$.document_id')=?
        AND json_extract(answer.payload,'$._private_ref')=answer.event_id
        AND json_type(answer.payload,'$.memory_origin_version') IS NULL
        AND message.recorded_at>=? AND answer.recorded_at>=? AND answer.sequence<=?
      ORDER BY message.sequence,answer.sequence LIMIT 13`)
      .bind(authority.binding.streamId, e.organization_id===null?"user":`user:${e.actor_user_id}`,
        e.document_id, e.enrolled_at, e.enrolled_at, through).all<Pair>());
    if (!current() || !pairs || pairs.some(pair => !id(pair.user_event_id) || !id(pair.answer_event_id) || !id(pair.turn_id)
      || !sequence(pair.user_sequence) || !sequence(pair.answer_sequence) || pair.user_sequence >= pair.answer_sequence)) return { status: "unavailable" };
    if (pairs.length > COMPLETED_CONVERSATION_CAPTURE_LIMIT) return { status: "capacity" };
    if (!pairs.length) return { status: selection.mode === "structured" ? "unavailable" : "no-source" };
    if (new Set(pairs.map(pair => pair.turn_id)).size !== pairs.length
      || new Set(pairs.flatMap(pair => [pair.user_event_id, pair.answer_event_id])).size !== pairs.length * 2) return { status: "unavailable" };
    const boundaries = pairs.map((pair, index) => ({ afterSequence: pair.user_sequence - 1,
      previousThrough: index ? pairs[index - 1].answer_sequence : pair.user_sequence - 1 }));
    const gaps = resultRows(await db.prepare(`SELECT CAST(candidate.key AS INTEGER) AS ordinal,
      CASE WHEN EXISTS(SELECT 1 FROM events event WHERE event.stream_id=? AND event.type IN('ChatMessageSent','AssistantReasoned')
        AND event.sequence>json_extract(candidate.value,'$.previousThrough')
        AND event.sequence<=json_extract(candidate.value,'$.afterSequence')) THEN 1 ELSE 0 END AS separated
      FROM json_each(?) candidate ORDER BY CAST(candidate.key AS INTEGER) LIMIT 13`)
      .bind(authority.binding.streamId, JSON.stringify(boundaries)).all<{ ordinal: number; separated: number }>());
    if (!current() || !gaps || gaps.length !== pairs.length
      || gaps.some((row, index) => row.ordinal !== index || row.separated !== 0 && row.separated !== 1)) return { status: "unavailable" };
    const intervals: LegacyConversationOriginalInterval[] = [];
    let groupSize = 0;
    for (const [index, pair] of pairs.entries()) {
      if (!intervals.length || groupSize === 6 || gaps[index].separated === 1) {
        intervals.push({ afterSequence: pair.user_sequence - 1, throughSequence: pair.answer_sequence }); groupSize = 1;
      } else { intervals.at(-1)!.throughSequence = pair.answer_sequence; groupSize++; }
    }
    if (intervals.length > FRAME_LIMIT) return { status: "capacity" };
    const captures: LegacyConversationOriginalCapture[] = [], originals: StructuredConversationOriginal[] = [];
    for (const interval of intervals) {
      const capture = await captureLegacyConversationOriginals(env, prepared, interval);
      const receipt = capture && await replayLegacyConversationOriginals(env, prepared, capture);
      if (!current() || !capture || !receipt) return { status: "unavailable" };
      captures.push(capture); originals.push(...receipt.originals.map(reference));
    }
    if (originals.length !== pairs.length * 2 || pairs.some(pair => !originals.some(row => row.eventId === pair.user_event_id
      && row.sequence === pair.user_sequence && row.turnId === pair.turn_id && row.role === "user")
      || !originals.some(row => row.eventId === pair.answer_event_id && row.sequence === pair.answer_sequence
        && row.turnId === pair.turn_id && row.role === "assistant"))) return { status: "unavailable" };
    const expected = await readStructuredConversationLedger(env, e, prepared, captures);
    if (!current() || !expected || await replayNativeMemorySelection(env, selection) !== selection || !current()) return { status: "unavailable" };
    const retained = expected.ledger.originals;
    if (!retained.every(ref => originals.some(original => canonicalConsent(original) === canonicalConsent(ref)))) return { status: "unavailable" };
    if (retained.length === originals.length) return { status: "unchanged", originalCount: retained.length, revision: expected.revision };
    if (expected.revision >= 64) return { status: "capacity" };
    const proposed = { ...expected.ledger, originals };
    const written = await appendStructuredConversationLedger(env, e, prepared, captures, expected, proposed);
    if (!current() || !written) return { status: "unavailable" };
    return { status: "published", originalCount: written.ledger.originals.length, revision: written.revision };
  } catch { return { status: "unavailable" }; }
}
