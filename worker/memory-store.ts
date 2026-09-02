import {
  createMemoryScopeGraph, forgetMemory, memoryDigest, memoryKey, memoryRecordEligible, memoryScopeGrant, memoryScopePath,
  memorySourceEligible, memorySourceMatches, memorySuppressed, memoryTime,
  type MemoryAccess, type MemoryPurpose, type MemoryRecord, type MemorySource, type MemorySuppression,
} from "../src/model/scoped-memory.ts";
import {
  eligibleMemoryObservations, rollingMemoryConsumption, type MemoryObservation,
} from "../src/model/memory-observations.ts";
import { createMemoryConversationSegment, type MemoryConversationSegment } from "../src/model/memory-conversation.ts";
import { publishMemoryReview, type MemoryCursor, type MemoryReviewPlan } from "./memory-shadow.ts";
import { MemorySourceAdapter, type MemoryIdentity, type MemorySourceCapture, type MemorySourceEvidence } from "./memory-source-adapter.ts";
import {
  MemoryBoundaryError, memoryAssert, memoryCursorJson, memoryGuardQuery, memoryGuardsCurrent,
  type MemoryDatabase, type MemorySqlGuard,
} from "./memory-sql.ts";

type Metadata = Omit<MemoryRecord, "body">;
type SegmentMetadata = Omit<MemoryConversationSegment, "record">;
type Partition = { generation: number; privacy_generation: number };
type StoreState = {
  sourceCaptures: readonly MemorySourceCapture[]; capturedPurposes: readonly MemoryPurpose[]; policyGuard?: MemorySqlGuard;
  evidence: MemorySourceEvidence; identity: MemoryIdentity; recipeVersion: string;
  purpose: MemoryPurpose;
  partition: Partition; storedSources: MemorySource[]; storedObservations: MemoryObservation[];
  sourceDocuments: Map<string,string>;
  metadata: Metadata[]; segments: Array<{ record_id: string; coverage_json: string }>;
  suppressions: MemorySuppression[];
};
export type MemoryStoreCapture = Readonly<{ kind: "issued-memory-store-capture" }>;
export type MemoryStoredView = MemorySourceEvidence & {
  records: MemoryRecord[]; segments: MemoryConversationSegment[]; suppressions: MemorySuppression[];
  consumption: ReturnType<typeof rollingMemoryConsumption>; generation: number; privacyGeneration: number;
};
const parseStored = <T>(text: string): T => {
  try { return JSON.parse(text) as T; } catch { throw new MemoryBoundaryError("invalid-stored-memory-metadata"); }
};
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
const metadataOf = ({ body: _body, ...metadata }: MemoryRecord): Metadata => metadata;
const placeholder = (metadata: Metadata): MemoryRecord => ({ ...metadata, body: "metadata eligibility check" });
const partitionBindings = (identity: MemoryIdentity) => [identity.actorUserId, identity.custodianId];

/**
 * Isolated synthetic persistence, not a live service. No schema initialization,
 * environment flags, provider calls or implicit commits to application tables.
 * Every read reopens source authority; persisted source rows never grant access.
 */
export class MemoryShadowStore {
  private readonly db: MemoryDatabase;
  private readonly adapter: MemorySourceAdapter;
  private readonly issued = new WeakMap<MemoryStoreCapture, StoreState>();

  constructor(database: MemoryDatabase, adapter: MemorySourceAdapter) {
    memoryAssert(database === adapter.database, "memory-databases-must-match");
    this.db = database; this.adapter = adapter;
  }

  private state(capture: MemoryStoreCapture): StoreState {
    const state = this.issued.get(capture); memoryAssert(state, "unissued-memory-store-capture"); return state!;
  }
  evidence(capture: MemoryStoreCapture): MemorySourceEvidence { return structuredClone(this.state(capture).evidence); }

  private generationGuard(state: StoreState): MemorySqlGuard {
    return { condition: "COALESCE((SELECT generation FROM memory_shadow_partitions WHERE actor_user_id=? AND custodian_id=?),0)=?",
      bindings: [...partitionBindings(state.identity), state.partition.generation] };
  }
  private guards(state: StoreState): MemorySqlGuard[] {
    return [{ condition: "EXISTS(SELECT 1 FROM memory_shadow_schema WHERE version=1 AND isolation='synthetic-only')", bindings: [] },
      this.generationGuard(state), ...(state.sourceCaptures.length ? state.sourceCaptures.flatMap((capture) => this.adapter.guards(capture)) : [state.policyGuard!])];
  }
  private currentAccess(state: StoreState): MemoryAccess {
    const now = this.adapter.now();
    memoryAssert(memoryTime(now) >= memoryTime(state.evidence.access.now), "memory-clock-rewind");
    return { ...state.evidence.access, now };
  }

