import { html } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import type { DocumentArtifact } from '../model/document-artifacts.ts';

type Size = { width:number; height:number };
const dimension=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=65535;
/** Only use complete, valid pairs. A fallback is a layout reservation, not source metadata. */
export function mediaSize(value:unknown,fallback:Size={width:1024,height:768}):Size&{source:'metadata'|'fallback'} {
  const row=value&&typeof value==='object'?value as Record<string,unknown>:{};
  for(const [width,height] of [[row.width,row.height],[row.image_width,row.image_height]]) {
    if(dimension(width)&&dimension(height))return {width,height,source:'metadata'};
  }
  return {...fallback,source:'fallback'};
}
export function videoSize(artifact:DocumentArtifact,url:string) {
  // Do not borrow a scene's dimensions for a different, assembled video URL.
  const item=artifact.items.find(item=>item.mediaUrl===url);
  return mediaSize(item??(artifact.mediaUrl===url?artifact.settings:undefined),{width:1280,height:720});
}
export function captureMediaSize(event:Event) {
  const element=event.currentTarget as HTMLImageElement|HTMLVideoElement|null;
  if(!element)return;
  const width=element.tagName==='IMG'?(element as HTMLImageElement).naturalWidth:(element as HTMLVideoElement).videoWidth;
  const height=element.tagName==='IMG'?(element as HTMLImageElement).naturalHeight:(element as HTMLVideoElement).videoHeight;
  if(dimension(width)&&dimension(height)){
    element.width=width;element.height=height;element.dataset.sizeSource='intrinsic';
  }
}
export function stillImage(src:string,alt:string,metadata?:unknown,options:{className?:string;loading?:'lazy'|'eager'}={}) {
  const size=mediaSize(metadata);
  // Recreate on source changes so an old image's intrinsic dimensions cannot leak into a new fallback.
  return keyed(src,html`<img src=${src} alt=${alt} class=${options.className??''} width=${size.width} height=${size.height} data-size-source=${size.source} loading=${options.loading??'lazy'} decoding="async" referrerpolicy="no-referrer" @load=${captureMediaSize} />`);
}
export function stillVideo(src:string,artifact:DocumentArtifact) {
  const size=videoSize(artifact,src);
  return keyed(src,html`<video controls playsinline src=${src} width=${size.width} height=${size.height} data-size-source=${size.source} preload="metadata" @loadedmetadata=${captureMediaSize}></video>`);
}
