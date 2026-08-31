import { documentContextBlockFromRoute, documentIdFromRoute } from "../model/routes";
import type { FormaStore } from "../state/store";
import { FormaElement } from "./forma-element";
import { joinNativeDialogClose, navigateInApp, navigationPresentationCurrent, type NavigationPresentation } from "./command-departure";
import { captureOutputNavigationFocus, outputNavigationOwnedRouteFocus, type OutputNavigationFocusLease } from "./output-navigation-focus";

/** One owner's transient completion slot, never a copy receipt or retained draft. */
export type ManualOutputReuse = { cancel:(()=>void)|null };
type ReuseResult = Awaited<ReturnType<FormaStore["addImageOutputAsContext"]>>
  | Awaited<ReturnType<FormaStore["addArtifactAsContext"]>>;
type ManualReuseOptions = {
  destinationDocumentId:string;
  /** The exact current source item and host binding, independent of its own close. */
  current():boolean;
  copy():Promise<ReuseResult>;
  presentation? : NavigationPresentation & {
    // The exact original gesture also governs inherited close focus.
    close(current:()=>boolean):void;
    /** Own close is allowed, but a newly opened presentation never is. */
    closedCurrent():boolean;
    /** Only the captured Library artifact viewer's native close has a route. */
    afterCloseRoute?:string;
  };
};

/** Admit the actual origin before copying; only that original gesture may reveal. */
export async function reuseManualOutput(origin:FormaElement,store:FormaStore,slot:ManualOutputReuse,event:MouseEvent,options:ManualReuseOptions):Promise<boolean>{
  const trigger=event.currentTarget as HTMLElement|null,presentation=options.presentation;
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey
    ||!trigger||!FormaElement.hasStoreIdentity(origin,store)
    ||presentation&&(presentation.owner!==origin||presentation.trigger!==trigger)
    ||!navigationPresentationCurrent(presentation??{owner:origin,element:trigger,trigger,current:options.current}))return false;
  event.preventDefault();
  let pending:Promise<boolean>|undefined;
  const run=async()=>{
    slot.cancel?.();
    const route=store.route.get(),{projectId,documentId:originDocumentId}=store.projection.get();
    const documentId=options.destinationDocumentId,opener=presentation?.opener;
    const source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
    let retired=false,closedOwn=false,closeReturned=false,closingOwn=false,transferred=false,targetBlockId="",expectedRoute=route;
    let cancelClose:(()=>void)|null=null;
    let unsubscribe=()=>{};
    const sourceCurrent=()=>{
      const session=store.session.get(),permissions=session?.projectContext?.permissions??session?.capabilities??[];
      const projection=store.projection.get();
      return store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization)
        &&projection.projectId===projectId&&projection.documents.some(document=>document.id===documentId&&document.projectId===projectId&&!document.removed)
        &&permissions.includes("project.read")&&permissions.includes("project.author");
    };
    const scopeCurrent=()=>{
      const path=store.route.get();
      // One synchronous native-close consequence, fixed before dispatch. Once
      // adopted, even a return to the original route cannot revive this gesture.
      if(closingOwn&&expectedRoute===route&&presentation?.afterCloseRoute===path)expectedRoute=path;
      return origin.isConnected&&FormaElement.hasStoreIdentity(origin,store)&&path===expectedRoute
        &&store.projection.get().documentId===originDocumentId&&sourceCurrent();
    };
    const focus:OutputNavigationFocusLease=captureOutputNavigationFocus(origin.ownerDocument,{ownedRouteFocus:element=>{
      if(closedOwn&&element===opener&&opener?.isConnected&&!opener.closest("[hidden],[inert]")
        &&!opener.matches(":disabled")&&scopeCurrent())return true;
      if(!transferred||!targetBlockId||!sourceCurrent())return false;
      const path=store.route.get(),arrival=store.captureWorkspaceNavigationFocus(path,focus);
      const current=()=>Boolean(arrival?.routeCurrent())&&sourceCurrent();
      // Native close may leave this original opener focused across the exact
      // lease-owned destination commit, before its linked editor takes focus.
      if(closedOwn&&element===opener&&opener?.isConnected&&!opener.closest("[hidden],[inert]")
        &&!opener.matches(":disabled")&&current()&&documentIdFromRoute(path)===documentId
        &&documentContextBlockFromRoute(path)===targetBlockId)return true;
      return current()&&outputNavigationOwnedRouteFocus(origin.ownerDocument,store,{documentId,blockId:targetBlockId},current)(element);
    }});
    const dispose=()=>{
      retired=true;unsubscribe();cancelClose?.();if(!transferred)focus.dispose();
      if(slot.cancel===dispose)slot.cancel=null;
    };
    const current=()=>{
      try{
        // Disabled after dispatch may be this original request's pending UI.
        // Initial enabled/visible admission was already checked above by Shell.
        if(!retired&&slot.cancel===dispose&&scopeCurrent()&&options.current()&&focus.current()
          &&(!presentation||closedOwn&&(!closeReturned||presentation.closedCurrent())||!closedOwn&&presentation.element.isConnected&&origin.contains(presentation.element)
            &&(presentation.element.tagName!=="DIALOG"||(presentation.element as HTMLDialogElement).open)
            &&presentation.current()))return true;
      }catch{/* Retired original work cannot acquire a new item, Source or presentation. */}
      dispose();return false;
    };
    slot.cancel=dispose;
    unsubscribe=store.subscribe(()=>{if(!current())dispose();});
    try{
      if(!current())return false;
      const result=await options.copy();
      if(!result||"publication"in result||!result.rootBlockId||!current())return false;
      if(presentation){
        closedOwn=true;
        if(presentation.element.tagName==="DIALOG"){
          const element=presentation.element as HTMLDialogElement;
          // close() changes open synchronously; the browser queues its close
          // event. Join that exact native event before parent close/route work
          // can race a fresh reveal. Cancellation settles this join as false.
          const closed=await joinNativeDialogClose(element,{
            current,close:()=>presentation.close(current),closing:value=>{closingOwn=value;},
            returned:()=>{closeReturned=true;},cancellation:value=>{cancelClose=value;},
          });
          if(!closed||element.open)return false;
        }else{presentation.close(current);closeReturned=true;}
        if(!current())return false;
      }
      targetBlockId=result.rootBlockId;transferred=true;unsubscribe();
      // The existing Store reveal owns this same lease after the one immediate
      // original-current check, including refusal and deferred native cleanup.
      return await store.revealOutputInput(targetBlockId,documentId,{current,focus});
    }finally{dispose();}
  };
  await navigateInApp(origin,()=>{
    // Do not retain the broad raw-owner predicate across the copy's legitimate
    // canonical publication. Its own original completion was captured before await.
    pending=run();return true;
  },presentation?{presentation}:{});
  return pending?await pending:false;
}
