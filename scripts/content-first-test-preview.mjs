import { createServer, preview } from "vite";
import { syntheticPreviewAddress } from "./lib/synthetic-preview.mjs";
const {port} = syntheticPreviewAddress();

// Finite renderer fixtures only: no Cloudflare Worker, production data or provider.
const built=process.argv.slice(2).includes("--built");
if(process.argv.slice(2).some(argument=>argument!=="--built"))throw new Error("Unknown finite preview option");
// Built mode reuses the qualified client output without injecting Vite HMR.
// It deliberately does not execute the Worker or load the project Vite config.
const server=built?await preview({configFile:false,root:process.cwd(),build:{outDir:"dist/client"},
  preview:{host:"127.0.0.1",port,strictPort:true}}):await createServer({configFile:false,root:process.cwd(),
  server:{host:"127.0.0.1",port,strictPort:true,forwardConsole:false,watch:{useFsEvents:false,usePolling:true}}});
if(!built)await server.listen();
server.printUrls();
const close=()=>built?new Promise((resolve,reject)=>server.httpServer.close(error=>error?reject(error):resolve())):server.close();
for(const signal of ["SIGTERM","SIGINT"])process.once(signal,()=>void close().then(()=>process.exit(0)));
