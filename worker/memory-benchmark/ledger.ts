/** Detached, default-off accounting primitive; never invokes a provider. */
export const BENCHMARK_MAXIMUM_MICRO_USD = 10_000_000;
export const BENCHMARK_MAXIMUM_GRANT_MS = 86_400_000;
const MAX_RESULT_BYTES = 1_048_576;

export interface BenchmarkD1Result<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
}
export interface BenchmarkD1Statement {
  bind(...values: (string | number | null)[]): BenchmarkD1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<BenchmarkD1Result<T>>;
}
/** The implementation requires D1's documented atomic batch semantics. */
export interface BenchmarkD1Database {
  prepare(sql: string): BenchmarkD1Statement;
  batch<T = Record<string, unknown>>(statements: BenchmarkD1Statement[]): Promise<BenchmarkD1Result<T>[]>;
}
export interface BenchmarkSnapshot {
  experimentId: string;
  planHash: string;
  principalId: string;
  payerId: string;
  period: string;
  maximumMicroUsd: number;
  spentMicroUsd: number;
  reservedMicroUsd: number;
  status: 'active' | 'halted' | 'complete';
  nextOrdinal: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  haltReason: string | null;
}
export interface BenchmarkInitialize {
  experimentId: string;
  planHash: string;
  principalId: string;
  payerId: string;
  period: string;
  expiresAt: number;
  now: number;
}
export interface BenchmarkReservation {
  experimentId: string;
  planHash: string;
  principalId: string;
  payerId: string;
  operationId: string;
  requestHash: string;
  ordinal: number;
  maximumMicroUsd: number;
  now: number;
}
export interface BenchmarkSettlement {
  experimentId: string;
  operationId: string;
  requestHash: string;
  actualMicroUsd: number;
  resultJson: string;
  now: number;
}
export interface BenchmarkDispatchClaim {
  experimentId: string;
  operationId: string;
  requestHash: string;
  now: number;
}
export interface BenchmarkStoredResult {
  operationId: string;
  ordinal: number;
  requestHash: string;
  actualMicroUsd: number;
  resultJson: string;
}
type Row = Record<string, unknown>;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
// UTC YYYY-MM bindings deliberately exclude expanded ISO years.
const timestamp = (value: unknown): value is number => integer(value) && value <= 253_402_300_799_999;
const periodAt = (now: number): string => new Date(now).toISOString().slice(0, 7);
const failure = (code: string): Error => new Error(`memory_benchmark_${code}`);

function validResult(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_RESULT_BYTES || new TextEncoder().encode(value).byteLength > MAX_RESULT_BYTES) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return false;
    const pending: { value: unknown; depth: number }[] = [{ value: parsed, depth: 0 }];
    let visited = 0;
    while (pending.length) {
      const item = pending.pop()!;
      if (++visited > 200_000 || item.depth > 64) return false;
      if (typeof item.value === 'number' && !Number.isFinite(item.value)) return false;
      if (item.value && typeof item.value === 'object') {
        for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
      }
    }
    return true;
  } catch { return false; }
}

function snapshot(row: Row): BenchmarkSnapshot {
  const money = [row.maximum_micro_usd, row.spent_micro_usd, row.reserved_micro_usd];
  if (!identifier(row.experiment_id) || !hash(row.plan_hash) || !identifier(row.principal_id)
    || !identifier(row.payer_id) || typeof row.period !== 'string' || !/^\d{4}-\d{2}$/.test(row.period)
    || !money.every(integer) || row.maximum_micro_usd !== BENCHMARK_MAXIMUM_MICRO_USD
    || (row.spent_micro_usd as number) + (row.reserved_micro_usd as number) > BENCHMARK_MAXIMUM_MICRO_USD
    || !integer(row.next_ordinal) || !timestamp(row.created_at) || !timestamp(row.updated_at)
    || !timestamp(row.expires_at) || row.expires_at <= row.created_at
    || row.expires_at - row.created_at > BENCHMARK_MAXIMUM_GRANT_MS || row.updated_at < row.created_at
    || !['active', 'halted', 'complete'].includes(String(row.status))
    || (row.halt_reason !== null && typeof row.halt_reason !== 'string')) throw failure('invalid_snapshot');
  return {
    experimentId: row.experiment_id, planHash: row.plan_hash, principalId: row.principal_id,
    payerId: row.payer_id, period: row.period, maximumMicroUsd: row.maximum_micro_usd as number,
    spentMicroUsd: row.spent_micro_usd as number, reservedMicroUsd: row.reserved_micro_usd as number,
    status: row.status as BenchmarkSnapshot['status'], nextOrdinal: row.next_ordinal,
    expiresAt: row.expires_at, createdAt: row.created_at, updatedAt: row.updated_at,
    haltReason: row.halt_reason as string | null,
  };
}

