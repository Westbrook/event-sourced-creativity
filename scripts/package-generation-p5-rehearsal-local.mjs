// Local-only fallback for final byte replacement in the already Sites-packaged
// layout. It does not replace native validation or authorize any hosted action.
import {readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const sha=b=>createHash('sha256').update(b).digest('hex');const reference='/private/tmp/forma-p5-sites-rehearsal-r3-layout-reference.tar.gz',archive='/private/tmp/forma-p5-sites-rehearsal-r3.tar.gz';if(!existsSync(reference))copyFileSync(archive,reference);assert.equal(sha(readFileSync(reference)),'75479175655b25fa6ebc66c463f2c9a7e57b55641c138043ead8ebb10e0464e3');
const result=JSON.parse(execFileSync('python3',['-c',`import tarfile,pathlib,gzip,json
root=pathlib.Path('rehearsal/p5-sites');before=tarfile.open('${reference}')
files=sorted(m.name for m in before.getmembers() if m.isfile())
assert len(files)==9
changes=[]
for name in files:
 data=(root/name).read_bytes()
 if data!=before.extractfile(name).read():changes.append(name)
assert changes==['dist/server/index.js'],changes
with open('${archive}','wb') as raw:
 with gzip.GzipFile(fileobj=raw,mode='wb',filename='',mtime=0) as gz:
  with tarfile.open(fileobj=gz,mode='w') as out:
   for name in files:
    data=(root/name).read_bytes();info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o644;info.mtime=0
    import io
    out.addfile(info,io.BytesIO(data))
print(json.dumps({'files':files,'contentChanges':changes}))
`],{encoding:'utf8'}));
writeFileSync('docs/evidence/generation-p5/sites-r3/packaging-validation.json',JSON.stringify({method:'Installed Sites 0.1.71 packager previously produced and validated this exact nine-file layout. Its cache disappeared before final repack. Local fallback preserves every filename and every non-Worker byte; replaces only the tested Worker to correct streamed UTF-8 byte accounting.',referenceArchiveSha256:sha(readFileSync(reference)),referenceWorkerSha256:'737e8938bd8fb085aca91d51ffc9cfdb71002035e804f96aebc0a16801feb8e8',finalArchiveSha256:sha(readFileSync(archive)),finalWorkerSha256:sha(readFileSync('rehearsal/p5-sites/dist/server/index.js')),...result,nativeValidationBypassed:false,nativeSaveAttempted:false,laterRequirement:'Restore/discover supported Sites workflow and pass native archive validation before any hosted save/deploy. Local layout verification is not native admission.'},null,2)+'\n');console.log({archiveSha256:sha(readFileSync(archive)),changes:result.contentChanges});
