import '../src/components/model3d-viewer.ts';
import '../src/components/model3d-settings-editor.ts';
import '../src/components/reference-compositor.ts';
import {normalizeModel3dSettings} from '../src/model/model3d.ts';
import {setFormaLocale} from '../src/components/design-system/localization.ts';

// Only synthetic local bytes are served; the fixture cannot submit provider work.
function modelBytes(){
  const profile=[[0,-1],[.4,-1],[.49,-.91],[.66,-.45],[.7,-.08],[.61,.3],[.36,.72],[.38,.91],[.36,1],[.27,1],[.27,.85],[.22,.7],[.42,.3],[.49,-.1],[.43,-.66],[0,-.8]],segments=48,positions=[],normals=[],indices=[];
  for(let row=0;row<profile.length;row++){
    const previous=profile[Math.max(0,row-1)],next=profile[Math.min(profile.length-1,row+1)],dr=next[0]-previous[0],dy=next[1]-previous[1],length=Math.hypot(dr,dy)||1;
    for(let segment=0;segment<=segments;segment++){
      const angle=segment/segments*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle);
      positions.push(profile[row][0]*c,profile[row][1],profile[row][0]*s);normals.push(dy/length*c,-dr/length,dy/length*s);
    }
  }
  for(let row=0;row<profile.length-1;row++)for(let segment=0;segment<segments;segment++){const a=row*(segments+1)+segment,b=a+segments+1;indices.push(a,b,a+1,a+1,b,b+1);}
  const vertices=new Float32Array(positions),normalValues=new Float32Array(normals),triangles=new Uint16Array(indices),bin=new Uint8Array(vertices.byteLength+normalValues.byteLength+triangles.byteLength);
  bin.set(new Uint8Array(vertices.buffer));bin.set(new Uint8Array(normalValues.buffer),vertices.byteLength);bin.set(new Uint8Array(triangles.buffer),vertices.byteLength+normalValues.byteLength);
  const document={asset:{version:'2.0',generator:'Forma local model viewer fixture'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},indices:2,material:0}]}],materials:[{name:'Jade ceramic',pbrMetallicRoughness:{baseColorFactor:[.15,.4,.31,1],metallicFactor:.12,roughnessFactor:.23},doubleSided:true}],buffers:[{byteLength:bin.byteLength}],bufferViews:[{buffer:0,byteOffset:0,byteLength:vertices.byteLength},{buffer:0,byteOffset:vertices.byteLength,byteLength:normalValues.byteLength},{buffer:0,byteOffset:vertices.byteLength+normalValues.byteLength,byteLength:triangles.byteLength}],accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3',min:[-.7,-1,-.7],max:[.7,1,.7]},{bufferView:1,componentType:5126,count:normals.length/3,type:'VEC3'},{bufferView:2,componentType:5123,count:indices.length,type:'SCALAR'}]};
  const json=new TextEncoder().encode(JSON.stringify(document)),jsonSize=Math.ceil(json.length/4)*4,binSize=Math.ceil(bin.length/4)*4,bytes=new Uint8Array(12+8+jsonSize+8+binSize),view=new DataView(bytes.buffer);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,bytes.length,true);view.setUint32(12,jsonSize,true);view.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+jsonSize);bytes.set(json,20);view.setUint32(20+jsonSize,binSize,true);view.setUint32(24+jsonSize,0x004e4942,true);bytes.set(bin,28+jsonSize);return bytes;
}
const fixtureModel=modelBytes(),fixtureImages=new Map(),originalFetch=window.fetch.bind(window);
window.fetch=(input,init)=>{
  const source=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
  if(source==='/api/media/fixture-model.glb')return Promise.resolve(new Response(fixtureModel,{headers:{'content-type':'model/gltf-binary','content-length':String(fixtureModel.length)}}));
  const image=fixtureImages.get(source);if(image)return Promise.resolve(new Response(image,{headers:{'content-type':'image/png','content-length':String(image.size)}}));
  if(source.startsWith('/api/'))return Promise.reject(new Error('This local UI fixture does not submit API requests.'));
  return originalFetch(input,init);
};
const publishImage=(path,blob)=>originalFetch('/__fixture__/image?path='+encodeURIComponent(path),{method:'POST',body:blob});
const hash=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),value=>value.toString(16).padStart(2,'0')).join('');
const image=document.createElement('canvas');image.width=400;image.height=300;const paint=image.getContext('2d');paint.fillStyle='#e8d8b9';paint.fillRect(0,0,400,300);paint.fillStyle='#ae8362';paint.fillRect(0,230,400,70);paint.fillStyle='#ebece4';paint.beginPath();paint.arc(310,85,44,0,Math.PI*2);paint.fill();const paletteBlob=await new Promise(resolve=>image.toBlob(resolve,'image/png'));
fixtureImages.set('/api/media/fixture-color.png',paletteBlob);await publishImage('/api/media/fixture-color.png',paletteBlob);
const sources=[{id:'fixture:color',blockId:'fixture-color',label:'Studio backdrop',mediaUrl:'/api/media/fixture-color.png',contentHash:await hash(paletteBlob),kind:'image'}];
const viewer=document.querySelector('#fixture-viewer');viewer.src='/api/media/fixture-model.glb';let captureCount=0;let capturedUrl='';
viewer.addEventListener('model3d-capture',async event=>{
  const {blob,view,src}=event.detail;await publishImage('/api/media/fixture-model-view.png',blob);fixtureImages.set('/api/media/fixture-model-view.png',blob);viewer.view=view;captureCount++;
  if(capturedUrl)URL.revokeObjectURL(capturedUrl);capturedUrl=URL.createObjectURL(blob);
  const output=document.querySelector('#fixture-capture');output.replaceChildren();const text=document.createElement('p');text.textContent=`Saved view ${captureCount}: ${blob.type}, ${blob.size} bytes. Source: ${src}. Background: ${view.background}. Camera: ${JSON.stringify(view.position)}.`;output.append(text);
  const preview=document.createElement('img');preview.id='saved-view';preview.alt='Saved model reference';preview.src=capturedUrl;output.append(preview);await preview.decode();
  const receipt=document.createElement('p');const digest=await hash(blob);receipt.textContent=`Image: ${preview.naturalWidth} × ${preview.naturalHeight}. SHA-256: ${digest}`;output.append(receipt);
  const previous=sources.findIndex(item=>item.id==='fixture:model');if(previous>=0)sources.splice(previous,1);sources.push({id:'fixture:model',blockId:'fixture-model',label:'Saved ceramic model',mediaUrl:'/api/media/fixture-model-view.png',contentHash:digest,kind:'model-view'});
});
document.querySelector('#fixture-refresh-view').addEventListener('click',()=>{viewer.view=structuredClone(viewer.view);document.querySelector('#fixture-refresh-status').textContent='Saved view properties refreshed with equivalent values.';});
const settings=document.querySelector('#fixture-settings');settings.settings=normalizeModel3dSettings();settings.prompt='A sculptural jade ceramic vase, smooth curved body and a narrow open neck';settings.referenceCount=0;
settings.addEventListener('model3d-settings-change',event=>{document.querySelector('#fixture-settings-output').textContent=`Settings ${event.detail.valid?'valid':'need attention'}. Prompt: ${Array.from(event.detail.prompt).length} characters. ${JSON.stringify(event.detail.settings)}`;});
document.querySelector('#fixture-language').addEventListener('change',event=>setFormaLocale(event.target.value));
document.querySelector('#open-compositor').addEventListener('click',async()=>{
  const compositor=document.createElement('forma-reference-compositor');compositor.sources=[...sources];compositor.recipe=null;compositor.label='Ceramic product scene';compositor.disabled=document.querySelector('#fixture-saving').checked;document.body.append(compositor);if(compositor.disabled){await compositor.updateComplete;const release=document.createElement('button');release.type='button';release.className='button';release.textContent='Finish fixture save';release.addEventListener('click',()=>{compositor.disabled=false;release.remove();});compositor.querySelector('dialog').append(release);}
  compositor.addEventListener('composition-close',()=>compositor.remove());
  compositor.addEventListener('composition-capture',event=>{
    const output=document.querySelector('#fixture-composition');output.replaceChildren();const label=document.createElement('p');label.textContent=`Saved composition: ${event.detail.blob.type}, ${event.detail.blob.size} bytes. ${JSON.stringify(event.detail.recipe)}`;output.append(label);const preview=document.createElement('img');preview.alt='Saved scene composition';preview.src=URL.createObjectURL(event.detail.blob);output.append(preview);compositor.remove();
  });
});
