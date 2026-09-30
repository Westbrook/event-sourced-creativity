"""R38 resumed P2-P4 metadata pass; reuses the existing durable R27 ledger writer."""
import importlib.util,json,pathlib,sys,hashlib
root=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('prior',root.parent/'forma-r27/ledger.py');prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior);prior.root=root;prior.path=root/'request-ledger.json'
if __name__=='__main__':
 mode=sys.argv[1]
 if mode=='init':
  assert not prior.path.exists()
  p=root.parent/'forma-r37/request-ledger.json';v=json.loads(p.read_text());assert(v['normal'],v['recovery'],v['issued'])==(45,18,63)
  v.update(stage='R38 accepted P2-P4 resumption with transient environment projection',limits={'normal':48,'recovery':19},stop=None)
  v['acceptedR38']={'priorLedgerSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'priorCharges':63,'maximumNewNormal':3,'maximumNewRecovery':0,'conditionalOldR3NotTransferable':True,'correctedVersionLookup':{'limit':2,'cursor':None},'scope':'Only P2-P4. Standard environment response may enter transient projector; no raw output persistence/display. Accepted connector/runtime exposure; no server-side suppression promise. No P1 repeat, allowance addition or mutation.'}
  v['priorReceiptLocations']['63']='../forma-r37/';print(prior.save(v))
 elif mode=='reserve':
  v=json.loads(prior.path.read_text());a=json.loads(sys.stdin.read());n=len(v['entries'])-62
  names=['sites_get_site','sites_get_environment_variables','sites_list_site_versions','sites_get_deployment_status']
  assert not v['stop'] and 0<=n<4 and a['action']==names[n]
  assert not any(e['state']=='reserved' for e in v['entries']);assert a['args']['project_id']==v['target'];assert prior.now()<'2026-09-30T22:00:00+00:00';assert v['normal']<48
  v['normal']+=1;v['issued']+=1;e={'sequence':v['issued'],'reservedAt':prior.now(),'state':'reserved','group':'r38-normal',**a};v['entries'].append(e);digest=prior.save(v)
  print(json.dumps({'sequence':e['sequence'],'savedAndReadBack':True,'ledgerSha256':digest,'action':a['action'],'args':a['args']}))
 elif mode=='receipt':print(prior.receipt(json.loads(sys.stdin.read())))
 elif mode=='stop':
  v=json.loads(prior.path.read_text());v['stop']=sys.argv[2];print(prior.save(v))
 else:raise ValueError(mode)
