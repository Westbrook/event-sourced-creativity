import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const [{ensureSchema},{POLICY_VERSION},{PRINCIPAL_WITH_ACCESS_SQL},{SPONSOR_ENTITLEMENT_SCHEMA},{SPONSOR_RESOURCE_SCHEMA},
  {SPONSOR_APPROVAL_SCHEMA,approveSponsorCampaign,compileSponsorApprovalProposal},{compileGuestSponsorApprovalProposal},
  {approveGuestSponsorCampaign,revokeGuestSponsorCampaign},{preflightOutputImageSlidesTarget},{sponsorImageTransport},
  {registeredExperience},{canonicalJson,digest},{readSponsorPolicy}]=await Promise.all([
  import('../worker/runtime.ts'),import('../worker/policy-version.ts'),import('../worker/access-policy.ts'),
  import('../worker/experience-sponsor-entitlement.ts'),import('../worker/experience-sponsor-resources.ts'),import('../worker/experience-sponsor-approval.ts'),
  import('../worker/experience-guest-sponsor-contract.ts'),import('../worker/experience-guest-sponsor-approval.ts'),
  import('../worker/output-image-slides-preflight.ts'),import('../worker/experience-sponsor-image-evidence.ts'),
  import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts'),import('../worker/experience-sponsor-policy.ts')]);
const origin='https://forma.example.invalid',url=`${origin}/unregistered-guest-approval`,payer='synthetic-payer';
const clock="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)",time='2020-01-01T00:00:00.000Z',epoch='2030-01-01T00:00:00.000Z',LIMIT=131072;
const h=char=>`sha256:${char.repeat(64)}`;
const headers=(actor=payer,extra={})=>({'content-type':'application/json',origin,...(actor?{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':`${actor}@example.invalid`}:{}),...extra});
const request=(body,actor=payer,overrides={})=>new Request(url,{method:'POST',headers:headers(actor),body:JSON.stringify(body),...overrides});
const rows=(f,table)=>f.sqlite.prepare(`SELECT * FROM "${table.replaceAll('"','""')}"`).all();
const snapshot=f=>{const schema=f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();return {schema,contents:Object.fromEntries(schema.filter(row=>row.type==='table').map(row=>[row.name,rows(f,row.name)]))};};
const changes=f=>f.sqlite.prepare('SELECT total_changes() AS n').get().n;
const configTables=['experience_sponsor_campaigns','experience_sponsor_resource_policies','experience_sponsor_approvals'];
const authorityFields=['user_id','role','consent_version','updated_at','permission_epoch','grants_json','organizations_json','projects_json','identity_policies_json','approved_canvas_requirements'];
const authority=f=>{const row=f.sqlite.prepare(PRINCIPAL_WITH_ACCESS_SQL).get(payer);return row?authorityFields.map(key=>row[key]??null):null;};
const approvalBatch=statements=>statements.some(statement=>statement.sql.startsWith('INSERT INTO experience_sponsor_approvals'));
const revokeBatch=statements=>statements.some(statement=>statement.sql.startsWith('UPDATE experience_sponsor_approvals'));
function onlyChanged(f,before,allowed=configTables){const after=snapshot(f);assert.deepEqual(after.schema,before.schema);for(const [table,value]of Object.entries(before.contents))if(!allowed.includes(table))assert.deepEqual(after.contents[table],value,table);}
function insert(f,table,row){const keys=Object.keys(row);f.sqlite.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row));}
async function templateFor(env, release) {
  const offered = await preflightOutputImageSlidesTarget({ env,
    target: { id: 'synthetic-template', selected: true, blocking_issues: [], media_kind: 'image', source_scope: { kind: 'document' },
      aspect_ratio: { width: 1, height: 1 }, instruction_text: 'Show a pear orchard', label: 'Synthetic template', coverage: { kind: 'document_outline' } },
    context: { snapshot: { facts: [{ type: 'subject', properties: { text: 'A pear orchard' } }] } } });
  assert.equal(offered.available, true);
  const settings = offered.settings, payload = settings.payload;
  return { version: 2, appId: 'image', recipeVersion: `image@${release.definition.revision}`, releaseDigest: release.releaseHash,
    outputKind: 'image', inputMode: 'text-only', outputCount: 1, durationMs: 0, width: 1024, height: 1024,
    route: offered.route, maximumCalls: offered.maximumCalls, maximumTokens: offered.maximumTokens, maximumMicrousd: offered.maximumMicrousd,
    calls: structuredClone(settings.calls), settings: { kind: settings.kind, productionMode: payload.productionMode,
      budgetAcknowledged: payload.budgetAcknowledged, preflightAcknowledged: payload.preflightAcknowledged,
      imageRender: structuredClone(settings.imageRender), imageBudget: structuredClone(settings.imageBudget), executionPolicy: structuredClone(settings.executionPolicy) },
    transport: await sponsorImageTransport(env) };
}

async function proposalFor(f){const now=f.sqlite.prepare(`SELECT ${clock} AS now`).get().now,template=await templateFor(f.env,await registeredExperience('image'));
  const allowance={maximumOperations:100,maximumTextBytes:1000000,maximumOperationsPerWindow:100,maximumTextBytesPerWindow:1000000,maximumPendingGrants:10,maximumInflightJobs:1};
  return {version:1,purpose:'guest-sponsored-image',issuerProtocol:'guest-image-source@1',policy:{version:3,mode:'candidate',campaignId:'synthetic-guest-campaign',policyVersion:'synthetic-guest@1',payerUserId:payer,
    audience:'guest-session',startsAtMs:now-60000,expiresAtMs:now+120000,maximumGrantLifetimeMs:30000,maximumAdmissions:10,maximumMicrousd:template.maximumMicrousd*10,maximumAdmissionsPerActor:5,
    windowMs:60000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,templates:[template],
    resources:{version:2,allowedOperations:['text-intake','preflight','issuance','image-text-draft-storage'],startsAtMs:now-60000,expiresAtMs:now+120000,windowMs:60000,maximumOperationTextBytes:65536,campaign:{...allowance,maximumInflightJobs:3},actor:{...allowance}},
    guestAdmission:{protocol:'guest-image-source@1',origin,sessionPolicyId:'contingent-session-policy',sessionTermsDigest:h('b'),sourcePolicyId:'contingent-source-policy',sourcePolicyDigest:h('c'),releaseHash:template.releaseDigest}}};}
function seedAuthority(f){
  insert(f,'organizations',{organization_id:'authority-org',name:'Original organization',owner_user_id:payer,status:'active',created_at:time,updated_at:time});
  insert(f,'organization_memberships',{membership_id:'authority-member',organization_id:'authority-org',user_id:payer,role:'owner',status:'active',invited_by_user_id:payer,accepted_at:time,created_at:time,updated_at:time});
  insert(f,'organization_projects',{project_access_id:'authority-project-access',project_id:'authority-project',organization_id:'authority-org',owner_user_id:payer,status:'active',created_at:time,updated_at:time});
  insert(f,'organization_security_policies',{organization_id:'authority-org',authentication_source:'any',allowed_domains_json:'[]',require_mfa:0,version:1,updated_by_user_id:payer,updated_at:time});
  for(const [id,status,capability,updated]of [['authority-active','active','self.usage.read',time],['authority-epoch','revoked','self.profile.read',epoch]])insert(f,'capability_grants',{grant_id:id,user_id:payer,capability,scope_type:'self',status,granted_by_user_id:payer,created_at:time,updated_at:updated});
  f.sqlite.prepare("INSERT INTO canvas_governance_requirements(requirement_id,status,details_json,updated_at) VALUES('trust_safety','approved','{}',?) ON CONFLICT(requirement_id) DO UPDATE SET status='approved',details_json='{}',updated_at=excluded.updated_at").run(time);
}
async function commandFor(f,proposal=f.proposal,approvalId='synthetic-guest-approval'){const compiled=await compileGuestSponsorApprovalProposal(proposal);
  return {version:1,action:'approve-guest-sponsor-campaign',approvalId,proposal,reviewedTermsDigest:compiled.termsDigest,confirmation:'APPROVE_GUEST_SPONSOR_CAMPAIGN'};}
async function fixture(t,{rich=true}={}){const f=outputTestDatabase();t.after(()=>f.sqlite.close());await ensureSchema(f.env);
  for(const sql of [...SPONSOR_ENTITLEMENT_SCHEMA,...SPONSOR_RESOURCE_SCHEMA,...SPONSOR_APPROVAL_SCHEMA])f.sqlite.exec(sql);
  for(const [actor,role]of [[payer,'creator'],['other','admin']])insert(f,'users',{user_id:actor,email:`${actor}@example.invalid`,display_name:actor,role,consent_version:POLICY_VERSION,consented_at:time,created_at:time,updated_at:time});
  if(rich)seedAuthority(f);Object.assign(f.env,{OPENAI_API_KEY:'no-network-fixture',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'});
  let egress=0,media=0;t.mock.method(globalThis,'fetch',()=>{egress++;throw Error('network forbidden');});for(const method of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,method,()=>{media++;throw Error('media forbidden');});
  t.after(()=>{assert.equal(egress,0);assert.equal(media,0);});f.proposal=await proposalFor(f);f.compiled=await compileGuestSponsorApprovalProposal(f.proposal);f.command=await commandFor(f);
  f.revokeCommand={version:1,action:'revoke-guest-sponsor-campaign',campaignId:f.proposal.policy.campaignId,policyDigest:f.compiled.policyDigest,confirmation:'REVOKE_GUEST_SPONSOR_CAMPAIGN'};
  f.approve=(command=f.command,actor=payer,overrides={})=>approveGuestSponsorCampaign(request(command,actor,overrides),f.env);
  f.revoke=(command=f.revokeCommand,actor=payer,overrides={})=>revokeGuestSponsorCampaign(request(command,actor,overrides),f.env);return f;}
function checkReceipt(f,result,status='approved',replayed=false){assert.deepEqual(Object.keys(result).sort(),['version','status','approvalId','campaignId','termsDigest','policyDigest','replayed','generationAvailable'].sort());
  assert.equal(result.version,1);assert.equal(result.status,status);assert.equal(result.approvalId,f.command.approvalId);assert.equal(result.campaignId,f.proposal.policy.campaignId);
  assert.equal(result.termsDigest,f.compiled.termsDigest);assert.equal(result.policyDigest,f.compiled.policyDigest);assert.equal(result.replayed,replayed);assert.equal(result.generationAvailable,false);assert.ok(Object.isFrozen(result));}
function hook(f,predicate,action,{method='first',after=true,occurrence=1}={}){const prepare=f.DB.prepare;let hits=0,fired=false;
  function wrap(statement,sql){const original=statement[method],bind=statement.bind;statement.bind=function(...args){return wrap(bind.apply(this,args),sql);};
    statement[method]=async function(){if(predicate(sql)&&++hits===occurrence){fired=true;if(!after)action();const result=await original.call(this);if(after)action();return result;}return original.call(this);};return statement;}
  f.DB.prepare=function(sql){return wrap(prepare.call(this,sql),sql);};return()=>{f.DB.prepare=prepare;assert.equal(fired,true,'native read hook executed');};}
function batchHook(f,predicate,action,{after=true}={}){const batch=f.DB.batch;let attempts=0;
  f.DB.batch=async statements=>{if(predicate(statements)){attempts++;if(attempts===1&&!after)action(statements);const result=await batch.call(f.DB,statements);if(attempts===1&&after)return action(result);return result;}else return batch.call(f.DB,statements);};
  return()=>{f.DB.batch=batch;assert.equal(attempts,1,'one mutation attempt, no automatic retry');};}
const authorityMutations=[
  ['user_id',"UPDATE users SET user_id='renamed-payer' WHERE user_id=?",[payer]],['role',"UPDATE users SET role='admin' WHERE user_id=?",[payer]],
  ['consent_version',"UPDATE users SET consent_version='not-current' WHERE user_id=?",[payer]],['updated_at',"UPDATE users SET updated_at='2021-01-01T00:00:00.000Z' WHERE user_id=?",[payer]],
  ['permission_epoch',"UPDATE capability_grants SET updated_at='2031-01-01T00:00:00.000Z' WHERE grant_id='authority-epoch'",[]],
  ['grants_json',"UPDATE capability_grants SET capability='self.privacy.manage' WHERE grant_id='authority-active'",[]],
  ['organizations_json',"UPDATE organizations SET name='Changed organization' WHERE organization_id='authority-org'",[]],
  ['projects_json',"UPDATE organization_projects SET project_id='changed-project' WHERE project_access_id='authority-project-access'",[]],
  ['identity_policies_json',"UPDATE organization_security_policies SET version=2 WHERE organization_id='authority-org'",[]],
  ['approved_canvas_requirements',"UPDATE canvas_governance_requirements SET status='pending' WHERE requirement_id='trust_safety'",[]],
];
async function waitUntil(predicate){const start=performance.now();while(!predicate()){assert.ok(performance.now()-start<5000);await delay(10);}}

for(const rich of [false,true])test(`full approval, exact replay and monotonic revoke fit strict D1 limits with ${rich?'populated':'basic'} native authority`,async t=>{
  const f=await fixture(t,{rich}),before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{checkReceipt(f,await f.approve());checkReceipt(f,await f.approve(),'approved',true);checkReceipt(f,await f.revoke(),'revoked');checkReceipt(f,await f.revoke(),'revoked',true);limits.assertVerified();
    t.diagnostic(JSON.stringify({rich,qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));
  }finally{limits.restore();}onlyChanged(f,before);
});
test('synthetic payer through native authentication records exact v3 command, terms, policy, resources and ten-field authority once',async t=>{
  const f=await fixture(t),before=snapshot(f),expectedAuthority=authority(f),start=f.sqlite.prepare(`SELECT ${clock} AS now`).get().now;checkReceipt(f,await f.approve());const end=f.sqlite.prepare(`SELECT ${clock} AS now`).get().now;
  const [row]=rows(f,'experience_sponsor_approvals'),[campaign]=rows(f,'experience_sponsor_campaigns'),[resources]=rows(f,'experience_sponsor_resource_policies');
  assert.equal(row.terms_json,f.compiled.termsJson);assert.equal(row.terms_digest,f.compiled.termsDigest);assert.equal(row.policy_json,f.compiled.policyJson);assert.equal(row.policy_digest,f.compiled.policyDigest);
  assert.equal(row.approval_command_json,canonicalJson(f.command));assert.equal(row.payer_user_id,payer);assert.equal(row.approved_by_user_id,payer);assert.deepEqual(JSON.parse(row.payer_authority_json),expectedAuthority);
  assert.ok(row.approved_at_ms>=start&&row.approved_at_ms<=end);assert.equal(row.revoked_at_ms,null);assert.equal(campaign.policy_json,f.compiled.policyJson);assert.equal(campaign.policy_digest,f.compiled.policyDigest);assert.equal(campaign.enabled,1);
  assert.equal(resources.limits_json,canonicalJson(f.proposal.policy.resources));assert.equal(resources.limits_digest,await digest(f.proposal.policy.resources));assert.equal(resources.enabled,1);onlyChanged(f,before);
  const saved=snapshot(f),count=changes(f);checkReceipt(f,await f.approve(),'approved',true);assert.deepEqual(snapshot(f),saved);assert.equal(changes(f),count);
});
test('the current canonical payer may be an admin while an unrelated admin cannot approve or revoke',async t=>{
  const f=await fixture(t),before=snapshot(f);await assert.rejects(f.approve(f.command,'other'));assert.deepEqual(snapshot(f),before);f.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id=?").run(payer);
  checkReceipt(f,await f.approve());const saved=snapshot(f);await assert.rejects(f.revoke(f.revokeCommand,'other'));assert.deepEqual(snapshot(f),saved);
});
test('absent or lifecycle-required identities never cause account setup or profile repair',async t=>{
  const f=await fixture(t);for(const [actor,extra]of [[null,{}],['missing',{}],[payer,{'oai-authenticated-user-email':'changed@example.invalid'}],[payer,{'oai-authenticated-user-full-name':'Changed','oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'}]]){
    const before=snapshot(f);await assert.rejects(f.approve(f.command,actor,{headers:headers(actor,extra)}));assert.deepEqual(snapshot(f),before);}
});
test('role, consent, context and impersonation boundaries deny both handlers without mutation',async t=>{
  for(const stage of ['approve','revoke'])for(const change of ['viewer','consent','context','impersonation','cohort']){const f=await fixture(t);if(stage==='revoke')await f.approve();const extra={};
    if(change==='viewer')f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(payer);else if(change==='consent')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(payer);
    else if(change==='cohort')f.env.FORMA_PILOT_COHORT_ID='configured';else extra.cookie=change==='context'?'forma_project_context=stale':'forma_impersonation=stale';
    const before=snapshot(f);await assert.rejects(stage==='approve'?f.approve(f.command,payer,{headers:headers(payer,extra)}):f.revoke(f.revokeCommand,payer,{headers:headers(payer,extra)}));assert.deepEqual(snapshot(f),before);}
});
test('unreviewed caps, resources, guest bindings and closed command changes cannot become approval',async t=>{
  const f=await fixture(t),mutations=[command=>command.reviewedTermsDigest=h('0'),command=>command.proposal.policy.maximumMicrousd++,command=>command.proposal.policy.resources.actor.maximumOperations--,
    command=>command.proposal.policy.guestAdmission.sourcePolicyDigest=h('0'),command=>command.action='approve-sponsor-campaign',command=>command.confirmation='APPROVE_SPONSOR_CAMPAIGN',command=>command.version=2,
    command=>command.nowMs=Date.now(),command=>command.actorUserId=payer,command=>command.proposal.policy.approvalReceiptDigest=h('0'),command=>command.proposal.policy.version=2];
  for(const change of mutations){const command=structuredClone(f.command);change(command);const before=snapshot(f);await assert.rejects(f.approve(command));assert.deepEqual(snapshot(f),before);}
  assert.throws(()=>readSponsorPolicy(f.compiled.policy));
});
test('same approval ID and campaign ID cannot be reused for different exact commands or terms',async t=>{
  const f=await fixture(t);await f.approve();const before=snapshot(f),changed=structuredClone(f.proposal);changed.policy.maximumMicrousd++;
  const otherCampaign=structuredClone(f.proposal);otherCampaign.policy.campaignId='another-campaign';
  for(const command of [await commandFor(f,changed),await commandFor(f,f.proposal,'other-approval'),await commandFor(f,otherCampaign)])await assert.rejects(f.approve(command));assert.deepEqual(snapshot(f),before);
});
for(const partial of ['campaign','campaign-resource'])test(`pre-existing ${partial} configuration is neither repaired nor overwritten into an approval`,async t=>{
  const f=await fixture(t);insert(f,'experience_sponsor_campaigns',{campaign_id:f.proposal.policy.campaignId,policy_digest:f.compiled.policyDigest,policy_json:f.compiled.policyJson,enabled:1});
  if(partial==='campaign-resource')insert(f,'experience_sponsor_resource_policies',{campaign_id:f.proposal.policy.campaignId,limits_digest:await digest(f.proposal.policy.resources),limits_json:canonicalJson(f.proposal.policy.resources),enabled:1});
  const before=snapshot(f);await assert.rejects(f.approve());assert.deepEqual(snapshot(f),before);
});
for(const [field,sql,bindings]of authorityMutations)test(`actual ${field} drift between authentication and authority snapshot cannot be recaptured as approval`,async t=>{
  const f=await fixture(t),beforeAuthority=authority(f);let changed;const done=hook(f,sql=>sql===PRINCIPAL_WITH_ACCESS_SQL,()=>{f.sqlite.prepare(sql).run(...bindings);const current=authority(f);
    if(field==='user_id')assert.equal(current,null);else assert.deepEqual(authorityFields.filter((_,index)=>current[index]!==beforeAuthority[index]),[field]);changed=snapshot(f);});
  await assert.rejects(f.approve());done();assert.deepEqual(snapshot(f),changed);
});
test('email and display-name drift after native authentication is rejected before approval',async t=>{
  for(const field of ['email','display_name']){const f=await fixture(t);let changed;const done=hook(f,sql=>sql===PRINCIPAL_WITH_ACCESS_SQL,()=>{f.sqlite.prepare(`UPDATE users SET ${field}=? WHERE user_id=?`).run(field==='email'?'changed@example.invalid':'Changed',payer);changed=snapshot(f);});
    await assert.rejects(f.approve());done();assert.deepEqual(snapshot(f),changed);}
});
for(const kind of ['lost','truncated','false'])test(`${kind} mutation acknowledgment resolves only the original exact current approval without automatic retry`,async t=>{
  const f=await fixture(t),done=batchHook(f,approvalBatch,result=>{if(kind==='lost')throw Error('lost ack');if(kind==='truncated')return result.slice(0,-1);return result.map((row,index)=>index?row:{...row,success:false});});
  checkReceipt(f,await f.approve(),'approved',true);done();assert.equal(rows(f,'experience_sponsor_approvals').length,1);
});
test('late in-transaction authority loss rolls back campaign, resource configuration and approval together',async t=>{
  const f=await fixture(t),before=snapshot(f),prepare=f.DB.prepare;let hit=false;
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;statement.bind=function(...bindings){const bound=bind.call(this,...bindings),execute=bound.execute;
    bound.execute=function(kind){if(!hit&&sql.startsWith('INSERT INTO experience_sponsor_approvals')){hit=true;f.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id=?").run(payer);}return execute.call(this,kind);};return bound;};return statement;};
  await assert.rejects(f.approve());f.DB.prepare=prepare;assert.equal(hit,true);assert.deepEqual(snapshot(f),before);
});
test('native authority loss just before the batch is not undone and is not hidden by a retry',async t=>{
  const f=await fixture(t);let changed;const done=batchHook(f,approvalBatch,()=>{f.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id=?").run(payer);changed=snapshot(f);},{after:false});
  await assert.rejects(f.approve());done();assert.deepEqual(snapshot(f),changed);
});
test('concurrent identical approvals converge while changed approval identities cannot win twice',async t=>{
  const f=await fixture(t),results=await Promise.all([f.approve(),f.approve()]);assert.equal(rows(f,'experience_sponsor_approvals').length,1);assert.equal(results.filter(result=>!result.replayed).length,1);
  const before=snapshot(f);await assert.rejects(f.approve(await commandFor(f,f.proposal,'different-id')));assert.deepEqual(snapshot(f),before);
});
for(const damage of ['campaign-json','campaign-digest','campaign-disabled','resource-json','resource-digest','resource-disabled','resource-missing'])test(`approval replay rejects ${damage} without configuration repair`,async t=>{
  const f=await fixture(t);await f.approve();const sql={
    'campaign-json':"UPDATE experience_sponsor_campaigns SET policy_json='{}'",'campaign-digest':`UPDATE experience_sponsor_campaigns SET policy_digest='${h('0')}'`,'campaign-disabled':'UPDATE experience_sponsor_campaigns SET enabled=0',
    'resource-json':"UPDATE experience_sponsor_resource_policies SET limits_json='{}'",'resource-digest':`UPDATE experience_sponsor_resource_policies SET limits_digest='${h('0')}'`,'resource-disabled':'UPDATE experience_sponsor_resource_policies SET enabled=0','resource-missing':'DELETE FROM experience_sponsor_resource_policies'}[damage];
  f.sqlite.exec(sql);const before=snapshot(f);await assert.rejects(f.approve());assert.deepEqual(snapshot(f),before);
});
test('database clock governs approval and replay even with a forged process clock',async t=>{
  const f=await fixture(t),now=f.sqlite.prepare(`SELECT ${clock} AS now`).get().now;f.proposal.policy.expiresAtMs=now+350;f.proposal.policy.resources.expiresAtMs=now+350;
  f.compiled=await compileGuestSponsorApprovalProposal(f.proposal);f.command=await commandFor(f);f.revokeCommand.policyDigest=f.compiled.policyDigest;
  t.mock.method(Date,'now',()=>0);checkReceipt(f,await f.approve());await waitUntil(()=>f.sqlite.prepare(`SELECT ${clock}>=? AS expired`).get(f.proposal.policy.expiresAtMs).expired);
  const before=snapshot(f);await assert.rejects(f.approve());assert.deepEqual(snapshot(f),before);checkReceipt(f,await f.revoke(),'revoked');
});
test('approval may precede the resource subwindow without extending or changing its limits',async t=>{
  const f=await fixture(t),now=f.sqlite.prepare(`SELECT ${clock} AS now`).get().now;f.proposal.policy.resources.startsAtMs=now+30000;f.compiled=await compileGuestSponsorApprovalProposal(f.proposal);f.command=await commandFor(f);
  checkReceipt(f,await f.approve());assert.equal(JSON.parse(rows(f,'experience_sponsor_resource_policies')[0].limits_json).startsAtMs,now+30000);
});
test('revocation remains available after original authority and configuration drift but cannot reapprove',async t=>{
  const f=await fixture(t);await f.approve();f.sqlite.prepare("UPDATE users SET role='admin',updated_at='2021-01-01T00:00:00.000Z' WHERE user_id=?").run(payer);
  f.sqlite.exec("UPDATE experience_sponsor_campaigns SET policy_json='{}',policy_digest='changed'; UPDATE experience_sponsor_resource_policies SET limits_json='{}',limits_digest='changed',enabled=0");
  const before=snapshot(f);await assert.rejects(f.approve());checkReceipt(f,await f.revoke(),'revoked');onlyChanged(f,before);const first=rows(f,'experience_sponsor_approvals')[0].revoked_at_ms;
  checkReceipt(f,await f.revoke(),'revoked',true);assert.equal(rows(f,'experience_sponsor_approvals')[0].revoked_at_ms,first);await assert.rejects(f.approve());
});
test('revocation requires exact original policy digest and closed guest action',async t=>{
  const f=await fixture(t);await f.approve();for(const command of [{...f.revokeCommand,policyDigest:h('0')},{...f.revokeCommand,confirmation:'REVOKE_SPONSOR_CAMPAIGN'},{...f.revokeCommand,action:'revoke-sponsor-campaign'},{...f.revokeCommand,extra:true}]){const before=snapshot(f);await assert.rejects(f.revoke(command));assert.deepEqual(snapshot(f),before);}
});
test('lost revocation acknowledgment recovers disabled state once and preserves the first timestamp',async t=>{
  const f=await fixture(t);await f.approve();const done=batchHook(f,revokeBatch,()=>{throw Error('lost revoke ack');});checkReceipt(f,await f.revoke(),'revoked',true);done();const before=snapshot(f),first=rows(f,'experience_sponsor_approvals')[0].revoked_at_ms;
  checkReceipt(f,await f.revoke(),'revoked',true);assert.equal(rows(f,'experience_sponsor_approvals')[0].revoked_at_ms,first);assert.deepEqual(snapshot(f),before);
});

function seedHistory(f){const now=f.sqlite.prepare(`SELECT ${clock} AS now`).get().now,campaign=f.proposal.policy.campaignId;
  insert(f,'experience_sponsor_campaigns',{campaign_id:'unrelated-campaign',policy_digest:h('a'),policy_json:'{}',enabled:1});
  insert(f,'experience_sponsor_resource_policies',{campaign_id:'unrelated-campaign',limits_digest:h('f'),limits_json:'{"unrelated":true}',enabled:1});
  for(const [grantId,campaignId]of [['pending-grant',campaign],['used-grant',campaign],['unrelated-grant','unrelated-campaign']])insert(f,'experience_sponsor_grants',{
    grant_id:grantId,campaign_id:campaignId,policy_digest:f.compiled.policyDigest,actor_user_id:'fixture-actor',session_digest:h('b'),intent_key:grantId,envelope_digest:h('c'),issued_at_ms:now,expires_at_ms:now+60000,enabled:1});
  insert(f,'experience_sponsor_consumptions',{consumption_id:'consumed',grant_id:'used-grant',campaign_id:campaign,actor_user_id:'fixture-actor',session_digest:h('b'),intent_key:'used-grant',envelope_digest:h('c'),job_id:'fixture-job',maximum_microusd:1234,admitted_at_ms:now});
  insert(f,'experience_sponsor_active_jobs',{actor_user_id:'fixture-actor',consumption_id:'consumed',job_id:'fixture-job'});
  insert(f,'experience_sponsor_resource_receipts',{resource_id:'resource-used',campaign_id:campaign,policy_digest:f.compiled.policyDigest,limits_digest:h('d'),actor_user_id:'fixture-actor',session_digest:h('b'),operation:'text-intake',intent_key:'resource-used',payload_digest:h('e'),text_bytes:17,issued_grant_id:null,recorded_at_ms:now});
  insert(f,'document_jobs',{job_id:'fixture-job',owner_id:'fixture-actor',stream_id:'creative:fixture-actor',document_id:'fixture-document',kind:'image',status:'running',source_surface:'fixture',correlation_id:'fixture-job',requested_sequence:1,request_json:'{}',requested_at:time,expires_at:'2099-01-01T00:00:00.000Z',updated_at:time});
  insert(f,'budget_counters',{scope:'user',scope_id:payer,period:'2026-09',used_tokens:11,reserved_tokens:100,hard_limit_tokens:1000,updated_at:time});
  insert(f,'cost_budget_counters',{scope:'user',scope_id:payer,period:'2026-09',used_microusd:23,reserved_microusd:1234,hard_limit_microusd:100000,updated_at:time});
  insert(f,'budget_reservations',{reservation_id:'held-tokens',owner_id:payer,stream_id:'creative:fixture-actor',correlation_id:'fixture-job',operation:'image',period:'2026-09',reserved_tokens:100,used_tokens:0,status:'active',created_at:time,updated_at:time});
  insert(f,'cost_budget_reservations',{reservation_id:'held-cost',owner_id:payer,workspace_id:'forma',stream_id:'creative:fixture-actor',correlation_id:'fixture-job',operation:'image',period:'2026-09',reserved_microusd:1234,used_microusd:0,status:'active',created_at:time,updated_at:time});
}
test('revoke disables all matching grants and preserves nonempty usage, holds, jobs and unrelated history',async t=>{
  const f=await fixture(t);await f.approve();seedHistory(f);const before=snapshot(f);checkReceipt(f,await f.revoke(),'revoked');onlyChanged(f,before,[...configTables,'experience_sponsor_grants']);
  for(const row of rows(f,'experience_sponsor_grants'))assert.deepEqual({...row},{...before.contents.experience_sponsor_grants.find(item=>item.grant_id===row.grant_id),enabled:row.campaign_id===f.proposal.policy.campaignId?0:1});
  assert.deepEqual(rows(f,'experience_sponsor_campaigns').find(row=>row.campaign_id==='unrelated-campaign'),before.contents.experience_sponsor_campaigns.find(row=>row.campaign_id==='unrelated-campaign'));
  assert.deepEqual(rows(f,'experience_sponsor_resource_policies').find(row=>row.campaign_id==='unrelated-campaign'),before.contents.experience_sponsor_resource_policies.find(row=>row.campaign_id==='unrelated-campaign'));
  const revoked=snapshot(f);await delay(5);checkReceipt(f,await f.revoke(),'revoked',true);assert.deepEqual(snapshot(f),revoked);
});
test('late revoke final-guard failure rolls back its tombstone and all disable updates',async t=>{
  const f=await fixture(t);await f.approve();seedHistory(f);const before=snapshot(f),prepare=f.DB.prepare;let hit=false;
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;statement.bind=function(...bindings){const bound=bind.call(this,...bindings),execute=bound.execute;
    bound.execute=function(kind){if(!hit&&sql.startsWith('UPDATE experience_sponsor_grants')){hit=true;f.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id=?").run(payer);}return execute.call(this,kind);};return bound;};return statement;};
  await assert.rejects(f.revoke());f.DB.prepare=prepare;assert.equal(hit,true);assert.deepEqual(snapshot(f),before);
});
test('actual canonical v2 approval collision remains intact and cannot be interpreted by guest v3 handlers',async t=>{
  const f=await fixture(t),{guestAdmission:ignored,...policy}=structuredClone(f.proposal.policy);void ignored;policy.version=2;policy.audience='canonical-principal';
  const proposal={policy,eligibleActorUserIds:['other'],issuerUserIds:['other']},compiled=await compileSponsorApprovalProposal(proposal);
  const command={action:'approve-sponsor-campaign',approvalId:'canonical-v2-approval',proposal,reviewedTermsDigest:compiled.termsDigest,confirmation:'APPROVE_SPONSOR_CAMPAIGN'};
  const accepted=await approveSponsorCampaign(request(command),f.env);assert.equal(accepted.replayed,false);const before=snapshot(f);
  await assert.rejects(f.approve());await assert.rejects(f.revoke({...f.revokeCommand,policyDigest:compiled.policyDigest}));assert.deepEqual(snapshot(f),before);
});
test('full immutable command bytes remain mandatory for historical approval and revoke reads',async t=>{
  const f=await fixture(t);await f.approve();assert.throws(()=>f.sqlite.exec("UPDATE experience_sponsor_approvals SET approval_command_json='{}'"),/immutable/);
  f.sqlite.exec('DROP TRIGGER experience_sponsor_approval_immutable');const wrong={...f.command,extra:true};f.sqlite.prepare('UPDATE experience_sponsor_approvals SET approval_command_json=?').run(canonicalJson(wrong));
  const before=snapshot(f);await assert.rejects(f.approve());await assert.rejects(f.revoke());assert.deepEqual(snapshot(f),before);
});
for(const association of ['user','email'])test(`active pilot participation by ${association} denies both handlers without initialization`,async t=>{
  for(const stage of ['approve','revoke']){const f=await fixture(t);if(stage==='revoke')await f.approve();insert(f,'pilot_cohorts',{cohort_id:'active-cohort',organization_id:'authority-org',status:'active',starts_at:time,ends_at:'2099-01-01T00:00:00.000Z',created_by_user_id:payer,created_at:time,updated_at:time});
    insert(f,'pilot_participants',{participant_id:'active-participant',cohort_id:'active-cohort',organization_id:'authority-org',email_normalized:association==='email'?`${payer}@example.invalid`:'different@example.invalid',user_id:association==='user'?payer:null,status:'active',invited_by_user_id:payer,created_at:time});
    const before=snapshot(f);await assert.rejects(stage==='approve'?f.approve():f.revoke());assert.deepEqual(snapshot(f),before);}
});
test('empty, stale, duplicate and leading-space context or impersonation cookies cannot bypass explicit personal payer intent',async t=>{
  const f=await fixture(t);for(const cookie of ['forma_project_context=','forma_impersonation=','forma_project_context=stale; forma_project_context=',
    'forma_impersonation=stale; forma_impersonation=','forma_project_context=; forma_project_context=stale','forma_impersonation=; forma_impersonation=stale',' forma_project_context=stale','  forma_impersonation=stale','other=x; forma_project_context=']){
    const before=snapshot(f);await assert.rejects(f.approve(f.command,payer,{headers:headers(payer,{cookie})}));assert.deepEqual(snapshot(f),before);}
});
test('the trusted identity header cannot change after native authentication',async t=>{
  const f=await fixture(t),req=request(f.command),before=snapshot(f),done=hook(f,sql=>sql===PRINCIPAL_WITH_ACCESS_SQL,()=>req.headers.set('oai-authenticated-user-id','other'));
  await assert.rejects(approveGuestSponsorCampaign(req,f.env));done();assert.deepEqual(snapshot(f),before);
});
for(const phase of ['approve','replay','revoke'])for(const damage of ['database','abort','cohort','identity-header'])test(`${damage} change at outer ${phase} final proof settlement denies disclosure`,async t=>{
  const f=await fixture(t);if(phase!=='approve')await f.approve();const controller=new AbortController(),req=request(phase==='revoke'?f.revokeCommand:f.command,payer,{signal:controller.signal});
  const done=hook(f,sql=>sql.startsWith('WITH approval_current_record AS MATERIALIZED'),()=>queueMicrotask(()=>queueMicrotask(()=>{if(damage==='database')f.env.DB={...f.DB};else if(damage==='abort')controller.abort();else if(damage==='cohort')f.env.FORMA_PILOT_COHORT_ID='late-cohort';else req.headers.set('oai-authenticated-user-id','other');})));
  await assert.rejects(phase==='revoke'?revokeGuestSponsorCampaign(req,f.env):approveGuestSponsorCampaign(req,f.env));done();f.env.DB=f.DB;delete f.env.FORMA_PILOT_COHORT_ID;
  assert.equal(rows(f,'experience_sponsor_approvals').length,1);assert.equal(rows(f,'experience_sponsor_approvals')[0].revoked_at_ms!==null,phase==='revoke');
  checkReceipt(f,phase==='revoke'?await f.revoke():await f.approve(),phase==='revoke'?'revoked':'approved',true);
});
test('post-commit authority withdrawal denies an approval receipt without undoing its original immutable row',async t=>{
  const f=await fixture(t),done=batchHook(f,approvalBatch,result=>{f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(payer);return result;});await assert.rejects(f.approve());done();
  assert.equal(rows(f,'experience_sponsor_approvals').length,1);const before=snapshot(f);await assert.rejects(f.approve());assert.deepEqual(snapshot(f),before);
});
test('both handlers require HTTPS JSON POST with an exact explicit origin and no query or fragment',async t=>{
  for(const stage of ['approve','revoke']){const f=await fixture(t);if(stage==='revoke')await f.approve();const body=stage==='approve'?f.command:f.revokeCommand,handler=stage==='approve'?approveGuestSponsorCampaign:revokeGuestSponsorCampaign;
    const requests=[new Request(url,{headers:headers()}),request(body,payer,{headers:headers(payer,{'content-type':'text/plain'})}),request(body,payer,{headers:headers(payer,{origin:'https://other.invalid'})}),
      new Request(url+'?x=1',{method:'POST',headers:headers(),body:JSON.stringify(body)}),new Request(url+'#x',{method:'POST',headers:headers(),body:JSON.stringify(body)}),
      new Request(url.replace('https:','http:'),{method:'POST',headers:headers(),body:JSON.stringify(body)}),request(body,payer,{headers:headers(payer,{'sec-fetch-site':'cross-site'})})];
    for(const req of requests){const before=snapshot(f);await assert.rejects(handler(req,f.env));assert.deepEqual(snapshot(f),before);}}
});
test('exactly 128 KiB valid UTF-8 JSON is accepted, and one extra byte is rejected without writes',async t=>{
  const f=await fixture(t),json=JSON.stringify(f.command),body=json+' '.repeat(LIMIT-Buffer.byteLength(json));assert.equal(Buffer.byteLength(body),LIMIT);checkReceipt(f,await f.approve(f.command,payer,{body}));
  const before=snapshot(f);await assert.rejects(f.approve(f.command,payer,{body:body+' '}));assert.deepEqual(snapshot(f),before);
});
test('non-UTF8, BOM, nonidentity coding and malformed body/header data are not repaired into approvals',async t=>{
  const f=await fixture(t);for(const overrides of [{body:'{'},{body:new Uint8Array([0x7b,0xc3,0x28,0x7d])},{body:'\ufeff'+JSON.stringify(f.command)},
    {headers:headers(payer,{'content-encoding':'gzip'})},{headers:headers(payer,{'content-type':'application/json; charset=iso-8859-1'})},
    {headers:headers(payer,{'content-length':'131073'})},{headers:headers(payer,{'content-length':'01'})}]){const before=snapshot(f);await assert.rejects(f.approve(f.command,payer,overrides));assert.deepEqual(snapshot(f),before);}
  checkReceipt(f,await f.approve(f.command,payer,{headers:headers(payer,{'content-type':'application/json; charset=utf-8','content-encoding':'IDENTITY','sec-fetch-site':'none'})}));
});
test('finite empty chunks obey the 4096-chunk bound without timer starvation',async t=>{
  const f=await fixture(t);for(const count of [4095,4096]){let i=0;const stream=new ReadableStream({pull(controller){if(i++<count)controller.enqueue(new Uint8Array());else{controller.enqueue(new TextEncoder().encode(JSON.stringify(f.command)));controller.close();}}});
    const before=snapshot(f),promise=f.approve(f.command,payer,{body:stream,duplex:'half'});if(count===4095)checkReceipt(f,await promise);else{await assert.rejects(promise);assert.deepEqual(snapshot(f),before);}}
});
test('oversized unknown-length body rejects promptly without awaiting nonsettling cancellation',{timeout:3000},async t=>{
  const f=await fixture(t);let cancels=0;const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(LIMIT+1));},cancel(){cancels++;return new Promise(()=>{});}}),before=snapshot(f),start=performance.now();
  await assert.rejects(f.approve(f.command,payer,{body:stream,duplex:'half'}));assert.ok(performance.now()-start<1500);assert.equal(cancels,1);assert.deepEqual(snapshot(f),before);
});
test('stalled body reaches its five-second deadline without waiting for a nonsettling cancel',{timeout:10000},async t=>{
  const f=await fixture(t);let cancels=0;const stream=new ReadableStream({cancel(){cancels++;return new Promise(()=>{});}}),before=snapshot(f),start=performance.now();
  await assert.rejects(f.approve(f.command,payer,{body:stream,duplex:'half'}));const elapsed=performance.now()-start;assert.ok(elapsed>=4500&&elapsed<9000);assert.equal(cancels,1);assert.deepEqual(snapshot(f),before);
});
test('abort during a stalled body rejects promptly and leaves account and campaign state unchanged',{timeout:3000},async t=>{
  const f=await fixture(t),controller=new AbortController(),stream=new ReadableStream({cancel(){return new Promise(()=>{});}}),before=snapshot(f),start=performance.now();
  const pending=f.approve(f.command,payer,{body:stream,duplex:'half',signal:controller.signal});setTimeout(()=>controller.abort(),20);await assert.rejects(pending);assert.ok(performance.now()-start<1500);assert.deepEqual(snapshot(f),before);
});
test('database replacement during body acquisition fails closed on the captured binding',async t=>{
  const f=await fixture(t),before=snapshot(f);const stream=new ReadableStream({pull(controller){f.env.DB={...f.DB};controller.enqueue(new TextEncoder().encode(JSON.stringify(f.command)));controller.close();}});
  await assert.rejects(f.approve(f.command,payer,{body:stream,duplex:'half'}));f.env.DB=f.DB;assert.deepEqual(snapshot(f),before);
});
test('already consumed or locked request bodies cannot be reused as approvals',async t=>{
  const f=await fixture(t),before=snapshot(f),consumed=request(f.command);await consumed.text();await assert.rejects(approveGuestSponsorCampaign(consumed,f.env));
  const locked=request(f.command),reader=locked.body.getReader();await assert.rejects(approveGuestSponsorCampaign(locked,f.env));reader.releaseLock();assert.deepEqual(snapshot(f),before);
});
test('cold or missing dormant schemas are never installed by either handler',async t=>{
  const f=await fixture(t),empty=outputTestDatabase();t.after(()=>empty.sqlite.close());const emptyBefore=snapshot(empty);await assert.rejects(approveGuestSponsorCampaign(request(f.command),empty.env));await assert.rejects(revokeGuestSponsorCampaign(request(f.revokeCommand),empty.env));assert.deepEqual(snapshot(empty),emptyBefore);
  f.sqlite.exec('DROP TABLE experience_sponsor_approvals');const before=snapshot(f);await assert.rejects(f.approve());await assert.rejects(f.revoke());assert.deepEqual(snapshot(f),before);
});
