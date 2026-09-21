import test from 'node:test';
import assert from 'node:assert/strict';
import {WaveformCache} from '../src/still/waveform-cache.ts';
const storage=()=>{const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};};
test('waveform cache survives a new runtime and isolates file, user and permission scope',()=>{
 const disk=storage(),first=new WaveformCache(()=>disk,()=>100);
 first.put('alice:workspace:epoch','/api/media/a',3,[0,.2,.8]);
 const second=new WaveformCache(()=>disk,()=>200);
 assert.deepEqual(second.get('alice:workspace:epoch','/api/media/a').levels,[0,.2,.8]);
 for(const scope of ['bob:workspace:epoch','alice:other:epoch','alice:workspace:new'])assert.equal(second.get(scope,'/api/media/a'),undefined);
 assert.equal(second.get('alice:workspace:epoch','/api/media/b'),undefined);
});
test('waveform cache expires, bounds entries and rejects corrupt envelopes',()=>{
 const disk=storage(),cache=new WaveformCache(()=>disk,()=>100);
 for(let i=0;i<60;i++)cache.put('s','/api/media/'+i,3,[.1]);
 assert.equal(cache.get('s','/api/media/0'),undefined);assert.ok(cache.get('s','/api/media/59'));
 assert.equal(new WaveformCache(()=>disk,()=>31*86400000).get('s','/api/media/59'),undefined);
 for(const levels of [[],[NaN],[Infinity],[-1],[2],Array(121).fill(.5)])cache.put('s','/api/media/bad',3,levels);
 assert.equal(cache.get('s','/api/media/bad'),undefined);
 disk.setItem('still:waveforms:v2','not json');assert.equal(new WaveformCache(()=>disk).get('s','/api/media/a'),undefined);
});
test('unavailable browser storage keeps a useful memory cache and never blocks playback',()=>{
 const cache=new WaveformCache(()=>{throw new Error('denied');});cache.put('s','/api/media/a',3,[.3]);assert.deepEqual(cache.get('s','/api/media/a').levels,[.3]);
});
