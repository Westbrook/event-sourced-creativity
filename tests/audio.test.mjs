import test from "node:test";
import assert from "node:assert/strict";
import { AUDIO_ADAPTER_CONTRACT, audioAuthoringConflict, audioContextDescription, audioContexts, audioFileExtension, audioMimeType, normalizeAudioCues, normalizeAudioUsage, VIDEO_AUDIO_REFERENCE_CONTRACT } from "../src/model/audio.ts";
import { boundedAudioExcerpt, verifiedAudioTiming } from "../src/model/audio-container.ts";
import { summarizeAudioSamples } from "../src/model/audio-browser.ts";
import { providerFacingCreativeContext } from "../src/model/prompt-policy.ts";
import { adaptAudioPrompt } from "../worker/audio-prompt-adapter.ts";
import { generateCreativeAudio } from "../worker/fal-audio-adapter.ts";
import { generateCreativeVideo, validateCreativeVideoAudioReferences } from "../worker/openai-adapter.ts";
import { VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { videoPlannerCreativeContext } from "../worker/video-prompt-adapter.ts";
import { buildManagedProductionPlan } from "../src/model/managed-production.ts";
import { productionUnitsForPlan } from "../src/model/production-system.ts";
import { collectProductionEvidence } from "../src/model/production-evidence.ts";
import { artifactContextEvents } from "../src/model/output-context.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { documentShareScope, shareAllowsCurrentAudio, shareVisibleBlocks } from "../src/model/share-scope.ts";
import { generationFailureGuidance } from "../src/model/document-jobs.ts";
import { audioProviderSubmissionState, interruptedDocumentJobUsage } from "../worker/document-job-reservations.ts";

const audioFact = (properties = {}) => ({
  block_id: "audio-private-01", type: "audio", active: true,
  properties: {
    label: "Ocean and felt piano", description: "Slow waves resolve into a hopeful original piano motif.",
    source_mime_type: "audio/mpeg", media_url: "/api/media/private%2Ftheme.mp3", source_content_hash: "private-sha256",
    audio_role: "score", mood: "restrained and hopeful", emotional_arc: "isolation → connection", instrumentation: ["felt piano", "low strings"],
    weight: .8, ...properties,
  },
});

const plan = {
  title: "The field remembers",
  summary: "An intimate original soundtrack about a quiet human reunion.",
  content_markdown: "Begin in stillness, build around an original piano motif, and resolve warmly.",
  items: [{ title: "Return", body: "A child re-enters the empty field.", notes: "Let the motif bloom gently.", image_prompt: "", slide: null }],
};

test("audio permissions are independent and always default to off", () => {
  assert.deepEqual(normalizeAudioUsage({}), { informGeneration: false, includeInOutput: false, allowProviderAudioTransfer: false });
  assert.deepEqual(normalizeAudioUsage({ inform_generation: true }), { informGeneration: true, includeInOutput: false, allowProviderAudioTransfer: false });
  assert.deepEqual(normalizeAudioUsage({ include_in_output: true, allow_provider_audio_transfer: true }), { informGeneration: false, includeInOutput: true, allowProviderAudioTransfer: true });
  assert.equal(AUDIO_ADAPTER_CONTRACT.acceptsAudioWaveformInput, false);
  assert.equal(AUDIO_ADAPTER_CONTRACT.publishedCostMicrousd, 80_000);
  assert.equal(VIDEO_AUDIO_REFERENCE_CONTRACT.maximumCombinedDurationSeconds, 15);
});

test("disabled audio descriptions never leak to provider context", () => {
  const snapshot = { facts: [audioFact({ transcript: "Private words that must not leave Forma." }), audioFact({ label: "Included only", include_in_output: true })] };
  assert.deepEqual(providerFacingCreativeContext(snapshot), { facts: [] });
  assert.equal(audioContexts(snapshot, "inform").length, 0);
  assert.equal(audioContexts(snapshot, "include").length, 1);
  assert.equal(audioContexts(snapshot, "transfer").length, 0);
});

test("approved audio descriptions inform composition without exposing private media", () => {
  const snapshot = { facts: [audioFact({ inform_generation: true, audio_cues: [{ start_seconds: 8, end_seconds: 12, label: "Discovery" }] })] };
  const [reference] = audioContexts(snapshot, "inform");
  assert.match(audioContextDescription(reference), /felt piano/);
  assert.match(audioContextDescription(reference), /Cue 8s–12s: Discovery/);
  const adaptation = adaptAudioPrompt(snapshot, plan);
  assert.equal(adaptation.compilation.valid, true);
  assert.equal(adaptation.audioWaveformSubmitted, false);
  assert.equal(adaptation.sourceAudioTreatment, "authored-description-only");
  assert.deepEqual(adaptation.sourceAudioBlockIds, ["audio-private-01"]);
  assert.match(adaptation.prompt, /restrained and hopeful/);
  assert.match(adaptation.prompt, /felt piano/);
  assert.doesNotMatch(adaptation.prompt, /\/api\/media|private-sha256|audio_url/i);
  assert.doesNotMatch(JSON.stringify(providerFacingCreativeContext(snapshot)), /\/api\/media|private-sha256|inform_generation/);
});

test("audio cues reject invalid ranges and preserve authored chronology", () => {
  const cues = normalizeAudioCues([
    { start_seconds: 18, end_seconds: 22, label: "Resolution", target_kind: "slide", target_id: "slide-4" },
    { start_seconds: -1, label: "Invalid" },
    { start_seconds: 9, end_seconds: 8, label: "Invalid end" },
    { start_seconds: 2, end_seconds: 6, label: "Opening" },
  ]);
  assert.deepEqual(cues.map((cue) => cue.label), ["Opening", "Resolution"]);
  assert.equal(cues[1].targetKind, "slide");
  assert.equal(audioMimeType("audio/mpeg; charset=binary"), "audio/mpeg");
  assert.equal(audioFileExtension("audio/mpeg"), "mp3");
  assert.equal(audioFileExtension("audio/wav"), "wav");
  assert.equal(audioMimeType("text/html"), null);
});

test("protected recordings never become inclusion, transfer, or positive listening context",()=>{
  const prohibited=audioFact({intent:"prohibit",inform_generation:true,include_in_output:true,allow_provider_audio_transfer:true});
  assert.deepEqual(audioContexts({facts:[prohibited]},"inform"),[]);
  assert.deepEqual(audioContexts({facts:[prohibited]},"include"),[]);
  assert.deepEqual(audioContexts({facts:[prohibited]},"transfer"),[]);
  assert.deepEqual(adaptAudioPrompt({facts:[prohibited]},plan).sourceAudioBlockIds,[]);
});

test("protected artist, named-work, and voice imitation fail locally across every active context type",()=>{
  const unsafe=["Compose in the style of John Williams.","Create a song that sounds exactly like Taylor Swift.","Recreate the Imperial March by John Williams.","Recreate the recognizable Imperial March.","Clone Morgan Freeman.","Use the famous Imperial March melody."];
  for(const direction of unsafe){
    const listening={facts:[audioFact({inform_generation:true,description:direction})]};
    assert.equal(audioAuthoringConflict(listening)?.code,"audio_originality_required",direction);
    const unlockedStyle={facts:[{type:"style",active:true,properties:{text:direction}}]};
    assert.equal(audioAuthoringConflict(unlockedStyle)?.code,"audio_originality_required",`unlocked: ${direction}`);
  }
  assert.equal(audioAuthoringConflict({facts:[audioFact({inform_generation:true,description:"No copyrighted music, but original music is encouraged."})]}),null);
  assert.equal(audioAuthoringConflict({facts:[audioFact({inform_generation:true,description:"No vocals; instrumental score only."})]}),null);
  assert.equal(audioAuthoringConflict({facts:[audioFact({audio_role:"soundscape",inform_generation:true}),{type:"direction",locked:true,properties:{text:"No music; original environmental wind and rain only."}}]}),null);
  assert.equal(audioAuthoringConflict({facts:[audioFact({audio_role:"soundscape",inform_generation:true}),{type:"direction",locked:true,properties:{text:"No audio; remain completely silent."}}]})?.code,"audio_output_forbidden");
});

test("media-backed audio remains private even if an untrusted block is retyped",()=>{
  const disguised={type:"direction",active:true,properties:{media_url:"/api/media/private.mp3",source_mime_type:"audio/mpeg",transcript:"PRIVATE PATIENT STATEMENT",inform_generation:false}};
  assert.deepEqual(providerFacingCreativeContext({facts:[disguised]}),{facts:[]});
});

test("video planning retains only approved sonic meaning and removes private cue targets",()=>{
  const snapshot={facts:[audioFact({inform_generation:true,mood:"terrified then hopeful",emotional_arc:"panic becomes relief",narrative_purpose:"the mother returns",instrumentation:["cello"],texture:"surf",tempo_bpm:72,transcript:"I found you",audio_cues:[{start_seconds:2,target_kind:"slide",target_id:"PRIVATE-SLIDE-ID",label:"reunion",emotional_intent:"relief"}]})]};
  const context=videoPlannerCreativeContext(snapshot),serialized=JSON.stringify(context);
  for(const expected of ["terrified then hopeful","panic becomes relief","the mother returns","cello","surf","I found you","reunion"])assert.match(serialized,new RegExp(expected),expected);
  assert.doesNotMatch(serialized,/PRIVATE-SLIDE-ID|private-sha256|\/api\/media|inform_generation/);
});

function wavRecording(seconds,sampleRate=8000){
  const sampleCount=seconds*sampleRate,bytes=new Uint8Array(44+sampleCount*2),view=new DataView(bytes.buffer);
  const word=(offset,value)=>{for(let index=0;index<value.length;index++)bytes[offset+index]=value.charCodeAt(index);};
  word(0,"RIFF");view.setUint32(4,bytes.length-8,true);word(8,"WAVE");word(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,"data");view.setUint32(40,sampleCount*2,true);
  for(let index=0;index<sampleCount;index++)view.setInt16(44+index*2,Math.round(Math.sin(index/8)*12000),true);
  return bytes;
}

test("server verifies real WAV timing and transfers only frame-aligned first-15-second bytes",()=>{
  const recording=wavRecording(22),timing=verifiedAudioTiming(recording,"audio/wav");
  assert.equal(timing.durationSeconds,22);
  const excerpt=boundedAudioExcerpt(recording,"audio/wav",0,15);
  assert.equal(excerpt.startSeconds,0);
  assert.equal(excerpt.durationSeconds,15);
  assert.equal(excerpt.originalDurationSeconds,22);
  assert.equal(verifiedAudioTiming(excerpt.bytes,"audio/wav").durationSeconds,15);
  assert.ok(excerpt.bytes.length<recording.length);
  assert.equal(boundedAudioExcerpt(new Uint8Array([1,2,3]),"audio/wav",0,15),null);
});

test("explicit browser-local analysis extracts measured dynamics and quiet passages without inventing transcripts",()=>{
  const rate=200,samples=new Float32Array(rate*12);
  for(let index=rate*2;index<samples.length;index++)samples[index]=Math.sin(index/4)*(.12+.7*index/samples.length);
  const analysis=summarizeAudioSamples([samples],rate);
  assert.equal(analysis.durationSeconds,12);
  assert.equal(analysis.channelCount,1);
  assert.equal(analysis.dynamicArc,"rising");
  assert.ok(analysis.quietRegions.some((region)=>region.startSeconds===0&&region.endSeconds>=1.9));
  assert.match(analysis.description,/Locally measured|No speech, words, instruments, or identity were inferred/);
  assert.equal(Object.hasOwn(analysis,"transcript"),false);
  assert.equal(summarizeAudioSamples([],rate),null);
});

test("managed audio creates exactly one paid provider render and evidence never claims acoustic inspection",()=>{
  const snapshot={facts:[{block_id:"beat-1",type:"direction",locked:true,properties:{text:"Mara returns to the shoreline"}},{block_id:"beat-2",type:"emotion",locked:true,properties:{text:"Slow fear gives way to relief"}}]};
  const production=buildManagedProductionPlan("audio",snapshot);
  const units=productionUnitsForPlan(production),renders=units.filter((unit)=>unit.kind==="render-audio");
  assert.equal(renders.length,1);
  assert.equal(renders[0].estimatedCostMicrousd,80_000);
  const evidence=collectProductionEvidence(production,{draft:plan,audioReceipt:{providerJobId:"fal-audio-1",mediaUrl:"/api/media/owner%2Ftheme.mp3",mediaType:"audio/mpeg"}});
  assert.equal(evidence.basis,"provider-audio-receipt");
  assert.equal(evidence.mediaInspected,false);
  assert.equal(evidence.metrics.contextAdherence.status,"not_evaluated");
  assert.equal(evidence.metrics.continuity.status,"not_evaluated");
  assert.equal(evidence.metrics.formatCraft.score,1);
  assert.equal(collectProductionEvidence(production,{draft:plan}).basis,"plan-proxy");
});

test("generated tracks become integrity-bound reusable audio inputs with every permission reset",()=>{
  const artifact={id:"track-1",kind:"audio",title:"A quiet return",summary:"Original composition",documentId:"doc-1",itemCount:1,items:[{id:"part-1",title:"Movement",body:"Quiet waves",notes:"",imagePrompt:"",slide:null}],mediaUrl:"/api/media/owner%2Ftrack.mp3",mediaType:"audio/mpeg",provider:"fal",modelId:AUDIO_ADAPTER_CONTRACT.model,settings:{source_media_sha256:"a".repeat(64),duration_seconds:179,lyrics:"Original words"}};
  let count=0;const result=artifactContextEvents(artifact,{documentId:"doc-1",projectId:"project-1",sourceSurface:"test",idFactory:()=>`id-${++count}`});
  const reference=result.events.find((event)=>event.type==="ReferenceIngested"),block=result.events.find((event)=>event.type==="BlockCreated");
  assert.equal(reference.payload.rights_class,"account-generated");
  assert.equal(reference.payload.content_hash,"a".repeat(64));
  assert.equal(block.payload.type,"audio");
  assert.equal(block.payload.properties.source_content_hash,"a".repeat(64));
  assert.equal(block.payload.properties.duration_seconds,179);
  assert.deepEqual(normalizeAudioUsage(block.payload.properties),{informGeneration:false,includeInOutput:false,allowProviderAudioTransfer:false});
});

function sharedProjection({included=true,mode="none",spoof=false}={}){
  const owner="audio-owner",namespace=ownerMediaNamespace(owner),audioKey=`${namespace}/full-recording.mp3`,videoKey=`${namespace}/generated/video.mp4`,audioUrl=`/api/media/${encodeURIComponent(audioKey)}`,videoUrl=`/api/media/${encodeURIComponent(videoKey)}`;
  const block={id:"audio-1",type:"audio",properties:{label:"Private recording",media_url:audioUrl,source_mime_type:"audio/mpeg",media_type:"audio/mpeg",rights_class:"owned_or_licensed",include_in_output:included,inform_generation:false,transcript:"PRIVATE WORDS"}};
  const asset={block_id:"audio-1",label:"Private recording",media_url:audioUrl,media_type:"audio/mpeg",provider_audio_transmitted:mode==="provider",inclusion:mode==="provider"?"provider-soundtrack-reference":"separate-playback-companion"};
  const projection={documentId:"doc-1",projectId:"project-1",documents:[{id:"doc-1",projectId:"project-1"}],blocks:spoof?[block,{id:"spoof",type:"message",properties:{media_url:audioUrl,source_mime_type:"image/png",media_type:"audio/mpeg",include_in_output:false}}]:[block],outputs:[],artifacts:[{id:"video-1",kind:"video",mediaUrl:videoUrl,items:[],settings:{...(mode!=="none"?{soundtrack_assets:[asset]}:{})}}]};
  return{owner,audioKey,videoKey,projection};
}

test("share eligibility alone never releases an unpaired or provider-transferred original recording",()=>{
  for(const mode of ["none","provider"]){const fixture=sharedProjection({mode}),scope=documentShareScope(fixture.projection,fixture.owner,"doc-1","project-1");assert.equal(scope.mediaKeys.includes(fixture.audioKey),false,mode);assert.equal(scope.mediaKeys.includes(fixture.videoKey),true,mode);assert.equal(shareVisibleBlocks(fixture.projection).some((block)=>block.id==="audio-1"),false,mode);assert.equal(shareAllowsCurrentAudio(fixture.projection,fixture.owner,fixture.audioKey),false,mode);}
});

test("only a selected companion can be shared and revocation also withdraws embedded soundtrack video",()=>{
  const companion=sharedProjection({mode:"companion"}),allowed=documentShareScope(companion.projection,companion.owner,"doc-1","project-1");
  assert.ok(allowed.mediaKeys.includes(companion.audioKey));
  assert.equal(shareAllowsCurrentAudio(companion.projection,companion.owner,companion.audioKey),true);
  companion.projection.blocks[0].properties.include_in_output=false;
  assert.equal(documentShareScope(companion.projection,companion.owner,"doc-1","project-1").mediaKeys.includes(companion.audioKey),false);
  assert.equal(shareAllowsCurrentAudio(companion.projection,companion.owner,companion.audioKey),false);
  const embedded=sharedProjection({mode:"provider"});embedded.projection.blocks[0].properties.include_in_output=false;
  assert.equal(documentShareScope(embedded.projection,embedded.owner,"doc-1","project-1").mediaKeys.includes(embedded.videoKey),false);
});

test("revoked or expired soundtrack rights immediately withdraw companions and provider-scored videos",()=>{
  for(const patch of [{rights_revoked:true},{rights_class:"revoked"},{license_expires_at:"2020-01-01T00:00:00.000Z"},{rights_expires_at:"2020-01-01T00:00:00.000Z"}]){
    const companion=sharedProjection({mode:"companion"});Object.assign(companion.projection.blocks[0].properties,patch);
    assert.equal(documentShareScope(companion.projection,companion.owner,"doc-1","project-1").mediaKeys.includes(companion.audioKey),false,JSON.stringify(patch));
    assert.equal(shareAllowsCurrentAudio(companion.projection,companion.owner,companion.audioKey),false,JSON.stringify(patch));
    const embedded=sharedProjection({mode:"provider"});Object.assign(embedded.projection.blocks[0].properties,patch);
    assert.equal(documentShareScope(embedded.projection,embedded.owner,"doc-1","project-1").mediaKeys.includes(embedded.videoKey),false,JSON.stringify(patch));
  }
});

test("adopting a soundtrack video as motion context or output can never bypass later source revocation",()=>{
  const fixture=sharedProjection({mode:"provider"}),videoUrl=`/api/media/${encodeURIComponent(fixture.videoKey)}`;
  fixture.projection.blocks.push({id:"adopted-video",type:"motion",properties:{media_url:videoUrl,source_artifact_kind:"video",artifact_structure:{items:[{media_url:videoUrl}]}}});
  fixture.projection.outputs.push({mediaUrl:videoUrl});
  assert.ok(documentShareScope(fixture.projection,fixture.owner,"doc-1","project-1").mediaKeys.includes(fixture.videoKey));
  fixture.projection.blocks[0].properties.include_in_output=false;
  assert.equal(documentShareScope(fixture.projection,fixture.owner,"doc-1","project-1").mediaKeys.includes(fixture.videoKey),false);
  assert.equal(shareVisibleBlocks(fixture.projection).some((block)=>block.id==="adopted-video"),false);
});

test("declared MIME spoofing cannot reclassify a private audio source as an ordinary shareable message",()=>{
  const fixture=sharedProjection({mode:"none",spoof:true}),scope=documentShareScope(fixture.projection,fixture.owner,"doc-1","project-1");
  assert.equal(scope.mediaKeys.includes(fixture.audioKey),false);
  assert.equal(shareVisibleBlocks(fixture.projection).some((block)=>block.id==="spoof"),false);
});

test("video soundtrack transfer enforces real Seedance image, rights, format, and duration limits", () => {
  const image = { blockId: "image-01", referenceId: "ref-image", bytes: new Uint8Array([1]), mimeType: "image/jpeg" };
  const soundtrack = { blockId: "audio-01", referenceId: "ref-audio", label: "Opening", bytes: new Uint8Array([1, 2]), mimeType: "audio/mpeg", durationSeconds: 8, rightsClass: "licensed" };
  assert.doesNotThrow(() => validateCreativeVideoAudioReferences(VIDEO_ADAPTER_CONTRACT.model, [image], [soundtrack]));
  assert.throws(() => validateCreativeVideoAudioReferences(VIDEO_ADAPTER_CONTRACT.model, [], [soundtrack]), (error) => error.detail?.code === "video_audio_reference_image_required");
  assert.throws(() => validateCreativeVideoAudioReferences(VIDEO_ADAPTER_CONTRACT.model, [image], [{ ...soundtrack, durationSeconds: 16 }]), (error) => error.detail?.code === "video_audio_reference_duration_exceeded");
  assert.throws(() => validateCreativeVideoAudioReferences(VIDEO_ADAPTER_CONTRACT.model, [image], [{ ...soundtrack, mimeType: "audio/flac" }]), (error) => error.detail?.code === "video_audio_reference_type_unsupported");
  assert.throws(() => validateCreativeVideoAudioReferences(VIDEO_ADAPTER_CONTRACT.model, [image], [{ ...soundtrack, rightsClass: "" }]), (error) => error.detail?.code === "video_audio_reference_rights_required");
});

test("confirmed Lyria rejections are free while accepted jobs alone incur the published audio cost",()=>{
  for(const status of [400,401,402,403,404,405,413,415,422,429]){
    assert.equal(audioProviderSubmissionState({attempted:true,httpStatus:status}),"rejected",String(status));
    assert.equal(interruptedDocumentJobUsage({audioProviderSubmission:"rejected"},{artifactKind:"audio"}).singleAudioCostMicrousd,0);
  }
  assert.equal(audioProviderSubmissionState({attempted:false,httpStatus:422}),"not_submitted");
  assert.equal(audioProviderSubmissionState({attempted:true,httpStatus:null}),"unknown");
  assert.equal(audioProviderSubmissionState({attempted:true,httpStatus:500}),"unknown");
  assert.equal(audioProviderSubmissionState({attempted:true,providerJobId:"accepted-lyria-job",httpStatus:422}),"confirmed");
  assert.equal(interruptedDocumentJobUsage({providerJobId:"accepted-lyria-job"},{artifactKind:"audio"}).singleAudioCostMicrousd,80_000);
});

test("locked silence always overrides an explicitly requested soundtrack", () => {
  const image = { blockId: "image-01", referenceId: "ref-image", bytes: new Uint8Array([1]), mimeType: "image/jpeg" };
  const soundtrack = { blockId: "audio-01", referenceId: "ref-audio", label: "Opening", bytes: new Uint8Array([1]), mimeType: "audio/wav", durationSeconds: 5, rightsClass: "licensed" };
  const snapshot = { facts: [{ type: "constraint", locked: true, properties: { text: "No music or soundtrack; remain silent." } }] };
  assert.throws(() => validateCreativeVideoAudioReferences(VIDEO_ADAPTER_CONTRACT.model, [image], [soundtrack], snapshot), (error) => error.detail?.code === "video_audio_forbidden");
});

for (const shape of ["file", "string"]) {
  test(`Lyria submits only its real schema and accepts ${shape} audio responses`, async () => {
    const calls = [];
    const previous = globalThis.fetch;
    globalThis.fetch = async (value, init = {}) => {
      const url = String(value);
      calls.push({ url, init });
      if (url === "https://queue.fal.run/fal-ai/lyria3/pro") {
        assert.deepEqual(Object.keys(JSON.parse(String(init.body))), ["prompt"]);
        return Response.json({ request_id: "req-audio-01" });
      }
      if (url === "https://queue.fal.run/fal-ai/lyria3/requests/req-audio-01/status?logs=1") return Response.json({ status: "COMPLETED" });
      if (url === "https://queue.fal.run/fal-ai/lyria3/requests/req-audio-01") return Response.json({
        audio: shape === "file" ? { url: "https://v3b.fal.media/files/theme.mp3", content_type: "audio/mpeg", file_name: "theme.mp3", file_size: 3 } : "https://v3b.fal.media/files/theme.mp3",
        lyrics: "[00:00] Sparse piano\n[00:08] Strings gather",
      });
      if (url === "https://v3b.fal.media/files/theme.mp3") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
      throw new Error(`Unexpected request ${url}`);
    };
    try {
      const receipts = [];
      const audio = await generateCreativeAudio({ FAL_KEY: "test-secret" }, "Write an entirely original felt-piano score.", { sourceAudioBlockIds: ["private-context"], onReceipt: (receipt) => receipts.push(receipt) });
      assert.equal(audio.providerJobId, "req-audio-01");
      assert.equal(audio.model, "fal-ai/lyria3/pro");
      assert.equal(audio.mimeType, "audio/mpeg");
      assert.equal(audio.costMicrousd, 80_000);
      assert.deepEqual(Array.from(audio.bytes), [1, 2, 3]);
      assert.equal(audio.preparedReceipt.audioWaveformSubmitted, false);
      assert.match(audio.lyrics, /Sparse piano/);
      assert.equal(receipts.length, 1);
      assert.equal(calls.filter((call) => call.init.method === "POST").length, 1);
    } finally { globalThis.fetch = previous; }
  });
}

test("Lyria recovery resumes its application-level queue without buying another generation", async () => {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (value, init = {}) => {
    const url = String(value);
    calls.push({ url, init });
    if (url.endsWith("/status?logs=1")) return Response.json({ status: "COMPLETED" });
    if (url === "https://queue.fal.run/fal-ai/lyria3/requests/req-existing") return Response.json({ audio: "https://fal.media/theme.mp3" });
    if (url === "https://fal.media/theme.mp3") return new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } });
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    await generateCreativeAudio({ FAL_KEY: "test-secret" }, "Original music", { providerJobId: "req-existing" });
    assert.equal(calls.some((call) => call.init.method === "POST"), false);
    assert.ok(calls[0].url.startsWith("https://queue.fal.run/fal-ai/lyria3/requests/req-existing/status"));
  } finally { globalThis.fetch = previous; }
});

