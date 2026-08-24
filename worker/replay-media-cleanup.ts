import { ownerMediaNamespaces } from "../src/model/media-ownership.ts";

/** Remove provider-backed replay artifacts that were saved before a failed run
 * reached a reusable terminal state. Completed replay media is never targeted. */
export async function deleteGeneratedImagesByGenerationPrefix(media:R2Bucket,ownerId:string,generationPrefix:string){
  let deleted=0;
  for(const namespace of ownerMediaNamespaces(ownerId)){
    const prefix=`${namespace}/generated/${generationPrefix}`;let cursor:string|undefined;
    do{
      const page=await media.list({prefix,cursor});
      const inspected=await Promise.all(page.objects.map(async(object)=>({key:object.key,metadata:await media.head(object.key)})));
      const keys=inspected.filter(({metadata})=>metadata?.customMetadata?.ownerId===ownerId).map(({key})=>key);
      if(keys.length){await media.delete(keys);deleted+=keys.length;}
      cursor=page.truncated?page.cursor:undefined;
    }while(cursor);
  }
  return deleted;
}
