import { ownerMediaNamespace } from './media-ownership.ts';
import type { CreativeEvent } from './events.ts';

/** Recovery uses a token-specific object so a stale lease cannot overwrite the
 * original. Resolve only that exact immutable completion's owner/generation
 * path; this is not permission to read an arbitrary owned object. */
export function originalGeneratedImageUrl(owner: string, completed: Pick<CreativeEvent,'payload'|'clientId'|'actor'>): string | null {
  const p=completed.payload;
  if(typeof p.generation_id!=="string"||!/^[A-Za-z0-9._-]+$/u.test(p.generation_id)||typeof p.media_url!=="string")return null;
  const prefix=ownerMediaNamespace(owner)+"/generated/"+p.generation_id;
  const original="/api/media/"+encodeURIComponent(prefix+".png");
  if(p.recovered!==true)return p.media_url===original?original:null;
  if(completed.clientId!=="output-fal-recovery"||completed.actor!=="worker:generator"||p.provider!=="fal"||p.model_id!=="ideogram/v4"||p.source_surface!=="outputs")return null;
  const encodedPrefix="/api/media/"+encodeURIComponent(prefix+"-recovery-");
  if(!p.media_url.startsWith(encodedPrefix))return null;
  const suffix=p.media_url.slice(encodedPrefix.length);
  return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.png$/u.test(suffix)?p.media_url:null;
}
