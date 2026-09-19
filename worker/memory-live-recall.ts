import { memoryEventAction, rollingLiveMemoryConsumption } from "../src/model/memory-observations.ts";
import { MEMORY_RECALL_LIFETIME } from "../src/model/memory-lifetime.ts";
import type { MemoryAssistedOutcomes } from "../src/model/memory-assisted-outcomes.ts";
import type { MemorySavedOutputs } from "../src/model/memory-saved-outputs.ts";
import { AssistantContextReadWitness } from "./assistant-context-source.ts";
import { liveMemoryAuthority, type LiveMemoryEnrollment } from "./memory-live-authority.ts";
import { readNativeDocumentMemory, type NativeDocumentMemoryContext } from "./memory-live-context.ts";
import { liveMemoryEnabled } from "./memory-live-store.ts";
import { liveMemorySourceQuery } from "./memory-live-sources.ts";
import { nativeMemoryGrantDeadline } from "./memory-native-deadlines.ts";
import { nativeMemoryOutcomesSchemaQuery, nativeMemoryOutcomesQuery, nativeMemoryOutcomesValue } from "./memory-native-outcomes.ts";
import { nativeMemorySavedOutputsSchemaQuery, nativeMemorySavedOutputsQuery, nativeMemorySavedOutputsValue } from "./memory-native-saved-outputs.ts";
import { nativeMemoryConsumptionSchemaQuery, nativeMemoryConsumptionQuery, nativeMemoryConsumptionValue } from "./memory-native-consumption.ts";
import type { ConsumptionProjection } from "./memory-consumption-types.ts";
import type { PilotUser } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";
import { captureNativeArtifactConsumption } from "./memory-native-artifact-consumption.ts";
import { MEMORY_CONSUMPTION_V2, MEMORY_CONSUMPTION_V3, MEMORY_CONSUMPTION_V4, parseMemoryConsumptionV2, parseMemoryConsumptionV3, parseMemoryConsumptionV4, type MemoryConsumptionV2, type MemoryConsumptionV2Source } from "../src/model/memory-consumption-v2.ts";

const NOTE = "Observed actions are not inferred preferences; excerpts are truncated and access-filtered.";
const canonicalEnrollment = (value: LiveMemoryEnrollment) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));

/** Preserve the existing strict client contract; do not expose private capture identities or SQL.
 * Activity counts describe this bounded selection, not sessions, preferences or complete history. */
export function nativeMemoryRecallView(value: NativeDocumentMemoryContext, retentionDays: number,
  assistedOutcomes?: MemoryAssistedOutcomes, savedOutputs?: MemorySavedOutputs, consumptionEpisodes?: ConsumptionProjection | MemoryConsumptionV2) {
  const rows = [
    ...value.actions.map(row => ({ ...row, type: row.type })),
    ...value.conversationPairs.map(row => ({ eventId: row.eventId, sequence: row.sequence,
      type: "AssistantReasoned", blockId: null, recordedAt: row.recordedAt, validUntil: row.validUntil })),
  ].sort((left, right) => left.sequence - right.sequence);
  const sources = rows.map(({ eventId, type, blockId, recordedAt, validUntil }) => ({ eventId, type, blockId, recordedAt, validUntil }));
  const counts = new Map<string, number>();
  for (const source of sources) {
    const action = source.type === "AssistantReasoned" ? "conversation" : memoryEventAction(source.type);
    if (action) counts.set(action, (counts.get(action) ?? 0) + 1);
  }
  const excerpts = value.conversationPairs.map(row => ({ sourceEventId: row.eventId, recordedAt: row.recordedAt,
    user: row.user, assistant: row.assistant }));
  const lifetime = { version: MEMORY_RECALL_LIFETIME, ...value.lifetime };
  return {
    mode: "live-reference-memory" as const, lifetime,
    scope: { organizationId: value.scope.organizationId, projectId: value.scope.projectId, documentId: value.scope.documentId },
    treatment: "untrusted-historical-evidence" as const, method: "extractive-not-semantic" as const,
    consumption: Object.fromEntries(counts),
    ...(assistedOutcomes ? { assistedOutcomes } : {}),
    ...(savedOutputs ? { savedOutputs } : {}),
    ...(consumptionEpisodes ? { consumptionEpisodes } : {}),
    rollingConsumption: rollingLiveMemoryConsumption(sources, lifetime, value.coverage.since, retentionDays),
    rollingConversation: { summary: excerpts.slice(0, -2), recent: excerpts.slice(-2), completeFromStart: false as const },
    coverage: { since: value.coverage.since, throughSequence: value.coverage.throughSequence,
      remainingThroughSequence: value.coverage.remainingThroughSequence, bounded: true as const, sourceCount: sources.length },
    sources, note: NOTE,
  };
}

