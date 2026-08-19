const ownerPrefix=(ownerId:string)=>ownerId.replace(/[^a-zA-Z0-9._-]/g,"-");

/** Remove provider-backed replay artifacts that were saved before a failed run
 * reached a reusable terminal state. Completed replay media is never targeted. */
export async function deleteGeneratedImagesByGenerationPrefix(media:R2Bucket,ownerId:string,generationPrefix:string){
  const prefix=`${ownerPrefix(ownerId)}/generated/${generationPrefix}`;let cursor:string|undefined;let deleted=0;
  do{
    const page=await media.list({prefix,cursor});const keys=page.objects.map((object)=>object.key);
    if(keys.length){await media.delete(keys);deleted+=keys.length;}
    cursor=page.truncated?page.cursor:undefined;
  }while(cursor);
  return deleted;
}
