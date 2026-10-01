import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readShortStoryExecutionRequest } from "../worker/short-story-execution-policy.ts";
import { applySlideStylePreset, defaultSlidePresentation, documentArtifactValidationIssues, DOCUMENT_ARTIFACT_KINDS, normalizeSlideDeckItems, normalizeSlideItem, normalizeSlidePresentation, normalizeSlideVisual, parseDocumentArtifactContent, resolveDocumentArtifactContextGroups, SLIDE_LAYOUTS, SLIDE_STYLE_PRESETS, SLIDE_VISUAL_KINDS, slideCopyIsDistinct, slideCopyIsNearDuplicate, slideCopyIssues, slideDeckCopyIsDistinct, slideDeckCopyIssues, slidePrecisionIssues, slideSourceIds, slideVisualIsComplete } from "../src/model/document-artifacts.ts";
import { isVideoDurationSeconds, normalizeVideoDurationSeconds, VIDEO_ADAPTER_CONTRACT, VIDEO_DURATION_SECONDS } from "../src/model/video-adapter.ts";
import { buildPresentationSourceContract } from "../src/model/presentation-source.ts";
import { selectArtifactProductionKind } from "../src/model/managed-production.ts";
import { foldEvents } from "../src/model/events.ts";
import { buildComprehensiveScenario, SCENARIO_EVENT_TYPES } from "../src/model/scenarios.ts";
import { evaluateReplayCoverage } from "../src/model/replay-coverage.ts";
import { generateCreativeVideo, generateDocumentArtifact, prepareInitialShortStoryRequest, preparePresentationComparisonRequest, PRESENTATION_ADAPTER_VERSION } from "../worker/openai-adapter.ts";
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

test("validates incomplete and substantively repeated artifact content across every non-slide medium",()=>{
  for(const kind of DOCUMENT_ARTIFACT_KINDS.filter((value)=>value!=="slides")){
    const output=parseDocumentArtifactContent(JSON.stringify({
      title:"",
      summary:"A source-grounded creative result.",
      content_markdown:"# Authored creative result",
      items:[
        {title:"First movement",body:"Build the story once. Preserve each independently meaningful audience expression.",notes:"",image_prompt:""},
        {title:"Second movement",body:"Build the story once. Deliver the right expression to the right moment.",notes:"",image_prompt:""},
        {title:"Empty movement",body:"",notes:"",image_prompt:""},
      ],
    }));
    const issues=documentArtifactValidationIssues(kind,output,{itemCount:3});

    assert.ok(issues.some(({code,path})=>code==="missing_title"&&path==="title"),kind);
    assert.ok(issues.some(({code,path})=>code==="duplicate_artifact_content"&&path==="items.1.body"),kind);
    assert.ok(issues.some(({code,path})=>code==="missing_item_content"&&path==="items.2"),kind);
  }
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
  const item=content?.items[0];assert.ok(item?.slide);assert.equal(item.body,"");assert.equal(item.slide.kicker,"Overview");assert.deepEqual(item.slide.bullets,["A specific conflict"]);assert.equal(item.slide.visual.kind,"hero-type");assert.equal(item.slide.visual.value,"A Reluctant Ally");assert.equal(item.slide.visual.label,"");assert.deepEqual(item.slide.visual.data,[]);assert.equal(slideVisualIsComplete(item.slide),true);assert.doesNotMatch(JSON.stringify(item),/Point [23]|Visual emphasis/);
});

test("preserves authored visual labels without manufacturing audience-facing visual scaffolding",()=>{
  const hero=(label)=>normalizeSlideVisual({layout:"statement",kicker:"Authored context",visual:{kind:"hero-type",label,value:"A distinct source-grounded visual claim",data:[]}},{title:"An independently meaningful heading"});
  for(const label of ["","Visual emphasis","VISUAL EMPHASIS","Stakeholder perspective"]){
    const normalized=hero(label);
    assert.equal(normalized.visual.label,"",`the ${label||"missing"} label never becomes generated slide filler`);
    assert.equal(slideVisualIsComplete(normalized),true,"an independent label is optional when its authored visual is complete");
  }
  assert.equal(hero("Forma output families").visual.label,"Forma output families","a meaningful source-authored label remains untouched");
});

test("hero fallback preserves the exact source provenance of its promoted visual evidence",()=>{
  for(const kind of ["hero-type","timeline","color-field"]){
    const normalized=normalizeSlideVisual({layout:"statement",kicker:"Approved context",visual:{kind,label:"Visual evidence",value:"Duplicate heading",data:[{label:"Distinct source-authored evidence",value:"",source_ids:["blk_999"]}]}},{title:"Duplicate heading",body:""});
    assert.equal(normalized.visual.kind,"hero-type");
    assert.equal(normalized.visual.value,"Distinct source-authored evidence");
    assert.deepEqual(normalized.sourceIds,["blk_999"],`${kind} must never erase an unauthorized provider source alias during visual conversion`);
    assert.deepEqual(normalized.visual.data,[]);
  }
});

test("discarded rows, empty quotations, and competing source spellings never erase provider source provenance",()=>{
  for(const kind of ["architecture","bars","hero-type","metric","timeline","diagram","color-field"]){
    const normalized=normalizeSlideVisual({layout:"statement",sourceIds:["blk_001"],source_ids:["blk_002"],quote:{text:"",sourceId:"blk_003",source_id:"blk_004"},citations:[{sourceId:"blk_005",source_id:"blk_006"}],visual:{kind,label:"Approved evidence",value:"Distinct authorized finding",data:[{label:"",value:"",sourceIds:["blk_007"],source_ids:["blk_999"]}]}},{title:"Independent presentation heading",body:""});
    assert.deepEqual(new Set(normalized.sourceIds),new Set(["blk_001","blk_002","blk_003","blk_004","blk_005","blk_006","blk_007","blk_999"]),`${kind} must retain every raw source alias even after malformed evidence is removed`);
  }
});

test("an independently meaningful authored slide body repairs an empty nonquantitative hero verbatim",()=>{
  const body="Second approved evidence remains exactly source-faithful.";
  const normalized=normalizeSlideItem({title:"Distinct authored chapter",body,notes:"Preserve the original speaker notes.",image_prompt:"",slide:{layout:"statement",kicker:"Approved context",source_ids:["blk_001"],visual:{kind:"hero-type",label:"Approved evidence",value:"Distinct authored chapter",data:[]}}},1);
  assert.equal(normalized.body,"");
  assert.equal(normalized.slide?.visual.value,body);
  assert.deepEqual(normalized.slide?.sourceIds,["blk_001"]);
  assert.equal(normalized.notes,"Preserve the original speaker notes.");
  assert.equal(slideVisualIsComplete(normalized.slide),true);
});

test("quotation continuation preserves source provenance instead of authenticating unattributed fragments",()=>{
  const normalized=normalizeSlideVisual({layout:"statement",kicker:"Interview",visual:{kind:"hero-type",label:"Product owner",value:"The governed release",data:[{label:"Continuation",value:"must preserve every source decision.",source_ids:["blk_999"]}]}},{title:"Stakeholder confidence",body:""});
  assert.equal(normalized.visual.kind,"quote");
  assert.deepEqual(normalized.sourceIds,["blk_999"]);
});

test("incomplete hero visuals report their missing authored value instead of an irrelevant two-row requirement",()=>{
  const output=parseDocumentArtifactContent(JSON.stringify({title:"Deck",summary:"Source-grounded presentation",content_markdown:"# Deck",presentation,items:[{title:"Repeated heading",body:"",notes:"",image_prompt:"",slide:{layout:"statement",kicker:"Distinct context",visual:{kind:"hero-type",label:"Visual emphasis",value:"Repeated heading",data:[]}}}]}));
  const issue=documentArtifactValidationIssues("slides",output,{itemCount:1}).find((candidate)=>candidate.code==="incomplete_visual");
  assert.ok(issue);
  assert.equal(issue.path,"items.0.slide.visual");
  assert.match(issue.message,/meaningful.*source-authored visual value/u);
  assert.doesNotMatch(issue.message,/two|points|rows/u);
});

test("retains meaningful label-only qualitative visuals while quantitative scorecards remain strict",()=>{
  for(const kind of ["comparison","personas","roadmap","timeline"]){
    const visual=normalizeSlideVisual({layout:kind==="timeline"?"timeline":kind,kicker:"Source evidence",bullets:[],visual:{kind,label:"Authored categories",value:"",data:[{label:"Phone",value:"",weight:1},{label:"Tablet",value:"",weight:1}]}},{title:"Distinct executive claim"});
    assert.equal(visual.visual.data.length,2,`${kind} keeps meaningful authored category labels`);
    assert.equal(slideVisualIsComplete(visual),true,`${kind} does not invent unsupported qualitative values`);
  }
  for(const kind of ["scorecard","bars","matrix"]){
    const visual=normalizeSlideVisual({layout:kind==="bars"?"scorecard":kind,kicker:"Quantitative evidence",bullets:[],visual:{kind,label:"Measured categories",value:"",data:[{label:"Phone",value:"",weight:1},{label:"Tablet",value:"",weight:1}]}},{title:"Measured executive claim"});
    assert.equal(slideVisualIsComplete(visual),false,`${kind} never accepts missing protected values`);
  }
  const alternate=normalizeSlideVisual({layout:"scorecard",kicker:"Evidence",bullets:[],visual:{kind:"scorecard",label:"Assessment",value:"",data:[{label:"Phone",value:"",display_value:"39.75",weight:.1},{label:"Tablet",value:"",exact_value:"53.00",weight:.2}]}},{title:"Distinct source scores"});
  assert.deepEqual(alternate.visual.data.map(({value})=>value),["39.75","53.00"],"authored exact/display values are recovered without inventing or dropping facts");
});

test("reclassifies prose-only scorecards as honest readable qualitative comparisons",()=>{
  const prose=[{label:"Project context",value:"Durable shared project context",weight:1/6},{label:"Exports",value:"Editable PPTX/DOCX with slide speaker notes; PDF exports",weight:1/6},{label:"Controls",value:"Output revisions, organization retention and spending controls",weight:1/6}];
  const qualitative=normalizeSlideVisual({layout:"scorecard",kicker:"Authored product assets",bullets:[],visual:{kind:"scorecard",label:"Existing foundation",value:"",data:prose}},{title:"Proven assets"});
  assert.equal(qualitative.layout,"comparison");
  assert.equal(qualitative.visual.kind,"comparison");
  assert.deepEqual(qualitative.visual.data.map(({label,value})=>({label,value})),prose.map(({label,value})=>({label,value})));
  const protectedScores=normalizeSlideVisual({layout:"scorecard",kicker:"Protected assessment",bullets:[],visual:{kind:"scorecard",label:"Six measured dimensions",value:"",unit:"/100",exact_value:"61.125",display_value:"61.13",data:[{label:"Phone",value:"39.75",weight:.3975},{label:"Tablet",value:"53.00",weight:.53}]}},{title:"Product gap"});
  assert.equal(protectedScores.layout,"scorecard");
  assert.equal(protectedScores.visual.kind,"scorecard");
});

test("repairs echoed category-only proposal rows locally without inventing evidence",()=>{
  const labels=["authorized evidence","affected resources","expected revision","approval requirements","cost when relevant"];
  const rows=[{label:"proposed action",value:"Prepare an evidence-backed proposal",weight:.9,source_ids:["blk_001"]},...labels.map((label)=>({label,value:label,weight:.8,source_ids:["blk_001"]}))];
  const item={title:"Proposals Before Changes",body:"Users selectively approve, edit, reject, or undo each proposed action.",notes:"Simple questions never change durable context.",image_prompt:"An editable proposal architecture.",context_group_ids:["group-proposal"],slide:{layout:"matrix",kicker:"Actionable approval",bullets:[],citations:[{source_id:"blk_001",label:"Authorized proposal evidence",anchor:"Slide 6",excerpt:"authorized evidence"}],source_ids:["blk_001"],visual:{kind:"matrix",label:"Proposal ingredients",value:"",data:rows}}};
  const output=parseDocumentArtifactContent(JSON.stringify({title:"Executive plan",summary:"A source-grounded proposal experience.",content_markdown:"# Executive plan",presentation,items:[item]}));
  const normalized=output?.items[0];
  assert.ok(normalized?.slide);
  assert.equal(normalized.slide.layout,"architecture");
  assert.equal(normalized.slide.visual.kind,"architecture");
  assert.deepEqual(normalized.slide.visual.data.map(({label})=>label),rows.map(({label})=>label));
  assert.deepEqual(normalized.slide.visual.data.map(({value})=>value),["Prepare an evidence-backed proposal","","","","",""]);
  assert.deepEqual(normalized.slide.visual.data.map(({sourceIds})=>sourceIds),rows.map(()=>["blk_001"]));
  assert.deepEqual(normalized.slide.visual.data.map(({weight})=>weight),rows.map(({weight})=>weight));
  assert.equal(normalized.slide.citations?.[0]?.sourceId,"blk_001");
  assert.equal(normalized.notes,item.notes);
  assert.deepEqual(slideCopyIssues(normalized),[]);
  assert.deepEqual(documentArtifactValidationIssues("slides",output,{itemCount:1,contextGroupIds:["group-proposal"]}),[]);
});

test("repairs repeated authored title and question values without dropping their source-backed rows",()=>{
  const title="The Context Company",body="Can it end file types?";
  const rows=[{label:"Title",value:title,weight:.9,source_ids:["blk_001"]},{label:"Question",value:body,weight:.8,source_ids:["blk_002"]}];
  const item={title,body,notes:"Keep both authored claims.",image_prompt:"An editable authored proposition.",context_group_ids:["group-opening"],slide:{layout:"comparison",kicker:"Opening proposition",source_ids:["blk_001","blk_002"],visual:{kind:"comparison",label:"Opening concepts",value:"",data:rows}}};
  const output=parseDocumentArtifactContent(JSON.stringify({title:"Deck",summary:"An authored opening.",content_markdown:`# ${title}\n${body}`,presentation,items:[item]}));
  const normalized=output?.items[0];
  assert.ok(normalized?.slide);
  assert.equal(normalized.title,title);
  assert.equal(normalized.body,body);
  assert.equal(normalized.slide.layout,"architecture");
  assert.equal(normalized.slide.visual.kind,"architecture");
  assert.deepEqual(normalized.slide.visual.data.map(({label,value,sourceIds})=>({label,value,sourceIds})),[{label:"Title",value:"",sourceIds:["blk_001"]},{label:"Question",value:"",sourceIds:["blk_002"]}]);
  assert.deepEqual(normalized.slide.sourceIds,["blk_001","blk_002"]);
  assert.deepEqual(normalized.context_group_ids,["group-opening"]);
  assert.deepEqual(slideCopyIssues(normalized),[]);
  assert.deepEqual(documentArtifactValidationIssues("slides",output,{itemCount:1,contextGroupIds:["group-opening"]}),[]);
});

test("condenses title-and-question diagrams while retaining every original source reference",()=>{
  const title="The Context Company",body="Can it end file types?";
  const rows=[{label:title,value:title,weight:1,source_ids:["blk_001"]},{label:body,value:body,weight:.8,source_ids:["blk_999"]}];
  const item={title,body,notes:"Keep both source references available for authorization.",image_prompt:"An authored opening.",context_group_ids:["group-opening"],slide:{layout:"architecture",kicker:"Opening proposition",source_ids:["blk_001"],visual:{kind:"architecture",label:"Opening concepts",value:"",data:rows}}};
  const output=parseDocumentArtifactContent(JSON.stringify({title:"Deck",summary:"An authored opening.",content_markdown:`# ${title}\n${body}`,presentation,items:[item]}));
  const normalized=output?.items[0];
  assert.ok(normalized?.slide);
  assert.equal(normalized.title,title);
  assert.equal(normalized.body,"");
  assert.equal(normalized.slide.layout,"cover");
  assert.equal(normalized.slide.visual.kind,"hero-type");
  assert.equal(normalized.slide.visual.value,body);
  assert.deepEqual(normalized.slide.visual.data,[]);
  assert.deepEqual(normalized.slide.sourceIds,["blk_001","blk_999"],"normalization must not erase an unauthorized provider source reference");
  assert.deepEqual(normalized.context_group_ids,["group-opening"]);
  assert.deepEqual(slideCopyIssues(normalized),[]);
  assert.equal(slideVisualIsComplete(normalized.slide),true);
});

