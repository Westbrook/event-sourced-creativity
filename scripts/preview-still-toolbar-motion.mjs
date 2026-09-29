import {createServer} from 'vite';
const port=Number(process.env.STILL_MOTION_PREVIEW_PORT||4331);
const server=await createServer({configFile:false,cacheDir:'/private/tmp/still-motion-preview-vite',optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port,strictPort:true},plugins:[{name:'synthetic-toolbar-review',configureServer(s){
 s.middlewares.use('/api',(_req,res)=>{res.statusCode=503;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:'synthetic_review',message:'This review uses fictional content. Saving and provider calls are unavailable.'}));});
 s.middlewares.use((req,res,next)=>{
  if(req.url==='/'){res.statusCode=302;res.setHeader('location','/still/project/p/document/d?progress-report');res.end();return;}
  if(!req.url?.startsWith('/still')){next();return;}
  res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Still toolbar implementation review</title></head><body><script type="module">import {mountStillMotionFixture} from "/tests/browser/fixtures/still-toolbar-motion.js";await mountStillMotionFixture();</script></body></html>');
 });
}}]});
await server.listen();console.log(`Synthetic Still toolbar review: http://127.0.0.1:${port}/still/project/p/document/d?progress-report`);
