import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applySlideStylePreset, DOCUMENT_ARTIFACT_KINDS } from "../src/model/document-artifacts.ts";
import { foldEvents } from "../src/model/events.ts";
import { artifactContextEvents, imageOutputContextEvents } from "../src/model/output-context.ts";
import { outputBlockRemovalEvents, outputBlockTextEditEvents, outputFrameEditEvents, outputInputDraft, outputInputEditEvents, serializeOutputInputDraft } from "../src/model/output-authoring.ts";
import { providerFacingCreativeContext, providerFacingRenderingContext } from "../src/model/prompt-policy.ts";
import { applyRichTextFormat, RICH_TEXT_FORMATS } from "../src/model/rich-text.ts";
import { videoReferencePreflight } from "../src/model/video-references.ts";

const event=(sequence,type,payload,actor="user")=>({eventId:`event-${sequence}`,streamId:"output-authoring",sequence,occurredAt:"2026-08-22T12:00:00.000Z",recordedAt:"2026-08-22T12:00:00.000Z",actor,clientId:"test",correlationId:`correlation-${sequence}`,causationId:null,compensatesEventId:null,schemaVersion:1,type,payload});
const ids=(prefix="input")=>{let index=0;return()=>`${prefix}-${++index}`;};
const slide=()=>({layout:"split",kicker:"The argument",bullets:["First point","Second point"],visual:{kind:"bars",label:"Confidence",value:"82%",data:[{label:"Confidence",value:"82%",weight:.82}]}});
const item=(index,kind)=>({id:`source-item-${index}`,title:`Original section ${index}`,body:`Receipt fallback ${index}`,notes:`Receipt notes ${index}`,imagePrompt:`Receipt image ${index}`,contextGroupIds:[],mediaUrl:kind==="storyboard"?`/api/media/frame-${index}.jpg`:null,mediaType:kind==="storyboard"?"image/jpeg":null,width:kind==="storyboard"?1024:null,height:kind==="storyboard"?768:null,focalPoint:null,slide:kind==="slides"?slide():null});
const artifact=(kind,count=2)=>({id:`artifact-${kind}`,documentId:"original-document",kind,title:`Original ${kind}`,summary:`Original ${kind} summary`,contentRef:`retained-${kind}`,inputRef:`private-${kind}`,itemCount:count,items:Array.from({length:count},(_,index)=>item(index+1,kind)),mediaUrl:kind==="video"?"/api/media/video.mp4":null,mediaType:kind==="video"?"video/mp4":null,provider:"provider",modelId:"model",latency:1200,sequence:7,library:false,sourceEventId:"source-event",sourceSurface:"document",settings:{},presentation:kind==="slides"?applySlideStylePreset(null,"gallery"):null});
const content=(source,overrides={})=>({title:source.title,summary:source.summary,content_markdown:`# ${source.title}\n\nThe complete retained manuscript.`,presentation:source.presentation,items:source.items.map((entry,index)=>({title:`Authored section ${index+1}`,body:`Complete authored body ${index+1}`,notes:`Camera or speaker notes ${index+1}`,image_prompt:`Visible image direction ${index+1}`,context_group_ids:[],slide:entry.slide})),...overrides});
const options=(prefix="input")=>({documentId:"destination",projectId:"project",sourceSurface:"test",positionStart:20,idFactory:ids(prefix)});
const materialize=(...inputs)=>{const rows=[event(1,"ProjectCreated",{project_id:"project",name:"Output authoring"}),event(2,"DocumentCreated",{project_id:"project",document_id:"destination",title:"Destination"}),...inputs.flat().map((input,index)=>event(index+3,input.type,input.payload))];return{rows,projection:foldEvents(rows,Number.POSITIVE_INFINITY,"destination")};};
const append=(state,inputs)=>{const rows=[...state.rows,...inputs.map((input,index)=>event(state.rows.length+index+1,input.type,input.payload))];return{rows,projection:foldEvents(rows,Number.POSITIVE_INFINITY,"destination")};};
const root=(state,sourceId)=>state.projection.blocks.find((block)=>block.properties.source_artifact_id===sourceId&&!block.properties.source_artifact_item_id);
const owned=(state,rootBlock)=>{const relationIds=new Set(state.projection.blockRelations.filter((relation)=>relation.kind==="artifact_contains"&&relation.fromBlockId===rootBlock.id).map((relation)=>relation.toBlockId));return state.projection.blocks.filter((block)=>block.id===rootBlock.id||relationIds.has(block.id));};