  async capture(identity: MemoryIdentity, recipeVersion = "document-memory-v1", purpose: MemoryPurpose = "learn"): Promise<MemoryStoreCapture | null> {
    if (this.adapter.mode === "off") return null;
    memoryAssert(recipeVersion.length > 0 && recipeVersion.length <= 128, "invalid-memory-recipe");
    const request = structuredClone(identity), bind = partitionBindings(request), db = this.db;
    const schema = await db.prepare("SELECT version,isolation FROM memory_shadow_schema").all<{ version: number; isolation: string }>();
    memoryAssert(schema.results.length === 1 && schema.results[0].version === 1 && schema.results[0].isolation === "synthetic-only", "unsupported-memory-schema");
    const rows = await db.batch<Record<string, unknown>>([
      db.prepare("SELECT generation,privacy_generation FROM memory_shadow_partitions WHERE actor_user_id=? AND custodian_id=?").bind(...bind),
      db.prepare("SELECT stream_id,sequence FROM memory_shadow_watermarks WHERE actor_user_id=? AND custodian_id=? AND scope_id=? AND recipe_version=?").bind(...bind,request.targetScopeId,recipeVersion),
      db.prepare("SELECT source_id,source_json,document_scope_id FROM memory_shadow_sources WHERE actor_user_id=? AND custodian_id=? LIMIT 1025").bind(...bind),
      db.prepare("SELECT observation_json FROM memory_shadow_observations WHERE actor_user_id=? AND custodian_id=? LIMIT 1025").bind(...bind),
      db.prepare("SELECT metadata_json FROM memory_shadow_records WHERE actor_user_id=? AND custodian_id=? LIMIT 1025").bind(...bind),
      db.prepare("SELECT suppression_json FROM memory_shadow_suppressions WHERE actor_user_id=? AND custodian_id=? LIMIT 1025").bind(...bind),
      db.prepare("SELECT record_id,coverage_json FROM memory_shadow_segments WHERE actor_user_id=? AND custodian_id=? LIMIT 1025").bind(...bind),
    ]);
    memoryAssert(rows.length === 7 && rows.every((row) => row.success && row.results.length <= 1024), "memory-store-read-limit");
    const processed = Object.fromEntries(rows[1].results.map((row) => [String(row.stream_id), Number(row.sequence)]));
    const sourceCapture = await this.adapter.capture(request, processed, purpose); memoryAssert(sourceCapture, "memory-disabled");
    const evidence = this.adapter.evidence(sourceCapture!);
    const storedSources = rows[2].results.map((row) => parseStored<MemorySource>(String(row.source_json)));
    const suppressions = rows[5].results.map((row) => parseStored<MemorySuppression>(String(row.suppression_json)));
    const previous = new Map(storedSources.map((source) => [memoryKey(source.custodianId, source.id), source]));
    for (const [key, source] of evidence.sources) {
      const old = previous.get(key);
      const suppressed = suppressions.some((row) => row.state === "active" && row.lineageIds.includes(source.lineageId));
      evidence.sources.set(key, { ...source,
        expiresAt: old ? new Date(Math.min(memoryTime(old.expiresAt),memoryTime(source.expiresAt))).toISOString() : source.expiresAt,
        state: suppressed ? "erased" : old && old.state !== "active" ? old.state : source.state,
      });
    }
    evidence.observations = eligibleMemoryObservations(evidence, purpose).map((observation) => {
      const source = evidence.sources.get(memoryKey(observation.source.custodianId,observation.source.id))!;
      return { ...observation,evidenceSource: { ...source },expiresAt: new Date(Math.min(memoryTime(observation.expiresAt),memoryTime(source.expiresAt))).toISOString() };
    });
    evidence.inventory.observationSources = evidence.observations.filter((row) => row.sequence > (processed[row.streamId] ?? 0)).map((row) => row.source);
    evidence.conversations = evidence.conversations.map((conversation) => {
      const turns = conversation.turns.filter((turn) => {
        const source = evidence.sources.get(memoryKey(turn.source.custodianId, turn.source.id));
        return source && memorySourceMatches(turn.source, source) && memorySourceEligible(source, evidence.access, evidence.graph, purpose);
      });
      return { ...conversation, turns, completeFromStart: conversation.completeFromStart && turns.length === conversation.turns.length };
    });
    const state: StoreState = { sourceCaptures: [sourceCapture!], capturedPurposes: [purpose], evidence, identity: request, recipeVersion, purpose,
      partition: rows[0].results[0] as unknown as Partition ?? { generation: 0, privacy_generation: 0 }, storedSources,
      sourceDocuments: new Map(rows[2].results.map((row) => [String(row.source_id),String(row.document_scope_id)])),
      storedObservations: rows[3].results.map((row) => parseStored<MemoryObservation>(String(row.observation_json))),
      metadata: rows[4].results.map((row) => parseStored<Metadata>(String(row.metadata_json))),
      segments: rows[6].results as Array<{ record_id: string; coverage_json: string }>, suppressions };
    memoryAssert(await memoryGuardsCurrent(db, this.guards(state)), "stale-memory-store-snapshot");
    const capture: MemoryStoreCapture = Object.freeze({ kind: "issued-memory-store-capture" }); this.issued.set(capture, state); return capture;
  }

