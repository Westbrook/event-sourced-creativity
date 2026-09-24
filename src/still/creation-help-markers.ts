import {html} from 'lit';

/** Read-only illustrations of editor syntax, never editor tokens or controls. */
export function creationHelpMarkers(text:string){
  return text.split(/(@[\p{L}\p{N}_-]*|\/(?:3D model|project|document|idea|image|video)?)/gu)
    .map((part,index)=>index%2?html`<bdi class="creation-guidance-token" dir="ltr">${part}</bdi>`:part);
}