// Cross-check both accounting totals and the contiguous, append-only ordinal sequence.
const integrity = `e.spent_micro_usd = COALESCE((SELECT SUM(actual_micro_usd) FROM memory_benchmark_operations o WHERE o.experiment_id=e.experiment_id AND o.state='settled'), 0)
  AND e.reserved_micro_usd = COALESCE((SELECT SUM(maximum_micro_usd) FROM memory_benchmark_operations o WHERE o.experiment_id=e.experiment_id AND o.state!='settled'), 0)
  AND e.next_ordinal = (SELECT COUNT(*) FROM memory_benchmark_operations o WHERE o.experiment_id=e.experiment_id)
  AND e.next_ordinal = COALESCE((SELECT MAX(ordinal)+1 FROM memory_benchmark_operations o WHERE o.experiment_id=e.experiment_id), 0)`;

export class BenchmarkLedger {
  private readonly db: BenchmarkD1Database;
  constructor(db: BenchmarkD1Database) { this.db = db; }

  private statement(sql: string, ...values: (string | number | null)[]): BenchmarkD1Statement {
    return this.db.prepare(sql).bind(...values);
  }

  private assertion(predicate: string, ...values: (string | number | null)[]): BenchmarkD1Statement {
    return this.statement(`INSERT INTO memory_benchmark_assertions(passed) SELECT CASE WHEN (${predicate}) THEN 1 ELSE 0 END`, ...values);
  }

  private async batch(statements: BenchmarkD1Statement[]): Promise<void> {
    const result = await this.db.batch(statements);
    if (!Array.isArray(result) || result.length !== statements.length || result.some(item => item?.success !== true)) throw failure('batch_unacknowledged');
  }

  async initialize(input: BenchmarkInitialize): Promise<BenchmarkSnapshot> {
    const { experimentId, planHash, principalId, payerId, period, expiresAt, now } = input;
    if (!identifier(experimentId) || !hash(planHash) || !identifier(principalId) || !identifier(payerId)
      || !timestamp(now) || !timestamp(expiresAt) || expiresAt <= now
      || expiresAt - now > BENCHMARK_MAXIMUM_GRANT_MS || period !== periodAt(now)) throw failure('invalid_grant');
    try {
      await this.batch([
        this.statement(`INSERT INTO memory_benchmark_experiments
          (experiment_id, plan_hash, principal_id, payer_id, period, expires_at, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS(SELECT 1 FROM memory_benchmark_experiments)`, experimentId, planHash, principalId, payerId, period, expiresAt, now, now),
        this.assertion(`EXISTS (SELECT 1 FROM memory_benchmark_experiments e WHERE e.experiment_id=?
          AND e.plan_hash=? AND e.principal_id=? AND e.payer_id=? AND e.period=? AND e.expires_at=?
          AND e.created_at<=? AND ${integrity})`, experimentId, planHash, principalId, payerId, period, expiresAt, now),
        this.statement('DELETE FROM memory_benchmark_assertions'),
      ]);
      const found = await this.status(experimentId);
      if (!found || found.planHash !== planHash || found.principalId !== principalId || found.payerId !== payerId
        || found.period !== period || found.expiresAt !== expiresAt) throw failure('grant_conflict');
      return found;
    } catch { throw failure('grant_not_initialized'); }
  }

