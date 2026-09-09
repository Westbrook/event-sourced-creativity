import { openOutputReferenceDestination } from "../components/output-reference-navigation";
import { navigateInApp, navigationPresentationMatches, type CommandDeparture, type LocalNavigation } from "../components/command-departure";
import { openCreativeNextActionDestination, openSelectedCreativePreparationDestination, type CreativeNextActionNavigationOwner, type SelectedCreativePreparationTarget } from "../components/creative-next-action-navigation";
import { outputNavigationMatches } from "../model/output-navigation";
import { outputSourceReadiness } from "../components/output-source-readiness";
import { FORMA_OUTPUT_DELIVERY_MESSAGES, outputDeliveryLabelKey, type OutputDeliveryLabelCategory } from "../components/design-system/locales/output-delivery-messages";
import { copyOutputRequirementCreationEvents } from "../model/output-requirement-copy.ts";
import { canonicalAdaptiveSelection, createAdaptiveProposalReview, type AdaptiveProposalReadNavigation, type AdaptiveProposalReadOperation, type AdaptiveProposalReadControl } from "../components/adaptive-proposal-review";
import { closeAdaptiveProposalDialog, renderAdaptiveProposalDialog } from "../components/adaptive-proposal-dialog";
import { libraryFocusRoute } from "../model/routes";
import { renderOutcomeDesk, renderOutcomeArrangementReview, restoreOutcomeDeskFocus } from "../components/outcome-desk";
import { outcomeDeskCopy } from "../components/design-system/locales/outcome-recipe-messages";
import { outcomeDeskIntegrationCopy, outcomeDeskLocale } from "../components/design-system/locales/outcome-desk-integration-messages";
import { OUTCOME_RECIPES, outcomeRecipe } from "../model/outcome-recipes";
import { outcomeDeskOutputSnapshot, projectOutcomeDesk, followOutcomeDeskAction, outcomeDeskRouteState, withOutcomeDeskPosture, withOutcomeDeskSelection, withOutcomeRecipe, type OutcomeDeskAction, type OutcomeDeskRow } from "../model/outcome-desk";
import { outcomeDeskHostActions, outcomeDeskHostActionAvailable, outcomeDeskPreparationActions, type OutcomeDeskTarget } from "./outcome-desk-host";
import { isProtectedOutcomeArrangementEvent, outcomeArrangementSelectionIds } from "./outcome-arrangements";
import { OutcomeArrangementController, currentOutcomeArrangementContext, outcomeArrangementOperationFromRoute, withOutcomeArrangementOperation } from "../state/outcome-desk-controller";
import { html, nothing, type TemplateResult } from "lit";
import { cache } from "lit/directives/cache.js";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import { suspendContextControls } from "../components/context-controls";
import { nextFormaId } from "../components/design-system/contracts";
import type { FormaUiPopover } from "../components/design-system/feedback";
import { localizeTemplateResult } from "../components/design-system/localized-template";
import { FormaElement, icon } from "../components/forma-element";
import type { FormaIconName } from "../components/icons";
import { ensureModalDialog } from "../components/modal-dialog";
import { captureOutputNavigationFocus, type OutputNavigationFocusLease } from "../components/output-navigation-focus";
import { renderVideoReel } from "../components/video-reel";
import { renderAudioPlayer, renderIncludedSoundtrackTranscripts, renderSoundtrackCompanions as renderAudioCompanions } from "../components/audio-playback";
import { BLOCK_GROUPS, BLOCK_TYPES, blockTypeDefinition, suggestedSubtype, type BlockGroup, type BlockKind } from "../model/block-types";
import { generationHistoryItems, outputQualityLabel, type CreativeBlock, type CreativeEvent, type CreativeOutput, type EventInput } from "../model/events";
import { PROMPT_TECHNIQUES, promptTechniqueDefinition } from "../model/prompt-structures";
import { CANVAS_INTERACTION_DEFINITIONS, type CanvasInteractionId } from "../model/canvas-interactions";
import type { AssistantToolRequest } from "../model/assistant-route-policy";
import type { FormaAssistantPanel } from "../components/design-system/assistant-panel";
import { creativeActionSourceRevision, creativeNextActions, creativeNextTargetAvailable, followCreativeNextTarget, type CreativeNextAction, type CreativeNextPorts, type CreativeNextTarget, type CreativePreparationStage } from "../model/workspace-intelligence";
import { documentPreparationRoute } from "../model/document-preparation-route";
import { nextActionFacts } from "../state/next-action-context";
import { artifactDeliveryFor } from "../state/artifact-delivery-context";
import { DOCUMENT_ARTIFACT_KINDS, documentArtifactRevision, documentArtifactDefinition, parseDocumentArtifactContent, type DocumentArtifact, type DocumentArtifactDraftItem, type DocumentArtifactKind } from "../model/document-artifacts";
import { artifactContextEvents, imageOutputContextEvents } from "../model/output-context";
import { describeOutput, imageOutputNamingCandidate } from "../model/output-naming";
import { COMBINED_CONTEXT_APPLICATION_DEFINITIONS, COMBINED_CONTEXT_ROLE_DEFINITIONS, combinedContextMemberships, type CombinedContextApplication, type CombinedContextMembership, type CombinedContextRole } from "../model/combined-context";
import { artifactGenerationInputInspection, failedGenerationInputInspection, outputGenerationInputInspection } from "../model/generation-inputs";
import { artifactReviewState, artifactSourceVersions } from "../model/context-health";
import { documentJobFailure, documentJobProgress, generationFailureGuidance, type DocumentJob } from "../model/document-jobs";
import { localizedDocumentJobProgress, localizedDocumentJobProgressDetail, localizedGenerationFailureGuidance } from "../components/design-system/localized-runtime-copy";
import { canvasFacetKey, canvasFacetsForItem, type CanvasFacet } from "./facets";
import { canvasFocusFromRoute, canvasIdFromRoute, canvasLensFromRoute, canvasProposalIdFromRoute, canvasRoute, canvasSlug, canvasViewFromRoute, withCanvasFocus, withCanvasQuery, withCanvasView } from "./routes";
import { canvasItemAccessibleName, canvasItemsInVirtualViewport, canvasMatchSizeTarget, canvasTextReplacementOperations, foldCanvasEvents, matchCanvasItemSizes, organizeCanvasItems, translateCanvasItems, type CanvasArrangement, type CanvasContextSet, type CanvasItem, type CanvasOrganization, type CanvasSizeModifier, type CanvasSourceKind, type CanvasView } from "./model";
import { CanvasPresenceHub, type CanvasPresence } from "./presence";
import { CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM, canvasPinchViewport, readCanvasViewportState, writeCanvasViewportState, type CanvasTouchPoint, type CanvasTouchViewport } from "./viewport-preferences";
import { canvasOfflineQueue, type CanvasQueueScope, type QueuedCanvasBatch } from "../sync/canvas-offline-queue";
import type { CapturedSourceOwnership, EventWriteAcknowledgment } from "../state/store";
import "../components/icons-authoring";
import "../components/icons-canvas";
import "../components/icons-media";
import "../components/icons-navigation";
import "../components/output-visual";
import "../components/prompt-fan-visual";
import "../components/reference-image";
import { readSlideFooterLabelPreference } from "../components/presentation-slide";
import "../components/presentation-deck";
import "../components/document-artifacts";
import "../components/design-primitives";
import "../components/design-system/choice-card";
import "../components/generation-input-dialog";
import "../components/context-intelligence";
import { renderNextActionCards } from "../components/next-action-cards";
import "../components/design-system/forms";
import "../components/design-system/feedback";
import "./canvas.css";

type CanvasSourceOwner={source:CapturedSourceOwnership;scope:CanvasQueueScope;retired:boolean};
type Tool="select"|"marquee"|"draw";
type AddKind="start"|"document"|"context"|"output"|"reference"|"composite";
type CanvasRenderKind="preview"|"generate"|"preview_fan"|"generate_fan";
type ResizeCorner="nw"|"ne"|"sw"|"se";
type Source={kind:CanvasSourceKind;id:string;title:string;body:string;blockType:string};

const DRAG_THRESHOLD_PX=4;
const RENDER_OVERSCAN_PX=800;
const IMAGE_MIN_FRAME={w:180,h:140};
const IMAGE_MAX_FRAME={w:1440,h:1120};
const ITEM_MIN_FRAME={w:160,h:112};
const ITEM_MAX_FRAME={w:1440,h:1120};
const renderSoundtrackCompanions=(value:Parameters<typeof renderAudioCompanions>[0],locale:Parameters<typeof renderAudioCompanions>[1])=>html`${renderIncludedSoundtrackTranscripts(value,locale)}${renderAudioCompanions(value,locale)}`;
const artifactIcon=(kind:DocumentArtifactKind):FormaIconName=>kind==="short_story"?"story":kind==="scene"?"scene":kind==="slides"?"slides":kind==="storyboard"?"storyboard":kind==="audio"?"audio":"video";
const uid=()=>crypto.randomUUID();
const hlc=(site:string)=>({pt:Date.now(),c:Math.floor(performance.now()*1000)%1_000_000,site});
const textForBlock=(block:CreativeBlock)=>String(block.properties.text??block.properties.label??block.properties.value??blockTypeDefinition(block.type)?.description??"Reusable project context");
const mediaKind=(item:CanvasItem)=>item.sourceKind==="output"||item.sourceKind==="reference"||item.blockType==="reference";
const volatileCanvasEvent=(event:EventInput)=>event.type==="CanvasLockAcquired"||event.type==="CanvasLockReleased";
const canvasSyncMessage=(reason:string,eventTypes:string[],localize:(source:string,values?:Record<string,string|number>)=>string)=>{
  const names:Record<string,string>={CanvasCreated:"new board",CanvasItemPlaced:"item placement",CanvasArrangementCreated:"arrangement",CanvasArrangementRemoved:"arrangement removal",CanvasArrangementRestored:"arrangement restoration",CanvasRegisterSet:"item geometry",CanvasTextApplied:"text edit",CanvasItemRemoved:"item removal",CanvasItemRestored:"item restoration",CanvasRenamed:"board rename",CanvasRemoved:"board removal",CanvasRestored:"board restoration"};
  const operation=eventTypes.length===1?(names[eventTypes[0]]??eventTypes[0].replace(/^Canvas/,"").replace(/([a-z])([A-Z])/g,"$1 $2").toLowerCase()):"board changes";
  const localizedOperation=localize(operation);
  if(/failed to fetch|networkerror|network request failed|load failed/i.test(reason))return localize("The Canvas server could not be reached while saving {operation}.",{operation:localizedOperation});
  const labels:Record<string,string>={canvas_id_required:"The board identifier is missing.",canvas_item_id_required:"The board item identifier is missing.",canvas_source_required:"The selected project content is no longer available.",invalid_canvas_lock_lease:"The collaboration lock duration was not valid.",invalid_canvas_lock_holder:"The collaboration lock owner was not valid.",invalid_canvas_register_operation:"The item position was not valid.",invalid_canvas_text_operation:"The text change was not valid.",invalid_canvas_stroke:"The drawing data was not valid.",project_owner_role_required:"Only a project owner can change project membership.",event_not_permitted_for_user:"Your account is not permitted to make this board change.",context_value_conflict:"Another collaborator changed this exact decision. Review its latest value and try again."};
  const matched=Object.entries(labels).find(([code])=>reason.includes(code));
  return matched?localize(matched[1]):localize("{operation} could not be saved: {reason}",{operation:localizedOperation===operation?`${operation[0]?.toUpperCase()??"B"}${operation.slice(1)}`:localizedOperation,reason});
};

