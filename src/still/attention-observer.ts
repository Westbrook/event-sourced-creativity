import { AttentionSummary, type AttentionSnapshot } from './attention.ts';
const selector='[data-attention-id], .action-dock [data-action-id]';
const id=(el:HTMLElement)=>el.dataset.attentionId??(el.dataset.actionId?`action:${el.dataset.actionId}`:'');
/** Aggregate DOM observations; never dispatch app changes, writes or decisions. */
export class StillAttentionObserver {
  readonly summary=new AttentionSummary();
  private elements=new Map<HTMLElement,string>();
  private observer:IntersectionObserver;
  private timer:number;
  private keyboardUntil=0;
  private enabled=false;
  private palette=false;
  constructor(private root:HTMLElement,private publish:(snapshot:AttentionSnapshot)=>void){
    this.observer=new IntersectionObserver(entries=>{
      for(const entry of entries){const key=this.elements.get(entry.target as HTMLElement);if(key)this.summary.exposure(key,entry.isIntersecting&&entry.intersectionRatio>=.25);}
    },{threshold:[0,.25]});
    window.addEventListener('focus',this.foreground);window.addEventListener('blur',this.foreground);
    window.addEventListener('pagehide',this.pause);window.addEventListener('pageshow',this.foreground);
    document.addEventListener('visibilitychange',this.foreground);
    for(const name of ['pointerover','pointerout','pointerdown','keydown','focusin','focusout','click','scroll'])root.addEventListener(name,this.event,true);
    this.timer=window.setInterval(()=>this.publish(this.summary.snapshot()),2000);
  }
  private foreground=()=>this.summary.setForeground(this.enabled&&!document.hidden&&document.hasFocus());
  private pause=()=>this.summary.setForeground(false);
  private event=(e:Event)=>{
    if(!e.isTrusted||!this.enabled)return;
    const path=e.composedPath(),target=path.find(n=>n instanceof HTMLElement) as HTMLElement|undefined;
    if(!target||path.some(n=>n instanceof HTMLElement&&n.matches('still-developer-console,.developer-panel')))return;
    const el=path.find(n=>n instanceof HTMLElement&&this.elements.has(n)) as HTMLElement|undefined;
    const key=el?this.elements.get(el)!:'';
    if(e.type==='keydown'){
      const k=e as KeyboardEvent;this.keyboardUntil=['Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(k.key)?performance.now()+250:0;
      this.summary.interact();
    }
    if(e.type==='pointerdown'){this.keyboardUntil=0;this.summary.keyboardFocused('');this.summary.interact();}
    if(e.type==='scroll')this.summary.interact();
    if(e.type==='pointerover'&&(e as PointerEvent).pointerType!=='touch')this.summary.hovered(key);
    if(e.type==='pointerout')this.summary.hovered('');
    if(e.type==='focusout')this.summary.keyboardFocused('');
    if(e.type==='focusin'){
      const focusVisible=path.some(n=>n instanceof HTMLElement&&n.matches(':focus-visible'));
      this.summary.keyboardFocused(performance.now()<this.keyboardUntil&&focusVisible?key:'');this.keyboardUntil=0;
    }
    if(e.type==='click'&&key)this.summary.activate(key);
  };
  refresh(scope:string,page:string,enabled:boolean,palette:boolean){
    const changed=this.summary.enter(scope,page);this.enabled=enabled;this.foreground();
    if(changed||palette!==this.palette){this.observer.disconnect();for(const key of this.elements.values())this.summary.exposure(key,false);this.elements.clear();this.keyboardUntil=0;}
    this.palette=palette;
    const elements=enabled&&!palette?[...this.root.querySelectorAll<HTMLElement>(selector)].filter(el=>id(el)):[];
    const current=new Set(elements);
    for(const [el,key] of this.elements)if(!current.has(el)||id(el)!==key){this.observer.unobserve(el);this.summary.exposure(key,false);this.elements.delete(el);}
    for(const el of elements)if(!this.elements.has(el)){this.elements.set(el,id(el));this.observer.observe(el);}
  }
  dispose(){
    this.pause();clearInterval(this.timer);this.observer.disconnect();
    window.removeEventListener('focus',this.foreground);window.removeEventListener('blur',this.foreground);
    window.removeEventListener('pagehide',this.pause);window.removeEventListener('pageshow',this.foreground);
    document.removeEventListener('visibilitychange',this.foreground);
    for(const name of ['pointerover','pointerout','pointerdown','keydown','focusin','focusout','click','scroll'])this.root.removeEventListener(name,this.event,true);
    this.elements.clear();
  }
}
