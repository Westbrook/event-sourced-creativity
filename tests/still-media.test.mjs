import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaSize,videoSize,captureMediaSize} from '../src/still/media.ts';
import {stillResults} from '../src/still/results.ts';
test('complete dimensions survive result listings and reference-property naming',()=>{
 const focalPoint={x:.8,y:.3,confidence:1,method:'attention-region-v2',sampleWidth:32,sampleHeight:32};
 const outputs=[{focalPoint,id:'portrait',width:768,height:1344,title:'Portrait',mediaUrl:'/api/media/a',sequence:1}];
 const [result]=stillResults({documentId:'d',outputs,artifacts:[]},[],[]);
 assert.deepEqual(result.focalPoint,focalPoint);
 assert.deepEqual(mediaSize(result),{width:768,height:1344,source:'metadata'});
 assert.deepEqual(mediaSize({image_width:2048,image_height:1024}),{width:2048,height:1024,source:'metadata'});
});
test('incomplete and invalid pairs reserve explicit fallback geometry',()=>{
 for(const metadata of [null,{}, {width:768}, {width:0,height:100}, {width:NaN,height:100}, {width:Infinity,height:100}, {width:'768',height:100}, {width:70000,height:1}, {width:2.2,height:1}])assert.deepEqual(mediaSize(metadata),{width:1024,height:768,source:'fallback'});
});
test('video sizing follows the rendered URL, never an unrelated scene',()=>{
 const a={mediaUrl:'/api/media/assembled',settings:{},items:[{mediaUrl:'/api/media/scene',width:720,height:1280}]};
 assert.deepEqual(videoSize(a,a.items[0].mediaUrl),{width:720,height:1280,source:'metadata'});
 assert.deepEqual(videoSize(a,a.mediaUrl),{width:1280,height:720,source:'fallback'});
 a.settings={width:1920,height:1080};assert.equal(videoSize(a,a.mediaUrl).source,'metadata');
});
test('loaded native dimensions correct fallback and stale metadata without altering sources',()=>{
 for(const element of [{tagName:'IMG',naturalWidth:900,naturalHeight:1600},{tagName:'VIDEO',videoWidth:720,videoHeight:1280}]){
  Object.assign(element,{closest:()=>null,src:'/api/media/original',width:1024,height:768,dataset:{sizeSource:'fallback'}});
  captureMediaSize({currentTarget:element});assert.equal(element.width,element.naturalWidth??element.videoWidth);assert.equal(element.height,element.naturalHeight??element.videoHeight);assert.equal(element.dataset.sizeSource,'intrinsic');assert.equal(element.src,'/api/media/original');
 }
 const failed={tagName:'IMG',naturalWidth:0,naturalHeight:0,width:1024,height:768,dataset:{sizeSource:'fallback'}};captureMediaSize({currentTarget:failed});assert.equal(failed.width,1024);assert.equal(failed.dataset.sizeSource,'fallback');
});
