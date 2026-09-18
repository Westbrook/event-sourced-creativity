import type { FormaStore } from "../state/store";
import { nextActionFacts } from "../state/next-action-context";
import { creativeActionSourceRevision, creativeNextActions, creativeNextTargetAvailable, followCreativeNextTarget,
  type CreativeNextAction, type CreativeNextPorts, type CreativePreparationStage } from "../model/workspace-intelligence";
import { documentContextBlockRoute, documentIdFromRoute, libraryFocusFromRoute, artifactFocusOptionsFromRoute, withDocumentInRoute } from "../model/routes";
import type { FormaWorkspace } from "./forma-workspace";
import type { FormaLibrary } from "./forma-library";
import type { FormaOutputRequirements } from "./forma-output-requirements";
import type { ContextBlock } from "./context-block";
import { FormaElement } from "./forma-element";
import { openOutputReferenceDestination } from "./output-reference-navigation";
import { navigateInApp, type InAppNavigation, type NavigationRefusal } from "./command-departure";
import { captureOutputNavigationFocus, outputNavigationOwnedRouteFocus } from "./output-navigation-focus";

export type CreativeNextActionNavigationOwner = {
  /** The actual connected caller, never an inferred or synthetic clean owner. */
  readonly origin:FormaElement;
  /** Preserve a genuinely reported shared refusal instead of replacing its recovery guidance. */
  readonly onRefusal?:(reason:NavigationRefusal)=>void;
  /** Original connected route/pane/selection and all retained draft owners, before the intentional handoff. */
  originCurrent: () => boolean;
  /** Same caller request across its own intentional unmount; never a new source or descriptor. */
  navigationCurrent: () => boolean;
};

/** Stateless exact opening only. Existing controllers own all reads, drafts, approvals and execution. */
export async function openCreativeNextActionDestination(
  store: FormaStore, ownerDocument: Document, action: CreativeNextAction, owner: CreativeNextActionNavigationOwner,
): Promise<boolean> {
  return openCreativeDestination(store,ownerDocument,action,owner,true);
}

/** An explicit existing preparation choice, not a claim that it is the current recommendation. */
export type SelectedCreativePreparationTarget = Extract<import("../model/workspace-intelligence").CreativeNextTarget,
  {kind:"context"|"configure"|"compare"}>;
export async function openSelectedCreativePreparationDestination(
  store:FormaStore,ownerDocument:Document,target:SelectedCreativePreparationTarget,owner:CreativeNextActionNavigationOwner,
):Promise<boolean>{
  if(!target||!(target.kind==="context"||target.kind==="configure"||target.kind==="compare"))return false;
  return openCreativeDestination(store,ownerDocument,
    {id:target.kind==="context"?"add-context":target.kind==="compare"?"compare-images":"configure-output",
      label:"",reason:"",title:"",priority:0,evidence:0,target},owner,false);
}