test("never treats measured evidence, real comparisons, or ordered roadmaps as category filler",()=>{
  const base=(kind,data,additional={})=>normalizeSlideVisual({layout:kind,kicker:"Source-grounded evidence",bullets:[],visual:{kind,label:"Authored visual",value:"",data,...additional}},{title:"Independent executive decision"});
  for(const kind of ["comparison","matrix","personas","architecture"]){
    const normalized=base(kind,[{label:"Authorized evidence",value:"Authorized evidence",weight:.8},{label:"Affected resources",value:"Affected resources",weight:.7}]);
    assert.equal(normalized.visual.kind,"architecture",`${kind} becomes an architecture diagram`);
    assert.deepEqual(normalized.visual.data.map(({value})=>value),["",""]);
  }
  const meaningful=base("comparison",[{label:"Phone",value:"One exact next action",weight:.8},{label:"Tablet",value:"Two useful panes",weight:.7}]);
  assert.equal(meaningful.visual.kind,"comparison");
  assert.deepEqual(meaningful.visual.data.map(({value})=>value),["One exact next action","Two useful panes"]);
  const quantitative=base("scorecard",[{label:"39.75",value:"39.75",exact_value:"39.75",weight:.3975},{label:"53.00",value:"53.00",exact_value:"53.00",weight:.53}],{unit:"/100"});
  assert.equal(quantitative.visual.kind,"scorecard");
  assert.deepEqual(quantitative.visual.data.map(({value})=>value),["39.75","53.00"]);
  for(const kind of ["roadmap","timeline"]){
    const ordered=base(kind,[{label:"Foundation",value:"Foundation",weight:.8},{label:"Release",value:"Release",weight:.7}]);
    assert.equal(ordered.visual.kind,kind,`${kind} preserves ordered source semantics`);
  }
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

test("detects repeated substantial sentence lead-ins even when their remaining claims differ",()=>{
  const first="Build the story once. Carry the creative foundation across every medium.";
  const second="Build the story once. Deliver the right expression to each audience.";
  assert.equal(slideCopyIsNearDuplicate(first,second),true,"a repeated opening sentence is visible duplication despite divergent continuations");
  assert.equal(slideCopyIsNearDuplicate("Build the story once",second),true,"an unpunctuated heading still duplicates the sentence opening");
  assert.equal(slideCopyIsNearDuplicate("For the team. Establish a shared starting point.","For the team. Preserve each independent decision."),false,"short generic transitions do not become false-positive duplicate prose");

  const duplicated={title:first,body:second,notes:"Keep both independent claims.",image_prompt:"",slide:{layout:"statement",kicker:"Distinct invitation",bullets:["Build the story once. Meet people where they already are."],visual:{kind:"hero-type",label:"Authored direction",value:"An independently meaningful visual claim",data:[]}}};
  const rawIssues=slideCopyIssues(duplicated);
  assert.equal(rawIssues.some((issue)=>issue.firstPath==="title"&&issue.secondPath==="body"),true);
  assert.equal(rawIssues.some((issue)=>issue.firstPath==="title"&&issue.secondPath==="slide.bullets.0"),true);

  const normalized=normalizeSlideItem(duplicated);
  assert.equal(normalized.title,first);
  assert.equal(normalized.body,"Deliver the right expression to each audience.","deterministic repair retains independently meaningful body copy");
  assert.deepEqual(normalized.slide?.bullets,["Meet people where they already are."],"deterministic repair keeps each independently meaningful bullet");
  assert.deepEqual(slideCopyIssues(normalized),[],"repaired visible fields contain the shared opening exactly once");
});

test("preserves repeated source-authored status values across independently labeled visual rows",()=>{
  const data=[
    {label:"Lost conversation turns",value:"zero",weight:1},
    {label:"Unauthorized actions",value:"zero",weight:1},
    {label:"Identity enforcement",value:"on track",weight:1},
    {label:"Deletion safeguards",value:"on track",weight:1},
    {label:"Invalid access grants",value:"none",weight:1},
    {label:"Unapproved provider charges",value:"none",weight:1},
  ];
  const item={title:"Independent release readiness",body:"Every safety boundary remains independently measurable.",notes:"Preserve the exact authored values.",image_prompt:"Editable release-readiness matrix.",context_group_ids:[],slide:{layout:"matrix",kicker:"Measured controls",bullets:[],visual:{kind:"matrix",label:"Production acceptance criteria",value:"",data}}};
  const output=parseDocumentArtifactContent(JSON.stringify({title:"Executive release plan",summary:"Every acceptance criterion remains faithfully represented.",content_markdown:"# Executive release plan",presentation,items:[item]}));
  assert.deepEqual(output?.items[0]?.slide?.visual.data.map(({label,value})=>({label,value})),data.map(({label,value})=>({label,value})));
  assert.deepEqual(slideCopyIssues(output?.items[0]),[]);
  assert.deepEqual(documentArtifactValidationIssues("slides",output,{itemCount:1}),[]);

  const duplicatedRows={...item,slide:{...item.slide,visual:{...item.slide.visual,data:[data[0],{...data[0]}]}}};
  assert.equal(slideCopyIssues(duplicatedRows).some((issue)=>issue.firstPath.endsWith(".label")&&issue.secondPath.endsWith(".label")),true,"identical data rows remain duplicated");
  assert.equal(slideCopyIssues(duplicatedRows).some((issue)=>issue.firstPath.endsWith(".value")&&issue.secondPath.endsWith(".value")),true,"identical labels do not excuse repeated row values");

  const repeatedExplanation="Every customer control remains continuously verified";
  const duplicatedDescriptions={...item,slide:{...item.slide,visual:{...item.slide.visual,data:[{label:"Identity enforcement",value:repeatedExplanation,weight:1},{label:"Deletion safeguards",value:repeatedExplanation,weight:1}]}}};
  assert.equal(slideCopyIssues(duplicatedDescriptions).some((issue)=>issue.firstPath.endsWith(".value")&&issue.secondPath.endsWith(".value")),true,"substantive duplicated narrative is still rejected");

  const duplicatedProse={...item,body:"A repeated executive claim",slide:{...item.slide,bullets:["A repeated executive claim"]}};
  assert.equal(slideCopyIssues(duplicatedProse).some((issue)=>issue.firstPath==="body"&&issue.secondPath==="slide.bullets.0"),true,"ordinary narrative duplication remains rejected");
});

test("preserves short independently labeled factual statuses across different slides",()=>{
  const slide=(title,rows)=>({title,body:"",notes:"Preserve every source-authored status.",image_prompt:"",context_group_ids:[],slide:{layout:"matrix",kicker:`Evidence for ${title}`,bullets:[],visual:{kind:"matrix",label:`${title} controls`,value:"",data:rows.map(([label,value])=>({label,value,weight:1}))}}});
  const slides=[slide("Approval readiness",[["Reviewer approvals","not implemented"],["Identity controls","fully compliant"]]),slide("Privacy readiness",[["Erasure workflow","not implemented"],["Retention policy","fully compliant"]])];
  assert.deepEqual(slideDeckCopyIssues(slides),[],"independent source-backed controls can truthfully share short status values");
  const output=parseDocumentArtifactContent(JSON.stringify({title:"Governed readiness",summary:"Preserve each independent control.",content_markdown:"# Governed readiness",presentation,items:slides}));
  assert.deepEqual(documentArtifactValidationIssues("slides",output,{itemCount:2}),[]);

  const sameLabel=[slides[0],slide("A repeated control",[["Reviewer approvals","not implemented"],["Separate evidence","fully compliant"]])];
  assert.equal(slideDeckCopyIssues(sameLabel).some((issue)=>issue.firstPath.endsWith(".value")&&issue.secondPath.endsWith(".value")),true,"repeated status for the same category is still visible as duplication");
  const repeatedNarrative="Every customer control remains continuously verified";
  const longNarrative=[slide("Governance",[["Reviewer approvals",repeatedNarrative],["Identity controls","fully compliant"]]),slide("Privacy",[["Erasure workflow",repeatedNarrative],["Retention policy","fully compliant"]])];
  assert.equal(slideDeckCopyIssues(longNarrative).some((issue)=>issue.firstPath.endsWith(".value")&&issue.secondPath.endsWith(".value")),true,"substantive copied prose remains rejected");
});

test("preserves recurring legacy-format evidence only when each numbered source independently authorizes it",()=>{
  const sourceId="authorized-pitch-context-feedback";
  const sourceText=[
    "Slide 1 — One context, infinite paths",
    "Forma replaces fragmented .doc, .ppt, .mov, .mp3, and .psd handoffs with one living context.",
    "Slide 2 — Context management",
    "Collect each useful decision.",
    "Slide 3 — Medium adaptation",
    "Choose an appropriate medium.",
    "Slide 4 — Message fidelity",
    "Preserve the authored message.",
    "Slide 5 — Delivery and trust",
    "Visual storyboard beats: scattered .doc/.ppt/.mov/.mp3/.psd files; one unified creative context.",
    "Slide 6 — Confident next step",
    "Give people meaningful review.",
  ].join("\n");
  const snapshot=(content=sourceText)=>({facts:[{block_id:sourceId,type:"direction",properties:{text:content}}],relationships:[]});
  const sourceContract=buildPresentationSourceContract(snapshot(),{requestedSlideCount:6,itemCount:6});
  const claims=["Independent opening","Gathered decisions","Appropriate delivery","Protected authorship","Delivery and trust","Meaningful review"];
  const makeOutput=(rowValue)=>parseDocumentArtifactContent(JSON.stringify({
    title:"Pitch context feedback",
    summary:"A faithful end-user evaluation.",
    content_markdown:"# Pitch context feedback",
    presentation,
    items:claims.map((claim,index)=>({
      title:claim,
      body:"",
      notes:"Retain the independently authored source.",
      image_prompt:"Source-grounded editable evidence.",
      context_group_ids:[],
      slide:{
        layout:index===4?"timeline":index===0?"cover":"statement",
        kicker:`Evidence ${index+1}`,
        bullets:[],
        source_ids:[sourceId],
        source_order:index+1,
        visual:index===4
          ?{kind:"timeline",label:"The delivery journey",value:"",data:[
            {label:"Fragmented handoffs",value:rowValue,weight:1,source_ids:[sourceId]},
            {label:"Unified Forma context",value:"one unified creative context",weight:.8,source_ids:[sourceId]},
          ]}
          :{kind:"hero-type",label:"Authored emphasis",value:index===0?".doc · .ppt · .mov · .mp3 · .psd":["unused","Collect useful choices","Select the right medium","Keep the message intact","unused","Support human oversight"][index],data:[]},
      },
    })),
  }));

  for(const rowValue of [".doc/.ppt/.mov/.mp3/.psd","scattered .doc/.ppt/.mov/.mp3/.psd files"]){
    const output=makeOutput(rowValue);
    assert.ok(output);
    assert.equal(slideDeckCopyIssues(output.items).some((issue)=>issue.secondSlide===4&&issue.secondPath==="slide.visual.data.0.value"),true,"the ungrounded generic comparator remains strict");
    assert.equal(documentArtifactValidationIssues("slides",output,{itemCount:6}).some((issue)=>issue.path==="items.4.slide.visual.data.0.value"),true,"no exemption exists without an independently authored source contract");
    assert.deepEqual(documentArtifactValidationIssues("slides",output,{itemCount:6,sourceContract}),[]);
    assert.equal(output.items[4]?.slide?.visual.data[0]?.value,rowValue,"the exact authored evidence must never be removed or rewritten");
    assert.deepEqual(output.items[4]?.slide?.visual.data[0]?.sourceIds,[sourceId]);
  }

  const ungroundedContract=buildPresentationSourceContract(snapshot(sourceText.replace("scattered .doc/.ppt/.mov/.mp3/.psd files","an unrelated authored delivery milestone")),{requestedSlideCount:6,itemCount:6});
  const ungrounded=makeOutput("scattered .doc/.ppt/.mov/.mp3/.psd files");
  assert.equal(documentArtifactValidationIssues("slides",ungrounded,{itemCount:6,sourceContract:ungroundedContract}).some((issue)=>issue.path==="items.4.slide.visual.data.0.value"),true,"another source section cannot authorize an invented row");

  const unauthorized=makeOutput("scattered .doc/.ppt/.mov/.mp3/.psd files");
  unauthorized.items[4].slide.visual.data[0].sourceIds=["unauthorized-private-source"];
  const unauthorizedIssues=documentArtifactValidationIssues("slides",unauthorized,{itemCount:6,sourceContract});
  assert.equal(unauthorizedIssues.some((issue)=>issue.code==="duplicate_deck_copy"&&issue.path==="items.4.slide.visual.data.0.value"),true);
  assert.equal(unauthorizedIssues.some((issue)=>issue.code==="incorrect_visual_source"),true,"cosmetic recurrence never authenticates a foreign source");
});

test("preserves an exact authored opening promise only on its independently authored final slide",()=>{
  const sourceId="authorized-opening-and-closing-promise";
  const promise="Your content. One context. Infinite paths to your target.";
  const sourceText=Array.from({length:9},(_,index)=>index===0?`Slide 1 — ${promise}\nOpen with the exact authored promise.`:index===8?`Slide 9 — Confident delivery\nClose with the exact promise: ${promise}`:`Slide ${index+1} — Independently authored chapter ${index+1}\nAdvance the distinct customer argument ${index+1}.`).join("\n");
  const sourceContract=buildPresentationSourceContract({facts:[{block_id:sourceId,type:"direction",properties:{text:sourceText}}],relationships:[]},{requestedSlideCount:9,itemCount:9});
  const output=parseDocumentArtifactContent(JSON.stringify({title:"Pitch context",summary:"The opening promise resolves in the close.",content_markdown:"# Pitch context",presentation,items:Array.from({length:9},(_,index)=>({title:index===0?promise:index===8?"Confident delivery":`Authored chapter ${index+1}`,body:index===8?promise:"",notes:"Keep the exact source-authored argument.",image_prompt:"Source-grounded creative direction.",context_group_ids:[],slide:{layout:index===0?"cover":index===8?"closing":"statement",kicker:`Decision ${index+1}`,bullets:[],source_ids:[sourceId],source_order:index+1,visual:{kind:"hero-type",label:"Independent emphasis",value:["Shared creative beginning","Gather meaningful context","Choose the medium","Adapt each expression","Respect individual attention","Keep durable decisions","Follow relevant paths","Protect human control","Reach the intended audience"][index],data:[]}}}))}));
  assert.ok(output);
  assert.equal(documentArtifactValidationIssues("slides",output,{itemCount:9}).some((issue)=>issue.path==="items.8.body"),true);
  assert.deepEqual(documentArtifactValidationIssues("slides",output,{itemCount:9,sourceContract}),[]);
  assert.equal(output.items[0].title,promise);
  assert.equal(output.items[8].body,promise);

  const intermediate=structuredClone(output);
  intermediate.items[4].body=promise;
  const intermediateSource=sourceText.replace("Advance the distinct customer argument 5.",`Advance the distinct customer argument 5. ${promise}`);
  const intermediateContract=buildPresentationSourceContract({facts:[{block_id:sourceId,type:"direction",properties:{text:intermediateSource}}],relationships:[]},{requestedSlideCount:9,itemCount:9});
  assert.equal(documentArtifactValidationIssues("slides",intermediate,{itemCount:9,sourceContract:intermediateContract}).some((issue)=>issue.path==="items.4.body"),true,"an intermediate echo is not an opening-to-closing promise");

  const repeatedTitle=structuredClone(output);
  repeatedTitle.items[8].title=promise;
  repeatedTitle.items[8].body="";
  assert.equal(documentArtifactValidationIssues("slides",repeatedTitle,{itemCount:9,sourceContract}).some((issue)=>issue.path==="items.8.title"),true,"repeated slide titles remain invalid even when their words are authored");

  const ungroundedText=sourceText.replace(`Close with the exact promise: ${promise}`,"Close with a distinct authored recommendation.");
  const ungroundedContract=buildPresentationSourceContract({facts:[{block_id:sourceId,type:"direction",properties:{text:ungroundedText}}],relationships:[]},{requestedSlideCount:9,itemCount:9});
  assert.equal(documentArtifactValidationIssues("slides",output,{itemCount:9,sourceContract:ungroundedContract}).some((issue)=>issue.path==="items.8.body"),true,"the opening source cannot authorize an unauthored closing claim");
});

test("preserves concise authored visual row labels inside independently meaningful slide body copy",()=>{
  const data=[
    {label:"Decision decomposition",value:"atomic",weight:1},
    {label:"Private conversations",value:"restricted",weight:1},
    {label:"Specialist permissions",value:"scoped",weight:1},
    {label:"Event-derived projections",value:"deterministic",weight:1},
    {label:"Output orchestration",value:"coordinated",weight:1},
  ];
  const item={title:"Independent delivery controls",body:"Decision decomposition establishes accountable boundaries while private conversations remain protected, specialist permissions constrain access, event-derived projections reconstruct state, and output orchestration coordinates every release.",notes:"Preserve every authored category and its supporting argument.",image_prompt:"Editable operational-control matrix.",context_group_ids:[],slide:{layout:"matrix",kicker:"Governed source evidence",bullets:[],visual:{kind:"matrix",label:"Operational control categories",value:"",data}}};
  const output=parseDocumentArtifactContent(JSON.stringify({title:"Executive release plan",summary:"Every authored category supports a distinct delivery control.",content_markdown:"# Executive release plan",presentation,items:[item]}));

  assert.deepEqual(slideCopyIssues(output?.items[0]),[],"concise source categories remain useful in both the authored argument and its structured visual");
  assert.deepEqual(documentArtifactValidationIssues("slides",output,{itemCount:1}),[]);
  assert.deepEqual(output?.items[0]?.slide?.visual.data.map(({label})=>label),data.map(({label})=>label));

  const exactEcho={...item,body:data[0].label};
  assert.equal(slideCopyIssues(exactEcho).some((issue)=>issue.firstPath==="body"&&issue.secondPath==="slide.visual.data.0.label"),true,"a body that only echoes its row label remains duplicated");

  const noIndependentClaim={...item,body:`The ${data[0].label} first`};
  assert.equal(slideCopyIssues(noIndependentClaim).some((issue)=>issue.firstPath==="body"&&issue.secondPath==="slide.visual.data.0.label"),true,"one extra token does not turn a repeated label into an independently meaningful argument");

  const partialWord={...item,body:"Decision decompositions establish independently accountable delivery boundaries."};
  assert.equal(slideCopyIssues(partialWord).some((issue)=>issue.firstPath==="body"&&issue.secondPath==="slide.visual.data.0.label"),true,"partial-word overlaps never qualify as an authored category phrase");

  const duplicatedRows={...item,slide:{...item.slide,visual:{...item.slide.visual,data:[data[0],{...data[0],value:"different"}]}}};
  assert.equal(slideCopyIssues(duplicatedRows).some((issue)=>issue.firstPath.endsWith(".label")&&issue.secondPath.endsWith(".label")),true,"identical visual categories remain duplicated");

  const narrativeLabel="Decision decomposition requires independent review and authorized approval";
  const duplicatedNarrative={...item,body:`${narrativeLabel} before every production release can proceed safely.`,slide:{...item.slide,visual:{...item.slide.visual,data:[{...data[0],label:narrativeLabel},data[1]]}}};
  assert.equal(slideCopyIssues(duplicatedNarrative).some((issue)=>issue.firstPath==="body"&&issue.secondPath==="slide.visual.data.0.label"),true,"substantive narrative row labels cannot duplicate the slide argument");

  const echoedBullet={...item,slide:{...item.slide,bullets:[item.body]}};
  assert.equal(slideCopyIssues(echoedBullet).some((issue)=>issue.firstPath==="body"&&issue.secondPath==="slide.bullets.0"),true,"ordinary narrative duplication remains rejected");

  const echoedValue={...item,slide:{...item.slide,visual:{...item.slide.visual,data:[{...data[0],value:item.body},data[1]]}}};
  assert.equal(slideCopyIssues(echoedValue).some((issue)=>issue.firstPath==="body"&&issue.secondPath==="slide.visual.data.0.value"),true,"substantive repeated visual values remain rejected");

  const independentHeading={...item,title:"Decision decomposition preserves independently scoped authority"};
  assert.equal(slideCopyIssues(independentHeading).some((issue)=>issue.firstPath==="title"&&issue.secondPath==="slide.visual.data.0.label"),false,"an independently meaningful authored heading may name one of its source-backed categories");
  const echoedHeading={...item,title:data[0].label};
  assert.equal(slideCopyIssues(echoedHeading).some((issue)=>issue.firstPath==="title"&&issue.secondPath==="slide.visual.data.0.label"),true,"a heading that only repeats its category remains duplicated");
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

test("retains all six protected assessment values and their exact-versus-display precision",()=>{
  const scores=[
    ["Phone","39.75"],
    ["Tablet","53.00"],
    ["Small monitor","67.25"],
    ["Large monitor","68.50"],
    ["Adaptive/accessibility","58.75"],
    ["Governed creative loop","79.50"],
  ];
  const item={title:"A complete responsive assessment",body:"Six equally weighted product dimensions.",notes:"The exact equal-weight average is 61.125; the rounded display value is 61.13.",image_prompt:"An editable six-row scorecard.",context_group_ids:[],slide:{layout:"scorecard",kicker:"Current baseline",source_ids:["blk_001"],section:"Assessment",source_order:3,citations:[{source_id:"blk_001",label:"Responsive product assessment",anchor:"§ 3",excerpt:"Phone: 39.75; Tablet: 53.00; Small monitor: 67.25; Large monitor: 68.50; Adaptive/accessibility: 58.75; Governed creative loop: 79.50."}],visual:{kind:"scorecard",label:"Assessment by device and capability",value:"61.13",exact_value:"61.125",display_value:"61.13",unit:"/ 100",data:scores.map(([label,value],index)=>({label,value,weight:Number(value)/100,exact_value:value,display_value:value,source_ids:[`clm_${String(index+1).padStart(3,"0")}`]}))}}};
  const output=parseDocumentArtifactContent(JSON.stringify({title:"Responsive strategy",summary:"A complete scorecard.",content_markdown:"The exact average is 61.125; the displayed average is 61.13.",presentation,items:[item]}));
  const slide=output?.items[0]?.slide;assert.ok(slide);assert.deepEqual(slide.visual.data.map(({label,value})=>[label,value]),scores);assert.equal(slide.visual.exactValue,"61.125");assert.equal(slide.visual.displayValue,"61.13");assert.equal(slide.visual.unit,"/ 100");assert.equal(slide.visual.data[1]?.value,"53.00");assert.equal(slide.section,"Assessment");assert.equal(slide.sourceOrder,3);assert.equal(slide.citations?.[0]?.anchor,"§ 3");assert.deepEqual(slideSourceIds(slide),["blk_001","clm_001","clm_002","clm_003","clm_004","clm_005","clm_006"]);assert.equal(slideVisualIsComplete(slide),true);assert.deepEqual(slidePrecisionIssues(slide),[]);assert.deepEqual(documentArtifactValidationIssues("slides",output,{itemCount:1}),[]);
  const reversed=normalizeSlideVisual({...item.slide,visual:{...item.slide.visual,exact_value:"61.13",display_value:"61.125"}},{title:item.title,body:item.body});assert.equal(slidePrecisionIssues(reversed).some((issue)=>issue.code==="reversed_precision_labels"),true);
  const dropped=normalizeSlideVisual({...item.slide,visual:{...item.slide.visual,data:item.slide.visual.data.slice(0,5)}},{title:item.title,body:item.body});assert.equal(slidePrecisionIssues(dropped).some((issue)=>issue.code==="inconsistent_scorecard_average"),true);
});

test("preserves complete attributed stakeholder quotations and inspectable source evidence",()=>{
  const stakeholderQuote="The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable, reviewable, and reusable across devices.";
  assert.ok(stakeholderQuote.length>120);
  const item={title:"Governance is the real differentiator",body:"",notes:`Product Owner: “${stakeholderQuote}”`,image_prompt:"An attributed stakeholder quotation.",context_group_ids:[],slide:{layout:"quote",kicker:"Product owner perspective",quote:{text:stakeholderQuote,speaker:"Product Owner",role:"Product Owner",source_id:"blk_004",citation:"Executive opportunity · stakeholder evidence"},citations:[{source_id:"blk_004",label:"Executive opportunity",anchor:"Stakeholder interview 4",excerpt:stakeholderQuote}],source_ids:["blk_004"],visual:{kind:"quote",label:"Why this matters",value:stakeholderQuote.slice(0,120),data:[]}}};
  const output=parseDocumentArtifactContent(JSON.stringify({title:"Stakeholder evidence",summary:"A complete protected quotation.",content_markdown:`> ${stakeholderQuote}\n> — Product Owner`,presentation,items:[item]}));
  const slide=output?.items[0]?.slide;assert.ok(slide);assert.equal(slide.quote?.text,stakeholderQuote);assert.equal(slide.quote?.speaker,"Product Owner");assert.equal(slide.quote?.role,"Product Owner");assert.equal(slide.quote?.citation,"Executive opportunity · stakeholder evidence");assert.equal(slide.visual.value,stakeholderQuote);assert.equal(slide.citations?.[0]?.excerpt,stakeholderQuote);assert.deepEqual(slideSourceIds(slide),["blk_004"]);assert.equal(slideVisualIsComplete(slide),true);assert.deepEqual(documentArtifactValidationIssues("slides",output,{itemCount:1}),[]);
  for(const semantic of ["quote","scorecard","comparison","matrix","architecture","personas","roadmap"]){assert.equal(SLIDE_LAYOUTS.includes(semantic),true,semantic);assert.equal(SLIDE_VISUAL_KINDS.includes(semantic),true,semantic);}
});

test("preserves Markdown and notes for protected quotations delivered in structured data rows",()=>{
  const quote="Every artifact must remain traceable, editable, reviewable, and reusable across devices.";
  const sourceContract=buildPresentationSourceContract({facts:[{block_id:"quote-source",active:true,properties:{label:"Stakeholder evidence",text:`Slide 1 — Product evidence\n“${quote}” — Product Owner`}}]},{requestedSlideCount:1});
  assert.equal(sourceContract.protectedQuotes.length,1);
  const output=parseDocumentArtifactContent(JSON.stringify({title:"Product evidence",summary:"An attributed comparison.",content_markdown:"# Product evidence",presentation,items:[{
    title:"A durable creative workflow",body:"",notes:"",image_prompt:"",context_group_ids:[],
    slide:{layout:"comparison",kicker:"Stakeholder perspective",source_ids:["quote-source"],visual:{kind:"comparison",label:"Evidence and consequence",value:"",data:[
      {label:"Customer expectation",value:`“${quote}” — Product Owner`,weight:1},
      {label:"Product consequence",value:"Keep authored decisions connected to each output.",weight:1},
    ]}},
  }]}));
  assert.ok(output);
  assert.equal(output.items[0].slide.quote,undefined);
  assert.equal(output.items[0].slide.visual.data[0].value.includes(quote),true);
  const options={itemCount:1,sourceContract,requireSourceGrounding:true,requireAllProtectedContent:true};
  const issues=documentArtifactValidationIssues("slides",output,options);
  assert.deepEqual(issues.map(({code,path})=>({code,path})),[
    {code:"missing_markdown_quote",path:"content_markdown"},
    {code:"missing_quote_speaker_notes",path:"items.0.notes"},
  ]);
  output.content_markdown=`# Product evidence\n\n> ${quote}\n> — Product Owner`;
  output.items[0].notes=`${quote} — Product Owner`;
  assert.deepEqual(documentArtifactValidationIssues("slides",output,options),[]);
});

test("reconstructs the actual legacy quote split into a hidden hero continuation",()=>{
  const opening="“The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable";
  const continuation="reviewable, and reusable across devices.”";
  const complete="The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable, reviewable, and reusable across devices.";
  const normalized=normalizeSlideVisual({layout:"statement",kicker:"Differentiator",visual:{kind:"hero-type",label:"Product Owner",value:opening,data:[{label:"Continuation",value:continuation,weight:1}]}},{title:"The customer promise",body:""});
  assert.equal(normalized.visual.kind,"quote");assert.equal(normalized.quote?.text,complete);assert.equal(normalized.quote?.speaker,"Product Owner");assert.equal(normalized.quote?.role,"Product Owner");assert.equal(normalized.visual.value,complete);assert.deepEqual(normalized.visual.data,[]);assert.equal(slideVisualIsComplete(normalized),true);
});

test("resolves only authorized request-local context aliases and retains invented references in its receipt",()=>{
  const output=parseDocumentArtifactContent(JSON.stringify({title:"Source-grounded deck",summary:"Two authored chapters.",content_markdown:"Two authored chapters.",presentation,items:[
    {title:"Authorized opening",body:"The original direction remains intact.",notes:"",image_prompt:"",context_group_ids:["context_group_1"],slide:{layout:"statement",kicker:"Opening",bullets:[],visual:{kind:"hero-type",label:"Intent",value:"A durable authored choice",data:[]}}},
    {title:"Rejected invented provenance",body:"No guessed identifier authenticates source access.",notes:"",image_prompt:"",context_group_ids:["private-durable-id","context_group_999"],slide:{layout:"statement",kicker:"Evidence",bullets:[],visual:{kind:"hero-type",label:"Boundary",value:"Only request-scoped aliases resolve",data:[]}}},
  ]}));
  const resolved=resolveDocumentArtifactContextGroups(output,[{id:"private-durable-id",alias:"context_group_1"}]);
  assert.deepEqual(resolved.output?.items.map((item)=>item.context_group_ids),[["private-durable-id"],[]]);assert.deepEqual(resolved.receipt.unknownAssignments,["private-durable-id","context_group_999"]);
  const issues=documentArtifactValidationIssues("slides",resolved.output,{itemCount:2,contextGroupIds:["private-durable-id"],unknownContextGroupAssignments:resolved.receipt.unknownAssignments});assert.equal(issues.some((issue)=>issue.code==="unknown_context_group_reference"),true);assert.equal(issues.some((issue)=>issue.message.includes("private-durable-id")),false);
});

test("validates scorecard completeness, quotation coverage, source grounding, and authored source order together",()=>{
  const quote="An asynchronous job without a global, actionable inbox is just work the customer has to remember to check.";
  const scoreRows=[["Phone","39.75"],["Tablet","53.00"],["Small monitor","67.25"],["Large monitor","68.50"],["Adaptive/accessibility","58.75"],["Governed creative loop","79.50"]];
  const source={facts:[{block_id:"private-executive-source",active:true,properties:{label:"Executive assessment",text:`Slide 1 — Responsive assessment\n${scoreRows.map(([label,value])=>`${label}: ${value}`).join("\n")}\nExact equal-weight average: 61.125\nRounded display average: 61.13\n\nSlide 2 — Actionable operations\n“${quote}” — Market Researcher`}}]};
  const sourceContract=buildPresentationSourceContract(source,{requestedSlideCount:2});assert.equal(sourceContract.authoredSlideCount,2);assert.equal(sourceContract.protectedFacts.filter((fact)=>fact.precision==="source").length,6);assert.equal(sourceContract.protectedQuotes.length,1);
  const output=parseDocumentArtifactContent(JSON.stringify({title:"Executive assessment",summary:"A complete source-grounded argument.",content_markdown:`Exact 61.125; displayed 61.13. ${quote} — Market Researcher`,presentation,items:[
    {title:"Every responsive score remains visible",body:"Six dimensions contribute equally.",notes:"The exact average is 61.125; the displayed average is 61.13.",image_prompt:"",context_group_ids:[],slide:{layout:"scorecard",kicker:"Baseline",source_ids:["private-executive-source"],source_order:1,visual:{kind:"scorecard",label:"Current-state assessment",value:"61.13",exact_value:"61.125",display_value:"61.13",data:scoreRows.map(([label,value])=>({label,value,weight:Number(value)/100,source_ids:["private-executive-source"]}))}}},
    {title:"Every pending job needs a global inbox",body:"",notes:`Market Researcher: ${quote}`,image_prompt:"",context_group_ids:[],slide:{layout:"quote",kicker:"Research perspective",source_ids:["private-executive-source"],source_order:2,quote:{text:quote,speaker:"Market Researcher",role:"Market Researcher",source_id:"private-executive-source"},visual:{kind:"quote",label:"Customer consequence",value:quote,data:[]}}},
  ]}));
  assert.deepEqual(documentArtifactValidationIssues("slides",output,{itemCount:2,sourceContract,requireSourceGrounding:true,requireAllProtectedContent:true}),[]);
  const incomplete=structuredClone(output);incomplete.items[0].slide.visual.data.pop();const incompleteCodes=new Set(documentArtifactValidationIssues("slides",incomplete,{itemCount:2,sourceContract,requireSourceGrounding:true}).map((issue)=>issue.code));assert.equal(incompleteCodes.has("inconsistent_scorecard_average"),true);assert.equal(incompleteCodes.has("missing_scorecard_datum"),true);
  const reversed=structuredClone(output);reversed.items[0].slide.visual.exactValue="61.13";reversed.items[0].slide.visual.displayValue="61.125";const reversedCodes=new Set(documentArtifactValidationIssues("slides",reversed,{itemCount:2,sourceContract,requireSourceGrounding:true}).map((issue)=>issue.code));assert.equal(reversedCodes.has("reversed_precision_labels"),true);assert.equal(reversedCodes.has("incorrect_exact_value"),true);assert.equal(reversedCodes.has("incorrect_display_value"),true);
  const truncated=structuredClone(output);truncated.items[1].slide.quote.text=quote.slice(0,50);truncated.items[1].slide.visual.value=quote.slice(0,50);assert.equal(documentArtifactValidationIssues("slides",truncated,{itemCount:2,sourceContract,requireSourceGrounding:true}).some((issue)=>issue.code==="missing_protected_quote"),true);
  const ungrounded=structuredClone(output);ungrounded.items[1].slide.sourceIds=[];delete ungrounded.items[1].slide.quote.sourceId;assert.equal(documentArtifactValidationIssues("slides",ungrounded,{itemCount:2,sourceContract,requireSourceGrounding:true}).some((issue)=>issue.code==="missing_slide_source"),true);
  const reordered=structuredClone(output);reordered.items.reverse();assert.equal(documentArtifactValidationIssues("slides",reordered,{itemCount:2,sourceContract,requireSourceGrounding:true}).some((issue)=>issue.code==="source_order_mismatch"),true);
  const hiddenFromNotes=structuredClone(output);hiddenFromNotes.items[1].notes="A market researcher explains the customer impact.";assert.equal(documentArtifactValidationIssues("slides",hiddenFromNotes,{itemCount:2,sourceContract,requireSourceGrounding:true,requireAllProtectedContent:true}).some((issue)=>issue.code==="missing_quote_speaker_notes"),true);
  const hiddenFromMarkdown=structuredClone(output);hiddenFromMarkdown.content_markdown="Exact 61.125; displayed 61.13.";assert.equal(documentArtifactValidationIssues("slides",hiddenFromMarkdown,{itemCount:2,sourceContract,requireSourceGrounding:true,requireAllProtectedContent:true}).some((issue)=>issue.code==="missing_markdown_quote"),true);
  const reversedNotes=structuredClone(output);reversedNotes.items[0].notes="The exact average is 61.13; the displayed average is 61.125.";assert.equal(documentArtifactValidationIssues("slides",reversedNotes,{itemCount:2,sourceContract,requireSourceGrounding:true,requireAllProtectedContent:true}).some((issue)=>issue.code==="reversed_narrative_precision"),true);
  const intentionallyPaged=structuredClone(hiddenFromNotes);intentionallyPaged.content_markdown="The current production page omits a later protected quotation.";assert.equal(documentArtifactValidationIssues("slides",intentionallyPaged,{itemCount:2,sourceContract,requireSourceGrounding:true,requireAllProtectedContent:false}).some((issue)=>issue.code==="missing_quote_speaker_notes"||issue.code==="missing_markdown_quote"),false);
});

test("repairs an incomplete provider slide plan once and retains exact validation receipts",async()=>{
  const originalFetch=globalThis.fetch;const requests=[];
  const incomplete={title:"Field study",summary:"A broken first pass",content_markdown:"# Field study",presentation:{...presentation,footer_label:"Field study"},items:[{title:"",body:"",notes:"",image_prompt:"",context_group_ids:[],slide:{layout:"split",kicker:"",bullets:[],visual:{kind:"bars",label:"",value:"",data:[]}}}]};
  const repaired={title:"Field study",summary:"A resolved deck",content_markdown:"# Field study\n\nOne clear progression.",presentation:{...presentation,footer_label:"Field study"},items:[{title:"Protect the opening",body:"",notes:"Explain why the field remains visible.",image_prompt:"No raster image.",context_group_ids:[],slide:{layout:"metric",kicker:"Evidence",bullets:[],visual:{kind:"metric",label:"Open field",value:"82%",data:[]}}}]};
  globalThis.fetch=async(_input,init={})=>{const request=JSON.parse(String(init.body));requests.push(request);const output=requests.length===1?incomplete:repaired;return Response.json({id:`response-${requests.length}`,model:"gpt-5.6-terra",output_text:JSON.stringify(output),usage:{input_tokens:100,output_tokens:50,total_tokens:150}});};
  try{const result=await generateDocumentArtifact({OPENAI_API_KEY:"test",OPENAI_MODEL:"gpt-5.6-terra"},"user-1","slides",{documentTitle:"Field study",snapshot:{facts:[],relationships:[]},options:{itemCount:1,locale:"ja-JP"}});assert.equal(requests.length,2);for(const request of requests){assert.match(request.instructions,/selected language \(ja-JP\)/);assert.match(request.instructions,/Preserve the original language and exact text of user-authored document titles/);assert.equal(JSON.parse(request.input).document_title,"Field study");}assert.equal(requests[1].text.format.name,"document_slides_repair");assert.equal(result.output.items[0]?.title,"Protect the opening");assert.equal(result.inputReceipt.validation.repair_attempted,true);assert.ok(result.inputReceipt.validation.initial_issues.some((issue)=>issue.code==="missing_title"));assert.deepEqual(result.inputReceipt.validation.repair_issues,[]);assert.deepEqual(result.usage,{inputTokens:200,outputTokens:100,totalTokens:300});}
  finally{globalThis.fetch=originalFetch;}
});

test("locally heals repeated slide openings and generic captions while registering the adapter defect without another provider call",async()=>{
  const originalFetch=globalThis.fetch;
  const requests=[];
  const generated={
    title:"One context, many paths",
    summary:"A complete, source-grounded pitch.",
    content_markdown:"# One context, many paths\n\nBuild the story once. Meet people where they are.",
    presentation:{...presentation,footer_label:"Forma"},
    items:[{
      title:"Build the story once.",
      body:"Build the story once. Meet people where they are.",
      notes:"Preserve the complete authored direction.",
      image_prompt:"A coherent visual argument.",
      context_group_ids:[],
      slide:{
        layout:"statement",
        kicker:"A useful invitation",
        bullets:["Build the story once. Carry its source into every useful format."],
        visual:{kind:"hero-type",label:"Visual emphasis",value:"One creative world with many thoughtful expressions",data:[]},
      },
    }],
  };
  globalThis.fetch=async(_input,init={})=>{
    requests.push(JSON.parse(String(init.body)));
    return Response.json({id:"locally-repaired-pitch",model:"gpt-5.6-terra",output_text:JSON.stringify(generated),usage:{input_tokens:100,output_tokens:50,total_tokens:150}});
  };

  try{
    const result=await generateDocumentArtifact({OPENAI_API_KEY:"test",OPENAI_MODEL:"gpt-5.6-terra"},"user-1","slides",{
      documentTitle:"One context, many paths",
      snapshot:{facts:[],relationships:[]},
      options:{itemCount:1},
    });
    const item=result.output.items[0];
    const validation=result.inputReceipt.validation;

    assert.equal(requests.length,1,"deterministic copy cleanup must not purchase another provider response");
    assert.equal(item.title,"Build the story once.");
    assert.equal(item.body,"Meet people where they are.");
    assert.deepEqual(item.slide.bullets,["Carry its source into every useful format."]);
    assert.equal(item.slide.visual.label,"");
    assert.deepEqual(validation.initial_issues,[]);
    assert.equal(validation.repair_attempted,false);
    assert.deepEqual(validation.validation_history.map(({stage})=>stage),["initial","review"]);
    assert.deepEqual(validation.adapter_reconciliation.issue_codes,["duplicate_slide_copy","generic_visual_label"]);
    assert.equal(validation.adapter_reconciliation.status,"pending");
    assert.equal(validation.adapter_reconciliation.self_healed,true);
    assert.equal(validation.adapter_reconciliation.adapter_version,PRESENTATION_ADAPTER_VERSION);
  }finally{globalThis.fetch=originalFetch;}
});

test("first-time storyboards prefer coherent production without silently changing video cost or manual choice",async()=>{
  const initial={kind:"short_story",mode:"manual",storyboardManagedDefault:false,storyboardManualOptOut:false};
  const storyboard=selectArtifactProductionKind(initial,"storyboard");
  assert.deepEqual(storyboard,{kind:"storyboard",mode:"managed",storyboardManagedDefault:true,storyboardManualOptOut:false});
  assert.equal(selectArtifactProductionKind(storyboard,"storyboard"),storyboard,"Opening the same storyboard must not override an existing choice.");
  const manualStoryboard={...storyboard,mode:"manual",storyboardManagedDefault:false,storyboardManualOptOut:true};
  assert.deepEqual(selectArtifactProductionKind(manualStoryboard,"storyboard"),manualStoryboard,"An explicit manual opt-out survives reopening the same storyboard.");
  for(const intermediate of ["video","slides","scene"]){
    const other=selectArtifactProductionKind(manualStoryboard,intermediate);
    assert.deepEqual(other,{kind:intermediate,mode:"manual",storyboardManagedDefault:false,storyboardManualOptOut:true});
    assert.deepEqual(selectArtifactProductionKind(other,"storyboard"),manualStoryboard,"An explicit manual opt-out survives leaving the storyboard and returning.");
  }
  assert.deepEqual(selectArtifactProductionKind(storyboard,"video"),{kind:"video",mode:"manual",storyboardManagedDefault:false,storyboardManualOptOut:false},"An automatic storyboard preference must never multiply paid video scenes.");
  assert.deepEqual(selectArtifactProductionKind(storyboard,"slides"),{kind:"slides",mode:"manual",storyboardManagedDefault:false,storyboardManualOptOut:false},"An automatic storyboard preference must not change another format's default.");
  for(const kind of ["video","slides","scene"])assert.deepEqual(selectArtifactProductionKind(initial,kind),{kind,mode:"manual",storyboardManagedDefault:false,storyboardManualOptOut:false});
  assert.deepEqual(selectArtifactProductionKind({...storyboard,storyboardManagedDefault:false},"video"),{kind:"video",mode:"managed",storyboardManagedDefault:false,storyboardManualOptOut:false},"An intentional managed workflow remains the user's decision.");

  const component=await readFile(new URL("../src/components/document-artifacts.ts",import.meta.url),"utf8");
  assert.match(component,/#productionMode:ProductionMode="manual";#storyboardManagedDefault=false;#storyboardManualOptOut=false/);
  const selection=component.slice(component.indexOf("  #selectArtifactKind("),component.indexOf("  #rememberRequestDraft("));
  assert.match(selection,/if\(this\.#kind!==kind\)\{\s*this\.#requestDrafts\.set\(this\.#kind,\{[^\n]+\}\);\s*this\.#clearSceneCost\(\);\s*\}/u,"leaving a format preserves its own draft before retiring its Scene quote");
  assert.match(selection,/const changed=this\.#kind!==kind,saved=changed\?this\.#requestDrafts\.get\(kind\):null;/u);
  assert.match(selection,/const selected=selectArtifactProductionKind\(\{kind:this\.#kind,mode:changed\?"manual":this\.#productionMode,storyboardManagedDefault:this\.#storyboardManagedDefault,storyboardManualOptOut:this\.#storyboardManualOptOut\},kind\);/u);
  assert.match(selection,/this\.#productionMode=saved\?\.productionMode\?\?selected\.mode/u,"restore only this format's deliberate production mode, otherwise apply its safe default");
  const opener=component.slice(component.indexOf("  async openRender("),component.indexOf("  async openArtifactById("));
  assert.match(opener,/if\(kind\)this\.#selectArtifactKind\(kind\)/);assert.match(opener,/return this\.#openCreate\(!kind,current\)/);
  assert.match(component,/name="artifact-kind"[^\n]*@change=\$\{\(\)=>\{this\.#retireRequestReview\(\);this\.#selectArtifactKind\(kind\)/,"format changes retire any pending failed-request restoration before selecting the new format");
  assert.match(component,/value="manual"[^\n]*@change=\$\{\(\)=>\{this\.#sceneDraftChanged\(\);this\.#productionMode="manual";this\.#sendSoundtrackToVideoProvider=false;this\.#storyboardManagedDefault=false/);
  assert.match(component,/value="manual"[^\n]*@change=\$\{\(\)=>\{this\.#sceneDraftChanged\(\);this\.#productionMode="manual";this\.#sendSoundtrackToVideoProvider=false;/,"switching to manual production must revoke soundtrack-provider transfer consent");
  assert.match(component,/value="managed"[^\n]*@change=\$\{\(\)=>\{this\.#sceneDraftChanged\(\);this\.#productionMode="managed";this\.#sendSoundtrackToVideoProvider=false;/,"switching to managed production must revoke soundtrack-provider transfer consent");
  assert.match(component,/if\(this\.#kind==="storyboard"\)this\.#storyboardManualOptOut=true/);
  assert.match(component,/if\(this\.#kind==="storyboard"\)this\.#storyboardManualOptOut=false/);
  assert.match(component,/Production cost and provider disclosure/);
  assert.match(component,/authorized source image(?:s)? may be used as scoped frame references; completed frames can guide later images/);
  assert.match(component,/paidMediaConfirmed:paid&&this\.#confirmed/);
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
  const paidConsentAt=renderDocumentRoute.indexOf("paid_media_confirmation_required");assert.ok(paidConsentAt>=0&&paidConsentAt<renderReservationAt,"direct paid rendering must require explicit consent before a budget reservation");assert.match(jobs,/payload\.paidMediaConfirmed!==true\)return Response\.json\(\{error:"paid_media_confirmation_required"/);assert.match(jobs,/requestPayload\.paidMediaConfirmed!==true\)return Response\.json\(\{error:"paid_media_confirmation_required"/);assert.match(events,/paid_media_confirmed:body\.paidMediaConfirmed===true/);
  assert.doesNotMatch(component,/if\(paid&&!this\.#confirmed\)return/);assert.doesNotMatch(component,/<input type="checkbox" \.checked=\$\{this\.#confirmed\}/);assert.doesNotMatch(component,/\|\|paid&&!this\.#confirmed/);assert.match(component,/if\(paid\)this\.#confirmed=true/);assert.match(component,/paidMediaConfirmed:paid&&this\.#confirmed/);assert.match(component,/Production cost and provider disclosure/);assert.match(component,/generationBudgetGate/);assert.match(component,/this\.#itemCount=Number\(\(event\.target as HTMLSelectElement\)\.value\);this\.#confirmed=false;this\.requestUpdate\(\)/);assert.match(component,/generate and send an account-owned continuity image/);
  assert.match(events,/artifact_media_target_not_found/);assert.match(store,/renderDocumentArtifact/);assert.match(store,/targetKind:"artifact"/);assert.match(store,/suppressedUntilCritical/);assert.match(component,/VIDEO_ADAPTER_CONTRACT\.label/);assert.match(component,/Inspect inputs/);assert.match(component,/system\("Saving…"\):this\.i18n\.system\("Stop"\)/);assert.match(component,/forma-video-reference-preflight/);assert.match(component,/reference-to-video/);assert.match(component,/No reference pixels will leave storage/);
  assert.match(component,/VIDEO_DURATION_SECONDS\.map/);assert.match(canvas,/openRender\(kind,item\.sourceId\)/);assert.match(canvas,/same complete configuration available in the document/);assert.match(events,/video_duration_unsupported/);
  assert.match(component,/document-artifact-reader-content/);assert.match(styles,/\.document-artifact-reader-content \{ min-height: 0; overflow: auto;/);assert.match(styles,/\.document-artifact-reader \{ min-height: 0; overflow: hidden;/);
  assert.match(component,/this\.#editItems\.length>1\|\|\["slides","storyboard","video"\]\.includes\(artifact\.kind\)/,"single-slide, single-frame, and single-scene structured outputs remain directly editable");
  assert.match(component,/content\.items\.length>1\|\|\["slides","storyboard","video"\]\.includes\(artifact\.kind\)/,"editable Word handoff includes even a single structured frame");
  assert.match(component,/this\.#revisionPreview\.content\.items\.length>1\|\|\["slides","storyboard","video"\]\.includes\(artifact\.kind\)/,"revision previews preserve the content and notes of even one slide, frame, or scene");
  assert.match(component,/#createdAt\(artifact:DocumentArtifact\)/);assert.match(component,/event\.eventId===artifact\.sourceEventId/);assert.match(component,/class="document-artifact-created"/);assert.match(component,/(?:>Created \$\{|this\.i18n\.system\("Created"\))/);assert.match(styles,/\.document-artifact-created \{/);
  assert.match(component,/Use & edit (?:\$\{documentArtifactDefinition\(artifact\.kind\)\.label\.toLowerCase\(\)\}|\{value\})/);assert.match(component,/"Edit input"/);assert.match(component,/addArtifactAsContext/);assert.match(store,/artifactContextEvents/);assert.match(canvas,/artifactContextEvents/);assert.match(canvas,/imageOutputContextEvents/);
  assert.match(component,/forma-presentation-slide/);assert.match(slideComponent,/presentation-visual-bars/);assert.match(canvas,/forma-presentation-slide/);assert.match(styles,/\.presentation-slide/);assert.match(styles,/aspect-ratio: 16\s*\/\s*9/);
  for(const source of [component,canvas]){assert.match(source,/forma-presentation-deck/);assert.match(source,/\.preferenceKey=\$\{artifact\.id\}/);assert.match(source,/\.deckTitle=\$\{artifact\.title\}/);assert.match(source,/\.documentId=\$\{artifact\.documentId\}/);}assert.match(deckComponent,/Show deck label/);assert.match(deckComponent,/Slide style/);assert.match(deckComponent,/SLIDE_STYLE_PRESETS\.map/);assert.match(deckComponent,/slide-style-changed/);assert.match(deckComponent,/DECK_STYLE_PREFERENCE/);assert.match(deckComponent,/List/);assert.match(deckComponent,/Slideshow/);assert.match(deckComponent,/Download PDF/);assert.match(deckComponent,/renderPresentationPdf/);assert.match(deckComponent,/application\/pdf/);assert.match(deckComponent,/DocumentArtifactExported/);assert.match(deckComponent,/ArrowLeft/);assert.match(deckComponent,/ArrowRight/);assert.match(deckComponent,/Previous/);assert.match(deckComponent,/Next/);assert.match(deckComponent,/normalizeSlideItem/);assert.doesNotMatch(deckComponent,/normalizeSlideDeckItems/,"approved slides must not undergo provider-draft cross-slide de-duplication");assert.match(deckComponent,/writeSlideFooterLabelPreference/);assert.match(slideComponent,/presentation\.footerLabel/);assert.match(slideComponent,/style-\$\{presentation\.stylePreset\}/);assert.doesNotMatch(slideComponent,/>\$\{presentation\.theme\}</);
  assert.match(styles,/\.presentation-deck-frame \{[^}]*aspect-ratio: 16\/9;/);assert.match(styles,/\.presentation-deck-frame \.presentation-slide \{ aspect-ratio: auto;/);
  for(const style of ["gallery","editorial","nocturne","field-notes"])assert.match(styles,new RegExp(`\\.presentation-slide\\.style-${style}`));assert.match(styles,/\.artifact-slides > li/);assert.match(styles,/\.presentation-slide-body > section > ul > li/);assert.match(styles,/list-style: disc/);assert.doesNotMatch(styles,/\.artifact-slides li \{/);
  for(const kind of DOCUMENT_ARTIFACT_KINDS)assert.match(component,new RegExp(kind));
  // Canvas still has six direct launch/inline-view formats. The upstream 3D owner
  // is DocumentArtifacts; its exact-output action is also reachable from Canvas.
  // Enum membership alone does not certify a native Canvas 3D launcher or viewer.
  const canvasKinds=["short_story","scene","slides","storyboard","video","audio"];
  assert.deepEqual(DOCUMENT_ARTIFACT_KINDS,[...canvasKinds,"model3d"],"audit both surfaces when another format is added");
  for(const kind of canvasKinds)assert.match(canvas,new RegExp(kind));
  assert.match(component,/if\(this\.#kind==="model3d"\)\{await this\.#createModel3d\(\);return;\}/);
  assert.match(component,/forma-model3d-viewer/);assert.match(component,/model3d-output-files/);
  const deliveryStart=canvas.indexOf("async #openArtifactDelivery("),deliveryEnd=canvas.indexOf("\n  #closeCanvasArtifact()",deliveryStart);
  assert.ok(deliveryStart>=0&&deliveryEnd>deliveryStart,"Canvas retains its kind-independent exact-output handoff");
  const delivery=canvas.slice(deliveryStart,deliveryEnd);
  assert.match(delivery,/if\(!current\("opening"\)\)return false;/);
  assert.match(delivery,/querySelector\("forma-document-artifacts"\)\?\.openArtifactById\(artifact\.id,/);
  assert.match(delivery,/expectedRevision:revision/);assert.match(delivery,/expectedContentSha256:delivery\.contentSha256/);
  assert.match(delivery,/intent:delivery\.intent,current/);
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
    const queueCall=calls.find((call)=>call.url==="https://queue.fal.run/bytedance/seedance-2.0/reference-to-video"&&call.method==="POST");const submitted=JSON.parse(String(queueCall.body));assert.deepEqual(submitted.image_urls,["https://v3b.fal.media/files/example/original-reference.png"]);assert.ok(calls.some((call)=>call.url==="https://queue.fal.run/ideogram/v4/requests/fal-image-1"));assert.equal(calls.some((call)=>call.url.includes("/fast/requests/")||call.url.endsWith("/response")),false);assert.equal(calls.some((call)=>call.url.includes("/storage/upload/")),false);assert.equal(prepared[0].parameters.image_transport,"original-fal-url");assert.equal(prepared[0].parameters.original_provider_asset_count,1);assert.equal(result.referenceInputs[0].transport,"original-fal-url");assert.equal(result.referenceInputs[0].original_provider_asset_reused,true);
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


test("C2 offline Short story preparation: bounded source and legacy dispatch controls", async (context) => {
  const safety = "synthetic-c2-safety";
  const invalid = "short_story_preparation_input_invalid";
  const limit = "short_story_preparation_input_limit";
  const policyInvalid = "short_story_preparation_request_policy_invalid";
  const canonicalInvalid = "short_story_preparation_noncanonical_json";
  const base = () => ({documentTitle:"Field study",snapshot:{facts:[],relationships:[]}});
  const fact = (id="private-source",properties={text:"A bell sounded."}) => ({block_id:id,type:"message",properties});
  const inactive = (properties={}) => ({documentTitle:"Field study",snapshot:{facts:[{...fact("inactive-source",properties),active:false}],relationships:[]}});
  const digest = (value) => createHash("sha256").update(value,"utf8").digest("hex");
  const liveSafety = (value) => "forma_"+digest(value).slice(0,32);
  const bytes = (value) => Buffer.byteLength(value,"utf8");
  const prepare = (value,identifier=safety) => prepareInitialShortStoryRequest(JSON.stringify(value),identifier);
  const rejectsCode = (run,code) => assert.rejects(run,(error)=>{assert.ok(error instanceof RangeError);assert.equal(error.message,code);return true;});
  const schema = (maximum=12) => ({
    type:"object",additionalProperties:false,required:["title","summary","content_markdown","items"],
    properties:{
      title:{type:"string"},summary:{type:"string"},content_markdown:{type:"string"},
      items:{type:"array",minItems:1,maxItems:maximum,items:{type:"object",additionalProperties:false,
        required:["title","body","notes","image_prompt","context_group_ids"],
        properties:{title:{type:"string"},body:{type:"string"},notes:{type:"string"},image_prompt:{type:"string"},context_group_ids:{type:"array",maxItems:24,items:{type:"string"}}}}},
    },
  });
  const initialInput = () => ({document_title:"Field study",creative_context:{facts:[],relationships:[]},combined_context_plan:[],audience:"general",tone:"derived from the document"});
  // This oracle fixes envelope ordering/defaults/omissions. Long shared prompt strings
  // and the full Slides schema are opaque payloads with separate assertions below.
  const envelope = (instructions,input,outputSchema,name,{model="gpt-5.6-terra",effort="low",maximum=6000,identifier=safety,slides=false,offline=false}={}) => JSON.stringify({
    model,instructions,input,text:{verbosity:"medium",format:{type:"json_schema",name,strict:true,schema:outputSchema}},
    reasoning:{effort},max_output_tokens:maximum,store:false,safety_identifier:identifier,
    ...(slides||offline?{service_tier:"default",prompt_cache_options:{mode:"explicit"}}:{}),
    ...(offline?{truncation:"disabled"}:{}),
  });
  const deepFrozen = (value) => {
    if(value&&typeof value==="object"){assert.equal(Object.isFrozen(value),true);for(const child of Object.values(value))deepFrozen(child);}
  };
  const invalidArtifact = {code:"invalid_json",path:"$",message:"The provider response was not a valid artifact object."};
  const story = {title:"Field study",summary:"A complete story",content_markdown:"# Field study\n\nA bell sounded.",items:[{title:"Opening",body:"A bell sounded.",notes:"",image_prompt:"",context_group_ids:[]}]};
  const deck = {
    title:"Field study",summary:"A resolved deck",content_markdown:"# Field study\n\nOne clear progression.",
    presentation:{...presentation,footer_label:"Field study"},
    items:[{title:"Protect the opening",body:"A second exact direction stays available.",notes:"Explain the available evidence.",image_prompt:"No raster image.",context_group_ids:[],
      slide:{layout:"statement",kicker:"Evidence",bullets:[],visual:{kind:"hero-type",label:"Open field",value:"One distinct authored field remains visible.",data:[]}}}],
  };
  const originalFetch = globalThis.fetch;
  const uuidDescriptor = Object.getOwnPropertyDescriptor(globalThis.crypto,"randomUUID");
  let uuidCalls=0,blockedFetchCalls=0;
  Object.defineProperty(globalThis.crypto,"randomUUID",{configurable:true,writable:true,value:()=>{uuidCalls++;return "00000000-0000-4000-8000-"+String(uuidCalls).padStart(12,"0");}});
  globalThis.fetch=async()=>{blockedFetchCalls++;throw new Error("C2 test forbids real transport");};
  const syntheticResponse = (request,raw,id) => Response.json({id,model:request.model,status:"completed",service_tier:"default",output_text:raw,usage:{input_tokens:100,output_tokens:50,total_tokens:150}});
  const legacy = async (kind) => {
    const requests=[],trace=[],submissions=[],observerErrors=[];
    const previousFetch=globalThis.fetch;
    const stage=(key)=>key.endsWith("repair")?"repair":"initial";
    const env={OPENAI_API_KEY:"synthetic-key",OPENAI_MODEL:"gpt-5.6-terra",...(kind==="slides"?{OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT:"medium",OPENAI_SLIDES_REPAIR_MODEL:"gpt-5.6-sol",OPENAI_SLIDES_REPAIR_REASONING_EFFORT:"high"}:{})};
    globalThis.fetch=async(url,init)=>{
      try{
        assert.equal(url,"https://api.openai.com/v1/responses");assert.equal(init.method,"POST");assert.equal(typeof init.body,"string");
        assert.equal(init.headers.authorization,"Bearer synthetic-key");
        const request=JSON.parse(init.body),phase=request.text.format.name.endsWith("_repair")?"repair":"initial";
        trace.push("fetch:"+phase);requests.push({raw:init.body,request,phase,clientId:init.headers["X-Client-Request-Id"]});
        return syntheticResponse(request,requests.length===1?"{}":JSON.stringify(kind==="slides"?deck:story),"synthetic-response-"+requests.length);
      }catch(error){observerErrors.push(error);throw error;}
    };
    try{
      const result=await generateDocumentArtifact(env,"synthetic-live-user",kind,{...base(),options:{
        itemCount:1,
        onBeforeProviderAttempt:(attempt)=>trace.push("before:"+stage(attempt.logicalCallKey)),
        onProviderSubmission:(call)=>{submissions.push({...call});trace.push("submission:"+call.status+":"+stage(call.unitId)+(kind==="slides"&&call.status==="completed"?":"+call.validationStatus:""));},
        onBeforeProviderDispatch:()=>trace.push("dispatch:"+(requests.length?"repair":"initial")),
        onProviderResponse:(receipt)=>{const phase=stage(receipt.call.unitId);trace.push("response:"+phase);return{responseRef:"synthetic-stored-"+phase};},
        onProviderAttempt:(receipt)=>trace.push("attempt:"+(receipt.responseIds.length===1?"initial":"repair")),
      }});
      return{result,requests,trace,submissions};
    }finally{globalThis.fetch=previousFetch;assert.deepEqual(observerErrors,[],"transport observer failures must remain sticky");}
  };
  try{
    await context.test("fixed initial envelope, one-item schema and independent request digest",async()=>{
      const raw=JSON.stringify(base()),first=await prepareInitialShortStoryRequest(raw,safety),second=await prepareInitialShortStoryRequest(raw,safety);
      assert.equal(first.qualification,"offline-initial-preparation-only");
      assert.equal(first.requestBody,second.requestBody);assert.equal(first.requestDigest,second.requestDigest);
      assert.equal(first.requestDigest,digest(first.requestBody));assert.match(first.requestDigest,/^[a-f0-9]{64}$/u);
      assert.equal(first.byteLength,bytes(first.requestBody));assert.equal(first.inputAllowance,first.byteLength+4096);
      assert.equal(first.maximumOutputTokens,6000);assert.equal(first.formatName,"document_short_story");assert.equal(first.capturedInput,raw);
      const wire=JSON.parse(first.requestBody);
      assert.deepEqual(Object.keys(wire),["model","instructions","input","text","reasoning","max_output_tokens","store","safety_identifier","service_tier","prompt_cache_options","truncation"]);
      assert.deepEqual(Object.keys(wire.text),["verbosity","format"]);assert.deepEqual(Object.keys(wire.text.format),["type","name","strict","schema"]);
      assert.deepEqual(wire.text.format.schema,schema(1));assert.equal(wire.input,JSON.stringify(initialInput()));
      assert.equal(first.requestBody,envelope(wire.instructions,JSON.stringify(initialInput()),schema(1),"document_short_story",{offline:true}));
      assert.match(wire.instructions,/Write a polished short story, not a treatment\./u);
      assert.match(wire.instructions,/For stories and scenes, place a group's members at the same narrative moments or aspects\./u);
      assert.match(wire.instructions,/Preserve the original language and exact text/u);
      assert.match(wire.instructions,/Return exactly 1/u);
      assert.deepEqual(readShortStoryExecutionRequest(first.requestBody),{disposition:"eligible",reasons:[],serializedRequest:first.requestBody,byteLength:first.byteLength,inputAllowance:first.inputAllowance,formatName:"document_short_story"});
      for(const key of ["tools","files","stream","background","previous_response_id","metadata"])assert.equal(Object.hasOwn(wire,key),false,key);
    });

    await context.test("genuine supplied-context aliases remain context rather than authority",async()=>{
      const membership={context_set_id:"private-group",name:"Crossing",role:"character",target:"Courier",application:"isolate",relativity:.8};
      const input={documentTitle:"Crossing",snapshot:{facts:[
        {...fact("private-source-1",{label:"Courier",text:"Keeps a brass compass.",combined_context_memberships:[{...membership,member_order:0}]}),document_id:"private-document",source_event_refs:["private-event"]},
        fact("private-source-2",{label:"Rain",text:"Arrives before dusk.",combined_context_memberships:[{...membership,member_order:1}]}),
      ],relationships:[{relation_id:"private-relation",from_block_id:"private-source-1",to_block_id:"private-source-2",kind:"contrasts",properties:{note:"A held direction."}}]}};
      const prepared=await prepare(input),wire=JSON.parse(prepared.requestBody),payload=JSON.parse(wire.input);
      deepFrozen(prepared);assert.throws(()=>{prepared.contextGroupContracts[0].alias="injected";},TypeError);
      assert.deepEqual(prepared.contextGroupContracts,[{id:"private-group",alias:"context_group_1"}]);
      assert.equal(payload.combined_context_plan.length,1);const group=payload.combined_context_plan[0];
      assert.deepEqual(Object.keys(group),["context_key","name","role","target","application","relativity","members","instruction"]);
      assert.equal(group.context_key,"context_group_1");assert.equal(group.name,"Crossing");assert.equal(group.target,"Courier");assert.equal(group.application,"isolate");
      assert.deepEqual(group.members.map(({label,order})=>({label,order})),[{label:"Courier",order:0},{label:"Rain",order:1}]);
      assert.deepEqual(payload.creative_context.facts.map(({decision_key})=>decision_key),["decision_1","decision_2"]);
      assert.equal(payload.creative_context.facts[0].properties.text,"Keeps a brass compass.");
      assert.deepEqual(payload.creative_context.relationships,[{from_decision:"decision_1",from_label:"Courier",to_decision:"decision_2",to_label:"Rain",kind:"contrasts",properties:{note:"A held direction."}}]);
      for(const id of ["private-group","private-source-1","private-source-2","private-document","private-event","private-relation"])assert.equal(wire.input.includes(id),false,id);
      assert.equal(prepared.sourceCustody,false);assert.equal(prepared.currentOriginalAuthority,false);assert.equal(prepared.liveRequestParity,false);
      assert.equal(prepared.capturedInput,JSON.stringify(input),"private supplied bytes remain a snapshot, not public certification");
    });

    await context.test("whole serialized request accepts 53904 bytes and rejects 53905 without trimming",async()=>{
      const prefix='Élan 雪 😀 "quoted" \\path\n';
      const value={documentTitle:"Field study",snapshot:{facts:[fact("a",{label:"First",text:prefix}),fact("b",{label:"Second",text:""})],relationships:[]}};
      const baseline=await prepare(value),padding=53904-baseline.byteLength;
      assert.ok(padding>0&&padding<65000);
      value.snapshot.facts[0].properties.text=prefix+"x".repeat(Math.min(40000,padding));
      value.snapshot.facts[1].properties.text="y".repeat(padding-Math.min(40000,padding));
      assert.ok(value.snapshot.facts.every(row=>row.properties.text.length<=49152));
      const raw=JSON.stringify(value);assert.ok(bytes(raw)<=65536);
      const prepared=await prepareInitialShortStoryRequest(raw,safety);
      assert.equal(prepared.byteLength,53904);assert.equal(prepared.inputAllowance,58000);assert.equal(bytes(prepared.requestBody),53904);
      const payload={document_title:"Field study",creative_context:{facts:[
        {decision_key:"decision_1",type:"message",properties:{label:"First",text:value.snapshot.facts[0].properties.text},order:1},
        {decision_key:"decision_2",type:"message",properties:{label:"Second",text:value.snapshot.facts[1].properties.text},order:2},
      ],relationships:[]},combined_context_plan:[],audience:"general",tone:"derived from the document"};
      const wire=JSON.parse(prepared.requestBody);
      assert.equal(wire.input,JSON.stringify(payload));
      assert.equal(prepared.requestBody,envelope(wire.instructions,JSON.stringify(payload),schema(1),"document_short_story",{offline:true}));
      assert.equal(prepared.capturedInput,raw);assert.ok(bytes(prefix)>prefix.length);
      assert.ok(prepared.requestBody.includes("\\\\path"),"nested JSON escaping contributes to the complete wire size");
      value.snapshot.facts[1].properties.text+="z";payload.creative_context.facts[1].properties.text+="z";
      const oversized=envelope(wire.instructions,JSON.stringify(payload),schema(1),"document_short_story",{offline:true});
      assert.equal(bytes(oversized),53905);assert.equal(readShortStoryExecutionRequest(oversized).disposition,"invalid");
      await rejectsCode(()=>prepare(value),policyInvalid);
    });

    await context.test("primitive safety and input capture invoke no getters or coercion hooks",async()=>{
      const effects={get:0,ownKeys:0,descriptor:0,coerce:0};
      const hostile=new Proxy({},{get(){effects.get++;throw new Error("getter");},ownKeys(){effects.ownKeys++;throw new Error("keys");},getOwnPropertyDescriptor(){effects.descriptor++;throw new Error("descriptor");}});
      const coercible={[Symbol.toPrimitive](){effects.coerce++;throw new Error("coerce");},toString(){effects.coerce++;throw new Error("toString");},toJSON(){effects.coerce++;throw new Error("toJSON");}};
      for(const supplied of [null,undefined,0,1n,true,Symbol("input"),[],{},new String("{}"),hostile,coercible]){
        let promise;assert.doesNotThrow(()=>{promise=prepareInitialShortStoryRequest(supplied,safety);});
        assert.ok(promise instanceof Promise);await rejectsCode(()=>promise,invalid);
      }
      for(const identifier of [""," leading","trailing ","x".repeat(201),null,0,{},hostile,coercible]){
        await rejectsCode(()=>prepareInitialShortStoryRequest(hostile,identifier),"short_story_preparation_safety_identifier_invalid");
      }
      for(const identifier of ["x","x".repeat(200),"é".repeat(200),"\ud800"]){
        const prepared=await prepare(base(),identifier);assert.equal(JSON.parse(prepared.requestBody).safety_identifier,identifier);
      }
      assert.deepEqual(effects,{get:0,ownKeys:0,descriptor:0,coerce:0});
    });

    await context.test("closed structural fields and noncanonical JSON reject configuration ambiguity",async()=>{
      const forbidden=["options","env","model","schema","route","candidateRaw","repair","onProviderSubmission","onBeforeProviderDispatch","capture"];
      for(const key of forbidden){
        await rejectsCode(()=>prepare({...base(),[key]:"not executable configuration"}),invalid);
        await rejectsCode(()=>prepare({documentTitle:"Field study",snapshot:{...base().snapshot,[key]:"not executable configuration"}}),invalid);
      }
      for(const key of ["standing_constraints","pins","tail","blocks"])await rejectsCode(()=>prepare({documentTitle:"Field study",snapshot:{...base().snapshot,[key]:[]}}),invalid);
      for(const key of ["__proto__","constructor","prototype","decision_key"]){
        const properties={};Object.defineProperty(properties,key,{enumerable:true,value:{ignored:false}});
        await rejectsCode(()=>prepare(inactive(properties)),invalid);
      }
      for(const raw of [
        '{"documentTitle":"first","documentTitle":"Field study","snapshot":{"facts":[],"relationships":[]}}',
        ' {"documentTitle":"Field study","snapshot":{"facts":[],"relationships":[]}}',
        '{"documentTitle":"Field\\u0020study","snapshot":{"facts":[],"relationships":[]}}',
        '{"documentTitle":"Field study","snapshot":{"facts":[{"block_id":"a","type":"message","properties":{"value":1e0},"active":false}],"relationships":[]}}',
        '{"documentTitle":"Field study","snapshot":{"facts":[{"block_id":"a","type":"message","properties":{"value":-0},"active":false}],"relationships":[]}}',
      ])await rejectsCode(()=>prepareInitialShortStoryRequest(raw,safety),canonicalInvalid);
      for(const raw of ["{","null","[]",'{"documentTitle":"x","snapshot":{"facts":null}}','{"documentTitle":"\\ud800","snapshot":{"facts":[]}}',JSON.stringify(base())+"\ud800"]){
        await rejectsCode(()=>prepareInitialShortStoryRequest(raw,safety),invalid);
      }
      for(const change of [
        value=>{value.snapshot.facts=[fact("same"),fact("same")];},
        value=>{value.snapshot.facts=[fact("a")];value.snapshot.relationships=[{from_block_id:"a",to_block_id:"missing",kind:"contrasts",properties:{}}];},
        value=>{value.snapshot.facts=[{...fact(),position:{x:"1",y:2}}];},
        value=>{value.snapshot.facts=[{...fact(),active:"false"}];},
        value=>{value.snapshot.facts=[{...fact(),properties:[]}];},
        value=>{value.snapshot.facts=[{...fact(),block_id:" padded"}];},
      ]){const value=base();change(value);await rejectsCode(()=>prepare(value),invalid);}
      const canonicalMembership=()=>({context_set_id:"known-group",name:"Known group",role:"custom",target:"Target",application:"isolate",relativity:.5,member_order:0});
      const grouped=()=>({documentTitle:"Field study",snapshot:{facts:[fact("a",{label:"A",combined_context_memberships:[canonicalMembership()]})],relationships:[]}});
      await prepare(grouped());
      for(const change of [
        value=>{value.snapshot.facts[0].properties.combined_context_memberships={};},
        value=>{value.snapshot.facts[0].properties.combined_context=canonicalMembership();},
        value=>{delete value.snapshot.facts[0].properties.combined_context_memberships[0].name;},
        value=>{value.snapshot.facts[0].properties.combined_context_memberships[0].role="unknown";},
        value=>{value.snapshot.facts[0].properties.combined_context_memberships[0].application="unknown";},
        value=>{value.snapshot.facts[0].properties.combined_context_memberships[0].name=" padded";},
        value=>{value.snapshot.facts[0].properties.combined_context_memberships[0].source_canvas_id=" padded";},
        value=>{value.snapshot.facts[0].properties.combined_context_memberships[0].extra=true;},
        value=>{value.snapshot.facts[0].properties.combined_context_memberships.push(canonicalMembership());},
        value=>{value.snapshot.facts.push(fact("b",{combined_context_memberships:[{...canonicalMembership(),name:"Conflicting name",member_order:1}]}));},
      ]){const value=grouped();change(value);await rejectsCode(()=>prepare(value),invalid);}
      for(const relativity of ["0.5",null,-.01,1.01]){const value=grouped();value.snapshot.facts[0].properties.combined_context_memberships[0].relativity=relativity;await rejectsCode(()=>prepare(value),invalid);}
      for(const order of ["0",null,-1,.5,Number.MAX_SAFE_INTEGER+1]){const value=grouped();value.snapshot.facts[0].properties.combined_context_memberships[0].member_order=order;await rejectsCode(()=>prepare(value),invalid);}
      const weighted=grouped();weighted.snapshot.facts[0].properties.combined_context_memberships[0].relativity=.2;
      weighted.snapshot.facts.push(fact("b",{label:"B",combined_context_memberships:[{...canonicalMembership(),relativity:.8,member_order:128,source_canvas_id:""}]}));
      const weightedPlan=JSON.parse(JSON.parse((await prepare(weighted)).requestBody).input).combined_context_plan[0];
      assert.equal(weightedPlan.relativity,.8);assert.deepEqual(weightedPlan.members.map(({relativity,order})=>({relativity,order})),[{relativity:.2,order:0},{relativity:.8,order:128}]);
      for(const key of ["context_set_id","contextSetId","copied_as_context_set","reference_set_kind","combinedContext","combinedContextMemberships","contextGroup","context_groups","context_group_ids","contextGroupIds"]){
        await rejectsCode(()=>prepare(inactive({[key]:key==="copied_as_context_set"?true:[]})),invalid);
      }
      const connected=()=>({documentTitle:"Field study",snapshot:{facts:[fact("a",{label:"A"}),fact("b",{label:"B"})],relationships:[{from_block_id:"a",to_block_id:"b",kind:"context_contains",properties:{member_order:0,relativity:.5}}]}});
      await prepare(connected());
      const typedGroup=connected();typedGroup.snapshot.facts[0].properties.context_group={name:"Named",role:"custom",target:"Target",application:"isolate",relativity:1};await prepare(typedGroup);
      for(const change of [
        value=>{value.snapshot.relationships[0].removed=true;},
        value=>{value.snapshot.relationships[0].properties.removed=true;},
        value=>{value.snapshot.relationships[0].properties.order=0;},
        value=>{value.snapshot.relationships[0].properties.context_set_id="legacy";},
        value=>{value.snapshot.relationships[0].properties.extra=true;},
        value=>{value.snapshot.relationships[0].properties.member_order="0";},
        value=>{value.snapshot.relationships[0].properties.relativity="0.5";},
        value=>{value.snapshot.relationships[0].to_block_id="a";},
        value=>{value.snapshot.relationships.push({...value.snapshot.relationships[0],kind:"combined_context_member"});},
        value=>{value.snapshot.relationships.push({from_block_id:"b",to_block_id:"a",kind:"context_contains",properties:{}});},
        value=>{value.snapshot.facts[1].active=false;},
        value=>{value.snapshot.facts[1].properties.active=false;},
        value=>{value.snapshot.facts[1].properties.weight=0;},
        value=>{value.snapshot.facts[0].properties.combined_context={...canonicalMembership(),context_set_id:"a"};},
        value=>{value.snapshot.facts[0].properties.context_group={name:"Missing fields"};},
      ]){const value=connected();change(value);await rejectsCode(()=>prepare(value),invalid);}
      const authoredWords="model schema repair onProviderSubmission OPENAI_API_KEY are authored words";
      const words={documentTitle:"Field study",snapshot:{facts:[fact("words",{text:authoredWords,model:"untrusted-model",schema:{kind:"untrusted"},onBeforeProviderDispatch:"not a function"})],relationships:[]}};
      const wordsWire=JSON.parse((await prepare(words)).requestBody);
      assert.equal(wordsWire.model,"gpt-5.6-terra");assert.equal(JSON.parse(wordsWire.input).creative_context.facts[0].properties.text,authoredWords);
      assert.equal((await prepare(base())).capturedInput,JSON.stringify(base()));
    });

    await context.test("canonical activity rejects supplied consent and unsupported audio-transfer structures",async()=>{
      const canonicalTypes=["direction","audience","message","emotion","subject","environment","action","motion","scale","composition","camera","lighting","style","material","palette","typography","audio","format","output","brand","exclusion","accessibility","reference","model3d","sketch"];
      const typed={documentTitle:"Field study",snapshot:{facts:canonicalTypes.map((type,index)=>({...fact("kind-"+index,{text:"Plain authored direction "+index}),type})),relationships:[]}};
      const typedFacts=JSON.parse(JSON.parse((await prepare(typed)).requestBody).input).creative_context.facts;
      assert.deepEqual(typedFacts.map(({type})=>type),canonicalTypes.filter(type=>type!=="output"));
      for(const type of ["text","Message"," message","audio ","OUTPUT","unknown","t".repeat(80)]){
        await rejectsCode(()=>prepare({documentTitle:"Field study",snapshot:{facts:[{...fact(),type}]}}),invalid);
      }
      await rejectsCode(()=>prepare({documentTitle:"Field study",snapshot:{facts:[{...fact(),type:"t".repeat(81)}]}}),limit);
      for(const role of ["Audio","AUDIO"," audio","audio ","\taudio\n"]){
        await rejectsCode(()=>prepare({documentTitle:"Field study",snapshot:{facts:[{...fact(),role}]}}),invalid);
      }
      for(const role of ["audio","audio engineer"]){
        const prepared=await prepare({documentTitle:"Field study",snapshot:{facts:[{...fact(),role}]}});
        assert.equal(JSON.parse(JSON.parse(prepared.requestBody).input).creative_context.facts.length,1);
      }
      for(const role of ["output"," Output ","OUTPUT"]){
        const prepared=await prepare({documentTitle:"Field study",snapshot:{facts:[{...fact(),role}]}});
        assert.equal(JSON.parse(JSON.parse(prepared.requestBody).input).creative_context.facts.length,0,"the existing output exclusion is not replaced");
      }
      assert.equal(JSON.parse(JSON.parse((await prepare({documentTitle:"Field study",snapshot:{facts:[fact("nested-role",{text:"Still source text",role:"output"})]}})).requestBody).input).creative_context.facts.length,1);
      await rejectsCode(()=>prepare({documentTitle:"Field study",snapshot:{facts:[{...fact(),Type:"OUTPUT"}]}}),invalid);
      for(const key of ["active","removed","locked"]){
        for(const value of [null,0,"false",{}])await rejectsCode(()=>prepare({documentTitle:"Field study",snapshot:{facts:[{...fact(),[key]:value}]}}),invalid);
      }
      for(const value of [null,0,"false",{}])await rejectsCode(()=>prepare(inactive({active:value})),invalid);
      for(const weight of [null,false,"0",-1,1.01])await rejectsCode(()=>prepare(inactive({weight})),invalid);
      const filtered={documentTitle:"Field study",snapshot:{facts:[
        {...fact("top-disabled"),active:false},{...fact("removed"),removed:true},fact("property-disabled",{active:false,text:"Disabled"}),fact("zero-weight",{weight:0,text:"Disabled"}),
        {...fact("included",{active:true,weight:.25,text:"Still active under the genuine predicate"}),active:true,removed:false,locked:false},
      ],relationships:[]}};
      const filteredFacts=JSON.parse(JSON.parse((await prepare(filtered)).requestBody).input).creative_context.facts;
      assert.equal(filteredFacts.length,1);assert.equal(filteredFacts[0].properties.text,"Still active under the genuine predicate");
      const forbidden=["inform_generation","informGeneration","include_in_output","includeInOutput","allow_provider_audio_transfer","allowProviderAudioTransfer","source_mime_type","sourceMimeType","media_type","mediaType","media_url","mediaUrl","audio_role","audioRole"];
      const controlled=()=>({documentTitle:"Field study",snapshot:{facts:[fact("a"),fact("b")],relationships:[{from_block_id:"a",to_block_id:"b",kind:"contrasts",properties:{}}]}});
      const implicitNeighbor={documentTitle:"Field study",snapshot:{facts:[fact("non-audio-neighbor",{text:"A bell sounded."})],relationships:[]}};
      const neighborPrepared=await prepare(implicitNeighbor);assert.equal(JSON.parse(JSON.parse(neighborPrepared.requestBody).input).creative_context.facts.length,1);
      const implicitAudio=structuredClone(implicitNeighbor);implicitAudio.snapshot.facts[0].properties.source_mime_type="audio/wav";
      await rejectsCode(()=>prepare(implicitAudio),invalid);
      for(const key of forbidden){
        for(const place of [
          value=>{value[key]=false;},value=>{value.snapshot[key]=false;},value=>{value.snapshot.facts[0][key]=false;},
          value=>{value.snapshot.facts[0].properties[key]=false;},value=>{value.snapshot.facts[0].properties.details=[{[key]:false}];},
          value=>{value.snapshot.relationships[0][key]=false;},value=>{value.snapshot.relationships[0].properties[key]=false;},
          value=>{value.snapshot.relationships[0].properties.details=[{nested:{[key]:false}}];},
        ]){const value=controlled();place(value);await rejectsCode(()=>prepare(value),invalid);}
        for(const value of [true,null,0,"",[],{}])await rejectsCode(()=>prepare(inactive({[key]:value})),invalid);
      }
      const audio=(properties={text:"  Sparse footsteps.  "})=>({documentTitle:"Field study",snapshot:{facts:[{...fact("authored-audio",properties),type:"audio"}],relationships:[]}});
      const plain=await prepare(audio()),plainFacts=JSON.parse(JSON.parse(plain.requestBody).input).creative_context.facts;
      assert.equal(plainFacts.length,1);assert.equal(plainFacts[0].properties.text,"  Sparse footsteps.  ");assert.equal(plain.capturedInput,JSON.stringify(audio()));
      const extraDescription=audio();extraDescription.snapshot.facts[0].properties.description="An otherwise plain authored audio description.";
      await rejectsCode(()=>prepare(extraDescription),invalid);
      for(const text of ["","   "]){const prepared=await prepare(audio({text}));assert.equal(JSON.parse(JSON.parse(prepared.requestBody).input).creative_context.facts.length,0);}
      for(const key of ["text","label"])for(const value of [null,0,false,[],{}])await rejectsCode(()=>prepare(audio({text:"Authored sound",[key]:value})),invalid);
      for(const key of ["description","details","reference","file","bytes","url","rights","transcript","source","metadata"]){
        await rejectsCode(()=>prepare(audio({text:"Authored sound",[key]:{rhythm:"Sparse"}})),invalid);
        const roleAudio={documentTitle:"Field study",snapshot:{facts:[{...fact("role-audio",{text:"Authored sound",[key]:null}),role:"audio"}]}};
        await rejectsCode(()=>prepare(roleAudio),invalid);
      }
      const nonAudio={documentTitle:"Field study",snapshot:{facts:[fact("inert-data",{text:"A media_url or inform_generation word is authored prose, not a control.",details:[{fileName:"synthetic.wav",rhythm:"Sparse"}],reference:{rights:"Supplied text only"}})],relationships:[]}};
      const inertPrepared=await prepare(nonAudio);assert.equal(inertPrepared.capturedInput,JSON.stringify(nonAudio));assert.equal(inertPrepared.sourceCustody,false);
      const member={context_set_id:"audio-group",name:"Footsteps",role:"custom",target:"Scene",application:"isolate",relativity:.5,member_order:0};
      const grouped=audio({text:"Sparse footsteps.",label:"Footsteps",active:true,weight:1,combined_context:member});
      const groupedPrepared=await prepare(grouped);assert.equal(groupedPrepared.contextGroupContracts.length,1);assert.equal(JSON.parse(JSON.parse(groupedPrepared.requestBody).input).creative_context.facts.length,1);
      const sourceMarked=audio({text:"Sparse footsteps.",combined_context:{...member,source_canvas_id:""}}),sourceMarkedPrepared=await prepare(sourceMarked);
      assert.equal(sourceMarkedPrepared.capturedInput,JSON.stringify(sourceMarked));assert.deepEqual(sourceMarkedPrepared.contextGroupContracts,[]);
      assert.equal(JSON.parse(JSON.parse(sourceMarkedPrepared.requestBody).input).creative_context.facts.length,0,"allowed source metadata still invokes the genuine recursive exclusion");
      const eventMarked=audio();eventMarked.snapshot.facts[0].source_event_refs=[];
      assert.equal(JSON.parse(JSON.parse((await prepare(eventMarked)).requestBody).input).creative_context.facts.length,0);
      const link=(value)=>{value.snapshot.facts.push(fact("other"));value.snapshot.relationships.push({from_block_id:"other",to_block_id:"authored-audio",kind:"context_contains",properties:{}});return value;};
      await prepare(link(audio()));await rejectsCode(()=>prepare(link(sourceMarked)),invalid);
      for(const key of ["text","label"]){
        const value=audio({text:"Authored sound",[key]:"s".repeat(49152)});value.snapshot.facts[0].active=false;await prepare(value);
        value.snapshot.facts[0].properties[key]+="s";await rejectsCode(()=>prepare(value),limit);
      }
    });

    await context.test("finite transport, depth, node, collection and field limits stay independent",async()=>{
      const nodeCount=(value)=>1+(value&&typeof value==="object"?Object.values(value).reduce((sum,child)=>sum+nodeCount(child),0):0);
      const atNodes=(target)=>{
        const value=inactive({payload:[]}),rows=value.snapshot.facts[0].properties.payload;
        let remaining=target-nodeCount(value);
        while(remaining>0){const children=Math.min(128,remaining-1);assert.ok(children>=0);rows.push(Array(children).fill(0));remaining-=children+1;}
        assert.equal(nodeCount(value),target);assert.ok(rows.length<=128);return value;
      };
      await prepare(atNodes(8192));await rejectsCode(()=>prepare(atNodes(8193)),limit);
      const atDepth=(maximum)=>{let payload=0;for(let depth=5;depth<maximum;depth++)payload={n:payload};return inactive({payload});};
      await prepare(atDepth(16));await rejectsCode(()=>prepare(atDepth(17)),limit);
      const membership=(index)=>({context_set_id:"declared-"+index,name:"Group "+index,role:"custom",target:"Target",application:"isolate",relativity:.5,member_order:0});
      for(const form of ["array","direct","legacy","empty-legacy"]){
        const declarations=(count)=>({documentTitle:"Field study",snapshot:{facts:form==="array"
          ?[fact("member",{label:"n",combined_context_memberships:Array.from({length:count},(_,index)=>membership(index))})]
          :Array.from({length:count},(_,index)=>fact("member-"+index,{label:"n",...(form==="direct"?{combined_context:membership(index)}:{combined_context_memberships:[],context_set_id:form==="empty-legacy"?"":"declared-"+index,copied_as_context_set:true})})),relationships:[]}});
        if(form==="array"||form==="direct"){const prepared=await prepare(declarations(24));assert.equal(prepared.contextGroupContracts.length,24);}
        else await rejectsCode(()=>prepare(declarations(24)),invalid);
        await rejectsCode(()=>prepare(declarations(25)),limit);
      }
      const repeated=(count)=>inactive({combined_context_memberships:Array.from({length:count},()=>membership(0))});
      await rejectsCode(()=>prepare(repeated(24)),invalid);await rejectsCode(()=>prepare(repeated(25)),limit);
      const chain=(edges,kind="context_contains")=>({documentTitle:"Field study",snapshot:{
        facts:Array.from({length:edges+1},(_,index)=>fact("chain-"+index,{label:"n"})),
        relationships:Array.from({length:edges},(_,index)=>({from_block_id:"chain-"+index,to_block_id:"chain-"+(index+1),kind,properties:{}})),
      }});
      const independentEdges=(edges,kind)=>({documentTitle:"Field study",snapshot:{
        facts:Array.from({length:edges*2},(_,index)=>fact("pair-"+index,{label:"n"})),
        relationships:Array.from({length:edges},(_,index)=>({from_block_id:"pair-"+(index*2),to_block_id:"pair-"+(index*2+1),kind,properties:{}})),
      }});
      for(const kind of ["context_contains","combined_context_member"]){
        const prepared=await prepare(independentEdges(24,kind));assert.equal(prepared.contextGroupContracts.length,24);
        await rejectsCode(()=>prepare(independentEdges(25,kind)),limit);
        assert.equal((await prepare(chain(3,kind))).contextGroupContracts.length,3);
      }
      const combined=independentEdges(24,"context_contains");combined.snapshot.facts[47].properties.combined_context=membership("extra");
      await rejectsCode(()=>prepare(combined),"short_story_preparation_context_group_limit");
      const properties128=Object.fromEntries(Array.from({length:128},(_,index)=>["key"+index,index]));
      await prepare(inactive(properties128));await rejectsCode(()=>prepare(inactive({...properties128,extra:0})),limit);
      await prepare(inactive({payload:Array(128).fill(0)}));await rejectsCode(()=>prepare(inactive({payload:Array(129).fill(0)})),limit);
      const facts128=Array.from({length:128},(_,index)=>({...fact("source-"+index,{}),active:false}));
      await prepare({documentTitle:"Field study",snapshot:{facts:facts128}});
      await rejectsCode(()=>prepare({documentTitle:"Field study",snapshot:{facts:[...facts128,{...fact("source-128",{}),active:false}]}}),limit);
      const links=Array.from({length:128},(_,index)=>({relation_id:"relation-"+index,from_block_id:"source-0",to_block_id:"source-1",kind:"contrasts",properties:{}}));
      await prepare({documentTitle:"Field study",snapshot:{facts:facts128.slice(0,2),relationships:links}});
      await rejectsCode(()=>prepare({documentTitle:"Field study",snapshot:{facts:facts128.slice(0,2),relationships:[...links,{...links[0],relation_id:"extra"}]}}),limit);
      const references=Array.from({length:128},(_,index)=>"event-"+index);
      await prepare({documentTitle:"Field study",snapshot:{facts:[{...facts128[0],source_event_refs:references}]}});
      await rejectsCode(()=>prepare({documentTitle:"Field study",snapshot:{facts:[{...facts128[0],source_event_refs:[...references,"extra"]}]}}),limit);
      for(const [at,over] of [
        [inactive({["k".repeat(128)]:0}),inactive({["k".repeat(129)]:0})],
        [inactive({payload:"s".repeat(49152)}),inactive({payload:"s".repeat(49153)})],
        [{...base(),documentTitle:"t".repeat(1024)},{...base(),documentTitle:"t".repeat(1025)}],
        [{documentTitle:"",snapshot:{facts:[{...fact("i".repeat(200),{}),active:false}]}},{documentTitle:"",snapshot:{facts:[{...fact("i".repeat(201),{}),active:false}]}}],
      ]){await prepare(at);await rejectsCode(()=>prepare(over),limit);}
      for(const key of ["document_id","role","intent","handle","effect","authority"]){
        const value=inactive();value.snapshot.facts[0][key]="m".repeat(200);await prepare(value);
        value.snapshot.facts[0][key]+="m";await rejectsCode(()=>prepare(value),limit);
      }
      const relationValue={documentTitle:"Field study",snapshot:{facts:[{...fact("a",{}),active:false},{...fact("b",{}),active:false}],relationships:[{relation_id:"r".repeat(200),from_block_id:"a",to_block_id:"b",kind:"k".repeat(80),properties:{},source_event_refs:["e".repeat(200)]}]}};
      await prepare(relationValue);
      for(const key of ["relation_id","kind"]){const changed=structuredClone(relationValue);changed.snapshot.relationships[0][key]+="x";await rejectsCode(()=>prepare(changed),limit);}
      const tooLongRef=structuredClone(relationValue);tooLongRef.snapshot.relationships[0].source_event_refs[0]+="x";await rejectsCode(()=>prepare(tooLongRef),limit);
      for(const key of ["name","target"]){
        const at=inactive({combined_context:{...membership(0),[key]:"m".repeat(160)}});await prepare(at);
        at.snapshot.facts[0].properties.combined_context[key]+="m";await rejectsCode(()=>prepare(at),limit);
      }
      const sized=(target,multibyte)=>{
        const value=inactive({left:multibyte?"雪".repeat(15000):"",right:""}),props=value.snapshot.facts[0].properties;
        const remaining=target-bytes(JSON.stringify(value));assert.ok(remaining>0);
        const leftAddition=Math.min(49000-props.left.length,remaining);props.left+="a".repeat(leftAddition);props.right="b".repeat(remaining-leftAddition);
        const raw=JSON.stringify(value);assert.equal(bytes(raw),target);return raw;
      };
      for(const multibyte of [false,true]){
        const raw=sized(65536,multibyte);assert.ok(raw.length<=65536);await prepareInitialShortStoryRequest(raw,safety);
        const over=sized(65537,multibyte);if(multibyte)assert.ok(over.length<65536);
        await rejectsCode(()=>prepareInitialShortStoryRequest(over,safety),limit);
      }
      await rejectsCode(()=>prepareInitialShortStoryRequest(" ".repeat(65537),safety),limit);
    });

    await context.test("owned preparation snapshots are deeply frozen and grant no actions",async()=>{
      const value=base(),raw=JSON.stringify(value),pending=prepareInitialShortStoryRequest(raw,safety);
      value.documentTitle="Changed outside";value.snapshot.facts.push(fact("late"));
      const prepared=await pending;
      assert.equal(prepared.capturedInput,raw);assert.equal(JSON.parse(prepared.requestBody).input,JSON.stringify(initialInput()));
      assert.deepEqual(Object.keys(prepared).sort(),["qualification","authorizations","sourceCustody","currentOriginalAuthority","liveRequestParity","requestBody","requestDigest","byteLength","inputAllowance","contextGroupContracts","maximumOutputTokens","formatName","capturedInput"].sort());
      assert.deepEqual(prepared.authorizations,{dispatch:false,settlement:false,publication:false,certifiedRecovery:false});
      assert.equal(prepared.sourceCustody,false);assert.equal(prepared.currentOriginalAuthority,false);assert.equal(prepared.liveRequestParity,false);
      deepFrozen(prepared);assert.throws(()=>{prepared.authorizations.dispatch=true;},TypeError);
      assert.throws(()=>prepared.contextGroupContracts.push({id:"injected",alias:"injected"}),TypeError);
      assert.throws(()=>{prepared.requestBody="mutated";},TypeError);
      assert.equal((await prepare(base())).requestBody,prepared.requestBody);
    });

    await context.test("offline success and capture, serialization or hashing failures attempt no paid effects",async()=>{
      const beforeUuid=uuidCalls,beforeFetch=blockedFetchCalls,effects={credentialReads:0,modelReads:0,callbacks:0};
      const priorKey=Object.getOwnPropertyDescriptor(Object.prototype,"OPENAI_API_KEY"),priorModel=Object.getOwnPropertyDescriptor(Object.prototype,"OPENAI_MODEL");
      const effectStop=new Error("unexpected offline paid effect");
      Object.defineProperty(Object.prototype,"OPENAI_API_KEY",{configurable:true,get(){effects.credentialReads++;throw effectStop;}});
      Object.defineProperty(Object.prototype,"OPENAI_MODEL",{configurable:true,get(){effects.modelReads++;throw effectStop;}});
      try{
        await prepare(base());
        await rejectsCode(()=>prepareInitialShortStoryRequest({get options(){effects.callbacks++;throw effectStop;}},safety),invalid);
        await rejectsCode(()=>prepareInitialShortStoryRequest("{",safety),invalid);
        await rejectsCode(()=>prepare({...base(),options:{onProviderSubmission:"forbidden"}}),invalid);
        const stringify=JSON.stringify;
        for(const phase of ["provider-input","provider-envelope"]){
          const stop=new Error("synthetic "+phase+" serialization failure"),raw=stringify(base());
          JSON.stringify=function(value,...rest){
            if(value&&typeof value==="object"&&(phase==="provider-input"?Object.hasOwn(value,"document_title"):Object.hasOwn(value,"model")&&Object.hasOwn(value,"text")))throw stop;
            return stringify(value,...rest);
          };
          try{await assert.rejects(()=>prepareInitialShortStoryRequest(raw,safety),(error)=>error===stop);}
          finally{JSON.stringify=stringify;}
        }
        const subtle=globalThis.crypto.subtle,ownDigest=Object.getOwnPropertyDescriptor(subtle,"digest"),hashStop=new Error("synthetic pre-capture digest failure");
        Object.defineProperty(subtle,"digest",{configurable:true,writable:true,value:()=>{throw hashStop;}});
        try{await assert.rejects(()=>prepare(base()),(error)=>error===hashStop);}
        finally{if(ownDigest)Object.defineProperty(subtle,"digest",ownDigest);else delete subtle.digest;}
        const freeze=Object.freeze,captureStop=new Error("synthetic final owned capture freeze failure");let finalFreezeAttempts=0;
        Object.freeze=function(value){
          const qualification=value&&typeof value==="object"?Object.getOwnPropertyDescriptor(value,"qualification"):null;
          if(qualification&&Object.hasOwn(qualification,"value")&&qualification.value==="offline-initial-preparation-only"){finalFreezeAttempts++;throw captureStop;}
          return freeze(value);
        };
        try{await assert.rejects(()=>prepare(base()),(error)=>error===captureStop);assert.equal(finalFreezeAttempts,1);}
        finally{Object.freeze=freeze;}
      }finally{
        if(priorKey)Object.defineProperty(Object.prototype,"OPENAI_API_KEY",priorKey);else delete Object.prototype.OPENAI_API_KEY;
        if(priorModel)Object.defineProperty(Object.prototype,"OPENAI_MODEL",priorModel);else delete Object.prototype.OPENAI_MODEL;
        assert.deepEqual(effects,{credentialReads:0,modelReads:0,callbacks:0});assert.equal(uuidCalls,beforeUuid);assert.equal(blockedFetchCalls,beforeFetch);
      }
    });

    await context.test("public fifth arguments reject as Promises before any property read",async()=>{
      const reads={environment:0,input:0,fifth:0,capture:0};
      const env=new Proxy({},{get(){reads.environment++;throw new Error("environment read");}});
      const input=new Proxy({},{get(){reads.input++;throw new Error("input read");}});
      const fifth=new Proxy({},{get(){reads.fifth++;throw new Error("fifth getter");},ownKeys(){reads.fifth++;throw new Error("fifth keys");},getOwnPropertyDescriptor(){reads.fifth++;throw new Error("fifth descriptor");}});
      const beforeUuid=uuidCalls,beforeFetch=blockedFetchCalls;
      for(const supplied of [null,false,0,"",Symbol("mode"),()=>{},[],{},fifth,{candidateRaw:"{}",candidateIssues:[],capture(){reads.capture++;throw new Error("forged capture");}}]){
        let pending;assert.doesNotThrow(()=>{pending=generateDocumentArtifact(env,"synthetic","short_story",input,supplied);});
        assert.ok(pending instanceof Promise);await rejectsCode(()=>pending,"document_artifact_preparation_not_public");
      }
      assert.deepEqual(reads,{environment:0,input:0,fifth:0,capture:0});assert.equal(uuidCalls,beforeUuid);assert.equal(blockedFetchCalls,beforeFetch);
    });

    await context.test("ordinary four-argument delegation preserves check order and original errors",async()=>{
      const trace=[],keyStop=new Error("synthetic credential getter"),inputStop=new Error("synthetic options getter");
      const input=new Proxy({},{get(){trace.push("input");throw inputStop;}});
      const env=new Proxy({},{get(_target,key){trace.push(String(key));throw keyStop;}});
      let pending;assert.doesNotThrow(()=>{pending=generateDocumentArtifact(env,"synthetic","short_story",input);});
      assert.ok(pending instanceof Promise);assert.deepEqual(trace,["OPENAI_API_KEY"]);
      await assert.rejects(()=>pending,(error)=>error===keyStop);
      trace.length=0;await assert.rejects(()=>generateDocumentArtifact(env,"synthetic","model3d",input),/model3d_dedicated_adapter_required/u);assert.deepEqual(trace,[]);
      await assert.rejects(()=>generateDocumentArtifact({},"synthetic","short_story",input),/provider_not_configured/u);assert.deepEqual(trace,[]);
      assert.doesNotThrow(()=>{pending=generateDocumentArtifact({OPENAI_API_KEY:"synthetic"},"synthetic","short_story",input,undefined);});
      assert.deepEqual(trace,["input"]);await assert.rejects(()=>pending,(error)=>error===inputStop);
    });

    await context.test("legacy source activity stays outside the offline C2 input rules",async()=>{
      // These two source shapes intentionally remain legacy-only; C2 must not
      // turn its narrower supplied-context profile into live consent policy.
      const sources=[{...fact("legacy-kind",{text:"Legacy free-form source type"}),type:"text"},
        {...fact("legacy-audio",{text:"Legacy opted-in authored sound",inform_generation:true,source_mime_type:"audio/wav",media_url:"/synthetic/legacy.wav"}),type:"audio"}];
      for(const source of sources)await rejectsCode(()=>prepare({documentTitle:"Field study",snapshot:{facts:[source],relationships:[]}}),invalid);
      const previousFetch=globalThis.fetch,observerErrors=[],beforeUuid=uuidCalls;let fetched=0;
      globalThis.fetch=async(url,init)=>{
        try{
          fetched++;assert.equal(url,"https://api.openai.com/v1/responses");assert.equal(typeof init.body,"string");
          const request=JSON.parse(init.body),input=JSON.parse(request.input);
          assert.equal(request.text.format.name,"document_short_story");assert.equal(input.creative_context.facts.length,2);
          assert.deepEqual(input.creative_context.facts.map(({type})=>type),["text","audio"]);
          assert.deepEqual(input.creative_context.facts.map(({properties})=>properties.text),["Legacy free-form source type","Legacy opted-in authored sound"]);
          return syntheticResponse(request,JSON.stringify(story),"legacy-source-activity");
        }catch(error){observerErrors.push(error);throw error;}
      };
      try{
        const result=await generateDocumentArtifact({OPENAI_API_KEY:"synthetic"},"synthetic","short_story",{documentTitle:"Field study",snapshot:{facts:sources,relationships:[]},options:{itemCount:1}});
        assert.equal(result.inputReceipt.validation.repair_attempted,false);assert.equal(fetched,1);assert.equal(uuidCalls-beforeUuid,1);
      }finally{globalThis.fetch=previousFetch;assert.deepEqual(observerErrors,[],"legacy source observer failures remain sticky");}
    });

    await context.test("trusted same-file Slides preparation retains initial and repair modes",async()=>{
      const beforeUuid=uuidCalls,beforeFetch=blockedFetchCalls;
      const input={...base(),options:{itemCount:1}},candidate=structuredClone(deck);
      candidate.items[0].body=candidate.items[0].slide.visual.value;
      const raw=JSON.stringify(candidate),initial=await preparePresentationComparisonRequest({},"synthetic-live-user",input);
      const repair=await preparePresentationComparisonRequest({},"synthetic-live-user",input,raw);
      assert.equal(initial.phase,"composition");assert.equal(initial.candidateDigest,null);assert.deepEqual(initial.candidateIssues,[]);
      assert.equal(repair.phase,"validation-repair");assert.equal(repair.candidateDigest,digest(raw));
      assert.ok(repair.candidateIssues.some(issue=>issue.code==="duplicate_slide_copy"));
      for(const prepared of [initial,repair]){
        const wire=JSON.parse(prepared.requestBody);
        assert.equal(prepared.requestDigest,digest(prepared.requestBody));assert.equal(prepared.maximumInputTokens,bytes(prepared.requestBody)+4096);
        assert.equal(prepared.maximumOutputTokens,6500);assert.equal(wire.text.format.schema.properties.items.minItems,1);assert.equal(wire.text.format.schema.properties.items.maxItems,1);
        assert.equal(Object.hasOwn(wire,"truncation"),false);assert.equal(wire.safety_identifier,liveSafety("synthetic-live-user"));
      }
      assert.equal(JSON.parse(initial.requestBody).text.format.name,"document_slides");
      const repairWire=JSON.parse(repair.requestBody);assert.equal(repairWire.text.format.name,"document_slides_repair");assert.equal(JSON.parse(repairWire.input).original_artifact,raw);
      await assert.rejects(()=>preparePresentationComparisonRequest({},"synthetic-live-user",input,JSON.stringify(deck)),/comparison_candidate_has_no_editorial_issue/u);
      let callbacks=0;await assert.rejects(()=>preparePresentationComparisonRequest({},"synthetic-live-user",{...input,options:{itemCount:1,onProviderSubmission(){callbacks++;}}}));
      assert.equal(callbacks,0);assert.equal(uuidCalls,beforeUuid);assert.equal(blockedFetchCalls,beforeFetch);
    });

    await context.test("legacy non-Slides initial and repair retain independent raw-envelope expectations",async()=>{
      const beforeUuid=uuidCalls,{result,requests,trace,submissions}=await legacy("short_story");
      assert.equal(requests.length,2);assert.equal(uuidCalls-beforeUuid,2);assert.deepEqual(result.usage,{inputTokens:200,outputTokens:100,totalTokens:300});
      const expectedInitial=initialInput(),expectedRepair={...initialInput(),original_artifact:"{}",validation_issues:[invalidArtifact]};
      for(const [index,expected] of [expectedInitial,expectedRepair].entries()){
        const {raw,request}=requests[index],name=index?"document_short_story_repair":"document_short_story";
        assert.deepEqual(request.text.format.schema,schema(12));assert.equal(request.input,JSON.stringify(expected));
        assert.equal(raw,envelope(request.instructions,JSON.stringify(expected),schema(12),name,{identifier:liveSafety("synthetic-live-user")}));
        assert.deepEqual(Object.keys(request),["model","instructions","input","text","reasoning","max_output_tokens","store","safety_identifier"]);
        for(const key of ["service_tier","prompt_cache_options","truncation","tools","stream","background"])assert.equal(Object.hasOwn(request,key),false,key);
      }
      assert.match(requests[0].request.instructions,/Write a polished short story, not a treatment\./u);
      assert.match(requests[1].request.instructions,/Repair the complete structured short story artifact/u);
      assert.deepEqual(trace,["before:initial","submission:pending:initial","dispatch:initial","fetch:initial","response:initial","submission:completed:initial","attempt:initial","before:repair","submission:pending:repair","dispatch:repair","fetch:repair","response:repair","submission:completed:repair","attempt:repair"]);
      assert.deepEqual(submissions.filter(call=>call.status==="completed").map(call=>call.responseRef),["synthetic-stored-initial","synthetic-stored-repair"]);
      const offline=await prepare(base());assert.deepEqual(JSON.parse(offline.requestBody).text.format.schema,schema(1));
      assert.equal(JSON.parse(offline.requestBody).instructions,requests[0].request.instructions,"both paths share genuine initial prompt construction");
    });

    await context.test("legacy Slides initial and repair retain route fields and callback ordering",async()=>{
      const {result,requests,trace,submissions}=await legacy("slides");assert.equal(requests.length,2);assert.equal(result.inputReceipt.validation.repair_attempted,true);
      for(const [index,{raw,request}] of requests.entries()){
        const outputSchema=request.text.format.schema;
        assert.deepEqual(Object.keys(request),["model","instructions","input","text","reasoning","max_output_tokens","store","safety_identifier","service_tier","prompt_cache_options"]);
        assert.deepEqual(outputSchema.required,["title","summary","content_markdown","items","presentation"]);
        assert.deepEqual(outputSchema.properties.items.items.required,["title","body","notes","image_prompt","context_group_ids","slide"]);
        assert.equal(outputSchema.properties.title.minLength,1);assert.equal(outputSchema.properties.content_markdown.minLength,1);assert.equal(outputSchema.properties.items.items.properties.title.minLength,1);
        assert.equal(outputSchema.properties.items.minItems,1);assert.equal(outputSchema.properties.items.maxItems,1);assert.equal(outputSchema.additionalProperties,false);
        assert.equal(raw,envelope(request.instructions,request.input,outputSchema,index?"document_slides_repair":"document_slides",{model:index?"gpt-5.6-sol":"gpt-5.6-terra",effort:index?"high":"medium",maximum:6500,identifier:liveSafety("synthetic-live-user"),slides:true}));
        assert.equal(Object.hasOwn(request,"truncation"),false);assert.equal(Object.hasOwn(request,"tools"),false);
      }
      const first=JSON.parse(requests[0].request.input),second=JSON.parse(requests[1].request.input);
      assert.deepEqual(Object.keys(first),["document_title","creative_context","combined_context_plan","audience","tone","presentation_source"]);
      assert.equal(first.document_title,"Field study");assert.deepEqual(first.creative_context,{facts:[],relationships:[]});assert.deepEqual(first.combined_context_plan,[]);assert.equal(first.audience,"general");assert.equal(first.tone,"derived from the document");
      assert.deepEqual(Object.keys(second),["document_title","audience","tone","original_artifact","validation_issues","required_context_groups","original_creative_context","presentation_source"]);
      assert.equal(second.document_title,"Field study");assert.equal(second.audience,"general");assert.equal(second.tone,"derived from the document");assert.equal(second.original_artifact,"{}");
      assert.deepEqual(second.validation_issues,[invalidArtifact]);assert.deepEqual(second.required_context_groups,[]);assert.deepEqual(second.original_creative_context,{facts:[],relationships:[]});assert.deepEqual(second.presentation_source,first.presentation_source);
      assert.deepEqual(trace,["before:initial","submission:pending:initial","dispatch:initial","fetch:initial","response:initial","submission:completed:initial:pending","attempt:initial","submission:completed:initial:invalid","before:repair","submission:pending:repair","dispatch:repair","fetch:repair","response:repair","submission:completed:repair:pending","attempt:repair","submission:completed:repair:valid"]);
      assert.equal(submissions.length,6);assert.equal(submissions.filter(call=>call.status==="pending").length,2);
    });

    await context.test("final synchronous dispatch guard remains adjacent to fetch and retains failure ordering",async()=>{
      const previousFetch=globalThis.fetch,observerErrors=[];
      try{
        const trace=[];let queued=false,fetches=0;
        globalThis.fetch=async(_url,init)=>{
          try{trace.push("fetch");fetches++;assert.equal(queued,false);assert.deepEqual(trace,["dispatch","fetch"]);return syntheticResponse(JSON.parse(init.body),JSON.stringify(story),"adjacency");}
          catch(error){observerErrors.push(error);throw error;}
        };
        await generateDocumentArtifact({OPENAI_API_KEY:"synthetic"},"synthetic","short_story",{...base(),options:{itemCount:1,onBeforeProviderDispatch(){trace.push("dispatch");queueMicrotask(()=>{queued=true;trace.push("microtask");});}}});
        assert.equal(fetches,1);assert.deepEqual(trace,["dispatch","fetch","microtask"]);
        for(const phase of ["before","pending","dispatch","repair-dispatch"]){
          const stop=new Error("synthetic "+phase+" stop"),events=[],calls=[];let sent=0;
          globalThis.fetch=async(_url,init)=>{sent++;events.push("fetch");return syntheticResponse(JSON.parse(init.body),"{}","stop-"+sent);};
          await assert.rejects(()=>generateDocumentArtifact({OPENAI_API_KEY:"synthetic"},"synthetic","short_story",{...base(),options:{
            itemCount:1,
            onBeforeProviderAttempt(){events.push("before");if(phase==="before")throw stop;},
            onProviderSubmission(call){calls.push({...call});events.push(call.status);if(phase==="pending"&&call.status==="pending")throw stop;},
            onBeforeProviderDispatch(){events.push("dispatch");if(phase==="dispatch"||phase==="repair-dispatch"&&sent===1)throw stop;},
          }}),(error)=>error===stop);
          assert.equal(sent,phase==="repair-dispatch"?1:0);
          assert.equal(calls.some(call=>call.status==="rejected"),false,"a local stop is never a zero-price provider rejection");
          if(phase==="before")assert.deepEqual(events,["before"]);
          if(phase==="pending")assert.deepEqual(events,["before","pending"]);
          if(phase==="dispatch")assert.deepEqual(events,["before","pending","dispatch"]);
          if(phase==="repair-dispatch")assert.deepEqual(events,["before","pending","dispatch","fetch","completed","before","pending","dispatch"]);
        }
        const responseStop=new Error("synthetic response persistence failure"),events=[];let calls=0;
        globalThis.fetch=async(_url,init)=>{calls++;events.push("fetch");return syntheticResponse(JSON.parse(init.body),JSON.stringify(story),"retention-failure");};
        await assert.rejects(()=>generateDocumentArtifact({OPENAI_API_KEY:"synthetic"},"synthetic","short_story",{...base(),options:{
          itemCount:1,onProviderSubmission(call){events.push(call.status);},
          onProviderResponse(){events.push("response");throw responseStop;},onProviderAttempt(){events.push("attempt");},
        }}),(error)=>{assert.notEqual(error,responseStop);assert.match(error.preparedPrompt,/Document short_story instructions:/u);return true;});
        assert.equal(calls,1);assert.deepEqual(events,["pending","fetch","response","completed"]);
      }finally{globalThis.fetch=previousFetch;assert.deepEqual(observerErrors,[],"an observer assertion cannot be hidden by adapter error handling");}
    });

    await context.test("all fact text and label fields require primitive strings without changing authored content",async()=>{
      const beforeIds=uuidCalls;
      const authored={text:"  Élan stays exact: "+"x".repeat(180)+"\n  ",label:" \tA held label: "+"y".repeat(180)+"  \n",details:{cadence:"Sparse"}};
      assert.ok(authored.text.length>160&&authored.label.length>160);
      const value={...base(),snapshot:{facts:[fact("r2-authored-source",authored)],relationships:[]}};
      const prepared=await prepare(value),payload=JSON.parse(JSON.parse(prepared.requestBody).input);
      assert.equal(payload.creative_context.facts.length,1);
      assert.deepEqual(payload.creative_context.facts[0].properties,authored,"source strings are not coerced, trimmed or limited to group-label length");
      assert.equal(prepared.capturedInput,JSON.stringify(value));
      for(const properties of [{},{text:""},{label:""},{text:" \t\n ",label:"  \n\t"}]){
        const optional={...base(),snapshot:{facts:[fact("optional-fields",properties)],relationships:[]}};
        const result=await prepare(optional),projected=JSON.parse(JSON.parse(result.requestBody).input).creative_context.facts;
        assert.equal(projected.length,1);assert.deepEqual(projected[0].properties,properties);
      }
      const malformed=[null,0,false,[],{}, {toString:"not callable"}];
      for(const field of ["text","label"]){
        for(const supplied of malformed){
          for(const activity of ["active","fact-inactive","removed","properties-inactive","zero-weight"]){
            const row=fact("typed-source",{[field]:supplied});
            if(activity==="fact-inactive")row.active=false;
            if(activity==="removed")row.removed=true;
            if(activity==="properties-inactive")row.properties.active=false;
            if(activity==="zero-weight")row.properties.weight=0;
            const input={...base(),snapshot:{facts:[row],relationships:[]}};
            await rejectsCode(()=>prepare(input),invalid);
          }
        }
        const boundary=inactive({[field]:"z".repeat(49152)});
        const accepted=await prepare(boundary);
        assert.deepEqual(JSON.parse(JSON.parse(accepted.requestBody).input).creative_context.facts,[]);
        assert.equal(accepted.capturedInput,JSON.stringify(boundary));
        boundary.snapshot.facts[0].properties[field]+="z";
        await rejectsCode(()=>prepare(boundary),limit);
      }
      assert.equal(uuidCalls,beforeIds,"text and label validation has no call-identity allocation");
    });

    await context.test("reference selectors reject recursively without dropping valid neighboring context",async()=>{
      const beforeIds=uuidCalls;
      const selectors=["block_references","blockReferences","subject_block_id","subjectBlockId"];
      const neighbor=()=>({...base(),snapshot:{facts:[
        fact("source-message",{text:"  A reed moves.  ",label:"Reed",details:{note:"Still"},sequence:[{note:"After"}]}),
        {...fact("source-subject",{text:"A copper reed.",label:"Subject"}),type:"subject"},
      ],relationships:[]}});
      for(const key of selectors){
        const supplied=key==="block_references"||key==="blockReferences"?[{handle:"@subject",role:"subject"}]:"source-subject";
        for(const placement of ["direct","nested-object","nested-array"]){
          const control=neighbor(),prepared=await prepare(control);
          const projected=JSON.parse(JSON.parse(prepared.requestBody).input).creative_context.facts;
          assert.equal(projected.length,2);
          assert.deepEqual(projected.map(row=>row.properties),control.snapshot.facts.map(row=>row.properties));
          assert.equal(prepared.capturedInput,JSON.stringify(control));
          const changed=JSON.parse(JSON.stringify(control)),properties=changed.snapshot.facts[0].properties;
          if(placement==="direct")properties[key]=supplied;
          if(placement==="nested-object")properties.details[key]=supplied;
          if(placement==="nested-array")properties.sequence[0][key]=supplied;
          await rejectsCode(()=>prepare(changed),invalid);
        }
        const presentFalse=neighbor();presentFalse.snapshot.facts[0].properties.details[key]=false;
        await rejectsCode(()=>prepare(presentFalse),invalid);
      }
      assert.equal(uuidCalls,beforeIds,"unsupported references cannot allocate a call identity");
    });
    assert.equal(blockedFetchCalls,0,"only explicitly installed synthetic transports may be attempted");
  }finally{
    globalThis.fetch=originalFetch;
    if(uuidDescriptor)Object.defineProperty(globalThis.crypto,"randomUUID",uuidDescriptor);else delete globalThis.crypto.randomUUID;
  }
});
