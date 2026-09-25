import {createRemoteJWKSet,jwtVerify} from 'jose';
const issuer='https://cloud.google.com/iap';
const googleKeys=createRemoteJWKSet(new URL('https://www.gstatic.com/iap/verify/public_key-jwk'));
/** Stable subject mapping is provisioned, never derived from unsigned email headers. */
export function iapVerifier({audience,keys=googleKeys}){
 if(!/^\/projects\/\d+\/global\/backendServices\/\d+$/.test(audience??''))throw Error('iap_audience_required');
 return async headers=>{
  const token=headers.get('x-goog-iap-jwt-assertion');
  if(!token)throw Error('authentication_required');
  const {payload}=await jwtVerify(token,keys,{issuer,audience,algorithms:['ES256'],requiredClaims:['sub','iat','exp'],clockTolerance:30,maxTokenAge:660});
  const now=Date.now()/1000;
  if(typeof payload.sub!=='string'||!payload.sub||typeof payload.iat!=='number'||typeof payload.exp!=='number'||payload.iat>now+30||payload.exp-payload.iat>660)throw Error('invalid_iap_claims');
  return {issuer,subject:payload.sub};
 };
}
export async function resolvePrincipal(db,verified){
 const {rows:[p]}=await db.query(`SELECT p.principal_id,p.account_id,p.permission_epoch,p.consent_version FROM pilot.identity_bindings i JOIN pilot.principals p USING(principal_id) WHERE i.issuer=$1 AND i.subject=$2 AND p.disabled_at IS NULL`,[verified.issuer,verified.subject]);
 if(!p)throw Error('principal_not_enrolled');
 return p;
}
