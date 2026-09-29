/** Portable synthetic-only toolbar regression lane; never calls a live provider. */
import {spawnSync} from 'node:child_process';
const browsers=process.argv[2]||'chromium,firefox,webkit';
if(!browsers.split(',').every(name=>['chromium','firefox','webkit'].includes(name)))throw Error('Use a comma-separated list of chromium,firefox,webkit');
function run(files){
 const result=spawnSync(process.execPath,['--import','tsx','--test',...files],{stdio:'inherit',env:{...process.env,STILL_TOOLBAR_BROWSERS:browsers}});
 if(result.status!==0)process.exit(result.status||1);
}
run(['tests/still-thread-timing.test.mjs','tests/still-toolbar-rhythm.test.mjs','tests/still-toolbar-transport.test.mjs','tests/still-decision-cache.test.mjs','tests/still-generation-decision.test.mjs','tests/still-direct-create.test.mjs']);
run(['tests/browser/still-toolbar-motion.test.mjs','tests/browser/still-toolbar-interruption.test.mjs']);
