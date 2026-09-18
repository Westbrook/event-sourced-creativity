import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../src/experiences/compiler.ts';
import { sceneScreenplayText } from '../src/model/scene-screenplay.ts';
import { readExperienceSceneContent } from '../src/experiences/scene-result.ts';

const sha = value => createHash('sha256').update(value).digest('hex');
function fixture() {
  const now = 1_800_000_000_000;
  const source = {characters: [{id: 'A', name: 'Sam'}, {id: 'B', name: 'Sam'}], location: 'Café 👩🏽‍💻'};
  const screenplay = {schemaVersion: 1, format: 'forma-screenplay@1', heading: {setting: 'INT.', location: 'location', time: 'NIGHT'}, blocks: [
    {kind: 'action', text: '  A letter waits.\n\nE\u0301 <b>not HTML</b>  '},
    {kind: 'dialogue', speaker: 'A', parenthetical: 'quietly', text: 'I know.\n'},
    {kind: 'dialogue', speaker: 'B', parenthetical: null, text: 'Then tell me.'},
  ]};
  const body = sceneScreenplayText(screenplay, source);
  const artifact = {title: 'At the café', summary: 'Two people share a secret.', content_markdown: body, presentation: null,
    items: [{title: 'At the café', body, notes: '', image_prompt: '', context_group_ids: [], slide: null}], scene_screenplay: screenplay};
  const raw = JSON.stringify(artifact);
  const expected = {documentId: 'doc', artifactId: 'scene', revision: 0, contentSha256: sha(raw), screenplaySha256: sha(canonicalJson(screenplay)),
    bodySha256: sha(body), displaySource: source, expiresAt: new Date(now + 60000).toISOString()};
  return {now, source, screenplay, body, artifact, raw, expected};
}

// Unadmitted content verification only. No server receipt, native job or provider call.
test('retained Scene preserves the exact literal body, Unicode and distinct equal-name cues', async () => {
  const f = fixture(), result = await readExperienceSceneContent(f.raw, f.expected, f.now);
  assert.equal(result.qualification, 'content-only');
  assert.equal(result.body, f.body);
  assert.deepEqual(result.screenplay, f.screenplay);
  assert.match(result.body, /A · Sam/); assert.match(result.body, /B · Sam/);
  assert.match(result.body, /<b>not HTML<\/b>/); assert.match(result.body, /E\u0301/);
  for (const value of [result, result.screenplay, result.screenplay.blocks, result.screenplay.blocks[0], result.selection,
    result.selection.displaySource, result.selection.displaySource.characters, result.selection.displaySource.characters[0]]) assert.equal(Object.isFrozen(value), true);
  assert.equal('pageCount' in result, false); assert.equal('requirementFulfilled' in result, false);
});

test('exact raw/body/script hashes and original revision are all mandatory', async () => {
  for (const mutate of [f => f.raw += ' ', f => f.expected.contentSha256 = '0'.repeat(64), f => f.expected.screenplaySha256 = '0'.repeat(64),
    f => f.expected.bodySha256 = '0'.repeat(64), f => f.expected.revision = 1, f => f.expected.documentId = '../doc',
    f => f.expected.expiresAt = new Date(f.now).toISOString(), f => f.expected.expiresAt = 'not-a-date',
    f => f.expected.extra = 'new authority', f => f.expected.displaySource.characters[0].name = 'Changed',
    f => f.expected.displaySource.location = 'Another room', f => f.expected.displaySource.characters.reverse()]) {
    const f = fixture(); mutate(f); assert.equal(await readExperienceSceneContent(f.raw, f.expected, f.now), null);
  }
});

test('matching whole JSON hashes do not bless foreign media, extra items, or a divergent projection', async () => {
  for (const mutate of [a => delete a.scene_screenplay, a => a.audio_revision = {}, a => a.presentation = {}, a => a.items.push(a.items[0]),
    a => a.items[0].body += ' more', a => a.items[0].notes = 'private text', a => a.items[0].context_group_ids.push('context'),
    a => a.items[0].image_prompt = 'image', a => a.items[0].slide = {}, a => a.items[0].extra = true,
    a => a.content_markdown += ' more', a => a.scene_screenplay.blocks[1].speaker = 'C', a => a.scene_screenplay.pageCount = 1,
    a => a.title += '\u202e', a => a.summary = '', a => a.items[0].title = 'Other']) {
    const f = fixture(); mutate(f.artifact); const raw = JSON.stringify(f.artifact);
    assert.equal(await readExperienceSceneContent(raw, {...f.expected, contentSha256: sha(raw)}, f.now), null);
  }
});

test('source and selection snapshot cannot be retargeted while cryptographic checks yield', async () => {
  const f = fixture(), original = structuredClone(f.expected);
  const pending = readExperienceSceneContent(f.raw, f.expected, f.now);
  f.expected.contentSha256 = '0'.repeat(64); f.expected.artifactId = 'new-scene'; f.expected.expiresAt = new Date(f.now).toISOString();
  f.source.characters[0].name = 'Someone else'; f.source.location = 'Elsewhere';
  const result = await pending;
  assert.deepEqual(result.selection, original);
  assert.equal(result.body, f.body);
});

test('caller getters and custom source iterators are refused without invocation', async () => {
  for (const location of ['selection', 'source', 'character', 'index', 'iterator']) {
    const f = fixture(); let calls = 0; const getter = () => { calls++; throw new Error('must not run'); };
    if (location === 'selection') Object.defineProperty(f.expected, 'contentSha256', {enumerable: true, get: getter});
    if (location === 'source') Object.defineProperty(f.source, 'location', {enumerable: true, get: getter});
    if (location === 'character') Object.defineProperty(f.source.characters[0], 'name', {enumerable: true, get: getter});
    if (location === 'index') Object.defineProperty(f.source.characters, '0', {enumerable: true, get: getter});
    if (location === 'iterator') f.source.characters[Symbol.iterator] = getter;
    assert.equal(await readExperienceSceneContent(f.raw, f.expected, f.now), null); assert.equal(calls, 0);
  }
});

test('unbounded or malformed retained JSON and non-finite clock fail closed', async () => {
  const f = fixture();
  for (const raw of [null, {}, '{', ' '.repeat(1_000_001), 'é'.repeat(500_001)]) assert.equal(await readExperienceSceneContent(raw, f.expected, f.now), null);
  for (const now of [NaN, Infinity, -Infinity]) assert.equal(await readExperienceSceneContent(f.raw, f.expected, now), null);
});

test('invalid label surrogates cannot pair across title and summary boundaries', async () => {
  const f = fixture();
  f.artifact.title += '\uD800'; f.artifact.summary = '\uDC00' + f.artifact.summary;
  f.artifact.items[0].title = f.artifact.title;
  const raw = JSON.stringify(f.artifact);
  assert.equal(await readExperienceSceneContent(raw, {...f.expected, contentSha256: sha(raw)}, f.now), null);
});
