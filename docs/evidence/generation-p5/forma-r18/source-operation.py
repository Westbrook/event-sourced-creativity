# Exact approved source transfer; credential stays in stdin/process memory only.
import os,sys,json,subprocess,pathlib,tempfile,tarfile,hashlib,datetime,tty,urllib.parse,importlib.util
ROOT=pathlib.Path('/private/tmp/forma-p5-live-comparison'); OUT=ROOT/'docs/evidence/generation-p5/forma-r18'
s=importlib.util.spec_from_file_location('ledger',OUT/'ledger.py');ledger=importlib.util.module_from_spec(s);s.loader.exec_module(ledger)
inputs=json.loads((OUT/'verified-inputs.json').read_text()); prior=inputs['predecessor'];manifest=json.loads((ROOT/'docs/evidence/generation-p5/forma-r15/artifact-manifest.json').read_text())['source']
if sys.stdin.isatty():tty.setraw(sys.stdin.fileno())
print('READY_FOR_EPHEMERAL_CREDENTIAL',flush=True)
c=json.loads(sys.stdin.readline());assert c['auth_mode']=='http_extra_header';assert c.get('publish_on_push_accepted')is False;assert not c.get('publish_on_push_expires_at')or datetime.datetime.fromisoformat(c['publish_on_push_expires_at'].replace('Z','+00:00'))<datetime.datetime.now(datetime.timezone.utc)
u=urllib.parse.urlsplit(c['remote_url']);assert u.scheme=='https'and not u.username and not u.password and not u.query and not u.fragment;assert not any(x in c['token']for x in '\r\n\0')
checkout=pathlib.Path(tempfile.mkdtemp(prefix='forma-p5-b-source-'));env=os.environ.copy()
for k in list(env):
 if k.startswith('GIT_TRACE')or k=='GIT_CURL_VERBOSE':env.pop(k)
env['GIT_TERMINAL_PROMPT']='0';env['SITES_GIT_AUTHORIZATION']='Authorization: Bearer '+c['token']
base=['git','-c','credential.helper=','-c','http.extraHeader=','-c','http.followRedirects=false','-c','protocol.version=0','-c','http.lowSpeedLimit=100','-c','http.lowSpeedTime=30','--config-env=http.'+c['remote_url']+'.extraHeader=SITES_GIT_AUTHORIZATION']
def git(args,network=False):
 p=subprocess.run(base+args if network else ['git',*args],cwd=checkout,env=env,capture_output=True,text=True,timeout=180)
 if p.returncode:raise RuntimeError('Git exit '+str(p.returncode)+': '+p.stderr.replace(c['token'],'[REDACTED]'))
 return p.stdout.strip()
def operation(action,args):
 r=ledger.reserve({'group':'source','action':action,'args':{'project_id':prior['target'],'branch':c['branch']}})
 try:
  value=git(args,True);ledger.receipt({'sequence':r['sequence'],'file':str(r['sequence']).zfill(2)+'-'+action+'.json','receipt':{'action':action,'stdout':value,'credentialPersisted':False,'hiddenHttpUnknown':True}});return value
 except Exception as e:
  ledger.receipt({'sequence':r['sequence'],'file':str(r['sequence']).zfill(2)+'-'+action+'-failed.json','receipt':{'action':action,'error':str(e).replace(c['token'],'[REDACTED]'),'uncertain':True}});raise
try:
 git(['init','--quiet']);git(['check-ref-format','refs/heads/'+c['branch']]);assert git(['ls-remote','--get-url',c['remote_url']])==c['remote_url']
 ref='refs/heads/'+c['branch'];before=operation('git-head-before',['ls-remote','--heads',c['remote_url'],ref]).split();assert before==[prior['source'],ref],'Remote source drift'
 operation('git-fetch',['fetch','--no-tags','--depth=1',c['remote_url'],ref]);assert git(['rev-parse','FETCH_HEAD'])==prior['source'];git(['read-tree','--empty'])
 arc=ROOT/inputs['sourceArchive'];assert hashlib.sha256(arc.read_bytes()).hexdigest()==inputs['sourceArchiveSha256']
 with tarfile.open(arc)as t:
  for m in t:
   assert not m.name.startswith('/')and '..'not in pathlib.PurePosixPath(m.name).parts and m.name!='.git'and not m.name.startswith('.git/')
   if m.isdir():continue
   assert m.isfile();p=checkout/m.name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(t.extractfile(m).read());p.chmod(m.mode&0o777)
 expected={f['path']:f['sha256']for f in manifest['files']};actual={str(f.relative_to(checkout)):hashlib.sha256(f.read_bytes()).hexdigest()for f in checkout.rglob('*')if f.is_file()and '.git'not in f.relative_to(checkout).parts};assert actual==expected
 git(['add','--force','--all','.']);assert len(git(['ls-files']).splitlines())==len(expected)
 tree=git(['write-tree']);sha=git(['-c','user.name=Westbrook Johnson','-c','user.email=westbrook.johnson@reve.art','commit-tree',tree,'-p',prior['source'],'-m','Publish sealed P5 Forma qualification release'])
 git(['update-ref','refs/heads/'+c['branch'],sha]);git(['symbolic-ref','HEAD','refs/heads/'+c['branch']]);assert git(['status','--porcelain'])==''
 result={'project_id':prior['target'],'checkout':str(checkout),'parent':prior['source'],'commit_sha':sha,'tree':tree,'sourceFiles':len(actual),'allSealedSourceFilesMatch':True,'publishOnPush':False,'credentialPersisted':False,'hiddenHttpUnknown':True}
 (OUT/'source-prepush-verification.json').write_text(json.dumps(result,indent=2)+'\n')
 operation('git-push',['push','--porcelain',c['remote_url'],sha+':'+ref]);after=operation('git-head-after',['ls-remote','--heads',c['remote_url'],ref]).split();assert after==[sha,ref]
 result['pushedVerified']=True;(OUT/'source-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
except Exception as e:
 v=json.loads(ledger.path.read_text());v['stop']='Source operation stopped: '+str(e).replace(c['token'],'[REDACTED]');ledger.save(v);print(json.dumps({'success':False,'error':v['stop'],'checkout':str(checkout)}),flush=True);sys.exit(1)
finally:c.clear();env.pop('SITES_GIT_AUTHORIZATION',None)
