import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {balancedOutputRetainedConjunction} from '../worker/output-retained-witness.ts';
test('balanced proof preserves every ordered predicate and SQL false/null semantics',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const length of [1,2,3,16,47,64]){
   const predicates=Array.from({length},(_,index)=>'(? /* '+index+' */)'),sql=balancedOutputRetainedConjunction(predicates);
   assert.equal((sql.match(/\?/g)||[]).length,length);
   assert.deepEqual([...sql.matchAll(/\/\* (\d+) \*\//g)].map(m=>Number(m[1])),Array.from({length},(_,i)=>i));
   const query=db.prepare('SELECT ('+sql+') AS current');
   assert.equal(query.get(...Array(length).fill(1)).current,1);
   for(const index of new Set([0,Math.floor(length/2),length-1]))for(const value of [0,null]){
    const bindings=Array(length).fill(1);bindings[index]=value;
    assert.equal(query.get(...bindings).current,value);
   }
  }
  assert.throws(()=>balancedOutputRetainedConjunction([]),/output_retained_witness_empty/);
 }finally{db.close();}
});