  async status(experimentId: string): Promise<BenchmarkSnapshot | null> {
    if (!identifier(experimentId)) throw failure('invalid_experiment');
    try {
      const row = await this.statement('SELECT * FROM memory_benchmark_experiments WHERE experiment_id=?', experimentId).first<Row>();
      return row ? snapshot(row) : null;
    } catch { throw failure('status_unavailable'); }
  }

  private async operation(experimentId: string, operationId: string): Promise<Row | null> {
    return this.statement('SELECT * FROM memory_benchmark_operations WHERE experiment_id=? AND operation_id=?', experimentId, operationId).first<Row>();
  }

  private async durableSettlement(experimentId: string, operationId: string): Promise<Row | null> {
    return this.statement(`SELECT o.* FROM memory_benchmark_operations o
      JOIN memory_benchmark_experiments e ON e.experiment_id=o.experiment_id
      WHERE e.experiment_id=? AND o.operation_id=? AND o.state='settled' AND o.payload_purged_at IS NULL
      AND ${integrity}`, experimentId, operationId).first<Row>();
  }

  private async uncertain(experimentId: string, operationId: string | undefined, reason: string, now: number): Promise<void> {
    try { await this.halt({ experimentId, operationId, reason, now: timestamp(now) ? now : Date.now() }); } catch { /* A persisted reservation remains non-dispatchable even if this write is unavailable. */ }
  }

