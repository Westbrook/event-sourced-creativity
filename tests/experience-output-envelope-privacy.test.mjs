import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// New bounded test, not a replay of any retained native suite. Run only the
// selected privacy projection and its pure constants; never the Worker graph.
const root = process.env.FORMA_EXPERIENCE_CANONICAL_ROOT
  ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(isAbsolute(root), 'Canonical root must be explicit and absolute.');
const require = createRequire(resolve(root, 'package.json'));
const ts = require('typescript');
const source = readFileSync(resolve(root, 'worker/event-privacy.ts'), 'utf8');
const ast = ts.createSourceFile('event-privacy.ts', source, ts.ScriptTarget.Latest, true);
const selectedNames = new Set(['SAFE_SCALAR_FIELDS', 'SAFE_IDENTIFIER_FIELDS', 'SAFE_IDENTIFIER', 'scalarKey', 'publicEventPayload']);
const selected = [];
for (const statement of ast.statements) {
  const names = ts.isVariableStatement(statement)
    ? statement.declarationList.declarations.map(declaration => declaration.name.getText(ast))
    : ts.isFunctionDeclaration(statement) && statement.name ? [statement.name.text] : [];
  if (names.some(name => selectedNames.has(name))) {
    assert.ok(names.every(name => selectedNames.has(name)), 'Unexpected coupled declaration.');
    for (const name of names) selectedNames.delete(name);
    selected.push(statement.getText(ast));
  }
}
assert.equal(selectedNames.size, 0, 'Selected canonical privacy seam changed.');
const bounded = selected.join('\n');
assert.equal(/\bimport\s/u.test(bounded), false, 'No runtime graph imports.');
const compiled = ts.transpileModule(bounded, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.deepEqual(compiled.diagnostics ?? [], []);
const module = { exports: {} };
// This unrelated presentation-issue branch is explicitly unavailable. If the
// new envelope path reaches it, fail instead of importing its runtime graph.
new Function('module', 'exports', 'safePresentationCandidateIssues', compiled.outputText)(
  module, module.exports, () => { throw new Error('Unreviewed presentation-issue branch.'); },
);
const { publicEventPayload } = module.exports;

for (const stage of ['save', 'confirm', 'preflight', 'authorize', 'run']) {
  test(`${stage}: original command envelope remains private and byte-preserved`, () => {
    const envelope = {
      action: stage, documentId: 'document-test', expectedRevision: 'output:12',
      clientMutationId: `experience-output-v1:test:${stage}`,
      experienceBinding: { draftId: 'draft-test', releaseHash: 'release-test' },
      authoredText: 'Private synthetic source α',
    };
    const original = { document_id: 'document-test', output_command_envelope: envelope };
    const { payload, privateJson } = publicEventPayload('event-test', original, true);
    assert.deepEqual(payload, { document_id: 'document-test', _private_ref: 'event-test' });
    assert.equal(privateJson, JSON.stringify(original));
    assert.deepEqual(JSON.parse(privateJson).output_command_envelope, envelope);
    assert.equal(JSON.stringify(payload).includes('Private synthetic source'), false);
  });
}

test('an envelope forces private retention even without the authored-event flag', () => {
  const original = { job_id: 'job-test', output_command_envelope: { action: 'run', grantId: 'grant-test' } };
  const result = publicEventPayload('event-test', original);
  assert.deepEqual(result.payload, { job_id: 'job-test', _private_ref: 'event-test' });
  assert.equal(result.privateJson, JSON.stringify(original));
});

test('generic operational event without an envelope keeps existing projection behavior', () => {
  const original = { job_id: 'job-test', status: 'queued' };
  assert.deepEqual(publicEventPayload('event-test', original), { payload: original, privateJson: null });
});
