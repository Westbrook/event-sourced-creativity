import json,sys,pathlib,os,datetime,hashlib,importlib.util
root=pathlib.Path(__file__).resolve().parent;path=root/'request-ledger.json'
spec=importlib.util.spec_from_file_location('prior',root.parent/'forma-r27/ledger.py');prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior);prior.root=root;prior.path=path
now=prior.now;save=prior.save
if __name__=='__main__':
 mode=sys.argv[1]
 if mode=='init':
  assert not path.exists();p=root.parent/'forma-r27/request-ledger.json';v=json.loads(p.read_text());assert(v['normal'],v['recovery'],v['issued'])==(29,10,39);v['stage']='R29 approved R27 restoration-state lookup only';v['priorStop']=v['stop'];v['stop']=None;v['acceptedRecoveryLookup']={'scope':'R27 recovery-decision.md exactly; unused normal status slot reassigned; no deployment or diagnostic','decisionSha256':hashlib.sha256((root.parent/'forma-r27/recovery-decision.md').read_bytes()).hexdigest(),'priorLedgerSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'maxNormal':1,'maxRecovery':3,'approved':True};v['priorReceiptLocations']['33-39']='../forma-r27/';print(save(v))
 elif mode=='reserve':
  a=json.loads(sys.stdin.read());v=json.loads(path.read_text());n=len(v['entries'])-39;assert 0<=n<4;assert not v['stop'];assert not any(e['state']=='reserved' for e in v['entries']);assert now()<'2026-09-30T22:00:00+00:00'
  expected=['get_site_version','get_deployment_status','get_site','get_environment_variables'][n];assert a['action']==expected;assert a['args']['project_id']==v['target'];key='normal' if n==0 else 'recovery';assert v[key]<v['limits'][key]
  v[key]+=1;v['issued']+=1;e={'sequence':v['issued'],'reservedAt':now(),'state':'reserved','group':'reconciliation-normal' if n==0 else 'reconciliation-recovery',**a};v['entries'].append(e);digest=save(v);print(json.dumps({'sequence':e['sequence'],'savedAndReadBack':True,'ledgerSha256':digest,'args':a['args']}))
 elif mode=='receipt':print(prior.receipt(json.loads(sys.stdin.read())))
 elif mode=='stop':v=json.loads(path.read_text());v['stop']=sys.argv[2];print(save(v))
 else:raise ValueError(mode)
