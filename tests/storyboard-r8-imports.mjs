// Isolated source overlay only; never changes canonical modules or runtime.
import {existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
const C=process.env.FORMA_SOURCE_ROOT;if(!C)throw Error('FORMA_SOURCE_ROOT required');
const root=new URL('../',import.meta.url).pathname;
registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.includes('/node_modules/'))return next(specifier,context);
 if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){
  const url=new URL(/\.[a-z0-9]+$/iu.test(specifier)?specifier:specifier+'.ts',context.parentURL);
  if(url.pathname.startsWith(root)&&!existsSync(url))return next('file://'+C+'/'+url.pathname.slice(root.length),context);
 }
 return next(specifier,context);
}});
