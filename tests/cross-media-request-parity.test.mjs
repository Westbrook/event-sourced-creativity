import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { generateDocumentArtifact } from '../worker/openai-adapter.ts';
const baseline = '2a0caa914a0c57002f9b69ff3b60cb3d6d8a687f';
test('six planner requests match audited current-main bytes and transport retry function exactly', async () => {
  const root = new URL('../', import.meta.url), temporary = await mkdtemp(join(tmpdir(), 'forma-e-parity-'));
  const source = execFileSync('git', ['show', `${baseline}:worker/openai-adapter.ts`], {cwd: root, encoding: 'utf8'});
  const current = await readFile(new URL('worker/openai-adapter.ts', root), 'utf8');
  const retry = value => value.slice(value.indexOf('async function openAIRequest('), value.indexOf('\nconst responseText='));
  assert.equal(retry(current), retry(source));
  const module = source.replace(/((?:from\s*|import\s*\()\s*)["'](\.{1,2}\/[^"']+)["']/g, (_match, prefix, path) => `${prefix}${JSON.stringify(new URL(path, new URL('worker/openai-adapter.ts', root)).href)}`);
  const previous = globalThis.fetch;
  try {
    await writeFile(join(temporary, 'package.json'), '{"type":"module"}');
    await symlink(fileURLToPath(new URL('node_modules', root)), join(temporary, 'node_modules'), 'dir');
    await writeFile(join(temporary, 'baseline.ts'), module);
    const original = await import(pathToFileURL(join(temporary, 'baseline.ts')).href);
    async function capture(generate, kind) {
      const requests = [];
      globalThis.fetch = async (url, init) => { requests.push({url, body: init.body}); throw new TypeError('synthetic uncertain submission'); };
      await assert.rejects(generate({OPENAI_API_KEY: 'offline'}, 'owner', kind, {documentTitle: 'Synthetic', snapshot: {facts: []}, options: {productionMode: 'manual', itemCount: 1}}));
      assert.equal(requests.length, 1);
      return requests;
    }
    for (const kind of ['short_story', 'scene', 'slides', 'storyboard', 'audio', 'video']) assert.deepEqual(await capture(generateDocumentArtifact, kind), await capture(original.generateDocumentArtifact, kind), kind);
  } finally { globalThis.fetch = previous; await rm(temporary, {recursive: true, force: true}); }
});
