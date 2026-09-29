"""Offline preservation and byte manifest, not native admission or deployment tooling."""
from pathlib import Path
import hashlib,json,subprocess,tarfile,gzip,io,shutil
r=Path.cwd();out=r/'docs/evidence/generation-p5/forma-r36';stage=Path('/private/tmp/forma-p5-r36-local-package')
h=lambda b:hashlib.sha256(b).hexdigest()
if stage.exists():shutil.rmtree(stage)
shutil.copytree(r/'dist',stage/'dist');(stage/'.openai').mkdir();shutil.copyfile(r/'.openai/hosting.json',stage/'.openai/hosting.json')
subprocess.run(['node','--import','tsx','--input-type=module','-e',"import{copyStudyPairCandidateMigrations}from'./build/release-migrations.ts';console.log(JSON.stringify(await copyStudyPairCandidateMigrations(process.cwd(),'/private/tmp/forma-p5-r36-local-package/dist/.openai/drizzle')));"],check=True)
def rows(root,paths):return [{'path':p,'bytes':(root/p).stat().st_size,'sha256':h((root/p).read_bytes())}for p in paths]
def archive(name,root,paths):
 target=out/name
 with target.open('wb')as f:
  with gzip.GzipFile(filename='',fileobj=f,mode='wb',mtime=0)as z:
   with tarfile.open(fileobj=z,mode='w',format=tarfile.PAX_FORMAT)as tar:
    for p in paths:
     data=(root/p).read_bytes();info=tarfile.TarInfo(p);info.size=len(data);info.mode=0o644;info.uid=info.gid=info.mtime=0;tar.addfile(info,io.BytesIO(data))
 return {'path':name,'bytes':target.stat().st_size,'sha256':h(target.read_bytes()),'files':rows(root,paths)}
tracked=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z']).decode().split('\0')
source=sorted(p for p in set(tracked) if p and not p.startswith(('docs/','tests/','.progress-report/','node_modules/','dist/','.wrangler/')) and (r/p).is_file())
# This unchanged experiment helper is an actual runtime import. Include it explicitly.
source.append('docs/evidence/generation-p1/i-profile.mjs');source.sort()
payload=sorted(str(p.relative_to(stage))for p in stage.rglob('*')if p.is_file())
a=archive('source-preservation.tar.gz',r,source);b=archive('activation-preservation.tar.gz',stage,payload)
base=sorted(str(p.relative_to(r))for p in(r/'dist').rglob('*')if p.is_file());baseline=rows(r,base)
value={'kind':'local-default-off-pair-candidate','retainedPlanningSource':'498936481741f7ed1b03d43422288d628db49f2f','freshLiveState':False,'target':'appgprj_6a7a020e334881919ed8aea0363cb98f','expiry':'2026-10-01T00:00:00Z','mutationRecoveryMargin':'2026-09-30T22:00:00Z','schemaProfile':'fresh-install-only; refuse existing study/approval objects; not an upgrade','routineBuildMigrations':41,'candidateMigrations':42,'unchangedReleased':41,'heldExcluded':31,'compiledConfigurationEntries':0,'flags':'approval,execution,hold-read,custody default off','nativeAdmission':False,'supportedPackagerRun':False,'source':a,'activationPayload':b,'routineBuildPayload':baseline}
retained_bytes=subprocess.check_output(['git','-C','/private/tmp/forma-p7-sites-release','archive','498936481741f7ed1b03d43422288d628db49f2f'])
with tarfile.open(fileobj=io.BytesIO(retained_bytes)) as retained:
 previous={m.name:retained.extractfile(m).read() for m in retained if m.isfile()}
value['sourceDeltaFromRetained554']=[{'path':p,'previousSha256':h(previous[p]) if p in previous else None,'candidateSha256':h((r/p).read_bytes())}for p in source if previous.get(p)!=(r/p).read_bytes()]
value['envelope']='p5-forma-pair-local:'+h(json.dumps(value,separators=(',',':')).encode());(out/'candidate-manifest.json').write_text(json.dumps(value,indent=2)+'\n')
print(json.dumps({'envelope':value['envelope'],'sourceFiles':len(source),'candidateFiles':len(payload),'stage':str(stage),'nativeAdmission':False}))
