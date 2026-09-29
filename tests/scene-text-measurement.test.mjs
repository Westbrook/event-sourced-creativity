import test from 'node:test';
import assert from 'node:assert/strict';
import { uncoveredSceneGlyphs, wrapSceneText } from '../src/components/scene-text-measurement.ts';

// Pure unadmitted text metrics only. Actual pinned-font loading is separate.
test('Scene coverage names unsupported glyphs without changing authored text', () => {
  assert.deepEqual(uncoveredSceneGlyphs('Élise — mañana · naïve\nE\u0301'),[]);
  const body='ليلى 👩‍👩‍👧‍👦 等待';
  assert.ok(uncoveredSceneGlyphs(body).includes('ل'));
  assert.ok(uncoveredSceneGlyphs(body).includes('👩'));
  assert.ok(uncoveredSceneGlyphs(body).includes('等'));
  assert.equal(body,'ليلى 👩‍👩‍👧‍👦 等待');
});
test('Scene wrapping preserves leading/trailing spaces and explicit blank lines', () => {
  const lines=wrapSceneText('  A B C  ',4,s=>s.length);
  assert.equal(lines.join(''),'  A B C  ');
  assert.ok(lines.every(line=>line.length<=4));
  assert.deepEqual(wrapSceneText('A\n\nB\n',10,s=>s.length),['A','','B','']);
  assert.deepEqual(wrapSceneText('abc def',4,s=>s.length),['abc ','def']);
});
test('Scene long-word wraps preserve whole graphemes and never normalize combining text', () => {
  const text='E\u0301E\u0301E\u0301';
  const lines=wrapSceneText(text,1,s=>[...new Intl.Segmenter('und',{granularity:'grapheme'}).segment(s)].length);
  assert.deepEqual(lines,['E\u0301','E\u0301','E\u0301']);assert.equal(lines.join(''),text);
  assert.deepEqual(wrapSceneText('abcdef',2,s=>s.length),['ab','cd','ef']);
});
test('Scene measurement refuses impossible and non-finite widths instead of dropping a character', () => {
  for(const width of [0,-1,Infinity,NaN])assert.equal(wrapSceneText('A',width,s=>s.length),null);
  assert.equal(wrapSceneText('A',1,()=>2),null);
  assert.equal(wrapSceneText('A',1,()=>NaN),null);
  assert.equal(wrapSceneText('A',1,()=>-1),null);
});
