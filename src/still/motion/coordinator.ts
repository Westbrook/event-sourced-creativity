import {constructionTransition} from './thread.js';
import {THREAD_TIMING} from './timing.js';
import {createLoadingSurface,type LoadingSurface} from './loading.js';
import {startRequestRhythm} from './request-rhythm.js';

type Upgraded=HTMLElement & {updateComplete?:Promise<unknown>;disabled?:boolean};
type Snapshot=HTMLElement & {ready?:Promise<unknown>};
type Options={ready:()=>boolean;timeout:()=>void;recovery:()=>boolean;state:()=>string;settled?:()=>void};

/** A sidecar around the real Lit dock. It never reparents live controls, owns
 * actions, waits to render page content, or starts/cancels a durable job. */
export class ToolbarMotion {
 private root?:HTMLElement;
 private live?:HTMLElement;
 private visual?:HTMLElement;
 private status?:HTMLElement;
 private loader?:LoadingSurface;
 private epoch=0;
 private abort?:AbortController;
 private clock?:ReturnType<typeof startRequestRhythm>;
 private task:Promise<unknown>=Promise.resolve();
 private phase:'idle'|'closing'|'loading'|'opening'|'paging'='idle';
 private pending=false;
 private focusId='';
 private focusParked=false;
 private lastWidth=0;
 private activation?:string;
 private activated=(event:Event)=>{
  const button=event.composedPath().find(node=>node instanceof HTMLElement&&node.localName==='en-button'&&this.live?.contains(node)) as HTMLElement|undefined;
  this.activation=button?.dataset.actionId||button?.id;
  queueMicrotask(()=>{this.activation=undefined;});
 };
 private observer=new ResizeObserver(()=>this.resize());
 private reduce=matchMedia('(prefers-reduced-motion: reduce)');
 private visibility=()=>this.clock?.sync();
 private motionPreference=()=>{if(this.phase==='opening'||this.phase==='paging')this.abort?.abort();};
 constructor(private app:HTMLElement,private options:Options){
  app.addEventListener('click',this.activated,true);
  document.addEventListener('visibilitychange',this.visibility);
  this.reduce.addEventListener('change',this.motionPreference);
 }
 get active(){return this.pending;}
 attach(){
  const root=this.app.querySelector<HTMLElement>('.toolbar-motion-root');
  if(!root)return;
  if(this.root!==root){this.root=root;this.live=root.querySelector<HTMLElement>('.toolbar-motion-live')!;this.visual=root.querySelector<HTMLElement>('.toolbar-motion-visual')!;this.status=root.querySelector<HTMLElement>('.toolbar-motion-status')!;this.observer.observe(root);this.lastWidth=root.clientWidth;}
  if(this.phase==='idle'&&this.pending)this.begin();
  this.live!.inert=this.pending&&root.hasAttribute('data-motion-active');
 }
 /** Called before a page effect, even if the eventual action list is equal. */
 begin(trigger='request'){
  trigger=this.activation||trigger;
  const from=this.root?.hasAttribute('data-motion-active')?undefined:this.snapshot();
  this.pending=true;
  if(!this.root||!this.visual)return;
  const epoch=++this.epoch;this.clock?.cancel();this.clock=undefined;this.abort?.abort();
  this.parkFocus();this.hideLive();this.phase='closing';this.root.dataset.toolbarPhase='closing';
  const prior=this.task;
  this.task=(async()=>{
   await prior;if(epoch!==this.epoch)return;
   this.visual!.replaceChildren();this.loader=createLoadingSurface(()=>this.root!.clientWidth);this.visual!.append(this.loader);this.loader.refreshWaitingSurface();
   if(from){this.visual!.prepend(from);this.abort=new AbortController();await constructionTransition({host:this.visual!,from,to:this.loader,duration:THREAD_TIMING.duration,reduced:this.reduce.matches,trigger,signal:this.abort.signal});}
   if(epoch!==this.epoch)return;
   this.phase='loading';this.root!.dataset.toolbarPhase='loading';
   this.clock=startRequestRhythm({isSuspended:()=>document.hidden,
    isReady:frame=>{if(frame.checkpointNumber>=13)this.options.timeout();return this.options.ready();},
    canOpen:frame=>!this.options.recovery()||frame.surface==='loading',
    onFrame:frame=>{
     if(epoch!==this.epoch||!this.loader)return;
     const progress=this.reduce.matches?(frame.stage==='waiting'&&!(frame.groupCycle===2&&frame.phase==='rest')?1:0):frame.waitingProgress;
     this.loader.dataset.state=progress>0?'waiting':'loading';this.loader.setWaitingProgress(progress);this.loader.setInfusionPhase({position:frame.shinePosition,opacity:this.reduce.matches?0:frame.tint});
     Object.assign(this.root!.dataset,{toolbarPhase:frame.stage,cycle:String(frame.cycleIndex+1),logicalTime:String(frame.logicalTime),openingPending:String(frame.openingPending)});
     this.announce(frame.stage==='waiting'?'Still. Waiting for your next actions.':'Finding your next actions.');
    },
    onOpen:()=>{if(epoch!==this.epoch)return;this.clock=undefined;this.task=this.open(epoch);}
   });
  })();
 }
 ensure(){if(!this.pending||this.root&&!this.root.hasAttribute('data-motion-active'))this.begin();}
 suspend(){++this.epoch;this.clock?.cancel();this.clock=undefined;this.abort?.abort();this.pending=false;this.phase='idle';this.visual?.replaceChildren();this.loader=undefined;this.reveal();this.announce('');}
 /** Flush visible time before applying an arrival, so late data cannot enter an
  * already missed left checkpoint if animation frames were delayed. */
 sync(){this.clock?.sync();}
 private announce(message:string){if(this.status&&this.status.textContent!==message)this.status.textContent=message;}
 private hideLive(){this.root!.setAttribute('data-motion-active','');this.live!.setAttribute('aria-busy','true');this.live!.inert=true;}
 private reveal(){this.root?.removeAttribute('data-motion-active');this.live?.setAttribute('aria-busy','false');if(this.live)this.live.inert=false;this.restoreFocus();}
 private parkFocus(){
  const focus=document.activeElement as HTMLElement|null;
  if(focus&&this.live?.contains(focus)){this.focusId=focus.dataset.actionId||focus.id;this.focusParked=true;this.root!.tabIndex=-1;this.root!.focus({preventScroll:true});}
  for(const item of this.live?.querySelectorAll<HTMLElement & {open:boolean}>('en-menu,en-tooltip')??[])item.open=false;
 }
 private restoreFocus(){
  if(!this.focusParked)return;this.focusParked=false;
  if(document.activeElement!==this.root)return;
  const buttons=[...this.live!.querySelectorAll<Upgraded>('en-toolbar > en-button')].filter(b=>!b.disabled);
  (buttons.find(b=>(b.dataset.actionId||b.id)===this.focusId)||buttons.find(b=>b.getAttribute('variant')==='primary')||buttons[0])?.focus({preventScroll:true});
 }
 private async open(epoch:number){
  const to=this.snapshot();if(!to||!this.loader||!this.visual)return;
  this.phase='opening';this.root!.dataset.toolbarPhase='opening';this.visual.append(to);this.abort=new AbortController();
  await constructionTransition({host:this.visual,from:this.loader,to,duration:THREAD_TIMING.duration,reduced:this.reduce.matches,signal:this.abort.signal,onInteractive:e=>{if(e.interactive&&epoch===this.epoch)this.reveal();}});
  if(epoch!==this.epoch)return;
  this.finish();
 }
 async page(change:()=>Promise<unknown>,trigger:'more'|'back',keyboard=false){
  const from=this.snapshot();if(!from||!this.visual){await change();return;}
  const epoch=++this.epoch;this.clock?.cancel();this.clock=undefined;this.abort?.abort();const prior=this.task;
  this.pending=true;this.parkFocus();this.hideLive();this.phase='paging';this.root!.dataset.toolbarPhase='paging';
  this.task=(async()=>{
   await prior;if(epoch!==this.epoch)return;await change();if(epoch!==this.epoch)return;
   this.visual!.replaceChildren(from);const to=this.snapshot();if(!to){this.finish();return;}this.visual!.append(to);this.abort=new AbortController();
   const focus=()=>{if(!keyboard)return;this.focusParked=false;const selector=trigger==='more'?'[data-action-id="ui:back"]':'[data-action-id="ui:more"]';(this.live?.querySelector<HTMLElement>(selector)||this.live?.querySelector<HTMLElement>('en-toolbar > en-button'))?.focus({preventScroll:true});};
   await constructionTransition({host:this.visual!,from,to,duration:THREAD_TIMING.pagingDuration,reduced:this.reduce.matches,trigger,signal:this.abort.signal,onInteractive:e=>{if(e.interactive&&epoch===this.epoch){this.reveal();focus();}}});
   if(epoch===this.epoch){this.finish();focus();}
  })();await this.task;
 }
 private finish(){this.pending=false;this.phase='idle';this.reveal();this.visual?.replaceChildren();this.loader=undefined;if(this.root)this.root.dataset.toolbarPhase='ready';this.announce('Actions available.');this.options.settled?.();}
 private snapshot():Snapshot|undefined{
  const toolbar=this.live?.querySelector<Upgraded>('.action-dock en-toolbar');
  const base=toolbar?.shadowRoot?.querySelector<HTMLElement>('[part~="base"]');if(!toolbar||!base)return;
  const buttons=[...toolbar.querySelectorAll<Upgraded>(':scope > en-button')];if(!buttons.length)return;
  const rect=base.getBoundingClientRect(),css=getComputedStyle(base),shell=document.createElement('div') as Snapshot;
  shell.className='spec-toolbar toolbar-snapshot';shell.dataset.empty='cushion';shell.dataset.state=this.options.state();shell.inert=true;shell.setAttribute('aria-hidden','true');
  Object.assign(shell.style,{width:`${rect.width}px`,height:`${rect.height}px`,minHeight:`${rect.height}px`,padding:css.padding,borderWidth:css.borderWidth,borderStyle:css.borderStyle,borderColor:css.borderColor,borderRadius:css.borderRadius,background:css.background,boxShadow:css.boxShadow,maxWidth:'none'});
  const row=document.createElement('div');row.className='toolbar-row';Object.assign(row.style,{gap:css.columnGap,height:'100%',padding:'0',direction:css.direction});shell.append(row);
  const copies=buttons.map(button=>{const clone=button.cloneNode(true) as Upgraded;clone.dataset.action=button.dataset.actionId||button.id;for(const node of [clone,...clone.querySelectorAll('[id]')])node.removeAttribute('id');clone.removeAttribute('autofocus');clone.setAttribute('tabindex','-1');const box=button.getBoundingClientRect();Object.assign(clone.style,{width:`${box.width}px`,height:`${box.height}px`,flex:'0 0 auto'});row.append(clone);return clone;});
  shell.ready=Promise.all(copies.map(c=>c.updateComplete));return shell;
 }
 private resize(){
  if(!this.root||this.root.clientWidth===this.lastWidth)return;this.lastWidth=this.root.clientWidth;
  if(this.loader)this.loader.refreshWaitingSurface();
  if(this.phase==='opening'||this.phase==='paging')this.abort?.abort();
 }
 dispose(){this.app.removeEventListener('click',this.activated,true);++this.epoch;this.clock?.cancel();this.abort?.abort();this.observer.disconnect();document.removeEventListener('visibilitychange',this.visibility);this.reduce.removeEventListener('change',this.motionPreference);}
}
