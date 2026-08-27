export type ContextConsentAction="execute"|"retrieve";
export function contextConsentAction(status:string,providerAvailable:boolean){
  const purchase=status==="quoted";
  return{action:(purchase?"execute":"retrieve") as ContextConsentAction,label:purchase?"context.consent.approve":"context.consent.reuse",disabled:purchase&&!providerAvailable};
}

/** A lost response is not proof of an unused approval. Only the server can establish non-submission. */
export function contextConsentFailure<T extends {status:string;providerAvailable?:boolean}>(quote:T|null,outcome:{transport?:boolean;status?:string;error?:string;submission?:string;providerAvailable?:boolean}){
  if(!quote)return{quote,notice:"failed" as const,uncertain:false};
  if(quote.status==="completed")return{quote,notice:"failed" as const,uncertain:false};
  if(outcome.submission==="not-submitted"&&["context_consent_changed","context_consent_expired"].includes(outcome.error??""))return{quote:null,notice:"refresh" as const,uncertain:false};
  if(outcome.submission==="not-submitted")return{quote:{...quote,status:"quoted",...(outcome.providerAvailable===false?{providerAvailable:false}:{})},notice:"not-submitted" as const,uncertain:false};
  const status=outcome.status&&outcome.status!=="quoted"?outcome.status:"uncertain",uncertain=["reserved","submitting","uncertain"].includes(status);
  return{quote:{...quote,status},notice:uncertain?"uncertain" as const:"failed" as const,uncertain};
}
