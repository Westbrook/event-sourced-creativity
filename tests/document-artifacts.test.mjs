import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applySlideStylePreset, defaultSlidePresentation, documentArtifactValidationIssues, DOCUMENT_ARTIFACT_KINDS, normalizeSlideDeckItems, normalizeSlidePresentation, parseDocumentArtifactContent, SLIDE_STYLE_PRESETS, slideCopyIsDistinct, slideCopyIsNearDuplicate, slideCopyIssues, slideDeckCopyIsDistinct, slideDeckCopyIssues, slideVisualIsComplete } from "../src/model/document-artifacts.ts";
import { isVideoDurationSeconds, normalizeVideoDurationSeconds, VIDEO_ADAPTER_CONTRACT, VIDEO_DURATION_SECONDS } from "../src/model/video-adapter.ts";
import { foldEvents } from "../src/model/events.ts";
import { buildComprehensiveScenario, SCENARIO_EVENT_TYPES } from "../src/model/scenarios.ts";
import { evaluateReplayCoverage } from "../src/model/replay-coverage.ts";
import { generateCreativeVideo, generateDocumentArtifact } from "../worker/openai-adapter.ts";
import { artifactGenerationInputInspection, outputGenerationInputInspection } from "../src/model/generation-inputs.ts";

const event=(sequence,type,payload,actor=type.startsWith("DocumentRender")?"worker:renderer":"user")=>({eventId:`e${sequence}`,streamId:"s",sequence,occurredAt:"2026-08-19T12:00:00.000Z",recordedAt:"2026-08-19T12:00:00.000Z",actor,clientId:"test",correlationId:"c",causationId:null,compensatesEventId:null,schemaVersion:1,type,payload});
const presentation={aspectRatio:"16:9",theme:"Editorial night",mode:"dark",palette:{background:"#121714",foreground:"#f5f3ee",accent:"#df7544",muted:"#a8b1aa",surface:"#252c27"}};
const slide={layout:"metric",kicker:"Evidence",bullets:["One durable decision","One reusable visual system"],visual:{kind:"bars",label:"Creative confidence",value:"82%",data:[{label:"Direction",value:"82%",weight:.82},{label:"Coherence",value:"74%",weight:.74}]}};