  /** True reserves cost once, but never authorizes dispatch without a subsequent claimDispatch. */
  async reserve(input: BenchmarkReservation): Promise<boolean> {
    const { experimentId, planHash, principalId, payerId, operationId, requestHash, ordinal, maximumMicroUsd, now } = input;
    if (!identifier(experimentId) || !hash(planHash) || !identifier(principalId) || !identifier(payerId)
      || !identifier(operationId) || !hash(requestHash) || !integer(ordinal) || !timestamp(now)
      || !integer(maximumMicroUsd) || maximumMicroUsd === 0 || maximumMicroUsd > BENCHMARK_MAXIMUM_MICRO_USD) return false;
    const reservationToken = crypto.randomUUID();
    try {
      await this.batch([
        this.assertion(`EXISTS (SELECT 1 FROM memory_benchmark_experiments e WHERE e.experiment_id=?
          AND e.plan_hash=? AND e.principal_id=? AND e.payer_id=? AND e.period=? AND e.expires_at>?
          AND e.created_at<=? AND e.updated_at<=? AND e.status='active' AND e.reserved_micro_usd=0
          AND e.next_ordinal=? AND e.spent_micro_usd+?<=e.maximum_micro_usd AND ${integrity}
          AND NOT EXISTS (SELECT 1 FROM memory_benchmark_operations o WHERE o.experiment_id=e.experiment_id AND o.operation_id=?))`,
        experimentId, planHash, principalId, payerId, periodAt(now), now, now, now, ordinal, maximumMicroUsd, operationId),
        this.statement(`INSERT INTO memory_benchmark_operations
          (experiment_id, operation_id, request_hash, ordinal, reservation_token, maximum_micro_usd, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, experimentId, operationId, requestHash, ordinal, reservationToken, maximumMicroUsd, now, now),
        this.statement(`UPDATE memory_benchmark_experiments SET reserved_micro_usd=?, next_ordinal=next_ordinal+1, updated_at=? WHERE experiment_id=?`, maximumMicroUsd, now, experimentId),
        this.assertion(`EXISTS (SELECT 1 FROM memory_benchmark_experiments e JOIN memory_benchmark_operations o ON o.experiment_id=e.experiment_id
          WHERE e.experiment_id=? AND o.reservation_token=? AND o.state='reserved' AND e.reserved_micro_usd=? AND ${integrity})`, experimentId, reservationToken, maximumMicroUsd),
        this.statement('DELETE FROM memory_benchmark_assertions'),
      ]);
      const [op, current] = await Promise.all([this.operation(experimentId, operationId), this.status(experimentId)]);
      if (!op || !current || op.reservation_token !== reservationToken || op.state !== 'reserved'
        || op.request_hash !== requestHash || op.ordinal !== ordinal || op.maximum_micro_usd !== maximumMicroUsd
        || current.status !== 'active' || current.reservedMicroUsd !== maximumMicroUsd || current.nextOrdinal !== ordinal + 1) {
        await this.uncertain(experimentId, operationId, 'reservation_verification_failed', now);
        return false;
      }
      return true;
    } catch {
      try {
        const op = await this.operation(experimentId, operationId);
        // A guard failure or another invocation's token cannot authorize this caller.
        if (op?.reservation_token === reservationToken) await this.uncertain(experimentId, operationId, 'reservation_acknowledgement_unknown', now);
      } catch { await this.uncertain(experimentId, operationId, 'reservation_state_unknown', now); }
      return false;
    }
  }

  /**
   * The acknowledged transaction is the dispatch linearization point. A halt before
   * this claim prevents dispatch; a halt after it may leave one authorized call in flight.
   * A durable claim is never replayable, even if its acknowledgement was lost.
   */
  async claimDispatch(input: BenchmarkDispatchClaim): Promise<boolean> {
    const { experimentId, operationId, requestHash, now } = input;
    if (!identifier(experimentId) || !identifier(operationId) || !hash(requestHash) || !timestamp(now)) return false;
    const claimToken = crypto.randomUUID();
    try {
      await this.batch([
        this.assertion(`EXISTS (SELECT 1 FROM memory_benchmark_experiments e JOIN memory_benchmark_operations o ON o.experiment_id=e.experiment_id
          WHERE e.experiment_id=? AND e.status='active' AND e.period=? AND e.expires_at>? AND e.updated_at<=?
          AND o.operation_id=? AND o.request_hash=? AND o.state='reserved' AND o.updated_at<=?
          AND o.dispatch_claimed_at IS NULL AND o.dispatch_claim_token IS NULL
          AND e.reserved_micro_usd=o.maximum_micro_usd AND ${integrity})`, experimentId, periodAt(now), now, now, operationId, requestHash, now),
        this.statement(`UPDATE memory_benchmark_operations SET dispatch_claimed_at=?, dispatch_claim_token=?, updated_at=?
          WHERE experiment_id=? AND operation_id=? AND request_hash=? AND state='reserved' AND dispatch_claimed_at IS NULL`, now, claimToken, now, experimentId, operationId, requestHash),
        this.statement('UPDATE memory_benchmark_experiments SET updated_at=? WHERE experiment_id=?', now, experimentId),
        this.assertion(`EXISTS (SELECT 1 FROM memory_benchmark_experiments e JOIN memory_benchmark_operations o ON o.experiment_id=e.experiment_id
          WHERE e.experiment_id=? AND e.status='active' AND o.operation_id=? AND o.request_hash=?
          AND o.dispatch_claimed_at=? AND o.dispatch_claim_token=? AND o.state='reserved' AND ${integrity})`, experimentId, operationId, requestHash, now, claimToken),
        this.statement('DELETE FROM memory_benchmark_assertions'),
      ]);
      // Exact SQL guards and a successful atomic acknowledgement are required.
      // Never turn a later read of a persisted claim into dispatch authorization.
      return true;
    } catch {
      try {
        const op = await this.operation(experimentId, operationId);
        if (op?.dispatch_claim_token === claimToken) await this.uncertain(experimentId, operationId, 'dispatch_acknowledgement_unknown', now);
      } catch { await this.uncertain(experimentId, operationId, 'dispatch_state_unknown', now); }
      return false;
    }
  }

  async settle(input: BenchmarkSettlement): Promise<void> {
    const { experimentId, operationId, requestHash, actualMicroUsd, resultJson, now } = input;
    if (!identifier(experimentId) || !identifier(operationId)) throw failure('invalid_operation');
    if (!hash(requestHash) || !integer(actualMicroUsd) || actualMicroUsd > BENCHMARK_MAXIMUM_MICRO_USD
      || !timestamp(now) || !validResult(resultJson)) {
      await this.uncertain(experimentId, operationId, 'invalid_receipt', now);
      throw failure('invalid_receipt');
    }
    const exact = (op: Row | null): boolean => !!op && op.state === 'settled' && op.request_hash === requestHash
      && op.actual_micro_usd === actualMicroUsd && op.result_json === resultJson;
    try {
      const before = await this.operation(experimentId, operationId);
      if (exact(before) && exact(await this.durableSettlement(experimentId, operationId))) return;
      if (!before || before.state !== 'reserved' || before.request_hash !== requestHash
        || !timestamp(before.dispatch_claimed_at) || typeof before.dispatch_claim_token !== 'string'
        || !integer(before.maximum_micro_usd) || actualMicroUsd > before.maximum_micro_usd) throw failure('receipt_conflict');
      await this.batch([
        this.assertion(`EXISTS (SELECT 1 FROM memory_benchmark_experiments e JOIN memory_benchmark_operations o ON o.experiment_id=e.experiment_id
          WHERE e.experiment_id=? AND e.status='active' AND e.period=? AND e.expires_at>? AND e.created_at<=? AND e.updated_at<=?
          AND o.operation_id=? AND o.request_hash=? AND o.state='reserved' AND o.maximum_micro_usd>=?
          AND o.dispatch_claimed_at IS NOT NULL AND o.dispatch_claimed_at<=? AND o.dispatch_claim_token IS NOT NULL
          AND e.reserved_micro_usd=o.maximum_micro_usd AND ${integrity})`, experimentId, periodAt(now), now, now, now, operationId, requestHash, actualMicroUsd, now),
        this.statement(`UPDATE memory_benchmark_operations SET state='settled', actual_micro_usd=?, result_json=?, updated_at=?
          WHERE experiment_id=? AND operation_id=? AND request_hash=? AND state='reserved'`, actualMicroUsd, resultJson, now, experimentId, operationId, requestHash),
        this.statement(`UPDATE memory_benchmark_experiments SET spent_micro_usd=spent_micro_usd+?, reserved_micro_usd=0, updated_at=? WHERE experiment_id=?`, actualMicroUsd, now, experimentId),
        this.assertion(`EXISTS (SELECT 1 FROM memory_benchmark_experiments e JOIN memory_benchmark_operations o ON o.experiment_id=e.experiment_id
          WHERE e.experiment_id=? AND e.reserved_micro_usd=0 AND o.operation_id=? AND o.state='settled'
          AND o.request_hash=? AND o.actual_micro_usd=? AND o.result_json=? AND ${integrity})`, experimentId, operationId, requestHash, actualMicroUsd, resultJson),
        this.statement('DELETE FROM memory_benchmark_assertions'),
      ]);
      const after = await this.durableSettlement(experimentId, operationId);
      if (!exact(after)) throw failure('settlement_unverified');
    } catch {
      // A lost commit acknowledgement may be recovered only by an exact durable receipt.
      try { if (exact(await this.durableSettlement(experimentId, operationId))) return; } catch { /* Uncertainty is terminal. */ }
      await this.uncertain(experimentId, operationId, 'settlement_uncertain_or_conflicting', now);
      throw failure('settlement_not_verified');
    }
  }

  async halt(input: { experimentId: string; operationId?: string; reason: string; now: number }): Promise<void> {
    const { experimentId, operationId, reason, now } = input;
    if (!identifier(experimentId) || (operationId !== undefined && !identifier(operationId))
      || typeof reason !== 'string' || !/^[a-z0-9_:-]{1,96}$/.test(reason) || !timestamp(now)) throw failure('invalid_halt');
    try {
      await this.batch([
        this.assertion('EXISTS (SELECT 1 FROM memory_benchmark_experiments WHERE experiment_id=?)', experimentId),
        this.statement(`UPDATE memory_benchmark_experiments SET status='halted', halt_reason=COALESCE(halt_reason, ?), updated_at=MAX(updated_at, ?) WHERE experiment_id=?`, reason, now, experimentId),
        this.statement(`UPDATE memory_benchmark_operations SET state='uncertain', updated_at=MAX(updated_at, ?) WHERE experiment_id=? AND state='reserved'`, now, experimentId),
        this.statement('DELETE FROM memory_benchmark_assertions'),
      ]);
      if ((await this.status(experimentId))?.status !== 'halted') throw failure('halt_unverified');
    } catch { throw failure('halt_unavailable'); }
  }

  async complete(experimentId: string, now: number): Promise<void> {
    if (!identifier(experimentId) || !timestamp(now)) throw failure('invalid_completion');
    try {
      if ((await this.status(experimentId))?.status === 'complete') return;
      await this.batch([
        this.assertion(`EXISTS (SELECT 1 FROM memory_benchmark_experiments e WHERE e.experiment_id=? AND e.status='active'
          AND e.period=? AND e.expires_at>? AND e.updated_at<=? AND e.reserved_micro_usd=0 AND e.next_ordinal>0 AND ${integrity})`, experimentId, periodAt(now), now, now),
        this.statement(`UPDATE memory_benchmark_experiments SET status='complete', updated_at=? WHERE experiment_id=?`, now, experimentId),
        this.statement('DELETE FROM memory_benchmark_assertions'),
      ]);
      if ((await this.status(experimentId))?.status !== 'complete') throw failure('completion_unverified');
    } catch { throw failure('completion_not_verified'); }
  }

  async results(experimentId: string): Promise<BenchmarkStoredResult[]> {
    if (!identifier(experimentId)) throw failure('invalid_experiment');
    try {
      const response = await this.statement(`SELECT operation_id, ordinal, request_hash, actual_micro_usd, result_json FROM memory_benchmark_operations
        WHERE experiment_id=? AND state='settled' AND payload_purged_at IS NULL AND result_json IS NOT NULL ORDER BY ordinal`, experimentId).all<Row>();
      if (response.success !== true || !Array.isArray(response.results)) throw failure('results_unavailable');
      return response.results.map(row => {
        if (!identifier(row.operation_id) || !integer(row.ordinal) || !hash(row.request_hash)
          || !integer(row.actual_micro_usd) || row.actual_micro_usd > BENCHMARK_MAXIMUM_MICRO_USD || !validResult(row.result_json)) throw failure('invalid_result');
        return { operationId: row.operation_id, ordinal: row.ordinal, requestHash: row.request_hash, actualMicroUsd: row.actual_micro_usd, resultJson: row.result_json };
      });
    } catch { throw failure('results_unavailable'); }
  }

  /** Erases synthetic payloads after expiry; immutable charge and operation tombstones remain. */
  async purgeResults(experimentId: string, now: number): Promise<void> {
    if (!identifier(experimentId) || !timestamp(now)) throw failure('invalid_purge');
    try {
      await this.batch([
        this.assertion(`EXISTS (SELECT 1 FROM memory_benchmark_experiments e WHERE e.experiment_id=?
          AND e.expires_at<=? AND e.updated_at<=? AND ${integrity})`, experimentId, now, now),
        this.statement(`UPDATE memory_benchmark_experiments SET
          halt_reason=CASE WHEN status='active' THEN COALESCE(halt_reason, 'expired_results_purged') ELSE halt_reason END,
          status=CASE WHEN status='active' THEN 'halted' ELSE status END, updated_at=MAX(updated_at, ?) WHERE experiment_id=?`, now, experimentId),
        this.statement(`UPDATE memory_benchmark_operations SET state='uncertain', updated_at=MAX(updated_at, ?)
          WHERE experiment_id=? AND state='reserved'`, now, experimentId),
        this.statement(`UPDATE memory_benchmark_operations SET result_json=NULL, payload_purged_at=?, updated_at=MAX(updated_at, ?)
          WHERE experiment_id=? AND state='settled' AND payload_purged_at IS NULL AND result_json IS NOT NULL`, now, now, experimentId),
        this.assertion(`EXISTS (SELECT 1 FROM memory_benchmark_experiments e WHERE e.experiment_id=? AND e.status!='active'
          AND ${integrity} AND NOT EXISTS (SELECT 1 FROM memory_benchmark_operations o
            WHERE o.experiment_id=e.experiment_id AND (o.state='reserved' OR (o.state='settled' AND o.result_json IS NOT NULL))))`, experimentId),
        this.statement('DELETE FROM memory_benchmark_assertions'),
      ]);
      const state = await this.status(experimentId);
      if (!state || state.status === 'active' || (await this.results(experimentId)).length) throw failure('purge_unverified');
    } catch { throw failure('purge_not_verified'); }
  }
}