test("Lyria refuses untrusted generated-audio locations", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (value) => {
    const url = String(value);
    if (url.endsWith("/status?logs=1")) return Response.json({ status: "COMPLETED" });
    if (url.includes("/requests/")) return Response.json({ audio: "https://attacker.example/private.mp3" });
    return Response.json({ request_id: "req-untrusted" });
  };
  try {
    await assert.rejects(generateCreativeAudio({ FAL_KEY: "test-secret" }, "Original music"), (error) => error.detail?.code === "fal_audio_url_untrusted");
  } finally { globalThis.fetch = previous; }
});

test("approved soundtrack video submits real image and audio URLs without a contradictory silent contract",async()=>{
  const previous=globalThis.fetch,calls=[];let uploads=0;
  globalThis.fetch=async(input,init={})=>{
    const url=String(input);calls.push({url,method:init.method??"GET",body:init.body});
    if(url.includes("/storage/upload/initiate")){uploads++;const suffix=uploads===1?"image.png":"soundtrack.mp3";return Response.json({upload_url:`https://upload.fal.media/${suffix}`,file_url:`https://v3b.fal.media/files/${suffix}`});}
    if(url.startsWith("https://upload.fal.media/"))return new Response("");
    if(url==="https://queue.fal.run/bytedance/seedance-2.0/reference-to-video"&&init.method==="POST")return Response.json({request_id:"video-audio-1",status:"IN_QUEUE"});
    if(url.endsWith("/status?logs=1"))return Response.json({request_id:"video-audio-1",status:"COMPLETED"});
    if(url==="https://queue.fal.run/bytedance/seedance-2.0/requests/video-audio-1")return Response.json({video:{url:"https://v3b.fal.media/files/video.mp4",content_type:"video/mp4"}});
    if(url==="https://v3b.fal.media/files/video.mp4")return new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"video/mp4"}});
    throw new Error(`Unexpected request: ${url}`);
  };
  const image={blockId:"image-block",referenceId:"image-ref",bytes:new Uint8Array([137,80,78,71]),mimeType:"image/png",label:"Approved visual",mode:"preserve_subject",sequence:null,shotDirection:"Turn toward the horizon",cameraDirection:"Slow push",framePrompt:"Golden shoreline",sourceArtifactId:null,sourceArtifactItemId:null,sourceArtifactKind:null,storyboardTitle:""};
  const soundtrack={blockId:"audio-block",referenceId:"audio-ref",label:"Original authorized score",bytes:new Uint8Array([1,2,3,4]),mimeType:"audio/mpeg",durationSeconds:8,rightsClass:"owned_or_licensed"};
  try{
    const prepared=[];
    const result=await generateCreativeVideo({FAL_KEY:"test-secret",FORMA_VIDEO_PROVIDER:"fal"},"A camera follows Mara along the shore.",{seconds:8,size:"1280x720",audioMode:"silent",references:[image],audioReferences:[soundtrack],onPrepared:(receipt)=>prepared.push(receipt)});
    const submitted=JSON.parse(String(calls.find((call)=>call.url.includes("/reference-to-video")&&call.method==="POST").body));
    assert.deepEqual(submitted.image_urls,["https://v3b.fal.media/files/image.png"]);
    assert.deepEqual(submitted.audio_urls,["https://v3b.fal.media/files/soundtrack.mp3"]);
    assert.equal(submitted.generate_audio,true);
    assert.match(submitted.prompt,/@Audio1/);
    assert.match(submitted.prompt,/authorized soundtrack/i);
    assert.doesNotMatch(submitted.prompt,/Deliver silent visual-only motion/i);
    assert.equal(prepared[0].parameters.audio_mode,"provided_soundtrack");
    assert.equal(prepared[0].parameters.native_audio_mode,"silent");
    assert.equal(prepared[0].parameters.soundtrack_mode,"rights-cleared-provider-reference");
    assert.equal(result.referenceInputs.some((reference)=>reference.audio_submitted===true),true);
  }finally{globalThis.fetch=previous;}
});

test("audio failure guidance names Lyria and Fal rather than video or OpenAI",()=>{
  const base={category:"provider",scope:"request",action:"edit_request",message:"provider failed",retryable:false,retryAfterMs:null,requestId:null,httpStatus:422};
  const job={kind:"render_document",status:"failed",stage:"rendering-audio",result:{artifactKind:"audio"}};
  for(const [detail,expected] of [[{...base,code:"audio_provider_not_configured",category:"authentication",httpStatus:503},/Fal audio generation/i],[{...base,code:"fal_audio_failed"},/audio composition/i],[{...base,code:"fal_audio_quota",category:"quota"},/audio track/i]]){
    const guidance=generationFailureGuidance(detail,"",job);
    assert.match(guidance.title,expected);
    assert.doesNotMatch(guidance.summary,/silent video|OpenAI credential/i);
  }
});
