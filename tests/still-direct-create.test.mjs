import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { ApiError } from '../src/still/client.ts';
import { generationReview } from '../src/still/generation-review.ts';
const source=ts.createSourceFile('app.ts',fs.readFileSync(new URL('../src/still/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const app=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='StillApp');
function method(name){
 const member=app.members.find(n=>n.name?.getText(source)===name);
 const async=member.modifiers?.some(n=>n.kind===ts.SyntaxKind.AsyncKeyword)?'async ':'';
 const code=ts.transpileModule(`${async}function ${name}(${member.parameters.map(p=>p.getText(source)).join(',')}) ${member.body.getText(source)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function('ApiError','generationReview',`${code};return ${name};`)(ApiError,generationReview);
}
function fixture(overrides={}){
 const state={busy:false,composing:false,directGeneration:false,generation:null,generationGate:null,reviewVersion:0,changed(){},draftSignature(){return 'draft';},updateComplete:Promise.resolve(),querySelector(){return null;},navigate(view,ids){this.navigation={view,ids};},writeRoute(){throw Error('Unexpected intermediate route');},
 client:{prepareGeneration(format){return {format};},async generate(){return {jobId:'accepted'};},...overrides},
 async run(work){if(this.busy)return;this.busy=true;try{await work();}catch(error){this.error=error;}finally{this.busy=false;}},generate:method('generate'),startGeneration:method('startGeneration')};
 return state;
}
test('explicit format choices submit directly to a generation view with no intermediate route',async()=>{
 for(const format of ['image','short_story','slides','storyboard','video','audio','model3d']){
  let submitted=0;const s=fixture({async generate(draft){submitted++;assert.equal(draft.format,format);return {jobId:'accepted'};}});
  await s.startGeneration(format);assert.equal(submitted,1);assert.deepEqual(s.navigation,{view:'generation',ids:{outputId:'accepted'}});assert.equal(s.directGeneration,false);
 }
});
test('rapid repeated clicks cannot submit another generation',async()=>{
 let release,submitted=0;const waiting=new Promise(resolve=>release=resolve);const s=fixture({async generate(){submitted++;await waiting;return {jobId:'accepted'};}});
 const first=s.startGeneration('image');await s.startGeneration('video');assert.equal(submitted,1);release();await first;
});
test('scene cost and server-required reviews remain explicit',async()=>{
 let submissions=0;const scene=fixture({async previewScene(){return {maximumMicrousd:100};},async generate(){submissions++;}});
 await scene.startGeneration('scene');assert.equal(submissions,0);assert.equal(scene.generation.scenePreview.maximumMicrousd,100);assert.equal(scene.navigation,undefined);
 const warning=fixture({async generate(){throw new ApiError(428,{error:'generation_preflight_review_required'});}});
 await warning.startGeneration('image');assert.equal(warning.generationGate.key,'preflightAcknowledged');assert.equal(warning.navigation,undefined);assert.equal(warning.directGeneration,false);
 const unknown=fixture({prepareGeneration(){return {format:'image',attempted:true};},async generate(){throw Error('Original generation unconfirmed');}});
 await unknown.startGeneration('image');assert.match(unknown.error.message,/unconfirmed/);assert.equal(unknown.navigation,undefined);assert.equal(unknown.generation.attempted,true);
});
