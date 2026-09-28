# Local-only exact source preparation. No remote, credential, push or build.
import pathlib,subprocess,tempfile,json,tarfile,hashlib,os
root=pathlib.Path('/private/tmp/forma-p5-live-comparison');out=root/'docs/evidence/generation-p5/forma-r18';v=json.loads((out/'verified-inputs.json').read_text());m=json.loads((root/'docs/evidence/generation-p5/forma-r15/artifact-manifest.json').read_text())['source'];parent=v['predecessor']['source']
checkout=pathlib.Path(tempfile.mkdtemp(prefix='forma-p5-b-local-successor-',dir='/private/tmp'))
def git(*a,cwd=checkout):return subprocess.check_output(['git',*a],cwd=cwd,text=True).strip()
git('init','--quiet');objects=pathlib.Path(git('rev-parse','--git-path','objects',cwd=root));objects=objects if objects.is_absolute()else(root/objects).resolve();(checkout/'.git/objects/info/alternates').write_text(str(objects)+'\n');assert git('cat-file','-t',parent)=='commit'
git('read-tree','--empty')
archive=root/v['sourceArchive'];assert hashlib.sha256(archive.read_bytes()).hexdigest()==v['sourceArchiveSha256']
with tarfile.open(archive)as t:
 for x in t:
  assert not x.name.startswith('/')and '..'not in pathlib.PurePosixPath(x.name).parts and x.name!='.git'and not x.name.startswith('.git/')
  if x.isdir():continue
  assert x.isfile();p=checkout/x.name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(t.extractfile(x).read());p.chmod(x.mode&0o777)
git('add','--force','--all','.');expected={f['path']:f['sha256']for f in m['files']};paths=git('ls-files','-z').split('\0');paths=[p for p in paths if p];assert set(paths)==set(expected)
for p in paths:assert hashlib.sha256((checkout/p).read_bytes()).hexdigest()==expected[p]
tree=git('write-tree');sha=git('-c','user.name=Westbrook Johnson','-c','user.email=westbrook.johnson@reve.art','commit-tree',tree,'-p',parent,'-m','Publish sealed P5 Forma qualification release');git('update-ref','refs/heads/main',sha);git('symbolic-ref','HEAD','refs/heads/main');assert git('status','--porcelain')==''
assert git('rev-parse','HEAD^')==parent
result={'project_id':v['predecessor']['target'],'checkout':str(checkout),'parent':parent,'commit_sha':sha,'tree':tree,'sourceFiles':len(paths),'sealedSourceBytesMatch':True,'localObjectStore':str(objects),'remoteRequests':0,'remoteConfigured':False,'sourcePushed':False,'built':False,'sourceChanged':False,'nativeAdmission':False,'method':'Retained local exact parent Git object; temporary publication checkout via local object alternates. No retry of remote shallow fetch.'};(out/'local-successor.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
