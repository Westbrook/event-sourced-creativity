import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../src/experiences/compiler.ts';
import { sceneScreenplayText } from '../src/model/scene-screenplay.ts';
import { wrapSceneText as browserWrap } from '../src/components/scene-text-measurement.ts';
import { wrapSceneText } from '../src/model/scene-text-wrap.ts';
import { SCENE_FONT_METRICS as metrics, SCENE_FONT_METRICS_SHA256 } from '../worker/scene-font-metrics.ts';
import { measureOutputSceneLayout } from '../worker/output-scene-layout.ts';

// Local original-content/asset fixtures only: no job, grant, provider, retained
// native result, browser parity, requirement fulfillment or publication claim.
const bytes = readFileSync(new URL('../public/fonts/dm-mono/DMMono-Regular-55b4c98f.ttf', import.meta.url));
const font = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const hash = value => createHash('sha256').update(value).digest('hex');
const source = () => ({ characters: [{ id: 'A', name: 'Alex' }, { id: 'B', name: 'Alex' }], location: 'Waiting room' });
const script = () => ({ schemaVersion: 1, format: 'forma-screenplay@1', heading: { setting: 'INT.', location: 'location', time: 'NIGHT' }, blocks: [
  { kind: 'action', text: 'A hand rests on the door.  \n\nThe key turns.\n' },
  { kind: 'dialogue', speaker: 'A', parenthetical: '(quietly)', text: '“Stay,” Alex says — softly.' },
  { kind: 'dialogue', speaker: 'B', parenthetical: null, text: 'I have to go.' },
] });

test('server Scene layout uses the pinned font and shared literal wrapper, hashes original content, and leaves fulfillment false', async () => {
  const value = script(), labels = source(), result = await measureOutputSceneLayout(value, labels, font());
  assert.equal(browserWrap, wrapSceneText);
  assert.equal(hash(canonicalJson(metrics)), SCENE_FONT_METRICS_SHA256);
  assert.equal(hash(bytes), metrics.fontSha256);
  assert.equal(result.status, 'layout-candidate'); assert.equal(result.qualification, 'measurement-only');
  assert.equal(result.pagination.pageCount, 1); assert.equal(result.pageRangeSatisfied, true); assert.equal(result.requirementFulfilled, false);
  assert.equal(result.body, sceneScreenplayText(value, labels)); assert.equal(result.bodySha256, hash(result.body));
  assert.equal(result.screenplaySha256, hash(canonicalJson(value))); assert.equal(result.displaySourceSha256, hash(canonicalJson(labels)));
  assert.equal(result.pagesSha256, hash(canonicalJson(result.pagination.pages)));
  assert.deepEqual(result.pagination.groups[1].lines, ['A hand rests on the door.  ', '', 'The key turns.', '']);
  assert.deepEqual(result.pagination.groups.filter(group => group.role === 'dialogue').map(group => group.cueLines), [['A · Alex'], ['B · Alex']]);
});

test('server Scene layout never substitutes unsupported Unicode or context-dependent glyph sequences', async () => {
  for (const text of ['Élise', 'e\u0301', 'ليلى', '等待室', '👩‍👩‍👧‍👦', 'l·l', 'L·L']) {
    const value = script(); value.blocks[0].text = text; const result = await measureOutputSceneLayout(value, source(), font());
    assert.equal(result.status, 'unqualified'); assert.equal(result.body, sceneScreenplayText(value, source()));
    assert.equal(result.reason, ['l·l', 'L·L'].includes(text) ? 'shaping-required' : 'unsupported-profile');
    assert.equal(result.pagination, undefined);
  }
});

test('server Scene layout snapshots original labels, script, and font bytes before asynchronous hashing', async () => {
  const value = script(), labels = source(), body = sceneScreenplayText(value, labels), data = font();
  const promise = measureOutputSceneLayout(value, labels, data);
  value.blocks[0].text = 'changed'; labels.characters[0].name = 'changed'; new Uint8Array(data).fill(0);
  const result = await promise; assert.equal(result.status, 'layout-candidate'); assert.equal(result.body, body);
  assert.ok(Object.isFrozen(result.pagination.pages[0].lines));
  const wrong = font(); new Uint8Array(wrong)[0] ^= 1;
  assert.equal((await measureOutputSceneLayout(script(), source(), wrong)).reason, 'font-unavailable');
  assert.equal((await measureOutputSceneLayout(script(), source(), new ArrayBuffer(0))).reason, 'font-unavailable');
});

test('server Scene layout retains every page and source line when the authored output exceeds two pages', async () => {
  const value = script(); value.blocks[0].text = Array(95).fill('The key turns.').join('\n');
  const result = await measureOutputSceneLayout(value, source(), font());
  assert.equal(result.status, 'layout-candidate'); assert.equal(result.pagination.status, 'too-long');
  assert.equal(result.pageRangeSatisfied, false); assert.equal(result.requirementFulfilled, false);
  assert.ok(result.pagination.pageCount > 2);
  const lines = result.pagination.pages.flatMap(page => page.lines).filter(line => line.role === 'action');
  assert.equal(lines.length, 95); assert.equal(lines.map(line => line.text).join('\n'), value.blocks[0].text);
});

test('server Scene layout takes no caller-supplied page authority and refuses hostile source fields without invoking them', async () => {
  const value = script(); value.pageCount = 1;
  assert.equal((await measureOutputSceneLayout(value, source(), font())).reason, 'invalid-scene');
  const labels = source(); let invoked = false;
  Object.defineProperty(labels, 'location', { enumerable: true, get() { invoked = true; return 'changed'; } });
  assert.equal((await measureOutputSceneLayout(script(), labels, font())).reason, 'invalid-scene'); assert.equal(invoked, false);
});