/** Both public entries use this one source/authority/route/focus/arrival implementation. */
async function openCreativeDestination(
  store:FormaStore,ownerDocument:Document,action:CreativeNextAction,owner:CreativeNextActionNavigationOwner,requireRecommendation:boolean,
):Promise<boolean>{
  const shell=owner.origin?.closest<FormaElement>("forma-shell");
  if(!owner.origin?.isConnected||owner.origin.ownerDocument!==ownerDocument||!shell?.isConnected
    ||!FormaElement.hasStoreIdentity(owner.origin,store)||!FormaElement.hasStoreIdentity(shell,store))return false;
  const target=action.target,signature=JSON.stringify(target),source=store.captureSourceOwnership();
  const authorization=store.captureAuthorizationScope(),originRoute=store.route.get(),origin=store.projection.get();
  if(target.canvasId!==null||target.sourceGeneration===undefined||!source||target.sourceGeneration!==source.generation
    ||!authorization||authorization.key!==target.authorityKey)return false;
  const facts=()=>nextActionFacts(store,target.documentId,null,{lifecycle:true});
  const initialFacts=facts(),sourceRevision=creativeActionSourceRevision(initialFacts);
  const scopeCurrent=()=>JSON.stringify(action.target)===signature&&store.sourceOwnershipActive(source)
    &&store.authorizationScopeActive(authorization)&&store.projection.get().projectId===target.projectId
    &&store.projection.get().documents.some(value=>value.id===target.documentId&&value.projectId===target.projectId&&!value.removed);
  const recommended=()=>{const current=facts();return creativeActionSourceRevision(current)===sourceRevision
    &&creativeNextTargetAvailable(target,current)&&(!requireRecommendation
      ||creativeNextActions(current).some(value=>value.id===action.id&&JSON.stringify(value.target)===signature));};
  const originCurrent=()=>scopeCurrent()&&owner.originCurrent()&&store.route.get()===originRoute
    &&store.projection.get().projectId===origin.projectId&&store.projection.get().documentId===origin.documentId&&recommended();
  if(!originCurrent()||ownerDocument.querySelector("dialog[open]"))return false;

  const document=origin.documents.find(value=>value.id===target.documentId&&value.projectId===target.projectId&&!value.removed);
  if(!document)return false;
  const blockId=target.kind==="source-block"||target.kind==="output-requirement"?target.blockId:null;
  const destination=blockId?documentContextBlockRoute(target.documentId,document.title,blockId)
    :withDocumentInRoute("/",target.documentId,document.title);
  // Only these existing preparation receivers can remain in the exact current
  // Workspace without retiring any route-scoped sibling. A path kind is not proof.
  const workspaces=()=>[...ownerDocument.querySelectorAll<FormaWorkspace>("forma-workspace")]
    .filter(value=>value.isConnected&&value.closest("forma-creative-application")?.closest("forma-shell")===shell
      &&FormaElement.hasStoreIdentity(value,store));
  const initialWorkspaces=workspaces();
  const retainedWorkspace=(target.kind==="context"||target.kind==="configure"||target.kind==="compare")
    &&originRoute===destination&&origin.documentId===target.documentId&&initialWorkspaces.length===1?initialWorkspaces[0]:null;
  const sameWorkspaceCurrent=()=>Boolean(retainedWorkspace&&retainedWorkspace.isConnected&&store.route.get()===originRoute
    &&store.projection.get().documentId===target.documentId&&workspaces().length===1&&workspaces()[0]===retainedWorkspace);
  const open=async(navigation?:InAppNavigation):Promise<boolean>=>{
    const admittedOriginCurrent=()=>originCurrent()&&(!navigation||navigation.current());
    if(!admittedOriginCurrent())return false;
    // The canonical bridge uses this same admitted lease, or its unchanged default ownership.
    if(target.kind==="canonical-output"&&!target.refresh){
      try{return await openOutputReferenceDestination(store,ownerDocument,
        {reference:target.reference,section:target.section},{authorization,originCurrent:admittedOriginCurrent,navigation,
          navigationCurrent:()=>scopeCurrent()&&owner.navigationCurrent()&&recommended()
            &&[...ownerDocument.querySelectorAll<FormaOutputRequirements>("forma-output-requirements")]
              .filter(value=>value.isConnected&&value.surface==="document"&&value.documentId===target.documentId
                &&(target.reference.kind==="requirement"?value.blockId===target.reference.blockId:!value.blockId))
              .every(value=>FormaElement.hasStoreIdentity(value,store))});}
      catch{return false;}
    }

    let arrived="",opening=true;
    const ownedRoute=()=>Boolean(store.captureWorkspaceNavigationFocus(store.route.get(),focus));
    const destinationIdentity=()=>scopeCurrent()&&owner.navigationCurrent()&&ownedRoute()
      &&(!retainedWorkspace||sameWorkspaceCurrent())
      &&(!arrived||store.route.get()===arrived)&&store.projection.get().documentId===target.documentId;
    const blockFocus=outputNavigationOwnedRouteFocus(ownerDocument,store,{documentId:target.documentId,blockId},
      ()=>destinationIdentity()&&recommended());
    const ownedDestinationFocus=(element:Element)=>{
      if(!destinationIdentity())return false;
      if(blockFocus(element))return true;
      if(element===shell.querySelector("#main-content"))return true;
      // Direct explicit media preparation moves to this pane before opening its
      // existing child. It is a bounded route-owned target, not a new focus lease.
      if(target.kind==="configure"&&target.medium&&element.isConnected&&recommended()){
        const workspace=element.closest<FormaWorkspace>("forma-workspace");
        if(workspace?.isConnected&&FormaElement.hasStoreIdentity(workspace,store)
          &&documentIdFromRoute(store.route.get())===target.documentId
          &&element===workspace.querySelector<HTMLElement>('[data-workbench-pane="result"]')
          &&element.getAttribute("aria-pressed")==="true")return true;
      }
      const dialog=element.closest<HTMLDialogElement>("dialog");if(!dialog)return false;
      if(target.kind==="assigned-review"){
        const parsed=libraryFocusFromRoute(store.route.get()),options=artifactFocusOptionsFromRoute(store.route.get());
        const library=dialog.closest<FormaLibrary>("forma-library"),viewer=dialog.closest("forma-document-artifacts");
        return Boolean(parsed?.kind==="artifact"&&parsed.id===target.artifactId&&options&&options!=="invalid"
          &&options.expectedRevision===target.revision&&options.expectedContentSha256===target.contentSha256
          &&library?.isConnected&&FormaElement.hasStoreIdentity(library,store)&&viewer?.documentId===target.documentId
          &&dialog.matches(".document-artifact-view"));
      }
      const workspace=dialog.closest<FormaWorkspace>("forma-workspace");
      if(!workspace?.isConnected||!FormaElement.hasStoreIdentity(workspace,store)||documentIdFromRoute(store.route.get())!==target.documentId)return false;
      if(target.kind==="context")return dialog.matches(".block-composer-dialog");
      if(target.kind==="configure")return dialog.matches(".next-format-dialog,.generation-details-dialog,.document-artifact-create");
      if(target.kind==="compare")return dialog.matches(".comparison-modal")&&store.ui.comparisonOutputIds===target.outputIds.join("|");
      if(target.kind==="output")return dialog.matches(".generated-image-viewer")
        &&dialog.getAttribute("aria-labelledby")==="generated-image-title-"+target.outputId;
      if(target.kind==="artifact"||target.kind==="artifact-delivery")return dialog.matches(".document-artifact-view")
        &&dialog.closest("forma-document-artifacts")?.documentId===target.documentId;
      return target.kind==="job"&&dialog.matches(".generation-input-dialog")
        &&dialog.closest("forma-document-artifacts")?.documentId===target.documentId;
    };
    const focus=navigation?.focus??captureOutputNavigationFocus(ownerDocument,{ownedRouteFocus:ownedDestinationFocus});
    if(navigation&&!navigation.bindDestinationFocus(ownedDestinationFocus))return false;
    const current=(stage:CreativePreparationStage="opening")=>destinationIdentity()
      &&(stage==="editing"||!opening||(!navigation||navigation.current())&&focus.current()&&recommended());
    const waitFor=async<T extends HTMLElement>(selector:string,accept:(value:T)=>boolean):Promise<T|null>=>{
      for(let attempt=0;attempt<24&&current();attempt++){
        await new Promise<void>(resolve=>window.requestAnimationFrame(()=>resolve()));
        if(!current())return null;
        const matches=[...ownerDocument.querySelectorAll<T>(selector)].filter(value=>value.isConnected&&accept(value));
        if(matches.length>1)return null;
        if(matches.length===1)return matches[0];
      }
      return null;
    };
    const transition=async()=>{
      if(retainedWorkspace&&!sameWorkspaceCurrent())return false;
      if(!await store.transitionWorkspace(destination,{documentFocus:false,current:admittedOriginCurrent,focus,
        ...(navigation?{onOriginHandoff:navigation.onOriginHandoff,onDestinationSource:navigation.onDestinationSource}:{})}))return false;
      arrived=store.route.get();return documentIdFromRoute(arrived)===target.documentId&&current();
    };
    const local=async()=>{
      if(!await transition())return false;
      const workspace=await waitFor<FormaWorkspace>("forma-workspace",value=>FormaElement.hasStoreIdentity(value,store)
        &&(!retainedWorkspace||value===retainedWorkspace));
      if(!workspace)return false;await workspace.updateComplete;if(!current())return false;
      const opened=await workspace.openCreativeNextAction(action,{current,focus});
      if(opened)opening=false;return opened&&current("editing");
    };
    const authoredRequirement=async(selected:{projectId:string;documentId:string;blockId:string})=>{
      if(!await transition())return false;
      const controller=await waitFor<FormaOutputRequirements>("forma-output-requirements",value=>FormaElement.hasStoreIdentity(value,store)
        &&value.surface==="document"&&value.documentId===selected.documentId&&value.blockId===selected.blockId);
      if(!controller)return false;
      return controller.revealAuthoredRequirement(selected,{current:()=>current(),focus});
    };
    // Required makes omissions a compile-time failure; unsupported targets never become generic navigation.
    const ports:Required<CreativeNextPorts>={
      context:local,configure:local,output:local,artifact:local,job:local,compare:local,"artifact-delivery":local,
      "source-block":async selected=>{
        // Output blocks render their existing requirement controller, not an ordinary article.
        if(initialFacts.blocks.find(value=>value.id===selected.blockId)?.type==="output")return authoredRequirement(selected);
        if(!await transition())return false;
        const controller=await waitFor<ContextBlock>(
          "forma-context-block",value=>FormaElement.hasStoreIdentity(value,store)&&value.surface==="document"&&value.block?.id===selected.blockId&&value.block.documentId===selected.documentId
            &&Boolean(ownerDocument.activeElement&&value.contains(ownerDocument.activeElement)&&blockFocus(ownerDocument.activeElement)));
        if(!controller)return false;
        const anchors=[...controller.querySelectorAll<HTMLElement>("[data-block-id]")].filter(value=>value.tagName==="ARTICLE"
          &&value.getAttribute("data-block-id")===selected.blockId&&value.closest("forma-context-block")===controller);
        const anchor=anchors.length===1?anchors[0]:null;
        return Boolean(anchor?.isConnected&&current()&&ownerDocument.activeElement===anchor&&anchor.getClientRects().length);
      },
      "assigned-review":async selected=>{
        const tasks=store.reviewInbox.get().filter(task=>task.id===selected.reviewId&&task.status==="pending"
          &&task.projectId===selected.projectId&&task.documentId===selected.documentId&&task.organizationId===selected.organizationId
          &&task.projectAccessId===selected.projectAccessId&&task.artifactId===selected.artifactId
          &&task.revision===selected.revision&&task.contentSha256===selected.contentSha256);
        if(tasks.length!==1||!await store.openAssignedReview(tasks[0],{current:admittedOriginCurrent,focus,
          ...(navigation?{onOriginHandoff:navigation.onOriginHandoff,onDestinationSource:navigation.onDestinationSource}:{})}))return false;
        arrived=store.route.get();if(!current())return false;
        const library=await waitFor<FormaLibrary>("forma-library",value=>FormaElement.hasStoreIdentity(value,store));
        if(!library)return false;
        const opened=await library.awaitArtifactRouteOpening(selected,{current:()=>current()});
        if(opened)opening=false;return opened&&current("editing");
      },
      "canonical-output":async selected=>{
        // Explicit refresh finishes on the original surface. It does not activate a stale row.
        if(!selected.refresh||!originCurrent()||!focus.current())return false;
        const refreshed=await store.outputRequirements.ensure(selected.documentId,{force:true});
        return scopeCurrent()&&owner.originCurrent()&&store.route.get()===originRoute&&focus.current()
          &&refreshed===store.outputRequirements.resource(selected.documentId)
          &&refreshed.state==="ready"&&!refreshed.accessLost&&!refreshed.privateUnavailable;
      },
      "output-requirement":authoredRequirement,
    };
    try{return await followCreativeNextTarget(target,facts,ports);}
    catch{return false;}
    finally{if(!navigation)focus.dispose();}
  };
  // Refresh is an exact read only; same-URL preparation retains the same live
  // Workspace instance. Neither branch claims a Shell departure or releases work.
  if(target.kind==="canonical-output"&&target.refresh||sameWorkspaceCurrent())return open();
  return navigateInApp(owner.origin,navigation=>open(navigation),{onRefusal:owner.onRefusal});
}
