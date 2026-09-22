import {lstat,readdir,access} from 'node:fs/promises';
import {resolve,relative,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyReleaseMigrations} from '../build/release-migrations.ts';
const root=process.cwd(),archive=process.argv[2];
if(!archive)throw Error('Usage: node --experimental-strip-types scripts/package-disabled-memory-release.mjs /absolute/output.tar');
const output=resolve(archive),inside=relative(join(root,'dist'),output);
if(!inside.startsWith('../'))throw Error('Archive must be outside dist');
try{await access(output);throw Error('Archive already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
const receipt=await verifyReleaseMigrations(root,join(root,'dist/.openai/drizzle'));
async function check(directory){for(const e of await readdir(directory,{withFileTypes:true})){if(['.git','node_modules'].includes(e.name)||e.name.startsWith('.env')||e.name.startsWith('.dev.vars')||e.name.endsWith('.pending.sql'))throw Error('Unsafe release artifact');const p=join(directory,e.name);if(e.isDirectory())await check(p);else if(!e.isFile()||!(await lstat(p)).isFile())throw Error('Non-regular release artifact');}}
await check(join(root,'dist'));await access(join(root,'dist/server/index.js'));await access(join(root,'dist/.openai/hosting.json'));
const result=spawnSync('tar',['-C',root,'-cf',output,'dist'],{stdio:'inherit'});if(result.status!==0)throw Error('Packaging failed');console.log(JSON.stringify({archive:output,...receipt}));
