import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { dependencies, walk } from './validation-inventory.mjs';

// Recipes describe execution; inventory never imports configs, starts servers,
// reads private fixtures, or turns an optional mode on.
export function executionOwnership(root, current, tests) {
  const configSources = current.configs.filter(f => f !== 'playwright.validation.config.mjs')
    .map(file => [file, readFileSync(resolve(root, file), 'utf8')]);
  const result = {};
  for (const file of current.files) {
    const lane = tests[file], name = basename(file);
    if (lane !== 'browser') {
      result[file] = { owner: 'Forma domain maintainer: ' + name.split('-')[0], lane,
        command: `node scripts/validation.mjs ${lane} ${file}`,
        resource: lane === 'source' ? 'isolated Node process' : lane === 'artifact' ? 'qualified build read lease + isolated Node process' : 'isolated Node/SQLite/Worker runtime',
        evidence: 'Named positive and negative cases in this suite; TAP leaf outcomes and timings in the run receipt' };
      continue;
    }
    let configs = configSources.filter(([, source]) => source.includes(name)).map(([f]) => f);
    if (file.startsWith('tests/model3d-native/')) configs = ['playwright.model3d-native.config.mjs'];
    if (['forma-audio-reviewed-download.spec.mjs', 'forma-slides-reviewed-download.spec.mjs'].includes(name)) configs = ['playwright.reviewed-download.config.mjs'];
    if (file.endsWith('.test.mjs')) {
      result[file] = { owner: 'Forma browser maintainer', lane, command: `node --import tsx --test --test-concurrency=1 ${file}`,
        resource: 'owned fixture server and pinned Playwright browser; fresh scenario state',
        prerequisites: 'Installed bundled browser; local port/process permission. Suite owns its explicit fixture startup. See tests/browser/README.md.' };
    } else {
      if (!configs.length) throw Error(`Unowned browser test: ${file}; add explicit config membership.`);
      result[file] = { owner: 'Forma browser maintainer', lane, configs,
        command: `FORMA_BROWSER_CONFIGS=${configs[0].replace(/^playwright\.|\.config\.mjs$/gu, '')} pnpm test:browser`,
        resource: 'config-owned browser batch; isolated context; true zoom remains a dedicated profile',
        prerequisites: configs.includes('playwright.reviewed-download.config.mjs') ? `FORMA_REVIEWED_DOWNLOAD_KIND=${name.includes('audio') ? 'audio' : 'slides'}; FORMA_REVIEWED_DOWNLOAD_FIXTURE_ROOT with authorized retained backend; no fixture fabrication`
          : 'Config opt-ins and fixture/account/archive requirements in tests/browser/README.md; no automatic account or provider work' };
    }
  }
  return result;
}

export function environmentInputs(root, current) {
  return [...new Set([...current.files, ...current.configs, ...walk(root, 'scripts'), ...walk(root, 'evals'), ...walk(root, 'tests').filter(p => /\.(mjs|ts)$/u.test(p))])]
    .filter(p => /\.(mjs|ts)$/u.test(p)).sort().flatMap(file => {
      const text = readFileSync(resolve(root, file), 'utf8');
      const flags = [...new Set([...text.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/gu)].map(m => m[1] ?? m[2]))].sort();
      return flags.length ? [{ file, flags, owner: 'Maintainer of the named test/config/tool', policy: 'Explicit input; unset defaults remain unchanged. A disabled or missing variant is unverified, never a pass.' }] : [];
    });
}

export function suiteInputs(root, file) {
  return [...dependencies(root, file)].sort();
}
