/** Seedance's nominal 480p grid is 864x496 (landscape) / 496x864
 * (portrait), not a literal 480px short edge. Keep standard 480px originals
 * readable, but never widen the aspect tolerance for arbitrary dimensions.
 * Provider table: https://fal.ai/models/bytedance/seedance-2.0/text-to-video
 * Verified 2026-09-16. Frame size in the contract selects orientation.
 * Shared by private-byte verification and the browser's display witness. */
export function outputVideoFrameDiagnostic(width:number,height:number,frameSize:"1280x720"|"720x1280") {
 const landscape=frameSize==="1280x720";
 if(width===(landscape?864:496)&&height===(landscape?496:864))return null;
 if(Math.min(width,height)!==480)return "dimensions";
 return Math.abs(width/height-(landscape?16/9:9/16))>.03?"aspect_ratio":null;
}
