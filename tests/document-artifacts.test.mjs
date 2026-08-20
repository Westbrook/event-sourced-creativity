import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applySlideStylePreset, defaultSlidePresentation, DOCUMENT_ARTIFACT_KINDS, normalizeSlideDeckItems, normalizeSlidePresentation, parseDocumentArtifactContent, SLIDE_STYLE_PRESETS, slideCopyIsDistinct, slideCopyIsNearDuplicate, slideCopyIssues, slideDeckCopyIsDistinct, slideDeckCopyIssues, slideVisualIsComplete } from "../src/model/document-artifacts.ts";
import { foldEvents } from "../src/model/events.ts";
import { buildComprehensiveScenario, SCENARIO_EVENT_TYPES } from "../src/model/scenarios.ts";
import { evaluateReplayCoverage } from "../src/model/replay-coverage.ts";
import { generateCreativeVideo } from "../worker/openai-adapter.ts";

const event=(sequence,type,payload,actor=type.startsWith("DocumentRender")?"worker:renderer":"user")=>({eventId:`e${sequence}`,streamId:"s",sequence,occurredAt:"2026-08-19T12:00:00.000Z",recordedAt:"2026-08-19T12:00:00.000Z",actor,clientId:"test",correlationId:"c",causationId:null,compensatesEventId:null,schemaVersion:1,type,payload});
const presentation={aspectRatio:"16:9",theme:"Editorial night",mode:"dark",palette:{background:"#121714",foreground:"#f5f3ee",accent:"#df7544",muted:"#a8b1aa",surface:"#252c27"}};
const slide={layout:"metric",kicker:"Evidence",bullets:["One durable decision","One reusable visual system"],visual:{kind:"bars",label:"Creative confidence",value:"82%",data:[{label:"Direction",value:"82%",weight:.82},{label:"Coherence",value:"74%",weight:.74}]}};

test("projects every document-derived form as a durable result",()=>{
  const artifacts=DOCUMENT_ARTIFACT_KINDS.map((kind,index)=>event(index+3,"DocumentRenderCompleted",{artifact_id:`a-${kind}`,artifact_kind:kind,document_id:"d",project_id:"p",title:kind,summary:`${kind} summary`,content_ref:`content-${kind}`,item_count:kind==="slides"?4:1,presentation:kind==="slides"?presentation:null,items:kind==="storyboard"?[{id:"frame-1",title:"Frame",media_url:"/api/media/frame.jpg"}]:kind==="slides"?[{id:"slide-1",title:"A visual claim",body:"Evidence becomes legible.",slide}]:[],media_url:kind==="video"?"/api/media/video.mp4":null,media_type:kind==="video"?"video/mp4":null,provider:kind==="video"?"fal":"openai-responses",model_id:kind==="video"?"google/gemini-omni-flash":"gpt-5.6-terra",latency_ms:1200,source_surface:"document"}));
  const projection=foldEvents([event(1,"ProjectCreated",{project_id:"p",name:"Project"}),event(2,"DocumentCreated",{project_id:"p",document_id:"d",title:"Document"}),...artifacts,event(8,"ImageFocalPointCalculated",{target_kind:"artifact",target_id:"frame-1",media_url:"/api/media/frame.jpg",focal_point:{x:.4,y:.6,confidence:.8,method:"attention-region-v2",sampleWidth:32,sampleHeight:32}},"worker:extractor")],Number.POSITIVE_INFINITY,"d");
  assert.deepEqual(projection.artifacts.map((artifact)=>artifact.kind),[...DOCUMENT_ARTIFACT_KINDS].reverse());
  assert.equal(projection.artifacts.find((artifact)=>artifact.kind==="video")?.mediaUrl,"/api/media/video.mp4");
  assert.equal(projection.artifacts.find((artifact)=>artifact.kind==="storyboard")?.items[0]?.focalPoint?.x,.4);
  assert.equal(projection.artifacts.find((artifact)=>artifact.kind==="slides")?.presentation?.theme,"Editorial night");
  assert.equal(projection.artifacts.find((artifact)=>artifact.kind==="slides")?.items[0]?.slide?.visual.kind,"bars");
});

