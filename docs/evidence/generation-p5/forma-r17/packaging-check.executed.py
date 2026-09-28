import json,hashlib,tarfile,tempfile,subprocess,pathlib,os
R=pathlib.Path('/private/tmp/forma-p5-live-comparison'); E=R/'docs/evidence/generation-p5/forma-r17'; P=pathlib.Path('/Users/westbrook/.codex/plugins/cache/openai-curated-remote/sites/0.1.71')
h=lambda b:hashlib.sha256(b).hexdigest()
def payload(p):
 with tarfile.open(p) as t:
  out={}
  for m in t:
   assert not m.name.startswith('/') and '..' not in pathlib.PurePosixPath(m.name).parts
   if m.isdir():continue
   assert m.isfile() and m.name not in out,m.name
   out[m.name]=t.extractfile(m).read()
  return out
m=json.loads((R/'docs/evidence/generation-p5/forma-r15/artifact-manifest.json').read_text()); c=m['compiled']; source=m['source']
for x in (c,source):
 b=(R/x['path']).read_bytes();assert len(b)==x['bytes'] and h(b)==x['sha256']
f=payload(R/c['path']);assert len(f)==622
assert {k:h(v) for k,v in f.items()}=={x['path']:x['sha256'] for x in c['files']}
archive=E/'native-package.tar.gz'
with tempfile.TemporaryDirectory(prefix='p5-r17-') as td:
 stage=pathlib.Path(td)
 for k,v in f.items():
  p=stage/k;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(v)
 (stage/'.openai').mkdir();(stage/'.openai/hosting.json').write_bytes((R/'.openai/hosting.json').read_bytes())
 assert not (stage/'drizzle').exists()
 run=subprocess.run(['node',str(P/'scripts/package-site.mjs'),str(stage),str(archive)],capture_output=True,text=True,check=True,env={**os.environ,'COPYFILE_DISABLE':'1'})
 (E/'packager.log').write_text(run.stdout+run.stderr)
g=payload(archive);assert g==f,'Supported packager changed payload'
old='c28af5fea0fc3ec2b37b878a544ec59c52a64daf'
sql={k:v for k,v in g.items() if k.startswith('dist/.openai/drizzle/') and k.endswith('.sql')};assert len(sql)==41
all_names={p.name for p in (R/'drizzle').glob('*.sql')};assert len(all_names)==72
held=sorted(all_names-{pathlib.Path(k).name for k in sql});assert len(held)==31
for k,v in sql.items():assert subprocess.check_output(['git','show',old+':drizzle/'+pathlib.Path(k).name],cwd=R)==v
assert not any('pending.sql' in k for k in g)
verified=[]
for phase in ['forma-r15','forma-r16']:
 manifest=json.loads((R/f'docs/evidence/generation-p5/{phase}/evidence-manifest.json').read_text())
 for name,digest in manifest['files'].items():assert h((R/f'docs/evidence/generation-p5/{phase}'/name).read_bytes())==digest,name
 verified.append({'path':f'docs/evidence/generation-p5/{phase}/evidence-manifest.json','sha256':h((R/f'docs/evidence/generation-p5/{phase}/evidence-manifest.json').read_bytes())})
paths=['scripts/package-site.mjs','scripts/workflow-metrics.mjs','skills/sites-hosting/scripts/package-site.sh','skills/sites-hosting/scripts/prepare-site-build.cjs','skills/sites-hosting/SKILL.md','skills/sites-building/references/persistence-and-storage.md']
result={'status':'local-supported-packaging-passed-native-admission-unobserved','release':m['release']['id'],'localPackage':'p5-forma-local-package:164dcc1c29d8fe5a6f0b36045661d5d5abef3dfa31bf4b2c70c4d49f780dc803','archive':str(archive),'archiveSha256':h(archive.read_bytes()),'archiveBytes':archive.stat().st_size,'regularFiles':len(g),'unpackedPathsAndBytesExactlyMatchR15':True,'preservationArchivesVerified':True,'sourceCommitCompared':old,'packagedMigrationBytesMatchSource':len(sql),'sourceMigrations':len(all_names),'heldMigrations':held,'optionalStudySQLIncluded':False,'stagedRootDrizzlePresent':False,'packagerEnvironment':{'COPYFILE_DISABLE':'1'},'originalPackagerAttempt':'Rejected locally: macOS AppleDouble sidecars only; zero missing/changed payloads; see first-packager-diff.json. Native call count zero.','nativeAdmission':False,'builds':0,'nativeRequests':0,'providerRequests':0,'pluginRoot':str(P),'unmodifiedPluginInputs':[{'path':p,'sha256':h((P/p).read_bytes())} for p in paths],'preservedEvidenceManifests':verified}
(E/'packaging-result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in ['heldMigrations','unmodifiedPluginInputs','preservedEvidenceManifests']},indent=2))
