import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  adoptLegacyCostReservation,
  claimCostBudgetReservation,
  costBudgetReservation,
  readCostBudgets,
  releaseCostBudget,
  releaseCostReservationsForCorrelation,
  reserveCostBudget,
  settleCostBudget,
} from "../worker/pilot-policy.ts";
import { estimatePlannerOperationMicrousd } from "../src/model/generation-budget.ts";
import { priceTextUsageBreakdownMicrousd } from "../worker/replay-cost.ts";

function budgetDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE cost_budget_counters (scope TEXT NOT NULL, scope_id TEXT NOT NULL, period TEXT NOT NULL, used_microusd INTEGER NOT NULL DEFAULT 0, reserved_microusd INTEGER NOT NULL DEFAULT 0, hard_limit_microusd INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(scope,scope_id,period))");
  sqlite.exec("CREATE TABLE cost_budget_reservations (reservation_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL DEFAULT 'forma', stream_id TEXT NOT NULL DEFAULT '', correlation_id TEXT NOT NULL DEFAULT '', operation TEXT NOT NULL, period TEXT NOT NULL, reserved_microusd INTEGER NOT NULL, used_microusd INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, allow_user_overage INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, settled_at TEXT, updated_at TEXT NOT NULL)");

  class PreparedStatement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new PreparedStatement(this.sql, values); }
    execute(kind) {
      const statement = sqlite.prepare(this.sql);
      if (kind === "first") return statement.get(...this.values) ?? null;
      if (kind === "all") return { results: statement.all(...this.values), success: true, meta: { changes: 0 } };
      const result = statement.run(...this.values);
      return { results: [], success: true, meta: { changes: Number(result.changes ?? 0) } };
    }
    async first() { return this.execute("first"); }
    async all() { return this.execute("all"); }
    async run() { return this.execute("run"); }
  }

  const env = {
    DB: {
      prepare(sql) { return new PreparedStatement(sql); },
      async batch(statements) {
        sqlite.exec("BEGIN");
        try {
          const result = statements.map((statement) => statement.execute(/^\s*(?:SELECT|WITH)/i.test(statement.sql) ? "all" : "run"));
          sqlite.exec("COMMIT");
          return result;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    },
  };
  return { sqlite, env };
}

const authorization = (reservationId, correlationId, extra = {}) => ({
  maximumMicrousd: 20_000_000,
  allowUserOverage: false,
  reservationId,
  correlationId,
  streamId: "creative:owner",
  operation: "document-render:video",
  ...extra,
});

test("same-dollar reservations settle exactly once by owner-scoped identity rather than by amount", async () => {
  const { sqlite, env } = budgetDatabase();
  const first = await reserveCostBudget(env, "owner", 3_000_000, authorization("reservation-one", "job-one"));
  const second = await reserveCostBudget(env, "owner", 3_000_000, authorization("reservation-two", "job-two"));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal((await readCostBudgets(env, "owner")).user.reservedMicrousd, 6_000_000);

  assert.equal((await settleCostBudget(env, "owner", 3_000_000, 500_000)).settled, false, "an ambiguous legacy amount cannot settle someone else's operation");
  assert.equal((await settleCostBudget(env, "another-owner", first.reservationId, 500_000)).settled, false);
  assert.equal((await settleCostBudget(env, "owner", first.reservationId, 1_100_000)).settled, true);
  assert.equal((await settleCostBudget(env, "owner", first.reservationId, 8_000_000)).settled, false, "a replayed settlement cannot debit twice");
  assert.equal((await releaseCostBudget(env, "owner", second.reservationId)).settled, true);

  const current = await readCostBudgets(env, "owner");
  assert.equal(current.user.usedMicrousd, 1_100_000);
  assert.equal(current.workspace.usedMicrousd, 1_100_000);
  assert.equal(current.user.reservedMicrousd, 0);
  assert.equal(current.workspace.reservedMicrousd, 0);
  assert.deepEqual(sqlite.prepare("SELECT reservation_id,status,used_microusd FROM cost_budget_reservations ORDER BY reservation_id").all().map((row) => ({ ...row })), [
    { reservation_id: "reservation-one", status: "settled", used_microusd: 1_100_000 },
    { reservation_id: "reservation-two", status: "released", used_microusd: 0 },
  ]);
});

test("deterministic retries reuse their immutable month and correlation without re-reserving", async () => {
  const { sqlite, env } = budgetDatabase();
  const options = authorization("stable-reservation", "stable-job", { period: "2025-12" });
  const first = await reserveCostBudget(env, "owner", 2_000_000, options);
  const retried = await reserveCostBudget(env, "owner", 2_000_000, options);
  assert.equal(first.ok, true);
  assert.equal(retried.ok, true);
  assert.equal(retried.reused, true);
  assert.equal(sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='user' AND period='2025-12'").get().reserved_microusd, 2_000_000);
  assert.equal((await reserveCostBudget(env, "owner", 2_000_000, { ...options, correlationId: "different-job" })).ok, false);

  const settled = await settleCostBudget(env, "owner", first.reservationId, 750_000);
  assert.equal(settled.period, "2025-12");
  assert.deepEqual({ ...sqlite.prepare("SELECT used_microusd,reserved_microusd FROM cost_budget_counters WHERE scope='user' AND period='2025-12'").get() }, { used_microusd: 750_000, reserved_microusd: 0 });
  assert.equal((await readCostBudgets(env, "owner")).user.usedMicrousd, 0, "a previous-month operation must not silently charge the current month");
});

test("monthly user and organization hard caps remain independently enforceable", async () => {
  const { sqlite, env } = budgetDatabase();
  const current = await readCostBudgets(env, "owner");
  assert.equal(current.user.limitMicrousd, 100_000_000);
  assert.equal(current.workspace.limitMicrousd, 1_000_000_000);

  sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=? WHERE scope='user' AND scope_id=?").run(99_500_000, "owner");
  assert.deepEqual(await reserveCostBudget(env, "owner", 1_000_000, authorization("over-user", "over-user")), { ok: false, scope: "user" });
  const approvedOverage = await reserveCostBudget(env, "owner", 1_000_000, authorization("approved-overage", "approved-overage", { allowUserOverage: true }));
  assert.equal(approvedOverage.ok, true);
  assert.equal(approvedOverage.userOverageMicrousd, 500_000);

  sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=? WHERE scope='workspace'").run(999_500_000);
  assert.deepEqual(await reserveCostBudget(env, "owner", 1_000_000, authorization("over-organization", "over-organization", { allowUserOverage: true })), { ok: false, scope: "workspace" });
});

test("correlation cancellation releases only the matching account and operation", async () => {
  const { env } = budgetDatabase();
  await reserveCostBudget(env, "owner", 1_000_000, authorization("matching", "cancel-me"));
  await reserveCostBudget(env, "owner", 1_000_000, authorization("remaining", "keep-me"));
  await reserveCostBudget(env, "other-owner", 1_000_000, authorization("other-account", "cancel-me"));

  assert.equal(await releaseCostReservationsForCorrelation(env, "owner", "cancel-me"), 1);
  assert.equal((await costBudgetReservation(env, "owner", "matching")).status, "released");
  assert.equal((await costBudgetReservation(env, "owner", "remaining")).status, "active");
  assert.equal((await costBudgetReservation(env, "other-owner", "other-account")).status, "active");
});

test("the additive migration can safely run after an already-initialized runtime", async () => {
  const { sqlite } = budgetDatabase();
  const migration = await readFile(new URL("../drizzle/0010_simple_alex_wilder.sql", import.meta.url), "utf8");
  assert.doesNotThrow(() => sqlite.exec(migration));
  assert.doesNotThrow(() => sqlite.exec(migration));
  const indexes = sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND name LIKE 'idx_cost_budget_reservations_%' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(indexes, ["idx_cost_budget_reservations_owner_correlation", "idx_cost_budget_reservations_owner_status_period"]);
});

test("budget gates use the same configured-model estimate as actual chat and adaptive reservations", () => {
  for (const model of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "unknown-model"]) {
    for (const operation of ["chat", "structure_adaptive"]) {
      const usage = operation === "chat" ? { inputTokens: 10_400, outputTokens: 1_600, totalTokens: 12_000 } : { inputTokens: 10_600, outputTokens: 1_400, totalTokens: 12_000 };
      assert.equal(estimatePlannerOperationMicrousd(model, operation), priceTextUsageBreakdownMicrousd(model, usage).totalMicrousd, `${model} ${operation}`);
    }
  }
});

test("proven pre-migration dollar reservations can be adopted and released without double-reserving", async () => {
  const { sqlite, env } = budgetDatabase();
  const period = (await readCostBudgets(env, "owner")).period;
  sqlite.prepare("UPDATE cost_budget_counters SET reserved_microusd=? WHERE period=?").run(750_000, period);
  const adopted = await adoptLegacyCostReservation(env, "owner", { reservationId: "legacy-dollar-reservation", amountMicrousd: 750_000, period, streamId: "creative:owner", correlationId: "legacy-correlation", operation: "document-render:video" });
  assert.equal(adopted, true);
  assert.equal((await readCostBudgets(env, "owner")).user.reservedMicrousd, 750_000, "adoption must not increment a preexisting reserved projection");
  assert.equal(await releaseCostReservationsForCorrelation(env, "owner", "legacy-correlation"), 1);
  const released = await readCostBudgets(env, "owner");
  assert.equal(released.user.reservedMicrousd, 0);
  assert.equal(released.workspace.reservedMicrousd, 0);
});

test("unproven historical reservations cannot consume an unrelated account or organization reservation", async () => {
  const { sqlite, env } = budgetDatabase();
  const period = (await readCostBudgets(env, "owner")).period;
  sqlite.prepare("UPDATE cost_budget_counters SET reserved_microusd=? WHERE scope='user'").run(400_000);
  sqlite.prepare("UPDATE cost_budget_counters SET reserved_microusd=? WHERE scope='workspace'").run(400_000);
  assert.equal(await adoptLegacyCostReservation(env, "owner", { reservationId: "fake-history", amountMicrousd: 600_000, period, streamId: "creative:owner", correlationId: "fake-history", operation: "document-render:video" }), false);
  assert.equal((await readCostBudgets(env, "owner")).user.reservedMicrousd, 400_000);
});

test("an active dollar reservation authorizes exactly one provider execution", async () => {
  const { env } = budgetDatabase();
  const reserved = await reserveCostBudget(env, "owner", 900_000, authorization("one-execution", "one-execution"));
  assert.equal(await claimCostBudgetReservation(env, "owner", reserved.reservationId), true);
  assert.equal(await claimCostBudgetReservation(env, "owner", reserved.reservationId), false);
  assert.equal((await costBudgetReservation(env, "owner", reserved.reservationId)).status, "executing");
  assert.equal((await settleCostBudget(env, "owner", reserved.reservationId, 450_000)).settled, true);
  assert.equal((await readCostBudgets(env, "owner")).user.usedMicrousd, 450_000);
});
