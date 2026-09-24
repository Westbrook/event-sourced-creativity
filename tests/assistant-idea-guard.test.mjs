import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantIdeaMutationIssue } from '../worker/assistant-idea-guard.ts';
import { plainTextIdeaBody } from '../src/model/idea-body.ts';
const block=(id,properties={})=>({id,projectId:'project',documentId:'document',scope:'library',type:'subject',handle:id,position:'a',properties:{text:id,...properties},sourceEvents:[],removed:false});
const reference=target=>({schemaVersion:1,document:{type:'en-rich-text',version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'token',attrs:{run:{kind:'token',id:'mention',type:'still-idea-reference',text:target,label:target,data:{schemaVersion:1,kind:'idea-reference',projectId:'project',blockId:target}}}}]}]}}});
const projection=(blocks,relations=[])=>({libraryBlocks:blocks,libraryBlockRelations:relations});
test('assistant and Memory text-only edits route structured bodies and Format preferences to Still',()=>{
 for(const properties of [{rich_text_body:plainTextIdeaBody('Paul')},{rich_text_body:{schemaVersion:99}},{preferred_output_kinds:['image']}])assert.equal(assistantIdeaMutationIssue({kind:'context.edit',targetBlockId:'target',text:'changed'},projection([block('target',properties)])),'idea_body_editor_required');
 assert.equal(assistantIdeaMutationIssue({kind:'context.edit',targetBlockId:'target',text:'changed'},projection([block('target')])) ,null);
});
test('assistant cannot remove a referenced Idea through its legacy private SQL path',()=>{
 const p=projection([block('scene',{rich_text_body:reference('person')}),block('person')]);
 assert.equal(assistantIdeaMutationIssue({kind:'context.remove',targetBlockId:'person'},p),'idea_reference_unavailable');
 assert.equal(assistantIdeaMutationIssue({kind:'context.remove',targetBlockId:'scene'},p),null);
});
test('assistant relation creation cannot close a cycle through a generic Idea reference',()=>{
 const p=projection([block('scene',{rich_text_body:reference('person')}),block('person')]);
 assert.equal(assistantIdeaMutationIssue({kind:'context.relation.add',fromBlockId:'person',toBlockId:'scene',relationKind:'context_contains'},p),'idea_reference_cycle');
 assert.equal(assistantIdeaMutationIssue({kind:'context.relation.add',fromBlockId:'scene',toBlockId:'person',relationKind:'context_contains'},p),null);
});
test('unrelated legacy assistant edits remain available beside an unknown future body',()=>{
 const p=projection([block('future',{rich_text_body:{schemaVersion:99}}),block('other')]);
 assert.equal(assistantIdeaMutationIssue({kind:'context.remove',targetBlockId:'other'},p),null);
 assert.equal(assistantIdeaMutationIssue({kind:'context.edit',targetBlockId:'other',text:'Other'},p),null);
});
