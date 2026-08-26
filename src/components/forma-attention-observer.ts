import { html } from "lit";
import { FormaElement } from "./forma-element";
import { ATTENTION_IDLE_GRACE_MS, attentionTickTransition, buildAttentionEpisode, clearLocalAttentionEpisodes, isAttentionActionTerminal, saveLocalAttentionEpisode } from "../model/attention";
import type { CreativeEvent } from "../model/events";
import { documentFocusFromRoute, documentIdFromRoute, documentViewFromRoute } from "../model/routes";

type LiveEpisode = {
  startedAt: number; lastTickAt: number; lastActivityAt: number; activeMs: number; idleMs: number; hadActivity: boolean;
  surface: string; context: string; visibleRefs: Set<string>; documentView?: string; documentId?: string; focused?: boolean;
};

const MIN_EPISODE_MS=1_500;
const attentionRef=(element:HTMLElement|null)=>element?.dataset.attentionRef??(element?.dataset.outputId?`object:${element.dataset.outputId}`:element?.dataset.blockId?`block:${element.dataset.blockId}`:null);
const contextFor=(target:Element|null)=>{
  const declared=target?.closest<HTMLElement>("[data-attention-context]")?.dataset.attentionContext;if(declared)return declared;
  if(target?.closest(".comparison-modal"))return"comparison";if(target?.closest(".composer-dock,.chat-composer,.forma-assistant-composer,forma-ui-conversation-composer,.block-editor,.block-composer"))return"writing-direction";
  if(target?.closest(".output-column,.output-card,.library-output"))return"generation";if(target?.closest(".context-column,.context-block"))return"studio-context";if(target?.closest(".library-main"))return"library-browsing";return null;
};
const safeRef=(event:CreativeEvent)=>{
  const p=event.payload;const value=p.object_id??p.document_id??p.block_id??p.item_id??p.brief_id??p.proposal_event_id;
  return value?`${event.type.replace(/[A-Z]/g,(letter)=>`-${letter.toLowerCase()}`).replace(/^-/,"")}:${String(value)}`:null;
};
const surfaceFor=(path:string)=>path.startsWith("/library")?"library":path.startsWith("/sessions")?"sessions":path.startsWith("/scout")?"scout":path.startsWith("/memory")?"memory":path.startsWith("/system")?"system":path.startsWith("/admin")?"event-admin":"studio";

