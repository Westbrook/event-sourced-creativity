import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { ApiError } from '../src/still/client.ts';
import { validateGenerationOptions } from '../src/still/generation-settings.ts';
import { generationReview } from '../src/still/generation-review.ts';
const source=ts.createSourceFile('app.ts',fs.readFileSync(new URL('../src/still/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const app=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='StillApp');
function method(name){
 const member=app.members.find(n=>n.name?.getText(source)===name);
 const async=member.modifiers?.some(n=>n.kind===ts.SyntaxKind.AsyncKeyword)?'async ':'';
 const code=ts.transpileModule(`${async}function ${name}(${member.parameters.map(p=>p.getText(source)).join(',')}) ${member.body.getText(source)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function('ApiError','generationReview','validateGenerationOptions',`${code};return ${name};`)(ApiError,generationReview,validateGenerationOptions);
}
function fixture(overrides={}){
 const state={busy:false,composing:false,directGeneration:false,generation:null,generationDrafts:new Map(),generationGate:null,reviewVersion:0,changed(){},draftSignature(){return 'draft';},updateComplete:Promise.resolve(),querySelector(){return null;},navigate(view,ids){this.navigation={view,ids};},focusContent(){},writeRoute(){this.route=this.generation?.format??'';},
 client:{position:{recentActions:[]},prepareGeneration(format){return {format,tone:'',audience:'',itemCount:6};},async generate(){return {jobId:'accepted'};},...overrides},
 async run(work){if(this.busy)return;this.busy=true;try{await work();}catch(error){this.error=error;}finally{this.busy=false;}},chooseFormat:method('chooseFormat'),generate:method('generate'),selectGenerationFormat:method('selectGenerationFormat')};
 return state;
}
test('every format opens configuration without estimating, reserving or generating',()=>{
 for(const format of ['image','short_story','scene','slides','storyboard','video','audio','model3d']){
  let submitted=0;const s=fixture({async generate(){submitted++;},async previewScene(){throw Error('Unrequested estimate');}});
  s.selectGenerationFormat(format);assert.equal(submitted,0);assert.equal(s.route,format);assert.equal(s.generation.format,format);assert.equal(s.navigation,undefined);
 }
});
test('back to types and reselect preserve settings while attempts remain locked',()=>{
 const s=fixture();s.selectGenerationFormat('slides');s.generation.tone='Warm';s.generation.itemCount=12;
 s.chooseFormat('');assert.equal(s.generation,null);s.selectGenerationFormat('slides');assert.equal(s.generation.itemCount,12);assert.equal(s.generation.tone,'Warm');
 s.generation.attempted=true;s.chooseFormat('video');assert.equal(s.generation.format,'slides');
});
test('a separate submission generates once and preserves required reviews',async()=>{
 let submitted=0;const s=fixture({async generate(){submitted++;return {jobId:'accepted'};}});
 s.selectGenerationFormat('image');assert.equal(submitted,0);await s.generate();assert.equal(submitted,1);assert.deepEqual(s.navigation,{view:'generation',ids:{outputId:'accepted'}});
 const scene=fixture({async previewScene(){return {maximumMicrousd:100};},async generate(){throw Error('Submit before quote');}});
 scene.selectGenerationFormat('scene');await scene.generate();assert.equal(scene.generation.scenePreview.maximumMicrousd,100);assert.equal(scene.navigation,undefined);
 const warning=fixture({async generate(){throw new ApiError(428,{error:'generation_preflight_review_required'});}});
 warning.selectGenerationFormat('image');await warning.generate();assert.equal(warning.generationGate.key,'preflightAcknowledged');assert.equal(warning.navigation,undefined);
});