/** One response, with no await after the final source/authority proof.
 * The original authenticated HTTP principal participates; a later DB principal cannot silently
 * replace a request's expired grant. This does not register a route or authorize enrollment. */
export async function recallLiveMemoryResponse(env: WorkerEnv, input: LiveMemoryEnrollment, requestPrincipal: PilotUser,
  options: { assistedOutcomes?: boolean; savedOutputs?: boolean; consumptionEpisodes?: boolean | typeof MEMORY_CONSUMPTION_V2 | typeof MEMORY_CONSUMPTION_V3 | typeof MEMORY_CONSUMPTION_V4 } = {}): Promise<Response> {
  const includeOutcomes = options.assistedOutcomes === true;
  const includeSavedOutputs = options.savedOutputs === true;
  const includeConsumption = options.consumptionEpisodes === true || options.consumptionEpisodes === MEMORY_CONSUMPTION_V2 || options.consumptionEpisodes === MEMORY_CONSUMPTION_V3 || options.consumptionEpisodes === MEMORY_CONSUMPTION_V4;
  const captured = structuredClone({ enrollment: input, principal: requestPrincipal });
  const { enrollment, principal } = captured;
  if (principal.fictional || !principal.authorizationSnapshot || principal.userId !== enrollment.actor_user_id
    || !liveMemoryEnabled(env, principal.userId)) throw new Error("memory-unavailable");
  const witness = new AssistantContextReadWitness<ReturnType<typeof nativeMemoryRecallView>>(env);
  const query = { sql: "SELECT * FROM memory_live_enrollments WHERE enrollment_id=? AND actor_user_id=? AND revision=?",
    bindings: [enrollment.enrollment_id, principal.userId, enrollment.revision] };
  const statement = env.DB.prepare(query.sql).bind(...query.bindings);
  const initial = structuredClone(await env.DB.batch<LiveMemoryEnrollment>([statement]));
  if (initial.length !== 1 || !initial[0].success || initial[0].results.length !== 1
    || canonicalEnrollment(initial[0].results[0]) !== canonicalEnrollment(enrollment)) throw new Error("memory-enrollment-changed");
  witness.observe([statement], initial, [query]);
  const authority = await liveMemoryAuthority(env, enrollment);
  if (!authority) throw new Error("memory-access-changed");
  // This original authority also supplies the optional provenance queries. Keep its
  // deadline across the following native-context await, not just a later grant.
  if (includeOutcomes || includeSavedOutputs || includeConsumption) {
    const provenanceGrantDeadline = nativeMemoryGrantDeadline(authority.principal, Date.now());
    if (provenanceGrantDeadline === undefined) throw new Error("memory-access-changed");
    witness.require({ sql: authority.guard.condition, bindings: [...authority.guard.bindings] });
    witness.before(provenanceGrantDeadline);
  }
  const value = await readNativeDocumentMemory(env, { principal, binding: authority.binding }, witness);
  if (!value) throw new Error("memory-unavailable");
  // Provenance evidence is inspector-only. Do not add it to the native value used
  // to create saved answers: those durable origins do not yet carry proposal
  // receipt/output dependencies. All references stay inside this exact source window.
  let outcomes: ReturnType<typeof nativeMemoryOutcomesValue> = null;
  let savedOutputs: ReturnType<typeof nativeMemorySavedOutputsValue> = null;
  let consumptionEpisodes: ConsumptionProjection | null = null;
  let consumptionV2: MemoryConsumptionV2 | null = null;
  const selected = [
    ...value.actions,
    ...value.conversationPairs.map(row => ({ ...row, type: "AssistantReasoned", blockId: null })),
  ].sort((left, right) => left.sequence - right.sequence);
  // A versioned request keeps older strict clients and their original proof
  // path unchanged. Older servers may omit the optional projection safely.
  if (includeOutcomes) {
    const schemaQuery = nativeMemoryOutcomesSchemaQuery();
    const schemaStatement = env.DB.prepare(schemaQuery.sql).bind(...schemaQuery.bindings);
    const schema = structuredClone(await env.DB.batch<Record<string, unknown>>([schemaStatement]));
    if (schema.length !== 1 || !schema[0].success || schema[0].results.length !== 1) throw new Error("memory-unavailable");
    witness.observe([schemaStatement], schema, [schemaQuery]);
    if (schema[0].results[0].ready === 1) {
      const query = nativeMemoryOutcomesQuery(enrollment, liveMemorySourceQuery(enrollment, authority), selected);
      const statement = env.DB.prepare(query.sql).bind(...query.bindings);
      const rows = structuredClone(await env.DB.batch<Record<string, unknown>>([statement]));
      if (rows.length !== 1 || !rows[0].success) throw new Error("memory-unavailable");
      outcomes = nativeMemoryOutcomesValue(rows[0].results, enrollment, selected, value.lifetime.checkedAt, value.lifetime.validUntil);
      if (outcomes) {
        witness.observe([statement], rows, [query]);
        witness.before(outcomes.validUntil);
      }
    }
  }
  if (includeSavedOutputs) {
    const schemaQuery = nativeMemorySavedOutputsSchemaQuery();
    const schemaStatement = env.DB.prepare(schemaQuery.sql).bind(...schemaQuery.bindings);
    const schema = structuredClone(await env.DB.batch<Record<string, unknown>>([schemaStatement]));
    if (schema.length !== 1 || !schema[0].success || schema[0].results.length !== 1) throw new Error("memory-unavailable");
    witness.observe([schemaStatement], schema, [schemaQuery]);
    if (schema[0].results[0].ready === 1) {
      const query = nativeMemorySavedOutputsQuery(enrollment, liveMemorySourceQuery(enrollment, authority), selected);
      const statement = env.DB.prepare(query.sql).bind(...query.bindings);
      const rows = structuredClone(await env.DB.batch<Record<string, unknown>>([statement]));
      if (rows.length !== 1 || !rows[0].success) throw new Error("memory-unavailable");
      savedOutputs = nativeMemorySavedOutputsValue(rows[0].results, enrollment, selected, value.lifetime.checkedAt, value.lifetime.validUntil);
      if (savedOutputs) {
        witness.observe([statement], rows, [query]);
        witness.before(savedOutputs.validUntil);
      }
    }
  }
  // An absent/uncertifiable projection is unavailable, not zero outcomes. A
  // valid projection (including an empty one) has an exact replayed query.
  let validUntil = value.lifetime.validUntil;
  for (const projection of [outcomes, savedOutputs]) {
    if (projection && Date.parse(projection.validUntil) < Date.parse(validUntil)) validUntil = projection.validUntil;
  }
  const artifactConsumption = options.consumptionEpisodes === MEMORY_CONSUMPTION_V2 || options.consumptionEpisodes === MEMORY_CONSUMPTION_V3 || options.consumptionEpisodes === MEMORY_CONSUMPTION_V4
    ? await captureNativeArtifactConsumption(env, enrollment, authority, { after: 0, through: enrollment.cursor_sequence, remembered: true, historical: options.consumptionEpisodes !== MEMORY_CONSUMPTION_V2, governed: options.consumptionEpisodes === MEMORY_CONSUMPTION_V4 }, witness) : null;
  for (const source of artifactConsumption?.sources ?? []) if (source.validUntil < validUntil) validUntil = source.validUntil;
  if (includeConsumption) {
    const schemaQuery = nativeMemoryConsumptionSchemaQuery();
    const schemaStatement = env.DB.prepare(schemaQuery.sql).bind(...schemaQuery.bindings);
    const schema = structuredClone(await env.DB.batch<Record<string, unknown>>([schemaStatement]));
    if (schema.length !== 1 || !schema[0].success || schema[0].results.length !== 1
      || schema[0].results[0].ready !== 1) throw new Error("memory-unavailable");
    witness.observe([schemaStatement], schema, [schemaQuery]);
    // Copy exactly the source descriptor: conversation rows also contain private
    // excerpts, which neither this bridge's input nor its proof should receive.
    const consumptionSources = selected.map(({ eventId, sequence, type, blockId, recordedAt, validUntil }) =>
      ({ eventId, sequence, type, blockId, recordedAt, validUntil }));
    const query = nativeMemoryConsumptionQuery(enrollment, liveMemorySourceQuery(enrollment, authority), consumptionSources);
    const statement = env.DB.prepare(query.sql).bind(...query.bindings);
    // Database/JSON errors abort this response; never substitute an empty set.
    const rows = structuredClone(await env.DB.batch<Record<string, unknown>>([statement]));
    if (rows.length !== 1 || !rows[0].success) throw new Error("memory-unavailable");
    consumptionEpisodes = nativeMemoryConsumptionValue(rows[0].results, enrollment, consumptionSources,
      value.lifetime.checkedAt, validUntil);
    if (!consumptionEpisodes) throw new Error("memory-unavailable");
    // Empty projections also bind the exact all-stream negative-edge/absence
    // proof. Native admission and every selected descriptor replay before send.
    witness.observe([statement], rows, [query]);
    witness.before(consumptionEpisodes.validUntil);
    validUntil = consumptionEpisodes.validUntil;
  }
  if (artifactConsumption && consumptionEpisodes) {
    const candidates: MemoryConsumptionV2Source[] = consumptionEpisodes.episodes.map(episode => {
      const source = selected[episode.observations[0].sourceIndex];
      return { eventId: source.eventId, type: "DocumentViewVisited", recordedAt: source.recordedAt, validUntil: source.validUntil,
        target: { kind: "document", documentId: enrollment.document_id } };
    });
    candidates.push(...artifactConsumption.sources.map(source => ({ eventId: source.eventId, type: "DocumentArtifactViewed" as const,
      recordedAt: source.recordedAt, validUntil: source.validUntil, target: source.target })));
    candidates.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.eventId.localeCompare(b.eventId));
    const sources = candidates.slice(-64), projection: MemoryConsumptionV2 = {
      version: options.consumptionEpisodes === MEMORY_CONSUMPTION_V4 ? MEMORY_CONSUMPTION_V4 : options.consumptionEpisodes === MEMORY_CONSUMPTION_V3 ? MEMORY_CONSUMPTION_V3 : MEMORY_CONSUMPTION_V2, treatment: "descriptive-consumption", validUntil, sources,
      episodes: sources.map((source, sourceIndex) => ({ episodeId: null,
        observations: [{ sourceIndex, kind: source.type === "DocumentViewVisited" ? "visit" : "viewer-open" }],
        firstRecordedAt: source.recordedAt, lastRecordedAt: source.recordedAt, validUntil: source.validUntil, independentEvidence: false })),
      coverage: { eligibleSourceCount: sources.length, observationCount: sources.length, unavailableArtifactSourceCount: artifactConsumption.unavailableSourceCount,
        completeHistory: false, bounded: true, truncated: artifactConsumption.truncated || candidates.length > sources.length },
      attention: "not-measured", comprehension: "not-measured", inferredPreferences: false,
    };
    consumptionV2 = (options.consumptionEpisodes === MEMORY_CONSUMPTION_V4 ? parseMemoryConsumptionV4 : options.consumptionEpisodes === MEMORY_CONSUMPTION_V3 ? parseMemoryConsumptionV3 : parseMemoryConsumptionV2)(projection, { version: MEMORY_RECALL_LIFETIME, checkedAt: value.lifetime.checkedAt, validUntil }, enrollment.document_id,
      { since: enrollment.enrolled_at, expiresAt: enrollment.expires_at });
    if (!consumptionV2) throw new Error("memory-consumption-unavailable");
    witness.before(validUntil);
  }
  const view = nativeMemoryRecallView({ ...value, lifetime: { ...value.lifetime, validUntil } },
    enrollment.retention_days, outcomes?.value, savedOutputs?.value, consumptionV2 ?? consumptionEpisodes ?? undefined);
  witness.seal(view);
  const statements = witness.statements();
  if (!statements.length) throw new Error("memory-unavailable");
  // Freeze the actual wire bytes before the final database await. No mutable view is returned.
  const serialized = JSON.stringify(witness.context());
  if (new TextEncoder().encode(serialized).byteLength > 65_536) throw new Error("memory-response-too-large");
  const response = new Response(serialized, { headers: { "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store", "vary": "Cookie, oai-authenticated-user-id, oai-authenticated-user-email" } });
  const final = await env.DB.batch<Record<string, unknown>>(statements);
  if (!liveMemoryEnabled(env, principal.userId) || !witness.matches(final)) throw new Error("memory-source-changed");
  return response;
}
