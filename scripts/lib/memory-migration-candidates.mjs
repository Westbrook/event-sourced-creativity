import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readLocalMigrations, migrateLocalDatabase } from './local-migrations.mjs';

// Source qualification only. This module deliberately accepts neither a database
// handle nor a connection/target path. Pending SQL remains outside the journal.
export const memoryMigrationCandidates = Object.freeze([
  Object.freeze({ file: 'memory-benchmark.pending.sql', hash: 'b3bf8d761d55582b3b607526514bd9ab9577c57cce7dac7fe214822e88de982e', statements: 9, kind: 'additive' }),
  Object.freeze({ file: 'memory-benchmark-native.pending.sql', hash: '20799cf9bd6c60ad2f0297294028066706e7dead722b6dd31cad5334b6c28b8a', statements: 27, kind: 'additive' }),
  Object.freeze({ file: 'memory-conversation-capture.pending.sql', hash: '7bf63ac40f57e8cd259214228973602bdc6f7fc33372446ea90a024c4ce0daa8', statements: 30, kind: 'atomic-rebuild' }),
]);
const hash = text => createHash('sha256').update(text).digest('hex');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object'
  ? '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}' : JSON.stringify(value);
const schema = db => db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name').all();
const conversation = rows => rows.filter(row => ['memory_structured_conversation_heads','memory_structured_conversation_revisions'].includes(row.tbl_name));
const fail = message => { throw new Error('memory_candidate_unqualified: ' + message); };

/** Pure, hash-pinned preparation. Not a general SQL splitter: trigger-body
 * semicolons must remain intact. Changes require a new explicit review/hash. */
export function prepareMemoryMigrationCandidate(candidate, sql, migrations) {
  if (!memoryMigrationCandidates.includes(candidate) || hash(sql) !== candidate.hash) fail('source identity');
  if (migrations.some(migration => migration.hash === candidate.hash || migration.tag.includes(candidate.file.replace('.pending.sql','').replaceAll('-','_')))) fail('candidate assigned to journal');
  const normalized = candidate.kind === 'additive' ? sql.replace(/^(?=CREATE (?:TABLE|(?:UNIQUE )?INDEX|TRIGGER)\b)/gmu, '--> statement-breakpoint\n') : sql;
  const statements = normalized.split('--> statement-breakpoint').filter(part => part.replace(/--[^\n]*/gu, '').trim());
  if (statements.length !== candidate.statements) fail('statement count');
  return { sql: statements.join('\n--> statement-breakpoint\n'), statements };
}

export function qualifyMemoryMigrationCandidates() {
  const migrations = readLocalMigrations(new URL('../../drizzle/', import.meta.url));
  const prepared = memoryMigrationCandidates.map(candidate => ({ candidate, ...prepareMemoryMigrationCandidate(candidate,
    readFileSync(new URL('../../db/' + candidate.file, import.meta.url), 'utf8'), migrations) }));
  const additive = [], reports = [];
  for (const { candidate, sql, statements } of prepared) {
    const db = new DatabaseSync(':memory:');
    try {
      if (candidate.kind === 'additive') {
        additive.push({ tag: 'preview_' + candidate.file.replace('.pending.sql','').replaceAll('-','_'), when: migrations.at(-1).when + additive.length + 1, sql });
        migrateLocalDatabase(db, { migrations: [...migrations, ...additive], dryRun: true });
        if (schema(db).length || db.isTransaction) fail('additive preview retained state');
      } else {
        migrateLocalDatabase(db, { migrations });
        const before = schema(db), beforeHash = hash(canonical(conversation(before)));
        if (beforeHash !== '4eac78f116b620e9fc22949faf7d4e3a5abfe8fab083e1c2827bd6091cae2a79') fail('conversation baseline');
        db.exec('BEGIN IMMEDIATE');
        try {
          statements.forEach(statement => db.exec(statement));
          const after = schema(db), afterHash = hash(canonical(conversation(after)));
          const expected = before.map(row => ({ ...row, sql: row.type === 'table' && conversation([row]).length
            ? row.sql.replaceAll('annotation_count BETWEEN 1 AND 256','annotation_count BETWEEN 0 AND 256') : row.sql }));
          if (afterHash !== '075a857266dad2a438313faf7641ddae71aa96ebdaed8c0a6e1af373de2e09e8' || canonical(after) !== canonical(expected)
            || db.prepare('PRAGMA foreign_key_check').get() || db.prepare('SELECT 1 FROM temp.sqlite_schema').get()) fail('conversation postcondition');
        } finally { db.exec('ROLLBACK'); }
        if (db.isTransaction || canonical(schema(db)) !== canonical(before)) fail('conversation preview retained state');
      }
      reports.push({ file: candidate.file, sourceSha256: candidate.hash, statements: candidate.statements, kind: candidate.kind, status: 'passed' });
    } finally { db.close(); }
  }
  return { qualification: 'local-disposable-sqlite-schema', hostedQualified: false, migrationsAssigned: false, productionApplied: false, candidates: reports };
}
