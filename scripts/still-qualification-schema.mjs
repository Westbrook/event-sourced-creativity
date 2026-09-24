import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

// Inventory and rehearsal support only. This module has no network, hosting or
// migration-journal writer and cannot authorize or apply a hosted migration.
export const CREATION_CANDIDATES = [
  'drizzle/candidates/0074_still_creation.sql',
  'drizzle/candidates/0075_still_creation_search.sql',
  'drizzle/candidates/still_semantic_index.sql',
  'drizzle/candidates/still_creation_qualification_budget.sql',
];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const schemaSnapshot = sqlite => sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
export function authoredSnapshot(sqlite) {
  const tables = ['events', 'event_private_payloads', 'private_content', 'event_client_receipts', 'project_event_scopes', 'project_resource_scopes'];
  return Object.fromEntries(tables.map(table => {
    const rows = sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    return [table, {count: rows.length, sha256: sha256(JSON.stringify(rows))}];
  }));
}

export async function creationSchemaManifest(root = fileURLToPath(new URL('../', import.meta.url))) {
  const candidates = [];
  for (const [index, path] of CREATION_CANDIDATES.entries()) {
    const sql = await readFile(resolve(root, path), 'utf8');
    const statements = sql.split(/^--> statement-breakpoint\s*$/m).map(s => s.trim()).filter(Boolean);
    candidates.push({order: index + 1, path, sha256: sha256(sql), bytes: Buffer.byteLength(sql),
      dependsOn: index === 3 ? ['authoritative isolated qualification D1 inventory and explicit budget authorization'] : index ? [CREATION_CANDIDATES[index - 1]] : ['authoritative application schema inventory'],
      statements: statements.map((statement, offset) => ({ordinal: offset + 1, sha256: sha256(statement), sql: statement}))});
  }
  const journal = await readFile(resolve(root, 'drizzle/meta/_journal.json'));
  const policy = await readFile(resolve(root, 'build/memory-migration-release.json'));
  const identity = candidates.map(({order, path, sha256, bytes, dependsOn, statements}) => ({order, path, sha256, bytes, dependsOn, statements: statements.map(({ordinal, sha256}) => ({ordinal, sha256}))}));
  return {version: 1, kind: 'source-only-additive-candidate-manifest',
    authorization: 'none', target: {environment: 'isolated qualification deployment not provisioned', siteId: null, d1Id: null},
    deployedInventory: 'unavailable', deploymentSequenceNumbers: null,
    sequenceRule: 'Assign host journal names only after authoritative applied-history reconciliation; source filenames are not target migration numbers.',
    sourceJournalSha256: sha256(journal), heldReleasePolicySha256: sha256(policy),
    manifestSha256: sha256(JSON.stringify(identity)), candidates};
}

export function assertManifestBytes(manifest) {
  for (const candidate of manifest.candidates) {
    if (candidate.statements.some(statement => sha256(statement.sql) !== statement.sha256)) throw Error('qualification_statement_hash_mismatch');
  }
  const identity = manifest.candidates.map(({order, path, sha256, bytes, dependsOn, statements}) => ({order, path, sha256, bytes, dependsOn, statements: statements.map(({ordinal, sha256}) => ({ordinal, sha256}))}));
  if (sha256(JSON.stringify(identity)) !== manifest.manifestSha256) throw Error('qualification_manifest_hash_mismatch');
}

/** Execute on a caller-owned disposable SQLite connection. A failure leaves the
 * committed prefix to reproduce hosts which fail between statements. Replaying
 * the exact manifest is the recovery under test; this is not a hosted executor. */
export function rehearseCandidateStatements(sqlite, manifest, {failAfter = Infinity} = {}) {
  assertManifestBytes(manifest);
  let applied = 0;
  for (const candidate of manifest.candidates) {
    for (const statement of candidate.statements) {
      if (applied === failAfter) throw Object.assign(Error('qualification_simulated_partial_failure'), {applied});
      sqlite.exec(statement.sql);
      applied++;
    }
  }
  return {applied, schemaSha256: sha256(JSON.stringify(schemaSnapshot(sqlite)))};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = await creationSchemaManifest();
  const sanitized = {...manifest, candidates: manifest.candidates.map(c => ({...c, statements: c.statements.map(({ordinal, sha256}) => ({ordinal, sha256}))}))};
  console.log(JSON.stringify(sanitized, null, 2));
}
