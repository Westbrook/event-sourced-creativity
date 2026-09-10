import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { parseOutputRequirement } from "../model/output-requirements";
import { copyOutputRequirementCreationEvents } from "../model/output-requirement-copy";
import "./forma-output-requirements";
import { BLOCK_GROUPS, BLOCK_INTENTS, BLOCK_TYPES, REFERENCE_PIXEL_MODES, blockIntentFor, blockTypeDefinition, suggestedSubtype, type BlockIntent, type BlockKind } from "../model/block-types";
import type { CreativeBlock, EventInput } from "../model/events";
import { DEFAULT_REFERENCE_FINDINGS } from "../model/extractors";
import { sampleImageFile } from "../model/image-sample";
import { libraryBaseRoute, libraryBlockEditorFromRoute, libraryBlockEditorRoute } from "../model/routes";
import { DEFAULT_IMAGE_FORMAT, IMAGE_FORMAT_PRESETS, imageAspectRatioLabel, imageFormatForPreset, normalizeImageFormat, type ImageFormat } from "../model/image-format";
import { outputInputDraft } from "../model/output-authoring";
import { combinedContextMemberships } from "../model/combined-context";
import { isImageReference, referenceMedium } from "../model/reference-media";
import { MAX_MODEL3D_UPLOAD_BYTES, MODEL3D_MIME_TYPE, model3dMimeType, validateModel3dAsset } from "../model/model3d-assets";
import { normalizeModel3dView, type Model3dCaptureDetail } from "../model/model3d-view";
import { FormaElement, icon } from "./forma-element";
import { nextFormaId } from "./design-system/contracts";
import { navigateInApp, navigationPresentationMatches, type NavigationPresentationContext } from "./command-departure";
import { captureOutputNavigationFocus } from "./output-navigation-focus";
import { ensureModalDialog } from "./modal-dialog";
import { suspendContextControls } from "./context-controls";
import "./context-block";
import { renderAudioPlayer } from "./audio-playback";
import "./icons-authoring";
import "./collection-tree";
import "./reference-image";
import "./output-input-editor";
import "./context-intelligence";
import "./model3d-viewer";
import "./model3d-geometry-editor";
import "./reference-composition-editor";

