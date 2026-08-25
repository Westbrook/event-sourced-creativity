import type { CreativeProjection } from "./events.ts";
import { mediaKeyMatchesOwnerNamespace } from "./media-ownership.ts";
import { audioFactProhibited, audioRightsAllowed } from "./audio.ts";

export type DocumentShareScope = {
  resourceKind: "document";
  resourceId: string;
  projectId: string;
  ownerId: string;
  mediaKeys: string[];
};

/** Only canonical, owner-scoped local objects may become shareable media. */
export function ownedMediaKey(value: unknown, ownerId: string): string | null {
  if (typeof value !== "string" || !value.startsWith("/api/media/")) return null;
  try {
    const key = decodeURIComponent(value.slice("/api/media/".length));
    return mediaKeyMatchesOwnerNamespace(key, ownerId) ? key : null;
  } catch {
    return null;
  }
}

const isAudioBlock=(block:CreativeProjection["blocks"][number])=>block.type==="audio"
  ||[block.properties.source_mime_type,block.properties.media_type].some((value)=>String(value??"").toLowerCase().startsWith("audio/"));

function currentlyAuthorizedAudioBlock(block:CreativeProjection["blocks"][number]){
  if(!isAudioBlock(block)||block.properties.include_in_output!==true||block.properties.rights_revoked===true)return false;
  if(!audioRightsAllowed(block.properties.rights_class??block.properties.rights))return false;
  const expires=Date.parse(String(block.properties.license_expires_at??block.properties.rights_expires_at??""));
  return !(Number.isFinite(expires)&&expires<=Date.now())&&!audioFactProhibited({intent:block.properties.intent,effect:block.properties.effect,properties:block.properties});
}

/** Eligibility alone is not source-release consent: only an actual selected, non-transferred companion is shareable. */
export function shareableAudioSourceBlockIds(projection:CreativeProjection){
  const approved=new Set(projection.blocks.filter(currentlyAuthorizedAudioBlock).map((block)=>block.id));
  return new Set(projection.artifacts.flatMap((artifact)=>Array.isArray(artifact.settings?.soundtrack_assets)?artifact.settings.soundtrack_assets.flatMap((value)=>{
    if(!value||typeof value!=="object")return[];
    const asset=value as Record<string,unknown>,id=String(asset.block_id??"");
    return asset.provider_audio_transmitted!==true&&asset.inclusion!=="provider-soundtrack-reference"&&approved.has(id)?[id]:[];
  }):[]));
}

export function shareVisibleBlocks(projection:CreativeProjection){
  const approved=shareableAudioSourceBlockIds(projection);
  const protectedAudioUrls=new Set(projection.blocks.filter(isAudioBlock).map((block)=>String(block.properties.media_url??"")).filter(Boolean));
  const revokedMediaUrls=unauthorizedArtifactMediaUrls(projection);
  return projection.blocks.filter((block)=>{
    const url=String(block.properties.media_url??"");
    if(revokedMediaUrls.has(url))return false;
    const structure=block.properties.artifact_structure;
    if(structure&&typeof structure==="object"&&!Array.isArray(structure)){
      const items=(structure as Record<string,unknown>).items;
      if(Array.isArray(items)&&items.some((item)=>item&&typeof item==="object"&&revokedMediaUrls.has(String((item as Record<string,unknown>).media_url??""))))return false;
    }
    return isAudioBlock(block)?approved.has(block.id):!protectedAudioUrls.has(url);
  });
}

function artifactAudioStillAuthorized(artifact:CreativeProjection["artifacts"][number],projection:CreativeProjection){
  return !Array.isArray(artifact.settings?.soundtrack_assets)||artifact.settings.soundtrack_assets.every((value)=>{
    if(!value||typeof value!=="object")return true;
    const asset=value as Record<string,unknown>;
    if(asset.provider_audio_transmitted!==true&&asset.inclusion!=="provider-soundtrack-reference")return true;
    return projection.blocks.some((block)=>block.id===String(asset.block_id??"")&&currentlyAuthorizedAudioBlock(block));
  });
}

function unauthorizedArtifactMediaUrls(projection:CreativeProjection){
  return new Set(projection.artifacts.filter((artifact)=>!artifactAudioStillAuthorized(artifact,projection))
    .flatMap((artifact)=>[artifact.mediaUrl,...artifact.items.map((item)=>item.mediaUrl)])
    .map((value)=>String(value??"")).filter(Boolean));
}

/** Actual audio R2 objects must resolve to an approved source companion or intentional audio artifact, never editor-controlled MIME claims. */
export function shareAllowsCurrentAudio(projection:CreativeProjection,ownerId:string,key:string){
  const approved=shareableAudioSourceBlockIds(projection);
  return projection.blocks.some((block)=>approved.has(block.id)&&ownedMediaKey(block.properties.media_url,ownerId)===key)
    ||projection.artifacts.some((artifact)=>artifact.kind==="audio"&&artifactAudioStillAuthorized(artifact,projection)&&ownedMediaKey(artifact.mediaUrl,ownerId)===key);
}

