"""Stage A only: persist/fsync/read back a reservation before native dispatch."""
import json,sys,pathlib,os,datetime,hashlib
root=pathlib.Path(__file__).parent;path=root/'request-ledger.json';mode=sys.argv[1]
def save(v):
 data=(json.dumps(v,indent=2)+'\n').encode();tmp=path.with_suffix('.tmp')
 with open(tmp,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
 os.replace(tmp,path);fd=os.open(root,os.O_RDONLY);os.fsync(fd);os.close(fd);assert path.read_bytes()==data
 return hashlib.sha256(data).hexdigest()
if mode=='init':
 assert not path.exists();v={'stage':'R15 A, executed in R16','target':json.load(open('.openai/hosting.json'))['project_id'],'approval':'User: Approved. In response to Stage A only: up to8 fresh read-only native metadata reservations.','decisionSha256':hashlib.sha256(pathlib.Path('docs/evidence/generation-p5/forma-r15/decision.md').read_bytes()).hexdigest(),'limit':8,'issued':0,'unused':8,'entries':[],'stop':None,'expiry':'2026-10-01T00:00:00Z','unit':'one conservative native tool reservation; internal HTTP/prices unknown','privateLedgerUnchanged':{'issued':60,'unused':11,'limit':71,'normalStop':59},'otherStagesAuthorized':False};print(save(v))
elif mode=='reserve':
 v=json.loads(path.read_text());assert not v['stop'];assert v['issued']<8;assert datetime.datetime.now(datetime.timezone.utc)<datetime.datetime.fromisoformat(v['expiry'].replace('Z','+00:00'));a=json.loads(sys.argv[2]);caps={'get_site':2,'get_environment_variables':2,'list_site_versions':1,'get_site_version':1,'get_deployment_status':2};assert a['action']in caps;assert sum(e['action']==a['action']for e in v['entries'])<caps[a['action']];assert a['args']['project_id']==v['target'];assert not any(e['state']=='reserved'for e in v['entries']);v['issued']+=1;v['unused']-=1;v['entries'].append({'sequence':v['issued'],'reservedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'state':'reserved',**a});digest=save(v);print(json.dumps({'sequence':v['issued'],'savedAndReadBack':True,'ledgerSha256':digest,'args':a['args']}))
elif mode=='receipt':
 v=json.loads(path.read_text());a=json.loads(sys.argv[2]);e=v['entries'][-1];assert e['state']=='reserved';assert a['sequence']==e['sequence'];f=root/a['file'];data=(json.dumps(a['receipt'],indent=2)+'\n').encode()
 with open(f,'wb')as dest:dest.write(data);dest.flush();os.fsync(dest.fileno())
 assert f.read_bytes()==data;e.update({'state':a.get('state','receipt-preserved'),'receipt':a['file'],'receiptSha256':hashlib.sha256(data).hexdigest(),'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()});print(save(v))
elif mode=='stop':
 v=json.loads(path.read_text());v['stop']=sys.argv[2];print(save(v))
else:raise ValueError('unknown local command')
