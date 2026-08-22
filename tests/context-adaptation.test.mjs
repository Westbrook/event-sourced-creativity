import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { compileContextAdaptationSections, partitionContextAdaptationFactScopes, requiredContextAdaptationFacts } from "../src/model/context-adaptation.ts";
import { documentJobCanRecoverProviderRender, documentJobProgress } from "../src/model/document-jobs.ts";
import { VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { buildIdeogramCaption } from "../worker/ideogram-caption-adapter.ts";
import { buildIdeogramPrompt } from "../worker/ideogram-prompt-adapter.ts";
import { generateCreativeVideo, validateCreativeVideoReferences } from "../worker/openai-adapter.ts";
import { adaptVideoPrompt, resolveVideoAudioPolicy, videoPlannerCreativeContext, videoStoryboardBeats } from "../worker/video-prompt-adapter.ts";

const videoOptions = (patch = {}) => ({
  references: [],
  seconds: 15,
  size: "1280x720",
  model: VIDEO_ADAPTER_CONTRACT.model,
  promptProfile: "positive-only",
  ...patch,
});

const reference = (sequence, patch = {}) => ({
  bytes: Uint8Array.from([137, 80, 78, 71, sequence]),
  mimeType: "image/png",
  blockId: `shot-${sequence}`,
  referenceId: `reference-${sequence}`,
  label: `Authored frame ${sequence}`,
  mode: "preserve_composition",
  sequence,
  shotDirection: `Shot ${sequence} moves forward.`,
  cameraDirection: "Slow dolly.",
  framePrompt: "Visible authored composition.",
  sourceArtifactId: "storyboard-armada",
  sourceArtifactItemId: `frame-${sequence}`,
  sourceArtifactKind: "storyboard",
  storyboardTitle: "Scenes from the Attack",
  ...patch,
});

test("the shared adapter compiler reserves required meaning and fails closed on invalid contracts", () => {
  const compiled = compileContextAdaptationSections([
    { id: "optional-opening", content: "Optional decorative setup that should never consume a mandatory context reservation.", priority: "optional" },
    { id: "required-boundary", content: "Keep Mara's crimson wardrobe isolated to Mara.", priority: "required" },
    { id: "required-ending", content: "The protective shield must never become destructive.", priority: "required" },
  ], 120);
  assert.equal(compiled.valid, true);
  assert.match(compiled.prompt, /crimson wardrobe/);
  assert.match(compiled.prompt, /never become destructive/);
  assert.ok(compiled.adaptedCharacters <= 120);

  assert.equal(compileContextAdaptationSections([{ id: "required", content: "This mandatory section exceeds a tiny budget.", priority: "required" }], 8).valid, false);
  assert.equal(compileContextAdaptationSections([{ id: "optional", content: "This optional sentence cannot fit in eight characters.", priority: "optional" }], 8).issues[0].code, "adapted_prompt_empty");
  assert.equal(compileContextAdaptationSections([{ id: "same", content: "One." }, { id: "same", content: "Two." }], 50).issues[0].code, "section_id_duplicated");
  assert.equal(compileContextAdaptationSections([{ id: "required", content: "Anything." }], 0).issues[0].code, "prompt_budget_invalid");
});

test("shared mandatory extraction respects source authority, disabled decisions, and structured colors", () => {
  const decisions = requiredContextAdaptationFacts({ facts: [
    { block_id: "locked-palette", type: "palette", locked: true, properties: { label: "Fleet colors", colors: ["#ff00cc", "#00ee77"] } },
    { block_id: "required-camera", type: "camera", properties: { required: true, text: "One unbroken overhead tracking shot." } },
    { block_id: "disabled", type: "style", locked: true, properties: { active: false, text: "Disabled watercolor." } },
    { block_id: "optional", type: "lighting", properties: { text: "Optional moonlight." } },
  ] });
  assert.deepEqual(decisions.map((decision) => decision.blockId), ["locked-palette", "required-camera"]);
  assert.match(decisions[0].direction, /#ff00cc.*#00ee77/);
});

test("mandatory structured direction and complete legal copy are preserved without pre-budget truncation", () => {
  const legal = `${"Preserve every authored legal clause exactly. ".repeat(24)}FINAL_REQUIRED_LEGAL_SENTINEL`;
  const snapshot = { facts: [
    { block_id: "legal", type: "typography", locked: true, properties: { text: legal, font_family: "LOCKED_CASLON_7734" } },
    { block_id: "camera", type: "camera", locked: true, properties: { camera_direction: "EXACT_RIGHTWARD_TRACK_7722" } },
    { block_id: "material", type: "material", locked: true, properties: { materials: ["EXACT_OBSIDIAN_7733"] } },
    { block_id: "type", type: "typography", locked: true, properties: { exact_text: "EXACT_STRUCTURED_WORDING_7744", safe_area: { left: "EXACT_STRUCTURED_SAFE_AREA_7755" } } },
  ] };
  const video = adaptVideoPrompt("The document unfolds.", videoOptions({ seconds: 4, snapshot }));
  const image = buildIdeogramPrompt(snapshot, { scene: "The document unfolds." }, "canonical", [], {});
  const caption = buildIdeogramCaption(snapshot, { scene: "The document unfolds." }, "canonical", [], {});
  for (const adaptation of [video, image, caption]) {
    for (const required of ["FINAL_REQUIRED_LEGAL_SENTINEL", "LOCKED_CASLON_7734", "EXACT_RIGHTWARD_TRACK_7722", "EXACT_OBSIDIAN_7733", "EXACT_STRUCTURED_WORDING_7744", "EXACT_STRUCTURED_SAFE_AREA_7755"]) assert.match(adaptation.prompt, new RegExp(required));
  }
  assert.equal(image.valid, true);
  assert.equal(caption.valid, true);

  const impossible = { facts: [{ block_id: "impossible", type: "typography", locked: true, properties: { text: "MANDATORY_LEGAL_COPY ".repeat(1_200) } }] };
  assert.throws(() => adaptVideoPrompt("Keep the exact legal copy.", videoOptions({ seconds: 4, snapshot: impossible })), (error) => error.detail.code === "video_required_context_exceeds_budget");
  assert.equal(buildIdeogramPrompt(impossible, { scene: "Keep the exact legal copy." }, "canonical", [], {}).valid, false);
});

test("locked structured exclusions remain mandatory across every visual adapter",()=>{
  const properties=[
    {lens:"FORBIDDEN_FISHEYE_SENTINEL"},
    {palette:["FORBIDDEN_CRIMSON_SENTINEL"]},
    {materials:["FORBIDDEN_ASBESTOS_SENTINEL"]},
    {exact_text:"FORBIDDEN_BRAND_COPY_SENTINEL"},
    {brand_name:"FORBIDDEN_BRAND_SENTINEL"},
    {camera_direction:"FORBIDDEN_DUTCH_TILT_SENTINEL"},
    {safe_area:{left:"FORBIDDEN_REGION_SENTINEL"}},
  ];
  for(const direction of properties){
    const expected=JSON.stringify(direction).match(/FORBIDDEN_[A-Z_]+_SENTINEL/)?.[0];
    const snapshot={facts:[{block_id:"locked-exclusion",type:"direction",locked:true,intent:"avoid",properties:direction}]};
    const video=adaptVideoPrompt("Preserve the authored visual direction.",videoOptions({seconds:4,snapshot}));
    const image=buildIdeogramPrompt(snapshot,{scene:"Preserve the authored visual direction."},"canonical",[],{});
    const caption=buildIdeogramCaption(snapshot,{scene:"Preserve the authored visual direction."},"canonical",[],{});
    for(const adaptation of [video,image,caption])assert.match(adaptation.prompt,new RegExp(expected));
    assert.equal(image.valid,true);
    assert.equal(caption.valid,true);
  }
  const impossible={facts:[{block_id:"empty-exclusion",type:"direction",locked:true,intent:"avoid",properties:{unsupported:"UNSUPPORTED_AUTHORIAL_VALUE"}}]};
  assert.throws(()=>adaptVideoPrompt("Preserve the authored visual direction.",videoOptions({seconds:4,snapshot:impossible})),(error)=>error.detail.code==="video_required_context_unrepresentable");
  assert.equal(buildIdeogramPrompt(impossible,{scene:"Preserve the authored visual direction."},"canonical",[],{}).valid,false);
  assert.equal(buildIdeogramCaption(impossible,{scene:"Preserve the authored visual direction."},"canonical",[],{}).valid,false);
});

test("video adaptation retains six authored beats, only approved composition references, and the actual production spine", () => {
  const titles = ["Armada Through the Clouds", "Ilya at the Rail", "The Illuminated Manuscript", "Words Before the Storm", "Spell Over the Bow", "The Fleet Advances"];
  const snapshot = {
    document: { title: "The Armada Advances" },
    standing_constraints: [
      { axis: "wardrobe", polarity: "affirm", value: "Keep Ilya's exact red scarf visible." },
      { axis: "magic", polarity: "forbid", value: "Destructive fireballs or burning ships." },
    ],
    facts: titles.map((title, index) => ({
      block_id: `shot-${index + 1}`,
      type: "reference",
      properties: {
        storyboard_frame_index: index + 1,
        storyboard_title: "Scenes from the Attack",
        source_artifact_id: "storyboard-armada",
        storyboard_shot_title: title,
        storyboard_shot_direction: `${title}: Ilya protects the approaching fleet.`,
        storyboard_camera_direction: `Use the authored ${index + 1} camera move.`,
        storyboard_frame_prompt: index === 1
          ? "Cinematic fantasy storyboard frame, ordinary setup, with Ilya holding the spell tome under his left arm."
          : `Cinematic fantasy storyboard frame, ${title}, luminous amber protective runes.`,
      },
    })),
  };
  const prompt = "0:00-0:02 Armada Through the Clouds. 0:02-0:04 Ilya at the Rail. 0:04-0:06 The Illuminated Manuscript. 0:06-0:08 Words Before the Storm. 0:08-0:11 Spell Over the Bow. 0:11-0:15 The Fleet Advances.\nAudio: low orchestral pulses.";
  const adaptation = adaptVideoPrompt(prompt, videoOptions({
    snapshot,
    references: [reference(1), reference(2), reference(4)],
    plan: { title: "Armada", summary: "One growing protective movement.", items: [{ notes: "Sails move left to right; the amber magic is protective and supportive, never destructive." }] },
  }));
  assert.equal(adaptation.audio.generateAudio, false);
  assert.equal(adaptation.storyboardBeats.length, 6);
  assert.deepEqual(adaptation.storyboardBeats.map((beat) => [beat.startsAtSeconds, beat.endsAtSeconds]), [[0, 2], [2, 4], [4, 6], [6, 8], [8, 11], [11, 15]]);
  assert.deepEqual(adaptation.referenceBindings.map((binding) => [binding.token, binding.sequence]), [["@Image1", 1], ["@Image2", 2], ["@Image3", 4]]);
  assert.match(adaptation.prompt, /COMPOSITION ONLY/);
  assert.match(adaptation.prompt, /left to right/);
  assert.match(adaptation.prompt, /protective and supportive, never destructive/);
  assert.match(adaptation.prompt, /under his left arm/);
  assert.match(adaptation.prompt, /exact red scarf/);
  assert.match(adaptation.prompt, /Destructive fireballs/);
  assert.doesNotMatch(adaptation.prompt, /orchestral pulses/);
  for (const title of titles) assert.match(adaptation.prompt, new RegExp(title));
  assert.equal(videoPlannerCreativeContext(snapshot).facts.length, 6);
});

test("video audio policy honors real authored directions, negation, visual objects, and unsupported soundtracks", () => {
  for (const direction of ["The scene must not include audio or sound effects.", "A scoreboard must display the score 10-4.", "The visual must show a vintage audio cassette."]) {
    assert.equal(resolveVideoAudioPolicy({ snapshot: { facts: [{ type: "direction", properties: { text: direction } }] } }).effectiveMode, "silent");
  }
  assert.throws(() => resolveVideoAudioPolicy({ snapshot: { facts: [{ type: "direction", properties: { description: "The audience must hear clearly audible dialogue." } }] } }), (error) => error.detail.code === "video_audio_required");
  assert.throws(() => resolveVideoAudioPolicy({ audioMode: "original_ambient", snapshot: { facts: [{ type: "direction", locked: true, properties: { text: "The finished video must remain completely silent." } }] } }), (error) => error.detail.code === "video_audio_forbidden");
  assert.throws(() => resolveVideoAudioPolicy({ audioMode: "original_ambient", snapshot: { standing_constraints: [{ axis: "audio", polarity: "forbid", value: "All generated audio and sound effects." }] } }), (error) => error.detail.code === "video_audio_forbidden");
  assert.equal(resolveVideoAudioPolicy({ audioMode: "original_ambient", snapshot: { standing_constraints: [{ axis: "audio", polarity: "forbid", value: "Recognizable songs and music." }] } }).effectiveMode, "original_ambient");
  assert.throws(() => resolveVideoAudioPolicy({ snapshot: { standing_constraints: [{ axis: "audio", polarity: "affirm", value: "A recognizable Star Wars orchestral theme must play." }] } }), (error) => error.detail.code === "video_audio_required");
  assert.throws(() => resolveVideoAudioPolicy({ snapshot: { standing_constraints: [{ axis: "style", polarity: "affirm", value: "A recognizable Star Wars orchestral theme must play." }] } }), (error) => error.detail.code === "video_audio_required");
  const safeForbiddenMusic=adaptVideoPrompt("Ilya protects the fleet.",videoOptions({seconds:4,audioMode:"original_ambient",snapshot:{standing_constraints:[{axis:"style",polarity:"forbid",value:"The Imperial March by John Williams plays."},{axis:"exclusion",polarity:"forbid",value:"Destructive fireballs."}]}}));
  assert.doesNotMatch(safeForbiddenMusic.prompt,/Imperial March|John Williams/);
  assert.match(safeForbiddenMusic.prompt,/Destructive fireballs/);
  assert.equal(resolveVideoAudioPolicy({ audioMode: "original_ambient", snapshot: { facts: [{ type: "direction", properties: { text: "Must include original ambient sound effects, with no music, vocals, or dialogue." } }] } }).effectiveMode, "original_ambient");
  for (const unsafe of ["An orchestral melody swells.", "The scoreboard shows 2-1 while a recognizable Star Wars orchestral theme plays.", "Ilya raises the shield (audio: low orchestral pulses).", "Use sound design in the style of John Williams.", "Taylor Swift performs Shake It Off.", "Taylor Swift’s Shake It Off.","Beyoncé’s Halo.","Shape of You by Ed Sheeran.","Bohemian Rhapsody by Queen.","John Williams’s Imperial March.","John Williams: Imperial March.","Star Wars: The Imperial March.", "John Williams performs the Imperial March.", "The recognizable Imperial March plays.", "The Imperial March by John Williams.", "A grand piano performs Moonlight Sonata.", "A full orchestra performs the Star Wars overture.","A crowd chants the famous Seven Nation Army riff while the gates open.","A choir chants a recognizable commercial jingle as the shield rises.","The actor imitates Morgan Freeman’s voice while the shield rises.","The exact voice of Morgan Freeman narrates the shield rising.","A voice identical to Scarlett Johansson whispers while the bridge emerges.","A beatboxing crowd recreates the famous We Will Rock You beat.","The brass hits the famous Marvel fanfare.","A crowd claps the unmistakable We Will Rock You rhythm.","A rapper freestyles over the recognizable Eminem beat.","A synthetic replica of David Attenborough describes the forest."]) {
    assert.throws(() => adaptVideoPrompt(unsafe, videoOptions({ seconds: 4, audioMode: "original_ambient" })), (error) => error.detail.code === "video_audio_profile_unsupported");
  }
  for(const purelyVisual of ["A child plays with a toy train.","The fleet performs a defensive maneuver.","The dwarf Ilya performs a protective spell.","A mechanic performs an engine repair.","An athlete performs a high jump.","While a child's toy train plays beside the window.","While the child's kitten plays beside the window.","A dancer performs to a teacher's careful directions.","An actor dances to a director's stage cues.","Captain Ilya’s Fleet Advances Toward Dawn.","Princess Mara’s Protective Shield Forms.","Jonas Bright’s Crimson Sails Unfurl.","John Smith’s Blue Silk Scarf.","Captain Ilya’s Amber Rune protects the fleet.","Lady Mara’s Crimson Ribbon catches the wind.","Commander Jonas’s Sapphire Lantern lights the deck.","Queen Elara’s Golden Crown gleams in twilight.","Doctor Patel’s Emerald Compass points north.","Portrait of Mara by Jonas hangs on the wall.","Aerial View of Harbor by Elena.","A printed poster displays Taylor Swift’s Shake It Off.","Use a confident brand voice in the written campaign.","A visibly printed poster shows the voice of the brand.","The brand’s tone of voice is confident and optimistic.","Define a warm voice and tone for the written campaign.","The choir holds candles without singing.","The narrator appears visually as a silent character.","Original ambient thunder rolls over the fleet.","Original wind whistles through the rigging.","The ship’s engine hums softly in the rain.","A narrator stands beside the orchestra pit door.","Use an unmistakable visual rhythm between storyboard beats."])assert.equal(adaptVideoPrompt(purelyVisual,videoOptions({seconds:4,audioMode:"original_ambient"})).audio.effectiveMode,"original_ambient");
  const visual = adaptVideoPrompt("An orchestral score swells as Ilya raises the amber shield and saves the fleet.", videoOptions({ seconds: 4 }));
  assert.match(visual.prompt, /Ilya raises the amber shield and saves the fleet/);
});

test("silent adaptation removes audio headings without sacrificing their visual climax",()=>{
  const directions=[
    ["Music: The Imperial March by John Williams plays as Ilya sacrifices herself to save the fleet.",/Ilya sacrifices herself to save the fleet/],
    ["Soundtrack: a recognizable orchestral fanfare rises while the child opens the final lifeboat.",/the child opens the final lifeboat/i],
    ["Audio: Morgan Freeman narrates while the last lantern reveals the mother is alive.",/the last lantern reveals the mother is alive/i],
  ];
  for(const [direction,climax] of directions){
    const silent=adaptVideoPrompt(direction,videoOptions({seconds:4}));
    assert.match(silent.prompt,climax);
    assert.doesNotMatch(silent.prompt,/Imperial March|John Williams|orchestral fanfare|Morgan Freeman/);
    assert.throws(()=>adaptVideoPrompt(direction,videoOptions({seconds:4,audioMode:"original_ambient"})),(error)=>error.detail.code==="video_audio_profile_unsupported");
  }
});

test("compatible locked audio, exact typography, and natural prohibitions preserve their intended meaning",()=>{
  for(const instruction of ["Audio: silence.","Audio: no music or vocals.","Sound design: silence."]){
    const snapshot={facts:[{block_id:"audio",type:"audio",locked:true,properties:{text:instruction}}]};
    assert.equal(adaptVideoPrompt("The fleet advances.",videoOptions({seconds:4,snapshot})).audio.effectiveMode,"silent");
  }
  for(const exact of ["AUDIO: SILENCE","MUSIC: THE SOUND OF SILENCE","SOUNDTRACK: NIGHT OF THE LIVING DEAD"]){
    const snapshot={facts:[{block_id:"type",type:"typography",locked:true,properties:{text:exact}}]};
    for(const audioMode of ["silent","original_ambient"])assert.ok(adaptVideoPrompt("The visual poster is legible.",videoOptions({seconds:4,snapshot,audioMode})).prompt.includes(exact));
  }
  for(const instruction of ["Sound design: original wind and rainfall.","Sound design: original non-musical wind and rainfall.","Sound design: original non-melodic wind and rainfall."]){
    const snapshot={facts:[{block_id:"audio",type:"direction",locked:true,properties:{text:instruction}}]};
    const adaptation=adaptVideoPrompt("The fleet advances.",videoOptions({seconds:4,snapshot,audioMode:"original_ambient"}));
    assert.match(adaptation.prompt,/SOUND DESIGN[^]*wind[^]*rainfall/i);
  }
  for(const instruction of ["No generated audio.","Do not generate any audio.","Audio: silence.","Audio disabled.","Sound: off."]){
    for(const type of ["audio","direction"]){
      const snapshot={facts:[{block_id:"audio",type,locked:true,properties:{text:instruction}}]};
      assert.equal(resolveVideoAudioPolicy({snapshot,audioMode:"silent"}).effectiveMode,"silent");
      assert.throws(()=>resolveVideoAudioPolicy({snapshot,audioMode:"original_ambient"}),(error)=>error.detail.code==="video_audio_forbidden");
    }
  }
  for(const instruction of ["No audible music.","No background music.","No copyrighted music.","Music-free final result.","No audible music; original wind and rain only."]){
    for(const type of ["audio","direction"]){
      const snapshot={facts:[{block_id:"audio",type,locked:true,properties:{text:instruction}}]};
      for(const audioMode of ["silent","original_ambient"])assert.equal(resolveVideoAudioPolicy({snapshot,audioMode}).effectiveMode,audioMode);
    }
  }
  for(const instruction of ["The poster visibly reads NO GENERATED AUDIO.","The written sign says NO GENERATED AUDIO."]){
    const snapshot={facts:[{block_id:"poster",type:"direction",locked:true,properties:{text:instruction}}]};
    assert.equal(resolveVideoAudioPolicy({snapshot,audioMode:"original_ambient"}).effectiveMode,"original_ambient");
  }
});

test("zero-provider-cost video preflight rejects impossible source contracts before planning", () => {
  let providerCalls=0;
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async()=>{providerCalls+=1;throw new Error("A local adaptation preflight must not call a provider.");};
  try{
    const impossible={facts:[{block_id:"legal",type:"typography",locked:true,properties:{text:"MANDATORY_LEGAL_COPY ".repeat(1_200)}}]};
    assert.throws(()=>adaptVideoPrompt("Preserve the complete authored visual direction.",videoOptions({seconds:4,snapshot:impossible})),(error)=>error.detail.code==="video_required_context_exceeds_budget");
    const missing={facts:[{block_id:"empty",type:"camera",locked:true,properties:{unsupported:"No representable camera direction"}}]};
    assert.throws(()=>adaptVideoPrompt("Preserve the complete authored visual direction.",videoOptions({seconds:4,snapshot:missing})),(error)=>error.detail.code==="video_required_context_unrepresentable");
    const unsafe={facts:[{block_id:"shot",type:"reference",properties:{storyboard_frame_index:1,storyboard_title:"Taylor Swift performs Shake It Off.",storyboard_shot_title:"An otherwise normal visual"}}]};
    assert.throws(()=>adaptVideoPrompt("Preserve the complete authored visual direction.",videoOptions({seconds:4,audioMode:"original_ambient",snapshot:unsafe})),(error)=>error.detail.code==="video_audio_profile_unsupported");
    assert.equal(providerCalls,0);
  }finally{globalThis.fetch=previousFetch;}
});

test("distinct same-title storyboard sets retain independent chronology and reference order", () => {
  const snapshot = { facts: [
    { block_id: "a1", type: "reference", properties: { source_artifact_id: "set-a", storyboard_title: "Shared name", storyboard_frame_index: 1, storyboard_shot_title: "A one" } },
    { block_id: "a2", type: "reference", properties: { source_artifact_id: "set-a", storyboard_title: "Shared name", storyboard_frame_index: 2, storyboard_shot_title: "A two" } },
    { block_id: "b1", type: "reference", properties: { source_artifact_id: "set-b", storyboard_title: "Shared name", storyboard_frame_index: 1, storyboard_shot_title: "B one" } },
    { block_id: "b2", type: "reference", properties: { source_artifact_id: "set-b", storyboard_title: "Shared name", storyboard_frame_index: 2, storyboard_shot_title: "B two" } },
  ] };
  assert.deepEqual(videoStoryboardBeats(snapshot).map((beat) => beat.title), ["A one", "A two", "B one", "B two"]);
  const valid = [reference(1, { sourceArtifactId: "set-a" }), reference(2, { sourceArtifactId: "set-a" }), reference(1, { sourceArtifactId: "set-b", blockId: "b1", referenceId: "b1" }), reference(2, { sourceArtifactId: "set-b", blockId: "b2", referenceId: "b2" })];
  assert.equal(validateCreativeVideoReferences({}, valid), VIDEO_ADAPTER_CONTRACT.model);
  assert.throws(() => validateCreativeVideoReferences({}, [reference(2), reference(1)]), (error) => error.detail.code === "video_reference_order_invalid");
});

test("managed video preflight preserves ambient audio before continuity references exist", () => {
  const textToVideoModel = "fal-ai/gemini-video";
  const env = { FAL_VIDEO_MODEL: textToVideoModel, FAL_REFERENCE_VIDEO_MODEL: VIDEO_ADAPTER_CONTRACT.model };

  assert.throws(
    () => validateCreativeVideoReferences(env, [], undefined, "original_ambient"),
    (error) => error.detail.code === "video_audio_provider_unsupported",
  );
  assert.equal(
    validateCreativeVideoReferences(env, [], env.FAL_REFERENCE_VIDEO_MODEL, "original_ambient"),
    VIDEO_ADAPTER_CONTRACT.model,
  );
  assert.equal(validateCreativeVideoReferences(env, [], VIDEO_ADAPTER_CONTRACT.model, "original_ambient"), VIDEO_ADAPTER_CONTRACT.model);
  assert.equal(validateCreativeVideoReferences(env, [], textToVideoModel, "silent"), textToVideoModel);

  const route = readFileSync(new URL("../worker/events-api.ts", import.meta.url), "utf8");
  assert.match(route, /const\s+managedProviderModel\s*=\s*body\.providerModel\s*\|\|\s*env\.FAL_REFERENCE_VIDEO_MODEL\s*\|\|\s*VIDEO_ADAPTER_CONTRACT\.model/);
  assert.match(route, /validateCreativeVideoReferences\(\s*env\s*,\s*references\s*,\s*managedProviderModel\s*,\s*requestedVideoAudioMode\s*\)/);
  assert.match(route, /validateCreativeVideoReferences\(\s*env\s*,\s*preparedVideoReferences\s*,\s*body\.providerModel\s*\|\|\s*undefined\s*,\s*requestedVideoAudioMode\s*\)/);
});

test("provider reference validation never permits description-only pixels, invalid order, or missing provenance", () => {
  const cases = [
    [reference(1, { mode: "context_only" }), "video_reference_mode_unsupported"],
    [reference(1, { mode: "invented" }), "video_reference_mode_unsupported"],
    [reference(1, { blockId: "" }), "video_reference_provenance_missing"],
    [reference(1, { referenceId: "" }), "video_reference_provenance_missing"],
    [reference(1, { sequence: 1.5 }), "video_reference_sequence_invalid"],
    [reference(1, { mimeType: "image/gif" }), "video_reference_invalid"],
  ];
  for (const [invalid, code] of cases) assert.throws(() => validateCreativeVideoReferences({}, [invalid]), (error) => error.detail.code === code);
});

test("image and caption adapters preserve locked decisions, real standing preferences, and character-isolated colors", () => {
  const membership = (id, target) => ({ context_set_id: id, name: `${target} wardrobe`, role: "character", target, application: "isolate", relativity: .9, member_order: 0 });
  const snapshot = {
    standing_constraints: [
      { axis: "lighting", polarity: "affirm", value: "ALWAYS_USE_AMBER_LANTERN_7734" },
      { axis: "composition", polarity: "forbid", value: "NEVER_CENTER_HORIZON_8899" },
    ],
    facts: [
      { block_id: "mara", type: "subject", properties: { text: "Mara crosses the deck.", combined_context_memberships: [membership("mara", "Mara")] } },
      { block_id: "mara-palette", type: "palette", properties: { label: "Crimson wardrobe", colors: ["#AA0101", "#BB0202"], combined_context_memberships: [membership("mara", "Mara")] } },
      { block_id: "jonas", type: "subject", properties: { text: "Jonas guards the mast.", combined_context_memberships: [membership("jonas", "Jonas")] } },
      { block_id: "jonas-palette", type: "palette", properties: { label: "Blue wardrobe", colors: ["#0101AA"], combined_context_memberships: [membership("jonas", "Jonas")] } },
      { block_id: "mara-forbidden", type: "palette", intent: "avoid", properties: { text: "FORBIDDEN_CRIMSON", colors: ["#CC0000"], combined_context_memberships: [membership("mara", "Mara")] } },
      { block_id: "locked-style", type: "style", locked: true, properties: { text: "EXACT woodblock ukiyo-e and gold leaf." } },
    ],
  };
  const image = buildIdeogramPrompt(snapshot, { scene: "The crew advances." }, "canonical", [], { quality: "high" });
  assert.equal(image.valid, true);
  assert.match(image.prompt, /COMBINED CONTEXT — character “Mara”/);
  assert.match(image.prompt, /#AA0101.*#BB0202/);
  assert.match(image.prompt, /#0101AA/);
  assert.match(image.prompt, /woodblock ukiyo-e/);
  assert.match(image.prompt, /ALWAYS_USE_AMBER_LANTERN_7734/);
  assert.match(image.prompt, /NEVER_CENTER_HORIZON_8899/);
  assert.match(image.prompt,/TARGET-SCOPED EXCLUSION — character “Mara”: Exclude FORBIDDEN_CRIMSON · #CC0000 only from this target/);
  assert.doesNotMatch(image.prompt,/^EXCLUDE:[^\n]*FORBIDDEN_CRIMSON/m);
  assert.doesNotMatch(image.prompt, /^PALETTE:/m);
  assert.doesNotMatch(image.prompt,/Keep [^.]*FORBIDDEN_CRIMSON/);
  assert.ok(image.includedBlockIds.includes("locked-style"));

  const caption = buildIdeogramCaption(snapshot, { scene: "The crew advances." }, "canonical", [], {});
  assert.match(caption.prompt, /ALWAYS_USE_AMBER_LANTERN_7734/);
  assert.match(caption.prompt, /NEVER_CENTER_HORIZON_8899/);
  assert.match(caption.prompt,/Target-scoped exclusion for character Mara: Exclude FORBIDDEN_CRIMSON · #CC0000 only from Mara/);
  assert.doesNotMatch(caption.caption.compositional_deconstruction.background,/FORBIDDEN_CRIMSON/);
  assert.doesNotMatch(caption.prompt,/Combined Context character Mara[^}]*FORBIDDEN_CRIMSON/);
});

test("target-scoped exclusions never contradict another target's locked requirements", () => {
  const membership=(id,target)=>({context_set_id:id,name:`${target} wardrobe`,role:"character",target,application:"isolate",relativity:.9,member_order:0});
  const forbidden={block_id:"mara-no-red",type:"palette",intent:"avoid",properties:{text:"Mara must not wear red",colors:["#FF0000"],combined_context_memberships:[membership("mara","Mara")]}};
  const required={block_id:"jonas-red",type:"palette",locked:true,properties:{text:"Jonas must wear red",colors:["#FF0000"],combined_context_memberships:[membership("jonas","Jonas")]}};
  const global={block_id:"no-fire",type:"exclusion",properties:{text:"No destructive fire"}};
  const snapshot={facts:[forbidden,required,global]};
  const scopes=partitionContextAdaptationFactScopes([forbidden,required,global]);
  assert.deepEqual(scopes.global.map((fact)=>fact.block_id),["no-fire"]);
  assert.deepEqual(scopes.scoped.map(({fact})=>fact.block_id),["mara-no-red","jonas-red"]);
  const video=adaptVideoPrompt("Mara and Jonas cross the deck.",videoOptions({seconds:4,snapshot}));
  const image=buildIdeogramPrompt(snapshot,{scene:"Mara and Jonas cross the deck."},"canonical",[],{});
  const caption=buildIdeogramCaption(snapshot,{scene:"Mara and Jonas cross the deck."},"canonical",[],{});
  assert.equal(image.valid,true);
  assert.equal(caption.valid,true);
  for(const adaptation of [video,image,caption]){
    assert.match(adaptation.prompt,/Jonas[^\n{}]*#FF0000/);
    assert.match(adaptation.prompt,/Mara[^\n{}]*#FF0000|#FF0000[^\n{}]*Mara/);
    assert.match(adaptation.prompt,/No destructive fire/);
  }
  assert.doesNotMatch(video.prompt,/outside the composition:[^\n]*#FF0000/);
  assert.doesNotMatch(image.prompt,/^EXCLUDE:[^\n]*#FF0000/m);
  assert.doesNotMatch(caption.caption.compositional_deconstruction.background,/#FF0000/);
});

test("target-scoped positive decisions never become ambiguous global video requirements",()=>{
  const membership=(id,target)=>({context_set_id:id,name:`${target} identity`,role:"character",target,application:"isolate",relativity:.9,member_order:0});
  const snapshot={facts:[
    {block_id:"alice",type:"subject",locked:true,properties:{text:"silver feather tattoo only on left wrist",combined_context_memberships:[membership("alice","Alice")]}},
    {block_id:"alice-color",type:"palette",locked:true,properties:{colors:["#FF0000"],combined_context_memberships:[membership("alice","Alice")]}},
    {block_id:"bob",type:"subject",properties:{text:"gold serpent tattoo only on right wrist",combined_context_memberships:[membership("bob","Bob")]}},
    {block_id:"bob-color",type:"palette",locked:true,properties:{colors:["#0000FF"],combined_context_memberships:[membership("bob","Bob")]}},
  ]};
  const adaptation=adaptVideoPrompt("Alice and Bob cross the deck.",videoOptions({seconds:4,snapshot}));
  assert.match(adaptation.prompt,/SUBJECT for character “Alice”: silver feather tattoo/);
  assert.match(adaptation.prompt,/SUBJECT for character “Bob”: gold serpent tattoo/);
  assert.match(adaptation.prompt,/PALETTE for character “Alice”: #FF0000/);
  assert.match(adaptation.prompt,/PALETTE for character “Bob”: #0000FF/);
  assert.doesNotMatch(adaptation.prompt,/^PALETTE: #(?:FF0000|0000FF)$/m);
  const image=buildIdeogramPrompt(snapshot,{scene:"Alice and Bob cross the deck."},"canonical",[],{});
  const caption=buildIdeogramCaption(snapshot,{scene:"Alice and Bob cross the deck."},"canonical",[],{});
  assert.match(image.prompt,/MANDATORY PRIMARY SUBJECT AND ACTION:[^\n]*Alice[^\n]*silver feather[^\n]*Bob[^\n]*gold serpent/);
  assert.match(caption.caption.high_level_description,/Alice[^\n]*silver feather[^\n]*Bob[^\n]*gold serpent/);
  const subjectElements=caption.caption.compositional_deconstruction.elements.filter((element)=>element.desc.startsWith("Required primary subject and action:"));
  assert.match(subjectElements.find((element)=>element.desc.includes("silver feather"))?.desc??"",/Alice/);
  assert.match(subjectElements.find((element)=>element.desc.includes("gold serpent"))?.desc??"",/Bob/);
});

test("group-scoped forbidden music never primes an explicitly opted-in ambient soundtrack",()=>{
  for(const title of ["The Imperial March by John Williams","Taylor Swift’s Shake It Off","Beyoncé’s Halo","Shape of You by Ed Sheeran","Bohemian Rhapsody by Queen","John Williams’s Imperial March"]){
    const snapshot={facts:[{block_id:"mara-no-song",type:"direction",intent:"avoid",properties:{text:title,combined_context_memberships:[{context_set_id:"mara",name:"Mara",role:"character",target:"Mara",application:"isolate",member_order:0}]}}]};
    const adaptation=adaptVideoPrompt("Mara crosses the silent deck.",videoOptions({seconds:4,audioMode:"original_ambient",snapshot}));
    assert.equal(adaptation.audio.effectiveMode,"original_ambient");
    assert.ok(!adaptation.prompt.includes(title),title);
  }
  const visual={facts:[{block_id:"mara-no-scarf",type:"direction",intent:"avoid",properties:{text:"John Smith’s Blue Silk Scarf",combined_context_memberships:[{context_set_id:"mara",name:"Mara",role:"character",target:"Mara",application:"isolate",member_order:0}]}}]};
  assert.match(adaptVideoPrompt("Mara crosses the deck.",videoOptions({seconds:4,audioMode:"original_ambient",snapshot:visual})).prompt,/John Smith’s Blue Silk Scarf/);
});

test("an ambiguous paid Fal submission failure is never automatically submitted twice", async () => {
  const previousFetch = globalThis.fetch;
  let paidSubmissions = 0;
  globalThis.fetch = async (_input, init = {}) => {
    if ((init.method ?? "GET") === "POST") paidSubmissions += 1;
    return Response.json({ error: { message: "Temporary provider gateway failure." } }, { status: 503 });
  };
  try {
    await assert.rejects(() => generateCreativeVideo({ FAL_KEY: "test-only", FORMA_VIDEO_PROVIDER: "fal" }, "The fleet advances silently.", { seconds: 4, size: "1280x720" }), (error) => error.detail.httpStatus === 503);
    assert.equal(paidSubmissions, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("a malformed completed video receipt remains recoverable and untrusted queue hints never receive requests", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    if ((init.method ?? "GET") === "POST") return Response.json({ request_id: "fal-paid-without-video", status_url: "https://untrusted.invalid/steal-provider-key" });
    if (url.includes("/status")) return Response.json({ request_id: "fal-paid-without-video", status: "COMPLETED" });
    return Response.json({ status: "COMPLETED" });
  };
  try {
    await assert.rejects(() => generateCreativeVideo({ FAL_KEY: "test-only", FORMA_VIDEO_PROVIDER: "fal" }, "The accepted fleet advances.", { seconds: 4, size: "1280x720" }), (error) => {
      assert.equal(error.detail.code, "fal_result_response_invalid");
      assert.equal(error.detail.retryable, true);
      assert.equal(error.detail.requestId, "fal-paid-without-video");
      return true;
    });
    assert.ok(calls.some((url) => url === "https://queue.fal.run/bytedance/seedance-2.0/requests/fal-paid-without-video/status?logs=1"));
    assert.equal(calls.some((url) => url.includes("untrusted.invalid")), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("a final-result audio copyright rejection is terminal, audio-specific, and never blames authorized images", async () => {
  const previousFetch = globalThis.fetch;
  const stages = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/storage/upload/initiate")) return Response.json({ upload_url: "https://upload.fal.media/reference", file_url: "https://v3b.fal.media/files/test/reference.png" });
    if (url === "https://upload.fal.media/reference") return new Response("");
    if ((init.method ?? "GET") === "POST") return Response.json({ request_id: "fal-audio-target", status: "IN_QUEUE" });
    if (url.includes("/status")) return Response.json({ request_id: "fal-audio-target", status: "COMPLETED" });
    return Response.json({ detail: [{ type: "content_policy_violation", msg: "Output audio has sensitive content. Potential copyright violation." }] }, { status: 422, headers: { "x-fal-request-id": "fal-audio-target" } });
  };
  try {
    await assert.rejects(() => generateCreativeVideo({ FAL_KEY: "test-only", FORMA_VIDEO_PROVIDER: "fal" }, "Ilya protects the fleet.", { seconds: 4, size: "1280x720", audioMode: "original_ambient", references: [reference(1)], onStage: (stage) => stages.push(stage) }), (error) => {
      assert.equal(error.detail.category, "safety");
      assert.equal(error.detail.retryable, false);
      assert.equal(error.detail.requestId, "fal-audio-target");
      assert.deepEqual(error.detail.riskCategories, ["audio-copyright"]);
      assert.equal(error.detail.contributingBlockIds, undefined);
      assert.equal(error.detail.contributingReferenceIds, undefined);
      assert.equal(error.detail.probe, "fal-seedance-audio-partner-validation");
      return true;
    });
    assert.ok(stages.includes("finalizing"));
    assert.equal(stages.includes("downloading"), false);
    const failed = { kind: "render_document", status: "failed", result: { artifactKind: "video", providerJobId: "fal-audio-target" }, errorDetail: { category: "safety", code: "fal_content_policy_violation", retryable: false, httpStatus: 422 } };
    assert.equal(documentJobCanRecoverProviderRender(failed), false);
    assert.equal(documentJobProgress({ ...failed, status: "running", stage: "finalizing", progressMessage: "Validating provider output." }).label, "Save");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("immutable video recovery preserves accepted audio, reference provenance, duration, and published resolution price", async () => {
  const previousFetch = globalThis.fetch;
  let paidSubmissions = 0;
  globalThis.fetch = async (input, init = {}) => {
    if ((init.method ?? "GET") === "POST") paidSubmissions += 1;
    if (String(input).includes("/status")) return Response.json({ request_id: "fal-legacy", status: "COMPLETED" });
    if (String(input).includes("queue.fal.run")) return Response.json({ video: { url: "https://v3b.fal.media/files/test/legacy.mp4", content_type: "video/mp4" } });
    return new Response(Uint8Array.from([1, 2, 3]), { headers: { "content-type": "video/mp4" } });
  };
  try {
    const prepared = [];
    const video = await generateCreativeVideo({ FAL_KEY: "test-only", FORMA_VIDEO_PROVIDER: "fal" }, "The already-paid fleet advances.", {
      seconds: 4,
      size: "1280x720",
      providerJobId: "fal-legacy",
      providerModel: VIDEO_ADAPTER_CONTRACT.model,
      references: [],
      retainedReceipt: {
        provider: "fal",
        model: VIDEO_ADAPTER_CONTRACT.model,
        submittedPrompt: "Immutable original soundtrack-enabled visual direction.",
        parameters: { duration: 8, resolution: "480p", aspect_ratio: "16:9", generate_audio: true },
        referenceInputs: [{ reference_id: "expired-local-reference", pixels_submitted: true }],
        usedReferencePixels: true,
      },
      onPrepared: (receipt) => prepared.push(receipt),
    });
    assert.equal(paidSubmissions, 0);
    assert.equal(video.usedReferencePixels, true);
    assert.equal(video.seconds, 8);
    assert.equal(video.costMicrousd, 1_076_040);
    assert.equal(video.submittedPrompt, "Immutable original soundtrack-enabled visual direction.");
    assert.equal(prepared[0].adaptation.audio.effectiveMode, "original_ambient");
    assert.equal(video.referenceInputs[0].reference_id, "expired-local-reference");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
