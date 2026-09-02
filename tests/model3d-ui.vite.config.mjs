import {defineConfig} from 'vite';
const media=new Map();
const mediaPaths=new Set(['/api/media/fixture-color.png','/api/media/fixture-model-view.png']);
export default defineConfig({
  root:new URL('../',import.meta.url).pathname,
  server:{hmr:false,host:'127.0.0.1',port:5193,strictPort:true,watch:{usePolling:true}},
  optimizeDeps:{include:['lit','three']},
  plugins:[{name:'forma-synthetic-model-fixture',configureServer(server){
    server.middlewares.use(async(request,response,next)=>{
      const url=new URL(request.url,'http://127.0.0.1');
      if(request.method==='POST'&&url.pathname==='/__fixture__/image'&&mediaPaths.has(url.searchParams.get('path'))){
        let size=0;const parts=[];for await(const part of request){size+=part.length;if(size>4*1024*1024){response.writeHead(413);response.end();return;}parts.push(part);}
        media.set(url.searchParams.get('path'),Buffer.concat(parts));response.writeHead(204);response.end();return;
      }
      if(mediaPaths.has(url.pathname)&&media.has(url.pathname)){response.writeHead(200,{'content-type':'image/png','cache-control':'no-store'});response.end(media.get(url.pathname));return;}
      next();
    });
  }}],
});
