import { createServer } from "vite";

// Finite renderer fixtures only: no Cloudflare Worker, production data or provider.
const server=await createServer({configFile:false,root:process.cwd(),
  server:{host:"127.0.0.1",port:4186,strictPort:true,forwardConsole:false,watch:{useFsEvents:false,usePolling:true}}});
await server.listen();
server.printUrls();
for(const signal of ["SIGTERM","SIGINT"])process.once(signal,()=>void server.close().then(()=>process.exit(0)));
