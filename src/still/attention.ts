/** Local observations only. This module has no network, storage or Jev dependency. */
export type AttentionTarget = { id:string; visibleMs:number; hoverMs:number; keyboardFocusMs:number; activations:number };
export type AttentionPage = {
  page:string; visits:number; elapsedMs:number; foregroundMs:number; idleForegroundMs:number;
  moreOpened:number; paletteOpened:number; targets:AttentionTarget[];
};
export type AttentionSnapshot = {
  version:1; mode:'observe-only'; sentToJev:false; storage:'tab-memory';
  foreground:boolean; idleAfterMs:number; current:AttentionPage|null; recent:AttentionPage[];
};
const IDLE_MS=30_000, MAX_PAGES=20, MAX_TARGETS=100;
export class AttentionSummary {
  private pages=new Map<string,AttentionPage>();
  private page='';
  private scope='';
  private last:number;
  private lastInput:number;
  private foreground=false;
  private visible=new Set<string>();
  private hover='';
  private focus='';
  constructor(private now=()=>performance.now()){this.last=this.lastInput=now();}
  private flush(){
    const now=this.now(),from=this.last;this.last=now;
    const p=this.pages.get(this.page);if(!p)return;
    const elapsed=Math.max(0,now-from);p.elapsedMs+=elapsed;
    // Timer suspension / device sleep must not be mistaken for continuous attention.
    const ms=this.foreground?Math.min(elapsed,5000):0;
    p.foregroundMs+=ms;
    p.idleForegroundMs+=Math.min(ms,Math.max(0,now-Math.max(from,this.lastInput+IDLE_MS)));
    for(const id of this.visible){const t=this.target(id);if(t)t.visibleMs+=ms;}
    if(this.visible.has(this.hover)){const t=this.target(this.hover);if(t)t.hoverMs+=ms;}
    if(this.visible.has(this.focus)){const t=this.target(this.focus);if(t)t.keyboardFocusMs+=ms;}
  }
  private target(id:string){
    const p=this.pages.get(this.page);if(!p||!id)return;
    let t=p.targets.find(t=>t.id===id);
    if(!t&&p.targets.length<MAX_TARGETS){t={id,visibleMs:0,hoverMs:0,keyboardFocusMs:0,activations:0};p.targets.push(t);}
    return t;
  }
  enter(scope:string,page:string){
    this.flush();
    if(scope!==this.scope){this.pages.clear();this.page='';this.scope=scope;}
    if(page===this.page)return false;
    this.page=page;this.visible.clear();this.hover=this.focus='';this.lastInput=this.now();
    if(!page)return true;
    let p=this.pages.get(page);
    if(!p)p={page,visits:0,elapsedMs:0,foregroundMs:0,idleForegroundMs:0,moreOpened:0,paletteOpened:0,targets:[]};
    p.visits++;this.pages.delete(page);this.pages.set(page,p);
    while(this.pages.size>MAX_PAGES)this.pages.delete(this.pages.keys().next().value!);
    return true;
  }
  setForeground(value:boolean){this.flush();this.foreground=value;if(!value)this.hover=this.focus='';}
  exposure(id:string,visible:boolean){this.flush();if(visible){if(this.target(id))this.visible.add(id);}else this.visible.delete(id);}
  hovered(id:string){this.flush();this.hover=id;}
  keyboardFocused(id:string){this.flush();this.focus=id;}
  interact(){this.flush();this.lastInput=this.now();}
  activate(id:string){this.interact();const t=this.target(id);if(t)t.activations++;}
  explore(kind:'more'|'palette'){this.interact();const p=this.pages.get(this.page);if(p){if(kind==='more')p.moreOpened++;else p.paletteOpened++;}}
  snapshot():AttentionSnapshot{
    this.flush();
    const rounded=(p:AttentionPage):AttentionPage=>({...p,elapsedMs:Math.round(p.elapsedMs),foregroundMs:Math.round(p.foregroundMs),idleForegroundMs:Math.round(p.idleForegroundMs),targets:p.targets.map(t=>({...t,visibleMs:Math.round(t.visibleMs),hoverMs:Math.round(t.hoverMs),keyboardFocusMs:Math.round(t.keyboardFocusMs)}))});
    return {version:1,mode:'observe-only',sentToJev:false,storage:'tab-memory',foreground:this.foreground,idleAfterMs:IDLE_MS,current:this.pages.has(this.page)?rounded(this.pages.get(this.page)!):null,recent:[...this.pages.values()].reverse().filter(p=>p.page!==this.page).map(rounded)};
  }
}
