import type { DocumentArtifact } from "../model/document-artifacts.ts";
import { MODEL3D_FORMAT_MIME_TYPES, isModel3dFormat } from "../model/model3d.ts";

export type Model3dArtifactFile = {
  url:string;
  mimeType:string;
  fileName:string;
  fileSize:number|null;
  format:string|null;
  role:"mesh"|"texture"|"preview";
  sha256:string;
  previewSupported?:boolean;
};

const privateMediaUrl=(value:unknown):value is string=>typeof value==="string"&&/^\/api\/media\/[A-Za-z0-9._~%+-]+$/u.test(value);
const extensionForMime=(value:string)=>({"model/gltf-binary":"glb","model/vnd.usdz+zip":"usdz","model/obj":"obj","model/stl":"stl","image/png":"png","image/jpeg":"jpg","image/webp":"webp"} as Record<string,string>)[value]??null;

/** Only retained private assets are exportable; provider URLs are never UI download targets. */
export function model3dArtifactFiles(artifact:Pick<DocumentArtifact,"kind"|"settings"|"mediaUrl"|"mediaType"|"title">):Model3dArtifactFile[]{
  if(artifact.kind!=="model3d")return [];
  const raw=Array.isArray(artifact.settings.model3d_files)?artifact.settings.model3d_files:[];
  const seen=new Set<string>();
  const files:Model3dArtifactFile[]=[];
  for(const value of raw){
    if(!value||typeof value!=="object"||Array.isArray(value))continue;
    const file=value as Record<string,unknown>;
    if(!privateMediaUrl(file.url)||seen.has(file.url))continue;
    const mimeType=typeof file.mimeType==="string"?file.mimeType.toLowerCase().split(";")[0]!.trim():"";
    const format=isModel3dFormat(file.format)?file.format:null;
    const role=file.role;
    if(role!=="mesh"&&role!=="texture"&&role!=="preview")continue;
    const fallback=format??extensionForMime(mimeType)??"bin";
    const originalName=typeof file.fileName==="string"?Array.from(file.fileName).map(character=>character.charCodeAt(0)<32||character.charCodeAt(0)===127||character==="/"||character==="\\"?"-":character).join("").trim():"";
    const fileName=originalName||`${role}-${files.length+1}.${fallback}`;
    seen.add(file.url);
    files.push({url:file.url,mimeType:mimeType||(format?MODEL3D_FORMAT_MIME_TYPES[format]:null)||"application/octet-stream",fileName,
      fileSize:typeof file.fileSize==="number"&&Number.isSafeInteger(file.fileSize)&&file.fileSize>=0?file.fileSize:null,
      format,role,sha256:typeof file.sha256==="string"?file.sha256:"",...(typeof file.previewSupported==="boolean"?{previewSupported:file.previewSupported}:{})});
  }
  // Legacy primary-only receipts still expose the genuine returned format.
  if(!files.length&&privateMediaUrl(artifact.mediaUrl)){
    const mimeType=artifact.mediaType??"",format=extensionForMime(mimeType);
    if(isModel3dFormat(format))files.push({url:artifact.mediaUrl,mimeType,fileName:`${artifact.title}.${format}`,fileSize:null,format,role:"mesh",sha256:""});
  }
  return files;
}

/** A supported GLB can be an additional mesh when the selected export is another format. */
export function model3dPreviewFile(artifact:Parameters<typeof model3dArtifactFiles>[0]):Model3dArtifactFile|null{
  return model3dArtifactFiles(artifact).find(file=>file.role==="mesh"&&file.format==="glb"&&file.mimeType==="model/gltf-binary"&&file.previewSupported!==false)??null;
}