test("validates retained artifact content without accepting partial provider output",()=>{
  assert.equal(parseDocumentArtifactContent('{"title":"Story","summary":"A","content_markdown":"Complete","items":[]}')?.title,"Story");
  const visual=parseDocumentArtifactContent(JSON.stringify({title:"Deck",summary:"A visual brief",content_markdown:"# Deck",presentation,items:[{title:"A visual claim",body:"Evidence becomes legible.",notes:"Explain the evidence.",image_prompt:"No raster image",slide}]}));
  assert.equal(visual?.presentation?.palette.accent,"#df7544");
  assert.equal(visual?.presentation?.footerLabel,"Editorial night");
  assert.equal(visual?.items[0]?.slide?.layout,"metric");
  assert.equal(visual?.items[0]?.slide?.visual.data[0]?.weight,.82);
  const legacy=parseDocumentArtifactContent(JSON.stringify({title:"Legacy deck",summary:"Still usable",content_markdown:"# Legacy",items:[{title:"A decision",body:"First signal. Second signal.",notes:"",image_prompt:""}]}));
  assert.equal(legacy?.items[0]?.slide,null);
  assert.equal(parseDocumentArtifactContent('{"title":"Story","items":[]}'),null);
  assert.equal(parseDocumentArtifactContent("not json"),null);
  const generic=parseDocumentArtifactContent(JSON.stringify({title:"The librarian and the discovery",summary:"Deck",content_markdown:"# Deck",presentation:{...presentation,theme:"Document-derived editorial"},items:[{title:"A visual claim",body:"Evidence becomes legible.",notes:"",image_prompt:"",slide}]}));
  assert.equal(generic?.presentation?.footerLabel,"The librarian and the discovery");assert.equal(defaultSlidePresentation().footerLabel,"");
});

test("offers four coherent deck-level styles while preserving the generated starting palette",()=>{
  assert.deepEqual(SLIDE_STYLE_PRESETS.map((preset)=>preset.id),["gallery","editorial","nocturne","field-notes"]);
  assert.deepEqual(SLIDE_STYLE_PRESETS.map((preset)=>preset.label),["Gallery","Editorial","Nocturne","Field notes"]);
  const generated=normalizeSlidePresentation({...presentation,style_preset:"nocturne",footer_label:"Night study"});assert.ok(generated);assert.equal(generated.stylePreset,"nocturne");assert.equal(generated.palette.accent,"#df7544");
  const editorial=applySlideStylePreset(generated,"editorial");assert.equal(editorial.stylePreset,"editorial");assert.equal(editorial.mode,"light");assert.equal(editorial.theme,generated.theme);assert.equal(editorial.footerLabel,"Night study");assert.equal(editorial.palette.accent,SLIDE_STYLE_PRESETS[1].palette.accent);
  const original=applySlideStylePreset(generated,"nocturne");assert.deepEqual(original.palette,generated.palette);
});

test("removes repeated slide copy, empty bullets, and unfinished visual placeholders",()=>{
  const content=parseDocumentArtifactContent(JSON.stringify({title:"Deck",summary:"Editorially complete",content_markdown:"# Deck",presentation,items:[{title:"A New Chapter",body:"A New Chapter",notes:"Explain the change.",image_prompt:"A visual transition.",slide:{layout:"split",kicker:"A New Chapter",bullets:["","•","A New Chapter","A specific conflict","A specific conflict"],visual:{kind:"color-field",label:"A New Chapter",value:"A New Chapter",data:[{label:"A Reluctant Ally",value:"Hidden leverage",weight:.8},{label:"Point 2",value:"",weight:.6},{label:"Point 3",value:"",weight:.4}]}}}]}));
  const item=content?.items[0];assert.ok(item?.slide);assert.equal(item.body,"");assert.equal(item.slide.kicker,"Overview");assert.deepEqual(item.slide.bullets,["A specific conflict"]);assert.equal(item.slide.visual.kind,"hero-type");assert.equal(item.slide.visual.value,"A Reluctant Ally");assert.equal(item.slide.visual.label,"Visual emphasis");assert.deepEqual(item.slide.visual.data,[]);assert.equal(slideVisualIsComplete(item.slide),true);assert.doesNotMatch(JSON.stringify(item),/Point [23]/);
});

