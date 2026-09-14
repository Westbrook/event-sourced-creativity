import { SCENE_SOURCE_GENERATION_TABLES } from "../db/scene-source-generation-tables.ts";
import { SCENE_SOURCE_GENERATION_TRIGGERS, SCENE_SOURCE_GENERATION_MAX, SCENE_SOURCE_EPOCH_ACTIVATE_SQL, SCENE_SOURCE_EPOCH_ADVANCE_SQL } from "../db/scene-source-generations.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";
import type { WorkerEnv } from "./runtime.ts";

type Scope = Readonly<{ streamId: string; projectAccessId?: string }>;
export type SceneSourceVersion = Readonly<Scope & { instanceNonce: string; epoch: number; streamGeneration: number; projectGeneration: number }>;
const requiredSchema = JSON.stringify([...SCENE_SOURCE_GENERATION_TABLES,
  ...SCENE_SOURCE_GENERATION_TRIGGERS.map(value => ({ ...value, type: "trigger" }))]);
function unavailable(): never { throw new Error("scene_source_version_unavailable"); }
const generation = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < SCENE_SOURCE_GENERATION_MAX;
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).length <= 160;
function scopeOf(scope: Scope): Scope {
  if (!identifier(scope.streamId) || scope.projectAccessId !== undefined && !identifier(scope.projectAccessId)) unavailable();
  return Object.freeze({ streamId: scope.streamId, ...(scope.projectAccessId === undefined ? {} : { projectAccessId: scope.projectAccessId }) });
}
export function sceneSourceSchemaAssertion(): OutputSqlAssertion {
  return { sql: `WITH expected AS (SELECT value FROM json_each(?)) SELECT NOT EXISTS(SELECT 1 FROM expected
    WHERE NOT EXISTS(SELECT 1 FROM sqlite_schema actual WHERE actual.name=json_extract(expected.value,'$.name')
      AND actual.type=json_extract(expected.value,'$.type') AND actual.sql=json_extract(expected.value,'$.sql')))`, bindings: [requiredSchema] };
}
const assertStatement = (env: Pick<WorkerEnv, "DB">, assertion: OutputSqlAssertion) =>
  env.DB.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE json('scene_source_schema_unavailable') END AS current`).bind(...assertion.bindings ?? []);

/** No source replay, certificate, or current-generation recapture occurs here.
 * All data-changing rewrites must include these guards in their SAME batch. */
export async function sceneSourceRebuildStatements(env: Pick<WorkerEnv, "DB">) {
  const found = await env.DB.prepare("SELECT name FROM sqlite_schema WHERE name IN ('scene_source_epoch','scene_source_generations')").all<{name: string}>();
  if (found.success !== true || !Array.isArray(found.results)) unavailable();
  if (!found.results.length) return { before: [assertStatement(env, {
    sql: "NOT EXISTS(SELECT 1 FROM sqlite_schema WHERE name IN ('scene_source_epoch','scene_source_generations'))",
    bindings: [],
  })], after: [] };
  if (found.results.length !== 2) unavailable();
  const privateTriggers = SCENE_SOURCE_GENERATION_TRIGGERS.filter(value => value.name.startsWith("scene_source_event_private_payloads_"));
  // These triggers reference events from another table. SQLite validates them
  // during ALTER TABLE, so detach/recreate within the same epoch-changing batch.
  return { before: [assertStatement(env, sceneSourceSchemaAssertion()), env.DB.prepare(SCENE_SOURCE_EPOCH_ACTIVATE_SQL),
    env.DB.prepare(SCENE_SOURCE_EPOCH_ADVANCE_SQL), ...privateTriggers.map(value => env.DB.prepare(`DROP TRIGGER ${value.name}`))],
    after: [...privateTriggers.map(value => env.DB.prepare(value.sql)), assertStatement(env, sceneSourceSchemaAssertion())] };
}

/** Called only by an explicit source-preparation operation. Activation inserts
 * one operational nonce after schema certification, never an authored record. */
export async function captureSceneSourceVersion(env: Pick<WorkerEnv, "DB">, input: Scope): Promise<SceneSourceVersion> {
  const scope = scopeOf(input);
  const result = await env.DB.batch<Record<string, unknown>>([
    assertStatement(env, sceneSourceSchemaAssertion()), env.DB.prepare(SCENE_SOURCE_EPOCH_ACTIVATE_SQL),
    env.DB.prepare(`SELECT instance_nonce,generation AS epoch,
      COALESCE((SELECT generation FROM scene_source_generations WHERE scope_kind='stream' AND scope_key=?),0) AS stream_generation,
      COALESCE((SELECT generation FROM scene_source_generations WHERE scope_kind='project' AND scope_key=?),0) AS project_generation
      FROM scene_source_epoch WHERE singleton=1 AND schema_version=1`).bind(scope.streamId, scope.projectAccessId ?? null),
  ]);
  if (!Array.isArray(result) || result.length !== 3 || [0, 1, 2].some(index => result[index]?.success !== true)
    || !Array.isArray(result[0]!.results) || result[0]!.results.length !== 1 || result[0]!.results[0]?.current !== 1
    || !Array.isArray(result[2]!.results) || result[2]!.results.length !== 1) unavailable();
  const row = result[2]!.results[0]!;
  if (typeof row.instance_nonce !== "string" || !/^[a-f0-9]{32}$/u.test(row.instance_nonce)
    || !generation(row.epoch) || row.epoch < 1 || !generation(row.stream_generation) || !generation(row.project_generation)) unavailable();
  return Object.freeze({ ...scope, instanceNonce: row.instance_nonce, epoch: row.epoch,
    streamGeneration: row.stream_generation, projectGeneration: row.project_generation });
}

/** Reuse these original predicates unchanged at every source page and final
 * consequence boundary. A mismatch is never permission to capture a new token. */
export function sceneSourceVersionAssertions(input: SceneSourceVersion): readonly OutputSqlAssertion[] {
  const scope = scopeOf(input);
  if (!/^[a-f0-9]{32}$/u.test(input.instanceNonce) || !generation(input.epoch) || input.epoch < 1
    || !generation(input.streamGeneration) || !generation(input.projectGeneration)
    || !scope.projectAccessId && input.projectGeneration !== 0) unavailable();
  const assertions: OutputSqlAssertion[] = [sceneSourceSchemaAssertion(), {
    sql: `EXISTS(SELECT 1 FROM scene_source_epoch WHERE singleton=1 AND schema_version=1 AND instance_nonce=? AND generation=?)
      AND COALESCE((SELECT generation FROM scene_source_generations WHERE scope_kind='stream' AND scope_key=?),0)=?
      AND COALESCE((SELECT generation FROM scene_source_generations WHERE scope_kind='project' AND scope_key=?),0)=?`,
    bindings: [input.instanceNonce, input.epoch, scope.streamId, input.streamGeneration, scope.projectAccessId ?? null, input.projectGeneration],
  }];
  // The shared SQL interface predates frozen witnesses; preserve its runtime
  // contract while making this particular witness deeply immutable.
  return Object.freeze(assertions.map(value => Object.freeze({ ...value, bindings: Object.freeze([...value.bindings ?? []]) }) as unknown as OutputSqlAssertion));
}
