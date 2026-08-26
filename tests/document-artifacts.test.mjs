import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applySlideStylePreset, defaultSlidePresentation, documentArtifactValidationIssues, DOCUMENT_ARTIFACT_KINDS, normalizeSlideDeckItems, normalizeSlideItem, normalizeSlidePresentation, normalizeSlideVisual, parseDocumentArtifactContent, resolveDocumentArtifactContextGroups, SLIDE_LAYOUTS, SLIDE_STYLE_PRESETS, SLIDE_VISUAL_KINDS, slideCopyIsDistinct, slideCopyIsNearDuplicate, slideCopyIssues, slideDeckCopyIsDistinct, slideDeckCopyIssues, slidePrecisionIssues, slideSourceIds, slideVisualIsComplete } from "../src/model/document-artifacts.ts";
import { isVideoDurationSeconds, normalizeVideoDurationSeconds, VIDEO_ADAPTER_CONTRACT, VIDEO_DURATION_SECONDS } from "../src/model/video-adapter.ts";
import { buildPresentationSourceContract } from "../src/model/presentation-source.ts";
import { selectArtifactProductionKind } from "../src/model/managed-production.ts";
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
  globalThis.fetch=async(_input,init={})=>{const request=JSON.parse(String(init.body));requests.push(request);const output=requests.length===1?incomplete:repaired;return Response.json({id:`response-${requests.length}`,model:"gpt-test",output_text:JSON.stringify(output),usage:{input_tokens:100,output_tokens:50,total_tokens:150}});};
  try{const result=await generateDocumentArtifact({OPENAI_API_KEY:"test",OPENAI_MODEL:"gpt-test"},"user-1","slides",{documentTitle:"Field study",snapshot:{facts:[],relationships:[]},options:{itemCount:1,locale:"ja-JP"}});assert.equal(requests.length,2);for(const request of requests){assert.match(request.instructions,/selected language \(ja-JP\)/);assert.match(request.instructions,/Preserve the original language and exact text of user-authored document titles/);assert.equal(JSON.parse(request.input).document_title,"Field study");}assert.equal(requests[1].text.format.name,"document_slides_repair");assert.equal(result.output.items[0]?.title,"Protect the opening");assert.equal(result.inputReceipt.validation.repair_attempted,true);assert.ok(result.inputReceipt.validation.initial_issues.some((issue)=>issue.code==="missing_title"));assert.deepEqual(result.inputReceipt.validation.repair_issues,[]);assert.deepEqual(result.usage,{inputTokens:200,outputTokens:100,totalTokens:300});}
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
    return Response.json({id:"locally-repaired-pitch",model:"gpt-test",output_text:JSON.stringify(generated),usage:{input_tokens:100,output_tokens:50,total_tokens:150}});
  };

  try{
    const result=await generateDocumentArtifact({OPENAI_API_KEY:"test",OPENAI_MODEL:"gpt-test"},"user-1","slides",{
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
    assert.equal(validation.adapter_reconciliation.adapter_version,"2026-08-26-validated-self-healing-v3");
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
  assert.match(component,/#selectArtifactKind\(kind:DocumentArtifactKind\)\{const selected=selectArtifactProductionKind/);
  assert.match(component,/openRender\([^)]*\)\{[^}]*if\(kind\)this\.#selectArtifactKind\(kind\)/);
  assert.match(component,/name="artifact-kind"[^\n]*@change=\$\{\(\)=>\{this\.#selectArtifactKind\(kind\)/);
  assert.match(component,/value="manual"[^\n]*@change=\$\{\(\)=>\{this\.#productionMode="manual";(?:this\.#sendSoundtrackToVideoProvider=false;)?this\.#storyboardManagedDefault=false/);
  assert.match(component,/value="manual"[^\n]*@change=\$\{\(\)=>\{this\.#productionMode="manual";this\.#sendSoundtrackToVideoProvider=false;/,"switching to manual production must revoke soundtrack-provider transfer consent");
  assert.match(component,/value="managed"[^\n]*@change=\$\{\(\)=>\{this\.#productionMode="managed";this\.#sendSoundtrackToVideoProvider=false;/,"switching to managed production must revoke soundtrack-provider transfer consent");
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
