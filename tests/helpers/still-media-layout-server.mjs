import {createServer} from 'vite';
export async function mediaLayoutServer(port=0){
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-media-layout',optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port},plugins:[{name:'media-layout-fixture',configureServer(s){s.middlewares.use('/api/media/layout-image',(req,res)=>{
 const url=new URL(req.url,'http://fixture'),width=Math.max(1,Math.min(4096,Number(url.searchParams.get('width'))||1536)),height=Math.max(1,Math.min(4096,Number(url.searchParams.get('height'))||1024));
 res.setHeader('content-type','image/svg+xml');res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="grid" width="128" height="128" patternUnits="userSpaceOnUse"><path d="M128 0H0V128" fill="none" stroke="#727d84" stroke-width="2"/></pattern></defs><rect width="100%" height="100%" fill="#394d59"/><rect width="100%" height="100%" fill="url(#grid)"/><rect x="2" y="2" width="${width-4}" height="${height-4}" fill="none" stroke="#e6b990" stroke-width="4"/><text x="24" y="48" font-size="24" fill="#fff">${width} × ${height} · native media fixture</text></svg>`);
 });}}]});await server.listen();return server;
}
if(process.argv[1]?.endsWith('still-media-layout-server.mjs')){const server=await mediaLayoutServer(4196);console.log(`Media layout preview: http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/still-media-layout.html?progress-report`);}
