/** Private, bounded memory cache. Never use this for authorization or mutations. */
export const DECISION_TTL_MS=5*60_000;
export type DecisionCacheInfo={layer:'server'|'browser';status:'hit'|'miss'|'shared'|'bypass';ageMs:number;remainingMs:number;originalLatencyMs:number;stored:boolean};
type Entry<T>={value:T;at:number;expires:number;latency:number;bytes:number;stored:boolean};
export const stableDecisionKey=(value:unknown)=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export class DecisionMemo<T> {
  private entries=new Map<string,Entry<T>>();
  private pending=new Map<string,Promise<Entry<T>>>();
  private bytes=0;
  private generation=0;
  constructor(private options:{accept:(value:T)=>boolean;ttl?:(value:T)=>number;latency?:(value:T)=>number|undefined;age?:(value:T)=>number;now?:()=>number;maxEntries?:number;maxBytes?:number}){}
  private now(){return this.options.now?.()??Date.now();}
  private remove(key:string){const old=this.entries.get(key);if(old)this.bytes-=old.bytes;this.entries.delete(key);}
  clear(){this.generation++;this.entries.clear();this.pending.clear();this.bytes=0;}
  private result(entry:Entry<T>,status:DecisionCacheInfo['status']){
    const ageMs=Math.max(0,this.now()-entry.at);
    return {value:structuredClone(entry.value),cache:{status,ageMs,remainingMs:Math.max(0,entry.expires-this.now()),originalLatencyMs:entry.latency,stored:entry.stored}};
  }
  peek(key:string){
    const entry=this.entries.get(key);if(!entry)return;
    if(entry.expires<=this.now()){this.remove(key);return;}
    this.entries.delete(key);this.entries.set(key,entry);
    return this.result(entry,'hit');
  }
  async run(key:string,load:()=>Promise<T>,bypass=false){
    if(!bypass){const hit=this.peek(key);if(hit)return hit;}else this.remove(key);
    const pending=this.pending.get(key);if(pending)return this.result(await pending,'shared');
    const generation=this.generation,started=this.now();
    const promise=Promise.resolve().then(load).then(value=>{
      const at=this.now(),ttl=this.options.accept(value)?Math.max(0,Math.min(DECISION_TTL_MS,this.options.ttl?.(value)??DECISION_TTL_MS)):0;
      const bytes=new TextEncoder().encode(key+JSON.stringify(value)).byteLength;
      const entry={value:structuredClone(value),at:at-(this.options.age?.(value)??0),expires:at,stored:false,latency:this.options.latency?.(value)??Math.max(0,at-started),bytes};
      if(ttl&&generation===this.generation&&bytes<=(this.options.maxBytes??8_000_000)){
        for(const [k,v]of this.entries)if(v.expires<=at)this.remove(k);
        entry.stored=true;entry.expires=at+ttl;this.remove(key);this.entries.set(key,entry);this.bytes+=bytes;
        while(this.entries.size>(this.options.maxEntries??24)||this.bytes>(this.options.maxBytes??8_000_000))this.remove(this.entries.keys().next().value!);
      }
      return entry;
    });
    // Bound pending bookkeeping; authorization/rate limiting belongs to the caller.
    if(this.pending.size<64)this.pending.set(key,promise);
    try{return this.result(await promise,bypass?'bypass':'miss');}
    finally{if(this.pending.get(key)===promise)this.pending.delete(key);}
  }
}