test("treats punctuation, line breaks, quote fragments, and close restatements as repeated slide copy",()=>{
  const quote='“Careful,” says the librarian. Then: “Show me what you found.”';const echo='“Careful,” says the librarian\nThen: “Show me what you found';
  assert.equal(slideCopyIsNearDuplicate(quote,echo),true);
  assert.equal(slideCopyIsNearDuplicate("The librarian warns them to move carefully before asking to see what they found.","The librarian asks to see what they found"),true);
  assert.equal(slideCopyIsNearDuplicate("Protect the window light.","Keep the wardrobe texture legible."),false);
  const rawItem={title:"A warning",body:quote,notes:"Explain the exchange.",image_prompt:"A quiet discovery.",slide:{layout:"split",kicker:"Discovery",bullets:[echo,"The map changes their next move"],visual:{kind:"metric",label:"Trust changes",value:"One disclosed secret",data:[]}}};
  const issues=slideCopyIssues(rawItem);assert.equal(slideCopyIsDistinct(rawItem),false);assert.equal(issues.some((issue)=>issue.firstPath==="body"&&issue.secondPath==="slide.bullets.0"),true);
  const content=parseDocumentArtifactContent(JSON.stringify({title:"Deck",summary:"An edited presentation",content_markdown:"# Deck",presentation,items:[rawItem]}));const item=content?.items[0];assert.ok(item?.slide);assert.equal(item.body,quote);assert.deepEqual(item.slide.bullets,["The map changes their next move"]);assert.equal(slideCopyIsDistinct(item),true);
});

test("normalizes repeated narrative copy across the complete slide deck",()=>{
  const repeated="The discovery changes what the librarian is willing to reveal.";
  const items=[
    {title:"A guarded discovery",body:repeated,notes:"Open the argument.",image_prompt:"",slide:{layout:"statement",kicker:"Discovery",bullets:["Trust remains provisional"],visual:{kind:"hero-type",label:"Turning point",value:"A map enters the room",data:[]}}},
    {title:"Trust becomes conditional",body:"The next decision depends on who accepts the map.",notes:"Advance the argument.",image_prompt:"",slide:{layout:"split",kicker:"Consequence",bullets:[repeated,"The group chooses a cautious route"],visual:{kind:"metric",label:"Shared confidence",value:"One difficult agreement",data:[]}}},
  ];
  const issues=slideDeckCopyIssues(items);assert.equal(slideDeckCopyIsDistinct(items),false);assert.equal(issues.some((issue)=>issue.firstSlide===0&&issue.secondSlide===1&&issue.firstPath==="body"&&issue.secondPath==="slide.bullets.0"),true);
  const normalized=normalizeSlideDeckItems(items);assert.deepEqual(normalized[1]?.slide?.bullets,["The group chooses a cautious route"]);assert.equal(slideDeckCopyIsDistinct(normalized),true);
});

