// Local-only staging. No source push, Site mutation, secret, or target connection.
// The plugin's normal packager overlays all source migrations. Stage ONLY the
// built, verified held set so package output cannot broaden database authority.
import {mkdtemp,cp,mkdir,readFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyReleaseMigrations} from '../build/release-migrations.ts';
const root=process.cwd(),archive=resolve(process.argv[2]??'/private/tmp/forma-p5-sites-disabled-r1.tar.gz');
const plugin=process.argv[3];if(!plugin)throw Error('Pass reviewed absolute Sites plugin root');
const before=await verifyReleaseMigrations(root,join(root,'dist/.openai/drizzle'));
const stage=await mkdtemp(join(tmpdir(),'p5-sites-package-')),unpack=await mkdtemp(join(tmpdir(),'p5-sites-inspect-'));
try{
 await cp(join(root,'dist'),join(stage,'dist'),{recursive:true});await mkdir(join(stage,'.openai'));
 await cp(join(root,'.openai/hosting.json'),join(stage,'.openai/hosting.json'));
 execFileSync(process.execPath,[join(plugin,'scripts/package-site.mjs'),stage,archive],{stdio:'pipe'});
 execFileSync('tar',['-xzf',archive,'-C',unpack]);
 const after=await verifyReleaseMigrations(root,join(unpack,'dist/.openai/drizzle'));
 const bytes=await readFile(archive);
 console.log(JSON.stringify({archive,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),before,after,studySchemaIncluded:false,sourcePushed:false,published:false}));
}finally{await rm(stage,{recursive:true,force:true});await rm(unpack,{recursive:true,force:true});}
