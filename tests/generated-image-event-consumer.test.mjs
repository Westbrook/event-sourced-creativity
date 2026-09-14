import assert from 'node:assert/strict';
import test from 'node:test';
import {foldEvents,createCreativeEventFold} from '../src/model/events.ts';
import {createImageEventConsumer} from '../worker/generated-image-event-consumer.ts';
const event=(sequence,type,payload)=>({eventId:'e'+sequence,streamId:'creative:a',sequence,occurredAt:'now',recordedAt:'now',actor:'user',clientId:'fixture',correlationId:'fixture',type,payload});
const seed=()=>[event(1,'ProjectCreated',{project_id:'p',name:'Project'}),event(2,'DocumentCreated',{project_id:'p',document_id:'d',title:'Image'}),
  event(3,'GenerationCompleted',{project_id:'p',document_id:'d',generation_id:'g',object_id:'out',object_ids:['out'],output_ref:'raw',media_url:'/api/media/a'})];
test('late fold selection equals normal initial selection and is single-use',()=>{
  const history=seed(),fold=createCreativeEventFold();for(const e of history)fold.accept(e);
  assert.deepEqual(fold.finish({documentId:'d',projectId:'p'}),foldEvents(history,Infinity,'d','p'));
  assert.throws(()=>fold.finish(),/already_finished/);
});
test('stream consumer retains complete initial/current projections and global alias/privacy evidence',()=>{
  const history=[...seed(),event(4,'ReferenceIngested',{reference_id:'r',rights_class:'owned'}),event(5,'RightsAsserted',{reference_id:'r',rights_class:'denied'}),
    event(6,'GenerationCompleted',{document_id:'other',generation_id:'g',object_id:'other'}),
    event(7,'IdeationPreviewCompleted',{document_id:'other',object_ids:['out']}),event(8,'DocumentArtifactEdited',{artifact_id:'out'}),
    event(9,'GeneratedImageEdited',{output_id:'out'}),event(10,'DocumentRenamed',{document_id:'d',new_title:'Renamed'}),event(11,'UnusedHistory',{large:'ignored'})];
  const consumer=createImageEventConsumer('out','key',row=>row.event);
  for(const e of history)consumer.accept({event:e,private_redacted:null});consumer.checkpoint();const actual=consumer.finish();
  const initial=foldEvents(history.slice(0,3),Infinity,'d');
  assert.deepEqual(actual.initial,{projectId:initial.projectId,libraryOutputs:initial.libraryOutputs.filter(o=>o.id==='out')});
  assert.deepEqual(actual.projection,foldEvents(history,Infinity,'d',initial.projectId));
  assert.deepEqual(actual.events.map(e=>e.sequence),[3,4,5,6,7,8,9]);
  assert.equal(actual.count,11);assert.equal(actual.head,11);assert.deepEqual(actual.envelopes.map(r=>r.event.sequence),[3,7,9]);
  assert.throws(()=>consumer.accept({event:history[0]}));assert.throws(()=>consumer.finish());
});
test('duplicate/out-of-order events and retained-state overflow refuse rather than prune',()=>{
  const duplicate=createImageEventConsumer('out','key',row=>row.event);duplicate.accept({event:seed()[0]});assert.throws(()=>duplicate.accept({event:seed()[0]}),/changed/);
  const large=createImageEventConsumer('out','key',row=>row.event);for(const e of seed())large.accept({event:e});
  large.accept({event:event(4,'ReferenceIngested',{reference_id:'r',text:'x'.repeat(8_000_000)})});
  assert.throws(()=>large.checkpoint(),/capacity_retained/);
});
