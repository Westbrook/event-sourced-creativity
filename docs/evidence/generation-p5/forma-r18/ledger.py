import json,sys,pathlib,os,datetime,hashlib
root=pathlib.Path(__file__).resolve().parent; path=root/'request-ledger.json'
caps={'fresh':3,'credential':1,'source':4,'save':1,'admission':1,'deploy':1,'terminal':2,'browser':2,'qualification':2,'logs':1,'final':2,'restore':1,'restore-status':2,'restore-final':2,'restore-state':1}
recovery={'restore','restore-status','restore-final','restore-state'}
def save(v):
 data=(json.dumps(v,indent=2)+'\n').encode();tmp=path.with_suffix('.tmp')
 with open(tmp,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
 os.replace(tmp,path);fd=os.open(root,os.O_RDONLY);os.fsync(fd);os.close(fd);assert path.read_bytes()==data
 return hashlib.sha256(data).hexdigest()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def reserve(a):
 v=json.loads(path.read_text());g=a['group'];assert g in caps;rec=g in recovery;assert not v['stop'] or rec;assert not any(e['state']=='reserved'for e in v['entries']);assert now()<'2026-09-30T22:00:00+00:00';assert sum(e['group']==g for e in v['entries'])<caps[g];assert a['args']['project_id']==v['target'];key='recovery'if rec else'normal';assert v[key]<v['limits'][key];v[key]+=1;v['issued']+=1;e={'sequence':v['issued'],'reservedAt':now(),'state':'reserved',**a};v['entries'].append(e);digest=save(v);return {'sequence':e['sequence'],'savedAndReadBack':True,'ledgerSha256':digest,'args':a['args']}
def receipt(a):
 v=json.loads(path.read_text());e=v['entries'][-1];assert e['state']=='reserved'and e['sequence']==a['sequence'];f=root/a['file'];assert f.parent==root and not f.exists();data=(json.dumps(a['receipt'],indent=2)+'\n').encode()
 with open(f,'wb')as d:d.write(data);d.flush();os.fsync(d.fileno())
 assert f.read_bytes()==data;e.update(state=a.get('state','receipt-preserved'),receipt=f.name,receiptSha256=hashlib.sha256(data).hexdigest(),completedAt=now());return save(v)
if __name__=='__main__':
 mode=sys.argv[1]
 if mode=='init':
  assert not path.exists();v={'stage':'R15 revised Stage B executed in R18','target':json.load(open('.openai/hosting.json'))['project_id'],'accepted':True,'limits':{'normal':20,'recovery':6},'normal':0,'recovery':0,'issued':0,'entries':[],'stop':None,'expiry':'2026-10-01T00:00:00Z','mutationRecoveryMargin':'2026-09-30T22:00:00Z','decisionSha256':hashlib.sha256((root/'accepted-decision.md').read_bytes()).hexdigest(),'unit':'operator reservations, hidden native/browser/authentication HTTP and hosting costs unknown','otherLedgersUnchanged':{'stageA':'7/8 complete; spare not transferable','private':'60/71; normalStop59 exhausted'},'retention':{'owner':'westbrook.johnson@reve.art','duration':'indefinite until separately reviewed deletion','sourceVersionHistory':'existing Site access','receipts':'redacted restricted P5 evidence/Git'},'replacedPrerequisite':'User accepts no new/changed migration files on source/package equality and supported Sites contract; zero hosted DDL and exact prior archive bytes not independently proved'};print(save(v))
 elif mode=='reserve':print(json.dumps(reserve(json.loads(sys.argv[2]))))
 elif mode=='receipt':print(receipt(json.loads(sys.argv[2])))
 elif mode=='stop':
  v=json.loads(path.read_text());v['stop']=sys.argv[2];print(save(v))
 else:raise ValueError(mode)
