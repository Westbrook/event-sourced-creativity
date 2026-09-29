import test from 'node:test';
import assert from 'node:assert/strict';
import {decodedAudioPeaks,audioPeaks,audioEnvelope,waveformPath,readWaveformBytes,MAX_WAVEFORM_BYTES} from '../src/still/audio-waveform.ts';
test('waveform follows the full recording, including quiet sections and the last sample',()=>{
 const samples=new Float32Array(1200);samples[200]=.25;samples[700]=.5;samples[1199]=1;
 const peaks=audioPeaks([samples],12);assert.equal(peaks.length,12);assert.deepEqual(peaks,[0,0,.25,0,0,0,0,.5,0,0,0,1]);
 assert.match(waveformPath(peaks),/M575.00 26.00V154.00$/);
});
test('all channels contribute without phase cancellation or invented peaks',()=>{
 assert.deepEqual(audioPeaks([new Float32Array([-.5,0,0]),new Float32Array([.5,0,1])],3),[.5,0,1]);
 assert.deepEqual(audioPeaks([new Float32Array(4)],2),[0,0]);assert.equal(waveformPath([0,0]),'M150.00 90.00V90.00 M450.00 90.00V90.00');
 assert.deepEqual(audioPeaks([new Float32Array([NaN,Infinity,-2])],3),[0,0,1]);
 assert.deepEqual(audioPeaks([]),[]);assert.deepEqual(audioPeaks([new Float32Array(1),new Float32Array(2)]),[]);
});
test('waveform transfer rejects failures, aborts and excessive data; preserves exact bytes',async()=>{
 const signal=new AbortController().signal;
 const data=new Uint8Array([82,73,70,70]);assert.deepEqual(new Uint8Array(await readWaveformBytes(new Response(data),signal)),data);
 await assert.rejects(readWaveformBytes(new Response('denied',{status:403}),signal));
 await assert.rejects(readWaveformBytes(new Response(data,{headers:{'content-length':String(MAX_WAVEFORM_BYTES+1)}}),signal));
 await assert.rejects(readWaveformBytes(new Response(new Uint8Array(MAX_WAVEFORM_BYTES+1)),signal));
 const aborted=new AbortController();aborted.abort();await assert.rejects(readWaveformBytes(new Response(data),aborted.signal));
});

test('cooperative analysis matches the envelope and honors navigation cancellation',async()=>{
 const samples=Float32Array.from({length:1201},(_,i)=>i/1201);
 assert.deepEqual(await decodedAudioPeaks([samples],new AbortController().signal),audioEnvelope([samples]));
 const controller=new AbortController(),pending=decodedAudioPeaks([samples],controller.signal);controller.abort();await assert.rejects(pending);
});


test('RMS envelope retains loud-signal detail without inventing variation in constant audio',()=>{
 const signal=new Float32Array(400);for(let i=0;i<400;i++)signal[i]=i%100===0?1:i<200?.2:.8;
 const raw=audioPeaks([signal],4),energy=audioEnvelope([signal],4);
 assert.deepEqual(raw,[1,1,1,1]);assert.ok(energy[0]<energy[2]);assert.equal(energy[0],energy[1]);
 assert.deepEqual(audioEnvelope([new Float32Array(400).fill(1)],4),[1,1,1,1]);
 assert.deepEqual(audioEnvelope([new Float32Array(4)],2),[0,0]);
 assert.equal(waveformPath([1]),'M300.00 26.00V154.00');
});
