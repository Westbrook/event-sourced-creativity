import {imageQueueRequest} from '../../worker/ordinary-image-queue-protocol.ts';
type Message={body:{jobId:string};ack():void;retry(options:{delaySeconds:number}):void};
type Env={APP:Fetcher;IMAGE_JOBS:{sendBatch(messages:{body:{jobId:string}}[]):Promise<unknown>};IMAGE_QUEUE_SECRET:string};
async function invoke(env:Env,action:'sweep'|'run',body:Record<string,unknown>){
  const response=await env.APP.fetch(await imageQueueRequest('https://forma.internal',env.IMAGE_QUEUE_SECRET,action,body));
  if(!response.ok)throw new Error(`ordinary_image_delivery_${response.status}`);
  return response;
}
export default {
  // No public ingress, provider credentials, D1 binding or media binding.
  fetch(){return new Response(null,{status:404});},
  async scheduled(_controller:unknown,env:Env){
    const {jobs}=await (await invoke(env,'sweep',{})).json() as {jobs:{jobId:string}[]};
    if(jobs.length)await env.IMAGE_JOBS.sendBatch(jobs.map(body=>({body})));
  },
  async queue(batch:{messages:Message[]},env:Env){
    for(const message of batch.messages){
      try{await invoke(env,'run',{jobId:message.body.jobId});message.ack();}
      catch{message.retry({delaySeconds:60});}
    }
  },
};
