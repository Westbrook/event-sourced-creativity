import type { FormaOutputRequirements } from "./forma-output-requirements";
import type { InAppNavigation } from "./command-departure";
import { outputNavigationMatches, type OutputNavigationReference, type OutputNavigationSection } from "../model/output-navigation";
import { documentContextBlockRoute, documentIdFromRoute, withDocumentInRoute } from "../model/routes";
import type { CapturedAuthorizationScope, FormaStore } from "../state/store";
import { captureOutputNavigationFocus, outputNavigationOwnedRouteFocus } from "./output-navigation-focus";

/** An exact existing Output address, not a new action, read, or execution grant. */
export type OutputReferenceDestination = {
  readonly reference: OutputNavigationReference;
  readonly section: OutputNavigationSection;
};
export type OutputReferenceNavigationOwner = {
  readonly authorization: CapturedAuthorizationScope | null;
  /** Optional existing Shell admission; its caller retains disposal through the whole arrival. */
  readonly navigation?:InAppNavigation;
  /** The caller's original route, source, selection, opening and exact read still own the handoff. */
  readonly originCurrent: () => boolean;
  /** The same opening remains owned after its deliberate transition may unmount the origin. */
  readonly navigationCurrent: () => boolean;
};

/** Existing Store transition and exact destination controller only; no refresh or fallback. */
export async function openOutputReferenceDestination(
  store: FormaStore, ownerDocument: Document, target: OutputReferenceDestination,
  owner: OutputReferenceNavigationOwner,
): Promise<boolean> {
  const reference=target.reference,{authorization,originCurrent,navigationCurrent,navigation:admission}=owner;
  const admittedOriginCurrent=()=>originCurrent()&&(!admission||admission.current());
  const targetDocument=store.projection.get().documents.find(value=>value.id===reference.documentId&&value.projectId===reference.projectId);
  if(!targetDocument)return false;
  if(!admittedOriginCurrent())return false;
  const destination=reference.blockId?documentContextBlockRoute(reference.documentId,targetDocument.title,reference.blockId)
    :withDocumentInRoute("/",reference.documentId,targetDocument.title);
  let arrived="";
  const destinationIdentityCurrent=()=>{
    const resource=store.outputRequirements.resource(reference.documentId),projection=store.projection.get();
    return navigationCurrent()&&store.route.get()===arrived&&documentIdFromRoute(arrived)===reference.documentId
      &&store.authorizationScopeActive(authorization)&&projection.projectId===reference.projectId&&projection.documentId===reference.documentId
      &&projection.documents.some(value=>value.id===reference.documentId&&!value.removed)
      &&resource.state==="ready"&&!resource.accessLost&&!resource.privateUnavailable
      &&outputNavigationMatches(reference,resource.snapshot,store.captureAuthorizationScope()?.key??"")
      &&!document.querySelector("dialog[open]");
  };
  const ownedRouteFocus=outputNavigationOwnedRouteFocus(ownerDocument,store,reference,destinationIdentityCurrent);
  const focus=admission?.focus??captureOutputNavigationFocus(ownerDocument,{ownedRouteFocus});
  if(admission&&!admission.bindDestinationFocus(ownedRouteFocus))return false;
  try{
    if(!await store.transitionWorkspace(destination,{documentFocus:false,current:admittedOriginCurrent,focus,
      ...(admission?{onOriginHandoff:admission.onOriginHandoff,onDestinationSource:admission.onDestinationSource}:{})}))return false;
    arrived=store.route.get();
    const navigation=store.captureWorkspaceNavigationFocus(arrived,focus);
    const destinationCurrent=()=>destinationIdentityCurrent()&&(!admission||admission.current())&&Boolean(navigation?.current());
    // The deliberate transition may disconnect the origin. The destination owns
    // focus now; unrelated later navigation or authority changes still invalidate it.
    for(let attempt=0;attempt<24&&destinationCurrent();attempt++){
      await new Promise<void>(resolve=>window.requestAnimationFrame(()=>resolve()));
      if(!destinationCurrent())return false;
      const controllers=[...document.querySelectorAll<FormaOutputRequirements>("forma-output-requirements")]
        .filter(controller=>controller.isConnected&&controller.documentId===reference.documentId&&controller.surface==="document"
          &&(reference.kind==="requirement"?controller.blockId===reference.blockId:!controller.blockId));
      if(controllers.length>1)return false;
      if(controllers.length===1){
        await controllers[0].updateComplete;if(!destinationCurrent())return false;
        return await controllers[0].focusOutputReference(reference,{section:target.section,current:destinationCurrent,focus});
      }
    }
    return false;
  }finally{if(!admission)focus.dispose();}
}