export class CanvasApplication extends FormaElement {
  #selected=new Set<string>();
  #deskDismissed=new Set<string>();
  #arrangementOpen=false;
  #arrangementOpening=0;
  #arrangementOpeningScope="";
  #deskFocusVersion=0;
  #arrangementName="";
  #arrangementReturnFocus?:HTMLElement;
  #arrangementCheckedStamp="";
  #arrangementUndoRequest:unknown;
  #arrangement=new OutcomeArrangementController({
    scope:()=>this.#arrangementScope(),stamp:()=>this.#arrangementStamp(),
    context:()=>currentOutcomeArrangementContext(this.store,[...this.#selected],this.#site(),this.#offline.count===0),
    post:(command,controls)=>this.store.canvasArrangementRequest(command,controls),
    remember:(identity)=>this.store.setRoute(withOutcomeArrangementOperation(this.store.route.get(),identity.operationId),{replace:true}),
    recoveryIdentity:()=>{const scope=this.#arrangementScope(),operationId=outcomeArrangementOperationFromRoute(this.store.route.get());return scope&&operationId?{projectId:scope.projectId,canvasId:scope.canvasId,operationId}:null;},
    captureRecoveryOwnership:(invalidated)=>this.#captureArrangementRecovery(invalidated),
    captureRefusalOwnership:(invalidated)=>this.#captureArrangementRecovery(invalidated,true),
    refresh:()=>this.store.refreshEvents(),changed:()=>this.requestUpdate(),operationId:uid,now:()=>Date.now(),
  });
  #controlsScope="";
  #popoverRoute="";
  #viewTriggerId=nextFormaId("canvas-view-toggle");
  #closePopovers(){for(const popover of this.querySelectorAll<FormaUiPopover>("forma-ui-popover"))popover.close();}
  #viewMenuAction={capture:true,handleEvent:(event:Event)=>{
    const target=event.target as Element|null;
    if(event.type==="click"&&!target?.closest("button"))return;
    const popover=this.querySelector<FormaUiPopover>(".canvas-view-menu");
    if(!this.#controlsScope||this.#controlsScope!==this.#currentControlsScope()||this.#popoverRoute!==this.store.route.get()){
      popover?.close();event.preventDefault();event.stopImmediatePropagation();return;
    }
    popover?.close(true);
  }};
  #selectionKey="";
  #selectionContexts=new Set<string>();
  #addReturnFocus?:HTMLElement;
  #outputsReturnFocus?:HTMLElement;
  #controlsFocus?:OutputNavigationFocusLease;
  #outputsDocumentId="";
  #tool:Tool="select";
  #addOpen=false;
  #addKind:AddKind="start";
  #newCanvasOpen=false;
  #formalizeOpen=false;
  #memberOpen=false;
  #semanticOpen=false;
  #organizeOpen=false;
  #organizeId=nextFormaId("canvas-organize");
  #editOpen=false;
  #documentOpen=false;
  #renderOpen=false;
  #renderReturnFocus?:HTMLElement;
  #pendingRenderPreparations:{current:()=>boolean;count:number}|null=null;
  #documentOutputsOpen=false;
  #documentOutputsItemId="";
  #viewingOutputId="";
  #nextImageOpening:{current:()=>boolean;presented:boolean}|null=null;
  #viewingArtifactId="";
  #viewerFocused=false;
  #viewerActionsOpen=false;
  #viewerReturnFocus?:HTMLElement;
  #inputOutputId="";
  #inputArtifactId="";
  #inputFailureJobId="";
  #viewingComparisonId="";
  #viewingOutputSource="canvas-image-dialog";
  #editValue="";
  #zoom=1;
  #cameraX=0;
  #cameraY=0;
  #dragPreview?:{positions:Map<string,{x:number;y:number}>;itemIds:string[]};
  #dragClickGuard="";
  #resizePreview?:{itemId:string;x:number;y:number;w:number;h:number};
  #selectionMarquee?:{x:number;y:number;width:number;height:number};
  #canvasName="";
  #newBlockGroup:BlockGroup="intent";
  #newBlockType:BlockKind="direction";
  #newBlockTitle="";
  #newBlockBody="";
  #sourceQuery="";
  #selectedSourceIds=new Set<string>();
  #contextName="Working context";
  #contextTarget="Working context";
  #contextRole:CombinedContextRole="custom";
  #contextApplication:CombinedContextApplication="isolate";
  #contextRelativity=.85;
  #documentTitle="";
  #renderDocumentItemId="";
  #intent="";
  #intentSubmitting=false;
  #proposalResultNavigation?:AdaptiveProposalReadNavigation&{current:()=>boolean;close:()=>void;focus:OutputNavigationFocusLease;dispose:()=>void};
  #currentProposalResultNavigation(){
    const navigation=this.#proposalResultNavigation;
    if(navigation&&!navigation.current()){navigation.dispose();this.#proposalResultNavigation=undefined;}
    return this.#proposalResultNavigation;
  }
  #proposalReview=createAdaptiveProposalReview(this.store,()=>({documentId:this.#anchorDocumentId(),canvasId:this.store.canvasProjection.get().selectedCanvasId||null,receiptNavigation:this.#currentProposalResultNavigation()}),()=>this.requestUpdate(),()=>this.i18n.t("adaptive.changes.title"),()=>this.#settleCanvasWrites());
  #proposalOpener?:HTMLElement;
  #closeProposalReview(restoreFocus=true){
    const route=this.store.route.get(),receipt=this.#proposalReview.receipt,presentation=this.#proposalReview.presentationId;
    this.#proposalResultNavigation?.close();
    closeAdaptiveProposalDialog(this,this.#proposalReview,this.#proposalOpener,()=>this.querySelector<HTMLElement>(".canvas-viewport,.canvas-stage-shell"),
      ()=>restoreFocus&&this.store.route.get()===route&&this.#proposalReview.receipt===receipt&&this.#proposalReview.presentationId===presentation);
  }
  #openProposalResult(kind:"block"|"canvas-item",id:string){
    if(!this.#proposalReview.canOpen(kind,id))return;
    const canvas=this.store.canvasProjection.get(),projection=this.store.projection.get();
    if(kind==="block"){
      const block=projection.libraryBlocks.find(item=>item.id===id&&!item.removed&&item.projectId===projection.projectId&&item.scope==="canvas"&&item.canvasId===canvas.selectedCanvasId);
      if(!block){this.store.toast(this.i18n.t("adaptive.changes.resultUnavailable"));return;}
      this.#closeProposalReview();this.#go(libraryFocusRoute("block",id,String(block.properties.label??block.handle),"/canvas/library"));return;
    }
    const item=canvas.items.find(candidate=>candidate.id===id);if(!item){this.store.toast(this.i18n.t("adaptive.changes.resultUnavailable"));return;}
    const proposal=this.#proposalReview,presentation=proposal.presentationId,receipt=proposal.receipt,scope=proposal.ports.scope();
    const source=this.store.captureSourceOwnership(),previousSelection=this.#selected,previousRoute=this.store.route.get();
    if(!scope||scope.canvasId!==canvas.selectedCanvasId||scope.projectId!==projection.projectId||!source||!this.store.sourceOwnershipActive(source))return;
    const block=projection.libraryBlocks.find(value=>value.id===item.sourceId&&value.projectId===scope.projectId&&!value.removed
      &&value.scope==="canvas"&&value.canvasId===canvas.selectedCanvasId&&receipt?.blockIds.includes(value.id));
    if(!block||!["block","sketch"].includes(item.sourceKind))return;
    const blockIdentity=JSON.stringify(block);
    const originalSelection=this.#currentProposalResultNavigation()?.originalSelection??[...previousSelection],authority=scope.key;
    const route=withCanvasView(this.store.route.get(),"spatial"),canvasId=canvas.selectedCanvasId;
    this.#closeProposalReview(false);
    if(!this.isConnected||this.store.route.get()!==previousRoute||this.#selected!==previousSelection||!this.store.sourceOwnershipActive(source)
      ||proposal.receipt!==receipt||proposal.presentationId!==presentation||proposal.ports.scope()?.key!==authority)return;
    // Native Close is synchronous. Capture before selection/navigation or any
    // awaited render, while suppressing only this handoff's delayed Close focus.
    const focus=captureOutputNavigationFocus(this.ownerDocument),selection=new Set([item.id]),identity=JSON.stringify(item);
    this.#proposalResultNavigation?.dispose();
    let retired=false,unsubscribe=()=>{};
    const receiptIdentity=(value:typeof receipt)=>value&&canonicalAdaptiveSelection({previewId:value.previewId,approvalHash:value.approvalHash,
      executionId:value.executionId,bindingHash:value.bindingHash,selectionKey:value.selectionKey,
      blockIds:value.blockIds,canvasItemIds:value.canvasItemIds,relationCount:value.relationCount});
    const receiptTarget=(value:typeof receipt)=>value&&({identity:receiptIdentity(value),executionId:value.executionId,bindingHash:value.bindingHash,
      previewId:value.previewId,approvalHash:value.approvalHash});
    let expected=receiptTarget(receipt);
    const pageIdentity=()=>canonicalAdaptiveSelection({receipts:proposal.receipts,nextCursor:proposal.nextCursor,discovery:proposal.receiptDiscovery});
    let ownedPresentation=presentation,ownedReceipt=receipt,ownedVisible=false,ownedPhase=proposal.phase,ownedBusy=proposal.busy;
    let ownedReceiptIdentity=canonicalAdaptiveSelection(receipt),ownedPage=proposal.receipts,ownedPageIdentity=pageIdentity();
    let reading:{presentation:number;opening:boolean;kind:AdaptiveProposalReadOperation["kind"];expected:typeof expected;
      temporary:boolean;invalid:boolean;phase:typeof proposal.phase;receipt:typeof receipt;receiptIdentity:string|null;page:typeof proposal.receipts;pageIdentity:string;
      acceptedReceipt?:typeof receipt;acceptedReceiptIdentity?:string;acceptedPage?:{receipts:typeof proposal.receipts;identity:string}}|undefined;
    const targetCurrent=(target:typeof expected)=>Boolean(target&&proposal.executionId===target.executionId&&proposal.bindingHash===target.bindingHash
      &&proposal.handle?.previewId===target.previewId&&proposal.handle?.approvalHash===target.approvalHash);
    const stable=()=>proposal.visible===ownedVisible&&proposal.presentationId===ownedPresentation&&proposal.phase===ownedPhase&&proposal.busy===ownedBusy
      &&proposal.receipt===ownedReceipt&&canonicalAdaptiveSelection(proposal.receipt)===ownedReceiptIdentity
      &&proposal.receipts===ownedPage&&pageIdentity()===ownedPageIdentity&&targetCurrent(expected);
    const reviewCurrent=()=>{
      if(!reading)return stable();
      if(reading.invalid)return false;
      if(reading.opening&&stable())return true;
      if(!proposal.visible||proposal.presentationId!==reading.presentation||!targetCurrent(reading.expected))return false;
      const samePage=proposal.receipts===reading.page&&pageIdentity()===reading.pageIdentity;
      if(proposal.phase==="applied")return proposal.receipt===(reading.acceptedReceipt??reading.receipt)
        &&canonicalAdaptiveSelection(proposal.receipt)===(reading.acceptedReceipt?reading.acceptedReceiptIdentity:reading.receiptIdentity)
        &&receiptIdentity(proposal.receipt)===reading.expected?.identity&&samePage;
      const sameReceipt=reading.kind==="choose"?proposal.receipt===null
        :proposal.receipt===reading.receipt&&canonicalAdaptiveSelection(proposal.receipt)===reading.receiptIdentity;
      if(!sameReceipt)return false;
      if(reading.kind==="receipts"&&proposal.phase==="receipts"&&reading.acceptedPage)
        return proposal.receipts===reading.acceptedPage.receipts&&pageIdentity()===reading.acceptedPage.identity;
      return samePage
        &&(proposal.phase===reading.phase||reading.temporary&&(proposal.phase==="unavailable"||proposal.phase==="uncertain"));
    };
    const adopt=(target:typeof expected)=>{
      expected=target;ownedPresentation=proposal.presentationId;ownedVisible=proposal.visible;ownedPhase=proposal.phase;ownedBusy=proposal.busy;
      ownedReceipt=proposal.receipt;ownedReceiptIdentity=canonicalAdaptiveSelection(proposal.receipt);ownedPage=proposal.receipts;ownedPageIdentity=pageIdentity();
    };
    const navigation={documentId:scope.documentId,canvasId,scopeKey:authority,originalSelection,focus,current:()=>{
      const current=this.store.canvasProjection.get();
      if(retired||!this.isConnected||this.store.route.get()!==route||this.#selected!==selection||selection.size!==1||!selection.has(item.id)
        ||!reviewCurrent()
        ||!this.store.sourceOwnershipActive(source)||this.store.projection.get().projectId!==scope.projectId
        ||JSON.stringify(this.store.projection.get().libraryBlocks.find(value=>value.id===block.id&&!value.removed))!==blockIdentity
        ||current.selectedCanvasId!==canvasId||JSON.stringify(current.items.find(candidate=>candidate.id===item.id))!==identity)retired=true;
      return!retired;
    },readPresentation:async(operation:AdaptiveProposalReadOperation,read:(control?:AdaptiveProposalReadControl)=>Promise<void>)=>{
      if(!navigation.current()||proposal.busy||reading)return;
      // Only a row in the current validated page may change receipt identity.
      // Its callback cannot outlive that page, even if another row has equal IDs.
      if(operation.kind==="choose"&&(proposal.phase!=="receipts"||!proposal.receipts.includes(operation.receipt)))return;
      const target=operation.kind==="choose"?receiptTarget(operation.receipt):expected;
      if(!target)return;
      const owned={presentation:proposal.presentationId+Number(!proposal.visible),opening:true,kind:operation.kind,expected:target,
        temporary:false,invalid:false,phase:proposal.phase,receipt:proposal.receipt,receiptIdentity:canonicalAdaptiveSelection(proposal.receipt),
        page:proposal.receipts,pageIdentity:pageIdentity(),acceptedReceipt:undefined as typeof receipt|undefined,
        acceptedReceiptIdentity:undefined as string|undefined,
        acceptedPage:undefined as {receipts:typeof proposal.receipts;identity:string}|undefined};reading=owned;
      const control={temporaryFailure:()=>{if(reading===owned&&navigation.current())owned.temporary=true;},
        retire:()=>{if(reading===owned)owned.invalid=true;},
        receiptAccepted:(value:NonNullable<typeof receipt>)=>{
          if(reading!==owned||!navigation.current())return false;
          if(operation.kind==="receipts"||receiptIdentity(value)!==target.identity){owned.invalid=true;return false;}
          owned.acceptedReceipt=value;owned.acceptedReceiptIdentity=canonicalAdaptiveSelection(value);
          return true;
        },
        pageAccepted:(receipts:typeof proposal.receipts,nextCursor:string|null,discovery:"proposal"|"destination")=>{
          if(reading!==owned||!navigation.current())return false;
          if(operation.kind!=="receipts"){owned.invalid=true;return false;}
          owned.acceptedPage={receipts,identity:canonicalAdaptiveSelection({receipts,nextCursor,discovery})};
          return true;
        }};
      try{const pending=read(control);owned.opening=false;await pending;}
      finally{if(reading===owned){
        // Restore exact reference/fingerprint guards after the declared read.
        if(navigation.current())adopt(target);
        reading=undefined;this.#currentProposalResultNavigation();
      }}
    },close:()=>{
      if(!navigation.current()||!proposal.visible)return;
      const target=reading?.expected??expected;reading=undefined;
      // Cancel only this read presentation. A late completion cannot publish
      // into a subsequent explicit Resume of the same content-free handle.
      proposal.suspend();adopt(target);
    },dispose:()=>{retired=true;unsubscribe();focus.dispose();}};
    this.#proposalResultNavigation=navigation;this.#selected=selection;this.#cameraX=item.x-48;this.#cameraY=item.y-48;
    this.#go(route);
    if(this.#currentProposalResultNavigation()!==navigation)return;
    // Observe each committed Store notification, not merely the next render:
    // a route/source/authority A -> B -> A must not revive this read context.
    const observe=()=>{
      if(this.#currentProposalResultNavigation()!==navigation)return;
      proposal.synchronize();this.#currentProposalResultNavigation();
    };
    unsubscribe=this.store.subscribe(observe);observe();this.requestUpdate();
    void this.updateComplete.then(()=>{
      try{
      const current=this.store.canvasProjection.get();
      if(this.#currentProposalResultNavigation()!==navigation||!this.isConnected||this.store.route.get()!==route||proposal.visible||proposal.presentationId!==presentation||proposal.receipt!==receipt
        ||proposal.ports.scope()?.key!==authority||!proposal.canOpen("canvas-item",item.id)||current.selectedCanvasId!==canvasId||this.querySelector("dialog[open]")
        ||!current.items.some(candidate=>candidate.id===item.id&&candidate.sourceId===item.sourceId&&candidate.sourceKind===item.sourceKind)||!focus.current())return;
      const target=this.querySelector<HTMLElement>('[data-canvas-item-id="'+CSS.escape(item.id)+'"]');
      if(target)focus.run(target,()=>{target.focus({preventScroll:true});return true;});
      }finally{focus.dispose();}
    },()=>navigation.dispose());
  }
  #proposalDialog(){return renderAdaptiveProposalDialog(this.#proposalReview,this.i18n,{id:"canvas-adaptive-proposal-title",dialog:()=>this.querySelector<HTMLDialogElement>(".adaptive-proposal-dialog"),close:()=>this.#closeProposalReview(),open:(kind,id)=>this.#openProposalResult(kind,id)});}
  #resumeProposalReview=()=>{const active=this.ownerDocument?.activeElement;if(active instanceof HTMLElement)this.#proposalOpener=active;void this.#proposalReview.resume();};
  #offline:{count:number;bytes:number;warning:boolean;full:boolean;paused?:number;sourcePausePending?:boolean;sourcePauseFailed?:boolean;unverified?:true}={count:0,bytes:0,warning:false,full:false,unverified:true};
  #presence:CanvasPresence[]=[];
  #presenceHub?:CanvasPresenceHub;

  #presenceKey="";
  #presenceUnsubscribe?:()=>void;
  #viewportCanvas="";
  #viewportElement?:HTMLElement;
  #viewportObserver?:ResizeObserver;
  #viewportSize?: { width: number; height: number };
  #touchPointers = new Map<number, CanvasTouchPoint>();
  #suppressedPointers = new Set<number>();
  #touchTransform?: { ids: [number, number]; starting: [CanvasTouchPoint, CanvasTouchPoint]; viewport: CanvasTouchViewport };
  #drawPoints:number[]=[];
  #clientInstance=uid();
  #syncTimer=0;
  #interactionCanvas="";
  #zoomInteractionTimer=0;
  #panInteractionTimer=0;
  #viewportSaveTimer=0;
  #searchInteractionTimer=0;
  #queueOwner?:CanvasSourceOwner;
  #sourcePausePending=false;
  #sourcePauseFailed=false;
  #syncing=false;
  #refreshing=false;
  #flushPromise:Promise<void>|null=null;
  #syncIssueNotified=false;
  #syncRetryTimer=0;
  #syncRetryAt=0;
  #lastInteractionAt=Date.now();
  #lastStreamRefreshAt=0;
  #online=()=>{this.requestUpdate();if(this.#canEditCanvas())void this.#refreshQueue();};
  #pagehide=()=>{if(this.#viewportCanvas)this.#persistViewport(this.#viewportCanvas);};
  #keyboard=(event:KeyboardEvent)=>this.#onKey(event);
  #interactionClick=(event:Event)=>{this.#lastInteractionAt=Date.now();const control=(event.target as Element|null)?.closest<HTMLElement>("button,summary,a");if(!control)return;const label=(control.getAttribute("aria-label")||control.textContent||"").replace(/\s+/g," ").trim();const matches=(source:string)=>label===source||label===this.i18n.system(source);const starts=(source:string)=>label.startsWith(source)||label.startsWith(this.i18n.system(source));if(control.closest(".canvas-history-actions"))return;if(control.matches(".canvas-focus-toggle")){this.#trackCanvasInteraction("focus_toggled",{focused:!canvasFocusFromRoute(this.store.route.get())});return;}if(control.closest(".canvas-command-actions")&&matches("Add")){this.#trackCanvasInteraction("add_opened",{category:"start"});return;}if(control.closest(".canvas-add-choices")){this.#trackCanvasInteraction("add_category_changed",{add_category:control.closest<HTMLElement>("[data-add-category]")?.dataset.addCategory??control.dataset.addCategory??"unknown"});return;}if(control.closest(".canvas-view-menu")&&(starts("Project members")||matches("Project sharing"))){this.#trackCanvasInteraction("members_opened");return;}if(control.closest(".canvas-view-menu")&&starts("Accessible reading order")){this.#trackCanvasInteraction("reading_order_opened");return;}if(control.closest(".canvas-view-menu")&&(matches("Everything")||/.+: .+/u.test(label))){this.#trackCanvasInteraction("filter_changed",{filter_kind:matches("Everything")?"all":"facet"});return;}if(control.closest(".canvas-selection-hud")&&starts("Organize")){this.#trackCanvasInteraction("organization_menu_opened");return;}if(control.closest(".canvas-selection-hud")&&matches("Open")){this.#trackCanvasInteraction("document_opened");return;}if(control.closest(".canvas-compare-view")&&matches("Remove")){this.#trackCanvasInteraction("comparison_member_removed");return;}if(control.closest(".canvas-intent-response")&&starts("Dismiss")){this.#trackCanvasInteraction("suggestion_dismissed");return;}if(control.closest(".canvas-render-dialog")&&starts("Open document"))this.#trackCanvasInteraction("document_opened");};
  #interactionChange=(event:Event)=>{const control=event.target as HTMLSelectElement;if(control.matches(".canvas-view-menu select"))this.#trackCanvasInteraction("sort_changed",{sort:control.value});};
  #interactionInput=(event:Event)=>{const control=event.target as HTMLInputElement;if(control.matches(".canvas-source-search input"))this.#searchSources(control.value);};
  #touchDown = (event: Event) => {
    const pointer = event as PointerEvent;
    const target = pointer.target instanceof Element ? pointer.target : null;
    if (pointer.pointerType !== "touch" || (target?.closest("button,a,input,textarea,select,summary,dialog,[contenteditable=true]") && !target.closest(".canvas-resize-handle"))) return;
    this.#touchPointers.set(pointer.pointerId, { x: pointer.clientX, y: pointer.clientY });
    if (this.#touchPointers.size !== 2 || this.#touchTransform) return;
    const entries = [...this.#touchPointers.entries()];
    const first = entries[0]!;
    const second = entries[1]!;
    this.#touchTransform = { ids: [first[0], second[0]], starting: [{ ...first[1] }, { ...second[1] }], viewport: { zoom: this.#zoom, cameraX: this.#cameraX, cameraY: this.#cameraY } };
    this.#suppressedPointers.add(first[0]);
    this.#suppressedPointers.add(second[0]);
    pointer.preventDefault();
    pointer.stopPropagation();
  };
  #touchMove = (event: Event) => {
    const pointer = event as PointerEvent;
    if (pointer.pointerType !== "touch" || !this.#touchPointers.has(pointer.pointerId)) return;
    this.#touchPointers.set(pointer.pointerId, { x: pointer.clientX, y: pointer.clientY });
    const gesture = this.#touchTransform;
    if (!gesture) {
      if (this.#suppressedPointers.has(pointer.pointerId)) { pointer.preventDefault(); pointer.stopPropagation(); }
      return;
    }
    const first = this.#touchPointers.get(gesture.ids[0]);
    const second = this.#touchPointers.get(gesture.ids[1]);
    const viewport = this.#viewportElement;
    if (!first || !second || !viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const transformed = canvasPinchViewport(gesture.viewport, gesture.starting, [first, second], { x: bounds.left, y: bounds.top });
    this.#zoom = transformed.zoom;
    this.#cameraX = transformed.cameraX;
    this.#cameraY = transformed.cameraY;
    this.#scheduleViewportPersistence();
    pointer.preventDefault();
    pointer.stopPropagation();
    this.requestUpdate();
  };
  #touchEnd = (event: Event) => {
    const pointer = event as PointerEvent;
    if (pointer.pointerType !== "touch" || !this.#touchPointers.has(pointer.pointerId)) return;
    this.#touchPointers.delete(pointer.pointerId);
    if (this.#touchTransform?.ids.includes(pointer.pointerId)) {
      this.#touchTransform = undefined;
      this.#scheduleViewportPersistence();
    }
    queueMicrotask(() => this.#suppressedPointers.delete(pointer.pointerId));
  };
  #bindTouchViewport(viewport: HTMLElement | undefined, attach: boolean) {
    if (!viewport) return;
    const action = attach ? "addEventListener" : "removeEventListener";
    viewport[action]("pointerdown", this.#touchDown, true);
    viewport[action]("pointermove", this.#touchMove, true);
    viewport[action]("pointerup", this.#touchEnd, true);
    viewport[action]("pointercancel", this.#touchEnd, true);
  }

  override connectedCallback(){super.connectedCallback();window.addEventListener("online",this.#online);window.addEventListener("offline",this.#online);window.addEventListener("keydown",this.#keyboard);window.addEventListener("pagehide",this.#pagehide);window.addEventListener("forma-assistant-tool-request",this.#assistantTool);window.addEventListener("forma-event-source-retired",this.#sourceRetired);this.addEventListener("click",this.#interactionClick);this.addEventListener("change",this.#interactionChange);this.addEventListener("input",this.#interactionInput);void this.#refreshQueue();this.#syncTimer=window.setInterval(()=>void this.#refreshSharedStream(),1_500);}
  override disconnectedCallback(){this.#proposalResultNavigation?.dispose();this.#proposalResultNavigation=undefined;this.#disposeControlsFocus();this.#closePopovers();this.#proposalReview.suspend();if(this.#viewportCanvas)this.#persistViewport(this.#viewportCanvas);window.removeEventListener("online",this.#online);window.removeEventListener("offline",this.#online);window.removeEventListener("keydown",this.#keyboard);window.removeEventListener("pagehide",this.#pagehide);window.removeEventListener("forma-assistant-tool-request",this.#assistantTool);window.removeEventListener("forma-event-source-retired",this.#sourceRetired);this.removeEventListener("click",this.#interactionClick);this.removeEventListener("change",this.#interactionChange);this.removeEventListener("input",this.#interactionInput);window.clearInterval(this.#syncTimer);window.clearTimeout(this.#syncRetryTimer);window.clearTimeout(this.#zoomInteractionTimer);window.clearTimeout(this.#panInteractionTimer);window.clearTimeout(this.#viewportSaveTimer);window.clearTimeout(this.#searchInteractionTimer);this.#viewportObserver?.disconnect();this.#bindTouchViewport(this.#viewportElement,false);this.#touchPointers.clear();this.#suppressedPointers.clear();this.#touchTransform=undefined;this.#resetPresence();document.documentElement.removeAttribute("data-canvas-focus");super.disconnectedCallback();}
  #currentControlsScope(){
    const source=this.store.captureSourceOwnership(),authorization=source?.authorization,canvas=this.store.canvasProjection.get();
    return authorization&&canvas.selectedCanvasId&&canvas.canvases.some((board)=>board.id===canvas.selectedCanvasId)
      ?JSON.stringify([authorization.key,source!.generation,canvas.projectId,canvas.selectedCanvasId,this.#canEditCanvas()]):"";
  }
  protected override willUpdate(){
    this.#captureQueueOwner();
    const scope=this.#currentControlsScope(),canvas=this.store.canvasProjection.get();
    const route=this.store.route.get();
    if(scope!==this.#controlsScope||route!==this.#popoverRoute){this.#disposeControlsFocus();this.#closePopovers();}
    this.#popoverRoute=route;
    if([...this.#selected].some((id)=>!canvas.items.some((item)=>item.id===id)))this.querySelector<FormaUiPopover>(".canvas-organize-control")?.close();
    const selection=JSON.stringify([scope,canvasViewFromRoute(this.store.route.get()),outcomeDeskRouteState(this.store.route.get()).posture,[...this.#selected].sort()]);
    if(selection!==this.#selectionKey){
      this.#disposeControlsFocus();
      for(const hud of this.querySelectorAll<HTMLElement>(".canvas-selection-hud"))suspendContextControls(hud);
      for(const panel of this.querySelectorAll<HTMLElement>(".canvas-selection-hud [popover]"))if(panel.matches(":popover-open"))panel.hidePopover();
    }
    if(this.#controlsScope&&scope!==this.#controlsScope){
      this.#closeAdd(false);this.#closeDocumentOutputs(false);this.#selectionContexts.clear();
      this.#closeArrangement(false);this.#arrangementName="";this.#arrangementReturnFocus=undefined;this.#deskDismissed.clear();
      this.#newBlockTitle="";this.#newBlockBody="";this.#sourceQuery="";this.#selectedSourceIds.clear();this.#addKind="start";
      this.#addReturnFocus=undefined;this.#outputsReturnFocus=undefined;this.#renderReturnFocus=undefined;
    }
    if(this.#documentOutputsOpen&&!canvas.items.some((item)=>item.id===this.#documentOutputsItemId&&item.sourceKind==="document"&&item.sourceId===this.#outputsDocumentId))this.#closeDocumentOutputs(false);
    this.#controlsScope=scope;this.#selectionKey=selection;
  }
  #disposeControlsFocus(){this.#controlsFocus?.dispose();this.#controlsFocus=undefined;this.#arrangement.retireRecovery();}
  #returnControlsFocus(opener?:HTMLElement){
    this.#disposeControlsFocus();
    const scope=this.#controlsScope,route=this.store.route.get(),selection=JSON.stringify([...this.#selected].sort());
    const lease=captureOutputNavigationFocus(this.ownerDocument);
    this.#controlsFocus=lease;
    const dispose=()=>{lease.dispose();if(this.#controlsFocus===lease)this.#controlsFocus=undefined;};
    void this.updateComplete.then(()=>{
      try{
        if(this.#controlsFocus!==lease||!this.isConnected||!scope||scope!==this.#currentControlsScope()
          ||route!==this.store.route.get()||selection!==JSON.stringify([...this.#selected].sort())
          ||this.#addOpen||this.#documentOutputsOpen||this.querySelector("dialog[open]")||!lease.current())return;
        const target=opener?.isConnected?opener:this.querySelector<HTMLElement>(".canvas-viewport,.canvas-stage-shell");
        if(target)lease.run(target,()=>{target.focus({preventScroll:true});return true;});
      }finally{dispose();}
    },dispose);
  }
  #closeAdd(restoreFocus=true){
    this.#disposeControlsFocus();
    this.#addOpen=false;
    this.querySelector<HTMLDialogElement>(".canvas-add-dialog")?.close();
    this.requestUpdate();if(restoreFocus)this.#returnControlsFocus(this.#addReturnFocus);
  }
  protected override updated(){
    this.#proposalReview.synchronize();
    document.documentElement.toggleAttribute("data-canvas-focus",canvasFocusFromRoute(this.store.route.get()));
    const imageOpening=this.#nextImageOpening;let retiredImageDialog:HTMLDialogElement|null=null;
    if(imageOpening&&(!this.#viewingOutputId||!imageOpening.current())){
      retiredImageDialog=this.querySelector<HTMLDialogElement>(".canvas-output-viewer");
      this.#nextImageOpening=null;this.#viewingOutputId="";
      retiredImageDialog?.close();
    }
    this.querySelectorAll<HTMLDialogElement>("dialog.modal").forEach((dialog)=>{
      if(dialog===retiredImageDialog)return;
      const image=dialog.matches(".canvas-output-viewer")?this.#nextImageOpening:null;
      if(image&&!image.current())return;
      if(dialog.dataset.canvasTopLayer==="true")return;
      dialog.dataset.canvasTopLayer="true";const promoted=ensureModalDialog(dialog);
      if(image&&promoted&&this.#nextImageOpening===image)image.presented=true;
    });
    const canvas=this.store.canvasProjection.get();const canvasId=canvas.selectedCanvasId;
    this.store.setCanvasPlanningSelection([...this.#selected]);
    if(outcomeDeskRouteState(this.store.route.get()).posture==="outcomes"){const current=this.#deskCurrent();
      if(current.facts.canRead&&["loading","refreshing"].includes(current.output?.resource.state??""))void this.store.outputRequirements.ensure(current.facts.documentId);
    }
    const arrangementStamp=this.#arrangementStamp();
    if(arrangementStamp!==this.#arrangementCheckedStamp){this.#arrangementCheckedStamp=arrangementStamp;void this.#arrangement.revalidate();}
    const undoRequest=this.store.canvasArrangementUndoRequest.get();
    if(undoRequest&&undoRequest!==this.#arrangementUndoRequest){this.#arrangementUndoRequest=undoRequest;this.store.canvasArrangementUndoRequest.set(null);
      if(undoRequest.authorityKey===this.store.captureAuthorizationScope()?.key&&undoRequest.canvasId===canvasId
        &&undoRequest.projectId===canvas.projectId)void this.#reviewArrangementUndo(undoRequest.operationId);
    }
    if(canvasId&&canvasId!==this.#interactionCanvas){this.#interactionCanvas=canvasId;this.#trackCanvasInteraction("board_opened",{item_count:canvas.items.length});}
    this.#syncPresence();
    const viewport=this.querySelector<HTMLElement>(".canvas-viewport");if(viewport!==this.#viewportElement){this.#viewportObserver?.disconnect();this.#bindTouchViewport(this.#viewportElement,false);this.#viewportElement=viewport??undefined;this.#viewportSize=viewport?{width:viewport.clientWidth,height:viewport.clientHeight}:undefined;this.#bindTouchViewport(this.#viewportElement,true);if(viewport&&typeof ResizeObserver!=="undefined"){this.#viewportObserver=new ResizeObserver((entries)=>{const entry=entries[0];if(!entry)return;const next={width:entry.contentRect.width,height:entry.contentRect.height},previous=this.#viewportSize;this.#viewportSize=next;if(previous&&previous.width>0&&previous.height>0&&next.width>0&&next.height>0&&this.#touchPointers.size<2){this.#cameraX+=(previous.width-next.width)/(2*this.#zoom);this.#cameraY+=(previous.height-next.height)/(2*this.#zoom);this.#scheduleViewportPersistence();}this.requestUpdate();});this.#viewportObserver.observe(viewport);}}
    if(canvasId&&canvasId!==this.#viewportCanvas){if(this.#viewportCanvas)this.#persistViewport(this.#viewportCanvas);this.#viewportCanvas=canvasId;const restored=this.#restoreViewport(canvasId);if(restored)this.requestUpdate();else{this.#zoom=1;this.#cameraX=0;this.#cameraY=0;requestAnimationFrame(()=>{if(this.#viewportCanvas!==canvasId)return;const activeViewport=this.#viewportElement;if(!activeViewport)return;const first=canvas.items[0];this.#cameraX=(first?.x??0)-activeViewport.clientWidth*.28/this.#zoom;this.#cameraY=(first?.y??0)-activeViewport.clientHeight*.28/this.#zoom;this.#scheduleViewportPersistence(canvasId);this.requestUpdate();});}}
  }

  #currentPresenceScope() {
    if (!this.isConnected) return null;
    const session = this.store.session.get(), canvas = this.store.canvasProjection.get();
    const authorization = this.store.captureAuthorizationScope(), context = session?.projectContext;
    if (!session || !session.user.userId || session.user.userId.toLowerCase() === "anonymous" || session.impersonation || !session.policy?.accepted || !session.canvas?.access ||
      !authorization || !this.store.authorizationScopeActive(authorization) ||
      !session.permissionEpoch || !canvas.projectId || !canvas.selectedCanvasId ||
      !canvas.canvases.some((board) => board.id === canvas.selectedCanvasId &&
        board.projectId === canvas.projectId && !board.removed)) return null;
    const permissions = context?.permissions ?? session.capabilities ?? [];
    if (!permissions.includes("project.read") || context &&
      (context.projectId !== canvas.projectId || !permissions.includes("project.canvas.use") ||
        !Number.isFinite(Date.parse(context.expiresAt)) || Date.parse(context.expiresAt) <= Date.now())) return null;
    // Stable scope shared by this account's tabs; expiry stays a local lifecycle
    // guard so separately issued sessions with the same grants can still meet.
    const authorizationKey = JSON.stringify([authorization.key, session.user.role,
      [...(session.capabilities ?? [])].sort(), session.policy.version, session.canvas.version,
      context ? [context.organizationId, context.projectAccessId, context.ownerUserId,
        context.role, [...context.permissions].sort()] : null]);
    const scope = { userId: session.user.userId, projectId: canvas.projectId,
      canvasId: canvas.selectedCanvasId, authorizationKey };
    return { scope, key: JSON.stringify([scope, context?.expiresAt ?? null]) };
  }
  #resetPresence() {
    const hub = this.#presenceHub, visible = this.#presence.length > 0;
    this.#presenceHub = undefined;
    this.#presenceKey = "";
    this.#presenceUnsubscribe?.();
    this.#presenceUnsubscribe = undefined;
    this.#presence = [];
    hub?.disconnect();
    if (visible && this.isConnected) this.requestUpdate();
  }
  #syncPresence() {
    const current = this.#currentPresenceScope(), key = current?.key ?? "";
    if (key === this.#presenceKey) return;
    this.#resetPresence();
    if (!current) return;
    const hub = new CanvasPresenceHub();
    this.#presenceHub = hub;
    this.#presenceKey = key;
    this.#presenceUnsubscribe = hub.subscribe((presence) => {
      if (this.#presenceHub !== hub) return;
      if (this.#currentPresenceScope()?.key !== key) { this.#resetPresence(); return; }
      if (!presence.length && !this.#presence.length) return;
      this.#presence = presence;
      this.requestUpdate();
    });
    hub.connect(current.scope, () => this.#presenceHub === hub &&
      this.#currentPresenceScope()?.key === key);
  }
  #go(path:string){this.#closePopovers();this.store.setRoute(path);}
  #leave(path:string){
    if(path===this.store.route.get())return Promise.resolve(true);
    return navigateInApp(this,navigation=>{this.#closePopovers();return navigation.route(path);});
  }
  #localCanvasPresentation(path:string):{view?:CanvasView;focusId?:string;retainDeskIntent?:boolean}|null {
    const route=this.store.route.get(),canvas=this.store.canvasProjection.get(),boardId=canvas.selectedCanvasId;
    if(!path.startsWith("/")||path.startsWith("//")||!this.#controlsScope||this.#controlsScope!==this.#currentControlsScope()
      ||!boardId||canvasIdFromRoute(route)!==boardId||canvasIdFromRoute(path)!==boardId)return null;
    const intent=this.querySelector<HTMLElement>(".canvas-intent-dock");
    const retainDeskIntent=canvasViewFromRoute(route)==="spatial"&&canvasViewFromRoute(path)==="spatial"
      &&Boolean(intent?.isConnected&&intent.closest("forma-canvas-surface")===this);
    if(path===route){
      const active=this.ownerDocument.activeElement;
      return active&&this.contains(active)&&active.closest(".outcome-desk")
        ?{focusId:active.closest(".outcome-desk-objects")?"canvas-outcome-desk-selected":"canvas-outcome-desk-heading",retainDeskIntent}:{};
    }
    for(const view of ["spatial","list","folders"] as const)if(path===withCanvasView(route,view))return {view};
    if(path===withCanvasFocus(route,true)||path===withCanvasFocus(route,false))return {};
    const lens=canvasLensFromRoute(path);
    if(["authored","title","type","random"].includes(lens.sort)&&(lens.sort!=="random"||/^\d+$/u.test(lens.seed))
      &&path===withCanvasQuery(route,{sort:lens.sort,seed:lens.sort==="random"?lens.seed:null}))return {};
    if((lens.filter==="all"||this.#facetGroups(canvas.items).some(({facet})=>lens.filter===`facet:${canvasFacetKey(facet)}`))
      &&path===withCanvasQuery(route,{filter:lens.filter}))return {};
    if(path===withOutcomeDeskPosture(route,"canvas"))return {focusId:this.#viewTriggerId,retainDeskIntent};
    if(path===withOutcomeDeskPosture(route,"outcomes"))return {focusId:"canvas-outcome-desk-heading",retainDeskIntent};
    const desk=outcomeDeskRouteState(path);
    if(desk.selectedKey&&path===withOutcomeDeskSelection(route,desk.selectedKey)
      &&projectOutcomeDesk(this.#deskCurrent(),desk.selectedKey).selected)return {focusId:"canvas-outcome-desk-selected",retainDeskIntent};
    if(path===withOutcomeRecipe(route,desk.recipeId))return {focusId:"canvas-outcome-desk-heading",retainDeskIntent};
    return null;
  }
  captureLocalNavigation(path:string):LocalNavigation|null {
    const target=this.#localCanvasPresentation(path);if(!target)return null;
    const departure=this.#captureCanvasDeparture(true,target.retainDeskIntent===true),store=this.store,scope=this.#controlsScope,source=store.captureSourceOwnership();
    const intent=target.retainDeskIntent?this.querySelector<HTMLElement>(".canvas-intent-dock"):null;
    const retainedIntentCurrent=()=>!target.retainDeskIntent||Boolean(intent?.isConnected
      &&intent.closest("forma-canvas-surface")===this&&this.querySelector(".canvas-intent-dock")===intent);
    const current=()=>this.store===store&&store.sourceOwnershipActive(source)&&retainedIntentCurrent()
      &&departure.current()&&this.#localCanvasPresentation(path)!==null;
    return {...departure,current,prepare:()=>{
      if(!current())return false;
      this.#closePopovers();
      if(target.view)this.#trackCanvasInteraction("view_changed",{view:target.view});
      return current();
    },afterCommit:async arrival=>{
      if(!target.focusId)return;
      const version=++this.#deskFocusVersion,opening=this.#arrangementOpening;
      await this.updateComplete;
      if(!arrival.current()||this.store!==store||!store.sourceOwnershipActive(source)||!retainedIntentCurrent()||scope!==this.#currentControlsScope()||store.route.get()!==path
        ||version!==this.#deskFocusVersion||opening!==this.#arrangementOpening||this.#arrangementOpen||this.querySelector("dialog[open]"))return;
      const targets=[...this.querySelectorAll<HTMLElement>("[id]")].filter(element=>element.id===target.focusId);
      const element=targets.length===1?targets[0]:null;
      if(element?.isConnected&&element.closest("forma-canvas-surface")===this&&!element.closest("[hidden],[inert]")
        &&element.getClientRects().length&&arrival.current())arrival.focus.run(element,()=>{element.focus({preventScroll:true});return true;});
    }};
  }
  #navigateCanvasPresentation(path:string){return navigateInApp(this,{localRoute:path});}
  #chooseView(view:CanvasView){return this.#navigateCanvasPresentation(withCanvasView(this.store.route.get(),view));}
  #referenceSourcesPresentationCurrent(element:HTMLDialogElement){
    if(!this.#addOpen||this.#addKind!=="reference"||!this.#canEditCanvas()
      ||this.querySelector(".canvas-add-dialog")!==element||element.closest("forma-canvas-surface")!==this
      ||this.#sourceQuery||this.#selectedSourceIds.size)return false;
    const placed=new Set(this.store.canvasProjection.get().items.map(item=>item.sourceId));
    return !this.#sources().some(source=>source.kind==="reference"&&!placed.has(source.id));
  }
  #openReferenceLibrary(event:MouseEvent){
    if(event.defaultPrevented||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return Promise.resolve(false);
    event.preventDefault();
    const trigger=event.currentTarget as HTMLElement|null;
    const element=trigger?.closest<HTMLDialogElement>(".canvas-add-dialog");
    if(!trigger||!element)return Promise.resolve(false);
    const scope=this.#currentControlsScope(),opener=this.#addReturnFocus;
    return navigateInApp(this,navigation=>{
      if(!navigation.closePresentation(()=>this.#closeAdd(false)))return false;
      return navigation.route("/canvas/library");
    },{presentation:{owner:this,element,trigger,
      current:()=>Boolean(scope)&&scope===this.#currentControlsScope()&&this.#referenceSourcesPresentationCurrent(element),
      ...(opener?.isConnected&&this.contains(opener)?{opener}:{})}});
  }
  #viewportStorage(){try{return window.localStorage;}catch{return undefined;}}
  #viewportUserId(){const session=this.store.session.get();return session?.projectContext?`${session.user.userId}:${session.projectContext.projectAccessId}`:session?.user.userId??"anonymous";}
  #captureQueueOwner(){
    const source=this.store.captureSourceOwnership(),scope=this.#queueScope();
    if(!source||!this.store.sourceOwnershipActive(source)||!scope.ownerId||!scope.projectId)return null;
    const prior=this.#queueOwner;
    if(prior&&prior.source.authorization.key===source.authorization.key&&prior.source.generation===source.generation
      &&JSON.stringify(prior.scope)===JSON.stringify(scope))return prior;
    if(prior&&(prior.source.authorization.key!==source.authorization.key||JSON.stringify(prior.scope)!==JSON.stringify(scope))){
      // This is a different known queue owner, not evidence that the original pause was persisted.
      this.#offline={count:0,bytes:0,warning:false,full:false,unverified:true};this.#sourcePausePending=false;this.#sourcePauseFailed=false;
    }
    const owner={source,scope,retired:false};this.#queueOwner=owner;return owner;
  }
  #queueSourceRetired(owner:CanvasSourceOwner){
    return owner.retired||this.store.sourceOwnershipScopeActive(owner.source)&&!this.store.sourceOwnershipActive(owner.source);
  }
  #queueOwnerCurrent(owner:CanvasSourceOwner){
    return this.isConnected&&this.#queueOwner===owner&&this.store.sourceOwnershipActive(owner.source)&&this.#queueScopeActive(owner.scope)&&!owner.retired;
  }
  #sourceRetired=(event:Event)=>{
    const detail=(event as CustomEvent<{source:CapturedSourceOwnership;generation:number;status:number}>).detail,owner=this.#queueOwner;
    if(!detail||!owner||![401,403,404].includes(detail.status)||this.store.sourceOwnershipActive(this.store.captureSourceOwnership())||!this.store.sourceOwnershipScopeActive(detail.source)
      ||detail.source.authorization.key!==owner.source.authorization.key||detail.source.generation!==owner.source.generation)return;
    owner.retired=true;
    this.#disposeControlsFocus();this.#closePopovers();this.#closeAdd(false);this.#closeDocumentOutputs(false);
    this.#selected.clear();this.#selectionContexts.clear();this.#selectedSourceIds.clear();this.#controlsScope="";this.#selectionKey="";
    this.#arrangementName="";
    this.#addKind="start";this.#newBlockTitle="";this.#newBlockBody="";this.#sourceQuery="";this.#editValue="";this.#canvasName="";this.#documentTitle="";this.#contextName="";this.#contextTarget="";this.#intent="";
    this.#newCanvasOpen=false;this.#formalizeOpen=false;this.#memberOpen=false;this.#semanticOpen=false;this.#organizeOpen=false;this.#editOpen=false;this.#documentOpen=false;this.#renderOpen=false;
    this.#nextImageOpening=null;this.#viewingOutputId="";this.#viewingArtifactId="";this.#inputOutputId="";this.#inputArtifactId="";this.#inputFailureJobId="";this.#viewingComparisonId="";this.#viewerActionsOpen=false;this.#viewingOutputSource="canvas-image-dialog";
    this.#addReturnFocus=undefined;this.#outputsReturnFocus=undefined;this.#viewerReturnFocus=undefined;this.#renderReturnFocus=undefined;
    for(const dialog of this.querySelectorAll<HTMLDialogElement>("dialog[open]"))dialog.close();
    void this.#pauseQueue(owner);
  };
  #pausedQueueMessage(){
    return this.i18n.system("Canvas sync paused · original references retained");
  }
  #queueStatusCurrent(){
    const owner=this.#queueOwner;
    return Boolean(owner&&this.store.sourceOwnershipScopeActive(owner.source)
      &&JSON.stringify(owner.scope)===JSON.stringify(this.#queueScope()));
  }
  #queueStorageDisclosure(){
    if(!this.#queueStatusCurrent())return nothing;
    const state=this.#sourcePauseFailed?"failed":this.#sourcePausePending?"pending":null;
    if(!state)return nothing;
    const message=state==="failed"?this.i18n.system("Canvas sync is paused in this page. Device storage could not confirm removal of private draft bodies or retention of the pause after reload. Do not retry the original changes."):this.i18n.system("Canvas sync is paused in this page while device storage removes private draft bodies and saves original references. The pause after reload is not yet confirmed. Do not retry the original changes.");
    return html`<p class="canvas-storage-status" data-storage-state=${state} role="status" aria-live="polite">${message}</p>`;
  }
  async #pauseQueue(owner:CanvasSourceOwner,batches?:readonly QueuedCanvasBatch[],acknowledgment?:EventWriteAcknowledgment){
    owner.retired=true;
    if(this.#queueOwner===owner&&this.store.sourceOwnershipScopeActive(owner.source)){window.clearTimeout(this.#syncRetryTimer);this.#syncRetryAt=0;this.#sourcePausePending=true;this.requestUpdate();}
    try{
      const receipt=acknowledgment&&batches?{batches,acknowledgment,owner:{authorizationKey:owner.source.authorization.key,actorUserId:owner.scope.ownerId,projectId:owner.scope.projectId,sourceGeneration:owner.source.generation}}:undefined;
      await canvasOfflineQueue.retireSource(owner.scope,{...(batches?{batchIds:batches.map((batch)=>batch.id)}:{}),...(receipt?{receipt}:{})});
      if(this.isConnected&&this.#queueOwner===owner&&this.store.sourceOwnershipScopeActive(owner.source)){
        const summary=await canvasOfflineQueue.summary(owner.scope);
        if(this.isConnected&&this.#queueOwner===owner&&this.store.sourceOwnershipScopeActive(owner.source)){
          this.#offline=summary;this.#sourcePausePending=Boolean(summary.sourcePausePending);this.#sourcePauseFailed=Boolean(summary.sourcePauseFailed);
          if(this.#sourcePauseFailed)this.store.toast(this.i18n.system("Canvas sync is paused in this page. Device storage could not confirm removal of private draft bodies or retention of the pause after reload. Do not retry the original changes."));
          else if(!this.#sourcePausePending&&summary.paused)this.store.toast(this.i18n.system("Private Canvas draft bodies were withdrawn from this device queue. Original batch references are retained; unconfirmed changes are not retried."));
          this.requestUpdate();
        }
      }
    }catch{
      if(this.isConnected&&this.#queueOwner===owner&&this.store.sourceOwnershipScopeActive(owner.source)){
        this.#sourcePausePending=false;this.#sourcePauseFailed=true;
        this.store.toast(this.i18n.system("Canvas sync is paused in this page. Device storage could not confirm removal of private draft bodies or retention of the pause after reload. Do not retry the original changes."));
        this.requestUpdate();
      }
    }
  }
  #queueScope(){const session=this.store.session.get(),context=session?.projectContext;return{ownerId:session?.user.userId??"",projectId:this.store.canvasProjection.get().projectId||this.store.projection.get().projectId,...(context?{historyOwnerId:context.ownerUserId,organizationId:context.organizationId,projectAccessId:context.projectAccessId,permissionEpoch:session?.permissionEpoch??""}:{})};}
  #queueScopeActive(scope:{ownerId:string;projectId:string;organizationId?:string;projectAccessId?:string;historyOwnerId?:string;permissionEpoch?:string}){const current=this.#queueScope();return this.#canEditCanvas()&&current.ownerId===scope.ownerId&&current.projectId===scope.projectId&&current.organizationId===scope.organizationId&&current.projectAccessId===scope.projectAccessId&&current.historyOwnerId===scope.historyOwnerId&&current.permissionEpoch===scope.permissionEpoch;}
  #persistViewport(canvasId:string){window.clearTimeout(this.#viewportSaveTimer);this.#viewportSaveTimer=0;writeCanvasViewportState(this.#viewportStorage(),this.#viewportUserId(),canvasId,{zoom:this.#zoom,cameraX:this.#cameraX,cameraY:this.#cameraY});}
  #scheduleViewportPersistence(canvasId=this.#viewportCanvas){if(!canvasId)return;const state={zoom:this.#zoom,cameraX:this.#cameraX,cameraY:this.#cameraY};const userId=this.#viewportUserId();window.clearTimeout(this.#viewportSaveTimer);this.#viewportSaveTimer=window.setTimeout(()=>{this.#viewportSaveTimer=0;writeCanvasViewportState(this.#viewportStorage(),userId,canvasId,state);},250);}
  #restoreViewport(canvasId:string){const state=readCanvasViewportState(this.#viewportStorage(),this.#viewportUserId(),canvasId);if(!state)return false;this.#zoom=state.zoom;this.#cameraX=state.cameraX;this.#cameraY=state.cameraY;return true;}
  async #changeHistory(direction:"undo"|"redo"){if(!this.#canEditCanvas())return;const before=this.store.head.get();if(direction==="undo")await this.store.undo();else await this.store.redo();if(this.store.head.get()>before)this.#trackCanvasInteraction(direction==="undo"?"undo_invoked":"redo_invoked",{input_method:"button"});}
  #canEditCanvas(){const session=this.store.session.get(),context=session?.projectContext,permissions=context?.permissions??session?.capabilities??[];return this.store.sourceOwnershipActive(this.store.captureSourceOwnership())&&permissions.includes("project.read")&&permissions.includes("project.author")&&(context?["owner","editor"].includes(context.role)&&permissions.includes("project.canvas.use"):session?.canvas.access===true);}
  #trackCanvasInteraction(interactionId:CanvasInteractionId,details:Record<string,unknown>={}){if(!this.store.ui.instrumentation||this.store.session.get()?.projectContext)return;const definition=CANVAS_INTERACTION_DEFINITIONS.get(interactionId);const canvas=this.store.canvasProjection.get();void this.store.hot({type:"CanvasInteractionRecorded",payload:{interaction_id:interactionId,category:definition?.category,canvas_id:canvas.selectedCanvasId||null,project_id:canvas.projectId||this.store.projection.get().projectId,surface:canvas.selectedCanvasId?"canvas-workspace":"canvas-home",selection_count:this.#selected.size,...details}});}
  #openAdd(kind?:AddKind){if(!this.#canEditCanvas()||!this.#currentControlsScope())return;this.#disposeControlsFocus();if(kind&&kind!==this.#addKind){this.#addKind=kind;this.#sourceQuery="";this.#selectedSourceIds.clear();}this.#addReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;this.#addOpen=true;this.#trackCanvasInteraction("add_opened",{category:this.#addKind});this.requestUpdate();}
  #site(){return`${this.store.session.get()?.user.userId??"web"}:${this.#clientInstance}`.slice(0,128);}
  async #refreshSharedStream(){
    const now=Date.now(),minimum=now-this.#lastInteractionAt>15_000&&!this.#offline.count?9_000:1_500;
    if(this.#refreshing||!navigator.onLine||document.visibilityState!=="visible"||now-this.#lastStreamRefreshAt<minimum)return;
    this.#refreshing=true;this.#lastStreamRefreshAt=now;
    try{await this.store.refreshEvents();if(this.#offline.count)void this.#flushQueue();}
    catch(error){
      if(error instanceof Error&&/\b(?:401|403)\b/.test(error.message))try{
        const previous=this.store.session.get()?.projectContext;
        const current=await this.store.refreshSession();
        if(previous&&(!current.projectContext||current.projectContext.projectAccessId!==previous.projectAccessId||!current.canvas.access))this.#go("/projects");
      }catch{/* A transient authentication failure must not expose another account's history. */}
    }finally{this.#refreshing=false;}
  }
  async #refreshQueue(){
    const owner=this.#captureQueueOwner();
    if(typeof indexedDB==="undefined"||!owner||!this.#canEditCanvas())return;
    const sourceCurrent=()=>!this.#queueSourceRetired(owner),current=()=>this.#queueOwnerCurrent(owner);
    let batches=await canvasOfflineQueue.listBatches(owner.scope,{current:sourceCurrent});
    if(!current()){if(this.#queueSourceRetired(owner))await this.#pauseQueue(owner,batches);return;}
    if(batches.some((batch)=>batch.sourceRetired)){
      await canvasOfflineQueue.reconcileRetired(owner.scope,this.store.events.get(),{current});
      if(!current())return;
      batches=await canvasOfflineQueue.listBatches(owner.scope,{current:sourceCurrent});
      if(!current())return;
    }
    this.store.stageOptimisticCanvasEvents(batches.filter((batch)=>!batch.sourceRetired).flatMap((batch)=>batch.events).filter((event)=>!volatileCanvasEvent(event)));
    const summary=await canvasOfflineQueue.summary(owner.scope);if(!current())return;
    this.#offline=summary;this.#sourcePausePending=Boolean(summary.sourcePausePending);this.#sourcePauseFailed=Boolean(summary.sourcePauseFailed);
    if(navigator.onLine&&summary.count>(summary.paused??0)&&!this.#sourcePausePending&&!this.#sourcePauseFailed)void this.#flushQueue();
    this.requestUpdate();
  }
  #accepted(events:EventInput[],appended:CreativeEvent[]){const ids=new Set(events.map((event)=>String(event.payload.client_event_id??"")).filter(Boolean));const principal=this.store.session.get()?.user.userId??"";return appended.filter((event)=>(event.actor==="user"||event.actor===`user:${principal}`)&&ids.has(String(event.payload.client_event_id??"")));}
  async #queueLocally(events:EventInput[]){
    const owner=this.#captureQueueOwner();if(!owner||!this.#canEditCanvas())throw new Error("This shared board is available for viewing only.");
    const queued=await canvasOfflineQueue.enqueueBatch(events,owner.scope,{current:()=>!this.#queueSourceRetired(owner)});
    if(queued.sourceRetired||this.#queueSourceRetired(owner)){await this.#pauseQueue(owner,[queued]);throw new Error("canvas_source_retired");}
    if(!this.#queueOwnerCurrent(owner))throw new Error("The active project changed before this board change could be displayed.");
    const staged=this.store.stageOptimisticCanvasEvents(queued.events.filter((event)=>!volatileCanvasEvent(event)));
    const summary=await canvasOfflineQueue.summary(owner.scope);
    if(!this.#queueOwnerCurrent(owner))throw new Error("The active project changed before this board change could be displayed.");
    this.#offline=summary;this.#sourcePausePending=Boolean(summary.sourcePausePending);this.#sourcePauseFailed=Boolean(summary.sourcePauseFailed);
    if(!navigator.onLine&&!this.#syncIssueNotified){this.#syncIssueNotified=true;this.store.toast(this.#offline.full?"Canvas device queue is full. Reconnect before making more durable changes.":"Offline. Your board changes are saved on this device and remain visible while sync waits.");}
    this.requestUpdate();return{queued,staged};
  }
  async #runFlushQueue(){
    const owner=this.#captureQueueOwner();if(!owner||!this.#canEditCanvas())return;const scope=owner.scope;
    const activeScope=()=>this.#queueOwnerCurrent(owner);
    const flush=async()=>{this.#syncing=true;this.requestUpdate();try{while(navigator.onLine&&activeScope()){const owned=await canvasOfflineQueue.listBatches(scope,{current:()=>!this.#queueSourceRetired(owner)});if(!activeScope()){if(this.#queueSourceRetired(owner))await this.#pauseQueue(owner,owned);break;}const waiting=owned.filter((batch)=>!batch.sourceRetired);if(!waiting.length)break;const expired=waiting.filter((batch)=>batch.events.every(volatileCanvasEvent)&&Date.now()-Date.parse(batch.createdAt)>15_000);if(expired.length){for(const batch of expired)await canvasOfflineQueue.removeBatch(batch.id,scope);continue;}const group=[];let eventCount=0,bytes=0;for(const batch of waiting){if(group.length&&(group.length>=24||eventCount+batch.events.length>120||bytes+batch.bytes>512*1024))break;group.push(batch);eventCount+=batch.events.length;bytes+=batch.bytes;}if(!activeScope())break;const events=group.flatMap((batch)=>batch.events),result=await this.store.syncCanvasBatch(events);if(result.pause==="source-retired"){await this.#pauseQueue(owner,group,result.acknowledgment);break;}if(!activeScope())break;const acceptedIds=new Set(this.#accepted(events,result.appended).map((event)=>String(event.payload.client_event_id??"")));const rejectedIds=new Set(result.rejected.map((item)=>String(events[item.index??-1]?.payload.client_event_id??"")).filter(Boolean));if(result.retryable){this.#syncRetryAt=Date.now()+2_000;if(!this.#syncIssueNotified){this.#syncIssueNotified=true;this.store.toast("Saving is delayed by the connection. Every pending board change remains on this device and will retry in order.");}break;}this.#syncRetryAt=0;if(result.error&&!result.rejected.length){const ids=events.map((event)=>String(event.payload.client_event_id??""));this.store.discardOptimisticCanvasEvents(ids);for(const batch of group)await canvasOfflineQueue.removeBatch(batch.id,scope);this.store.toast(canvasSyncMessage(result.error,events.map((event)=>event.type),(message,values)=>this.i18n.system(message,values)));continue;}if(result.rejected.length){this.store.discardOptimisticCanvasEvents(rejectedIds);const reasons=[...new Set(result.rejected.map((item)=>item.reason))].join("; ");this.store.toast(canvasSyncMessage(reasons,result.rejected.map((item)=>events[item.index??-1]?.type??item.type??"Canvas change"),(message,values)=>this.i18n.system(message,values)));}const covered=new Set([...acceptedIds,...rejectedIds]);let incomplete=false;for(const batch of group){if(batch.events.every((event)=>covered.has(String(event.payload.client_event_id??""))))await canvasOfflineQueue.removeBatch(batch.id,scope);else incomplete=true;}if(incomplete){this.#syncRetryAt=Date.now()+1_000;break;}this.#syncIssueNotified=false;}}finally{if(activeScope()){const summary=await canvasOfflineQueue.summary(scope);if(activeScope())this.#offline=summary;}this.#syncing=false;if(activeScope())this.requestUpdate();}};
    if(navigator.locks?.request)await navigator.locks.request(`forma-canvas-ordered-sync:${encodeURIComponent(scope.ownerId)}:${encodeURIComponent(scope.projectId)}:${encodeURIComponent(scope.organizationId??"")}:${encodeURIComponent(scope.projectAccessId??"")}:${encodeURIComponent(scope.historyOwnerId??"")}:${encodeURIComponent(scope.permissionEpoch??"")}`,{mode:"exclusive"},flush);else await flush();
  }
  async #flushQueue(){const owner=this.#captureQueueOwner();if(!owner||!this.#queueOwnerCurrent(owner)||this.#sourcePausePending||this.#sourcePauseFailed)return;if(this.#flushPromise)return this.#flushPromise;if(this.#syncRetryAt>Date.now()){window.clearTimeout(this.#syncRetryTimer);this.#syncRetryTimer=window.setTimeout(()=>void this.#flushQueue(),this.#syncRetryAt-Date.now());return;}this.#flushPromise=this.#runFlushQueue();try{await this.#flushPromise;}finally{this.#flushPromise=null;if(navigator.onLine&&this.#queueOwnerCurrent(owner)&&!this.#sourcePausePending&&!this.#sourcePauseFailed&&this.#offline.count>(this.#offline.paused??0)){window.clearTimeout(this.#syncRetryTimer);this.#syncRetryTimer=window.setTimeout(()=>void this.#flushQueue(),Math.max(0,this.#syncRetryAt-Date.now()));}}}
  #preserveCombinedContexts(events:EventInput[]){
    const created=events.find((event)=>event.type==="DocumentCreated"&&event.payload.created_from==="canvas-selection");if(!created)return events;
    const sourceItemIds=(Array.isArray(created.payload.source_canvas_item_ids)?created.payload.source_canvas_item_ids:[]).map(String),canvas=this.store.canvasProjection.get(),selected=canvas.items.filter((item)=>sourceItemIds.includes(item.id)),membershipsBySource=this.#combinedMembershipsForSelection(selected);if(!membershipsBySource.size)return events;
    const groups=[...new Map([...membershipsBySource.values()].flat().map((membership)=>[membership.contextSetId,{context_set_id:membership.contextSetId,name:membership.name,role:membership.role,target:membership.target,application:membership.application,relativity:membership.relativity,source_canvas_id:membership.sourceCanvasId}])).values()];created.payload={...created.payload,combined_contexts:groups,combined_context_isolation:true};
    const memberBlockIds=new Map<string,string[]>();
    const decorated=events.map((event)=>{
      if(event.type!=="BlockCreated")return event;const properties=event.payload.properties&&typeof event.payload.properties==="object"&&!Array.isArray(event.payload.properties)?event.payload.properties as Record<string,unknown>:{};const sourceId=String(properties.copied_from_block_id??properties.source_output_id??properties.source_artifact_id??event.payload.source_artifact_id??"");const inherited=membershipsBySource.get(sourceId)??[];if(!inherited.length)return event;const merged=[...combinedContextMemberships(properties),...inherited].filter((membership,index,all)=>all.findIndex((candidate)=>candidate.contextSetId===membership.contextSetId)===index);const blockId=String(event.payload.block_id??"");for(const membership of inherited)memberBlockIds.set(membership.contextSetId,[...(memberBlockIds.get(membership.contextSetId)??[]),blockId]);return{...event,payload:{...event.payload,properties:{...properties,combined_context_memberships:merged,semantic_isolation:true}}};
    });
    const documentId=String(created.payload.document_id??""),projectId=String(created.payload.project_id??canvas.projectId),relationEvents:EventInput[]=[];for(const[groupId,ids]of memberBlockIds){const unique=[...new Set(ids.filter(Boolean))];for(let index=1;index<unique.length;index+=1)relationEvents.push({type:"BlockRelationAdded",payload:{relation_id:uid(),project_id:projectId,document_id:documentId,from_block_id:unique[0],to_block_id:unique[index],kind:"combined_context_member",properties:{context_set_id:groupId,semantic_isolation:true,relativity:groups.find((group)=>group.context_set_id===groupId)?.relativity??.8,member_order:index,created_from:"canvas-combined-context"}}});}
    const placementIndex=decorated.findIndex((event)=>event.type==="CanvasItemPlaced"&&event.payload.source_kind==="document"&&event.payload.source_id===documentId);if(placementIndex<0)return[...decorated,...relationEvents];return[...decorated.slice(0,placementIndex),...relationEvents,...decorated.slice(placementIndex)];
  }
  async #commit(events:EventInput[]){if(!events.length||!this.#canEditCanvas())return[];events=this.#preserveCombinedContexts(events);const historyActionId=uid();const selectedCanvas=this.store.canvasProjection.get().selectedCanvasId;const historyOwnerId=this.store.session.get()?.user.userId??"anonymous";const withIds=events.map((event)=>({...event,payload:{...event.payload,...(this.store.session.get()?.projectContext&&!event.payload.canvas_id&&selectedCanvas?{canvas_id:String(event.payload.source_canvas_id??selectedCanvas)}:{}),client_event_id:String(event.payload.client_event_id??uid()),history_action_id:String(event.payload.history_action_id??historyActionId),history_owner_id:String(event.payload.history_owner_id??historyOwnerId)}}));if(withIds.every(volatileCanvasEvent)&&!navigator.onLine)return[];try{const{staged}=await this.#queueLocally(withIds);if(navigator.onLine)void this.#flushQueue();return staged;}catch(error){if(error instanceof Error&&error.message==="canvas_source_retired"){this.store.toast(this.#pausedQueueMessage());return[];}const reason=error instanceof Error?error.message:"The device write-ahead queue is unavailable.";this.store.toast(this.i18n.system("This board change could not be secured on the device: {reason}",{reason}));return[];}}
  #syncStatus(){if(this.#queueStatusCurrent()&&(this.#sourcePausePending||this.#sourcePauseFailed||this.#offline.paused))return this.#pausedQueueMessage();if(this.#queueStatusCurrent()&&this.#canEditCanvas()&&this.#offline.unverified)return this.i18n.system("Device queue not yet checked");if(!navigator.onLine)return!this.#canEditCanvas()?this.i18n.t("canvas.readOnlyOffline","Offline · shared updates are paused"):this.#offline.count?`Offline · ${this.#offline.count} change${this.#offline.count===1?"":"s"} safe on this device`:"Offline";if(!this.#canEditCanvas())return this.i18n.t("canvas.readOnlyStatus","Viewing · updates arrive automatically");if(this.#syncing)return`Saving ${this.#offline.count} change${this.#offline.count===1?"":"s"}…`;if(this.#offline.count)return`${this.#offline.count} change${this.#offline.count===1?"":"s"} waiting to sync`;return this.i18n.t("canvas.allChangesSaved","All changes saved");}
  async #settleCanvasWrites(){if(this.#sourcePausePending||this.#sourcePauseFailed||this.#offline.paused){this.store.toast(this.#pausedQueueMessage());return false;}if(!navigator.onLine){this.store.toast("Reconnect before starting work that depends on the server’s current project state.");return false;}this.#syncRetryAt=0;await this.#flushQueue();if(this.#sourcePausePending||this.#sourcePauseFailed||this.#offline.paused){this.store.toast(this.#pausedQueueMessage());return false;}if(this.#offline.count){this.store.toast("Your edits are safe on this device, but dependent work will wait until they reach the server.");return false;}return true;}

  async #createCanvas(){if(!this.#canEditCanvas())return;const name=this.#canvasName.trim()||"Untitled board";const project=this.store.projection.get();const id=uid();const appended=await this.#commit([{type:"CanvasCreated",payload:{canvas_id:id,project_id:project.projectId,name,slug:canvasSlug(name),created_from:"canvas-home"}}]);if(appended.length){this.#newCanvasOpen=false;this.#canvasName="";this.#go(`/canvas/${encodeURIComponent(id)}/${canvasSlug(name)}`);}}
  #sources():Source[]{const p=this.store.projection.get();const canvas=this.store.canvasProjection.get();return[
    ...p.documents.map((item)=>({kind:"document" as const,id:item.id,title:item.title,body:`${p.libraryBlocks.filter((block)=>block.documentId===item.id).length} decisions · ${p.libraryOutputs.filter((output)=>output.documentId===item.id).length} images · ${p.libraryArtifacts.filter((artifact)=>artifact.documentId===item.id).length} stories, presentations, or motion results`,blockType:"document"})),
    ...p.libraryBlocks.map((item)=>({kind:(item.type==="reference"?"reference":item.type==="sketch"?"sketch":"block") as CanvasSourceKind,id:item.id,title:String(item.properties.label??item.handle),body:textForBlock(item),blockType:item.type})),
    ...p.libraryArtifacts.map((item)=>this.#artifactSource(item)),
    ...p.libraryOutputs.map((item)=>this.#outputSource(item)),
    ...canvas.contextSets.map((set)=>({kind:"context" as const,id:set.id,title:set.name,body:`${set.itemIds.length} connected items`,blockType:"context"})),
  ];}
  #insertionPoint(offset=0){const viewport=this.#viewportElement;if(!viewport)return{x:this.#cameraX+100+offset,y:this.#cameraY+100+offset};return{x:this.#cameraX+viewport.clientWidth*.5/this.#zoom+offset,y:this.#cameraY+viewport.clientHeight*.46/this.#zoom+offset};}
  #outputSource(item:CreativeOutput):Source{
    const project=this.store.projection.get(),document=project.documents.find((candidate)=>candidate.id===item.documentId),content=this.store.content.get();
    const candidate=imageOutputNamingCandidate(item,content,document?.title??"Project output");
    const peers=project.libraryOutputs.filter((output)=>output.documentId===item.documentId).map((output)=>imageOutputNamingCandidate(output,content,document?.title??"Project output"));
    const presentation=describeOutput(candidate,peers,{events:this.store.events.get(),locale:outcomeDeskLocale(this.i18n.locale),timeZone:this.i18n.timeZone,formatTake:(take)=>this.i18n.t("output.take","Take {number}",{number:this.i18n.number(take)})});
    return{kind:"output",id:item.id,title:presentation.disambiguator?`${presentation.disambiguator} — ${presentation.title}`:presentation.title,body:`${promptTechniqueDefinition(item.promptTechnique).shortLabel} prompt · ${document?.title??"Project output"}`,blockType:"output"};
  }
  #artifactSource(item:DocumentArtifact):Source{
    const presentation=describeOutput(item,this.store.projection.get().libraryArtifacts,{events:this.store.events.get(),locale:outcomeDeskLocale(this.i18n.locale),timeZone:this.i18n.timeZone,formatTake:(take)=>this.i18n.t("output.take","Take {number}",{number:this.i18n.number(take)})});
    return{kind:"artifact",id:item.id,title:presentation.disambiguator?`${presentation.disambiguator} — ${presentation.title}`:presentation.title,body:`${documentArtifactDefinition(item.kind).label} · ${item.summary}`,blockType:item.kind};
  }
  #itemTitle(item:CanvasItem){
    const project=this.store.projection.get();
    if(item.sourceKind==="output"){const output=project.libraryOutputs.find((candidate)=>candidate.id===item.sourceId);return output?this.#outputSource(output).title:item.title;}
    if(item.sourceKind==="artifact"){const artifact=project.libraryArtifacts.find((candidate)=>candidate.id===item.sourceId);return artifact?this.#artifactSource(artifact).title:item.title;}
    return item.title;
  }
  #toggleSource(sourceId:string){if(this.#selectedSourceIds.has(sourceId))this.#selectedSourceIds.delete(sourceId);else this.#selectedSourceIds.add(sourceId);this.requestUpdate();}
  #selectedContextSources(){const placed=new Set(this.store.canvasProjection.get().items.map((item)=>item.sourceId));return this.#sources().filter((source)=>!placed.has(source.id)&&(source.kind==="block"||source.kind==="sketch")&&this.#selectedSourceIds.has(source.id));}
  #toggleVisibleSources(sources:Source[]){const allSelected=sources.length>0&&sources.every((source)=>this.#selectedSourceIds.has(source.id));for(const source of sources)if(allSelected)this.#selectedSourceIds.delete(source.id);else this.#selectedSourceIds.add(source.id);this.requestUpdate();}
  async #placeSources(sources:Source[],placement:Record<string,unknown>={}){
    if(!sources.length||!this.#canEditCanvas())return false;
    const canvas=this.store.canvasProjection.get(),batchId=uid(),origin=this.#insertionPoint((canvas.items.length%6)*24),columns=Math.min(3,Math.ceil(Math.sqrt(sources.length))),base=this.store.head.get()+1;
    const placed=sources.map((source,index)=>{
      const itemId=uid(),isImage=source.kind==="output"||source.kind==="reference",isArtifact=source.kind==="artifact",w=isImage||isArtifact?360:source.kind==="document"?330:300,h=isImage?280:isArtifact?300:source.kind==="context"?180:210,col=index%columns,row=Math.floor(index/columns);
      return{source,itemId,event:{type:"CanvasItemPlaced",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:itemId,source_kind:source.kind,source_id:source.id,title:source.title,body:source.body,block_type:source.blockType,source_surface:sources.length>1?"canvas-context-picker-batch":"canvas-add-dialog",batch_id:batchId,batch_index:index,batch_size:sources.length,...placement,frame:{x:origin.x+(col-(columns-1)/2)*340,y:origin.y+row*250,w,h,rot:0,z:`z${String(base+index).padStart(12,"0")}`}}} as EventInput};
    });
    const appended=await this.#commit(placed.map((item)=>item.event)),acceptedItemIds=new Set(appended.map((event)=>String(event.payload.item_id??"")));
    if(acceptedItemIds.size)this.#selected=new Set(acceptedItemIds);
    if(appended.length===placed.length){
      this.#addOpen=false;this.#addKind="start";this.#sourceQuery="";this.#selectedSourceIds.clear();
      if(sources.length>1)this.store.toast(this.i18n.system("{count} context blocks added to the canvas.",{count:this.i18n.number(sources.length)}));
    }else for(const item of placed)if(acceptedItemIds.has(item.itemId))this.#selectedSourceIds.delete(item.source.id);
    this.requestUpdate();
    return appended.length===placed.length;
  }
  async #placeSource(source:Source,placement:Record<string,unknown>={}){return this.#placeSources([source],placement);}
  async #createNativeBlock(input?:{type:BlockKind;title:string;body:string}){const canvas=this.store.canvasProjection.get();const blockId=uid(),itemId=uid();const type=input?.type??this.#newBlockType;const definition=blockTypeDefinition(type);const title=input?.title.trim()||this.#newBlockTitle.trim()||`${definition?.label??"Context"} idea`;const body=input?.body.trim()||this.#newBlockBody.trim()||definition?.prompt||"Describe this idea";const point=this.#insertionPoint((canvas.items.length%5)*22);const appended=await this.#commit([{type:"BlockCreated",payload:{block_id:blockId,project_id:canvas.projectId,canvas_id:canvas.selectedCanvasId,scope:"canvas",type,handle:`${type}/${canvasSlug(title)}`,position:`c${String(this.store.head.get()+1).padStart(8,"0")}`,properties:{text:body,label:title,subtype:suggestedSubtype(type),authority:"authored",weight:.75,...(type==="audio"?{audio_role:"score",inform_generation:false,include_in_output:false,allow_provider_audio_transfer:false}:{})}}},{type:"CanvasItemPlaced",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:itemId,source_kind:type==="sketch"?"sketch":"block",source_id:blockId,title,body,block_type:type,frame:{x:point.x,y:point.y,w:type==="sketch"?480:300,h:type==="sketch"?320:210,rot:0,z:`z${String(this.store.head.get()+2).padStart(12,"0")}`}}}]);if(appended.length){this.#selected=new Set([itemId]);this.#newBlockTitle="";this.#newBlockBody="";this.#addOpen=false;this.#addKind="start";this.requestUpdate();}return appended.length?itemId:null;}
  async #startDrawing(){if(!this.#canEditCanvas())return;const selected=this.store.canvasProjection.get().items.find((item)=>this.#selected.has(item.id)&&item.sourceKind==="sketch");const itemId=selected?.id??await this.#createNativeBlock({type:"sketch",title:"Working sketch",body:"An authored gesture from the project board."});if(itemId){this.#selected=new Set([itemId]);this.#tool="draw";this.#addOpen=false;this.#trackCanvasInteraction("drawing_started",{created_new_sketch:!selected});this.store.toast("Draw directly on the new sketch. Its strokes are reusable project context.");this.requestUpdate();}}
  async #removeSelected(){if(!this.#canEditCanvas())return;const canvas=this.store.canvasProjection.get();await this.#commit([...this.#selected].map((itemId)=>({type:"CanvasItemRemoved",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:itemId,reason:"user-removed-from-canvas"}})));this.#organizeOpen=false;this.#selected.clear();this.requestUpdate();}
  #clearSelection(reason="explicit"){const previous=this.#selected.size;this.#organizeOpen=false;this.#selected.clear();this.#presenceHub?.update({selectedItemId:""});if(previous)this.#trackCanvasInteraction("selection_cleared",{previous_selection_count:previous,reason});this.requestUpdate();}
  #expandedSelection(items:CanvasItem[]){const canvas=this.store.canvasProjection.get();const byId=new Map(canvas.items.map((item)=>[item.id,item]));const expanded=new Map<string,CanvasItem>();const visit=(item:CanvasItem)=>{if(expanded.has(item.id))return;expanded.set(item.id,item);if(item.sourceKind==="context"){const set=canvas.contextSets.find((candidate)=>candidate.id===item.sourceId);for(const childId of set?.itemIds??[]){const child=byId.get(childId);if(child)visit(child);}}};for(const item of items)visit(item);return[...expanded.values()];}
  #combinedMembershipsForSelection(items:CanvasItem[]){
    const canvas=this.store.canvasProjection.get(),projection=this.store.projection.get(),byId=new Map(canvas.items.map((item)=>[item.id,item])),memberships=new Map<string,CombinedContextMembership[]>();
    const append=(sourceId:string,group:CombinedContextMembership)=>{const current=memberships.get(sourceId)??[];if(!current.some((item)=>item.contextSetId===group.contextSetId))memberships.set(sourceId,[...current,group]);};
    const visit=(item:CanvasItem,parents:CombinedContextMembership[]=[])=>{
      if(item.sourceKind==="context"){
        const set=canvas.contextSets.find((candidate)=>candidate.id===item.sourceId);if(!set)return;
        for(const[memberOrder,childId]of set.itemIds.entries()){const child=byId.get(childId);if(!child)continue;const group:CombinedContextMembership={contextSetId:set.id,name:set.name,role:set.role as CombinedContextRole,target:set.target,application:set.application as CombinedContextApplication,relativity:set.relativity,memberOrder,sourceCanvasId:set.canvasId};visit(child,[...parents,group]);}
        return;
      }
      const sourceIds=item.sourceKind==="document"?projection.libraryBlocks.filter((block)=>block.documentId===item.sourceId).map((block)=>block.id):[item.sourceId];for(const sourceId of sourceIds)for(const group of parents)append(sourceId,group);
    };
    for(const item of items)visit(item);return memberships;
  }
  #prepareDocument(items:CanvasItem[]){if(!this.#canEditCanvas())return;const first=items[0];this.#documentTitle=items.length===1?`${first.title} study`:`${items.length} idea study`;this.#documentOpen=true;this.#trackCanvasInteraction("document_prepare_opened",{source_count:items.length});this.requestUpdate();}
  async #createDocumentFromSelection(){
    if(!this.#canEditCanvas())return;
    const title=this.#documentTitle.trim();const canvas=this.store.canvasProjection.get();const projection=this.store.projection.get();const selected=canvas.items.filter((item)=>this.#selected.has(item.id));if(!title||!selected.length)return;
    const expanded=this.#expandedSelection(selected);const sourceBlockIds=new Set<string>();
    for(const item of expanded){
      if(["block","reference","sketch"].includes(item.sourceKind))sourceBlockIds.add(item.sourceId);
      if(item.sourceKind==="document")for(const block of projection.libraryBlocks)if(block.documentId===item.sourceId)sourceBlockIds.add(block.id);
    }
    for(const relation of projection.libraryBlockRelations)if(relation.kind==="artifact_contains"&&sourceBlockIds.has(relation.fromBlockId))sourceBlockIds.add(relation.toBlockId);
    const sourceBlocks=projection.libraryBlocks.filter((block)=>sourceBlockIds.has(block.id));
    const selectedOutputs=[...new Map(expanded.filter((item)=>item.sourceKind==="output").map((item)=>[item.sourceId,projection.libraryOutputs.find((output)=>output.id===item.sourceId)])).values()].filter((output):output is CreativeOutput=>Boolean(output));
    const selectedArtifacts=[...new Map(expanded.filter((item)=>item.sourceKind==="artifact").map((item)=>[item.sourceId,projection.libraryArtifacts.find((artifact)=>artifact.id===item.sourceId)])).values()].filter((artifact):artifact is DocumentArtifact=>Boolean(artifact));
    const documentId=uid(),itemId=uid();const copiedIds=new Map(sourceBlocks.map((block)=>[block.id,uid()]));const handle=canvasSlug(title)||"canvas-study";const point=this.#insertionPoint(48);const base=this.store.head.get()+1;const sourceCanvasItemIds=selected.map((item)=>item.id);
    const events:EventInput[]=[
      {type:"DocumentCreated",payload:{project_id:canvas.projectId,document_id:documentId,handle,title,canvas_id:canvas.selectedCanvasId,source_canvas_item_ids:sourceCanvasItemIds,created_from:"canvas-selection",source_output_count:selectedOutputs.length,source_artifact_count:selectedArtifacts.length}},
      {type:"EmptyCanvasChosen",payload:{project_id:canvas.projectId,document_id:documentId,canvas_id:canvas.selectedCanvasId,source_canvas_item_ids:sourceCanvasItemIds,source_surface:"canvas-document-preparation"}},
    ];
    for(const[blockIndex,block]of sourceBlocks.entries())events.push({type:"BlockCreated",payload:{block_id:copiedIds.get(block.id),project_id:canvas.projectId,document_id:documentId,source_canvas_id:canvas.selectedCanvasId,type:block.type,handle:`${block.handle}-canvas-${documentId.slice(0,8)}`,position:`c${String(base+events.length+blockIndex).padStart(8,"0")}`,properties:{...block.properties,authority:"authored",copied_from_block_id:block.id,source_canvas_item_ids:sourceCanvasItemIds,created_from:"canvas-selection"}}});
    const adoptedBlockIds:string[]=[];
    for(const output of selectedOutputs){
      const retained=output.contentRef?await this.store.ensurePrivateContent(output.contentRef):null;let direction:Record<string,unknown>|null=null;if(retained)try{const parsed=JSON.parse(retained) as unknown;if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))direction=parsed as Record<string,unknown>;}catch{/* The rights-backed generated image remains usable without optional planner prose. */}
      const materialized=imageOutputContextEvents(output,{documentId,projectId:canvas.projectId,sourceSurface:"canvas-selection-image-output",content:direction,positionStart:base+events.length,positionPrefix:"c",sourceCanvasId:canvas.selectedCanvasId,sourceCanvasItemIds});
      events.push(...materialized.events);adoptedBlockIds.push(...materialized.blockIds);
    }
    for(const artifact of selectedArtifacts){
      const retained=artifact.contentRef?await this.store.ensurePrivateContent(artifact.contentRef):null;const content=parseDocumentArtifactContent(retained??undefined);if(artifact.contentRef&&!content){this.store.toast(this.i18n.system("{title} cannot be copied because its complete original content is unavailable.",{title:artifact.title}));return;}
      const materialized=artifactContextEvents(artifact,{documentId,projectId:canvas.projectId,sourceSurface:`canvas-selection-${artifact.kind}`,content,positionStart:base+events.length,positionPrefix:"c",sourceCanvasId:canvas.selectedCanvasId,sourceCanvasItemIds});
      events.push(...materialized.events);adoptedBlockIds.push(...materialized.blockIds);
    }
    for(const relation of projection.libraryBlockRelations){const from=copiedIds.get(relation.fromBlockId),to=copiedIds.get(relation.toBlockId);if(from&&to)events.push({type:"BlockRelationAdded",payload:{relation_id:uid(),project_id:canvas.projectId,document_id:documentId,source_canvas_id:canvas.selectedCanvasId,from_block_id:from,to_block_id:to,kind:relation.kind,properties:{...relation.properties,copied_from_relation_id:relation.id,created_from:"canvas-selection"}}});}
    const preparedCount=sourceBlocks.length+adoptedBlockIds.length;
    events.push({type:"CanvasItemPlaced",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:itemId,source_kind:"document",source_id:documentId,title,body:`${preparedCount} prepared input${preparedCount===1?"":"s"} · Ready to render`,block_type:"document",frame:{x:point.x,y:point.y,w:380,h:300,rot:0,z:`z${String(base+events.length).padStart(12,"0")}`}}});
    const appended=await this.#commit(copyOutputRequirementCreationEvents(events,copiedIds));if(appended.length){this.#selected=new Set([itemId]);this.#documentOpen=false;this.#documentTitle="";this.store.toast(preparedCount===1?this.i18n.system("{title} is on the board with {count} reusable input. No rendering has started; choose an output only when it is ready.",{title,count:this.i18n.number(preparedCount)}):this.i18n.system("{title} is on the board with {count} reusable inputs. No rendering has started; choose an output only when it is ready.",{title,count:this.i18n.number(preparedCount)}));this.requestUpdate();}
  }
  #openEdit(){if(!this.#canEditCanvas())return;const item=this.store.canvasProjection.get().items.find((candidate)=>this.#selected.has(candidate.id));if(!item)return;this.#editValue=item.body;this.#editOpen=true;this.requestUpdate();}
  async #saveEdit(){if(!this.#canEditCanvas())return;const canvas=this.store.canvasProjection.get();const item=canvas.items.find((candidate)=>this.#selected.has(candidate.id));if(!item)return;const source=this.store.projection.get().libraryBlocks.find((block)=>block.id===item.sourceId);const value=source?.properties.source_artifact_id||source?.properties.source_output_id?this.#editValue:this.#editValue.trim();const site=this.#site();const shared=["block","reference","sketch"].includes(item.sourceKind);const blockEvents=shared?this.store.outputBlockTextEvents(item.sourceId,value,"canvas-hud"):[];if(shared&&value!==item.body&&!blockEvents.length){this.store.toast("Unlock the related storyboard input before editing this frame.");return;}const events:EventInput[]=[{type:"CanvasTextApplied",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:item.id,operation:{object:{kind:shared?"block":"canvas_item",item_id:item.id,...(shared?{block_id:item.sourceId}:{})},field:"value",ops:canvasTextReplacementOperations(this.store.eventView.get(),item.id,value,site)}}},...blockEvents.map((event)=>({...event,payload:{...event.payload,project_id:canvas.projectId,canvas_id:canvas.selectedCanvasId}}))];const appended=await this.#commit(events);if(appended.length){this.#editOpen=false;this.store.toast("Shared context and future generation direction were updated together.");}}
  async #reuseArtifact(artifact:DocumentArtifact){const source=this.store.captureSourceOwnership(),route=this.store.route.get();if(!source||!this.#canEditCanvas())return;const projection=this.store.projection.get(),destination=projection.documents.some((document)=>document.id===projection.documentId)?projection.documentId:artifact.documentId,presentation=artifact.kind==="slides"?this.querySelector<HTMLElementTagNameMap["forma-presentation-deck"]>(".canvas-artifact-viewer forma-presentation-deck")?.activePresentation:null;const result=await this.store.addArtifactAsContext(artifact.id,destination,"canvas-artifact-viewer",{reveal:false,presentation});if(result&&!("publication" in result)&&result.rootBlockId&&this.isConnected&&this.store.sourceOwnershipActive(source)&&route===this.store.route.get()&&this.#viewingArtifactId===artifact.id){this.#closeCanvasArtifact();await this.store.revealOutputInput(result.rootBlockId,destination);}}
  async #reuseOutput(output:CreativeOutput){const source=this.store.captureSourceOwnership(),route=this.store.route.get();if(!source||!this.#canEditCanvas())return;const projection=this.store.projection.get(),destination=projection.documents.some((document)=>document.id===projection.documentId)?projection.documentId:output.documentId;const result=await this.store.addImageOutputAsContext(output.id,destination,"canvas-output-viewer",{reveal:false});if(result&&!("publication" in result)&&result.rootBlockId&&this.isConnected&&this.store.sourceOwnershipActive(source)&&route===this.store.route.get()&&this.#viewingOutputId===output.id){this.#closeCanvasOutput();await this.store.revealOutputInput(result.rootBlockId,destination);}}
  #select(itemId:string,event?:Pick<MouseEvent,"shiftKey">){const additive=Boolean(event?.shiftKey||this.#tool==="marquee");if(additive){if(this.#selected.has(itemId))this.#selected.delete(itemId);else this.#selected.add(itemId);}else this.#selected=new Set([itemId]);this.#organizeOpen=false;this.#presenceHub?.update({selectedItemId:itemId});const item=this.store.canvasProjection.get().items.find((candidate)=>candidate.id===itemId);this.#trackCanvasInteraction("item_selected",{source_kind:item?.sourceKind??"unknown",additive,selected:item?this.#selected.has(itemId):true});this.requestUpdate();}
  #fromCardControl(event:Event){return event.composedPath().some((target)=>target instanceof Element&&target!==event.currentTarget&&target.matches("button,a,input,textarea,select,summary,dialog,[contenteditable=true],[role=button],[role=link]"));}
  #drag(event:PointerEvent,item:CanvasItem){
    const site=this.#site();if(!this.#canEditCanvas()||this.#fromCardControl(event)||!["select","marquee"].includes(this.#tool))return;
    const canvas=this.store.canvasProjection.get();
    const movingItems=this.#selected.has(item.id)&&this.#selected.size>1?canvas.items.filter((candidate)=>this.#selected.has(candidate.id)):[item];
    if(movingItems.some((candidate)=>candidate.lockedBy&&candidate.lockedBy!==site)){this.store.toast("One of the selected ideas is being edited elsewhere. The group was left in place so its arrangement stays intact.");return;}
    const target=event.currentTarget as HTMLElement;const fromStickyHeader=event.composedPath().some((node)=>node instanceof Element&&node.matches(".canvas-item>header"));if(target.scrollHeight>target.clientHeight+1&&!fromStickyHeader)return;
    event.preventDefault();event.stopPropagation();target.setPointerCapture(event.pointerId);
    const itemIds=movingItems.map((candidate)=>candidate.id),itemIdSet=new Set(itemIds),groupMoveId=uid(),startX=event.clientX,startY=event.clientY;let dx=0,dy=0,dragging=false;
    const paint=(screenX:number,screenY:number)=>this.querySelectorAll<HTMLElement>(".canvas-item[data-canvas-item-id]").forEach((card)=>{if(itemIdSet.has(card.dataset.canvasItemId??""))card.style.translate=`${screenX}px ${screenY}px`;});
    const releaseEvents=(reason:string):EventInput[]=>movingItems.map((candidate)=>({type:"CanvasLockReleased",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:candidate.id,holder_id:site,reason,group_move_id:groupMoveId,selected_item_ids:itemIds}}));
    const move=(next:PointerEvent)=>{
      if(next.pointerId!==event.pointerId||this.#suppressedPointers.has(next.pointerId))return;
      const screenX=next.clientX-startX,screenY=next.clientY-startY;if(!dragging&&Math.hypot(screenX,screenY)<DRAG_THRESHOLD_PX)return;
      if(!dragging){dragging=true;this.#dragClickGuard=item.id;void this.#commit(movingItems.map((candidate)=>({type:"CanvasLockAcquired",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:candidate.id,holder_id:site,lease_ms:15_000,reason:itemIds.length>1?"group-direct-manipulation":"direct-manipulation",group_move_id:groupMoveId,selected_item_ids:itemIds}})));}
      dx=screenX/this.#zoom;dy=screenY/this.#zoom;this.#dragPreview={positions:translateCanvasItems(movingItems,dx,dy),itemIds};paint(screenX,screenY);this.#presenceHub?.update({x:item.x+dx,y:item.y+dy});
    };
    const finish=async(next:PointerEvent)=>{
      if(next.pointerId!==event.pointerId)return;
      target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",finish);target.removeEventListener("pointercancel",finish);if(!dragging)return;
      if(next.type==="pointercancel"||this.#suppressedPointers.has(next.pointerId)){this.#dragClickGuard="";this.#dragPreview=undefined;paint(0,0);this.requestUpdate();void this.#commit(releaseEvents("direct-manipulation-canceled"));return;}
      window.setTimeout(()=>{if(this.#dragClickGuard===item.id)this.#dragClickGuard="";},750);
      const positions=translateCanvasItems(movingItems,dx,dy),movement={x:dx,y:dy};const changes:EventInput[]=[];
      for(const candidate of movingItems){const position=positions.get(candidate.id)!;for(const prop of ["x","y"] as const)changes.push({type:"CanvasRegisterSet",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:candidate.id,previous_value:candidate[prop],source_surface:itemIds.length>1?"canvas-group-drag":"canvas-direct-manipulation",group_move_id:groupMoveId,selected_item_ids:itemIds,movement_delta:movement,preserves_relative_arrangement:true,operation:{object:{kind:"canvas_item",item_id:candidate.id},prop,value:position[prop],hlc:hlc(site)}}});}
      changes.push(...releaseEvents("direct-manipulation-complete"));await this.#commit(changes);await this.updateComplete;this.#dragPreview=undefined;paint(0,0);this.requestUpdate();
    };
    target.addEventListener("pointermove",move);target.addEventListener("pointerup",finish,{once:true});target.addEventListener("pointercancel",finish,{once:true});
  }
  #toggleBatchSelection(){this.#tool=this.#tool==="marquee"?"select":"marquee";this.#selectionMarquee=undefined;this.#organizeOpen=false;this.#trackCanvasInteraction("batch_selection_toggled",{enabled:this.#tool==="marquee"});this.requestUpdate();}
  #marqueeSelect(event:PointerEvent){
    const target=event.currentTarget as HTMLElement;const bounds=target.getBoundingClientRect();const startX=event.clientX-bounds.left,startY=event.clientY-bounds.top;const additive=event.shiftKey;let moved=false;
    event.preventDefault();target.setPointerCapture(event.pointerId);this.#selectionMarquee={x:startX,y:startY,width:0,height:0};this.requestUpdate();
    const move=(next:PointerEvent)=>{if(next.pointerId!==event.pointerId||this.#suppressedPointers.has(next.pointerId))return;const currentX=next.clientX-bounds.left,currentY=next.clientY-bounds.top;const width=Math.abs(currentX-startX),height=Math.abs(currentY-startY);moved=moved||Math.hypot(currentX-startX,currentY-startY)>=DRAG_THRESHOLD_PX;this.#selectionMarquee={x:Math.min(startX,currentX),y:Math.min(startY,currentY),width,height};this.requestUpdate();};
    const finish=(next:PointerEvent)=>{if(next.pointerId!==event.pointerId)return;target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",finish);target.removeEventListener("pointercancel",finish);const marquee=this.#selectionMarquee;this.#selectionMarquee=undefined;if(next.type==="pointercancel"||this.#suppressedPointers.has(next.pointerId)){this.requestUpdate();return;}if(!moved||!marquee){if(!additive)this.#clearSelection("empty-marquee");else this.requestUpdate();return;}const worldRect={x:this.#cameraX+marquee.x/this.#zoom,y:this.#cameraY+marquee.y/this.#zoom,width:marquee.width/this.#zoom,height:marquee.height/this.#zoom};const visibleItems=this.#orderedItems(this.store.canvasProjection.get().items);const matches=canvasItemsInVirtualViewport(visibleItems,worldRect).map((item)=>item.id);this.#selected=additive?new Set([...this.#selected,...matches]):new Set(matches);this.#organizeOpen=false;this.#presenceHub?.update({selectedItemId:this.#selected.size===1?[...this.#selected][0]:""});this.#trackCanvasInteraction("batch_selection_completed",{matched_count:matches.length,additive});this.requestUpdate();};
    target.addEventListener("pointermove",move);target.addEventListener("pointerup",finish,{once:true});target.addEventListener("pointercancel",finish,{once:true});
  }
  #pan(event:PointerEvent){if(this.#tool==="marquee"){if(event.target===event.currentTarget)this.#marqueeSelect(event);return;}if(event.target!==event.currentTarget||this.#tool!=="select")return;const target=event.currentTarget as HTMLElement;target.setPointerCapture(event.pointerId);const startX=event.clientX,startY=event.clientY,startCameraX=this.#cameraX,startCameraY=this.#cameraY;let moved=false;const move=(next:PointerEvent)=>{if(next.pointerId!==event.pointerId||this.#suppressedPointers.has(next.pointerId))return;const dx=next.clientX-startX,dy=next.clientY-startY;moved=moved||Math.abs(dx)+Math.abs(dy)>3;this.#cameraX=startCameraX-dx/this.#zoom;this.#cameraY=startCameraY-dy/this.#zoom;this.requestUpdate();};const up=(next:PointerEvent)=>{if(next.pointerId!==event.pointerId)return;target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",up);target.removeEventListener("pointercancel",up);if(this.#suppressedPointers.has(next.pointerId)||next.type==="pointercancel")return;if(moved){this.#scheduleViewportPersistence();this.#trackCanvasInteraction("board_panned",{input_method:"pointer"});}else this.#clearSelection("canvas-background");};target.addEventListener("pointermove",move);target.addEventListener("pointerup",up,{once:true});target.addEventListener("pointercancel",up,{once:true});}
  #nudge(dx:number,dy:number){if(!this.#canEditCanvas())return;const canvas=this.store.canvasProjection.get(),site=this.#site();const events:EventInput[]=[];for(const item of canvas.items.filter((candidate)=>this.#selected.has(candidate.id)))for(const[prop,value,previous]of [["x",item.x+dx,item.x],["y",item.y+dy,item.y]] as const)events.push({type:"CanvasRegisterSet",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:item.id,previous_value:previous,source_surface:"canvas-keyboard-nudge",input_method:"keyboard",operation:{object:{kind:"canvas_item",item_id:item.id},prop,value,hlc:hlc(site)}}});if(events.length)void this.#commit(events);}
  #scaledImageFrame(item:CanvasItem,scale:number,corner:ResizeCorner){
    const minimum=Math.max(IMAGE_MIN_FRAME.w/item.w,IMAGE_MIN_FRAME.h/item.h),maximum=Math.min(IMAGE_MAX_FRAME.w/item.w,IMAGE_MAX_FRAME.h/item.h);const bounded=Math.max(minimum,Math.min(maximum,scale));const w=Math.round(item.w*bounded*100)/100,h=Math.round(item.h*bounded*100)/100;return{x:corner.includes("w")?Math.round((item.x+item.w-w)*100)/100:item.x,y:corner.includes("n")?Math.round((item.y+item.h-h)*100)/100:item.y,w,h};
  }
  #imageFrameFromPointer(item:CanvasItem,corner:ResizeCorner,dx:number,dy:number){const sx=corner.includes("e")?1:-1,sy=corner.includes("s")?1:-1;const scale=1+(sx*dx*item.w+sy*dy*item.h)/(item.w*item.w+item.h*item.h);return this.#scaledImageFrame(item,scale,corner);}
  #freeformItemFrame(item:CanvasItem,corner:ResizeCorner,dx:number,dy:number){const widthDelta=corner.includes("e")?dx:-dx,heightDelta=corner.includes("s")?dy:-dy;const w=Math.max(ITEM_MIN_FRAME.w,Math.min(ITEM_MAX_FRAME.w,item.w+widthDelta)),h=Math.max(ITEM_MIN_FRAME.h,Math.min(ITEM_MAX_FRAME.h,item.h+heightDelta));return{x:corner.includes("w")?Math.round((item.x+item.w-w)*100)/100:item.x,y:corner.includes("n")?Math.round((item.y+item.h-h)*100)/100:item.y,w:Math.round(w*100)/100,h:Math.round(h*100)/100};}
  #itemFrameFromPointer(item:CanvasItem,corner:ResizeCorner,dx:number,dy:number){return mediaKind(item)?this.#imageFrameFromPointer(item,corner,dx,dy):this.#freeformItemFrame(item,corner,dx,dy);}
  #resizeEvents(item:CanvasItem,next:{x:number;y:number;w:number;h:number},corner:ResizeCorner,inputMethod:"pointer"|"keyboard",site:string){
    const canvas=this.store.canvasProjection.get(),previousFrame={x:item.x,y:item.y,w:item.w,h:item.h,area:item.w*item.h},nextFrame={...next,area:next.w*next.h},receipt={presentation_receipt_id:uid(),presentation_action_id:uid(),presentation_signal_version:1,presentation_intent:"organization",semantic_status:"candidate-signal",does_not_change_generation_context:true,future_interpretations:["influence","attention","comparison-priority"],explicit_user_action:true,source_surface:"canvas-resize-handles",resize_action:"direct-manipulation",resize_mode:mediaKind(item)?"aspect-locked":"freeform",resize_corner:corner,input_method:inputMethod,source_kind:item.sourceKind,source_id:item.sourceId,block_type:item.blockType,selected_item_ids:[item.id],previous_frame:previousFrame,next_frame:nextFrame,relative_area_change:nextFrame.area/previousFrame.area};
    return(["x","y","w","h"] as const).filter((prop)=>next[prop]!==item[prop]).map((prop)=>({type:"CanvasRegisterSet",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:item.id,previous_value:item[prop],...receipt,operation:{object:{kind:"canvas_item",item_id:item.id},prop,value:next[prop],hlc:hlc(site)}}} satisfies EventInput));
  }
  #resizeItem(event:PointerEvent,item:CanvasItem,corner:ResizeCorner){
    if(!this.#canEditCanvas()||this.#tool!=="select")return;event.preventDefault();event.stopPropagation();const target=event.currentTarget as HTMLElement,site=this.#site(),canvas=this.store.canvasProjection.get();target.setPointerCapture(event.pointerId);const startX=event.clientX,startY=event.clientY;let resizing=false;
    const move=(next:PointerEvent)=>{if(next.pointerId!==event.pointerId||this.#suppressedPointers.has(next.pointerId))return;const dx=(next.clientX-startX)/this.#zoom,dy=(next.clientY-startY)/this.#zoom;if(!resizing&&Math.hypot(dx,dy)<DRAG_THRESHOLD_PX/this.#zoom)return;if(!resizing){resizing=true;void this.#commit([{type:"CanvasLockAcquired",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:item.id,holder_id:site,lease_ms:15_000,reason:"item-resize"}}]);}this.#resizePreview={itemId:item.id,...this.#itemFrameFromPointer(item,corner,dx,dy)};this.requestUpdate();};
    const finish=async(next:PointerEvent)=>{if(next.pointerId!==event.pointerId)return;target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",finish);target.removeEventListener("pointercancel",finish);if(!resizing)return;const preview=this.#resizePreview?.itemId===item.id?this.#resizePreview:null;if(next.type==="pointercancel"||this.#suppressedPointers.has(next.pointerId)||!preview){this.#resizePreview=undefined;this.requestUpdate();void this.#commit([{type:"CanvasLockReleased",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:item.id,holder_id:site,reason:"item-resize-canceled"}}]);return;}const changes=this.#resizeEvents(item,preview,corner,"pointer",site);await this.#commit([...changes,{type:"CanvasLockReleased",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:item.id,holder_id:site,reason:"item-resize-complete"}}]);await this.updateComplete;this.#resizePreview=undefined;this.requestUpdate();};
    target.addEventListener("pointermove",move);target.addEventListener("pointerup",finish,{once:true});target.addEventListener("pointercancel",finish,{once:true});
  }
  #resizeItemWithKeyboard(event:KeyboardEvent,item:CanvasItem,corner:ResizeCorner){
    if(!this.#canEditCanvas()||event.defaultPrevented||event.isComposing||event.metaKey||event.ctrlKey||event.altKey||!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key))return;event.preventDefault();event.stopPropagation();const step=event.shiftKey?24:8;const dx=event.key==="ArrowLeft"?-step:event.key==="ArrowRight"?step:0,dy=event.key==="ArrowUp"?-step:event.key==="ArrowDown"?step:0;const next=this.#itemFrameFromPointer(item,corner,dx,dy);const changes=this.#resizeEvents(item,next,corner,"keyboard",this.#site());if(changes.length)void this.#commit(changes);
  }
  async #reapplyArrangement(arrangement:CanvasArrangement){if(!this.#canEditCanvas())return;
    const protectedGroup=this.store.events.get().find((event)=>event.type==="CanvasArrangementCreated"&&event.payload.arrangement_id===arrangement.id&&isProtectedOutcomeArrangementEvent(event));
    if(protectedGroup){const recipe=outcomeRecipe(protectedGroup.payload.recipe_id);if(!recipe)return;if(!this.#arrangementName)this.#arrangementName=arrangement.name;this.#go(withOutcomeRecipe(this.store.route.get(),recipe.id));this.#organizeOpen=false;this.#openArrangement();return;}
const canvas=this.store.canvasProjection.get(),site=this.#site(),actionId=uid();const frames=new Map(arrangement.frames.map((frame)=>[frame.itemId,frame]));const items=canvas.items.filter((item)=>arrangement.itemIds.includes(item.id));const events:EventInput[]=[];for(const item of items){const frame=frames.get(item.id);if(!frame)continue;for(const prop of ["x","y","w","h"] as const)if(item[prop]!==frame[prop])events.push({type:"CanvasRegisterSet",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:item.id,previous_value:item[prop],organization:"arrangement-reapply",arrangement_id:arrangement.id,organization_action_id:actionId,selected_item_ids:arrangement.itemIds,source_surface:"canvas-organize-menu",operation:{object:{kind:"canvas_item",item_id:item.id},prop,value:frame[prop],hlc:hlc(site)}}});}this.#organizeOpen=false;if(!events.length){this.store.toast(this.i18n.system("{name} is already applied.",{name:arrangement.name}));this.requestUpdate();return;}const appended=await this.#commit(events);if(appended.length)this.store.toast(this.i18n.system("{name} reapplied to {count} cards.",{name:arrangement.name,count:this.i18n.number(items.length)}));this.requestUpdate();}
  async #organizeSelection(organization:CanvasOrganization){if(!this.#canEditCanvas())return;const canvas=this.store.canvasProjection.get();const items=canvas.items.filter((item)=>this.#selected.has(item.id));if(items.length<2)return;const positions=organizeCanvasItems(items,organization);const site=this.#site(),arrangementId=uid(),selectedItemIds=items.map((item)=>item.id);const names:Record<CanvasOrganization,string>={grid:"Compact grid",row:"Horizontal row",column:"Vertical column",type:"Content-type groups"};const previousFrames=items.map((item)=>({item_id:item.id,x:item.x,y:item.y,w:item.w,h:item.h}));const arrangementFrames=items.map((item)=>{const position=positions.get(item.id)??item;return{item_id:item.id,x:position.x,y:position.y,w:item.w,h:item.h};});const events:EventInput[]=[{type:"CanvasArrangementCreated",payload:{arrangement_id:arrangementId,canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,name:`${names[organization]} · ${items.length} cards`,kind:organization,item_ids:selectedItemIds,frames:arrangementFrames,previous_frames:previousFrames,source_surface:"canvas-organize-menu",organization_action_id:arrangementId,explicit_user_action:true,does_not_change_generation_context:true}}];for(const item of items){const position=positions.get(item.id);if(!position)continue;for(const[prop,value,previous]of [["x",position.x,item.x],["y",position.y,item.y]] as const)if(value!==previous)events.push({type:"CanvasRegisterSet",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:item.id,previous_value:previous,organization,arrangement_id:arrangementId,organization_action_id:arrangementId,selected_item_ids:selectedItemIds,source_surface:"canvas-organize-menu",operation:{object:{kind:"canvas_item",item_id:item.id},prop,value,hlc:hlc(site)}}});}this.#organizeOpen=false;const appended=await this.#commit(events);if(appended.length)this.store.toast(this.i18n.system("{name} arrangement saved for {count} cards.",{name:this.i18n.system(names[organization]),count:this.i18n.number(items.length)}));this.requestUpdate();}
  async #matchSelectionSize(sizeModifier:CanvasSizeModifier){if(!this.#canEditCanvas())return;const canvas=this.store.canvasProjection.get();const items=canvas.items.filter((item)=>this.#selected.has(item.id));if(items.length<2)return;const target=canvasMatchSizeTarget(items,sizeModifier),frames=matchCanvasItemSizes(items,sizeModifier),site=this.#site(),arrangementId=uid();const selectedItemIds=items.map((item)=>item.id),modifierLabel=sizeModifier[0].toUpperCase()+sizeModifier.slice(1);const previousFrames=items.map((item)=>({item_id:item.id,x:item.x,y:item.y,w:item.w,h:item.h}));const arrangementFrames=items.flatMap((item)=>{const frame=frames.get(item.id);return frame?[{item_id:item.id,...frame}]:[];});const events:EventInput[]=[{type:"CanvasArrangementCreated",payload:{arrangement_id:arrangementId,canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,name:`${modifierLabel} size · ${items.length} cards`,kind:"match-size",size_modifier:sizeModifier,target_width:target.width,target_height:target.height,item_ids:selectedItemIds,frames:arrangementFrames,previous_frames:previousFrames,source_surface:"canvas-organize-menu",organization_action_id:arrangementId,explicit_user_action:true,does_not_change_generation_context:true}}];for(const item of items){const next=frames.get(item.id);if(!next)continue;const image=mediaKind(item),previousFrame={x:item.x,y:item.y,w:item.w,h:item.h,area:item.w*item.h},nextFrame={...next,area:next.w*next.h},receiptId=uid();for(const prop of ["x","y","w","h"] as const)if(next[prop]!==item[prop])events.push({type:"CanvasRegisterSet",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:item.id,previous_value:item[prop],organization:"match-size",arrangement_id:arrangementId,organization_action_id:arrangementId,presentation_action_id:arrangementId,presentation_receipt_id:receiptId,presentation_intent:"organization",does_not_change_generation_context:true,explicit_user_action:true,size_modifier:sizeModifier,target_width:target.width,target_height:target.height,target_area:target.width*target.height,resize_mode:"uniform-card-size-match",card_frame_normalized:true,aspect_ratio_preserved:Math.abs(item.w/item.h-next.w/next.h)<.001,intrinsic_media_aspect_ratio_preserved:image,media_fit:image?"cover":null,source_aspect_ratio:item.w/item.h,applied_aspect_ratio:next.w/next.h,normalization_delta:{width:next.w-target.width,height:next.h-target.height},source_kind:item.sourceKind,source_id:item.sourceId,block_type:item.blockType,selected_item_ids:selectedItemIds,previous_frame:previousFrame,next_frame:nextFrame,relative_area_change:nextFrame.area/previousFrame.area,source_surface:"canvas-organize-menu",operation:{object:{kind:"canvas_item",item_id:item.id},prop,value:next[prop],hlc:hlc(site)}}});}this.#organizeOpen=false;const appended=await this.#commit(events);if(appended.length)this.store.toast(this.i18n.system("{modifier} size arrangement saved. All {count} cards now measure {width} × {height}; images crop without stretching.",{modifier:this.i18n.system(modifierLabel),count:this.i18n.number(items.length),width:this.i18n.number(Math.round(target.width)),height:this.i18n.number(Math.round(target.height))}));this.requestUpdate();}
  async #formalize(options:{place?:boolean;name?:string;target?:string;composite?:boolean}={}){if(!this.#canEditCanvas())return null;const canvas=this.store.canvasProjection.get();if(!this.#selected.size)return null;const id=uid(),itemId=uid();const name=options.name?.trim()||this.#contextName.trim()||"Working context",target=options.target?.trim()||this.#contextTarget.trim()||name,composite=options.composite!==false;const selected=canvas.items.filter((item)=>this.#selected.has(item.id));const blockIds=selected.filter((item)=>["block","reference","sketch"].includes(item.sourceKind)).map((item)=>item.sourceId);const documentIds=selected.filter((item)=>item.sourceKind==="document").map((item)=>item.sourceId);const outputIds=selected.filter((item)=>item.sourceKind==="output").map((item)=>item.sourceId);const events:EventInput[]=[{type:"ContextSetFormalized",payload:{context_set_id:id,canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,name,target,role:this.#contextRole,application:this.#contextApplication,relativity:this.#contextRelativity,item_ids:[...this.#selected],as_of_sequence:this.store.head.get(),explicit_user_action:true,arrangement_is_context:false,contains_generations:outputIds.length>0,composite,semantic_isolation:composite}}];if(options.place){const point=this.#insertionPoint(36);events.push({type:"CanvasItemPlaced",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:itemId,source_kind:"context",source_id:id,title:name,body:`${selected.length} connected ideas · ${COMBINED_CONTEXT_ROLE_DEFINITIONS.find((item)=>item.id===this.#contextRole)?.label??"Custom target"}: ${target} · ${Math.round(this.#contextRelativity*100)}% relative`,block_type:"context",frame:{x:point.x,y:point.y,w:320,h:180,rot:0,z:`z${String(this.store.head.get()+2).padStart(12,"0")}`}}});}const appended=await this.#commit(events);if(!appended.length)return null;const context:CanvasContextSet={id,canvasId:canvas.selectedCanvasId,projectId:canvas.projectId,name,itemIds:[...this.#selected],blockIds,documentIds,outputIds,role:this.#contextRole,target,application:this.#contextApplication,relativity:this.#contextRelativity,asOfSequence:this.store.head.get(),sourceEventId:appended[0].eventId};this.#formalizeOpen=false;if(options.place){this.#selected=new Set([itemId]);this.store.toast("Combined context added with a durable isolation boundary. Its sources remain independently reusable.");}this.requestUpdate();return context;}
  async #documentContext(item:CanvasItem){const canvas=this.store.canvasProjection.get();const selected=this.#selected.has(item.id)?new Set(this.#selected):new Set([item.id]);const documents=canvas.items.filter((candidate)=>selected.has(candidate.id)&&candidate.sourceKind==="document");if(documents.length!==1){this.store.toast("Select one target document before rendering your chosen inputs.");return null;}const existing=canvas.contextSets.find((set)=>set.itemIds.length===selected.size&&set.itemIds.every((id)=>selected.has(id)));if(existing)return existing;this.#selected=selected;return this.#formalize({place:false,name:selected.size>1?`${item.title} and ${selected.size-1} selected input${selected.size===2?"":"s"}`:`${item.title} render context`,target:item.title,composite:false});}
  #renderPreparationPending(){return Boolean(this.#pendingRenderPreparations&&this.#pendingRenderPreparations.count>0&&this.#pendingRenderPreparations.current());}
  #beginRenderPreparation(){
    let pending=this.#pendingRenderPreparations;
    if(!pending||!pending.current()){
      const store=this.store,source=store.captureSourceOwnership(),scope=this.#currentControlsScope();
      pending={count:0,current:()=>this.isConnected&&this.store===store&&store.sourceOwnershipActive(source)
        &&Boolean(scope)&&scope===this.#currentControlsScope()};
      this.#pendingRenderPreparations=pending;
    }
    const operation=pending;operation.count+=1;this.requestUpdate();
    return ()=>{
      operation.count-=1;
      if(operation.count===0&&this.#pendingRenderPreparations===operation)this.#pendingRenderPreparations=null;
      if(this.isConnected)this.requestUpdate();
    };
  }
  async #renderDocument(kind:CanvasRenderKind){if(!this.#canEditCanvas())return;const item=this.store.canvasProjection.get().items.find((candidate)=>candidate.id===this.#renderDocumentItemId&&candidate.sourceKind==="document");if(!item)return;const finish=this.#beginRenderPreparation();try{const context=await this.#documentContext(item);if(!context||!await this.#settleCanvasWrites())return;const outputs=this.store.projection.get().libraryOutputs.filter((output)=>output.documentId===item.sourceId);const sourcePreviewId=(kind==="generate"||kind==="generate_fan")?outputs.find((output)=>output.purpose==="ideate")?.id:undefined;const started=await this.store.generateCanvasContext(kind,context,sourcePreviewId,item.sourceId);if(started){this.#renderOpen=false;this.#openDocumentOutputs(item);}}finally{finish();}}
  async #renderArtifact(kind:DocumentArtifactKind){if(!this.#canEditCanvas())return;const canvas=this.store.canvasProjection.get(),item=canvas.items.find((candidate)=>candidate.id===this.#renderDocumentItemId&&candidate.sourceKind==="document");if(!item)return;const finish=this.#beginRenderPreparation();try{if(!await this.#settleCanvasWrites())return;const selected=this.#selected.has(item.id)?this.#expandedSelection(canvas.items.filter((candidate)=>this.#selected.has(candidate.id))):[item];if(!await this.store.adoptCanvasOutputItems(selected,item.sourceId,"canvas-artifact-render"))return;this.#renderOpen=false;this.requestUpdate();await this.updateComplete;await this.querySelector("forma-document-artifacts")?.openRender(kind,item.sourceId);}finally{finish();}}
  #openRender(item:CanvasItem,opener?:HTMLElement){if(!this.#canEditCanvas())return;this.#renderReturnFocus=opener;this.#renderDocumentItemId=item.id;this.#renderOpen=true;this.#trackCanvasInteraction("render_opened",{document_id:item.sourceId});this.requestUpdate();}
  #openRenderDocument(event:MouseEvent,item:CanvasItem){
    const trigger=event.currentTarget as HTMLElement|null;
    const element=trigger?.closest<HTMLDialogElement>(".canvas-render-dialog");
    if(!trigger||!element||element.closest("forma-canvas-surface")!==this)return Promise.resolve(false);
    const scope=this.#currentControlsScope(),opener=this.#renderReturnFocus;
    return navigateInApp(this,navigation=>{
      if(!navigation.closePresentation(()=>{
        this.#renderOpen=false;this.#renderReturnFocus=undefined;element.close();this.requestUpdate();
      }))return false;
      return navigation.route(`/document/${encodeURIComponent(item.sourceId)}/${canvasSlug(item.title)}`);
    },{presentation:{owner:this,element,trigger,
      current:()=>this.#renderOpen&&this.#renderDocumentItemId===item.id&&!this.#renderPreparationPending()
        &&Boolean(scope)&&scope===this.#currentControlsScope()
        &&this.querySelector(".canvas-render-dialog")===element
        &&this.store.canvasProjection.get().items.some(candidate=>candidate.id===item.id&&candidate.sourceKind==="document"&&candidate.sourceId===item.sourceId),
      ...(opener?.isConnected&&this.contains(opener)?{opener}:{})}});
  }
  #startStroke(event:PointerEvent,item:CanvasItem){if(!this.#canEditCanvas()||this.#tool!=="draw"||item.sourceKind!=="sketch")return;event.preventDefault();event.stopPropagation();const svg=event.currentTarget as SVGSVGElement;svg.setPointerCapture(event.pointerId);const rect=svg.getBoundingClientRect();this.#drawPoints=[];const pressure:number[]=[];const add=(next:PointerEvent)=>{if(this.#drawPoints.length>=4000)return;this.#drawPoints.push(Math.round((next.clientX-rect.left)/rect.width*item.w),Math.round((next.clientY-rect.top)/rect.height*item.h));pressure.push(next.pointerType==="pen"?Math.max(0,Math.min(1,next.pressure||.5)):.5);};add(event);const move=(next:PointerEvent)=>{if(next.pointerId!==event.pointerId||this.#suppressedPointers.has(next.pointerId))return;add(next);const preview=svg.querySelector<SVGPolylineElement>(".canvas-stroke-preview");if(preview)preview.setAttribute("points",this.#pairs(this.#drawPoints));};const finish=async(next:PointerEvent)=>{if(next.pointerId!==event.pointerId)return;svg.removeEventListener("pointermove",move);svg.removeEventListener("pointerup",finish);svg.removeEventListener("pointercancel",finish);if(next.type==="pointercancel"||this.#suppressedPointers.has(next.pointerId)||this.#drawPoints.length<4){this.#drawPoints=[];return;}const canvas=this.store.canvasProjection.get();const site=this.#site();await this.#commit([{type:"StrokeAdded",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,item_id:item.id,operation:{sketch:{item_id:item.id},stroke:{id:[site,Date.now()],points:this.#drawPoints,pressure,style:{color:"#171717",width:3},bbox:{x:0,y:0,w:item.w,h:item.h}}}}}]);this.#drawPoints=[];};svg.addEventListener("pointermove",move);svg.addEventListener("pointerup",finish,{once:true});svg.addEventListener("pointercancel",finish,{once:true});}
  #pairs(points:number[]){let value="";for(let i=0;i<points.length;i+=2)value+=`${points[i]},${points[i+1]} `;return value.trim();}
  #onKey(event:KeyboardEvent){
    if(event.defaultPrevented||event.key==="Escape"&&document.querySelector("[popover]:popover-open"))return;
    const target=event.composedPath()[0];if(!(target instanceof HTMLElement)||!this.store.route.get().startsWith("/canvas"))return;if(target.matches("input,textarea,select,[contenteditable=true]")||target.closest("button,a,summary,[role=button],[role=link],[role=tab],[role=menuitem],dialog")&&event.key!=="Escape")return;
    if(event.key==="Escape"&&this.#viewerFocused&&(this.#viewingOutputId||this.#viewingArtifactId)){event.preventDefault();event.stopPropagation();this.#setViewerFocus(false);return;}
    // Current native viewers own cancel, close and opener return.
    // Do not retire them in the board key handler before the UA cancel step.
    if(event.key==="Escape"){
      const dialog=target.closest<HTMLDialogElement>("dialog");
      if(dialog?.isConnected&&dialog.open&&dialog.matches(":modal")
        &&(dialog===this.querySelector<HTMLDialogElement>(".canvas-artifact-viewer")
          ||dialog===this.querySelector<HTMLDialogElement>(".canvas-output-viewer")))return;
    }
    // This posture and its owned review dialog do not operate on hidden board selections.
    if(this.#arrangementOpen||outcomeDeskRouteState(this.store.route.get()).posture==="outcomes")return;
    const plainKey=!event.metaKey&&!event.ctrlKey&&!event.altKey,editable=this.#canEditCanvas();
    const focusedCard=target.closest<HTMLElement>(".canvas-item[data-canvas-item-id]");
    if(plainKey&&focusedCard&&(event.key==="Enter"||event.key===" ")&&!target.closest("button,a,summary")){event.preventDefault();const itemId=focusedCard.dataset.canvasItemId;if(itemId)this.#select(itemId,{shiftKey:event.shiftKey});return;}
    if(event.key==="Escape"&&this.#tool==="marquee"){event.preventDefault();this.#tool="select";this.#selectionMarquee=undefined;this.requestUpdate();return;}
    if(plainKey&&event.key.toLowerCase()==="b"){event.preventDefault();this.#toggleBatchSelection();}
    if(editable&&plainKey&&event.key.toLowerCase()==="n"){event.preventDefault();this.#openAdd();}
    if(plainKey&&event.key==="?"||event.metaKey&&!event.ctrlKey&&!event.altKey&&event.key==="\\"){event.preventDefault();this.#semanticOpen=!this.#semanticOpen;if(this.#semanticOpen)this.#trackCanvasInteraction("reading_order_opened",{input_method:"keyboard"});this.requestUpdate();}
    if(editable&&plainKey&&event.key.toLowerCase()==="e"&&this.#selected.size===1){event.preventDefault();this.#openEdit();}
    if(editable&&plainKey&&event.key.toLowerCase()==="f"&&this.#selected.size){event.preventDefault();if(!this.#contextTarget.trim())this.#contextTarget=this.#contextName;this.#formalizeOpen=true;this.requestUpdate();}
    if(plainKey&&event.key.toLowerCase()==="c"&&this.#selected.size>1){event.preventDefault();void this.#openComparison();}
    if(editable&&plainKey&&event.key.toLowerCase()==="d"){event.preventDefault();void this.#startDrawing();}
    if(plainKey&&event.key==="0"){event.preventDefault();this.#setZoom(1);}
    if(plainKey&&event.key==="1"){event.preventDefault();this.#fitBoard();}
    if(editable&&plainKey&&(event.key==="Delete"||event.key==="Backspace")){event.preventDefault();void this.#removeSelected();}
    if(plainKey&&(event.key==="+"||event.key==="=")){event.preventDefault();this.#setZoom(this.#zoom+.1);}
    if(plainKey&&event.key==="-"){event.preventDefault();this.#setZoom(this.#zoom-.1);}
    const step=event.shiftKey?10:1;if(editable&&plainKey&&event.key==="ArrowLeft"){event.preventDefault();this.#nudge(-step,0);}if(editable&&plainKey&&event.key==="ArrowRight"){event.preventDefault();this.#nudge(step,0);}if(editable&&plainKey&&event.key==="ArrowUp"){event.preventDefault();this.#nudge(0,-step);}if(editable&&plainKey&&event.key==="ArrowDown"){event.preventDefault();this.#nudge(0,step);}
    if(event.key==="Escape"&&(this.#inputOutputId||this.#inputArtifactId||this.#inputFailureJobId)){this.#inputOutputId="";this.#inputArtifactId="";this.#inputFailureJobId="";this.requestUpdate();return;}
    if(event.key==="Escape"){const overlayOpen=this.#addOpen||this.#formalizeOpen||this.#memberOpen||this.#editOpen||this.#documentOpen||this.#renderOpen||this.#documentOutputsOpen||this.#semanticOpen||this.#organizeOpen||Boolean(this.#viewingOutputId)||Boolean(this.#viewingArtifactId);this.#addOpen=false;this.#formalizeOpen=false;this.#memberOpen=false;this.#editOpen=false;this.#documentOpen=false;this.#renderOpen=false;this.#documentOutputsOpen=false;this.#documentOutputsItemId="";if(this.#semanticOpen)this.#closeSemantic();this.#organizeOpen=false;this.#viewingOutputId="";this.#viewingArtifactId="";this.#viewingComparisonId="";if(!overlayOpen&&this.#selected.size){this.#selected.clear();}else if(!overlayOpen&&canvasFocusFromRoute(this.store.route.get()))this.#navigateCanvasPresentation(withCanvasFocus(this.store.route.get(),false));this.requestUpdate();}
  }
  #fitBoard(){const viewport=this.#viewportElement;const items=this.store.canvasProjection.get().items;if(!viewport||!items.length)return;const minX=Math.min(...items.map((item)=>item.x)),minY=Math.min(...items.map((item)=>item.y)),maxX=Math.max(...items.map((item)=>item.x+item.w)),maxY=Math.max(...items.map((item)=>item.y+item.h));const width=Math.max(1,maxX-minX),height=Math.max(1,maxY-minY);this.#zoom=Math.max(CANVAS_MIN_ZOOM,Math.min(1,Math.min((viewport.clientWidth-160)/width,(viewport.clientHeight-160)/height)));this.#cameraX=(minX+maxX)/2-viewport.clientWidth/(2*this.#zoom);this.#cameraY=(minY+maxY)/2-viewport.clientHeight/(2*this.#zoom);this.#scheduleViewportPersistence();this.#trackCanvasInteraction("board_fitted",{item_count:items.length});this.requestUpdate();}
  #setZoom(next:number,anchor?:{clientX:number;clientY:number},snap=true){const viewport=this.#viewportElement;const before=this.#zoom;const precision=snap?20:1000;const zoom=Math.max(CANVAS_MIN_ZOOM,Math.min(CANVAS_MAX_ZOOM,Math.round(next*precision)/precision));if(zoom===before)return;if(viewport){const rect=viewport.getBoundingClientRect();const localX=anchor?anchor.clientX-rect.left:viewport.clientWidth/2,localY=anchor?anchor.clientY-rect.top:viewport.clientHeight/2;const worldX=this.#cameraX+localX/before,worldY=this.#cameraY+localY/before;this.#zoom=zoom;this.#cameraX=worldX-localX/zoom;this.#cameraY=worldY-localY/zoom;}else this.#zoom=zoom;this.#scheduleViewportPersistence();window.clearTimeout(this.#zoomInteractionTimer);this.#zoomInteractionTimer=window.setTimeout(()=>this.#trackCanvasInteraction("zoom_changed",{zoom_percent:Math.round(this.#zoom*100),input_method:anchor?"wheel-or-pinch":"control"}),350);this.requestUpdate();}
  #canvasWheel(event:WheelEvent){event.preventDefault();event.stopPropagation();if(event.ctrlKey){const delta=Math.max(-100,Math.min(100,event.deltaY));this.#setZoom(this.#zoom*Math.exp(-delta*.01),{clientX:event.clientX,clientY:event.clientY},false);return;}const unit=event.deltaMode===WheelEvent.DOM_DELTA_LINE?16:event.deltaMode===WheelEvent.DOM_DELTA_PAGE?Math.max(this.#viewportElement?.clientWidth??0,this.#viewportElement?.clientHeight??0):1;this.#cameraX+=event.deltaX*unit/this.#zoom;this.#cameraY+=event.deltaY*unit/this.#zoom;this.#scheduleViewportPersistence();window.clearTimeout(this.#panInteractionTimer);this.#panInteractionTimer=window.setTimeout(()=>this.#trackCanvasInteraction("board_panned",{input_method:"wheel"}),350);this.requestUpdate();}
  #cardWheel(event:WheelEvent){const card=event.currentTarget as HTMLElement;if(!event.ctrlKey&&Math.abs(event.deltaY)>=Math.abs(event.deltaX)&&card.scrollHeight>card.clientHeight+1)event.stopPropagation();}
  #setView(view:CanvasView){this.#trackCanvasInteraction("view_changed",{view});this.#go(withCanvasView(this.store.route.get(),view));}
  async #openComparison(){const canvas=this.store.canvasProjection.get();const selected=canvas.items.filter((item)=>this.#selected.has(item.id)&&mediaKind(item)).slice(0,4);if(selected.length<2)return;if(!this.store.session.get()?.projectContext)await this.#commit([{type:"ComparisonOpened",payload:{canvas_id:canvas.selectedCanvasId,project_id:canvas.projectId,object_ids:selected.map((item)=>item.sourceId),canvas_item_ids:selected.map((item)=>item.id),source_surface:"canvas-hud"}}]);this.#setView("compare");}
  #viewerFan(output:CreativeOutput){if(!output.promptFanId)return[output];return this.store.projection.get().libraryOutputs.filter((candidate)=>candidate.mediaUrl&&candidate.promptFanId===output.promptFanId&&candidate.documentId===output.documentId).sort((left,right)=>{const leftIndex=PROMPT_TECHNIQUES.indexOf(left.promptTechnique),rightIndex=PROMPT_TECHNIQUES.indexOf(right.promptTechnique);return(leftIndex<0?PROMPT_TECHNIQUES.length:leftIndex)-(rightIndex<0?PROMPT_TECHNIQUES.length:rightIndex)||left.sequence-right.sequence;});}
  #recordCanvasOutputView(output:CreativeOutput,interaction:"open"|"navigate",navigationMethod:"trigger"|"keyboard"|"button",previous?:CreativeOutput,direction?:-1|1){if(!this.store.ui.instrumentation||this.store.session.get()?.projectContext)return;void this.store.hot({type:"ObjectViewed",payload:{object_id:output.id,view_id:this.#viewingComparisonId,comparison_id:output.promptFanId?this.#viewingComparisonId:null,source_surface:this.#viewingOutputSource,interaction,navigation_method:navigationMethod,prompt_fan_id:output.promptFanId||null,prompt_technique:output.promptTechnique,previous_object_id:previous?.id??null,direction:direction===-1?"previous":direction===1?"next":null}});}
  #setViewerFocus(focused:boolean){this.#viewerFocused=focused;this.requestUpdate();void this.updateComplete.then(()=>this.querySelector<HTMLButtonElement>(".canvas-viewer-focus-toggle")?.focus({preventScroll:true}));}
  #restoreViewerFocus(){const opener=this.#viewerReturnFocus;this.#viewerReturnFocus=undefined;if(opener?.isConnected)opener.focus({preventScroll:true});}
  #showCanvasOutput(output:CreativeOutput,sourceSurface="canvas-image-dialog",current?:()=>boolean){if(current&&!current())return false;this.#nextImageOpening=current?{current,presented:false}:null;this.#viewerReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;this.#viewerFocused=false;this.#viewingOutputId=output.id;this.#viewingComparisonId=uid();this.#viewingOutputSource=sourceSurface;const fan=this.#viewerFan(output);if(this.store.ui.instrumentation&&!this.store.session.get()?.projectContext&&fan.length>1)void this.store.hot({type:"ComparisonOpened",payload:{comparison_id:this.#viewingComparisonId,comparison_kind:"prompt_fan_image_viewer",prompt_fan_id:output.promptFanId,object_ids:fan.map((candidate)=>candidate.id),starting_object_id:output.id,source_surface:sourceSurface}});this.#recordCanvasOutputView(output,"open","trigger");this.requestUpdate();}
  #openCanvasOutput(event:MouseEvent,output:CreativeOutput,item:CanvasItem){event.stopPropagation();if(event.shiftKey){event.preventDefault();this.#select(item.id,{shiftKey:true});return;}this.#showCanvasOutput(output);}
  #closeCanvasOutput(){this.#nextImageOpening=null;this.querySelector<HTMLDialogElement>(".canvas-output-viewer")?.close();this.#viewerFocused=false;this.#viewingOutputId="";this.#viewingComparisonId="";this.requestUpdate();this.#restoreViewerFocus();}
  #navigateCanvasOutput(direction:-1|1,navigationMethod:"keyboard"|"button"){const output=this.store.projection.get().libraryOutputs.find((candidate)=>candidate.id===this.#viewingOutputId);if(!output)return;const fan=this.#viewerFan(output);if(fan.length<2)return;const currentIndex=Math.max(0,fan.findIndex((candidate)=>candidate.id===output.id));const next=fan[(currentIndex+direction+fan.length)%fan.length];this.#viewingOutputId=next.id;this.#recordCanvasOutputView(next,"navigate",navigationMethod,output,direction);this.requestUpdate();}
  #documentOutputs(item:CanvasItem){return this.store.projection.get().libraryOutputs.filter((output)=>output.documentId===item.sourceId&&Boolean(output.mediaUrl)).sort((left,right)=>right.sequence-left.sequence);}
  #documentArtifacts(item:CanvasItem){return this.store.projection.get().libraryArtifacts.filter((artifact)=>artifact.documentId===item.sourceId).sort((left,right)=>right.sequence-left.sequence);}
  #documentOutputJobs(item:CanvasItem){return{images:this.store.documentGenerationJobs(item.sourceId),artifacts:this.store.documentRenderJobs(item.sourceId)};}
  #documentOutputFailures(item:CanvasItem){return this.store.documentJobs.get().filter((job)=>job.documentId===item.sourceId&&!job.parentJobId&&(job.kind==="preview"||job.kind==="generate"||job.kind==="prompt_fan"||job.kind==="render_document")&&(job.status==="failed"||job.status==="partial")).sort((left,right)=>right.requestedAt.localeCompare(left.requestedAt));}
  #documentOutputCount(item:CanvasItem){const jobs=this.#documentOutputJobs(item);return this.#documentOutputs(item).length+this.#documentArtifacts(item).length+jobs.images.length+jobs.artifacts.length+this.#documentOutputFailures(item).length;}
  #openDocumentOutputs(item:CanvasItem){const canvas=this.store.canvasProjection.get();if(!this.#currentControlsScope()||item.canvasId!==canvas.selectedCanvasId||!canvas.items.some((current)=>current.id===item.id&&current.sourceKind==="document"&&current.sourceId===item.sourceId))return;this.#disposeControlsFocus();const jobs=this.#documentOutputJobs(item);const failures=this.#documentOutputFailures(item);this.#outputsReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;this.#documentOutputsItemId=item.id;this.#outputsDocumentId=item.sourceId;this.#documentOutputsOpen=true;this.#trackCanvasInteraction("document_outputs_opened",{document_id:item.sourceId,output_count:this.#documentOutputCount(item),image_count:this.#documentOutputs(item).length,artifact_count:this.#documentArtifacts(item).length,rendering_count:jobs.images.length+jobs.artifacts.length,failure_count:failures.length});this.requestUpdate();}
  #closeDocumentOutputs(restoreFocus=true){this.#disposeControlsFocus();this.#documentOutputsOpen=false;this.querySelector<HTMLDialogElement>(".canvas-document-outputs-dialog")?.close();this.#documentOutputsItemId="";this.#outputsDocumentId="";this.requestUpdate();if(restoreFocus)this.#returnControlsFocus(this.#outputsReturnFocus);}
  async #placeDocumentOutput(output:CreativeOutput){const placed=await this.#placeSource(this.#outputSource(output),{source_document_id:output.documentId,source_generation_id:output.generationId,source_surface:"canvas-document-outputs-dialog"});if(placed)this.#trackCanvasInteraction("document_output_placed",{document_id:output.documentId,object_id:output.id,prompt_technique:output.promptTechnique,quality:output.quality,prompt_fan_id:output.promptFanId||null});}
  async #placeDocumentArtifact(artifact:DocumentArtifact){const placed=await this.#placeSource(this.#artifactSource(artifact),{source_document_id:artifact.documentId,source_artifact_id:artifact.id,source_surface:"canvas-document-outputs-dialog"});if(placed)this.#trackCanvasInteraction("document_output_placed",{document_id:artifact.documentId,object_id:artifact.id,output_family:"document_artifact",artifact_kind:artifact.kind});}
  #outputCreatedAt(sourceEventId:string,sequence:number){const event=this.store.events.get().find((candidate)=>candidate.eventId===sourceEventId)??this.store.events.get().find((candidate)=>candidate.sequence===sequence);return event?.occurredAt??"";}
  #outputTimestamp(value:string,label="Created"){const date=new Date(value);if(!value||!Number.isFinite(date.getTime()))return nothing;return html`<time class="canvas-document-output-created" datetime=${value}>${this.i18n.system(label)} ${this.i18n.date(date,{dateStyle:"medium",timeStyle:"short"})}</time>`;}
  #pendingDocumentOutput(job:DocumentJob){
    const progress=documentJobProgress(job);
    const artifactKind=DOCUMENT_ARTIFACT_KINDS.includes(job.result?.artifactKind as DocumentArtifactKind)?job.result!.artifactKind as DocumentArtifactKind:null;
    const artifact=job.kind==="render_document";
    const fan=job.kind==="prompt_fan";
    const quality=job.fanKind??(job.kind==="preview"?"preview":"generate");
    const technique=promptTechniqueDefinition(job.promptTechnique);
    const title=artifact
      ?artifactKind?this.i18n.system(documentArtifactDefinition(artifactKind).label):this.i18n.system("Document output")
      :fan?this.i18n.system("{quality} fan ×4",{quality:this.i18n.system(quality==="preview"?"Draft":"Full-quality")})
        :this.i18n.system("{quality} image · {technique}",{quality:this.i18n.system(quality==="preview"?"Draft":"Full-quality"),technique:this.i18n.system(technique.shortLabel)});
    const partialUrl=typeof job.result?.partialMediaUrl==="string"?job.result.partialMediaUrl:"";
    const status=this.i18n.system(job.status==="queued"?"Queued":job.status==="committing"?"Saving":"Rendering");
    return html`<article class="canvas-document-output-pending" aria-label=${this.i18n.system("{title} {status}",{title,status:status.toLocaleLowerCase(this.i18n.locale)})}>
      <div class=${`canvas-document-output-preview canvas-document-output-placeholder${partialUrl?" has-partial":""}${artifact?" is-artifact":""}`}>
        ${partialUrl?html`<img src=${partialUrl} alt="Early image preview; the final output is still rendering" loading="eager">`:html`<b class="canvas-document-output-placeholder-mark" aria-hidden="true">${icon(fan?"families":artifactKind?artifactIcon(artifactKind):"image")}</b>`}
        <span>${status}</span>
      </div>
      <div class="canvas-document-output-copy canvas-document-output-progress-copy">
        <span>${status} · ${this.i18n.system(progress.label)}</span>
        <h3>${title}</h3>
        ${this.#outputTimestamp(job.requestedAt,"Requested")}
        <p>${job.progressMessage?localizedDocumentJobProgress(job,this.i18n):this.i18n.system("The server accepted this render and is preparing its next stage.")}</p>
        <div class="canvas-document-output-progress" role="progressbar" aria-label=${this.i18n.system("{title} progress", { title: title })} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${progress.percent}><i style=${`--document-output-progress:${progress.percent}%`}></i></div>
        ${progress.detail?html`<small>${localizedDocumentJobProgressDetail(progress.detail,job,this.i18n)}</small>`:nothing}
        <ol class="canvas-document-output-progress-steps" aria-label="Rendering stages">${progress.steps.map((step)=>html`<li class=${step.state}><i aria-hidden="true"></i><span>${this.i18n.system(step.label)}</span></li>`)}</ol>
      </div>
      <footer><small>Will appear here automatically when ready.</small></footer>
    </article>`;
  }
  async #showCanvasArtifact(artifact:DocumentArtifact){
    const source=this.store.captureSourceOwnership(),route=this.store.route.get(),scope=this.#currentControlsScope();
    const priorArtifact=this.#viewingArtifactId,priorOutput=this.#viewingOutputId,priorAdd=this.#addOpen;
    const current=()=>Boolean(source&&this.isConnected&&this.store.sourceOwnershipActive(source)&&route===this.store.route.get()
      &&scope&&scope===this.#currentControlsScope()&&priorArtifact===this.#viewingArtifactId&&priorOutput===this.#viewingOutputId&&priorAdd===this.#addOpen
      &&this.store.projection.get().libraryArtifacts.some((item)=>item.id===artifact.id&&item.documentId===artifact.documentId&&item.sourceEventId===artifact.sourceEventId&&item.contentRef===artifact.contentRef));
    if(!current())return;
    this.#closePopovers();this.#viewerReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;this.#viewerFocused=false;this.#viewerActionsOpen=false;
    if(artifact.contentRef&&!this.store.content.get()[artifact.contentRef])try{await this.store.ensurePrivateContent(artifact.contentRef);}catch{return;}
    if(!current())return;
    this.#viewingArtifactId=artifact.id;
    if(this.store.ui.instrumentation&&!this.store.session.get()?.projectContext)void this.store.hot({type:"DocumentArtifactViewed",payload:{artifact_id:artifact.id,artifact_kind:artifact.kind,document_id:artifact.documentId,source_surface:"canvas-artifact-viewer"}});
    this.requestUpdate();
  }
  async #openArtifactDelivery(artifact:DocumentArtifact){
    const authorization=this.store.captureAuthorizationScope(),canvasId=this.store.canvasProjection.get().selectedCanvasId;
    const facts=()=>nextActionFacts(this.store,artifact.documentId,canvasId);
    const sourceRevision=creativeActionSourceRevision(facts()),revision=documentArtifactRevision(this.store.events.get(),artifact.id);
    const delivery=artifactDeliveryFor(this.store,artifact,undefined,canvasId);
    const sourceState=JSON.stringify(delivery.review);
    const current=(stage:CreativePreparationStage)=>{
      const now=facts();
      return Boolean(authorization&&this.store.authorizationScopeActive(authorization)&&now.canRead
        &&this.store.canvasProjection.get().selectedCanvasId===canvasId
        &&now.artifacts.some(candidate=>candidate.id===artifact.id&&candidate.sourceEventId===artifact.sourceEventId&&candidate.contentRef===artifact.contentRef)
        &&(stage==="editing"||documentArtifactRevision(this.store.events.get(),artifact.id)===revision
          &&creativeActionSourceRevision(now)===sourceRevision
          &&JSON.stringify(artifactDeliveryFor(this.store,artifact,undefined,canvasId).review)===sourceState));
    };
    if(!current("opening"))return false;
    this.#closeCanvasArtifact();await this.updateComplete;
    if(!current("opening"))return false;
    try{return await this.querySelector("forma-document-artifacts")?.openArtifactById(artifact.id,{
      expectedRevision:revision,...(delivery.contentSha256?{expectedContentSha256:delivery.contentSha256}:{}),intent:delivery.intent,current,
    })??false;}catch{if(authorization&&this.store.authorizationScopeActive(authorization))this.store.toast(this.i18n.t("artifact.delivery.exactChanged","This exact output revision is no longer available. No review or export was performed."));return false;}
  }
  #closeCanvasArtifact(){this.#closePopovers();this.querySelector<HTMLDialogElement>(".canvas-artifact-viewer")?.close();this.#viewerFocused=false;this.#viewerActionsOpen=false;this.#viewingArtifactId="";this.requestUpdate();this.#restoreViewerFocus();}
  #resizeHandles(item:CanvasItem,corners:readonly ResizeCorner[]){if(!this.#canEditCanvas()||!this.#selected.has(item.id))return nothing;const paths:Record<ResizeCorner,string>={nw:"M0 4 4 0M0 8 8 0M0 12 12 0",ne:"M24 4 20 0M24 8 16 0M24 12 12 0",sw:"M0 20 4 24M0 16 8 24M0 12 12 24",se:"M24 20 20 24M24 16 16 24M24 12 12 24"};const mode=mediaKind(item)?"Image aspect ratio stays locked.":"Width and height can change independently.";return corners.map((corner)=>html`<button type="button" class=${`canvas-resize-handle canvas-resize-handle--${corner}`} aria-label=${this.i18n.system("Resize {title} from the {label} card corner. Current size {number} by {number2}. {mode}", { title: item.title, label: corner==="nw" ? this.i18n.system("top left") : corner==="ne" ? this.i18n.system("top right") : corner==="sw" ? this.i18n.system("bottom left") : this.i18n.system("bottom right"), number: this.i18n.number(Math.round(item.w)), number2: this.i18n.number(Math.round(item.h)), mode: this.i18n.system(mode) })} title=${this.i18n.system("Drag the card corner to resize · Arrow keys for precise changes · {mode}", { mode: this.i18n.system(mode) })} @pointerdown=${(event:PointerEvent)=>this.#resizeItem(event,item,corner)} @keydown=${(event:KeyboardEvent)=>this.#resizeItemWithKeyboard(event,item,corner)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d=${paths[corner]}></path></svg></button>`);}

  #sourceFor(item:CanvasItem){const p=this.store.projection.get();if(item.sourceKind==="document")return p.documents.find((source)=>source.id===item.sourceId);if(item.sourceKind==="output")return p.libraryOutputs.find((source)=>source.id===item.sourceId);if(item.sourceKind==="artifact")return p.libraryArtifacts.find((source)=>source.id===item.sourceId);if(item.sourceKind==="context")return this.store.canvasProjection.get().contextSets.find((source)=>source.id===item.sourceId);return p.libraryBlocks.find((source)=>source.id===item.sourceId);}
  #itemFacets(item:CanvasItem):CanvasFacet[]{const p=this.store.projection.get();if(item.sourceKind==="context"){const set=this.store.canvasProjection.get().contextSets.find((candidate)=>candidate.id===item.sourceId);return set?[...new Map(set.itemIds.flatMap((id)=>{const child=this.store.canvasProjection.get().items.find((candidate)=>candidate.id===id);return child?this.#itemFacets(child):[];}).map((facet)=>[canvasFacetKey(facet),facet])).values()]:[];}return canvasFacetsForItem(item,p.libraryBlocks);}
  #outputVisual(output:CreativeOutput,item:CanvasItem){return html`<div class="canvas-image-interaction"><forma-output-visual .output=${output} .compact=${true}></forma-output-visual><button type="button" class="canvas-image-open" aria-label=${this.i18n.system("Open generated image {id} at full size. Shift-click to add this idea to the selection", { id: output.id })} title="Open full image · Shift-click to add this idea to the selection" @pointerdown=${(event:PointerEvent)=>event.stopPropagation()} @click=${(event:MouseEvent)=>this.#openCanvasOutput(event,output,item)}><span>Open full image</span></button></div>`;}
  #artifactPreview(artifact:DocumentArtifact){
    const label=this.i18n.system(documentArtifactDefinition(artifact.kind).label);
    if(artifact.kind==="video"&&artifact.mediaUrl)return html`<video src=${artifact.mediaUrl} preload="metadata" muted playsinline aria-label=${artifact.title}></video>`;
    if(artifact.kind==="storyboard"&&artifact.items.some((entry)=>entry.mediaUrl))return html`<div class="canvas-artifact-frames">${artifact.items.slice(0,4).map((entry)=>entry.mediaUrl?html`<img src=${entry.mediaUrl} alt="" loading="lazy">`:nothing)}</div>`;
    if(artifact.kind==="slides"){const content=parseDocumentArtifactContent(this.store.content.get()[artifact.contentRef??""]),receipt=artifact.items[0],source=content?.items[0];const item:DocumentArtifactDraftItem={title:source?.title??receipt?.title??artifact.title,body:source?.body??receipt?.body??artifact.summary,notes:source?.notes??receipt?.notes??"",image_prompt:source?.image_prompt??receipt?.imagePrompt??"",slide:source?.slide??receipt?.slide??null};return html`<div class="canvas-artifact-slide-preview"><forma-presentation-slide .item=${item} .presentation=${content?.presentation??artifact.presentation} .index=${0} .total=${artifact.itemCount} .compact=${true} .showFooterLabel=${readSlideFooterLabelPreference()}></forma-presentation-slide></div>`;}
    return html`<div class="canvas-artifact-symbol"><span aria-hidden="true">${icon(artifactIcon(artifact.kind))}</span><small>${label}</small></div>`;
  }
  #documentItemBody(item:CanvasItem):TemplateResult{
    const projection=this.store.projection.get();
    const outputs=projection.libraryOutputs.filter((output)=>output.documentId===item.sourceId);
    const artifacts=projection.libraryArtifacts.filter((artifact)=>artifact.documentId===item.sourceId);
    const latest=generationHistoryItems(outputs)[0];
    const latestImageSequence=latest?.kind==="fan"?Math.max(...latest.outputs.map((output)=>output.sequence)):latest?.kind==="output"?latest.output.sequence:-1;
    const latestArtifact=artifacts[0];
    const artifactIsNewest=Boolean(latestArtifact&&latestArtifact.sequence>latestImageSequence);
    const imageJobs=this.store.documentGenerationJobs(item.sourceId);
    const artifactJobs=this.store.documentRenderJobs(item.sourceId);
    const jobs=[...imageJobs,...artifactJobs];
    const headline=jobs.length
      ?jobs[0].progressMessage?localizedDocumentJobProgress(jobs[0],this.i18n):this.i18n.system("Rendering another form…")
      :artifactIsNewest&&latestArtifact
        ?this.i18n.system("{label} ready",{label:this.i18n.system(documentArtifactDefinition(latestArtifact.kind).label)})
        :latest?.kind==="fan"
          ?this.i18n.system("{count} of 4 fan images",{count:this.i18n.number(latest.complete)})
          :latest?.kind==="output"
            ?this.i18n.system("{quality} image ready",{quality:this.i18n.system(latest.output.quality==="low"?"Draft":"Full-quality")})
            :artifacts.length
              ?artifacts.length===1?this.i18n.system("{count} document format ready",{count:this.i18n.number(artifacts.length)}):this.i18n.system("{count} document formats ready",{count:this.i18n.number(artifacts.length)})
              :this.i18n.system("Prepared without a render");
    const detail=jobs.length
      ?jobs.length===1?this.i18n.system("{count} render in progress",{count:this.i18n.number(jobs.length)}):this.i18n.system("{count} renders in progress",{count:this.i18n.number(jobs.length)})
      :artifacts.length
        ?`${artifacts.map((artifact)=>this.i18n.system(documentArtifactDefinition(artifact.kind).label)).slice(0,3).join(" · ")}${artifacts.length>3?` · +${this.i18n.number(artifacts.length-3)}`:""}`
        :item.body;
    return html`<div class=${`canvas-document-preview${latest||latestArtifact?" has-output":""}${jobs.length?" is-rendering":""}`}>
      <div class="canvas-document-visual">${artifactIsNewest&&latestArtifact
        ?this.#artifactPreview(latestArtifact)
        :latest?.kind==="fan"
          ?html`<forma-prompt-fan-visual .outputs=${latest.outputs} .compact=${true}></forma-prompt-fan-visual>`
          :latest?.kind==="output"
            ?this.#outputVisual(latest.output,item)
            :latestArtifact
              ?this.#artifactPreview(latestArtifact)
              :html`<span aria-hidden="true">${icon("document")}</span>`}</div>
      <div class="canvas-document-status"><b>${headline}</b><span>${detail}</span></div>
    </div>`;
  }
  #itemBody(item:CanvasItem):TemplateResult{
    const source=this.#sourceFor(item);
    if(item.sourceKind==="output"){const output=source as CreativeOutput|undefined;return output?this.#outputVisual(output,item):html`<p>Generation unavailable</p>`;}
    if(item.sourceKind==="artifact"){const artifact=source as DocumentArtifact|undefined;return artifact?html`<div class="canvas-standalone-artifact">${this.#artifactPreview(artifact)}<button type="button" class="canvas-artifact-open" @pointerdown=${(event:PointerEvent)=>event.stopPropagation()} @click=${(event:MouseEvent)=>{event.stopPropagation();this.#showCanvasArtifact(artifact);}}>${this.i18n.system("Open {label}",{label:this.i18n.system(documentArtifactDefinition(artifact.kind).label).toLocaleLowerCase(this.i18n.locale)})}</button><p>${artifact.summary}</p></div>`:html`<p>Document output unavailable</p>`;}
    if(item.sourceKind==="document")return this.#documentItemBody(item);
    if(item.sourceKind==="context"){const set=source as CanvasContextSet|undefined;const role=COMBINED_CONTEXT_ROLE_DEFINITIONS.find((option)=>option.id===set?.role);const application=COMBINED_CONTEXT_APPLICATION_DEFINITIONS.find((option)=>option.id===set?.application);return html`<div class="canvas-context-preview"><span class="canvas-context-stack"><i></i><i></i><i></i></span><b>${set?.itemIds.length??0} connected ideas · ${Math.round((set?.relativity??.8)*100)}% relative</b><small>${role?.label??this.i18n.system("Custom target")}: ${set?.target??set?.name??item.title}</small><small>${application?.label??this.i18n.system("Keep isolated")} when rendering</small></div>`;}
    const block=source as CreativeBlock|undefined;
    if(item.sourceKind==="sketch")return html`<svg class="canvas-sketch" viewBox=${`0 0 ${item.w} ${item.h}`} @pointerdown=${(event:PointerEvent)=>this.#startStroke(event,item)} aria-label="Sketch surface">${item.strokes.map((stroke)=>html`<polyline points=${this.#pairs(stroke.points)} fill="none" stroke=${stroke.color} stroke-width=${stroke.width} vector-effect="non-scaling-stroke"></polyline>`)}<polyline class="canvas-stroke-preview" fill="none" stroke="currentColor" stroke-width="3" vector-effect="non-scaling-stroke"></polyline></svg>`;
    const media=block?.type==="reference"?String(block.properties.media_url??""):"";
    return html`${media?html`<div class="canvas-reference-stage"><forma-reference-image .src=${media} .alt=${String(block?.properties.label??item.title)} .compact=${true} .separateOpenControl=${true} .targetId=${block?.id??item.sourceId} .referenceId=${String(block?.properties.reference_id??"")} .focalPoint=${block?.properties.focal_point} @forma-reference-image-select-requested=${(event:CustomEvent)=>{event.preventDefault();this.#select(item.id,{shiftKey:true});}}></forma-reference-image></div>`:nothing}<p>${item.body||(block?textForBlock(block):"")}</p>`;
  }
  #card(item:CanvasItem){const selected=this.#selected.has(item.id);const title=this.#itemTitle(item);const facets=this.#itemFacets(item).slice(0,2);const resizing=this.#resizePreview?.itemId===item.id?this.#resizePreview:null;const frame=resizing??item;const left=(frame.x-this.#cameraX)*this.#zoom,top=(frame.y-this.#cameraY)*this.#zoom;const preview=this.#dragPreview?.itemIds.includes(item.id)?this.#dragPreview.positions.get(item.id):null;const translateX=preview?(preview.x-item.x)*this.#zoom:0,translateY=preview?(preview.y-item.y)*this.#zoom:0;const artifactLabel=item.sourceKind==="artifact"?documentArtifactDefinition(item.blockType as DocumentArtifactKind)?.label:null;return html`<article class=${`canvas-item canvas-item--${item.sourceKind}${selected?" selected":""}${resizing?" is-resizing":""}`} data-canvas-item-id=${item.id} style=${`left:${left}px;top:${top}px;width:${frame.w}px;height:${frame.h}px;z-index:${item.z.replace(/\D/g,"")||1};translate:${translateX}px ${translateY}px;transform:scale(${this.#zoom}) rotate(${item.rot}deg)`} tabindex="0" role="group" aria-label=${`${canvasItemAccessibleName({...item,title})}${selected?`, ${this.i18n.t("canvas.selected","selected")}`:""}`} @click=${(event:MouseEvent)=>{if(this.#dragClickGuard===item.id){this.#dragClickGuard="";return;}if(["select","marquee"].includes(this.#tool)&&!this.#fromCardControl(event))this.#select(item.id,event);}} @pointerdown=${(event:PointerEvent)=>this.#drag(event,item)} @wheel=${(event:WheelEvent)=>this.#cardWheel(event)}><header><div class="canvas-item-kicker"><span>${item.sourceKind==="context"?this.i18n.system("Combined context"):this.i18n.system(artifactLabel??blockTypeDefinition(item.blockType)?.label??item.blockType??item.sourceKind)}</span>${item.lockedBy?html`<small>${icon("lock")} Editing</small>`:nothing}</div><h3>${title}</h3>${this.#resizeHandles(item,["nw","ne"])}</header><div class="canvas-item-content">${this.#itemBody(item)}</div>${facets.length||selected?html`<footer class=${`${selected?"has-resize-handles":""}${selected&&!facets.length?" handles-only":""}`}>${facets.map((facet)=>html`<span>${this.i18n.system(facet.label)}: ${facet.value}</span>`)}${this.#resizeHandles(item,["sw","se"])}</footer>`:nothing}</article>`;}
  #nearbyItems(items:CanvasItem[]){const viewport=this.#viewportElement;const width=(viewport?.clientWidth||window.innerWidth)/this.#zoom,height=(viewport?.clientHeight||window.innerHeight)/this.#zoom;return canvasItemsInVirtualViewport(items,{x:this.#cameraX,y:this.#cameraY,width,height},RENDER_OVERSCAN_PX/this.#zoom);}
  #nearbyPresence() {
    if (this.#currentPresenceScope()?.key !== this.#presenceKey) return [];
    const viewport = this.#viewportElement, now = Date.now();
    const width = (viewport?.clientWidth || window.innerWidth) / this.#zoom;
    const height = (viewport?.clientHeight || window.innerHeight) / this.#zoom;
    const overscan = RENDER_OVERSCAN_PX / this.#zoom;
    return this.#presence.filter((peer) => peer.hasPosition && peer.expiresAt > now &&
      peer.x >= this.#cameraX - overscan && peer.x <= this.#cameraX + width + overscan &&
      peer.y >= this.#cameraY - overscan && peer.y <= this.#cameraY + height + overscan);
  }
  #renderPresence() {
    const label = this.i18n.t("canvas.presence.otherTab", "Your other tab · this browser");
    const detail = this.i18n.t("canvas.presence.localOnly",
      "Last board position from another tab for this account in this browser.");
    return this.#nearbyPresence().map((peer) => html`<span class="canvas-presence" role="img"
      aria-label=${label + ". " + detail}
      style=${`transform:translate3d(${(peer.x-this.#cameraX)*this.#zoom}px,${(peer.y-this.#cameraY)*this.#zoom}px,0)`}>
      <forma-ui-badge tone="neutral" .label=${label} aria-hidden="true"></forma-ui-badge>
    </span>`);
  }
  #orderedItems(items:CanvasItem[]){const lens=canvasLensFromRoute(this.store.route.get());let result=[...items];if(lens.filter!=="all"){if(lens.filter.startsWith("facet:")){const key=lens.filter.slice(6);result=result.filter((item)=>this.#itemFacets(item).some((facet)=>canvasFacetKey(facet)===key));}else result=result.filter((item)=>item.sourceKind===lens.filter||item.blockType===lens.filter);}if(lens.sort==="title")result.sort((a,b)=>this.#itemTitle(a).localeCompare(this.#itemTitle(b),this.i18n.locale));if(lens.sort==="type")result.sort((a,b)=>(a.blockType||a.sourceKind).localeCompare(b.blockType||b.sourceKind));if(lens.sort==="random"){const seed=Number(lens.seed)||1;result.sort((a,b)=>{const hash=(value:string)=>[...value].reduce((sum,char)=>Math.imul(sum^char.charCodeAt(0),16777619),seed);return hash(a.id)-hash(b.id);});}return result;}
  #facetGroups(items:CanvasItem[]){const counts=new Map<string,{facet:CanvasFacet;count:number}>();for(const item of items)for(const facet of this.#itemFacets(item)){const key=canvasFacetKey(facet),previous=counts.get(key);counts.set(key,{facet,count:(previous?.count??0)+1});}return[...counts.values()].filter((entry)=>entry.count>=2).sort((a,b)=>b.count-a.count||a.facet.value.localeCompare(b.facet.value)).slice(0,8);}
  #anchorDocumentId(){return this.store.canvasPlanningDocumentId([...this.#selected]);}
  #planningDocumentControl(){
    const canvas=this.store.canvasProjection.get(),documentId=this.#anchorDocumentId(),documents=this.store.projection.get().documents.filter((document)=>document.projectId===canvas.projectId);
    return documents.length?html`<label class="canvas-planning-choice"><span>${this.i18n.t("next.exact.destination","Planning document")}</span><select .value=${documentId} @change=${(event:Event)=>{const id=(event.currentTarget as HTMLSelectElement).value;if(this.store.chooseCanvasPlanningDocument(id)){this.#clearSelection();this.store.setCanvasPlanningSelection([]);this.requestUpdate();}}}><option value="" disabled>${this.i18n.t("next.exact.chooseDocument","Choose a document")}</option>${documents.map((document)=>html`<option value=${document.id} ?selected=${document.id===documentId} dir="auto">${document.title}</option>`)}</select></label>`:nothing;
  }
  #boardNextFacts(){return nextActionFacts(this.store,this.#anchorDocumentId(),this.store.canvasProjection.get().selectedCanvasId,{lifecycle:true});}
  captureCommandDeparture():CommandDeparture {return this.#captureCanvasDeparture();}
  #captureCanvasDeparture(retainClosedSources=false,retainDeskIntent=false):CommandDeparture {
    const route=this.store.route.get(),scope=this.#currentControlsScope(),canvas=this.store.canvasProjection.get();
    const projectId=canvas.projectId,boardId=canvas.selectedCanvasId,anchor=this.#anchorDocumentId();
    const selected=this.#selected,selectedIds=[...selected].sort(),selection=JSON.stringify(selectedIds);
    const planning=JSON.stringify(this.store.canvasPlanningSelection.get());
    const outputs=()=>[...this.ownerDocument.querySelectorAll("forma-output-requirements")]
      .filter(controller=>controller.isConnected&&FormaElement.hasStoreIdentity(controller,this.store));
    const panels=()=>[...this.ownerDocument.querySelectorAll<FormaAssistantPanel>("forma-assistant-panel")].filter(panel=>{
      const owner=panel.closest<FormaElement>("forma-creative-assistant");
      return panel.isConnected&&Boolean(owner?.isConnected&&FormaElement.hasStoreIdentity(owner,this.store));
    });
    const controllers=outputs().map(controller=>({controller,documentId:controller.documentId,blockId:controller.blockId,surface:controller.surface}));
    const assistants=panels().map(panel=>({panel,owner:panel.closest("forma-creative-assistant")}));
    const bindings=()=>{
      let boardEvent="";const itemEvents=new Map<string,string>();
      for(const event of this.store.eventView.get()){
        if(String(event.payload.canvas_id??"")!==boardId)continue;
        if(["CanvasCreated","CanvasRemoved","CanvasRestored"].includes(event.type))boardEvent=event.eventId;
        const id=String(event.payload.item_id??event.payload.reference_item_id??"");
        if(selectedIds.includes(id)&&["CanvasItemPlaced","CanvasReferenceCreated","CanvasItemRemoved","CanvasItemRestored"].includes(event.type))itemEvents.set(id,event.eventId);
      }
      const items=this.store.canvasProjection.get().items;
      return JSON.stringify([boardEvent,selectedIds.map(id=>{const item=items.find(value=>value.id===id);
        return [id,item?.sourceKind??null,item?.sourceId??null,itemEvents.get(id)??""];})]);
    };
    const originalBindings=bindings(),shell=this.closest<FormaElement>("forma-shell");
    const commandDialog=(dialog:HTMLDialogElement)=>Boolean(shell?.isConnected&&FormaElement.hasStoreIdentity(shell,this.store)
      &&dialog.matches(".command-dialog")&&dialog.closest("forma-shell")===shell);
    return {element:this,current:()=>{
      const current=this.store.canvasProjection.get(),currentOutputs=outputs(),currentPanels=panels();
      return this.isConnected&&this.store.route.get()===route&&scope===this.#currentControlsScope()
        &&projectId===current.projectId&&boardId===current.selectedCanvasId&&this.#selected===selected
        &&selection===JSON.stringify([...this.#selected].sort())&&anchor===this.#anchorDocumentId()
        &&planning===JSON.stringify(this.store.canvasPlanningSelection.get())&&bindings()===originalBindings
        &&selectedIds.every(id=>current.items.some(item=>item.id===id))
        &&currentOutputs.length===controllers.length&&controllers.every(({controller,documentId,blockId,surface})=>currentOutputs.includes(controller)
          &&controller.documentId===documentId&&controller.blockId===blockId&&controller.surface===surface)
        &&currentPanels.length===assistants.length&&assistants.every(({panel,owner})=>currentPanels.includes(panel)&&panel.closest("forma-creative-assistant")===owner);
    },blocked:context=>this.#boardNextBlocked(dialog=>commandDialog(dialog)||this.#memberOpen
      &&dialog.matches('[aria-labelledby="canvas-members-title"]')&&dialog.closest("forma-canvas-surface")===this
      &&navigationPresentationMatches(context,this,dialog)||this.#renderOpen&&!this.#renderPreparationPending()
      &&dialog.matches(".canvas-render-dialog")&&dialog.closest("forma-canvas-surface")===this
      &&navigationPresentationMatches(context,this,dialog)||this.#referenceSourcesPresentationCurrent(dialog)
      &&navigationPresentationMatches(context,this,dialog),true,retainClosedSources,retainDeskIntent),
      reason:()=>assistants.some(({panel})=>panel.commandDepartureBlocked)?"next.lifecycle.assistantOwnsWork":"next.lifecycle.currentWorkOpen"};
  }
  #boardNextBlocked(ownedDialog:(dialog:HTMLDialogElement)=>boolean=()=>false,departure=false,retainClosedSources=false,retainDeskIntent=false){
    const renderDialog=this.#renderOpen?this.querySelector<HTMLDialogElement>(".canvas-render-dialog"):null;
    const addDialog=this.#addOpen?this.querySelector<HTMLDialogElement>(".canvas-add-dialog"):null;
    if(this.#renderPreparationPending()||!retainDeskIntent&&this.#intent||this.#intentSubmitting||!retainClosedSources&&(this.#newBlockTitle||this.#newBlockBody)||this.#documentTitle||this.#canvasName
      ||this.#addOpen&&(!addDialog||!ownedDialog(addDialog))||this.#newCanvasOpen||this.#formalizeOpen||this.#editOpen||this.#documentOpen||this.#renderOpen&&(!renderDialog||!ownedDialog(renderDialog))
      ||this.#documentOutputsOpen||this.#arrangementOpen||this.#proposalReview.visible||this.#proposalReview.busy
      ||this.#proposalReview.dirty||!departure&&this.#proposalReview.uncertain||this.store.optimisticEvents.get().length
      ||this.#offline.count||this.#sourcePausePending||this.#sourcePauseFailed
      ||this.ownerDocument.querySelector(".output-requirement-form,.output-plan-review"))return true;
    return [...this.ownerDocument.querySelectorAll<HTMLDialogElement>("dialog[open]")].some(dialog=>!ownedDialog(dialog))
      ||[...this.ownerDocument.querySelectorAll("forma-output-requirements")]
        .some(controller=>controller.isConnected&&FormaElement.hasStoreIdentity(controller,this.store)
          &&(departure?controller.commandDepartureBlocked:controller.navigationBlocked))
      ||[...this.ownerDocument.querySelectorAll<FormaAssistantPanel>("forma-assistant-panel")].some(panel=>{
        if(!panel.isConnected)return false;if(!departure)return panel.navigationBlocked;
        const owner=panel.closest<FormaElement>("forma-creative-assistant");
        return Boolean(owner?.isConnected&&FormaElement.hasStoreIdentity(owner,this.store)&&panel.commandDepartureBlocked);
      });
  }
  /** Board ranking remains board-scoped; a destination is independently resolved before any handoff. */
  async #followBoardNextAction(action:CreativeNextAction,onCurrentWorkBlocked?:()=>void){
    const target=action.target,source=this.store.captureSourceOwnership(),authorization=this.store.captureAuthorizationScope();
    const route=this.store.route.get(),scope=this.#currentControlsScope(),boardId=this.store.canvasProjection.get().selectedCanvasId;
    const selectedIds=[...this.#selected].sort(),selection=JSON.stringify(selectedIds),signature=JSON.stringify(target);
    const selectedSources=(items:CanvasItem[])=>JSON.stringify(selectedIds.map(id=>{
      const item=items.find(value=>value.id===id);return item?[item.id,item.sourceKind,item.sourceId]:null;
    }));
    const selectedSourceIdentity=selectedSources(this.store.canvasProjection.get().items);
    const bindingRevision=(events:CreativeEvent[])=>{
      let boardEvent="";const itemEvents=new Map<string,string>();
      for(const event of events){
        const payload=event.payload;
        if(["CanvasCreated","CanvasRemoved","CanvasRestored"].includes(event.type)&&String(payload.canvas_id??"")===boardId)
          boardEvent=event.eventId;
        const itemId=String(payload.item_id??payload.reference_item_id??"");
        if(selectedIds.includes(itemId)&&["CanvasItemPlaced","CanvasReferenceCreated","CanvasItemRemoved","CanvasItemRestored"].includes(event.type))
          itemEvents.set(itemId,event.eventId);
      }
      return JSON.stringify([boardEvent,selectedIds.map(id=>[id,itemEvents.get(id)??""])]);
    };
    const originalBindings=bindingRevision(this.store.eventView.get());
    if(!source||!scope||!this.#arrangementScope()||!this.store.session.get()?.canvas.access||!this.store.routeDataReady()
      ||target.canvasId!==boardId||target.documentId!==this.#anchorDocumentId())return false;
    if(this.#boardNextBlocked()){
      this.store.toast(this.i18n.t("next.lifecycle.currentWorkOpen","Save or discard local edits, clear unsent text, or check the current request before continuing. Closing a panel may retain work; wait if the request is running."));
      onCurrentWorkBlocked?.();
      return false;
    }
    const request=++this.#deskNavigation,sourceRevision=creativeActionSourceRevision(this.#boardNextFacts());
    const boardCurrent=()=>{
      const events=this.store.eventView.get(),board=foldCanvasEvents(events,target.projectId,boardId);
      return request===this.#deskNavigation&&this.store.sourceOwnershipActive(source)&&this.store.authorizationScopeActive(authorization)
        &&this.store.session.get()?.canvas.access===true&&board.canvases.some(value=>value.id===boardId)
        &&selectedSources(board.items)===selectedSourceIdentity&&bindingRevision(events)===originalBindings;
    };
    const sameOrigin=()=>boardCurrent()&&this.isConnected&&route===this.store.route.get()
      &&scope===this.#currentControlsScope()&&boardId===this.store.canvasProjection.get().selectedCanvasId
      &&selection===JSON.stringify([...this.#selected].sort())&&target.documentId===this.#anchorDocumentId()
      &&Boolean(this.#arrangementScope())&&this.store.session.get()?.canvas.access===true
      &&this.store.sourceOwnershipActive(source)&&this.store.authorizationScopeActive(authorization);
    const recommended=()=>{const facts=this.#boardNextFacts();return JSON.stringify(action.target)===signature
      &&creativeActionSourceRevision(facts)===sourceRevision&&creativeNextTargetAvailable(target,facts)
      &&creativeNextActions(facts).some(value=>value.id===action.id&&JSON.stringify(value.target)===signature);};
    const originCurrent=()=>sameOrigin()&&recommended()&&!this.#boardNextBlocked();
    let navigationRefusal="";
    const owner:CreativeNextActionNavigationOwner={origin:this,originCurrent,navigationCurrent:boardCurrent,
      onRefusal:reason=>{navigationRefusal=reason;}};
    if(!originCurrent())return false;
    // The Document descriptor is never made by deleting canvasId from the board target.
    const documentFacts=nextActionFacts(this.store,target.documentId,null,{lifecycle:true});
    const documentScope={projectId:documentFacts.projectId,documentId:documentFacts.documentId,canvasId:null,
      authorityKey:documentFacts.authorityKey,sourceGeneration:documentFacts.sourceGeneration};
    const prepare=(selected:Extract<CreativeNextTarget,{kind:"context"|"configure"|"compare"}>)=>{
      const destination:SelectedCreativePreparationTarget=selected.kind==="compare"
        ?{...documentScope,kind:"compare",outputIds:[...selected.outputIds]}
        :selected.kind==="configure"?{...documentScope,kind:"configure",medium:selected.medium,sourceRevision:creativeActionSourceRevision(documentFacts)}
          :{...documentScope,kind:"context",sourceRevision:creativeActionSourceRevision(documentFacts)};
      return creativeNextTargetAvailable(destination,documentFacts)
        ?openSelectedCreativePreparationDestination(this.store,this.ownerDocument,destination,owner):Promise.resolve(false);
    };
    const crossSurface=()=>{
      const candidates=creativeNextActions(documentFacts).filter(candidate=>{
        const next=candidate.target;
        if(next.kind!==target.kind)return false;
        if(next.kind==="source-block"&&target.kind==="source-block"
          ||next.kind==="output-requirement"&&target.kind==="output-requirement")return next.blockId===target.blockId;
        if(next.kind==="assigned-review"&&target.kind==="assigned-review")return next.reviewId===target.reviewId
          &&next.organizationId===target.organizationId&&next.projectAccessId===target.projectAccessId
          &&next.artifactId===target.artifactId&&next.revision===target.revision&&next.contentSha256===target.contentSha256;
        if(next.kind==="canonical-output"&&target.kind==="canonical-output")return next.section===target.section&&next.refresh===target.refresh
          &&JSON.stringify(next.reference)===JSON.stringify(target.reference);
        return next.kind==="artifact-delivery"&&target.kind==="artifact-delivery"&&next.artifactId===target.artifactId
          &&next.sequence===target.sequence&&next.revision===target.revision&&next.sourceEventId===target.sourceEventId
          &&next.contentRef===target.contentRef&&next.intent===target.intent&&next.proof===target.proof;
      });
      return candidates.length===1?openCreativeNextActionDestination(this.store,this.ownerDocument,candidates[0],owner):Promise.resolve(false);
    };
    const local=async(selected:Extract<CreativeNextTarget,{kind:"job"|"output"|"artifact"}>)=>{
      const controller=this.querySelector("forma-document-artifacts");let opened=false,retired=false;
      const ownedDialog=(dialog:HTMLDialogElement)=>selected.kind==="output"
        ?dialog.matches(".canvas-output-viewer")&&this.contains(dialog)&&this.#viewingOutputId===selected.outputId
        :Boolean(controller?.isConnected&&controller.documentId===selected.documentId&&controller.contains(dialog)
          &&dialog.matches(selected.kind==="job"?".generation-input-dialog":".document-artifact-view"));
      const focus=captureOutputNavigationFocus(this.ownerDocument,{ownedRouteFocus:element=>{
        const dialog=element.closest<HTMLDialogElement>("dialog");return Boolean(sameOrigin()&&dialog&&ownedDialog(dialog));
      }});
      const unsubscribe=this.store.subscribe(()=>{if(!sameOrigin())retired=true;});
      const current=()=>!retired&&sameOrigin()&&(opened||recommended()&&focus.current()&&!this.#boardNextBlocked(ownedDialog));
      try{
        if(!current())return false;
        if(selected.kind==="job")opened=Boolean(await controller?.openJobById(selected.jobId,{current}));
        else if(selected.kind==="artifact")opened=Boolean(await controller?.openArtifactById(selected.artifactId,{expectedRevision:selected.revision,current}));
        else{
          const output=this.store.projection.get().libraryOutputs.find(value=>value.id===selected.outputId);
          if(!output)return false;this.#showCanvasOutput(output,"canvas-image-dialog",current);await this.updateComplete;
          opened=Boolean(current()&&this.querySelector<HTMLDialogElement>(".canvas-output-viewer")?.open);
        }
        return opened&&current();
      }finally{unsubscribe();focus.dispose();}
    };
    const ports:Required<CreativeNextPorts>={context:prepare,configure:prepare,compare:prepare,output:local,artifact:local,job:local,
      "source-block":crossSurface,"assigned-review":crossSurface,"artifact-delivery":crossSurface,"canonical-output":crossSurface,"output-requirement":crossSurface};
    let opened=false;
    try{opened=await followCreativeNextTarget(target,()=>this.#boardNextFacts(),ports);}catch{ /* No fallback to another target. */ }
    if(!opened&&navigationRefusal!=="current-work"&&originCurrent())this.store.toast(this.i18n.t("next.exact.unavailable","This exact action changed or is no longer available. Review the current document."));
    return opened;
  }
  #nextDocument(){const projection=this.store.projection.get(),documentId=this.#anchorDocumentId(),document=projection.documents.find((item)=>item.id===documentId),actions=creativeNextActions(this.#boardNextFacts());return html`<section class="canvas-next-document" aria-label=${this.i18n.t("next.exact.heading","Next for this document")}><div class="canvas-planning-summary"><span>${this.i18n.t("next.exact.destination","Planning document")}</span>${document?html`<b dir="auto">${document.title}</b>`:html`<p role="status">${this.i18n.t(projection.documents.length?"canvas.controls.chooseInView":"canvas.controls.emptyStart",projection.documents.length?"Choose a planning document in View, or select one document on the board.":"Add a source or create a decision to begin.")}</p>`}<p class="muted">${this.i18n.t("next.lifecycle.boardScope","Guidance uses this planning document and the current board. Other boards keep their own original work.")}</p></div>${renderNextActionCards(actions,this.i18n,(action)=>void this.#followBoardNextAction(action),{creatorHandoff:true})}</section>`;}
  async #followNextAction(action:CreativeNextAction){try{const followed=await followCreativeNextTarget(action.target,()=>nextActionFacts(this.store,this.#anchorDocumentId(),this.store.canvasProjection.get().selectedCanvasId),{
    context:(target)=>this.#go(documentPreparationRoute(target.documentId,this.store.projection.get().documents.find((document)=>document.id===target.documentId)?.title??"","context")),
    configure:(target)=>this.#go(documentPreparationRoute(target.documentId,this.store.projection.get().documents.find((document)=>document.id===target.documentId)?.title??"",target.medium)),
    output:(target)=>this.#showCanvasOutput(this.store.projection.get().libraryOutputs.find((output)=>output.id===target.outputId)!),
    artifact:(target)=>this.querySelector("forma-document-artifacts")!.openArtifactById(target.artifactId,{expectedRevision:target.revision}),
    job:(target)=>this.querySelector("forma-document-artifacts")!.openJobById(target.jobId),
    compare:(target)=>{const projection=this.store.projection.get();this.#go(`/document/${encodeURIComponent(target.documentId)}/${canvasSlug(projection.documents.find((document)=>document.id===target.documentId)?.title??"")}`);this.store.patchUi({compareOpen:true,comparisonOutputIds:target.outputIds.join("|")});},
  });if(!followed)this.store.toast(this.i18n.t("next.exact.unavailable","This exact action changed or is no longer available. Review the current document."));}catch{this.store.toast(this.i18n.t("next.exact.unavailable","This exact action changed or is no longer available. Review the current document."));}}
  #assistantTool=(event:Event)=>{const request=(event as CustomEvent<AssistantToolRequest>).detail;if(request.mode!=="plan-board")return;const session=this.store.session.get();const canvas=this.store.canvasProjection.get();const projectId=session?.projectContext?.projectId??this.store.projection.get().projectId;const permitted=!session?.projectContext||session.projectContext.permissions.includes("project.output.request");if(!session||!this.#canEditCanvas()||!permitted||request.actorUserId!==session.user.userId||request.projectId!==projectId||request.canvasId!==canvas.selectedCanvasId||request.documentId!==this.#anchorDocumentId())return;event.preventDefault();this.#intent=request.message;void this.#askIntent().then(request.resolve).catch(()=>request.resolve(false));};
  async #askIntent(){const session=this.store.session.get();if(!session||!this.#canEditCanvas()||session.projectContext&&!session.projectContext.permissions.includes("project.output.request"))return false;const originalIntent=this.#intent,intent=originalIntent.trim();const documentId=this.#anchorDocumentId();const canvasId=this.store.canvasProjection.get().selectedCanvasId;if(!intent||!documentId||!canvasId){this.store.toast(documentId?"Describe what you want to explore.":this.i18n.t("next.exact.chooseDocument","Choose a document"));return false;}if(this.#intentSubmitting)return false;this.#trackCanvasInteraction("intent_submitted",{intent_length:intent.length,selected_context_count:this.#selected.size});this.#intentSubmitting=true;this.requestUpdate();let queued=false;try{const settled=await this.#settleCanvasWrites();if(settled&&canvasId===this.store.canvasProjection.get().selectedCanvasId)queued=await this.store.structureAdaptive(intent,{documentId,sourceSurface:"canvas",projectScope:true,canvasId});return queued;}catch{return false;}finally{this.#intentSubmitting=false;const current=this.store.session.get();if(queued&&this.#intent===originalIntent&&canvasId===this.store.canvasProjection.get().selectedCanvasId&&session.user.userId===current?.user.userId&&(session.projectContext?.projectAccessId??"")===(current?.projectContext?.projectAccessId??""))this.#intent="";this.requestUpdate();}}
  #intentMatches(intent:string){const segmenter=typeof Intl.Segmenter==="function"?new Intl.Segmenter(this.i18n.locale,{granularity:"word"}):null;const tokens=segmenter?[...segmenter.segment(intent)].filter((segment)=>segment.isWordLike).map((segment)=>segment.segment.toLocaleLowerCase(this.i18n.locale)):intent.toLocaleLowerCase(this.i18n.locale).match(/[\p{L}\p{N}]+/gu)??[];const searchable=tokens.filter((token)=>/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(token)||token.length>2);const placed=new Set(this.store.canvasProjection.get().items.map((item)=>item.sourceId));return this.#sources().filter((source)=>!placed.has(source.id)).map((source)=>({source,score:searchable.filter((token)=>`${source.title} ${source.body}`.toLocaleLowerCase(this.i18n.locale).includes(token)).length})).filter((entry)=>entry.score>0).sort((a,b)=>b.score-a.score).slice(0,3).map((entry)=>entry.source);}
  async #useSuggestion(executionId:string,proposalIds:string[]){if(!this.#canEditCanvas())return;const active=this.ownerDocument?.activeElement;if(active instanceof HTMLElement)this.#proposalOpener=active;const canvas=this.store.canvasProjection.get(),point=this.#insertionPoint((canvas.items.length%5)*22);this.#proposalReview.open(executionId,proposalIds,{x:point.x,y:point.y,w:300,h:210});}
  #searchSources(value:string){this.#sourceQuery=value;window.clearTimeout(this.#searchInteractionTimer);if(value.trim()){const query=value.trim().toLocaleLowerCase();const resultCount=this.#sources().filter((source)=>(source.kind==="block"||source.kind==="sketch")&&`${source.blockType} ${source.title} ${source.body}`.toLocaleLowerCase().includes(query)).length;this.#searchInteractionTimer=window.setTimeout(()=>this.#trackCanvasInteraction("source_searched",{query_length:value.trim().length,result_count:resultCount}),500);}this.requestUpdate();}
  #batchSelectionControl(){const active=this.#tool==="marquee";return html`<aside class=${`canvas-batch-select${active?" active":""}`} aria-label="Batch selection tool"><button type="button" aria-pressed=${active} title="Batch select ideas (B)" @click=${()=>this.#toggleBatchSelection()}><span aria-hidden="true">${icon("marquee")}</span><b>${active?this.i18n.system("Selecting ideas"):this.i18n.system("Batch select")}</b><kbd>B</kbd></button>${active?html`<small>${this.#canEditCanvas()?this.i18n.system("Drag from empty canvas to select an area. Cards remain clickable and draggable. Hold Shift to add; press Escape when done."):this.i18n.t("canvas.readOnlySelectionHelp","Drag across an empty area to select cards. Hold Shift to add; press Escape when done.")} ${this.i18n.t("canvas.touchSelectionHint","Tap cards to add or remove them.")}</small>`:nothing}</aside>`;}

  #listing(){const canvas=this.store.canvasProjection.get();const p=this.store.projection.get();const editable=this.#canEditCanvas();return html`<section class="canvas-page canvas-home page-pad"><header class="page-header page-header--hero page-header--canvas"><div class="page-header-copy"><h1 dir="auto">${this.i18n.t("canvas.projectBoardsHeading","{name} boards",{name:p.projectName})}</h1><p>Open spatial rooms for collecting project documents, reusable context, references, sketches, and generations—without reducing them to a single document.</p></div>${editable?html`<div class="page-header-actions"><forma-ui-button label=${this.i18n.t("canvas.newBoard","New board")} icon-name="plus" variant="primary" @forma-press=${()=>{this.#newCanvasOpen=true;this.requestUpdate();}}></forma-ui-button></div>`:nothing}</header><div class="canvas-home-grid">${canvas.canvases.map((item)=>{const itemCount=foldCanvasEvents(this.store.eventView.get(),item.projectId,item.id).items.length;return html`<article><a href=${canvasRoute(item)} @click=${(event:MouseEvent)=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;event.preventDefault();this.#leave(canvasRoute(item));}}><span>${item.name.slice(0,1).toUpperCase()}</span><div><h2 dir="auto">${item.name}</h2><p>${itemCount} idea${itemCount===1?"":"s"} on the board</p><small dir="auto">${p.projectName}</small></div>${icon("arrow")}</a></article>`;})}${!canvas.canvases.length?editable?html`<forma-ui-empty-state heading="Make space for the project" detail="Start with an empty board, then pull in only the ideas, studies, and generations that matter to the next decision." action="Create the first board" @forma-action=${()=>{this.#newCanvasOpen=true;this.requestUpdate();}}></forma-ui-empty-state>`:html`<forma-ui-empty-state heading=${this.i18n.t("canvas.noSharedBoards","No shared boards yet")} detail=${this.i18n.t("canvas.readOnlyBoards","A project editor can create the first board for this shared project.")}></forma-ui-empty-state>`:nothing}</div>${editable&&this.#newCanvasOpen?this.#newCanvasDialog():nothing}</section>`;}
  #newCanvasDialog(){return html`<dialog class="modal" open closedby="any" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget){this.#newCanvasOpen=false;this.requestUpdate();}}}><form class="modal-card canvas-compact-dialog" @submit=${(event:SubmitEvent)=>{event.preventDefault();void this.#createCanvas();}}><button type="button" class="icon-button modal-close" @click=${()=>{this.#newCanvasOpen=false;this.requestUpdate();}} aria-label="Close">${icon("close")}</button><h2>Name this project board</h2><p>It starts empty and can draw from every document and reusable asset in ${this.store.projection.get().projectName}.</p><label>Board name<input autofocus .value=${this.#canvasName} @input=${(event:InputEvent)=>{this.#canvasName=(event.target as HTMLInputElement).value;}}></label><button type="submit" class="button primary">Create board</button></form></dialog>`;}
  #canArrangeOutcome(){const session=this.store.session.get(),permissions=session?.projectContext?.permissions??session?.capabilities??[];return Boolean(this.#arrangementScope()&&this.store.asOf.get()===Number.POSITIVE_INFINITY&&permissions.includes("project.author")&&this.#canEditCanvas());}
  #arrangementScope(){
    const authorization=this.store.captureAuthorizationScope(),session=this.store.session.get(),canvas=this.store.canvasProjection.get();
    const permissions=session?.projectContext?.permissions??session?.capabilities??[];
    return authorization&&session&&canvas.projectId&&canvas.selectedCanvasId&&permissions.includes("project.read")&&permissions.includes("project.canvas.use")
      &&(!session.projectContext||session.projectContext.projectId===canvas.projectId)
      ?{authorityKey:authorization.key,actorId:session.user.userId,projectId:canvas.projectId,canvasId:canvas.selectedCanvasId}:null;
  }
  #arrangementStamp(){return JSON.stringify([this.#arrangementScope(),[...this.#selected].sort(),this.store.events.get().map((event)=>event.eventId),
    this.store.optimisticEvents.get().length,this.#offline.count,navigator.onLine,this.store.asOf.get(),this.#canEditCanvas(),
    this.#arrangementOpening,this.store.route.get()]);}

  #deskNavigation = 0;
  async #deskRefreshOutputs(){
    const current=this.#deskCurrent(),route=this.store.route.get(),scope=this.#currentControlsScope(),client=this.store.outputRequirements;
    if(!client||!current.facts.canRead)return false;
    this.#disposeControlsFocus();
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    this.#controlsFocus=focus;
    try{
      await client.ensure(current.facts.documentId,{force:true});
      if(!this.isConnected||route!==this.store.route.get()||scope!==this.#currentControlsScope())return false;
      if(this.#controlsFocus===focus)await this.#focusOutcomeDesk("canvas-outcome-desk-selected",scope,undefined,focus);
      return true;
    }finally{
      focus.dispose();if(this.#controlsFocus===focus)this.#controlsFocus=undefined;
    }
  }
  #deskOutputScope(){
    const current=this.#deskCurrent(),snapshot=outcomeDeskOutputSnapshot(current),copy=outcomeDeskIntegrationCopy(this.i18n.locale),summary=snapshot?.summary;
    const values=summary?{done:summary.fulfilled_required_obligations,total:summary.required_obligations,
      optionalDone:summary.fulfilled_selected_optional_obligations,optionalTotal:summary.selected_optional_obligations,
      unresolved:summary.unresolved_required_groups+summary.unresolved_selected_optional_groups}:null;
    const known=Boolean(snapshot&&outputSourceReadiness(snapshot).allowed&&summary?.scope_known&&values
      &&Object.values(values).every(value=>Number.isSafeInteger(value)&&value>=0));
    const route=this.store.route.get(),scope=this.#currentControlsScope();
    return html`<section class="outcome-desk-scope" aria-live="polite"><p>${known?copy.scopeProgress.replace(/\{(\w+)\}/g,(_match,key)=>this.i18n.number(values![key as keyof typeof values])):copy.unknownOutputs}</p>
      <p>${copy.deliveryHint}</p><button type="button" class="button secondary" ?disabled=${!current.facts.canRead||!this.store.outputRequirements}
        @click=${()=>{if(this.isConnected&&route===this.store.route.get()&&scope===this.#currentControlsScope())void this.#deskRefreshOutputs();}}>${this.i18n.t("output.delivery.refresh","Refresh outputs")}</button></section>`;
  }
  async #deskOpenOutput(target:Extract<OutcomeDeskTarget,{kind:"canonical-output"}>){
    const reference=target.reference,authorization=this.store.captureAuthorizationScope(),sourceRoute=this.store.route.get(),
      sourceScope=this.#currentControlsScope(),selection=JSON.stringify([...this.#selected].sort()),request=++this.#deskNavigation;
    const originalCurrent=()=>request===this.#deskNavigation&&this.isConnected&&sourceRoute===this.store.route.get()
      &&sourceScope===this.#currentControlsScope()&&selection===JSON.stringify([...this.#selected].sort())&&!this.#arrangementOpen
      &&this.store.authorizationScopeActive(authorization)&&!document.querySelector("dialog[open]")
      &&outputNavigationMatches(reference,outcomeDeskOutputSnapshot(this.#deskCurrent()),this.store.captureAuthorizationScope()?.key??"");
    return await openOutputReferenceDestination(this.store,this.ownerDocument,target,{
      authorization,originCurrent:originalCurrent,navigationCurrent:()=>request===this.#deskNavigation,
    });
  }

  #deskCurrent(){
    const documentId=this.#anchorDocumentId(),canvasId=this.store.canvasProjection.get().selectedCanvasId;
    const authorization=this.store.captureAuthorizationScope(),session=this.store.session.get(),client=this.store.outputRequirements;
    return{facts:nextActionFacts(this.store,documentId,canvasId,{lifecycle:true}),document:this.store.projection.get().documents.find((document)=>document.id===documentId)??null,
      ...(authorization&&session&&client?{output:{authorizationScopeKey:authorization.key,actorUserId:session.user.userId,
        projectAccessId:session.projectContext?.projectAccessId??null,resource:client.resource(documentId),
        jobs:this.store.documentJobs.get().filter(job=>job.documentId===documentId)}}:{})};
  }
  #deskPorts(){return{displayLocale:this.i18n,localize:(id:string,fallback:string)=>this.i18n.t(id,fallback),
    delivery:(artifact:DocumentArtifact)=>artifactDeliveryFor(this.store,artifact,undefined,this.store.canvasProjection.get().selectedCanvasId)};}
  #focusOutcomeDesk(focusId:string,scope=this.#currentControlsScope(),opener?:HTMLElement,focus?:OutputNavigationFocusLease){
    const version=++this.#deskFocusVersion,route=this.store.route.get(),opening=this.#arrangementOpening;
    return this.updateComplete.then(()=>{
      if(!this.isConnected||!scope||scope!==this.#currentControlsScope()||version!==this.#deskFocusVersion
        ||route!==this.store.route.get()||opening!==this.#arrangementOpening||this.#arrangementOpen||this.querySelector("dialog[open]")
        ||focus&&!focus.current())return;
      if(opener?.isConnected)opener.focus({preventScroll:true});else restoreOutcomeDeskFocus(this,focusId==="canvas-view-toggle"?this.#viewTriggerId:focusId);
    });
  }
  #deskNavigate(route:string){return this.#navigateCanvasPresentation(route);}
  async #deskFollow(action:OutcomeDeskAction<OutcomeDeskTarget>){
    const route=this.store.route.get(),scope=this.#currentControlsScope();
    let currentWorkBlocked=false;
    const followed=await followOutcomeDeskAction(action,()=>this.#deskCurrent(),{
      available:(candidate,current)=>outcomeDeskHostActionAvailable(candidate,current,this.#deskPorts()),
      open:(candidate)=>candidate.target.kind==="canonical-output"?candidate.target.refresh?this.#deskRefreshOutputs():this.#deskOpenOutput(candidate.target)
        :candidate.target.kind==="next"?candidate.subject.kind==="document"&&candidate.target.action.target.sourceGeneration!==undefined
          ?this.#followBoardNextAction(candidate.target.action,()=>{currentWorkBlocked=true;}):this.#followNextAction(candidate.target.action)
        :this.#openArtifactDelivery(this.#deskCurrent().facts.artifacts.find((artifact)=>candidate.target.kind==="delivery"&&artifact.id===candidate.target.artifactId)!),
    });
    // The delegated current-work refusal already explains this exact attempt.
    if(!followed&&!currentWorkBlocked&&this.isConnected&&route===this.store.route.get()&&scope===this.#currentControlsScope())
      this.store.toast(this.i18n.t("next.exact.unavailable","This exact action changed or is no longer available. Review the current document."));
    return followed;
  }
  #deskTitle(row:OutcomeDeskRow){
    const copy=outcomeDeskIntegrationCopy(this.i18n.locale),object=row.object;
    if(row.retained)return copy.operation+" · "+row.reference.id;
    if(object.kind==="requirement")return object.value.spec?.label||copy.requirement;
    if(object.kind==="target")return object.value.label;
    if(object.kind==="result"){const matches=outcomeDeskOutputSnapshot(this.#deskCurrent())?.assets.filter(asset=>asset.id===object.value.assetId)??[];return matches.length===1?matches[0].name:copy.result;}
    if(object.kind==="operation")return object.value.targetLabel||copy.operation+" · "+object.value.id;
    return object.kind==="job"?copy.job+" · "+object.value.jobId
      :object.kind==="output"?object.value.title||copy.output:object.value.title;
  }
  #deskObject(row:OutcomeDeskRow){
    const copy=outcomeDeskIntegrationCopy(this.i18n.locale),object=row.object;
    if(row.navigation){
      const snapshot=outcomeDeskOutputSnapshot(this.#deskCurrent());
      if(row.retained||!snapshot)return html`<p role="status">${copy.retainedOperation}</p><code dir="ltr">${row.reference.id}</code>`;
      if(object.kind==="requirement")return html`<p>${copy.canonicalHint}</p><p dir="auto">${object.value.content}</p>`;
      if(object.kind==="target"){
        const state=snapshot.targetStates.find(value=>value.target_id===object.value.id);
        const label=(category:OutputDeliveryLabelCategory,value:unknown)=>{const key=outputDeliveryLabelKey(category,value);return this.i18n.t("output.delivery."+key,FORMA_OUTPUT_DELIVERY_MESSAGES.en[("output.delivery."+key) as keyof typeof FORMA_OUTPUT_DELIVERY_MESSAGES.en]);};
        return html`<p>${copy.canonicalHint}</p>${object.value.required?html`<p>${copy.requiredOwed}</p>`:nothing}
          <p>${state?this.i18n.t("output.delivery.targetDimensions","Execution: {execution} · Checks: {checks} · Review: {review} · Freshness: {freshness}",{
            execution:label("execution",state.execution),checks:label("checks",state.checks),review:label("review",state.review),freshness:label("freshness",state.freshness)}):copy.unknownOutputs}</p>`;
      }
      return html`<p>${copy.canonicalHint}</p><code dir="ltr">${row.reference.id}</code><p>${copy.deliveryHint}</p>`;
    }
    if(object.kind==="document")return html`<p>${copy.sourceHint}</p>`;
    if(object.kind==="output")return html`<forma-output-visual .output=${object.value} .compact=${true}></forma-output-visual><p>${copy.existingHint}</p>`;
    if(object.kind==="job")return html`<p>${localizedDocumentJobProgress(object.value,this.i18n)}</p><p>${copy.existingHint}</p>`;
    if(object.kind!=="artifact")return nothing;
    const artifact=object.value,delivery=artifactDeliveryFor(this.store,artifact,undefined,this.store.canvasProjection.get().selectedCanvasId);
    return html`<div class="outcome-desk-artifact-preview">${this.#artifactPreview(artifact)}</div>
      <p>${this.i18n.t("artifact.delivery.revision","Output revision {revision}",{revision:this.i18n.number(delivery.revision)})}</p>
      <p>${delivery.review.status==="approved"&&!delivery.approved?this.i18n.t("artifact.delivery.unverifiedApproval","Recorded approval does not match the current output."):this.i18n.system(delivery.review.label)}</p><p>${copy.deliveryHint}</p>`;
  }
  #outcomeDesk(){
    const route=this.store.route.get(),state=outcomeDeskRouteState(route),current=this.#deskCurrent(),ports=this.#deskPorts();
    const copy=outcomeDeskIntegrationCopy(this.i18n.locale),scope=this.#currentControlsScope();
    const active=()=>this.isConnected&&scope===this.#currentControlsScope()&&route===this.store.route.get()&&!this.#arrangementOpen;
    return renderOutcomeDesk({instanceId:"canvas-outcome-desk",canvasReturnFocusId:"canvas-view-toggle",locale:outcomeDeskLocale(this.i18n.locale),
      route,current,selectedKey:state.selectedKey,recipeId:state.recipeId,candidates:outcomeDeskHostActions(current,state.selectedKey,ports),
      dismissedKeys:[...this.#deskDismissed]},{
      available:(action,facts)=>outcomeDeskHostActionAvailable(action,facts,this.#deskPorts()),open:(action)=>void this.#deskFollow(action),
      navigate:(path)=>{if(active())this.#deskNavigate(path);},dismiss:(key,focus)=>{if(!active())return;this.#deskDismissed.add(key);this.requestUpdate();this.#focusOutcomeDesk(focus);},
      restoreSuggestions:(focus)=>{if(!active())return;this.#deskDismissed.clear();this.requestUpdate();this.#focusOutcomeDesk(focus);},
      renderScope:()=>html`${this.#deskOutputScope()}${state.selectedKey===("document:"+current.facts.documentId)
        ?html`<p class="muted">${this.i18n.t("next.lifecycle.boardScope","Guidance uses this planning document and the current board. Other boards keep their own original work.")}</p>`:nothing}`,
      title:(row)=>this.#deskTitle(row),accessibleName:(row)=>copy[row.object.kind]+" · "+this.#deskTitle(row)+" · "+row.reference.id+(row.reference.revision?" · "+row.reference.revision:""),
      renderObject:(row)=>this.#deskObject(row),
      renderOtherWays:(row)=>{const formats=outcomeDeskPreparationActions(this.#deskCurrent(),row.key,this.#deskPorts());
        return formats.length?html`<section class="outcome-desk-formats" aria-label=${copy.prepare}><p>${copy.prepareHint}</p><p>${copy.formatLimits}</p>
          ${formats.map((action)=>html`<button type="button" class="button secondary" @click=${()=>void this.#deskFollow(action)}>${action.label}</button>`)}
        </section>`:nothing;},
    });
  }
  #captureArrangementRecovery(invalidated:()=>void,sourceWitness=false){
    const source=this.store.captureSourceOwnership(),opening=this.#arrangementOpening,route=this.store.route.get();
    const scope=this.#currentControlsScope(),stamp=this.#arrangementStamp();
    // Historical presentation variants are validated once in this one witness
    // closure; later Output-cache loading is not a new source/authority denial.
    const routes=new Set(sourceWitness?[route,withOutcomeDeskPosture(route,"canvas"),withOutcomeDeskPosture(route,"outcomes")]:[route]);
    const routeCurrent=()=>{
      const next=this.store.route.get();
      if(routes.has(next))return true;
      if(!sourceWitness)return false;
      const key=outcomeDeskRouteState(next).selectedKey;
      if(!key)return false;
      // Preserve the exact existing transforms, including query ordering from
      // the currently validated posture; do not normalize arbitrary parameters.
      for(const base of routes){
        const selected=withOutcomeDeskSelection(base,key),spatial=withOutcomeDeskPosture(selected,"canvas");
        if(next!==selected&&next!==spatial)continue;
        if(!projectOutcomeDesk(this.#deskCurrent(),key).selected)return false;
        routes.add(selected);routes.add(spatial);return true;
      }
      return false;
    };
    let live=true,unsubscribe:()=>void=()=>{};
    const dispose=()=>{if(!live)return;live=false;unsubscribe();};
    const current=()=>{
      if(live&&(!source||!this.isConnected||!scope||scope!==this.#currentControlsScope()||!this.store.sourceOwnershipActive(source)
        ||!sourceWitness&&(!this.#arrangementOpen||opening!==this.#arrangementOpening||stamp!==this.#arrangementStamp())
        ||!routeCurrent()))dispose();
      return live;
    };
    if(!current())return null;
    unsubscribe=this.store.subscribe(()=>{if(!current())invalidated();});
    return{current,dispose};
  }
  #openArrangement(){
    this.#arrangement.retireRecovery();
    const active=document.activeElement instanceof HTMLElement?document.activeElement:undefined;
    this.#arrangementReturnFocus=active?.closest(".canvas-view-menu")?.querySelector<HTMLElement>(".ui-popover-trigger")??active;
    this.#arrangementOpening++;this.#deskFocusVersion++;this.#arrangementOpeningScope=this.#currentControlsScope();
    this.#arrangementOpen=true;const menu=this.querySelector<FormaUiPopover>(".canvas-view-menu");menu?.close();
    this.requestUpdate();
  }
  #closeArrangement(restoreFocus=true){
    this.#arrangement.retireRecovery();
    const scope=this.#arrangementOpeningScope,opener=this.#arrangementReturnFocus;
    this.#arrangementOpening++;this.#deskFocusVersion++;this.#arrangementOpen=false;
    this.querySelector<HTMLDialogElement>(".canvas-outcome-arrangement-dialog")?.close();this.requestUpdate();
    if(restoreFocus)this.#focusOutcomeDesk("canvas-view-toggle",scope,opener);
  }
  #arrangementCloseHandler(){
    const opening=this.#arrangementOpening;
    return(event:Event)=>{
      const dialog=event.currentTarget as HTMLDialogElement|null;
      if(this.#arrangementOpen&&opening===this.#arrangementOpening&&dialog&&!dialog.open
        &&dialog===this.querySelector(".canvas-outcome-arrangement-dialog"))this.#closeArrangement();
    };
  }
  async #previewArrangement(){
    const refused=this.#arrangement.refusedPreparation;
    const recipe=refused?.recipeId??outcomeDeskRouteState(this.store.route.get()).recipeId,name=refused?.name??this.#arrangementName,scope=this.#currentControlsScope(),selection=JSON.stringify([...this.#selected].sort());
    const opening=this.#arrangementOpening,route=this.store.route.get();
    if(!recipe||!await this.#settleCanvasWrites()||!this.isConnected||!this.#arrangementOpen||opening!==this.#arrangementOpening
      ||route!==this.store.route.get()||scope!==this.#currentControlsScope()||selection!==JSON.stringify([...this.#selected].sort())
      ||(refused?this.#arrangement.refusedPreparation!==refused:name!==this.#arrangementName
        ||recipe!==outcomeDeskRouteState(this.store.route.get()).recipeId))return false;
    return refused?this.#arrangement.reviewRefusedPreparation(refused):this.#arrangement.start({recipeId:recipe,name});
  }
  async #retrieveArrangement(){
    const scope=this.#arrangementScope(),operationId=outcomeArrangementOperationFromRoute(this.store.route.get());
    if(!scope||!operationId)return false;
    return this.#arrangement.retrieve({projectId:scope.projectId,canvasId:scope.canvasId,operationId});
  }
  #selectArrangementReceipt(){
    const preview=this.#arrangement.state.preview,scope=this.#arrangementScope();
    if(!preview||!scope||preview.canvasId!==scope.canvasId||preview.projectId!==scope.projectId)return;
    const ids=outcomeArrangementSelectionIds(preview.selectedItemIds);
    if(!ids||!ids.every((id)=>this.store.canvasProjection.get().items.some((item)=>item.id===id&&!item.removed&&item.visible)))return;
    this.#selected=new Set(ids);this.requestUpdate();void this.#arrangement.revalidate();
  }
  async #reviewArrangementUndo(operationId:string){
    const scope=this.#arrangementScope(),state=this.#arrangement.state;
    if(!scope||!this.#canArrangeOutcome())return false;
    if(state.identity&&!["applied","dismissed","not-applied"].includes(state.status)){this.#openArrangement();return false;}
    const originals=this.store.events.get().filter((event)=>event.type==="CanvasArrangementCreated"&&isProtectedOutcomeArrangementEvent(event,scope.actorId)
      &&event.payload.history_action_id===operationId&&event.payload.project_id===scope.projectId&&event.payload.canvas_id===scope.canvasId);
    const original=originals.length===1?originals[0]:null,recipe=outcomeRecipe(original?.payload.recipe_id);
    const ids=original&&Array.isArray(original.payload.item_ids)?outcomeArrangementSelectionIds(original.payload.item_ids as string[]):null;
    if(!original||!recipe||!ids)return false;
    this.#selected=new Set(ids);this.#openArrangement();
    const opening=this.#arrangementOpening,route=this.store.route.get(),stamp=this.#arrangementStamp(),originalProof=JSON.stringify(original);
    if(!await this.#settleCanvasWrites()||!this.isConnected||!this.#arrangementOpen||opening!==this.#arrangementOpening
      ||route!==this.store.route.get()||stamp!==this.#arrangementStamp()||!this.#canArrangeOutcome()
      ||!this.store.events.get().some((event)=>event.eventId===original.eventId&&JSON.stringify(event)===originalProof))return false;
    return this.#arrangement.start({recipeId:recipe.id,name:outcomeDeskIntegrationCopy(this.i18n.locale).undoName,undoOperationId:operationId});
  }
  async #dismissArrangement(){
    const opening=this.#arrangementOpening,scope=this.#arrangementOpeningScope,route=this.store.route.get();
    if(this.#arrangement.state.submitted||!this.#arrangement.state.preview){this.#closeArrangement();return;}
    if(await this.#arrangement.dismiss()&&this.#arrangementOpen&&opening===this.#arrangementOpening
      &&scope===this.#currentControlsScope()&&route===this.store.route.get())this.#closeArrangement();
  }
  #arrangementDialog(){
    const state=this.#arrangement.state,disposition=this.#arrangement.disposition,refused=this.#arrangement.refusedPreparation,copy=outcomeDeskIntegrationCopy(this.i18n.locale),sharedCopy=outcomeDeskCopy(this.i18n.locale);
    const recipe=outcomeDeskRouteState(this.store.route.get()).recipeId,scope=this.#arrangementScope(),ids=outcomeArrangementSelectionIds([...this.#selected]);
    const retainedOperation=outcomeArrangementOperationFromRoute(this.store.route.get());
    const pending=Boolean(retainedOperation&&!state.identity||state.identity&&!["applied","dismissed","not-applied"].includes(state.status));
    const pendingName=this.#arrangement.pendingLocalName;
    const localName=pending&&!refused&&pendingName===this.#arrangementName&&this.#controlsScope===this.#currentControlsScope()?pendingName:null;
    const notDispatched=Boolean(refused&&this.#arrangement.preparationNotDispatched);
    const status=notDispatched?copy.preparationNotDispatched:refused?(refused.undoOperationId?copy.refusedUndoPreparation:copy.refusedPreparation):disposition?copy.dispositionHint:state.status==="not-applied"?copy.notApplied:state.status==="idle"?(retainedOperation?copy.uncertain:""):copy[state.status];
    const opening=this.#arrangementOpening,openingScope=this.#arrangementOpeningScope;
    const owned=()=>this.isConnected&&this.#arrangementOpen&&opening===this.#arrangementOpening&&openingScope===this.#currentControlsScope();
    const close=()=>{if(this.#arrangementOpen&&opening===this.#arrangementOpening)this.#closeArrangement();};
    return html`<dialog class="modal canvas-outcome-arrangement-dialog" open closedby="any" aria-labelledby="canvas-arrangement-heading"
      @cancel=${(event:Event)=>{event.preventDefault();close();}} @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)close();}}
      @close=${this.#arrangementCloseHandler()}>
      <section class="modal-card" lang=${this.i18n.locale} dir=${this.i18n.locale==="ar"?"rtl":"ltr"}>
        <h2 id="canvas-arrangement-heading" tabindex="-1">${copy.arrange}</h2>
        <p>${copy.rights}</p><p>${copy.board}: <bdi>${scope?.canvasId??""}</bdi></p>
        ${state.identity?html`<p>${copy.operation}: <bdi>${state.identity.operationId}</bdi></p>`:nothing}
        ${localName?html`<p data-arrangement-local-name>${copy.name}: <bdi>${localName}</bdi></p>`:nothing}
        ${status?html`<p role="status">${status}</p>`:nothing}
        ${disposition?html`<button type="button" class="button secondary" data-arrangement-disposition=${disposition.operationId}
          @click=${(event:MouseEvent)=>{const button=event.currentTarget as HTMLElement|null;
            if(owned()&&button?.isConnected&&button===this.querySelector("[data-arrangement-disposition]")
              &&this.#arrangement.disposition===disposition)void this.#arrangement.dismiss(disposition);}}>${copy.requestDisposition}</button>`:nothing}
        ${state.issue&&!(notDispatched&&state.issue==="changed")&&!(pending&&state.issue==="expired")&&(!state.preview||state.status!=="review")?html`<p role="status">${sharedCopy.issues[state.issue]}</p>`:nothing}
        ${state.preview&&state.status==="review"?html`<p>${sharedCopy.recipesById[state.preview.recipeId]?.title??sharedCopy.recipes}</p>
          <button type="button" class="button secondary" ?disabled=${state.busy||state.submitted} @click=${()=>{if(owned())this.#selectArrangementReceipt();}}>${copy.selectReceipt}</button>
          ${renderOutcomeArrangementReview(state.preview,{instanceId:"canvas-arrangement-review",locale:outcomeDeskLocale(this.i18n.locale),issue:state.issue,
            busy:state.busy,submitted:state.submitted,retrieve:()=>{if(owned())void this.#retrieveArrangement();},
            titleForCard:(id)=>{const item=this.store.canvasProjection.get().items.find((candidate)=>candidate.id===id);return(item?this.#itemTitle(item)+" · ":"")+id;},
            confirm:(_preview,confirmation)=>{if(owned())void this.#arrangement.apply(confirmation);},cancel:()=>{if(owned())void this.#dismissArrangement();}})}`:nothing}
        ${refused?.undoOperationId?html`<p>${copy.undo}: <bdi>${refused.undoOperationId}</bdi></p>
          <p>${copy.name}: <bdi>${refused.name}</bdi></p><p>${copy.selection}: <bdi>${this.i18n.number(refused.selectedItemIds.length)}</bdi>.</p>
          <button type="button" class="button primary" data-arrangement-refused-undo=${refused.operationId}
            ?disabled=${state.busy||!scope||!this.#canArrangeOutcome()||!navigator.onLine||!ids||JSON.stringify(ids)!==JSON.stringify(refused.selectedItemIds)}
            @click=${()=>{if(owned()&&this.#arrangement.refusedPreparation===refused)void this.#previewArrangement();}}>${copy.undo}</button>`:nothing}
        ${!pending||refused&&!refused.undoOperationId?html`<form class="canvas-arrangement-form" @submit=${(event:SubmitEvent)=>{event.preventDefault();if(owned()&&(!refused||this.#arrangement.refusedPreparation===refused))void this.#previewArrangement();}}>
          <label>${sharedCopy.recipes}<select .value=${refused?.recipeId??recipe??""} ?disabled=${Boolean(refused)} @change=${(event:Event)=>{if(!owned()||refused)return;const selected=outcomeRecipe((event.target as HTMLSelectElement).value);this.#go(withOutcomeRecipe(this.store.route.get(),selected?.id??null));this.requestUpdate();}}>
            <option value="">${sharedCopy.noRecipe}</option>${OUTCOME_RECIPES.map((value)=>html`<option value=${value.id}>${sharedCopy.recipesById[value.id].title}</option>`)}
          </select></label>
          <label>${copy.name}<input dir="auto" .value=${refused?.name??this.#arrangementName} ?readonly=${Boolean(refused)} @input=${(event:InputEvent)=>{if(!owned()||refused)return;this.#arrangementName=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label>
          <p>${recipe?sharedCopy.recipeHint:copy.recipeRequired}</p><p>${copy.selection}: <bdi>${this.i18n.number(ids?.length??0)}</bdi>. ${copy.selectionRequired}</p>
          <button type="submit" class="button primary" ?disabled=${state.busy||!scope||!this.#canArrangeOutcome()||!(refused?.recipeId??recipe)||!ids||!(refused?.name??this.#arrangementName).trim()||Array.from((refused?.name??this.#arrangementName).trim()).length>80||!navigator.onLine||Boolean(refused&&JSON.stringify(ids)!==JSON.stringify(refused.selectedItemIds))}>${copy.preview}</button>
        </form>`:nothing}
        ${state.status==="applied"&&state.identity?html`<button type="button" class="button secondary" ?disabled=${state.busy||!this.#canArrangeOutcome()} @click=${()=>{if(owned())void this.#reviewArrangementUndo(state.identity!.operationId);}}>${copy.undo}</button>`:nothing}
        ${retainedOperation&&(!state.preview||state.status!=="review")?html`<button type="button" class="button secondary" ?disabled=${state.busy} @click=${()=>{if(owned())void this.#retrieveArrangement();}}>${sharedCopy.retrieve}</button>`:nothing}
        ${!state.preview||state.status!=="review"?html`<button type="button" class="button secondary" @click=${close}>${copy.close}</button>`:nothing}
      </section>
    </dialog>`;
  }
  #workspace(){const canvas=this.store.canvasProjection.get();const project=this.store.projection.get();const selectedCanvas=canvas.canvases.find((item)=>item.id===canvas.selectedCanvasId);if(!selectedCanvas)return this.#listing();const editable=this.#canEditCanvas();const outcomes=outcomeDeskRouteState(this.store.route.get()).posture==="outcomes";const focused=canvasFocusFromRoute(this.store.route.get());const view=canvasViewFromRoute(this.store.route.get());const items=this.#orderedItems(canvas.items);const nearbyItems=view==="spatial"?this.#nearbyItems(items):items;const facets=this.#facetGroups(canvas.items);const filed=canvas.items.some((item)=>Boolean(project.membership[item.sourceId]));const enoughToOrganize=canvas.items.length>=4;const selectedItems=canvas.items.filter((item)=>this.#selected.has(item.id));const textEditable=selectedItems.length===1&&["block","reference","sketch"].includes(selectedItems[0].sourceKind);const comparable=selectedItems.filter(mediaKind).length>=2;const trackedDocumentIds=new Set(canvas.items.filter((item)=>item.sourceKind==="document").map((item)=>item.sourceId));const unplacedOutputs=project.libraryOutputs.filter((output)=>output.canvasId===canvas.selectedCanvasId&&!trackedDocumentIds.has(output.documentId)&&!this.store.events.get().some((event)=>event.type==="CanvasItemPlaced"&&event.payload.source_id===output.id));const inputOutput=project.libraryOutputs.find((output)=>output.id===this.#inputOutputId),inputArtifact=project.libraryArtifacts.find((artifact)=>artifact.id===this.#inputArtifactId),inputFailure=this.store.documentJobs.get().find((job)=>job.jobId===this.#inputFailureJobId);const gridSize=24*this.#zoom,gridX=(-this.#cameraX*this.#zoom)%gridSize,gridY=(-this.#cameraY*this.#zoom)%gridSize;return html`<section class="canvas-workspace" data-empty=${String(canvas.items.length===0)} aria-label=${selectedCanvas.name}>
    <header class="canvas-commandbar"><div class="canvas-board-identity"><a href="/canvas" @click=${(event:MouseEvent)=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;event.preventDefault();this.#leave("/canvas");}} aria-label=${this.i18n.t("canvas.backToProjectBoards","Back to project boards")}><span class="ui-directional-icon">${icon("back")}</span></a><div><small dir="auto">${project.projectName}</small><h1 dir="auto">${selectedCanvas.name}</h1></div><span class=${`canvas-sync-status${this.#offline.count?" pending":""}`} role="status" aria-live="polite">${this.#syncStatus()}</span></div><div class="canvas-command-actions">${editable?html`${canvas.items.length?html`<div class="canvas-history-actions" role="group" aria-label="Board history"><button class="icon-button" ?disabled=${!this.store.canUndo()} aria-label="Undo board action" title=${this.store.canUndo()?this.i18n.system("Undo the last board action"):this.i18n.system("No board action to undo")} @click=${()=>this.#changeHistory("undo")}>${icon("undo")}</button><button class="icon-button" ?disabled=${!this.store.canRedo()} aria-label="Redo board action" title=${this.store.canRedo()?this.i18n.system("Redo the last undone board action"):this.i18n.system("No board action to redo")} @click=${()=>this.#changeHistory("redo")}>${icon("redo")}</button></div>`:nothing}<button class="button primary compact canvas-sources-toggle" @click=${()=>this.#openAdd()} aria-haspopup="dialog">${icon("plus")} ${this.i18n.t("canvas.controls.sources","Sources")}</button>`:nothing}<forma-ui-popover class="canvas-view-menu" .label=${this.i18n.system("View")} .triggerId=${this.#viewTriggerId} .content=${html`<div class="canvas-view-actions" @click=${this.#viewMenuAction} @change=${this.#viewMenuAction}>${this.#planningDocumentControl()}<button type="button" @click=${this.#resumeProposalReview}>${this.i18n.t("adaptive.changes.resume")}</button><button type="button" id="canvas-outcome-toggle" aria-pressed=${outcomes} @click=${()=>this.#deskNavigate(withOutcomeDeskPosture(this.store.route.get(),outcomes?"canvas":"outcomes"))}>${outcomeDeskCopy(this.i18n.locale).heading}</button>
      <button type="button" ?disabled=${!this.#canArrangeOutcome()} @click=${()=>this.#openArrangement()}>${outcomeDeskIntegrationCopy(this.i18n.locale).arrange}</button>
      ${outcomeArrangementOperationFromRoute(this.store.route.get())?html`<button type="button" @click=${()=>{this.#openArrangement();void this.#retrieveArrangement();}}>${outcomeDeskIntegrationCopy(this.i18n.locale).openReceipt}</button>`:nothing}
      ${!canvas.items.length?html`<div class="canvas-empty-tools">${editable?html`<div class="canvas-history-actions" role="group" aria-label="Board history"><button type="button" ?disabled=${!this.store.canUndo()} aria-label="Undo board action" @click=${()=>this.#changeHistory("undo")}>${icon("undo")}</button><button type="button" ?disabled=${!this.store.canRedo()} aria-label="Redo board action" @click=${()=>this.#changeHistory("redo")}>${icon("redo")}</button></div>`:nothing}${this.#batchSelectionControl()}<button type="button" aria-label=${this.i18n.t("canvas.zoomOut","Zoom out")} @click=${()=>this.#setZoom(this.#zoom-.1)}>${icon("minus")}</button><button type="button" @click=${()=>this.#setZoom(1)}>${Math.round(this.#zoom*100)}%</button><button type="button" aria-label=${this.i18n.t("canvas.zoomIn","Zoom in")} @click=${()=>this.#setZoom(this.#zoom+.1)}>${icon("plus")}</button></div>`:nothing}<button class=${view==="spatial"?"active":""} @click=${()=>this.#chooseView("spatial")}>${this.i18n.t("canvas.board","Board")}</button><button class=${view==="list"?"active":""} @click=${()=>this.#chooseView("list")}>${this.i18n.t("canvas.readingOrder","Reading order")}</button>${filed?html`<button class=${view==="folders"?"active":""} @click=${()=>this.#chooseView("folders")}>Project folders</button>`:nothing}${enoughToOrganize?html`<hr><form class="canvas-view-preferences" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label>Order<select .value=${canvasLensFromRoute(this.store.route.get()).sort} @change=${(event:Event)=>this.#navigateCanvasPresentation(withCanvasQuery(this.store.route.get(),{sort:(event.target as HTMLSelectElement).value,seed:(event.target as HTMLSelectElement).value==="random"?String(Date.now()):null}))}><option value="authored">Board placement</option><option value="title">Title</option><option value="type">Content type</option><option value="random">Shuffle</option></select></label></form>`:nothing}${facets.length?html`<hr><span>Focus by what Forma found</span><button @click=${()=>this.#navigateCanvasPresentation(withCanvasQuery(this.store.route.get(),{filter:"all"}))}>Everything</button>${facets.map(({facet,count})=>html`<button @click=${()=>this.#navigateCanvasPresentation(withCanvasQuery(this.store.route.get(),{filter:`facet:${canvasFacetKey(facet)}`}))}>${this.i18n.system(facet.label)}: ${facet.value}<small>${count}</small></button>`)}`:nothing}<hr><button @click=${()=>{this.#memberOpen=true;this.requestUpdate();}}>${this.i18n.t("projects.sharingHeading","Project sharing")}</button><button @click=${()=>{this.#semanticOpen=true;this.requestUpdate();}}>Accessible reading order</button></div>`}></forma-ui-popover><button class="button secondary compact canvas-focus-toggle" aria-label=${focused?this.i18n.system("Exit focused Canvas view"):this.i18n.system("Enter focused Canvas view")} aria-pressed=${focused} title=${focused?this.i18n.system("Restore application navigation"):this.i18n.system("Give this project board the full workspace")} @click=${()=>this.#navigateCanvasPresentation(withCanvasFocus(this.store.route.get(),!focused))}><span aria-hidden="true">${icon(focused?"collapse":"expand")}</span><span>${focused?this.i18n.system("Exit focus"):this.i18n.system("Focus")}</span></button></div>${this.#queueStorageDisclosure()}</header>
    ${outcomes?this.#outcomeDesk():nothing}
    <div class="canvas-authoring-next" ?hidden=${outcomes} ?inert=${outcomes}>${this.#nextDocument()}</div>
    <section class="canvas-stage-shell" ?hidden=${outcomes} ?inert=${outcomes} tabindex="-1" aria-label="Project board">${view==="spatial"?html`<div class="canvas-viewport" tabindex="-1" role="region" aria-roledescription="virtual project board" aria-label=${this.i18n.system("{name}, {count} items", { name: selectedCanvas.name, count: this.i18n.number(items.length) })} @wheel=${(event:WheelEvent)=>this.#canvasWheel(event)}><div class=${`canvas-plane${this.#tool==="marquee"?" is-batch-selecting":""}`} style=${`--canvas-zoom:${this.#zoom};--canvas-grid-size:${gridSize}px;--canvas-grid-x:${gridX}px;--canvas-grid-y:${gridY}px`} @pointerdown=${(event:PointerEvent)=>this.#pan(event)}>${nearbyItems.map((item)=>this.#card(item))}${this.#renderPresence()}${this.#selectionMarquee?html`<span class="canvas-selection-marquee" aria-hidden="true" style=${`left:${this.#selectionMarquee.x}px;top:${this.#selectionMarquee.y}px;width:${this.#selectionMarquee.width}px;height:${this.#selectionMarquee.height}px`}></span>`:nothing}</div></div>`:view==="list"?this.#listView(items):view==="compare"?this.#compareView(items):this.#folderView(items)}
      ${view==="spatial"&&canvas.items.length?this.#batchSelectionControl():nothing}${view==="spatial"&&editable?this.#intentDock():nothing}${this.#selectionControls(view==="spatial"?selectedItems:[],textEditable,comparable)}${view==="spatial"&&canvas.items.length?html`<div class="canvas-zoom-hud"><button aria-label=${this.i18n.t("canvas.zoomOut","Zoom out")} @click=${()=>this.#setZoom(this.#zoom-.1)}>${icon("minus")}</button><button @click=${()=>this.#setZoom(1)}>${Math.round(this.#zoom*100)}%</button><button aria-label=${this.i18n.t("canvas.zoomIn","Zoom in")} @click=${()=>this.#setZoom(this.#zoom+.1)}>${icon("plus")}</button></div>`:nothing}${view==="spatial"&&editable&&unplacedOutputs.length?html`<button class="canvas-new-output" @click=${()=>this.#placeSource(this.#sources().find((source)=>source.id===unplacedOutputs[0].id)!)}>${icon("plus")} Place ${unplacedOutputs.length===1?this.i18n.system("new generation"):this.i18n.system("{count} new generations", { count: this.i18n.number(unplacedOutputs.length) })}</button>`:nothing}
    </section>
    ${this.#proposalDialog()}
    <forma-document-artifacts class="canvas-shared-artifact-composer" .launcherOnly=${true} .documentId=${this.#anchorDocumentId()} source="canvas" @document-artifact-queued=${(event:CustomEvent<{documentId:string}>)=>{const target=canvas.items.find((item)=>item.sourceKind==="document"&&item.sourceId===event.detail.documentId);if(target)this.#openDocumentOutputs(target);}}></forma-document-artifacts>
    ${this.#arrangementOpen?this.#arrangementDialog():nothing}
    ${editable&&this.#addOpen?this.#addDialog():nothing}${editable&&this.#formalizeOpen?this.#formalizeDialog():nothing}${this.#memberOpen?this.#memberDialog():nothing}${editable&&this.#editOpen?this.#editDialog():nothing}${editable&&this.#documentOpen?this.#documentDialog():nothing}${editable&&this.#renderOpen?this.#renderDialog():nothing}${this.#semanticOpen?this.#semanticDialog(items):nothing}${this.#documentOutputsOpen?this.#documentOutputsDialog():nothing}${this.#viewingOutputId?this.#outputViewerDialog():nothing}${this.#viewingArtifactId?this.#artifactViewerDialog():nothing}${!this.store.session.get()?.projectContext&&inputOutput?html`<forma-generation-input-dialog .open=${true} .inspection=${outputGenerationInputInspection(inputOutput,this.store.events.get(),this.store.content.get())} @generation-input-close=${()=>{this.#inputOutputId="";this.requestUpdate();}}></forma-generation-input-dialog>`:nothing}${!this.store.session.get()?.projectContext&&inputArtifact?html`<forma-generation-input-dialog .open=${true} .inspection=${artifactGenerationInputInspection(inputArtifact,this.store.content.get())} @generation-input-close=${()=>{this.#inputArtifactId="";this.requestUpdate();}}></forma-generation-input-dialog>`:nothing}${!this.store.session.get()?.projectContext&&inputFailure?html`<forma-generation-input-dialog .open=${true} .inspection=${failedGenerationInputInspection(inputFailure,this.store.events.get(),this.store.content.get())} @generation-input-close=${()=>{this.#inputFailureJobId="";this.requestUpdate();}}></forma-generation-input-dialog>`:nothing}
  </section>`;}
  #intentDock(){const scope=this.#controlsScope,route=this.store.route.get();const anchor=this.#anchorDocumentId();const canvasId=this.store.canvasProjection.get().selectedCanvasId;const suggestions=this.store.adaptiveSuggestionSetsFor(anchor,canvasId);const pendingJobs=this.store.documentJobs.get().filter((job)=>job.documentId===anchor&&job.canvasId===canvasId&&job.kind==="structure_adaptive"&&job.sourceSurface==="canvas"&&(job.status==="queued"||job.status==="running"||job.status==="committing")).length;const working=pendingJobs>0;const session=this.store.session.get();const assistantActive=Boolean(session?.assistant?.enabled&&session.policy.accepted);const plannerReady=Boolean(session?.provider.plannerConfigured??session?.provider.configured);const canPlan=Boolean(session&&(!session.projectContext||session.projectContext.permissions.includes("project.output.request")));return html`${assistantActive?nothing:html`<forma-ui-popover class="canvas-intent-dock" .label=${this.i18n.t("assistant.mode.planBoard")} .content=${html`<form @submit=${(event:SubmitEvent)=>{event.preventDefault();if(!scope||scope!==this.#currentControlsScope()||route!==this.store.route.get()){this.#closePopovers();return;}this.querySelector<FormaUiPopover>(".canvas-intent-dock")?.close(true);void this.#askIntent();}}><span>${icon("spark")}</span><input aria-label="Describe what you want to explore" maxlength="2000" dir="auto" ?disabled=${!canPlan} placeholder=${!canPlan?plannerReady?this.i18n.t("workspace.admin.readOnlyGeneration"):this.i18n.t("assistant.creativeUnavailable"):working?this.i18n.system("You can prepare the next intent…"):this.i18n.system("What do you want to explore?")} .value=${this.#intent} @input=${(event:InputEvent)=>{this.#intent=(event.target as HTMLInputElement).value;this.requestUpdate();}}><button ?disabled=${this.#intentSubmitting||!canPlan||!this.#intent.trim()} aria-label=${working?this.i18n.system("Forma is preparing suggestions"):this.i18n.t("assistant.mode.planBoardSubmit")}>${working?icon("dots"):icon("send")}</button></form>`}></forma-ui-popover>`}${suggestions.length||working?html`<aside class="canvas-intent-stack" aria-label="Suggested next moves" aria-live="polite">${working?html`<div class="canvas-intent-pending" role="status"><span>${icon("spark")}</span><div><b>Considering your intent</b><small>Suggestions will join this stack when they are ready.</small></div></div>`:nothing}<div class="canvas-intent-cards">${[...suggestions].reverse().map((suggestion,index)=>{const structure=suggestion.structure;const matches=this.#intentMatches(`${suggestion.intent} ${structure.interpretation}`);return html`<article class="canvas-intent-response" data-suggestion-id=${suggestion.id}><header><div><small>${index===0?this.i18n.system("Latest suggestions"):this.i18n.system("Earlier suggestions")}</small>${suggestion.intent?html`<q>${suggestion.intent}</q>`:nothing}<p>${structure.interpretation}</p></div><button aria-label=${(suggestion.intent ? this.i18n.system("Dismiss suggestions for {intent}", { intent: suggestion.intent }) : this.i18n.system("Dismiss suggestions"))} @click=${()=>this.store.dismissAdaptiveSuggestion(anchor,suggestion.id)}>${icon("close")}</button></header><div>${matches.map((source)=>html`<button @click=${()=>this.#placeSource(source)}><span>Add from project</span><b>${source.title}</b></button>`)}<button @click=${()=>this.#useSuggestion(suggestion.id,["/active_decision"])}><span>${this.i18n.t("adaptive.changes.reviewNext")}</span><b>${structure.active_decision.label}</b></button>${structure.suggested_blocks.slice(0,3).map((item,proposalIndex)=>html`<button @click=${()=>this.#useSuggestion(suggestion.id,["/suggested_blocks/"+proposalIndex])}><span>${this.i18n.system(blockTypeDefinition(item.type)?.label??item.type)}</span><b>${item.label}</b></button>`)}<button @click=${()=>this.#useSuggestion(suggestion.id,["/active_decision",...structure.suggested_blocks.map((_item,proposalIndex)=>"/suggested_blocks/"+proposalIndex)])}>${this.i18n.t("adaptive.changes.reviewAll")}</button></div></article>`;})}</div></aside>`:nothing}`;}
  #selectionControls(items:CanvasItem[],textEditable:boolean,comparable:boolean){
    const projection=this.store.projection.get(),single=items.length===1?items[0]:null;
    const block=single&&projection.libraryBlocks.find((candidate)=>candidate.id===single.sourceId);
    if(block&&single)this.#selectionContexts.add(single.id);
    return html`${keyed(this.#controlsScope,html`${repeat([...this.#selectionContexts].filter((id)=>this.store.canvasProjection.get().items.some((item)=>item.id===id)),(id)=>id,(id)=>html`${cache(single?.id===id&&block?localizeTemplateResult(html`${this.#selectionHud(items,textEditable,comparable)}`,this.i18n):nothing)}`)}`)}${items.length&&!block?this.#selectionHud(items,textEditable,comparable):nothing}`;
  }
  #selectionHud(items:CanvasItem[],textEditable:boolean,comparable:boolean){
    const editable=this.#canEditCanvas(),label=items.length===1?this.#itemTitle(items[0]):this.i18n.t("canvas.controls.selectedCount","{count} ideas selected",{count:this.i18n.number(items.length)});
    const documents=items.filter((item)=>item.sourceKind==="document"),selectedDocument=documents.length===1?documents[0]:null;
    const selectedBlock=items.length===1?this.store.projection.get().libraryBlocks.find((block)=>block.id===items[0].sourceId):undefined;
    const documentOutputCount=selectedDocument?this.#documentOutputCount(selectedDocument):0;
    const combine=()=>{this.#contextName=items.length===1?`${label} context`:"Combined context";this.#contextTarget=items.length===1?label:"";this.#formalizeOpen=true;this.requestUpdate();};
    const overflow:Array<{value:string;label:string;run:()=>unknown}>=[];
    if(editable){
      if(!selectedDocument&&(selectedBlock||comparable))overflow.push({value:"combine",label:this.i18n.system("Combine"),run:combine});
      if(!selectedDocument&&selectedBlock)overflow.push({value:"document",label:this.i18n.system("Create document"),run:()=>this.#prepareDocument(items)});
      overflow.push({value:"remove",label:this.i18n.system("Remove"),run:()=>this.#removeSelected()});
    }
    const scope=this.#controlsScope,route=this.store.route.get(),selectedIds=items.map((item)=>item.id).sort(),selection=JSON.stringify(selectedIds);
    const popover=()=>this.querySelector<FormaUiPopover>(".canvas-selection-more");
    const current=()=>Boolean(this.isConnected&&scope&&scope===this.#currentControlsScope()
      &&route===this.store.route.get()&&selection===JSON.stringify([...this.#selected].sort())
      &&selectedIds.length&&items.every((item)=>this.store.canvasProjection.get().items.some((candidate)=>candidate.id===item.id&&candidate.sourceKind===item.sourceKind&&candidate.sourceId===item.sourceId))
      &&this.#canEditCanvas());
    return html`<aside class="canvas-selection-hud" aria-label="Actions for selected board content"><div><span>${items.length}</span><b dir="auto">${label}</b></div>
      ${selectedDocument?html`
        <button class=${documentOutputCount||!editable?"canvas-document-outputs-action canvas-selected-primary":"canvas-document-outputs-action"} @click=${()=>this.#openDocumentOutputs(selectedDocument)}>Outputs <span>${documentOutputCount}</span></button>
        <button @click=${()=>this.#leave(`/document/${encodeURIComponent(selectedDocument.sourceId)}/${canvasSlug(selectedDocument.title)}`)}>${this.i18n.t("projects.openCreatorDocument","Open document in Creator Workspace")}</button>
        ${editable?html`<button class=${documentOutputCount?"canvas-render-action":"canvas-render-action canvas-selected-primary"} aria-label=${items.length>1?(items.length===2?this.i18n.system("Render {title} with {count} selected input",{title:selectedDocument.title,count:this.i18n.number(items.length-1)}):this.i18n.system("Render {title} with {count} selected inputs",{title:selectedDocument.title,count:this.i18n.number(items.length-1)})):this.i18n.system("Render {title}",{title:selectedDocument.title})} @click=${(event:MouseEvent)=>this.#openRender(selectedDocument,event.currentTarget as HTMLElement)}>${items.length>1?(items.length===2?this.i18n.system("Render with {count} input…",{count:this.i18n.number(items.length-1)}):this.i18n.system("Render with {count} inputs…",{count:this.i18n.number(items.length-1)})):this.i18n.system("Render…")}</button>`:nothing}
      `:html`
        ${editable&&textEditable?html`<button class="canvas-selected-primary" @click=${()=>this.#openEdit()}>Edit</button>`:nothing}
        ${selectedBlock?html`<forma-context-intelligence .block=${selectedBlock} surface="canvas" .compact=${true} .readOnly=${!editable}></forma-context-intelligence>`:nothing}
        ${comparable?html`<button class="canvas-selected-primary" @click=${()=>this.#openComparison()}>Compare</button>`:nothing}
        ${editable&&items.length>1?this.#organizeControl(items):nothing}
        ${editable&&!selectedBlock?html`<button class=${comparable?"canvas-prepare-action":"canvas-prepare-action canvas-selected-primary"} @click=${()=>this.#prepareDocument(items)}>Create document</button>${!comparable?html`<button @click=${combine}>Combine</button>`:nothing}`:nothing}
      `}
      ${overflow.length?html`<forma-ui-popover class="canvas-selection-more" .label=${this.i18n.t("canvas.controls.otherWays","Other ways")} .heading=${this.i18n.t("canvas.controls.otherWaysNamed","Other ways for {name}",{name:`\u2068${label}\u2069`})} .actions=${overflow.map(({value,label})=>({value,label}))} .actionCurrent=${(value:string)=>current()&&Boolean(popover()?.isConnected)&&overflow.some((action)=>action.value===value)} @forma-action=${(event:CustomEvent<{value:string}>)=>{if(!current()||event.currentTarget!==popover()||!popover()?.isConnected)return;const chosen=overflow.find((item)=>item.value===event.detail.value);if(chosen)void chosen.run();}}></forma-ui-popover>`:nothing}
      <button class="canvas-selection-close" aria-label="Clear selection" title="Clear selection" @click=${()=>this.#clearSelection()}>${icon("close")}</button>
    </aside>`;
  }
  #organizeControl(items:CanvasItem[]){
    const scope=this.#controlsScope,route=this.store.route.get();
    const selectedIds=items.map((item)=>item.id).sort(),selection=JSON.stringify(selectedIds);
    const popover=()=>this.querySelector<FormaUiPopover>(".canvas-organize-control");
    const current=()=>Boolean(this.isConnected&&scope&&scope===this.#currentControlsScope()
      &&route===this.store.route.get()&&selection===JSON.stringify([...this.#selected].sort())
      &&selectedIds.length>1&&selectedIds.every((id)=>this.store.canvasProjection.get().items.some((item)=>item.id===id))
      &&this.#canEditCanvas());
    const run=(event:Event,action:()=>unknown)=>{
      const menu=popover(),button=event.currentTarget as HTMLElement|null;
      if(!current()||!menu?.isConnected||!button?.isConnected||button.closest("forma-ui-popover")!==menu
        ||!menu.querySelector(".ui-popover-panel")?.matches(":popover-open")){
        return;
      }
      menu.close(true);
      return action();
    };
    const capture={capture:true,handleEvent:(event:Event)=>{
      if(event.type==="click"&&!(event.target as Element|null)?.closest("button"))return;
      if(event.type==="beforetoggle"&&(event as ToggleEvent).newState!=="open")return;
      const menu=event.currentTarget as FormaUiPopover|null;
      if(menu?.isConnected&&menu===popover()&&current())return;
      if(menu?.isConnected&&menu===popover())menu.close();
      event.preventDefault();event.stopImmediatePropagation();
    }};
    const toggle=(event:CustomEvent<{open:boolean}>)=>{
      const menu=event.currentTarget as FormaUiPopover|null;
      if(!menu?.isConnected||menu!==popover())return;
      const open=Boolean(menu.querySelector(".ui-popover-panel")?.matches(":popover-open"));
      if(open&&!current())menu?.close();
      const next=open&&current();
      if(this.#organizeOpen!==next){this.#organizeOpen=next;this.requestUpdate();}
    };
    return html`<forma-ui-popover class="canvas-organize-control" .label=${this.i18n.system("Organize")} .content=${this.#organizeMenu(items,run)} @click=${capture} @beforetoggle=${capture} @forma-toggle=${toggle}></forma-ui-popover>`;
  }
  #organizeMenu(items:CanvasItem[],run:(event:Event,action:()=>unknown)=>unknown){const choices:Array<{kind:CanvasOrganization;title:string;detail:string}>=[{kind:"grid",title:"Compact grid",detail:"Bring everything into one scannable field"},{kind:"row",title:"Arrange in a row",detail:"Compare the ideas from left to right"},{kind:"column",title:"Arrange in a column",detail:"Read the ideas as a top-to-bottom sequence"},{kind:"type",title:"Group by content type",detail:"Keep references, generations, and decisions together"}];const sizes:Array<{kind:CanvasSizeModifier;title:string;detail:string}>=[{kind:"minimum",title:"Minimum",detail:"Use the smallest selected width and height"},{kind:"average",title:"Average",detail:"Use the mean selected width and height"},{kind:"maximum",title:"Maximum",detail:"Use the largest selected width and height"}];const selectedIds=new Set(items.map((item)=>item.id));const saved=this.store.canvasProjection.get().arrangements.filter((arrangement)=>arrangement.itemIds.length===selectedIds.size&&arrangement.itemIds.every((id)=>selectedIds.has(id))).slice(-4).reverse();return html`<aside id=${this.#organizeId} class="canvas-organize-menu" aria-label=${this.i18n.system("Organize {count} selected ideas", { count: this.i18n.number(items.length) })}><header><b>Organize these ideas</b><button aria-label="Close organize menu" @click=${(event:Event)=>run(event,()=>{this.#organizeOpen=false;this.requestUpdate();})}>${icon("close")}</button></header><section aria-labelledby=${this.#organizeId+"-arrange"}><span id=${this.#organizeId+"-arrange"}>Arrange</span><div class="canvas-organize-options" role="group" aria-label="Arrange selected ideas">${choices.map((choice)=>html`<button @click=${(event:Event)=>run(event,()=>this.#organizeSelection(choice.kind))}><b>${this.i18n.system(choice.title)}</b><small>${this.i18n.system(choice.detail)}</small></button>`)}</div></section><section aria-labelledby=${this.#organizeId+"-match-size"}><span id=${this.#organizeId+"-match-size"}>Match size</span><small>Give every selected card—including images—the same width and height. Image pixels crop inside that shared frame without stretching.</small><div class="canvas-size-options" role="group" aria-label="Match selected card size">${sizes.map((choice)=>{const target=canvasMatchSizeTarget(items,choice.kind);return html`<button @click=${(event:Event)=>run(event,()=>this.#matchSelectionSize(choice.kind))}><b>${this.i18n.system(choice.title)}</b><small>${this.i18n.system(choice.detail)}: ${Math.round(target.width)} × ${Math.round(target.height)}</small></button>`;})}</div></section>${saved.length?html`<section aria-labelledby=${this.#organizeId+"-saved-arrangements"}><span id=${this.#organizeId+"-saved-arrangements"}>Saved for this selection</span><small>Reapply an earlier layout after moving or resizing any of these cards.</small><div class="canvas-organize-options">${saved.map((arrangement)=>html`<button @click=${(event:Event)=>run(event,()=>this.#reapplyArrangement(arrangement))}><b>${arrangement.name}</b><small>${arrangement.targetWidth&&arrangement.targetHeight?`${Math.round(arrangement.targetWidth)} × ${Math.round(arrangement.targetHeight)}`:this.i18n.system("{count} cards", { count: this.i18n.number(arrangement.itemIds.length) })}</small></button>`)}</div></section>`:nothing}<p>Each action saves a replayable arrangement against this selection. It changes board presentation only; the meaning and contents of each idea stay untouched.</p></aside>`;}
  #listView(items:CanvasItem[]){return html`<section class="canvas-list-view"><header><h2>${this.i18n.t("canvas.readingOrder","Reading order")}</h2><p>The same project board in an accessible, keyboard-ready sequence.</p></header><ol>${items.map((item)=>html`<li class=${this.#selected.has(item.id)?"selected":""}><button @click=${(event:MouseEvent)=>this.#select(item.id,event)}><span>${item.sourceKind==="context"?this.i18n.system("Combined context"):this.i18n.system(blockTypeDefinition(item.blockType)?.label??item.sourceKind)}</span><b>${this.#itemTitle(item)}</b><small>${this.#itemFacets(item).slice(0,2).map((facet)=>facet.value).join(" · ")||this.i18n.system("Project content")}</small></button></li>`)}</ol><button class="button secondary" @click=${()=>this.#chooseView("spatial")}>${this.i18n.t("canvas.returnToBoard","Return to board")}</button></section>`;}
  #compareView(items:CanvasItem[]){const chosen=items.filter((item)=>this.#selected.has(item.id)&&mediaKind(item)).slice(0,4);return html`<section class="canvas-compare-view"><header><div><h2>Compare selected images</h2><p>Judge references and generations together, then combine the useful realities into the next context.</p></div><button class="button secondary" @click=${()=>this.#chooseView("spatial")}>${this.i18n.t("canvas.returnToBoard","Return to board")}</button></header>${chosen.length>1?html`<div>${chosen.map((item)=>html`<article><span>${item.sourceKind}</span><h3>${this.#itemTitle(item)}</h3>${this.#itemBody(item)}<button class="text-button" @click=${()=>{this.#selected.delete(item.id);this.requestUpdate();}}>Remove</button></article>`)}</div>${this.#canEditCanvas()?html`<button class="button primary" @click=${()=>{this.#contextName="Comparison takeaways";this.#contextTarget="";this.#formalizeOpen=true;this.requestUpdate();}}>Combine selected realities</button>`:nothing}`:html`<div class="canvas-empty"><h3>Select two images on the board</h3><p>Compare appears beside your selection as soon as two references or generations are selected.</p><button class="button secondary" @click=${()=>this.#chooseView("spatial")}>${this.i18n.t("canvas.returnToBoard","Return to board")}</button></div>`}</section>`;}
  #folderView(items:CanvasItem[]){const p=this.store.projection.get();const groups=new Map<string,CanvasItem[]>();for(const item of items){const filed=p.membership[item.sourceId];const label=p.collections.find((collection)=>collection.id===filed?.collectionId)?.handle??"Unfiled";groups.set(label,[...(groups.get(label)??[]),item]);}return html`<section class="canvas-folder-view"><header><div><h2>Project folders</h2><p>The existing project organization—never a second board-only filing system.</p></div><button class="button secondary" @click=${()=>this.#chooseView("spatial")}>${this.i18n.t("canvas.returnToBoard","Return to board")}</button></header>${[...groups].map(([label,members])=>html`<section><h3>${label}</h3><div>${members.map((item)=>html`<button @click=${(event:MouseEvent)=>{this.#select(item.id,event);this.#setView("spatial");}}><span>${item.blockType||item.sourceKind}</span><b>${this.#itemTitle(item)}</b></button>`)}</div></section>`)}</section>`;}
  #addDialog(){
    const sources=this.#sources();
    const placed=new Set(this.store.canvasProjection.get().items.map((item)=>item.sourceId));
    const available=sources.filter((source)=>!placed.has(source.id));
    const category=this.#addKind==="document"?available.filter((source)=>source.kind==="document"):this.#addKind==="output"?available.filter((source)=>source.kind==="output"||source.kind==="artifact"):this.#addKind==="reference"?available.filter((source)=>source.kind==="reference"):this.#addKind==="composite"?available.filter((source)=>source.kind==="context"):available.filter((source)=>source.kind==="block"||source.kind==="sketch");
    const query=this.#sourceQuery.trim().toLocaleLowerCase();
    const filtered=this.#addKind!=="context"||!query?category:category.filter((source)=>`${source.blockType} ${blockTypeDefinition(source.blockType as BlockKind)?.label??""} ${source.title} ${source.body}`.toLocaleLowerCase().includes(query));
    const close=()=>this.#closeAdd();
    return html`<dialog class="modal canvas-add-dialog" data-calm-drawer open closedby="any" aria-labelledby="canvas-sources-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)close();}} @keydown=${(event:KeyboardEvent)=>{if(event.key==="Escape"&&!event.isComposing){event.preventDefault();event.stopPropagation();close();}}} @cancel=${(event:Event)=>{event.preventDefault();event.stopPropagation();close();}} @close=${(event:Event)=>{if(this.#addOpen&&event.currentTarget===this.querySelector(".canvas-add-dialog")&&!(event.currentTarget as HTMLDialogElement).open)close();}}>
      <div class="modal-card">
        <button type="button" class="icon-button modal-close" @click=${close} aria-label=${this.i18n.t("canvas.controls.closeSources","Close sources")}>${icon("close")}</button>
        ${this.#addKind==="start"?html`
          <header><h2 id="canvas-sources-title">${this.i18n.t("canvas.controls.sourcesFor","Sources for {name}",{name:`\u2068${this.store.canvasProjection.get().canvases.find((canvas)=>canvas.id===this.store.canvasProjection.get().selectedCanvasId)?.name??""}\u2069`})}</h2><p>Bring in project work or start something new. Nothing is copied unless you explicitly combine it.</p></header>
          <div class="canvas-add-choices">
            <forma-ui-choice-card data-add-category="document" .label=${this.i18n.system("Document")} .detail=${this.i18n.system("Bring in a complete line of work")} icon-name="document" value="document" @forma-action=${()=>{this.#addKind="document";this.requestUpdate();}}></forma-ui-choice-card>
            <forma-ui-choice-card data-add-category="context" .label=${this.i18n.system("Context")} .detail=${this.i18n.system("Add an existing or new creative decision")} icon-name="selection" value="context" @forma-action=${()=>{this.#addKind="context";this.#sourceQuery="";this.requestUpdate();}}></forma-ui-choice-card>
            <forma-ui-choice-card data-add-category="output" .label=${this.i18n.system("Output")} .detail=${this.i18n.system("Place an image, story, scene, deck, storyboard, or video")} icon-name="image" value="output" @forma-action=${()=>{this.#addKind="output";this.requestUpdate();}}></forma-ui-choice-card>
            <forma-ui-choice-card data-add-category="reference" .label=${this.i18n.system("Reference")} .detail=${this.i18n.system("Bring visual evidence onto the board")} icon-name="contrast" value="reference" @forma-action=${()=>{this.#addKind="reference";this.requestUpdate();}}></forma-ui-choice-card>
            <forma-ui-choice-card data-add-category="draw" .label=${this.i18n.system("Draw")} .detail=${this.i18n.system("Create a reusable sketch block")} icon-name="draw" value="draw" @forma-action=${()=>{void this.#startDrawing();}}></forma-ui-choice-card>
            ${sources.some((source)=>source.kind==="context")?html`<forma-ui-choice-card data-add-category="composite" .label=${this.i18n.system("Combined context")} .detail=${this.i18n.system("Reuse a context assembled earlier")} icon-name="focal-point" value="composite" @forma-action=${()=>{this.#addKind="composite";this.requestUpdate();}}></forma-ui-choice-card>`:nothing}
          </div>
        `:html`
          <header class="canvas-add-subheader"><button type="button" @click=${()=>{this.#addKind="start";this.#sourceQuery="";this.requestUpdate();}}>${icon("back")} ${this.i18n.t("canvas.controls.sources","Sources")}</button><h2 id="canvas-sources-title">${this.#addKind==="context"?this.i18n.system("Add context"):this.#addKind==="output"?this.i18n.system("Outputs"):this.#addKind==="reference"?this.i18n.system("References"):this.#addKind==="composite"?this.i18n.system("Combined contexts"):this.i18n.system("Documents")}</h2></header>
          ${this.#addKind==="context"?html`
            <div class="canvas-add-layout">
              <form class="canvas-context-create-form" @submit=${(event:SubmitEvent)=>{event.preventDefault();void this.#createNativeBlock();}}>
                <h3>Add a context block</h3>
                <label>Area<select .value=${this.#newBlockGroup} @change=${(event:Event)=>{this.#newBlockGroup=(event.target as HTMLSelectElement).value as BlockGroup;this.#newBlockType=BLOCK_TYPES.find((type)=>type.group===this.#newBlockGroup)?.type??"direction";this.requestUpdate();}}>${BLOCK_GROUPS.map((group)=>html`<option value=${group.id}>${this.i18n.system(group.label)}</option>`)}</select></label>
                <label>Block type<select .value=${this.#newBlockType} @change=${(event:Event)=>{this.#newBlockType=(event.target as HTMLSelectElement).value as BlockKind;}}>${BLOCK_TYPES.filter((type)=>type.group===this.#newBlockGroup).map((type)=>html`<option value=${type.type}>${this.i18n.system(type.label)}</option>`)}</select></label>
                <label>Name<input .value=${this.#newBlockTitle} @input=${(event:InputEvent)=>{this.#newBlockTitle=(event.target as HTMLInputElement).value;}} placeholder="Give this idea a short name"></label>
                <label>What should it do?<textarea rows="4" .value=${this.#newBlockBody} @input=${(event:InputEvent)=>{this.#newBlockBody=(event.target as HTMLTextAreaElement).value;}} placeholder=${this.i18n.system(blockTypeDefinition(this.#newBlockType)?.prompt ?? "Describe this idea")}></textarea></label>
                <button type="submit" class="button primary">Add to board</button>
              </form>
              <form class="canvas-context-source-form" @submit=${(event:SubmitEvent)=>{event.preventDefault();const selected=this.#selectedContextSources();if(selected.length)void this.#placeSources(selected);}}>
                <h3>Add from project</h3>
                <label class="canvas-source-search"><span>Search existing context</span><span class="canvas-source-search-field">${icon("search")}<input type="search" autocomplete="off" placeholder="Search name, type, or instructions" .value=${this.#sourceQuery} @input=${(event:InputEvent)=>{this.#sourceQuery=(event.target as HTMLInputElement).value;this.requestUpdate();}}></span></label>
                <small class="canvas-source-count" role="status" aria-live="polite">${query?this.i18n.system("{count} of {count2} available context blocks", { count: this.i18n.number(filtered.length), count2: this.i18n.number(category.length) }):(category.length===1 ? this.i18n.system("{count} available context block", { count: this.i18n.number(category.length) }) : this.i18n.system("{count} available context blocks", { count: this.i18n.number(category.length) }))}</small>
                ${this.#sourceList(filtered,query?`No existing context matches “${this.#sourceQuery.trim()}”. Try another name, type, or instruction.`:undefined)}
              </form>
            </div>
          `:this.#sourceList(filtered)}
        `}
      </div>
    </dialog>`;
  }
  #sourceList(sources:Source[],emptyMessage?:string){
    if(this.#addKind==="context"){
      const selected=this.#selectedContextSources(),allVisibleSelected=sources.length>0&&sources.every((source)=>this.#selectedSourceIds.has(source.id));
      return html`<div class="canvas-context-source-picker">
        ${sources.length?html`<div class="canvas-source-list canvas-source-list--selectable" role="group" aria-label="Available context blocks">${sources.map((source)=>{const active=this.#selectedSourceIds.has(source.id);return html`<button type="button" class=${active?"selected":""} aria-pressed=${active} @click=${()=>this.#toggleSource(source.id)}><span>${source.blockType||source.kind}</span><b>${source.title}</b><small>${source.body}</small><i aria-hidden="true">${active?icon("check"):icon("plus")}</i></button>`;})}</div>`:html`<div class="canvas-source-empty"><p>${emptyMessage??this.i18n.system("Everything in this category is already on the board.")}</p></div>`}
        <div class="canvas-source-batch-actions">
          <div><b aria-live="polite">${selected.length} selected</b><small>Choose several blocks, then place them together.</small></div>
          <div><button type="button" class="button ghost compact" ?disabled=${!sources.length} @click=${()=>this.#toggleVisibleSources(sources)}>${allVisibleSelected?this.i18n.system("Clear visible"):this.i18n.system("Select visible")}</button><button type="button" class="button ghost compact" ?disabled=${!selected.length} @click=${()=>{this.#selectedSourceIds.clear();this.requestUpdate();}}>Clear</button><button type="submit" class="button primary compact" ?disabled=${!selected.length}>Add ${selected.length||""} to canvas</button></div>
        </div>
      </div>`;
    }
    return sources.length?html`<div class="canvas-source-list">${sources.map((source)=>html`<button @click=${()=>this.#placeSource(source)}><span>${source.blockType||source.kind}</span><b>${source.title}</b><small>${source.body}</small>${icon("plus")}</button>`)}</div>`:html`<div class="canvas-source-empty"><p>${emptyMessage??this.i18n.system("Everything in this category is already on the board.")}</p>${this.#addKind==="reference"?html`<a class="button secondary compact" href="/canvas/library" @click=${(event:MouseEvent)=>this.#openReferenceLibrary(event)}>${this.i18n.t("projects.manageReferences","Upload or manage references")}</a>`:nothing}</div>`;
  }
  #formalizeDialog(){const role=COMBINED_CONTEXT_ROLE_DEFINITIONS.find((item)=>item.id===this.#contextRole)!;const application=COMBINED_CONTEXT_APPLICATION_DEFINITIONS.find((item)=>item.id===this.#contextApplication)!;return html`<dialog class="modal" open closedby="any" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget){this.#formalizeOpen=false;this.requestUpdate();}}}><form class="modal-card canvas-compact-dialog canvas-combine-dialog" @submit=${(event:SubmitEvent)=>{event.preventDefault();if(this.#contextName.trim()&&this.#contextTarget.trim())void this.#formalize({place:true});}}><button type="button" class="icon-button modal-close" @click=${()=>{this.#formalizeOpen=false;this.requestUpdate();}} aria-label="Close">${icon("close")}</button><header><h2>Combine these ideas</h2><p>Create one reusable, meaningful boundary from ${this.#selected.size} selected item${this.#selected.size===1?"":"s"}. The sources remain independent; renderers will keep their shared meaning together.</p></header><label>Group name<input .value=${this.#contextName} @input=${(event:InputEvent)=>{this.#contextName=(event.target as HTMLInputElement).value;this.requestUpdate();}}><small>A reusable name for this set of decisions.</small></label><label>Named target<input .value=${this.#contextTarget} @input=${(event:InputEvent)=>{this.#contextTarget=(event.target as HTMLInputElement).value;this.requestUpdate();}}><small>The character, place, chapter, object, or other specific part of the result this group defines.</small></label><label>What does this group define?<select .value=${this.#contextRole} @change=${(event:Event)=>{this.#contextRole=(event.target as HTMLSelectElement).value as CombinedContextRole;this.requestUpdate();}}>${COMBINED_CONTEXT_ROLE_DEFINITIONS.map((option)=>html`<option value=${option.id}>${this.i18n.system(option.label)}</option>`)}</select><small>${this.i18n.system(role.description)}</small></label><label>How should members travel?<select .value=${this.#contextApplication} @change=${(event:Event)=>{this.#contextApplication=(event.target as HTMLSelectElement).value as CombinedContextApplication;this.requestUpdate();}}>${COMBINED_CONTEXT_APPLICATION_DEFINITIONS.map((option)=>html`<option value=${option.id}>${this.i18n.system(option.label)}</option>`)}</select><small>${this.i18n.system(application.description)}</small></label><label class="canvas-context-relativity"><span><b>Group relativity</b><output>${Math.round(this.#contextRelativity*100)}%</output></span><input type="range" min="0" max="1" step=".05" .value=${String(this.#contextRelativity)} @input=${(event:InputEvent)=>{this.#contextRelativity=Number((event.target as HTMLInputElement).value);this.requestUpdate();}}><small>Higher values keep these decisions tightly bound. Individual block influence still controls how strongly each decision contributes.</small></label><div class="canvas-context-output-effects" aria-label="How this combined context affects outputs"><span><b>Images & video</b><small>Members apply to the named target instead of leaking across the frame.</small></span><span><b>Stories & scenes</b><small>Members arrive at the same narrative moments or aspects.</small></span><span><b>Slides</b><small>Members occupy one slide or a contiguous chapter.</small></span></div><button type="submit" class="button primary" ?disabled=${!this.#contextName.trim()||!this.#contextTarget.trim()}>Add combined context</button></form></dialog>`;}
  #documentDialog(){const selected=this.store.canvasProjection.get().items.filter((item)=>this.#selected.has(item.id));return html`<dialog class="modal" open closedby="any" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget){this.#documentOpen=false;this.requestUpdate();}}}><form class="modal-card canvas-compact-dialog canvas-document-dialog" @submit=${(event:SubmitEvent)=>{event.preventDefault();if(this.#documentTitle.trim()&&selected.length)void this.#createDocumentFromSelection();}}><button type="button" class="icon-button modal-close" @click=${()=>{this.#documentOpen=false;this.requestUpdate();}} aria-label="Close">${icon("close")}</button><span class="canvas-dialog-step">Step 1 of 2 · prepare</span><h2>Create a document from ${selected.length} idea${selected.length===1?"":"s"}</h2><p>The document will collect reusable copies of the selected decisions and appear on this board immediately. This step does not call an image model or use generation budget.</p><label>Document name<input autofocus maxlength="80" .value=${this.#documentTitle} @input=${(event:InputEvent)=>{this.#documentTitle=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label><div class="canvas-dialog-summary"><b>Prepared now</b><span>${selected.map((item)=>item.title).join(" · ")}</span></div><div class="canvas-dialog-actions"><button type="button" class="button secondary" @click=${()=>{this.#documentOpen=false;this.requestUpdate();}}>Cancel</button><button type="submit" class="button primary" ?disabled=${!this.#documentTitle.trim()||!selected.length}>Create document</button></div></form></dialog>`;}
  #renderDialog(){
    const item=this.store.canvasProjection.get().items.find((candidate)=>candidate.id===this.#renderDocumentItemId&&candidate.sourceKind==="document");const session=this.store.session.get();const plannerReady=Boolean(session?.provider.plannerConfigured??session?.provider.configured);const providerReady=Boolean(session?.provider.configured);const videoReady=Boolean(session?.provider.videoConfigured);const audioReady=Boolean(session?.provider.audioConfigured);const working=Boolean(this.store.busy.get())||this.#renderPreparationPending();if(!item)return nothing;
    const imageChoices:Array<{kind:CanvasRenderKind;title:string;detail:string;cost:string;primary?:boolean}>=[{kind:"preview",title:"Draft image",detail:"A fast, low-quality image for checking the direction.",cost:"1 image · lower cost"},{kind:"generate",title:"Full image",detail:"A full-quality image using the latest draft as a reference when available.",cost:"1 image · full cost",primary:true},{kind:"preview_fan",title:"Draft fan ×4",detail:"Compare prose, bullets, JSON, and XML prompt preparation at draft quality.",cost:"4 images · lower quality"},{kind:"generate_fan",title:"Full fan ×4",detail:"Compare all four prompt preparations at full quality.",cost:"4 images · highest cost"}];
    const artifacts:Array<{kind:DocumentArtifactKind;title:string;detail:string;cost:string}>=[{kind:"short_story",title:"Short story",detail:"A polished narrative shaped by this document's intent.",cost:"Choose audience and tone"},{kind:"scene",title:"Film / TV scene",detail:"Production-readable action and dialogue.",cost:"Choose audience and tone"},{kind:"slides",title:"Slides",detail:"An editable presentation with speaker notes and a coherent visual system.",cost:"Choose slide count, audience, and tone"},{kind:"storyboard",title:"Storyboard",detail:"Connected draft frames with preserved subject and shot continuity.",cost:"Choose the frame count · paid images"},{kind:"video",title:"Video",detail:"Motion with optional ordered reference pixels, shot direction, and audio.",cost:"Choose duration, framing, and reference policy"},{kind:"audio",title:this.i18n.t("artifact.audio.label","Audio"),detail:this.i18n.t("audio.block.description","Music, soundscapes, spoken words, and deliberate silence"),cost:this.i18n.t("audio.goal.heading","What would you like to create?")}];
    return html`<dialog class="modal canvas-render-dialog" open closedby="any" aria-labelledby="canvas-render-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget){this.#renderOpen=false;this.requestUpdate();}}}><div class="modal-card"><button class="icon-button modal-close" @click=${()=>{this.#renderOpen=false;this.requestUpdate();}} aria-label="Close render options">${icon("close")}</button><header><span class="canvas-dialog-step">Step 2 of 2 · render when ready</span><h2 id="canvas-render-title">Render ${item.title}</h2><p>Choose the result that helps your next decision. Every format opens the same complete configuration available in the document.</p></header>${plannerReady?providerReady?nothing:html`<p class="canvas-provider-note">${this.i18n.t("assistant.previewUnavailable")}</p>`:html`<p class="canvas-provider-note">Connect the provider before starting a render. The prepared document remains available without it.</p>`}${providerReady&&!videoReady?html`<p class="canvas-provider-note">Text, image, and storyboard renders are available. Video remains disabled until a video provider is configured.</p>`:nothing}<h3 class="canvas-render-section-title">Images</h3><div class="canvas-render-choices">${imageChoices.map((choice)=>html`<button class=${choice.primary?"primary":""} ?disabled=${!providerReady||working} @click=${()=>this.#renderDocument(choice.kind)}><span>${this.i18n.system(choice.title)}</span><small>${this.i18n.system(choice.detail)}</small><em>${this.i18n.system(choice.cost)}</em></button>`)}</div><div class="canvas-render-artifact-heading"><h3 class="canvas-render-section-title">Narrative, presentation & motion</h3></div><div class="canvas-render-choices canvas-render-choices--artifacts">${artifacts.map((choice)=>html`<button ?disabled=${!plannerReady||choice.kind==="storyboard"&&!providerReady||choice.kind==="video"&&!videoReady||choice.kind==="audio"&&!audioReady||working} @click=${()=>this.#renderArtifact(choice.kind)}><span>${this.i18n.system(choice.title)}</span><small>${this.i18n.system(choice.detail)}</small><em>${this.i18n.system(choice.cost)}</em></button>`)}</div><p class="canvas-render-guidance">Storyboards and video show their estimated cost and require explicit confirmation before any paid work begins.</p><div class="canvas-dialog-actions"><button class="button secondary" @click=${()=>{this.#renderOpen=false;this.requestUpdate();}}>Not yet</button><button class="text-button" @click=${(event:MouseEvent)=>void this.#openRenderDocument(event,item)}>${this.i18n.t("projects.openCreatorDocument","Open document in Creator Workspace")}</button></div></div></dialog>`;
  }
  #documentOutputsDialog(){
    const item=this.store.canvasProjection.get().items.find((candidate)=>candidate.id===this.#documentOutputsItemId&&candidate.sourceKind==="document"&&candidate.sourceId===this.#outputsDocumentId);if(!item)return nothing;
    const outputs=this.#documentOutputs(item),artifacts=this.#documentArtifacts(item),jobs=this.#documentOutputJobs(item),failures=this.#documentOutputFailures(item);
    const ready=outputs.length+artifacts.length,pending=jobs.images.length+jobs.artifacts.length,total=ready+pending+failures.length;
    const placed=new Set(this.store.canvasProjection.get().items.filter((candidate)=>candidate.sourceKind==="output"||candidate.sourceKind==="artifact").map((candidate)=>candidate.sourceId));
    return html`<dialog class="modal canvas-document-outputs-dialog" data-calm-drawer open closedby="any" aria-modal="true" aria-labelledby="canvas-document-outputs-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeDocumentOutputs();}} @keydown=${(event:KeyboardEvent)=>{if(event.key==="Escape"&&!event.isComposing){event.preventDefault();event.stopPropagation();this.#closeDocumentOutputs();}}} @cancel=${(event:Event)=>{event.preventDefault();event.stopPropagation();this.#closeDocumentOutputs();}} @close=${(event:Event)=>{if(this.#documentOutputsOpen&&event.currentTarget===this.querySelector(".canvas-document-outputs-dialog")&&!(event.currentTarget as HTMLDialogElement).open)this.#closeDocumentOutputs();}}>
      <div class="modal-card canvas-document-outputs-card">
        <button type="button" autofocus class="icon-button modal-close" aria-label="Close document outputs" @click=${()=>this.#closeDocumentOutputs()}>${icon("close")}</button>
        <header>
          <span class="canvas-dialog-step">${ready} ready${pending?" " + this.i18n.system("· {pending} rendering", { pending: this.i18n.number(pending) }):""}${failures.length?" " + this.i18n.system("· {count} failed", { count: this.i18n.number(failures.length) }):""} · ${outputs.length+jobs.images.length} image${outputs.length+jobs.images.length===1?"":"s"} · ${artifacts.length+jobs.artifacts.length} other result${artifacts.length+jobs.artifacts.length===1?"":"s"}</span>
          <h2 id="canvas-document-outputs-title">${item.title}</h2>
          <p>Review every result without crowding the board. Rendering work appears here as soon as it is accepted, reports its current server stage, and becomes placeable when ready.</p>
        </header>
        ${total?html`<div class="canvas-document-output-sections" aria-live="polite" aria-relevant="additions text">
          ${outputs.length||jobs.images.length?html`<section>
            <header><h3>Images</h3><span>${outputs.length} ready${jobs.images.length?" " + this.i18n.system("· {count} rendering", { count: this.i18n.number(jobs.images.length) }):""}</span></header>
            <div class="canvas-document-output-grid">
              ${jobs.images.map((job)=>this.#pendingDocumentOutput(job))}
              ${outputs.map((output)=>{const technique=promptTechniqueDefinition(output.promptTechnique),title=this.#outputSource(output).title,onCanvas=placed.has(output.id),fan=this.#viewerFan(output);const state=[output.saved?this.i18n.system("Saved"):"",output.pinned?this.i18n.system("Pinned"):"",output.discarded?this.i18n.system("Discarded"):""].filter(Boolean).join(" · ");return html`<article><button type="button" class="canvas-document-output-preview" aria-label=${this.i18n.system("Review {quality} {label} output at full size", { quality: this.i18n.system(outputQualityLabel(output)), label: title })} @click=${()=>this.#showCanvasOutput(output,"canvas-document-outputs-dialog")}><forma-output-visual .output=${output} .compact=${true}></forma-output-visual><span>Open full image</span></button><div class="canvas-document-output-copy"><span>${this.i18n.system(outputQualityLabel(output))}${output.promptFanId?" "+this.i18n.system("· Fan {index} of {total}",{index:this.i18n.number(Math.max(1,fan.findIndex((candidate)=>candidate.id===output.id)+1)),total:this.i18n.number(fan.length)}):""} · ${this.i18n.system(technique.label)}</span><h3 dir="auto">${title}</h3><small>${output.width??1536} × ${output.height??1024}${state?` · ${state}`:""}</small>${this.#outputTimestamp(this.#outputCreatedAt(output.sourceEventId,output.sequence))}</div><footer><button type="button" class="button secondary compact" @click=${()=>this.#showCanvasOutput(output,"canvas-document-outputs-dialog")}>Review</button>${this.#canEditCanvas()?html`<button type="button" class="button primary compact" ?disabled=${onCanvas} @click=${()=>this.#placeDocumentOutput(output)}>${onCanvas?this.i18n.system("On canvas"):this.i18n.system("Place on canvas")}</button>`:nothing}</footer></article>`;})}
            </div>
          </section>`:nothing}
          ${artifacts.length||jobs.artifacts.length?html`<section>
            <header><h3>Stories, presentations & motion</h3><span>${artifacts.length} ready${jobs.artifacts.length?" " + this.i18n.system("· {count} rendering", { count: this.i18n.number(jobs.artifacts.length) }):""}</span></header>
            <div class="canvas-document-output-grid canvas-document-artifact-grid">
              ${jobs.artifacts.map((job)=>this.#pendingDocumentOutput(job))}
              ${artifacts.map((artifact)=>{const definition=documentArtifactDefinition(artifact.kind),onCanvas=placed.has(artifact.id);return html`<article><button type="button" class="canvas-document-output-preview canvas-document-artifact-preview" aria-label=${this.i18n.system("Review {label}: {title}", { label: this.i18n.system(definition.label), title: artifact.title })} @click=${()=>this.#showCanvasArtifact(artifact)}>${this.#artifactPreview(artifact)}<span>${this.i18n.system("Open {label}",{label:this.i18n.system(definition.label).toLocaleLowerCase(this.i18n.locale)})}</span></button><div class="canvas-document-output-copy"><span>${this.i18n.system(definition.label)}</span><h3>${artifact.title}</h3><small>${artifact.itemCount} ${artifact.kind==="slides"?this.i18n.system("slides"):artifact.kind==="storyboard"?this.i18n.system("frames"):this.i18n.system(artifact.itemCount===1 ? "part" : "parts")} · ${this.i18n.system("Generation time")} ${Math.round(artifact.latency/1000)}s</small>${this.#outputTimestamp(this.#outputCreatedAt(artifact.sourceEventId,artifact.sequence))}<p>${artifact.summary}</p></div><footer><button type="button" class="button secondary compact" @click=${()=>this.#showCanvasArtifact(artifact)}>Review</button>${this.#canEditCanvas()?html`<button type="button" class="button primary compact" ?disabled=${onCanvas} @click=${()=>this.#placeDocumentArtifact(artifact)}>${onCanvas?this.i18n.system("On canvas"):this.i18n.system("Place on canvas")}</button>`:nothing}</footer></article>`;})}
            </div>
          </section>`:nothing}
          ${failures.length?html`<section class="canvas-document-failures">
            <header><div><h3>Failed attempts</h3><p>${this.store.session.get()?.projectContext?this.i18n.t("generation.sharedFailurePrivacy","Failure details remain available; generation inputs stay private to their author."):this.i18n.system("These attempts produced no usable output. Their frozen inputs remain inspectable even after a notice is dismissed.")}</p></div><span>${failures.filter((job)=>!job.dismissedAt).length} unread</span></header>
            <ol>${failures.map((job)=>{const detail=documentJobFailure(job),guidance=localizedGenerationFailureGuidance(generationFailureGuidance(detail,job.error??"",job),detail,job.error??"",this.i18n);const artifactKind=String(job.result?.artifactKind??"").replaceAll("_"," ");const label=job.kind==="render_document"?(artifactKind||"Document output"):job.kind==="prompt_fan"?`${job.fanKind==="preview"?"Draft":"Full"} fan`:job.kind==="preview"?"Draft image":"Full image";return html`<li class=${job.dismissedAt?"dismissed":""}><div><span>${label}</span><b>${guidance.title}</b><p>${guidance.summary}</p><small><time datetime=${job.requestedAt}>${this.i18n.date(new Date(job.requestedAt),{dateStyle:"medium",timeStyle:"short"})}</time> · ${detail?.code??job.error??"operation_failed"}${job.dismissedAt?" " + this.i18n.system("· notice read"):""}</small></div><div>${!this.store.session.get()?.projectContext?html`<button type="button" class="button secondary compact" @click=${async()=>{this.#inputFailureJobId=job.jobId;if(this.store.ui.instrumentation)void this.store.hot({type:"ObjectViewed",payload:{object_id:job.jobId,object_type:"generation-failure",document_id:job.documentId,source_surface:"canvas-document-outputs-dialog",reason:"inspect-failed-inputs"}});this.requestUpdate();try{await this.store.loadDocumentJobDetail(job.jobId);this.requestUpdate();}catch(error){this.store.toast(error instanceof Error?error.message:"The retained generation inputs could not be loaded.");}}}>Inspect inputs</button>`:nothing}${!job.dismissedAt?html`<button type="button" class="button ghost compact" @click=${()=>this.store.dismissDocumentJobFailure(job.jobId)}>Dismiss notice</button>`:nothing}</div></li>`;})}</ol>
          </section>`:nothing}
        </div>`:html`<div class="canvas-document-output-empty"><span aria-hidden="true">${icon("image")}</span><h3>No outputs yet</h3><p>The document can stay on the board without rendering anything. Create an image, story, scene, slide deck, storyboard, or video when it would help the next decision.</p>${this.#canEditCanvas()?html`<button type="button" class="button primary" @click=${(event:MouseEvent)=>{this.#closeDocumentOutputs();this.#openRender(item,event.currentTarget as HTMLElement);}}>Render something…</button>`:nothing}</div>`}
        <footer><span>${pending?(pending===1 ? this.i18n.system("{pending} render is continuing on the server.", { pending: this.i18n.number(pending) }) + " " : this.i18n.system("{pending} renders are continuing on the server.", { pending: this.i18n.number(pending) }) + " "):""}Outputs remain attached to ${item.title} whether or not they are placed.</span><button type="button" class="button secondary" @click=${()=>this.#closeDocumentOutputs()}>Done</button></footer>
      </div>
    </dialog>`;
  }
  #artifactViewerDialog(){
    const artifact=this.store.projection.get().libraryArtifacts.find((candidate)=>candidate.id===this.#viewingArtifactId);if(!artifact)return nothing;
    const definition=documentArtifactDefinition(artifact.kind),content=parseDocumentArtifactContent(this.store.content.get()[artifact.contentRef??""]);
    const items=artifact.items.map((item,index)=>({...item,...(content?.items[index]?{title:content.items[index].title,body:content.items[index].body,notes:content.items[index].notes,imagePrompt:content.items[index].image_prompt,slide:content.items[index].slide??item.slide}:{} )}));
    const presentation=content?.presentation??artifact.presentation;
    const deckItems=items.map((entry):DocumentArtifactDraftItem=>({title:entry.title,body:entry.body,notes:entry.notes,image_prompt:entry.imagePrompt,slide:entry.slide}));
    const projection=this.store.projection.get();
    const sourceBlocks=projection.libraryBlocks.filter((block)=>block.scope==="document"&&block.documentId===artifact.documentId&&block.projectId===projection.projectId);
    const delivery=artifactDeliveryFor(this.store,artifact,undefined,this.store.canvasProjection.get().selectedCanvasId);
    const session=this.store.session.get(),project=session?.projectContext,events=this.store.events.get(),review=artifactReviewState(artifact,sourceBlocks,events),releaseAllowed=!project||(!project.managedPilot&&!artifactSourceVersions(artifact.id,events))||delivery.approved;
    const completed=events.find((event)=>event.eventId===artifact.sourceEventId),rendered=[...events].reverse().find((event)=>event.type==="DocumentRenderRequested"&&String(event.payload.artifact_id??"")===artifact.id),renderedBy=rendered?.actor.startsWith("user:")?rendered.actor.slice(5):"";
    const productionOwner=Boolean(session&&!session.impersonation&&(!project||String(completed?.payload.requested_by_user_id??renderedBy)===session.user.userId));
    const actionsPanelId=`canvas-artifact-viewer-actions-${artifact.id}`;
    const canEditCanvas=this.#canEditCanvas();
    const groupViewerActions=artifact.kind==="slides"&&(1+Number(!project)+Number(canEditCanvas))>1;
    const viewerMenuAuthorization=this.store.captureAuthorizationScope(),viewerMenuRoute=this.store.route.get();
    const viewerMenuAction={capture:true,handleEvent:(event:Event)=>{
      if(!(event.target as Element|null)?.closest("button,a"))return;
      const current=Boolean(viewerMenuAuthorization&&this.store.authorizationScopeActive(viewerMenuAuthorization)&&viewerMenuRoute===this.store.route.get()&&this.#viewingArtifactId===artifact.id);
      this.querySelector<FormaUiPopover>(".artifact-viewer-actions-popover")?.close(current);
      if(!current){event.preventDefault();event.stopImmediatePropagation();}
    }};
    const viewerActions=html`<div id=${actionsPanelId} class="artifact-viewer-actions-body" @click=${groupViewerActions?viewerMenuAction:undefined}>${!this.store.session.get()?.projectContext?html`<button type="button" class="button secondary" @click=${()=>{this.#inputArtifactId=artifact.id;this.requestUpdate();}}>Inspect inputs</button>`:nothing}${canEditCanvas?html`<button type="button" class="button secondary" @click=${()=>this.#reuseArtifact(artifact)}>${this.i18n.t("projects.editCreator","Edit in Creator Workspace")}</button>`:nothing}<button type="button" class="button ghost" @click=${()=>this.#closeCanvasArtifact()}>Done</button></div>`;
    return html`<dialog class="modal canvas-artifact-viewer" data-output-focus=${String(this.#viewerFocused)} data-artifact-kind=${artifact.kind} open closedby="any" aria-modal="true" aria-labelledby="canvas-artifact-viewer-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeCanvasArtifact();}} @cancel=${(event:Event)=>{event.preventDefault();if(this.#viewerFocused){this.#setViewerFocus(false);return;}this.#closeCanvasArtifact();}}><article class="modal-card canvas-artifact-viewer-card"><button type="button" autofocus class="icon-button canvas-viewer-focus-toggle" aria-label=${this.i18n.system(this.#viewerFocused?"Exit focus":"Focus view")} title=${this.i18n.system(this.#viewerFocused?"Exit focus":"Focus view")} aria-pressed=${this.#viewerFocused} @click=${()=>this.#setViewerFocus(!this.#viewerFocused)}>${icon(this.#viewerFocused?"collapse":"expand")}</button><button type="button" class="icon-button modal-close" aria-label="Close document output" @click=${()=>this.#closeCanvasArtifact()}>${icon("close")}</button><header><span class="canvas-dialog-step">${this.i18n.system(definition.label)}${productionOwner?` · ${artifact.modelId}`:""}</span><h2 id="canvas-artifact-viewer-title">${artifact.title}</h2><span class=${`artifact-review-status artifact-review-${review.status}`}>${project&&review.status==="approved"&&!delivery.approved?this.i18n.t("artifact.delivery.unverifiedApproval","Recorded approval does not match the current output."):this.i18n.t(`deliver.review.${review.status}`,review.label)}</span><p>${artifact.summary}</p><button type="button" class="button primary" @click=${()=>void this.#openArtifactDelivery(artifact)}>${this.i18n.t(`artifact.delivery.action.${delivery.action}`)}</button></header><div class=${`canvas-artifact-viewer-content canvas-artifact-viewer-content--${artifact.kind}`}>${artifact.kind==="audio"?renderAudioPlayer(artifact.mediaUrl,artifact.title,this.i18n,{transcript:String(artifact.settings.lyrics??"")}):artifact.kind==="video"&&artifact.mediaUrl?renderVideoReel(items,artifact.mediaUrl,artifact.title,this.i18n):artifact.kind==="storyboard"?html`<ol class="canvas-artifact-storyboard">${items.map((entry,index)=>html`<li>${entry.mediaUrl?html`<img src=${entry.mediaUrl} alt=${entry.title} loading="lazy">`:html`<span aria-hidden="true">${icon("storyboard")}</span>`}<div><small>Shot ${index+1}</small><h3>${entry.title}</h3><p>${entry.body}</p>${entry.notes?html`<em>${entry.notes}</em>`:nothing}</div></li>`)}</ol>`:artifact.kind==="slides"?html`<forma-presentation-deck .items=${deckItems} .presentation=${presentation} .preferenceKey=${artifact.id} .deckTitle=${artifact.title} .documentId=${artifact.documentId} .releaseAllowed=${releaseAllowed} source-surface="canvas-artifact-viewer"></forma-presentation-deck>`:html`<pre>${content?.content_markdown??artifact.summary}</pre>`}${artifact.kind!=="slides"?renderSoundtrackCompanions(artifact.settings.soundtrack_assets,this.i18n):nothing}</div><footer data-actions-open=${String(this.#viewerActionsOpen)}><span>${artifact.itemCount} ${artifact.kind==="slides"?this.i18n.system("slides"):artifact.kind==="storyboard"?this.i18n.system("frames"):artifact.kind==="video"?this.i18n.system(artifact.itemCount===1 ? "scene" : "scenes"):this.i18n.system(artifact.itemCount===1 ? "part" : "parts")} · ${this.i18n.system("Generation time")} ${Math.round(artifact.latency/1000)}s</span>${groupViewerActions?html`<forma-ui-popover class="artifact-viewer-actions-popover" .label=${this.i18n.t("action.more","More actions")} .content=${viewerActions} @forma-toggle=${(event:CustomEvent<{open:boolean}>)=>{this.#viewerActionsOpen=event.detail.open;}}></forma-ui-popover>`:viewerActions}</footer></article></dialog>`;
  }
  #outputViewerDialog(){if(this.#nextImageOpening&&!this.#nextImageOpening.current())return nothing;const output=this.store.projection.get().libraryOutputs.find((candidate)=>candidate.id===this.#viewingOutputId);if(!output)return nothing;const title=this.#outputSource(output).title,fan=this.#viewerFan(output),index=Math.max(0,fan.findIndex((candidate)=>candidate.id===output.id)),fanNavigation=fan.length>1,technique=promptTechniqueDefinition(output.promptTechnique),rtl=this.matches(":dir(rtl)");return html`<dialog class="modal canvas-output-viewer" data-output-focus=${String(this.#viewerFocused)} ?open=${!this.#nextImageOpening||this.#nextImageOpening.presented} closedby="any" aria-modal="true" aria-labelledby="canvas-output-viewer-title" @keydown=${(event:KeyboardEvent)=>{if(!fanNavigation||event.defaultPrevented||event.isComposing||event.metaKey||event.ctrlKey||event.altKey||(event.key!=="ArrowLeft"&&event.key!=="ArrowRight"))return;event.preventDefault();event.stopPropagation();this.#navigateCanvasOutput(event.key===(rtl?"ArrowRight":"ArrowLeft")?-1:1,"keyboard");}} @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeCanvasOutput();}} @cancel=${(event:Event)=>{event.preventDefault();if(this.#viewerFocused){this.#setViewerFocus(false);return;}this.#closeCanvasOutput();}}><div class="modal-card canvas-output-viewer-card"><button type="button" class="icon-button canvas-viewer-focus-toggle" aria-label=${this.i18n.system(this.#viewerFocused?"Exit focus":"Focus view")} title=${this.i18n.system(this.#viewerFocused?"Exit focus":"Focus view")} aria-pressed=${this.#viewerFocused} @click=${()=>this.#setViewerFocus(!this.#viewerFocused)}>${icon(this.#viewerFocused?"collapse":"expand")}</button><button type="button" class="icon-button modal-close" aria-label="Close generated image" @click=${()=>this.#closeCanvasOutput()}>${icon("close")}</button><header><span class="canvas-dialog-step">${fanNavigation?this.i18n.system("Image {count} of {count2} · {label} approach", { count: this.i18n.number(index+1), count2: this.i18n.number(fan.length), label: technique.shortLabel }):this.i18n.system("Generated image")}</span><h2 id="canvas-output-viewer-title" dir="auto">${title}</h2>${fanNavigation?html`<p>Use the Left and Right Arrow keys to move through this fan without closing the dialog.</p>`:nothing}</header><div class="canvas-output-viewer-stage"><forma-output-visual .output=${output}></forma-output-visual>${fanNavigation?html`<button class="icon-button canvas-output-navigation previous" aria-label="Previous fan image" aria-keyshortcuts=${rtl?"ArrowRight":"ArrowLeft"} @click=${()=>this.#navigateCanvasOutput(-1,"button")}>${icon(rtl?"next":"previous")}</button><button class="icon-button canvas-output-navigation next" aria-label="Next fan image" aria-keyshortcuts=${rtl?"ArrowLeft":"ArrowRight"} @click=${()=>this.#navigateCanvasOutput(1,"button")}>${icon(rtl?"previous":"next")}</button>`:nothing}</div><footer><span>${output.width??1536} × ${output.height??1024} · ${this.i18n.system(outputQualityLabel(output))}</span><div>${!this.store.session.get()?.projectContext?html`<button type="button" class="button secondary" @click=${()=>{this.#inputOutputId=output.id;this.requestUpdate();}}>Inspect inputs</button>`:nothing}${this.#canEditCanvas()?html`<button type="button" class="button primary" @click=${()=>this.#reuseOutput(output)}>${this.i18n.t("projects.editCreator","Edit in Creator Workspace")}</button>`:nothing}<button type="button" class="button ghost" @click=${()=>this.#closeCanvasOutput()}>Done</button></div></footer></div></dialog>`;}
  #canManageSharing(){
    const session=this.store.session.get(),context=session?.projectContext;
    return !context||Boolean(session?.organizations?.some((organization)=>organization.organizationId===context.organizationId&&["owner","administrator"].includes(organization.role)));
  }
  #openSharingSettings(event:MouseEvent){
    if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return Promise.resolve(false);
    event.preventDefault();
    const trigger=event.currentTarget as HTMLElement|null;
    const element=trigger?.closest<HTMLDialogElement>('dialog[aria-labelledby="canvas-members-title"]');
    if(!trigger||!element||element.closest("forma-canvas-surface")!==this)return Promise.resolve(false);
    const scope=this.#currentControlsScope(),opener=this.querySelector<HTMLElement>(`#${this.#viewTriggerId}`);
    return navigateInApp(this,navigation=>{
      if(!navigation.closePresentation(()=>{
        this.#memberOpen=false; element.close(); this.requestUpdate();
      }))return false;
      return navigation.route("/settings/workspaces");
    },{presentation:{owner:this,element,trigger,
      current:()=>this.#memberOpen&&Boolean(scope)&&scope===this.#currentControlsScope()&&this.#canManageSharing()
        &&this.querySelector('dialog[aria-labelledby="canvas-members-title"]')===element,
      ...(opener?{opener}:{})}});
  }
  #memberDialog(){const session=this.store.session.get(),context=session?.projectContext;const canManage=this.#canManageSharing();const role=context?this.i18n.t(`workspace.admin.role.${context.role}`,context.role):"";return html`<dialog class="modal" open closedby="any" aria-labelledby="canvas-members-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget){this.#memberOpen=false;this.requestUpdate();}}}><div class="modal-card canvas-compact-dialog"><button type="button" class="icon-button modal-close" @click=${()=>{this.#memberOpen=false;this.requestUpdate();}} aria-label=${this.i18n.t("action.close","Close")}>${icon("close")}</button><h2 id="canvas-members-title">${this.i18n.t("projects.sharingHeading","Project sharing")}</h2><p>${canManage?this.i18n.t("projects.sharingDescription","Invite people to an organization, share this project, and manage viewer or editor access in Creator Workspace settings."):this.i18n.t("projects.sharingCurrentRole","Your project role is {role}. A project administrator manages Canvas access.",{role})}</p><p>${this.i18n.t("projects.sharingCanvasLimitation","Invited collaborators can use shared documents and outputs. Canvas boards are available when a project administrator grants Canvas access.")}</p>${canManage?html`<a class="button primary" href="/settings/workspaces" @click=${(event:MouseEvent)=>void this.#openSharingSettings(event)}>${this.i18n.t("projects.openSharingSettings","Open sharing in Creator Workspace")}</a>`:nothing}</div></dialog>`;}
  #editDialog(){return html`<dialog class="modal" open closedby="any" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget){this.#editOpen=false;this.requestUpdate();}}}><form class="modal-card canvas-compact-dialog" @submit=${(event:SubmitEvent)=>{event.preventDefault();void this.#saveEdit();}} @keydown=${(event:KeyboardEvent)=>{if(!event.isComposing&&event.key==="Enter"&&(event.metaKey||event.ctrlKey)){event.preventDefault();event.stopPropagation();(event.currentTarget as HTMLFormElement).requestSubmit();}}}><button type="button" class="icon-button modal-close" @click=${()=>{this.#editOpen=false;this.requestUpdate();}} aria-label="Close">${icon("close")}</button><h2>Edit shared context</h2><p>This content remains reusable across the project, independent of its position on this board.</p><forma-ui-rich-text label="Creative instruction" .value=${this.#editValue} .rows=${7} help="Command or Control plus Enter saves this shared context." @forma-input=${(event:CustomEvent<{value:string}>)=>{this.#editValue=event.detail.value;}}></forma-ui-rich-text><footer><button type="button" class="button ghost" @click=${()=>{this.#editOpen=false;this.requestUpdate();}}>Cancel</button><button type="submit" class="button primary">Save</button></footer></form></dialog>`;}
  #closeSemantic(){
    const dialog=this.querySelector<HTMLDialogElement>("dialog.modal:has(> .canvas-semantic-dialog)");
    if(dialog?.isConnected&&dialog.closest("forma-canvas-surface")===this&&dialog.open)dialog.close();
    this.#semanticOpen=false;this.requestUpdate();
  }
  #semanticDialog(items:CanvasItem[]){return html`<dialog class="modal" open closedby="any" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeSemantic();}}><div class="modal-card canvas-semantic-dialog"><button class="icon-button modal-close" @click=${()=>this.#closeSemantic()} aria-label="Close">${icon("close")}</button><h2>Board reading order</h2><p>Every spatial item remains available without pointer input.</p><ol>${items.map((item)=>{const title=this.#itemTitle(item);return html`<li><button @click=${(event:MouseEvent)=>{this.#select(item.id,event);this.#closeSemantic();}}><b>${title}</b><span>${item.blockType||item.sourceKind}</span><small>${canvasItemAccessibleName({...item,title})}</small></button></li>`;})}</ol></div></dialog>`;}
  #proposals(){if(this.store.session.get()?.projectContext)return html`<section class="canvas-page canvas-proposals page-pad"><header class="page-header"><div class="page-header-copy"><h1>${this.i18n.t("canvas.proposals.personalOnly","Report space is available in your own projects")}</h1><p>${this.i18n.t("canvas.proposals.sharedUnavailable","Shared boards synchronize their content directly. Arrangement proposals remain available only in your personal projects.")}</p></div><div class="page-header-actions"><a class="button secondary" href="/canvas" @click=${(event:MouseEvent)=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;event.preventDefault();this.#leave("/canvas");}}>${this.i18n.t("canvas.proposals.returnBoards","Return to project boards")}</a></div></header></section>`;const canvas=this.store.canvasProjection.get();const focusedId=canvasProposalIdFromRoute(this.store.route.get());const proposals=focusedId?canvas.proposals.filter((item)=>item.id===focusedId):canvas.proposals;return html`<section class="canvas-page canvas-reports page-pad"><header class="page-header page-header--hero page-header--canvas"><div class="page-header-copy"><h1>Suggested arrangements</h1><p>Agent work stays adjacent to the project until a person chooses to bring it onto a board.</p></div><div class="page-header-actions"><button class="button secondary" @click=${()=>this.#leave("/canvas")}>Open boards</button></div></header>${proposals.length?html`<div class="canvas-reports-grid">${proposals.map((proposal)=>html`<article><span>${proposal.agent}</span><h2>${proposal.title}</h2><p>${proposal.summary}</p><small>${proposal.itemIds.length} cited items · ${proposal.status}</small>${this.#canEditCanvas()?html`<div><button class="button primary" ?disabled=${proposal.status==="accepted"} @click=${()=>this.#commit([{type:"ProposalAccepted",payload:{canvas_id:proposal.canvasId,project_id:proposal.projectId,proposal_id:proposal.id,item_ids:proposal.itemIds}}])}>Accept</button><button class="button secondary" ?disabled=${proposal.status==="rejected"} @click=${()=>this.#commit([{type:"ProposalRejected",payload:{canvas_id:proposal.canvasId,project_id:proposal.projectId,proposal_id:proposal.id,reason:"user-declined-arrangement"}}])}>Reject</button>${proposal.status!=="open"?html`<button class="text-button" @click=${()=>this.#commit([{type:"ProposalRestored",payload:{canvas_id:proposal.canvasId,project_id:proposal.projectId,proposal_id:proposal.id}}])}>Restore</button>`:nothing}</div>`:nothing}</article>`)}</div>`:html`<div class="canvas-empty"><h2>No suggestions waiting</h2><p>Ask Forma from a board when you want help finding a productive next move.</p></div>`}</section>`;}
  override render(){const path=this.store.route.get();const session=this.store.session.get();if(!session)return html`<section class="canvas-page canvas-gate page-pad"><p role="status">Checking Canvas availability…</p></section>`;if(!session.canvas.access)return html`<section class="canvas-page canvas-gate page-pad"><header class="page-header page-header--hero page-header--canvas"><div class="page-header-copy"><h1>Canvas is in internal review</h1><p>The server has not opened this spatial workspace for your role. ${session.canvas.blockedBy.length?this.i18n.system("{count} governance {label}.", { count: this.i18n.number(session.canvas.blockedBy.length), label: session.canvas.blockedBy.length===1 ? this.i18n.system("requirement remains") : this.i18n.system("requirements remain") }):this.i18n.system("Your account role is not eligible for Canvas.")}</p></div><div class="page-header-actions"><a class="button secondary" href="/projects">Return to projects</a>${session.capabilities?.some((capability)=>capability==="platform.release.approve"||capability==="platform.policy.manage")?html`<a class="button primary" href="/operations/canvas">Review Canvas governance</a>`:nothing}</div></header><div class="canvas-gate-requirements">${session.canvas.requirements.map((item)=>html`<article><span>${item.approved?this.i18n.system("Approved"):this.i18n.system("Pending")}</span><h2>${item.label}</h2><p>${item.summary}</p></article>`)}</div></section>`;if(path.startsWith("/canvas/proposals"))return this.#proposals();return canvasIdFromRoute(path)?this.#workspace():this.#listing();}
}

if(!customElements.get("forma-canvas-surface"))customElements.define("forma-canvas-surface",CanvasApplication);
