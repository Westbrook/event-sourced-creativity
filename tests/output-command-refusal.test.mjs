import test from 'node:test';
import assert from 'node:assert/strict';
import {outputCommandRefusal} from '../src/experiences/output-command-refusal.ts';
const refusal=error=>({version:1,status:'unavailable',originalIntent:'unknown_or_retained',error});
test('bounded server refusal is distinct from an unknown transport outcome',()=>{
 assert.deepEqual(outputCommandRefusal(refusal('experience_output_source_changed')),{code:'experience_output_source_changed'});
 for(const code of ['not_loaded','submission_unconfirmed','original_unavailable','withdrawn'])assert.equal(outputCommandRefusal(refusal(code)),null);
});
test('successful status clears refusal and arbitrary text is not displayed',()=>{
 assert.equal(outputCommandRefusal({status:'review',draftId:'draft'}),null);
 for(const code of ['https://private.invalid','<script>secret</script>','Private source text','x'.repeat(97),null])assert.equal(outputCommandRefusal(refusal(code)),null);
});
