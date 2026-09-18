import { isDraftId } from "../src/experiences/intake.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

export type SponsorIntakeClassification =
  | { kind: "ordinary"; guard: BudgetReservationGuard }
  | { kind: "sponsored" }
  | { kind: "unavailable" };

const table = "experience_sponsor_intakes";
const catalog = "lower(name)=? AND type IN('table','view')";
// JSON null, malformed marker values and orphan markers all close the ordinary
// path. Invalid ordinary JSON alone is not evidence of sponsored custody.
const marker = "CASE WHEN json_valid(content) THEN json_type(content,'$.sponsor_intake') IS NOT NULL ELSE 0 END";

/** Negative classification only. A raw sidecar or marker can refuse ordinary
 * access but cannot authorize a sponsored read, write, payer or provider. No
 * schema is installed, no private content is returned and no state is cached. */
export async function classifySponsorIntakeDraft(env: WorkerEnv, draftId: string): Promise<SponsorIntakeClassification> {
  if (!isDraftId(draftId)) return { kind: "unavailable" };
  const database = env.DB;
  try {
    const schema = await database.prepare(`SELECT type,sql FROM sqlite_master WHERE ${catalog}`).bind(table)
      .first<{ type: string; sql: string | null }>();
    if (env.DB !== database || schema && (schema.type !== "table" || typeof schema.sql !== "string")) return { kind: "unavailable" };
    if (schema && await database.prepare("SELECT 1 AS sponsored FROM experience_sponsor_intakes WHERE draft_id=? LIMIT 1").bind(draftId).first())
      return env.DB === database ? { kind: "sponsored" } : { kind: "unavailable" };
    if (env.DB !== database) return { kind: "unavailable" };
    const marked = await database.prepare(`SELECT 1 AS sponsored FROM private_content WHERE content_id=? AND (${marker}) LIMIT 1`)
      .bind(draftId).first();
    if (env.DB !== database) return { kind: "unavailable" };
    if (marked) return { kind: "sponsored" };
    // The absent branch must never reference the absent table, even in CASE:
    // SQLite resolves every table before evaluating a condition.
    const guard: BudgetReservationGuard = schema ? {
      sql: `EXISTS(SELECT 1 FROM sqlite_master WHERE ${catalog} AND type='table' AND sql=?)
        AND NOT EXISTS(SELECT 1 FROM experience_sponsor_intakes WHERE draft_id=?)
        AND NOT EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND (${marker}))`,
      bindings: [table, schema.sql!, draftId, draftId],
    } : {
      sql: `NOT EXISTS(SELECT 1 FROM sqlite_master WHERE ${catalog})
        AND NOT EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND (${marker}))`,
      bindings: [table, draftId],
    };
    Object.freeze(guard.bindings); Object.freeze(guard);
    return Object.freeze({ kind: "ordinary", guard });
  } catch { return { kind: "unavailable" }; }
}
