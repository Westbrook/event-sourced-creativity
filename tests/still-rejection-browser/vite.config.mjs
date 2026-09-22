import {realpathSync} from 'node:fs';
import nativeConfig from '../model3d-native/vite.config.mjs';
export default {...nativeConfig,optimizeDeps:{entries:['tests/still-rejection-browser/index.html']},cacheDir:'/private/tmp/forma-rejection-vite-cache',server:{...nativeConfig.server,port:4211,fs:{allow:[nativeConfig.root,realpathSync(new URL('../../node_modules',import.meta.url))]}}};
