export type CanvasPresence = { userId:string; name:string; color:string; x:number; y:number; selectedItemId:string; updatedAt:number };

export class CanvasPresenceHub {
  #channel:BroadcastChannel|null=null;#canvasId="";#self:CanvasPresence;#listeners=new Set<(presence:CanvasPresence[])=>void>();#peers=new Map<string,CanvasPresence>();#timer=0;
  constructor(user:{userId:string;name:string}){this.#self={userId:user.userId,name:user.name,color:colorFor(user.userId),x:0,y:0,selectedItemId:"",updatedAt:Date.now()};}
  connect(canvasId:string,projectId:string){this.disconnect();this.#canvasId=canvasId;if(typeof BroadcastChannel==="undefined"||!projectId||!this.#self.userId||this.#self.userId==="anonymous")return;this.#channel=new BroadcastChannel(`canvas-presence:${encodeURIComponent(this.#self.userId)}:${encodeURIComponent(projectId)}:${encodeURIComponent(canvasId)}`);this.#channel.onmessage=(event)=>{const message=event.data as{kind?:string;presence?:CanvasPresence;userId?:string};if(message.kind==="leave"&&message.userId)this.#peers.delete(message.userId);if(message.kind==="presence"&&message.presence?.userId!==this.#self.userId)this.#peers.set(message.presence!.userId,message.presence!);this.#emit();};this.#broadcast();this.#timer=window.setInterval(()=>{const cutoff=Date.now()-6_000;for(const[userId,peer]of this.#peers)if(peer.updatedAt<cutoff)this.#peers.delete(userId);this.#broadcast();this.#emit();},2_000);}
  update(patch:Partial<Pick<CanvasPresence,"x"|"y"|"selectedItemId">>){Object.assign(this.#self,patch,{updatedAt:Date.now()});this.#broadcast();}
  subscribe(listener:(presence:CanvasPresence[])=>void){this.#listeners.add(listener);listener([...this.#peers.values()]);return()=>this.#listeners.delete(listener);}
  disconnect(){if(this.#channel){this.#channel.postMessage({kind:"leave",userId:this.#self.userId});this.#channel.close();}this.#channel=null;window.clearInterval(this.#timer);this.#peers.clear();this.#emit();}
  #broadcast(){this.#self.updatedAt=Date.now();this.#channel?.postMessage({kind:"presence",canvasId:this.#canvasId,presence:this.#self});}
  #emit(){const peers=[...this.#peers.values()];for(const listener of this.#listeners)listener(peers);}
}

const colorFor=(value:string)=>{let hash=0;for(const char of value)hash=(hash*31+char.charCodeAt(0))|0;return["#315fe8","#c6543d","#417d5b","#8b5ab8","#ad7515"][Math.abs(hash)%5];};
