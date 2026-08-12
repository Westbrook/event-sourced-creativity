import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateImageFocalPoint, focalPointCss, normalizeImageFocalPoint } from "../src/model/focal-point.ts";
import { foldEvents } from "../src/model/events.ts";

const sample=(width,height,pixelAt)=>({sourceWidth:1600,sourceHeight:1000,gridWidth:width,gridHeight:height,pixels:Array.from({length:width*height},(_,index)=>pixelAt(index%width,Math.floor(index/width)))});

test("locates a visually distinct region with a deterministic, normalized focal point",()=>{
  const image=sample(12,12,(x,y)=>x>=8&&x<=10&&y>=3&&y<=7?[235,72,42]:[98,101,103]);
  const first=calculateImageFocalPoint(image);const second=calculateImageFocalPoint(image);
  assert.deepEqual(first,second);assert.ok(first.x>.62);assert.ok(first.y>.3&&first.y<.65);assert.ok(first.confidence>.3);assert.equal(first.method,"saliency-grid-v1");
  assert.match(focalPointCss(first),/--focal-x:[\d.]+%;--focal-y:[\d.]+%/);
});

test("uses a safe center anchor for an image without a distinct subject",()=>{
  const point=calculateImageFocalPoint(sample(12,12,()=>[124,124,124]));
  assert.ok(Math.abs(point.x-.5)<.02);assert.ok(Math.abs(point.y-.5)<.02);assert.ok(point.confidence<.5);
  assert.equal(normalizeImageFocalPoint({x:2,y:.5,confidence:.8}),null);
});

test("projects durable focal points onto generated outputs and uploaded reference blocks",()=>{
  const base={streamId:"s",occurredAt:"2026-08-12T12:00:00.000Z",recordedAt:"2026-08-12T12:00:00.000Z",clientId:"test",correlationId:"c",causationId:null,compensatesEventId:null,schemaVersion:1};
  const focal={x:.71,y:.34,confidence:.82,method:"saliency-grid-v1",sampleWidth:12,sampleHeight:12};
  const events=[
    {...base,eventId:"e1",sequence:1,actor:"user",type:"ProjectCreated",payload:{project_id:"p",name:"P"}},
    {...base,eventId:"e2",sequence:2,actor:"user",type:"DocumentCreated",payload:{document_id:"d",project_id:"p",title:"D"}},
    {...base,eventId:"e3",sequence:3,actor:"user",type:"BlockCreated",payload:{block_id:"r",document_id:"d",type:"reference",handle:"reference/r",properties:{reference_id:"ref",media_url:"/r.jpg"}}},
    {...base,eventId:"e4",sequence:4,actor:"worker:generator",type:"GenerationCompleted",payload:{generation_id:"g",document_id:"d",object_ids:["o"],media_url:"/o.png"}},
    {...base,eventId:"e5",sequence:5,actor:"worker:extractor",type:"ImageFocalPointCalculated",payload:{target_kind:"reference",target_id:"r",block_id:"r",focal_point:focal}},
    {...base,eventId:"e6",sequence:6,actor:"worker:extractor",type:"ImageFocalPointCalculated",payload:{target_kind:"generation",target_id:"o",focal_point:focal}},
  ];
  const projection=foldEvents(events);assert.deepEqual(projection.blocks.find((block)=>block.id==="r")?.properties.focal_point,focal);assert.deepEqual(projection.outputs.find((output)=>output.id==="o")?.focalPoint,focal);
});

test("every CSS cover crop has an explicit focal-position contract",async()=>{
  const css=await readFile(new URL("../src/styles.css",import.meta.url),"utf8");
  const coverRules=[...css.matchAll(/[^{}]*\{[^{}]*object-fit:\s*cover;[^{}]*\}/g)].map((match)=>match[0]);
  assert.ok(coverRules.length>=8);assert.deepEqual(coverRules.filter((rule)=>!rule.includes("object-position: var(--focal-x,50%) var(--focal-y,50%)")),[]);
  const [store,eventsApi,output,reference]=await Promise.all([
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),readFile(new URL("../src/components/output-visual.ts",import.meta.url),"utf8"),readFile(new URL("../src/components/reference-image.ts",import.meta.url),"utf8"),
  ]);
  assert.match(store,/calculate_focal_point/);assert.match(eventsApi,/ImageFocalPointCalculated/);assert.match(eventsApi,/cost_class:"local-free"/);assert.match(output,/positionImageAtFocalPoint/);assert.match(reference,/positionImageAtFocalPoint/);
});
