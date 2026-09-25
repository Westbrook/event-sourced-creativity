const c=JSON.parse(process.env.RELEASE_CONFIG??'null');
if(!c||c.namespace!==process.env.APP_NAME||!/^[a-z][a-z0-9-]{2,29}$/.test(process.env.APP_NAME??''))throw Error('established_target_required');
if(!/^[a-z][a-z0-9-]+@reve-prototyping\.iam\.gserviceaccount\.com$/.test(process.env.DEPLOY_SERVICE_ACCOUNT??''))throw Error('scoped_deploy_identity_required');
c.revision=process.env.GITHUB_SHA;
// Preflight validates target before building; post-build always replaces these with pushed immutable refs.
for(const [key,env]of [['apiImage','API_IMAGE'],['webImage','WEB_IMAGE']])c[key]=process.env[env]??'preflight-only@sha256:'+'0'.repeat(64);
console.log(JSON.stringify(c,null,2));
