import { CASES, REFERENCES } from './cases.mjs';
import { makeCell, makeManifest, factorDiff } from './core.mjs';
const base = c => ({ prompt:c.prompt, references:[], model:'gpt-image-2.5-sunburst', quality:'high', size:'1536x1024', outputFormat:'png', stream:false,
  endpoint:'/v1/images/generations', orchestration:'direct-frozen-prompt', modelResolution:'unresolved-alias', technique:'prose',
  planner:{ mode:'frozen',model:'gpt-5.6-terra',reasoning:'low',instructions:'captured-original',newDirection:null },
  compiler:'captured-original', moderation:'auto', history:[], referenceRoleWording:'authorized property only', evidenceVersion:'original', strictModeration:false, recovery:'original-only', estimator:'unqualified',
  checker:{mode:'off',backend:'none',policy:'benign-fixtures-v1',context:'brief'}, attachedModeration:'off', semantics:'original', modality:'image' });
const clean = c => ({ compiler:'remove-provenance', prompt:`Render brief:\n${c.prompt}` });
// A recipe's explicitly named compiler change and resulting prompt are one treatment.
// These are synthetic design examples, not implemented candidate compiler outputs.
export const EXPERIMENTS = [
  ['E0a','evidence-only',()=>({evidenceVersion:'A-v1'}),'Evidence correctness, identical media request'],
  ['E0b','strict-validation',()=>({strictModeration:true}),'Strict result validation; malformed moderation blocks downstream'],
  ['E1','historical-freeze',()=>({evidenceVersion:'HIST-private-hash-verification'}),'Private HIST hash evidence, unknown source/direction stay unknown; synthetic cells are not historical replay'],
  ['E2a','provenance',clean,'Remove bookkeeping while preserving authored text'],
  ['E2b','spatial-boilerplate',c=>({compiler:'omit-default-document-scope',prompt:`Preserve all local scopes.\n${c.prompt}` }),'Default spatial boilerplate only'],
  ['E2c','deduplication',c=>({compiler:'deduplicate',prompt:`Unique authored requirements:\n${c.prompt}` }),'Freeze shared idea content, membership and version'],
  ['E2d','render-brief',c=>({compiler:'render-brief',prompt:`Scene, palette and required details:\n${c.prompt}` }),'Auxiliary visual requirements remain mandatory'],
  ['E2e','role-correction',()=>({semantics:'explicit-approved-group-role-correction'}),'Intentional semantic change, not formatting'],
  ['E3','literary-clarification',c=>({prompt:`${c.prompt}\nPreserve the named identity and era in an original illustration.`}),'Explicit clarification preserving identity'],
  ['E4','route-orchestration',()=>({endpoint:'/v1/responses',orchestration:'responses-image-tool-with-recorded-mainline-model'}),'Route plus orchestration, effective revised prompt unknown until receipt'],
  ['E5a','model',()=>({model:'gpt-image-2.5-flare'}),'Experiment-only model at fixed high quality'],
  ['E5b','snapshot',()=>({model:'gpt-image-2.5-sunburst-2026-09-08',modelResolution:'dated-model-id'}),'Alias versus snapshot, equality not assumed'],
  ['E6a','planner-reasoning',()=>({planner:{mode:'rerun-full-workflow',model:'gpt-5.6-terra',reasoning:'medium',instructions:'captured-original',newDirection:null}}),'Separate full-workflow treatment; generated direction not known'],
  ['E6b','planner-model',()=>({planner:{mode:'rerun-full-workflow',model:'gpt-5.6-sol',reasoning:'low',instructions:'captured-original',newDirection:null}}),'Full workflow, common reasoning support requires qualification'],
  ['E6c','planner-brief',()=>({planner:{mode:'rerun-full-workflow',model:'gpt-5.6-terra',reasoning:'low',instructions:'tight-render-brief-authority-preserved',newDirection:null}}),'Full workflow instructions only'],
  ['E7','history',()=>({history:[{role:'user',content:'Keep the same authored subject, period and exclusions.'}] }),'Responses fixed relevant history'],
  ['E8','moderation',()=>({moderation:'low'}),'Optional benign policy study; never retry fallback'],
  ['E9a','asset-combination',()=>({references:REFERENCES,endpoint:'/v1/images/edits'}),'Reference presence plus generations-to-edits route; valid intended tasks required'],
  ['E9b','derivative',()=>({references:[{...REFERENCES[0],bytesHash:'d'.repeat(64),width:16,height:12,derivative:'synthetic resize; coverage requires review'}] }),'Derivative pixels/dimensions only, source hash retained'],
  ['E9c','reference-role',()=>({referenceRoleWording:'Use only composition; preserve authored subject and exclusions.'}),'Identical reference bytes/order/route, role wording only'],
  ['E10a','quality',()=>({quality:'low'}),'Experiment-only fixed Sunburst, never production low override'],
  ['E10b','size',()=>({size:'1024x1536'}),'Only dimensions; format/stream are separate later manifests'],
  ['E11','diagnosis',()=>({evidenceVersion:'A-v1-UX-review'}),'Mocked evidence viewing, zero provider calls'],
  ['E12','cross-media',()=>({modality:'cross-media-contract-fixtures'}),'Contract adoption, no pooled cross-media image fidelity claim'],
  ['E13a','context-check',()=>({checker:{mode:'observe',backend:'LLM-policy-check',policy:'benign-fixtures-v1',context:'brief'}}),'Optional shadow checker, existing dispatch unchanged'],
  ['E13b','safeguard',()=>({checker:{mode:'observe',backend:'gpt-oss-safeguard-20b',policy:'benign-fixtures-v1',context:'brief'}}),'Text-only separately hosted backend, no provisioning'],
  ['E13c','clarification',c=>({prompt:`${c.prompt}\nExplicitly preserve all named authored requirements.`,semantics:'user-visible-clarification'}),'Separate clarification assistance with visible intent diff'],
  ['E14','attached-text',()=>({attachedModeration:'observe-complete-output'}),'Attached versus standalone on same captured text, not image preapproval'],
  ['E15','reuse',()=>({recovery:'completed-zero-call-uncertain-original-status-only'}),'Offline zero-purchase admission'],
  ['E16','estimate',()=>({estimator:'model-specific-unqualified-consumption'}),'Qualification protocol only; Replay remains closed'],
];
const routes = () => ({endpoint:'/v1/responses',orchestration:'responses-image-tool-with-recorded-mainline-model'});
export const COMBINATIONS = [
  ['C1',['E2a','E2b','E2c','E2d'],'compiler constituents plus combined cell'],
  ['C2',['E2a','E4'],'full prompt-by-route factorial'],
  ['C3',['E3','E4'],'full clarification-by-route factorial'],
  ['C4',['E4','E5a'],'full route-by-model factorial; unsupported cells remain missing'],
  ['C5',['E2a','E9c'],'compiler-by-role factorial on identical reference assets'],
  ['C6',['E6a','E2a'],'planner-by-compiler full-workflow factorial'],
  ['C7',['E4','E8'],'optional route-by-moderation factorial'],
  ['C8',['E0a','E12'],'adoption group, not statistical interaction'],
  ['C9',['E5a','E10a'],'model-by-quality factorial, independent of production routing'],
  ['C10',['E13a','E14'],'optional independent checker evidence factorial'],
];
const recipe = (id,c) => EXPERIMENTS.find(e=>e[0]===id)[2](c);
export function exampleManifests() {
  const examples = [];
  for (const [id,,patch,interpretation] of EXPERIMENTS) {
    const cases = [CASES[0]], c = cases[0];
    let config = base(c);
    if (id.startsWith('E6')) config={...config,planner:{...config.planner,mode:'rerun-full-workflow'}};
    if (id==='E10a') config={...config,model:'gpt-image-2.5-sunburst-2026-09-08',modelResolution:'dated-model-id'};
    if (id==='E7') config={...config,...routes()};
    if (['E9b','E9c'].includes(id)) config={...config,references:[REFERENCES[0]],endpoint:'/v1/images/edits'};
    if (id==='E13b') config={...config,...recipe('E13a',c)};
    const root=makeCell(c,config), changed={...config,...patch(c)};
    const diff=factorDiff(config,changed);
    const variants=[makeCell(c,changed,root,diff)];
    if(id==='E9a') for(const ref of REFERENCES) { const one={...config,references:[ref],endpoint:'/v1/images/edits'}; variants.push(makeCell(c,one,root,factorDiff(config,one))); }
    if(id==='E10a') {const medium={...config,quality:'medium'};variants.push(makeCell(c,medium,root,['quality']));}
    const noMedia=['E0a','E0b','E1','E11','E12','E15','E16'].includes(id);
    examples.push(makeManifest({experiment:id,cases,cells:[root,...variants],allowedFactors:diff,interpretation,
      callsPerTrial:{planner:id.startsWith('E6')?1:0,media:noMedia?0:1,moderation:noMedia?0:1,evaluator:noMedia?0:1,contextChecker:id.startsWith('E13')?1:0,status:0,result:0},
      gates:['synthetic_design_example_requires_actual_candidate_capture']}));
  }
  for(const[id,components,interpretation]of COMBINATIONS){
    const c=CASES[0],cases=[c]; let config=base(c);
    if(id==='C6') config={...config,planner:{...config.planner,mode:'rerun-full-workflow'}};
    if(id==='C9') config={...config,model:'gpt-image-2.5-sunburst-2026-09-08',modelResolution:'dated-model-id'};
    if(id==='C5') config={...config,references:[REFERENCES[0]],endpoint:'/v1/images/edits'};
    const root=makeCell(c,config), cells=[root],allowed=new Set();
    const masks=id==='C1'?[1,2,4,8,15]:[1,2,3];
    for(const mask of masks){
      let next={...config};
      components.forEach((component,index)=>{if(mask&(1<<index)) next={...next,...recipe(component,c)};});
      if(id==='C9'&&next.model==='gpt-image-2.5-flare') next.model='gpt-image-2.5-flare-2026-09-08';
      if(id==='C1'&&mask===15) next={...next,compiler:'provenance+scope+dedup+render-brief',prompt:`Combined cleaned rendering brief:\n${c.prompt}`};
      const diff=factorDiff(config,next);diff.forEach(f=>allowed.add(f));cells.push(makeCell(c,next,root,diff));
    }
    examples.push(makeManifest({experiment:id,cases,cells,allowedFactors:[...allowed],interpretation,callsPerTrial:{planner:id==='C6'?1:0,media:id==='C8'?0:1,moderation:1,evaluator:1,contextChecker:id==='C10'?1:0,status:0,result:0},gates:['individual_screens_first','synthetic_design_example_requires_actual_candidate_capture']}));
  }
  return examples;
}
export function firstScreen(){
  const cells=CASES.flatMap(c=>{const root=makeCell(c,base(c));return[root,makeCell(c,{...base(c),...clean(c)},root,['compiler','prompt'])];});
  return makeManifest({experiment:'first-screen-proposed-E2a',cases:CASES,cells,repetitions:3,allowedFactors:['compiler','prompt'],
    interpretation:'Six synthetic strata × three correlated repetitions × two frozen prompt arms. Incident-equivalent is synthetic; actual private incident requires a new authorized manifest with captured source/direction, not substitution.',
    callsPerTrial:{planner:0,media:1,moderation:1,evaluator:1,contextChecker:0,status:0,result:0},gates:['actual_private_incident_not_yet_admitted','actual_candidate_compiler_capture_required']});
}
