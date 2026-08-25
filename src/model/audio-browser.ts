/** Inspect local file duration without playback, provider transfer, or fabricated transcripts. */
export async function browserAudioDuration(file: File, timeoutMs = 5_000): Promise<number | null> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return null;
  const element = document.createElement("audio");
  const url = URL.createObjectURL(file);
  element.preload = "metadata";
  return await new Promise<number | null>((resolve) => {
    let finished = false;
    const complete = (value: number | null) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      element.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timeout = window.setTimeout(() => complete(null), timeoutMs);
    element.addEventListener("loadedmetadata", () => complete(Number.isFinite(element.duration) && element.duration > 0 ? element.duration : null), { once: true });
    element.addEventListener("error", () => complete(null), { once: true });
    element.src = url;
  });
}

export type LocalAudioAnalysis={
  durationSeconds:number;
  analyzedDurationSeconds:number;
  channelCount:number;
  rms:number;
  peak:number;
  quietRegions:Array<{startSeconds:number;endSeconds:number}>;
  estimatedTempoBpm:number|null;
  dynamicArc:"rising"|"falling"|"steady";
  description:string;
};

/** Measure bounded PCM locally; this never infers speech, lyrics, instruments, or emotion. */
export function summarizeAudioSamples(channels:readonly Float32Array[],sampleRate:number):LocalAudioAnalysis|null{
  if(!channels.length||!Number.isFinite(sampleRate)||sampleRate<1||!channels[0]?.length)return null;
  const sampleCount=channels[0]!.length,inspectedSamples=Math.min(sampleCount,Math.floor(sampleRate*180));
  if(channels.some((channel)=>channel.length<inspectedSamples))return null;
  const windowSize=Math.max(1,Math.round(sampleRate*.1)),stride=Math.max(1,Math.floor(windowSize/512));
  const energies:number[]=[];let peak=0,meanSquare=0,count=0;
  for(let offset=0;offset<inspectedSamples;offset+=windowSize){
    let energy=0,windowCount=0;
    for(let index=offset;index<Math.min(inspectedSamples,offset+windowSize);index+=stride){
      let mixed=0;for(const channel of channels)mixed+=channel[index]??0;mixed/=channels.length;
      if(!Number.isFinite(mixed))continue;
      const amplitude=Math.abs(mixed);peak=Math.max(peak,amplitude);energy+=mixed*mixed;meanSquare+=mixed*mixed;windowCount++;count++;
    }
    energies.push(windowCount?Math.sqrt(energy/windowCount):0);
  }
  if(!count)return null;
  const rms=Math.sqrt(meanSquare/count),threshold=Math.max(.003,peak*.035),quietRegions:Array<{startSeconds:number;endSeconds:number}>=[];
  for(let index=0;index<energies.length;){
    if(energies[index]!>threshold){index++;continue;}
    const start=index;while(index<energies.length&&energies[index]!<=threshold)index++;
    if(index-start>=8)quietRegions.push({startSeconds:Math.round(start*windowSize/sampleRate*10)/10,endSeconds:Math.round(Math.min(inspectedSamples,index*windowSize)/sampleRate*10)/10});
  }
  const onsets:number[]=[];
  for(let index=2;index<energies.length;index++)if(energies[index]!>Math.max(threshold*3,energies[index-1]!*1.65)&&energies[index-1]!>=energies[index-2]!)onsets.push(index*windowSize/sampleRate);
  const intervals=onsets.slice(1).map((onset,index)=>onset-onsets[index]!).filter((interval)=>interval>=.3&&interval<=1.2);
  let estimatedTempoBpm:number|null=null;
  if(intervals.length>=5){const sorted=[...intervals].sort((left,right)=>left-right),median=sorted[Math.floor(sorted.length/2)]!,agreement=intervals.filter((interval)=>Math.abs(interval-median)<median*.12).length/intervals.length;if(agreement>=.7)estimatedTempoBpm=Math.round(60/median);}
  const third=Math.max(1,Math.floor(energies.length/3)),opening=energies.slice(0,third).reduce((total,value)=>total+value,0)/third,ending=energies.slice(-third).reduce((total,value)=>total+value,0)/third;
  const dynamicArc:LocalAudioAnalysis["dynamicArc"]=ending>opening*1.35?"rising":opening>ending*1.35?"falling":"steady";
  const durationSeconds=sampleCount/sampleRate,analyzedDurationSeconds=inspectedSamples/sampleRate;
  const description=`Locally measured ${durationSeconds.toFixed(1)}-second ${channels.length===1?"mono":"multichannel"} recording: ${dynamicArc} signal energy, RMS ${rms.toFixed(3)}, peak ${peak.toFixed(3)}${quietRegions.length?`, ${quietRegions.length} sustained quiet ${quietRegions.length===1?"passage":"passages"}`:""}${estimatedTempoBpm?`, estimated pulse ${estimatedTempoBpm} BPM`:""}${analyzedDurationSeconds<durationSeconds?`; first ${Math.round(analyzedDurationSeconds)} seconds analyzed`:""}. No speech, words, instruments, or identity were inferred.`;
  return{durationSeconds,analyzedDurationSeconds,channelCount:channels.length,rms,peak,quietRegions:quietRegions.slice(0,16),estimatedTempoBpm,dynamicArc,description};
}

/** Decode only after an explicit user action; bytes never leave the browser or authenticated Forma origin. */
export async function analyzeAudioLocally(bytes:ArrayBuffer):Promise<LocalAudioAnalysis>{
  const AudioContextConstructor=globalThis.AudioContext;
  if(typeof AudioContextConstructor!=="function")throw new Error("local_audio_analysis_unsupported");
  const context=new AudioContextConstructor();
  try{
    const decoded=await context.decodeAudioData(bytes.slice(0));
    const channels=Array.from({length:Math.min(decoded.numberOfChannels,2)},(_,index)=>decoded.getChannelData(index));
    const analyzed=summarizeAudioSamples(channels,decoded.sampleRate);
    if(!analyzed)throw new Error("local_audio_analysis_invalid");
    return analyzed;
  }finally{await context.close().catch(()=>{});}
}
