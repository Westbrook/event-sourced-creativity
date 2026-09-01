import type { FormaElement } from "./forma-element";
import type { OutputNavigationFocusLease } from "./output-navigation-focus";
import type { AssignedReviewTask, CapturedSourceOwnership } from "../state/store";

/** One current read-only presentation, not an exemption for its owner's work. */
export type NavigationPresentation = {
  readonly owner:FormaElement;
  readonly element:HTMLElement;
  readonly trigger:HTMLElement;
  current():boolean;
  /** The exact known native opener, when this presentation records one. */
  readonly opener?:HTMLElement;
};
/** Only an already-admitted native close may retain this exact readonly parent obligation. */
export type NavigationClosingPresentation = {
  readonly presentation:NavigationPresentation;
  readonly parent:FormaElement;
  /** Shell exposes the captured route only after its one native Library-root cleanup. */
  readonly originalRoute?:string;
  closedCurrent():boolean;
};
export type NavigationNativeCloseOptions = {
  readonly parent:FormaElement;
  closedCurrent():boolean;
  /** The exact current Library viewer's own root, never an arbitrary destination. */
  readonly afterCloseRoute?:string;
};

export type NavigationRefusal = "current-work"|"unavailable";
export type NavigationPresentationContext = {
  readonly presentation?:NavigationPresentation;
  /** The same admitted readonly presentation, only while its original native close is joined. */
  readonly closingPresentation?:NavigationClosingPresentation;
  /** The existing Shell notice was actually reported; optional callers retain its reason. */
  readonly onRefusal?:(reason:NavigationRefusal)=>void;
};

function navigationPresentationVisible(element:HTMLElement):boolean {
  const style=element.ownerDocument.defaultView?.getComputedStyle(element);
  return Boolean(style&&element.getClientRects().length>0&&style.display!=="none"
    &&style.visibility!=="hidden"&&style.visibility!=="collapse"&&style.contentVisibility!=="hidden");
}

/** Structural admission only; Shell also verifies its exact origin and Store. */
export function navigationPresentationCurrent(presentation:NavigationPresentation):boolean {
  const {owner,element,trigger}=presentation;
  try{
    const dialog=trigger.closest<HTMLDialogElement>("dialog");
    return owner.isConnected&&element.isConnected&&trigger.isConnected
      &&element.ownerDocument===owner.ownerDocument&&trigger.ownerDocument===owner.ownerDocument
      &&owner.contains(element)&&element.contains(trigger)
      &&!element.closest("[hidden],[inert]")&&!trigger.closest("[hidden],[inert]")
      &&!trigger.matches(":disabled")&&trigger.getAttribute("aria-disabled")!=="true"
      &&navigationPresentationVisible(element)&&navigationPresentationVisible(trigger)
      &&(element.tagName!=="DIALOG"||(element as HTMLDialogElement).open)
      &&(!dialog||dialog.open)&&presentation.current();
  }catch{return false;}
}

/** Initial visibility is unchanged; this recognizes only the subsequent owned native close. */
export function navigationPresentationClosing(context:NavigationPresentationContext|undefined,owner:FormaElement):boolean{
  const closing=context?.closingPresentation,presentation=closing?.presentation;
  try{return Boolean(closing&&presentation?.owner===owner&&owner.isConnected&&closing.parent.isConnected
      &&closing.parent.contains(owner)&&presentation.element.ownerDocument===owner.ownerDocument
      &&closing.parent.ownerDocument===owner.ownerDocument&&presentation.element.tagName==="DIALOG"
      &&!(presentation.element as HTMLDialogElement).open&&closing.closedCurrent());
  }catch{return false;}
}

/** Subtract exactly the admitted node; another presentation is still a blocker. */
export function navigationPresentationMatches(context:NavigationPresentationContext|undefined,owner:FormaElement,element:Element|null):boolean {
  const presentation=context?.presentation;
  return Boolean(presentation&&presentation.owner===owner&&presentation.element===element
    &&navigationPresentationCurrent(presentation));
}
export function hasBlockingNavigationDialog(ownerDocument:Document,context?:NavigationPresentationContext):boolean {
  const presentation=context?.presentation;
  return [...ownerDocument.querySelectorAll("dialog[open]")].some(element=>!presentation
    ||!navigationPresentationMatches(context,presentation.owner,element));
}

