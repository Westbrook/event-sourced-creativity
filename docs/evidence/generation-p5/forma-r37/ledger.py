"""R37 bounded metadata pass; reuses the existing durable R27 ledger writer."""
import importlib.util,json,pathlib,sys,hashlib
root=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('prior',root.parent/'forma-r27/ledger.py');prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior);prior.root=root;prior.path=root/'request-ledger.json'
if __name__=='__main__':
 mode=sys.argv[1]
 if mode=='init':
  assert not prior.path.exists()
  p=root.parent/'forma-r34/request-ledger.json';v=json.loads(p.read_text());assert(v['normal'],v['recovery'],v['issued'])==(44,18,62)
  v.update(stage='R37 approved corrected metadata-only reconciliation',limits={'normal':48,'recovery':19},stop=None)
  v['acceptedR37']={'priorLedgerSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'priorCharges':62,'maximumNewNormal':4,'maximumNewRecovery':0,'conditionalOldR3NotTransferable':True,'correctedVersionLookup':{'limit':2,'cursor':None},'scope':'Ordered four-step metadata-only sequence; stop before environment read if secret-free output is not supported; no repetition or mutation.'}
  v['priorReceiptLocations']['46-62']='../forma-r34/';print(prior.save(v))
 elif mode=='reserve':
  v=json.loads(prior.path.read_text());a=json.loads(sys.stdin.read());n=len(v['entries'])-62
  names=['sites_get_site','sites_get_environment_variables','sites_list_site_versions','sites_get_deployment_status']
  assert not v['stop'] and 0<=n<4 and a['action']==names[n]
  assert not any(e['state']=='reserved' for e in v['entries']);assert a['args']['project_id']==v['target'];assert prior.now()<'2026-09-30T22:00:00+00:00';assert v['normal']<48
  v['normal']+=1;v['issued']+=1;e={'sequence':v['issued'],'reservedAt':prior.now(),'state':'reserved','group':'r37-normal',**a};v['entries'].append(e);digest=prior.save(v)
  print(json.dumps({'sequence':e['sequence'],'savedAndReadBack':True,'ledgerSha256':digest,'action':a['action'],'args':a['args']}))
 elif mode=='receipt':print(prior.receipt(json.loads(sys.stdin.read())))
 elif mode=='stop':
  v=json.loads(prior.path.read_text());v['stop']=sys.argv[2];print(prior.save(v))
 else:raise ValueError(mode)
