import json,os,sys,pathlib,tempfile,datetime
path=pathlib.Path(sys.argv[1]);kind=sys.argv[2];stage=int(sys.argv[3]);n=int(sys.argv[4]);action=sys.argv[5]
l=json.loads(path.read_text());recovery=kind=='recovery';assert kind in ['normal','recovery'];assert n>0
assert not l['normalWorkStopped'] or recovery
assert l['issued']+n<= (71 if recovery else 59)
k='r14Recovery' if recovery else 'r14Normal';assert l[k]+n <= (12 if recovery else 28)
s=l['r14Stages'][kind][stage];assert s['used']+n<=s['maximum']
if recovery and stage==1: assert l['cleanupAttempts']+n<=5;l['cleanupAttempts']+=n
l[k]+=n;s['used']+=n;l['issued']+=n;l['unused']=71-l['issued']
l['entries'].append(dict(sequence=len(l['entries'])+1,utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),action=action,requests=n,cumulative=l['issued'],state='durably reserved before action',recovery=recovery,actualHttpRequests=None,r14Stage=stage))
fd,tmp=tempfile.mkstemp(dir=path.parent)
with os.fdopen(fd,'w') as f:json.dump(l,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
os.replace(tmp,path);fd=os.open(path.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
assert json.loads(path.read_text())==l
print(json.dumps(dict(saved=True,issued=l['issued'],unused=l['unused'],action=action)))
