import importlib.util,json,pathlib,sys,hashlib,tempfile
root=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('prior',root.parent/'forma-r27/ledger.py');prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior);prior.root=root;prior.path=root/'request-ledger.json'
normal=['sites_get_site','sites_get_environment_variables','sites_list_site_versions','sites_get_deployment_status','sites_create_source_repository_write_credential','source_open','source_push','sites_save_site_version','sites_get_site_version','sites_update_environment_variables','sites_deploy_site_version','sites_get_site_version','sites_get_deployment_status','owner_manual_get']
recovery=['sites_get_site','sites_get_environment_variables','sites_update_environment_variables','sites_get_environment_variables','sites_deploy_site_version','sites_get_site_version','sites_get_deployment_status','sites_get_site','sites_get_environment_variables']
def reserve(a):
 v=json.loads(prior.path.read_text());new=v['entries'][67:];rec=a['slot'].startswith('R');n=int(a['slot'][1:]);names=recovery if rec else normal;assert 1<=n<=len(names) and a['action']==names[n-1];assert not any(e['slot']==a['slot'] for e in new);assert not any(e['state']=='reserved' for e in v['entries']);assert rec or not v['stop'];assert a['args']['project_id']==v['target'];assert prior.now()<('2026-10-01T00:00:00+00:00' if rec else '2026-09-30T22:00:00+00:00')
 if a['slot']=='N10':assert not any(e['group']=='r41-recovery' for e in new)
 key='recovery' if rec else 'normal';assert v[key]<v['limits'][key];assert sum(e['group']=='r41-'+key for e in new)<len(names);v[key]+=1;v['issued']+=1;e={'sequence':v['issued'],'reservedAt':prior.now(),'state':'reserved','group':'r41-'+key,**a};v['entries'].append(e);digest=prior.save(v);return {'sequence':e['sequence'],'savedAndReadBack':True,'ledgerSha256':digest,'slot':a['slot'],'args':a['args']}
if __name__=='__main__':
 mode=sys.argv[1]
 if mode=='init':
  assert not prior.path.exists();p=root.parent/'forma-r39/request-ledger.json';v=json.loads(p.read_text());assert(v['normal'],v['recovery'],v['issued'])==(49,18,67);v.update(stage='R41 accepted R40 hold-classification cycle',limits={'normal':63,'recovery':28},stop=None);v['acceptedR40']={'decisionSha256':'2626bc8b32e373183cacfe92c3fa764b1d8f1b7954e01a0601ad7a96d847ebc9','envelope':'p5-forma-hold-read-release:c8b59eb065faec9bc85ad91e91cb93fe54828b2bac7a3a14419b9d67d9a8d3ab','priorLedgerSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'normalAddition':14,'recoveryAddition':9,'oldConditionalR3NotTransferable':True,'quietWindowAccepted':True,'sourceRecoveryAccepted':True};v['priorReceiptLocations']['65-67']='../forma-r39/';print(prior.save(v))
 elif mode=='test':
  original=(prior.root,prior.path)
  with tempfile.TemporaryDirectory() as t:
   prior.root=pathlib.Path(t);prior.path=prior.root/'request-ledger.json';v={'synthetic':True,'entries':[{'state':'reserved'}]};h=prior.save(v);assert json.loads(prior.path.read_text())==v;assert h==hashlib.sha256(prior.path.read_bytes()).hexdigest()
  prior.root,prior.path=original;print('synthetic durable flush/readback passed; no reservation charged')
 elif mode=='reserve':print(json.dumps(reserve(json.loads(sys.stdin.read()))))
 elif mode=='receipt':print(prior.receipt(json.loads(sys.stdin.read())))
 elif mode=='stop':
  v=json.loads(prior.path.read_text());v['stop']=sys.argv[2];print(prior.save(v))
