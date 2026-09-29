import test from 'node:test';
import assert from 'node:assert/strict';
import {threadTimeline,threadWidthScale} from '../src/still/motion/thread.js';
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.001,`${actual} ≠ ${expected}`);
test('selected Thread timings retain the accepted swipe ratio and longer-width travel',()=>{
 const opening=threadTimeline(1040,{arrival:.69,opening:true}),closing=threadTimeline(1040,{returnToLoading:true});
 near(opening.duration,1351.2);near(opening.duration-.69*1040,633.6);near(closing.returnSweep,528);near(closing.returnSweep/633.6,750/900);near(closing.duration,1040);
 near(threadTimeline(800,{arrival:.75,departure:.435}).duration,1348);
 near(threadWidthScale(58,640),1);near(threadWidthScale(58,800),1.1);near(threadWidthScale(960,58),1.2);near(threadWidthScale(58,1400),1.2);
});