  async read(identity: MemoryIdentity, recipeVersion = "document-memory-v1"): Promise<MemoryStoredView | null> {
    const capture = await this.capture(identity, recipeVersion, "recall"); if (!capture) return null;
    const state = this.state(capture), evidence = structuredClone(state.evidence);
    let access = this.currentAccess(state);
    evidence.access = access;
    const eligible = state.metadata.filter((metadata) => memoryRecordEligible(placeholder(metadata), evidence.sources,
      access, evidence.graph, state.suppressions));
    const guards = this.guards(state), db = this.db;
    const results = await db.batch<Record<string, unknown>>([
      ...guards.map((guard) => memoryGuardQuery(db, guard)),
      ...eligible.map((metadata) => db.prepare("SELECT body FROM memory_shadow_private_bodies WHERE actor_user_id=? AND custodian_id=? AND record_id=?")
        .bind(...partitionBindings(state.identity),metadata.id)),
    ]);
    memoryAssert(results.length === guards.length + eligible.length && results.slice(0,guards.length).every((row) => row.results[0]?.verified === 1), "stale-memory-read");
    access = this.currentAccess(state); evidence.access = access;
    for (const [key,source] of evidence.sources) if (!memorySourceEligible(source,access,evidence.graph,"recall")) evidence.sources.delete(key);
    evidence.conversations = evidence.conversations.map((conversation) => {
      const turns = conversation.turns.filter((turn) => evidence.sources.has(memoryKey(turn.source.custodianId,turn.source.id)));
      return { ...conversation,turns,completeFromStart: conversation.completeFromStart && turns.length === conversation.turns.length };
    });
    const records = eligible.flatMap((metadata, index) => {
      const body = results[guards.length + index]?.results[0]?.body;
      const record = { ...metadata, body: typeof body === "string" ? body : "" };
      return memoryRecordEligible(record,evidence.sources,access,evidence.graph,state.suppressions) ? [record] : [];
    });
    const byId = new Map(records.map((record) => [record.id, record]));
    const segments = state.segments.flatMap((row) => byId.has(row.record_id)
      ? [{ ...parseStored<SegmentMetadata>(row.coverage_json), record: byId.get(row.record_id)! }] : []);
    // Consumption is rebuilt from PERSISTED projections and fresh canonical sources.
    const observations = eligibleMemoryObservations({ ...evidence, observations: state.storedObservations });
    return { ...evidence, observations, records, segments, suppressions: structuredClone(state.suppressions),
      consumption: rollingMemoryConsumption({ ...evidence, observations }),
      generation: state.partition.generation, privacyGeneration: state.partition.privacy_generation };
  }

