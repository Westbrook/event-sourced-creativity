"""Local preservation archive, not a native Sites admission or packager substitute."""
import pathlib,hashlib,json,tarfile,gzip,io,subprocess
root=pathlib.Path.cwd();out=root/'docs/evidence/generation-p5/forma-r15';h=lambda b:hashlib.sha256(b).hexdigest()
def archive(name,entries):
 target=out/name
 with open(target,'wb') as f:
  with gzip.GzipFile(filename='',mode='wb',fileobj=f,mtime=0) as z:
   with tarfile.open(fileobj=z,mode='w',format=tarfile.USTAR_FORMAT) as t:
    for path in entries:
     b=(root/path).read_bytes();i=tarfile.TarInfo(path);i.size=len(b);i.mode=0o644;i.uid=i.gid=i.mtime=0;t.addfile(i,io.BytesIO(b))
 return {'path':str(target.relative_to(root)),'bytes':target.stat().st_size,'sha256':h(target.read_bytes()),'files':[{'path':p,'bytes':(root/p).stat().st_size,'sha256':h((root/p).read_bytes())}for p in entries]}
compiled=sorted(str(p.relative_to(root))for p in(root/'dist').rglob('*')if p.is_file())
# Exact full source snapshot for reproducibility, including non-JS build inputs.
tracked=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z']).decode().split('\0')
source=sorted(p for p in set(tracked) if p and not p.startswith(('docs/','tests/','.progress-report/')) and (root/p).is_file() and not p.startswith(('node_modules/','dist/','.wrangler/')))
a=archive('compiled-preservation.tar.gz',compiled);b=archive('source-preservation.tar.gz',source)
release=json.loads((root/'worker/generation-study-qualification-release.json').read_text());value={'release':release,'compiled':a,'source':b,'nativeAdmission':False,'supportedPackagerRun':False,'reason':'Listed Sites 0.1.71 skill/packager cache absent; native tools remain callable. These are deterministic local preservation archives. Future supported packaging must preserve payload/migration manifests and pass native admission before deployment. No plugin patch or reinstall performed.','target':release['target'],'expiry':release['expiry']}
value['id']='p5-forma-local-package:'+h(json.dumps(value,separators=(',',':')).encode());(out/'artifact-manifest.json').write_text(json.dumps(value,indent=2)+'\n');print(json.dumps({'id':value['id'],'sourceFiles':len(source),'compiledFiles':len(compiled),'sourceArchive':{k:v for k,v in b.items()if k!='files'},'compiledArchive':{k:v for k,v in a.items()if k!='files'}}))
