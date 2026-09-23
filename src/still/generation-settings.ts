import { DEFAULT_MODEL3D_SETTINGS, type Model3dSettings } from '../model/model3d.ts';
import { DOCUMENT_RENDER_GUIDANCE_MAX_LENGTH } from '../model/document-render-guidance.ts';
import type { GenerationDraft } from './client.ts';

export type GenerationSettings = {
  productionMode: 'manual' | 'managed';
  presentationStyle: string; presentationFidelity: 'faithful' | 'creative';
  videoSeconds: number; videoSize: string; videoAudioMode: string;
  sceneMedium: 'visual' | 'audio';
  audioGoal: string; audioDestination: string; audioDuration: number; audioSpeakerCount: number; audioInstrumental: boolean;
  model3dSettings: Model3dSettings;
};
export function defaultGenerationSettings(): GenerationSettings {
  return { productionMode:'manual',presentationStyle:'document',presentationFidelity:'faithful',videoSeconds:4,videoSize:'1280x720',videoAudioMode:'silent',sceneMedium:'visual',audioGoal:'music',audioDestination:'standalone',audioDuration:30,audioSpeakerCount:1,audioInstrumental:false,model3dSettings:structuredClone(DEFAULT_MODEL3D_SETTINGS) };
}
export function validateGenerationOptions(g:GenerationDraft) {
  const s=g.settings??defaultGenerationSettings();
  if(g.format==='slides'&&(!Number.isInteger(g.itemCount)||g.itemCount<1||g.itemCount>(s.productionMode==='managed'?100:15)))throw new Error(`Choose a whole number from 1 to ${s.productionMode==='managed'?100:15} slides.`);
  if(g.format==='audio'&&['timed_music','sound_effects'].includes(s.audioGoal)&&(!Number.isInteger(s.audioDuration)||s.audioDuration<1||s.audioDuration>(s.audioGoal==='timed_music'?600:180)))throw new Error(`Choose a whole number from 1 to ${s.audioGoal==='timed_music'?600:180} seconds.`);
  if((g.audience??'').trim().length>DOCUMENT_RENDER_GUIDANCE_MAX_LENGTH||(g.tone??'').trim().length>DOCUMENT_RENDER_GUIDANCE_MAX_LENGTH)throw new Error(`Audience and tone each allow up to ${DOCUMENT_RENDER_GUIDANCE_MAX_LENGTH} characters.`);
}
