import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';

// Parse only the outer Boolean composition; SQL subqueries/functions and
// BETWEEN's AND remain atomic. This is a predicate-preservation regression,
// not fabricated custody, provider completion or hosted acceptance.
import { publicationParts, predicateTree } from './output-native-publication-fixture.mjs';
test('native publication keeps all five format predicates and custody bindings while balancing D1 depth',()=>{
  const source=readFileSync(new URL('../worker/output-private-execution.ts',import.meta.url),'utf8');
  const parts=publicationParts(source),tree=predicateTree(parts.predicate);
  assert.equal(tree.op,'OR');assert.deepEqual(tree.terms.map(node=>node.terms.length),[2,21,31,28,57]);
  const hash=createHash('sha256').update(JSON.stringify(tree)).digest('hex');
  assert.equal(hash,'8988d92ba3f49ab5d1b079b3bda8f7144de6fb7870b3e075fe98bfadc7178b1b');
  assert.equal((parts.sql.match(/\?/gu)||[]).length,24);
  assert.match(parts.after,/status='written' AND publication_event_id IS NULL/u);
});
