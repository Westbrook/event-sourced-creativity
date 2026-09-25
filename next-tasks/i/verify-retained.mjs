// Reads only the explicitly authorized N4 bundle; never a remote reader, never a raw copy.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {buildCreativeDirectionRequest} from '../../worker/openai-adapter.ts';
import {buildBoundedPromptRepresentation} from '../../src/model/prompt-structures.ts';
import {PROFILE,applyProfile,promptSections} from './profile.mjs';
const root='/Users/westbrook/.codex/visualizations/2026/09/22/01a0c67b-ab60-7bd3-b0fe-3cc63442339a/forma-generation-review';
const manifest=JSON.parse(fs.readFileSync(root+'/next-tasks/n4/manifest.json','utf8'));
const custody=manifest.privateEvidence;
if(Date.now()>=Date.parse(custody.deleteNoLaterThan))throw new Error('original_custody_expired_do_not_read');
if(process.env.I_RETAINED_ACCESS_REVOKED==='1')throw new Error('original_custody_revoked_do_not_read');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const seal=s=>({bytes:Buffer.byteLength(s),sha256:hash(s)});
const bytes=fs.readFileSync(custody.path);assert.equal(hash(bytes),custody.sha256);
assert.equal(fs.statSync(custody.path).mode&0o777,0o400);
assert.equal(fs.statSync(fileURLToPath(new URL('.', 'file://'+custody.path))).mode&0o777,0o700);
const bundle=JSON.parse(bytes);for(const r of bundle.records)assert.equal(hash(r.content),r.sha256);
const record=needle=>{const found=bundle.records.filter(r=>r.linkedFrom.some(s=>s.includes(needle)));assert.equal(found.length,1);return found[0];};
const envelope=needle=>JSON.parse(record(needle).content);
const plannerEnv=envelope('forma-direction-330c5437-c846-4388-a374-de9cefb2def3:request');
const planner=JSON.parse(plannerEnv.requestBody),input=JSON.parse(planner.input);
const plannerResponseEnv=envelope('forma-direction-330c5437-c846-4388-a374-de9cefb2def3:response');
const response=JSON.parse(plannerResponseEnv.responseBody);
const responseText=response.output_text??response.output.flatMap(o=>o.content??[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
const savedDirection=record('GenerationCompleted:output_ref').content;
assert.equal(responseText,savedDirection);const direction=JSON.parse(savedDirection);
const admitted=JSON.parse(bundle.job.request_json).snapshot;
const compiler=JSON.parse(envelope(':compiler:request').requestBody).prompt;
const {context:effective}=promptSections(compiler);
const saved=record('GenerationCompleted:prompt_ref').content;
const imageEnv=envelope('forma-image-d277f9b7-2e46-4828-832c-5629fb74874a:request');const image=JSON.parse(imageEnv.requestBody);
const exactEnv=envelope('moderation-4374d9d1-6e02-4286-ad9e-2606b1217c78:request');const exact=JSON.parse(exactEnv.requestBody);
assert.equal(compiler,saved);assert.equal(image.prompt,compiler);assert.equal(exact.input[0].text,compiler);
const advisoryEnv=envelope('moderation-72fc0eb6-0238-494d-9a67-de69bc8f04ce:request');
for(const env of [plannerEnv,imageEnv,exactEnv,advisoryEnv])assert.equal(hash(env.requestBody),env.operation.requestSha256);
// Current compiler given the admitted snapshot plus retained effective envelope additions.
const compileSnapshot={...admitted,document:effective.document,standing_constraints:effective.standing_constraints,reference_inputs:input.reference_inputs};
const rebuilt=buildBoundedPromptRepresentation('prose',compileSnapshot,direction);
assert.equal(rebuilt.prompt,compiler);assert.equal(rebuilt.compacted,false);
const current=buildCreativeDirectionRequest(compileSnapshot,planner.model,planner.safety_identifier,'en');
const currentBody=JSON.parse(current.requestBody);
const requestDiff=Object.keys({...planner,...currentBody}).filter(k=>JSON.stringify(planner[k])!==JSON.stringify(currentBody[k]));
const facts=admitted.facts.map((f,i)=>{
 assert.equal(f.properties.text,input.facts[i].properties.text);assert.equal(f.properties.text,effective.facts[i].properties.text);
 for(const k of ['role','intent','effect','authority']){assert.equal(f[k],input.facts[i][k]);assert.equal(f[k],effective.facts[i][k]);}
 assert.deepEqual(f.properties,input.facts[i].properties);assert.deepEqual(f.properties,effective.facts[i].properties);
 return {index:i,classification:'authored requirement in admitted record; not fresh source authority',text:seal(f.properties.text),intent:f.intent,effect:f.effect,authority:f.authority,weight:f.properties.weight,scope:f.properties.spatial_scope,plannerEquals:true,compilerEquals:true};
});
const treatment=applyProfile(compiler,{enabled:true});
assert.deepEqual(promptSections(treatment),{...promptSections(compiler),head:promptSections(treatment).head});
assert.equal(treatment.slice(PROFILE.treatment.length),compiler.slice(PROFILE.baseline.length));
assert.equal(JSON.stringify(image),imageEnv.requestBody);assert.equal(JSON.stringify(exact),exactEnv.requestBody);
const treatmentImage=JSON.stringify({...image,prompt:treatment});const treatmentExact=JSON.stringify({...exact,input:exact.input.map((x,i)=>i===0?{...x,text:treatment}:x)});
const span=(container,text)=>{const start=container.indexOf(text);assert.ok(start>=0);return {offset:Buffer.byteLength(container.slice(0,start)),...seal(text)};};
const instructionSuffix=currentBody.instructions.startsWith(planner.instructions)?currentBody.instructions.slice(planner.instructions.length):null;
const requestPatches=[['imageRequest',imageEnv.requestBody,treatmentImage],['exactModerationRequest',exactEnv.requestBody,treatmentExact]].map(([target,a,b])=>{const offset=a.indexOf(PROFILE.baseline);assert.ok(offset>=0);assert.equal(b,a.slice(0,offset)+PROFILE.treatment+a.slice(offset+PROFILE.baseline.length));return {target,offset:Buffer.byteLength(a.slice(0,offset)),remove:PROFILE.baseline,insert:PROFILE.treatment};});
const trace={schemaVersion:'i-constraint-trace-v1',originalBundle:seal(bytes),deleteNoLaterThan:custody.deleteNoLaterThan,checkedAt:new Date().toISOString(),noNewRawCopy:true,recordsVerified:bundle.records.length,requestBodiesVerified:4,facts,currentCompiler:{...seal(compiler),identical:true,compacted:false},currentPlanner:{requestDiff,baseline:seal(plannerEnv.requestBody),current:seal(current.requestBody),instructionsOnly:requestDiff.length===1&&requestDiff[0]==='instructions',addedInstructionSuffix:instructionSuffix},direction:seal(savedDirection),specificSpans:{authoredMain:span(compiler,admitted.facts[0].properties.text),plannerScene:span(savedDirection,direction.scene),plannerNextMove:span(savedDirection,direction.next_moves[1])},sectionsPreserved:true,typographyUnchanged:true,observationsAuthority:'N4 result.md dated recorded observation; no image reinspection',acceptance:'unrecorded'};
// Exact patch includes only compiler-owned public text. No private source or planner prose written.
const candidate={schemaVersion:'i-comparison-candidate-v1',id:PROFILE.id,status:'experimental-disabled',ready:false,localInputsVerified:true,liveAuthorized:false,baseCommit:'c28af5fea0fc3ec2b37b878a544ec59c52a64daf',factor:PROFILE.factor,executionMode:'fixed-retained-planner renderer pair; ordinary Generate forbidden for this comparison',sourceAuthority:'N4 dated admitted-job request only; no current workspace-source certification',originalBundle:trace.originalBundle,deleteNoLaterThan:custody.deleteNoLaterThan,baseline:{prompt:seal(compiler),imageRequest:seal(imageEnv.requestBody),moderationRequest:seal(exactEnv.requestBody)},treatment:{prompt:seal(treatment),imageRequest:seal(treatmentImage),moderationRequest:seal(treatmentExact)},exactDiff:{encoding:'UTF-8',offset:0,remove:PROFILE.baseline,insert:PROFILE.treatment,removedBytes:Buffer.byteLength(PROFILE.baseline),insertedBytes:Buffer.byteLength(PROFILE.treatment),changedFields:['imageRequest/prompt','exactModerationRequest/input/0/text'],requestPatches},fixed:{plannerOutput:seal(savedDirection),authoredFacts:facts.map(f=>f.text),imageSettings:Object.fromEntries(Object.entries(image).filter(([k])=>!['prompt','user'].includes(k))),privateUser:seal(image.user),omittedImageFields:['moderation','background','output_compression','input_fidelity','seed','response_format'],remainingPromptBytes:'identical',compilerTypography:'identical',safetyPolicy:'unchanged; fresh matching arm checks required'},plannerOperations:0,proposedImageOperations:2,requiredBeforeLive:['Human review of exact pair and source reuse/acceptance question','Valid unrevoked original custody; no extension or expired reconstruction','P1-qualified fixed-planner supplied-input execution path with normal admission, safety, finance, original-attempt recovery and retention','Current available model/configuration/price and billing exposure pinned; any drift requires revised packet','Separate explicit paid-operation approval, retention/deletion and stop rules'],unknowns:['Visual adherence or improvement','Whether the retained planner addition caused the historical tether','Current returned model identity and configuration','User acceptance','Current workspace source authority'],treatmentMediatedPlannerOutput:false};
if(process.argv.includes('--show-private'))console.log(JSON.stringify({authored:admitted.facts[0],plannerRequestFact:input.facts[0],plannerOutput:direction,compilerContextFact:effective.facts[0]},null,2));
else {
 fs.writeFileSync(new URL('./retained-verification.json',import.meta.url),JSON.stringify(trace,null,2)+'\n');
 fs.writeFileSync(new URL('./comparison-candidate.json',import.meta.url),JSON.stringify(candidate,null,2)+'\n');
 console.log(JSON.stringify({records:trace.recordsVerified,requests:4,facts:facts.length,compiler:trace.currentCompiler,currentPlanner:trace.currentPlanner,baseline:candidate.baseline.prompt,treatment:candidate.treatment.prompt},null,2));
}
