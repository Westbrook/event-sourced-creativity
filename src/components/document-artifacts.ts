import { storyboardAudienceHtml } from "../model/storyboard-audience.ts";
import { documentJobCanCheckSavedPresentationReceipt, savedPresentationReceiptCheckMessage, type PresentationReceiptCheckStatus } from "../model/presentation-receipt-check.ts";
import { html, noChange, nothing, type PropertyValues } from "lit";
import { NativeShortStoryController, type NativeStoryOpening } from "./native-short-story-controller.ts";
import { nativeStoryDialogPresentation, renderNativeStoryDialog } from "./native-short-story-dialog.ts";
import { nativeStoryRetainedRoute } from "../model/native-short-story-generation.ts";
import { captureNativeSceneHandle, nativeSceneRetainedRoute } from "../model/native-scene-completion.ts";
import { captureNativeSlidesHandle, nativeSlidesRetainedRoute } from "../model/native-slides-completion.ts";
import { captureNativeStoryboardHandle, nativeStoryboardRetainedRoute } from "../model/native-storyboard-completion.ts";
import { captureNativeAudioHandle, nativeAudioRetainedRoute } from "../model/native-audio-completion.ts";
import { captureNativeVideoHandle, nativeVideoRetainedRoute } from "../model/native-video-completion.ts";
import { captureNativeModel3dHandle, nativeModel3dRetainedRoute } from "../model/native-model3d-completion.ts";
import { readNativeSceneCompletion, readNativeSlidesCompletion, readNativeStoryboardCompletion, readNativeAudioCompletion, readNativeVideoCompletion, readNativeModel3dCompletion } from "../model/retained-short-story-client.ts";
import { readNativeRetainedAudioMedia } from "../model/native-retained-audio-media.ts";
import { inspectPcmWav, trimPcmWav } from "../model/audio-container.ts";
import { prepareLocalAudioConversion } from "../model/audio-local-conversion-browser.ts";
import type { AudioLocalConversion } from "../model/audio-local-conversion.ts";
import type { AudioTrimEditCode, AudioTrimEditRequest } from "../model/document-artifacts.ts";
import { audioTrimCopy } from "./design-system/locales/audio-trim-messages.ts";
import { type AudioTrimSelection } from "./audio-trim-editor.ts";
import "./audio-trim-editor.ts";
import { inspectVideoPrefix, trimVideoPrefix, VIDEO_PREFIX_TRIM_MAX_BYTES } from "../model/video-container.ts";
import { ownerMediaNamespace } from "../model/media-ownership.ts";
import { videoArtifactMediaItem, type VideoTrimEditCode, type VideoTrimEditRequest } from "../model/document-artifacts.ts";
import { videoTrimCopy } from "./design-system/locales/video-trim-messages.ts";
import { type VideoTrimSelection } from "./video-trim-editor.ts";
import "./video-trim-editor.ts";
import { model3dArtifactMediaFile } from "../model/document-artifacts.ts";
import { prepareModel3dArtifactScale, type Model3dArtifactScalePreparation, type Model3dArtifactScaleSource, type Model3dScaleEditRequest } from "../model/model3d-artifact-revision.ts";
import { GeometryScaleError, type Model3dGeometryBounds } from "../model/model3d-geometry-edit.ts";
import { MAX_MODEL3D_UPLOAD_BYTES } from "../model/model3d-assets.ts";
import type { Model3dScaleEditCode } from "../model/model3d-media-revision.ts";
import { model3dScaleCopy } from "./design-system/locales/model3d-artifact-scale-messages.ts";
import { renderModel3dArtifactScaleEditor, renderModel3dArtifactScaleActions, type Model3dArtifactScaleView } from "./model3d-artifact-scale-editor.ts";
import "./native-short-story-dialog.css";
import { cache } from "lit/directives/cache.js";
import { keyed } from "lit/directives/keyed.js";
import { localizeTemplateResult } from "./design-system/localized-template";
import { ensureModalDialog, requestDialogText } from "./modal-dialog";
import { retainCreativePreparation, type CreativePreparationGuard, type CreativePreparationStage } from "../model/workspace-intelligence";
import { nextActionFacts } from "../state/next-action-context";
import { artifactDeliveryFor } from "../state/artifact-delivery-context";
import type { ArtifactDeliveryIntent } from "../model/artifact-delivery";
import { documentContextBlockRoute, libraryFocusFromRoute, libraryFocusRoute, libraryRootRoute } from "../model/routes";
import { navigateInApp, navigationPresentationClosing, navigationPresentationMatches, type NavigationPresentationContext } from "./command-departure";
import { reuseManualOutput, type ManualOutputReuse } from "./manual-output-reuse";
import { outputNavigationOwnedRouteFocus } from "./output-navigation-focus";
import { DOCUMENT_ARTIFACT_KINDS, SLIDE_STYLE_PRESETS, documentArtifactRevision, documentArtifactDefinition, parseDocumentArtifactContent, type DocumentArtifact, type DocumentArtifactDraftItem, type DocumentArtifactItem, type DocumentArtifactKind, type SlideStylePresetId } from "../model/document-artifacts";
import { authorizedGenerationFailureRemediation, documentJobCanRecoverPresentation, documentJobCanRecoverProviderRender, documentJobFailure, documentJobFailureVisible, generationFailureGuidance, type DocumentJob } from "../model/document-jobs";
import { documentRenderSuggestions } from "../model/document-render-suggestions";
import { DOCUMENT_RENDER_GUIDANCE_MAX_LENGTH, documentRenderGuidance } from "../model/document-render-guidance.ts";
import { restoreDocumentRenderSettings, type RestoredDocumentRenderSettings } from "../model/document-render-request.ts";
import { inferDocumentArtifactKind } from "../model/document-output-intent";
import { foldEvents } from "../model/events";
import { focalPointCss } from "../model/focal-point";
import { artifactGenerationInputInspection, documentGenerationInputInspection, failedGenerationInputInspection } from "../model/generation-inputs";
import { positionImageAtFocalPoint } from "../model/image-focus";
import { videoReferencePreflight, type VideoReferencePreflightItem } from "../model/video-references";
import { DEFAULT_MODEL3D_SETTINGS, RODIN_IMAGE_MIME_TYPES, RODIN_MAX_IMAGE_REFERENCES, estimateModel3dCostMicrousd, validateModel3dRequest, type Model3dSettings } from "../model/model3d";
import { model3dAdaptationReceipt, type Model3dDocumentAdaptation } from "../model/model3d-prompt-adapter";
import { model3dArtifactFiles, model3dPreviewFile, type Model3dArtifactFile } from "./model3d-output";
import { DEFAULT_REFERENCE_VIDEO_MODEL, DEFAULT_VIDEO_MODEL, normalizeVideoDurationSeconds, VIDEO_ADAPTER_CONTRACT, VIDEO_DURATION_SECONDS, type VideoAudioMode, type VideoDurationSeconds } from "../model/video-adapter";
import {
  VIDEO_AUDIO_REFERENCE_CONTRACT, audioFactProhibited, audioFileExtension, audioPlaybackTiming,
  normalizeAudioRequestProfile, selectAudioAdapterContract, type AudioDestination, type AudioGenerationGoal,
  type AudioRequestProfile,
} from "../model/audio";
import { formatGenerationUsd, generationBudgetGate } from "../model/generation-budget";
import { MAX_MANAGED_PRESENTATION_SLIDES, buildManagedProductionPlan, minimumPresentationSlideCount, productionTeamFor, selectArtifactProductionKind, type ProductionFormat, type ProductionMode } from "../model/managed-production";
import { buildPresentationSourceContract, inferPresentationSourceOutline } from "../model/presentation-source";
import { formatPresentationSourceIssue, formatPresentationSourceIssues } from "./presentation-source-guidance";
import { creatorProductionSummary } from "../model/production-summary";
import { describeOutput, describeOutputs, imageOutputNamingCandidate } from "../model/output-naming";
import { model3dArtifactContextReadiness } from "../model/output-context";
import { createSceneConfiguration, isSceneMedium, type SceneMedium } from "../model/scene-configuration";
import { renderSceneProviderDisclosure } from "./scene-provider-disclosure";
import { isSceneCostPreview, isSceneSafeUnusedProof, sceneCostRequestDescription, sceneCostRequestHash, type SceneCostInspection, type SceneCostRequest } from "../model/scene-cost-consent";
import { FormaElement, icon } from "./forma-element";
import { captureOutputNavigationFocus } from "./output-navigation-focus";
import type { FormaUiPopover } from "./design-system/feedback";
import "./design-system/feedback";
import { renderVideoReel } from "./video-reel";
import { renderAudioPlayer, renderIncludedSoundtrackTranscripts, renderSoundtrackCompanions as renderAudioCompanions, soundtrackCompanions, type SoundtrackAsset } from "./audio-playback";
import type { FormaIconName } from "./icons";
import { readSlideFooterLabelPreference } from "./presentation-slide";
import { artifactReviewState, artifactSourceVersions } from "../model/context-health";
import { runReadyImageGeneration } from "../model/generation-intent";
import {
  DOCUMENT_PRODUCTION_WORKFLOW_EVENT,
  moveProductionWorkflowStage,
  productionWorkflowIssues,
  productionWorkflowRecordedSources,
  productionWorkflowSceneConfiguration,
  productionWorkflows,
  productionWorkflowSourceIdentity,
  productionWorkflowSourcesForStage,
  productionWorkflowStageStates,
  recommendProductionWorkflow,
  type ProductionWorkflow,
  type ProductionWorkflowSource,
  type ProductionWorkflowStage,
} from "../model/production-workflow";
import type { ArtifactRevisionDetail, ArtifactRevisionSummary, CapturedSourceOwnership, SceneSubmissionResult } from "../state/store";
import { localizedDocumentJobProgress, localizedGenerationFailureGuidance } from "./design-system/localized-runtime-copy";
import "./icons-media";
import "./presentation-deck";
import "./generation-input-dialog";
import "./presentation-rejected-drafts";
import "./video-reference-preflight";
import "./model3d-settings-editor";
import "./model3d-viewer";
import "./model3d-generation.css";

const kindIcon=(kind:DocumentArtifactKind):FormaIconName=>kind==="short_story"?"story":kind==="scene"?"scene":kind==="slides"?"slides":kind==="storyboard"?"storyboard":kind==="audio"?"audio":kind==="model3d"?"layers":"video";

/** Return recorded media playback length, never generation latency or an audio estimate. */
export function documentArtifactPlaybackSeconds(artifact:Pick<DocumentArtifact,"kind"|"items"|"settings"|"mediaUrl">):number|null{
  if(artifact.kind==="audio"){
    const timing=audioPlaybackTiming(artifact.settings,artifact.mediaUrl);
    return timing&&timing.basis!=="estimate"?timing.seconds:null;
  }
  if(artifact.kind!=="video")return null;
  const sceneDurations=artifact.items.map((item)=>item.durationSeconds);
  if(sceneDurations.length>0&&sceneDurations.every((seconds):seconds is number=>typeof seconds==="number"&&Number.isFinite(seconds)&&seconds>0)){
    const total=sceneDurations.reduce((sum,seconds)=>sum+seconds,0);
    if(Number.isFinite(total)&&total>0)return total;
  }
  const configured=artifact.settings.video_seconds;
  return typeof configured==="number"&&Number.isFinite(configured)&&configured>0?configured:null;
}

type NativeStoryCloseLease = { dialog:HTMLDialogElement; current:()=>boolean; closedCurrent:()=>boolean };

type AudioTrimDraft = {
  artifactId: string; abort: AbortController; current: () => boolean; basisCurrent: () => boolean;
  selection: AudioTrimSelection | null; startFrame: number; endFrame: number; sampleRate: number;
  expectedRevision: number; expectedContentSha256: string; mediaSha256: string;
  conversion: AudioLocalConversion | null; conversionAvailable: boolean; conversionFailed: boolean;
  mediaUrl: string; mediaType: string;
  loading: boolean; saving: boolean; checking: boolean; request: AudioTrimEditRequest | null; code: AudioTrimEditCode | null;
};

type VideoTrimDraft = {
  artifactId: string; itemId: string; mediaUrl: string; abort: AbortController;
  current: () => boolean; basisCurrent: () => boolean;
  bytes: Uint8Array | null; selection: VideoTrimSelection | null;
  expectedRevision: number; expectedContentSha256: string;
  loading: boolean; saving: boolean; checking: boolean;
  request: VideoTrimEditRequest | null; code: VideoTrimEditCode | null;
  invalidRangeFromInput: Element | null;
};

type Model3dScaleDraft = {
  artifactId:string; mediaUrl:string; byteLength:number; rawContent:string;
  abort:AbortController; current:()=>boolean; basisCurrent:()=>boolean;
  source:Model3dArtifactScaleSource|null; bytes:Uint8Array|null;
  prepared:Model3dArtifactScalePreparation|null; beforeBounds:Model3dGeometryBounds|null; factor:string; preparation:number;
  loading:boolean; preparing:boolean; saving:boolean; checking:boolean;
  request:Model3dScaleEditRequest|null; code:Model3dScaleEditCode|null;
};

type SceneRequestHandle = { requestId: string; everDispatched: boolean };
type SceneCostView = {
  handle: SceneRequestHandle; request: SceneCostRequest; sourceSurface: string; requestHash: string;
  formCurrent: () => boolean; current: () => boolean; busy: boolean;
  inspection: SceneCostInspection | null; checked: boolean; error: "" | "unavailable" | "source-index" | "recovery";
};
// Navigation continuity only: no private source, quote, job or accounting is retained here.
// It is deliberately transient and never evicts an unresolved request to admit another.
const sceneRequestHandles = new WeakMap<object, Map<string, SceneRequestHandle>>();
const MAX_SCENE_REQUEST_HANDLES = 32;

type Model3dSubmitBasis = Readonly<{
  adaptation:Model3dDocumentAdaptation;revision:string;opening:CreativePreparationGuard;
  form:HTMLFormElement;dialog:HTMLDialogElement;kind:"model3d";
}>;

export class DocumentArtifacts extends FormaElement {
  static properties={compact:{type:Boolean},source:{type:String},documentId:{type:String,attribute:"document-id"},launcherOnly:{type:Boolean,attribute:"launcher-only"}};
  compact=false;source="document";documentId="";launcherOnly=false;#kind:DocumentArtifactKind="short_story";#productionMode:ProductionMode="manual";#storyboardManagedDefault=false;#storyboardManualOptOut=false;#itemCount=6;#managedSlideInput="";#invalidSlideCount=false;#presentationStyle:SlideStylePresetId|"document"="document";#presentationFidelity:"faithful"|"creative"="faithful";#audience="";#tone="";#rememberedAudiences=new Set<string>();#rememberedTones=new Set<string>();#seconds:VideoDurationSeconds=VIDEO_ADAPTER_CONTRACT.defaultDuration;#videoSize:"1280x720"|"720x1280"="1280x720";#restoredVideoResolution:"480p"|"720p"|undefined;#videoAudioMode:VideoAudioMode=VIDEO_ADAPTER_CONTRACT.defaultAudioMode;#confirmed=false;#submitting=false;#referenceBusy=false;#activeId="";#inputId="";#failedInputJob:DocumentJob|null=null;#runningInputJob:DocumentJob|null=null;#actorInputContent:Record<string,string>={};#createOpen=false;#convertingId="";#showAll=false;#editingId="";#editMarkdown="";#editItems:Array<{title:string;body:string;notes:string}>=[];#editRevision=0;#savingEdit=false;#historyOpen=false;#historyBusy=false;#revisionHistory:ArtifactRevisionSummary[]=[];#revisionBefore:number|null=null;#revisionPreview:ArtifactRevisionDetail|null=null;#reviewers:Array<{userId:string;displayName:string}>=[];#selectedReviewerId="";#reviewNote="";#viewerFocused=false;#reviewPanelOpen=false;#viewerActionsOpen=false;#viewerReturnFocus?:HTMLElement;
  #soundtrackBlockIds:string[]=[];#sendSoundtrackToVideoProvider=false;#audioImageBlockId="";#reconcilingProviderJobId="";
  #audioGoal:AudioGenerationGoal="music";#audioDestination:AudioDestination="standalone";#audioDuration=30;#audioDurationInput="30";#invalidAudioDuration=false;#audioSpeakerCount=1;#audioInstrumental=false;#audioVideoArtifactId="";#sendAudioVideoToProvider=false;
  #requestDrafts=new Map<DocumentArtifactKind,{audience:string;tone:string;productionMode:ProductionMode;itemCount:number;managedSlideInput:string;invalidSlideCount:boolean}>();
  #requestReviewEpoch=0;
  #requestReviewLoading=false;
  #restoredRequest:{jobId:string;needsTransferConfirmation:boolean}|null=null;
  #model3dSettings:Model3dSettings=structuredClone(DEFAULT_MODEL3D_SETTINGS);
  #model3dReferenceBlockIds:string[]=[];#model3dDraftRevision=0;
  #model3dSubmitBasis=new WeakMap<SubmitEvent,Model3dSubmitBasis|null>();
  #model3dSubmitEvents=new WeakSet<SubmitEvent>();
  #sceneMedium:SceneMedium="visual";
  #sceneCostView:SceneCostView|null=null;
  #sceneCostRevision=0;
  #sceneSourcesRefreshed=false;
  #sceneCapacityDestination:string|null=null;
  #sceneSubmitting:SceneCostView|null=null;
  #sceneInputCurrent:(()=>boolean)|null=null;
  #workflowTarget:ProductionFormat="video";#workflowTargetSelected=false;#workflowDocumentScope="";#workflowExpanded:boolean|null=null;#activeWorkflowId="";#activeWorkflowStageId="";#workflowBusy=false;#workflowRisk:{workflowId:string;stageId:string;requestKey:string;summary:string}|null=null;#autoBoundWorkflowEvents=new Set<string>();
  #pendingWorkflowRegeneration:{workflowId:string;documentId:string;stageId:string;source:ProductionWorkflowSource;sceneSubmission?:{requestId:string;pending:boolean;dispatched:boolean}}|null=null;
  #reviewIntentRevision=0;
  #outputReuse:ManualOutputReuse={cancel:null};
  // One native close already dispatched by this viewer, not a receipt or draft.
  // Retain its guard through cancellation until the original close is delivered.
  #viewerCloseGuard:{viewer:()=>boolean;dialog:HTMLDialogElement;current:()=>boolean}|null=null;
  #editDraftRevision=0;
  #audioTrim:AudioTrimDraft|null=null;
  #audioTrimNotice:{artifactId:string;code:"saved"|"unchanged";current:()=>boolean}|null=null;
  #videoTrim:VideoTrimDraft|null=null;
  #videoTrimNotice:{artifactId:string;code:"saved"|"unchanged";current:()=>boolean}|null=null;
  #model3dScale:Model3dScaleDraft|null=null;
  #model3dScaleNotice:{artifactId:string;code:"saved"|"unchanged";current:()=>boolean}|null=null;
  #presentationReceiptCheck:{jobId:string;status:PresentationReceiptCheckStatus|"checking";current:()=>boolean}|null=null;
  #nativeStoryController:NativeShortStoryController|null=null;
  #nativeStoryOpening:NativeStoryOpening|null=null;
  #nativeStoryEpoch=0;
  #nativeStoryIntentRevision=0;
  #nativeStoryCurrent:CreativePreparationGuard|null=null;
  #nativeStoryAudience="";#nativeStoryTone="";#nativeStoryLocale="";#nativeStoryDocumentTitle="";
  #nativeStoryComposing=false;
  #nativeStoryOpener:HTMLElement|undefined;
  // One admitted close only; its in-flight receipt is never restored as dialog state.
  #nativeStoryCloseLease:NativeStoryCloseLease|null=null;
  #createOpener:HTMLElement|undefined;
  #sceneResultRead:{view:SceneCostView;abort:AbortController}|null=null;
  #sceneResultCloseLease:NativeStoryCloseLease|null=null;
  #slidesResultRead:{jobId:string;abort:AbortController}|null=null;
  #slidesResultError:string|null=null;
  #slidesCompletedJobs=new Map<string,{job:DocumentJob;current:()=>boolean;retired?:true}>();
  #slidesOverflow:{documentId:string;current:()=>boolean}|null=null;
  #storyboardResultRead:{jobId:string;abort:AbortController}|null=null;
  #storyboardResultError:string|null=null;
  #storyboardCompletedJobs=new Map<string,{job:DocumentJob;current:()=>boolean;retired?:true}>();
  #storyboardOverflow:{documentId:string;current:()=>boolean}|null=null;
  #audioResultRead:{jobId:string;abort:AbortController}|null=null;
  #audioResultError:string|null=null;
  #audioCompletedJobs=new Map<string,{job:DocumentJob;current:()=>boolean;retired?:true}>();
  #audioOverflow:{documentId:string;current:()=>boolean}|null=null;
  #videoResultRead:{jobId:string;abort:AbortController}|null=null;
  #videoResultError:string|null=null;
  #videoCompletedJobs=new Map<string,{job:DocumentJob;current:()=>boolean;retired?:true}>();
  #videoOverflow:{documentId:string;current:()=>boolean}|null=null;
  #model3dResultRead:{jobId:string;abort:AbortController}|null=null;
  #model3dResultError:string|null=null;
  #model3dCompletedJobs=new Map<string,{job:DocumentJob;current:()=>boolean;retired?:true}>();
  #model3dOverflow:{documentId:string;current:()=>boolean}|null=null;
  #nativeStoryPageHidden=()=>{if(this.ownerDocument.visibilityState==="hidden"){this.retireNativeShortStory();this.#sceneResultRead?.abort.abort();this.#slidesResultRead?.abort.abort();this.#storyboardResultRead?.abort.abort();this.#audioResultRead?.abort.abort();this.#videoResultRead?.abort.abort();this.#model3dResultRead?.abort.abort();}};
  #nativeStoryPageHide=()=>{this.retireNativeShortStory();this.#sceneResultRead?.abort.abort();this.#slidesResultRead?.abort.abort();this.#storyboardResultRead?.abort.abort();this.#audioResultRead?.abort.abort();this.#videoResultRead?.abort.abort();this.#model3dResultRead?.abort.abort();};
  #nativeModel3dJob(job:DocumentJob){
    return this.#nativeStoryEligible(job.documentId)&&job.kind==="render_document"&&job.status==="completed"
      &&job.sourceSurface==="document"&&job.productionMode==="manual"&&job.result?.artifactKind==="model3d";
  }
  #nativeModel3dJobIdentity(job:DocumentJob){
    return JSON.stringify([job.jobId,job.documentId,job.kind,job.status,job.sourceSurface,job.productionMode,
      job.documentRevision,job.requestKey,job.requestedAt,job.completedAt,job.attemptCount,job.result?.artifactKind,job.result?.artifactId]);
  }
  async #openOriginalModel3d(job:DocumentJob,event:MouseEvent,renderedCurrent:()=>boolean){
    const trigger=event.currentTarget;
    if(!(trigger instanceof HTMLButtonElement)||!this.contains(trigger)||this.#model3dResultRead
      ||!renderedCurrent()||!this.#nativeModel3dJob(job)||!this.#readonlyReuseView()||this.#activeId||this.#convertingId)return false;
    const handle=captureNativeModel3dHandle({documentId:job.documentId,jobId:job.jobId});if(!handle)return false;
    const store=this.store,source=this.#privateSourceCurrent(),authorization=store.captureAuthorizationScope(),route=store.route.get();
    const identity=this.#nativeModel3dJobIdentity(job),artifactId=job.result?.artifactId,read={jobId:job.jobId,abort:new AbortController()};
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    const current=()=>this.#model3dResultRead===read&&!read.abort.signal.aborted&&renderedCurrent()&&source()
      &&this.store===store&&store.authorizationScopeActive(authorization)&&store.route.get()===route
      &&this.ownerDocument.visibilityState!=="hidden"&&!this.closest("[hidden],[inert]")
      &&trigger.isConnected&&this.contains(trigger)&&trigger.dataset.nativeModel3dJob===handle.jobId&&focus.current()
      &&this.#readonlyReuseView()&&!this.#activeId&&!this.#convertingId&&!this.#model3dCompletedJobs.get(handle.jobId)?.retired
      &&(()=>{
        const live=store.documentJobs.get().find(value=>value.jobId===handle.jobId);
        if(live)return this.#nativeModel3dJob(live)&&this.#nativeModel3dJobIdentity(live)===identity;
        const retained=this.#model3dCompletedJobs.get(handle.jobId);
        return Boolean(retained?.current()&&this.#nativeModel3dJob(retained.job)&&this.#nativeModel3dJobIdentity(retained.job)===identity);
      })();
    this.#model3dResultRead=read;this.#model3dResultError=null;this.requestUpdate();
    try{
      const completion=await readNativeModel3dCompletion(handle,{origin:location.origin,signal:read.abort.signal,current,
        request:(path,init)=>fetch(path,init)});
      if(!current())return false;
      const path=nativeModel3dRetainedRoute(completion,handle);if(!path)return false;
      await store.refreshEvents({readOnly:true,current});if(!current())return false;
      const selected=completion.selection,artifact=store.projection.get().libraryArtifacts.find(value=>value.id===selected.artifactId);
      if(selected.documentId!==handle.documentId||selected.artifactId!==artifactId
        ||!artifact||artifact.kind!=="model3d"||artifact.documentId!==selected.documentId
        ||documentArtifactRevision(store.events.get(),artifact.id)!==selected.revision)return false;
      const original={id:artifact.id,sourceEventId:artifact.sourceEventId,contentRef:artifact.contentRef,sequence:artifact.sequence,
        inputRef:artifact.inputRef??null,mediaUrl:artifact.mediaUrl,mediaType:artifact.mediaType,itemCount:artifact.itemCount,files:JSON.stringify(artifact.settings.model3d_files??null)};
      const exact=()=>Date.parse(completion.expiresAt)>Date.now()&&nativeModel3dRetainedRoute(completion,handle)===path
        &&store.projection.get().libraryArtifacts.some(value=>value.id===original.id&&value.kind==="model3d"
          &&value.documentId===selected.documentId&&value.sourceEventId===original.sourceEventId
          &&value.contentRef===original.contentRef&&value.sequence===original.sequence
          &&(value.inputRef??null)===original.inputRef&&value.mediaUrl===original.mediaUrl
          &&value.mediaType===original.mediaType&&value.itemCount===original.itemCount
          &&JSON.stringify(value.settings.model3d_files??null)===original.files)
        &&documentArtifactRevision(store.events.get(),original.id)===selected.revision;
      return await navigateInApp(this,navigation=>current()&&exact()&&navigation.current()
        ?navigation.route(path,{documentFocus:false}):false);
    }catch{
      if(current())this.#model3dResultError=handle.jobId;
      return false;
    }finally{
      focus.dispose();read.abort.abort();if(this.#model3dResultRead===read)this.#model3dResultRead=null;
      this.requestUpdate();
    }
  }
  #nativeModel3dCompletions(){
    const source=this.#privateSourceCurrent(),live=this.store.documentJobs.get();
    for(const [id,retained] of this.#model3dCompletedJobs){
      const current=live.find(job=>job.jobId===id);
      if(!retained.current()||!this.#nativeModel3dJob(retained.job))this.#model3dCompletedJobs.delete(id);
      else if(current&&(!this.#nativeModel3dJob(current)||this.#nativeModel3dJobIdentity(current)!==this.#nativeModel3dJobIdentity(retained.job)))retained.retired=true;
    }
    if(this.#model3dOverflow&&(!this.#model3dOverflow.current()||!this.#nativeStoryEligible(this.#model3dOverflow.documentId)))this.#model3dOverflow=null;
    let capacity=Boolean(this.#model3dOverflow);
    for(const job of live.filter(value=>this.#nativeModel3dJob(value))){
      if(this.#model3dCompletedJobs.has(job.jobId))continue;
      if(this.#model3dCompletedJobs.size>=120){this.#model3dOverflow??={documentId:job.documentId,current:source};capacity=true;continue;}
      // Keep an observed exact completion across the ordinary feed ACK. Its
      // authority is still re-read before Open; it is never a cached receipt.
      const captured=Object.freeze({...job,result:job.result?Object.freeze({...job.result}):job.result});
      this.#model3dCompletedJobs.set(job.jobId,{job:captured,current:source});
    }
    const jobs=[...this.#model3dCompletedJobs.values()].filter(value=>!value.retired).map(value=>value.job);
    if(!jobs.length&&!capacity)return nothing;
    return html`<div class="document-artifact-jobs native-model3d-completions">${jobs.map(job=>html`<span><b>${this.i18n.system("Completed 3D model")}</b><small>${this.i18n.date(new Date(job.completedAt??job.updatedAt),{dateStyle:"medium",timeStyle:"short"})}</small><button type="button" class="button secondary compact" data-native-model3d-job=${job.jobId} aria-busy=${String(this.#model3dResultRead?.jobId===job.jobId)} @click=${(event:MouseEvent)=>void this.#openOriginalModel3d(job,event,source)}>${this.i18n.system("Open original 3D model")}</button>${this.#model3dResultError===job.jobId?html`<small role="status">${this.i18n.system("The exact completed 3D model could not be verified. Try opening this same request again.")}</small>`:nothing}</span>`)}${capacity?html`<p role="status">${this.i18n.system("More completed 3D models are available. Open them from this Document’s results.")}</p>`:nothing}</div>`;
  }
  #nativeStoryEligible(documentId:string){
    const session=this.store.session.get(),projection=this.store.projection.get();
    return Boolean(this.isConnected&&this.source==="document"&&this.closest("forma-workspace")
      &&session&&!session.projectContext&&!session.impersonation&&this.store.captureAuthorizationScope()
      &&projection.documentId===documentId&&this.#targetDocumentId()===documentId
      &&projection.documents.some(value=>value.id===documentId&&value.projectId===projection.projectId&&!value.removed)
      &&nextActionFacts(this.store,documentId,null).canConfigure);
  }
  #nativeStoryDialog(opening=this.#nativeStoryOpening){
    const dialog=this.#createDialog();
    return opening&&dialog?.dataset.nativeStoryOpening===String(opening.id)?dialog:null;
  }
  #nativeStoryLive(opening:NativeStoryOpening){
    return Boolean(this.#nativeStoryOpening===opening&&this.#createOpen
      &&this.#nativeStoryController?.state.openingId===opening.id&&this.#nativeStoryController.state.status!=="retired"
      &&this.ownerDocument.visibilityState!=="hidden"&&!this.closest("[hidden],[inert]")&&this.#nativeStoryCurrent?.());
  }
  /** Parent calls before the result pane becomes hidden, including responsive changes. */
  retireNativeShortStory(){this.#retireNativeStoryOpening();}
  #retireNativeStoryOpening(lease:NativeStoryCloseLease|null=null){
    const opening=this.#nativeStoryOpening,dialog=this.#nativeStoryDialog(),current=this.#nativeStoryCurrent;
    ++this.#nativeStoryEpoch;this.#nativeStoryCloseLease=lease;
    this.#nativeStoryOpening=null;this.#nativeStoryCurrent=null;this.#nativeStoryOpener=undefined;
    this.#nativeStoryAudience="";this.#nativeStoryTone="";this.#nativeStoryLocale="";this.#nativeStoryDocumentTitle="";this.#nativeStoryComposing=false;
    if(opening){this.#createOpen=false;if(this.#configurationCurrent===current)this.#configurationCurrent=null;}
    try{if(opening)this.#nativeStoryController?.retire(opening);}
    finally{dialog?.close();if(opening)this.requestUpdate();}
  }
  async openNativeShortStory(documentId:string,options:{current?:(stage:CreativePreparationStage)=>boolean}={}){
    const previousIntent=this.#nativeStoryIntentRevision;
    if(!this.#nativeStoryEligible(documentId)||this.#activeId||this.#submitting||this.#sceneSubmitting
      ||this.#workflowBusy||this.#activeWorkflowStageId||this.#pendingWorkflowRegeneration
      ||this.#failedInputJob||this.#runningInputJob||this.#sceneInputCurrent||this.#referenceBusy
      ||this.#createOpen&&!this.#nativeStoryOpening||options.current&&!options.current("opening")
      ||[...this.ownerDocument.querySelectorAll("dialog[open]")].some(dialog=>dialog!==this.#nativeStoryDialog())
      ||previousIntent!==this.#nativeStoryIntentRevision)return false;
    ++this.#nativeStoryIntentRevision;
    const epoch=this.#nativeStoryEpoch+1;
    this.retireNativeShortStory();if(this.#nativeStoryEpoch!==epoch)return false;
    const sourceCurrent=this.#privateSourceCurrent(),authorization=this.store.captureAuthorizationScope(),route=this.store.route.get();
    const opener=this.ownerDocument.activeElement instanceof HTMLElement?this.ownerDocument.activeElement:undefined;
    const focus=captureOutputNavigationFocus(this.ownerDocument,{ownedRouteFocus:element=>{
      const dialog=this.#nativeStoryDialog();
      return epoch===this.#nativeStoryEpoch&&Boolean(dialog?.open&&(element===dialog||element===dialog.querySelector("[data-native-story-close]")));
    }});
    try{
    const current=retainCreativePreparation(()=>nextActionFacts(this.store,documentId,null),stage=>
      epoch===this.#nativeStoryEpoch&&sourceCurrent()&&this.store.authorizationScopeActive(authorization)
      &&this.store.route.get()===route&&this.#nativeStoryEligible(documentId)
      &&this.ownerDocument.visibilityState!=="hidden"&&(!options.current||options.current(stage))
      &&(stage==="opening"?focus.current()&&![...this.ownerDocument.querySelectorAll("dialog[open]")].some(dialog=>dialog!==this.#nativeStoryDialog())
        :Boolean(this.#nativeStoryDialog()?.open&&this.#nativeStoryDialog()?.matches(":modal"))));
    if(!current())return false;
    await this.updateComplete;if(!current())return false;
    await this.#revealWorkbenchPane();if(!current())return false;
    this.#retireRequestReview();
    this.#nativeStoryCurrent=current;this.#configurationCurrent=current;this.#createOpen=true;
    this.#nativeStoryAudience="";this.#nativeStoryTone="";this.#nativeStoryLocale=this.i18n.locale;
    this.#nativeStoryDocumentTitle=this.store.projection.get().documentTitle;this.#nativeStoryOpener=opener;
    const store=this.store;
    const controller=this.#nativeStoryController??=new NativeShortStoryController({
      submit:(setup,controls)=>store.submitNativeShortStory(setup,controls),
      origin:this.ownerDocument.location.origin,
      request:(path,init)=>{
        const opening=this.#nativeStoryOpening,signal=init.signal;
        return store.guardedFetch(path,init,"Read story",{
          current:()=>this.store===store&&Boolean(opening&&signal&&!signal.aborted&&this.#nativeStoryLive(opening)),
        });
      },
      changed:()=>this.requestUpdate(),
    });
    const opening=controller.open({documentId,current});
    if(controller.state.openingId!==opening.id||controller.state.status==="retired"||!current()){
      if(epoch===this.#nativeStoryEpoch){this.#nativeStoryOpening=opening;this.retireNativeShortStory();}return false;
    }
    this.#nativeStoryOpening=opening;this.requestUpdate();
    await this.updateComplete;
    if(!this.#nativeStoryLive(opening)){if(this.#nativeStoryOpening===opening)this.retireNativeShortStory();return false;}
    const dialog=this.#nativeStoryDialog(opening);
    const initialFocus=dialog?.querySelector<HTMLElement>("[data-native-story-close]");
    if(!dialog||!initialFocus||!focus.run(initialFocus,()=>current()&&ensureModalDialog(dialog)&&dialog.open&&dialog.matches(":modal"))
      ||!current.beginEditing()){if(this.#nativeStoryOpening===opening)this.retireNativeShortStory();return false;}
    return this.#nativeStoryLive(opening);
    }catch{if(epoch===this.#nativeStoryEpoch)this.retireNativeShortStory();return false;}
    finally{focus.dispose();}
  }
  #nativeStoryTemplate(opening:NativeStoryOpening){
    const controller=this.#nativeStoryController!;
    const editable=()=>this.#nativeStoryLive(opening)&&nativeStoryDialogPresentation(controller.state).create;
    const failClosed=()=>{if(this.#nativeStoryOpening===opening)this.retireNativeShortStory();};
    return renderNativeStoryDialog({openingId:opening.id,documentTitle:this.#nativeStoryDocumentTitle,
      locale:this.#nativeStoryLocale,audience:this.#nativeStoryAudience,tone:this.#nativeStoryTone,composing:this.#nativeStoryComposing,
      state:controller.state,i18n:this.i18n,
      close:()=>{if(this.#nativeStoryOpening===opening)this.retireNativeShortStory();},
      change:(field,value)=>{if(!editable())return;if(field==="audience")this.#nativeStoryAudience=value;else this.#nativeStoryTone=value;this.requestUpdate();},
      composition:active=>{if(!editable())return;this.#nativeStoryComposing=active;this.requestUpdate();},
      create:()=>{
        if(!editable()||this.#nativeStoryComposing||documentRenderGuidance({audience:this.#nativeStoryAudience,tone:this.#nativeStoryTone}).issues.length)return;
        void controller.create(opening,{audience:this.#nativeStoryAudience,tone:this.#nativeStoryTone,locale:this.#nativeStoryLocale}).catch(failClosed);
      },
      check:()=>{if(this.#nativeStoryLive(opening))void controller.check(opening).catch(failClosed);},
      open:event=>{void this.#openNativeStoryResult(opening,event).catch(failClosed);},
    });
  }
  #nativeStoryReadOnly(opening:NativeStoryOpening){
    return this.#nativeStoryLive(opening)&&this.#nativeStoryController?.state.status==="available"
      &&!this.#editingId&&!this.#savingEdit&&!this.#reviewNote&&!this.#submitting&&!this.#referenceBusy
      &&!this.#sceneSubmitting&&!this.#workflowBusy&&!this.#convertingId;
  }
  async #openNativeStoryResult(opening:NativeStoryOpening,event:MouseEvent){
    const trigger=event.currentTarget,element=this.#nativeStoryDialog(opening),controller=this.#nativeStoryController;
    const parent=this.closest<FormaElement>("forma-workspace");
    if(!(trigger instanceof HTMLButtonElement)||!element?.contains(trigger)||!parent||!controller||!this.#nativeStoryLive(opening))return;
    const path=controller.openStory(opening),state=controller.state,completion=state.completion,handle=state.handle;
    if(!path||!completion||!handle||!this.#nativeStoryLive(opening))return;
    const sourceCurrent=this.#privateSourceCurrent(),authorization=this.store.captureAuthorizationScope(),route=this.store.route.get();
    let retainedCurrent=()=>true;
    const exact=()=>Date.parse(completion.expiresAt)>Date.now()&&nativeStoryRetainedRoute(completion,handle)===path&&retainedCurrent();
    const origin=()=>sourceCurrent()&&this.store.authorizationScopeActive(authorization)&&this.store.route.get()===route
      &&this.#nativeStoryEligible(opening.documentId)&&this.ownerDocument.visibilityState!=="hidden"&&!this.closest("[hidden],[inert]");
    const live=()=>this.#nativeStoryReadOnly(opening)&&exact();
    const closedEpoch=this.#nativeStoryEpoch+1;
    const lease:NativeStoryCloseLease={dialog:element,current:()=>this.#nativeStoryCloseLease===lease&&this.#nativeStoryEpoch===closedEpoch
      &&!this.#nativeStoryOpening&&origin()&&exact(),closedCurrent:()=>lease.current()&&!element.open&&this.#readonlyReuseView()};
    const opener=this.#nativeStoryOpener?.isConnected?this.#nativeStoryOpener:undefined;
    try{
      return await navigateInApp(this,async navigation=>{
        if(!navigation.current()||!live()||!origin())return false;
        await this.store.refreshEvents({readOnly:true,current:()=>navigation.current()&&live()&&origin()});
        if(!navigation.current()||!live()||!origin())return false;
        const selected=completion.selection,artifact=this.store.projection.get().libraryArtifacts.find(value=>value.id===selected.artifactId);
        if(!artifact||artifact.kind!=="short_story"||artifact.documentId!==selected.documentId
          ||documentArtifactRevision(this.store.events.get(),artifact.id)!==selected.revision)return false;
        retainedCurrent=()=>this.store.projection.get().libraryArtifacts.some(value=>value.id===artifact.id&&value.kind==="short_story"
          &&value.documentId===selected.documentId&&value.sourceEventId===artifact.sourceEventId
          &&value.contentRef===artifact.contentRef&&value.sequence===artifact.sequence)
          &&documentArtifactRevision(this.store.events.get(),artifact.id)===selected.revision;
        if(!exact())return false;
        if(!await navigation.closeNativePresentation(()=>{
          if(live()&&origin())this.#retireNativeStoryOpening(lease);
        },{parent,closedCurrent:lease.closedCurrent}))return false;
        // The native close is asynchronous. Recheck expiry and exact selection at route activation.
        if(!navigation.current()||!lease.closedCurrent()||!exact())return false;
        return navigation.route(path,{documentFocus:false});
      },{presentation:{owner:this,element,trigger,opener,current:()=>live()||lease.current()}});
    }finally{if(this.#nativeStoryCloseLease===lease)this.#nativeStoryCloseLease=null;}
  }

  #privateSourceRevision=0;
  #privateSourceCurrent(){
    const source=this.store.captureSourceOwnership(),revision=this.#privateSourceRevision;
    return()=>this.isConnected&&revision===this.#privateSourceRevision&&this.store.sourceOwnershipActive(source);
  }
  #retirePrivateGenerationInputs=(event:Event)=>{
    const source=(event as CustomEvent<{source?:CapturedSourceOwnership}>).detail?.source;
    if(source&&this.store.sourceOwnershipScopeActive(source))this.#clearPrivateGenerationInputs();
  };
  #clearPrivateGenerationInputs=()=>{
    this.#retireAudioTrim();this.#audioTrimNotice=null;
    this.#retireVideoTrim();this.#videoTrimNotice=null;
    this.#retireModel3dScale();this.#model3dScaleNotice=null;
    this.retireNativeShortStory();
    this.#slidesResultRead?.abort.abort();this.#slidesResultRead=null;this.#slidesResultError=null;this.#slidesCompletedJobs.clear();this.#slidesOverflow=null;
    this.#storyboardResultRead?.abort.abort();this.#storyboardResultRead=null;this.#storyboardResultError=null;this.#storyboardCompletedJobs.clear();this.#storyboardOverflow=null;
    this.#audioResultRead?.abort.abort();this.#audioResultRead=null;this.#audioResultError=null;this.#audioCompletedJobs.clear();this.#audioOverflow=null;
    this.#videoResultRead?.abort.abort();this.#videoResultRead=null;this.#videoResultError=null;this.#videoCompletedJobs.clear();this.#videoOverflow=null;
    this.#model3dResultRead?.abort.abort();this.#model3dResultRead=null;this.#model3dResultError=null;this.#model3dCompletedJobs.clear();this.#model3dOverflow=null;
    this.#privateSourceRevision++;this.#presentationReceiptCheck=null;this.#model3dSubmitBasis=new WeakMap();
    this.#closeViewerPopovers();this.#sceneInputCurrent=null;this.#clearSceneCost();
    this.#actorInputContent={};this.#failedInputJob=null;this.#runningInputJob=null;
    this.#viewerCloseGuard=null;this.#viewerCurrent=null;this.#viewerOpening=false;this.#viewerReturnFocus=undefined;
    this.#activeId="";this.#inputId="";this.#deliveryBinding=null;this.#deliveryBindingLoading=null;
    this.#editingId="";this.#editMarkdown="";this.#editItems=[];this.#editRevision=0;
    this.#historyOpen=false;this.#historyBusy=false;this.#revisionHistory=[];this.#revisionBefore=null;this.#revisionPreview=null;
    this.#reviewers=[];this.#selectedReviewerId="";this.#reviewNote="";
    this.#pendingWorkflowRegeneration=null;this.#viewerFocused=false;this.#reviewPanelOpen=false;this.#viewerActionsOpen=false;
    this.#clearCreationDraft();this.#viewDialog()?.close();this.requestUpdate();
  };
  override connectedCallback(){super.connectedCallback();this.ownerDocument.addEventListener("visibilitychange",this.#nativeStoryPageHidden);window.addEventListener("pagehide",this.#nativeStoryPageHide);window.addEventListener("forma-authorization-changed",this.#clearPrivateGenerationInputs);window.addEventListener("forma-event-source-retired",this.#retirePrivateGenerationInputs);}
  override disconnectedCallback(){
    this.ownerDocument.removeEventListener("visibilitychange",this.#nativeStoryPageHidden);window.removeEventListener("pagehide",this.#nativeStoryPageHide);
    this.#outputReuse.cancel?.();
    window.removeEventListener("forma-authorization-changed",this.#clearPrivateGenerationInputs);
    window.removeEventListener("forma-event-source-retired",this.#retirePrivateGenerationInputs);
    this.#clearPrivateGenerationInputs();super.disconnectedCallback();
  }
  #projection(){const current=this.store.projection.get();return this.documentId&&this.documentId!==current.documentId?foldEvents(this.store.events.get(),Number.POSITIVE_INFINITY,this.documentId,current.projectId):current;}
  #artifactSourceBlocks(artifact:Pick<DocumentArtifact,"documentId">){const current=this.store.projection.get();return current.libraryBlocks.filter((block)=>block.scope==="document"&&block.documentId===artifact.documentId&&block.projectId===current.projectId);}
  #eligibleAudioVideos(){
    const events=this.store.events.get();
    return this.#projection().artifacts.filter((artifact)=>{
      if(artifact.kind!=="video"||artifact.documentId!==this.#targetDocumentId()||artifact.mediaType!=="video/mp4"||!artifact.mediaUrl?.startsWith("/api/media/"))return false;
      if(Array.isArray(artifact.settings.soundtrack_assets)&&artifact.settings.soundtrack_assets.length)return false;
      const assembly=artifact.settings.assembly&&typeof artifact.settings.assembly==="object"?artifact.settings.assembly as Record<string,unknown>:null;
      if(artifact.items.length>1&&assembly?.composed!==true)return false;
      const duration=documentArtifactPlaybackSeconds(artifact);
      return Boolean(duration&&duration<=180&&artifactReviewState(artifact,this.#artifactSourceBlocks(artifact),events).status==="approved");
    });
  }
  #audioRequestProfile():AudioRequestProfile{
    const video=this.#eligibleAudioVideos().find((artifact)=>artifact.id===this.#audioVideoArtifactId);
    const videoGoal=this.#audioGoal==="video_music"||this.#audioGoal==="video_sound_effects";
    const duration=this.#audioGoal==="timed_music"||this.#audioGoal==="sound_effects"?this.#audioDuration
      :videoGoal&&video?Math.ceil(documentArtifactPlaybackSeconds(video)??0):undefined;
    return normalizeAudioRequestProfile({
      goal:this.#audioGoal,destination:videoGoal?"video":this.#audioDestination,
      ...(duration?{durationSeconds:duration}:{}),
      ...(this.#audioGoal==="narration"?{speakerCount:this.#audioSpeakerCount}:{}),
      ...((this.#audioGoal==="music"||this.#audioGoal==="timed_music")&&this.#audioInstrumental?{requireInstrumental:true}:{}),
      ...(videoGoal&&this.#audioVideoArtifactId?{videoReferenceId:this.#audioVideoArtifactId}:{}),
    },this.#presentationPlanningSnapshot());
  }
  #selectedAudioAdapter(profile:AudioRequestProfile){
    const selected=selectAudioAdapterContract(profile);
    const configured=this.store.session.get()?.provider.audioModel;
    if(profile.goal==="music"&&selected.contract.adapterId==="fal-lyria-music"&&configured){
      try{return selectAudioAdapterContract(profile,{preferredModel:configured});}catch{return selected;}
    }
    return selected;
  }
  #setAudioGoal(goal:AudioGenerationGoal){
    this.#audioGoal=goal;this.#audioImageBlockId="";this.#sendAudioVideoToProvider=false;this.#confirmed=false;
    if(goal!=="video_music"&&goal!=="video_sound_effects")this.#audioVideoArtifactId="";
    if(goal!=="music"&&goal!=="timed_music")this.#audioInstrumental=false;
    if(goal!=="music"&&this.#productionMode==="managed")this.#productionMode="manual";
    if(goal==="sound_effects"){this.#audioDuration=8;this.#audioDurationInput="8";}
    else if(goal==="timed_music"){this.#audioDuration=30;this.#audioDurationInput="30";}
    this.#invalidAudioDuration=false;this.requestUpdate();
  }
  #targetDocumentId(){return this.documentId||this.store.projection.get().documentId;}
  #workflowFormatLabel(format:ProductionFormat){return format==="image"?this.i18n.t("lab.icon.image","Image"):this.i18n.t(`artifact.${format}.label`,documentArtifactDefinition(format).label);}
  #outputTake(take:number){return this.i18n.t("output.take","Take {number}",{number:this.i18n.number(take)});}
  async #renameArtifact(artifact:DocumentArtifact){
    const context=this.store.session.get()?.projectContext;if(context&&!context.permissions.includes("project.author"))return;
    const next=await requestDialogText({title:this.i18n.system("Rename {documentTitle}",{documentTitle:artifact.title}),label:this.i18n.system("Name"),value:artifact.title,confirmLabel:this.i18n.system("Save name"),cancelLabel:this.i18n.t("action.cancel","Cancel")});
    const name=next?.normalize("NFC").trim();if(!name||name===artifact.title)return;
    const appended=await this.store.append({type:"OutputRenamed",payload:{output_id:artifact.id,artifact_id:artifact.id,artifact_kind:artifact.kind,output_kind:"artifact",document_id:artifact.documentId,project_id:this.#projection().projectId,old_title:artifact.title,new_title:name,source_surface:`${this.source}-artifact-viewer`}});
    if(appended.length)this.#viewDialog()?.setAttribute("aria-label",name);
  }

  #sceneDestination(){
    const session=this.store.session.get(),projection=this.#projection(),documentId=this.#targetDocumentId();
    const authorization=this.store.captureAuthorizationScope(),permissions=session?.projectContext?.permissions??session?.capabilities??[];
    if(!session||!authorization||!this.store.authorizationScopeActive(authorization)||!permissions.includes("project.read")
      ||!projection.documents.some(document=>document.id===documentId&&document.projectId===projection.projectId)
      ||session.projectContext&&session.projectContext.projectId!==projection.projectId)return null;
    return JSON.stringify([session.user.userId,projection.projectId,documentId]);
  }
  #sceneHandles(){
    let handles=sceneRequestHandles.get(this.store);
    if(!handles){handles=new Map();sceneRequestHandles.set(this.store,handles);}
    return handles;
  }
  #sceneCanAuthor(){
    const session=this.store.session.get(),permissions=session?.projectContext?.permissions??session?.capabilities??[];
    return Boolean(this.#sceneDestination()&&session?.policy.accepted&&permissions.includes("project.author")&&permissions.includes("project.output.request"));
  }
  #sceneCanCreate(){return this.#sceneCanAuthor()&&this.store.session.get()?.provider.plannerConfigured===true;}
  #clearSceneCost(){
    this.#sceneResultRead?.abort.abort();this.#sceneResultRead=null;
    this.#sceneCostRevision++;this.#sceneCostView=null;this.#sceneSourcesRefreshed=false;this.#sceneCapacityDestination=null;this.#sceneSubmitting=null;
  }
  #sceneDraftChanged(){
    if(this.#kind!=="scene")return;
    this.#clearSceneCost();this.requestUpdate();
  }
  #sceneSettings(requestId:string){
    if(documentRenderGuidance({audience:this.#audience,tone:this.#tone}).issues.length)return null;
    const workflow=this.#activeWorkflowStageId?this.#currentWorkflow():null;
    const stage=workflow?.stages.find(candidate=>candidate.id===this.#activeWorkflowStageId&&candidate.format==="scene");
    if(this.#activeWorkflowStageId&&!stage)return null;
    const states=workflow?productionWorkflowStageStates(workflow,this.#projection(),this.store.events.get(),this.#runningWorkflowStages(workflow)):[];
    const sceneConfiguration=workflow&&stage?productionWorkflowSceneConfiguration(workflow,stage.id):createSceneConfiguration(this.#sceneMedium);
    if(!sceneConfiguration)return null;
    const request:SceneCostRequest={requestId,documentId:this.#targetDocumentId(),sceneMedium:sceneConfiguration.medium,
      productionMode:this.#productionMode,audience:this.#audience.trim(),tone:this.#tone.trim(),locale:this.i18n.locale,
      ...(workflow&&stage?{workflowId:workflow.id,workflowStageId:stage.id,workflowSources:productionWorkflowSourcesForStage(workflow,stage.id,states)}:{})};
    // Scene counts remain automatic. A returned plan count is never copied into this request.
    return{request,sourceSurface:workflow&&stage?`workflow:${workflow.id}:${stage.id}`:this.source};
  }
  #sceneActionCurrent(){
    const destination=this.#sceneDestination(),opening=this.#configurationCurrent,revision=this.#sceneCostRevision;
    return()=>Boolean(destination&&this.isConnected&&this.#createOpen&&this.#kind==="scene"
      &&this.#configurationCurrent===opening&&opening?.()&&this.#sceneCostRevision===revision&&this.#sceneDestination()===destination);
  }
  #sceneInspectionValid(inspection:SceneCostInspection,view:SceneCostView){
    const session=this.store.session.get(),preview=inspection?.preview,job=inspection?.job;
    if(!view.current()||inspection?.requestId!==view.handle.requestId)return false;
    if(preview!==null&&(!isSceneCostPreview(preview)||preview.requestId!==view.handle.requestId
      ||preview.documentId!==view.request.documentId||preview.actorUserId!==session?.user.userId||preview.projectId!==this.#projection().projectId))return false;
    if(job)return job.jobId===view.handle.requestId&&job.documentId===view.request.documentId&&job.kind==="render_document"
      &&["queued","running","committing","completed","failed","partial","canceled"].includes(job.status);
    return Boolean(preview&&preview.requestHash===view.requestHash&&preview.permissionEpoch===(session?.permissionEpoch??"legacy")
      &&Boolean(preview.contextSessionId)===Boolean(session?.projectContext)&&preview.period===new Date().toISOString().slice(0,7)
      &&(!session?.provider.plannerModel||preview.model===session.provider.plannerModel)
      &&preview.sceneMedium===(view.request.sceneMedium??"visual")&&preview.productionMode===(view.request.productionMode??"manual"));
  }
  #sceneFreshPreview(){
    const view=this.#sceneCostView;
    return view&&!view.busy&&view.current()&&view.inspection&&!view.inspection.job&&this.#sceneInspectionValid(view.inspection,view)?view.inspection.preview:null;
  }
  async #prepareSceneCost(required:()=>boolean){
    if(!required()||this.#submitting||this.#sceneSubmitting?.formCurrent()||this.#workflowBusy)return;
    const destination=this.#sceneDestination();if(!destination)return;
    const handles=this.#sceneHandles();
    let handle=handles.get(destination);
    if(!handle){if(handles.size>=MAX_SCENE_REQUEST_HANDLES){this.#clearSceneCost();this.#sceneCapacityDestination=destination;this.requestUpdate();return;}handle={requestId:crypto.randomUUID(),everDispatched:false};handles.set(destination,handle);}
    const settings=this.#sceneSettings(handle.requestId);if(!settings)return;
    const request=structuredClone(settings.request),requestIdentity=JSON.stringify(sceneCostRequestDescription(request));
    const opening=this.#configurationCurrent,authorization=this.store.captureAuthorizationScope(),route=this.store.route.get();
    const sourceCurrent=this.store.captureSceneCostSource(request),revision=++this.#sceneCostRevision;
    const view:SceneCostView={handle,request,sourceSurface:settings.sourceSurface,requestHash:"",busy:true,inspection:null,checked:false,error:"",
      formCurrent:()=>Boolean(this.isConnected&&this.#createOpen&&this.#kind==="scene"&&this.#configurationCurrent===opening&&opening?.()
        &&this.#sceneCostView===view&&this.#sceneCostRevision===revision&&this.#sceneDestination()===destination&&handles.get(destination)===handle
        &&this.store.authorizationScopeActive(authorization)&&this.store.route.get()===route
        &&JSON.stringify(sceneCostRequestDescription(this.#sceneSettings(view.handle.requestId)?.request??{requestId:"",documentId:""}))===requestIdentity),
      current:()=>view.formCurrent()&&sourceCurrent()};
    this.#sceneCostView=view;this.#sceneSourcesRefreshed=false;this.requestUpdate();
    try{
      view.requestHash=await sceneCostRequestHash(request);if(!view.current())return;
      const inspection=await this.store.previewSceneCost(request,{sourceSurface:view.sourceSurface,current:view.current});
      if(!view.current())return;
      if(!this.#sceneInspectionValid(inspection,view))throw new Error("scene_cost_unavailable");
      if(inspection.job)view.handle.everDispatched=true;
      view.inspection=inspection;view.checked=true;
    }catch(error){
      if(view.current()){view.inspection=null;view.error=error instanceof Error&&error.message==="project_source_index_stale"?"source-index":"unavailable";}
    }finally{
      if(this.#sceneCostView===view){view.busy=false;if(!view.current())this.#clearSceneCost();this.requestUpdate();}
    }
  }
  async #refreshSceneSources(view:SceneCostView){
    if(this.#sceneCostView!==view||view.busy||view.error!=="source-index"||!view.formCurrent())return;
    view.busy=true;this.requestUpdate();
    try{
      await this.store.refreshEvents();
      if(!view.formCurrent())return;
      this.#clearSceneCost();this.#sceneSourcesRefreshed=true;
    }catch{
      if(view.formCurrent())view.error="source-index";
    }finally{
      if(this.#sceneCostView===view)view.busy=false;
      this.requestUpdate();
    }
  }
  #sceneSafeUnused(view:SceneCostView,inspection=view.inspection){
    if(!inspection||!this.#sceneInspectionValid(inspection,view))return false;
    const proof=inspection.safeUnused,job=inspection.job,preview=inspection.preview,session=this.store.session.get();
    return Boolean(isSceneSafeUnusedProof(proof)&&job&&preview
      &&proof.requestId===view.handle.requestId&&proof.actorUserId===session?.user.userId
      &&proof.projectId===this.#projection().projectId&&proof.documentId===view.request.documentId
      &&proof.permissionEpoch===(session?.permissionEpoch??"legacy")&&Boolean(proof.contextSessionId)===Boolean(session?.projectContext)
      &&proof.bindingHash===preview.bindingHash&&proof.jobStatus===job.status&&proof.jobUpdatedAt===job.updatedAt
      &&proof.attemptCount===job.attemptCount&&job.leaseExpiresAt===null&&typeof job.completedAt==="string"
      &&Number.isFinite(Date.parse(job.completedAt))&&Date.parse(job.completedAt)<=Date.parse(proof.verifiedAt));
  }
  async #newSceneRequest(view:SceneCostView,offeredUnused=false){
    if(this.#sceneCostView!==view||view.busy||!view.current()||!view.checked
      ||view.inspection?.job?.status!=="completed"&&!offeredUnused||!this.#sceneCanAuthor())return;
    // An offered certificate may expire while its button waits. It only permits this
    // free recheck; replacing the handle always requires the newly returned proof.
    view.busy=true;this.requestUpdate();
    try{
      const inspection=await this.store.previewSceneCost(view.request,{sourceSurface:view.sourceSurface,current:view.current});
      if(!view.current())return;
      if(!this.#sceneInspectionValid(inspection,view))throw new Error("scene_cost_unavailable");
      view.inspection=inspection;view.checked=true;
      if(inspection.job?.status!=="completed"&&!this.#sceneSafeUnused(view,inspection)){view.error="recovery";return;}
      const destination=this.#sceneDestination();if(!destination||this.#sceneHandles().get(destination)!==view.handle)return;
      this.#sceneHandles().set(destination,{requestId:crypto.randomUUID(),everDispatched:false});
      this.#clearSceneCost();
      await this.#prepareSceneCost(this.#sceneActionCurrent());
    }catch{
      if(view.current()){view.inspection=null;view.checked=false;view.error="unavailable";}
    }finally{
      if(this.#sceneCostView===view)view.busy=false;
      this.requestUpdate();
    }
  }
  async #inspectSceneRequest(view:SceneCostView){
    const job=view.inspection?.job;
    if(!job||this.#sceneCostView!==view||view.busy||!view.current()||!view.checked)return;
    await this.#inspectOwnedSceneInputs(job);
  }
  #sceneFailureInspectionAction(job:DocumentJob){
    const jobId=job.jobId,documentId=job.documentId,sourceCurrent=this.#privateSourceCurrent(),authorization=this.store.captureAuthorizationScope(),route=this.store.route.get(),locale=this.i18n.locale;
    const opening=this.#configurationCurrent,revision=this.#sceneCostRevision,viewer=this.#viewerCurrent,input=this.#sceneInputCurrent;
    const exact=()=>this.store.documentJobs.get().find(candidate=>candidate.jobId===jobId&&candidate.documentId===documentId
      &&candidate.kind==="render_document"&&candidate.result?.artifactKind==="scene"&&documentJobFailureVisible(candidate));
    const current=()=>Boolean(sourceCurrent()&&this.isConnected&&this.#targetDocumentId()===documentId&&this.#sceneDestination()
      &&this.store.authorizationScopeActive(authorization)&&this.store.route.get()===route&&this.i18n.locale===locale
      &&!this.#createOpen&&this.#configurationCurrent===opening&&this.#sceneCostRevision===revision
      &&!this.#viewerOpening&&this.#viewerCurrent===viewer&&!this.#activeId&&!this.#inputId
      &&!this.#failedInputJob&&!this.#runningInputJob&&this.#sceneInputCurrent===input&&exact());
    // The rendered action owns one exact public request. A refreshed row for that
    // same request is allowed; a later opening or a different request is not.
    // A bounded page can omit an authorized request. A present contradictory
    // row still invalidates this opening; absence alone does not.
    const knownJobCurrent=()=>{const known=this.store.documentJobs.get().find(candidate=>candidate.jobId===jobId);
      return !known||known.documentId===documentId&&known.kind==="render_document"&&known.result?.artifactKind==="scene"&&documentJobFailureVisible(known);};
    return()=>{if(!current())return;const selected=exact();if(selected)return this.#inspectOwnedSceneInputs(selected,knownJobCurrent);};
  }
  async #inspectOwnedSceneInputs(job:DocumentJob,knownJobCurrent?:()=>boolean){
    const sourceCurrent=this.#privateSourceCurrent(),authorization=this.store.captureAuthorizationScope(),route=this.store.route.get(),documentId=job.documentId,locale=this.i18n.locale;
    if(!authorization||!this.#sceneDestination()||this.#targetDocumentId()!==documentId)return;
    const closingComposer=this.#createOpen;
    this.#createOpen=false;this.#configurationCurrent=null;this.#activeWorkflowStageId="";this.#clearSceneCost();
    const revision=this.#sceneCostRevision,viewer=this.#viewerCurrent,activeId=this.#activeId,inputId=this.#inputId;
    // The deliberate close owns this handoff, not a later composer or viewer opening.
    const current=()=>Boolean(sourceCurrent()&&this.#sceneInputCurrent===current&&this.isConnected&&!this.#createOpen&&this.#configurationCurrent===null
      &&this.#sceneCostRevision===revision&&this.#targetDocumentId()===documentId&&this.store.route.get()===route
      &&this.store.authorizationScopeActive(authorization)&&this.i18n.locale===locale&&(!knownJobCurrent||knownJobCurrent())&&this.#viewerCurrent===viewer&&this.#activeId===activeId&&this.#inputId===inputId);
    this.#sceneInputCurrent=current;
    this.#createDialog()?.close();if(closingComposer)void this.#restoreWorkflowRegeneration();this.requestUpdate();await this.updateComplete;
    if(!current())return;
    if(["failed","partial","canceled"].includes(job.status))await this.#inspectFailedInputs(job,current);else await this.#inspectRunningInputs(job,current);
  }
  async #submitScene(view:SceneCostView|null){
    const preview=this.#sceneFreshPreview();
    if(!view||this.#sceneCostView!==view||!preview||view.inspection?.preview!==preview||!this.#sceneCanCreate()
      ||this.#submitting||this.#sceneSubmitting?.formCurrent()||this.#workflowBusy||this.#referenceBusy||generationBudgetGate(this.store.session.get()?.costBudgets,{projectedMicrousd:preview.maximumMicrousd}).level==="blocked")return;
    this.#sceneSubmitting=view;this.requestUpdate();
    const pending=this.#pendingWorkflowRegeneration;
    const regeneration=pending&&pending.documentId===view.request.documentId&&pending.workflowId===view.request.workflowId&&pending.stageId===view.request.workflowStageId?pending:null;
    const submission=regeneration?{requestId:view.handle.requestId,pending:true,dispatched:false}:null;
    if(regeneration&&submission)regeneration.sceneSubmission=submission;
    const outcome:{result:SceneSubmissionResult|null}={result:null};
    try{
      const{requestId,...settings}=view.request;
      const ok=await this.store.renderDocumentArtifact("scene",{...settings,sceneRequestId:requestId,sceneCostConsent:{...preview,confirmed:true},
        sourceSurface:view.sourceSurface,current:()=>view.current()&&this.#sceneCostView===view,
        onDispatch:()=>{
          view.handle.everDispatched=true;
          if(regeneration&&submission&&regeneration.sceneSubmission===submission){submission.dispatched=true;if(this.#pendingWorkflowRegeneration===regeneration)this.#pendingWorkflowRegeneration=null;}
        },
        onResult:returned=>{
          if(returned.requestId!==requestId)return;
          if(!view.current())return;
          const inspection={requestId,preview:returned.preview,job:returned.job};
          if(returned.attemptSubmission==="submitted"&&returned.job&&this.#sceneInspectionValid(inspection,view)){outcome.result=returned;view.inspection=inspection;view.checked=false;view.error="";}
          else{view.inspection=null;view.checked=false;view.error="unavailable";}
        }});
      if(!view.current())return;
      if(ok&&outcome.result&&!outcome.result.reused&&outcome.result.job){
        if(regeneration&&this.#pendingWorkflowRegeneration===regeneration)this.#pendingWorkflowRegeneration=null;
        if(view.request.audience)this.#rememberedAudiences.add(view.request.audience);
        if(view.request.tone)this.#rememberedTones.add(view.request.tone);
        this.#activeWorkflowStageId="";this.#createOpen=false;this.#clearSceneCost();this.#createDialog()?.close();
        this.dispatchEvent(new CustomEvent("document-artifact-queued",{detail:{documentId:view.request.documentId,kind:"scene"},bubbles:true,composed:true}));
      }else if(!ok&&this.#sceneCostView===view){view.inspection=null;view.checked=false;view.error="unavailable";}
    }catch{
      if(view.current()){view.inspection=null;view.checked=false;view.error="unavailable";}
    }finally{
      if(this.#sceneSubmitting===view)this.#sceneSubmitting=null;
      if(regeneration&&submission&&regeneration.sceneSubmission===submission){
        submission.pending=false;
        if(submission.dispatched){if(this.#pendingWorkflowRegeneration===regeneration)this.#pendingWorkflowRegeneration=null;}
        else if(!this.#createOpen&&this.#pendingWorkflowRegeneration===regeneration)void this.#restoreWorkflowRegeneration();
      }
      this.requestUpdate();
    }
  }
  #sceneOriginalResultReady(view:SceneCostView){
    const job=view.inspection?.job,preview=view.inspection?.preview;
    return Boolean(view.current()&&view.checked&&!view.busy&&job?.status==="completed"
      &&this.#sceneInspectionValid(view.inspection!,view)&&isSceneCostPreview(preview)
      &&preview.requestHash===view.requestHash&&preview.itemCount===1&&preview.productionMode==="manual"
      &&job.sourceSurface==="document"&&job.productionMode==="manual"&&job.result?.artifactKind==="scene"
      &&view.sourceSurface==="document"&&view.request.productionMode==="manual"
      &&!view.request.workflowId&&!view.request.workflowStageId&&!view.request.workflowSources?.length
      &&this.#audience===(view.request.audience??"")&&this.#tone===(view.request.tone??"")
      &&!this.#activeWorkflowStageId&&!this.#pendingWorkflowRegeneration&&!this.#requestReviewLoading
      &&!this.#editingId&&!this.#savingEdit&&!this.#reviewNote&&!this.#submitting&&!this.#referenceBusy
      &&!this.#sceneSubmitting&&!this.#workflowBusy&&!this.#convertingId
      &&[...this.#requestDrafts].every(([kind,draft])=>kind==="scene"||kind==="short_story"
        &&draft.audience===""&&draft.tone===""&&draft.productionMode==="manual"&&draft.itemCount===6
        &&draft.managedSlideInput===""&&!draft.invalidSlideCount));
  }
  async #openOriginalScene(view:SceneCostView,event:MouseEvent){
    const trigger=event.currentTarget,element=this.#createDialog(),parent=this.closest<FormaElement>("forma-workspace");
    if(!(trigger instanceof HTMLButtonElement)||!element?.contains(trigger)||!element.open||!parent
      ||this.#sceneResultRead||!this.#sceneOriginalResultReady(view))return false;
    const job=view.inspection!.job!,handle=captureNativeSceneHandle({documentId:job.documentId,jobId:job.jobId});
    if(!handle)return false;
    const store=this.store,source=this.#privateSourceCurrent(),authorization=store.captureAuthorizationScope(),route=store.route.get();
    const epoch=this.#sceneCostRevision,read={view,abort:new AbortController()};
    const focus=captureOutputNavigationFocus(this.ownerDocument);let focusTransferred=false;
    const opener=this.#createOpener?.isConnected?this.#createOpener:undefined;
    const origin=()=>this.store===store&&source()&&store.authorizationScopeActive(authorization)&&store.route.get()===route
      &&this.#targetDocumentId()===handle.documentId&&this.ownerDocument.visibilityState!=="hidden"&&!this.closest("[hidden],[inert]");
    const originalCurrent=()=>this.#sceneResultRead===read&&!read.abort.signal.aborted&&(focusTransferred||focus.current())&&origin()&&this.#createDialog()===element
      &&element.contains(trigger)&&this.#sceneOriginalResultReady(view);
    const current=()=>element.open&&originalCurrent();let closingStarted=false;
    let ownedLease:NativeStoryCloseLease|null=null;
    this.#sceneResultRead=read;this.requestUpdate();
    try{
      const completion=await readNativeSceneCompletion(handle,{origin:location.origin,signal:read.abort.signal,current,
        request:(path,init)=>fetch(path,init)});
      if(!current())return false;
      const path=nativeSceneRetainedRoute(completion,handle);if(!path)return false;
      await store.refreshEvents({readOnly:true,current});if(!current())return false;
      const selected=completion.selection,artifact=store.projection.get().libraryArtifacts.find(value=>value.id===selected.artifactId);
      if(!artifact||artifact.kind!=="scene"||artifact.documentId!==selected.documentId
        ||documentArtifactRevision(store.events.get(),artifact.id)!==selected.revision)return false;
      const exact=()=>Date.parse(completion.expiresAt)>Date.now()&&nativeSceneRetainedRoute(completion,handle)===path
        &&store.projection.get().libraryArtifacts.some(value=>value.id===artifact.id&&value.kind==="scene"
          &&value.documentId===selected.documentId&&value.sourceEventId===artifact.sourceEventId
          &&value.contentRef===artifact.contentRef&&value.sequence===artifact.sequence)
        &&documentArtifactRevision(store.events.get(),artifact.id)===selected.revision;
      const live=()=>current()&&exact();
      const closed=()=>origin()&&exact()&&this.#sceneCostRevision===epoch+1&&!this.#sceneCostView&&!this.#createOpen
        &&this.#configurationCurrent===null&&!this.#activeWorkflowStageId&&!this.#pendingWorkflowRegeneration
        &&this.#kind==="scene"&&this.#audience===(view.request.audience??"")&&this.#tone===(view.request.tone??"")
        &&this.#readonlyReuseView();
      const closing=()=>closingStarted&&!element.open&&originalCurrent()&&exact();
      const lease:NativeStoryCloseLease={dialog:element,current:()=>this.#sceneResultCloseLease===lease&&(live()||closing()||closed()),
        closedCurrent:()=>this.#sceneResultCloseLease===lease&&!element.open&&(closing()||closed())};
      this.#sceneResultCloseLease=lease;ownedLease=lease;
      return await navigateInApp(this,async navigation=>{
        if(!live())return false;
        focusTransferred=true;focus.dispose();
        if(!await navigation.closeNativePresentation(()=>{
          if(live()){closingStarted=true;element.close();}
        },{parent,closedCurrent:lease.closedCurrent}))return false;
        if(!navigation.current()||!lease.closedCurrent()||!closed()||!exact())return false;
        return navigation.route(path,{documentFocus:false});
      },{presentation:{owner:this,element,trigger,opener,current:lease.current}});
    }catch{
      if(current()){view.error="unavailable";this.requestUpdate();}
      return false;
    }finally{
      focus.dispose();read.abort.abort();if(this.#sceneResultRead===read)this.#sceneResultRead=null;
      if(ownedLease&&this.#sceneResultCloseLease===ownedLease)this.#sceneResultCloseLease=null;
      this.requestUpdate();
    }
  }
  #nativeAudioJob(job:DocumentJob){
    return this.#nativeStoryEligible(job.documentId)&&job.kind==="render_document"&&job.status==="completed"
      &&job.sourceSurface==="document"&&job.productionMode==="manual"&&job.result?.artifactKind==="audio";
  }
  #nativeAudioJobIdentity(job:DocumentJob){
    return JSON.stringify([job.jobId,job.documentId,job.kind,job.status,job.sourceSurface,job.productionMode,
      job.documentRevision,job.requestKey,job.requestedAt,job.completedAt,job.attemptCount,job.result?.artifactKind,job.result?.artifactId]);
  }
  async #openOriginalAudio(job:DocumentJob,event:MouseEvent,renderedCurrent:()=>boolean){
    const trigger=event.currentTarget;
    if(!(trigger instanceof HTMLButtonElement)||!this.contains(trigger)||this.#audioResultRead
      ||!renderedCurrent()||!this.#nativeAudioJob(job)||!this.#readonlyReuseView()||this.#activeId||this.#convertingId)return false;
    const handle=captureNativeAudioHandle({documentId:job.documentId,jobId:job.jobId});if(!handle)return false;
    const store=this.store,source=this.#privateSourceCurrent(),authorization=store.captureAuthorizationScope(),route=store.route.get();
    const identity=this.#nativeAudioJobIdentity(job),artifactId=job.result?.artifactId,read={jobId:job.jobId,abort:new AbortController()};
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    const current=()=>this.#audioResultRead===read&&!read.abort.signal.aborted&&renderedCurrent()&&source()
      &&this.store===store&&store.authorizationScopeActive(authorization)&&store.route.get()===route
      &&this.ownerDocument.visibilityState!=="hidden"&&!this.closest("[hidden],[inert]")
      &&trigger.isConnected&&this.contains(trigger)&&trigger.dataset.nativeAudioJob===handle.jobId&&focus.current()
      &&this.#readonlyReuseView()&&!this.#activeId&&!this.#convertingId&&!this.#audioCompletedJobs.get(handle.jobId)?.retired
      &&(()=>{
        const live=store.documentJobs.get().find(value=>value.jobId===handle.jobId);
        if(live)return this.#nativeAudioJob(live)&&this.#nativeAudioJobIdentity(live)===identity;
        const retained=this.#audioCompletedJobs.get(handle.jobId);
        return Boolean(retained?.current()&&this.#nativeAudioJob(retained.job)&&this.#nativeAudioJobIdentity(retained.job)===identity);
      })();
    this.#audioResultRead=read;this.#audioResultError=null;this.requestUpdate();
    try{
      const completion=await readNativeAudioCompletion(handle,{origin:location.origin,signal:read.abort.signal,current,
        request:(path,init)=>fetch(path,init)});
      if(!current())return false;
      const path=nativeAudioRetainedRoute(completion,handle);if(!path)return false;
      await store.refreshEvents({readOnly:true,current});if(!current())return false;
      const selected=completion.selection,artifact=store.projection.get().libraryArtifacts.find(value=>value.id===selected.artifactId);
      if(selected.documentId!==handle.documentId||selected.artifactId!==artifactId
        ||!artifact||artifact.kind!=="audio"||artifact.documentId!==selected.documentId
        ||documentArtifactRevision(store.events.get(),artifact.id)!==selected.revision)return false;
      const original={id:artifact.id,sourceEventId:artifact.sourceEventId,contentRef:artifact.contentRef,sequence:artifact.sequence,
        inputRef:artifact.inputRef??null,mediaUrl:artifact.mediaUrl,mediaType:artifact.mediaType,mediaSha256:artifact.settings.source_media_sha256};
      const exact=()=>Date.parse(completion.expiresAt)>Date.now()&&nativeAudioRetainedRoute(completion,handle)===path
        &&store.projection.get().libraryArtifacts.some(value=>value.id===original.id&&value.kind==="audio"
          &&value.documentId===selected.documentId&&value.sourceEventId===original.sourceEventId
          &&value.contentRef===original.contentRef&&value.sequence===original.sequence
          &&(value.inputRef??null)===original.inputRef&&value.mediaUrl===original.mediaUrl
          &&value.mediaType===original.mediaType&&value.settings.source_media_sha256===original.mediaSha256)
        &&documentArtifactRevision(store.events.get(),original.id)===selected.revision;
      return await navigateInApp(this,navigation=>current()&&exact()&&navigation.current()
        ?navigation.route(path,{documentFocus:false}):false);
    }catch{
      if(current())this.#audioResultError=handle.jobId;
      return false;
    }finally{
      focus.dispose();read.abort.abort();if(this.#audioResultRead===read)this.#audioResultRead=null;
      this.requestUpdate();
    }
  }
  #nativeAudioCompletions(){
    const source=this.#privateSourceCurrent(),live=this.store.documentJobs.get();
    for(const [id,retained] of this.#audioCompletedJobs){
      const current=live.find(job=>job.jobId===id);
      if(!retained.current()||!this.#nativeAudioJob(retained.job))this.#audioCompletedJobs.delete(id);
      else if(current&&(!this.#nativeAudioJob(current)||this.#nativeAudioJobIdentity(current)!==this.#nativeAudioJobIdentity(retained.job)))retained.retired=true;
    }
    if(this.#audioOverflow&&(!this.#audioOverflow.current()||!this.#nativeStoryEligible(this.#audioOverflow.documentId)))this.#audioOverflow=null;
    let capacity=Boolean(this.#audioOverflow);
    for(const job of live.filter(value=>this.#nativeAudioJob(value))){
      if(this.#audioCompletedJobs.has(job.jobId))continue;
      if(this.#audioCompletedJobs.size>=120){this.#audioOverflow??={documentId:job.documentId,current:source};capacity=true;continue;}
      // Keep an observed exact completion across the ordinary feed ACK. Its
      // authority is still re-read before Open; it is never a cached receipt.
      const captured=Object.freeze({...job,result:job.result?Object.freeze({...job.result}):job.result});
      this.#audioCompletedJobs.set(job.jobId,{job:captured,current:source});
    }
    const jobs=[...this.#audioCompletedJobs.values()].filter(value=>!value.retired).map(value=>value.job);
    if(!jobs.length&&!capacity)return nothing;
    return html`<div class="document-artifact-jobs native-audio-completions">${jobs.map(job=>html`<span><b>${this.i18n.system("Completed audio")}</b><small>${this.i18n.date(new Date(job.completedAt??job.updatedAt),{dateStyle:"medium",timeStyle:"short"})}</small><button type="button" class="button secondary compact" data-native-audio-job=${job.jobId} aria-busy=${String(this.#audioResultRead?.jobId===job.jobId)} @click=${(event:MouseEvent)=>void this.#openOriginalAudio(job,event,source)}>${this.i18n.system("Open original audio")}</button>${this.#audioResultError===job.jobId?html`<small role="status">${this.i18n.system("The exact completed audio could not be verified. Try opening this same request again.")}</small>`:nothing}</span>`)}${capacity?html`<p role="status">${this.i18n.system("More completed audio results are available. Open them from this Document’s results.")}</p>`:nothing}</div>`;
  }
  #nativeVideoJob(job:DocumentJob){
    return this.#nativeStoryEligible(job.documentId)&&job.kind==="render_document"&&job.status==="completed"
      &&job.sourceSurface==="document"&&job.productionMode==="manual"&&job.result?.artifactKind==="video";
  }
  #nativeVideoJobIdentity(job:DocumentJob){
    return JSON.stringify([job.jobId,job.documentId,job.kind,job.status,job.sourceSurface,job.productionMode,
      job.documentRevision,job.requestKey,job.requestedAt,job.completedAt,job.attemptCount,job.result?.artifactKind,job.result?.artifactId]);
  }
  async #openOriginalVideo(job:DocumentJob,event:MouseEvent,renderedCurrent:()=>boolean){
    const trigger=event.currentTarget;
    if(!(trigger instanceof HTMLButtonElement)||!this.contains(trigger)||this.#videoResultRead
      ||!renderedCurrent()||!this.#nativeVideoJob(job)||!this.#readonlyReuseView()||this.#activeId||this.#convertingId)return false;
    const handle=captureNativeVideoHandle({documentId:job.documentId,jobId:job.jobId});if(!handle)return false;
    const store=this.store,source=this.#privateSourceCurrent(),authorization=store.captureAuthorizationScope(),route=store.route.get();
    const identity=this.#nativeVideoJobIdentity(job),artifactId=job.result?.artifactId,read={jobId:job.jobId,abort:new AbortController()};
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    const current=()=>this.#videoResultRead===read&&!read.abort.signal.aborted&&renderedCurrent()&&source()
      &&this.store===store&&store.authorizationScopeActive(authorization)&&store.route.get()===route
      &&this.ownerDocument.visibilityState!=="hidden"&&!this.closest("[hidden],[inert]")
      &&trigger.isConnected&&this.contains(trigger)&&trigger.dataset.nativeVideoJob===handle.jobId&&focus.current()
      &&this.#readonlyReuseView()&&!this.#activeId&&!this.#convertingId&&!this.#videoCompletedJobs.get(handle.jobId)?.retired
      &&(()=>{
        const live=store.documentJobs.get().find(value=>value.jobId===handle.jobId);
        if(live)return this.#nativeVideoJob(live)&&this.#nativeVideoJobIdentity(live)===identity;
        const retained=this.#videoCompletedJobs.get(handle.jobId);
        return Boolean(retained?.current()&&this.#nativeVideoJob(retained.job)&&this.#nativeVideoJobIdentity(retained.job)===identity);
      })();
    this.#videoResultRead=read;this.#videoResultError=null;this.requestUpdate();
    try{
      const completion=await readNativeVideoCompletion(handle,{origin:location.origin,signal:read.abort.signal,current,
        request:(path,init)=>fetch(path,init)});
      if(!current())return false;
      const path=nativeVideoRetainedRoute(completion,handle);if(!path)return false;
      await store.refreshEvents({readOnly:true,current});if(!current())return false;
      const selected=completion.selection,artifact=store.projection.get().libraryArtifacts.find(value=>value.id===selected.artifactId);
      if(selected.documentId!==handle.documentId||selected.artifactId!==artifactId
        ||!artifact||artifact.kind!=="video"||artifact.documentId!==selected.documentId
        ||documentArtifactRevision(store.events.get(),artifact.id)!==selected.revision)return false;
      const original={id:artifact.id,sourceEventId:artifact.sourceEventId,contentRef:artifact.contentRef,sequence:artifact.sequence,
        inputRef:artifact.inputRef??null,mediaUrl:artifact.mediaUrl,mediaType:artifact.mediaType,itemCount:artifact.itemCount,items:JSON.stringify(artifact.items.map(item=>[item.id,item.mediaUrl,item.mediaType]))};
      const exact=()=>Date.parse(completion.expiresAt)>Date.now()&&nativeVideoRetainedRoute(completion,handle)===path
        &&store.projection.get().libraryArtifacts.some(value=>value.id===original.id&&value.kind==="video"
          &&value.documentId===selected.documentId&&value.sourceEventId===original.sourceEventId
          &&value.contentRef===original.contentRef&&value.sequence===original.sequence
          &&(value.inputRef??null)===original.inputRef&&value.mediaUrl===original.mediaUrl
          &&value.mediaType===original.mediaType&&value.itemCount===original.itemCount
          &&JSON.stringify(value.items.map(item=>[item.id,item.mediaUrl,item.mediaType]))===original.items)
        &&documentArtifactRevision(store.events.get(),original.id)===selected.revision;
      return await navigateInApp(this,navigation=>current()&&exact()&&navigation.current()
        ?navigation.route(path,{documentFocus:false}):false);
    }catch{
      if(current())this.#videoResultError=handle.jobId;
      return false;
    }finally{
      focus.dispose();read.abort.abort();if(this.#videoResultRead===read)this.#videoResultRead=null;
      this.requestUpdate();
    }
  }
  #nativeVideoCompletions(){
    const source=this.#privateSourceCurrent(),live=this.store.documentJobs.get();
    for(const [id,retained] of this.#videoCompletedJobs){
      const current=live.find(job=>job.jobId===id);
      if(!retained.current()||!this.#nativeVideoJob(retained.job))this.#videoCompletedJobs.delete(id);
      else if(current&&(!this.#nativeVideoJob(current)||this.#nativeVideoJobIdentity(current)!==this.#nativeVideoJobIdentity(retained.job)))retained.retired=true;
    }
    if(this.#videoOverflow&&(!this.#videoOverflow.current()||!this.#nativeStoryEligible(this.#videoOverflow.documentId)))this.#videoOverflow=null;
    let capacity=Boolean(this.#videoOverflow);
    for(const job of live.filter(value=>this.#nativeVideoJob(value))){
      if(this.#videoCompletedJobs.has(job.jobId))continue;
      if(this.#videoCompletedJobs.size>=120){this.#videoOverflow??={documentId:job.documentId,current:source};capacity=true;continue;}
      // Keep an observed exact completion across the ordinary feed ACK. Its
      // authority is still re-read before Open; it is never a cached receipt.
      const captured=Object.freeze({...job,result:job.result?Object.freeze({...job.result}):job.result});
      this.#videoCompletedJobs.set(job.jobId,{job:captured,current:source});
    }
    const jobs=[...this.#videoCompletedJobs.values()].filter(value=>!value.retired).map(value=>value.job);
    if(!jobs.length&&!capacity)return nothing;
    return html`<div class="document-artifact-jobs native-video-completions">${jobs.map(job=>html`<span><b>${this.i18n.system("Completed video")}</b><small>${this.i18n.date(new Date(job.completedAt??job.updatedAt),{dateStyle:"medium",timeStyle:"short"})}</small><button type="button" class="button secondary compact" data-native-video-job=${job.jobId} aria-busy=${String(this.#videoResultRead?.jobId===job.jobId)} @click=${(event:MouseEvent)=>void this.#openOriginalVideo(job,event,source)}>${this.i18n.system("Open original video")}</button>${this.#videoResultError===job.jobId?html`<small role="status">${this.i18n.system("The exact completed video could not be verified. Try opening this same request again.")}</small>`:nothing}</span>`)}${capacity?html`<p role="status">${this.i18n.system("More completed video results are available. Open them from this Document’s results.")}</p>`:nothing}</div>`;
  }
  #nativeStoryboardJob(job:DocumentJob){
    return this.#nativeStoryEligible(job.documentId)&&job.kind==="render_document"&&job.status==="completed"
      &&job.sourceSurface==="document"&&job.productionMode==="manual"&&job.result?.artifactKind==="storyboard";
  }
  #nativeStoryboardJobIdentity(job:DocumentJob){
    return JSON.stringify([job.jobId,job.documentId,job.kind,job.status,job.sourceSurface,job.productionMode,
      job.documentRevision,job.requestKey,job.requestedAt,job.completedAt,job.attemptCount,job.result?.artifactKind,job.result?.artifactId]);
  }
  async #openOriginalStoryboard(job:DocumentJob,event:MouseEvent,renderedCurrent:()=>boolean){
    const trigger=event.currentTarget;
    if(!(trigger instanceof HTMLButtonElement)||!this.contains(trigger)||this.#storyboardResultRead
      ||!renderedCurrent()||!this.#nativeStoryboardJob(job)||!this.#readonlyReuseView()||this.#activeId||this.#convertingId)return false;
    const handle=captureNativeStoryboardHandle({documentId:job.documentId,jobId:job.jobId});if(!handle)return false;
    const store=this.store,source=this.#privateSourceCurrent(),authorization=store.captureAuthorizationScope(),route=store.route.get();
    const identity=this.#nativeStoryboardJobIdentity(job),artifactId=job.result?.artifactId,read={jobId:job.jobId,abort:new AbortController()};
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    const current=()=>this.#storyboardResultRead===read&&!read.abort.signal.aborted&&renderedCurrent()&&source()
      &&this.store===store&&store.authorizationScopeActive(authorization)&&store.route.get()===route
      &&this.ownerDocument.visibilityState!=="hidden"&&!this.closest("[hidden],[inert]")
      &&trigger.isConnected&&this.contains(trigger)&&trigger.dataset.nativeStoryboardJob===handle.jobId&&focus.current()
      &&this.#readonlyReuseView()&&!this.#activeId&&!this.#convertingId&&!this.#storyboardCompletedJobs.get(handle.jobId)?.retired
      &&(()=>{
        const live=store.documentJobs.get().find(value=>value.jobId===handle.jobId);
        if(live)return this.#nativeStoryboardJob(live)&&this.#nativeStoryboardJobIdentity(live)===identity;
        const retained=this.#storyboardCompletedJobs.get(handle.jobId);
        return Boolean(retained?.current()&&this.#nativeStoryboardJob(retained.job)&&this.#nativeStoryboardJobIdentity(retained.job)===identity);
      })();
    this.#storyboardResultRead=read;this.#storyboardResultError=null;this.requestUpdate();
    try{
      const completion=await readNativeStoryboardCompletion(handle,{origin:location.origin,signal:read.abort.signal,current,
        request:(path,init)=>fetch(path,init)});
      if(!current())return false;
      const path=nativeStoryboardRetainedRoute(completion,handle);if(!path)return false;
      await store.refreshEvents({readOnly:true,current});if(!current())return false;
      const selected=completion.selection,artifact=store.projection.get().libraryArtifacts.find(value=>value.id===selected.artifactId);
      if(selected.documentId!==handle.documentId||selected.artifactId!==artifactId
        ||!artifact||artifact.kind!=="storyboard"||artifact.documentId!==selected.documentId
        ||documentArtifactRevision(store.events.get(),artifact.id)!==selected.revision)return false;
      const original={id:artifact.id,sourceEventId:artifact.sourceEventId,contentRef:artifact.contentRef,sequence:artifact.sequence};
      const exact=()=>Date.parse(completion.expiresAt)>Date.now()&&nativeStoryboardRetainedRoute(completion,handle)===path
        &&store.projection.get().libraryArtifacts.some(value=>value.id===original.id&&value.kind==="storyboard"
          &&value.documentId===selected.documentId&&value.sourceEventId===original.sourceEventId
          &&value.contentRef===original.contentRef&&value.sequence===original.sequence)
        &&documentArtifactRevision(store.events.get(),original.id)===selected.revision;
      return await navigateInApp(this,navigation=>current()&&exact()&&navigation.current()
        ?navigation.route(path,{documentFocus:false}):false);
    }catch{
      if(current())this.#storyboardResultError=handle.jobId;
      return false;
    }finally{
      focus.dispose();read.abort.abort();if(this.#storyboardResultRead===read)this.#storyboardResultRead=null;
      this.requestUpdate();
    }
  }
  #nativeStoryboardCompletions(){
    const source=this.#privateSourceCurrent(),live=this.store.documentJobs.get();
    for(const [id,retained] of this.#storyboardCompletedJobs){
      const current=live.find(job=>job.jobId===id);
      if(!retained.current()||!this.#nativeStoryboardJob(retained.job))this.#storyboardCompletedJobs.delete(id);
      else if(current&&(!this.#nativeStoryboardJob(current)||this.#nativeStoryboardJobIdentity(current)!==this.#nativeStoryboardJobIdentity(retained.job)))retained.retired=true;
    }
    if(this.#storyboardOverflow&&(!this.#storyboardOverflow.current()||!this.#nativeStoryEligible(this.#storyboardOverflow.documentId)))this.#storyboardOverflow=null;
    let capacity=Boolean(this.#storyboardOverflow);
    for(const job of live.filter(value=>this.#nativeStoryboardJob(value))){
      if(this.#storyboardCompletedJobs.has(job.jobId))continue;
      if(this.#storyboardCompletedJobs.size>=120){this.#storyboardOverflow??={documentId:job.documentId,current:source};capacity=true;continue;}
      // Keep an observed exact completion across the ordinary feed ACK. Its
      // authority is still re-read before Open; it is never a cached receipt.
      const captured=Object.freeze({...job,result:job.result?Object.freeze({...job.result}):job.result});
      this.#storyboardCompletedJobs.set(job.jobId,{job:captured,current:source});
    }
    const jobs=[...this.#storyboardCompletedJobs.values()].filter(value=>!value.retired).map(value=>value.job);
    if(!jobs.length&&!capacity)return nothing;
    return html`<div class="document-artifact-jobs native-storyboard-completions">${jobs.map(job=>html`<span><b>${this.i18n.system("Completed Storyboard")}</b><small>${this.i18n.date(new Date(job.completedAt??job.updatedAt),{dateStyle:"medium",timeStyle:"short"})}</small><button type="button" class="button secondary compact" data-native-storyboard-job=${job.jobId} aria-busy=${String(this.#storyboardResultRead?.jobId===job.jobId)} @click=${(event:MouseEvent)=>void this.#openOriginalStoryboard(job,event,source)}>${this.i18n.system("Open original Storyboard")}</button>${this.#storyboardResultError===job.jobId?html`<small role="status">${this.i18n.system("The exact completed storyboard could not be verified. Try opening this same request again.")}</small>`:nothing}</span>`)}${capacity?html`<p role="status">${this.i18n.system("More completed storyboards are available. Open them from this Document’s results.")}</p>`:nothing}</div>`;
  }
  #nativeSlidesJob(job:DocumentJob){
    return this.#nativeStoryEligible(job.documentId)&&job.kind==="render_document"&&job.status==="completed"
      &&job.sourceSurface==="document"&&job.productionMode==="manual"&&job.result?.artifactKind==="slides";
  }
  #nativeSlidesJobIdentity(job:DocumentJob){
    return JSON.stringify([job.jobId,job.documentId,job.kind,job.status,job.sourceSurface,job.productionMode,
      job.documentRevision,job.requestKey,job.requestedAt,job.completedAt,job.attemptCount,job.result?.artifactKind,job.result?.artifactId]);
  }
  async #openOriginalSlides(job:DocumentJob,event:MouseEvent,renderedCurrent:()=>boolean){
    const trigger=event.currentTarget;
    if(!(trigger instanceof HTMLButtonElement)||!this.contains(trigger)||this.#slidesResultRead
      ||!renderedCurrent()||!this.#nativeSlidesJob(job)||!this.#readonlyReuseView()||this.#activeId||this.#convertingId)return false;
    const handle=captureNativeSlidesHandle({documentId:job.documentId,jobId:job.jobId});if(!handle)return false;
    const store=this.store,source=this.#privateSourceCurrent(),authorization=store.captureAuthorizationScope(),route=store.route.get();
    const identity=this.#nativeSlidesJobIdentity(job),artifactId=job.result?.artifactId,read={jobId:job.jobId,abort:new AbortController()};
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    const current=()=>this.#slidesResultRead===read&&!read.abort.signal.aborted&&renderedCurrent()&&source()
      &&this.store===store&&store.authorizationScopeActive(authorization)&&store.route.get()===route
      &&this.ownerDocument.visibilityState!=="hidden"&&!this.closest("[hidden],[inert]")
      &&trigger.isConnected&&this.contains(trigger)&&trigger.dataset.nativeSlidesJob===handle.jobId&&focus.current()
      &&this.#readonlyReuseView()&&!this.#activeId&&!this.#convertingId&&!this.#slidesCompletedJobs.get(handle.jobId)?.retired
      &&(()=>{
        const live=store.documentJobs.get().find(value=>value.jobId===handle.jobId);
        if(live)return this.#nativeSlidesJob(live)&&this.#nativeSlidesJobIdentity(live)===identity;
        const retained=this.#slidesCompletedJobs.get(handle.jobId);
        return Boolean(retained?.current()&&this.#nativeSlidesJob(retained.job)&&this.#nativeSlidesJobIdentity(retained.job)===identity);
      })();
    this.#slidesResultRead=read;this.#slidesResultError=null;this.requestUpdate();
    try{
      const completion=await readNativeSlidesCompletion(handle,{origin:location.origin,signal:read.abort.signal,current,
        request:(path,init)=>fetch(path,init)});
      if(!current())return false;
      const path=nativeSlidesRetainedRoute(completion,handle);if(!path)return false;
      await store.refreshEvents({readOnly:true,current});if(!current())return false;
      const selected=completion.selection,artifact=store.projection.get().libraryArtifacts.find(value=>value.id===selected.artifactId);
      if(selected.documentId!==handle.documentId||selected.artifactId!==artifactId
        ||!artifact||artifact.kind!=="slides"||artifact.documentId!==selected.documentId
        ||documentArtifactRevision(store.events.get(),artifact.id)!==selected.revision)return false;
      const original={id:artifact.id,sourceEventId:artifact.sourceEventId,contentRef:artifact.contentRef,sequence:artifact.sequence};
      const exact=()=>Date.parse(completion.expiresAt)>Date.now()&&nativeSlidesRetainedRoute(completion,handle)===path
        &&store.projection.get().libraryArtifacts.some(value=>value.id===original.id&&value.kind==="slides"
          &&value.documentId===selected.documentId&&value.sourceEventId===original.sourceEventId
          &&value.contentRef===original.contentRef&&value.sequence===original.sequence)
        &&documentArtifactRevision(store.events.get(),original.id)===selected.revision;
      return await navigateInApp(this,navigation=>current()&&exact()&&navigation.current()
        ?navigation.route(path,{documentFocus:false}):false);
    }catch{
      if(current())this.#slidesResultError=handle.jobId;
      return false;
    }finally{
      focus.dispose();read.abort.abort();if(this.#slidesResultRead===read)this.#slidesResultRead=null;
      this.requestUpdate();
    }
  }
  #nativeSlidesCompletions(){
    const source=this.#privateSourceCurrent(),live=this.store.documentJobs.get();
    for(const [id,retained] of this.#slidesCompletedJobs){
      const current=live.find(job=>job.jobId===id);
      if(!retained.current()||!this.#nativeSlidesJob(retained.job))this.#slidesCompletedJobs.delete(id);
      else if(current&&(!this.#nativeSlidesJob(current)||this.#nativeSlidesJobIdentity(current)!==this.#nativeSlidesJobIdentity(retained.job)))retained.retired=true;
    }
    if(this.#slidesOverflow&&(!this.#slidesOverflow.current()||!this.#nativeStoryEligible(this.#slidesOverflow.documentId)))this.#slidesOverflow=null;
    let capacity=Boolean(this.#slidesOverflow);
    for(const job of live.filter(value=>this.#nativeSlidesJob(value))){
      if(this.#slidesCompletedJobs.has(job.jobId))continue;
      if(this.#slidesCompletedJobs.size>=120){this.#slidesOverflow??={documentId:job.documentId,current:source};capacity=true;continue;}
      // Keep an observed exact completion across the ordinary feed ACK. Its
      // authority is still re-read before Open; it is never a cached receipt.
      const captured=Object.freeze({...job,result:job.result?Object.freeze({...job.result}):job.result});
      this.#slidesCompletedJobs.set(job.jobId,{job:captured,current:source});
    }
    const jobs=[...this.#slidesCompletedJobs.values()].filter(value=>!value.retired).map(value=>value.job);
    if(!jobs.length&&!capacity)return nothing;
    return html`<div class="document-artifact-jobs native-slides-completions">${jobs.map(job=>html`<span><b>${this.i18n.system("Completed Slides")}</b><small>${this.i18n.date(new Date(job.completedAt??job.updatedAt),{dateStyle:"medium",timeStyle:"short"})}</small><button type="button" class="button secondary compact" data-native-slides-job=${job.jobId} aria-busy=${String(this.#slidesResultRead?.jobId===job.jobId)} @click=${(event:MouseEvent)=>void this.#openOriginalSlides(job,event,source)}>${this.i18n.system("Open original Slides")}</button>${this.#slidesResultError===job.jobId?html`<small role="status">${this.i18n.system("The exact completed slides could not be verified. Try opening this same request again.")}</small>`:nothing}</span>`)}${capacity?html`<p role="status">${this.i18n.system("More completed slides are available. Open them from this Document’s results.")}</p>`:nothing}</div>`;
  }
  #sceneCostControls(){
    const required=this.#sceneActionCurrent(),view=this.#sceneCostView?.current()?this.#sceneCostView:null;
    const destination=this.#sceneDestination(),handle=destination?this.#sceneHandles().get(destination):undefined;
    const job=view?.inspection?.job,preview=this.#sceneFreshPreview(),unused=Boolean(view&&this.#sceneSafeUnused(view)),busy=Boolean(view?.busy||this.#sceneResultRead||this.#submitting||this.#sceneSubmitting?.formCurrent()||this.#workflowBusy);
    return html`<aside class="artifact-cost-confirm artifact-scene-cost-status" aria-label=${this.i18n.t("scene.cost.review","Scene cost and request status")}><span>
      <b>${job?this.i18n.t("scene.cost.original","Original Scene request — not the current draft"):preview?this.i18n.t("scene.cost.ready","Verified Scene plan — approval required"):this.i18n.t("scene.cost.notVerified","Scene plan not yet verified")}</b>
      <small role="status">${destination&&this.#sceneCapacityDestination===destination?this.i18n.t("scene.cost.capacity","This window is retaining the maximum number of Scene request references. Return to an existing Scene destination or inspect its recorded work in Activity; unresolved requests will not be replaced."):(view?.busy||this.#sceneResultRead?.view===view)?this.i18n.t("scene.cost.checking","Checking this exact Scene request…"):view?.error==="source-index"?this.i18n.t("scene.cost.sourcesStale","The Document’s saved source index needs refreshing. Refresh the Document, then check this same request again."):view?.error==="recovery"?this.i18n.t("scene.cost.recoveryChanged","The original request no longer permits a new request. Keep this reference and check it again; no new request was started."):view?.error?this.i18n.t("scene.cost.unavailable","The exact Scene request could not be verified. Check its original status before approving paid work."):this.#sceneSourcesRefreshed?this.i18n.t("scene.cost.sourcesRefreshed","Document sources refreshed. Check this same Scene request again before approving."):job?this.i18n.t("scene.cost.originalStatus","Original request status: {status}. Draft changes do not change this recorded request.",{status:this.i18n.t(`activity.status.${job.status}`,job.status)}):handle?.everDispatched?this.i18n.t("scene.cost.unknown","This request may already have been submitted. Check its original status; no replacement request will be started automatically."):this.i18n.t("scene.cost.free","Checking the current plan or original request is free: no provider call, reservation, or generation starts.")}</small>
      ${this.store.session.get()?.provider.plannerConfigured!==true?html`<small>${this.i18n.system("Provider")}: ${this.i18n.t("lab.unavailable","Unavailable")} · ${this.i18n.t("generation.contactAdministrator","Contact your project administrator")}</small>`:nothing}
      ${unused?html`<small>${this.i18n.t("scene.cost.unused","The original request is verified unused. New Scene request checks it again, then prepares a new plan for separate approval.")}</small>`:nothing}
      ${job&&!view?.inspection?.preview?html`<small>${this.i18n.t("scene.cost.detailsUnavailable","The original cost and settings are unavailable. This does not establish a zero charge or released reservation.")}</small>`:nothing}
      <div>
        <button type="button" class="button secondary compact" ?disabled=${busy||!required()} @click=${()=>void this.#prepareSceneCost(required)}>${handle?.everDispatched||job?this.i18n.t("scene.cost.inspect","Check original Scene request · free"):this.i18n.t("scene.cost.check","Check Scene cost · free")}</button>
        ${view?.error==="source-index"?html`<button type="button" class="button secondary compact" ?disabled=${busy} @click=${()=>void this.#refreshSceneSources(view)}>${this.i18n.t("scene.cost.refreshSources","Refresh Document sources")}</button>`:nothing}
        ${job&&view?html`<button type="button" class="button secondary compact" ?disabled=${busy||!view.checked} @click=${()=>void this.#inspectSceneRequest(view)}>${this.i18n.t("scene.cost.receipt","Inspect original Scene inputs")}</button>`:nothing}
        ${job?.status==="completed"&&job.productionMode==="manual"&&job.sourceSurface==="document"&&view?.inspection?.preview?.itemCount===1?html`<button type="button" class="button secondary compact" ?disabled=${busy&&this.#sceneResultRead?.view!==view||!this.#sceneOriginalResultReady(view)} aria-busy=${this.#sceneResultRead?.view===view?"true":nothing} @click=${(event:MouseEvent)=>void this.#openOriginalScene(view,event)}>${this.i18n.t("scene.cost.openOriginal","Open original Scene")}</button>${!busy&&!this.#sceneOriginalResultReady(view)?html`<small>${this.i18n.t("scene.cost.openDraftBlocked","Your current settings differ from the original request or contain other unsaved output drafts. Inspect the original inputs before leaving this draft.")}</small>`:nothing}`:nothing}
        ${(job?.status==="completed"||unused)&&view?.checked&&this.#sceneCanAuthor()?html`<button type="button" class="button secondary compact" ?disabled=${busy} @click=${()=>void this.#newSceneRequest(view,unused)}>${this.i18n.t("scene.cost.new","New Scene request")}</button>`:nothing}
      </div>
    </span></aside>`;
  }

  #sceneMediumLabel(medium:SceneMedium|"auto"){return this.i18n.t(`scene.medium.${medium}`,medium==="auto"?"Automatic (downstream)":medium==="audio"?"Audio":"Visual");}
  #sceneVariantLabel(medium:SceneMedium){return this.i18n.t(`scene.variant.${medium}`,medium==="audio"?"Audio scene":"Visual scene");}
  #sceneAlternateLabel(medium:SceneMedium){return this.i18n.t(`scene.alternate.${medium}`,medium==="audio"?"Audio scene available as an alternate":"Visual scene available as an alternate");}
  #sceneMediumDescription(medium:SceneMedium){return this.i18n.t(`scene.medium.description.${medium}`,medium==="audio"?"Dialogue, sound cues, ambience, and listening continuity.":"Action, framing, and visual continuity.");}
  #artifactSceneConfiguration(artifact:DocumentArtifact){
    if(artifact.kind!=="scene")return null;
    const retained=artifact.settings.scene_configuration;
    const configured=retained&&typeof retained==="object"&&!Array.isArray(retained)?retained as Record<string,unknown>:{};
    const medium=isSceneMedium(artifact.settings.scene_medium)?artifact.settings.scene_medium:isSceneMedium(configured.medium)?configured.medium:"visual";
    const validFormat=(value:unknown):value is ProductionFormat=>value==="image"||DOCUMENT_ARTIFACT_KINDS.includes(value as DocumentArtifactKind);
    return createSceneConfiguration(medium,{
      source:configured.source==="production-path"?"production-path":"manual",
      targetFormat:validFormat(configured.targetFormat)?configured.targetFormat:null,
      downstreamFormats:Array.isArray(configured.downstreamFormats)?configured.downstreamFormats.filter(validFormat):[],
    });
  }
  #currentWorkflow(){const projection=this.#projection();const documentScope=`${projection.projectId}:${this.#targetDocumentId()}`;if(this.#workflowDocumentScope!==documentScope){this.#workflowDocumentScope=documentScope;this.#workflowTarget=inferDocumentArtifactKind(projection.blocks,projection.documentTitle)??"video";this.#workflowTargetSelected=false;this.#workflowExpanded=null;this.#activeWorkflowId="";this.#activeWorkflowStageId="";this.#workflowRisk=null;this.#autoBoundWorkflowEvents.clear();}const workflows=productionWorkflows(this.store.events.get(),this.#targetDocumentId(),projection.projectId);const project=this.store.session.get()?.projectContext;const readOnly=Boolean(project&&(!project.permissions.includes("project.author")||!project.permissions.includes("project.output.request")));return workflows.find((workflow)=>workflow.id===this.#activeWorkflowId)??(!this.#workflowTargetSelected||readOnly?workflows.at(-1)??null:workflows.filter((workflow)=>workflow.target===this.#workflowTarget).at(-1)??null);}
  #runningWorkflowStages(workflow:ProductionWorkflow){return new Set(this.store.documentJobs.get().flatMap((job)=>{if(job.documentId!==workflow.documentId||!["queued","running","committing"].includes(job.status))return[];const stage=workflow.stages.find((candidate)=>job.sourceSurface===`workflow:${workflow.id}:${candidate.id}`);return stage?[`${workflow.id}:${stage.id}`]:[];}));}
  async #saveWorkflow(workflow:ProductionWorkflow){
    if(this.#workflowBusy||productionWorkflowIssues(workflow).length)return false;
    const project=this.store.session.get()?.projectContext;
    if(project&&(!project.permissions.includes("project.author")||!project.permissions.includes("project.output.request")))return false;
    this.#workflowBusy=true;this.requestUpdate();
    try{const appended=await this.store.append({type:DOCUMENT_PRODUCTION_WORKFLOW_EVENT,payload:{workflow_id:workflow.id,document_id:workflow.documentId,project_id:workflow.projectId,target_kind:workflow.target,workflow,source_surface:`${this.source}-production-workflow`}},{expected:this.store.head.get()});if(appended.length){this.#workflowTarget=workflow.target;this.#workflowTargetSelected=true;this.#activeWorkflowId=workflow.id;return true;}return false;}
    finally{this.#workflowBusy=false;this.requestUpdate();}
  }
  async #createWorkflow(){const projection=this.#projection();const workflow=recommendProductionWorkflow({id:crypto.randomUUID(),documentId:this.#targetDocumentId(),projectId:projection.projectId,target:this.#workflowTarget,approvalRequired:Boolean(this.store.session.get()?.projectContext)});return this.#saveWorkflow(workflow);}
  #updateWorkflowStage(workflow:ProductionWorkflow,stageId:string,update:(stage:ProductionWorkflowStage)=>ProductionWorkflowStage){return this.#saveWorkflow({...workflow,stages:workflow.stages.map((stage)=>stage.id===stageId?update(stage):stage)});}
  async #selectWorkflowSource(workflow:ProductionWorkflow,stage:ProductionWorkflowStage,outputId:string,options:{requireCurrentInputs?:boolean}={}){
    if(!outputId)return this.#updateWorkflowStage(workflow,stage.id,(current)=>({...current,source:null}));
    const projection=this.#projection();let source:ProductionWorkflowSource|null=null;
    if(stage.format==="image"){
      const image=projection.libraryOutputs.find((candidate)=>candidate.id===outputId&&candidate.documentId===workflow.documentId&&!candidate.discarded);
      if(!image||!image.mediaUrl)return false;
      source={outputKind:"image",outputId:image.id,format:"image",documentId:image.documentId,sourceEventId:image.sourceEventId,revision:0,approvalRequired:false,allowTextGuidance:false};
    }else{
      const artifact=projection.libraryArtifacts.find((candidate)=>candidate.id===outputId&&candidate.documentId===workflow.documentId&&candidate.kind===stage.format);
      if(!artifact)return false;
      if(artifact.contentRef&&!this.store.content.get()[artifact.contentRef])await this.store.ensurePrivateContent(artifact.contentRef);
      const binding=await this.#artifactBinding(artifact);if(!binding)return false;
      source={outputKind:"artifact",outputId:artifact.id,format:artifact.kind,documentId:artifact.documentId,sourceEventId:artifact.sourceEventId,revision:binding.artifact_revision,contentSha256:binding.content_sha256,approvalRequired:stage.approvalRequired||workflow.approvalRequired,allowTextGuidance:false};
    }
    const current=this.#currentWorkflow();
    const currentStage=current?.id===workflow.id&&current.documentId===workflow.documentId
      ? current.stages.find((candidate)=>candidate.id===stage.id&&candidate.format===stage.format&&candidate.enabled)
      : undefined;
    if(!current||!currentStage
      ||JSON.stringify(productionWorkflowSourceIdentity(stage.source?[stage.source]:[]))
        !==JSON.stringify(productionWorkflowSourceIdentity(currentStage.source?[currentStage.source]:[])))return false;
    if(options.requireCurrentInputs){
      const completion=this.store.events.get().find((event)=>event.eventId===source.sourceEventId);
      const recorded=completion?productionWorkflowRecordedSources(completion):null;
      const states=productionWorkflowStageStates(current,this.#projection(),this.store.events.get(),this.#runningWorkflowStages(current));
      const expected=productionWorkflowSourcesForStage(current,currentStage.id,states);
      if(recorded===null||JSON.stringify(productionWorkflowSourceIdentity(recorded))!==JSON.stringify(productionWorkflowSourceIdentity(expected)))return false;
    }
    return this.#updateWorkflowStage(current,currentStage.id,(candidate)=>({...candidate,source}));
  }
  async #launchWorkflowStage(workflow:ProductionWorkflow,stage:ProductionWorkflowStage){
    const states=productionWorkflowStageStates(workflow,this.#projection(),this.store.events.get(),this.#runningWorkflowStages(workflow));
    const state=states.find((candidate)=>candidate.stage.id===stage.id);if(!state||!["missing","ready"].includes(state.status))return;
    const workflowSources=productionWorkflowSourcesForStage(workflow,stage.id,states);
    const sourceSurface=`workflow:${workflow.id}:${stage.id}`;
    this.#activeWorkflowId=workflow.id;this.#activeWorkflowStageId=stage.id;
    if(stage.format==="image"){
      const requestKey=this.store.productionWorkflowGenerationRequestKey(workflow.id,stage.id,workflowSources);
      const executor={ensureGenerationReadiness:async(kind:"preview"|"generate",options:{sourcePreviewId?:string|null;sourceSurface?:string})=>{const readiness=await this.store.ensureGenerationReadiness(kind,{...options,requestKey,workflowId:workflow.id,workflowStageId:stage.id,workflowSources});if(readiness?.status==="review"&&!this.store.generationRiskAcknowledged(requestKey)){this.#workflowRisk={workflowId:workflow.id,stageId:stage.id,requestKey,summary:readiness.summary};this.requestUpdate();}return readiness;},generationRiskAcknowledged:this.store.generationRiskAcknowledged.bind(this.store),preview:this.store.preview.bind(this.store),generate:()=>this.store.generate({sourceSurface,workflowId:workflow.id,workflowStageId:stage.id,workflowSources}),toast:(message:string)=>{if(!this.#workflowRisk)this.store.toast(message);}};
      try{await runReadyImageGeneration(executor,"generate",{sourceSurface});}finally{this.#activeWorkflowStageId="";this.requestUpdate();}return;
    }
    if(stage.format==="scene")this.#sceneMedium=productionWorkflowSceneConfiguration(workflow,stage.id)?.medium??"visual";
    this.#selectArtifactKind(stage.format);
    await this.#openCreate();
  }
  async #regenerateWorkflowStage(workflow:ProductionWorkflow,stage:ProductionWorkflowStage){
    if(!stage.source||this.#workflowBusy)return;
    const previousSource={...stage.source};
    for(const event of this.store.events.get()){
      if(event.type==="DocumentRenderCompleted"
        &&String(event.payload.workflow_id??"")===workflow.id
        &&String(event.payload.workflow_stage_id??"")===stage.id
        &&String(event.payload.document_id??"")===workflow.documentId){
        this.#autoBoundWorkflowEvents.add(event.eventId);
      }
    }
    if(!await this.#updateWorkflowStage(workflow,stage.id,(current)=>({...current,source:null})))return;
    if(stage.format!=="image")this.#pendingWorkflowRegeneration={workflowId:workflow.id,documentId:workflow.documentId,stageId:stage.id,source:previousSource};
    const current=this.#currentWorkflow();
    const replacement=current?.id===workflow.id?current.stages.find((candidate)=>candidate.id===stage.id):undefined;
    if(current&&replacement&&replacement.enabled&&!replacement.source)await this.#launchWorkflowStage(current,replacement);
    if(stage.format!=="image"&&!this.#createOpen)void this.#restoreWorkflowRegeneration();
  }
  async #restoreWorkflowRegeneration(){
    if(this.#submitting)return;
    const pending=this.#pendingWorkflowRegeneration;
    // Close may occur during Store preparation or inside fetch, before onDispatch runs.
    // Only this exact submission may release or consume its existing rollback.
    if(!pending||pending.sceneSubmission?.pending)return;
    this.#pendingWorkflowRegeneration=null;
    if(pending.sceneSubmission?.dispatched)return;
    const workflow=this.#currentWorkflow();
    if(!workflow||workflow.id!==pending.workflowId||workflow.documentId!==pending.documentId)return;
    const stage=workflow.stages.find((candidate)=>candidate.id===pending.stageId);
    if(!stage||!stage.enabled||stage.source||this.#runningWorkflowStages(workflow).has(`${workflow.id}:${stage.id}`))return;
    await this.#updateWorkflowStage(workflow,stage.id,(current)=>({...current,source:pending.source}));
  }
  async #selectSceneMedium(medium:SceneMedium){
    this.#sceneDraftChanged();
    if(this.#workflowBusy||!isSceneMedium(medium))return;
    const workflow=this.#activeWorkflowStageId?this.#currentWorkflow():null;
    const stage=workflow?.stages.find((candidate)=>candidate.id===this.#activeWorkflowStageId&&candidate.format==="scene");
    if(!workflow||!stage){this.#sceneMedium=medium;this.requestUpdate();return;}
    const previous=this.#sceneMedium;
    this.#sceneMedium=medium;this.requestUpdate();
    const saved=await this.#updateWorkflowStage(workflow,stage.id,(current)=>({...current,sceneMedium:medium,...(medium!==productionWorkflowSceneConfiguration(workflow,stage.id)?.medium?{source:null}:{})}));
    if(!saved){this.#sceneMedium=previous;this.requestUpdate();}
  }
  #presentationOutline(){return inferPresentationSourceOutline(this.#projection().blocks.filter((block)=>Number(block.properties.weight??.5)>0));}
  #presentationPlanningSnapshot(){const projection=this.#projection();const facts=projection.blocks.map((block)=>({block_id:block.id,type:block.type,role:block.type,handle:block.handle,locked:block.locked,active:Number(block.properties.weight??.5)>0,properties:block.properties}));const blockIds=new Set(facts.map((fact)=>fact.block_id));const relationships=projection.blockRelations.filter((relation)=>blockIds.has(relation.fromBlockId)&&blockIds.has(relation.toBlockId)).map((relation)=>({relation_id:relation.id,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties}));return{facts,relationships};}
  #resetPresentationCount(mode=this.#productionMode){const authored=this.#presentationOutline().authoredSlideCount;const minimum=minimumPresentationSlideCount(this.#presentationPlanningSnapshot());this.#itemCount=Math.max(1,Math.min(mode==="manual"?15:MAX_MANAGED_PRESENTATION_SLIDES,Math.max(authored??6,minimum)));this.#managedSlideInput="";this.#invalidSlideCount=false;}
  #selectArtifactKind(kind:DocumentArtifactKind){
    if(this.#kind!==kind){
      this.#requestDrafts.set(this.#kind,{audience:this.#audience,tone:this.#tone,productionMode:this.#productionMode,itemCount:this.#itemCount,managedSlideInput:this.#managedSlideInput,invalidSlideCount:this.#invalidSlideCount});
      this.#clearSceneCost();
    }
    const changed=this.#kind!==kind,saved=changed?this.#requestDrafts.get(kind):null;
    const selected=selectArtifactProductionKind({kind:this.#kind,mode:changed?"manual":this.#productionMode,storyboardManagedDefault:this.#storyboardManagedDefault,storyboardManualOptOut:this.#storyboardManualOptOut},kind);
    this.#kind=selected.kind;this.#productionMode=saved?.productionMode??selected.mode;this.#storyboardManagedDefault=selected.storyboardManagedDefault;this.#storyboardManualOptOut=selected.storyboardManualOptOut;
    if(changed){this.#audience=saved?.audience??"";this.#tone=saved?.tone??"";this.#itemCount=saved?.itemCount??6;this.#managedSlideInput=saved?.managedSlideInput??"";this.#invalidSlideCount=saved?.invalidSlideCount??false;this.#restoredRequest=null;this.#restoredVideoResolution=undefined;}
    this.#soundtrackBlockIds=[];this.#sendSoundtrackToVideoProvider=false;this.#audioImageBlockId="";this.#sendAudioVideoToProvider=false;if(kind!=="audio")this.#audioVideoArtifactId="";if(kind==="audio"&&this.#audioGoal!=="music"||kind==="model3d")this.#productionMode="manual";
  }
  #rememberRequestDraft(){this.#requestDrafts.set(this.#kind,{audience:this.#audience,tone:this.#tone,productionMode:this.#productionMode,itemCount:this.#itemCount,managedSlideInput:this.#managedSlideInput,invalidSlideCount:this.#invalidSlideCount});}
  #retireRequestReview(){this.#requestReviewEpoch++;this.#requestReviewLoading=false;this.#restoredRequest=null;this.#restoredVideoResolution=undefined;}
  #guidanceInput(field:"audience"|"tone",value:string){
    if(this.#requestReviewLoading)this.#retireRequestReview();
    if(field==="audience")this.#audience=value;else this.#tone=value;
    this.#sceneDraftChanged();this.requestUpdate();
  }
  #applyRestoredRequest(settings:RestoredDocumentRenderSettings){
    this.#audience=settings.audience;this.#tone=settings.tone;this.#productionMode=settings.productionMode;
    if(settings.itemCount!==null)this.#itemCount=settings.itemCount;
    this.#managedSlideInput="";this.#invalidSlideCount=false;
    this.#presentationStyle=settings.presentationStyle;this.#presentationFidelity=settings.presentationFidelity;
    if(settings.sceneMedium)this.#sceneMedium=settings.sceneMedium;
    this.#restoredVideoResolution=settings.kind==="video"&&settings.productionMode==="manual"?settings.videoResolution:undefined;
    if(settings.videoSeconds)this.#seconds=settings.videoSeconds;if(settings.videoSize)this.#videoSize=settings.videoSize;if(settings.videoAudioMode)this.#videoAudioMode=settings.videoAudioMode;
    if(settings.audioProfile){const profile=settings.audioProfile;this.#audioGoal=profile.goal;this.#audioDestination=profile.destination;this.#audioDuration=profile.durationSeconds??30;this.#audioDurationInput=String(this.#audioDuration);this.#invalidAudioDuration=false;this.#audioSpeakerCount=profile.speakerCount??1;this.#audioInstrumental=profile.requireInstrumental===true;}
    this.#audioImageBlockId=settings.audioImageBlockId;this.#audioVideoArtifactId=settings.audioVideoArtifactId;this.#soundtrackBlockIds=[...settings.soundtrackBlockIds];
    // Earlier transfer consent is evidence, never a new authorization.
    this.#confirmed=false;this.#sendSoundtrackToVideoProvider=false;this.#sendAudioVideoToProvider=false;this.#clearSceneCost();
  }
  #createDialog(){return this.renderRoot.querySelector<HTMLDialogElement>(".document-artifact-create");}#viewDialog(){return this.renderRoot.querySelector<HTMLDialogElement>(".document-artifact-view");}
  #revealCreateFocus(event:Event,current:()=>boolean){
    const toggled=event.type==="toggle";
    if(event.type!=="focusin"&&!toggled||!event.isTrusted||!this.isConnected||!current())return;
    const path=event.composedPath(),source=path[0],form=event.currentTarget,dialog=this.#createDialog(),document=this.ownerDocument,view=document.defaultView;
    if(!(source instanceof HTMLElement)||!(form instanceof HTMLElement)||form.tagName!=="FORM"||!dialog||!view)return;
    const disclosure=toggled&&source.tagName==="DETAILS"?source as HTMLDetailsElement:null;
    if(toggled&&(!disclosure||event.target!==disclosure||!disclosure.open))return;
    const summaries=disclosure?.querySelectorAll<HTMLElement>(":scope > summary");
    const target=disclosure?summaries?.length===1?summaries[0]:null:source;
    if(!(target instanceof HTMLElement)||path.find(node=>node instanceof HTMLElement&&node.tagName==="FORM")!==form
      ||path.find(node=>node instanceof HTMLElement&&node.tagName==="DIALOG")!==dialog)return;
    this.#revealOwnedCreateFocus(target,form,current,disclosure);
  }
  #revealModel3dLayoutFocus(event:Event,current:()=>boolean){
    const editor=event.currentTarget,target=this.ownerDocument.activeElement;
    if(event.type!=="model3d-settings-change"||!(editor instanceof HTMLElement)||event.target!==editor
      ||!editor.matches('forma-model3d-settings-editor[prompt-source="document"]')||!editor.isConnected
      ||editor.ownerDocument!==this.ownerDocument||!(target instanceof HTMLElement)||!editor.contains(target)
      ||target.closest("forma-model3d-settings-editor")!==editor)return;
    const form=editor.closest("form.document-artifact-dialog");
    if(!(form instanceof HTMLElement))return;
    const ownsEditor=()=>{
      const editors=form.querySelectorAll('forma-model3d-settings-editor[prompt-source="document"]');
      return this.ownerDocument.hasFocus()&&editor.isConnected&&editor.ownerDocument===this.ownerDocument&&editor.matches('forma-model3d-settings-editor[prompt-source="document"]')
        &&editor.contains(target)&&target.closest("forma-model3d-settings-editor")===editor&&editor.closest("form.document-artifact-dialog")===form
        &&editors.length===1&&editors[0]===editor;
    };
    // The editor emits its existing change after a changed prompt has rendered.
    // Recheck the still-owned focus against that layout without moving focus.
    this.#revealOwnedCreateFocus(target,form,()=>current()&&ownsEditor());
  }
  #revealOwnedCreateFocus(target:HTMLElement,form:HTMLElement,current:()=>boolean,disclosure:HTMLDetailsElement|null=null){
    const dialog=this.#createDialog(),document=this.ownerDocument,view=document.defaultView;
    if(!dialog||!view)return;
    const ownsDisclosure=()=>!disclosure||disclosure.isConnected&&disclosure.open&&disclosure.ownerDocument===document
      &&form.contains(disclosure)&&disclosure.closest("form")===form&&disclosure.closest("dialog")===dialog
      &&target.tagName==="SUMMARY"&&target.parentElement===disclosure
      &&disclosure.querySelectorAll(":scope > summary").length===1&&disclosure.querySelector(":scope > summary")===target;
    const ownsFocus=()=>this.isConnected&&current()&&target.isConnected&&form.isConnected&&dialog.isConnected
      &&target.ownerDocument===document&&form.ownerDocument===document&&dialog.ownerDocument===document
      &&document.activeElement===target&&this.#createDialog()===dialog&&dialog.open&&dialog.matches(":modal")
      &&form.parentElement===dialog&&form.contains(target)&&target.closest("form")===form&&target.closest("dialog")===dialog
      &&target.matches(":focus-visible")&&!target.matches(":disabled")&&target.getAttribute("aria-disabled")!=="true"
      &&!target.closest('[hidden], [inert], [aria-hidden="true"]')&&ownsDisclosure();
    if(!ownsFocus()||!target.matches("button,input,select,textarea,summary,a[href]"))return;
    const forms=dialog.querySelectorAll(":scope > form.document-artifact-dialog"),footers=form.querySelectorAll<HTMLElement>(":scope > footer");
    if(forms.length!==1||forms[0]!==form||footers.length!==1)return;
    const footer=footers[0]!;
    if(!footer.isConnected||footer.ownerDocument!==document||footer.parentElement!==form||footer.contains(target))return;
    const style=view.getComputedStyle(target);
    if(!target.getClientRects().length||style.display==="none"||style.visibility==="hidden"||style.visibility==="collapse"||style.opacity==="0")return;
    // Rectangles retain fractions; native offset/client metrics round to
    // integers. Bound their rendered scale instead of shrinking the outline
    // or under-scrolling when a rounded offset is slightly too large/small.
    const clientBounds=(element:HTMLElement)=>{
      const rect=element.getBoundingClientRect(),minScale=rect.height/(element.offsetHeight+.5),maxScale=rect.height/(element.offsetHeight-.5);
      const top=rect.top+(element.clientTop+.5)*maxScale,bottom=rect.top+Math.max(0,element.clientTop+element.clientHeight-1)*minScale;
      return [minScale,maxScale,top,bottom].every(Number.isFinite)&&minScale>0&&maxScale>=minScale&&bottom>top?{top,bottom,minScale,maxScale}:null;
    };
    const formBounds=clientBounds(form),dialogBounds=clientBounds(dialog),rect=target.getBoundingClientRect(),footerRect=footer.getBoundingClientRect();
    const viewport=view.visualViewport,viewportTop=viewport?.offsetTop??0,viewportHeight=viewport?.height??view.innerHeight;
    const targetScale=rect.height/(target.offsetHeight-.5),maxScroll=form.scrollHeight-form.clientHeight;
    if(!formBounds||!dialogBounds||![rect.top,rect.bottom,rect.width,rect.height,targetScale,footerRect.top,footerRect.bottom,
      viewportTop,viewportHeight,form.scrollTop,maxScroll].every(Number.isFinite)
      ||rect.width<=0||rect.height<=0||targetScale<=0||footerRect.bottom<=footerRect.top||viewportHeight<=0||maxScroll<=0)return;
    const top=Math.max(formBounds.top,dialogBounds.top,viewportTop),bottom=Math.min(formBounds.bottom,dialogBounds.bottom,viewportTop+viewportHeight,footerRect.top);
    if(bottom<=top)return;
    const width=Number.parseFloat(style.outlineWidth),offset=Number.parseFloat(style.outlineOffset);
    const outline=style.outlineStyle!=="none"&&style.outlineStyle!=="hidden"&&Number.isFinite(width)&&Number.isFinite(offset)?Math.max(0,width+offset)*targetScale:0;
    let start=rect.top-outline,end=rect.bottom+outline;
    if(disclosure){
      const expanded=disclosure.getBoundingClientRect(),expandedStyle=view.getComputedStyle(disclosure);
      if(!disclosure.getClientRects().length||expandedStyle.display==="none"||expandedStyle.visibility==="hidden"
        ||expandedStyle.visibility==="collapse"||expandedStyle.opacity==="0"
        ||![expanded.top,expanded.bottom,expanded.width,expanded.height].every(Number.isFinite)||expanded.width<=0||expanded.height<=0)return;
      const expandedStart=Math.min(start,expanded.top),expandedEnd=Math.max(end,expanded.bottom);
      const lower=(expandedEnd-bottom)/(expandedEnd>bottom?formBounds.minScale:formBounds.maxScale);
      const upper=(expandedStart-top)/(expandedStart<top?formBounds.minScale:formBounds.maxScale);
      if(![lower,upper].every(Number.isFinite))return;
      // Opening details does not move focus. Reveal its contents with the
      // summary's full outline only when both fit; oversized disclosures keep
      // the focused summary's envelope and remain available to native scrolling.
      if(lower<=upper){start=expandedStart;end=expandedEnd;}
    }
    const lower=(end-bottom)/(end>bottom?formBounds.minScale:formBounds.maxScale);
    const upper=(start-top)/(start<top?formBounds.minScale:formBounds.maxScale);
    if(![start,end,lower,upper].every(Number.isFinite))return;
    let requested=form.scrollTop;
    if(lower<=upper){
      // Both edges constrain the movement. Round outward only when that
      // remains safe for the opposite edge; otherwise stay inside the finite
      // fractional interval, leaving clearance on each side.
      const delta=Math.max(lower,Math.min(upper,0));
      if(delta!==0){
        const rounded=delta>0?Math.ceil(form.scrollTop+delta):Math.floor(form.scrollTop+delta),movement=rounded-form.scrollTop;
        requested=movement>=lower&&movement<=upper?rounded:form.scrollTop+(lower+upper)/2;
      }
    }else{
      // An oversized or uncertain envelope cannot be certified to fit. Keep
      // a span that already covers the lane; a one-CSS-pixel edge band avoids
      // alternating tiny corrections after native metric/scroll rounding.
      const band=formBounds.maxScale;
      const delta=start>top+band?start-top:end<bottom-band?end-bottom:0;
      if(delta!==0)requested=delta>0?Math.ceil(form.scrollTop+delta/formBounds.minScale):Math.floor(form.scrollTop+delta/formBounds.minScale);
    }
    const scrollTop=Math.max(0,Math.min(maxScroll,requested));
    if(!Number.isFinite(scrollTop)||scrollTop===form.scrollTop||!ownsFocus())return;
    form.scrollTo({top:scrollTop,behavior:"instant"});
  }
  #configurationCurrent:CreativePreparationGuard|null=null;
  #creationScope="";
  #viewerPopoverScope="";
  #closeViewerPopovers(){for(const popover of this.querySelectorAll<FormaUiPopover>("forma-ui-popover"))popover.close();}
  #syncViewerPopovers(){
    const scope=JSON.stringify([this.store.captureAuthorizationScope()?.key??"",this.store.route.get(),this.documentId,this.#activeId]);
    if(scope!==this.#viewerPopoverScope)this.#closeViewerPopovers();
    if(this.#viewerFocused||this.#editingId===this.#activeId)this.querySelector<FormaUiPopover>(".artifact-viewer-evidence-popover")?.close();
    this.#viewerPopoverScope=scope;
  }
  #clearCreationDraft(){this.retireNativeShortStory();this.#retireRequestReview();this.#requestDrafts.clear();this.#model3dSettings=structuredClone(DEFAULT_MODEL3D_SETTINGS);this.#model3dReferenceBlockIds=[];this.#model3dDraftRevision++;this.#clearSceneCost();this.#createOpen=false;this.#confirmed=false;this.#configurationCurrent=null;this.#audience="";this.#tone="";this.#rememberedAudiences.clear();this.#rememberedTones.clear();this.#soundtrackBlockIds=[];this.#audioImageBlockId="";this.#audioVideoArtifactId="";this.#sendSoundtrackToVideoProvider=false;this.#sendAudioVideoToProvider=false;this.#createDialog()?.close();}
  #viewerCurrent:(()=>boolean)|null=null;
  #viewerOpening=false;
  #deliveryBinding:{artifactId:string;revision:number;content:string;contentSha256:string;current:()=>boolean}|null=null;
  #deliveryBindingLoading:(()=>boolean)|null=null;
  #currentDeliveryBinding(artifact:DocumentArtifact){
    const value=this.#deliveryBinding;
    return value?.current===this.#viewerCurrent&&value.current()&&this.#activeId===artifact.id
      &&value.artifactId===artifact.id&&value.revision===documentArtifactRevision(this.store.events.get(),artifact.id)
      &&value.content===this.store.content.get()[artifact.contentRef??""]?value:null;
  }
  async #refreshDeliveryBinding(artifact:DocumentArtifact){
    const current=this.#viewerCurrent;
    if(!current||!current()||this.#activeId!==artifact.id||this.#deliveryBindingLoading===current)return;
    this.#deliveryBindingLoading=current;
    const content=this.store.content.get()[artifact.contentRef??""];
    try{const binding=await this.#artifactBinding(artifact);
      if(binding&&content!==undefined&&this.#viewerCurrent===current&&current()&&this.#activeId===artifact.id
        &&content===this.store.content.get()[artifact.contentRef??""]
        &&binding.artifact_revision===documentArtifactRevision(this.store.events.get(),artifact.id))
        this.#deliveryBinding={artifactId:artifact.id,revision:binding.artifact_revision,content,contentSha256:binding.content_sha256,current};
    }finally{if(this.#deliveryBindingLoading===current){this.#deliveryBindingLoading=null;this.requestUpdate();}}
  }
  async #showArtifactIntent(artifact:DocumentArtifact,intent:ArtifactDeliveryIntent){
    const current=this.#viewerCurrent,binding=this.#currentDeliveryBinding(artifact);
    if(!current||!current()||this.#activeId!==artifact.id||this.#editingId===artifact.id||this.#savingEdit)return false;
    const delivery=artifactDeliveryFor(this.store,artifact,binding?.contentSha256??null);
    if(artifact.kind==="slides"){
      if(intent==="inspect")return this.#showSlidesEvidence(artifact);
      this.#closeViewerPopovers();
      this.#viewerFocused=false;
      if(intent==="review")this.#reviewPanelOpen=true;
      else if(delivery.releaseAllowed)this.#viewerActionsOpen=true;
      else{this.#reviewPanelOpen=true;this.store.toast(this.#currentDeliveryBinding(artifact)?this.i18n.t("artifact.delivery.releaseBlocked","The current output needs valid independent approval before export."):this.i18n.t("artifact.delivery.bytesUnavailable","The current output bytes are unavailable for review or export."));}
      this.requestUpdate();await this.updateComplete;
      if(this.#viewerCurrent!==current||!current()||this.#activeId!==artifact.id
        ||this.#currentDeliveryBinding(artifact)!==binding||this.#editingId===artifact.id||this.#savingEdit)return false;
      if(intent==="export"&&artifactDeliveryFor(this.store,artifact,this.#currentDeliveryBinding(artifact)?.contentSha256??null).releaseAllowed){
        const trigger=this.#viewDialog()?.querySelector<HTMLButtonElement>(".presentation-deck-export");
        if(trigger&&!trigger.disabled){trigger.focus({preventScroll:true});trigger.click();}
        else this.#viewDialog()?.querySelector<HTMLButtonElement>("[data-artifact-export]")?.focus({preventScroll:true});
      }else this.#viewDialog()?.querySelector<HTMLElement>(".artifact-review-actions select, .artifact-review-actions textarea, .artifact-viewer-review-toggle")?.focus({preventScroll:true});
      return true;
    }
    // The extra native-panel render belongs to this gesture, never newer focus.
    const focus=captureOutputNavigationFocus(this.ownerDocument),route=this.store.route.get();
    const owned=()=>this.#viewerCurrent===current&&current()&&this.#activeId===artifact.id&&route===this.store.route.get()
      &&this.#currentDeliveryBinding(artifact)===binding&&this.#editingId!==artifact.id&&!this.#savingEdit&&focus.current();
    try{
      this.#viewerFocused=false;
      if(intent==="inspect"){
        this.#closeViewerPopovers();this.requestUpdate();await this.updateComplete;
        if(!owned())return false;
        const details=this.#viewDialog()?.querySelector<HTMLDetailsElement>(".artifact-viewer-details"),summary=details?.querySelector<HTMLElement>("summary");
        if(!details||!summary)return false;
        details.open=true;
        return focus.run(summary,()=>{summary.focus({preventScroll:true});return true;});
      }
      if(intent==="review"){this.#closeViewerPopovers();this.#reviewPanelOpen=true;}
      else if(!delivery.releaseAllowed){this.#closeViewerPopovers();this.#reviewPanelOpen=true;this.store.toast(this.#currentDeliveryBinding(artifact)?this.i18n.t("artifact.delivery.releaseBlocked","The current output needs valid independent approval before export."):this.i18n.t("artifact.delivery.bytesUnavailable","The current output bytes are unavailable for review or export."));}
      else if(intent==="export"&&artifact.kind==="model3d")this.#closeViewerPopovers();
      this.requestUpdate();await this.updateComplete;
      if(!owned())return false;
      if(intent==="export"&&artifactDeliveryFor(this.store,artifact,this.#currentDeliveryBinding(artifact)?.contentSha256??null).releaseAllowed){
        if(artifact.kind==="model3d"){
          const choices=this.#viewDialog()?.querySelectorAll<HTMLButtonElement>(".model3d-output-files .artifact-export-choice")??[];
          const choice=[...choices].find(button=>!button.disabled);
          return Boolean(choice&&focus.run(choice,()=>{choice.focus();return true;}));
        }
        const menu=this.querySelector<FormaUiPopover>(".artifact-viewer-actions-popover");
        if(!menu){
          const choices=this.#viewDialog()?.querySelectorAll<HTMLButtonElement>(".artifact-export-choice")??[];
          const choice=[...choices].find(button=>!button.disabled);
          return Boolean(choice&&focus.run(choice,()=>{choice.focus({preventScroll:true});return true;}));
        }
        await menu.updateComplete;
        if(!owned()||!menu.isConnected)return false;
        const trigger=menu.querySelector<HTMLButtonElement>(".ui-popover-trigger"),panel=menu.querySelector<HTMLElement>(".ui-popover-panel");
        if(!trigger||trigger.disabled||!panel)return false;
        // Native popovertarget opens the existing panel; only its final enabled
        // format receives focus. Opening is not export approval or a download.
        if(!panel.matches(":popover-open"))trigger.click();
        if(!owned()||!panel.matches(":popover-open"))return false;
        const choice=[...menu.querySelectorAll<HTMLButtonElement>(".artifact-export-choice")].find(button=>!button.disabled);
        return Boolean(choice&&focus.run(choice,()=>{choice.focus({preventScroll:true});return true;}));
      }
      const panel=this.#viewDialog()?.querySelector<HTMLElement>(".artifact-review-actions");
      const target=panel&&([...panel.querySelectorAll<HTMLElement>("select, textarea, a, button")].find(element=>!element.matches(":disabled"))??panel);
      return Boolean(target&&focus.run(target,()=>{target.focus({preventScroll:true});return true;}));
    }catch{return false;}finally{focus.dispose();}
  }
  protected override willUpdate(changed:PropertyValues<this>){
    this.#syncAudioTrim();
    this.#syncVideoTrim();
    this.#syncModel3dScale();
    if(this.#nativeStoryOpening&&!this.#nativeStoryLive(this.#nativeStoryOpening))this.retireNativeShortStory();
    this.#syncViewerPopovers();
    if(this.#presentationReceiptCheck&&!this.#presentationReceiptCheck.current())this.#presentationReceiptCheck=null;
    const scope=nextActionFacts(this.store,this.#targetDocumentId(),this.source==="canvas"?this.store.canvasProjection.get().selectedCanvasId:null).authorityKey;
    if(this.#creationScope&&scope!==this.#creationScope)this.#clearCreationDraft();
    this.#creationScope=scope;
    if(this.#sceneInputCurrent&&!this.#sceneInputCurrent()){this.#sceneInputCurrent=null;this.#failedInputJob=null;this.#runningInputJob=null;this.#actorInputContent={};}
    if(this.#sceneCostView&&!this.#sceneCostView.current())this.#clearSceneCost();
    if(changed.has("documentId")&&changed.get("documentId")!==undefined&&changed.get("documentId")!==this.documentId){
      this.#createOpen=false;this.#confirmed=false;this.#activeId="";this.#inputId="";this.#failedInputJob=null;this.#runningInputJob=null;this.#actorInputContent={};this.#activeWorkflowStageId="";
      this.#createDialog()?.close();this.#viewDialog()?.close();
    }
    if(this.#configurationCurrent&&!this.#configurationCurrent()){this.#createOpen=false;this.#confirmed=false;this.#configurationCurrent=null;}
    if(!this.#createOpen)this.#createDialog()?.close();
  }
  protected override updated(){
    if(this.#configurationCurrent&&!this.#configurationCurrent()){this.#createOpen=false;this.#confirmed=false;this.#configurationCurrent=null;this.#createDialog()?.close();this.requestUpdate();}
    if(this.#viewerCurrent&&!this.#viewerCurrent()){this.#activeId="";this.#viewerCurrent=null;this.#viewDialog()?.close();this.requestUpdate();}
    const create=this.#createDialog(),view=this.#viewDialog();
    const bindingArtifact=this.#activeId?this.store.projection.get().libraryArtifacts.find(artifact=>artifact.id===this.#activeId):undefined;
    if(bindingArtifact&&this.store.content.get()[bindingArtifact.contentRef??""]&&!this.#currentDeliveryBinding(bindingArtifact)&&!this.#deliveryBindingLoading)void this.#refreshDeliveryBinding(bindingArtifact);
    const preflight=this.querySelector("forma-video-reference-preflight");
    if(preflight)preflight.documentId=this.#targetDocumentId();
    if(this.#createOpen&&create&&!create.open&&!this.#nativeStoryOpening)ensureModalDialog(create);
    if(this.#activeId&&view&&!this.#viewerOpening){
      this.dispatchEvent(new CustomEvent("document-artifact-viewer-open",{bubbles:true,composed:true}));
      if(!view.open)ensureModalDialog(view);
    }
    this.#bindCompletedWorkflowStage();
  }
  #bindCompletedWorkflowStage(){
    const workflow=this.#currentWorkflow();
    const project=this.store.session.get()?.projectContext;
    if(!workflow||this.#workflowBusy||project&&(!project.permissions.includes("project.author")||!project.permissions.includes("project.output.request")))return;
    const projection=this.#projection(),events=this.store.events.get();
    const states=productionWorkflowStageStates(workflow,projection,events,this.#runningWorkflowStages(workflow));
    const completion=[...events].reverse().find((event)=>event.type==="DocumentRenderCompleted"
      &&String(event.payload.workflow_id??"")===workflow.id
      &&String(event.payload.document_id??"")===workflow.documentId
      &&!this.#autoBoundWorkflowEvents.has(event.eventId)
      &&workflow.stages.some((stage)=>{
        if(!(stage.enabled&&!stage.final&&stage.format!=="image"&&!stage.source&&stage.id===String(event.payload.workflow_stage_id??"")))return false;
        const state=states.find((candidate)=>candidate.stage.id===stage.id);
        const recorded=productionWorkflowRecordedSources(event);
        if(!state||!["missing","running"].includes(state.status)||recorded===null)return false;
        const expected=productionWorkflowSourcesForStage(workflow,stage.id,states);
        if(JSON.stringify(productionWorkflowSourceIdentity(recorded))!==JSON.stringify(productionWorkflowSourceIdentity(expected)))return false;
        if(stage.format==="scene"){
          const artifact=projection.libraryArtifacts.find((candidate)=>candidate.id===String(event.payload.artifact_id??"")&&candidate.documentId===workflow.documentId);
          if(!artifact||this.#artifactSceneConfiguration(artifact)?.medium!==(productionWorkflowSceneConfiguration(workflow,stage.id)?.medium??"visual"))return false;
        }
        return true;
      }));
    if(!completion)return;
    const stage=workflow.stages.find((candidate)=>candidate.id===String(completion.payload.workflow_stage_id??""));
    const outputId=String(completion.payload.artifact_id??"");
    if(!stage||!outputId)return;
    this.#autoBoundWorkflowEvents.add(completion.eventId);
    void this.#selectWorkflowSource(workflow,stage,outputId,{requireCurrentInputs:true}).then((bound)=>{
      if(!bound)this.#autoBoundWorkflowEvents.delete(completion.eventId);
    });
  }
  #openCreate=async(inferKind=false,required?:CreativePreparationGuard)=>{const nativeIntent=this.#nativeStoryIntentRevision;if(required&&!required()||nativeIntent!==this.#nativeStoryIntentRevision)return false;this.retireNativeShortStory();if(nativeIntent!==this.#nativeStoryIntentRevision)return false;if(!required)this.#retireRequestReview();const privateCurrent=this.#privateSourceCurrent(),sourceCurrent=()=>nativeIntent===this.#nativeStoryIntentRevision&&privateCurrent(),retained=required??retainCreativePreparation(()=>nextActionFacts(this.store,this.#targetDocumentId(),this.source==="canvas"?this.store.canvasProjection.get().selectedCanvasId:null));const current:CreativePreparationGuard=Object.assign(()=>sourceCurrent()&&retained(),{beginEditing:()=>sourceCurrent()&&retained.beginEditing()});if(!current())return false;const project=this.store.session.get()?.projectContext;if(project&&!project.permissions.includes("project.output.request"))return false;this.#configurationCurrent=current;if(inferKind){const projection=this.#projection(),inferred=inferDocumentArtifactKind(projection.blocks,projection.documentTitle);if(inferred)this.#selectArtifactKind(inferred);if(!this.#activeWorkflowStageId)this.#sceneMedium="visual";}this.#confirmed=false;this.#videoAudioMode=VIDEO_ADAPTER_CONTRACT.defaultAudioMode;this.#soundtrackBlockIds=[];this.#sendSoundtrackToVideoProvider=false;this.#sendAudioVideoToProvider=false;this.#audioImageBlockId="";if(this.#kind==="slides"&&!this.#requestDrafts.has("slides"))this.#resetPresentationCount();if(!this.#createOpen)this.#createOpener=this.ownerDocument.activeElement instanceof HTMLElement?this.ownerDocument.activeElement:undefined;this.#createOpen=true;this.requestUpdate();await this.updateComplete;if(this.#configurationCurrent!==current)return false;if(!current()){this.#createOpen=false;this.#configurationCurrent=null;this.#createDialog()?.close();this.requestUpdate();return false;}const dialog=this.#createDialog();if(dialog&&!dialog.open)ensureModalDialog(dialog);return Boolean(dialog?.open)&&current.beginEditing();};
  async #revealWorkbenchPane(){this.dispatchEvent(new CustomEvent("document-artifact-open",{bubbles:true,composed:true}));const workspace=this.closest("forma-workspace") as (HTMLElement&{updateComplete?:Promise<boolean>})|null;if(workspace?.updateComplete)await workspace.updateComplete;}
  async openRender(kind?:DocumentArtifactKind,documentId?:string,options:{videoSeconds?:VideoDurationSeconds;sceneMedium?:SceneMedium;current?:(stage:CreativePreparationStage)=>boolean}={}){
    const nativeIntent=this.#nativeStoryIntentRevision;if(options.current&&!options.current("opening")||nativeIntent!==this.#nativeStoryIntentRevision)return false;
    this.retireNativeShortStory();if(nativeIntent!==this.#nativeStoryIntentRevision)return false;this.#retireRequestReview();this.#activeWorkflowStageId="";if(documentId)this.documentId=documentId;
    const privateCurrent=this.#privateSourceCurrent(),sourceCurrent=()=>nativeIntent===this.#nativeStoryIntentRevision&&privateCurrent();
    const current=retainCreativePreparation(()=>nextActionFacts(this.store,this.#targetDocumentId(),this.source==="canvas"?this.store.canvasProjection.get().selectedCanvasId:null),(stage)=>sourceCurrent()&&(!options.current||options.current(stage)));
    if(!current())return false;
    if(kind)this.#selectArtifactKind(kind);if(kind==="scene")this.#sceneMedium=isSceneMedium(options.sceneMedium)?options.sceneMedium:"visual";if(options.videoSeconds)this.#seconds=normalizeVideoDurationSeconds(options.videoSeconds);
    await this.updateComplete;if(!current())return false;
    await this.#revealWorkbenchPane();if(!current())return false;
    return this.#openCreate(!kind,current);
  }
  async openArtifactById(artifactId:string,options:{expectedRevision?:number;expectedContentSha256?:string;intent?:ArtifactDeliveryIntent;current?:(stage:CreativePreparationStage)=>boolean}={}){const nativeIntent=this.#nativeStoryIntentRevision,privateCurrent=this.#privateSourceCurrent(),sourceCurrent=()=>nativeIntent===this.#nativeStoryIntentRevision&&privateCurrent(),authorization=this.store.captureAuthorizationScope(),artifact=this.store.projection.get().libraryArtifacts.find((candidate)=>candidate.id===artifactId);if(!artifact||!authorization)throw new Error("The requested output is no longer available.");if(!sourceCurrent()||options.current&&!options.current("opening")||nativeIntent!==this.#nativeStoryIntentRevision)return false;this.retireNativeShortStory();if(nativeIntent!==this.#nativeStoryIntentRevision)return false;const revision=options.expectedRevision??documentArtifactRevision(this.store.events.get(),artifactId),retained=this.store.content.get()[artifact.contentRef??""];if(documentArtifactRevision(this.store.events.get(),artifactId)!==revision)return false;this.documentId=artifact.documentId;await this.updateComplete;if(!sourceCurrent())return false;await this.#revealWorkbenchPane();if(!sourceCurrent())return false;if(!this.store.authorizationScopeActive(authorization)||this.#targetDocumentId()!==artifact.documentId||documentArtifactRevision(this.store.events.get(),artifactId)!==revision||retained!==undefined&&retained!==this.store.content.get()[artifact.contentRef??""]||!this.store.projection.get().libraryArtifacts.some((candidate)=>candidate.id===artifactId&&candidate.documentId===artifact.documentId&&candidate.sequence===artifact.sequence&&candidate.sourceEventId===artifact.sourceEventId&&candidate.contentRef===artifact.contentRef))throw new Error("The requested output changed before it opened.");if(options.current&&!options.current("opening"))return false;return this.#openArtifact(artifact,(stage)=>sourceCurrent()&&this.store.authorizationScopeActive(authorization)&&this.#targetDocumentId()===artifact.documentId&&(!options.current||options.current(stage)),revision,options);}
  // Exact read-only job inspection shared by next actions on every surface.
  // The optional caller owns the inspection lifetime, not a disposable focus lease.
  // Its boolean result means only that this exact current inspection was presented.
  async openJobById(jobId:string,options:{current?:()=>boolean}={}){const nativeIntent=this.#nativeStoryIntentRevision;if(options.current&&!options.current()||nativeIntent!==this.#nativeStoryIntentRevision)return false;this.retireNativeShortStory();if(nativeIntent!==this.#nativeStoryIntentRevision)return false;const privateCurrent=this.#privateSourceCurrent(),sourceCurrent=()=>nativeIntent===this.#nativeStoryIntentRevision&&privateCurrent(),authorization=this.store.captureAuthorizationScope(),job=this.store.documentJobs.get().find((candidate)=>candidate.jobId===jobId);if(!job||!authorization)throw new Error("The requested work is no longer available.");const route=options.current?this.store.route.get():"",callerCurrent=()=>sourceCurrent()&&(!options.current||this.store.route.get()===route&&options.current());if(!callerCurrent())return false;this.documentId=job.documentId;await this.updateComplete;if(!callerCurrent())return false;await this.#revealWorkbenchPane();if(!callerCurrent())return false;if(!this.store.authorizationScopeActive(authorization)||this.#targetDocumentId()!==job.documentId||!this.store.documentJobs.get().some((candidate)=>candidate.jobId===jobId&&candidate.documentId===job.documentId))return false;const required:(()=>boolean)|undefined=options.current?()=>callerCurrent()&&this.#sceneInputCurrent===required&&this.store.authorizationScopeActive(authorization)&&this.#targetDocumentId()===job.documentId:undefined;if(required)this.#sceneInputCurrent=required;if(["failed","partial","canceled"].includes(job.status))await this.#inspectFailedInputs(job,required);else await this.#inspectRunningInputs(job,required);if(required){if(!required())return false;await this.updateComplete;if(!required())return false;const dialog=this.querySelector("forma-generation-input-dialog");await dialog?.updateComplete;return Boolean(required()&&dialog?.isConnected&&dialog.open&&dialog.querySelector<HTMLDialogElement>("dialog")?.open&&(this.#failedInputJob?.jobId===jobId||this.#runningInputJob?.jobId===jobId));}}
  #closeOnBackdrop(event:MouseEvent){if(event.target!==event.currentTarget)return;const dialog=event.currentTarget as HTMLDialogElement;if(dialog.classList.contains("document-artifact-view")&&!this.#cancelViewer(event,false))return;dialog.close();if(dialog.classList.contains("document-artifact-create")){this.#createOpen=false;this.#activeWorkflowStageId="";void this.#restoreWorkflowRegeneration();}else{this.#activeId="";this.#reviewNote="";this.#viewerFocused=false;this.#reviewPanelOpen=false;this.#viewerActionsOpen=false;}this.requestUpdate();}
  #setViewerFocus(focused:boolean){this.#viewerFocused=focused;if(focused)this.#reviewPanelOpen=false;this.requestUpdate();void this.updateComplete.then(()=>this.#viewDialog()?.querySelector<HTMLButtonElement>(".artifact-viewer-focus-toggle")?.focus({preventScroll:true}));}
  #cancelViewer(event:Event,exitFocus=true){
    if(this.#activeId&&Boolean(this.#viewerCurrent?.())&&this.#editingId===this.#activeId){
      event.preventDefault();event.stopPropagation();
      if(this.#audioTrim){this.store.toast(this.#savingEdit?audioTrimCopy(this.i18n.locale).saving:audioTrimCopy(this.i18n.locale).finish);return false;}
      if(this.#videoTrim){this.store.toast(this.#savingEdit?videoTrimCopy(this.i18n.locale).saving:videoTrimCopy(this.i18n.locale).finish);return false;}
      if(this.#model3dScale){const copy=model3dScaleCopy(this.i18n.locale);this.store.toast(this.#savingEdit?copy.saving:`${copy.save} / ${copy.cancel}`);return false;}
      this.store.toast(this.#savingEdit
        ?this.i18n.t("artifact.delivery.savingCorrection")
        :this.i18n.t("artifact.delivery.finishCorrection","",{save:this.i18n.system("Save finished output"),cancel:this.i18n.system("Cancel")}));
      return false;
    }
    if(!exitFocus||!this.#viewerFocused)return true;
    event.preventDefault();event.stopPropagation();this.#setViewerFocus(false);return false;
  }
  async #showSlidesViewingDialog(dialog:HTMLDialogElement,current:()=>boolean,focus:ReturnType<typeof captureOutputNavigationFocus>){
    const owner=this.ownerDocument,route=this.store.route.get();
    const deck=dialog.querySelector("forma-presentation-deck");
    const owned=()=>Boolean(this.isConnected&&current()&&focus.current()&&owner.hasFocus()
      &&owner.visibilityState!=="hidden"&&this.store.route.get()===route&&this.#viewDialog()===dialog
      &&dialog.isConnected&&deck?.isConnected&&dialog.querySelector("forma-presentation-deck")===deck
      &&deck.closest("dialog")===dialog&&this.#editingId!==this.#activeId);
    try{
      if(!deck||!owned())return false;
      await deck.updateComplete;
      if(!owned()||dialog.open)return false;
      // Reuse the stable content target already used by Present slide. Unlike Next,
      // it stays focusable at either end of the deck and across reading posture changes.
      // List remains List: its first explicit Present slide action receives focus instead.
      const target=deck.querySelector<HTMLElement>(".presentation-deck-stage")
        ??deck.querySelector<HTMLElement>(".presentation-deck-list-header > button");
      if(!target||!target.isConnected||target.matches(":disabled"))return false;
      const prior=target.getAttribute("autofocus");
      target.setAttribute("autofocus","");
      try{
        return focus.run(target,()=>owned()&&ensureModalDialog(dialog)&&dialog.open
          &&dialog.matches(":modal")&&owner.activeElement===target&&target.getClientRects().length>0&&owned());
      }finally{
        if(prior===null)target.removeAttribute("autofocus");else target.setAttribute("autofocus",prior);
      }
    }catch{return false;}
  }
  async #showSlidesEvidence(artifact:DocumentArtifact){
    const viewer=this.#viewerCurrent,binding=this.#currentDeliveryBinding(artifact),route=this.store.route.get();
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    const current=()=>this.#viewerCurrent===viewer&&Boolean(viewer?.())&&this.store.route.get()===route
      &&this.#activeId===artifact.id&&this.#currentDeliveryBinding(artifact)===binding
      &&this.#editingId!==artifact.id&&!this.#savingEdit&&this.ownerDocument.hasFocus()&&focus.current();
    try{
      if(!current())return false;
      this.#closeViewerPopovers();this.#viewerFocused=false;this.requestUpdate();await this.updateComplete;
      if(!current())return false;
      const dialog=this.#viewDialog(),menu=dialog?.querySelector<FormaUiPopover>(".artifact-viewer-evidence-popover");
      if(!dialog?.open||!menu)return false;
      await menu.updateComplete;
      if(!current()||dialog!==this.#viewDialog()||!dialog.open||!menu.isConnected)return false;
      const trigger=menu.querySelector<HTMLButtonElement>(".ui-popover-trigger");
      const panel=menu.querySelector<HTMLElement>(".ui-popover-panel");
      const content=menu.querySelector<HTMLElement>(".artifact-viewer-details");
      if(!trigger||trigger.disabled||!panel||!content)return false;
      if(!panel.matches(":popover-open")){
        if(!current())return false;
        trigger.click();
        if(!current()||!panel.matches(":popover-open"))return false;
      }
      return focus.run(content,()=>{
        if(!current()||!panel.matches(":popover-open")||!content.isConnected)return false;
        content.focus({preventScroll:true});return this.ownerDocument.activeElement===content;
      });
    }catch{return false;}finally{focus.dispose();}
  }
  async #openArtifact(artifact:DocumentArtifact,required:(stage:CreativePreparationStage)=>boolean=()=>true,revision=documentArtifactRevision(this.store.events.get(),artifact.id),options:{expectedContentSha256?:string;intent?:ArtifactDeliveryIntent}={}){
    const slidesFocus=artifact.kind==="slides"&&!options.intent?captureOutputNavigationFocus(this.ownerDocument):null;
    const owner=this.ownerDocument,view=owner.defaultView,originalRequired=required;
    const departed=()=>slidesFocus?.dispose();
    const hidden=()=>{if(owner.visibilityState==="hidden")departed();};
    let openingOwner:(()=>boolean)|null=null;
    if(slidesFocus){
      view?.addEventListener("blur",departed);owner.addEventListener("visibilitychange",hidden);
      required=(stage)=>originalRequired(stage)&&(stage!=="opening"||owner.hasFocus()&&slidesFocus.current());
    }
    try{const nativeIntent=this.#nativeStoryIntentRevision;if(!required("opening")||nativeIntent!==this.#nativeStoryIntentRevision)return false;this.retireNativeShortStory();if(nativeIntent!==this.#nativeStoryIntentRevision)return false;const privateCurrent=this.#privateSourceCurrent(),sourceCurrent=()=>nativeIntent===this.#nativeStoryIntentRevision&&privateCurrent(),authorization=this.store.captureAuthorizationScope();let opening=true,retained:string|undefined=this.store.content.get()[artifact.contentRef??""],contentCaptured=retained!==undefined;const current=()=>sourceCurrent()&&this.#viewerCurrent===current&&Boolean(authorization&&this.store.authorizationScopeActive(authorization))&&required(opening?"opening":"editing")&&this.store.projection.get().libraryArtifacts.some((candidate)=>candidate.id===artifact.id&&candidate.documentId===artifact.documentId&&candidate.sequence===artifact.sequence&&candidate.sourceEventId===artifact.sourceEventId&&candidate.contentRef===artifact.contentRef)&&(!opening||documentArtifactRevision(this.store.events.get(),artifact.id)===revision&&(!contentCaptured||this.store.content.get()[artifact.contentRef??""]===retained));if(!sourceCurrent())return false;this.#viewerCloseGuard=null;this.#viewerCurrent=current;openingOwner=current;this.#viewerOpening=true;this.#deliveryBinding=null;this.#deliveryBindingLoading=null;this.#viewDialog()?.close();this.#activeId="";this.#viewerReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;if(artifact.contentRef&&!this.store.content.get()[artifact.contentRef])await this.store.ensurePrivateContent(artifact.contentRef);if(!current())return false;retained=this.store.content.get()[artifact.contentRef??""];contentCaptured=true;const binding=await this.#artifactBinding(artifact);if(!current()||options.expectedContentSha256&&binding?.content_sha256!==options.expectedContentSha256)return false;this.#deliveryBinding=binding&&retained!==undefined?{artifactId:artifact.id,revision:binding.artifact_revision,content:retained,contentSha256:binding.content_sha256,current}:null;this.#activeId=artifact.id;this.#viewerFocused=false;this.#reviewPanelOpen=false;this.#historyOpen=false;this.#historyBusy=false;this.#revisionHistory=[];this.#revisionBefore=null;this.#revisionPreview=null;this.#reviewers=[];this.#selectedReviewerId="";this.#reviewNote="";const context=this.store.session.get()?.projectContext;if(context&&context.permissions.includes("project.author")){try{const authorization=this.store.captureAuthorizationScope();const response=await fetch(`/api/workspaces/${encodeURIComponent(context.organizationId)}/projects/${encodeURIComponent(context.projectAccessId)}/members`,{credentials:"same-origin"});const body=await response.json() as {members?:Array<{user_id:string;display_name:string;review_access?:number|boolean}>};if(current()&&response.ok&&authorization&&this.store.authorizationScopeActive(authorization)&&this.#activeId===artifact.id){const history=this.store.events.get();const completed=history.find((event)=>event.eventId===artifact.sourceEventId);const rendered=[...history].reverse().find((event)=>event.type==="DocumentRenderRequested"&&String(event.payload.artifact_id??"")===artifact.id);const actorOf=(value:string)=>value.startsWith("user:")?value.slice(5):"";const contributors=history.filter((event)=>event.type==="DocumentArtifactEdited"&&String(event.payload.artifact_id??"")===artifact.id).flatMap((event)=>[actorOf(event.actor),String(event.payload.edited_by_user_id??"")]);const disqualified=new Set([this.store.session.get()?.user.userId??"",String(completed?.payload.requested_by_user_id??actorOf(rendered?.actor??"")),...contributors].filter(Boolean));this.#reviewers=(body.members??[]).filter((member)=>Boolean(member.review_access)&&!disqualified.has(member.user_id)).map((member)=>({userId:member.user_id,displayName:member.display_name}));this.#selectedReviewerId=this.#reviewers[0]?.userId??"";}}catch{/* The exact review request remains disabled until eligible reviewers can be verified. */}}if(!current())return false;this.requestUpdate();await this.updateComplete;if(!current())return false;const dialog=this.#viewDialog();if(!slidesFocus)this.#viewerOpening=false;if(dialog){dialog.setAttribute("aria-label",artifact.title);const closed=()=>{if(dialog.open)return;dialog.removeEventListener("close",closed);if(this.#viewerCurrent!==current||this.#viewerOpening)return;const owned=current(),registered=this.#viewerCloseGuard,closeGuard=registered?.viewer===current&&registered.dialog===dialog?registered:null;if(closeGuard)this.#viewerCloseGuard=null;this.#viewerCurrent=null;this.#reviewNote="";this.#viewerFocused=false;this.#reviewPanelOpen=false;const opener=this.#viewerReturnFocus;this.#viewerReturnFocus=undefined;if(!owned)return;if((!closeGuard||closeGuard.current())&&opener?.isConnected)opener.focus({preventScroll:true});this.dispatchEvent(new CustomEvent("document-artifact-close",{bubbles:true,composed:true,...(closeGuard?{detail:{preserveFocus:true}}:{})}));};dialog.addEventListener("close",closed);if(!dialog.open){
      if(slidesFocus){
        if(!await this.#showSlidesViewingDialog(dialog,current,slidesFocus)){
          dialog.removeEventListener("close",closed);
          if(this.#viewerCurrent===current&&this.#viewDialog()===dialog&&dialog.open)dialog.close();
          return false;
        }
      }else ensureModalDialog(dialog);
    }this.#viewerOpening=false;if(dialog.open){opening=false;retained=undefined;}}if(!this.store.session.get()?.projectContext&&this.store.ui.instrumentation)void this.store.hot({type:"DocumentArtifactViewed",payload:{artifact_id:artifact.id,artifact_kind:artifact.kind,document_id:artifact.documentId,source_surface:`${this.source}-artifact-gallery`}});if(dialog?.open&&options.intent)await this.#showArtifactIntent(artifact,options.intent);return Boolean(dialog?.open&&this.#viewerCurrent===current&&current());
    }finally{
      if(slidesFocus){
        slidesFocus.dispose();view?.removeEventListener("blur",departed);owner.removeEventListener("visibilitychange",hidden);
        if(openingOwner&&this.#viewerCurrent===openingOwner&&this.#viewerOpening){
          this.#viewerCurrent=null;this.#activeId="";this.#viewerOpening=false;this.#viewerReturnFocus=undefined;
          this.#deliveryBinding=null;this.#deliveryBindingLoading=null;this.requestUpdate();
        }
      }
    }
  }
  #model3dReferences(){return videoReferencePreflight(this.#projection().blocks,this.store.events.get()).items;}
  #model3dReferenceMime(item:VideoReferencePreflightItem){
    const ingestion=[...this.store.events.get()].reverse().find(event=>event.type==="ReferenceIngested"&&event.payload.reference_id===item.block.properties.reference_id);
    return String(item.block.properties.media_type??item.block.properties.source_mime_type??ingestion?.payload.media_type??ingestion?.payload.source_mime_type??"").toLowerCase().split(";")[0]!.trim();
  }
  #model3dReferenceSupported(item:VideoReferencePreflightItem){return(RODIN_IMAGE_MIME_TYPES as readonly string[]).includes(this.#model3dReferenceMime(item));}
  #model3dReferenceIssue(){
    const references=this.#model3dReferences();
    return this.#model3dReferenceBlockIds.some(id=>!references.some(item=>item.block.id===id&&item.sendsPixels&&item.rightsConfirmed&&this.#model3dReferenceSupported(item)));
  }
  #model3dAdaptation(){return this.store.documentModel3dAdaptation(this.#targetDocumentId(),this.#model3dReferenceBlockIds.length);}
  #model3dValidation(adaptation:Model3dDocumentAdaptation){return validateModel3dRequest({prompt:adaptation.prompt,settings:this.#model3dSettings,referenceCount:this.#model3dReferenceBlockIds.length});}
  #changeModel3dReference(id:string,selected:boolean){
    if(this.#submitting)return;
    if(selected){if(this.#model3dReferenceBlockIds.length>=RODIN_MAX_IMAGE_REFERENCES||this.#model3dReferenceBlockIds.includes(id))return;this.#model3dReferenceBlockIds=[...this.#model3dReferenceBlockIds,id];}
    else this.#model3dReferenceBlockIds=this.#model3dReferenceBlockIds.filter(value=>value!==id);
    this.#model3dDraftRevision++;this.#confirmed=false;this.requestUpdate();
  }
  #moveModel3dReference(id:string,offset:number){
    if(this.#submitting)return;
    const index=this.#model3dReferenceBlockIds.indexOf(id),target=index+offset;
    if(index<0||target<0||target>=this.#model3dReferenceBlockIds.length)return;
    const next=[...this.#model3dReferenceBlockIds];[next[index],next[target]]=[next[target]!,next[index]!];
    this.#model3dReferenceBlockIds=next;this.#model3dDraftRevision++;this.#confirmed=false;this.requestUpdate();
  }
  async #createModel3d(reviewed:Model3dDocumentAdaptation,reviewedRevision:string){
    const adaptation=this.#model3dAdaptation(),validation=this.#model3dValidation(adaptation),opening=this.#configurationCurrent;
    if(!reviewed.valid||this.store.documentGenerationRevision()!==reviewedRevision||JSON.stringify(reviewed)!==JSON.stringify(adaptation)){this.requestUpdate();return;}
    if(this.#submitting||this.#referenceBusy||this.#workflowBusy||!validation.valid||!adaptation.valid||this.#model3dReferenceIssue()
      ||!this.store.session.get()?.provider.model3dConfigured||!opening||!opening()||!this.#createDialog()?.open)return;
    const sourceCurrent=this.#privateSourceCurrent(),documentId=this.#targetDocumentId(),revision=this.#model3dDraftRevision;
    const prompt=reviewed.prompt,receipt=model3dAdaptationReceipt(reviewed),settings=structuredClone(this.#model3dSettings),referenceBlockIds=[...this.#model3dReferenceBlockIds];
    const reviewedIdentity=JSON.stringify(reviewed);
    const current=()=>sourceCurrent()&&this.isConnected&&this.#createOpen&&this.#kind==="model3d"&&this.#configurationCurrent===opening
      &&opening()&&this.#createDialog()?.open===true&&this.#targetDocumentId()===documentId&&this.#model3dDraftRevision===revision
      &&this.store.documentGenerationRevision()===reviewedRevision&&JSON.stringify(this.#model3dAdaptation())===reviewedIdentity;
    if(!current()||generationBudgetGate(this.store.session.get()?.costBudgets,{projectedMicrousd:validation.estimatedCostMicrousd}).level==="blocked")return;
    this.#submitting=true;this.#confirmed=true;this.requestUpdate();
    try{
      const ok=await this.store.renderDocumentArtifact("model3d",{documentId,locale:this.i18n.locale,model3dPrompt:prompt,model3dSettings:settings,
        model3dPromptSource:"document",model3dAdaptation:receipt,model3dReferenceBlockIds:referenceBlockIds,productionMode:"manual",paidMediaConfirmed:true,sourceSurface:this.source,current});
      if(!current())return;
      if(ok){this.#pendingWorkflowRegeneration=null;this.#activeWorkflowStageId="";this.#createOpen=false;this.#configurationCurrent=null;this.#createDialog()?.close();
        this.dispatchEvent(new CustomEvent("document-artifact-queued",{detail:{documentId,kind:"model3d"},bubbles:true,composed:true}));}
    }finally{this.#submitting=false;this.requestUpdate();}
  }
  #model3dReferencePicker(){
    const candidates=this.#model3dReferences(),selected=this.#model3dReferenceBlockIds;
    const ordered=selected.map(id=>({id,item:candidates.find(item=>item.block.id===id)}));
    return html`<section class="model3d-reference-picker" aria-label=${this.i18n.t("model3d.references.heading","3D reference images")}>
      <header><h3>${this.i18n.t("model3d.references.heading","3D reference images")}</h3><p>${this.i18n.t("model3d.references.help","Choose up to five views of the subject. The first selected image guides materials. Only the selected image pixels and the exact prompt above are sent.")}</p></header>
      <p role="status">${this.i18n.t("model3d.references.count","{count} of {maximum} images selected",{count:this.i18n.number(selected.length),maximum:this.i18n.number(RODIN_MAX_IMAGE_REFERENCES)})}</p>
      ${ordered.length?html`<ol class="model3d-reference-order">${ordered.map(({id,item},index)=>html`<li>
        ${item?html`<img src=${item.mediaUrl} alt="" loading="lazy"><span>${item.label}</span>`:html`<span>${this.i18n.t("model3d.references.missing","This selected image is no longer available.")}</span>`}
        <small>${index===0?this.i18n.t("model3d.references.material","Material reference"):this.i18n.t("model3d.references.view","Additional view")}</small>
        <div><button type="button" class="icon-button" ?disabled=${this.#submitting||index===0} aria-label=${this.i18n.t("model3d.references.earlier","Move reference earlier")} @click=${()=>this.#moveModel3dReference(id,-1)}>${icon("previous")}</button><button type="button" class="icon-button" ?disabled=${this.#submitting||index===ordered.length-1} aria-label=${this.i18n.t("model3d.references.later","Move reference later")} @click=${()=>this.#moveModel3dReference(id,1)}>${icon("next")}</button><button type="button" class="icon-button" ?disabled=${this.#submitting} aria-label=${this.i18n.t("model3d.references.remove","Remove selected reference")} @click=${()=>this.#changeModel3dReference(id,false)}>${icon("close")}</button></div>
      </li>`)}</ol>`:html`<p>${this.i18n.t("model3d.references.textOnly","No images selected: create a model from the exact prompt.")}</p>`}
      ${candidates.length?html`<details><summary>${this.i18n.t("model3d.references.choose","Choose document images")}</summary><ul class="model3d-reference-candidates">${candidates.map(item=>{const checked=selected.includes(item.block.id),formatSupported=this.#model3dReferenceSupported(item),eligible=item.sendsPixels&&item.rightsConfirmed&&formatSupported;return html`<li><label><input type="checkbox" .checked=${checked} ?disabled=${this.#submitting||!checked&&(!eligible||selected.length>=RODIN_MAX_IMAGE_REFERENCES)} @change=${(event:Event)=>this.#changeModel3dReference(item.block.id,(event.currentTarget as HTMLInputElement).checked)}><img src=${item.mediaUrl} alt="" loading="lazy"><span>${item.label}${!eligible?html`<small>${formatSupported?this.i18n.t("model3d.references.authorization","Enable image pixels and confirm usable rights in this context block before selecting it."):this.i18n.t("model3d.references.format","Use a JPG, PNG, or WebP reference. Replace or re-upload this image before selecting it.")}</small>`:nothing}</span></label></li>`;})}</ul></details>`:html`<p>${this.i18n.t("model3d.references.empty","Add an image reference or save a 3D model view in the document to guide this generation with images.")}</p>`}
      ${this.#model3dReferenceIssue()?html`<p role="alert">${this.i18n.t("model3d.references.changed","A selected image is unavailable or its pixel permission or rights changed. Remove it or update the context block before generating.")}</p>`:nothing}
    </section>`;
  }
  async #create(model3dAdaptation?:Model3dDocumentAdaptation,model3dDocumentRevision=""){
    if(this.#kind==="scene"||this.#requestReviewLoading)return;
    if(this.#kind==="model3d"){if(model3dAdaptation)await this.#createModel3d(model3dAdaptation,model3dDocumentRevision);return;}
    const guidance=documentRenderGuidance({audience:this.#audience,tone:this.#tone});
    if(guidance.issues.length){this.requestUpdate();await this.updateComplete;this.#createDialog()?.querySelector<HTMLInputElement>(`[name="${guidance.issues[0]!.field}"]`)?.focus();return;}
    if(this.#submitting||this.#referenceBusy||this.#workflowBusy||this.#kind==="slides"&&this.#productionMode==="managed"&&this.#invalidSlideCount||this.#kind==="audio"&&this.#invalidAudioDuration)return;
    if(this.#kind==="slides"){
      const sourceIssues=buildPresentationSourceContract(this.#presentationPlanningSnapshot(),{requestedSlideCount:this.#itemCount}).sourceIssues??[];
      if(sourceIssues.length){this.store.toast(formatPresentationSourceIssues(sourceIssues,this.i18n));return;}
    }
    if(this.#kind==="slides"&&minimumPresentationSlideCount(this.#presentationPlanningSnapshot())>MAX_MANAGED_PRESENTATION_SLIDES){this.store.toast(this.i18n.system("The authored presentation exceeds the {maximum}-slide editable PowerPoint limit. No generation was started.",{maximum:this.i18n.number(MAX_MANAGED_PRESENTATION_SLIDES)}));return;}
    if(this.#kind==="slides"&&minimumPresentationSlideCount(this.#presentationPlanningSnapshot())>this.#itemCount){this.store.toast(this.i18n.t("presentation.planning.countConflict","Choose the complete authored slide count before generating this presentation."));return;}
    const paid=this.#kind==="storyboard"||this.#kind==="video"||this.#kind==="audio";if(paid)this.#confirmed=true;
    if(this.#kind==="audio"&&!this.store.session.get()?.provider.audioConfigured){this.store.toast(this.i18n.t("audio.generation.unavailable","Audio generation is unavailable. Contact your workspace administrator."));return;}
    if(this.#kind==="audio"&&(this.#audioGoal==="video_music"||this.#audioGoal==="video_sound_effects")&&(!this.#eligibleAudioVideos().some((artifact)=>artifact.id===this.#audioVideoArtifactId)||!this.#sendAudioVideoToProvider)){
      this.store.toast(this.i18n.t("audio.settings.videoPermission","I authorize sending this approved video to the audio provider"));return;
    }
    if(this.#kind==="video"){
      if(!this.store.session.get()?.provider.videoConfigured){this.store.toast("Fal video generation is not configured in this environment.");return;}
      const references=videoReferencePreflight(this.#projection().blocks,this.store.events.get());
      if(references.rightsBlockedCount||references.unavailablePixelCount||this.#productionMode!=="managed"&&references.providerLimitExceededCount){this.store.toast(references.rightsBlockedCount?"Confirm usable rights for every pixel-backed reference before starting this video render.":references.unavailablePixelCount?"Replace or re-upload each unavailable pixel-backed reference before starting this video render.":this.i18n.system("Choose at most {maximum} pixel-backed references; keep the others description-only.",{maximum:this.i18n.number(references.providerReferenceLimit)}));return;}
    }
    this.#submitting=true;this.requestUpdate();
    const workflow=this.#activeWorkflowStageId?this.#currentWorkflow():null;const workflowStage=workflow?.stages.find((stage)=>stage.id===this.#activeWorkflowStageId&&stage.format===this.#kind);if(this.#activeWorkflowStageId&&!workflowStage){this.#submitting=false;this.requestUpdate();return;}const states=workflow?productionWorkflowStageStates(workflow,this.#projection(),this.store.events.get(),this.#runningWorkflowStages(workflow)):[];const workflowOptions=workflow&&workflowStage?{workflowId:workflow.id,workflowStageId:workflowStage.id,workflowSources:productionWorkflowSourcesForStage(workflow,workflowStage.id,states),sourceSurface:`workflow:${workflow.id}:${workflowStage.id}`}:{sourceSurface:this.source};
    const audience=this.#audience.trim(),tone=this.#tone.trim(),authoredSlideCount=this.#kind==="slides"?this.#presentationOutline().authoredSlideCount:null;
    const audioProfile=this.#kind==="audio"?this.#audioRequestProfile():null;
    const audioSelection=audioProfile?this.#selectedAudioAdapter(audioProfile):null;
    const ok=await this.store.renderDocumentArtifact(this.#kind,{documentId:this.#targetDocumentId(),locale:this.i18n.locale,itemCount:this.#kind==="slides"||this.#productionMode==="manual"&&this.#kind==="storyboard"?this.#itemCount:undefined,...(this.#kind==="slides"?{requestedSlideCount:this.#itemCount,...(authoredSlideCount===null?{}:{authoredSlideCount}),...(this.#presentationStyle==="document"?{}:{presentationStyle:this.#presentationStyle}),presentationFidelity:this.#presentationFidelity}:{}),audience:audience||undefined,tone:tone||undefined,videoSeconds:this.#kind==="video"&&this.#productionMode==="manual"?this.#seconds:undefined,videoSize:this.#kind==="video"?this.#videoSize:undefined,...(this.#kind==="video"&&this.#productionMode==="manual"&&this.#restoredVideoResolution!==undefined?{videoResolution:this.#restoredVideoResolution}:{}),videoAudioMode:this.#kind==="video"?this.#videoAudioMode:undefined,soundtrackBlockIds:this.#soundtrackBlockIds,sendSoundtrackToVideoProvider:this.#kind==="video"&&this.#sendSoundtrackToVideoProvider,audioImageBlockId:this.#kind==="audio"?this.#audioImageBlockId||undefined:undefined,...(audioProfile&&audioSelection?{audioProfile,audioProviderModel:audioSelection.contract.model,...(this.#audioVideoArtifactId?{audioVideoArtifactId:this.#audioVideoArtifactId}:{}),...(this.#sendAudioVideoToProvider?{sendAudioVideoToProvider:true}:{})}:{}),productionMode:this.#productionMode,paidMediaConfirmed:paid&&this.#confirmed,...workflowOptions});
    this.#submitting=false;if(ok){this.#pendingWorkflowRegeneration=null;if(audience)this.#rememberedAudiences.add(audience);if(tone)this.#rememberedTones.add(tone);this.#activeWorkflowStageId="";this.#createOpen=false;this.#createDialog()?.close();this.dispatchEvent(new CustomEvent("document-artifact-queued",{detail:{documentId:this.#targetDocumentId(),kind:this.#kind},bubbles:true,composed:true}));}else if(!this.#createOpen)void this.#restoreWorkflowRegeneration();this.requestUpdate();
  }
  async #stop(jobId:string){await this.store.stopDocumentJob(jobId);this.requestUpdate();}
  async #recover(jobId:string){await this.store.recoverDocumentRender(jobId);this.requestUpdate();}
  async #recoverPresentation(jobId:string){await this.store.recoverDocumentPresentation(jobId);this.requestUpdate();}
  async #reconcileProviderReceipt(jobId:string){if(this.#reconcilingProviderJobId)return;this.#reconcilingProviderJobId=jobId;this.requestUpdate();try{await this.store.reconcileDocumentProviderReceipt(jobId);}finally{this.#reconcilingProviderJobId="";this.requestUpdate();}}
  async #checkSavedPresentationReceipt(job:DocumentJob){
    if(this.#presentationReceiptCheck?.status==="checking"&&this.#presentationReceiptCheck.current())return;
    const sourceCurrent=this.#privateSourceCurrent(),authorization=this.store.captureAuthorizationScope(),route=this.store.route.get(),documentId=job.documentId;
    const state={jobId:job.jobId,status:"checking" as PresentationReceiptCheckStatus|"checking",current:()=>this.#presentationReceiptCheck===state&&sourceCurrent()
      &&this.store.authorizationScopeActive(authorization)&&this.store.route.get()===route&&this.#targetDocumentId()===documentId};
    this.#presentationReceiptCheck=state;
    if(!state.current()||!documentJobCanCheckSavedPresentationReceipt(job)){this.#presentationReceiptCheck=null;return;}
    this.requestUpdate();
    try{const status=await this.store.checkSavedPresentationReceipt(job.jobId,{current:state.current});if(state.current())state.status=status??"unavailable";}
    catch{if(state.current())state.status="unavailable";}
    finally{if(this.#presentationReceiptCheck===state){if(!state.current())this.#presentationReceiptCheck=null;this.requestUpdate();}}
  }
  async #prepareRetry(kind:DocumentArtifactKind,job?:DocumentJob){
    if(!job)return this.openRender(kind,this.#targetDocumentId());
    this.#retireRequestReview();
    const epoch=this.#requestReviewEpoch,sourceCurrent=this.#privateSourceCurrent(),authorization=this.store.captureAuthorizationScope();
    if(!authorization||job.documentId!==this.#targetDocumentId()||job.result?.artifactKind!==kind)return;
    const required=retainCreativePreparation(()=>nextActionFacts(this.store,job.documentId,this.source==="canvas"?this.store.canvasProjection.get().selectedCanvasId:null),()=>this.#requestReviewEpoch===epoch&&sourceCurrent()&&this.store.authorizationScopeActive(authorization)&&this.#targetDocumentId()===job.documentId);
    if(!required())return;
    this.#requestReviewLoading=true;this.requestUpdate();
    try{
      let detail:DocumentJob,content:Record<string,string>;
      if(authorization.shared){const inspected=await this.store.loadActorDocumentGenerationReceipt(job.jobId);if(!required())return;detail=inspected.job;content=inspected.content;}
      else{detail=await this.store.loadDocumentJobDetail(job.jobId);if(!required())return;content=this.store.content.get();}
      if(detail.jobId!==job.jobId||detail.documentId!==job.documentId||detail.requestedAt!==job.requestedAt||detail.requestKey!==job.requestKey)throw new Error("request_settings_unavailable");
      const restored=restoreDocumentRenderSettings(detail,content);
      if(!restored||restored.kind!==kind)throw new Error("request_settings_unavailable");
      this.#activeWorkflowStageId="";
      if(job.sourceSurface.startsWith("workflow:")){
        const [,workflowId,...parts]=job.sourceSurface.split(":"),stageId=parts.join(":"),projection=this.#projection();
        const workflow=productionWorkflows(this.store.events.get(),job.documentId,projection.projectId).find(candidate=>candidate.id===workflowId);
        const stage=workflow?.stages.find(candidate=>candidate.id===stageId&&candidate.enabled&&candidate.format===kind);
        const state=workflow&&stage?productionWorkflowStageStates(workflow,projection,this.store.events.get(),this.#runningWorkflowStages(workflow)).find(candidate=>candidate.stage.id===stageId):null;
        if(!workflow||!stage||!state||!["missing","ready"].includes(state.status))throw new Error("request_settings_unavailable");
        this.#activeWorkflowId=workflow.id;this.#activeWorkflowStageId=stage.id;this.#workflowTarget=workflow.target;this.#workflowTargetSelected=true;this.#workflowExpanded=true;
      }
      this.#selectArtifactKind(kind);
      await this.#revealWorkbenchPane();if(!required())return;
      const opened=await this.#openCreate(false,required);if(!opened||!required())return;
      this.#applyRestoredRequest(restored);this.#restoredRequest={jobId:job.jobId,needsTransferConfirmation:restored.needsTransferConfirmation};
    }catch{
      if(required())this.store.toast(this.i18n.system("The original request settings are unavailable. Inspect its retained inputs before configuring a new request."));
    }finally{if(this.#requestReviewEpoch===epoch){this.#requestReviewLoading=false;this.requestUpdate();}}
  }
  async #dismissFailure(jobId:string,event:Event){
    const trigger=event.currentTarget as HTMLElement;
    const cards=Array.from(this.querySelectorAll<HTMLElement>(".document-artifact-failure-card"));
    const index=cards.findIndex((card)=>card.contains(trigger));
    if(!await this.store.dismissDocumentJobFailure(jobId))return;
    await this.updateComplete;
    const remaining=Array.from(this.querySelectorAll<HTMLElement>(".document-artifact-failure-card"));
    const next=remaining[Math.min(Math.max(index,0),remaining.length-1)];
    (next?.querySelector<HTMLElement>(".document-artifact-failure-actions > .button")??this.querySelector<HTMLElement>(".document-artifacts > header > button"))?.focus({preventScroll:true});
  }
  async #inspectFailedInputs(job:DocumentJob,required?:()=>boolean){
    const nativeIntent=this.#nativeStoryIntentRevision,privateCurrent=this.#privateSourceCurrent(),sourceCurrent=()=>nativeIntent===this.#nativeStoryIntentRevision&&privateCurrent(),authorization=this.store.captureAuthorizationScope();if(!sourceCurrent()||!authorization||required&&!required()||nativeIntent!==this.#nativeStoryIntentRevision)return;
    if(!required)this.#sceneInputCurrent=null;
    const current=()=>sourceCurrent()&&this.store.authorizationScopeActive(authorization)&&(required?required():!this.#sceneInputCurrent&&this.#failedInputJob?.jobId===job.jobId);
    this.#actorInputContent={};this.#runningInputJob=null;this.#failedInputJob=required?null:job;this.requestUpdate();
    try{
      let detail:DocumentJob,content:Record<string,string>={};
      if(required&&job.result?.artifactKind==="scene"){
        const options={documentId:job.documentId,fresh:true as const,current};
        const inspected=authorization.shared?await this.store.loadActorDocumentGenerationReceipt(job.jobId,options):await this.store.loadDocumentJobDetail(job.jobId,options);
        if(!current())return;detail=inspected.job;content=inspected.content;
      }else if(authorization.shared){const inspected=await this.store.loadActorDocumentGenerationReceipt(job.jobId);if(!current())return;detail=inspected.job;content=inspected.content;}
      else{
        detail=await this.store.loadDocumentJobDetail(job.jobId);if(!current())return;
        if(required&&(detail.jobId!==job.jobId||detail.documentId!==job.documentId))throw new Error("scene_cost_unavailable");
        if(detail.moderationPromptRef&&!this.store.content.get()[detail.moderationPromptRef]){await this.store.ensurePrivateContent(detail.moderationPromptRef);if(!current())return;}
      }
      if(!current())return;
      if(required&&(detail.jobId!==job.jobId||detail.documentId!==job.documentId))throw new Error("scene_cost_unavailable");
      if(required&&!authorization.shared&&job.result?.artifactKind!=="scene")content={...this.store.content.get()};
      this.#actorInputContent=content;this.#failedInputJob=detail;this.requestUpdate();
    }catch(error){
      if(current()){
        if(required){this.#sceneInputCurrent=null;this.#failedInputJob=null;this.#actorInputContent={};this.requestUpdate();}
        this.store.toast(required?job.result?.artifactKind==="scene"?this.i18n.t("scene.cost.unavailable","The exact Scene request could not be verified. Check its original status before approving paid work."):"The retained generation inputs could not be loaded.":error instanceof Error?error.message:"The retained generation inputs could not be loaded.");
      }
    }
  }
  async #inspectRunningInputs(job:DocumentJob,required?:()=>boolean){
    const nativeIntent=this.#nativeStoryIntentRevision,privateCurrent=this.#privateSourceCurrent(),sourceCurrent=()=>nativeIntent===this.#nativeStoryIntentRevision&&privateCurrent(),authorization=this.store.captureAuthorizationScope();if(!sourceCurrent()||!authorization||required&&!required()||nativeIntent!==this.#nativeStoryIntentRevision)return;
    if(!required)this.#sceneInputCurrent=null;
    const current=()=>sourceCurrent()&&this.store.authorizationScopeActive(authorization)&&(required?required():!this.#sceneInputCurrent&&this.#runningInputJob?.jobId===job.jobId);
    this.#actorInputContent={};this.#failedInputJob=null;this.#runningInputJob=required?null:job;this.requestUpdate();
    try{
      let detail:DocumentJob,content:Record<string,string>={};
      if(required&&job.result?.artifactKind==="scene"){
        const options={documentId:job.documentId,fresh:true as const,current};
        const inspected=authorization.shared?await this.store.loadActorDocumentGenerationReceipt(job.jobId,options):await this.store.loadDocumentJobDetail(job.jobId,options);
        if(!current())return;detail=inspected.job;content=inspected.content;
      }else if(authorization.shared){const inspected=await this.store.loadActorDocumentGenerationReceipt(job.jobId);if(!current())return;detail=inspected.job;content=inspected.content;}
      else detail=await this.store.loadDocumentJobDetail(job.jobId);
      if(!current())return;
      if(required&&(detail.jobId!==job.jobId||detail.documentId!==job.documentId))throw new Error("scene_cost_unavailable");
      if(required&&!authorization.shared&&job.result?.artifactKind!=="scene")content={...this.store.content.get()};
      this.#actorInputContent=content;this.#runningInputJob=detail;this.requestUpdate();
    }catch(error){
      if(current()){
        if(required){this.#sceneInputCurrent=null;this.#runningInputJob=null;this.#actorInputContent={};this.requestUpdate();}
        this.store.toast(required?job.result?.artifactKind==="scene"?this.i18n.t("scene.cost.unavailable","The exact Scene request could not be verified. Check its original status before approving paid work."):"The in-progress generation receipt could not be loaded.":error instanceof Error?error.message:"The in-progress generation receipt could not be loaded.");
      }
    }
  }
  #content(artifact:DocumentArtifact){return parseDocumentArtifactContent(this.store.content.get()[artifact.contentRef??""]);}
  #createdAt(artifact:DocumentArtifact){const events=this.store.events.get();return(events.find((event)=>event.eventId===artifact.sourceEventId)??events.find((event)=>event.sequence===artifact.sequence))?.occurredAt??"";}
  #createdTime(artifact:DocumentArtifact){const value=this.#createdAt(artifact),date=new Date(value);if(!value||!Number.isFinite(date.getTime()))return nothing;return html`<time class="document-artifact-created" datetime=${value}>${this.i18n.system("Created")} ${this.i18n.date(date,{dateStyle:"medium",timeStyle:"short"})}</time>`;}
  #items(artifact:DocumentArtifact){const content=this.#content(artifact);return artifact.items.map((receipt,index)=>({...receipt,...(content?.items[index]?{body:content.items[index].body,notes:content.items[index].notes,imagePrompt:content.items[index].image_prompt,title:content.items[index].title,contextGroupIds:content.items[index].context_group_ids??receipt.contextGroupIds??[],slide:content.items[index].slide??receipt.slide}:{})}));}
  #slide(item:DocumentArtifactDraftItem,presentation:DocumentArtifact["presentation"],index:number,total:number,compact=false){return html`<forma-presentation-slide .item=${item} .presentation=${presentation} .index=${index} .total=${total} .compact=${compact} .showFooterLabel=${readSlideFooterLabelPreference()}></forma-presentation-slide>`;}
  #image(item:DocumentArtifactItem){if(!item.mediaUrl)return nothing;return html`<img src=${item.mediaUrl} alt=${item.title} loading="lazy" decoding="async" style=${focalPointCss(item.focalPoint)} @load=${(event:Event)=>{positionImageAtFocalPoint(event.currentTarget as HTMLImageElement,item.focalPoint);if(!item.focalPoint&&!this.store.session.get()?.projectContext)void this.store.calculateImageFocalPoint({targetKind:"artifact",targetId:item.id,mediaUrl:item.mediaUrl!});}}>`;}
  async #artifactBinding(artifact:DocumentArtifact){
    const sourceCurrent=this.#privateSourceCurrent(),retained=this.store.content.get()[artifact.contentRef??""],authorization=this.store.captureAuthorizationScope();
    if(!sourceCurrent()||!retained||!authorization)return null;
    const revision=documentArtifactRevision(this.store.events.get(),artifact.id);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(retained))),(byte)=>byte.toString(16).padStart(2,"0")).join("");
    if(!sourceCurrent()||!this.store.authorizationScopeActive(authorization)||retained!==this.store.content.get()[artifact.contentRef??""]
      ||revision!==documentArtifactRevision(this.store.events.get(),artifact.id)
      ||!this.store.projection.get().libraryArtifacts.some(candidate=>candidate.id===artifact.id&&candidate.documentId===artifact.documentId&&candidate.contentRef===artifact.contentRef))return null;
    return{artifact_revision:revision,content_sha256:digest};
  }
  async #download(artifact:DocumentArtifact){const content=this.#content(artifact),authorization=this.store.captureAuthorizationScope();if(!content||!authorization)return;const binding=await this.#artifactBinding(artifact);if(authorization.shared&&!binding)return;const blob=new Blob([content.content_markdown],{type:"text/markdown;charset=utf-8"});const receipt={type:"DocumentArtifactExported",payload:{artifact_id:artifact.id,artifact_kind:artifact.kind,document_id:artifact.documentId,format:"markdown",...(binding??{}),source_surface:`${this.source}-artifact-viewer`}};if(!await this.store.authorizeProjectExport(receipt,authorization))return;if(!this.store.authorizationScopeActive(authorization))return;const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`${(artifact.title||this.i18n.system(documentArtifactDefinition(artifact.kind).label)).normalize("NFKC").toLocaleLowerCase(this.i18n.locale).replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-|-$/g,"")||"forma"}.md`;try{document.body.append(link);link.click();}finally{link.remove();const downloadUrl=link.href;window.setTimeout(()=>URL.revokeObjectURL(downloadUrl),60_000);}}
  async #downloadWord(artifact:DocumentArtifact){
    const content=this.#content(artifact),authorization=this.store.captureAuthorizationScope();if(!content||!authorization)return;
    const retained=this.store.content.get()[artifact.contentRef??""];if(!retained)return;
    const revision=this.store.events.get().filter((event)=>event.type==="DocumentArtifactEdited"&&String(event.payload.artifact_id??"")===artifact.id).length;
    try{
      const{createWordDocument,WORD_DOCUMENT_MIME}=await import("../model/office-documents");
      if(!this.store.authorizationScopeActive(authorization))return;
      const structured=content.items.length>1||["slides","storyboard","video"].includes(artifact.kind)?`\n\n${content.items.map((item,index)=>`## ${this.i18n.system(artifact.kind==="slides"?"Slide":artifact.kind==="storyboard"?"Frame":artifact.kind==="video"?"Scene":"Part")} ${this.i18n.number(index+1)}: ${item.title}\n\n${item.body}${item.notes?`\n\n${this.i18n.system("Notes")}: ${item.notes}`:""}`).join("\n\n")}`:"";
      const bytes=createWordDocument(content.content_markdown+structured,{title:artifact.title,language:this.i18n.locale,direction:this.i18n.direction,translate:(source)=>this.i18n.system(source)});
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(retained))),(byte)=>byte.toString(16).padStart(2,"0")).join("");
      if(!this.store.authorizationScopeActive(authorization))return;
      const receipt={type:"DocumentArtifactExported",payload:{artifact_id:artifact.id,artifact_kind:artifact.kind,document_id:artifact.documentId,format:WORD_DOCUMENT_MIME,artifact_revision:revision,content_sha256:digest,source_surface:`${this.source}-artifact-viewer`}};
      if(!await this.store.authorizeProjectExport(receipt,authorization))return;
      if(!this.store.authorizationScopeActive(authorization))return;
      const blob=new Blob([Uint8Array.from(bytes).buffer],{type:WORD_DOCUMENT_MIME}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`${(artifact.title||this.i18n.system(documentArtifactDefinition(artifact.kind).label)).normalize("NFKC").toLocaleLowerCase(this.i18n.locale).replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-|-$/g,"")||"forma"}.docx`;document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1_000);
    }catch(error){this.store.toast(error instanceof Error&&/office_archive/.test(error.message)?"The finished output is too large for a complete editable Word document. Nothing was released.":"The editable Word document could not be prepared. Nothing was released.");}
  }
  async #downloadMedia(artifact:DocumentArtifact){const authorization=this.store.captureAuthorizationScope();if(!artifact.mediaUrl||!authorization)return;const binding=await this.#artifactBinding(artifact);if(authorization.shared&&!binding)return;const receipt={type:"DocumentArtifactExported",payload:{artifact_id:artifact.id,artifact_kind:artifact.kind,document_id:artifact.documentId,format:artifact.mediaType??"application/octet-stream",...(binding??{}),source_surface:`${this.source}-artifact-viewer`}};if(!await this.store.authorizeProjectExport(receipt,authorization))return;if(!this.store.authorizationScopeActive(authorization))return;const link=document.createElement("a");link.href=artifact.mediaUrl;const mediaType=String(artifact.mediaType??"").toLowerCase(),extension=mediaType==="video/mp4"?"mp4":mediaType==="video/webm"?"webm":audioFileExtension(mediaType);link.download=extension?`${artifact.title}.${extension}`:artifact.title;document.body.append(link);link.click();link.remove();}
  async #downloadModel3dFile(artifact:DocumentArtifact,file:Model3dArtifactFile){
    const authorization=this.store.captureAuthorizationScope(),viewer=this.#viewerCurrent,sourceCurrent=this.#privateSourceCurrent();
    const fileIdentity=JSON.stringify(file),revision=documentArtifactRevision(this.store.events.get(),artifact.id);
    const current=()=>Boolean(authorization&&this.store.authorizationScopeActive(authorization)&&sourceCurrent()&&viewer&&viewer()
      &&this.#viewerCurrent===viewer&&this.#activeId===artifact.id&&revision===documentArtifactRevision(this.store.events.get(),artifact.id)
      &&model3dArtifactFiles(this.store.projection.get().libraryArtifacts.find(value=>value.id===artifact.id)??artifact).some(value=>JSON.stringify(value)===fileIdentity));
    if(!authorization||!current())return;
    const binding=await this.#artifactBinding(artifact);
    if(!binding||!current()||!artifactDeliveryFor(this.store,artifact,binding.content_sha256).releaseAllowed)return;
    const receipt={type:"DocumentArtifactExported",payload:{artifact_id:artifact.id,artifact_kind:artifact.kind,document_id:artifact.documentId,
      format:file.mimeType,destination_kind:file.role,media_url:file.url,media_sha256:file.sha256,...binding,source_surface:`${this.source}-model3d-viewer`}};
    if(!await this.store.authorizeProjectExport(receipt,authorization)||!current()||!artifactDeliveryFor(this.store,artifact,binding.content_sha256).releaseAllowed)return;
    const link=document.createElement("a");link.href=file.url;link.download=file.fileName;document.body.append(link);link.click();link.remove();
  }
  #model3dOutput(artifact:DocumentArtifact,releaseAllowed:boolean,disabledExportTitle:string){
    const files=model3dArtifactFiles(artifact),preview=model3dPreviewFile(artifact),reuse=model3dArtifactContextReadiness(artifact);
    const unsupportedPreview=files.some(file=>file.role==="mesh"&&file.format==="glb"&&file.previewSupported===false);
    const scaleCopy=model3dScaleCopy(this.i18n.locale),edited=Boolean(this.#content(artifact)?.model3d_revision);
    return html`<section class="artifact-model3d-result">
      ${this.#model3dScaleNotice?.artifactId===artifact.id&&this.#model3dScaleNotice.current()?html`<p class="artifact-model3d-scale-status" role="status">${scaleCopy.status[this.#model3dScaleNotice.code]}</p>`:nothing}
      ${preview?html`<forma-model3d-viewer .src=${preview.url} .expectedSha256=${preview.sha256} .readonly=${true}></forma-model3d-viewer>`:html`<div class="model3d-preview-unavailable" role="status">${icon("layers")}<p>${unsupportedPreview?this.i18n.t("model3d.output.previewUnsupported","This model is available as an original download. Its mesh features or size exceed the interactive viewer’s current support."):this.i18n.t("model3d.output.previewUnavailable","Interactive preview requires a self-contained GLB. The returned files remain available in their original formats below.")}</p></div>`}
      ${preview?html`<p>${this.i18n.t("model3d.output.viewHelp","Rotate the preview to inspect the result. To guide another generation, use the original model as context and save the image view you want to send.")}</p>`:nothing}
      ${!reuse.supported?html`<p role="status">${unsupportedPreview?this.i18n.t("model3d.output.reuseUnsupported","To reuse this output as a reference, simplify or convert it to a self-contained GLB supported by the viewer, then upload it."):this.i18n.t("model3d.output.reuseUnavailable","To reuse this output as context, download and upload a self-contained GLB model with its textures embedded.")}</p>`:nothing}
      <section id=${`artifact-model3d-files-${artifact.id}`} class="model3d-output-files" aria-label=${this.i18n.t("model3d.output.files","Returned model files and textures")}><h3>${this.i18n.t("model3d.output.files","Returned model files and textures")}</h3>
        <p>${edited?scaleCopy.currentFileNotes:this.i18n.t("model3d.output.filesHelp","Each download preserves the provider’s returned format. Meshes that use separate textures need their companion files.")}</p>
        ${files.length?html`<ul>${files.map(file=>html`<li><div><b dir="auto">${file.fileName}</b><small>${file.role==="mesh"?this.i18n.t("model3d.output.mesh","Mesh"):file.role==="texture"?this.i18n.t("model3d.output.texture","Texture"):this.i18n.t("model3d.output.preview","Preview")} · ${file.format?.toUpperCase()??file.mimeType}${file.fileSize===null?"":` · ${this.i18n.number(file.fileSize/1_000_000,{maximumFractionDigits:2})} MB`}</small></div><button type="button" class="button secondary compact artifact-export-choice" data-artifact-export ?disabled=${!releaseAllowed} title=${releaseAllowed?file.fileName:disabledExportTitle} @click=${()=>void this.#downloadModel3dFile(artifact,file)}>${icon("download")}${this.i18n.t("model3d.output.download","Download {format}",{format:file.format?.toUpperCase()??file.mimeType})}</button></li>`)}</ul>`:html`<p role="status">${this.i18n.t("model3d.output.filesUnavailable","The retained model files are unavailable. Inspect the original generation receipt before requesting another paid generation.")}</p>`}
      </section>
    </section>`;
  }
  async #downloadSoundtrack(artifact:DocumentArtifact,asset:SoundtrackAsset){const authorization=this.store.captureAuthorizationScope(),url=String(asset.media_url??"");if(!authorization||!url.startsWith("/api/media/"))return;const binding=await this.#artifactBinding(artifact);if(authorization.shared&&!binding)return;const receipt={type:"DocumentArtifactExported",payload:{artifact_id:artifact.id,artifact_kind:artifact.kind,document_id:artifact.documentId,format:String(asset.media_type??"audio/mpeg"),destination_kind:"soundtrack-companion",...(binding??{}),source_surface:`${this.source}-soundtrack-companion`}};if(!await this.store.authorizeProjectExport(receipt,authorization)||!this.store.authorizationScopeActive(authorization))return;const extension=audioFileExtension(String(asset.media_type??""))??"mp3",link=document.createElement("a");link.href=url;link.download=`${asset.label??artifact.title}.${extension}`;document.body.append(link);link.click();link.remove();}
  async #downloadMediaArchive(artifact:DocumentArtifact){
    const authorization=this.store.captureAuthorizationScope(),retained=this.store.content.get()[artifact.contentRef??""],content=this.#content(artifact);
    if(!authorization||!retained||!content)return;
    try{
      const binding=await this.#artifactBinding(artifact);
      if(!binding||!this.store.authorizationScopeActive(authorization))return;
      const video=artifact.kind==="video";
      const items=this.#items(artifact).map((item,index)=>({item,index})).sort((left,right)=>(left.item.narrativeOrder??left.index+1)-(right.item.narrativeOrder??right.index+1)||left.index-right.index);
      if(!items.length||items.length!==content.items.length||items.length!==artifact.itemCount||video&&items.length<2)throw new Error("incomplete_media_archive");
      const extensions:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif","image/avif":"avif","video/mp4":"mp4","video/webm":"webm"};
      const files:Array<{name:string;content:string|Uint8Array}>=[],manifest:Array<Record<string,unknown>>=[],soundtrackManifest:Array<Record<string,unknown>>=[];
      let totalBytes=0;
      for(const [index,{item}] of items.entries()){
        const mime=String(item.mediaType??"").toLowerCase(),extension=extensions[mime],url=String(item.mediaUrl??"");
        if(!extension||!mime.startsWith(video?"video/":"image/")||!/^\/api\/media\/[A-Za-z0-9._~%+-]+$/u.test(url))throw new Error("incomplete_media_archive");
        const response=await this.store.guardedFetch(url,{credentials:"same-origin"},"export approved media");
        if(!this.store.authorizationScopeActive(authorization))return;
        const actualMime=String(response.headers.get("content-type")??"").split(";")[0]!.trim().toLowerCase();
        if(!response.ok||actualMime!==mime)throw new Error("incomplete_media_archive");
        const bytes=new Uint8Array(await response.arrayBuffer());
        if(!this.store.authorizationScopeActive(authorization))return;
        totalBytes+=bytes.byteLength;
        if(bytes.byteLength>24_000_000||totalBytes>90_000_000)throw new Error("office_archive_too_large");
        const ordinal=String(index+1).padStart(3,"0"),filename=video?`scenes/scene-${ordinal}.${extension}`:`frames/frame-${ordinal}.${extension}`;
        files.push({name:filename,content:bytes});
        manifest.push({position:index+1,title:item.title,description:item.body,notes:item.notes,file:filename,mimeType:mime,...(item.durationSeconds?{durationSeconds:item.durationSeconds}:{})});
      }
      for(const [index,soundtrack] of soundtrackCompanions(artifact.settings.soundtrack_assets).entries()){
        const url=String(soundtrack.media_url??""),mime=String(soundtrack.media_type??"").toLowerCase(),extension=audioFileExtension(mime);
        if(!extension||!/^\/api\/media\/[A-Za-z0-9._~%+-]+$/u.test(url))throw new Error("incomplete_media_archive");
        const response=await this.store.guardedFetch(url,{credentials:"same-origin"},"export the approved soundtrack");
        if(!this.store.authorizationScopeActive(authorization))return;
        const actualMime=String(response.headers.get("content-type")??"").split(";")[0]!.trim().toLowerCase();if(!response.ok||actualMime!==mime)throw new Error("incomplete_media_archive");
        const soundtrackBytes=new Uint8Array(await response.arrayBuffer());if(!this.store.authorizationScopeActive(authorization))return;
        totalBytes+=soundtrackBytes.byteLength;if(soundtrackBytes.byteLength>25_000_000||totalBytes>90_000_000)throw new Error("office_archive_too_large");
        const filename=`soundtracks/soundtrack-${String(index+1).padStart(3,"0")}.${extension}`;files.push({name:filename,content:soundtrackBytes});
        soundtrackManifest.push({position:index+1,label:soundtrack.label??"",file:filename,mimeType:mime,durationSeconds:soundtrack.duration_seconds??null,cues:soundtrack.cues??[]});
      }
      const{createOfficeArchive}=await import("../model/office-documents");
      if(!this.store.authorizationScopeActive(authorization))return;
      const audience=artifact.kind==="storyboard"?[{name:"index.html",content:storyboardAudienceHtml({title:artifact.title,markdown:content.content_markdown,frames:manifest,soundtracks:soundtrackManifest})}]:[];
      const bytes=createOfficeArchive([...audience,{name:"README.md",content:content.content_markdown},{name:"manifest.json",content:JSON.stringify({title:artifact.title,kind:artifact.kind,revision:binding.artifact_revision,contentSha256:binding.content_sha256,items:manifest,...(soundtrackManifest.length?{soundtracks:soundtrackManifest}:{})},null,2)},...files],{media:true});
      if(!this.store.authorizationScopeActive(authorization)||this.store.content.get()[artifact.contentRef??""]!==retained)return;
      const receipt={type:"DocumentArtifactExported",payload:{artifact_id:artifact.id,artifact_kind:artifact.kind,document_id:artifact.documentId,format:"application/zip",...binding,source_surface:`${this.source}-artifact-viewer`}};
      if(!await this.store.authorizeProjectExport(receipt,authorization)||!this.store.authorizationScopeActive(authorization))return;
      const blob=new Blob([Uint8Array.from(bytes).buffer],{type:"application/zip"}),url=URL.createObjectURL(blob),link=document.createElement("a");
      link.href=url;link.download=`${(artifact.title||this.i18n.system(documentArtifactDefinition(artifact.kind).label)).normalize("NFKC").toLocaleLowerCase(this.i18n.locale).replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-|-$/g,"")||"forma"}.zip`;
      document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1_000);
    }catch{if(this.store.authorizationScopeActive(authorization))this.store.toast(this.i18n.system("The complete original output is unavailable, so an incomplete copy was not created."));}
  }
  #artifactInputStatus(artifact:DocumentArtifact){const blocks=this.#projection().blocks.filter((block)=>block.properties.source_artifact_id===artifact.id);const root=blocks.some((block)=>!block.properties.source_artifact_item_id);const itemIds=new Set(blocks.map((block)=>String(block.properties.source_artifact_item_id??"")).filter(Boolean));const frames=artifact.kind==="storyboard"?artifact.items.filter((item)=>Boolean(item.mediaUrl)):artifact.kind==="video"?artifact.items.filter((item)=>Boolean(item.mediaUrl)&&String(item.mediaType??"").startsWith("video/")):[];return{total:1+frames.length,added:(root?1:0)+frames.filter((item)=>itemIds.has(item.id)).length};}
  #readonlyReuseView(){
    return !this.#editingId&&!this.#savingEdit&&!this.#reviewNote&&!this.#createOpen&&!this.#submitting
      &&!this.#referenceBusy&&!this.#sceneSubmitting&&!this.#workflowBusy;
  }
  /** Only this exact current readonly viewer may be subtracted from its parent. */
  allowsNavigationPresentation(context?:NavigationPresentationContext):boolean{
    const sceneLease=this.#sceneResultCloseLease;
    if(sceneLease?.current()&&navigationPresentationMatches(context,this,sceneLease.dialog))return true;
    if(sceneLease&&context?.closingPresentation?.presentation.element===sceneLease.dialog
      &&navigationPresentationClosing(context,this)&&sceneLease.closedCurrent())return true;
    const opening=this.#nativeStoryOpening,lease=this.#nativeStoryCloseLease;
    if(opening&&this.#nativeStoryReadOnly(opening)&&navigationPresentationMatches(context,this,this.#nativeStoryDialog(opening)))return true;
    if(lease&&context?.closingPresentation?.presentation.element===lease.dialog
      &&navigationPresentationClosing(context,this)&&lease.closedCurrent())return true;
    return this.isConnected&&!this.#convertingId&&this.#readonlyReuseView()
      &&(navigationPresentationClosing(context,this)||Boolean(this.#viewerCurrent?.())&&Boolean(this.#activeId)
        &&navigationPresentationMatches(context,this,this.#viewDialog()));
  }
  async #openChangedSource(artifact:DocumentArtifact,id:string,path:string,event:MouseEvent){
    const trigger=event.currentTarget as HTMLAnchorElement|null;
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey
      ||!trigger||trigger.getAttribute("download")!==null
      ||trigger.getAttribute("target")&&trigger.getAttribute("target")!=="_self")return;
    event.preventDefault();
    const store=this.store,sourceCurrent=this.#privateSourceCurrent(),viewer=this.#viewerCurrent,element=this.#viewDialog();
    const parent=this.closest<FormaElement>("forma-library,forma-workspace,forma-canvas-surface,forma-creative-editor,forma-chat-studio,forma-document-generations"),shell=this.closest<FormaElement>("forma-shell");
    const route=store.route.get(),projectId=store.projection.get().projectId;
    const target=()=>{
      const projection=store.projection.get(),permissions=store.session.get()?.projectContext?.permissions??store.session.get()?.capabilities??[];
      if(projection.projectId!==projectId||!permissions.includes("project.read"))return null;
      if(id.startsWith("output:")){
        const source=projection.libraryArtifacts.find(value=>value.id===id.slice(7));
        return source?{path:libraryFocusRoute("artifact",source.id,source.title,route),documentId:source.documentId,blockId:"",
          identity:JSON.stringify([source.id,source.documentId,source.sequence,source.sourceEventId,source.contentRef,documentArtifactRevision(store.events.get(),source.id)])}:null;
      }
      const block=projection.libraryBlocks.find(value=>value.id===id&&!value.removed&&value.scope==="document"
        &&value.documentId===artifact.documentId&&value.projectId===projectId);
      const document=projection.documents.find(value=>value.id===artifact.documentId&&value.projectId===projectId&&!value.removed);
      return block&&document?{path:documentContextBlockRoute(document.id,document.title,block.id),documentId:document.id,blockId:block.id,
        identity:JSON.stringify([block.projectId,block.documentId,block.scope,block.id,block.type,block.sourceEvents])}:null;
    };
    const original=target(),targetCurrent=()=>{const current=target();return Boolean(original&&current&&current.path===path&&current.identity===original.identity);};
    const artifactCurrent=()=>store.projection.get().libraryArtifacts.some(value=>value.id===artifact.id
      &&value.documentId===artifact.documentId&&value.sequence===artifact.sequence
      &&value.sourceEventId===artifact.sourceEventId&&value.contentRef===artifact.contentRef);
    const current=()=>sourceCurrent()&&this.#viewerCurrent===viewer&&Boolean(viewer?.())&&this.#activeId===artifact.id
      &&this.#viewDialog()===element&&artifactCurrent()&&targetCurrent();
    if(!original||original.path!==path||trigger.getAttribute("href")!==path||!element||!viewer||!parent||!shell||!current())return;
    if(!this.#readonlyReuseView()){store.toast(this.i18n.t("next.lifecycle.currentWorkOpen"));return;}
    const knownOpener=this.#viewerReturnFocus,opener=knownOpener?.isConnected?knownOpener:undefined;
    const focus=libraryFocusFromRoute(route),afterCloseRoute=parent.matches("forma-library")
      &&parent.querySelector("forma-document-artifacts")===this&&focus?.kind==="artifact"&&focus.id===artifact.id?libraryRootRoute(route):undefined;
    await navigateInApp(this,async navigation=>{
      if(!current()||!this.#readonlyReuseView())return false;
      if(!await navigation.closeNativePresentation(owned=>{
        this.#viewerCloseGuard={viewer,dialog:element,current:owned};
        element.close();this.#activeId="";this.requestUpdate();
      },{parent,afterCloseRoute,closedCurrent:()=>sourceCurrent()&&artifactCurrent()&&targetCurrent()
        &&!this.#activeId&&!this.#viewerOpening&&(this.#viewerCurrent===viewer||this.#viewerCurrent===null)&&this.#readonlyReuseView()}))return false;
      if(!navigation.current()||!targetCurrent()||!await navigation.route(path,{documentFocus:false}))return false;
      if(!original.blockId)return true; // Existing Shell artifact-arrival retention owns its current viewer.
      const arrived=()=>navigation.current()&&targetCurrent()&&store.route.get()===path
        &&store.projection.get().documentId===original.documentId;
      const focusedSource=outputNavigationOwnedRouteFocus(shell.ownerDocument,store,
        {documentId:original.documentId,blockId:original.blockId},arrived);
      // Route-module loading is separate from Shell updateComplete. Observe the
      // existing Workspace arrival/focus across the same bounded native frames.
      for(let attempt=0;attempt<24&&arrived();attempt++){
        await new Promise<void>(resolve=>window.requestAnimationFrame(()=>resolve()));
        if(!arrived())return false;
        const workspaces=[...shell.querySelectorAll<FormaElement>("forma-workspace")]
          .filter(workspace=>workspace.isConnected&&FormaElement.hasStoreIdentity(workspace,store));
        if(workspaces.length>1)return false;if(!workspaces.length)continue;
        const workspace=workspaces[0]!;await workspace.updateComplete;
        if(!arrived()||!workspace.isConnected)return false;
        const focused=shell.ownerDocument.activeElement;
        // The Workspace owns the actual focus. Never move it or acquire a new lease here.
        if(focused?.closest("forma-workspace")===workspace&&focusedSource(focused))return true;
      }
      return false;
    },{presentation:{owner:this,element,trigger,opener,current:()=>current()&&this.#readonlyReuseView()}});
  }
  async #addArtifactContext(artifact:DocumentArtifact,event:MouseEvent){
    const sourceCurrent=this.#privateSourceCurrent();
    const element=this.#viewDialog(),trigger=event.currentTarget as HTMLElement|null,viewer=this.#viewerCurrent;
    if(this.#convertingId||!sourceCurrent()||!element||!trigger||!viewer||!this.#readonlyReuseView()||artifact.kind==="model3d"&&!model3dArtifactContextReadiness(artifact).supported)return;
    const destination=this.#targetDocumentId(),source=this.source,hostDocumentId=this.documentId;
    const slidePresentation=artifact.kind==="slides"?element.querySelector("forma-presentation-deck")?.activePresentation:null;
    const route=this.store.route.get(),focus=libraryFocusFromRoute(route),library=this.closest<FormaElement>("forma-library");
    const afterCloseRoute=focus?.kind==="artifact"&&focus.id===artifact.id&&library?.isConnected
      &&FormaElement.hasStoreIdentity(library,this.store)&&library.querySelector("forma-document-artifacts")===this
      ?libraryRootRoute(route):undefined;
    const originalOpener=this.#viewerReturnFocus,opener=originalOpener?.isConnected?originalOpener:undefined;let dispatched=false;
    try{
      await reuseManualOutput(this,this.store,this.#outputReuse,event,{
        destinationDocumentId:destination,
        current:()=>sourceCurrent()&&this.source===source&&this.documentId===hostDocumentId
          &&this.#targetDocumentId()===destination&&this.store.projection.get().libraryArtifacts.some(value=>value.id===artifact.id
            &&value.documentId===artifact.documentId&&value.sequence===artifact.sequence
            &&value.sourceEventId===artifact.sourceEventId&&value.contentRef===artifact.contentRef),
        copy:()=>{dispatched=true;this.#convertingId=artifact.id;this.requestUpdate();
          return this.store.addArtifactAsContext(artifact.id,destination,source+"-artifact-viewer",{reveal:false,presentation:slidePresentation});},
        presentation:{owner:this,element,trigger,opener,afterCloseRoute,
          current:()=>this.#readonlyReuseView()&&this.#viewerCurrent===viewer&&viewer()
            &&this.#activeId===artifact.id&&this.#viewDialog()===element,
          close:current=>{this.#viewerCloseGuard={viewer,dialog:element,current};element.close();this.#activeId="";this.requestUpdate();},
          closedCurrent:()=>!this.#activeId&&!this.#viewerOpening&&(this.#viewerCurrent===viewer||this.#viewerCurrent===null),
        },
      });
    }finally{if(dispatched&&this.#convertingId===artifact.id){this.#convertingId="";this.requestUpdate();}}
  }
  #retireAudioTrim(){
    const draft=this.#audioTrim;this.#audioTrim=null;
    if(draft){draft.abort.abort();if(draft.conversion)draft.selection?.bytes.fill(0);draft.selection=null;draft.conversion=null;}
    const editor=this.querySelector<import("./audio-trim-editor.ts").AudioTrimEditor>("forma-audio-trim-editor");
    if(editor)editor.selection=null;
  }
  #syncAudioTrim(){
    const draft=this.#audioTrim;
    if(this.#audioTrimNotice&&!this.#audioTrimNotice.current())this.#audioTrimNotice=null;
    if(!draft)return;
    if(!draft.current()){
      this.#retireAudioTrim();
      if(this.#editingId===draft.artifactId){this.#editingId="";this.#editRevision=0;}
      return;
    }
    if(!draft.basisCurrent()){
      draft.abort.abort();if(draft.conversion)draft.selection?.bytes.fill(0);draft.selection=null;draft.conversion=null;draft.loading=false;
      if(!draft.saving&&draft.code!=="unconfirmed")draft.code="source_changed";
      const editor=this.querySelector<import("./audio-trim-editor.ts").AudioTrimEditor>("forma-audio-trim-editor");
      if(editor)editor.selection=null;
    }
  }
  async #startAudioTrim(artifact:DocumentArtifact,event:MouseEvent){
    if(!(event.currentTarget instanceof HTMLElement))return;
    if(this.#savingEdit||this.#editingId||artifact.kind!=="audio"||this.store.session.get()?.projectContext)return;
    const raw=this.store.content.get()[artifact.contentRef??""],content=parseDocumentArtifactContent(raw);
    const media={url:artifact.mediaUrl??"",mediaType:artifact.mediaType??"",sha256:String(artifact.settings.source_media_sha256??"")};
    if(!content||!raw)return;
    const store=this.store,source=this.#privateSourceCurrent(),authorization=store.captureAuthorizationScope();
    const viewer=this.#viewerCurrent,dialog=this.#viewDialog(),route=store.route.get(),projectId=store.projection.get().projectId;
    if(!authorization||authorization.shared||!viewer?.()||!dialog?.open)return;
    const revision=documentArtifactRevision(store.events.get(),artifact.id),abort=new AbortController();
    const scope=()=>source()&&this.store===store&&store.authorizationScopeActive(authorization)
      &&!store.session.get()?.projectContext&&this.#viewerCurrent===viewer&&viewer()&&this.#activeId===artifact.id
      &&store.route.get()===route&&store.projection.get().projectId===projectId&&this.#viewDialog()===dialog&&dialog.open
      &&store.projection.get().libraryArtifacts.some(value=>value.id===artifact.id&&value.documentId===artifact.documentId
        &&value.sourceEventId===artifact.sourceEventId&&value.contentRef===artifact.contentRef);
    const draft:AudioTrimDraft={artifactId:artifact.id,abort,selection:null,startFrame:0,endFrame:0,sampleRate:0,expectedRevision:revision,
      expectedContentSha256:"",mediaSha256:media.sha256,loading:true,saving:false,checking:false,request:null,code:null,
      conversion:null,conversionAvailable:false,conversionFailed:false,mediaUrl:media.url,mediaType:media.mediaType,
      current:()=>this.#audioTrim===draft&&scope(),
      basisCurrent:()=>draft.current()&&store.content.get()[artifact.contentRef??""]===raw
        &&documentArtifactRevision(store.events.get(),artifact.id)===revision
        &&store.projection.get().libraryArtifacts.some(value=>value.id===artifact.id&&value.mediaUrl===media.url
          &&value.mediaType===media.mediaType&&value.settings.source_media_sha256===media.sha256),
    };
    this.#audioTrimNotice=null;this.#audioTrim=draft;this.#editingId=artifact.id;this.#editRevision=revision;
    this.#editMarkdown=content.content_markdown;this.#editItems=[];this.#reviewPanelOpen=false;
    const focus=captureOutputNavigationFocus(this.ownerDocument);this.requestUpdate();
    try{
      if(!/^audio\/(?:wav|wave|x-wav|mpeg)$/i.test(media.mediaType)||!media.url.startsWith("/api/media/")||! /^[a-f0-9]{64}$/.test(media.sha256)){
        draft.code="unsupported";return;
      }
      const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw));
      if(!draft.basisCurrent()||abort.signal.aborted)return;
      draft.expectedContentSha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
      if(media.mediaType==="audio/mpeg"){draft.conversionAvailable=true;return;}
      const blob=await readNativeRetainedAudioMedia(media,{signal:abort.signal,current:draft.basisCurrent,
        origin:this.ownerDocument.location.origin,
        request:(path,init)=>store.guardedFetch(path,init,"load audio for a local trim",{current:draft.basisCurrent}),
      });
      if(!draft.basisCurrent()||abort.signal.aborted)return;
      const bytes=new Uint8Array(await blob.arrayBuffer());
      if(!draft.basisCurrent()||abort.signal.aborted)return;
      const info=inspectPcmWav(bytes);
      if(!info){draft.code="unsupported";return;}
      draft.endFrame=info.frameCount;draft.sampleRate=info.sampleRate;draft.selection={bytes,info,startFrame:0,endFrame:info.frameCount};
      draft.loading=false;this.requestUpdate();await this.updateComplete;
      const target=dialog.querySelector<HTMLInputElement>("forma-audio-trim-editor .audio-trim-start");
      if(draft.basisCurrent()&&focus.current()&&target?.isConnected)
        focus.run(target,()=>{if(!draft.basisCurrent())return false;target.focus({preventScroll:true});if(!draft.basisCurrent()||!focus.current()||this.ownerDocument.activeElement!==target||!target.isConnected)return false;target.scrollIntoView({block:"nearest",inline:"nearest"});return true;});
    }catch{
      if(draft.current())draft.code=draft.basisCurrent()?"unavailable":"source_changed";
    }finally{
      try{
        if(draft.current()){
          draft.loading=false;this.requestUpdate();
          if(!draft.selection){
            await this.updateComplete;
            const target=dialog.querySelector<HTMLButtonElement>(draft.conversionAvailable?".artifact-audio-convert-prepare":".artifact-audio-trim-cancel");
            if(draft.current()&&focus.current()&&target?.isConnected&&!target.disabled)
              focus.run(target,()=>{if(!draft.current())return false;target.focus({preventScroll:true});if(!draft.current()||!focus.current()||this.ownerDocument.activeElement!==target||!target.isConnected)return false;target.scrollIntoView({block:"nearest",inline:"nearest"});return true;});
          }
        }
      }catch{/* A retired or interrupted opening never reacquires native focus. */}
      finally{focus.dispose();}
    }
  }
  async #prepareAudioConversion(draft:AudioTrimDraft,event:MouseEvent){
    if(this.#audioTrim!==draft||!draft.basisCurrent()||draft.loading||draft.saving||this.#savingEdit||!draft.conversionAvailable||draft.selection||draft.mediaType!=="audio/mpeg")return;
    const focus=captureOutputNavigationFocus(this.ownerDocument),origin=event.currentTarget as HTMLElement;
    draft.loading=true;draft.conversionFailed=false;draft.code=null;this.requestUpdate();let original:Uint8Array|null=null;
    try{
      const blob=await readNativeRetainedAudioMedia({url:draft.mediaUrl,mediaType:"audio/mpeg",sha256:draft.mediaSha256},{signal:draft.abort.signal,current:draft.basisCurrent,origin:this.ownerDocument.location.origin,
        request:(path,init)=>this.store.guardedFetch(path,init,"prepare an explicit local Audio conversion",{current:draft.basisCurrent})});
      if(!draft.basisCurrent())return;
      original=new Uint8Array(await blob.arrayBuffer());if(!draft.basisCurrent())return;
      const prepared=await prepareLocalAudioConversion(original,draft.mediaSha256,{signal:draft.abort.signal,current:draft.basisCurrent});
      if(!draft.basisCurrent()){prepared.bytes.fill(0);return;}
      const info=inspectPcmWav(prepared.bytes);if(!info){prepared.bytes.fill(0);throw new Error("audio_conversion_invalid");}
      draft.conversion=prepared.conversion;draft.conversionAvailable=false;draft.selection={bytes:prepared.bytes,info,startFrame:0,endFrame:info.frameCount};draft.endFrame=info.frameCount;draft.sampleRate=info.sampleRate;
      draft.loading=false;this.requestUpdate();await this.updateComplete;
      const target=this.#viewDialog()?.querySelector<HTMLInputElement>("forma-audio-trim-editor .audio-trim-start");
      if(draft.basisCurrent()&&origin.isConnected&&this.ownerDocument.activeElement===origin&&focus.current()&&target?.isConnected)
        focus.run(target,()=>{if(!draft.basisCurrent())return false;target.focus({preventScroll:true});if(this.ownerDocument.activeElement!==target)return false;target.scrollIntoView({block:"nearest",inline:"nearest"});return true;});
    }catch{if(draft.basisCurrent())draft.conversionFailed=true;}
    finally{original?.fill(0);focus.dispose();if(this.#audioTrim===draft){draft.loading=false;this.requestUpdate();}}
  }
  #changeAudioTrim(event:CustomEvent<{startFrame:number;endFrame:number}>){
    const draft=this.#audioTrim,selection=draft?.selection;
    if(!draft||!selection||draft.saving||!draft.basisCurrent()||draft.code==="unconfirmed")return;
    const {startFrame,endFrame}=event.detail;
    if(!Number.isSafeInteger(startFrame)||!Number.isSafeInteger(endFrame)||startFrame<0||startFrame>=endFrame||endFrame>selection.info.frameCount)return;
    draft.startFrame=startFrame;draft.endFrame=endFrame;draft.selection={...selection,startFrame,endFrame};
    draft.code=null;this.requestUpdate();
  }
  async #saveAudioTrim(artifact:DocumentArtifact,event:MouseEvent,check=false){
    const draft=this.#audioTrim,selection=draft?.selection;
    if(!draft||draft.saving||this.#savingEdit)return;
    if(check?(!draft.current()||draft.code!=="unconfirmed"||!draft.request):(!selection||!draft.basisCurrent()||draft.code==="unconfirmed"||draft.code==="invalid_range"))return;
    const trimmed=!check&&selection?trimPcmWav(selection.bytes,selection.startFrame,selection.endFrame):null;
    if(!check&&!trimmed){draft.code="invalid_range";this.requestUpdate();return;}
    const focus=captureOutputNavigationFocus(this.ownerDocument),origin=event.currentTarget as HTMLButtonElement;
    draft.saving=true;draft.checking=check;this.#savingEdit=true;draft.code=null;this.requestUpdate();let invoked=false;
    try{
      if(!check&&trimmed&&selection){
        const digest=await crypto.subtle.digest("SHA-256",new Uint8Array(trimmed.bytes));
        if(!draft.basisCurrent())return;
        draft.request={expectedRevision:draft.expectedRevision,expectedContentSha256:draft.expectedContentSha256,
          audioTrim:{sourceMediaSha256:draft.mediaSha256,sourceFrameCount:selection.info.frameCount,
            startFrame:selection.startFrame,endFrame:selection.endFrame,
            resultMediaSha256:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("")}};
        if(draft.conversion)draft.request.audioTrim.conversion=draft.conversion;
      }
      const input=draft.request;if(!input||!draft.current())return;
      invoked=true;
      const result=check?await this.store.checkAudioTrimOperation(artifact.id,input):await this.store.reviseDocumentArtifact(artifact.id,input,draft.conversion?selection?.bytes:undefined);
      if(!draft.current())return;
      draft.code=result.code;
      if(result.status!=="saved"&&result.status!=="unchanged")return;
      const revision=documentArtifactRevision(this.store.events.get(),artifact.id),raw=this.store.content.get()[artifact.contentRef??""];
      const current=this.store.projection.get().libraryArtifacts.find(value=>value.id===artifact.id);
      if(result.status==="saved"&&(revision!==result.revision||revision!==input.expectedRevision+1
        ||current?.mediaUrl!==result.audioRevision.media.url||current.settings.source_media_sha256!==input.audioTrim.resultMediaSha256)){
        draft.code="unconfirmed";return;
      }
      if(result.status==="unchanged"&&!draft.basisCurrent()){draft.code="unconfirmed";return;}
      const source=this.#privateSourceCurrent(),authorization=this.store.captureAuthorizationScope(),viewer=this.#viewerCurrent,route=this.store.route.get();
      const noticeCurrent=()=>source()&&Boolean(authorization&&this.store.authorizationScopeActive(authorization))
        &&this.#viewerCurrent===viewer&&Boolean(viewer?.())&&this.#activeId===artifact.id&&this.store.route.get()===route
        &&documentArtifactRevision(this.store.events.get(),artifact.id)===revision&&this.store.content.get()[artifact.contentRef??""]===raw;
      this.#audioTrimNotice={artifactId:artifact.id,code:result.code,current:noticeCurrent};
      const ownsFocus=origin.isConnected&&this.ownerDocument.activeElement===origin&&focus.current();
      this.#cancelArtifactEdit();await this.updateComplete;
      const menu=this.querySelector<FormaUiPopover>(".artifact-viewer-actions-popover");if(menu)await menu.updateComplete;
      const target=menu?.querySelector<HTMLButtonElement>(".ui-popover-trigger")
        ??this.#viewDialog()?.querySelector<HTMLButtonElement>(".artifact-viewer-review-toggle");
      if(ownsFocus&&noticeCurrent()&&focus.current()&&target?.isConnected)
        focus.run(target,()=>{if(!noticeCurrent())return false;target.focus({preventScroll:true});return true;});
    }catch{
      if(draft.current())draft.code=invoked?"unconfirmed":"unavailable";
    }finally{
      focus.dispose();draft.saving=false;draft.checking=false;
      if(this.#audioTrim===draft||!this.#audioTrim){this.#savingEdit=false;this.#syncAudioTrim();this.requestUpdate();}
    }
  }
  #audioTrimTemplate(draft:AudioTrimDraft){
    const copy=audioTrimCopy(this.i18n.locale);
    return html`<section class="artifact-audio-trim" aria-label=${copy.title}>
      <h3>${copy.title}</h3><p>${copy.help}</p>
      ${draft.conversionAvailable||draft.conversion?html`<p>${copy.conversionHelp}</p>`:nothing}
      ${draft.conversionAvailable||draft.conversion?html`<button type="button" class="button secondary artifact-audio-convert-prepare" aria-disabled=${String(draft.loading||draft.saving||Boolean(draft.conversion))} @click=${(event:MouseEvent)=>void this.#prepareAudioConversion(draft,event)}>${draft.conversion?copy.conversionReady:copy.conversionAction}</button><details><summary>${copy.conversionDetailsLabel}</summary><p>${copy.conversionDetails}</p></details>`:nothing}
      ${draft.conversionFailed?html`<p role="status">${copy.conversionFailure}</p>`:nothing}
      ${draft.loading?html`<p role="status">${copy.loading}</p>`:nothing}
      ${draft.checking?html`<p role="status">${copy.checking}</p>`:nothing}
      ${!draft.selection&&draft.sampleRate>0?html`<p>${copy.interval.replace("{start}",this.i18n.number(draft.startFrame/draft.sampleRate,{maximumFractionDigits:3})).replace("{end}",this.i18n.number(draft.endFrame/draft.sampleRate,{maximumFractionDigits:3}))}</p>`:nothing}
      ${draft.code&&(draft.code!=="invalid_range"||!draft.selection)?html`<p class="artifact-audio-trim-status" role="status">${copy.status[draft.code]}</p>`:nothing}
      ${draft.selection?html`<forma-audio-trim-editor .selection=${draft.selection} .disabled=${draft.saving||draft.code==="unconfirmed"}
        @audio-trim-change=${(event:CustomEvent<{startFrame:number;endFrame:number}>)=>this.#changeAudioTrim(event)} @audio-trim-invalid=${()=>{if(draft.basisCurrent()&&!draft.saving){draft.code="invalid_range";this.requestUpdate();}}}></forma-audio-trim-editor>`:nothing}
      <p class="artifact-audio-trim-notes">${copy.originalNotes}</p>
    </section>`;
  }
  #retireModel3dScale(){
    const draft=this.#model3dScale;this.#model3dScale=null;
    if(draft){draft.abort.abort();draft.preparation++;draft.bytes?.fill(0);draft.prepared?.geometry.bytes.fill(0);
      draft.bytes=null;draft.prepared=null;draft.beforeBounds=null;draft.source=null;draft.rawContent="";}
  }
  #syncModel3dScale(){
    const draft=this.#model3dScale;
    if(this.#model3dScaleNotice&&!this.#model3dScaleNotice.current())this.#model3dScaleNotice=null;
    if(!draft)return;
    if(!draft.current()){
      this.#retireModel3dScale();
      if(this.#editingId===draft.artifactId){this.#editingId="";this.#editRevision=0;}
    }else if(!draft.basisCurrent()){
      draft.abort.abort();draft.preparation++;draft.bytes?.fill(0);draft.prepared?.geometry.bytes.fill(0);
      draft.bytes=null;draft.prepared=null;draft.beforeBounds=null;draft.loading=false;draft.preparing=false;
      if(!draft.saving&&draft.code!=="unconfirmed")draft.code="source_changed";
    }
  }
  #model3dScaleMediaOwned(artifact:DocumentArtifact){
    const file=model3dArtifactMediaFile(artifact),ownerId=this.store.session.get()?.user.userId;
    if(!file||!ownerId)return null;
    try{const key=decodeURIComponent(file.url.slice("/api/media/".length));
      return key.startsWith(`${ownerMediaNamespace(ownerId)}/generated/`)&&key.endsWith(".glb")?file:null;}
    catch{return null;}
  }
  async #readModel3dScaleMedia(draft:Model3dScaleDraft):Promise<Uint8Array>{
    const url=new URL(draft.mediaUrl,this.ownerDocument.location.origin);
    if(url.origin!==this.ownerDocument.location.origin||url.pathname!==draft.mediaUrl||url.search||url.hash
      ||!Number.isSafeInteger(draft.byteLength)||draft.byteLength<1||draft.byteLength>MAX_MODEL3D_UPLOAD_BYTES)
      throw new Error("model3d_scale_unavailable");
    const controller=new AbortController(),deadline=Date.now()+30_000;
    const current=()=>draft.basisCurrent()&&!draft.abort.signal.aborted&&!controller.signal.aborted&&Date.now()<deadline;
    const check=()=>{if(!current())throw new Error("model3d_scale_retired");};
    check();
    let stop!:(error:Error)=>void;
    const stopped=new Promise<never>((_resolve,reject)=>{stop=reject;});void stopped.catch(()=>undefined);
    const abort=()=>{controller.abort();stop(new Error("model3d_scale_retired"));};
    draft.abort.signal.addEventListener("abort",abort,{once:true});const timer=setTimeout(abort,30_000);
    const settle=<T>(operation:Promise<T>)=>Promise.race([operation,stopped]);
    const cancel=(operation:(()=>Promise<unknown>)|undefined)=>{try{if(operation)void operation().catch(()=>undefined);}catch{/* Already released. */}};
    let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,complete=false;
    const bytes=new Uint8Array(draft.byteLength);
    try{
      const request=this.store.guardedFetch(draft.mediaUrl,{method:"GET",signal:controller.signal,
        credentials:"same-origin",redirect:"error",cache:"no-store"},"load a saved GLB for local scaling",{current});
      void request.then(late=>{if(!current())cancel(late.body?()=>late.body!.cancel():undefined);},()=>undefined).catch(()=>undefined);
      response=await settle(request);check();
      if(response.status!==200||response.redirected||response.url!==url.href
        ||response.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="model/gltf-binary")
        throw new Error("model3d_scale_unavailable");
      const header=response.headers.get("content-length"),encoding=response.headers.get("content-encoding");
      const identity=encoding===null||encoding.trim().toLowerCase()==="identity";
      if(header!==null&&(!/^(0|[1-9]\d*)$/u.test(header)||!Number.isSafeInteger(Number(header))
        ||identity&&Number(header)!==draft.byteLength))throw new Error("model3d_scale_size");
      reader=response.body?.getReader();if(!reader)throw new Error("model3d_scale_unavailable");
      let size=0,chunks=0;
      for(;;){
        check();const part=await settle(reader.read());check();if(part.done)break;
        if(++chunks>65_536||!(part.value instanceof Uint8Array)||!part.value.byteLength
          ||size+part.value.byteLength>bytes.byteLength)throw new Error("model3d_scale_size");
        bytes.set(part.value,size);size+=part.value.byteLength;
      }
      if(size!==draft.byteLength)throw new Error("model3d_scale_size");
      check();complete=true;return bytes;
    }finally{
      clearTimeout(timer);draft.abort.signal.removeEventListener("abort",abort);controller.abort();
      if(!complete){bytes.fill(0);cancel(reader?()=>reader!.cancel():response?.body?()=>response!.body!.cancel():undefined);}
      try{reader?.releaseLock();}catch{/* The retired read cannot own editor state. */}
    }
  }
  async #prepareModel3dScale(draft:Model3dScaleDraft){
    if(!draft.source||!draft.bytes||!draft.basisCurrent()||draft.saving||draft.code==="unconfirmed")return;
    const preparation=++draft.preparation,factor=Number(draft.factor);
    draft.prepared?.geometry.bytes.fill(0);draft.prepared=null;draft.code=null;
    if(!draft.factor.trim()||!Number.isFinite(factor)||factor<=0){draft.code="invalid_scale";draft.preparing=false;this.requestUpdate();return;}
    draft.preparing=true;this.requestUpdate();
    const current=()=>draft.basisCurrent()&&draft.preparation===preparation&&!draft.abort.signal.aborted;
    try{
      const prepared=await prepareModel3dArtifactScale({captured:draft.source,current:draft.source,
        rawContent:draft.rawContent,bytes:draft.bytes,factor});
      if(!current()){prepared.geometry.bytes.fill(0);return;}
      draft.prepared=prepared;draft.beforeBounds=prepared.geometry.beforeBounds;
    }catch(error){
      if(current())draft.code=error instanceof GeometryScaleError?(error.code==="unsupported"?"unsupported":"invalid_scale"):"unavailable";
    }finally{if(draft.preparation===preparation){draft.preparing=false;this.requestUpdate();}}
  }
  async #startModel3dScale(artifact:DocumentArtifact,event:MouseEvent){
    const origin=event.currentTarget;
    if(!(origin instanceof HTMLButtonElement)||origin!==this.querySelector(".artifact-model3d-scale-open")||!origin.isConnected
      ||this.#savingEdit||this.#editingId||artifact.kind!=="model3d"||this.store.session.get()?.projectContext)return;
    const raw=this.store.content.get()[artifact.contentRef??""],content=parseDocumentArtifactContent(raw),file=this.#model3dScaleMediaOwned(artifact);
    if(!content||!raw||!file||content.items.length||artifact.items.length)return;
    const store=this.store,source=this.#privateSourceCurrent(),authorization=store.captureAuthorizationScope();
    const viewer=this.#viewerCurrent,dialog=this.#viewDialog(),route=store.route.get(),projectId=store.projection.get().projectId;
    const ownerId=store.session.get()?.user.userId??"",fileIdentity=JSON.stringify(file);
    if(!authorization||authorization.shared||!ownerId||!viewer?.()||!dialog?.open||!dialog.contains(origin))return;
    const revision=documentArtifactRevision(store.events.get(),artifact.id),head=store.head.get(),abort=new AbortController();
    const scope=()=>source()&&this.store===store&&store.authorizationScopeActive(authorization)
      &&!store.session.get()?.projectContext&&store.session.get()?.user.userId===ownerId
      &&this.#viewerCurrent===viewer&&viewer()&&this.#activeId===artifact.id
      &&store.route.get()===route&&store.projection.get().projectId===projectId&&this.#viewDialog()===dialog&&dialog.open
      &&store.projection.get().libraryArtifacts.some(value=>value.id===artifact.id&&value.documentId===artifact.documentId
        &&value.sourceEventId===artifact.sourceEventId&&value.contentRef===artifact.contentRef);
    if(!scope())return;
    const draft:Model3dScaleDraft={artifactId:artifact.id,mediaUrl:file.url,byteLength:file.fileSize,rawContent:raw,
      abort,source:null,bytes:null,prepared:null,beforeBounds:null,factor:"1",preparation:0,loading:true,preparing:false,saving:false,checking:false,request:null,code:null,
      current:()=>this.#model3dScale===draft&&scope(),
      basisCurrent:()=>draft.current()&&store.head.get()===head&&store.content.get()[artifact.contentRef??""]===raw
        &&documentArtifactRevision(store.events.get(),artifact.id)===revision
        &&store.projection.get().libraryArtifacts.some(value=>value.id===artifact.id&&value.items.length===0
          &&JSON.stringify(model3dArtifactMediaFile(value))===fileIdentity),
    };
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    this.#model3dScaleNotice=null;this.#model3dScale=draft;this.#editingId=artifact.id;this.#editRevision=revision;
    this.#editMarkdown=content.content_markdown;this.#editItems=[];this.#reviewPanelOpen=false;this.requestUpdate();
    try{
      const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw));
      if(!draft.basisCurrent()||abort.signal.aborted)return;
      const contentSha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
      draft.source={artifactKind:"model3d",artifactId:artifact.id,documentId:artifact.documentId,projectId,
        sourceEventId:artifact.sourceEventId,revision,contentSha256,mediaUrl:file.url,mediaSha256:file.sha256,byteLength:file.fileSize};
      const bytes=await this.#readModel3dScaleMedia(draft);
      if(!draft.basisCurrent()||abort.signal.aborted){bytes.fill(0);return;}draft.bytes=bytes;
      await this.#prepareModel3dScale(draft);
    }catch{if(draft.current())draft.code=draft.basisCurrent()?"unavailable":"source_changed";}
    finally{
      try{
        if(draft.current()){
          draft.loading=false;this.requestUpdate();await this.updateComplete;
          const target=dialog.querySelector<HTMLInputElement|HTMLButtonElement>(draft.prepared?".artifact-model3d-scale-factor":".artifact-model3d-scale-cancel");
          if(draft.current()&&focus.current()&&target?.isConnected&&!target.disabled)
            focus.run(target,()=>{if(!draft.current())return false;target.focus();return true;});
        }
      }catch{/* A newer native intent owns focus. */}finally{focus.dispose();}
    }
  }
  #changeModel3dScale(event:InputEvent,expected:Model3dScaleDraft){
    const draft=this.#model3dScale,target=event.currentTarget;
    if(!draft||draft!==expected||draft.saving||draft.checking||!draft.basisCurrent()||draft.code==="unconfirmed"
      ||!(target instanceof HTMLInputElement)||target!==this.querySelector(".artifact-model3d-scale-factor"))return;
    draft.factor=target.value;void this.#prepareModel3dScale(draft);
  }
  async #saveModel3dScale(artifact:DocumentArtifact,event:MouseEvent,check=false,expected=this.#model3dScale){
    const draft=this.#model3dScale,origin=event.currentTarget;
    if(!draft||draft!==expected||draft.artifactId!==artifact.id||draft.saving||this.#savingEdit
      ||!(origin instanceof HTMLButtonElement)||origin!==this.querySelector(check?".artifact-model3d-scale-check":".artifact-model3d-scale-save")
      ||!origin.isConnected||!this.#viewDialog()?.contains(origin))return;
    if(check?(!draft.current()||draft.code!=="unconfirmed"||!draft.request):
      (!draft.prepared||draft.preparing||draft.loading||!draft.basisCurrent()||draft.code!==null))return;
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    draft.saving=true;draft.checking=check;this.#savingEdit=true;draft.code=null;this.requestUpdate();let invoked=false;
    try{
      if(!check)draft.request=draft.prepared!.request;
      const input=draft.request;
      const result=input?(invoked=true,check?await this.store.checkModel3dScaleOperation(artifact.id,input):await this.store.reviseDocumentArtifact(artifact.id,input))
        :{status:"unchanged" as const,code:"unchanged" as const};
      if(!draft.current())return;draft.code=result.code;
      if(result.status!=="saved"&&result.status!=="unchanged")return;
      const revision=documentArtifactRevision(this.store.events.get(),artifact.id),raw=this.store.content.get()[artifact.contentRef??""];
      const current=this.store.projection.get().libraryArtifacts.find(value=>value.id===artifact.id),file=current&&model3dArtifactMediaFile(current);
      if(result.status==="saved"&&(!input||!current||!file||revision!==result.revision||revision!==input.expectedRevision+1
        ||current.items.length!==0||current.mediaUrl!==result.model3dRevision.media.url||file.url!==result.model3dRevision.media.url
        ||file.sha256!==input.model3dScale.resultMediaSha256||file.fileSize!==result.model3dRevision.media.byteLength)){
        draft.code="unconfirmed";return;
      }
      if(result.status==="unchanged"&&!draft.basisCurrent()){draft.code="unconfirmed";return;}
      const store=this.store,source=this.#privateSourceCurrent(),authorization=store.captureAuthorizationScope(),viewer=this.#viewerCurrent,route=store.route.get();
      const noticeCurrent=()=>source()&&this.store===store&&Boolean(authorization&&store.authorizationScopeActive(authorization))
        &&this.#viewerCurrent===viewer&&Boolean(viewer?.())&&this.#activeId===artifact.id&&store.route.get()===route
        &&documentArtifactRevision(store.events.get(),artifact.id)===revision&&store.content.get()[artifact.contentRef??""]===raw;
      this.#model3dScaleNotice={artifactId:artifact.id,code:result.code,current:noticeCurrent};
      const ownsFocus=origin.isConnected&&this.ownerDocument.activeElement===origin&&focus.current();
      this.#cancelArtifactEdit();await this.updateComplete;
      const menu=this.querySelector<FormaUiPopover>(".artifact-viewer-actions-popover");if(menu)await menu.updateComplete;
      const target=menu?.querySelector<HTMLButtonElement>(".ui-popover-trigger")??this.#viewDialog()?.querySelector<HTMLButtonElement>(".artifact-viewer-review-toggle");
      if(ownsFocus&&noticeCurrent()&&focus.current()&&target?.isConnected&&!target.disabled)
        focus.run(target,()=>{if(!noticeCurrent())return false;target.focus();return true;});
    }catch{if(draft.current())draft.code=invoked?"unconfirmed":"unavailable";}
    finally{focus.dispose();draft.saving=false;draft.checking=false;
      if(this.#model3dScale===draft||!this.#model3dScale){this.#savingEdit=false;this.#syncModel3dScale();this.requestUpdate();}}
  }
  #model3dScaleView(artifact:DocumentArtifact,draft:Model3dScaleDraft):Model3dArtifactScaleView{
    return{locale:this.i18n.locale,fieldForm:`artifact-model3d-scale-field-${artifact.id}`,factor:draft.factor,
      beforeBounds:draft.beforeBounds,afterBounds:draft.prepared?.geometry.afterBounds??null,
      loading:draft.loading,preparing:draft.preparing,saving:draft.saving,checking:draft.checking,
      ready:Boolean(draft.prepared&&draft.basisCurrent()&&draft.code===null),code:draft.code,
      onFactorInput:event=>this.#changeModel3dScale(event,draft),
      onSave:event=>void this.#saveModel3dScale(artifact,event,false,draft),
      onCheck:event=>void this.#saveModel3dScale(artifact,event,true,draft),
      onCancel:event=>{if(this.#model3dScale===draft&&draft.current()&&event.currentTarget===this.querySelector(".artifact-model3d-scale-cancel"))void this.#cancelArtifactEdit(event);}};
  }
  #retireVideoTrim(){
    const draft=this.#videoTrim;this.#videoTrim=null;
    if(draft){draft.abort.abort();draft.bytes?.fill(0);draft.bytes=null;draft.selection=null;draft.invalidRangeFromInput=null;}
    const editor=this.querySelector<import("./video-trim-editor.ts").VideoTrimEditor>("forma-video-trim-editor");
    if(editor)editor.selection=null;
  }
  #syncVideoTrim(){
    const draft=this.#videoTrim;
    if(this.#videoTrimNotice&&!this.#videoTrimNotice.current())this.#videoTrimNotice=null;
    if(!draft)return;
    if(!draft.current()){
      this.#retireVideoTrim();
      if(this.#editingId===draft.artifactId){this.#editingId="";this.#editRevision=0;}
      return;
    }
    if(!draft.basisCurrent()){
      draft.abort.abort();draft.bytes?.fill(0);draft.bytes=null;draft.selection=null;draft.invalidRangeFromInput=null;draft.loading=false;
      if(!draft.saving&&draft.code!=="unconfirmed")draft.code="source_changed";
      const editor=this.querySelector<import("./video-trim-editor.ts").VideoTrimEditor>("forma-video-trim-editor");
      if(editor)editor.selection=null;
    }
  }
  async #readVideoTrimMedia(draft:VideoTrimDraft):Promise<Uint8Array>{
    const url=new URL(draft.mediaUrl,this.ownerDocument.location.origin);
    if(url.origin!==this.ownerDocument.location.origin||url.pathname!==draft.mediaUrl||url.search||url.hash)
      throw new Error("video_trim_unavailable");
    const controller=new AbortController(),deadline=Date.now()+30_000;
    const current=()=>draft.basisCurrent()&&!draft.abort.signal.aborted&&!controller.signal.aborted&&Date.now()<deadline;
    const check=()=>{if(!current())throw new Error("video_trim_retired");};
    check();
    let stop!:(error:Error)=>void;
    const stopped=new Promise<never>((_resolve,reject)=>{stop=reject;});
    void stopped.catch(()=>undefined);
    const abort=()=>{controller.abort();stop(new Error("video_trim_retired"));};
    draft.abort.signal.addEventListener("abort",abort,{once:true});
    const timer=setTimeout(abort,30_000);
    const settle=<T>(operation:Promise<T>)=>Promise.race([operation,stopped]);
    const cancel=(operation:(()=>Promise<unknown>)|undefined)=>{
      // Cancellation is observed, but an unresponsive stream never owns the
      // deadline or keeps a retired editor waiting for its cancel promise.
      try{if(operation)void operation().catch(()=>undefined);}catch{/* Already released. */}
    };
    let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,complete=false;
    try{
      check();
      const request=this.store.guardedFetch(draft.mediaUrl,{method:"GET",signal:controller.signal,
        credentials:"same-origin",redirect:"error",cache:"no-store"},"load video for a local trim",{current});
      void request.then(late=>{if(!current())cancel(late.body?()=>late.body!.cancel():undefined);},()=>undefined).catch(()=>undefined);
      response=await settle(request);check();
      if(response.status!==200||response.redirected||response.url!==url.href
        ||response.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="video/mp4")
        throw new Error("video_trim_unavailable");
      const header=response.headers.get("content-length"),encoding=response.headers.get("content-encoding");
      const identity=encoding===null||encoding.trim().toLowerCase()==="identity";
      if(header!==null&&(!/^(0|[1-9]\d*)$/u.test(header)||!Number.isSafeInteger(Number(header))
        ||identity&&(Number(header)<1||Number(header)>VIDEO_PREFIX_TRIM_MAX_BYTES)))throw new Error("video_trim_size");
      reader=response.body?.getReader();if(!reader)throw new Error("video_trim_unavailable");
      const bytes=new Uint8Array(VIDEO_PREFIX_TRIM_MAX_BYTES);let size=0,chunks=0;
      for(;;){
        check();const part=await settle(reader.read());check();
        if(part.done)break;
        if(++chunks>65_536||!(part.value instanceof Uint8Array)||!part.value.byteLength
          ||size+part.value.byteLength>VIDEO_PREFIX_TRIM_MAX_BYTES)throw new Error("video_trim_size");
        bytes.set(part.value,size);size+=part.value.byteLength;
      }
      complete=true;
      if(!size||identity&&header!==null&&size!==Number(header))throw new Error("video_trim_size");
      check();return bytes.slice(0,size);
    }finally{
      clearTimeout(timer);draft.abort.signal.removeEventListener("abort",abort);controller.abort();
      if(!complete)cancel(reader?()=>reader!.cancel():response?.body?()=>response!.body!.cancel():undefined);
      try{reader?.releaseLock();}catch{/* The already-retired pending read owns no editor state. */}
    }
  }
  #videoTrimMediaOwned(artifact:DocumentArtifact){
    const item=videoArtifactMediaItem(artifact),ownerId=this.store.session.get()?.user.userId;
    if(!item||!ownerId)return null;
    try{const key=decodeURIComponent(artifact.mediaUrl!.slice("/api/media/".length));
      return key.startsWith(`${ownerMediaNamespace(ownerId)}/generated/`)&&key.endsWith(".mp4")?item:null;}
    catch{return null;}
  }
  async #startVideoTrim(artifact:DocumentArtifact,event:MouseEvent){
    const origin=event.currentTarget;
    if(!(origin instanceof HTMLElement)||!origin.isConnected||this.#savingEdit||this.#editingId
      ||artifact.kind!=="video"||this.store.session.get()?.projectContext)return;
    const raw=this.store.content.get()[artifact.contentRef??""],content=parseDocumentArtifactContent(raw),item=this.#videoTrimMediaOwned(artifact);
    if(!content||!raw||!item)return;
    const store=this.store,source=this.#privateSourceCurrent(),authorization=store.captureAuthorizationScope();
    const viewer=this.#viewerCurrent,dialog=this.#viewDialog(),route=store.route.get(),projectId=store.projection.get().projectId;
    const ownerId=store.session.get()?.user.userId??"",mediaUrl=artifact.mediaUrl!,declaredSha=artifact.settings.source_media_sha256;
    const hasDeclaredSha=Object.hasOwn(artifact.settings,"source_media_sha256");
    if(!authorization||authorization.shared||!ownerId||!viewer?.()||!dialog?.open||!dialog.contains(origin))return;
    const revision=documentArtifactRevision(store.events.get(),artifact.id),head=store.head.get(),abort=new AbortController();
    const scope=()=>source()&&this.store===store&&store.authorizationScopeActive(authorization)
      &&!store.session.get()?.projectContext&&store.session.get()?.user.userId===ownerId
      &&this.#viewerCurrent===viewer&&viewer()&&this.#activeId===artifact.id
      &&store.route.get()===route&&store.projection.get().projectId===projectId&&this.#viewDialog()===dialog&&dialog.open
      &&store.projection.get().libraryArtifacts.some(value=>value.id===artifact.id&&value.documentId===artifact.documentId
        &&value.sourceEventId===artifact.sourceEventId&&value.contentRef===artifact.contentRef);
    if(!scope())return;
    const draft:VideoTrimDraft={artifactId:artifact.id,itemId:item.id,mediaUrl,abort,bytes:null,selection:null,
      expectedRevision:revision,expectedContentSha256:"",loading:true,saving:false,checking:false,request:null,code:null,invalidRangeFromInput:null,
      current:()=>this.#videoTrim===draft&&scope(),
      basisCurrent:()=>draft.current()&&store.head.get()===head&&store.content.get()[artifact.contentRef??""]===raw
        &&documentArtifactRevision(store.events.get(),artifact.id)===revision
        &&store.projection.get().libraryArtifacts.some(value=>value.id===artifact.id&&value.mediaUrl===mediaUrl
          &&value.mediaType==="video/mp4"&&Object.hasOwn(value.settings,"source_media_sha256")===hasDeclaredSha
          &&value.settings.source_media_sha256===declaredSha&&videoArtifactMediaItem(value)?.id===item.id),
    };
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    this.#videoTrimNotice=null;this.#videoTrim=draft;this.#editingId=artifact.id;this.#editRevision=revision;
    this.#editMarkdown=content.content_markdown;this.#editItems=[];this.#reviewPanelOpen=false;
    this.requestUpdate();
    try{
      // Retire only the currently owned reader's players before replacing it with
      // the bytes-free selector. This editor creates no media element or Blob URL.
      for(const player of dialog.querySelectorAll<HTMLMediaElement>(".artifact-reader-video video, .artifact-reader-video audio")){
        player.pause();player.removeAttribute("src");player.load();
      }
      if(hasDeclaredSha&&(typeof declaredSha!=="string"||!/^[a-f0-9]{64}$/u.test(declaredSha))){draft.code="unsupported";return;}
      const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw));
      if(!draft.basisCurrent()||abort.signal.aborted)return;
      draft.expectedContentSha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
      const bytes=await this.#readVideoTrimMedia(draft);
      if(!draft.basisCurrent()||abort.signal.aborted){bytes.fill(0);return;}
      draft.bytes=bytes;
      const info=await inspectVideoPrefix(bytes);
      if(!draft.basisCurrent()||abort.signal.aborted)return;
      if(!info){draft.bytes.fill(0);draft.bytes=null;draft.code="unsupported";return;}
      if(hasDeclaredSha&&info.sourceSha256!==declaredSha){draft.bytes.fill(0);draft.bytes=null;draft.code="source_changed";return;}
      draft.selection={info,startSample:0,endSample:info.sampleCount};draft.loading=false;
      this.requestUpdate();await this.updateComplete;
      const target=dialog.querySelector<HTMLInputElement>("forma-video-trim-editor .video-trim-end");
      if(draft.basisCurrent()&&focus.current()&&target?.isConnected)
        focus.run(target,()=>{if(!draft.basisCurrent())return false;target.focus({preventScroll:true});
          if(!draft.basisCurrent()||!focus.current()||this.ownerDocument.activeElement!==target||!target.isConnected)return false;
          target.scrollIntoView({block:"nearest",inline:"nearest"});return true;});
    }catch{
      if(draft.current())draft.code=draft.basisCurrent()?"unavailable":"source_changed";
      draft.bytes?.fill(0);draft.bytes=null;draft.selection=null;
    }finally{
      try{
        if(draft.current()){
          draft.loading=false;this.requestUpdate();
          if(!draft.selection){
            await this.updateComplete;
            const target=dialog.querySelector<HTMLButtonElement>(".artifact-video-trim-cancel");
            if(draft.current()&&focus.current()&&target?.isConnected&&!target.disabled)
              focus.run(target,()=>{if(!draft.current())return false;target.focus({preventScroll:true});
                if(!draft.current()||!focus.current()||this.ownerDocument.activeElement!==target||!target.isConnected)return false;
                target.scrollIntoView({block:"nearest",inline:"nearest"});return true;});
          }
        }
      }catch{/* An interrupted opening does not reacquire focus. */}
      finally{focus.dispose();}
    }
  }
  #changeVideoTrim(event:CustomEvent<{startSample:0;endSample:number}>,expected:VideoTrimDraft){
    const draft=this.#videoTrim,selection=draft?.selection;
    if(!draft||draft!==expected||!selection||draft.saving||!draft.basisCurrent()||draft.code==="unconfirmed"
      ||event.currentTarget!==this.querySelector("forma-video-trim-editor"))return;
    const {startSample,endSample}=event.detail;
    if(startSample!==0||!Number.isSafeInteger(endSample)||endSample<1||endSample>selection.info.sampleCount)return;
    draft.selection={info:selection.info,startSample:0,endSample};draft.code=null;draft.invalidRangeFromInput=null;this.requestUpdate();
  }
  async #saveVideoTrim(artifact:DocumentArtifact,event:MouseEvent,check=false,expected=this.#videoTrim){
    const draft=this.#videoTrim,selection=draft?.selection,origin=event.currentTarget;
    if(!draft||draft!==expected||draft.artifactId!==artifact.id||draft.saving||this.#savingEdit||!(origin instanceof HTMLButtonElement)
      ||!origin.isConnected||!this.#viewDialog()?.contains(origin))return;
    if(check?(!draft.current()||draft.code!=="unconfirmed"||!draft.request):
      (!selection||!draft.bytes||!draft.basisCurrent()||draft.code==="unconfirmed"||draft.code==="invalid_range"))return;
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    draft.saving=true;draft.checking=check;this.#savingEdit=true;draft.code=null;draft.invalidRangeFromInput=null;this.requestUpdate();let invoked=false;
    try{
      if(!check&&selection&&draft.bytes){
        const trimmed=await trimVideoPrefix(draft.bytes,{startSample:0,endSample:selection.endSample});
        if(!draft.basisCurrent())return;
        if(!trimmed||trimmed.sourceSha256!==selection.info.sourceSha256){draft.code="invalid_range";return;}
        draft.request={expectedRevision:draft.expectedRevision,expectedContentSha256:draft.expectedContentSha256,
          videoTrim:{sourceMediaSha256:selection.info.sourceSha256,sourceSampleCount:selection.info.sampleCount,
            startSample:0,endSample:selection.endSample,resultMediaSha256:trimmed.sha256}};
      }
      const input=draft.request;if(!input||!draft.current())return;
      invoked=true;
      const result=check?await this.store.checkVideoTrimOperation(artifact.id,input):await this.store.reviseDocumentArtifact(artifact.id,input);
      if(!draft.current())return;
      draft.code=result.code;
      if(result.status!=="saved"&&result.status!=="unchanged")return;
      const revision=documentArtifactRevision(this.store.events.get(),artifact.id),raw=this.store.content.get()[artifact.contentRef??""];
      const current=this.store.projection.get().libraryArtifacts.find(value=>value.id===artifact.id);
      if(result.status==="saved"&&(!current||revision!==result.revision||revision!==input.expectedRevision+1
        ||result.videoRevision.source.itemId!==draft.itemId||current?.mediaUrl!==result.videoRevision.media.url
        ||videoArtifactMediaItem(current)?.id!==draft.itemId||current.settings.source_media_sha256!==input.videoTrim.resultMediaSha256)){
        draft.code="unconfirmed";return;
      }
      if(result.status==="unchanged"&&!draft.basisCurrent()){draft.code="unconfirmed";return;}
      const store=this.store,source=this.#privateSourceCurrent(),authorization=store.captureAuthorizationScope(),viewer=this.#viewerCurrent,route=store.route.get();
      const noticeCurrent=()=>source()&&this.store===store&&Boolean(authorization&&store.authorizationScopeActive(authorization))
        &&this.#viewerCurrent===viewer&&Boolean(viewer?.())&&this.#activeId===artifact.id&&store.route.get()===route
        &&documentArtifactRevision(store.events.get(),artifact.id)===revision&&store.content.get()[artifact.contentRef??""]===raw;
      this.#videoTrimNotice={artifactId:artifact.id,code:result.code,current:noticeCurrent};
      const ownsFocus=origin.isConnected&&this.ownerDocument.activeElement===origin&&focus.current();
      this.#cancelArtifactEdit();await this.updateComplete;
      const menu=this.querySelector<FormaUiPopover>(".artifact-viewer-actions-popover");if(menu)await menu.updateComplete;
      const target=menu?.querySelector<HTMLButtonElement>(".ui-popover-trigger")
        ??this.#viewDialog()?.querySelector<HTMLButtonElement>(".artifact-viewer-review-toggle");
      if(ownsFocus&&noticeCurrent()&&focus.current()&&target?.isConnected&&!target.disabled)
        focus.run(target,()=>{if(!noticeCurrent())return false;target.focus({preventScroll:true});return true;});
    }catch{
      if(draft.current())draft.code=invoked?"unconfirmed":"unavailable";
    }finally{
      focus.dispose();draft.saving=false;draft.checking=false;
      if(this.#videoTrim===draft||!this.#videoTrim){this.#savingEdit=false;this.#syncVideoTrim();this.requestUpdate();}
    }
  }
  #videoTrimTemplate(draft:VideoTrimDraft){
    const copy=videoTrimCopy(this.i18n.locale);
    const inputInvalid=draft.invalidRangeFromInput?.isConnected&&draft.invalidRangeFromInput===this.querySelector("forma-video-trim-editor");
    return html`<section class="artifact-video-trim" aria-label=${copy.title}>
      <h3>${copy.title}</h3><p>${copy.help}</p>
      ${draft.loading?html`<p role="status">${copy.loading}</p>`:nothing}
      ${draft.checking?html`<p role="status">${copy.checking}</p>`:nothing}
      ${draft.code&&!(draft.code==="invalid_range"&&inputInvalid&&draft.selection)?html`<p class="artifact-video-trim-status" role="status">${copy.status[draft.code]}</p>`:nothing}
      ${draft.selection?html`<forma-video-trim-editor .selection=${inputInvalid?noChange:draft.selection} .disabled=${draft.saving||draft.code==="unconfirmed"}
        @video-trim-change=${(event:CustomEvent<{startSample:0;endSample:number}>)=>this.#changeVideoTrim(event,draft)}
        @video-trim-invalid=${(event:Event)=>{if(this.#videoTrim===draft&&draft.basisCurrent()&&!draft.saving&&draft.code!=="unconfirmed"
          &&event.currentTarget===this.querySelector("forma-video-trim-editor")){draft.code="invalid_range";draft.invalidRangeFromInput=event.currentTarget as Element;this.requestUpdate();}}}></forma-video-trim-editor>`:nothing}
      <p class="artifact-video-trim-notes">${copy.originalNotes}</p>
    </section>`;
  }
  #startArtifactEdit(artifact:DocumentArtifact,event?:MouseEvent){
    const content=this.#content(artifact);if(!content)return;
    const focus=event?captureOutputNavigationFocus(this.ownerDocument):null;
    this.#editingId=artifact.id;this.#editMarkdown=content.content_markdown;
    this.#editItems=content.items.map((item)=>({title:item.title,body:item.body,notes:item.notes}));
    this.#editRevision=documentArtifactRevision(this.store.events.get(),artifact.id);this.requestUpdate();
    if(!focus)return;
    const sourceCurrent=this.#privateSourceCurrent(),authorization=this.store.captureAuthorizationScope();
    const viewer=this.#viewerCurrent,dialog=this.#viewDialog(),route=this.store.route.get(),editItems=this.#editItems;
    const revision=this.#editRevision,draftRevision=this.#editDraftRevision;
    const current=()=>sourceCurrent()&&Boolean(authorization&&this.store.authorizationScopeActive(authorization))
      &&this.#viewerCurrent===viewer&&Boolean(viewer?.())&&this.#activeId===artifact.id&&this.#editingId===artifact.id
      &&this.#editItems===editItems&&this.#editRevision===revision&&this.#editDraftRevision===draftRevision
      &&this.store.route.get()===route&&dialog===this.#viewDialog()&&Boolean(dialog?.open)&&focus.current();
    return this.updateComplete.then(()=>{
      if(!current())return;
      const target=this.#viewDialog()?.querySelector<HTMLTextAreaElement>('.artifact-direct-editor textarea[rows="12"]');
      if(target?.isConnected)focus.run(target,()=>{
        if(!current())return false;
        const editorKind=artifact.kind;
        if((editorKind!=="short_story"&&editorKind!=="slides")||this.#viewerFocused){target.focus();return true;}
        const editorCurrent=()=>current()&&target.isConnected&&!this.#viewerFocused
          &&target.ownerDocument===this.ownerDocument
          &&dialog?.getAttribute("data-artifact-kind")===editorKind
          &&dialog.getAttribute("data-output-focus")==="false"
          &&dialog.querySelector<HTMLTextAreaElement>('.artifact-direct-editor textarea[rows="12"]')===target;
        if(!editorCurrent())return false;
        // Reveal the complete owned control, without relying on focus's scroll alignment.
        target.focus({preventScroll:true});
        if(!editorCurrent()||this.ownerDocument.activeElement!==target)return false;
        target.scrollIntoView({block:"nearest",inline:"nearest",behavior:"instant"});
        return editorCurrent()&&this.ownerDocument.activeElement===target;
      });
    }).catch(()=>{/* A retired opening never recovers focus. */}).finally(()=>focus.dispose());
  }
  #cancelArtifactEdit(event?:MouseEvent){
    if(event&&(this.#savingEdit||this.#editingId!==this.#activeId))return;
    const focus=event?captureOutputNavigationFocus(this.ownerDocument):null,artifactId=this.#editingId;
    this.#retireAudioTrim();
    this.#retireVideoTrim();
    this.#retireModel3dScale();
    this.#editingId="";this.#editMarkdown="";this.#editItems=[];this.#editRevision=0;this.requestUpdate();
    // Native close, source retirement and Save ACK cleanup do not acquire focus.
    if(!focus)return;
    const sourceCurrent=this.#privateSourceCurrent(),authorization=this.store.captureAuthorizationScope();
    const viewer=this.#viewerCurrent,dialog=this.#viewDialog(),route=this.store.route.get(),editItems=this.#editItems,draftRevision=this.#editDraftRevision;
    const current=()=>sourceCurrent()&&Boolean(authorization&&this.store.authorizationScopeActive(authorization))
      &&this.#viewerCurrent===viewer&&Boolean(viewer?.())&&this.#activeId===artifactId&&!this.#editingId
      &&this.#editItems===editItems&&this.#editDraftRevision===draftRevision&&this.store.route.get()===route
      &&dialog===this.#viewDialog()&&Boolean(dialog?.open)&&focus.current();
    return (async()=>{
      await this.updateComplete;if(!current())return;
      const menu=this.querySelector<FormaUiPopover>(".artifact-viewer-actions-popover");
      if(menu)await menu.updateComplete;if(!current())return;
      const target=menu?.querySelector<HTMLButtonElement>(".ui-popover-trigger")
        ??this.#viewDialog()?.querySelector<HTMLButtonElement>(".artifact-viewer-review-toggle");
      if(target?.isConnected)focus.run(target,()=>{if(!current())return false;target.focus();return true;});
    })().catch(()=>{/* A newer edit or focus intent owns the next action. */}).finally(()=>focus.dispose());
  }
  async #saveArtifactEdit(artifact:DocumentArtifact){
    if(this.#savingEdit||this.#editingId!==artifact.id||!this.#editMarkdown.trim())return;
    const context=this.store.session.get()?.projectContext;
    if(context&&!context.permissions.includes("project.author"))return;
    const sourceCurrent=this.#privateSourceCurrent(),authorization=this.store.captureAuthorizationScope(),viewer=this.#viewerCurrent;
    const route=this.store.route.get(),projectId=this.store.projection.get().projectId,editItems=this.#editItems,draftRevision=this.#editDraftRevision;
    const retainedBefore=this.store.content.get()[artifact.contentRef??""];
    const input={markdown:this.#editMarkdown,items:editItems.map((item,index)=>({index,...item})),expectedRevision:this.#editRevision};
    const current=()=>sourceCurrent()&&Boolean(authorization&&this.store.authorizationScopeActive(authorization))
      &&this.#viewerCurrent===viewer&&Boolean(viewer?.())&&this.#activeId===artifact.id&&this.#editingId===artifact.id
      &&this.#editItems===editItems&&this.#editRevision===input.expectedRevision
      &&this.store.route.get()===route&&this.store.projection.get().projectId===projectId;
    if(!current())return;
    this.#savingEdit=true;this.requestUpdate();
    try{
      const saved=await this.store.reviseDocumentArtifact(artifact.id,input);
      if(!saved||!current())return;
      // A changed Save advances B only to the exact next canonical revision.
      // A server-verified no-op keeps the same revision and captured raw bytes.
      const revision=documentArtifactRevision(this.store.events.get(),artifact.id);
      let matches=false;
      try{
        const retained=JSON.parse(this.store.content.get()[artifact.contentRef??""]??"") as {
          content_markdown?:unknown;items?:Array<{title?:unknown;body?:unknown;notes?:unknown}>;
        };
        const unchanged=revision===input.expectedRevision&&this.store.content.get()[artifact.contentRef??""]===retainedBefore;
        matches=(revision===input.expectedRevision+1||unchanged)&&retained.content_markdown===input.markdown
          &&Array.isArray(retained.items)&&retained.items.length===input.items.length
          &&input.items.every((item,index)=>retained.items![index]?.title===item.title
            &&retained.items![index]?.body===item.body&&retained.items![index]?.notes===item.notes);
      }catch{/* Unverified retained bytes never authorize rebasing an unsaved draft. */}
      if(!matches)return;
      if(this.#editDraftRevision===draftRevision)this.#cancelArtifactEdit();
      else this.#editRevision=revision;
    }finally{this.#savingEdit=false;this.requestUpdate();}
  }
  async #loadHistory(artifact:DocumentArtifact,older=false){
    const sourceCurrent=this.#privateSourceCurrent(),viewer=this.#viewerCurrent;
    const current=()=>sourceCurrent()&&this.#viewerCurrent===viewer&&Boolean(viewer?.())&&this.#activeId===artifact.id;
    if(this.#historyBusy||!current())return;this.#historyOpen=true;this.#historyBusy=true;this.requestUpdate();
    try{const result=await this.store.artifactRevisions(artifact.id,older&&this.#revisionBefore!==null?this.#revisionBefore:undefined);
      if(result&&current()){this.#revisionHistory=older?[...this.#revisionHistory,...result.revisions]:result.revisions;this.#revisionBefore=result.nextBefore;}
    }finally{if(current()){this.#historyBusy=false;this.requestUpdate();}}
  }
  async #previewRevision(artifact:DocumentArtifact,revision:number){
    const sourceCurrent=this.#privateSourceCurrent(),viewer=this.#viewerCurrent;
    const current=()=>sourceCurrent()&&this.#viewerCurrent===viewer&&Boolean(viewer?.())&&this.#activeId===artifact.id;
    if(!current())return;const result=await this.store.artifactRevision(artifact.id,revision);
    if(result&&current()){this.#revisionPreview=result;this.requestUpdate();}
  }
  async #restoreRevision(artifact:DocumentArtifact,revision:number){if(this.#savingEdit)return;const current=documentArtifactRevision(this.store.events.get(),artifact.id);this.#savingEdit=true;this.requestUpdate();try{if(await this.store.restoreDocumentArtifact(artifact.id,revision,current)){this.#revisionPreview=null;await this.#loadHistory(artifact);}}finally{this.#savingEdit=false;this.requestUpdate();}}
  async #reviewArtifact(artifact:DocumentArtifact,type:"ArtifactReviewRequested"|"ArtifactApproved"|"ArtifactChangesRequested"){
    if(this.#editingId===artifact.id||this.#savingEdit)return;
    const sourceCurrent=this.#privateSourceCurrent(),authorization=this.store.captureAuthorizationScope(),viewer=this.#viewerCurrent;
    const route=this.store.route.get(),projectId=this.store.projection.get().projectId,draftRevision=this.#reviewIntentRevision;
    const reviewerId=this.#selectedReviewerId,note=type==="ArtifactChangesRequested"?this.#reviewNote.trim():"",sourceSurface=`${this.source}-artifact-review`;
    const current=()=>sourceCurrent()&&Boolean(authorization&&this.store.authorizationScopeActive(authorization))
      &&this.#viewerCurrent===viewer&&Boolean(viewer?.())&&this.#activeId===artifact.id
      &&this.store.route.get()===route&&this.store.projection.get().projectId===projectId
      &&this.#editingId!==artifact.id&&!this.#savingEdit;
    if(!current())return;
    const context=this.store.session.get()?.projectContext;
    if(context&&!context.permissions.includes("project.author")&&!(type!=="ArtifactReviewRequested"&&context.permissions.includes("project.review.approve")))return;
    const sourceBlocks=this.#artifactSourceBlocks(artifact);
    const review=artifactReviewState(artifact,sourceBlocks,this.store.events.get());
    if(type==="ArtifactApproved"&&["stale","unverified"].includes(review.status)){this.store.toast("Update or regenerate this output before approving unverifiable source decisions.");return;}
    if(type==="ArtifactApproved"&&context&&!context.permissions.includes("project.review.approve")){this.store.toast("Only a designated project reviewer can approve this output.");return;}
    if(context&&type==="ArtifactReviewRequested"&&!reviewerId){this.store.toast("Add an independent Viewer to this project and enable their approval permission before requesting review.");return;}
    if(type==="ArtifactChangesRequested"&&!note){this.store.toast("Describe the exact change the author needs to make.");return;}
    const approvedIds=new Set((artifactSourceVersions(artifact.id,this.store.events.get())??[]).map((value)=>String(value.block_id??"")));
    const payload={artifact_id:artifact.id,artifact_kind:artifact.kind,document_id:artifact.documentId,project_id:projectId,
      ...(context&&type==="ArtifactReviewRequested"?{assigned_reviewer_user_id:reviewerId}:{}),...(note?{review_note:note.slice(0,500)}:{}),
      source_block_versions:sourceBlocks.filter((block)=>approvedIds.has(block.id)).map((block)=>({block_id:block.id,version:block.sourceEvents.length})),source_surface:sourceSurface};
    const binding=await this.#artifactBinding(artifact);
    if(!current())return;
    if(!binding){this.store.toast("The latest finished output is unavailable for review.");return;}
    const appended=await this.store.append({type,payload:{...payload,...binding}});
    if(appended.length){
      if(sourceCurrent()&&authorization&&this.store.authorizationScopeActive(authorization)){
        void this.store.syncReviewInbox();void this.store.syncProjectNotifications();
      }
      if(!current()||this.#reviewIntentRevision!==draftRevision)return;
      if(type==="ArtifactChangesRequested"){this.#reviewNote="";this.#reviewIntentRevision++;this.requestUpdate();}
      this.store.toast(type==="ArtifactApproved"?"Output approved against its current source decisions.":type==="ArtifactChangesRequested"?"Changes requested and recorded for the project.":context?"The exact output revision was assigned to its independent reviewer.":this.i18n.t("artifact.delivery.reviewRequestedPersonal","Review requested for this exact output revision."));
    }
  }
  #preview(artifact:DocumentArtifact){const content=this.#content(artifact),items=this.#items(artifact);if(artifact.kind==="model3d")return html`<div class="artifact-model3d-preview"><span aria-hidden="true">${icon("layers")}</span><b>${this.i18n.t("model3d.label","3D model")}</b><p>${artifact.summary}</p></div>`;if(artifact.kind==="video"&&artifact.mediaUrl)return html`<video controls preload="metadata" src=${artifact.mediaUrl}></video>`;if(artifact.kind==="audio")return html`<div class="artifact-audio-preview"><span aria-hidden="true">${icon("audio")}</span><p>${artifact.summary}</p></div>`;if(artifact.kind==="storyboard")return html`<div class="artifact-storyboard-strip">${items.map((item)=>item.mediaUrl?this.#image(item):html`<span>${icon("image")}</span>`)}</div>`;if(artifact.kind==="slides"){const item=items[0]??{title:artifact.title,body:artifact.summary,notes:"",imagePrompt:"",slide:null};return html`<div class="artifact-slide-preview">${this.#slide({title:item.title,body:item.body,notes:item.notes,image_prompt:item.imagePrompt,slide:item.slide},content?.presentation??artifact.presentation,0,artifact.itemCount,true)}</div>`;}return html`<div class="artifact-text-preview"><span>${icon(kindIcon(artifact.kind))}</span><p>${artifact.summary}</p></div>`;}
  #createDialogTemplate(){
    if(this.#nativeStoryOpening)return this.#nativeStoryTemplate(this.#nativeStoryOpening);
    const definition=documentArtifactDefinition(this.#kind);
    const guidance=documentRenderGuidance({audience:this.#audience,tone:this.#tone});
    const guidanceIssue=(field:"audience"|"tone")=>guidance.issues.find(issue=>issue.field===field);
    const guidanceError=(field:"audience"|"tone")=>this.i18n.system("{field} is too long. Remove {excess} UTF-16 code units.",{field:this.i18n.system(field==="audience"?"Audience":"Tone"),excess:this.i18n.number(Math.max(0,guidance[field].length-DOCUMENT_RENDER_GUIDANCE_MAX_LENGTH))});
    const paid=this.#kind==="storyboard"||this.#kind==="video"||this.#kind==="audio"||this.#kind==="model3d";
    const session=this.store.session.get();
    const sceneView=this.#sceneCostView?.current()?this.#sceneCostView:null,scenePreview=this.#sceneFreshPreview();
    const model3dAdaptation=this.#kind==="model3d"?this.#model3dAdaptation():null;
    const model3dDocumentRevision=model3dAdaptation?this.store.documentGenerationRevision():"";
    const model3dValidation=model3dAdaptation?this.#model3dValidation(model3dAdaptation):null;
    const model3dUnavailable=this.#kind==="model3d"&&!session?.provider.model3dConfigured;
    const model3dBlocked=this.#kind==="model3d"&&(!model3dAdaptation?.valid||!model3dValidation?.valid||this.#model3dReferenceIssue());
    const renderedKind=this.#kind,configurationOpening=this.#configurationCurrent;
    const ownsOpening=()=>Boolean(configurationOpening&&this.#createOpen&&this.#configurationCurrent===configurationOpening&&this.#kind===renderedKind);
    const formCurrent=()=>this.isConnected&&ownsOpening()&&this.#createDialog()?.open===true&&Boolean(configurationOpening?.());
    // Native details toggle does not bubble; capture it on this form owner.
    const captureToggle={capture:true,handleEvent:(event:Event)=>this.#revealCreateFocus(event,formCurrent)};
    // One submit activation authorizes the prompt visible at dialog capture.
    // A render between capture and bubble cannot renew that event's approval.
    const captureSubmit={capture:true,handleEvent:(event:SubmitEvent)=>{
      if(renderedKind!=="model3d"&&this.#kind!=="model3d"||this.#model3dSubmitEvents.has(event))return;
      // No private payload: this refusal marker survives source clearing and consumption.
      this.#model3dSubmitEvents.add(event);
      const dialog=this.#createDialog(),form=event.target as HTMLFormElement|null;
      let basis:Model3dSubmitBasis|null=null;
      if(event.type==="submit"&&!event.defaultPrevented&&renderedKind==="model3d"&&this.#kind===renderedKind
        &&model3dAdaptation&&configurationOpening&&formCurrent()&&dialog&&event.currentTarget===dialog
        &&form?.isConnected&&form.parentElement===dialog&&dialog.querySelector(":scope > form.document-artifact-dialog")===form){
        basis=Object.freeze({adaptation:structuredClone(model3dAdaptation),revision:model3dDocumentRevision,
          opening:configurationOpening,form,dialog,kind:"model3d"});
      }
      // Retain a rejection too: later callbacks cannot replace a missing owner.
      this.#model3dSubmitBasis.set(event,basis);
    }};
    const submit=(event:SubmitEvent)=>{
      const captured=this.#model3dSubmitEvents.has(event),basis=this.#model3dSubmitBasis.get(event);
      this.#model3dSubmitBasis.delete(event);
      const canceled=event.defaultPrevented;event.preventDefault();
      if(captured||renderedKind==="model3d"||this.#kind==="model3d"){
        if(!basis||canceled||event.type!=="submit"||basis.kind!==renderedKind||this.#kind!==basis.kind
          ||basis.opening!==configurationOpening||basis.opening!==this.#configurationCurrent||!formCurrent()
          ||event.target!==basis.form||event.currentTarget!==basis.form||!basis.form.isConnected
          ||basis.dialog!==this.#createDialog()||!basis.dialog.open||basis.form.parentElement!==basis.dialog
          ||basis.dialog.querySelector(":scope > form.document-artifact-dialog")!==basis.form)return;
        void this.#create(basis.adaptation,basis.revision);return;
      }
      if(!formCurrent())return;
      if(renderedKind==="scene")void this.#submitScene(sceneView);else void this.#create(model3dAdaptation??undefined,model3dDocumentRevision);
    };
    const videoUnavailable=this.#kind==="video"&&!session?.provider.videoConfigured;const audioUnavailable=this.#kind==="audio"&&!session?.provider.audioConfigured;
    const references=videoReferencePreflight(this.#projection().blocks,this.store.events.get());
    const videoBlocked=this.#kind==="video"&&Boolean(references.rightsBlockedCount||references.unavailablePixelCount||this.#productionMode!=="managed"&&references.providerLimitExceededCount);
    const configuredVideoModel=references.providerPixelCount||this.#kind==="video"&&this.#productionMode==="managed"?(session?.provider.videoReferenceModel??DEFAULT_REFERENCE_VIDEO_MODEL):(session?.provider.videoModel??DEFAULT_VIDEO_MODEL);const configuredVideoLabel=configuredVideoModel===VIDEO_ADAPTER_CONTRACT.model?VIDEO_ADAPTER_CONTRACT.label:configuredVideoModel;
    const videoBlockedMessage=references.providerLimitExceededCount?this.i18n.system("Choose at most {count} pixel-backed references for {provider}; keep the remaining references description-only.",{count:this.i18n.number(references.providerReferenceLimit),provider:configuredVideoLabel}):references.unavailablePixelCount?this.i18n.system("The reference-to-video path is blocked because at least one selected pixel reference no longer has an available source image. Replace or re-upload it before rendering."):this.i18n.system("The reference-to-video path is blocked until every selected provider pixel reference has usable rights evidence.");
    const audioConfirmation=" "+(this.#sendSoundtrackToVideoProvider?this.i18n.t("audio.soundtrack.videoTransfer","Send this soundtrack to the video provider"):this.i18n.system(this.#videoAudioMode==="original_ambient"?"Original environmental ambience is enabled; the provider can still reject generated audio.":"The video is silent; soundtrack ideas stay available for post-production."));
    const videoResolution=this.#productionMode==="manual"?this.#restoredVideoResolution??VIDEO_ADAPTER_CONTRACT.defaultResolution:VIDEO_ADAPTER_CONTRACT.defaultResolution;
    const providerEstimate=configuredVideoModel===VIDEO_ADAPTER_CONTRACT.model?" "+this.i18n.system("Estimated provider render: {amount} at {resolution}; planning and final provider billing are separate.",{amount:"$"+(this.#seconds*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[videoResolution]/1_000_000).toFixed(2),resolution:videoResolution}):"";
    const videoConfirmation=(references.providerPath==="reference-to-video"?references.providerPixelCount===1?this.i18n.system("This starts a paid {seconds}-second reference-to-video render. {count} actual image will be sent to the provider; {descriptions} remain ordered description-only guidance.",{seconds:this.i18n.number(this.#seconds),count:this.i18n.number(references.providerPixelCount),descriptions:this.i18n.number(references.describeOnlyCount)}):this.i18n.system("This starts a paid {seconds}-second reference-to-video render. {count} actual images will be sent to the provider; {descriptions} remain ordered description-only guidance.",{seconds:this.i18n.number(this.#seconds),count:this.i18n.number(references.providerPixelCount),descriptions:this.i18n.number(references.describeOnlyCount)}):this.i18n.system("This starts a paid {seconds}-second prompt-only video render. No reference pixels will leave storage.",{seconds:this.i18n.number(this.#seconds)}))+audioConfirmation+providerEstimate;
    const projection=this.#projection();
    const soundtrackCandidates=projection.blocks.filter((block)=>block.type==="audio"&&Number(block.properties.weight??.5)>0&&block.properties.include_in_output===true&&Boolean(block.properties.media_url)&&Boolean(block.properties.reference_id)&&!audioFactProhibited({intent:block.properties.intent,effect:block.properties.effect,properties:block.properties}));
    const selectedSoundtrack=soundtrackCandidates.find((block)=>block.id===this.#soundtrackBlockIds[0]);
    const eligibleAudioImages=references.items.filter((item)=>item.sendsPixels&&item.rightsConfirmed);
    const eligibleAudioVideos=this.#kind==="audio"?this.#eligibleAudioVideos():[];
    const eligibleAudioVideoNames=new Map(describeOutputs(eligibleAudioVideos,{peers:projection.libraryArtifacts,events:this.store.events.get(),locale:this.i18n.locale,timeZone:this.i18n.timeZone,alwaysIncludeTake:true,formatTake:(take)=>this.#outputTake(take)}).map((result)=>[result.id,`${result.disambiguator} — ${result.title}`]));
    const selectedAudioVideo=eligibleAudioVideos.find((artifact)=>artifact.id===this.#audioVideoArtifactId);
    const audioProfile=this.#kind==="audio"?this.#audioRequestProfile():null;
    const audioSelection=audioProfile?this.#selectedAudioAdapter(audioProfile):null;
    const audioVideoGoal=audioProfile?.goal==="video_music"||audioProfile?.goal==="video_sound_effects";
    const audioVideoBlocked=Boolean(audioVideoGoal&&(!selectedAudioVideo||!this.#sendAudioVideoToProvider));
    const preciseAudioPrice=audioSelection?this.i18n.number(audioSelection.estimatedCostMicrousd/1_000_000,{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:6}):"";
    const soundtrackDuration=Number(selectedSoundtrack?.properties.duration_seconds??0),soundtrackBytes=Number(selectedSoundtrack?.properties.size_bytes??0);
    const estimatedTransferBytes=soundtrackDuration>VIDEO_AUDIO_REFERENCE_CONTRACT.maximumCombinedDurationSeconds&&soundtrackBytes?Math.ceil(soundtrackBytes*VIDEO_AUDIO_REFERENCE_CONTRACT.maximumCombinedDurationSeconds/soundtrackDuration)+512:soundtrackBytes;
    const soundtrackTransferEligible=Boolean(this.#kind==="video"&&this.#productionMode==="manual"&&selectedSoundtrack&&selectedSoundtrack.properties.allow_provider_audio_transfer===true&&references.providerPixelCount>0&&configuredVideoModel===VIDEO_ADAPTER_CONTRACT.model&&VIDEO_AUDIO_REFERENCE_CONTRACT.supportedMimeTypes.includes(String(selectedSoundtrack.properties.source_mime_type??selectedSoundtrack.properties.media_type??"") as typeof VIDEO_AUDIO_REFERENCE_CONTRACT.supportedMimeTypes[number])&&soundtrackDuration>0&&(!estimatedTransferBytes||estimatedTransferBytes<=VIDEO_AUDIO_REFERENCE_CONTRACT.maximumBytesPerReference));
    const outline=this.#kind==="slides"?this.#presentationOutline():null;
    const authoredSlideCount=outline?.authoredSlideCount??null;
    const planningSnapshot=this.#presentationPlanningSnapshot();
    const sourceContract=this.#kind==="slides"?buildPresentationSourceContract(planningSnapshot,{requestedSlideCount:this.#itemCount}):null;
    const minimumSlideCount=this.#kind==="slides"?minimumPresentationSlideCount(planningSnapshot):0;
    const unsupportedAuthoredSlideCount=authoredSlideCount!==null&&authoredSlideCount>MAX_MANAGED_PRESENTATION_SLIDES;
    const managedReferences=references.items.filter((item)=>item.sendsPixels&&item.rightsConfirmed).map((item)=>({referenceId:String(item.block.properties.reference_id??""),blockId:item.block.id,sequence:item.sequence,contextGroupIds:[],label:item.label}));
    let planningError=formatPresentationSourceIssues(sourceContract?.sourceIssues??[],this.i18n)||(this.#kind==="slides"&&this.#itemCount<minimumSlideCount?this.i18n.t("presentation.source.minimumSlides","At least {minimum} source-authored or separately isolated slides are required. Increase the requested slide count before generating.",{minimum:this.i18n.number(minimumSlideCount)}):"");
    let managedPlan:ReturnType<typeof buildManagedProductionPlan>|null=null;
    try{managedPlan=this.#productionMode==="managed"&&this.#kind!=="scene"&&this.#kind!=="model3d"&&!unsupportedAuthoredSlideCount?buildManagedProductionPlan(this.#kind,planningSnapshot,{references:managedReferences,...(this.#kind==="slides"?{requestedItemCount:this.#itemCount,requestedSlideCount:this.#itemCount}:{})}):null;}
    catch(error){planningError=planningError||(this.#kind==="slides"?formatPresentationSourceIssue({code:"presentation_source_unavailable"},this.i18n):error instanceof Error?error.message:"The presentation sources cannot be assigned to their requested slides.");}
    const managedEstimate=managedPlan?managedPlan.estimatedTotalCostMicrousd+(this.#kind==="storyboard"?managedPlan.scenes.length*1_000_000:this.#kind==="audio"?audioSelection?.estimatedCostMicrousd??0:0):0;
    // Reservation and UI budget gating match the existing Store/server default;
    // retained resolution affects only the provider-render estimate above.
    const estimatedCost=this.#kind==="model3d"?estimateModel3dCostMicrousd(this.#model3dSettings):this.#kind==="scene"?scenePreview?.maximumMicrousd??0:managedEstimate||this.#kind==="video"?managedEstimate||this.#seconds*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[VIDEO_ADAPTER_CONTRACT.defaultResolution]+1_000_000:this.#kind==="audio"?(audioSelection?.estimatedCostMicrousd??0)+1_000_000:this.#kind==="storyboard"?this.#itemCount*1_000_000+1_000_000:1_000_000;
    const preciseTotalAudioPrice=this.i18n.number(estimatedCost/1_000_000,{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:6});
    const budgetGate=generationBudgetGate(session?.costBudgets,{projectedMicrousd:estimatedCost});
    const predictedSlideCount=this.#kind==="slides"?(managedPlan?.predictedSlideCount??managedPlan?.scenes.length??this.#itemCount):null;
    const providerBatchCount=this.#kind==="slides"?(managedPlan?.providerBatchCount??1):0;
    const providerCallCount=this.#kind==="slides"?(managedPlan?.providerCallCount??1):0;
    const maximumProviderCallCount=this.#kind==="slides"?(managedPlan?.maximumProviderCallCount??2):0;
    const slideCountMismatch=!unsupportedAuthoredSlideCount&&authoredSlideCount!==null&&predictedSlideCount!==authoredSlideCount;
    const requestedCountMismatch=this.#kind==="slides"&&!unsupportedAuthoredSlideCount&&predictedSlideCount!==this.#itemCount;
    const availableManualSlideCounts=Array.from({length:15},(_,index)=>index+1);
    const slideProviderModel=session?.provider.plannerModel??session?.provider.model??"Configured text model";
    const generatedAnchor=this.#kind==="video"&&Boolean(managedPlan?.scenes.some((scene)=>!scene.referenceIds.length));
    const audioMaximumReservation=audioSelection?.contract.pricing.mode==="per_1000_characters"||audioSelection?.contract.pricing.mode==="per_minute";
    const paidConfirmation=this.#kind==="model3d"?this.i18n.t("model3d.cost.confirmation","This submits one paid Rodin 2.5 request to Fal and Hyper3D and reserves {amount}. Only the exact prompt and {count} selected images are sent. Provider content review still applies.",{amount:formatGenerationUsd(estimatedCost),count:this.i18n.number(this.#model3dReferenceBlockIds.length)}):this.#kind==="audio"?`${audioMaximumReservation?this.i18n.t("audio.provider.maximum","Maximum provider reservation: {amount}",{amount:preciseAudioPrice}):this.i18n.t("audio.provider.estimate","Estimated provider cost: {amount}",{amount:preciseAudioPrice})} · ${this.i18n.system("Total reserved: up to {amount}.",{amount:preciseTotalAudioPrice})}`:this.#kind==="video"&&managedPlan?(managedPlan.scenes.length===1?this.i18n.system("This starts {count} paid video scene totaling {seconds} seconds and reserves up to {amount}.",{count:this.i18n.number(managedPlan.scenes.length),seconds:this.i18n.number(managedPlan.totalDurationSeconds),amount:formatGenerationUsd(managedEstimate)}):this.i18n.system("This starts {count} paid video scenes totaling {seconds} seconds and reserves up to {amount}.",{count:this.i18n.number(managedPlan.scenes.length),seconds:this.i18n.number(managedPlan.totalDurationSeconds),amount:formatGenerationUsd(managedEstimate)}))+" "+(references.providerPixelCount?references.providerPixelCount===1?this.i18n.system("{count} authorized image may be sent to the provider; {descriptions} remain description-only.",{count:this.i18n.number(references.providerPixelCount),descriptions:this.i18n.number(references.describeOnlyCount)}):this.i18n.system("{count} authorized images may be sent to the provider; {descriptions} remain description-only.",{count:this.i18n.number(references.providerPixelCount),descriptions:this.i18n.number(references.describeOnlyCount)}):this.i18n.system("No existing user reference images are sent."))+(generatedAnchor?" "+this.i18n.system("Forma will generate and send an account-owned continuity image to the video provider."):"")+audioConfirmation:this.#kind==="video"?videoConfirmation+" "+this.i18n.system("Total reserved: up to {amount}.",{amount:formatGenerationUsd(estimatedCost)}):(managedPlan?.scenes.length??this.#itemCount)===1?this.i18n.system("This creates {count} paid storyboard frame, saves every finished image, and reserves up to {amount}.",{count:this.i18n.number(managedPlan?.scenes.length??this.#itemCount),amount:formatGenerationUsd(estimatedCost)}):this.i18n.system("This creates {count} paid storyboard frames, saves every finished image, and reserves up to {amount}.",{count:this.i18n.number(managedPlan?.scenes.length??this.#itemCount),amount:formatGenerationUsd(estimatedCost)});
    const documentId=this.#targetDocumentId();const listSuffix=documentId.replace(/[^a-z0-9_-]/gi,"-");const audienceListId=`document-artifact-audiences-${listSuffix}`,toneListId=`document-artifact-tones-${listSuffix}`;const audienceSuggestions=[...this.#rememberedAudiences,...documentRenderSuggestions(this.store.events.get(),documentId,"audience")].filter((value,index,all)=>all.findIndex((candidate)=>candidate.toLocaleLowerCase()===value.toLocaleLowerCase())===index).slice(0,12);const toneSuggestions=[...this.#rememberedTones,...documentRenderSuggestions(this.store.events.get(),documentId,"tone")].filter((value,index,all)=>all.findIndex((candidate)=>candidate.toLocaleLowerCase()===value.toLocaleLowerCase())===index).slice(0,12);
    const close=()=>{if(!ownsOpening())return;this.#rememberRequestDraft();this.#retireRequestReview();this.#configurationCurrent=null;if(renderedKind==="scene")this.#clearSceneCost();this.#createOpen=false;this.#activeWorkflowStageId="";this.#createDialog()?.close();void this.#restoreWorkflowRegeneration();this.requestUpdate();};
    return html`<dialog class="document-artifact-create" closedby="any" aria-labelledby="document-artifact-create-title" @submit=${captureSubmit} @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget&&event.currentTarget===this.#createDialog())close();}} @close=${(event:Event)=>{const dialog=event.currentTarget as HTMLDialogElement;if(dialog.open||dialog!==this.#createDialog())return;close();}}>
      <form class="document-artifact-dialog" @focusin=${(event:FocusEvent)=>this.#revealCreateFocus(event,formCurrent)} @toggle=${captureToggle} @input=${()=>{if(this.#requestReviewLoading)this.#retireRequestReview();}} @change=${()=>{if(this.#requestReviewLoading)this.#retireRequestReview();}} @submit=${submit}>
        <header><div><span>Render document</span><h2 id="document-artifact-create-title">Create another form of this work</h2><p>The same creative direction can become a story, presentation, storyboard, or video without changing the original document.</p></div><button type="button" class="icon-button" aria-label="Close" @click=${close}>${icon("close")}</button></header>
        <fieldset class="artifact-kind-picker" aria-label="Artifact type">${DOCUMENT_ARTIFACT_KINDS.map((kind)=>{const item=documentArtifactDefinition(kind);return html`<label class=${this.#kind===kind?"selected":""}><input type="radio" name="artifact-kind" value=${kind} .checked=${this.#kind===kind} @change=${()=>{this.#retireRequestReview();this.#selectArtifactKind(kind);if(kind==="slides"&&!this.#requestDrafts.has("slides"))this.#resetPresentationCount();this.#confirmed=false;this.requestUpdate();}}><span aria-hidden="true">${icon(kindIcon(kind))}</span><b>${this.i18n.system(item.label)}</b><small>${this.i18n.system(item.description)}</small></label>`;})}</fieldset>
        <section class="artifact-options">
          ${this.#kind==="audio"?html`<fieldset class="artifact-audio-goals"><legend>${this.i18n.t("audio.goal.heading","What would you like to create?")}</legend>${[
            {goal:"music",label:this.i18n.t("audio.goal.music","Original music")},
            {goal:"timed_music",label:this.i18n.t("audio.goal.timedMusic","Timed music")},
            {goal:"sound_effects",label:this.i18n.t("audio.goal.effects","Sound effects")},
            {goal:"narration",label:this.i18n.t("audio.goal.voice","Narration or dialogue")},
            {goal:"mixed_audio",label:this.i18n.t("audio.goal.radio","Produced audio scene")},
            {goal:"video_music",label:this.i18n.t("audio.goal.videoMusic","Music for video")},
            {goal:"video_sound_effects",label:this.i18n.t("audio.goal.videoEffects","Sound effects for video")},
          ].map((option)=>{const goal=option.goal as AudioGenerationGoal;const unavailable=(goal==="video_music"||goal==="video_sound_effects")&&!eligibleAudioVideos.length;return html`<label class=${`artifact-audio-goal${this.#audioGoal===goal?" selected":""}${unavailable?" unavailable":""}`}><input type="radio" name="artifact-audio-goal" value=${goal} .checked=${this.#audioGoal===goal} ?disabled=${unavailable} @change=${()=>this.#setAudioGoal(goal)}><b>${option.label}</b>${unavailable?html`<small>${this.i18n.t("audio.goal.videoUnavailable","Create and approve a video in this document to unlock synchronized audio.")}</small>`:nothing}</label>`;})}</fieldset>`:nothing}
          <div class="artifact-option-intro"><h3>${this.#kind==="scene"?this.#sceneVariantLabel(this.#sceneMedium):this.i18n.system(definition.label)}</h3><p>${this.#kind==="scene"?this.#sceneMediumDescription(this.#sceneMedium):this.i18n.system(definition.description)}</p></div>
          ${this.#kind!=="model3d"?html`<fieldset class="artifact-production-mode" aria-label="Production management"><legend>How should this be produced?</legend><label><input type="radio" name="artifact-production-mode" value="manual" .checked=${this.#productionMode==="manual"} @change=${()=>{this.#sceneDraftChanged();this.#productionMode="manual";this.#sendSoundtrackToVideoProvider=false;this.#storyboardManagedDefault=false;if(this.#kind==="storyboard")this.#storyboardManualOptOut=true;if(this.#kind==="slides")this.#resetPresentationCount("manual");this.#confirmed=false;this.requestUpdate();}}> Use my settings</label><label><input type="radio" name="artifact-production-mode" value="managed" .checked=${this.#productionMode==="managed"} ?disabled=${this.#kind==="audio"&&this.#audioGoal!=="music"} @change=${()=>{this.#sceneDraftChanged();this.#productionMode="managed";this.#sendSoundtrackToVideoProvider=false;this.#storyboardManagedDefault=false;if(this.#kind==="storyboard")this.#storyboardManualOptOut=false;if(this.#kind==="slides")this.#resetPresentationCount("managed");this.#confirmed=false;this.requestUpdate();}}> Use a structured production workflow</label></fieldset>`:nothing}
          ${this.#kind==="audio"?html`<div class="artifact-audio-settings">
            <label>${this.i18n.t("audio.settings.destination","Where will this be used?")}<select .value=${audioVideoGoal?"video":this.#audioDestination} ?disabled=${Boolean(audioVideoGoal)} @change=${(event:Event)=>{this.#audioDestination=(event.currentTarget as HTMLSelectElement).value as AudioDestination;this.#confirmed=false;this.requestUpdate();}}>${(["standalone","video","podcast","radio"] as const).map((destination)=>html`<option value=${destination}>${this.i18n.t(`audio.destination.${destination}`,destination==="standalone"?"Standalone audio":destination==="video"?"Video":destination==="podcast"?"Podcast":"Radio or advertisement")}</option>`)}</select></label>
            ${this.#audioGoal==="timed_music"||this.#audioGoal==="sound_effects"?html`<label>${this.i18n.t("audio.settings.duration","Duration in seconds")}<input type="number" min="1" max=${this.#audioGoal==="timed_music"?600:180} step="1" inputmode="numeric" .value=${this.#invalidAudioDuration?this.#audioDurationInput:String(this.#audioDuration)} @input=${(event:InputEvent)=>{const input=event.currentTarget as HTMLInputElement;const value=Number(input.value);const maximum=this.#audioGoal==="timed_music"?600:180;this.#audioDurationInput=input.value;this.#invalidAudioDuration=!input.value||!Number.isSafeInteger(value)||value<1||value>maximum;input.setCustomValidity(this.#invalidAudioDuration?this.i18n.t("audio.settings.duration","Duration in seconds"):"");if(!this.#invalidAudioDuration){this.#audioDuration=value;if(value>380)this.#audioInstrumental=false;}this.#audioImageBlockId="";this.#confirmed=false;this.requestUpdate();}}></label>`:nothing}
            ${this.#audioGoal==="narration"?html`<label>${this.i18n.t("audio.settings.speakers","Voices")}<select .value=${String(this.#audioSpeakerCount)} @change=${(event:Event)=>{this.#audioSpeakerCount=Number((event.currentTarget as HTMLSelectElement).value);this.#confirmed=false;this.requestUpdate();}}><option value="1">${this.i18n.t("audio.settings.oneSpeaker","One narrator")}</option><option value="2">${this.i18n.t("audio.settings.twoSpeakers","Two-person conversation")}</option></select></label>`:nothing}
            ${this.#audioGoal==="music"||this.#audioGoal==="timed_music"&&this.#audioDuration<=380?html`<label class="artifact-audio-preference"><input type="checkbox" .checked=${this.#audioInstrumental} @change=${(event:Event)=>{this.#audioInstrumental=(event.currentTarget as HTMLInputElement).checked;this.#audioImageBlockId="";this.#confirmed=false;this.requestUpdate();}}><span>${this.i18n.t("audio.settings.instrumental","Prefer instrumental music")}</span></label>`:nothing}
            ${audioVideoGoal?html`<label>${this.i18n.t("audio.settings.video","Approved video")}<select .value=${this.#audioVideoArtifactId} @change=${(event:Event)=>{this.#audioVideoArtifactId=(event.currentTarget as HTMLSelectElement).value;this.#sendAudioVideoToProvider=false;this.#confirmed=false;this.requestUpdate();}}><option value="">${this.i18n.t("audio.settings.chooseVideo","Choose an approved video")}</option>${eligibleAudioVideos.map((artifact)=>html`<option value=${artifact.id} dir="auto">${eligibleAudioVideoNames.get(artifact.id)??artifact.title} · ${this.i18n.number(documentArtifactPlaybackSeconds(artifact)??0)}s</option>`)}</select></label>${selectedAudioVideo?html`<label>${this.i18n.t("audio.settings.duration","Duration in seconds")}<input readonly .value=${this.i18n.number(documentArtifactPlaybackSeconds(selectedAudioVideo)??0)}></label><label class="artifact-audio-video-consent"><input type="checkbox" .checked=${this.#sendAudioVideoToProvider} @change=${(event:Event)=>{this.#sendAudioVideoToProvider=(event.currentTarget as HTMLInputElement).checked;this.#confirmed=false;this.requestUpdate();}}><span><b>${this.i18n.t("audio.settings.videoPermission","I authorize sending this approved video to the audio provider")}</b><small>${this.i18n.t("audio.settings.videoPermissionHint","The selected video, including any embedded sound, is sent to Fal and its specialist provider only for synchronization.")}</small></span></label>`:nothing}`:nothing}
          </div>`:nothing}
          ${this.#kind==="scene"?html`<fieldset class="artifact-scene-medium" aria-label=${this.i18n.t("scene.medium.label","Scene type")}><legend>${this.i18n.t("scene.medium.label","Scene type")}</legend>${(["visual","audio"] as const).map((medium)=>html`<label><input type="radio" name="artifact-scene-medium" value=${medium} .checked=${this.#sceneMedium===medium} ?disabled=${this.#workflowBusy} @change=${()=>void this.#selectSceneMedium(medium)}><span><b>${this.#sceneVariantLabel(medium)}</b><small>${this.#sceneMediumDescription(medium)}</small></span></label>`)}</fieldset>`:nothing}
          ${this.#productionMode==="manual"&&(this.#kind==="slides"||this.#kind==="storyboard")?html`<label>Number of ${this.#kind==="slides"?this.i18n.system("slides"):this.i18n.system("frames")}<select .value=${String(this.#itemCount)} @change=${(event:Event)=>{this.#itemCount=Number((event.target as HTMLSelectElement).value);this.#confirmed=false;this.requestUpdate();}}>${(this.#kind==="slides"?availableManualSlideCounts:[4,6,8,10,12]).map((count)=>html`<option value=${count} ?selected=${count===this.#itemCount}>${count}${this.#kind==="slides"&&count===authoredSlideCount?" " + this.i18n.system("· authored outline"):""}</option>`)}</select>${this.#kind==="slides"?html`<span>${this.i18n.t("output.delivery.manualSlideLimit", "Manual presentations support up to 15 slides in one provider request.")}</span>`:nothing}</label>`:nothing}
          ${this.#kind==="slides"&&this.#productionMode==="managed"?html`<label>Requested number of slides<input type="number" min="1" max=${MAX_MANAGED_PRESENTATION_SLIDES} step="1" inputmode="numeric" .value=${this.#invalidSlideCount?this.#managedSlideInput:String(this.#itemCount)} @input=${(event:InputEvent)=>{const input=event.currentTarget as HTMLInputElement;const value=Number(input.value);this.#managedSlideInput=input.value;this.#invalidSlideCount=!input.value||!Number.isInteger(value)||value<1||value>MAX_MANAGED_PRESENTATION_SLIDES;input.setCustomValidity(this.#invalidSlideCount?`Choose a whole number from 1 to ${MAX_MANAGED_PRESENTATION_SLIDES} slides.`:"");if(!this.#invalidSlideCount)this.#itemCount=value;this.#confirmed=false;this.requestUpdate();}}><span role=${this.#invalidSlideCount?"alert":"status"}>${this.#invalidSlideCount?this.i18n.system("Enter a whole number from 1 to {MAX_MANAGED_PRESENTATION_SLIDES}; a longer presentation cannot be exported as editable PowerPoint.", { MAX_MANAGED_PRESENTATION_SLIDES: this.i18n.number(MAX_MANAGED_PRESENTATION_SLIDES) }):this.i18n.system("Structured production can preserve longer authored presentations, up to the {MAX_MANAGED_PRESENTATION_SLIDES}-slide editable-export limit.", { MAX_MANAGED_PRESENTATION_SLIDES: this.i18n.number(MAX_MANAGED_PRESENTATION_SLIDES) })}</span></label>`:nothing}
          ${this.#kind==="slides"?html`<label>Presentation style<select .value=${this.#presentationStyle} @change=${(event:Event)=>{this.#presentationStyle=(event.currentTarget as HTMLSelectElement).value as SlideStylePresetId|"document";this.requestUpdate();}}><option value="document">Follow the authored document</option>${SLIDE_STYLE_PRESETS.map((preset)=>html`<option value=${preset.id}>${this.i18n.system(preset.label)} · ${this.i18n.system(preset.description)}</option>`)}</select><span>${this.#presentationStyle==="document"?this.i18n.system("Authored brand, color, and typography direction remains authoritative."):this.i18n.system("Apply the selected deck-wide palette and style without changing protected source facts.")}</span></label><label>Source fidelity<select .value=${this.#presentationFidelity} @change=${(event:Event)=>{this.#presentationFidelity=(event.currentTarget as HTMLSelectElement).value as "faithful"|"creative";this.requestUpdate();}}><option value="faithful">Preserve authored slides and evidence</option><option value="creative">Vary presentation, preserve protected facts</option></select><span>${this.#presentationFidelity==="faithful"?this.i18n.system("Preserve numbered slide order, attributed quotations, source evidence, numerical precision, and speaker notes."):this.i18n.system("Only narrative phrasing and layout may vary; attributed quotations, numerical facts, and source evidence remain protected.")}</span></label>`:nothing}
          ${this.#kind==="video"?html`${this.#productionMode==="manual"?html`<label>Length<select .value=${String(this.#seconds)} @change=${(event:Event)=>{this.#seconds=normalizeVideoDurationSeconds((event.target as HTMLSelectElement).value);this.#confirmed=false;this.requestUpdate();}}>${VIDEO_DURATION_SECONDS.map((seconds)=>html`<option value=${seconds}>${seconds} seconds</option>`)}</select></label>`:nothing}<label>Frame<select .value=${this.#videoSize} @change=${(event:Event)=>{this.#videoSize=(event.target as HTMLSelectElement).value as "1280x720"|"720x1280";this.#confirmed=false;this.requestUpdate();}}><option value="1280x720">Landscape · 16:9</option><option value="720x1280">Portrait · 9:16</option></select></label><label>${this.#sendSoundtrackToVideoProvider?this.i18n.t("audio.video.generatedLabel","Additional generated audio"):this.i18n.t("artifact.audio.label","Audio")}<select .value=${this.#videoAudioMode} @change=${(event:Event)=>{this.#videoAudioMode=(event.target as HTMLSelectElement).value as VideoAudioMode;this.#confirmed=false;this.requestUpdate();}}><option value="silent">${this.#sendSoundtrackToVideoProvider?this.i18n.t("audio.video.noAdditional","No added ambience"):this.i18n.system("Silent · recommended")}</option><option value="original_ambient">Original ambient sound · opt in</option></select><span>${this.#videoAudioMode==="original_ambient"?this.i18n.system("Original environmental sound only; no music or voices. Provider review can still reject audio."):this.#sendSoundtrackToVideoProvider?this.i18n.t("audio.video.providedHint","Only the approved soundtrack is requested; no additional ambience is requested."):this.i18n.system("Silent by default to prevent generated-soundtrack copyright failures.")}</span></label>`:nothing}
          ${["slides","storyboard","video"].includes(this.#kind)?html`<label class="artifact-soundtrack-picker"><span>${this.i18n.t("audio.soundtrack.label","Optional soundtrack")}</span><select ?disabled=${!soundtrackCandidates.length} .value=${this.#soundtrackBlockIds[0]??""} @change=${(event:Event)=>{const selected=(event.currentTarget as HTMLSelectElement).value;this.#soundtrackBlockIds=selected?[selected]:[];this.#sendSoundtrackToVideoProvider=false;this.#confirmed=false;this.requestUpdate();}}><option value="">${this.i18n.t("audio.soundtrack.none","No soundtrack")}</option>${soundtrackCandidates.map((block)=>html`<option value=${block.id}>${String(block.properties.label??block.handle)}</option>`)}</select>${!soundtrackCandidates.length?html`<small>${this.i18n.t("audio.soundtrack.empty","To add a soundtrack, enable Pair with finished outputs on an audio context block.")}</small>`:selectedSoundtrack?html`<small>${this.#sendSoundtrackToVideoProvider?this.i18n.t("audio.soundtrack.transferNotice","This recording is sent as an approved video-provider reference; the returned video may contain provider-interpreted audio."):this.i18n.t("audio.soundtrack.companionNotice","This soundtrack is played alongside the output; it is not embedded in exported PDF or video files.")}</small>`:nothing}</label>`:nothing}
          ${this.#kind==="video"&&this.#productionMode==="manual"&&selectedSoundtrack?html`<label class="artifact-soundtrack-transfer"><input type="checkbox" .checked=${this.#sendSoundtrackToVideoProvider} ?disabled=${!soundtrackTransferEligible} @change=${(event:Event)=>{this.#sendSoundtrackToVideoProvider=(event.currentTarget as HTMLInputElement).checked;this.#confirmed=false;this.requestUpdate();}}><span><b>${this.i18n.t("audio.soundtrack.videoTransfer","Send this soundtrack to the video provider")}</b><small>${this.i18n.t("audio.soundtrack.videoTransferNotice","Requires an approved image plus an MP3 or WAV clip of 15 seconds or less.")}${Number(selectedSoundtrack.properties.duration_seconds??0)>15?` ${this.i18n.t("audio.soundtrack.excerptNotice","Longer recordings send only an authenticated excerpt from the first 15 seconds.")}`:""}</small></span></label>`:nothing}
          ${this.#kind==="audio"&&audioSelection?.contract.maximumImageReferences&&eligibleAudioImages.length?html`<label><span>${this.i18n.system("Reference image")}</span><select .value=${this.#audioImageBlockId} @change=${(event:Event)=>{this.#audioImageBlockId=(event.currentTarget as HTMLSelectElement).value;this.#confirmed=false;this.requestUpdate();}}><option value="">${this.i18n.t("audio.image.none","No reference image")}</option>${eligibleAudioImages.map((image)=>html`<option value=${image.block.id}>${image.label}</option>`)}</select>${this.#audioImageBlockId?html`<small>${this.i18n.t("audio.image.transferNotice","Choosing an image sends its approved image pixels to Fal and Lyria 3 Pro through temporary provider storage.")}</small>`:nothing}</label>`:nothing}
          ${this.#kind!=="model3d"?html`
          <label>Audience <span>optional</span><input name="audience" list=${audienceListId} autocomplete="off" placeholder="Festival audience, client team…" aria-invalid=${String(Boolean(guidanceIssue("audience")))} aria-describedby=${`${audienceListId}-count${guidanceIssue("audience")?` ${audienceListId}-error`:""}`} .value=${this.#audience} @input=${(event:InputEvent)=>this.#guidanceInput("audience",(event.target as HTMLInputElement).value)}><small id=${`${audienceListId}-count`}>${this.i18n.system("{count}/{maximum} UTF-16 code units",{count:this.i18n.number(guidance.audience.length),maximum:this.i18n.number(DOCUMENT_RENDER_GUIDANCE_MAX_LENGTH)})}</small>${guidanceIssue("audience")?html`<small id=${`${audienceListId}-error`} role="alert">${guidanceError("audience")}</small>`:nothing}<datalist id=${audienceListId}>${audienceSuggestions.map((value)=>html`<option value=${value}></option>`)}</datalist></label>
          <label>Tone <span>optional</span><input name="tone" list=${toneListId} autocomplete="off" placeholder="Let the document decide" aria-invalid=${String(Boolean(guidanceIssue("tone")))} aria-describedby=${`${toneListId}-count${guidanceIssue("tone")?` ${toneListId}-error`:""}`} .value=${this.#tone} @input=${(event:InputEvent)=>this.#guidanceInput("tone",(event.target as HTMLInputElement).value)}><small id=${`${toneListId}-count`}>${this.i18n.system("{count}/{maximum} UTF-16 code units",{count:this.i18n.number(guidance.tone.length),maximum:this.i18n.number(DOCUMENT_RENDER_GUIDANCE_MAX_LENGTH)})}</small>${guidanceIssue("tone")?html`<small id=${`${toneListId}-error`} role="alert">${guidanceError("tone")}</small>`:nothing}<datalist id=${toneListId}>${toneSuggestions.map((value)=>html`<option value=${value}></option>`)}</datalist></label>
          `:nothing}
          ${model3dAdaptation?html`<forma-model3d-settings-editor .settings=${this.#model3dSettings} .prompt=${model3dAdaptation.prompt} prompt-source="document" .adaptation=${model3dAdaptation} .blockLabels=${Object.fromEntries(this.#projection().blocks.map(block=>[block.id,String(block.properties.label??block.handle)]))} .referenceCount=${this.#model3dReferenceBlockIds.length} .disabled=${this.#submitting} @model3d-settings-change=${(event:CustomEvent<{settings:Model3dSettings;prompt:string;valid:boolean}>)=>{if(!ownsOpening())return;this.#model3dSettings=event.detail.settings;this.#model3dDraftRevision++;this.#confirmed=false;this.requestUpdate();this.#revealModel3dLayoutFocus(event,formCurrent);}}></forma-model3d-settings-editor>`:nothing}
        </section>
        ${this.#kind!=="model3d"?html`<aside class="artifact-request-summary" aria-label=${this.i18n.system("Current request settings")}>
          <b>${this.i18n.system("Current request settings")}</b>
          ${this.#requestReviewLoading?html`<p role="status">${this.i18n.system("Loading the selected attempt’s request settings…")}</p>`:nothing}
          ${this.#restoredRequest?html`<p>${this.i18n.system("Settings restored from request {request}.",{request:this.#restoredRequest.jobId})}</p><p>${this.i18n.system("This is a new paid request using the current authorized document source. It does not resume or reconcile the previous request. Earlier charges and reservations remain unchanged.")}</p>${this.#restoredRequest.needsTransferConfirmation?html`<p>${this.i18n.system("Provider transfer requires fresh confirmation; the previous permission was not copied.")}</p>`:nothing}`:nothing}
          <dl><dt>${this.i18n.system("Source document")}</dt><dd dir="auto">${projection.documentTitle}</dd><dt>${this.i18n.system("Format")}</dt><dd>${this.i18n.system(definition.label)}</dd><dt>${this.i18n.system("Production management")}</dt><dd>${this.i18n.system(this.#productionMode==="managed"?"Use a structured production workflow":"Use my settings")}</dd><dt>${this.i18n.system("Audience")}</dt><dd dir="auto">${guidance.audience||this.i18n.system("Let the document decide")}</dd><dt>${this.i18n.system("Tone")}</dt><dd dir="auto">${guidance.tone||this.i18n.system("Let the document decide")}</dd>${this.#kind==="slides"?html`<dt>${this.i18n.system("Slides")}</dt><dd>${this.i18n.number(this.#itemCount)}</dd><dt>${this.i18n.system("Presentation style")}</dt><dd>${this.i18n.system(this.#presentationStyle==="document"?"Follow the authored document":SLIDE_STYLE_PRESETS.find(preset=>preset.id===this.#presentationStyle)?.label??this.#presentationStyle)}</dd><dt>${this.i18n.system("Source fidelity")}</dt><dd>${this.i18n.system(this.#presentationFidelity==="faithful"?"Preserve authored slides and evidence":"Vary presentation, preserve protected facts")}</dd>`:nothing}</dl>
          <small>${this.i18n.system("Each field allows up to {maximum} UTF-16 code units after trimming outer whitespace.",{maximum:this.i18n.number(DOCUMENT_RENDER_GUIDANCE_MAX_LENGTH)})}</small>
        </aside>`:nothing}
        ${this.#kind==="slides"?html`<aside class="video-provider-note artifact-presentation-preflight" aria-label="Presentation source and generation plan" aria-live="polite"><b>${unsupportedAuthoredSlideCount?this.i18n.system("Presentation unavailable · {authoredSlideCount} authored slides", { authoredSlideCount: this.i18n.number(authoredSlideCount) }):(predictedSlideCount===1 ? this.i18n.system("Predicted presentation · {predictedSlideCount} slide", { predictedSlideCount: typeof predictedSlideCount === "number" ? this.i18n.number(predictedSlideCount) : String(predictedSlideCount) }) : this.i18n.system("Predicted presentation · {predictedSlideCount} slides", { predictedSlideCount: typeof predictedSlideCount === "number" ? this.i18n.number(predictedSlideCount) : String(predictedSlideCount) }))}</b><p>${authoredSlideCount===null?this.i18n.system("No explicitly numbered slide outline was detected in the active document context."):(authoredSlideCount===1 ? (outline?.sections.length ? (outline.sections.length===1 ? this.i18n.system("{authoredSlideCount} explicitly numbered authored slide detected across {count} source section.", { authoredSlideCount: this.i18n.number(authoredSlideCount), count: this.i18n.number(outline.sections.length) }) : this.i18n.system("{authoredSlideCount} explicitly numbered authored slide detected across {count} source sections.", { authoredSlideCount: this.i18n.number(authoredSlideCount), count: this.i18n.number(outline.sections.length) })) : this.i18n.system("{authoredSlideCount} explicitly numbered authored slide detected.", { authoredSlideCount: this.i18n.number(authoredSlideCount) })) : (outline?.sections.length ? (outline.sections.length===1 ? this.i18n.system("{authoredSlideCount} explicitly numbered authored slides detected across {count} source section.", { authoredSlideCount: this.i18n.number(authoredSlideCount), count: this.i18n.number(outline.sections.length) }) : this.i18n.system("{authoredSlideCount} explicitly numbered authored slides detected across {count} source sections.", { authoredSlideCount: this.i18n.number(authoredSlideCount), count: this.i18n.number(outline.sections.length) })) : this.i18n.system("{authoredSlideCount} explicitly numbered authored slides detected.", { authoredSlideCount: this.i18n.number(authoredSlideCount) })))}</p>${unsupportedAuthoredSlideCount?html`<p role="alert"><b>${authoredSlideCount} authored slides exceed the ${MAX_MANAGED_PRESENTATION_SLIDES}-slide editable PowerPoint limit.</b> Divide the authored presentation before requesting generation; no provider call or reservation can be started.</p>`:slideCountMismatch||requestedCountMismatch?html`<p role="alert"><b>Authored and planned slide counts differ.</b> ${requestedCountMismatch?this.i18n.system("You requested {itemCount} slides, but the structured workflow will preserve all {predictedSlideCount} authored slides.", { itemCount: this.i18n.number(this.#itemCount), predictedSlideCount: String(predictedSlideCount) }):predictedSlideCount!==null&&authoredSlideCount!==null&&predictedSlideCount<authoredSlideCount?(authoredSlideCount-predictedSlideCount===1 ? this.i18n.system("{count} authored slide cannot fit this {predictedSlideCount}-slide manual plan. Choose a larger supported count or switch to structured production.", { count: this.i18n.number(authoredSlideCount-predictedSlideCount), predictedSlideCount: this.i18n.number(predictedSlideCount) }) : this.i18n.system("{count} authored slides cannot fit this {predictedSlideCount}-slide manual plan. Choose a larger supported count or switch to structured production.", { count: this.i18n.number(authoredSlideCount-predictedSlideCount), predictedSlideCount: this.i18n.number(predictedSlideCount) })):this.i18n.system("The {predictedSlideCount}-slide plan expands the {authoredSlideCount}-slide authored outline; added slides must remain source-grounded.", { predictedSlideCount: String(predictedSlideCount), authoredSlideCount: String(authoredSlideCount) })}</p>`:nothing}${outline?.slides.length?html`<details><summary>Inspect ${outline.slides.length} authored slide title${outline.slides.length===1?"":"s"}</summary><ol>${outline.slides.map((slide)=>html`<li><b>Slide ${slide.number}</b>${slide.title?html` · ${slide.title}`:nothing}</li>`)}</ol></details>`:nothing}</aside>`:nothing}
        ${sourceContract?.numberedOutline.some((slide)=>slide.sourceMode==="outline")?html`<aside class="video-provider-note artifact-presentation-outline-note"><p>${this.i18n.t("presentation.planning.outlineEvidence","Short outlines provide slide titles and coverage requirements. Supporting research is assigned separately; explicit source groups take priority. Unresolved source scope blocks generation before spending. Scene and other output specifications are excluded from Slides.")}</p></aside>`:nothing}
        ${planningError?html`<aside class="video-provider-note artifact-production-plan" role="alert"><b>${this.i18n.t("presentation.planning.attention","Presentation source placement needs attention")}</b><p>${planningError}</p><small>${this.i18n.t("presentation.planning.noProvider","No provider request or budget reservation will be started.")}</small></aside>`:nothing}
        ${managedPlan?html`<aside class="video-provider-note artifact-production-plan"><b>${this.i18n.system(productionTeamFor(this.#kind).label)}</b><p>${managedPlan.team.specialists.map((member)=>this.i18n.system(member.label)).join(" · ")}</p><p>${this.#kind==="video"?(managedPlan.scenes.length===1 ? this.i18n.system("{count} individually playable scene · {totalDurationSeconds} seconds total · each scene 15 seconds or less · up to {amount} reserved.", { count: this.i18n.number(managedPlan.scenes.length), totalDurationSeconds: this.i18n.number(managedPlan.totalDurationSeconds), amount: formatGenerationUsd(managedEstimate) }) : this.i18n.system("{count} individually playable scenes · {totalDurationSeconds} seconds total · each scene 15 seconds or less · up to {amount} reserved.", { count: this.i18n.number(managedPlan.scenes.length), totalDurationSeconds: this.i18n.number(managedPlan.totalDurationSeconds), amount: formatGenerationUsd(managedEstimate) })):this.#kind==="slides"?(providerBatchCount===1 ? this.i18n.system("{predictedSlideCount} source-grounded slides · {providerBatchCount} provider batch of up to 8 slides · {amount} initially reserved.", { predictedSlideCount: typeof predictedSlideCount === "number" ? this.i18n.number(predictedSlideCount) : String(predictedSlideCount), providerBatchCount: this.i18n.number(providerBatchCount), amount: formatGenerationUsd(managedEstimate) }) : this.i18n.system("{predictedSlideCount} source-grounded slides · {providerBatchCount} provider batches of up to 8 slides · {amount} initially reserved.", { predictedSlideCount: typeof predictedSlideCount === "number" ? this.i18n.number(predictedSlideCount) : String(predictedSlideCount), providerBatchCount: this.i18n.number(providerBatchCount), amount: formatGenerationUsd(managedEstimate) })):this.i18n.system("{count} context-led {label} · up to {amount} reserved.", { count: this.i18n.number(managedPlan.scenes.length), label: this.#kind==="storyboard" ? this.i18n.system("frames") : this.i18n.system("narrative movements"), amount: formatGenerationUsd(managedEstimate) })}</p>${this.#kind==="video"?html`<small>${managedPlan.anchorRationale} Existing authorized references run in parallel where possible. Transitions use text guidance; the provider does not support native start/end frame locks or extracted video frames. The completed result is an ordered scene reel.</small>`:nothing}</aside>`:nothing}
        ${this.#kind==="slides"&&!unsupportedAuthoredSlideCount?html`<aside class="artifact-cost-confirm artifact-presentation-provider-disclosure" aria-label="Paid presentation provider, source transmission, and cost"><span><b>Paid provider · OpenAI Responses · ${slideProviderModel}</b><small>${this.#productionMode==="managed"?(providerBatchCount===1 ? this.i18n.system("{providerBatchCount} planned provider batch", { providerBatchCount: this.i18n.number(providerBatchCount) }) : this.i18n.system("{providerBatchCount} planned provider batches", { providerBatchCount: this.i18n.number(providerBatchCount) })):this.i18n.system("1 planned provider request")}; ${providerCallCount} initial paid request${providerCallCount===1?"":"s"}, up to ${maximumProviderCallCount} total paid requests including bounded validation and continuity repairs. Initial reservation and application-enforced spending ceiling: ${formatGenerationUsd(estimatedCost)}. Forma blocks any request or repair whose conservative maximum would exceed this ceiling; it is not a provider-enforced cap. Actual provider usage is shown after completion.</small><small>Submitting transmits this document’s active, authorized source text, numbered slide instructions, stakeholder quotations, and numerical claims to OpenAI. Stable source identifiers remain private to Forma; request-local evidence aliases support source-grounded review.</small></span></aside>`:nothing}
        ${this.#kind==="scene"?html`${this.#sceneCostControls()}${renderSceneProviderDisclosure(this.i18n,{preview:sceneView?.inspection?.preview??null,existing:Boolean(sceneView?.inspection?.job)})}`:nothing}
        ${this.#kind==="audio"&&audioSelection?html`<aside class="artifact-cost-confirm artifact-audio-provider-disclosure" aria-label=${this.i18n.t("artifact.audio.label","Audio")} aria-live="polite"><span>
          <b>${audioMaximumReservation?this.i18n.t("audio.provider.maximum","Maximum provider reservation: {amount}",{amount:preciseAudioPrice}):this.i18n.t("audio.provider.estimate","Estimated provider cost: {amount}",{amount:preciseAudioPrice})}</b>
          <small>${audioVideoGoal?this.i18n.t("audio.settings.videoPermissionHint","The selected video, including any embedded sound, is sent to Fal and its specialist provider only for synchronization."):this.#audioImageBlockId?this.i18n.t("audio.image.transferNotice","Choosing an image sends its approved image pixels to Fal and Lyria 3 Pro through temporary provider storage."):this.i18n.t("audio.settings.textOnly","Only approved written creative direction is sent. Existing audio recordings stay private.")}</small>
          ${audioProfile?.goal==="narration"?html`<small>${this.i18n.t("audio.provider.voiceEstimate","Speech is billed at $0.05 per 1,000 actual script characters; the displayed amount is the maximum reservation.")}</small>`:audioProfile?.goal==="mixed_audio"?html`<small>${this.i18n.t("audio.provider.sceneEstimate","Produced scenes are billed at $0.1875 per generated minute; the displayed amount is the maximum reservation.")}</small>`:nothing}
          ${audioSelection.contract.watermark==="synthid"?html`<small>${this.i18n.t("audio.generation.watermark","Generated audio includes an embedded SynthID watermark.")}</small>`:nothing}
          <details class="artifact-audio-model-details"><summary>${this.i18n.t("audio.provider.details","Provider and model details")}</summary><small>${this.i18n.t("audio.provider.route","Selected specialist: {model}",{model:audioSelection.contract.label})} · ${audioSelection.contract.model}</small></details>
          ${audioUnavailable?html`<small role="alert">${this.i18n.t("audio.generation.unavailable","Audio generation is unavailable. Contact your workspace administrator.")}</small>`:nothing}
        </span></aside>`:nothing}
        ${this.#kind==="model3d"?html`${this.#model3dReferencePicker()}<aside class="video-provider-note model3d-provider-note"><b>${this.i18n.t("model3d.provider.heading","Provider · Fal / Hyper3D Rodin 2.5")}</b><p>${model3dUnavailable?this.i18n.t("model3d.provider.unavailable","3D generation is unavailable. Contact your workspace administrator."):this.i18n.t("model3d.provider.content","Use references you have permission to send. Keep the subject clearly visible and describe its shape and materials. Provider content checks apply to both prompts and images; acceptance cannot be guaranteed.")}</p><code>${model3dValidation?.model??""}</code></aside>`:nothing}
        ${this.#kind==="video"?html`<forma-video-reference-preflight .disabled=${this.#submitting} .source=${this.source} @video-reference-change=${()=>{this.#confirmed=false;this.requestUpdate();}} @video-reference-busy=${(event:CustomEvent<{busy:boolean}>)=>{this.#referenceBusy=event.detail.busy;this.#confirmed=false;this.requestUpdate();}}></forma-video-reference-preflight><aside class="video-provider-note"><b>Provider path · ${configuredVideoLabel}</b><p>${videoUnavailable?this.i18n.system("Video generation is unavailable. Contact your workspace administrator."):videoBlocked?videoBlockedMessage:generatedAnchor?(references.providerPixelCount ? (references.providerPixelCount===1 ? this.i18n.system("Fal will receive an account-owned generated continuity image on the reference-to-video path, alongside {providerPixelCount} authorized existing image. Every provider request and receipt remains inspectable.", { providerPixelCount: this.i18n.number(references.providerPixelCount) }) : this.i18n.system("Fal will receive an account-owned generated continuity image on the reference-to-video path, alongside {providerPixelCount} authorized existing images. Every provider request and receipt remains inspectable.", { providerPixelCount: this.i18n.number(references.providerPixelCount) })) : this.i18n.system("Fal will receive an account-owned generated continuity image on the reference-to-video path; no existing user reference images are sent. Every provider request and receipt remains inspectable.")):references.providerPath==="reference-to-video"?(references.providerPixelCount===1 ? this.i18n.system("Fal will upload {providerPixelCount} actual image to short-lived storage and send them to the adopted {configuredVideoLabel} adapter. Storyboard order is retained, authorized provenance is stated without identity-policy priming, and a pseudonymous end-user identifier accompanies the request. The prepared request and provider receipt remain inspectable.", { providerPixelCount: this.i18n.number(references.providerPixelCount), configuredVideoLabel: configuredVideoLabel }) : this.i18n.system("Fal will upload {providerPixelCount} actual images to short-lived storage and send them to the adopted {configuredVideoLabel} adapter. Storyboard order is retained, authorized provenance is stated without identity-policy priming, and a pseudonymous end-user identifier accompanies the request. The prepared request and provider receipt remain inspectable.", { providerPixelCount: this.i18n.number(references.providerPixelCount), configuredVideoLabel: configuredVideoLabel })):this.i18n.system("Fal will use {configuredVideoLabel} as the configured prompt-only video path. Reference descriptions and storyboard direction inform the prompt, but no image pixels are attached. The request and provider receipt remain inspectable.", { configuredVideoLabel: configuredVideoLabel })}</p></aside>`:nothing}
        ${budgetGate.level!=="none"&&(this.#kind!=="scene"||Boolean(scenePreview))?html`<aside class="artifact-cost-confirm"><span><b>${budgetGate.level==="blocked"?this.i18n.system("Monthly budget unavailable"):this.i18n.system("Monthly budget review")}</b><small>${budgetGate.level==="blocked"?this.i18n.system("This request exceeds the remaining {amount} {label} budget.", { amount: formatGenerationUsd(budgetGate.remainingMicrousd), label: budgetGate.scope==="workspace" ? this.i18n.system("organization") : this.i18n.system("personal") }):this.i18n.system("{percent}% of the {label} budget would be committed. {amount} remains before this request.", { percent: this.i18n.number(Math.round(budgetGate.projectedUtilization*100)), label: budgetGate.scope==="workspace" ? this.i18n.system("organization") : this.i18n.system("personal"), amount: formatGenerationUsd(budgetGate.remainingMicrousd) })}</small></span></aside>`:nothing}
        ${paid?html`<aside class="artifact-cost-confirm"><span><b>Production cost and provider disclosure</b><small>${paidConfirmation}${this.#kind==="storyboard"&&this.#productionMode==="managed"&&references.providerPixelCount?(references.providerPixelCount===1 ? " " + this.i18n.system("{providerPixelCount} authorized source image may be used as scoped frame references; completed frames can guide later images.", { providerPixelCount: this.i18n.number(references.providerPixelCount) }) : " " + this.i18n.system("{providerPixelCount} authorized source images may be used as scoped frame references; completed frames can guide later images.", { providerPixelCount: this.i18n.number(references.providerPixelCount) })):""}</small></span></aside>`:nothing}
        <footer><button type="button" class="button ghost" @click=${close}>Cancel</button><button class="button primary" ?disabled=${this.#requestReviewLoading||this.#kind!=="model3d"&&guidance.issues.length>0||this.#submitting||Boolean(this.#sceneSubmitting?.formCurrent())||this.#workflowBusy||this.#referenceBusy||this.#kind==="scene"&&(!scenePreview||!this.#sceneCanCreate())||unsupportedAuthoredSlideCount||Boolean(planningError)||requestedCountMismatch||this.#kind==="slides"&&this.#productionMode==="managed"&&this.#invalidSlideCount||this.#kind==="audio"&&this.#invalidAudioDuration||audioVideoBlocked||videoUnavailable||audioUnavailable||videoBlocked||model3dUnavailable||model3dBlocked||this.#sendSoundtrackToVideoProvider&&!soundtrackTransferEligible||budgetGate.level==="blocked"}>${this.#submitting||this.#sceneSubmitting?.formCurrent()?this.i18n.system("Adding to the queue…"):this.#referenceBusy?this.i18n.system("Saving reference modes…"):this.#kind==="model3d"?this.i18n.t("model3d.create.paid","Approve cost and generate 3D model"):this.#productionMode==="managed"?this.i18n.t("artifact.create.workflow","Start {kind} workflow",{kind:this.#kind==="scene"?this.#sceneVariantLabel(this.#sceneMedium):this.i18n.system(productionTeamFor(this.#kind).label)}):this.i18n.t("artifact.create.kind","Create {kind}",{kind:this.#kind==="scene"?this.#sceneVariantLabel(this.#sceneMedium):this.i18n.t(`artifact.${this.#kind}.label`,definition.label)})}</button></footer>
      </form>
    </dialog>`;
  }
  #videoReel(artifact:DocumentArtifact,items:DocumentArtifactItem[]){
    return renderVideoReel(items,artifact.mediaUrl,artifact.title,this.i18n);
  }
  #reviewLabel(review:ReturnType<typeof artifactReviewState>){
    const status=review.status==="stale"&&review.label.startsWith("Approval expired")?"staleApproved":review.status==="draft"&&review.label.startsWith("Edited")?"edited":review.status;
    return this.i18n.t(`artifact.review.${status}.label`,this.i18n.system(review.label));
  }
  #productionDesk(artifacts:DocumentArtifact[],jobs:DocumentJob[]){
    const managed=artifacts.filter((artifact)=>artifact.settings.production_mode==="managed");
    const running=jobs.filter((job)=>job.productionMode==="managed");
    if(!managed.length&&!running.length)return nothing;
    const basisLabels:Record<string,string>={"rendered-text":"Returned writing","rendered-slides":"Returned slides","provider-image-receipt":"Completed image receipts","provider-video-receipt":"Completed video receipts","provider-audio-receipt":this.i18n.t("production.audioReceipt","Completed audio receipt"),"plan-proxy":"Plan only"};
    return html`<section class="document-production-desk" aria-labelledby=${`production-desk-${this.#targetDocumentId()}`}>
      <header><div><span class="eyebrow">${this.i18n.t("production.eyebrow","Managed production")}</span><h3 id=${`production-desk-${this.#targetDocumentId()}`}>${this.i18n.t("production.heading","How your work was produced")}</h3><p>${this.i18n.t("production.description","See your production team, completed work, actual charge, and what the available evidence can honestly support.")}</p></div></header>
      ${running.length?html`<p class="document-production-running" role="status">${this.i18n.t("production.running","{count} managed production in progress",{count:this.i18n.number(running.length)})}</p>`:nothing}
      ${managed.length?html`<ol class="document-production-list">${managed.slice(0,this.compact?3:6).map((artifact)=>{const history=this.store.events.get(),summary=creatorProductionSummary(artifact,history),session=this.store.session.get(),completed=history.find((event)=>event.eventId===artifact.sourceEventId),requested=[...history].reverse().find((event)=>event.type==="DocumentRenderRequested"&&String(event.payload.artifact_id??"")===artifact.id),requester=String(completed?.payload.requested_by_user_id??(requested?.actor.startsWith("user:")?requested.actor.slice(5):"")),productionOwner=Boolean(session&&!session.impersonation&&(!session.projectContext||requester===session.user.userId));return html`<li><div class="document-production-identity"><b>${artifact.title}</b><span>${this.i18n.system(summary.teamLabel??documentArtifactDefinition(artifact.kind).label)}</span></div><div class="document-production-facts"><span>${this.i18n.t("production.units","{count} completed units",{count:this.i18n.number(summary.itemCount)})}</span>${productionOwner&&summary.actualMicrousd!==null?html`<span>${this.i18n.t("production.actual","Charged {amount}",{amount:formatGenerationUsd(summary.actualMicrousd)})}</span>`:nothing}${productionOwner&&summary.reservedMicrousd!==null?html`<span>${this.i18n.t("production.reserved","Initially reserved: {amount}",{amount:formatGenerationUsd(summary.reservedMicrousd)})}</span>`:nothing}</div><details><summary>${this.i18n.t("production.evidence","Review production evidence")}</summary>${summary.specialists.length?html`<p><b>${this.i18n.t("production.specialists","Specialist responsibilities")}</b> ${summary.specialists.map((specialist)=>this.i18n.system(specialist)).join(" · ")}</p>`:nothing}${summary.evidenceBasis?html`<p><b>${this.i18n.t("production.basis","Evidence basis")}</b> ${this.i18n.system(basisLabels[summary.evidenceBasis]??summary.evidenceBasis)}${summary.measuredWeight!==null?" " + this.i18n.system("· {percent}% of applicable quality dimensions measured", { percent: this.i18n.number(Math.round(summary.measuredWeight*100)) }):""}</p>`:nothing}${(artifact.kind==="video"||artifact.kind==="storyboard")&&!summary.mediaInspected?html`<p class="document-production-limitation">${this.i18n.t("production.visualUnverified","Visual quality and continuity were not inspected.")}</p>`:nothing}${artifact.kind==="audio"&&!summary.mediaInspected?html`<p class="document-production-limitation">${this.i18n.t("production.audioUnverified","Musical quality, originality, and continuity were not inspected.")}</p>`:nothing}${summary.delivery==="scene-reel"?html`<p class="document-production-limitation">${this.i18n.t("production.sceneReel","Delivered as individually playable scenes; a combined MP4 is not available.")}</p>`:nothing}${summary.audioMode?html`<p>${summary.audioMode==="provided_soundtrack_and_original_ambient"?this.i18n.t("production.providedSoundtrackAndAmbient","The approved soundtrack and original environmental ambience were requested separately."):summary.audioMode==="provided_soundtrack"?this.i18n.t("production.providedSoundtrack","The explicitly approved soundtrack was sent to the video provider."):summary.audioMode==="original_ambient"?this.i18n.t("production.ambientAudio","Original environmental audio was requested."):this.i18n.t("production.silentAudio","The video was produced without audio.")}</p>`:nothing}</details></li>`;})}</ol>`:nothing}
    </section>`;
  }
  #workflowSceneMediumControl(workflow:ProductionWorkflow,stage:ProductionWorkflowStage,canEdit:boolean){
    const sceneConfiguration=productionWorkflowSceneConfiguration(workflow,stage.id);
    if(!sceneConfiguration)return nothing;
    const selected=stage.sceneMedium??"auto";
    return html`<label class="production-workflow-source production-workflow-scene-medium"><span>${this.i18n.t("scene.medium.label","Scene type")}</span><select .value=${selected} ?disabled=${this.#workflowBusy||!canEdit} @change=${(event:Event)=>{
      const value=(event.currentTarget as HTMLSelectElement).value;
      if(value!=="auto"&&!isSceneMedium(value))return;
      const medium:"auto"|SceneMedium=value==="auto"?"auto":value;
      const nextWorkflow:ProductionWorkflow={...workflow,stages:workflow.stages.map((candidate)=>candidate.id===stage.id?{...candidate,sceneMedium:medium}:candidate)};
      const changed=productionWorkflowSceneConfiguration(nextWorkflow,stage.id)?.medium!==sceneConfiguration.medium;
      void this.#updateWorkflowStage(workflow,stage.id,(current)=>({...current,sceneMedium:medium,...(changed?{source:null}:{})}));
    }}>${(["auto","visual","audio"] as const).map((medium)=>html`<option value=${medium}>${this.#sceneMediumLabel(medium)}</option>`)}</select><small>${this.#sceneVariantLabel(sceneConfiguration.medium)} · ${this.#workflowFormatLabel(workflow.target)}</small></label>`;
  }
  #productionWorkflow(){
    const projection=this.#projection(),project=this.store.session.get()?.projectContext,history=this.store.events.get(),retained=this.store.content.get();
    const canEdit=!project||project.permissions.includes("project.author")&&project.permissions.includes("project.output.request");
    const workflow=this.#currentWorkflow();
    if(!workflow&&!canEdit)return nothing;
    const states=workflow?productionWorkflowStageStates(workflow,projection,this.store.events.get(),this.#runningWorkflowStages(workflow)):[];
    const final=states.at(-1);
    const formats:ProductionFormat[]=["image",...DOCUMENT_ARTIFACT_KINDS];
    return html`<details class=${`production-workflow${this.compact?" production-workflow--compact":""}`} ?open=${this.#workflowExpanded??(Boolean(workflow)&&!this.compact)} @toggle=${(event:Event)=>{this.#workflowExpanded=(event.currentTarget as HTMLDetailsElement).open;}}>
      <summary><span><b>${this.i18n.t("workflow.heading","Production path")}</b><small>${workflow?this.#workflowFormatLabel(workflow.target):this.i18n.t("workflow.description","Choose only the stages that improve this final result.")}</small></span>${workflow&&final?html`<span class=${`production-workflow-status production-workflow-status--${final.status}`} aria-live="polite">${this.i18n.t(`workflow.status.${final.status}`,final.status)}</span>`:html`<span class="production-workflow-entry">${this.i18n.t("workflow.enable","Prepare this output in stages")}</span>`}<span class="production-workflow-disclosure" aria-hidden="true">${icon("next")}</span></summary>
      <form class="production-workflow-form" @submit=${(event:SubmitEvent)=>{event.preventDefault();if(workflow&&final)void this.#launchWorkflowStage(workflow,final.stage);else void this.#createWorkflow();}}>
        <header class="production-workflow-header"><label>${this.i18n.t("workflow.final","Final deliverable")}<select .value=${workflow?.target??this.#workflowTarget} ?disabled=${this.#workflowBusy||!canEdit} @change=${(event:Event)=>{this.#workflowTarget=(event.currentTarget as HTMLSelectElement).value as ProductionFormat;this.#workflowTargetSelected=true;this.#workflowExpanded=true;this.#activeWorkflowId="";this.#activeWorkflowStageId="";this.#workflowRisk=null;this.requestUpdate();}}>${formats.map((format)=>html`<option value=${format} ?selected=${format===(workflow?.target??this.#workflowTarget)}>${this.#workflowFormatLabel(format)}</option>`)}</select></label><p>${this.i18n.t("workflow.description","Choose only the stages that improve this final result.")}</p></header>
        ${workflow?html`<ol class="production-workflow-stages" aria-live="polite">${states.map((state,index)=>{
          const {stage}=state;
          const sceneConfiguration=stage.format==="scene"?productionWorkflowSceneConfiguration(workflow,stage.id):null;
          const documentTitle=projection.documents.find((document)=>document.id===workflow.documentId)?.title??projection.documentTitle;
          const imageOutputs=projection.libraryOutputs.filter((output)=>output.documentId===workflow.documentId);
          const imagePeers=imageOutputs.map((output)=>imageOutputNamingCandidate(output,retained,documentTitle));
          const artifactPeers=projection.libraryArtifacts.filter((artifact)=>artifact.documentId===workflow.documentId&&artifact.kind===stage.format);
          const visible=stage.format==="image"
            ?imagePeers.filter((candidate)=>imageOutputs.some((output)=>output.id===candidate.id&&!output.discarded&&Boolean(output.mediaUrl)))
            :artifactPeers.filter((artifact)=>!sceneConfiguration||this.#artifactSceneConfiguration(artifact)?.medium===sceneConfiguration.medium);
          const candidates=describeOutputs(visible,{peers:stage.format==="image"?imagePeers:artifactPeers,events:history,locale:this.i18n.locale,timeZone:this.i18n.timeZone,includeTimestamp:true,alwaysIncludeTake:true,formatTake:(take)=>this.#outputTake(take),formatKind:(kind)=>this.#workflowFormatLabel(kind)});
          const selectedCandidate=candidates.find((candidate)=>candidate.id===stage.source?.outputId);
          const sourceDescriptionId=`production-workflow-source-${workflow.id}-${stage.id}`;
          const enabledDependencies=state.dependencies.filter((dependency)=>dependency.stage.enabled).map((dependency)=>{
            const configuration=dependency.stage.format==="scene"?productionWorkflowSceneConfiguration(workflow,dependency.stage.id):null;
            return configuration?this.#sceneVariantLabel(configuration.medium):this.#workflowFormatLabel(dependency.stage.format);
          });
          const canCreate=canEdit&&stage.enabled&&["missing","ready"].includes(state.status);
          const dependenciesReady=state.dependencies.filter((dependency)=>dependency.stage.enabled).every((dependency)=>["selected","approved","complete","skipped"].includes(dependency.status));
          const canRegenerate=canEdit&&!stage.final&&stage.enabled&&Boolean(stage.source)&&dependenciesReady
            &&["selected","approved","needs-review","changes-requested","stale"].includes(state.status);
          return html`<li class=${`production-workflow-stage production-workflow-stage--${state.status}`}>
            <div class="production-workflow-stage-heading"><span class="production-workflow-stage-icon" aria-hidden="true">${icon(stage.format==="image"?"image":kindIcon(stage.format))}</span><div><span class="production-workflow-stage-kicker">${stage.final?this.i18n.t("workflow.final","Final deliverable"):this.i18n.t("workflow.step","Stage {number}",{number:this.i18n.number(index+1)})}${stage.optional?` · ${this.i18n.t("workflow.optional","Optional")}`:""}</span><h4>${sceneConfiguration?this.#sceneVariantLabel(sceneConfiguration.medium):this.#workflowFormatLabel(stage.format)}</h4><p>${sceneConfiguration?this.#sceneMediumDescription(sceneConfiguration.medium):this.i18n.t(`workflow.reason.${stage.format}`,stage.format)}</p>${enabledDependencies.length?html`<small>${this.i18n.t("workflow.inputs","Uses {formats}",{formats:enabledDependencies.join(" · ")})}</small>`:nothing}</div><span class=${`production-workflow-status production-workflow-status--${state.status}`}>${this.i18n.t(`workflow.status.${state.status}`,state.status)}</span></div>
            ${!stage.final?html`<div class="production-workflow-stage-controls"><label class="production-workflow-toggle"><input type="checkbox" .checked=${stage.enabled} ?disabled=${this.#workflowBusy||!canEdit} @change=${(event:Event)=>void this.#updateWorkflowStage(workflow,stage.id,(current)=>({...current,enabled:(event.currentTarget as HTMLInputElement).checked}))}>${this.i18n.t("workflow.include","Include this stage")}</label>${stage.enabled?html`${sceneConfiguration?this.#workflowSceneMediumControl(workflow,stage,canEdit):nothing}<label class="production-workflow-source">${this.i18n.t("workflow.source","Use an existing result")}<select .value=${stage.source?.outputId??""} aria-describedby=${sourceDescriptionId} ?disabled=${this.#workflowBusy||!canEdit} @change=${(event:Event)=>void this.#selectWorkflowSource(workflow,stage,(event.currentTarget as HTMLSelectElement).value)}><option value="">${this.i18n.t("workflow.choose","Choose an output")}</option>${candidates.map((candidate)=>html`<option value=${candidate.id} title=${candidate.label} dir="auto">${candidate.label}</option>`)}</select><small id=${sourceDescriptionId} class="production-workflow-source-detail" dir="auto">${selectedCandidate?.secondaryLabel?`${selectedCandidate.secondaryLabel} · `:""}${this.i18n.t("workflow.sourceNamingHelp","Each take is a separate result. Renaming changes its name, never its content or approval.")}</small></label>${stage.format!=="image"?html`<label class="production-workflow-toggle"><input type="checkbox" .checked=${stage.approvalRequired} ?disabled=${workflow.approvalRequired||this.#workflowBusy||!canEdit} @change=${(event:Event)=>void this.#updateWorkflowStage(workflow,stage.id,(current)=>{const approvalRequired=(event.currentTarget as HTMLInputElement).checked;return{...current,approvalRequired,source:current.source?{...current.source,approvalRequired}:null};})}>${this.i18n.t("workflow.review","Require approval before continuing")}</label>`:nothing}${stage.format==="audio"&&stage.source?html`<label class="production-workflow-toggle"><input type="checkbox" .checked=${stage.source.allowTextGuidance} ?disabled=${this.#workflowBusy||!canEdit} @change=${(event:Event)=>void this.#updateWorkflowStage(workflow,stage.id,(current)=>({...current,source:current.source?{...current.source,allowTextGuidance:(event.currentTarget as HTMLInputElement).checked}:null}))}>${this.i18n.t("workflow.audioGuidance","Use written musical direction")}</label><small class="production-workflow-notice">${this.i18n.t("workflow.audioNotice","Only written musical descriptions inform the next stage. Audio is never attached or sent.")}</small>`:nothing}${stage.format==="image"?html`<small class="production-workflow-notice">${this.i18n.t("workflow.imageNotice","Selected images provide description-only guidance. Image pixels are never sent automatically.")}</small>`:nothing}<div class="production-workflow-actions">${state.artifact?html`<button type="button" class="button secondary compact" @click=${()=>void this.#openArtifact(state.artifact!,undefined,undefined,{intent:"review"})}>${this.i18n.t("workflow.open","Open and review")}</button>`:nothing}${canCreate?html`<button type="button" class="button secondary compact" ?disabled=${this.#workflowBusy} @click=${()=>void this.#launchWorkflowStage(workflow,stage)}>${this.i18n.t("workflow.create","Create {kind}",{kind:sceneConfiguration?this.#sceneVariantLabel(sceneConfiguration.medium):this.#workflowFormatLabel(stage.format)})}</button>`:nothing}${canEdit?html`<button type="button" class="icon-button" aria-label=${this.i18n.t("workflow.moveEarlier","Move stage earlier")} ?disabled=${index===0||moveProductionWorkflowStage(workflow,stage.id,-1)===workflow||this.#workflowBusy} @click=${()=>void this.#saveWorkflow(moveProductionWorkflowStage(workflow,stage.id,-1))}>${icon("previous")}</button><button type="button" class="icon-button" aria-label=${this.i18n.t("workflow.moveLater","Move stage later")} ?disabled=${index>=workflow.stages.length-2||moveProductionWorkflowStage(workflow,stage.id,1)===workflow||this.#workflowBusy} @click=${()=>void this.#saveWorkflow(moveProductionWorkflowStage(workflow,stage.id,1))}>${icon("next")}</button>`:nothing}</div>`:nothing}</div>`:sceneConfiguration?html`<div class="production-workflow-stage-controls">${this.#workflowSceneMediumControl(workflow,stage,canEdit)}</div>`:stage.format==="video"?html`<small class="production-workflow-notice">${this.i18n.t("production.sceneReel","Delivered as individually playable scenes; a combined MP4 is not available.")}</small>`:nothing}
            ${state.inputFreshness==="changed"||canRegenerate?html`<div class="production-workflow-stage-controls">
              ${state.inputFreshness==="changed"?html`<small class="production-workflow-notice" role="status">${this.i18n.t("workflow.inputsChanged","Earlier stage inputs changed. Regenerate this output to continue with the latest production path.")}</small>`:nothing}
              ${canRegenerate?html`<div class="production-workflow-actions"><button type="button" class="button secondary compact" ?disabled=${this.#workflowBusy} @click=${()=>void this.#regenerateWorkflowStage(workflow,stage)}>${this.i18n.t("workflow.regenerate","Regenerate {kind}",{kind:sceneConfiguration?this.#sceneVariantLabel(sceneConfiguration.medium):this.#workflowFormatLabel(stage.format)})}</button></div>`:nothing}
            </div>`:nothing}
          </li>`;
        })}</ol>`:nothing}
        ${workflow&&this.#workflowRisk?.workflowId===workflow.id&&states.some((state)=>state.stage.id===this.#workflowRisk?.stageId&&this.store.productionWorkflowGenerationRequestKey(workflow.id,state.stage.id,productionWorkflowSourcesForStage(workflow,state.stage.id,states))===this.#workflowRisk.requestKey)?html`<aside class="production-workflow-risk" role="alert"><p>${this.#workflowRisk.summary}</p><button type="button" class="button secondary compact" @click=${()=>{const risk=this.#workflowRisk;if(!risk)return;const stage=workflow.stages.find((candidate)=>candidate.id===risk.stageId);if(!stage)return;this.store.acknowledgeGenerationRisk(risk.requestKey);this.#workflowRisk=null;void this.#launchWorkflowStage(workflow,stage);}}>${this.i18n.t("impersonation.continue","I understand, continue")}</button></aside>`:nothing}
        ${workflow&&final?.artifact?html`<section class="production-workflow-deliverable" aria-label=${this.i18n.t("workflow.final","Final deliverable")}><header><b>${final.artifact.title}</b><span class=${`production-workflow-status production-workflow-status--${final.status}`}>${this.i18n.t(`workflow.status.${final.status}`,final.status)}</span></header><div class="production-workflow-deliverable-preview">${this.#preview(final.artifact)}</div></section>`:nothing}
        ${workflow&&final?.image?.mediaUrl?html`<img class="production-workflow-image" src=${final.image.mediaUrl} alt=${this.i18n.t("workflow.final","Final deliverable")} loading="lazy">`:nothing}
        <footer class="production-workflow-footer"><small>${this.i18n.t("workflow.guarantee","Your original document stays unchanged. Nothing runs, spends budget, or sends media until you approve each stage.")}</small>${canEdit&&!final?.artifact&&!final?.image?html`<button type="submit" class="button primary compact" ?disabled=${this.#workflowBusy||Boolean(workflow&&final&&final.status!=="ready")}>${workflow?this.i18n.t("workflow.create","Create {kind}",{kind:this.#workflowFormatLabel(workflow.target)}):this.i18n.t("workflow.plan","Plan production path")}</button>`:nothing}${workflow&&final?.artifact?html`<button type="button" class="button primary compact" @click=${()=>void this.#openArtifact(final.artifact!,undefined,undefined,{intent:"review"})}>${this.i18n.t("workflow.open","Open and review")}</button>`:nothing}${workflow&&final?.image?.mediaUrl?html`<a class="button primary compact" href=${final.image.mediaUrl} target="_blank" rel="noopener noreferrer">${this.i18n.t("workflow.open","Open and review")}</a>`:nothing}</footer>
      </form>
    </details>`;
  }
  #viewer(artifact:DocumentArtifact|null){
    if(!artifact)return nothing;
    const session=this.store.session.get(),context=session?.projectContext;
    const canAuthor=!context||context.permissions.includes("project.author");
    const canReview=!context||context.permissions.includes("project.review.approve");
    const content=this.#content(artifact),items=this.#items(artifact),sceneConfiguration=this.#artifactSceneConfiguration(artifact);
    const presentation=content?.presentation??artifact.presentation;
    const deckItems=items.map((item)=>({title:item.title,body:item.body,notes:item.notes,image_prompt:item.imagePrompt,context_group_ids:item.contextGroupIds??[],slide:item.slide}));
    const inputStatus=this.#artifactInputStatus(artifact),remaining=inputStatus.total-inputStatus.added;
    const review=artifactReviewState(artifact,this.#artifactSourceBlocks(artifact),this.store.events.get());
    const userId=session?.user.userId??"";
    const history=this.store.events.get();
    const completed=history.find((event)=>event.eventId===artifact.sourceEventId);
    const requested=[...history].reverse().find((event)=>event.type==="ArtifactReviewRequested"&&String(event.payload.artifact_id??"")===artifact.id);
    const rendered=[...history].reverse().find((event)=>event.type==="DocumentRenderRequested"&&String(event.payload.artifact_id??"")===artifact.id);
    const contributors=history.filter((event)=>event.type==="DocumentArtifactEdited"&&String(event.payload.artifact_id??"")===artifact.id&&event.sequence>artifact.sequence);
    const latestChangeRequest=[...history].reverse().find((event)=>event.type==="ArtifactChangesRequested"&&String(event.payload.artifact_id??"")===artifact.id&&Number(event.payload.artifact_revision??-1)===contributors.length);
    const reviewerGuidance=String(latestChangeRequest?.payload.review_note??"").trim();
    const actorOf=(value:string)=>value.startsWith("user:")?value.slice(5):"";
    const productionOwner=Boolean(session&&!session.impersonation&&(!context||String(completed?.payload.requested_by_user_id??actorOf(rendered?.actor??""))===userId));
    const independentEligible=!context||(![String(completed?.payload.requested_by_user_id??actorOf(rendered?.actor??"")),actorOf(requested?.actor??""),...contributors.flatMap((event)=>[actorOf(event.actor),String(event.payload.edited_by_user_id??"")])].filter(Boolean).includes(userId)
      &&(!requested||String(requested.payload.assigned_reviewer_user_id??"")===userId));
    const delivery=artifactDeliveryFor(this.store,artifact,this.#currentDeliveryBinding(artifact)?.contentSha256??null);
    const releaseAllowed=delivery.releaseAllowed;
    const disabledExportTitle=!delivery.canRead||!this.#currentDeliveryBinding(artifact)
      ?this.i18n.t("artifact.delivery.bytesUnavailable","The current output bytes are unavailable for review or export.")
      :delivery.rightsBlockIds.length||delivery.review.status==="stale"
        ?this.i18n.t("artifact.delivery.currentSourcesBlocked","Export is blocked now: the inputs changed or their rights are no longer current.")
        :this.i18n.system("Independent approval is required before export");
    const changedSourceIds=[...new Set([...review.changedBlockIds,...delivery.rightsBlockIds])];
    const renderSoundtrackCompanions=(value:Parameters<typeof renderAudioCompanions>[0],locale:Parameters<typeof renderAudioCompanions>[1])=>renderAudioCompanions(value,locale,releaseAllowed?{onDownload:(asset)=>void this.#downloadSoundtrack(artifact,asset)}:{});
    const generationCost=productionOwner&&(artifact.kind==="slides"||artifact.kind==="audio"||artifact.kind==="storyboard"||artifact.kind==="video"||artifact.kind==="short_story"||artifact.kind==="scene"||artifact.kind==="model3d")?creatorProductionSummary(artifact,history):null;
    const settledGenerationCost=generationCost?.actualMicrousd===undefined||generationCost.actualMicrousd===null?null:`$${(generationCost.actualMicrousd/1_000_000).toFixed(6)}`;
    const editing=this.#editingId===artifact.id,audioDraft=this.#audioTrim?.artifactId===artifact.id?this.#audioTrim:null;
    const videoDraft=this.#videoTrim?.artifactId===artifact.id?this.#videoTrim:null,videoCopy=videoTrimCopy(this.i18n.locale);
    const canTrimVideo=canAuthor&&!context&&Boolean(content)&&Boolean(this.#videoTrimMediaOwned(artifact));
    const model3dDraft=this.#model3dScale?.artifactId===artifact.id?this.#model3dScale:null,model3dCopy=model3dScaleCopy(this.i18n.locale);
    const canScaleModel3d=canAuthor&&!context&&Boolean(content)&&Boolean(this.#model3dScaleMediaOwned(artifact));
    const audioCopy=audioTrimCopy(this.i18n.locale),canTrim=canAuthor&&!context&&Boolean(content)&&artifact.kind==="audio";
    // Keep zero/one alternative and active edit disposition direct.
    const viewerSecondaryCount=Number(!context)+Number(Boolean(content))+Number(canAuthor&&Boolean(content)&&artifact.kind!=="audio"&&artifact.kind!=="model3d")+Number(canTrim)+Number(canTrimVideo)+Number(canScaleModel3d)+Number(canAuthor)
      +2*Number(Boolean(content)&&artifact.kind!=="slides"&&artifact.kind!=="model3d")
      +Number(Boolean(content)&&(artifact.kind==="storyboard"||artifact.kind==="video"&&items.length>1)&&items.some(item=>Boolean(item.mediaUrl)))
      +Number(Boolean(artifact.mediaUrl)&&artifact.kind!=="model3d");
    const groupViewerActions=!editing&&viewerSecondaryCount>1;
    const reviewPanelId=`artifact-review-panel-${artifact.id}`;
    const actionsPanelId=`artifact-viewer-actions-${artifact.id}`;
    const evidencePanelId=`artifact-viewer-evidence-${artifact.id}`;
    const evidenceContent=html`<div><p dir="auto">${artifact.summary}</p><p>${this.i18n.t("artifact.delivery.revision","Output revision {revision}",{revision:this.i18n.number(delivery.revision)})}</p>${this.#currentDeliveryBinding(artifact)?html`<p><b>${this.i18n.t("artifact.delivery.contentHash","Retained content SHA-256")}</b> <code dir="ltr">${this.#currentDeliveryBinding(artifact)!.contentSha256}</code></p>`:html`<p>${this.i18n.t("artifact.delivery.bytesUnavailable","The current output bytes are unavailable for review or export.")}</p>`}${delivery.exportReceipt?html`<p>${this.i18n.t("artifact.delivery.exportRecorded","Export authorization recorded earlier for this revision")}</p>`:nothing}${!releaseAllowed&&(delivery.rightsBlockIds.length||delivery.review.status==="stale")?html`<p>${this.i18n.t("artifact.delivery.currentSourcesBlocked","Export is blocked now: the inputs changed or their rights are no longer current.")}</p>`:nothing}<p>${this.i18n.t("artifact.delivery.notDelivered","Export authorization does not confirm download or recipient delivery.")}</p>${sceneConfiguration?html`<p class="artifact-scene-configuration"><b>${this.i18n.t("scene.medium.label","Scene type")}</b> ${this.#sceneVariantLabel(sceneConfiguration.medium)}${sceneConfiguration.targetFormat?` · ${this.#workflowFormatLabel(sceneConfiguration.targetFormat)}`:""} · ${this.#sceneAlternateLabel(sceneConfiguration.alternateMedium)}</p>`:nothing}${productionOwner?html`<p class="artifact-viewer-provider">${artifact.kind==="slides"?`${artifact.provider} · `:""}${artifact.modelId}</p>`:nothing}${generationCost?html`<p class="artifact-generation-cost">${settledGenerationCost===null?this.i18n.system("Settled provider cost unavailable"):this.i18n.system("Settled provider cost: {settledGenerationCost}", { settledGenerationCost: settledGenerationCost })}${generationCost.reservedMicrousd===null?"":" · " + this.i18n.t("production.reserved","Initially reserved: {amount}", { amount: formatGenerationUsd(generationCost.reservedMicrousd) })}</p>`:nothing}</div>`;
    const focusLabel=this.i18n.system(this.#viewerFocused?"Exit focus":"Focus view");
    const artifactIdentity=describeOutput(artifact,this.store.projection.get().libraryArtifacts,{events:history,locale:this.i18n.locale,timeZone:this.i18n.timeZone,formatTake:(take)=>this.#outputTake(take)});
    const playbackSeconds=documentArtifactPlaybackSeconds(artifact);
    const audioTiming=artifact.kind==="audio"?audioPlaybackTiming(artifact.settings,artifact.mediaUrl):null;
    const viewerDuration=artifact.kind==="audio"?(audioTiming?` · ${this.i18n.t(`audio.duration.${audioTiming.basis}`,"",{seconds:this.i18n.number(audioTiming.seconds)})}`:"")
      :artifact.kind==="video"?(playbackSeconds===null?"":` · ${this.i18n.number(playbackSeconds)}s`):"";
    const viewerMenuAuthorization=this.store.captureAuthorizationScope(),viewerMenuRoute=this.store.route.get();
    const viewerMenuAction={capture:true,handleEvent:(event:Event)=>{
      const action=(event.target as Element|null)?.closest("button,a");if(!action)return;
      const current=Boolean(viewerMenuAuthorization&&this.store.authorizationScopeActive(viewerMenuAuthorization)&&viewerMenuRoute===this.store.route.get()&&this.#activeId===artifact.id&&(!this.#viewerCurrent||this.#viewerCurrent()));
      // Reuse must admit its still-visible native trigger before its own viewer closes.
      if(!current||action.getAttribute("data-artifact-reuse")===null)this.querySelector<FormaUiPopover>(".artifact-viewer-actions-popover")?.close(current);
      if(!current){event.preventDefault();event.stopImmediatePropagation();}
    }};
    const pendingActionLabel=(action:string)=>this.#savingEdit?this.i18n.t("artifact.delivery.actionPending","",{action}):action;
    const reuseAccessibleLabel=this.store.route.get().startsWith("/canvas/")?this.i18n.t(remaining?"projects.useEditCreator":"projects.editCreator",remaining?"Use & edit in Creator Workspace":"Edit in Creator Workspace"):this.i18n.system("Use {value} as input", { value: documentArtifactDefinition(artifact.kind).label.toLowerCase() });
    const reuseLabel=this.#convertingId===artifact.id?this.i18n.system("Opening editable input…"):this.store.route.get().startsWith("/canvas/")?this.i18n.t(remaining?"projects.useEditCreator":"projects.editCreator",remaining?"Use & edit in Creator Workspace":"Edit in Creator Workspace"):!remaining?this.i18n.system("Edit input"):artifact.kind==="storyboard"?(remaining-1===1 ? this.i18n.system("Use & edit {count} frame", { count: this.i18n.number(Math.max(0,remaining-1)) }) : this.i18n.system("Use & edit {count} frames", { count: this.i18n.number(Math.max(0,remaining-1)) })):this.i18n.system("Use & edit {value}", { value: documentArtifactDefinition(artifact.kind).label.toLowerCase() });
    const viewerActions=html`<div id=${actionsPanelId} class="artifact-viewer-actions-body" @click=${groupViewerActions?viewerMenuAction:undefined}>${model3dDraft?renderModel3dArtifactScaleActions(this.#model3dScaleView(artifact,model3dDraft)):audioDraft?html`<button type="button" class="button secondary artifact-audio-trim-cancel" ?disabled=${this.#savingEdit} @click=${(event:MouseEvent)=>this.#cancelArtifactEdit(event)}>${audioCopy.cancel}</button>${audioDraft.code==="unconfirmed"||audioDraft.checking?html`<button type="button" class="button secondary artifact-audio-trim-check" aria-disabled=${String(this.#savingEdit)} aria-busy=${String(audioDraft.checking)} @click=${(event:MouseEvent)=>void this.#saveAudioTrim(artifact,event,true)}>${audioDraft.checking?audioCopy.checking:audioCopy.check}</button>`:nothing}<button type="button" class="button primary artifact-audio-trim-save" aria-disabled=${String(this.#savingEdit||!audioDraft.selection||audioDraft.code==="unconfirmed"||audioDraft.code==="invalid_range")} aria-busy=${String(this.#savingEdit)} @click=${(event:MouseEvent)=>void this.#saveAudioTrim(artifact,event)}>${this.#savingEdit?audioCopy.saving:audioDraft.conversion?audioCopy.conversionSave:audioCopy.save}</button>`:videoDraft?html`<button type="button" class="button secondary artifact-video-trim-cancel" ?disabled=${this.#savingEdit} @click=${(event:MouseEvent)=>{if(this.#videoTrim===videoDraft&&videoDraft.current()&&event.currentTarget===this.querySelector(".artifact-video-trim-cancel"))return this.#cancelArtifactEdit(event);}}>${videoCopy.cancel}</button>${videoDraft.code==="unconfirmed"||videoDraft.checking?html`<button type="button" class="button secondary artifact-video-trim-check" aria-disabled=${String(this.#savingEdit)} aria-busy=${String(videoDraft.checking)} @click=${(event:MouseEvent)=>void this.#saveVideoTrim(artifact,event,true,videoDraft)}>${videoDraft.checking?videoCopy.checking:videoCopy.check}</button>`:nothing}<button type="button" class="button primary artifact-video-trim-save" aria-disabled=${String(this.#savingEdit||!videoDraft.selection||videoDraft.code==="unconfirmed"||videoDraft.code==="invalid_range")} aria-busy=${String(this.#savingEdit)} @click=${(event:MouseEvent)=>void this.#saveVideoTrim(artifact,event,false,videoDraft)}>${this.#savingEdit?videoCopy.saving:videoCopy.save}</button>`:editing?html`<button type="button" class="button secondary" ?disabled=${this.#savingEdit} @click=${(event:MouseEvent)=>this.#cancelArtifactEdit(event)}>Cancel</button><button type="button" class="button primary" ?disabled=${this.#savingEdit||!this.#editMarkdown.trim()} @click=${()=>void this.#saveArtifactEdit(artifact)}>${this.#savingEdit?this.i18n.system("Saving finished output…"):this.i18n.system("Save finished output")}</button>`:html`${!context?html`<button class="button secondary" @click=${()=>{this.#inputId=artifact.id;this.requestUpdate();}}>Inspect inputs</button>`:nothing}${content?html`<button type="button" class="button secondary" @click=${()=>void this.#loadHistory(artifact)}>Output history</button>`:nothing}${canTrim?html`<button type="button" class="button primary artifact-audio-trim-open" ?disabled=${this.#savingEdit} title=${audioCopy.personalOnly} @click=${(event:MouseEvent)=>void this.#startAudioTrim(artifact,event)}>${audioCopy.action}</button>`:nothing}${canTrimVideo?html`<button type="button" class="button primary artifact-video-trim-open" ?disabled=${this.#savingEdit} title=${videoCopy.personalOnly} @click=${(event:MouseEvent)=>void this.#startVideoTrim(artifact,event)}>${videoCopy.action}</button>`:nothing}${canScaleModel3d?html`<button type="button" class="button primary artifact-model3d-scale-open" ?disabled=${this.#savingEdit} @click=${(event:MouseEvent)=>void this.#startModel3dScale(artifact,event)}>${model3dCopy.action}</button>`:nothing}${canAuthor&&content&&artifact.kind!=="audio"&&artifact.kind!=="model3d"?html`<button type="button" class="button primary" ?disabled=${this.#savingEdit} title=${this.#savingEdit?this.i18n.t("artifact.delivery.editBusy"):nothing} @click=${(event:MouseEvent)=>{if(!this.#savingEdit)return this.#startArtifactEdit(artifact,event);}}>${this.#savingEdit?this.i18n.t("artifact.delivery.editPending","",{edit:this.i18n.system("Edit finished output")}):this.i18n.system("Edit finished output")}</button>`:nothing}${canAuthor?html`<button class="button secondary" data-artifact-reuse aria-label=${pendingActionLabel(reuseAccessibleLabel)} ?disabled=${this.#convertingId===artifact.id||this.#savingEdit||artifact.kind==="model3d"&&!model3dArtifactContextReadiness(artifact).supported} title=${this.#savingEdit?this.i18n.t("artifact.delivery.editBusy"):nothing} @click=${(event:MouseEvent)=>this.#addArtifactContext(artifact,event)}>${pendingActionLabel(reuseLabel)}</button>`:nothing}${content&&artifact.kind!=="slides"&&artifact.kind!=="model3d"?html`<button class="button secondary artifact-export-choice" data-artifact-export ?disabled=${!releaseAllowed} title=${releaseAllowed?delivery.approved?this.i18n.system("Download the approved output"):this.i18n.t("artifact.delivery.downloadCurrent","Download the current output"):disabledExportTitle} @click=${()=>this.#download(artifact)}>Download Markdown</button><button class="button secondary artifact-export-choice" ?disabled=${!releaseAllowed} title=${releaseAllowed?this.i18n.system("Download an editable Microsoft Word document"):disabledExportTitle} @click=${()=>void this.#downloadWord(artifact)}>Download Word</button>`:nothing}${content&&(artifact.kind==="storyboard"||artifact.kind==="video"&&items.length>1)&&items.some((item)=>item.mediaUrl)?html`<button type="button" class="button secondary artifact-export-choice" ?disabled=${!releaseAllowed} title=${releaseAllowed?delivery.approved?this.i18n.system("Download the approved media"):this.i18n.t("projects.downloadMedia","Download media"):disabledExportTitle} @click=${()=>void this.#downloadMediaArchive(artifact)}>${this.i18n.t("projects.downloadMedia","Download media")} · ${this.i18n.number(items.length)} ${this.i18n.system(artifact.kind==="storyboard"?"frames":"scenes")}</button>`:nothing}${artifact.mediaUrl&&artifact.kind!=="model3d"?html`<button type="button" class="button primary artifact-export-choice" ?disabled=${!releaseAllowed} title=${releaseAllowed?delivery.approved?this.i18n.system("Download the approved media"):this.i18n.t("projects.downloadMedia","Download media"):disabledExportTitle} @click=${()=>void this.#downloadMedia(artifact)}>${artifact.kind==="audio"?this.i18n.t("audio.output.download","Download audio"):artifact.kind==="video"&&artifact.itemCount>1?this.i18n.system("Download first scene"):this.i18n.system("Download media")}</button>`:nothing}`}</div>`;
    return html`<dialog class="document-artifact-view" data-output-focus=${String(this.#viewerFocused)} data-artifact-kind=${artifact.kind} closedby=${editing?"closerequest":"any"} @click=${this.#closeOnBackdrop} @cancel=${this.#cancelViewer} @close=${(event:Event)=>{const dialog=event.currentTarget as HTMLDialogElement;if(dialog.open||dialog!==this.#viewDialog()||this.#viewerOpening)return;this.#deliveryBinding=null;this.#deliveryBindingLoading=null;this.#closeViewerPopovers();this.#viewerFocused=false;this.#reviewPanelOpen=false;this.#viewerActionsOpen=false;if(this.#activeId){this.#activeId="";this.#cancelArtifactEdit();this.requestUpdate();}}}>
      <article class="document-artifact-reader">
        <header class="artifact-viewer-header"><div class="artifact-viewer-identity"><div class="artifact-viewer-kicker"><span>${sceneConfiguration?this.#sceneVariantLabel(sceneConfiguration.medium):this.i18n.system(documentArtifactDefinition(artifact.kind).label)}${artifactIdentity.disambiguator?` · ${artifactIdentity.disambiguator}`:""}</span><p class=${`artifact-review-status artifact-review-${review.status}`}><b>${context&&review.status==="approved"&&!delivery.approved?this.i18n.t("artifact.delivery.unverifiedApproval","Recorded approval does not match the current output."):this.#reviewLabel(review)}</b>${review.changedBlockIds.length?html` · ${review.changedBlockIds.length} source decision${review.changedBlockIds.length===1?"":"s"} changed`:nothing}</p></div><h2 dir="auto">${artifact.title}</h2>${artifact.kind==="slides"?nothing:html`<details id=${evidencePanelId} class="artifact-viewer-details"><summary>${this.i18n.t("production.evidence","Review production evidence")}</summary>${evidenceContent}</details>`}</div><div class="document-artifact-reader-actions">${canAuthor?html`<button type="button" class="icon-button artifact-rename" aria-label=${this.i18n.system("Rename {documentTitle}",{documentTitle:artifact.title})} title=${this.i18n.system("Rename")} @click=${()=>void this.#renameArtifact(artifact)}>${icon("edit")}</button>`:nothing}${delivery.canRead?html`<button type="button" class="button primary compact artifact-viewer-review-toggle" ?disabled=${editing||this.#savingEdit} title=${this.#savingEdit?this.i18n.t(editing?"artifact.delivery.savingCorrection":"artifact.delivery.editBusy"):nothing} aria-controls=${artifact.kind==="slides"&&delivery.intent==="export"?nothing:delivery.intent==="inspect"?evidencePanelId:delivery.intent==="review"?reviewPanelId:artifact.kind==="model3d"?`artifact-model3d-files-${artifact.id}`:actionsPanelId} aria-expanded=${delivery.intent==="inspect"||delivery.intent==="export"&&(!groupViewerActions||artifact.kind==="slides"||artifact.kind==="model3d")?nothing:delivery.intent==="review"?this.#reviewPanelOpen:this.#viewerActionsOpen} @click=${()=>void this.#showArtifactIntent(artifact,delivery.intent)}>${pendingActionLabel(this.i18n.t(`artifact.delivery.action.${delivery.action}`))}</button>`:nothing}<button type="button" class="icon-button artifact-viewer-focus-toggle" aria-label=${focusLabel} title=${focusLabel} aria-pressed=${this.#viewerFocused} ?disabled=${editing} @click=${()=>this.#setViewerFocus(!this.#viewerFocused)}>${icon(this.#viewerFocused?"collapse":"expand")}</button><button type="button" class="icon-button" aria-label=${this.i18n.t("action.close","Close")} @click=${(event:MouseEvent)=>{if(this.#cancelViewer(event,false))this.#viewDialog()?.close();}}>${icon("close")}</button></div></header>
        <div class=${`document-artifact-reader-content artifact-reader-${artifact.kind}`}>${model3dDraft?renderModel3dArtifactScaleEditor(this.#model3dScaleView(artifact,model3dDraft)):audioDraft?this.#audioTrimTemplate(audioDraft):videoDraft?this.#videoTrimTemplate(videoDraft):editing?html`<section class="artifact-direct-editor" aria-label="Edit finished output"><label>Finished output<textarea rows="12" .value=${this.#editMarkdown} @input=${(event:InputEvent)=>{this.#editMarkdown=(event.currentTarget as HTMLTextAreaElement).value;if(this.#editItems.length===1&&["short_story","scene"].includes(artifact.kind))this.#editItems[0]!.body=this.#editMarkdown;this.#editDraftRevision++;this.requestUpdate();}}></textarea></label>${this.#editItems.length>1||["slides","storyboard","video"].includes(artifact.kind)?html`<ol class="artifact-direct-editor-items">${this.#editItems.map((item,index)=>html`<li><h3>${artifact.kind==="slides"?this.i18n.system("Slide"):artifact.kind==="storyboard"?this.i18n.system("Frame"):artifact.kind==="video"?this.i18n.system("Scene"):this.i18n.system("Part")} ${index+1}</h3><label>Title<input .value=${item.title} @input=${(event:InputEvent)=>{item.title=(event.currentTarget as HTMLInputElement).value;this.#editDraftRevision++;this.requestUpdate();}}></label><label>Content<textarea rows="4" .value=${item.body} @input=${(event:InputEvent)=>{item.body=(event.currentTarget as HTMLTextAreaElement).value;this.#editDraftRevision++;this.requestUpdate();}}></textarea></label><label>Notes<textarea rows="2" .value=${item.notes} @input=${(event:InputEvent)=>{item.notes=(event.currentTarget as HTMLTextAreaElement).value;this.#editDraftRevision++;this.requestUpdate();}}></textarea></label></li>`)}</ol>`:nothing}<p>Your correction updates the finished deliverable itself. No model provider is called; any earlier approval must be requested again.</p></section>`:artifact.kind==="model3d"?this.#model3dOutput(artifact,releaseAllowed,disabledExportTitle):artifact.kind==="audio"?html`<section class="artifact-audio-result">${this.#audioTrimNotice?.artifactId===artifact.id&&this.#audioTrimNotice.current()?html`<p class="artifact-audio-trim-status" role="status">${audioCopy.status[this.#audioTrimNotice.code]}</p>`:nothing}${renderAudioPlayer(artifact.mediaUrl,artifact.title,this.i18n,{transcript:artifact.settings.audio_role==="voice"&&content?.content_markdown?"":typeof artifact.settings.lyrics==="string"?artifact.settings.lyrics:""})}${artifact.settings.audio_synthid_watermarked?html`<p class="artifact-audio-watermark">${this.i18n.t("audio.generation.watermark","Generated audio includes an embedded SynthID watermark.")}</p>`:nothing}${content?.content_markdown?html`<details class="forma-audio-transcript"><summary>${artifact.settings.audio_role==="voice"?this.i18n.t("audio.reference.transcript","Transcript or listening notes"):this.i18n.t("audio.generation.lyrics","Lyrics and production notes")}</summary><pre class="artifact-prose" dir="auto">${content.content_markdown}</pre></details>`:nothing}</section>`:artifact.kind==="video"&&artifact.mediaUrl?html`${this.#videoTrimNotice?.artifactId===artifact.id&&this.#videoTrimNotice.current()?html`<p class="artifact-video-trim-status" role="status">${videoCopy.status[this.#videoTrimNotice.code]}</p>`:nothing}${this.#videoReel(artifact,items)}`:artifact.kind==="storyboard"?html`<ol class="artifact-storyboard">${items.map((item,index)=>html`<li>${this.#image(item)}<div><span>Shot ${index+1}</span><h3>${item.title}</h3><p>${item.body}</p><small>${item.notes}</small></div></li>`)}</ol>`:artifact.kind==="slides"?html`<forma-presentation-deck .items=${deckItems} .presentation=${presentation} .preferenceKey=${artifact.id} .deckTitle=${artifact.title} .documentId=${artifact.documentId} .releaseAllowed=${releaseAllowed} .sourceSurface=${`${this.source}-artifact-viewer`}></forma-presentation-deck>`:html`<pre class="artifact-prose">${content?.content_markdown??this.i18n.system("The retained artifact content is unavailable.")}</pre>`}${!editing&&artifact.kind!=="slides"?html`${renderIncludedSoundtrackTranscripts(artifact.settings.soundtrack_assets,this.i18n)}${renderSoundtrackCompanions(artifact.settings.soundtrack_assets,this.i18n)}`:nothing}</div>
        ${reviewerGuidance?html`<aside class="artifact-review-guidance" aria-label="Requested changes for this output revision"><b>Reviewer requested these changes</b><p dir="auto">${reviewerGuidance}</p></aside>`:nothing}
        ${canAuthor||canReview||changedSourceIds.length?html`<div id=${reviewPanelId} class="artifact-review-actions" tabindex="-1" aria-label="Output review workflow" ?hidden=${!this.#reviewPanelOpen}>${changedSourceIds.length?html`<div><p>${this.i18n.t("artifact.delivery.sourcesChanged","These exact inputs changed or their rights are no longer current.")}</p><ul>${changedSourceIds.map(id=>{const block=this.#artifactSourceBlocks(artifact).find(candidate=>candidate.id===id),source=id.startsWith("output:")?this.store.projection.get().libraryArtifacts.find(candidate=>candidate.id===id.slice(7)):null;const href=source?libraryFocusRoute("artifact",source.id,source.title,this.store.route.get()):block?documentContextBlockRoute(artifact.documentId,this.store.projection.get().documents.find(document=>document.id===artifact.documentId)?.title??"",block.id):null;return html`<li>${href?html`<a class="button ghost compact" href=${href} @click=${(event:MouseEvent)=>void this.#openChangedSource(artifact,id,href,event)}>${source?.title??String(block?.properties.label??block?.handle??"")}</a>`:this.i18n.t("artifact.delivery.sourceUnavailable","An input is no longer available.")}</li>`;})}</ul></div>`:nothing}${canAuthor&&!delivery.approved?html`${context?html`<label>Independent reviewer<select .value=${this.#selectedReviewerId} @change=${(event:Event)=>{this.#selectedReviewerId=(event.currentTarget as HTMLSelectElement).value;this.#reviewIntentRevision++;this.requestUpdate();}} ?disabled=${!this.#reviewers.length}>${this.#reviewers.length?this.#reviewers.map((reviewer)=>html`<option value=${reviewer.userId}>${reviewer.displayName}</option>`):html`<option value="">No designated reviewer</option>`}</select></label>`:nothing}<button type="button" class="button secondary compact" ?disabled=${editing||!this.#currentDeliveryBinding(artifact)||review.status==="unverified"||review.status==="stale"||Boolean(context&&!this.#selectedReviewerId)} @click=${()=>void this.#reviewArtifact(artifact,"ArtifactReviewRequested")}>${review.status==="in-review"?this.i18n.system("Reassign reviewer"):this.i18n.system("Assign exact review")}</button>${context&&!this.#reviewers.length?html`<small>Enable independent approval for an existing project Viewer under organization settings.</small>`:nothing}`:nothing}${canReview&&independentEligible?html`<label>Required changes<textarea rows="2" maxlength="500" .value=${this.#reviewNote} @input=${(event:InputEvent)=>{this.#reviewNote=(event.currentTarget as HTMLTextAreaElement).value;this.#reviewIntentRevision++;this.requestUpdate();}} placeholder="Explain the exact correction needed for this output revision"></textarea></label><button type="button" class="button secondary compact" ?disabled=${editing||!this.#currentDeliveryBinding(artifact)||!this.#reviewNote.trim()||review.status!=="in-review"} @click=${()=>void this.#reviewArtifact(artifact,"ArtifactChangesRequested")}>Request changes</button><button type="button" class="button primary compact" ?disabled=${editing||!this.#currentDeliveryBinding(artifact)||review.status!=="in-review"} @click=${()=>void this.#reviewArtifact(artifact,"ArtifactApproved")}>Approve output</button>`:canReview&&context?html`<small>A different designated reviewer must approve work you created, edited, or submitted.</small>`:nothing}</div>`:nothing}
        ${this.#historyOpen?html`<section class="artifact-revision-history" aria-label="Finished output history"><header><h3>Recoverable output history</h3><button type="button" class="button ghost compact" @click=${()=>{this.#historyOpen=false;this.#revisionPreview=null;this.requestUpdate();}}>Close history</button></header>${this.#historyBusy?html`<p role="status">Loading saved output revisions…</p>`:html`<ol>${this.#revisionHistory.map((entry)=>html`<li><div><b>${entry.current?this.i18n.system("Current output"):this.i18n.system("Revision {revision}", { revision: this.i18n.number(entry.revision) })}</b><small>${this.i18n.date(new Date(entry.createdAt),{dateStyle:"medium",timeStyle:"short"})} · ${entry.createdByUserId}${entry.available?"":" " + this.i18n.system("· retention period ended")}</small></div><div>${entry.available?html`<button type="button" class="button secondary compact" aria-label=${this.i18n.system("Inspect revision {revision}", { revision: this.i18n.number(entry.revision) })} @click=${()=>void this.#previewRevision(artifact,entry.revision)}>Inspect</button>${canAuthor&&!entry.current?html`<button type="button" class="button secondary compact" aria-label=${this.i18n.system("Restore revision {revision}", { revision: this.i18n.number(entry.revision) })} ?disabled=${this.#savingEdit} @click=${()=>void this.#restoreRevision(artifact,entry.revision)}>Restore</button>`:nothing}`:nothing}</div></li>`)}</ol>${this.#revisionBefore!==null?html`<button type="button" class="button secondary compact" @click=${()=>void this.#loadHistory(artifact,true)}>Load older revisions</button>`:nothing}`}${this.#revisionPreview?html`<details open><summary>Revision ${this.#revisionPreview.revision} content</summary><pre>${this.#revisionPreview.content.markdown}</pre>${this.#revisionPreview.content.items.length>1||["slides","storyboard","video"].includes(artifact.kind)?html`<ol>${this.#revisionPreview.content.items.map((item,index)=>html`<li><div><b>${artifact.kind==="slides"?this.i18n.system("Slide"):artifact.kind==="storyboard"?this.i18n.system("Frame"):artifact.kind==="video"?this.i18n.system("Scene"):this.i18n.system("Part")} ${index+1}: ${item.title}</b>${item.body?html`<p>${item.body}</p>`:nothing}${item.notes?html`<p><b>Notes:</b> ${item.notes}</p>`:nothing}</div></li>`)}</ol>`:nothing}</details>`:nothing}<p>Restoring creates a new revision and requires fresh independent approval. No generation provider is contacted.</p></section>`:nothing}
        <footer data-actions-open=${String(this.#viewerActionsOpen)}><span>${artifact.itemCount} ${artifact.kind==="slides"?this.i18n.system("slides"):artifact.kind==="storyboard"?this.i18n.system("frames"):artifact.kind==="video"?this.i18n.system(artifact.itemCount===1 ? "scene" : "scenes"):this.i18n.system(artifact.itemCount===1 ? "part" : "parts")}${viewerDuration}${inputStatus.added?" " + this.i18n.system("· {added}/{total} input members", { added: this.i18n.number(inputStatus.added), total: this.i18n.number(inputStatus.total) }):""}</span>${artifact.kind==="slides"?html`<forma-ui-popover class="artifact-viewer-evidence-popover" .label=${this.i18n.t("production.evidence","Review production evidence")} .heading=${this.i18n.t("production.evidence","Review production evidence")} .content=${html`<div id=${evidencePanelId} class="artifact-viewer-details" tabindex="0">${evidenceContent}</div>`}></forma-ui-popover>`:nothing}${groupViewerActions?html`<forma-ui-popover class="artifact-viewer-actions-popover" .label=${this.i18n.t("action.more","More actions")} .content=${viewerActions} @forma-toggle=${(event:CustomEvent<{open:boolean}>)=>{this.#viewerActionsOpen=event.detail.open;this.requestUpdate();}}></forma-ui-popover>`:viewerActions}</footer>
      </article>
    </dialog>`;
  }
  override render(){
    const projection=this.#projection();const artifacts=projection.artifacts;
    const artifactIdentities=new Map(describeOutputs(artifacts,{events:this.store.events.get(),locale:this.i18n.locale,timeZone:this.i18n.timeZone,formatTake:(take)=>this.#outputTake(take)}).map((presentation)=>[presentation.id,presentation]));
    const project=this.store.session.get()?.projectContext;
    const readOnly=Boolean(project&&!project.permissions.includes("project.output.request"));
    const artifactKinds=new Set(artifacts.map((artifact)=>artifact.kind));
    const artifactHeading=!artifacts.length?this.i18n.t("artifact.heading.empty","Create another kind of result"):artifactKinds.size===1?this.i18n.plural("artifact.heading.same",artifacts.length,"{count} {kind} result","{count} {kind} results",{kind:this.i18n.t(`artifact.${artifacts[0]!.kind}.label`,documentArtifactDefinition(artifacts[0]!.kind).label)}):this.i18n.t("artifact.heading.mixed","{count} results across {formats} formats",{count:this.i18n.number(artifacts.length),formats:this.i18n.number(artifactKinds.size)});
    const jobs=readOnly?[]:this.store.documentRenderJobs(this.#targetDocumentId());
    const failedJobs=readOnly?[]:this.store.documentJobs.get().filter((job)=>job.documentId===this.#targetDocumentId()&&job.kind==="render_document"&&documentJobFailureVisible(job)).slice(0,3);
    const rejectedDraftJobs=readOnly?[]:this.store.documentJobs.get().filter((job)=>job.documentId===this.#targetDocumentId()&&job.kind==="render_document"&&job.result?.artifactKind==="slides"&&(job.status==="failed"||job.status==="partial"));
    const recoverablePresentationJob=failedJobs.find(documentJobCanRecoverPresentation);
    const active=this.#viewerCurrent&&!this.#viewerCurrent()?null:this.store.projection.get().libraryArtifacts.find((artifact)=>artifact.id===this.#activeId)??null;const inputArtifact=this.store.projection.get().libraryArtifacts.find((artifact)=>artifact.id===this.#inputId)??active;
    const inspectionContent=project||this.#sceneInputCurrent?this.#actorInputContent:this.store.content.get(),sceneInputOwner=this.#sceneInputCurrent;
    const nativeStoryDocumentId=this.#targetDocumentId(),nativeStorySourceCurrent=this.#privateSourceCurrent();
    const dialogs=html`${readOnly?nothing:keyed(JSON.stringify([this.store.captureAuthorizationScope()?.key??"",projection.projectId,this.#targetDocumentId(),this.source]),this.#nativeStoryOpening?keyed(this.#nativeStoryOpening.id,this.#createOpen?this.#nativeStoryTemplate(this.#nativeStoryOpening):nothing):cache(this.#createOpen?localizeTemplateResult(this.#createDialogTemplate(),this.i18n):nothing))}${this.#viewer(active)}${this.#runningInputJob?html`<forma-generation-input-dialog .open=${true} .openingCurrent=${sceneInputOwner} .inspection=${documentGenerationInputInspection(this.#runningInputJob,this.store.events.get(),inspectionContent)} @generation-input-close=${()=>{if(this.#sceneInputCurrent!==sceneInputOwner)return;this.#sceneInputCurrent=null;this.#runningInputJob=null;this.#actorInputContent={};this.requestUpdate();}}></forma-generation-input-dialog>`:this.#failedInputJob?html`<forma-generation-input-dialog .open=${true} .openingCurrent=${sceneInputOwner} .inspection=${failedGenerationInputInspection(this.#failedInputJob,this.store.events.get(),inspectionContent)} @generation-input-close=${()=>{if(this.#sceneInputCurrent!==sceneInputOwner)return;this.#sceneInputCurrent=null;this.#failedInputJob=null;this.#actorInputContent={};this.requestUpdate();}}></forma-generation-input-dialog>`:!project&&inputArtifact?html`<forma-generation-input-dialog .open=${Boolean(this.#inputId)} .inspection=${artifactGenerationInputInspection(inputArtifact,this.store.content.get())} @generation-input-close=${()=>{this.#inputId="";this.requestUpdate();}}></forma-generation-input-dialog>`:nothing}`;
    if(this.launcherOnly)return html`<div class="document-artifact-launcher">${dialogs}</div>`;
    const workflow=this.#currentWorkflow();
    const outdatedWorkflowOutputs=new Set(workflow
      ? productionWorkflowStageStates(workflow,projection,this.store.events.get(),this.#runningWorkflowStages(workflow))
        .flatMap((state)=>state.inputFreshness==="changed"&&state.stage.source?[state.stage.source.outputId]:[])
      : []);
    return html`<section class=${`document-artifacts ${this.compact?"compact":""}`} aria-label=${this.i18n.t("workbench.creativeResults","Creative results")}>
      <header><div><span class="eyebrow">${this.i18n.t("workbench.creativeResults","Creative results")}</span><h2>${artifactHeading}</h2>${this.compact?nothing:html`<p>Every result comes from the same decisions and remains attached to this document in every view.</p>`}</div>${this.#nativeStoryEligible(nativeStoryDocumentId)?html`<button type="button" class="button secondary native-story-launch" @click=${()=>void this.openNativeShortStory(nativeStoryDocumentId,{current:()=>nativeStorySourceCurrent()})}>${this.i18n.t("story.launcher.title")}</button>`:nothing}${readOnly?nothing:html`<button type="button" class="button secondary compact" @click=${()=>{this.#activeWorkflowStageId="";void this.#openCreate(true);}}>Create output</button>`}</header>
      ${this.#productionWorkflow()}
      ${this.#nativeSlidesCompletions()}
      ${this.#nativeStoryboardCompletions()}
      ${this.#nativeAudioCompletions()}
      ${this.#nativeVideoCompletions()}
      ${this.#nativeModel3dCompletions()}
      ${artifacts.length?html`<div class="document-artifact-list">${artifacts.slice(0,this.compact&&!this.#showAll?3:Math.max(12,artifacts.length)).map((artifact)=>{const review=artifactReviewState(artifact,this.#artifactSourceBlocks(artifact),this.store.events.get()),sceneConfiguration=this.#artifactSceneConfiguration(artifact),identity=artifactIdentities.get(artifact.id);return html`<button type="button" data-forma-content="primary" @click=${()=>this.#openArtifact(artifact)}>${this.#preview(artifact)}<span><b dir="auto">${artifact.title}</b><small>${identity?.disambiguator?`${identity.disambiguator} · `:""}${sceneConfiguration?this.#sceneVariantLabel(sceneConfiguration.medium):this.i18n.system(documentArtifactDefinition(artifact.kind).label)} · ${artifact.itemCount} ${artifact.kind==="slides"?this.i18n.system("slides"):artifact.kind==="storyboard"?this.i18n.system("frames"):this.i18n.system(artifact.itemCount===1 ? "part" : "parts")} · ${this.#reviewLabel(review)}${outdatedWorkflowOutputs.has(artifact.id)?html` · ${this.i18n.t("workflow.inputsChangedLabel","Production inputs changed")}`:nothing}</small>${this.#createdTime(artifact)}</span></button>`;})}</div>${this.compact&&artifacts.length>3?html`<button type="button" class="button ghost compact artifact-show-all" @click=${()=>{this.#showAll=!this.#showAll;this.requestUpdate();}}>${this.#showAll?this.i18n.system("Show fewer"):this.i18n.system("View all {count} outputs", { count: this.i18n.number(artifacts.length) })}</button>`:nothing}`:nothing}
      ${recoverablePresentationJob&&artifacts.length?html`<aside class="document-artifact-recovery" role="status"><button type="button" class="button primary compact" @click=${()=>this.#recoverPresentation(recoverablePresentationJob.jobId)}>${this.i18n.system("Recover saved render")}</button><small>${this.i18n.system("Paid once · replay without another provider call")}</small></aside>`:nothing}
      ${jobs.length?html`<div class="document-artifact-jobs" aria-live="polite">${jobs.map((job)=>html`<span><i></i><b>${DOCUMENT_ARTIFACT_KINDS.includes(job.result?.artifactKind as DocumentArtifactKind)?this.i18n.system(documentArtifactDefinition(job.result!.artifactKind as DocumentArtifactKind).label):this.i18n.system("Artifact")}</b><small>${job.progressMessage?localizedDocumentJobProgress(job,this.i18n):this.i18n.system(job.stage)}</small>${job.result?.artifactKind==="slides"?html`<button type="button" class="button ghost compact" @click=${()=>this.#inspectRunningInputs(job)}>Inspect inputs</button>`:nothing}<button type="button" class="button ghost compact" ?disabled=${job.status==="committing"} title=${job.status==="committing"?this.i18n.system("This result is already being saved"):this.i18n.t("generation.stopUncertainty","Stopping does not guarantee that provider work stops or that reserved budget is released. Incurred costs remain; uncertain holds stay reserved until verified. Check the original receipt.")} @click=${()=>this.#stop(job.jobId)}>${job.status==="committing"?this.i18n.system("Saving…"):this.i18n.system("Stop")}</button></span>`)}</div>`:nothing}
      ${failedJobs.length?html`<details class="document-artifact-failure-digest" ?open=${!artifacts.length}><summary><span>${this.i18n.t("activity.needsYou","Needs your attention")}</span><b>${this.i18n.number(failedJobs.length)}</b></summary><div class="document-artifact-failures" role="region" aria-label="Recent document render issues">${failedJobs.map((job)=>{
        const kind=DOCUMENT_ARTIFACT_KINDS.includes(job.result?.artifactKind as DocumentArtifactKind)?job.result!.artifactKind as DocumentArtifactKind:"short_story";
        const detail=documentJobFailure(job);
        const guidance=localizedGenerationFailureGuidance(generationFailureGuidance(detail,job.error??"",job),detail,job.error??"",this.i18n);
        const applicationEligibility=guidance.applicationEligibility===true;
        const inspectScene=applicationEligibility?this.#sceneFailureInspectionAction(job):null;
        const requestContext=applicationEligibility?this.i18n.t("scene.receipt.requestContext","Document {document} · request {request}",{
          document:`\u2068${job.documentId}\u2069`,request:`\u2068${job.jobId}\u2069`,
        }):"";
        const recoverable=documentJobCanRecoverProviderRender(job)&&guidance.retryAllowed;
        const presentationRecoverable=documentJobCanRecoverPresentation(job);
        const session=this.store.session.get();
        const reconciliationEligible=Boolean(session&&!session.impersonation&&(!session.projectContext||session.projectContext.ownerUserId===session.user.userId)&&job.status==="failed"&&kind==="storyboard"&&job.result?.storyboardProviderSubmission==="pending"&&!job.result.providerJobId);
        const presentationReceiptEligible=Boolean(session&&!session.impersonation&&documentJobCanCheckSavedPresentationReceipt(job));
        const presentationReceiptCheck=this.#presentationReceiptCheck?.jobId===job.jobId&&this.#presentationReceiptCheck.current()?this.#presentationReceiptCheck:null;
        const savedFrameCount=Array.isArray(job.result?.renderedItems)?job.result.renderedItems.length:0;
        const savedStoryboardAvailable=kind==="storyboard"&&savedFrameCount>0&&!session?.projectContext;
        const infrastructureBlocked=Boolean(detail&&!recoverable&&!guidance.retryAllowed&&guidance.actionUrl&&(["authentication","quota","access"].includes(detail.category)||["review_budget","add_credits","verify_organization"].includes(detail.action)||detail.code==="video_provider_not_configured"));
        const remediation=infrastructureBlocked&&session&&!session.impersonation?authorizedGenerationFailureRemediation(guidance,session)??(applicationEligibility?null:{href:"/settings",label:this.i18n.system("Review settings"),external:false}):null;
        return html`<article class=${`document-artifact-failure-card${guidance.retryAllowed?"":" document-artifact-failure-card--terminal"}`}>
          <div class="document-artifact-failure-copy">
            <div class="document-artifact-failure-heading"><span class="document-artifact-failure-icon" aria-hidden="true">${icon("info")}</span><div><span class="document-artifact-failure-format">${this.i18n.system(documentArtifactDefinition(kind).label)}</span><h3 aria-label=${applicationEligibility?`${guidance.title} · ${requestContext}`:nothing}>${guidance.title}</h3>${applicationEligibility?html`<small>${requestContext}</small>`:nothing}</div></div>
            <p>${guidance.summary}</p>
            ${presentationRecoverable?html`<small>${this.i18n.system("Paid once · replay without another provider call")}</small>`:nothing}
            ${savedStoryboardAvailable?html`<small>${this.i18n.system("{saved} frames recorded. Inspect the original plan without generating again. The storyboard is incomplete; its existing budget hold is unchanged.",{saved:this.i18n.number(savedFrameCount)})}</small>`:nothing}
          </div>
          <div class="document-artifact-failure-actions">
            ${applicationEligibility?html`<button type="button" class="button primary compact" aria-label=${`${this.i18n.system("Inspect original Scene inputs · free")} · ${requestContext}`} @click=${inspectScene}>${this.i18n.system("Inspect original Scene inputs · free")}</button>${remediation?html`<a class="button secondary compact" href=${remediation.href}>${remediation.label}</a>`:html`<small>${this.i18n.t("generation.contactAdministrator","Contact your project administrator")}</small>`}`:savedStoryboardAvailable?html`<button type="button" class="button primary compact" @click=${()=>this.#inspectFailedInputs(job)}>${this.i18n.system("View saved frames")}</button>`:reconciliationEligible?html`<button type="button" class="button primary compact" ?disabled=${Boolean(this.#reconcilingProviderJobId)} @click=${()=>void this.#reconcileProviderReceipt(job.jobId)}>${this.#reconcilingProviderJobId===job.jobId?this.i18n.system("Checking…"):this.i18n.system("Refresh provider status")}</button>`:remediation&&!presentationRecoverable?html`<a class="button primary compact" href=${remediation.href} target=${remediation.external?"_blank":"_self"} rel=${remediation.external?"noopener noreferrer":nothing}>${remediation.label}</a><button type="button" class="button secondary compact" @click=${()=>this.#prepareRetry(kind,job)}>${this.i18n.system("Review & change request")}</button>`:html`<button type="button" class="button primary compact" title=${presentationRecoverable?this.i18n.system("Paid once · replay without another provider call"):nothing} @click=${()=>presentationRecoverable?this.#recoverPresentation(job.jobId):recoverable?this.#recover(job.jobId):this.#prepareRetry(kind,job)}>${presentationRecoverable||recoverable?this.i18n.system("Recover saved render"):this.i18n.system("Review & change request")}</button>`}
            ${presentationReceiptEligible?html`<button type="button" class="button secondary compact" title=${this.i18n.system("Checks retained evidence only; does not recover a slideshow or start a new paid request.")} ?disabled=${Boolean(this.#presentationReceiptCheck?.status==="checking"&&this.#presentationReceiptCheck.current())} @click=${()=>void this.#checkSavedPresentationReceipt(job)}>${presentationReceiptCheck?.status==="checking"?this.i18n.system("Checking saved receipt…"):this.i18n.system("Check saved receipt · no generation")}</button>${presentationReceiptCheck&&presentationReceiptCheck.status!=="checking"?html`<small role="status">${this.i18n.system(savedPresentationReceiptCheckMessage(presentationReceiptCheck.status))}</small>`:nothing}`:nothing}
            ${presentationRecoverable?html`<button type="button" class="button secondary compact" @click=${()=>this.#prepareRetry(kind,job)}>${this.i18n.system("Review & change request")}</button>`:nothing}
            ${savedStoryboardAvailable||applicationEligibility?nothing:html`<button type="button" class="button secondary compact" @click=${()=>this.#inspectFailedInputs(job)}>Inspect inputs</button>`}
            <button type="button" class="button ghost compact" aria-label=${this.i18n.system("Dismiss this generation issue")} @click=${(event:Event)=>void this.#dismissFailure(job.jobId,event)}>Dismiss</button>
          </div>
          ${detail?.requestId||detail?.code||detail?.httpStatus||detail?.validationIssues?.length?html`<details class="creative-diagnostics document-artifact-failure-details"><summary>Technical details</summary><div class="document-artifact-failure-receipt" tabindex="0" aria-label=${this.i18n.system("Technical receipt")}>${detail?.code?html`<code>Reason: ${detail.code}</code>`:nothing}${detail?.requestId?html`<code>Provider request: ${detail.requestId}</code>`:nothing}${detail?.httpStatus?applicationEligibility||detail.code==="document_render_guidance_too_long"||detail.code==="document_render_guidance_invalid"?html`<code>${this.i18n.system("Application status")}: ${detail.httpStatus}</code>`:html`<code>Provider status: ${detail.httpStatus}</code>`:nothing}${detail?.validationIssues?.map((issue)=>html`<code>${issue.globalSlideIndex?`Slide ${issue.globalSlideIndex} · `:""}${issue.stage} attempt ${issue.providerAttempt}: ${issue.code} · ${issue.message}</code>`)}</div></details>`:nothing}
        </article>`;
      })}</div></details>`:nothing}
      ${readOnly?nothing:html`<forma-presentation-rejected-drafts .documentId=${this.#targetDocumentId()} .jobs=${rejectedDraftJobs}></forma-presentation-rejected-drafts>`}
      ${this.#productionDesk(artifacts,jobs)}
      ${dialogs}
    </section>`;
  }
}

if (!customElements.get("forma-document-artifacts")) customElements.define("forma-document-artifacts",DocumentArtifacts);
declare global{interface HTMLElementTagNameMap{"forma-document-artifacts":DocumentArtifacts}}
