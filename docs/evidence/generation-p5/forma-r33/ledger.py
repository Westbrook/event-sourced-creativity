import json,sys,pathlib,os,datetime,hashlib,importlib.util
root=pathlib.Path(__file__).resolve().parent;path=root/'request-ledger.json'
spec=importlib.util.spec_from_file_location('prior',root.parent/'forma-r27/ledger.py');prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior);prior.root=root;prior.path=path
now=prior.now;save=prior.save
slots={'N1':'browser_inventory','N2':'get_site','N3':'get_environment_variables','N4':'get_site_version','N5':'get_deployment_status','N6':'create_source_repository_write_credential','N7':'source_open','N8':'source_push','N9':'save_site_version','N10':'get_site_version','N11':'deploy_site_version','N12':'terminal_or_id_lookup','N13':'manual_qualification','R1':'get_site','R2':'restore554','R3':'get_site_version','R4':'get_deployment_status','R5':'get_site','R6':'get_environment_variables'}
if __name__=='__main__':
 mode=sys.argv[1]
 if mode=='init':
  assert not path.exists();p=root.parent/'forma-r32/request-ledger.json';v=json.loads(p.read_text());assert(v['normal'],v['recovery'],v['issued'])==(32,13,45);assert v['limits']=={'normal':43,'recovery':19}
  v.update(stage='R33 accepted R32 resumption of R30 N2–N13 and R1–R6',limits={'normal':44,'recovery':19},stop=None)
  v['acceptedR32']={'commit':'b1a9d210ba587c2c6b5648febf821a0cca44641f','decisionSha256':hashlib.sha256((root.parent/'forma-r32/resumption-decision.md').read_bytes()).hexdigest(),'normalAddition':1,'recoveryAddition':0,'priorLedgerSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'accepted':True,'repeatInventory':False,'scope':'Original N2–N13 and guarded R1–R6; no other action'}
  v['priorReceiptLocations']['45']='../forma-r32/';print(save(v))
 elif mode=='reserve':
  a=json.loads(sys.stdin.read());v=json.loads(path.read_text());slot=a['slot'];assert slot in slots and slot!='N1' and a['action']==slots[slot];assert not any(e['state']=='reserved' for e in v['entries']);assert not any(e.get('slot')==slot for e in v['entries'][45:]);rec=slot.startswith('R');assert not v['stop'] or rec;assert now()<('2026-10-01T00:00:00+00:00' if rec else '2026-09-30T22:00:00+00:00');assert a['args'].get('project_id',v['target'])==v['target'];key='recovery' if rec else 'normal';assert v[key]<v['limits'][key]
  v[key]+=1;v['issued']+=1;e={'sequence':v['issued'],'reservedAt':now(),'state':'reserved','group':'r30-recovery' if rec else 'r30-normal',**a};v['entries'].append(e);digest=save(v);print(json.dumps({'sequence':e['sequence'],'slot':slot,'savedAndReadBack':True,'ledgerSha256':digest,'args':a['args']}))
 elif mode=='receipt':print(prior.receipt(json.loads(sys.stdin.read())))
 elif mode=='stop':v=json.loads(path.read_text());v['stop']=sys.argv[2];print(save(v))
 else:raise ValueError(mode)