test("every generated document format becomes a complete, independently editable input",()=>{
  for(const kind of DOCUMENT_ARTIFACT_KINDS){
    const source=artifact(kind),snapshot=structuredClone(source),created=artifactContextEvents(source,{...options(kind),content:content(source)}),state=materialize(created.events),input=root(state,source.id),draft=outputInputDraft(input);
    assert.ok(draft,kind);assert.equal(draft.kind,kind);assert.equal(draft.markdown,content(source).content_markdown);assert.deepEqual(draft.items.map((entry)=>entry.source_artifact_item_id),["source-item-1","source-item-2"]);
    const next={...draft,title:`Customized ${kind}`,summary:"A revised summary",items:draft.items.map((entry,index)=>index?entry:{...entry,notes:"A carefully revised visible note"})};
    const changed=append(state,outputInputEditEvents(input,owned(state,input),next));const revised=root(changed,source.id),authored=outputInputDraft(revised);
    assert.equal(authored.title,`Customized ${kind}`);assert.equal(authored.items[0].notes,"A carefully revised visible note");assert.match(revised.properties.text,/carefully revised visible note/);assert.deepEqual(source,snapshot);
  }
});

test("managed video reels keep every ordered scene through receipt projection, adoption, editing, and provider-safe reuse",()=>{
  const receipt={type:"DocumentRenderCompleted",payload:{artifact_id:"managed-film",artifact_kind:"video",document_id:"destination",project_id:"project",title:"A complete film",summary:"Three authored scenes",item_count:3,media_url:"/api/media/owner%2Fscene-1.mp4",media_type:"video/mp4",items:Array.from({length:3},(_,index)=>({id:`clip-${index+1}`,title:`Original shot ${index+1}`,media_url:`/api/media/owner%2Fscene-${index+1}.mp4`,media_type:"video/mp4",scene_id:`private-scene-${index+1}`,narrative_order:index+1,generation_order:3-index,duration_seconds:5+index}))}};
  const projected=materialize([receipt]).projection.artifacts[0];assert.deepEqual(projected.items.map((entry)=>[entry.sceneId,entry.narrativeOrder,entry.generationOrder,entry.durationSeconds]),[["private-scene-1",1,3,5],["private-scene-2",2,2,6],["private-scene-3",3,1,7]]);
  const original=structuredClone(projected),authored=content(projected),adopted=artifactContextEvents(projected,{...options("managed-film"),content:authored}),state=materialize(adopted.events),input=root(state,projected.id),draft=outputInputDraft(input);
  const children=state.projection.blocks.filter((block)=>block.properties.source_artifact_item_id);assert.equal(children.length,3);assert.ok(children.every((block)=>block.type==="motion"));assert.equal(state.projection.blockRelations.filter((relation)=>relation.kind==="artifact_contains"&&relation.fromBlockId===input.id).length,3);assert.ok(!adopted.events.some((row)=>row.type==="ReferenceIngested"),"video bytes cannot silently become an image-pixel reference");
  assert.deepEqual(draft.items.map((entry)=>entry.media_url),["/api/media/owner%2Fscene-1.mp4","/api/media/owner%2Fscene-2.mp4","/api/media/owner%2Fscene-3.mp4"]);assert.deepEqual(draft.items.map((entry)=>entry.duration_seconds),[5,6,7]);
  draft.items[1]={...draft.items[1],title:"A carefully revised second scene",notes:"Keep the rain just beyond the door."};const changed=append(state,outputInputEditEvents(input,owned(state,input),draft)),revised=root(changed,projected.id),persisted=outputInputDraft(revised);const secondChild=changed.projection.blocks.find((block)=>block.properties.source_artifact_item_id==="clip-2");assert.equal(secondChild.properties.video_scene_title,"A carefully revised second scene");assert.equal(secondChild.properties.video_scene_camera_direction,"Keep the rain just beyond the door.");
  assert.deepEqual(persisted.items.map((entry)=>entry.media_url),draft.items.map((entry)=>entry.media_url));assert.deepEqual(persisted.items.map((entry)=>entry.scene_id),["private-scene-1","private-scene-2","private-scene-3"]);assert.deepEqual(persisted.items.map((entry)=>entry.narrative_order),[1,2,3]);assert.equal(persisted.items[1].title,"A carefully revised second scene");assert.match(serializeOutputInputDraft(persisted),/Scene duration: 6 seconds/);assert.deepEqual(projected,original);
  const snapshot={facts:[{block_id:revised.id,type:revised.type,properties:revised.properties}]};for(const sanitized of [providerFacingCreativeContext(snapshot),providerFacingRenderingContext(snapshot)]){const text=JSON.stringify(sanitized);assert.doesNotMatch(text,/\/api\/media\/|private-scene-|generation_order/);assert.match(text,/duration_seconds/);assert.match(text,/A carefully revised second scene/);}
  assert.equal(videoReferencePreflight(changed.projection.blocks,changed.rows).providerPixelCount,0);
});