/** Join one actual native close after its original target handlers and a later task. */
export function joinNativeDialogClose(element:HTMLDialogElement,options:{
  current():boolean;
  close():void;
  closing(value:boolean):void;
  returned():void;
  cancellation(value:(()=>void)|null):void;
}):Promise<boolean>{
  return new Promise<boolean>(resolve=>{
    let finished=false,task=0,closing=false;
    const finish=(ok:boolean)=>{
      if(finished)return;finished=true;
      element.removeEventListener("close",onCloseStart,true);
      element.removeEventListener("close",onCloseEnd,false);
      if(task)window.clearTimeout(task);
      closing=false;options.closing(false);options.cancellation(null);resolve(ok);
    };
    const onCloseStart=(event:Event)=>{
      if(event.target!==element||event.currentTarget!==element)return;
      element.removeEventListener("close",onCloseStart,true);
      if(!element.open){closing=true;options.closing(true);}
    };
    const onCloseEnd=(event:Event)=>{
      if(event.target!==element||event.currentTarget!==element)return;
      element.removeEventListener("close",onCloseEnd,false);
      if(element.open||!closing){finish(false);return;}
      // This listener follows the existing target handlers. Only their exact
      // native-close chain may perform an expected parent route consequence.
      const owned=options.current();closing=false;options.closing(false);
      if(!owned){finish(false);return;}
      // A capture-listener microtask can precede native target callbacks.
      task=window.setTimeout(()=>{task=0;finish(options.current());},0);
    };
    options.cancellation(()=>finish(false));
    element.addEventListener("close",onCloseStart,true);
    element.addEventListener("close",onCloseEnd,false);
    try{options.close();}catch{finish(false);}finally{options.returned();}
  });
}

/** One actual view's admission, never raw draft data, permission or receipt evidence. */
export type CommandDeparture = {
  readonly element:FormaElement;
  current(context?:NavigationPresentationContext):boolean;
  blocked(context?:NavigationPresentationContext):boolean;
  /** Existing localized owner guidance; resolved by the caller in its current locale. */
  reason():string;
};
export type LocalNavigation = CommandDeparture & {
  prepare():boolean;
  afterCommit?(arrival:{current():boolean;readonly focus:OutputNavigationFocusLease}):void|Promise<void>;
};
export type CommandDepartureOwner = FormaElement & {
  captureCommandDeparture():CommandDeparture;
  captureLocalNavigation?(path:string):LocalNavigation|null;
};
export type InAppNavigationAction = ((navigation:InAppNavigation)=>unknown)|{readonly localRoute:string};

/** One admitted UI gesture; the caller still invokes its existing Store operation. */
export type InAppNavigation = {
  current():boolean;
  readonly focus:OutputNavigationFocusLease;
  /** Add exact destination targets to this same lease, only after its Store-owned route commit. */
  bindDestinationFocus(allowed:(element:Element)=>boolean):boolean;
  onOriginHandoff():boolean;
  /** Bind the one Store-issued Source after this gesture's positive owned adoption. */
  onDestinationSource(source:CapturedSourceOwnership):boolean;
  /** Reuse the current assigned-review handoff and exact native viewer arrival. */
  openAssignedReview(task:AssignedReviewTask):Promise<boolean>;
  /** Close only the admitted presentation, once, before requesting its destination. */
  closePresentation(close:()=>void):boolean;
  /** Join the admitted native close and its exact parent cleanup without renewing this gesture. */
  closeNativePresentation(close:(current:()=>boolean)=>void,options:NavigationNativeCloseOptions):Promise<boolean>;
  route(path:string,preferences?:{documentFocus?:boolean;replace?:boolean}):boolean|Promise<boolean>;
};
type InAppNavigationHost = FormaElement & {
  navigateFrom(origin:FormaElement,run:InAppNavigationAction,context?:NavigationPresentationContext):Promise<boolean>;
};

/** Only actual connected Shell compositions own this ordinary-navigation admission. */
export function navigateInApp(origin:FormaElement,run:InAppNavigationAction,context:NavigationPresentationContext={}):Promise<boolean>{
  const host=origin.closest<InAppNavigationHost>("forma-shell");
  return host?host.navigateFrom(origin,run,context):Promise.resolve(false);
}
