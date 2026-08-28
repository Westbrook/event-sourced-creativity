import assert from 'node:assert/strict';
import test from 'node:test';
import {buildPromptRepresentation} from '../src/model/prompt-structures.ts';
const target={schema_version:1,aspect_ratio:{width:1,height:1},dimensions:{width:1024,height:1024,unit:'px'}};
test('the selected frame reaches prose, bullets, JSON and XML without editing the stored source/default',()=>{
 const snapshot={facts:[{block_id:'message',type:'message',properties:{text:'Pear trees beside a sheltered orchard.'}},{block_id:'default',type:'format',properties:{image_format:{schema_version:1,aspect_ratio:{width:3,height:2},dimensions:{width:1536,height:1024,unit:'px'}}}}]};
 const before=structuredClone(snapshot);
 for(const technique of['prose','bullets','json','xml']){
  const prompt=buildPromptRepresentation(technique,snapshot,{title:'Orchard',scene:'Pear trees'},[],{size:'1024x1024',outputImageFormat:target,outputTargetInstructions:'One square image.'});
  assert.match(prompt,/One square image\./);assert.match(prompt,/not factual evidence/);
  if(technique==='json'){const data=JSON.parse(prompt);assert.equal(data.aspect_ratio,'1:1');assert.equal(data.resolution,'1024x1024');assert.equal(data.output_requirements.citable,false);}
  else if(technique==='xml')assert.match(prompt,/<aspect-ratio>1:1<\/aspect-ratio>/);
  else assert.match(prompt,/Output frame: 1024 × 1024 pixels at 1:1/);
 }
 assert.deepEqual(snapshot,before);
 assert.match(buildPromptRepresentation('prose',snapshot,{title:'Orchard',scene:'Pear trees'}),/Output frame: 1536 × 1024 pixels at 3:2/);
});
