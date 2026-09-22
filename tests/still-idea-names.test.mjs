import test from 'node:test';
import assert from 'node:assert/strict';
import { genericIdeaName, descriptiveIdeaName, ideaExcerpt } from '../src/model/idea-names.ts';
import { newLearnedSuggestion } from '../src/model/context-intelligence.ts';
test('legacy category handles get grounded display suggestions without losing meaningful names',()=>{
 for(const name of ['Subject','subject/subject','Something','style/style','Untitled'])assert.equal(genericIdeaName(name),true,name);
 assert.equal(descriptiveIdeaName('Subject','Atticus Finch is a lawyer.','subject'),'Atticus Finch is a lawyer.');
 assert.equal(descriptiveIdeaName('Atticus’s family','A long description','subject'),'Atticus’s family');
 assert.ok(ideaExcerpt('word '.repeat(100)).length<=240);
});
test('research labels survive normalization; legacy or generic responses use their own content',()=>{
 const data={id:'learned',type:'subject',text:'Atticus Finch is the father of Scout and Jem.'};
 assert.equal(newLearnedSuggestion({...data,label:'Atticus Finch’s family'},[]).label,'Atticus Finch’s family');
 assert.equal(newLearnedSuggestion({...data,label:'Subject'},[]).label,data.text);
 assert.equal(newLearnedSuggestion(data,[]).label,data.text);
});
