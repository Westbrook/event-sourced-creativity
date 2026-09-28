import os,sys,json,subprocess,pathlib,hashlib,datetime,tty,urllib.parse,importlib.util
sys.dont_write_bytecode=True
ROOT=pathlib.Path('/private/tmp/forma-p5-live-comparison');OUT=ROOT/'docs/evidence/generation-p5/forma-r19';old=OUT.parent/'forma-r18';s=importlib.util.spec_from_file_location('ledger',OUT/'ledger.py');ledger=importlib.util.module_from_spec(s);s.loader.exec_module(ledger)
v=json.loads((old/'local-successor.json').read_text());checkout=pathlib.Path(v['checkout']);p=v['project_id'];sha=v['commit_sha'];parent=v['parent']
expected={f['path']:f['sha256']for f in json.loads((OUT.parent/'forma-r15/artifact-manifest.json').read_text())['source']['files']}
def local(*a):return subprocess.check_output(['git',*a],cwd=checkout,text=True).strip()
assert local('rev-parse','HEAD')==sha and local('rev-parse','HEAD^')==parent and local('status','--porcelain')==''
assert set(filter(None,local('ls-files','-z').split('\0')))==set(expected)
for name,h in expected.items():assert hashlib.sha256((checkout/name).read_bytes()).hexdigest()==h
assert hashlib.sha256((OUT.parent/'forma-r17/native-package.tar.gz').read_bytes()).hexdigest()=='130377a70b50a81e7111c71445bf2c15bd8bea2c992abe25eaf2d607c1407360'
if sys.stdin.isatty():tty.setraw(sys.stdin.fileno())
print('READY_FOR_EPHEMERAL_CREDENTIAL',flush=True);c=json.loads(sys.stdin.readline());assert c['auth_mode']=='http_extra_header'and c['publish_on_push_accepted']is False;assert not c.get('publish_on_push_expires_at')or datetime.datetime.fromisoformat(c['publish_on_push_expires_at'].replace('Z','+00:00'))<datetime.datetime.now(datetime.timezone.utc)
u=urllib.parse.urlsplit(c['remote_url']);assert u.scheme=='https'and not u.username and not u.password and not u.query and not u.fragment;assert not any(x in c['token']for x in '\r\n\0');assert c['repository']==p
assert local('ls-remote','--get-url',c['remote_url'])==c['remote_url'];local('check-ref-format','refs/heads/'+c['branch'])
env=os.environ.copy()
for k in list(env):
 if k.startswith('GIT_TRACE')or k=='GIT_CURL_VERBOSE':env.pop(k)
env['GIT_TERMINAL_PROMPT']='0';env['SITES_GIT_AUTHORIZATION']='Authorization: Bearer '+c['token']
base=['git','-c','credential.helper=','-c','http.extraHeader=','-c','http.followRedirects=false','-c','http.lowSpeedLimit=100','-c','http.lowSpeedTime=30','--config-env=http.'+c['remote_url']+'.extraHeader=SITES_GIT_AUTHORIZATION']
def op(action,args):
 a=ledger.reserve({'group':'source','action':action,'args':{'project_id':p,'branch':c['branch']}})
 try:
  r=subprocess.run(base+args,cwd=checkout,env=env,capture_output=True,text=True,timeout=180);data={'action':action,'exitCode':r.returncode,'stdout':r.stdout.replace(c['token'],'[REDACTED]'),'stderr':r.stderr.replace(c['token'],'[REDACTED]'),'credentialPersisted':False,'underlyingHttpUnknown':True};ledger.receipt({'sequence':a['sequence'],'file':str(a['sequence']).zfill(2)+'-'+action+'.json','receipt':data});assert r.returncode==0,'Git failed, see charged receipt';return r.stdout.strip()
 except subprocess.TimeoutExpired:
  ledger.receipt({'sequence':a['sequence'],'file':str(a['sequence']).zfill(2)+'-'+action+'.json','receipt':{'action':action,'timeout':True,'uncertain':True}});raise RuntimeError('Git transport timeout; outcome uncertain')
try:
 ref='refs/heads/'+c['branch'];assert op('git-head-resume',['ls-remote','--heads',c['remote_url'],ref]).split()==[parent,ref],'Remote source drift'
 op('git-push',['push','--porcelain',c['remote_url'],sha+':'+ref]);assert op('git-head-verified',['ls-remote','--heads',c['remote_url'],ref]).split()==[sha,ref],'Remote head verification mismatch'
 result={**v,'pushedVerified':True,'sourcePushed':True,'publishOnPush':False,'fetchesThisResumption':0,'credentialPersisted':False,'underlyingHttpUnknown':True};(OUT/'source-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
except Exception as e:
 j=json.loads(ledger.path.read_text());j['stop']='Source resumption stopped: '+str(e).replace(c['token'],'[REDACTED]');ledger.save(j);print(json.dumps({'success':False,'error':j['stop']}),flush=True);sys.exit(1)
finally:c.clear();env.pop('SITES_GIT_AUTHORIZATION',None)