test("keeps text, structured slides, storyboard, and video rendering behind durable server jobs",async()=>{
  const [adapter,jobs,events,store,component,slideComponent,deckComponent,canvas,styles]=await Promise.all([
    readFile(new URL("../worker/openai-adapter.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/document-jobs-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/document-artifacts.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/presentation-slide.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/presentation-deck.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/canvas/canvas-application.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/styles.css",import.meta.url),"utf8"),
  ]);
  assert.match(adapter,/queue\.fal\.run/);assert.match(adapter,/google\/gemini-omni-flash/);assert.match(adapter,/request_id/);assert.match(adapter,/providerJobId/);assert.match(adapter,/generateDocumentArtifact/);
  assert.match(adapter,/slidePresentationSchema/);assert.match(adapter,/footer_label/);assert.match(adapter,/style_preset/);assert.match(adapter,/SLIDE_STYLE_PRESET_IDS/);assert.match(adapter,/SLIDE_VISUAL_KINDS/);assert.match(adapter,/not a request for raster slide images/i);assert.match(adapter,/Never put process language/);
  assert.match(adapter,/Never emit empty bullets/);assert.match(adapter,/Do not repeat or closely restate/);assert.match(adapter,/punctuation, quotation marks, line breaks/);assert.match(adapter,/review every slide against every other slide/i);assert.match(adapter,/slideCopyIsDistinct/);assert.match(adapter,/slideDeckCopyIsDistinct/);
  assert.match(jobs,/render_document/);assert.match(jobs,/providerJobId/);assert.match(jobs,/renderedItems/);
  assert.match(events,/DocumentRenderRequested/);assert.match(events,/DocumentRenderCompleted/);assert.match(events,/DocumentRenderFailed/);
  assert.match(events,/artifact_media_target_not_found/);assert.match(store,/renderDocumentArtifact/);assert.match(store,/targetKind:"artifact"/);assert.match(component,/I understand, continue/);assert.match(component,/Gemini Omni Flash/);assert.match(component,/Saving…":"Stop/);
  assert.match(component,/document-artifact-reader-content/);assert.match(styles,/\.document-artifact-reader-content \{ min-height: 0; overflow: auto;/);assert.match(styles,/\.document-artifact-reader \{ min-height: 0; overflow: hidden;/);
  assert.match(component,/forma-presentation-slide/);assert.match(slideComponent,/presentation-visual-bars/);assert.match(canvas,/forma-presentation-slide/);assert.match(styles,/\.presentation-slide/);assert.match(styles,/aspect-ratio: 16\s*\/\s*9/);
  for(const source of [component,canvas]){assert.match(source,/forma-presentation-deck/);assert.match(source,/\.preferenceKey=\$\{artifact\.id\}/);}assert.match(deckComponent,/Show deck label/);assert.match(deckComponent,/Slide style/);assert.match(deckComponent,/SLIDE_STYLE_PRESETS\.map/);assert.match(deckComponent,/slide-style-changed/);assert.match(deckComponent,/DECK_STYLE_PREFERENCE/);assert.match(deckComponent,/List/);assert.match(deckComponent,/Slideshow/);assert.match(deckComponent,/ArrowLeft/);assert.match(deckComponent,/ArrowRight/);assert.match(deckComponent,/Previous/);assert.match(deckComponent,/Next/);assert.match(deckComponent,/normalizeSlideDeckItems/);assert.match(deckComponent,/writeSlideFooterLabelPreference/);assert.match(slideComponent,/presentation\.footerLabel/);assert.match(slideComponent,/style-\$\{presentation\.stylePreset\}/);assert.doesNotMatch(slideComponent,/>\$\{presentation\.theme\}</);
  assert.match(styles,/\.presentation-deck-frame \{[^}]*aspect-ratio: 16\/9;/);assert.match(styles,/\.presentation-deck-frame \.presentation-slide \{ aspect-ratio: auto;/);
  for(const style of ["gallery","editorial","nocturne","field-notes"])assert.match(styles,new RegExp(`\\.presentation-slide\\.style-${style}`));assert.match(styles,/\.artifact-slides > li/);assert.match(styles,/\.presentation-slide-body > section > ul > li/);assert.match(styles,/list-style: disc/);assert.doesNotMatch(styles,/\.artifact-slides li \{/);
  for(const kind of DOCUMENT_ARTIFACT_KINDS){assert.match(component,new RegExp(kind));assert.match(canvas,new RegExp(kind));}
});

test("submits and resumes Gemini Omni Flash video through the Fal queue",async()=>{
  const originalFetch=globalThis.fetch;const calls=[];
  globalThis.fetch=async(input,init={})=>{
    calls.push({url:String(input),method:init.method??"GET",authorization:new Headers(init.headers).get("authorization"),body:init.body});
    if(calls.length===1)return Response.json({request_id:"fal-request-1",status:"IN_QUEUE"});
    if(calls.length===2)return Response.json({request_id:"fal-request-1",status:"COMPLETED"});
    if(calls.length===3)return Response.json({video:{url:"https://v3b.fal.media/files/example/video.mp4",content_type:"video/mp4",file_size:4}});
    return new Response(Uint8Array.from([0,1,2,3]),{headers:{"content-type":"video/mp4"}});
  };
  try{
    const receipts=[];const result=await generateCreativeVideo({FAL_KEY:"test-only",FORMA_VIDEO_PROVIDER:"fal",FAL_VIDEO_MODEL:"google/gemini-omni-flash"},"A quiet camera move across the field.",{seconds:4,size:"1280x720",onReceipt:(receipt)=>{receipts.push(receipt);}});
    assert.equal(result.provider,"fal");assert.equal(result.model,"google/gemini-omni-flash");assert.equal(result.providerJobId,"fal-request-1");assert.equal(result.costMicrousd,500_000);assert.equal(result.mimeType,"video/mp4");
    assert.deepEqual(receipts,[{providerJobId:"fal-request-1",provider:"fal",model:"google/gemini-omni-flash"}]);
    assert.equal(calls[0].url,"https://queue.fal.run/google/gemini-omni-flash");assert.equal(calls[0].method,"POST");assert.equal(calls[0].authorization,"Key test-only");assert.deepEqual(JSON.parse(String(calls[0].body)),{prompt:"A quiet camera move across the field.",aspect_ratio:"16:9",duration:4});
    assert.match(calls[1].url,/\/requests\/fal-request-1\/status\?logs=1$/);assert.match(calls[2].url,/\/requests\/fal-request-1$/);assert.equal(calls[3].url,"https://v3b.fal.media/files/example/video.mp4");
  }finally{globalThis.fetch=originalFetch;}
});

test("replay laboratory semantically covers every document artifact",()=>{
  const events=buildComprehensiveScenario();const coverage=evaluateReplayCoverage(events,SCENARIO_EVENT_TYPES);const check=coverage.checks.find((item)=>item.key==="document-artifact-rendering");
  assert.equal(check?.passed,true);assert.equal(coverage.passed,true);
  const repetitive=events.map((entry)=>entry.type!=="DocumentRenderCompleted"||entry.payload.artifact_kind!=="slides"?entry:{...entry,payload:{...entry.payload,items:entry.payload.items.map((item,index)=>index?item:{...item,body:'“Careful,” says the librarian. Then: “Show me what you found.”',slide:{...item.slide,bullets:['“Careful,” says the librarian\nThen: “Show me what you found']}})}});const repetitiveCoverage=evaluateReplayCoverage(repetitive,SCENARIO_EVENT_TYPES);
  assert.equal(repetitiveCoverage.checks.find((item)=>item.key==="document-artifact-rendering")?.passed,false);
  const repeatedAcrossSlides=events.map((entry)=>entry.type!=="DocumentRenderCompleted"||entry.payload.artifact_kind!=="slides"?entry:{...entry,payload:{...entry.payload,items:entry.payload.items.map((item,index,items)=>index===1?{...item,body:items[0].body}:item)}});const repeatedDeckCoverage=evaluateReplayCoverage(repeatedAcrossSlides,SCENARIO_EVENT_TYPES);
  assert.equal(repeatedDeckCoverage.checks.find((item)=>item.key==="document-artifact-rendering")?.passed,false);
});