export class FormaAttentionObserver extends FormaElement {
  #episode:LiveEpisode|null=null;#timer=0;#intersection?:IntersectionObserver;#enabled=false;#lastRoute="";
  #visibility=()=>{if(document.visibilityState==="visible")this.#start();else this.#finish("page_hidden",null,false);};
  #route=(event:Event)=>{const path=String((event as CustomEvent<{path:string}>).detail?.path??this.store.route.get());if(path===this.#lastRoute)return;this.#finish("route_changed",null,false);this.#lastRoute=path;this.#start();};
  #forget=()=>{clearLocalAttentionEpisodes(this.store.session.get()?.user.userId??"anonymous");this.#episode=null;if(this.#capturing())this.#start();};
  #activity=(event:Event)=>{
    if(!this.#capturing())return;const now=Date.now();if(!this.#episode)this.#start(now);if(!this.#episode)return;this.#accrue(now);
    const target=event.target instanceof Element?event.target:null;const context=contextFor(target);const ref=target?.closest<HTMLElement>("[data-attention-ref],[data-output-id],[data-block-id]")??null;
    if(context)this.#episode.context=context;const refId=attentionRef(ref);if(refId)this.#episode.visibleRefs.add(refId);
    this.#episode.lastActivityAt=now;this.#episode.hadActivity=true;
  };
  #appended=(event:Event)=>{
    if(!this.#capturing())return;const appended=(event as CustomEvent<{events:CreativeEvent[]}>).detail?.events??[];
    const terminal=[...appended].reverse().find((item)=>item.actor==="user"&&isAttentionActionTerminal(item.type));if(!terminal)return;
    if(!this.#episode)this.#start();if(this.#episode)this.#episode.hadActivity=true;
    this.#finish(terminal.type,safeRef(terminal),true);
  };

  override connectedCallback(){
    super.connectedCallback();this.#lastRoute=this.store.route.get();
    document.addEventListener("visibilitychange",this.#visibility);window.addEventListener("forma-route-changed",this.#route);window.addEventListener("forma-events-appended",this.#appended);window.addEventListener("forma-attention-forget",this.#forget);
    window.addEventListener("pointermove",this.#activity,{passive:true});window.addEventListener("pointerdown",this.#activity,{passive:true});window.addEventListener("scroll",this.#activity,{passive:true});window.addEventListener("keydown",this.#activity,{passive:true});window.addEventListener("touchstart",this.#activity,{passive:true});window.addEventListener("focusin",this.#activity,{passive:true});
    this.#timer=window.setInterval(()=>this.#tick(),5_000);this.#syncSetting();this.#refreshVisibleRefs();
  }
  override disconnectedCallback(){
    this.#finish("capture_disabled",null,false);document.removeEventListener("visibilitychange",this.#visibility);window.removeEventListener("forma-route-changed",this.#route);window.removeEventListener("forma-events-appended",this.#appended);window.removeEventListener("forma-attention-forget",this.#forget);
    window.removeEventListener("pointermove",this.#activity);window.removeEventListener("pointerdown",this.#activity);window.removeEventListener("scroll",this.#activity);window.removeEventListener("keydown",this.#activity);window.removeEventListener("touchstart",this.#activity);window.removeEventListener("focusin",this.#activity);window.clearInterval(this.#timer);this.#intersection?.disconnect();super.disconnectedCallback();
  }
  protected override updated(){this.#syncSetting();window.setTimeout(()=>this.#refreshVisibleRefs(),0);}
  #capturing(){return Boolean(!this.store.session.get()?.projectContext&&this.store.ui.attentionCapture&&!this.store.ui.attentionPaused&&document.visibilityState==="visible");}
  #syncSetting(){const enabled=this.#capturing();if(enabled===this.#enabled)return;this.#enabled=enabled;if(enabled)this.#start();else this.#finish(this.store.ui.attentionPaused?"capture_paused":"capture_disabled",null,false);}
  #start(now=Date.now()){
    if(!this.#capturing()||this.#episode)return;const path=this.store.route.get();const visibleRefs=new Set<string>();if(this.store.ui.compareOpen)this.store.ui.comparisonOutputIds.split("|").filter(Boolean).forEach((id)=>visibleRefs.add(`object:${id}`));const documentView=documentViewFromRoute(path)??undefined;const documentId=documentIdFromRoute(path)??(documentView?this.store.projection.get().documentId:undefined);this.#episode={startedAt:now,lastTickAt:now,lastActivityAt:now,activeMs:0,idleMs:0,hadActivity:false,surface:surfaceFor(path),context:`${surfaceFor(path)}-overview`,visibleRefs,documentView,documentId,focused:documentView?documentFocusFromRoute(path):undefined};
  }
  #accrue(now:number){
    const episode=this.#episode;if(!episode||now<=episode.lastTickAt)return;const activeUntil=Math.min(now,episode.lastActivityAt+ATTENTION_IDLE_GRACE_MS);
    if(activeUntil>episode.lastTickAt)episode.activeMs+=activeUntil-episode.lastTickAt;episode.idleMs+=Math.max(0,now-Math.max(episode.lastTickAt,activeUntil));episode.lastTickAt=now;
  }
  #tick(){const now=Date.now();const transition=attentionTickTransition(this.#episode?.lastActivityAt??null,now);if(transition==="dormant")return;this.#accrue(now);if(transition==="idle-timeout")this.#finish("idle_timeout",null,false);}
  #finish(terminalType:string,terminalRef:string|null,restart:boolean){
    const current=this.#episode;this.#episode=null;if(!current)return;const endedAt=Date.now();this.#accrueFor(current,endedAt);const total=current.activeMs+current.idleMs;
    if(total>=MIN_EPISODE_MS&&current.activeMs>0&&(terminalType!=="idle_timeout"||current.hadActivity)){
      const episode=buildAttentionEpisode({episode_id:crypto.randomUUID(),surface:current.surface,context:current.context,document_view:current.documentView,document_id:current.documentId,focused:current.focused,started_at:new Date(current.startedAt).toISOString(),ended_at:new Date(endedAt).toISOString(),active_ms:Math.round(current.activeMs),idle_ms:Math.round(current.idleMs),visible_refs:[...current.visibleRefs].slice(0,8),terminal_type:terminalType,terminal_ref:terminalRef});
      saveLocalAttentionEpisode(episode,this.store.session.get()?.user.userId??"anonymous");if(!/^(capture_disabled|capture_paused)$/.test(terminalType))void this.store.hot({type:"AttentionEpisodeObserved",payload:episode},{keepalive:terminalType==="page_hidden"});
    }
    if(restart&&this.#capturing())this.#start(endedAt);
  }
  #accrueFor(episode:LiveEpisode,now:number){const activeUntil=Math.min(now,episode.lastActivityAt+ATTENTION_IDLE_GRACE_MS);if(activeUntil>episode.lastTickAt)episode.activeMs+=activeUntil-episode.lastTickAt;episode.idleMs+=Math.max(0,now-Math.max(episode.lastTickAt,activeUntil));episode.lastTickAt=now;}
  #refreshVisibleRefs(){
    this.#intersection?.disconnect();if(!this.#capturing()||!("IntersectionObserver" in window))return;
    this.#intersection=new IntersectionObserver((entries)=>{const episode=this.#episode;if(!episode)return;for(const entry of entries){const ref=attentionRef(entry.target as HTMLElement);if(!ref)continue;if(entry.isIntersecting&&entry.intersectionRatio>=.35)episode.visibleRefs.add(ref);else episode.visibleRefs.delete(ref);}},{threshold:[.35]});
    document.querySelectorAll<HTMLElement>("[data-attention-ref],[data-output-id],[data-block-id]").forEach((element)=>this.#intersection?.observe(element));
  }
  override render(){return html``;}
}
if (!customElements.get("forma-attention-observer")) customElements.define("forma-attention-observer",FormaAttentionObserver);
