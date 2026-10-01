import { ESLint } from 'eslint';
import { verifyVendor } from './lib/vendor-integrity.mjs';
verifyVendor(process.cwd());
// Explicit owned inputs avoid traversing unrelated retained archives and caches.
const eslint = new ESLint({ cache: true, cacheStrategy: 'content', cacheLocation: 'outputs/validation/eslint.cache' });
const results = await eslint.lintFiles(['src/**/*.{js,mjs,ts}', 'worker/**/*.ts', 'workers/**/*.ts', 'db/**/*.ts',
  'build/**/*.{mjs,ts}', 'scripts/**/*.{mjs,ts}', 'evals/**/*.{mjs,ts}', 'tests/**/*.{mjs,ts}', '*.{mjs,ts}']);
const formatter = await eslint.loadFormatter('stylish');
process.stdout.write(formatter.format(results));
if (results.some(r => r.errorCount)) process.exitCode = 1;
