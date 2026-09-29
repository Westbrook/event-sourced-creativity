import json,sys,pathlib,os,datetime,hashlib
root=pathlib.Path(__file__).resolve().parent;path=root/'request-ledger.json'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(v):
 data=(json.dumps(v,indent=2)+'\n').encode();tmp=path.with_suffix('.tmp')
 with open(tmp,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
 os.replace(tmp,path);fd=os.open(root,os.O_RDONLY);os.fsync(fd);os.close(fd);assert path.read_bytes()==data
 return hashlib.sha256(data).hexdigest()
def reserve(a):
 v=json.loads(path.read_text());caps={'fresh':3,'deploy':1,'terminal':1,'diagnostic':1,'logs':1,'restore':1,'restore-status':1,'restore-final':2};g=a['group'];assert g in caps;rec=g.startswith('restore');new=v['entries'][32:]
 assert not any(e['state']=='reserved'for e in v['entries']);assert sum(e['group']==g for e in new)<caps[g];assert now()<'2026-09-30T22:00:00+00:00';assert a['args']['project_id']==v['target'];assert not v['stop'] or rec
 if g in {'diagnostic','logs'}:assert v['diagnosticGoAheadAccepted']
 key='recovery'if rec else'normal';assert v[key]<v['limits'][key];v[key]+=1;v['issued']+=1;e={'sequence':v['issued'],'reservedAt':now(),'state':'reserved',**a};v['entries'].append(e);digest=save(v);return{'sequence':e['sequence'],'savedAndReadBack':True,'ledgerSha256':digest,'args':a['args']}
def receipt(a):
 v=json.loads(path.read_text());e=v['entries'][-1];assert e['state']=='reserved'and e['sequence']==a['sequence'];f=root/a['file'];assert f.parent==root and not f.exists();data=(json.dumps(a['receipt'],indent=2)+'\n').encode()
 with open(f,'wb')as d:d.write(data);d.flush();os.fsync(d.fileno())
 assert f.read_bytes()==data;e.update(state='receipt-preserved',receipt=f.name,receiptSha256=hashlib.sha256(data).hexdigest(),completedAt=now());return save(v)
if __name__=='__main__':
 mode=sys.argv[1]
 if mode=='init':
  assert not path.exists();prior=root.parent/'forma-r25/request-ledger.json';v=json.loads(prior.read_text());assert(v['normal'],v['recovery'],v['issued'])==(23,9,32);assert v['limits']=={'normal':26,'recovery':10};v.update(stage='R27 accepted R26 full saved551 diagnostic/restoration cycle',limits={'normal':30,'recovery':13},stop=None,diagnosticGoAheadAccepted=True);v['acceptedR26Amendment']={'normalAddition':4,'recoveryAddition':3,'userAnswer':'Approve the full cycle and amendment','decisionSha256':hashlib.sha256((root.parent/'forma-r26/decision.md').read_bytes()).hexdigest(),'priorLedgerSha256':hashlib.sha256(prior.read_bytes()).hexdigest(),'priorEntries':32,'intermediateDiagnosticApprovalPause':False};v['priorReceiptLocations']={'1-24':'../forma-r21/','25':'../forma-r23/','26-32':'../forma-r25/'};print(save(v))
 elif mode=='reserve':print(json.dumps(reserve(json.loads(sys.stdin.read()))))
 elif mode=='receipt':print(receipt(json.loads(sys.stdin.read())))
 elif mode=='stop':v=json.loads(path.read_text());v['stop']=sys.argv[2];print(save(v))
 elif mode=='diagnostic-approved':v=json.loads(path.read_text());v['diagnosticGoAheadAccepted']=True;v['diagnosticApproval']=sys.argv[2];print(save(v))
 else:raise ValueError(mode)
