// Local receipt projection only. Does not call Sites or modify any app/source.
export function projectSite(data){
 const keys=['id','title','slug','status','current_live_url','expected_url','latest_version_number','current_user_role','access_mode','access_policy','updated_at','disabled_by'];
 return {...Object.fromEntries(keys.filter(k=>Object.hasOwn(data,k)).map(k=>[k,data[k]])),omittedCredentialFields:['siwc_bypass_bearer_token','source_repository_credential'].filter(k=>Object.hasOwn(data,k))};
}
