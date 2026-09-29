import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

/** Fresh in-memory D1 fixture; no native/runtime helpers and no network access. */
export function createBenchmarkDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../../db/memory-benchmark.pending.sql', import.meta.url), 'utf8'));
  const hooks = {
    // One-shot fault injection. Statement indices are zero-based.
    failBatchAt: null,
    loseBatchAcknowledgement: false,
    malformedBatchAcknowledgement: false,
    failReads: 0,
    batches: 0,
  };
  const read = (sql, values) => {
    if (hooks.failReads > 0) {
      hooks.failReads--;
      throw new Error('injected read failure');
    }
    return sqlite.prepare(sql).all(...values).map(row => ({ ...row }));
  };
  const prepare = (sql, values = []) => ({
    sql,
    values,
    bind(...next) { return prepare(sql, next); },
    async first(column) {
      const row = read(sql, values)[0];
      return row === undefined ? null : column === undefined ? row : row[column];
    },
    async all() { return { success: true, results: read(sql, values) }; },
    async run() {
      const info = sqlite.prepare(sql).run(...values);
      return { success: true, results: [], meta: { changes: Number(info.changes) } };
    },
  });
  const DB = {
    prepare,
    async batch(statements) {
      hooks.batches++;
      const failAt = hooks.failBatchAt;
      const lost = hooks.loseBatchAcknowledgement;
      const malformed = hooks.malformedBatchAcknowledgement;
      hooks.failBatchAt = null;
      hooks.loseBatchAcknowledgement = false;
      hooks.malformedBatchAcknowledgement = false;
      sqlite.exec('BEGIN IMMEDIATE');
      let results;
      try {
        results = statements.map((statement, index) => {
          if (index === failAt) throw new Error('injected transactional failure');
          const rows = sqlite.prepare(statement.sql).all(...statement.values).map(row => ({ ...row }));
          return { success: true, results: rows };
        });
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
      if (lost) throw new Error('injected lost acknowledgement after commit');
      return malformed ? [{ success: false }] : results;
    },
  };
  return { DB, sqlite, hooks, close: () => sqlite.close() };
}
