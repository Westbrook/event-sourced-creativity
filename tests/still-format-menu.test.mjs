import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, rankAllFormats } from '../src/still/decisions.ts';
const ids=['image','short_story','scene','slides','storyboard','video','audio','model3d'];
const candidates=ACTIONS.filter(a=>ids.includes(a.id));
const score=(score,confidence=.9)=>({type:'score',score,confidence});

test('create offers three choices and keeps all five remaining formats in Jev order',()=>{
 const ranked=rankAllFormats(candidates,{fit_model3d:score(3),fit_audio:score(2.9),fit_image:score(2.8),fit_video:score(2.7),fit_slides:score(2.6),fit_scene:score(1.9),fit_storyboard:score(.7),fit_short_story:score(0),fit_unknown:score(3)});
 assert.deepEqual(ranked.slice(0,3),['model3d','audio','image']);
 assert.deepEqual(ranked.slice(3),['video','slides','scene','storyboard','short_story']);
 assert.equal(ranked.slice(0,3).length+2,5,'Three formats, Menu, Back');
 assert.equal(new Set(ranked).size,8);
});

test('missing, malformed and uncertain evidence never hides an eligible format or invents an unavailable one',()=>{
 const ranked=rankAllFormats(candidates,{fit_model3d:score(3,.01),fit_image:score(NaN),fit_audio:score(4),fit_video:score(2.7)});
 assert.equal(ranked[0],'video');
 assert.deepEqual(new Set(ranked),new Set(ids));
 assert.deepEqual(rankAllFormats(candidates),candidates.map(a=>a.id));
 assert.ok(!rankAllFormats(candidates.filter(a=>a.id!=='video'),{fit_video:score(3)}).includes('video'));
 assert.deepEqual(candidates.map(a=>a.id),ACTIONS.filter(a=>ids.includes(a.id)).map(a=>a.id),'Ranking does not mutate candidates');
});
