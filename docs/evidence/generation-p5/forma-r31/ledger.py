import json,sys,pathlib,os,datetime,hashlib,importlib.util
root=pathlib.Path(__file__).resolve().parent;path=root/'request-ledger.json'
spec=importlib.util.spec_from_file_location('prior',root.parent/'forma-r27/ledger.py');prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior);prior.root=root;prior.path=path
now=prior.now;save=prior.save
slots={'N1':'browser_inventory','N2':'get_site','N3':'get_environment_variables','N4':'get_site_version','N5':'get_deployment_status','N6':'create_source_repository_write_credential','N7':'source_open','N8':'source_push','N9':'save_site_version','N10':'get_site_version','N11':'deploy_site_version','N12':'terminal_or_id_lookup','N13':'manual_qualification','R1':'get_site','R2':'restore554','R3':'get_site_version','R4':'get_deployment_status','R5':'get_site','R6':'get_environment_variables'}
if __name__=='__main__':
 mode=sys.argv[1]
 if mode=='init':
  assert not path.exists();p=root.parent/'forma-r29/request-ledger.json';v=json.loads(p.read_text());assert(v['normal'],v['recovery'],v['issued'])==(30,13,43)
  v.update(stage='R31 execution of exact accepted R30',limits={'normal':43,'recovery':19},stop=None)
  v['acceptedR30']={'commit':'fa61b4bdbd661cf37c39c164543a44adcdde740b','envelope':'p5-forma-current-qualification:20088b648d017aba644ee08c8d30c8a651f5e5177f10ecf8911f94d245139f51','normalAddition':13,'recoveryAddition':6,'priorLedgerSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'decisionSha256':hashlib.sha256((root.parent/'forma-r30/decision.md').read_bytes()).hexdigest(),'ownerSignedInAttestation':True,'exclusivePublicationWindowAccepted':True,'accepted':True,'expiry':'2026-10-01T00:00:00Z','margin':'2026-09-30T22:00:00Z'}
  v['priorReceiptLocations']['40-43']='../forma-r29/';print(save(v))
 elif mode=='reserve':
  a=json.loads(sys.stdin.read());v=json.loads(path.read_text());slot=a['slot'];assert slot in slots and a['action']==slots[slot];assert not any(e['state']=='reserved' for e in v['entries']);assert not any(e.get('slot')==slot for e in v['entries'][43:]);rec=slot.startswith('R');assert not v['stop'] or rec;assert now()<('2026-10-01T00:00:00+00:00' if rec else '2026-09-30T22:00:00+00:00');assert a['args'].get('project_id',v['target'])==v['target'];key='recovery' if rec else 'normal';assert v[key]<v['limits'][key]
  v[key]+=1;v['issued']+=1;e={'sequence':v['issued'],'reservedAt':now(),'state':'reserved','group':'r30-recovery' if rec else 'r30-normal',**a};v['entries'].append(e);digest=save(v);print(json.dumps({'sequence':e['sequence'],'slot':slot,'savedAndReadBack':True,'ledgerSha256':digest,'args':a['args']}))
 elif mode=='receipt':print(prior.receipt(json.loads(sys.stdin.read())))
 elif mode=='stop':v=json.loads(path.read_text());v['stop']=sys.argv[2];print(save(v))
 else:raise ValueError(mode)
