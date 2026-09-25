import {mkdir,writeFile} from 'node:fs/promises';import {randomBytes} from 'node:crypto';import {resolve} from 'node:path';
const directory=process.argv[2];if(!directory)throw Error('private_output_directory_required');
await mkdir(directory,{mode:448});
for(const name of ['database-admin-password','database-runtime-password','encryption-root'])await writeFile(resolve(directory,name),randomBytes(32).toString(name==='encryption-root'?'base64':'hex'),{mode:384,flag:'wx'});
console.log('Fresh test credentials written to the requested private directory. Values are not logged.');
