import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSceneScreenplay, sceneScreenplayText } from '../src/model/scene-screenplay.ts';

// Synthetic, unadmitted parser input only; not an original generated artifact.
const script = () => ({ schemaVersion: 1, format: 'forma-screenplay@1',
  heading: { setting: 'INT.', location: 'location', time: 'NIGHT' },
  blocks: [{ kind: 'action', text: 'A hand rests on the locked door.' },
    { kind: 'dialogue', speaker: 'A', parenthetical: null, text: '  Who has the key?\nTell me.  ' },
    { kind: 'dialogue', speaker: 'B', parenthetical: 'quietly', text: 'You do.' }] });
const source = () => ({ characters: [{ id: 'A', name: 'ليلى' }, { id: 'B', name: 'ليلى' }], location: 'Waiting room' });

test('closed Scene structure preserves literal bytes and projects exact source labels without merging equal names', () => {
  const raw = script(), captured = parseSceneScreenplay(raw);
  assert.deepEqual(captured, raw);
  const body = sceneScreenplayText(captured, source());
  assert.equal(body, 'INT. Waiting room · NIGHT\n\nA hand rests on the locked door.\n\nA · ليلى\n  Who has the key?\nTell me.  \n\nB · ليلى\n(quietly)\nYou do.');
  raw.blocks[1].text = 'Changed'; assert.notEqual(captured.blocks[1].text, raw.blocks[1].text);
  assert.throws(() => captured.blocks.push(raw.blocks[0]), TypeError);
  assert.throws(() => { captured.heading.time = 'DAY'; }, TypeError);
});

test('Scene structure refuses added headings, foreign characters/locations, missing dialogue and action-free scripts', () => {
  for (const mutate of [s => { s.blocks[2].speaker = 'C'; }, s => { s.heading.location = 'second-location'; },
    s => { s.blocks.push({ kind: 'heading', text: 'EXT. STREET - DAY' }); }, s => { s.blocks[2].speaker = 'A'; },
    s => { s.blocks[0] = s.blocks[1]; }, s => { s.blocks[1].speakerName = 'Other'; },
    s => { s.heading.character = 'A'; }, s => { s.pageCount = 1; }, s => { s.blocks = s.blocks.slice(0, 2); }]) {
    const raw = script(); mutate(raw); assert.equal(parseSceneScreenplay(raw), null);
  }
  const reordered = script(); reordered.blocks.reverse(); assert.equal(parseSceneScreenplay(reordered), null);
});

test('Scene parser rejects sparse/executable envelopes without invoking getters or coercion', () => {
  let called = false;
  const accessor = script(); Object.defineProperty(accessor.blocks[1], 'text', { enumerable: true, get() { called = true; return 'hidden'; } });
  const coerced = script(); coerced.heading.setting = { toString() { called = true; return 'INT.'; } };
  const sparse = script(); delete sparse.blocks[1];
  const symbol = script(); symbol[Symbol('extra')] = true;
  const inherited = script(); Object.setPrototypeOf(inherited.heading, { provider: true });
  for (const raw of [accessor, coerced, sparse, symbol, inherited]) assert.equal(parseSceneScreenplay(raw), null);
  assert.equal(called, false);
});

test('Scene byte limits and invalid control data fail without clipping or padding; Unicode remains literal', () => {
  for (const content of [' ', 'bad\u0000text', 'bad\u202etext', 'bad\ud800text', 'bad\rtext', 'x'.repeat(8193)]) {
    const raw = script(); raw.blocks[0].text = content; assert.equal(parseSceneScreenplay(raw), null);
  }
  const unicode = script(); unicode.blocks[0].text = 'Élise 👩‍👩‍👧‍👦 sees <the sign> & waits — فارسی می‌ماند — क्‍ष.';
  assert.equal(parseSceneScreenplay(unicode).blocks[0].text, unicode.blocks[0].text);
  const large = script(); large.blocks.push(...Array.from({ length: 8 }, () => ({ kind: 'action', text: '界'.repeat(8192) })));
  assert.equal(parseSceneScreenplay(large), null);
  const many = script(); many.blocks.push(...Array.from({ length: 126 }, () => ({ kind: 'action', text: 'Wait.' })));
  assert.equal(parseSceneScreenplay(many), null);
});

test('Scene display source refuses reordered or substituted identity slots and never supplies absent names', () => {
  for (const mutate of [s => s.characters.reverse(), s => { s.characters[1].id = 'C'; }, s => { s.characters[0].name = ''; },
    s => { s.location = ''; }, s => { s.characters[1].fallback = 'Someone'; }]) {
    const names = source(); mutate(names); assert.equal(sceneScreenplayText(script(), names), null);
  }
  assert.equal(sceneScreenplayText(script(), null), null);
});
