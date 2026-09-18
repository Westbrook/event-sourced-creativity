import test from 'node:test';
import assert from 'node:assert/strict';
import {registerOutputSourceImports} from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const {outputVideoFrameDiagnostic}=await import('../src/model/output-video-dimensions.ts');

test('Seedance nominal 480p accepts only the documented native grid for each orientation',()=>{
 assert.equal(outputVideoFrameDiagnostic(864,496,'1280x720'),null);
 assert.equal(outputVideoFrameDiagnostic(496,864,'720x1280'),null);
 for(const [width,height] of [[496,864],[864,495],[863,496],[865,496],[864,497],[1280,720],[640,640],[992,432],[752,560]])
  assert.equal(outputVideoFrameDiagnostic(width,height,'1280x720'),'dimensions');
 assert.equal(outputVideoFrameDiagnostic(864,496,'720x1280'),'dimensions');
});

test('existing standard 480px clips retain their previous orientation and tolerance rules',()=>{
 for(const [width,height,frame] of [[854,480,'1280x720'],[480,854,'720x1280']])assert.equal(outputVideoFrameDiagnostic(width,height,frame),null);
 for(const [width,height,frame] of [[480,854,'1280x720'],[854,480,'720x1280'],[640,480,'1280x720'],[880,480,'1280x720']])assert.equal(outputVideoFrameDiagnostic(width,height,frame),'aspect_ratio');
 for(const [width,height] of [[0,0],[-864,496],[NaN,496],[Infinity,496]])assert.equal(outputVideoFrameDiagnostic(width,height,'1280x720'),'dimensions');
});
