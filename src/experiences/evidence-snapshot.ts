/** Bounded immutable JSON data without invoking accessors. No authority is created. */
export function snapshotExperienceEvidence(value:unknown):unknown{
 let nodes=0,characters=0;const seen=new Set<object>();
 const visit=(v:unknown,depth:number):unknown=>{
  if(++nodes>8192||depth>16)throw Error("experience_metadata_limit");
  if(v===null||typeof v==="boolean"||typeof v==="number"&&Number.isFinite(v))return v;
  if(typeof v==="string"){characters+=v.length;if(characters<=1_048_576)return v;}
  if(!v||typeof v!=="object"||seen.has(v))throw Error("experience_metadata_invalid");
  const array=Array.isArray(v),prototype=Object.getPrototypeOf(v);
  if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)throw Error("experience_metadata_invalid");
  seen.add(v);const descriptors=Object.getOwnPropertyDescriptors(v),out:Record<string,unknown>=Object.create(null);
  if(Reflect.ownKeys(descriptors).some(k=>typeof k!=="string")||array&&Object.keys(descriptors).length!==v.length+1)throw Error("experience_metadata_invalid");
  if(array){
   for(let index=0;index<v.length;index++)if(!Object.hasOwn(descriptors,String(index)))throw Error("experience_metadata_invalid");
  }
  for(const [key,d] of Object.entries(descriptors)){
   if(array&&key==="length")continue;
   if(!d.enumerable||!Object.hasOwn(d,"value")||["__proto__","constructor","prototype"].includes(key)||array&&!/^(0|[1-9]\d*)$/u.test(key))throw Error("experience_metadata_invalid");
   out[key]=visit(d.value,depth+1);
  }
  seen.delete(v);return Object.freeze(array?Object.values(out):out);
 };return visit(value,0);
}
