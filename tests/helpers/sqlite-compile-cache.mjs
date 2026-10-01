import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

const identities = new Map();
export const compileCacheMetrics = { hits: 0, misses: 0 };

/** Opt-in, run-scoped, immutable compile results; never database rows or connections. */
export function cachedCompile(python, compiler, input, compile) {
  const directory = process.env.FORMA_SQLITE_CACHE_DIR;
  if (!directory) return compile();
  let identity = identities.get(python);
  if (!identity) {
    const probe = spawnSync(python, ['-I', '-S', '-B', '-c', 'import sys,sqlite3,json; print(json.dumps([sys.executable,sys.version,sqlite3.sqlite_version,sys.platform]))'], { encoding: 'utf8', timeout: 5000 });
    if (probe.status !== 0) return compile(); // Preserve the compiler's existing diagnostic.
    identity = probe.stdout.trim(); identities.set(python, identity);
  }
  const key = createHash('sha256').update(JSON.stringify([identity, compiler, input])).digest('hex');
  const file = resolve(directory, key + '.json');
  try {
    const record = JSON.parse(readFileSync(file, 'utf8'));
    if (record.key === key && typeof record.result?.ok === 'boolean' && record.result.sqliteVersion
      && record.digest === createHash('sha256').update(JSON.stringify(record.result)).digest('hex')) {
      compileCacheMetrics.hits++; return record.result;
    }
  } catch { /* Missing/partial/corrupt cache is a miss, never a pass. */ }
  compileCacheMetrics.misses++;
  const result = compile(); // Thrown/transport failures are never cached.
  mkdirSync(directory, { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, JSON.stringify({ key, result, digest: createHash('sha256').update(JSON.stringify(result)).digest('hex') }));
  renameSync(temporary, file);
  return result;
}
