import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';

const ok=(condition,message)=>{if(!condition)throw new Error(message);};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export const dbValue=value=>value==='-inf'?-Infinity:Number(value);
export function localMedia(root,relative){
 ok(typeof relative==='string'&&relative&&!path.isAbsolute(relative),'Media path must be relative to the project');
 const p=path.resolve(root,relative),inside=(base,p)=>p.startsWith(base+path.sep);
 ok(inside(root,p)&&fs.existsSync(p)&&fs.statSync(p).isFile()&&inside(fs.realpathSync(root),fs.realpathSync(p)),'Media is missing or outside project');return p;
}
function usable(root,spec){
 localMedia(root,spec.path);ok(['user-authorized','licensed','original'].includes(spec.status)&&typeof spec.source==='string'&&spec.source.trim(),'Media needs an actual source and usable status');
}
export function validateAudio(e,root){
 const a=e.audio,D=e.durationFrames/e.fps;
 ok(a&&finite(a.offsetSeconds)&&a.offsetSeconds>=0&&finite(a.gainDb)&&a.gainDb>=-80&&a.gainDb<=12,'Invalid audio parameters');
 ok(['missing','user-authorized','licensed','original'].includes(a.status),'Invalid audio status');
 if(a.path)usable(root,a);else ok(a.status==='missing','No audio file: use status missing');
 for(const c of e.cues.filter(c=>c.sound)){
  const s=c.sound;usable(root,s);
  ok(finite(s.trimStartSeconds)&&s.trimStartSeconds>=0&&finite(s.durationSeconds)&&s.durationSeconds>0&&finite(s.peakSeconds)&&s.peakSeconds>=0&&s.peakSeconds<s.durationSeconds,'Invalid sound trim or peak');
  ok(finite(s.gainDb)&&s.gainDb>=-80&&s.gainDb<=12,'Invalid sound gain');
  ok(s.durationSeconds-s.peakSeconds+c.frame/e.fps>0,'Sound ends before the timeline');
 }
 if(a.mix){
  const m=a.mix;ok(typeof m.ducking==='boolean'&&finite(m.fadeOutSeconds)&&m.fadeOutSeconds>=0&&m.fadeOutSeconds<=D,'Invalid mix/fade duration');
  ok(m.targetLufs===null||finite(m.targetLufs)&&m.targetLufs>=-30&&m.targetLufs<=-10,'targetLufs must be null or between -30 and -10');
  ok(finite(m.truePeakDb)&&m.truePeakDb>=-9&&m.truePeakDb<=-1,'truePeakDb must be between -9 and -1');
 }
 return Boolean(a.path||e.cues.some(c=>c.sound));
}
function run(bin,args){return execFileSync(bin,args,{encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});}
function metadata(ffprobe,p){return JSON.parse(run(ffprobe,['-v','error','-show_format','-show_streams','-of','json',p]));}
export function audioPlan(e){
 return e.cues.filter(c=>c.sound).map(c=>{
  const s=c.sound,start=c.frame/e.fps-s.peakSeconds,skip=Math.max(0,-start);
  return {frame:c.frame,path:s.path,targetPeakSeconds:c.frame/e.fps,sourceTrimSeconds:s.trimStartSeconds+skip,clipDurationSeconds:Math.min(s.durationSeconds-skip,e.durationFrames/e.fps-Math.max(0,start)),delaySamples:Math.round(Math.max(0,start)*48000),gainDb:s.gainDb,trimmedPreRollSeconds:skip};
 });
}
function loudness(ffmpeg,file,target=-16,peak=-1.5){
 // spawnSync keeps both successful stderr reports and the exit status.
 const r=spawnSync(ffmpeg,['-nostdin','-hide_banner','-nostats','-i',file,'-vn','-af',`loudnorm=I=${target}:TP=${peak}:LRA=11:print_format=json`,'-f','null','-'],{encoding:'utf8',maxBuffer:16*1024*1024});
 ok(r.status===0,`Audio measurement failed: ${(r.stderr??'').slice(-800)}`);
 const blocks=(r.stderr??'').match(/\{[^{}]*"input_i"[^{}]*\}/g);ok(blocks?.length,'No loudness measurement report');return JSON.parse(blocks.at(-1));
}
export const audioMetrics=loudness;
export function buildMix(e,root,out,ffmpeg,ffprobe){
 if(!validateAudio(e,root))return null;
 const D=e.durationFrames/e.fps,plan=audioPlan(e),m=e.audio.mix??{ducking:false,fadeOutSeconds:0,targetLufs:null,truePeakDb:-1.5};
 const inputs=[],lines=[],labels=[];let inputIndex=0;
 if(e.audio.path){const p=localMedia(root,e.audio.path),md=metadata(ffprobe,p);ok(md.streams.some(s=>s.codec_type==='audio'),'BGM has no audio stream');ok(Number(md.format.duration)-e.audio.offsetSeconds>=D-1/e.fps,'Audio is too short after offset');inputs.push('-i',p);lines.push(`[${inputIndex++}:a:0]atrim=start=${e.audio.offsetSeconds}:duration=${D},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${e.audio.gainDb}dB,apad=whole_dur=${D},atrim=duration=${D}[bgm]`);}
 for(const [n,p] of plan.entries()){
  const file=localMedia(root,p.path),md=metadata(ffprobe,file);ok(md.streams.some(s=>s.codec_type==='audio')&&Number(md.format.duration)>=p.sourceTrimSeconds+p.clipDurationSeconds-0.002,`Sound source is too short: ${p.path}`);
  inputs.push('-i',file);const fade=Math.min(0.008,p.clipDurationSeconds/4);
  lines.push(`[${inputIndex++}:a:0]atrim=start=${p.sourceTrimSeconds}:duration=${p.clipDurationSeconds},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${p.gainDb}dB,afade=t=in:d=${fade},afade=t=out:st=${p.clipDurationSeconds-fade}:d=${fade},adelay=${p.delaySamples}S:all=1[s${n}]`);labels.push(`[s${n}]`);
 }
 if(labels.length)lines.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,apad=whole_dur=${D},atrim=duration=${D}[sfx]`);
 if(e.audio.path&&labels.length){
  if(m.ducking){lines.push('[sfx]asplit=2[sfxout][side]');lines.push('[bgm][side]sidechaincompress=threshold=0.025:ratio=3.5:attack=8:release=250[duck]');lines.push('[duck][sfxout]amix=inputs=2:normalize=0:duration=longest[combined]');}
  else lines.push('[bgm][sfx]amix=inputs=2:normalize=0:duration=longest[combined]');
 }else lines.push(`${e.audio.path?'[bgm]':'[sfx]'}anull[combined]`);
 lines.push(`[combined]apad=whole_dur=${D},atrim=duration=${D},asetpts=PTS-STARTPTS${m.fadeOutSeconds?`,afade=t=out:st=${D-m.fadeOutSeconds}:d=${m.fadeOutSeconds}`:''}[mix]`);
 fs.writeFileSync(path.join(out,'mix-filter.txt'),lines.join(';\n'));fs.writeFileSync(path.join(out,'audio-cues.json'),JSON.stringify(plan,null,2)+'\n');
 const premaster=path.join(out,'premaster.wav'),master=path.join(out,'mixed.wav');
 run(ffmpeg,['-nostdin','-v','error','-n',...inputs,'-filter_complex',lines.join(';'),'-map','[mix]','-ar','48000','-c:a','pcm_f32le',premaster]);
 const before=loudness(ffmpeg,premaster,m.targetLufs??-16,m.truePeakDb);let filter='anull',normalization='disabled';
 if(m.targetLufs!==null){
  const values=['input_i','input_tp','input_lra','input_thresh','target_offset'];
  if(values.every(k=>Number.isFinite(Number(before[k])))){
   filter=`loudnorm=I=${m.targetLufs}:TP=${m.truePeakDb}:LRA=11:measured_I=${before.input_i}:measured_TP=${before.input_tp}:measured_LRA=${before.input_lra}:measured_thresh=${before.input_thresh}:offset=${before.target_offset}:linear=true`;normalization='two-pass';
  }else normalization='skipped_nonfinite_silence_or_too_short';
 }
 run(ffmpeg,['-nostdin','-v','error','-n','-i',premaster,'-af',filter+',aresample=48000','-t',String(D),'-c:a','pcm_s24le',master]);
 const after=loudness(ffmpeg,master);fs.writeFileSync(path.join(out,'mix-report.json'),JSON.stringify({durationSeconds:D,events:plan.length,ducking:m.ducking&&Boolean(e.audio.path)&&plan.length>0,normalization,before,after,subjectiveReview:'not_verified'},null,2)+'\n');
 return master;
}
