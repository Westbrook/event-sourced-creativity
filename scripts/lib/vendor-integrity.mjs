import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { walk } from './validation-inventory.mjs';

export function verifyVendor(root) {
  const base = resolve(root, 'src/still/vendor');
  const provenance = JSON.parse(readFileSync(resolve(base, 'provenance.json'), 'utf8'));
  const actual = walk(base, '.').map(p => p.slice(2)).filter(p => /\.(?:js|ts)$/u.test(p)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(provenance.modulePaths) || actual.length !== provenance.modules) throw Error('Vendored module membership changed; regenerate the upstream closure.');
  const hash = createHash('sha256');
  for (const file of [...actual].sort((a, b) => a.localeCompare(b))) hash.update(file).update(readFileSync(resolve(base, file)));
  hash.update('tokens/default.css').update(readFileSync(resolve(base, 'tokens/default.css')));
  if (hash.digest('hex') !== provenance.outputClosureSha256) throw Error('Vendored bytes differ from the recorded upstream build; do not lint-fix generated library output.');
  return { revision: provenance.revision, modules: actual.length };
}