test("multi-section manuscripts survive later metadata edits, real headings, and long-form prose",()=>{
  const source=artifact("short_story",3),initial=materialize(artifactContextEvents(source,{...options("story"),content:content(source)}).events),original=root(initial,source.id);
  const manuscript=`# An entirely different title\n\n${"Exact long-form prose. ".repeat(160)}\n\n## Supporting creative direction\n\nThis heading belongs to the author's actual story.`;
  let state=append(initial,outputInputEditEvents(original,owned(initial,original),{...outputInputDraft(original),markdown:manuscript}));
  let revised=root(state,source.id);assert.equal(outputInputDraft(revised).markdown,manuscript);assert.ok(outputInputDraft(revised).markdown.length>1200);
  const next={...outputInputDraft(revised),title:"A separately revised title",items:outputInputDraft(revised).items.map((entry,index)=>index===1?{...entry,notes:"A later continuity correction"}:entry)};
  state=append(state,outputInputEditEvents(revised,owned(state,revised),next));revised=root(state,source.id);
  assert.equal(outputInputDraft(revised).markdown,manuscript);assert.match(revised.properties.text,/A later continuity correction/);assert.match(revised.properties.text,/author's actual story/);assert.equal(source.title,"Original short_story");
});

test("intentional empty authored fields and cleared manuscripts never resurrect receipt fallback",()=>{
  const source=artifact("scene"),authored=content(source);authored.items[0]={...authored.items[0],title:"",body:"",notes:"",image_prompt:""};
  const state=materialize(artifactContextEvents(source,{...options("clear"),content:authored}).events),input=root(state,source.id),draft=outputInputDraft(input);
  assert.deepEqual({...draft.items[0],source_artifact_item_id:undefined,context_group_ids:undefined,slide:undefined},{source_artifact_item_id:undefined,title:"",body:"",notes:"",image_prompt:"",context_group_ids:undefined,slide:undefined});
  const cleared=append(state,outputInputEditEvents(input,owned(state,input),{...draft,markdown:"",summary:"",items:draft.items.map((entry,index)=>index===1?{...entry,title:"",body:"",notes:"",image_prompt:""}:entry)}));const result=outputInputDraft(root(cleared,source.id));
  assert.equal(result.markdown,"");assert.equal(result.summary,"");assert.equal(result.items[1].body,"");assert.equal(result.items[1].image_prompt,"");
});

test("storyboard root and frame edits remain synchronized without touching another same-source fork",()=>{
  const source=artifact("storyboard"),first=artifactContextEvents(source,{...options("first"),content:content(source)}),second=artifactContextEvents(source,{...options("second"),content:content(source),positionStart:60});
  let state=materialize(first.events,second.events);const firstRoot=state.projection.blocks.find((block)=>block.id===first.blockIds[0]),secondRoot=state.projection.blocks.find((block)=>block.id===second.blockIds[0]);
  const firstFrames=owned(state,firstRoot).filter((block)=>block.id!==firstRoot.id),secondFrames=owned(state,secondRoot).filter((block)=>block.id!==secondRoot.id);
  const draft=outputInputDraft(firstRoot);draft.title="An independently edited storyboard";draft.items[0]={...draft.items[0],body:"A private dusk close-up",notes:"Slow leftward camera move",image_prompt:"Sodium streetlight at dusk"};
  const edits=outputInputEditEvents(firstRoot,owned(state,firstRoot),draft);assert.ok(edits.every((input)=>owned(state,firstRoot).some((block)=>block.id===input.payload.block_id)));state=append(state,edits);
  let frame=state.projection.blocks.find((block)=>block.id===firstFrames[0].id),untouched=state.projection.blocks.find((block)=>block.id===secondFrames[0].id);
  assert.equal(frame.properties.storyboard_shot_direction,"A private dusk close-up");assert.equal(frame.properties.storyboard_camera_direction,"Slow leftward camera move");assert.equal(frame.properties.storyboard_frame_prompt,"Sodium streetlight at dusk");assert.equal(untouched.properties.storyboard_shot_direction,"Complete authored body 1");
  assert.equal(videoReferencePreflight([frame],state.rows).storyboardItems[0].shotDirection,"A private dusk close-up");
  const changed=outputFrameEditEvents(frame,owned(state,state.projection.blocks.find((block)=>block.id===firstRoot.id)),"A hand-edited dawn tracking shot");state=append(state,changed);frame=state.projection.blocks.find((block)=>block.id===firstFrames[0].id);
  assert.equal(outputInputDraft(state.projection.blocks.find((block)=>block.id===firstRoot.id)).items[0].body,"A hand-edited dawn tracking shot");assert.equal(frame.properties.storyboard_shot_direction,"A hand-edited dawn tracking shot");assert.equal(videoReferencePreflight([frame],state.rows).storyboardItems[0].shotDirection,"A hand-edited dawn tracking shot");
  untouched=state.projection.blocks.find((block)=>block.id===secondFrames[0].id);assert.equal(untouched.properties.storyboard_shot_direction,"Complete authored body 1");
});

test("a protected storyboard root or frame rejects the complete edit atomically",()=>{
  const source=artifact("storyboard"),created=artifactContextEvents(source,{...options("locked"),content:content(source)}),initial=materialize(created.events),input=root(initial,source.id),frame=owned(initial,input).find((block)=>block.id!==input.id);
  const lockedRoot=append(initial,[{type:"BlockLocked",payload:{block_id:input.id}}]),protectedRoot=lockedRoot.projection.blocks.find((block)=>block.id===input.id);assert.deepEqual(outputInputEditEvents(protectedRoot,owned(lockedRoot,protectedRoot),{...outputInputDraft(protectedRoot),title:"Forbidden"}),[]);
  const lockedFrame=append(initial,[{type:"BlockLocked",payload:{block_id:frame.id}}]),rootWithLock=lockedFrame.projection.blocks.find((block)=>block.id===input.id),draft=outputInputDraft(rootWithLock);draft.items[0]={...draft.items[0],body:"Forbidden frame change"};
  assert.deepEqual(outputInputEditEvents(rootWithLock,owned(lockedFrame,rootWithLock),draft),[]);
});

test("owned storyboard removal is isolated, reversible, and refuses protected or orphaned children",()=>{
  const source=artifact("storyboard"),first=artifactContextEvents(source,{...options("remove-a"),content:content(source)}),second=artifactContextEvents(source,{...options("remove-b"),content:content(source)}),state=materialize(first.events,second.events);
  const input=state.projection.blocks.find((block)=>block.id===first.blockIds[0]),other=state.projection.blocks.find((block)=>block.id===second.blockIds[0]),frame=owned(state,input).find((block)=>block.id!==input.id),remove={type:"BlockRemoved",payload:{block_id:input.id,reason:"test"}};
  const changes=outputBlockRemovalEvents(input,state.projection.blocks,state.projection.blockRelations,remove);assert.deepEqual(changes.map((change)=>change.payload.block_id),[...owned(state,input).filter((block)=>block.id!==input.id).map((block)=>block.id),input.id]);
  const removed=append(state,changes);assert.equal(removed.projection.blocks.some((block)=>block.id===input.id),false);assert.equal(removed.projection.blocks.some((block)=>block.properties.context_set_root_id===input.id),false);assert.equal(removed.projection.blocks.some((block)=>block.id===other.id),true);assert.equal(videoReferencePreflight(removed.projection.blocks,removed.rows).storyboardItems.length,2);
  const restored=append(removed,[...changes].reverse().map((change)=>({type:"BlockRestored",payload:change.payload})));assert.equal(restored.projection.blocks.length,state.projection.blocks.length);assert.equal(videoReferencePreflight(restored.projection.blocks,restored.rows).storyboardItems.length,4);
  assert.deepEqual(outputBlockRemovalEvents(frame,state.projection.blocks,state.projection.blockRelations,{type:"BlockRemoved",payload:{block_id:frame.id}}),[]);
  const protectedState=append(state,[{type:"BlockLocked",payload:{block_id:frame.id}}]),protectedRoot=protectedState.projection.blocks.find((block)=>block.id===input.id);assert.deepEqual(outputBlockRemovalEvents(protectedRoot,protectedState.projection.blocks,protectedState.projection.blockRelations,remove),[]);
});

test("presentation appearance, authored chart details, and canonical manuscript all reach future output copy",()=>{
  const source=artifact("slides"),state=materialize(artifactContextEvents(source,{...options("slides"),content:content(source)}).events),input=root(state,source.id),draft=outputInputDraft(input);
  draft.presentation=applySlideStylePreset(draft.presentation,"nocturne");draft.presentation.footerLabel="Private screening";draft.items[0].slide.visual.data[0]={label:"Signal",value:"45%",weight:.45};
  const serialized=serializeOutputInputDraft(draft);assert.match(serialized,/Presentation style: nocturne/);assert.match(serialized,/Presentation appearance: dark/);assert.match(serialized,/Presentation palette: .*#121715/);assert.match(serialized,/Slide layout: split/);assert.match(serialized,/Visual type: bars/);assert.match(serialized,/Signal: 45%/);
  const changed=append(state,outputInputEditEvents(input,owned(state,input),draft));assert.equal(outputInputDraft(root(changed,source.id)).markdown,content(source).content_markdown);assert.equal(outputInputDraft(root(changed,source.id)).presentation.stylePreset,"nocturne");
});

test("generated image inputs preserve editable direction and a provider-facing palette",()=>{
  const output={id:"image-output",documentId:"original-document",canvasId:null,contextSetId:null,generationId:"image-generation",modelId:"image-model",variant:0,latency:100,sequence:1,pinned:false,saved:false,discarded:false,library:false,contentRef:"private-image-content",promptRef:"private-image-prompt",promptTechnique:"prose",promptFanId:null,provider:"openai",mediaUrl:"/api/media/generated.jpg",mediaType:"image/jpeg",width:1024,height:768,plannerModelId:null,quality:"high",purpose:"final",sourceEventId:"source-image",sourceSurface:"document",promotionId:null,promotedFromId:null,promotedFromEventId:null,focalPoint:null,standalone:true,standaloneSequence:1};
  const result=imageOutputContextEvents(output,{...options("image"),content:{title:"Edited image",rationale:"Keep the quiet composition",scene:"A warm threshold",palette:["#123456","#abcdef"]}}),input=result.events.find((change)=>change.type==="BlockCreated").payload.properties;
  assert.equal(input.label,"Edited image");assert.match(input.text,/quiet composition/);assert.deepEqual(input.output_palette,["#123456","#abcdef"]);assert.deepEqual(input.palette,["#123456","#abcdef"]);
});

test("every output can be kept and unkept using the same replayable library events",()=>{
  const base=[event(1,"ProjectCreated",{project_id:"project",name:"Project"}),event(2,"DocumentCreated",{project_id:"project",document_id:"destination",title:"Destination"}),event(3,"GenerationCompleted",{project_id:"project",document_id:"destination",generation_id:"generation",model_id:"model",object_ids:["image"]},"worker:generator"),...DOCUMENT_ARTIFACT_KINDS.map((kind,index)=>event(index+4,"DocumentRenderCompleted",{project_id:"project",document_id:"destination",artifact_id:`saved-${kind}`,artifact_kind:kind,title:kind,summary:"Summary",item_count:1,items:[]},"worker:generator"))];
  const idsToKeep=["image",...DOCUMENT_ARTIFACT_KINDS.map((kind)=>`saved-${kind}`)],keptRows=[...base,...idsToKeep.map((id,index)=>event(base.length+index+1,"AddedToLibrary",{object_id:id,document_id:"destination"}))],kept=foldEvents(keptRows,Number.POSITIVE_INFINITY,"destination");
  assert.equal(kept.libraryOutputs[0].library,true);assert.ok(kept.libraryArtifacts.every((entry)=>entry.library));assert.equal(kept.libraryArtifacts.filter((entry)=>entry.library).length+kept.libraryOutputs.filter((entry)=>entry.library).length,6);
  const removed=foldEvents([...keptRows,...idsToKeep.map((id,index)=>event(keptRows.length+index+1,"RemovedFromLibrary",{object_id:id,document_id:"destination"}))],Number.POSITIVE_INFINITY,"destination");assert.ok(removed.libraryArtifacts.every((entry)=>!entry.library));assert.ok(removed.libraryOutputs.every((entry)=>!entry.library));
});

test("provider prompts preserve semantic authored content while removing every durable adoption lineage",()=>{
  const privateKeys={source_artifact_id:"PRIVATE_ARTIFACT",source_artifact_item_id:"PRIVATE_ITEM",source_artifact_content_ref:"PRIVATE_CONTENT",source_canvas_item_ids:["PRIVATE_CANVAS"],copied_from_block_id:"PRIVATE_BLOCK",forked_from_block_id:"PRIVATE_FORK",copied_from_relation_id:"PRIVATE_RELATION",forked_from_relation_id:"PRIVATE_FORK_RELATION",artifact_markdown:"PRIVATE_CANONICAL"};
  const snapshot={facts:[{block_id:"editable-block",type:"composition",properties:{text:"The actual authored shot",source_artifact_kind:"storyboard",...privateKeys,nested:{...privateKeys}}}],relationships:[],pins:["editable-block"]};
  const creative=providerFacingCreativeContext(snapshot),rendering=providerFacingRenderingContext(snapshot);assert.equal(creative.facts[0].block_id,"editable-block");assert.equal(creative.facts[0].properties.source_artifact_kind,"storyboard");assert.equal(rendering.facts[0].decision_key,"decision_1");assert.equal(rendering.facts[0].properties.text,"The actual authored shot");
  for(const result of [JSON.stringify(creative),JSON.stringify(rendering)])assert.doesNotMatch(result,/PRIVATE_/);
  assert.doesNotMatch(JSON.stringify(rendering),/editable-block/);
});

test("portable rich-text formatting preserves selected content and ordinary keyboard-friendly prose",()=>{
  const expected={bold:"**copy**",italic:"*copy*",heading:"## copy",bullets:"- copy",numbered:"1. copy",quote:"> copy",link:"[copy](https://)"};
  for(const format of RICH_TEXT_FORMATS)assert.equal(applyRichTextFormat("copy",0,4,format).value,expected[format],format);
  assert.equal(applyRichTextFormat("one\ntwo",0,7,"numbered").value,"1. one\n2. two");assert.deepEqual(applyRichTextFormat("",0,0,"bold"),{value:"****",selectionStart:2,selectionEnd:2});assert.equal(applyRichTextFormat("\ncopy",0,0,"heading").value,"## \ncopy");assert.equal(applyRichTextFormat("é ✨",0,4,"italic").value,"*é ✨*");
});

test("the shared authoring surface uses native accessible controls and one owner-aware path everywhere",async()=>{
  const [forms,editor,store,context,creative,library,layers,canvas,worker,reel,artifacts,shared]=await Promise.all(["../src/components/design-system/forms.ts","../src/components/output-input-editor.ts","../src/state/store.ts","../src/components/context-block.ts","../src/components/forma-creative-editor.ts","../src/components/library-block-editor.ts","../src/components/forma-studio-editor-alternatives.ts","../src/canvas/canvas-application.ts","../worker/events-api.ts","../src/components/video-reel.ts","../src/components/document-artifacts.ts","../src/components/forma-shared-view.ts"].map((file)=>readFile(new URL(file,import.meta.url),"utf8")));
  const molecule=forms.slice(forms.indexOf("export class FormaUiRichText"),forms.indexOf("export class FormaUiSelect"));assert.match(molecule,/<label class="ui-rich-text-label" for=\$\{this\.#id\}/);assert.match(molecule,/<textarea id=\$\{this\.#id\}/);assert.match(molecule,/aria-describedby=\$\{descriptions\}/);assert.match(molecule,/this\.#composing \? noChange : this\.value/);assert.match(molecule,/@compositionstart/);assert.match(molecule,/@compositionend/);assert.match(molecule,/role="group"/);assert.match(molecule,/aria-keyshortcuts/);assert.match(molecule,/aria-live="polite" aria-atomic="true"/);assert.ok(molecule.indexOf("<textarea")<molecule.indexOf('role="group"'));assert.doesNotMatch(molecule,/contenteditable/i);
  assert.match(editor,/@compositionstart/);assert.match(editor,/@compositionend/);assert.match(editor,/if \(!this\.#composing\) this\.requestUpdate\(\)/);assert.match(editor,/<ol>/);assert.match(editor,/<fieldset/);assert.match(editor,/output-input-frame-preview/);assert.match(editor,/output-input-slide-preview/);
  for(const surface of [editor,context,canvas,artifacts,shared])assert.match(surface,/renderVideoReel/);assert.match(reel,/controls playsinline preload="metadata"/);assert.match(reel,/<label class="forma-video-reel-picker">Choose a scene<select/);assert.match(reel,/role="status" aria-live="polite" aria-atomic="true"/);assert.match(reel,/data-scene-status \.textContent=\$\{label\(0\)\}/);assert.doesNotMatch(reel,/data-scene-status>\$\{/);assert.match(reel,/A combined MP4 is not available/);assert.doesNotMatch(reel,/autoplay/);assert.match(editor,/draft\.items\.length <= 6/);
  for(const surface of [context,creative,library,layers])assert.match(surface,/\.removeOutputBlock\(/);assert.match(worker,/outputBlockRemovalEvents\(target/);assert.match(store,/adoptCanvasOutputItems/);assert.ok(store.indexOf('your document was left unchanged')<store.indexOf('for(const item of unique.values()){const result='),"all selected sources must be checked before any adoption writes");assert.match(canvas,/adoptCanvasOutputItems\(selected,item\.sourceId,"canvas-artifact-render"\)/);assert.match(creative,/\.requestSubmit\(\)/);assert.match(creative,/forma-output-input-editor"\)\?\.reset\(\)/);assert.match(creative,/rich\.value=textFor\(selected\)/);assert.match(creative,/radio\.checked=radio\.value===strengthFor/);
});

test("ordinary and adopted copy edits share the same derived-output authoring boundary",()=>{
  const source=artifact("scene"),state=materialize(artifactContextEvents(source,{...options("plain"),content:content(source)}).events),input=root(state,source.id),prose="  Intentional leading space and a trailing line.\n";
  const changed=append(state,outputBlockTextEditEvents(input,owned(state,input),prose,"guided-brief"));assert.equal(outputInputDraft(root(changed,source.id)).markdown,prose);
});
