import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Newly authored isolated controls of actual production members, not held fixtures.
const source = readFileSync(new URL('../src/components/forma-output-requirements.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('controller.ts', source, ts.ScriptTarget.Latest, true);
const controller = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FormaOutputRequirements');
const member = name => controller.members.find(node => node.name?.getText(parsed) === name).getText(parsed).replace(/#([A-Za-z]\w*)/g, '_$1');
function fixture() {
  const frames = new Map(), cleared = []; let serial = 0, current = true, route = '/preview';
  class Element { closest() { return this; } }
  const region = new Element(); region.isConnected = true; region.dataset = { previewResult: 'result' };
  const thumbnail = new Element(); region.contains = element => element === region || element === thumbnail;
  const doc = { activeElement: region, defaultView: {
    requestAnimationFrame(callback) { frames.set(++serial, callback); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); },
  } };
  const code = `class Harness { _previewFocusFrame=0; ${member('#previewFocusDeparted')} ${member('#evictOffscreenReviewImages')} }; Harness`;
  const Class = vm.runInNewContext(ts.transpile(code, { target: ts.ScriptTarget.ES2022 }), { Element });
  const instance = new Class();
  Object.assign(instance, { isConnected:true, ownerDocument:doc, store:{ route:{get:()=>route} },
    _captureView:()=>({}), _viewCurrent:()=>current, contains:element=>element===region,
    _offscreenPreviews:new Set(['result']), _previewObserved:new Map([[region,'result']]),
    _reviewPreviews:new Map([['result',{kind:'image'}]]), _previewDialog:null,
    _clearReviewPreview:id=>cleared.push(id), updates:0, requestUpdate(){this.updates++;},
  });
  return { instance, doc, region, thumbnail, frames, cleared,
    depart:()=>instance._previewFocusDeparted({target:region}),
    flush:()=>{for(const [id,cb] of frames){frames.delete(id);cb();}},
    retire:()=>{current=false;}, reroute:()=>{route='/other';} };
}

test('region-to-thumbnail native focus finishes before offscreen cleanup', () => {
  const f=fixture(); f.doc.activeElement=null; f.depart();
  assert.equal(f.cleared.length,0); assert.equal(f.frames.size,1);
  f.doc.activeElement=f.thumbnail; f.flush();
  assert.deepEqual(f.cleared,[]); assert.equal(f.instance.updates,0);
});
test('genuine offscreen focus departure releases the unowned image once', () => {
  const f=fixture(); f.depart(); f.doc.activeElement=null; f.flush();
  assert.deepEqual(f.cleared,['result']); assert.equal(f.instance.updates,1);
});
for(const boundary of ['retire','reroute']) test(`${boundary} prevents queued focus cleanup from acting on another view`,()=>{
  const f=fixture(); f.depart(); f.doc.activeElement=null; f[boundary](); f.flush();
  assert.deepEqual(f.cleared,[]); assert.equal(f.instance.updates,0);
});
test('multiple focus transitions coalesce and an open dialog keeps its image',()=>{
  const f=fixture(); f.depart(); f.depart(); assert.equal(f.frames.size,1);
  f.doc.activeElement=null; f.instance._previewDialog={preview:f.instance._reviewPreviews.get('result')};f.flush();
  assert.deepEqual(f.cleared,[]);
});
test('result rendering is keyed by result identity and disconnect cancels pending focus work',()=>{
  assert.match(source,/repeat\(results, \(result\) => result\.id, \(result\) => this\.#result/);
  const disconnect=member('disconnectedCallback');
  assert.match(disconnect,/cancelAnimationFrame\(this\._previewFocusFrame\)/);
  assert.match(disconnect,/this\._clearReviewPreview\(\)/);
});