test("projects every document-derived form as a durable result",()=>{
  const artifacts=DOCUMENT_ARTIFACT_KINDS.map((kind,index)=>event(index+3,"DocumentRenderCompleted",{artifact_id:`a-${kind}`,artifact_kind:kind,document_id:"d",project_id:"p",title:kind,summary:`${kind} summary`,content_ref:`content-${kind}`,input_ref:`input-${kind}`,item_count:kind==="slides"?4:1,presentation:kind==="slides"?presentation:null,items:kind==="storyboard"?[{id:"frame-1",title:"Frame",media_url:"/api/media/frame.jpg"}]:kind==="slides"?[{id:"slide-1",title:"A visual claim",body:"Evidence becomes legible.",slide}]:[],media_url:kind==="video"?"/api/media/video.mp4":null,media_type:kind==="video"?"video/mp4":null,provider:kind==="video"?"fal":"openai-responses",model_id:kind==="video"?"bytedance/seedance-2.0/reference-to-video":"gpt-5.6-terra",latency_ms:1200,source_surface:"document"}));
  const projection=foldEvents([event(1,"ProjectCreated",{project_id:"p",name:"Project"}),event(2,"DocumentCreated",{project_id:"p",document_id:"d",title:"Document"}),...artifacts,event(8,"ImageFocalPointCalculated",{target_kind:"artifact",target_id:"frame-1",media_url:"/api/media/frame.jpg",focal_point:{x:.4,y:.6,confidence:.8,method:"attention-region-v2",sampleWidth:32,sampleHeight:32}},"worker:extractor")],Number.POSITIVE_INFINITY,"d");
  assert.deepEqual(projection.artifacts.map((artifact)=>artifact.kind),[...DOCUMENT_ARTIFACT_KINDS].reverse());
  assert.equal(projection.artifacts.find((artifact)=>artifact.kind==="video")?.mediaUrl,"/api/media/video.mp4");
  assert.equal(projection.artifacts.find((artifact)=>artifact.kind==="storyboard")?.items[0]?.focalPoint?.x,.4);
  assert.equal(projection.artifacts.find((artifact)=>artifact.kind==="slides")?.presentation?.theme,"Editorial night");
  assert.equal(projection.artifacts.find((artifact)=>artifact.kind==="slides")?.items[0]?.slide?.visual.kind,"bars");
  assert.equal(projection.artifacts.find((artifact)=>artifact.kind==="video")?.inputRef,"input-video");
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

test("reports exact slide contract failures without rejecting intentionally bodyless slides",()=>{
  const bodyless=parseDocumentArtifactContent(JSON.stringify({title:"Deck",summary:"Visual",content_markdown:"# Deck",presentation,items:[{title:"One clear claim",body:"",notes:"Speak to the evidence.",image_prompt:"",context_group_ids:[],slide:{layout:"metric",kicker:"Evidence",bullets:[],visual:{kind:"metric",label:"Confidence",value:"82%",data:[]}}}]}));
  assert.deepEqual(documentArtifactValidationIssues("slides",bodyless,{itemCount:1}),[]);
  const incomplete=parseDocumentArtifactContent(JSON.stringify({title:"Document-derived editorial",summary:"Broken",content_markdown:"",presentation:{...presentation,footer_label:"Document-derived editorial"},items:[{title:"",body:"",notes:"",image_prompt:"",context_group_ids:[],slide:{layout:"bars",kicker:"",bullets:[],visual:{kind:"bars",label:"",value:"",data:[]}}}]}));
  const codes=new Set(documentArtifactValidationIssues("slides",incomplete,{itemCount:2,contextGroupIds:["group-1"]}).map((issue)=>issue.code));
  for(const code of ["missing_content","wrong_item_count","missing_context_group","missing_footer_label","missing_title","incomplete_visual","missing_visible_claim"])assert.equal(codes.has(code),true,code);
});

test("repairs an incomplete provider slide plan once and retains exact validation receipts",async()=>{
  const originalFetch=globalThis.fetch;const requests=[];
  const incomplete={title:"Field study",summary:"A broken first pass",content_markdown:"# Field study",presentation:{...presentation,footer_label:"Field study"},items:[{title:"",body:"",notes:"",image_prompt:"",context_group_ids:[],slide:{layout:"split",kicker:"",bullets:[],visual:{kind:"bars",label:"",value:"",data:[]}}}]};
  const repaired={title:"Field study",summary:"A resolved deck",content_markdown:"# Field study\n\nOne clear progression.",presentation:{...presentation,footer_label:"Field study"},items:[{title:"Protect the opening",body:"",notes:"Explain why the field remains visible.",image_prompt:"No raster image.",context_group_ids:[],slide:{layout:"metric",kicker:"Evidence",bullets:[],visual:{kind:"metric",label:"Open field",value:"82%",data:[]}}}]};
  globalThis.fetch=async(_input,init={})=>{const request=JSON.parse(String(init.body));requests.push(request);const output=requests.length===1?incomplete:repaired;return Response.json({id:`response-${requests.length}`,model:"gpt-test",output_text:JSON.stringify(output),usage:{input_tokens:100,output_tokens:50,total_tokens:150}});};
  try{const result=await generateDocumentArtifact({OPENAI_API_KEY:"test",OPENAI_MODEL:"gpt-test"},"user-1","slides",{documentTitle:"Field study",snapshot:{facts:[],relationships:[]},options:{itemCount:1}});assert.equal(requests.length,2);assert.equal(requests[1].text.format.name,"document_slides_repair");assert.equal(result.output.items[0]?.title,"Protect the opening");assert.equal(result.inputReceipt.validation.repair_attempted,true);assert.ok(result.inputReceipt.validation.initial_issues.some((issue)=>issue.code==="missing_title"));assert.deepEqual(result.inputReceipt.validation.repair_issues,[]);assert.deepEqual(result.usage,{inputTokens:200,outputTokens:100,totalTokens:300});}
  finally{globalThis.fetch=originalFetch;}
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
  assert.match(adapter,/queue\.fal\.run/);assert.match(adapter,/DEFAULT_REFERENCE_VIDEO_MODEL/);assert.match(adapter,/VIDEO_ADAPTER_CONTRACT/);assert.match(adapter,/@Image/);assert.match(adapter,/end_user_id/);assert.match(adapter,/request_id/);assert.match(adapter,/providerJobId/);assert.match(adapter,/generateDocumentArtifact/);
  assert.match(adapter,/slidePresentationSchema/);assert.match(adapter,/footer_label/);assert.match(adapter,/style_preset/);assert.match(adapter,/SLIDE_STYLE_PRESET_IDS/);assert.match(adapter,/SLIDE_VISUAL_KINDS/);assert.match(adapter,/not a request for raster slide images/i);assert.match(adapter,/Never put process language/);
  assert.match(adapter,/Never emit empty bullets/);assert.match(adapter,/Do not repeat or closely restate/);assert.match(adapter,/punctuation, quotation marks, line breaks/);assert.match(adapter,/review every slide against every other slide/i);assert.match(adapter,/documentArtifactValidationIssues/);assert.match(adapter,/document_slides_repair/);assert.match(adapter,/one bounded repair pass/i);
  assert.match(jobs,/render_document/);assert.match(jobs,/providerJobId/);assert.match(jobs,/renderedItems/);
  assert.match(events,/DocumentRenderRequested/);assert.match(events,/DocumentRenderCompleted/);assert.match(events,/DocumentRenderFailed/);
  assert.match(events,/document-artifact-input/);assert.match(events,/input_ref/);assert.match(events,/videoPixelReferences/);assert.match(events,/used_reference_pixels/);
  const renderDocumentRoute=events.slice(events.indexOf('if(body.action==="render_document")'));
  const videoPreflightAt=renderDocumentRoute.indexOf('if(!body.providerJobId)adaptVideoPrompt(');
  const renderReservationAt=renderDocumentRoute.indexOf('reserveBudget(');
  assert.ok(videoPreflightAt>=0,"fresh video requests must validate the complete source adaptation before paying a planner");
  assert.ok(videoPreflightAt<renderReservationAt,"video adaptation preflight must finish before reserving budget or calling a provider");
  const unsupportedVideoProviderAt=renderDocumentRoute.indexOf('env.FORMA_VIDEO_PROVIDER!=="fal"');
  assert.ok(unsupportedVideoProviderAt>=0&&unsupportedVideoProviderAt<renderReservationAt,"unsupported video providers must be rejected before reserving budget or calling a planner");
  assert.match(events,/artifact_media_target_not_found/);assert.match(store,/renderDocumentArtifact/);assert.match(store,/targetKind:"artifact"/);assert.match(component,/I understand, continue/);assert.match(component,/VIDEO_ADAPTER_CONTRACT\.label/);assert.match(component,/Inspect inputs/);assert.match(component,/Saving…":"Stop/);assert.match(component,/forma-video-reference-preflight/);assert.match(component,/reference-to-video/);assert.match(component,/No reference pixels will leave storage/);
  assert.match(component,/VIDEO_DURATION_SECONDS\.map/);assert.match(canvas,/openRender\(kind,item\.sourceId\)/);assert.match(canvas,/same complete configuration available in the document/);assert.match(events,/video_duration_unsupported/);
  assert.match(component,/document-artifact-reader-content/);assert.match(styles,/\.document-artifact-reader-content \{ min-height: 0; overflow: auto;/);assert.match(styles,/\.document-artifact-reader \{ min-height: 0; overflow: hidden;/);
  assert.match(component,/#createdAt\(artifact:DocumentArtifact\)/);assert.match(component,/event\.eventId===artifact\.sourceEventId/);assert.match(component,/class="document-artifact-created"/);assert.match(component,/>Created \$\{/);assert.match(styles,/\.document-artifact-created \{/);
  assert.match(component,/Use \$\{documentArtifactDefinition\(artifact\.kind\)\.label\.toLowerCase\(\)\} as input/);assert.match(component,/addArtifactAsContext/);assert.match(store,/artifactContextEvents/);assert.match(canvas,/artifactContextEvents/);assert.match(canvas,/imageOutputContextEvents/);
  assert.match(component,/forma-presentation-slide/);assert.match(slideComponent,/presentation-visual-bars/);assert.match(canvas,/forma-presentation-slide/);assert.match(styles,/\.presentation-slide/);assert.match(styles,/aspect-ratio: 16\s*\/\s*9/);
  for(const source of [component,canvas]){assert.match(source,/forma-presentation-deck/);assert.match(source,/\.preferenceKey=\$\{artifact\.id\}/);assert.match(source,/\.deckTitle=\$\{artifact\.title\}/);assert.match(source,/\.documentId=\$\{artifact\.documentId\}/);}assert.match(deckComponent,/Show deck label/);assert.match(deckComponent,/Slide style/);assert.match(deckComponent,/SLIDE_STYLE_PRESETS\.map/);assert.match(deckComponent,/slide-style-changed/);assert.match(deckComponent,/DECK_STYLE_PREFERENCE/);assert.match(deckComponent,/List/);assert.match(deckComponent,/Slideshow/);assert.match(deckComponent,/Download PDF/);assert.match(deckComponent,/renderPresentationPdf/);assert.match(deckComponent,/application\/pdf/);assert.match(deckComponent,/DocumentArtifactExported/);assert.match(deckComponent,/ArrowLeft/);assert.match(deckComponent,/ArrowRight/);assert.match(deckComponent,/Previous/);assert.match(deckComponent,/Next/);assert.match(deckComponent,/normalizeSlideDeckItems/);assert.match(deckComponent,/writeSlideFooterLabelPreference/);assert.match(slideComponent,/presentation\.footerLabel/);assert.match(slideComponent,/style-\$\{presentation\.stylePreset\}/);assert.doesNotMatch(slideComponent,/>\$\{presentation\.theme\}</);
  assert.match(styles,/\.presentation-deck-frame \{[^}]*aspect-ratio: 16\/9;/);assert.match(styles,/\.presentation-deck-frame \.presentation-slide \{ aspect-ratio: auto;/);
  for(const style of ["gallery","editorial","nocturne","field-notes"])assert.match(styles,new RegExp(`\\.presentation-slide\\.style-${style}`));assert.match(styles,/\.artifact-slides > li/);assert.match(styles,/\.presentation-slide-body > section > ul > li/);assert.match(styles,/list-style: disc/);assert.doesNotMatch(styles,/\.artifact-slides li \{/);
  for(const kind of DOCUMENT_ARTIFACT_KINDS){assert.match(component,new RegExp(kind));assert.match(canvas,new RegExp(kind));}
});

test("uses the complete Seedance 2.0 duration contract across four through fifteen seconds",()=>{
  assert.deepEqual(VIDEO_DURATION_SECONDS,[4,5,6,7,8,9,10,11,12,13,14,15]);
  assert.deepEqual(VIDEO_ADAPTER_CONTRACT.supportedDurations,VIDEO_DURATION_SECONDS);
  assert.equal(normalizeVideoDurationSeconds("15"),15);
  assert.equal(normalizeVideoDurationSeconds(3),VIDEO_ADAPTER_CONTRACT.defaultDuration);
  assert.equal(isVideoDurationSeconds(15),true);
  assert.equal(isVideoDurationSeconds(16),false);
});

test("retains inspectable input receipts for image and document outputs",async()=>{
  const output={id:"object-1",documentId:"d",canvasId:null,contextSetId:null,generationId:"generation-1",modelId:"gpt-image-2",variant:0,latency:1000,sequence:3,pinned:false,saved:false,discarded:false,library:false,contentRef:null,promptRef:"prompt-1",promptTechnique:"bullets",promptFanId:null,provider:"openai",mediaUrl:"/api/media/image.png",mediaType:"image/png",width:1024,height:1024,plannerModelId:"gpt-5.6-terra",quality:"high",purpose:"final",sourceEventId:"e3",sourceSurface:"document",promotionId:null,promotedFromId:null,promotedFromEventId:null,focalPoint:null,standalone:true,standaloneSequence:3};
  const compile=event(2,"ContextCompiled",{generation_id:"generation-1",compiled_snapshot:{facts:[{block_id:"b1",type:"subject",properties:{text:"A librarian"}}]},context_hash:"hash",reference_inputs:[{label:"Portrait",pixels_submitted:true}],used_uploaded_reference_pixels:true},"worker:compiler");
  const imageInspection=outputGenerationInputInspection(output,[compile],{"prompt-1":"Exact image prompt"});assert.equal(imageInspection.prompt,"Exact image prompt");assert.equal(imageInspection.receipt.context_hash,"hash");assert.equal(imageInspection.receipt.used_reference_pixels,true);
  const artifact={id:"artifact-1",documentId:"d",kind:"video",title:"Motion",summary:"A motion study",contentRef:"artifact-content",inputRef:"artifact-input",itemCount:1,items:[],mediaUrl:"/api/media/video.mp4",mediaType:"video/mp4",provider:"fal",modelId:"fal-ai/veo3.1/fast/reference-to-video",latency:2000,sequence:4,sourceEventId:"e4",sourceSurface:"document",settings:{video_seconds:4},presentation:null};
  const retained={schema_version:1,document_snapshot:{facts:[{block_id:"b1"}]},planner:{instructions:"Plan motion",providerInput:{document_title:"Motion"}},render:{submitted_prompt:"Exact motion prompt",reference_inputs:[{label:"Frame 1",pixels_submitted:true}]}};const artifactInspection=artifactGenerationInputInspection(artifact,{"artifact-input":JSON.stringify(retained)});assert.equal(artifactInspection.prompt,"Exact motion prompt");assert.equal(artifactInspection.retained,true);assert.deepEqual(artifactInspection.receipt.document_snapshot,{facts:[{block_id:"b1"}]});
  const [outputCard,fanReview,artifactGallery,canvas,inputDialog]=await Promise.all(["output-card.ts","prompt-fan-review.ts","document-artifacts.ts"].map((name)=>readFile(new URL(`../src/components/${name}`,import.meta.url),"utf8")).concat([readFile(new URL("../src/canvas/canvas-application.ts",import.meta.url),"utf8"),readFile(new URL("../src/components/generation-input-dialog.ts",import.meta.url),"utf8")]));
  for(const surface of [outputCard,fanReview,artifactGallery,canvas])assert.match(surface,/Inspect inputs/);
  assert.match(inputDialog,/Submitted prompt/);assert.match(inputDialog,/Reference pixels/);assert.match(inputDialog,/Complete input receipt/);assert.match(inputDialog,/Copy prompt/);assert.match(inputDialog,/Copy receipt/);
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
    assert.deepEqual(receipts,[{providerJobId:"fal-request-1",provider:"fal",model:"google/gemini-omni-flash",providerStatusUrl:"https://queue.fal.run/google/gemini-omni-flash/requests/fal-request-1/status",providerResponseUrl:"https://queue.fal.run/google/gemini-omni-flash/requests/fal-request-1",providerCancelUrl:"https://queue.fal.run/google/gemini-omni-flash/requests/fal-request-1/cancel"}]);
    assert.equal(calls[0].url,"https://queue.fal.run/google/gemini-omni-flash");assert.equal(calls[0].method,"POST");assert.equal(calls[0].authorization,"Key test-only");const submitted=JSON.parse(String(calls[0].body));assert.equal(submitted.aspect_ratio,"16:9");assert.equal(submitted.duration,4);assert.match(submitted.prompt,/exactly 4 seconds/);assert.match(submitted.prompt,/A quiet camera move across the field/);
    assert.equal(calls[1].url,"https://queue.fal.run/google/gemini-omni-flash/requests/fal-request-1/status?logs=1");assert.equal(calls[2].url,"https://queue.fal.run/google/gemini-omni-flash/requests/fal-request-1");assert.equal(calls[3].url,"https://v3b.fal.media/files/example/video.mp4");
  }finally{globalThis.fetch=originalFetch;}
});

test("resumes a routed Fal video through the application-level queue without a second paid submission",async()=>{
  const originalFetch=globalThis.fetch;const calls=[];globalThis.fetch=async(input,init={})=>{const url=String(input);calls.push({url,method:init.method??"GET"});if(url.endsWith("/status?logs=1"))return Response.json({request_id:"fal-existing-1",status:"COMPLETED",response_url:"https://queue.fal.run/google/gemini-omni-flash/requests/fal-existing-1"});if(url==="https://queue.fal.run/google/gemini-omni-flash/requests/fal-existing-1")return Response.json({video:{url:"https://v3b.fal.media/files/example/recovered-video.mp4",content_type:"video/mp4"}});return new Response(Uint8Array.from([0,1,2,3]),{headers:{"content-type":"video/mp4"}});};
  try{const receipts=[];const result=await generateCreativeVideo({FAL_KEY:"test-only",FORMA_VIDEO_PROVIDER:"fal"},"Recover the accepted render.",{seconds:10,size:"1280x720",providerJobId:"fal-existing-1",providerModel:"google/gemini-omni-flash/reference-to-video",onReceipt:(receipt)=>receipts.push(receipt)});assert.equal(calls.some((call)=>call.method==="POST"),false);assert.equal(calls[0].url,"https://queue.fal.run/google/gemini-omni-flash/requests/fal-existing-1/status?logs=1");assert.equal(calls[1].url,"https://queue.fal.run/google/gemini-omni-flash/requests/fal-existing-1");assert.equal(result.providerJobId,"fal-existing-1");assert.equal(receipts[0].providerStatusUrl,"https://queue.fal.run/google/gemini-omni-flash/requests/fal-existing-1/status");}
  finally{globalThis.fetch=originalFetch;}
});

test("submits actual ordered fictional storyboard pixels through Seedance reference-to-video",async()=>{
  const originalFetch=globalThis.fetch;const calls=[];globalThis.fetch=async(input,init={})=>{const url=String(input);calls.push({url,method:init.method??"GET",body:init.body});if(url.includes("/storage/upload/initiate"))return Response.json({upload_url:"https://upload.fal.media/reference-1",file_url:"https://v3b.fal.media/files/example/reference-1.png"});if(url==="https://upload.fal.media/reference-1")return new Response("");if(init.method==="POST")return Response.json({request_id:"fal-reference-1",status:"IN_QUEUE",status_url:"https://queue.fal.run/bytedance/seedance-2.0/requests/fal-reference-1/status",response_url:"https://queue.fal.run/bytedance/seedance-2.0/requests/fal-reference-1",cancel_url:"https://queue.fal.run/bytedance/seedance-2.0/requests/fal-reference-1/cancel"});if(url.includes("/status"))return Response.json({request_id:"fal-reference-1",status:"COMPLETED"});if(url==="https://queue.fal.run/bytedance/seedance-2.0/requests/fal-reference-1")return Response.json({video:{url:"https://v3b.fal.media/files/example/reference-video.mp4",content_type:"video/mp4"}});return new Response(Uint8Array.from([0,1,2,3]),{headers:{"content-type":"video/mp4"}});};
  try{
    const prepared=[];const stages=[];const result=await generateCreativeVideo({FAL_KEY:"test-only",FORMA_VIDEO_PROVIDER:"fal"},"The group crosses the library.",{seconds:8,size:"1280x720",resolution:"480p",generateAudio:false,endUserId:"user-123",references:Array.from({length:6},(_,index)=>({bytes:Uint8Array.from([137,80,78,71,index]),mimeType:"image/png",blockId:`block-frame-${index+1}`,referenceId:`reference-frame-${index+1}`,label:`Storyboard frame ${index+1}`,mode:"preserve_composition",sequence:index+1,shotDirection:`Beat ${index+1} enters from frame left.`,cameraDirection:"Slow dolly forward.",framePrompt:"Warm library interior.",sourceArtifactId:"storyboard-1",sourceArtifactItemId:`frame-${index+1}`,sourceArtifactKind:"storyboard",storyboardTitle:"Library discovery",contextGroups:[{id:"group-cast",name:"Cast continuity",target:"Mara",role:"character",application:"isolate",relativity:.92}]})),onPrepared:(receipt)=>prepared.push(receipt),onStage:(stage)=>stages.push(stage)});
    const queueCall=calls.find((call)=>call.url.includes("queue.fal.run")&&call.method==="POST");const submitted=JSON.parse(String(queueCall.body));assert.equal(queueCall.url,"https://queue.fal.run/bytedance/seedance-2.0/reference-to-video");assert.equal(submitted.duration,8);assert.equal(submitted.resolution,"480p");assert.equal(submitted.generate_audio,false);assert.match(submitted.end_user_id,/^forma_[a-f0-9]{32}$/);assert.equal(submitted.image_urls.length,6);assert.ok(submitted.image_urls.every((url)=>url==="https://v3b.fal.media/files/example/reference-1.png"));assert.match(submitted.prompt,/@Image1/);assert.match(submitted.prompt,/@Image6/);assert.match(submitted.prompt,/fictional and synthetic/);assert.doesNotMatch(submitted.prompt,/real person|public figure|biometric/i);assert.match(submitted.prompt,/Storyboard(?: “Library discovery”)? shot 1/);assert.match(submitted.prompt,/Storyboard(?: “Library discovery”)? shot 6/);assert.match(submitted.prompt,/Library discovery/);assert.match(submitted.prompt,/Slow dolly forward/);assert.match(submitted.prompt,/Combined Context “Cast continuity” applies this image only to character “Mara” at 92% relativity/);assert.ok(stages.includes("uploading-references"));assert.equal(prepared[0].parameters.image_transport,"fal-storage-upload");assert.equal(prepared[0].parameters.image_count,6);assert.equal(prepared[0].parameters.identity_provenance,"fictional-synthetic-storyboard");assert.equal(prepared[0].parameters.reference_prompt_profile,"positive-only");assert.equal(prepared[0].parameters.adapter_id,"fal-seedance-reference");assert.equal(prepared[0].parameters.adapter_version,"2.0.0");assert.equal(prepared[0].parameters.adapter_status,"adopted");assert.equal(prepared[0].parameters.end_user_id_supplied,true);assert.equal(result.usedReferencePixels,true);assert.equal(result.referenceInputs.length,6);assert.equal(result.referenceInputs[0].pixels_submitted,true);assert.equal(result.referenceInputs[0].storyboard_sequence,1);assert.equal(result.referenceInputs[5].storyboard_sequence,6);assert.equal(result.referenceInputs[0].context_groups[0].id,"group-cast");assert.equal(result.referenceInputs[0].transport,"fal-storage-upload");assert.equal(result.referenceInputs[0].sha256.length,64);assert.equal(result.providerResponseUrl,"https://queue.fal.run/bytedance/seedance-2.0/requests/fal-reference-1");assert.equal(result.costMicrousd,1_076_040);
  }finally{globalThis.fetch=originalFetch;}
});

test("reuses a byte-verified original Fal image URL for Seedance references",async()=>{
  const originalFetch=globalThis.fetch;const calls=[];const referenceBytes=Uint8Array.from([137,80,78,71,13,10,26,10]);
  globalThis.fetch=async(input,init={})=>{const url=String(input);calls.push({url,method:init.method??"GET",body:init.body});
    if(url==="https://queue.fal.run/ideogram/v4/requests/fal-image-1")return Response.json({images:[{url:"https://v3b.fal.media/files/example/original-reference.png"}]});
    if(url==="https://v3b.fal.media/files/example/original-reference.png")return new Response(referenceBytes,{headers:{"content-type":"image/png"}});
    if(url==="https://queue.fal.run/bytedance/seedance-2.0/reference-to-video"&&init.method==="POST")return Response.json({request_id:"fal-video-1",status:"IN_QUEUE"});
    if(url.endsWith("/status?logs=1"))return Response.json({request_id:"fal-video-1",status:"COMPLETED"});
    if(url==="https://queue.fal.run/bytedance/seedance-2.0/requests/fal-video-1")return Response.json({video:{url:"https://v3b.fal.media/files/example/video.mp4",content_type:"video/mp4"}});
    if(url==="https://v3b.fal.media/files/example/video.mp4")return new Response(Uint8Array.from([0,1,2,3]),{headers:{"content-type":"video/mp4"}});
    throw new Error(`Unexpected request: ${url}`);
  };
  try{const prepared=[];const result=await generateCreativeVideo({FAL_KEY:"test-only",FORMA_VIDEO_PROVIDER:"fal"},"Continue the fictional fashion study.",{seconds:4,size:"1280x720",resolution:"480p",references:[{bytes:referenceBytes,mimeType:"image/png",blockId:"block-1",referenceId:"reference-1",label:"Fashion study",mode:"preserve_subject",sequence:1,shotDirection:"The fictional model turns toward the light.",cameraDirection:"Slow push in.",framePrompt:"Editorial studio.",sourceArtifactId:"storyboard-1",sourceArtifactItemId:"frame-1",sourceArtifactKind:"storyboard",storyboardTitle:"Fashion study",provider:"fal",providerModel:"ideogram/v4/fast",providerRequestId:"fal-image-1",providerMediaUrl:null}],onPrepared:(receipt)=>prepared.push(receipt)});
    const queueCall=calls.find((call)=>call.url==="https://queue.fal.run/bytedance/seedance-2.0/reference-to-video"&&call.method==="POST");const submitted=JSON.parse(String(queueCall.body));assert.deepEqual(submitted.image_urls,["https://v3b.fal.media/files/example/original-reference.png"]);assert.equal(calls.some((call)=>call.url.includes("/storage/upload/")),false);assert.equal(prepared[0].parameters.image_transport,"original-fal-url");assert.equal(prepared[0].parameters.original_provider_asset_count,1);assert.equal(result.referenceInputs[0].transport,"original-fal-url");assert.equal(result.referenceInputs[0].original_provider_asset_reused,true);
  }finally{globalThis.fetch=originalFetch;}
});

test("links a Seedance likeness-policy failure to every submitted reference",async()=>{
  const originalFetch=globalThis.fetch;globalThis.fetch=async(input,init={})=>{const url=String(input);if(url.includes("/storage/upload/initiate"))return Response.json({upload_url:"https://upload.fal.media/reference-1",file_url:"https://v3b.fal.media/files/example/reference-1.png"});if(url==="https://upload.fal.media/reference-1")return new Response("");if(url==="https://queue.fal.run/bytedance/seedance-2.0/reference-to-video"&&init.method==="POST")return Response.json({detail:[{msg:"The images provided may contain likenesses of real people.",type:"content_policy_violation"}]},{status:422});throw new Error(`Unexpected request: ${url}`);};
  const reference=(index)=>({bytes:Uint8Array.from([137,80,78,71,index]),mimeType:"image/png",blockId:`block-${index}`,referenceId:`reference-${index}`,label:`Frame ${index}`,mode:"preserve_subject",sequence:index,shotDirection:"A fictional character turns.",cameraDirection:"Static.",framePrompt:"Painted storyboard.",sourceArtifactId:"storyboard-1",sourceArtifactItemId:`frame-${index}`,sourceArtifactKind:"storyboard",storyboardTitle:"Fictional sequence"});
  try{await assert.rejects(()=>generateCreativeVideo({FAL_KEY:"test-only",FORMA_VIDEO_PROVIDER:"fal"},"Continue the fictional sequence.",{seconds:4,size:"1280x720",references:[reference(1),reference(2)]}),(error)=>{assert.equal(error.detail?.category,"safety");assert.deepEqual(error.detail?.contributingBlockIds,["block-1","block-2"]);assert.deepEqual(error.detail?.contributingReferenceIds,["reference-1","reference-2"]);assert.equal(error.detail?.probe,"fal-seedance-reference-partner-validation");assert.match(error.preparedPrompt,/fictional sequence/i);return true;});}
  finally{globalThis.fetch=originalFetch;}
});

test("reports a Seedance policy rejection at final-result validation without claiming a video rendered",async()=>{
  const originalFetch=globalThis.fetch;const stages=[];globalThis.fetch=async(input,init={})=>{const url=String(input);if(url.includes("/storage/upload/initiate"))return Response.json({upload_url:"https://upload.fal.media/reference-1",file_url:"https://v3b.fal.media/files/example/reference-1.png"});if(url==="https://upload.fal.media/reference-1")return new Response("");if(url==="https://queue.fal.run/bytedance/seedance-2.0/reference-to-video"&&init.method==="POST")return Response.json({request_id:"fal-result-policy-1",status:"IN_QUEUE"});if(url.endsWith("/status?logs=1"))return Response.json({request_id:"fal-result-policy-1",status:"COMPLETED"});if(url==="https://queue.fal.run/bytedance/seedance-2.0/requests/fal-result-policy-1")return Response.json({detail:[{msg:"The image may contain a likeness that cannot be processed.",type:"content_policy_violation"}]},{status:422});throw new Error(`Unexpected request: ${url}`);};
  const reference={bytes:Uint8Array.from([137,80,78,71,1]),mimeType:"image/png",blockId:"block-1",referenceId:"reference-1",label:"Fashion study",mode:"preserve_subject",sequence:null,shotDirection:"Turn toward the light.",cameraDirection:"Slow push.",framePrompt:"Editorial studio.",sourceArtifactId:null,sourceArtifactItemId:null,sourceArtifactKind:null,storyboardTitle:""};
  try{await assert.rejects(()=>generateCreativeVideo({FAL_KEY:"test-only",FORMA_VIDEO_PROVIDER:"fal"},"Continue the fashion study.",{seconds:4,size:"1280x720",resolution:"480p",references:[reference],onStage:(stage)=>stages.push(stage)}),(error)=>{assert.equal(error.detail?.category,"safety");assert.equal(error.detail?.probe,"fal-seedance-result-partner-validation");assert.deepEqual(error.detail?.contributingBlockIds,["block-1"]);return true;});assert.ok(stages.includes("finalizing"));assert.equal(stages.includes("downloading"),false);}
  finally{globalThis.fetch=originalFetch;}
});

test("offers a positive-only Seedance 2.0 reference adapter without identity-safety priming",async()=>{
  const originalFetch=globalThis.fetch;let submitted;globalThis.fetch=async(input,init={})=>{const url=String(input);if(url.includes("/storage/upload/initiate"))return Response.json({upload_url:"https://upload.fal.media/reference-1",file_url:"https://v3b.fal.media/files/example/reference-1.png"});if(url==="https://upload.fal.media/reference-1")return new Response("");if(url==="https://queue.fal.run/bytedance/seedance-2.0/reference-to-video"&&init.method==="POST"){submitted=JSON.parse(String(init.body));return Response.json({request_id:"fal-positive-1",status:"IN_QUEUE"});}if(url.endsWith("/status?logs=1"))return Response.json({request_id:"fal-positive-1",status:"COMPLETED"});if(url==="https://queue.fal.run/bytedance/seedance-2.0/requests/fal-positive-1")return Response.json({video:{url:"https://v3b.fal.media/files/example/positive.mp4",content_type:"video/mp4"}});if(url==="https://v3b.fal.media/files/example/positive.mp4")return new Response(Uint8Array.from([0,1,2,3]),{headers:{"content-type":"video/mp4"}});throw new Error(`Unexpected request: ${url}`);};
  const reference={bytes:Uint8Array.from([137,80,78,71,1]),mimeType:"image/png",blockId:"block-1",referenceId:"reference-1",label:"Adult editorial fashion reference",mode:"preserve_subject",sequence:null,shotDirection:"Turn toward warm light.",cameraDirection:"Slow push.",framePrompt:"Preserve the art direction.",sourceArtifactId:null,sourceArtifactItemId:null,sourceArtifactKind:null,storyboardTitle:""};
  try{const prepared=[];const result=await generateCreativeVideo({FAL_KEY:"test-only",FORMA_VIDEO_PROVIDER:"fal"},"Create an editorial motion study.",{seconds:4,size:"1280x720",resolution:"480p",references:[reference],onPrepared:(receipt)=>prepared.push(receipt)});assert.equal(prepared[0].parameters.reference_prompt_profile,"positive-only");assert.equal(prepared[0].parameters.adapter_status,"adopted");assert.equal(prepared[0].parameters.audio_mode,"silent");assert.equal(prepared[0].parameters.audio_opt_in,false);assert.equal(prepared[0].model,"bytedance/seedance-2.0/reference-to-video");assert.equal(submitted.resolution,"480p");assert.equal(submitted.generate_audio,false);assert.doesNotMatch(submitted.prompt,/real person|public figure|face|identity|biometric/i);assert.match(submitted.prompt,/authorized creative reference/i);assert.equal(result.costMicrousd,538_020);}
  finally{globalThis.fetch=originalFetch;}
});

test("only submits original ambient video audio after an explicit user opt-in",async()=>{
  const originalFetch=globalThis.fetch;let submitted;globalThis.fetch=async(input,init={})=>{const url=String(input);if(url==="https://queue.fal.run/bytedance/seedance-2.0/reference-to-video"&&init.method==="POST"){submitted=JSON.parse(String(init.body));return Response.json({request_id:"fal-ambient-1",status:"IN_QUEUE"});}if(url.endsWith("/status?logs=1"))return Response.json({request_id:"fal-ambient-1",status:"COMPLETED"});if(url==="https://queue.fal.run/bytedance/seedance-2.0/requests/fal-ambient-1")return Response.json({video:{url:"https://v3b.fal.media/files/example/ambient.mp4",content_type:"video/mp4"}});if(url==="https://v3b.fal.media/files/example/ambient.mp4")return new Response(Uint8Array.from([0,1,2,3]),{headers:{"content-type":"video/mp4"}});throw new Error(`Unexpected request: ${url}`);};
  try{const prepared=[];await generateCreativeVideo({FAL_KEY:"test-only",FORMA_VIDEO_PROVIDER:"fal"},"A breeze moves through the trees.",{seconds:4,size:"1280x720",audioMode:"original_ambient",onPrepared:(receipt)=>prepared.push(receipt)});assert.equal(submitted.generate_audio,true);assert.equal(prepared[0].parameters.audio_mode,"original_ambient");assert.equal(prepared[0].parameters.audio_opt_in,true);assert.equal(prepared[0].parameters.audio_residual_risk,"provider-output-review");assert.match(submitted.prompt,/non-musical, non-melodic environmental ambience/i);}
  finally{globalThis.fetch=originalFetch;}
});

test("blocks unsupported authored music before staging references or submitting paid video",async()=>{
  const originalFetch=globalThis.fetch;let requested=false;globalThis.fetch=async()=>{requested=true;throw new Error("A provider request should not have been made.");};
  try{await assert.rejects(()=>generateCreativeVideo({FAL_KEY:"test-only",FORMA_VIDEO_PROVIDER:"fal"},"A cinematic image moves through the trees.",{seconds:4,size:"1280x720",audioMode:"original_ambient",snapshot:{facts:[{type:"audio",active:true,properties:{text:"An orchestral score and recognizable melody accompany the image."}}]}}),(error)=>{assert.equal(error.detail?.code,"video_audio_profile_unsupported");assert.equal(error.detail?.retryable,false);return true;});assert.equal(requested,false);}
  finally{globalThis.fetch=originalFetch;}
});

test("recovers an empty Fal submission body from its durable request header",async()=>{
  const originalFetch=globalThis.fetch;const calls=[];globalThis.fetch=async(input,init={})=>{calls.push({url:String(input),body:init.body});const call=calls.length;if(call===1)return new Response("",{status:200,headers:{"x-fal-request-id":"fal-header-1"}});if(call===2)return Response.json({request_id:"fal-header-1",status:"COMPLETED"});if(call===3)return Response.json({video:{url:"https://v3b.fal.media/files/example/header-video.mp4",content_type:"video/mp4"}});return new Response(Uint8Array.from([0,1,2,3]),{headers:{"content-type":"video/mp4"}});};
  try{const prepared=[];const result=await generateCreativeVideo({FAL_KEY:"test-only",FORMA_VIDEO_PROVIDER:"fal"},"A slow push through morning light.",{seconds:15,size:"1280x720",onPrepared:(receipt)=>prepared.push(receipt)});assert.equal(calls[0].url,"https://queue.fal.run/bytedance/seedance-2.0/reference-to-video");const submitted=JSON.parse(String(calls[0].body));assert.equal(submitted.resolution,"720p");assert.equal(submitted.duration,15);assert.match(submitted.prompt,/exactly 15 seconds/);assert.equal(prepared[0].parameters.adapter_status,"adopted");assert.equal(result.model,"bytedance/seedance-2.0/reference-to-video");assert.equal(result.providerJobId,"fal-header-1");}
  finally{globalThis.fetch=originalFetch;}
});

test("classifies an empty Fal submission without a request receipt instead of leaking a JSON parser error",async()=>{
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response("",{status:200});
  try{await assert.rejects(()=>generateCreativeVideo({FAL_KEY:"test-only",FORMA_VIDEO_PROVIDER:"fal"},"A slow push through morning light.",{seconds:4,size:"1280x720"}),(error)=>{assert.equal(error.detail?.code,"fal_submission_receipt_missing");assert.doesNotMatch(error.message,/Unexpected end of JSON input/);assert.match(error.message,/empty submission response/i);return true;});}
  finally{globalThis.fetch=originalFetch;}
});

test("replay laboratory semantically covers every document artifact",()=>{
  const events=buildComprehensiveScenario();const coverage=evaluateReplayCoverage(events,SCENARIO_EVENT_TYPES);const check=coverage.checks.find((item)=>item.key==="document-artifact-rendering");
  assert.equal(check?.passed,true);assert.equal(coverage.passed,true);
  assert.equal(coverage.checks.find((item)=>item.key==="output-as-input")?.passed,true);
  const repetitive=events.map((entry)=>entry.type!=="DocumentRenderCompleted"||entry.payload.artifact_kind!=="slides"?entry:{...entry,payload:{...entry.payload,items:entry.payload.items.map((item,index)=>index?item:{...item,body:'“Careful,” says the librarian. Then: “Show me what you found.”',slide:{...item.slide,bullets:['“Careful,” says the librarian\nThen: “Show me what you found']}})}});const repetitiveCoverage=evaluateReplayCoverage(repetitive,SCENARIO_EVENT_TYPES);
  assert.equal(repetitiveCoverage.checks.find((item)=>item.key==="document-artifact-rendering")?.passed,false);
  const repeatedAcrossSlides=events.map((entry)=>entry.type!=="DocumentRenderCompleted"||entry.payload.artifact_kind!=="slides"?entry:{...entry,payload:{...entry.payload,items:entry.payload.items.map((item,index,items)=>index===1?{...item,body:items[0].body}:item)}});const repeatedDeckCoverage=evaluateReplayCoverage(repeatedAcrossSlides,SCENARIO_EVENT_TYPES);
  assert.equal(repeatedDeckCoverage.checks.find((item)=>item.key==="document-artifact-rendering")?.passed,false);
});
