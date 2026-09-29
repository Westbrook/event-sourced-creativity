import test from 'node:test';
import assert from 'node:assert/strict';
import {StillClient} from '../src/still/client.ts';
import {defaultGenerationSettings,validateGenerationOptions} from '../src/still/generation-settings.ts';
const draft=format=>({format,settings:defaultGenerationSettings(),documentId:'d',requestId:'request',sourceHead:4,itemCount:6,tone:'Warm',audience:'Readers',prompt:'A carved owl'});
const payload=g=>StillClient.prototype.generationPayload.call({},g).payload;
test('configuration values reach the corresponding generation request',()=>{
 const slides=draft('slides');Object.assign(slides.settings,{productionMode:'managed',presentationStyle:'editorial',presentationFidelity:'creative'});slides.itemCount=24;
 assert.equal(payload(slides).requestedSlideCount,24);assert.equal(payload(slides).productionMode,'managed');assert.equal(payload(slides).presentationFidelity,'creative');assert.equal(payload(slides).audience,'Readers');
 const video=draft('video');Object.assign(video.settings,{videoSeconds:12,videoSize:'720x1280',videoAudioMode:'original_ambient'});
 assert.equal(payload(video).videoSeconds,12);assert.equal(payload(video).videoSize,'720x1280');assert.equal(payload(video).videoAudioMode,'original_ambient');video.settings.productionMode='managed';assert.equal(payload(video).videoSeconds,undefined);
 const audio=draft('audio');Object.assign(audio.settings,{audioGoal:'narration',audioDestination:'podcast',audioSpeakerCount:2});
 assert.equal(payload(audio).audioProfile.goal,'narration');assert.equal(payload(audio).audioProfile.speakerCount,2);assert.equal(payload(audio).audioProfile.destination,'podcast');
 Object.assign(audio.settings,{audioGoal:'timed_music',audioDuration:45,audioInstrumental:true});assert.equal(payload(audio).audioProfile.durationSeconds,45);assert.equal(payload(audio).audioProfile.requireInstrumental,true);
 const scene=draft('scene');scene.settings.sceneMedium='audio';assert.equal(payload(scene).sceneMedium,'audio');
 const model=draft('model3d');model.settings.model3dSettings.geometry_file_format='obj';assert.equal(payload(model).model3dSettings.geometry_file_format,'obj');assert.equal(defaultGenerationSettings().model3dSettings.geometry_file_format,'glb');
 const image=draft('image');image.settings.productionMode='managed';assert.equal(payload(image).productionMode,'managed');assert.equal(payload(image).artifactKind,undefined);
});
test('invalid durations, counts and guidance cannot be submitted',()=>{
 const slides=draft('slides');for(const count of [0,16,1.5,NaN]){slides.itemCount=count;assert.throws(()=>validateGenerationOptions(slides),/slides/);}slides.settings.productionMode='managed';slides.itemCount=100;assert.doesNotThrow(()=>validateGenerationOptions(slides));
 const audio=draft('audio');audio.settings.audioGoal='sound_effects';audio.settings.audioDuration=181;assert.throws(()=>validateGenerationOptions(audio),/seconds/);audio.settings.audioDuration=30;audio.tone='a'.repeat(121);assert.throws(()=>validateGenerationOptions(audio),/120/);
});