/** Freeze the exact object set visible when the immutable document share is created. */
export function documentShareScope(projection: CreativeProjection, ownerId: string, documentId: string, projectId: string): DocumentShareScope | null {
  if (!documentId || !projectId || projection.documentId !== documentId || projection.projectId !== projectId) return null;
  if (!projection.documents.some((document) => document.id === documentId && document.projectId === projectId)) return null;

  const visibleBlocks=shareVisibleBlocks(projection);
  const visibleArtifacts=projection.artifacts.filter((artifact)=>artifactAudioStillAuthorized(artifact,projection));
  const forbiddenMediaKeys=new Set([...unauthorizedArtifactMediaUrls(projection)].map((value)=>ownedMediaKey(value,ownerId)).filter((value):value is string=>Boolean(value)));
  const candidates = [
    ...visibleBlocks.map((block) => block.properties.media_url),
    ...visibleBlocks.flatMap((block) => {
      const structure = block.properties.artifact_structure;
      if (!structure || typeof structure !== "object" || Array.isArray(structure)) return [];
      const items = (structure as Record<string, unknown>).items;
      return Array.isArray(items) ? items.map((item) => item && typeof item === "object" ? (item as Record<string, unknown>).media_url : null) : [];
    }),
    ...projection.outputs.map((output) => output.mediaUrl),
    ...visibleArtifacts.flatMap((artifact) => [artifact.mediaUrl, ...artifact.items.map((item) => item.mediaUrl),...(Array.isArray(artifact.settings?.soundtrack_assets)?artifact.settings.soundtrack_assets.flatMap((value)=>{
      if(!value||typeof value!=="object")return[];
      const asset=value as Record<string,unknown>;
      const sourceBlockId=String(asset.block_id??"");
      return asset.provider_audio_transmitted!==true&&asset.inclusion!=="provider-soundtrack-reference"&&sourceBlockId&&visibleBlocks.some((block)=>block.id===sourceBlockId&&block.properties.include_in_output===true)?[asset.media_url]:[];
    }):[])]),
  ];
  const mediaKeys = [...new Set(candidates.map((value) => ownedMediaKey(value, ownerId)).filter((value): value is string => typeof value === "string"&&!forbiddenMediaKeys.has(value)))].sort();
  return { resourceKind: "document", resourceId: documentId, projectId, ownerId, mediaKeys };
}

export function shareAllowsMedia(scope: Pick<DocumentShareScope, "ownerId" | "mediaKeys">, key: string) {
  return mediaKeyMatchesOwnerNamespace(key, scope.ownerId) && scope.mediaKeys.includes(key);
}

/** Remove private references and rewrite only explicitly authorized object URLs. */
export function sanitizeSharedValue(value: unknown, scope: Pick<DocumentShareScope, "ownerId" | "mediaKeys">, token: string, mediaReference = false): unknown {
  if (typeof value === "string" && value.startsWith("/api/media/")) {
    const key = ownedMediaKey(value, scope.ownerId);
    return key && shareAllowsMedia(scope, key) ? `/api/shared/${encodeURIComponent(token)}/media/${encodeURIComponent(key)}` : null;
  }
  if (typeof value === "string" && mediaReference) return null;
  if (Array.isArray(value)) return value.map((item) => sanitizeSharedValue(item, scope, token, mediaReference));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => {
      const normalized=key.replace(/([a-z\d])([A-Z])/g,"$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g,"$1_$2").toLowerCase().replace(/_i_ds$/,"_ids");
      return !/(?:^|_)(?:content|prompt|intent|input)_?ref$/i.test(normalized)
        && !/(?:^|_)prompt(?:_|$)/.test(normalized)
        && !/(?:^|_)(?:model|adapter)(?:_id|_version)?$/.test(normalized)
        && !/(?:^|_)provider(?:$|_(?:id|name|model|request|receipt|job|status|response|cancel|url))/.test(normalized)
        && !/^(?:request_id|client_id|correlation_id|causation_id|scene_id|target_id|source_artifact_item_id|reference_id|source_content_hash|source_evidence_hash|sha256)$/.test(normalized)
        && !/^(?:(?:source(?:_[a-z]+)*|context_(?:group|set)|block|claim|group)_ids?|source_(?:keys?|alias(?:es|_map)?))$/.test(normalized)
        && !/^organization_context_(?:source_block|package(?:_version|_binding)?)_ids?$/.test(normalized)
        && !/^(?:source|evidence)(?:_[a-z]+)*_refs?$/.test(normalized)
        && !/^source_block_versions?$/.test(normalized)
        && !/^(?:source|context)(?:_[a-z]+)*_fingerprints?$/.test(normalized);
    }).map(([key, item]) => [key, sanitizeSharedValue(item, scope, token, /^(?:media|image|thumbnail|preview|poster|audio|soundtrack|recording)_?url$/i.test(key))]));
  }
  return value;
}