const slug = (value:string,id="") => value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,48)||(id?`document-${id.slice(0,8)}`:"untitled");
const colorsFrom = (value:unknown) => Array.isArray(value) ? value.map(String).filter((color)=>/^#[0-9a-f]{6}$/i.test(color)).slice(0,8) : [];
const REFERENCE_RELATION_KINDS=[
  {id:"visual_evidence",label:"General visual evidence"},{id:"subject_reference",label:"Subject appearance"},{id:"style_reference",label:"Style and treatment"},{id:"composition_reference",label:"Composition and framing"},{id:"material_reference",label:"Material and surface"},{id:"lighting_reference",label:"Lighting behavior"},{id:"palette_reference",label:"Color and palette"},{id:"mood_reference",label:"Mood and atmosphere"},
] as const;
const suggestedReferenceRelation=(type:BlockKind)=>REFERENCE_RELATION_KINDS.find((item)=>item.id===`${type}_reference`)?.id??(type==="environment"?"mood_reference":"visual_evidence");

export class LibraryBlockEditor extends FormaElement {
  static properties={blockId:{attribute:false}};
  /** Pin a retained form to its original decision; undefined uses the current route. */
  blockId:string|null|undefined=undefined;
  #loaded="";
  #cleanDraft="";
  #sourceRevision="";
  #derivedDirty=false;
  #handle="";
  #type:BlockKind="direction";
  #subtype=suggestedSubtype("direction");
  #intent:BlockIntent="include";
  #copy="";
  #imageTitle="";
  #weightId=nextFormaId("library-weight");
  #weight=.65;
  #colors=["#27352f","#dbe878","#f1ede3"];
  #imageFormat:ImageFormat=DEFAULT_IMAGE_FORMAT;
  #mediaUrl="";
  #pixelMode="context_only";
  #collectionId="";
  #pendingFile:File|null=null;
  #rightsConfirmed=false;
  #referenceRelations=new Map<string,string>();
  #pendingRelatedFile:File|null=null;
  #relatedRightsConfirmed=false;
  #uploading=false;
  #savingModelView:object|null=null;
  #pendingSaves:{current:()=>boolean;count:number}|null=null;
  #confirmRemove=false;
  #browserCollapsed=true;
  #filingCollapsed=true;

  // Content-free check remains meaningful while the existing Library cache detaches this editor.
  get navigationBlocked(){const pending=this.#pendingSaves;return this.#uploading||Boolean(this.#savingModelView)||Boolean(this.querySelector("forma-model3d-geometry-editor")?.navigationBlocked)||this.#confirmRemove
    ||Boolean(pending&&pending.count>0&&pending.current())
    ||Boolean(this.#cleanDraft&&this.#draftFingerprint()!==this.#cleanDraft);}
  allowsNavigationPresentation(context?:NavigationPresentationContext){
    return this.#selected()?.type.toLowerCase()==="output"&&!this.navigationBlocked
      &&navigationPresentationMatches(context,this,this.querySelector(".library-block-editor"));
  }

  /** Suspend owned modal layers while retaining native fields and child editors. */
  suspendControls(){this.#confirmRemove=false;suspendContextControls(this);this.requestUpdate();}
  override disconnectedCallback(){this.suspendControls();super.disconnectedCallback();}
  #canAuthor(){const session=this.store.session.get(),permissions=session?.projectContext?.permissions??session?.capabilities??[];return Boolean(this.store.captureAuthorizationScope())&&permissions.includes("project.read")&&permissions.includes("project.author");}
  #useCopy(block:CreativeBlock){if(!this.#canAuthor())return;this.dispatchEvent(new CustomEvent("library-use-copy",{detail:{blockId:block.id},bubbles:true,composed:true}));}

  protected override updated(){if(this.isConnected)ensureModalDialog(this.querySelector<HTMLDialogElement>(".library-block-remove-dialog"));}

  #target(){return this.blockId!==undefined?{blockId:this.blockId}:libraryBlockEditorFromRoute(this.store.route.get())??{blockId:null};}
  #selected(){const id=this.#target().blockId;return id?this.store.projection.get().libraryBlocks.find((block)=>block.id===id):undefined;}
  #reset(block?:CreativeBlock){
    this.#loaded=block?.id??"__new__";this.#handle=block?.handle??"";this.#type=(BLOCK_TYPES.some((item)=>item.type===block?.type)?block!.type:"direction") as BlockKind;this.#subtype=String(block?.properties.subtype??suggestedSubtype(this.#type));this.#intent=block?blockIntentFor(block.type,block.properties):"include";this.#copy=String(block?.type==="audio"&&block.properties.media_url?block.properties.description??block.properties.text??"":block?.properties.artifact_markdown??block?.properties.text??block?.properties.source_excerpt??block?.properties.label??"");this.#imageTitle=String(block?.properties.label??"");this.#weight=Number(block?.properties.weight??.65);this.#colors=colorsFrom(block?.properties.colors);if(!this.#colors.length)this.#colors=["#27352f","#dbe878","#f1ede3"];this.#imageFormat=normalizeImageFormat(block?.properties.image_format);this.#mediaUrl=String(block?.properties.media_url??"");this.#pixelMode=String(block?.properties.pixel_reference_mode??"context_only");this.#collectionId=block?this.store.projection.get().membership[block.id]?.collectionId??"":"";this.#referenceRelations=new Map(block?this.store.projection.get().libraryBlockRelations.filter((relation)=>relation.fromBlockId===block.id&&relation.kind!=="artifact_contains").map((relation)=>[relation.toBlockId,relation.kind]):[]);this.#pendingFile=null;this.#rightsConfirmed=false;this.#pendingRelatedFile=null;this.#relatedRightsConfirmed=false;this.#confirmRemove=false;this.#derivedDirty=false;
  }
  #draftFingerprint(){return JSON.stringify([this.#handle,this.#type,this.#subtype,this.#intent,this.#copy,this.#imageTitle,this.#weight,this.#colors,this.#imageFormat,this.#mediaUrl,this.#pixelMode,this.#collectionId,[...this.#referenceRelations],Boolean(this.#pendingFile),this.#rightsConfirmed,Boolean(this.#pendingRelatedFile),this.#relatedRightsConfirmed,this.#derivedDirty]);}
  #ensureLoaded(){
    const block=this.#selected();if(this.#target().blockId&&!block)return;
    const key=block?.id??"__new__",projection=this.store.projection.get();
    const revision=JSON.stringify([block,block?projection.membership[block.id]:null,block?projection.libraryBlockRelations.filter((relation)=>relation.fromBlockId===block.id):[]]);
    if(this.#loaded===key&&block?.type==="model3d"&&(!block.properties.media_url||!normalizeModel3dView(block.properties.model_view))){
      const clean=this.#draftFingerprint()===this.#cleanDraft;this.#mediaUrl="";this.#pixelMode="context_only";
      if(clean)this.#cleanDraft=this.#draftFingerprint();
    }
    if(this.#loaded!==key||this.#draftFingerprint()===this.#cleanDraft&&revision!==this.#sourceRevision){this.#reset(block);this.#cleanDraft=this.#draftFingerprint();this.#sourceRevision=revision;}
  }
  #localRoute(path:string){const library=this.closest<FormaElement>("forma-library");return this.isConnected&&library?.isConnected
    &&FormaElement.hasStoreIdentity(library,this.store)?navigateInApp(library,{localRoute:path}):Promise.resolve(false);}
  #open(blockId=""){if(!this.isConnected||!this.#canAuthor())return;return this.#localRoute(libraryBlockEditorRoute(blockId,this.store.route.get()));}
  #close(){return this.#localRoute(libraryBaseRoute(this.store.route.get()));}
  #changeType(type:BlockKind){const previousDefault=suggestedReferenceRelation(this.#type);this.#type=type;this.#subtype=suggestedSubtype(type);this.#intent=type==="exclusion"?"avoid":"include";if(type==="reference"){this.#referenceRelations.clear();this.#pendingRelatedFile=null;this.#relatedRightsConfirmed=false;}else{const nextDefault=suggestedReferenceRelation(type);for(const [id,kind] of this.#referenceRelations)if(kind===previousDefault||kind==="visual_evidence")this.#referenceRelations.set(id,nextDefault);}this.requestUpdate();}
  #propertyEvents(block:CreativeBlock):EventInput[]{
    const events:EventInput[]=[];const add=(path:string,current:unknown,next:unknown)=>{if(JSON.stringify(current)!==JSON.stringify(next))events.push({type:"BlockPropertyEdited",payload:{block_id:block.id,property_path:path,old_value:current??null,new_value:next,source_surface:"library-block-editor"}});};
    if(block.handle!==this.#handle.trim())events.push({type:"BlockRenamed",payload:{block_id:block.id,old_handle:block.handle,new_handle:this.#handle.trim(),reason:"library-block-editor"}});
    if(block.type!==this.#type){add("type",block.type,this.#type);if(this.#type==="audio"){for(const path of ["inform_generation","include_in_output","allow_provider_audio_transfer"] as const)add(path,block.properties[path],false);add("audio_role",block.properties.audio_role,"score");}}
    add("subtype",block.properties.subtype,this.#subtype);add("intent",blockIntentFor(block.type,block.properties),this.#intent);
    const workbench=this.querySelector("forma-output-input-editor");if(workbench?.draft&&outputInputDraft(block)){events.push(...this.store.outputInputEvents(block.id,workbench.draft,"library-block-editor"));if(this.#type==="audio"&&block.properties.media_url)add("description",block.properties.description??"",workbench.draft.summary.trim());}else if(this.#type==="audio"&&block.properties.media_url)add("description",block.properties.description??"",this.#copy.trim());else if(block.properties.text!==undefined)events.push(...this.store.outputBlockTextEvents(block.id,this.#copy,"library-block-editor"));else if(this.#type==="reference"&&!isImageReference(block.properties)&&block.properties.source_excerpt!==undefined)add("source_excerpt",block.properties.source_excerpt,this.#copy.trim());else add(this.#type==="reference"||this.#type==="palette"?"label":"text",block.properties.label??block.properties.text??"",this.#copy.trim());
    if(block.properties.source_output_id){add("label",block.properties.label??"",this.#imageTitle);add("image_caption",block.properties.image_caption??"",this.#imageTitle);}
    if(this.#type==="palette")add("colors",block.properties.colors??[],this.#colors);
    if(this.#type==="format")add("image_format",block.properties.image_format??DEFAULT_IMAGE_FORMAT,this.#imageFormat);
    if(this.#type==="reference"&&(block.type!=="reference"||isImageReference(block.properties))){if(!block.properties.reference_composition)add("media_url",block.properties.media_url??"",this.#mediaUrl.trim());add("pixel_reference_mode",block.properties.pixel_reference_mode??"context_only",this.#pixelMode);}
    if(this.#type==="model3d"&&block.type==="model3d")add("pixel_reference_mode",block.properties.pixel_reference_mode??"context_only",block.properties.media_url&&normalizeModel3dView(block.properties.model_view)?this.#pixelMode:"context_only");
    if(Number(block.properties.weight??.5)!==this.#weight)events.push({type:"BlockWeightSet",payload:{block_id:block.id,previous_weight:Number(block.properties.weight??.5),weight:this.#weight,source_surface:"library-block-editor"}});
    return events;
  }
  async #uploadReference(events:EventInput[],properties:Record<string,unknown>,current:()=>boolean=()=>true){
    if(!current()||!this.#pendingFile)return;this.#uploading=true;this.requestUpdate();const file=this.#pendingFile;let sample;try{sample=await sampleImageFile(file);}catch{sample=undefined;}
    if(!current())return;let dispatched=false;const form=new FormData();form.append("file",file);form.append("rightsConfirmed","true");form.append("nonSensitiveConfirmed","true");const response=await this.store.guardedFetch("/api/media",{method:"POST",body:form},"upload this reference image to the fictional library",{current:()=>dispatched||current(),onDispatch:()=>{dispatched=true;}});const media=await response.json() as {key?:string;url?:string;contentHash?:string;mimeType?:string;error?:string};if(!current())return;if(!response.ok||!media.url)throw new Error(media.error??"That reference could not be uploaded");
    const mimeType=media.mimeType??file.type;const referenceId=crypto.randomUUID();events.push({type:"ReferenceIngested",payload:{reference_id:referenceId,source_type:"upload",source_ref:media.url,content_hash:media.contentHash??media.key,source_mime_type:mimeType,rights_class:"asserted"}},{type:"RightsAsserted",payload:{reference_id:referenceId,rights_class:"owned_or_licensed",assertion_method:"explicit-library-block-confirmation"}});Object.assign(properties,{reference_id:referenceId,media_url:media.url,source_mime_type:mimeType,media_type:mimeType,label:this.#copy.trim()||file.name,extraction_preferences:DEFAULT_REFERENCE_FINDINGS,extraction_status:sample?"pending":"unavailable"});return{referenceId,sample};
  }
  async #uploadModel(events:EventInput[],properties:Record<string,unknown>,current:()=>boolean){
    const file=this.#pendingFile;
    if(!file||!this.#rightsConfirmed||!current())return;
    const submitted=current;
    current=()=>submitted()&&this.#type==="model3d"&&this.#pendingFile===file&&this.#rightsConfirmed&&this.#canAuthor();
    if(!model3dMimeType(file))throw new Error(this.i18n.t("model3d.upload.format","Choose a self-contained GLB (.glb) model."));
    if(file.size>MAX_MODEL3D_UPLOAD_BYTES)throw new Error(this.i18n.system("Choose a GLB model smaller than 64 MB."));
    this.#uploading=true;this.requestUpdate();
    validateModel3dAsset(await file.arrayBuffer(),MODEL3D_MIME_TYPE);
    if(!current())return;
    const form=new FormData();form.append("file",file);form.append("rightsConfirmed","true");form.append("nonSensitiveConfirmed","true");
    let dispatched=false;
    const response=await this.store.guardedFetch("/api/media",{method:"POST",body:form},this.i18n.t("model3d.upload.action","upload this 3D model"),{current:()=>dispatched||current(),onDispatch:()=>{dispatched=true;}});
    const media=await response.json() as {url?:string;contentHash?:string;mimeType?:string;error?:string};
    if(!current())return;
    if(!response.ok||!media.url||media.mimeType!==MODEL3D_MIME_TYPE||!media.contentHash)throw new Error(media.error??this.i18n.t("model3d.upload.failed","The model could not be uploaded. Try a self-contained GLB."));
    const referenceId=crypto.randomUUID();
    events.push({type:"ReferenceIngested",payload:{reference_id:referenceId,source_type:"upload",source_ref:media.url,content_hash:media.contentHash,source_mime_type:MODEL3D_MIME_TYPE,rights_class:"asserted"}},{type:"RightsAsserted",payload:{reference_id:referenceId,rights_class:"owned_or_licensed",assertion_method:"explicit-library-model3d-confirmation"}});
    Object.assign(properties,{model_reference_id:referenceId,model_url:media.url,model_mime_type:MODEL3D_MIME_TYPE,model_content_hash:media.contentHash,model_filename:file.name,label:String(properties.text??"").trim()||file.name,pixel_reference_mode:"context_only"});
  }
  #geometryBusy(){return Boolean(this.querySelector("forma-model3d-geometry-editor")?.busy);}
  #geometrySaved(event:CustomEvent<{blockId:string}>){
    if(event.target!==this.querySelector("forma-model3d-geometry-editor")||event.detail.blockId!==this.#selected()?.id)return;
    event.stopPropagation();const clean=this.#draftFingerprint()===this.#cleanDraft;
    // Keep unrelated raw form edits, but never restore a PNG mode cleared by the new mesh.
    this.#mediaUrl="";this.#pixelMode="context_only";
    if(clean){this.#cleanDraft=this.#draftFingerprint();this.#sourceRevision="";}
    this.requestUpdate();
  }
  async #saveModelView(event:CustomEvent<Model3dCaptureDetail>){
    event.stopPropagation();
    const block=this.#selected();
    if(!block||block.type!=="model3d"||block.scope!=="library"||block.locked||block.properties.organization_context_package_binding_id||!this.#canAuthor()||this.#savingModelView||this.#geometryBusy())return;
    const store=this.store,source=store.captureSourceOwnership(),route=store.route.get(),pending={},modelUrl=String(block.properties.model_url??""),modelHash=block.properties.model_content_hash;
    const current=()=>this.isConnected&&this.store===store&&this.#savingModelView===pending&&store.sourceOwnershipActive(source)
      &&store.route.get()===route&&this.#canAuthor()&&this.#selected()?.id===block.id&&!this.#selected()?.locked
      &&this.#selected()?.properties.model_url===modelUrl&&this.#selected()?.properties.model_content_hash===modelHash;
    if(event.detail.src!==modelUrl||!store.sourceOwnershipActive(source))return;
    this.#savingModelView=pending;this.requestUpdate();
    try{await store.saveModel3dView(block.id,event.detail,current);}finally{if(this.#savingModelView===pending){this.#savingModelView=null;this.requestUpdate();}}
  }
  #modelEditor(block:CreativeBlock|undefined,editable:boolean){
    if(this.#type!=="model3d")return nothing;
    const view=normalizeModel3dView(block?.properties.model_view),saved=Boolean(block?.properties.media_url&&view);
    return html`<section class="library-model3d-editor" aria-label=${this.i18n.t("model3d.context.title","3D model and saved view")}>
      <p>${this.i18n.t("model3d.context.explanation","Choose a view here and save it as an image. Generations use that saved view; rotating the preview does not change it.")}</p>
      ${block?.properties.model_url?html`<forma-model3d-viewer .src=${String(block.properties.model_url)} .view=${view} .readonly=${!editable||block.locked} .disabled=${Boolean(this.#savingModelView)||this.#geometryBusy()} @model3d-capture=${this.#saveModelView}></forma-model3d-viewer>`:html`<label>${this.i18n.t("model3d.upload.label","Upload an owned or licensed 3D model")}<input type="file" accept=".glb,model/gltf-binary" @change=${(event:Event)=>{this.#pendingFile=(event.target as HTMLInputElement).files?.[0]??null;this.#rightsConfirmed=false;this.requestUpdate();}}></label><p>${this.i18n.t("model3d.upload.help","Choose a self-contained GLB under 64 MB, with embedded textures and no external files. Save the block, then choose its image view.")}</p>${this.#pendingFile?html`<label class="rights-check"><input type="checkbox" .checked=${this.#rightsConfirmed} @change=${(event:Event)=>{this.#rightsConfirmed=(event.target as HTMLInputElement).checked;this.requestUpdate();}}><span>${this.i18n.t("model3d.upload.rights","I own or may use this model and its textures. In a controlled pilot, it contains no sensitive information.")}</span></label>`:nothing}`}
      ${block?.properties.model_url?html`<forma-model3d-geometry-editor .blockId=${block.id} .readOnly=${!editable||block.locked}
        .guard=${()=>this.isConnected&&this.#selected()?.id===block.id&&this.#type==="model3d"&&this.#canAuthor()&&!this.#uploading&&!this.#savingModelView&&!this.#pendingSaves?.count}
        @model3d-geometry-state=${()=>this.requestUpdate()} @model3d-geometry-saved=${this.#geometrySaved}></forma-model3d-geometry-editor>`:nothing}
      ${saved?html`<figure><img src=${String(block!.properties.media_url)} alt=${this.i18n.t("model3d.context.savedAlt","Saved model view for generation")} loading="lazy"><figcaption>${this.i18n.t("model3d.context.saved","Saved image view")}</figcaption></figure>`:block?html`<p role="status">${this.i18n.t("model3d.context.missingView","Save a view before using this model as an image reference.")}</p>`:nothing}
      <label>${this.i18n.t("model3d.context.pixelLabel","How generations use the saved view")}<select .value=${this.#pixelMode} ?disabled=${!saved||!editable||Boolean(block?.locked)||Boolean(this.#savingModelView)||this.#geometryBusy()} @change=${(event:Event)=>{this.#pixelMode=(event.target as HTMLSelectElement).value;this.requestUpdate();}}>${REFERENCE_PIXEL_MODES.map((mode)=>html`<option value=${mode.id} ?selected=${mode.id===this.#pixelMode}>${this.i18n.system(mode.label)}</option>`)}</select></label>
      ${block?.properties.model_url?html`<a href=${String(block.properties.model_url)} download=${String(block.properties.model_filename??"model.glb")}>${this.i18n.t("model3d.geometry.download","Download current GLB")}</a>`:nothing}
    </section>`;
  }
  #relationEvents(blockId:string){const p=this.store.projection.get();const existing=new Map(p.libraryBlockRelations.filter((relation)=>relation.fromBlockId===blockId&&relation.kind!=="artifact_contains").map((relation)=>[relation.toBlockId,relation]));const events:EventInput[]=[];for(const [referenceBlockId,kind] of this.#referenceRelations){const relation=existing.get(referenceBlockId);if(!relation)events.push({type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),project_id:p.projectId,from_block_id:blockId,to_block_id:referenceBlockId,kind,properties:{purpose:"creative-reference"},source_surface:"library-block-editor"}});else if(relation.kind!==kind){events.push({type:"BlockRelationRemoved",payload:{relation_id:relation.id,project_id:relation.projectId,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties,source_surface:"library-block-editor"}},{type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),project_id:p.projectId,from_block_id:blockId,to_block_id:referenceBlockId,kind,properties:{purpose:"creative-reference",replaces_relation_id:relation.id},source_surface:"library-block-editor"}});}}
    for(const relation of existing.values())if(!this.#referenceRelations.has(relation.toBlockId))events.push({type:"BlockRelationRemoved",payload:{relation_id:relation.id,project_id:relation.projectId,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties,source_surface:"library-block-editor"}});return events;}
  async #uploadRelatedReference(events:EventInput[],rootBlockId:string,current:()=>boolean=()=>true){if(!current()||!this.#pendingRelatedFile)return;this.#uploading=true;this.requestUpdate();const file=this.#pendingRelatedFile;let sample;try{sample=await sampleImageFile(file);}catch{sample=undefined;}if(!current())return;let dispatched=false;const form=new FormData();form.append("file",file);form.append("rightsConfirmed","true");form.append("nonSensitiveConfirmed","true");const response=await this.store.guardedFetch("/api/media",{method:"POST",body:form},"upload and relate this reference image in the fictional library",{current:()=>dispatched||current(),onDispatch:()=>{dispatched=true;}});const media=await response.json() as {key?:string;url?:string;contentHash?:string;mimeType?:string;error?:string};if(!current())return;if(!response.ok||!media.url)throw new Error(media.error??"That related reference could not be uploaded");const p=this.store.projection.get();const mimeType=media.mimeType??file.type;const referenceId=crypto.randomUUID();const referenceBlockId=crypto.randomUUID();events.push({type:"ReferenceIngested",payload:{reference_id:referenceId,source_type:"upload",source_ref:media.url,content_hash:media.contentHash??media.key,source_mime_type:mimeType,rights_class:"asserted"}},{type:"RightsAsserted",payload:{reference_id:referenceId,rights_class:"owned_or_licensed",assertion_method:"explicit-related-reference-confirmation"}},{type:"BlockCreated",payload:{block_id:referenceBlockId,project_id:p.projectId,scope:"library",type:"reference",handle:`reference/${slug(file.name,referenceBlockId)}`,position:`l${String(this.store.head.get()+events.length+1).padStart(6,"0")}`,properties:{reference_id:referenceId,label:file.name,media_url:media.url,source_mime_type:mimeType,media_type:mimeType,subtype:"Visual evidence",weight:.72,authority:"authored",pixel_reference_mode:"inspiration",extraction_preferences:DEFAULT_REFERENCE_FINDINGS,extraction_status:sample?"pending":"unavailable",created_from:"library-block-editor-related-upload"}}},{type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),project_id:p.projectId,from_block_id:rootBlockId,to_block_id:referenceBlockId,kind:suggestedReferenceRelation(this.#type),properties:{purpose:"creative-reference",created_with_root:true},source_surface:"library-block-editor"}});return{referenceBlockId,referenceId,sample};}
  async #save(event:SubmitEvent){const sourceOwner=this.store.captureSourceOwnership();if(!this.store.sourceOwnershipActive(sourceOwner))return;
    event.preventDefault();if(!this.isConnected||!this.#canAuthor()||this.#geometryBusy())return;const selected=this.#selected();if(this.#target().blockId&&!selected){this.store.toast(this.i18n.t("context.controls.unavailable","That saved decision is no longer available. Return to the Library to choose another."));return;}const adopted=selected?outputInputDraft(selected):null;if(selected?.properties.organization_context_package_binding_id){this.store.toast(this.i18n.system("Organization context"));return;}if(selected&&selected.scope!=="library"){this.store.toast("Fork a document-owned block before editing it independently.");return;}if(!this.#copy.trim()&&this.#type!=="reference"&&this.#type!=="model3d"&&!adopted){this.store.toast("Add content before saving this block.");return;}if(this.#type==="reference"&&this.#pendingFile&&!this.#rightsConfirmed){this.store.toast("Confirm that you may use this image before uploading it.");return;}if(this.#pendingRelatedFile&&!this.#relatedRightsConfirmed){this.store.toast("Confirm that you may use the related reference image before uploading it.");return;}if(this.#type==="model3d"&&!selected&&(!this.#pendingFile||!this.#rightsConfirmed)){this.store.toast(this.i18n.t("model3d.upload.required","Choose a GLB and confirm your rights before saving."));return;}
    const workbench=this.querySelector("forma-output-input-editor");if(selected&&adopted&&workbench?.draft&&JSON.stringify(adopted)!==JSON.stringify(workbench.draft)&&!this.store.outputInputEvents(selected.id,workbench.draft,"library-block-editor").length){this.store.toast("Unlock every related storyboard frame before saving these changes.");return;}
    // Same scoped count as Editor/Guided, owned by this exact Library target.
    // Back may cache-detach this child without retiring its original Save.
    let pending=this.#pendingSaves;
    if(!pending||!pending.current()){
      const store=this.store,library=this.closest<FormaElement>("forma-library");
      const projectId=store.projection.get().projectId,targetId=this.#target().blockId;
      pending={count:0,current:()=>Boolean(library?.isConnected&&this.store===store
        &&FormaElement.hasStoreIdentity(library,store)&&store.sourceOwnershipActive(sourceOwner)
        &&store.projection.get().projectId===projectId&&this.#target().blockId===targetId)};
      this.#pendingSaves=pending;
    }
    pending.count+=1;
    try{
      if(selected){
        const submittedDraft=this.#draftFingerprint(),cleanDraft=this.#cleanDraft;
        const currentSave=()=>this.#pendingSaves===pending&&pending.current()
          &&this.store.sourceOwnershipActive(sourceOwner)&&this.#selected()?.id===selected.id;
        const events=[...this.#propertyEvents(selected),...this.#relationEvents(selected.id)];
        const relatedUpload=await this.#uploadRelatedReference(events,selected.id,()=>this.store.sourceOwnershipActive(sourceOwner));
        if(!this.store.sourceOwnershipActive(sourceOwner))return;
        if(!events.length){this.store.toast("No block changes to save.");return;}
        const appended=await this.store.appendBatch(events);
        if(this.store.sourceOwnershipActive(sourceOwner)&&appended.length){
          if(this.store.sourceOwnershipActive(sourceOwner)&&relatedUpload?.sample)await this.store.extractReference(relatedUpload.referenceBlockId,relatedUpload.referenceId,relatedUpload.sample,DEFAULT_REFERENCE_FINDINGS);
          if(!currentSave())return;
          const currentDraft=this.#draftFingerprint();
          // Reload unchanged A or a deliberate return to known canonical fields.
          // A distinct newer raw draft remains in this same retained editor.
          const reload=currentDraft===submittedDraft||currentDraft===cleanDraft||currentDraft===this.#cleanDraft;
          if(reload)this.#loaded="";
          this.store.toast(reload?"Reusable block and its connected context were updated."
            :this.i18n.t("guided.save.newerEditsKept","The earlier submission was saved. Your newer edits are still here."));
        }
        return;
      }
      const p=this.store.projection.get();const id=crypto.randomUUID(),creationType=this.#type;const properties:Record<string,unknown>={subtype:this.#subtype,intent:this.#intent,weight:this.#weight,authority:"authored",created_from:"library-block-editor"};if(creationType==="palette")Object.assign(properties,{label:this.#copy.trim(),colors:this.#colors});else if(creationType==="reference")Object.assign(properties,{label:this.#copy.trim()||this.#pendingFile?.name||"Reference",media_url:this.#mediaUrl.trim(),pixel_reference_mode:this.#pixelMode});else Object.assign(properties,{text:this.#copy.trim(),...(creationType==="format"?{image_format:this.#imageFormat}:{}),...(creationType==="audio"?{audio_role:"score",inform_generation:false,include_in_output:false,allow_provider_audio_transfer:false}:{})});
      const events:EventInput[]=[];if(creationType==="model3d")await this.#uploadModel(events,properties,()=>this.store.sourceOwnershipActive(sourceOwner)&&Boolean(pending?.current()));const upload=creationType==="reference"?await this.#uploadReference(events,properties,()=>this.store.sourceOwnershipActive(sourceOwner)):undefined;if(!this.store.sourceOwnershipActive(sourceOwner)||creationType==="model3d"&&!properties.model_url)return;events.push({type:"BlockCreated",payload:{block_id:id,project_id:p.projectId,scope:"library",type:creationType,handle:this.#handle.trim()||`${creationType}/${slug(this.#copy||this.#pendingFile?.name||"untitled",id)}`,position:`l${String(this.store.head.get()+1).padStart(6,"0")}`,properties}});if(creationType!=="reference")events.push(...this.#relationEvents(id));const relatedUpload=await this.#uploadRelatedReference(events,id,()=>this.store.sourceOwnershipActive(sourceOwner));if(!this.store.sourceOwnershipActive(sourceOwner))return;if(this.#collectionId)events.push({type:"CollectionItemAdded",payload:{collection_id:this.#collectionId,item_ref:{block_id:id},position:"a0"}});
      const appended=await this.store.appendBatch(events);if(this.store.sourceOwnershipActive(sourceOwner)&&appended.length){if(upload?.sample)await this.store.extractReference(id,upload.referenceId,upload.sample,DEFAULT_REFERENCE_FINDINGS);if(relatedUpload?.sample)await this.store.extractReference(relatedUpload.referenceBlockId,relatedUpload.referenceId,relatedUpload.sample,DEFAULT_REFERENCE_FINDINGS);if(!this.store.sourceOwnershipActive(sourceOwner))return;this.#open(id);if(!this.store.sourceOwnershipActive(sourceOwner))return;this.#loaded="";this.store.toast(relatedUpload||this.#referenceRelations.size?"Reusable context set created. Its connected blocks can be added to a document in one action.":"Reusable project block created without attaching it to a document.");}
    }catch(error){if(this.store.sourceOwnershipActive(sourceOwner))this.store.toast(error instanceof Error?this.i18n.system(error.message):"Block could not be saved");}finally{
      this.#uploading=false;pending.count-=1;
      if(pending.count===0&&this.#pendingSaves===pending)this.#pendingSaves=null;
      this.requestUpdate();
    }
  }
  async #fork(block:CreativeBlock){
    if(!this.isConnected||!this.#canAuthor())return;
    if(block.properties.organization_context_package_binding_id){this.store.toast(this.i18n.system("Organization context"));return;}
    const p=this.store.projection.get();
    const id=crypto.randomUUID();
    const membership=p.membership[block.id];
    const outputSetId=block.properties.source_artifact_id?crypto.randomUUID():"";const rootMemberships=combinedContextMemberships(block.properties).map((membership)=>({...membership,...(outputSetId?{contextSetId:outputSetId}:{})}));
    const events:EventInput[]=[{type:"BlockCreated",payload:{block_id:id,project_id:p.projectId,scope:"library",type:block.type,handle:`${block.handle}-fork-${String(this.store.head.get()+1).padStart(3,"0")}`,position:`l${String(this.store.head.get()+1).padStart(6,"0")}`,properties:{...block.properties,...(outputSetId?{context_set_id:outputSetId,context_set_root_id:id,combined_context_memberships:rootMemberships}:{}),authority:"authored",forked_from_block_id:block.id,source_document_id:block.properties.source_document_id||block.documentId||null,created_from:"library-block-editor"}}}];
    for(const relation of p.libraryBlockRelations.filter((item)=>item.fromBlockId===block.id)){
      const target=p.libraryBlocks.find((item)=>item.id===relation.toBlockId);if(!target)continue;
      let targetId=target.id;
      if(target.scope!=="library"||relation.kind==="artifact_contains"){
        targetId=crypto.randomUUID();
        const targetMemberships=combinedContextMemberships(target.properties).map((membership)=>({...membership,...(outputSetId?{contextSetId:outputSetId}:{})}));
        events.push({type:"BlockCreated",payload:{block_id:targetId,project_id:p.projectId,scope:"library",type:target.type,handle:`${target.handle}-fork-${String(this.store.head.get()+events.length+1).padStart(3,"0")}`,position:`l${String(this.store.head.get()+events.length+1).padStart(6,"0")}`,properties:{...target.properties,...(outputSetId?{context_set_id:outputSetId,context_set_root_id:id,reference_set_id:outputSetId,combined_context_memberships:targetMemberships}:{}),authority:"authored",forked_from_block_id:target.id,source_document_id:target.properties.source_document_id||target.documentId||null,created_from:"library-block-editor-related-fork"}}});
      }
      events.push({type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),project_id:p.projectId,from_block_id:id,to_block_id:targetId,kind:relation.kind,properties:{...relation.properties,...(outputSetId?{context_set_id:outputSetId}:{}),forked_from_relation_id:relation.id},source_surface:"library-block-editor"}});
    }
    if(membership)events.push({type:"CollectionItemAdded",payload:{collection_id:membership.collectionId,item_ref:{block_id:id},position:membership.position}});
    const copiedIds=new Map(events.filter((event)=>event.type==="BlockCreated").map((event)=>[String((event.payload.properties as Record<string,unknown>).forked_from_block_id),String(event.payload.block_id)]));
    const store=this.store,source=store.captureSourceOwnership(),route=store.route.get();
    const library=this.closest<FormaElement>("forma-library"),cleanDraft=this.#cleanDraft;
    const focus=captureOutputNavigationFocus(this.ownerDocument);let retired=false;
    const current=()=>!retired&&this.isConnected&&this.store===store&&this.closest("forma-library")===library
      &&Boolean(library?.isConnected&&FormaElement.hasStoreIdentity(library,store))
      &&store.route.get()===route&&store.projection.get().projectId===p.projectId
      &&store.projection.get().documentId===p.documentId&&this.#target().blockId===block.id
      &&this.#selected()?.id===block.id&&store.sourceOwnershipActive(source)&&focus.current();
    const dispose=()=>{retired=true;focus.dispose();};
    const unsubscribe=store.subscribe(()=>{if(!current())dispose();});
    try{
      const appended=await this.store.appendBatch(copyOutputRequirementCreationEvents(events,copiedIds));
      if(appended.length){
        // A committed clone does not consume another current raw draft.
        if(current()&&this.#draftFingerprint()===cleanDraft
          &&store.projection.get().libraryBlocks.some(value=>value.id===id)){this.#open(id);this.#loaded="";}
        if(store.sourceOwnershipActive(source))this.store.toast(events.some((item)=>item.type==="BlockRelationAdded")?"Independent context set forked with its reference relationships.":"Independent fork created. Editing it will not change the source document.");
      }
    }finally{unsubscribe();dispose();}
  }
  async #remove(){
    if(!this.isConnected||!this.#canAuthor())return;
    const block=this.#selected();if(!block||block.scope!=="library")return;
    const store=this.store,library=this.closest<FormaElement>("forma-library"),route=store.route.get(),projection=store.projection.get();
    const projectId=projection.projectId,documentId=projection.documentId,source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
    const fingerprint=this.#draftFingerprint(),focus=captureOutputNavigationFocus(this.ownerDocument);
    let retired=false;
    const dispose=()=>{retired=true;focus.dispose();};
    const current=()=>{
      if(!retired&&(!this.isConnected||this.store!==store||this.closest("forma-library")!==library
        ||!library?.isConnected||!FormaElement.hasStoreIdentity(library,store)||!this.#canAuthor()
        ||store.route.get()!==route||store.projection.get().projectId!==projectId||store.projection.get().documentId!==documentId
        ||this.#target().blockId!==block.id||this.#draftFingerprint()!==fingerprint
        ||!store.sourceOwnershipActive(source)||!store.authorizationScopeActive(authorization)||!focus.current()))dispose();
      return !retired;
    };
    const unsubscribe=store.subscribe(()=>{current();});
    try{
      if(!current())return;
      const appended=await store.removeOutputBlock({type:"BlockRemoved",payload:{block_id:block.id,scope:"library",reason:"removed-from-library-block-editor"}});
      if(appended.length){
        if(current()){
          // A confirmed removal may consume its original draft, but not newer
          // work. Render away only this owned confirmation before shared admission.
          this.#confirmRemove=false;this.requestUpdate();await this.updateComplete;
          if(current()&&!this.querySelector(".library-block-remove-dialog")){
            const opened=await this.#open();
            if(opened&&this.store===store&&this.#target().blockId===block.id&&this.#draftFingerprint()===fingerprint
              &&store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization))this.#loaded="";
          }
        }
        if(store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization))store.toast(appended.length>1?"The complete storyboard and its linked frames were removed together.":"Reusable block removed. Its history remains replayable.");
      }
    }finally{unsubscribe();dispose();}
  }

  #openOutputDocument(event:MouseEvent,block:CreativeBlock){
    const element=this.querySelector<HTMLElement>(".library-block-editor"),trigger=event.currentTarget;
    if(!(trigger instanceof HTMLElement)||!element||!block.documentId)return;
    const store=this.store,route=store.route.get(),projectId=store.projection.get().projectId;
    const blockId=block.id,documentId=block.documentId;
    const source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
    const current=()=>{
      const selected=this.#selected(),projection=store.projection.get();
      return this.isConnected&&this.store===store&&store.route.get()===route&&projection.projectId===projectId
        &&store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization)
        &&this.#target().blockId===blockId&&selected?.id===blockId&&selected.documentId===documentId
        &&selected.type.toLowerCase()==="output"&&this.querySelector(".library-block-editor")===element
        &&projection.documents.some(document=>document.id===documentId&&document.projectId===projectId&&!document.removed);
    };
    // This read-only section stays current until the original Store handoff.
    // Other retained Library editors are still checked by its existing owner.
    return navigateInApp(this,navigation=>store.openDocument(documentId,"/",undefined,navigation),{
      presentation:{owner:this,element,trigger,current},
    });
  }

  #outputInspection(block: CreativeBlock) {
    const projection=this.store.projection.get();
    const content=String(block.properties.text??"");
    const spec=block.properties.output_spec??parseOutputRequirement({id:block.id,Type:"Output",Subtype:block.properties.subtype,Content:content}).spec;
    const snapshot={scope:{projectId:projection.projectId,documentId:block.documentId||"",authorizationScopeKey:this.store.captureAuthorizationScope()?.key??""},requirementId:block.id,revision:this.store.head.get(),label:String(block.properties.subtype??this.i18n.system("Output")),originalText:content,spec,canEdit:false,canReviewPlan:false,summary:{headline:this.i18n.t("output.delivery.chooseDocument","Add this Output requirement to a Document to plan its deliverables."),detail:this.i18n.t("output.delivery.projectScope","Open the Document to change requirements or review exact files."),overall:"unknown",requiredRemaining:null,unresolvedGroups:null,selectedResultFiles:null},sourceOptions:[]};
    return html`<section class="library-block-editor"><header class="library-block-editor-header"><h1>${this.i18n.system("Output")}</h1><button type="button" class="button ghost" @click=${this.#close}>${this.i18n.system("Back to Library")}</button></header><p>${this.i18n.t("output.delivery.projectScope","Open the Document to change requirements or review exact files.")}</p>${block.documentId?html`<button type="button" class="button primary" @click=${(event:MouseEvent)=>this.#openOutputDocument(event,block)}>${this.i18n.system("Open Document")}</button><forma-output-requirements .documentId=${block.documentId} .blockId=${block.id} .inspectionOnly=${true}></forma-output-requirements>`:html`<forma-output-requirement-card .snapshot=${snapshot} .resourceState=${"ready"} .presentation=${"full"}></forma-output-requirement-card>`}</section>`;
  }

  override render(){
    this.#ensureLoaded();const p=this.store.projection.get();const block=this.#selected();const canAuthor=this.#canAuthor();const governed=Boolean(block?.properties.organization_context_package_binding_id);const editable=canAuthor&&(!this.#target().blockId||Boolean(block))&&(!block||block.scope==="library")&&!governed;const definition=blockTypeDefinition(this.#type)!;const standalone=p.libraryBlocks.filter((item)=>item.scope==="library");const documentBlocks=p.libraryBlocks.filter((item)=>item.scope==="document");const structuralFrames=new Set(p.libraryBlockRelations.filter((relation)=>relation.kind==="artifact_contains").map((relation)=>relation.toBlockId));const referenceBlocks=standalone.filter((item)=>item.type==="reference"&&isImageReference(item.properties)&&item.id!==block?.id&&!structuralFrames.has(item.id));const sourceDocument=block?.documentId?p.documents.find((document)=>document.id===block.documentId):undefined;const imageReference=this.#type==="reference"&&(!block||block.type!=="reference"||isImageReference(block.properties));const selectedReferenceMedium=block?.type==="reference"?referenceMedium(block.properties):"unknown";
    if(block?.type.toLowerCase()==="output") return this.#outputInspection(block);
    if(!editable)return html`<section class="library-block-editor library-block-inspection" aria-labelledby="library-block-editor-title"><header class="library-block-editor-header"><div><h1 id="library-block-editor-title">${this.i18n.t("projects.editorView","View reusable context")}</h1><p>${block&&canAuthor&&!governed?this.i18n.system("“{handle}” still shapes {value}. Forking preserves its content and filing while giving the new block an independent identity.",{handle:block.handle,value:sourceDocument?.title??this.i18n.system("its document")}):this.i18n.t("projects.readOnlyLibrary","You can inspect shared project decisions and creative results.")}</p></div><button type="button" class="button ghost" @click=${this.#close}>${this.i18n.t("context.controls.backLibrary","Back to Library")}</button></header>${block?html`<forma-context-block .block=${block} .readOnly=${true} surface="library"></forma-context-block>${canAuthor&&!governed?html`<div class="focus-preview-actions"><button type="button" class="button primary" @click=${()=>void this.#fork(block)}>${this.i18n.t("context.controls.fork","Fork as reusable block")}</button><button type="button" class="button secondary" @click=${()=>this.#useCopy(block)}>${this.i18n.t("projects.useDocument","Use in open document")}</button></div>`:nothing}`:html`<p>${this.i18n.t("context.controls.unavailable","That saved decision is no longer available. Return to the Library to choose another.")}</p>`}</section>`;
    return html`<section class="library-block-editor" aria-labelledby="library-block-editor-title">
      <header class="library-block-editor-header"><div><span class="eyebrow">Project library / Block editor</span><h1 id="library-block-editor-title">${!canAuthor?this.i18n.t("projects.editorView","View reusable context"):block?editable?this.i18n.t("projects.editorEdit","Edit a reusable block"):this.i18n.t("projects.editorFork","Fork a document block"):this.i18n.t("projects.editorCreate","Create reusable context")}</h1><p>${!canAuthor?this.i18n.system("Your shared-project role allows you to review this saved context."):editable?this.i18n.system("Build context once, file it with the project, and copy it into documents only when useful."):this.i18n.system("This source remains part of its document. Fork it to create an independently editable project block.")}</p>${block?html`<p class="context-library-state">${this.i18n.system(definition.label)} · ${this.i18n.system(BLOCK_INTENTS.find((item)=>item.id===blockIntentFor(block.type,block.properties))?.label??blockIntentFor(block.type,block.properties))} · ${this.i18n.t(block.locked?"context.controls.locked":"context.controls.unlocked",block.locked?"Locked":"Unlocked")}</p>`:nothing}</div><div>${block&&canAuthor&&!governed?html`<button type="button" class="button secondary" @click=${()=>this.#useCopy(block)}>${this.i18n.t("projects.useDocument","Use in open document")}</button>`:nothing}${canAuthor?html`<button class="button secondary" @click=${()=>this.#open()}>${icon("plus")} New block</button>`:nothing}<button class="button ghost" @click=${this.#close}>Back to Library</button></div></header>
      <div class=${`library-block-editor-layout ${this.#browserCollapsed?"context-collapsed":""} ${this.#filingCollapsed?"filing-collapsed":""}`}>
        <aside class=${`library-block-browser ${this.#browserCollapsed?"collapsed":""}`}>
          <header>${this.#browserCollapsed
            ? html`<button class="library-panel-toggle" aria-label=${this.i18n.t("projects.editorExpandContext","Expand project context")} title="Expand project context" aria-expanded="false" @click=${()=>{this.#browserCollapsed=false;this.requestUpdate();}}>${icon("next")}</button>`
            : html`<div><span class="eyebrow">Project context</span><h3>Available blocks</h3></div><span>${p.libraryBlocks.length}</span><button class="library-panel-toggle" aria-label=${this.i18n.t("projects.editorCollapseContext","Collapse project context")} title="Give the editor more room" aria-expanded="true" @click=${()=>{this.#browserCollapsed=true;this.requestUpdate();}}>${icon("previous")}</button>`}
          </header>
          ${this.#browserCollapsed?nothing:html`<div class="library-block-browser-section"><b>Independent blocks</b>${standalone.length?standalone.map((item)=>html`<button class=${block?.id===item.id?"selected":""} @click=${()=>this.#open(item.id)}><span>${item.type}</span><strong>${item.handle}</strong><small>${p.collections.find((collection)=>collection.id===p.membership[item.id]?.collectionId)?.handle??this.i18n.system("Unfiled")}</small></button>`):html`<p>No independent blocks yet.</p>`}</div><div class="library-block-browser-section"><b>From documents</b>${documentBlocks.map((item)=>html`<button class=${block?.id===item.id?"selected":""} @click=${()=>this.#open(item.id)}><span>${item.type}</span><strong>${item.handle}</strong><small>${p.documents.find((document)=>document.id===item.documentId)?.title??this.i18n.system("Document")}</small></button>`)}</div>`}
        </aside>
        <section class="library-block-workbench" aria-labelledby="library-block-editor-title">

          ${block&&editable?html`<forma-context-intelligence .block=${block} surface="library"></forma-context-intelligence>`:nothing}
          ${block?.properties.reference_composition ? html`<forma-reference-composition-editor .block=${block} .readOnly=${!editable} surface="library"></forma-reference-composition-editor>` : nothing}
          <form class=${`library-block-form ${editable?"":"read-only"}`} @submit=${this.#save} @keydown=${(event:KeyboardEvent)=>{if(event.isComposing)return;if(event.key==="Enter"&&(event.metaKey||event.ctrlKey)){event.preventDefault();event.stopPropagation();(event.currentTarget as HTMLFormElement).requestSubmit();}else if(event.key==="Escape"){event.preventDefault();event.stopPropagation();this.#close();}}}>
            <fieldset aria-labelledby="library-block-identity" ?disabled=${!editable||Boolean(block?.locked)}><h3 class="library-fieldset-heading" id="library-block-identity">Block identity</h3><label>Handle<input maxlength="96" placeholder=${this.i18n.system("{type}/short-name", { type: this.#type })} .value=${this.#handle} @input=${(event:InputEvent)=>{this.#handle=(event.target as HTMLInputElement).value;this.requestUpdate();}}><small>A stable, readable name. Leave blank to derive it from the content.</small></label><label>Type<select ?disabled=${block?.type==="model3d"||block?.type==="audio"&&Boolean(block.properties.media_url)} .value=${this.#type} @change=${(event:Event)=>this.#changeType((event.target as HTMLSelectElement).value as BlockKind)}>${BLOCK_GROUPS.map((group)=>html`<optgroup label=${this.i18n.system(group.label)}>${BLOCK_TYPES.filter((item)=>item.group===group.id&&item.type!=="output"&&(item.type!=="model3d"||!block||block.type==="model3d")).map((item)=>html`<option value=${item.type} ?selected=${item.type===this.#type}>${this.i18n.system(item.label)}</option>`)}</optgroup>`)}</select></label><label>Suggested subtype<select .value=${this.#subtype} @change=${(event:Event)=>{this.#subtype=(event.target as HTMLSelectElement).value;this.requestUpdate();}}>${repeat([...new Set([this.#subtype,...definition.subtypes])],(subtype)=>subtype,(subtype)=>html`<option value=${subtype} ?selected=${subtype===this.#subtype}>${this.i18n.system(subtype)}</option>`)}</select></label><label>Intent<select .value=${this.#intent} @change=${(event:Event)=>{this.#intent=(event.target as HTMLSelectElement).value as BlockIntent;this.requestUpdate();}}>${BLOCK_INTENTS.map((intent)=>html`<option value=${intent.id} ?selected=${intent.id===this.#intent}>${this.i18n.system(intent.label)} — ${this.i18n.system(intent.description)}</option>`)}</select></label></fieldset>
            ${this.#type==="audio"&&block?html`${renderAudioPlayer(String(block.properties.media_url??""),String(block.properties.label??block.handle),this.i18n,{transcript:String(block.properties.transcript??block.properties.lyrics??"")})}<fieldset class="audio-permissions" ?disabled=${!editable||Boolean(block.locked)}><legend>${this.i18n.t("artifact.audio.label","Audio")}</legend>${([{"path":"inform_generation","key":"inform"},{"path":"include_in_output","key":"include"},{"path":"allow_provider_audio_transfer","key":"transfer"}] as const).map(({path,key})=>{const hint=`library-audio-${block.id}-${key}`;return html`<label class="audio-permission"><input type="checkbox" aria-describedby=${hint} .checked=${block.properties[path]===true} @change=${(event:Event)=>void this.store.append({type:"BlockPropertyEdited",payload:{block_id:block.id,property_path:path,old_value:block.properties[path]===true,new_value:(event.currentTarget as HTMLInputElement).checked,source_surface:"library-audio-context"}})}><span><b>${this.i18n.t(`audio.use.${key}.label`,"")}</b><small id=${hint}>${this.i18n.t(`audio.use.${key}.description`,"")}</small></span></label>`;})}</fieldset>`:nothing}
            ${this.#type==="format"?html`<fieldset aria-labelledby="library-image-format" ?disabled=${!editable||Boolean(block?.locked)}><h3 class="library-fieldset-heading" id="library-image-format">Image frame</h3><div class="library-image-format"><label>Aspect ratio<select .value=${imageAspectRatioLabel(this.#imageFormat)} @change=${(event:Event)=>{this.#imageFormat=imageFormatForPreset((event.target as HTMLSelectElement).value);this.requestUpdate();}}>${IMAGE_FORMAT_PRESETS.map((preset)=>html`<option value=${preset.id}>${preset.id} · ${this.i18n.system(preset.label)}</option>`)}</select></label><label>Width<input type="number" min="64" max="8192" .value=${String(this.#imageFormat.dimensions.width)} @input=${(event:InputEvent)=>{this.#imageFormat=normalizeImageFormat({dimensions:{width:Number((event.target as HTMLInputElement).value),height:this.#imageFormat.dimensions.height}});this.requestUpdate();}}></label><label>Height<input type="number" min="64" max="8192" .value=${String(this.#imageFormat.dimensions.height)} @input=${(event:InputEvent)=>{this.#imageFormat=normalizeImageFormat({dimensions:{width:this.#imageFormat.dimensions.width,height:Number((event.target as HTMLInputElement).value)}});this.requestUpdate();}}></label></div><small>The target frame travels with every copy of this reusable block.</small></fieldset>`:nothing}
            <fieldset aria-labelledby="library-block-content" ?disabled=${!editable||Boolean(block?.locked)}><h3 class="library-fieldset-heading" id="library-block-content">Reusable content</h3>
              ${block&&outputInputDraft(block)?html`<forma-output-input-editor .block=${block} source="library-block-editor" @output-input-change=${(event:CustomEvent<{draft:{markdown:string}}>)=>{this.#copy=event.detail.draft.markdown;this.#derivedDirty=true;}}></forma-output-input-editor>`:html`${block?.properties.source_output_id?html`<label>Image title and caption<input .value=${this.#imageTitle} @input=${(event:InputEvent)=>{this.#imageTitle=(event.target as HTMLInputElement).value;}}></label>`:nothing}<forma-ui-rich-text class="block-editor-copy" .label=${block?.properties.source_output_id?this.i18n.system("Image description and creative direction"):block?.type==="reference"&&!imageReference?this.i18n.system("Source"):this.i18n.system("{label} content", { label: this.i18n.system(definition.label) })} .value=${this.#copy} .placeholder=${this.i18n.system(definition.prompt)} .help=${this.i18n.system("{description}. This remains project context until someone copies it into a document.", { description: this.i18n.system(definition.description) })} .rows=${6} ?disabled=${!editable||Boolean(block?.locked)} @forma-input=${(event:CustomEvent<{value:string}>)=>{this.#copy=event.detail.value;}}></forma-ui-rich-text>`}
              ${this.#type==="palette"?html`<div class="library-palette-editor"><span>Palette colors</span>${this.#colors.map((color,index)=>html`<label><input type="color" .value=${color} @input=${(event:InputEvent)=>{this.#colors=this.#colors.map((value,i)=>i===index?(event.target as HTMLInputElement).value:value);this.requestUpdate();}}><small>${color}</small></label>`)}</div>`:nothing}
              ${this.#type==="reference"&&block&&!imageReference?html`<div class="library-reference-editor library-reference-source" data-reference-medium=${selectedReferenceMedium}><span>${icon(selectedReferenceMedium==="audio"?"audio":selectedReferenceMedium==="video"?"video":"document")}</span><blockquote>${String(block.properties.source_excerpt??block.properties.text??block.properties.description??block.properties.label??"")}</blockquote></div>`:nothing}
              ${imageReference?html`<div class="library-reference-editor">${(block?.properties.reference_composition?block.properties.media_url:this.#mediaUrl)?html`<forma-reference-image .src=${block?.properties.reference_composition?String(block.properties.media_url):this.#mediaUrl} .alt=${block?.properties.source_output_id?this.#imageTitle:this.#copy||this.i18n.system("Reference preview")} .compact=${true} .targetId=${block?.id??""}></forma-reference-image>`:nothing}${block?.properties.reference_composition?nothing:html`<label>Reference image URL<input type="url" placeholder="https://…" .value=${this.#mediaUrl} @input=${(event:InputEvent)=>{this.#mediaUrl=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label>`}<label>How copied blocks use pixels<select .value=${this.#pixelMode} @change=${(event:Event)=>{this.#pixelMode=(event.target as HTMLSelectElement).value;this.requestUpdate();}}>${REFERENCE_PIXEL_MODES.map((mode)=>html`<option value=${mode.id} ?selected=${mode.id===this.#pixelMode}>${this.i18n.system(mode.label)}</option>`)}</select></label>${!block?html`<label class="library-reference-upload">Or upload an owned or licensed image<input type="file" accept="image/*" @change=${(event:Event)=>{this.#pendingFile=(event.target as HTMLInputElement).files?.[0]??null;this.#rightsConfirmed=false;this.requestUpdate();}}></label>${this.#pendingFile?html`<label class="rights-check"><input type="checkbox" .checked=${this.#rightsConfirmed} @change=${(event:Event)=>{this.#rightsConfirmed=(event.target as HTMLInputElement).checked;this.requestUpdate();}}><span>I confirm I own or may use ${this.#pendingFile.name} and, in a controlled pilot, that it contains no sensitive information.</span></label>`:nothing}`:nothing}</div>`:nothing}
              ${this.#modelEditor(block,editable)}
              <label class="library-weight" for=${this.#weightId}>${this.i18n.system("Default influence")} <output for=${this.#weightId}>${Math.round(this.#weight*100)}%</output><input id=${this.#weightId} aria-label=${this.i18n.system("Default influence")} type="range" min="0" max="1" step=".05" .value=${String(this.#weight)} @input=${(event:InputEvent)=>{this.#weight=Number((event.target as HTMLInputElement).value);this.requestUpdate();}}></label>
            </fieldset>
            ${this.#type!=="reference"?html`<fieldset class="library-reference-relations" aria-labelledby="library-block-references" ?disabled=${!editable||Boolean(block?.locked)}><h3 class="library-fieldset-heading" id="library-block-references">Related reference images</h3><p class="library-fieldset-note">Keep images as reusable reference blocks, then describe what each one contributes. Adding this block to a document also adds every connected reference as one context set.</p>${referenceBlocks.length?html`<div class="library-reference-relation-list">${referenceBlocks.map((reference)=>{const selectedKind=this.#referenceRelations.get(reference.id);return html`<article class=${selectedKind?"selected":""}><forma-reference-image .src=${String(reference.properties.media_url??"")} .alt=${String(reference.properties.label??reference.handle)} .compact=${true} .targetId=${reference.id} .referenceId=${String(reference.properties.reference_id??"")} .focalPoint=${reference.properties.focal_point}></forma-reference-image><div><label class="reference-relation-check"><input type="checkbox" .checked=${Boolean(selectedKind)} @change=${(event:Event)=>{if((event.target as HTMLInputElement).checked)this.#referenceRelations.set(reference.id,suggestedReferenceRelation(this.#type));else this.#referenceRelations.delete(reference.id);this.requestUpdate();}}><span><b>${String(reference.properties.label??reference.handle)}</b><small>${reference.handle}</small></span></label>${selectedKind?html`<label>Use this image for<select .value=${selectedKind} @change=${(event:Event)=>{this.#referenceRelations.set(reference.id,(event.target as HTMLSelectElement).value);this.requestUpdate();}}>${REFERENCE_RELATION_KINDS.map((kind)=>html`<option value=${kind.id}>${this.i18n.system(kind.label)}</option>`)}</select></label>`:nothing}</div></article>`;})}</div>`:html`<p class="library-reference-empty">No standalone reference images yet. Upload one below and it will remain independently reusable.</p>`}<div class="related-reference-upload"><label>Upload and relate a new reference<input type="file" accept="image/*" @change=${(event:Event)=>{this.#pendingRelatedFile=(event.target as HTMLInputElement).files?.[0]??null;this.#relatedRightsConfirmed=false;this.requestUpdate();}}></label>${this.#pendingRelatedFile?html`<label class="rights-check"><input type="checkbox" .checked=${this.#relatedRightsConfirmed} @change=${(event:Event)=>{this.#relatedRightsConfirmed=(event.target as HTMLInputElement).checked;this.requestUpdate();}}><span>I confirm I own or may use ${this.#pendingRelatedFile.name} and, in a controlled pilot, that it contains no sensitive information. It will become a separate project reference connected as ${this.i18n.system(REFERENCE_RELATION_KINDS.find((item)=>item.id===suggestedReferenceRelation(this.#type))?.label??"").toLocaleLowerCase(this.i18n.locale)}.</span></label>`:nothing}</div></fieldset>`:nothing}
            ${!block?html`<fieldset aria-labelledby="library-block-filing"><h3 class="library-fieldset-heading" id="library-block-filing">Project filing</h3><label>Collection<select .value=${this.#collectionId} @change=${(event:Event)=>{this.#collectionId=(event.target as HTMLSelectElement).value;this.requestUpdate();}}><option value="">Unfiled</option>${p.collections.map((collection)=>html`<option value=${collection.id}>${collection.handle}</option>`)}</select><small>The same collection may also contain documents. Access follows the project container.</small></label></fieldset>`:nothing}
            <footer>${block&&editable?html`<button type="button" class="button danger" ?disabled=${block.locked} @click=${()=>{this.#confirmRemove=true;this.requestUpdate();}}>${icon("trash")} Remove</button><button type="button" class="button secondary" @click=${()=>this.#fork(block)}>Fork</button><button type="button" class="button ghost" @click=${()=>this.store.append({type:block.locked?"BlockUnlocked":"BlockLocked",payload:{block_id:block.id,scope:"library",locked_by:"user"}})}>${icon(block.locked?"lock":"unlock")} ${block.locked?this.i18n.system("Unlock"):this.i18n.system("Lock")}</button>`:html`<span></span>`}<button class="button primary" ?disabled=${!editable||this.#uploading||this.#geometryBusy()||Boolean(block?.locked)}>${this.#uploading?this.i18n.system("Uploading…"):block?this.i18n.system("Save changes"):this.i18n.system("Create reusable block")}</button></footer>
          </form>
        </section>
        <aside class=${`library-block-filing ${this.#filingCollapsed?"collapsed":""}`}>
          <header>${this.#filingCollapsed
            ? html`<button class="library-panel-toggle" aria-label=${this.i18n.t("projects.editorExpandFolders","Expand project and folders")} title="Expand project and folders" aria-expanded="false" @click=${()=>{this.#filingCollapsed=false;this.requestUpdate();}}>${icon("previous")}</button>`
            : html`<div><span class="eyebrow">Shared containers</span><h3>Project & folders</h3></div><button class="library-panel-toggle" aria-label=${this.i18n.t("projects.editorCollapseFolders","Collapse project and folders")} title="Give the editor more room" aria-expanded="true" @click=${()=>{this.#filingCollapsed=true;this.requestUpdate();}}>${icon("next")}</button>`}
          </header>
          ${this.#filingCollapsed?nothing:html`<p>Documents and blocks inherit access from this project and use the same authored collection tree.</p><forma-collection-tree destination=${libraryBlockEditorRoute(block?.id??"",this.store.route.get())} item-kind="block" item-id=${block?.scope==="library"?block.id:""} item-label=${block?.handle??""}></forma-collection-tree>`}
        </aside>
      </div>
      ${this.#confirmRemove&&block?html`<dialog class="modal library-block-remove-dialog" closedby="any" aria-labelledby="library-block-remove-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget){this.#confirmRemove=false;this.requestUpdate();}}} @cancel=${(event:Event)=>{event.preventDefault();this.#confirmRemove=false;this.requestUpdate();}}><div class="modal-card"><button class="icon-button modal-close" aria-label=${this.i18n.t("projects.editorCancelRemoval","Cancel removal")} @click=${()=>{this.#confirmRemove=false;this.requestUpdate();}}>${icon("close")}</button><span class="eyebrow">Reversible removal</span><h2 id="library-block-remove-title">Remove “${block.handle}”?</h2><p>${this.store.outputOwnedBlockCount(block.id)?this.i18n.system("The storyboard and all {value} linked frames disappear together. One Undo restores the complete set.", { value: this.i18n.number(this.store.outputOwnedBlockCount(block.id)) }):this.i18n.system("It will disappear from active project and collection views. Its event history remains available for replay and Undo.")}</p><footer><button class="button ghost" @click=${()=>{this.#confirmRemove=false;this.requestUpdate();}}>Cancel</button><button class="button danger" @click=${this.#remove}>Remove block</button></footer></div></dialog>`:nothing}
    </section>`;
  }
}

if (!customElements.get("forma-library-block-editor")) customElements.define("forma-library-block-editor",LibraryBlockEditor);

declare global { interface HTMLElementTagNameMap { "forma-library-block-editor": LibraryBlockEditor } }