  async publish(input: { capture: MemoryStoreCapture; plan: MemoryReviewPlan; records: readonly MemoryRecord[];
    segments?: readonly MemoryConversationSegment[] }): Promise<{ status: "committed" | "already-committed"; processed: MemoryCursor }> {
    const state = this.state(input.capture), captured = structuredClone({ plan: input.plan, records: input.records, segments: input.segments ?? [] });
    const { plan, records, segments } = captured, evidence = state.evidence, db = this.db, bind = partitionBindings(state.identity);
    memoryAssert(state.purpose === "learn", "memory-learning-capture-required");
    memoryAssert(records.length <= 128 && segments.length <= 32 && new Set(records.map((record) => record.id)).size === records.length
      && new Set(segments.map((segment) => segment.record.id)).size === segments.length, "memory-publication-limit");
    memoryAssert(records.filter((record) => record.kind === "conversation-summary").length === segments.length
      && records.filter((record) => record.kind === "conversation-summary").every((record) => segments.some((segment) => segment.record.id === record.id)),
    "memory-summary-coverage-required");
    memoryAssert(new Set([...state.metadata.map((row) => row.id),...records.map((row) => row.id)]).size <= 1024
      && new Set([...state.storedSources.map((row) => row.id),...evidence.sources.values()].map((row) => typeof row === "string" ? row : row.id)).size <= 1024
      && new Set([...state.storedObservations,...evidence.observations].map((row) => row.eventId)).size <= 1024, "memory-partition-capacity");
    const outputHash = await memoryDigest(canonical({ records: [...records].sort((a,b) => a.id.localeCompare(b.id)),
      segments: [...segments].sort((a,b) => a.record.id.localeCompare(b.record.id)) }));
    const previous = await db.prepare("SELECT plan_json,output_hash FROM memory_shadow_reviews WHERE actor_user_id=? AND custodian_id=? AND review_id=?")
      .bind(...bind,plan.id).first<{ plan_json: string; output_hash: string }>();
    if (previous) {
      memoryAssert(previous.plan_json === canonical(plan) && previous.output_hash === outputHash, "conflicting-memory-review-replay");
      memoryAssert(await this.replayCurrent(state), "stale-memory-review-replay");
      return { status: "already-committed", processed: { ...plan.through } };
    }
    memoryAssert(plan.recipeVersion === state.recipeVersion && memoryCursorJson(plan.from) === memoryCursorJson(evidence.inventory.from)
      && memoryCursorJson(plan.through) === memoryCursorJson(evidence.inventory.through), "memory-review-interval-mismatch");
    const access = this.currentAccess(state);
    const checked = await publishMemoryReview({ plan, processed: evidence.inventory.from, successful: true, records,
      sources: evidence.sources, access, graph: evidence.graph, suppressions: state.suppressions });
    memoryAssert(checked.published, "ineligible-memory-publication");
    for (const record of records) {
      const old = state.metadata.find((metadata) => metadata.id === record.id);
      memoryAssert(!old || old.state !== "erased" && record.version > old.version && record.scopeId === old.scopeId
        && record.kind === old.kind && record.claimKey === old.claimKey, "memory-record-version-conflict");
    }
    for (const segment of segments) {
      const inventory = evidence.conversations.find((candidate) => candidate.conversationId === segment.conversationId);
      const record = records.find((candidate) => candidate.id === segment.record.id);
      memoryAssert(inventory && record && canonical(record) === canonical(segment.record), "unbound-memory-segment");
      memoryAssert(segment.method === "extractive-v1" && record!.kind === "conversation-summary" && record!.authority === "historical"
        && record!.scopeId === inventory!.scopeId && record!.claimKey === `conversation:${inventory!.conversationId}`
        && segment.covered.length === record!.sources.length
        && segment.covered.every((covered,index) => memorySourceMatches(covered.source,record!.sources[index])), "unbound-memory-segment-sources");
      const turns = segment.covered.map((covered) => inventory!.turns.find((turn) => turn.turnId === covered.turnId
        && turn.role === covered.role && memorySourceMatches(turn.source,covered.source)));
      memoryAssert(turns.length > 0 && turns.every(Boolean), "unbound-memory-segment");
      const rebuilt = await createMemoryConversationSegment({ id: record!.id, version: record!.version,
        inventory: { ...inventory!, turns: turns as NonNullable<typeof inventory>["turns"] } }, evidence.sources,access,evidence.graph);
      memoryAssert(rebuilt && rebuilt.record.body === record!.body && canonical(rebuilt.covered) === canonical(segment.covered), "invalid-memory-segment-body");
    }
    const statements: D1PreparedStatement[] = [];
    for (const source of evidence.sources.values()) statements.push(this.sourceStatement(state,source));
    for (const observation of evidence.observations) statements.push(db.prepare(`INSERT INTO memory_shadow_observations(actor_user_id,custodian_id,source_id,observation_json)
      VALUES(?,?,?,?) ON CONFLICT(actor_user_id,custodian_id,source_id) DO UPDATE SET observation_json=excluded.observation_json`)
      .bind(...bind,observation.source.id,canonical(observation)));
    // Missing LEARN evidence does not prove lost RECALL permission. Physical
    // invalidation is handled by maintain/prune using an independent recall capture.
    for (const record of records) {
      statements.push(db.prepare(`INSERT INTO memory_shadow_records(actor_user_id,custodian_id,record_id,scope_id,version,state,expires_at,metadata_json)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(actor_user_id,custodian_id,record_id) DO UPDATE SET version=excluded.version,state=excluded.state,
        expires_at=excluded.expires_at,metadata_json=excluded.metadata_json`).bind(...bind,record.id,record.scopeId,record.version,record.state,record.expiresAt,canonical(metadataOf(record))));
      statements.push(db.prepare(`INSERT INTO memory_shadow_private_bodies(actor_user_id,custodian_id,record_id,body) VALUES(?,?,?,?)
        ON CONFLICT(actor_user_id,custodian_id,record_id) DO UPDATE SET body=excluded.body`).bind(...bind,record.id,record.body));
      statements.push(db.prepare("DELETE FROM memory_shadow_dependencies WHERE actor_user_id=? AND custodian_id=? AND record_id=?").bind(...bind,record.id));
      for (const source of record.sources) statements.push(db.prepare("INSERT INTO memory_shadow_dependencies(actor_user_id,custodian_id,record_id,source_id,lineage_id) VALUES(?,?,?,?,?)")
        .bind(...bind,record.id,source.id,source.lineageId));
      statements.push(db.prepare("DELETE FROM memory_shadow_segments WHERE actor_user_id=? AND custodian_id=? AND record_id=?").bind(...bind,record.id));
      const segment = segments.find((candidate) => candidate.record.id === record.id);
      if (segment) statements.push(db.prepare("INSERT INTO memory_shadow_segments(actor_user_id,custodian_id,record_id,coverage_json) VALUES(?,?,?,?)")
        .bind(...bind,record.id,canonical({ method: segment.method, conversationId: segment.conversationId, covered: segment.covered })));
      statements.push(...this.outboxStatements(state,record,"upsert",access.now));
    }
    for (const [stream,sequence] of Object.entries(plan.through)) statements.push(db.prepare(`INSERT INTO memory_shadow_watermarks(actor_user_id,custodian_id,scope_id,recipe_version,stream_id,sequence)
      VALUES(?,?,?,?,?,?) ON CONFLICT(actor_user_id,custodian_id,scope_id,recipe_version,stream_id) DO UPDATE SET sequence=excluded.sequence`)
      .bind(...bind,state.identity.targetScopeId,state.recipeVersion,stream,sequence));
    const inventoryHash = await memoryDigest(canonical(evidence.inventory));
    statements.push(db.prepare("INSERT INTO memory_shadow_reviews(actor_user_id,custodian_id,review_id,scope_id,recipe_version,plan_json,inventory_hash,output_hash,committed_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(...bind,plan.id,state.identity.targetScopeId,state.recipeVersion,canonical(plan),inventoryHash,outputHash,access.now));
    // Recheck time after hashing/segment validation, then SQL rechecks authority in the commit transaction.
    const finalAccess = this.currentAccess(state);
    memoryAssert(records.every((record) => memoryRecordEligible(record,evidence.sources,finalAccess,evidence.graph,state.suppressions,"learn"))
      && plan.sources.every((ref) => memorySourceEligible(evidence.sources.get(memoryKey(ref.custodianId,ref.id))!,finalAccess,evidence.graph,"learn")), "expired-memory-publication");
    const activeSources = [...evidence.sources.values()].filter((source) => source.state === "active");
    const scopes = new Set([state.identity.targetScopeId,...records.map((record) => record.scopeId),...activeSources.map((source) => source.scopeId),
      ...evidence.observations.flatMap((observation) => observation.targets.map((target) => target.scopeId))]);
    const deadline = Math.min(memoryTime(finalAccess.enrollmentExpiresAt),...records.map((record) => memoryTime(record.expiresAt)),
      ...activeSources.flatMap((source) => [memoryTime(source.expiresAt),memoryTime(source.happenedAt) + finalAccess.retentionDays * 86_400_000]),
      ...evidence.observations.map((observation) => memoryTime(observation.expiresAt)),
      ...[...scopes].map((scope) => memoryTime(memoryScopeGrant(finalAccess,evidence.graph,scope,"learn")?.expiresAt)),
      ...evidence.observations.filter((observation) => observation.action === "attention").map(() => memoryTime(evidence.attention?.expiresAt)));
    memoryAssert(Number.isFinite(deadline) && deadline > memoryTime(finalAccess.now), "expired-memory-publication");
    const timeGuard = this.adapter.transactionTimeGuard(finalAccess.now,new Date(deadline).toISOString());
    try { await this.commit(state,statements,false,timeGuard); }
    catch (error) {
      // A concurrent identical worker or a lost acknowledgement may have committed.
      const receipt = await db.prepare("SELECT plan_json,output_hash FROM memory_shadow_reviews WHERE actor_user_id=? AND custodian_id=? AND review_id=?")
        .bind(...bind,plan.id).first<{ plan_json: string; output_hash: string }>();
      if (receipt?.plan_json === canonical(plan) && receipt.output_hash === outputHash && await this.replayCurrent(state))
        return { status: "already-committed", processed: { ...plan.through } };
      throw error;
    }
    return { status: "committed", processed: { ...plan.through } };
  }

  async forget(capture: MemoryStoreCapture, recordId: string): Promise<{ erased: number; privacyGeneration: number }> {
    const state = this.state(capture), access = this.currentAccess(state), db = this.db, bind = partitionBindings(state.identity);
    const record = state.metadata.find((candidate) => candidate.id === recordId);
    memoryAssert(record && memoryScopeGrant(access,state.evidence.graph,record.scopeId,"recall"), "memory-forget-access-denied");
    const { suppression } = forgetMemory(placeholder(record!));
    const previous = state.suppressions.find((row) => row.scopeId === suppression.scopeId && row.claimKey === suppression.claimKey && row.state === "active");
    suppression.lineageIds = [...new Set([...(previous?.lineageIds ?? []),...suppression.lineageIds])].sort();
    if (record!.state === "erased" && previous && canonical(previous) === canonical(suppression)) {
      memoryAssert(await memoryGuardsCurrent(db,this.guards(state)), "stale-memory-forget");
      return { erased: 0, privacyGeneration: state.partition.privacy_generation };
    }
    const suppressions = [...state.suppressions,suppression];
    const affected = state.metadata.filter((row) => row.state !== "erased" && this.suppressed(row,suppressions,state));
    const suppressionId = await memoryDigest(canonical([suppression.scopeId,suppression.claimKey]));
    const statements = [db.prepare(`INSERT INTO memory_shadow_suppressions(actor_user_id,custodian_id,suppression_id,suppression_json,created_at)
      VALUES(?,?,?,?,?) ON CONFLICT(actor_user_id,custodian_id,suppression_id) DO UPDATE SET suppression_json=excluded.suppression_json`)
      .bind(...bind,suppressionId,canonical(suppression),access.now)];
    for (const row of affected) statements.push(...this.eraseStatements(state,row,access.now));
    for (const source of state.storedSources.filter((row) => suppression.lineageIds.includes(row.lineageId))) {
      statements.push(this.sourceStatement(state,{ ...source,state: "erased" }));
      statements.push(db.prepare("DELETE FROM memory_shadow_observations WHERE actor_user_id=? AND custodian_id=? AND source_id=?").bind(...bind,source.id));
    }
    await this.commit(state,statements,true);
    return { erased: affected.length, privacyGeneration: state.partition.privacy_generation + 1 };
  }

  /** No human-activity or night-window requirement. Scheduling this remains a separate release. */
  async prune(capture: MemoryStoreCapture): Promise<{ erased: number }> {
    const state = this.state(capture);
    memoryAssert(state.purpose === "recall", "memory-recall-capture-required-for-maintenance");
    return this.pruneState(state);
  }

  private async pruneState(state: StoreState): Promise<{ erased: number }> {
    const access = this.currentAccess(state), bind = partitionBindings(state.identity);
    const retainedSources = this.retentionSources(state,access);
    const invalid = this.invalidRecords(state,access,retainedSources), statements: D1PreparedStatement[] = [];
    for (const metadata of invalid) statements.push(...this.eraseStatements(state,metadata,access.now));
    for (const source of state.storedSources) {
      if (state.sourceDocuments.get(source.id) !== state.identity.targetScopeId) continue;
      const current = retainedSources.get(memoryKey(source.custodianId,source.id));
      if (source.state !== "active" || current && this.mayRetainSource(current,access,state)) continue;
      statements.push(this.sourceStatement(state,{ ...source,state: memoryTime(source.expiresAt) <= memoryTime(access.now) ? "erased" : "revoked" }));
      statements.push(this.db.prepare("DELETE FROM memory_shadow_observations WHERE actor_user_id=? AND custodian_id=? AND source_id=?").bind(...bind,source.id));
    }
    if (statements.length) await this.commit(state,statements);
    else memoryAssert(await memoryGuardsCurrent(this.db,this.guards(state)), "stale-memory-maintenance");
    return { erased: invalid.length };
  }

  /**
   * Deadline/policy cleanup never waits for source hydration or a finalized chat.
   * Stored receipts can prove ineligibility, NEVER current permission to recall.
   * A pending/inconsistent source defers only the subsequent dependency review.
   */
  async maintain(identity: MemoryIdentity): Promise<{ erased: number; sourceReview: "complete" | "deferred" | "unnecessary" }> {
    const request = structuredClone(identity), policy = await this.adapter.policySnapshot(request);
    if (!policy) return { erased: 0, sourceReview: "unnecessary" };
    const graph = createMemoryScopeGraph(policy.scopes);
    const bind = partitionBindings(request), db = this.db;
    const rows = await db.batch<Record<string,unknown>>([
      db.prepare("SELECT generation,privacy_generation FROM memory_shadow_partitions WHERE actor_user_id=? AND custodian_id=?").bind(...bind),
      db.prepare("SELECT source_id,source_json,document_scope_id FROM memory_shadow_sources WHERE actor_user_id=? AND custodian_id=? LIMIT 1025").bind(...bind),
      db.prepare("SELECT metadata_json FROM memory_shadow_records WHERE actor_user_id=? AND custodian_id=? LIMIT 1025").bind(...bind),
      db.prepare("SELECT suppression_json FROM memory_shadow_suppressions WHERE actor_user_id=? AND custodian_id=? LIMIT 1025").bind(...bind),
      db.prepare("SELECT observation_json FROM memory_shadow_observations WHERE actor_user_id=? AND custodian_id=? LIMIT 1025").bind(...bind),
    ]);
    memoryAssert(rows.length === 5 && rows.every((row) => row.success && row.results.length <= 1024),"memory-maintenance-read-limit");
    const storedSources = rows[1].results.map((row) => parseStored<MemorySource>(String(row.source_json)));
    const state: StoreState = { sourceCaptures:[],capturedPurposes:[],policyGuard:policy.guard,identity:request,recipeVersion:"maintenance",purpose:"recall",
      evidence:{ access:policy.access,graph,sources:new Map(storedSources.map((source) => [memoryKey(source.custodianId,source.id),source])),observations:[],conversations:[],
        inventory:{ complete:false,from:{},through:{},observationSources:[] },scannedRows:0,unavailableRows:0,attention:policy.attention },
      partition:rows[0].results[0] as unknown as Partition ?? { generation:0,privacy_generation:0 },storedSources,
      sourceDocuments:new Map(rows[1].results.map((row) => [String(row.source_id),String(row.document_scope_id)])),
      storedObservations:rows[4].results.map((row) => parseStored<MemoryObservation>(String(row.observation_json))),
      metadata:rows[2].results.map((row) => parseStored<Metadata>(String(row.metadata_json))),segments:[],
      suppressions:rows[3].results.map((row) => parseStored<MemorySuppression>(String(row.suppression_json))) };
    state.evidence.access = this.currentAccess(state);
    // Stored observation classification lets known attention withdrawals, cutoffs
    // and target-policy losses be swept without opening private source content.
    const observations = { ...state.evidence, observations:state.storedObservations };
    const allowed = new Set(["learn","recall"].flatMap((purpose) => eligibleMemoryObservations(observations,purpose as MemoryPurpose).map((row) => row.eventId)));
    for (const observation of state.storedObservations) {
      const key = memoryKey(observation.source.custodianId,observation.source.id), source = state.evidence.sources.get(key);
      if (source && !allowed.has(observation.eventId)) state.evidence.sources.set(key,{ ...source,state:"revoked" });
    }
    const swept = await this.pruneState(state), access = this.currentAccess(state);
    if (!storedSources.some((source) => state.sourceDocuments.get(source.id) === request.targetScopeId
      && this.mayRetainSource(state.evidence.sources.get(memoryKey(source.custodianId,source.id))!,access,state))) return { ...swept, sourceReview:"unnecessary" };
    try {
      // Retention is allowed for learning OR recall; neither purpose silently
      // enables the other. Revalidate every allowed purpose before deleting data
      // that might be visible only through the other grant.
      const snapshots: StoreState[] = [];
      for (const purpose of ["recall","learn"] as const) if (memoryScopeGrant(access,graph,request.targetScopeId,purpose)) {
        const capture = await this.capture(request,"document-memory-v1",purpose); memoryAssert(capture,"memory-disabled");
        snapshots.push(this.state(capture!));
      }
      memoryAssert(snapshots.length > 0,"memory-maintenance-access-changed");
      const combined: StoreState = { ...snapshots[0],sourceCaptures:snapshots.flatMap((snapshot) => snapshot.sourceCaptures),
        capturedPurposes:snapshots.flatMap((snapshot) => snapshot.capturedPurposes),
        evidence:{ ...snapshots[0].evidence,sources:new Map(snapshots.flatMap((snapshot) => [...snapshot.evidence.sources])) } };
      const checked = await this.pruneState(combined);
      return { erased:swept.erased + checked.erased, sourceReview:"complete" };
    } catch (error) {
      if (error instanceof MemoryBoundaryError) return { ...swept, sourceReview:"deferred" };
      throw error;
    }
  }

  private inDocument(scopeId: string, state: StoreState): boolean {
    try { return memoryScopePath(state.evidence.graph,state.identity.custodianId,scopeId).some((scope) => scope.id === state.identity.targetScopeId); }
    catch { return false; }
  }
  private async replayCurrent(state: StoreState): Promise<boolean> {
    return Boolean(memoryScopeGrant(this.currentAccess(state),state.evidence.graph,state.identity.targetScopeId,state.purpose))
      && state.sourceCaptures.length === 1 && memoryGuardsCurrent(this.db,this.adapter.guards(state.sourceCaptures[0]));
  }
  private suppressed(metadata: Metadata, suppressions: MemorySuppression[], state: StoreState): boolean {
    if (suppressions.some((row) => row.state === "active" && metadata.sources.some((source) => row.lineageIds.includes(source.lineageId)))) return true;
    try { return memorySuppressed(placeholder(metadata),suppressions,state.evidence.graph); }
    catch { return false; }
  }
  private mayRetainSource(source: MemorySource, access: MemoryAccess, state: StoreState): boolean {
    return memorySourceEligible(source,access,state.evidence.graph,"recall") || memorySourceEligible(source,access,state.evidence.graph,"learn");
  }
  private retentionSources(state: StoreState, access: MemoryAccess): Map<string,MemorySource> {
    const sources = new Map(state.evidence.sources);
    for (const source of state.storedSources) {
      const key = memoryKey(source.custodianId,source.id);
      // A recall-only capture cannot establish that a learn-only source vanished.
      // This is a retention fallback only, never used by read/recall/publication.
      if (!sources.has(key) && this.mayRetainSource(source,access,state)
        && !state.capturedPurposes.some((purpose) => memorySourceEligible(source,access,state.evidence.graph,purpose))) sources.set(key,source);
    }
    return sources;
  }
  private invalidRecords(state: StoreState, access: MemoryAccess, sources: ReadonlyMap<string,MemorySource>): Metadata[] {
    return state.metadata.filter((metadata) => metadata.state === "active"
      && (memoryTime(metadata.expiresAt) <= memoryTime(access.now) || this.suppressed(metadata,state.suppressions,state)
        || (this.inDocument(metadata.scopeId,state) || metadata.sources.some((source) => state.sourceDocuments.get(source.id) === state.identity.targetScopeId))
          && !["recall","learn"].some((purpose) => memoryRecordEligible(placeholder(metadata),sources,access,state.evidence.graph,state.suppressions,purpose as MemoryPurpose))));
  }
  private sourceStatement(state: StoreState, source: MemorySource): D1PreparedStatement {
    return this.db.prepare(`INSERT INTO memory_shadow_sources(actor_user_id,custodian_id,source_id,document_scope_id,source_json,expires_at,state) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(actor_user_id,custodian_id,source_id) DO UPDATE SET source_json=excluded.source_json,expires_at=excluded.expires_at,state=excluded.state`)
      .bind(...partitionBindings(state.identity),source.id,state.sourceDocuments.get(source.id) ?? state.identity.targetScopeId,canonical(source),source.expiresAt,source.state);
  }
  private eraseStatements(state: StoreState, metadata: Metadata, now: string): D1PreparedStatement[] {
    const bind = [...partitionBindings(state.identity),metadata.id], db = this.db;
    return [
      db.prepare("UPDATE memory_shadow_records SET state='erased',metadata_json=? WHERE actor_user_id=? AND custodian_id=? AND record_id=?")
        .bind(canonical({ ...metadata,state: "erased" }),...bind),
      db.prepare("DELETE FROM memory_shadow_private_bodies WHERE actor_user_id=? AND custodian_id=? AND record_id=?").bind(...bind),
      db.prepare("DELETE FROM memory_shadow_segments WHERE actor_user_id=? AND custodian_id=? AND record_id=?").bind(...bind),
      ...this.outboxStatements(state,metadata,"delete",now),
    ];
  }
  private outboxStatements(state: StoreState, record: Pick<MemoryRecord,"id" | "version">, operation: "upsert" | "delete", now: string): D1PreparedStatement[] {
    const bind = partitionBindings(state.identity), generation = state.partition.generation + 1;
    return [this.db.prepare("DELETE FROM memory_shadow_index_outbox WHERE actor_user_id=? AND custodian_id=? AND record_id=?").bind(...bind,record.id),
      this.db.prepare("INSERT INTO memory_shadow_index_outbox(actor_user_id,custodian_id,intent_id,record_id,record_version,operation,generation,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(...bind,canonical([record.id,record.version,operation,generation]),record.id,record.version,operation,generation,now)];
  }

  private async commit(state: StoreState, writes: D1PreparedStatement[], privacy = false, timeGuard?: MemorySqlGuard): Promise<void> {
    const db = this.db, guards = [...this.guards(state),...(timeGuard ? [timeGuard] : [])], guardIds: string[] = [], statements: D1PreparedStatement[] = [];
    const assert = (guard: MemorySqlGuard) => {
      // Validate the server-owned condition before interpolating it into a CHECK assertion.
      memoryGuardQuery(db,guard);
      const id = crypto.randomUUID(); guardIds.push(id);
      statements.push(db.prepare(`INSERT INTO memory_shadow_atomic_guards(guard_id,verified) SELECT ?,CASE WHEN (${guard.condition}) THEN 1 ELSE 0 END`).bind(id,...guard.bindings));
    };
    for (const guard of guards) assert(guard);
    const bind = partitionBindings(state.identity);
    statements.push(db.prepare("INSERT INTO memory_shadow_partitions(actor_user_id,custodian_id,generation,privacy_generation) VALUES(?,?,0,0) ON CONFLICT(actor_user_id,custodian_id) DO NOTHING").bind(...bind));
    statements.push(...writes);
    for (const guard of guards) assert(guard);
    // The last publication write is time-qualified too; expiry must not advance progress.
    statements.push(db.prepare(`UPDATE memory_shadow_partitions SET generation=generation+1,privacy_generation=privacy_generation+? WHERE actor_user_id=? AND custodian_id=? AND generation=?${timeGuard ? ` AND (${timeGuard.condition})` : ""}`)
      .bind(privacy ? 1 : 0,...bind,state.partition.generation,...(timeGuard?.bindings ?? [])));
    assert({ condition: "changes()=1", bindings: [] });
    for (const id of guardIds) statements.push(db.prepare("DELETE FROM memory_shadow_atomic_guards WHERE guard_id=?").bind(id));
    try {
      const results = await db.batch(statements);
      memoryAssert(results.length === statements.length && results.every((result) => result.success), "memory-commit-unconfirmed");
    } catch { throw new MemoryBoundaryError("memory-commit-rejected"); }
  }
}
