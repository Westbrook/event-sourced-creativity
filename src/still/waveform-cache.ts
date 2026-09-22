/** Versioned, scoped envelopes only: no audio bytes or titles are persisted. */
const CACHE_KEY='still:waveforms:v2';
const TTL=30*24*60*60*1000, LIMIT=48;
export type WaveformRecord={key:string;at:number;duration:number;levels:number[]};
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
const keyFor=(scope:string,src:string)=>JSON.stringify([scope,src]);
function valid(row:WaveformRecord,now:number){return row&&typeof row.key==='string'&&row.key.length<8192&&Number.isFinite(row.at)&&row.at<=now&&now-row.at<TTL&&Number.isFinite(row.duration)&&row.duration>0&&row.duration<=1200&&Array.isArray(row.levels)&&row.levels.length>0&&row.levels.length<=120&&row.levels.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1);}
export class WaveformCache {
  private memory:WaveformRecord[]=[];
  constructor(private storage:()=>StorageLike=()=>localStorage,private now=()=>Date.now()){}
  private entries(){
    try{const raw=this.storage().getItem(CACHE_KEY);if(raw&&raw.length<250_000){const rows=JSON.parse(raw);if(Array.isArray(rows))this.memory=[...new Map([...rows.filter(row=>valid(row,this.now())),...this.memory].sort((a,b)=>a.at-b.at).map(row=>[row.key,row])).values()].slice(-LIMIT);}}catch{/* Restricted storage still permits memory caching. */}
    this.memory=this.memory.filter(row=>valid(row,this.now()));return this.memory;
  }
  get(scope:string,src:string){if(!scope||!src.startsWith('/api/media/'))return;const row=this.entries().find(row=>row.key===keyFor(scope,src));return row?{...row,levels:[...row.levels]}:undefined;}
  put(scope:string,src:string,duration:number,levels:number[]){
    if(!scope||!src.startsWith('/api/media/'))return;
    const row={key:keyFor(scope,src),at:this.now(),duration,levels:levels.map(x=>Number(x.toFixed(5)))};
    if(!valid(row,this.now()))return;
    this.memory=[...this.entries().filter(old=>old.key!==row.key),row].slice(-LIMIT);
    try{this.storage().setItem(CACHE_KEY,JSON.stringify(this.memory));}catch{/* Playback and memory caching do not depend on disk availability. */}
  }
}
export const waveformCache=new WaveformCache();
