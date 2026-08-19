import assert from "node:assert/strict";
import test from "node:test";
import { buildPromptRepresentation } from "../src/model/prompt-structures.ts";
import { buildComprehensiveScenario, SCENARIO_EVENT_TYPES } from "../src/model/scenarios.ts";
import { evaluateReplayCoverage } from "../src/model/replay-coverage.ts";
import { documentImageFormat, imageFormatEventFields, imageFormatForPreset, IMAGE_FORMAT_PRESETS, normalizeImageFormat, providerRenderFormat, validateProviderImageSize } from "../src/model/image-format.ts";

test("normalizes block-level dimensions into one consistent aspect ratio",()=>{
  const format=normalizeImageFormat({aspect_ratio:{width:16,height:9},dimensions:{width:1200,height:1500,unit:"px"}});
  assert.deepEqual(format,{schema_version:1,aspect_ratio:{width:4,height:5},dimensions:{width:1200,height:1500,unit:"px"}});
  assert.deepEqual(imageFormatForPreset("16:9").dimensions,{width:1920,height:1080,unit:"px"});
});

test("resolves the active Format block and separates target size from provider render size",()=>{
  const snapshot={facts:[{block_id:"format-1",type:"format",active:true,properties:{weight:1,image_format:{schema_version:1,aspect_ratio:{width:4,height:5},dimensions:{width:1200,height:1500,unit:"px"}}}}]};
  const selected=documentImageFormat(snapshot);const preview=providerRenderFormat(selected.format,"preview");const full=providerRenderFormat(selected.format,"full");
  assert.equal(selected.blockId,"format-1");assert.equal(preview.size,"768x960");assert.equal(full.size,"1280x1600");
  assert.deepEqual(imageFormatEventFields(selected.format,"full",selected.blockId),{image_format_block_id:"format-1",target_aspect_ratio:"4:5",target_width:1200,target_height:1500,target_unit:"px",provider_render_size:"1280x1600",size:"1280x1600"});
  assert.match(buildPromptRepresentation("prose",snapshot,{title:"Portrait study"}),/polished portrait image/);
  assert.match(buildPromptRepresentation("prose",snapshot,{title:"Portrait study"}),/1200 × 1500 pixels at 4:5/);
  const structured=JSON.parse(buildPromptRepresentation("json",snapshot,{title:"Portrait study"}));assert.equal(structured.aspect_ratio,"4:5");assert.equal(structured.resolution,"1200x1500");assert.equal(structured.user_edited_layout.width,1200);assert.equal(structured.user_edited_layout.height,1500);
});

test("derives valid provider sizes for every preset and rejects undersized requests before submission",()=>{
  for(const preset of IMAGE_FORMAT_PRESETS)for(const purpose of ["preview","full"]){const render=providerRenderFormat(preset,purpose);assert.equal(validateProviderImageSize(render.size).valid,true,`${preset.id} ${purpose}: ${render.size}`);}
  assert.equal(providerRenderFormat(imageFormatForPreset("2:3"),"preview").size,"672x1008");
  const rejected=validateProviderImageSize("544x816");assert.equal(rejected.valid,false);assert.match(rejected.issues.join(" "),/at least 655,360 pixels/);
});

test("the replay contract exercises format creation, editing, compilation, and output receipts",()=>{
  const events=buildComprehensiveScenario();const coverage=evaluateReplayCoverage(events,SCENARIO_EVENT_TYPES);const check=coverage.checks.find((item)=>item.key==="image-format-control");
  assert.equal(check?.passed,true);assert.ok(events.some((event)=>event.type==="BlockCreated"&&event.payload.type==="format"&&event.payload.properties.image_format));assert.ok(events.some((event)=>event.type==="BlockPropertyEdited"&&event.payload.property_path==="image_format"));
  for(const type of ["GenerationRequested","ContextCompiled","GenerationCompleted"])assert.ok(events.some((event)=>event.type===type&&event.payload.target_aspect_ratio==="4:5"&&event.payload.target_width===1200&&event.payload.target_height===1500),type);
});
