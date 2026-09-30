"""R39 accepted P3/P4/replacement-P2 order; existing durable R27 writer."""
import importlib.util,json,pathlib,sys,hashlib
root=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('prior',root.parent/'forma-r27/ledger.py');prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior);prior.root=root;prior.path=root/'request-ledger.json'
if __name__=='__main__':
 mode=sys.argv[1]
 if mode=='init':
  assert not prior.path.exists();p=root.parent/'forma-r38/request-ledger.json';v=json.loads(p.read_text());assert(v['normal'],v['recovery'],v['issued'])==(46,18,64)
  v.update(stage='R39 accepted history-first reconciliation, replacement environment last',limits={'normal':49,'recovery':19},stop=None)
  v['acceptedR39']={'priorLedgerSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'priorCharges':64,'normalAddition':1,'maximumNewNormal':3,'maximumNewRecovery':0,'conditionalOldR3NotTransferable':True,'order':['P3','P4-if-eligible','replacement-P2'],'scope':'History independent of prior malformed environment output; stop all on authorization/identity failure; no P1, pagination, retries, mutation or active-publication inference.'}
  v['priorReceiptLocations']['64']='../forma-r38/';print(prior.save(v))
 elif mode=='reserve':
  v=json.loads(prior.path.read_text());a=json.loads(sys.stdin.read());new=v['entries'][64:];assert not v['stop'] and len(new)<3
  names={'P3':'sites_list_site_versions','P4':'sites_get_deployment_status','P2-replacement':'sites_get_environment_variables'};assert a['action']==names[a['slot']];assert not any(e['slot']==a['slot'] for e in new)
  if not new:assert a['slot']=='P3'
  else:assert new[0]['slot']=='P3' and a['slot']!='P3';assert not any(e['slot']=='P2-replacement' for e in new)
  if a['slot']=='P3':assert a['args']=={'project_id':v['target'],'limit':2}
  assert not any(e['state']=='reserved' for e in v['entries']);assert a['args']['project_id']==v['target'];assert prior.now()<'2026-09-30T22:00:00+00:00';assert v['normal']<49
  v['normal']+=1;v['issued']+=1;e={'sequence':v['issued'],'reservedAt':prior.now(),'state':'reserved','group':'r39-normal',**a};v['entries'].append(e);digest=prior.save(v);print(json.dumps({'sequence':e['sequence'],'savedAndReadBack':True,'ledgerSha256':digest,'action':a['action'],'args':a['args']}))
 elif mode=='receipt':print(prior.receipt(json.loads(sys.stdin.read())))
 elif mode=='stop':
  v=json.loads(prior.path.read_text());v['stop']=sys.argv[2];print(prior.save(v))
 else:raise ValueError(mode)
