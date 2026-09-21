import { documentImageFormat, providerRenderFormat } from '../src/model/image-format.ts';

/** Read-only presentation metadata from the admitted, frozen Still image request.
 * Do not reconstruct a workflow/native recipe from the current document. */
export function documentJobImageSize(kind:string,request:Record<string,unknown>){
 if(kind!=='generate')return;
 const saved=request.requestedImageSize as {width?:unknown;height?:unknown}|undefined;
 if(saved&&typeof saved.width==='number'&&typeof saved.height==='number'&&Number.isSafeInteger(saved.width)&&Number.isSafeInteger(saved.height)&&saved.width>0&&saved.height>0&&saved.width<=16384&&saved.height<=16384)return {width:saved.width,height:saved.height};
 if(request.stillImageProvider!=='openai'||request.outputExecution||request.workflowId||request.workflowStageId||request.workflowSources)return;
 const snapshot=request.snapshot;
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||!Array.isArray((snapshot as Record<string,unknown>).facts))return;
 try{const {width,height}=providerRenderFormat(documentImageFormat(snapshot).format,'full');return {width,height};}catch{return;}
}
