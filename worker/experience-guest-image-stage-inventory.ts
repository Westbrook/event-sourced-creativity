import { freeze } from "../src/experiences/compiler.ts";
import { collectRetainedGuestImageHistory, collectDueGuestImageHistory, current, together, type Context, type Proof, type Row } from "./experience-guest-image-history.ts";
import { collectGuestImageStageFacts, guestImageStageUnclaimedClosure, sha, fail, type History, type GuestImageHistoricalStage } from "./experience-guest-image-stage-facts.ts";
import type { GuestClaimProof } from "./experience-guest-session.ts";
import type { WorkerEnv } from "./runtime.ts";
export type { GuestImageHistoricalStage } from "./experience-guest-image-stage-facts.ts";

async function collectStages(history: History) {
  const facts = await collectGuestImageStageFacts(history), { ctx } = facts;
  const parts = [...history.original.parts, ...history.currentGuards, history.sponsor.proof, history.memory.proof,
    ...facts.stageParts, facts.blockCustodyProof, facts.eventCountProof, guestImageStageUnclaimedClosure(facts), facts.recordedTimeProof];
  const commonProof = together(parts), proof = together([commonProof, ...facts.tailProofs]);
  const result = await ctx.db.prepare(`SELECT 1 AS current WHERE ${proof.sql}`).bind(...proof.bindings).first<{ current: number }>(); current(ctx);
  if (result?.current !== 1) return fail();
  return { ctx, history, sessionId: facts.sessionId, documentId: facts.documentId, sourceHead: facts.sourceHead, sourceSaveHead: facts.sourceSaveHead,
    stageHead: facts.stageHead, stageState: facts.stageState, expiresAt: facts.expiresAt, tails: facts.tails, resources: facts.resources,
    commonProof, proof, confirmed: facts.confirmed, quote: facts.quote, transport: facts.transport, rows: facts.rows };
}

export type GuestImageStageInventory = Readonly<{ version: 1; sessionId: string; documentId: string; sourceHead: number;
  sourceSaveHead: number; stageHead: number; stageState: GuestImageHistoricalStage; expiresAt: string; manifestDigest: string }>;
type Manifest = Readonly<{ version: 1; kind: "original-image-stage-history"; sessionId: string; guestSubject: string; documentId: string;
  projectId: string; sourceHead: number; sourceSaveHead: number; stageHead: number; stageState: GuestImageHistoricalStage; expiresAt: string;
  draftHash: string; contentDigest: string; sourceEventIds: readonly string[]; originalPayerUserId: string; nativeSnapshotDigest: string }>;
type InventoryData = Readonly<{ manifest: Manifest; proof: Proof; history: Readonly<Record<string, unknown>> }>;
const inventories = new WeakMap<GuestImageStageInventory, { db: WorkerEnv["DB"]; ctx: Context; data: InventoryData }>();

/** Retained historical custody inventory only. It never provides a live quote
 * guard or the N+1 inventory brand accepted by the first-SAVE claim writer. */
export async function inspectGuestImageStageInventory(request: Request, env: WorkerEnv, input: { proof: GuestClaimProof }): Promise<GuestImageStageInventory> {
  const original = await collectRetainedGuestImageHistory(request, env, input), history = await collectStages(original); current(history.ctx);
  const { source, session, projectId, eventIds } = original.original;
  const immutableRow = (value: Row) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "revoked_at_ms"));
  const nativeSnapshotDigest = await sha(history.ctx, { source, session: immutableRow(session),
    sourcePolicy: original.original.policy, custodyTerms: original.original.terms,
    prefix: original.original.prefixWitnesses, approval: immutableRow(original.saved.approval.row),
    tails: history.tails.map(value => value.observed), resources: history.resources, rows: history.rows });
  const manifest: Manifest = { version: 1, kind: "original-image-stage-history", sessionId: history.sessionId,
    guestSubject: String(session.guest_subject), documentId: history.documentId, projectId, sourceHead: history.sourceHead,
    sourceSaveHead: history.sourceSaveHead, stageHead: history.stageHead, stageState: history.stageState, expiresAt: history.expiresAt,
    draftHash: String(source.draft_hash), contentDigest: String(source.content_digest), sourceEventIds: [...eventIds],
    originalPayerUserId: original.saved.approval.policy.payerUserId, nativeSnapshotDigest };
  const manifestDigest = await sha(history.ctx, manifest);
  // Hashing is an await boundary too: prove the original graph after it before
  // publishing even a source-free review summary.
  const final = await history.ctx.db.prepare(`SELECT 1 AS current WHERE ${history.proof.sql}`).bind(...history.proof.bindings).first<{ current: number }>(); current(history.ctx);
  if (final?.current !== 1) return fail();
  const inventory = Object.freeze({ version: 1 as const, sessionId: history.sessionId, documentId: history.documentId,
    sourceHead: history.sourceHead, sourceSaveHead: history.sourceSaveHead, stageHead: history.stageHead,
    stageState: history.stageState, expiresAt: history.expiresAt, manifestDigest });
  const retainedHistory = { sourcePlan: original.original.plan, sourceEventIds: [...eventIds],
    source, session: immutableRow(session), sourcePolicy: original.original.policy, custodyTerms: original.original.terms,
    approval: immutableRow(original.saved.approval.row), tails: history.tails, resources: history.resources, rows: history.rows,
    confirmed: history.confirmed, quote: history.quote, transport: history.transport };
  inventories.set(inventory, { db: history.ctx.db, ctx: history.ctx, data: freeze({ manifest, proof: history.proof, history: retainedHistory }) });
  return inventory;
}
export function guestImageStageInventoryData(env: WorkerEnv, inventory: GuestImageStageInventory): InventoryData {
  const captured = inventory && typeof inventory === "object" ? inventories.get(inventory) : undefined;
  if (!captured || env.DB !== captured.db) return fail();
  current(captured.ctx); return captured.data;
}
/** Internal due facts, not a retained inventory or completed-claim capability.
 * The only consumer is original unclaimed private-tail retirement. */
export async function collectDueGuestImageStageHistory(env: WorkerEnv, input: { sessionId: string }) {
  const original = await collectDueGuestImageHistory(env, input), history = await collectStages(original); current(history.ctx); return history;
}
