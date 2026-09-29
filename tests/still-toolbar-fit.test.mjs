import test from 'node:test';
import assert from 'node:assert/strict';
import {fitToolbarLimit} from '../src/still/toolbar-fit.ts';
const widths=[{limit:1,width:90},{limit:2,width:310},{limit:3,width:350},{limit:4,width:480},{limit:5,width:620},{limit:6,width:760},{limit:7,width:900}];
test('fits the measured controls without exceeding the developer maximum',()=>{
 for(const maximum of [1,2,3,4,5,6,7])for(const available of [80,320,375,500,650,1000]){
  const limit=fitToolbarLimit(widths,available,maximum);
  assert.ok(limit>=1&&limit<=maximum);
  if(limit>1)assert.ok(widths.find(m=>m.limit===limit).width<available);
 }
 assert.equal(fitToolbarLimit(widths,650,7),5);
 assert.equal(fitToolbarLimit(widths,650,3),3);
});
test('growing requires slack, shrinking does not, and one control is the last resort',()=>{
 assert.equal(fitToolbarLimit(widths,625,5,4),4);
 assert.equal(fitToolbarLimit(widths,640,5,4),5);
 assert.equal(fitToolbarLimit(widths,615,5,5),4);
 assert.equal(fitToolbarLimit(widths,30,5),1);
 assert.equal(fitToolbarLimit([{limit:5,width:Infinity}],400,5),1);
});
