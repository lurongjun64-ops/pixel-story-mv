#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {localMedia,validateAudio,buildMix,audioMetrics,dbValue} from './audio.mjs';

const skillRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const help='Usage: node pixel-mv.mjs init|validate|inspect|render <project-directory>\n       node pixel-mv.mjs mix <project-directory> <new-output-directory>\nSee references/production.md for runtime overrides.';
const invariant=(ok,message)=>{if(!ok)throw new Error(message);};
const integer=(x,min=0)=>Number.isSafeInteger(x)&&x>=min;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const inside=(root,p)=>p===root||p.startsWith(root+path.sep);

export function validateEpisode(e,root){
 invariant(e&&e.schemaVersion===1,'Unsupported schemaVersion');
 invariant(typeof e.title==='string'&&e.title.trim(),'title is required');
 for(const key of ['width','height','logicalWidth','logicalHeight','fps','durationFrames'])invariant(integer(e[key],1),`${key} must be a positive integer`);
 invariant(e.width%2===0&&e.height%2===0,'H.264 requires even dimensions');
 const scale=e.width/e.logicalWidth;
 invariant(integer(scale,1)&&scale===e.height/e.logicalHeight,'Pixel layer needs an equal integer scale on both axes');
 invariant(e.fps<=120,'fps exceeds supported limit (120)');
 invariant(e.hero&&typeof e.hero.name==='string'&&e.hero.name.length<=12,'hero.name must contain at most 12 characters');
 invariant(/^#[a-f\d]{6}$/i.test(e.hero.coat),'hero.coat must be a six-digit hex color');
 invariant(finite(e.hero.stepFps)&&e.hero.stepFps>0&&e.hero.stepFps<=e.fps,'Invalid sprite stepFps');
 invariant(Array.isArray(e.scenes)&&e.scenes.length,'At least one scene is required');
 let cursor=0;const ids=new Set();
 for(const s of e.scenes){
  invariant(typeof s.id==='string'&&s.id&&!ids.has(s.id),'Scene ids must be nonempty and unique');ids.add(s.id);
  invariant(integer(s.start)&&integer(s.end,1)&&s.start===cursor&&s.end>s.start&&s.end<=e.durationFrames,`Scene ${s.id} overlaps, has a gap, or exceeds duration`);cursor=s.end;
  invariant(['station','workshop','rooftop'].includes(s.place),`Implement unknown place: ${s.place}`);
  invariant(typeof s.label==='string',`Missing label in ${s.id}`);
  invariant(s.hero&&['idle','walk'].includes(s.hero.action),`Unsupported hero action in ${s.id}`);
  for(const key of ['fromX','toX'])invariant(finite(s.hero[key])&&s.hero[key]>=0.08&&s.hero[key]<=0.92,`hero.${key} outside safe bounds in ${s.id}`);
  for(const key of ['light','time'])invariant(Array.isArray(s.stats?.[key])&&s.stats[key].length===2&&s.stats[key].every(n=>finite(n)&&n>=0&&n<=999999),`Invalid stats.${key} in ${s.id}`);
 }
 invariant(cursor===e.durationFrames,'Scenes must cover the whole duration');
 invariant(Array.isArray(e.captions)&&Array.isArray(e.cues),'captions and cues must be arrays');cursor=0;
 for(const c of e.captions){invariant(integer(c.start)&&integer(c.end,1)&&c.start>=cursor&&c.end>c.start&&c.end<=e.durationFrames,'Caption timing is invalid or overlapping');invariant(typeof c.text==='string'&&c.text.trim(),'Empty caption');cursor=c.end;}
 for(const c of e.cues)invariant(integer(c.frame)&&c.frame<e.durationFrames&&typeof c.kind==='string'&&typeof c.note==='string','Invalid cue');
 const hasAudio=validateAudio(e,root);
 if(e.art){
  invariant(Array.isArray(e.art.palette)&&e.art.palette.length&&e.art.palette.every(c=>/^#[a-f\d]{6}$/i.test(c)),'art.palette needs hex colors');
  invariant(Array.isArray(e.art.assets),'art.assets must be an array');const assetIds=new Set();
  for(const a of e.art.assets){
   invariant(typeof a.id==='string'&&a.id&&!assetIds.has(a.id),'Asset ids must be unique');assetIds.add(a.id);localMedia(root,a.path);
   invariant(integer(a.frameWidth,1)&&integer(a.frameHeight,1)&&typeof a.source==='string'&&a.source.trim(),'Asset dimensions and source are required');
   invariant(a.animations&&Object.keys(a.animations).length,'Asset animations required');
   for(const t of Object.values(a.animations))invariant(Array.isArray(t.frames)&&t.frames.length&&t.frames.every(f=>integer(f))&&Array.isArray(t.durations)&&t.durations.length===t.frames.length&&t.durations.every(d=>integer(d,1))&&['forward','ping-pong','hold'].includes(t.mode),'Invalid animation frames, durations or mode');
  }
  if(e.hero.spriteId){const sprite=e.art.assets.find(a=>a.id===e.hero.spriteId);invariant(sprite&&e.scenes.every(s=>sprite.animations[s.hero.action]),'Hero sprite must define each requested action');}
 }else invariant(!e.hero.spriteId,'hero.spriteId requires art assets');
 const warnings=e.captions.filter(c=>[...c.text].length/((c.end-c.start)/e.fps)>8).map(c=>`Review dense caption at frame ${c.start}`);
 return {valid:true,frames:e.durationFrames,duration:e.durationFrames/e.fps,scale,audio:hasAudio?'present':'silent',warnings};
}
function readProject(root){return JSON.parse(fs.readFileSync(path.join(root,'episode.json'),'utf8'));}
function tool(name,variable){
 if(process.env[variable]){invariant(fs.existsSync(process.env[variable]),`${variable} does not exist`);return process.env[variable];}
 for(const dir of (process.env.PATH??'').split(path.delimiter)){const p=path.join(dir,name);if(fs.existsSync(p))return p;}
 throw new Error(`Missing ${name}. Set ${variable} to an existing executable; no software was downloaded.`);
}
function command(bin,args){return execFileSync(bin,args,{encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});}
function saveJSON(p,value){fs.writeFileSync(p,JSON.stringify(value,null,2)+'\n');}
function probe(ffprobe,p){return JSON.parse(command(ffprobe,['-v','error','-count_frames','-show_format','-show_streams','-of','json',p]));}
async function playwright(){
 const locations=[process.env.PIXEL_PLAYWRIGHT,'playwright'].filter(Boolean);
 for(const p of locations){try{const resolved=require.resolve(p),mod=await import(pathToFileURL(resolved).href),api=mod.chromium?mod:mod.default;if(api?.chromium)return api;}catch{}}
 throw new Error('Missing Playwright. Set PIXEL_PLAYWRIGHT to its installed package directory.');
}
async function serve(root){
 const server=http.createServer((req,res)=>{
  try{const url=new URL(req.url,'http://localhost'),p=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
   if(!inside(root,p)||!fs.existsSync(p)||!fs.statSync(p).isFile()||!inside(fs.realpathSync(root),fs.realpathSync(p))){res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.json':'application/json','.png':'image/png','.js':'text/javascript','.mjs':'text/javascript','.woff2':'font/woff2'})[path.extname(p)]??'application/octet-stream');fs.createReadStream(p).pipe(res);
  }catch{res.writeHead(400);res.end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {server,url:`http://127.0.0.1:${server.address().port}/`};
}
export async function renderProject(root,{inspect=false}={}){
 const e=readProject(root),validation=validateEpisode(e,root);
 const ffmpeg=inspect?null:tool('ffmpeg','PIXEL_FFMPEG'),ffprobe=inspect?null:tool('ffprobe','PIXEL_FFPROBE'),pw=await playwright();
 if(!inspect){command(ffmpeg,['-version']);command(ffprobe,['-version']);}
 const out=path.resolve(process.env.PIXEL_RENDER_DIR??path.join(root,'renders',new Date().toISOString().replace(/[:.]/g,'-')));
 invariant(!fs.existsSync(out),'Output already exists; choose a new render directory');fs.mkdirSync(path.dirname(out),{recursive:true});fs.mkdirSync(out);
 const qa=path.join(out,'qa'),frames=path.join(out,'frames');fs.mkdirSync(qa);fs.mkdirSync(frames);saveJSON(path.join(qa,'timeline.json'),validation);
 const mixed=inspect?null:buildMix(e,root,qa,ffmpeg,ffprobe);
 const {server,url}=await serve(root);let browser;
 try{
  browser=await pw.chromium.launch({headless:true,...(process.env.PIXEL_CHROMIUM?{executablePath:process.env.PIXEL_CHROMIUM}:{})});
  const page=await browser.newPage({viewport:{width:e.width,height:e.height},deviceScaleFactor:1});
  await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
  await page.addInitScript(()=>{window.__RENDER_MODE__=true;});const errors=[];page.on('pageerror',err=>errors.push(err.message));
  await page.goto(url);await page.evaluate(()=>window.ready);
  const assets=await page.evaluate(()=>window.auditAssets?.()??[]);saveJSON(path.join(qa,'assets.json'),assets);invariant(assets.length===(e.art?.assets.length??0)&&assets.every(a=>a.passed),'Pixel asset audit failed or missing; inspect qa/assets.json');
  const canvas=page.locator('#film');invariant(await canvas.count()===1,'Expected canvas#film');
  const snap=async f=>{await page.evaluate(frame=>window.renderFrame(frame),f);const d=await page.evaluate(()=>window.getDiagnostics?.()??[]);invariant(!d.length,`Layout overflow at frame ${f}: ${d.join(', ')}`);return canvas.screenshot({type:'png',animations:'disabled'});};
  const target=Math.floor(e.durationFrames*0.6),hash=b=>createHash('sha256').update(b).digest('hex');
  const first=hash(await snap(target));await snap(0);await snap(e.durationFrames-1);const second=hash(await snap(target));invariant(first===second,'Render depends on previous frames');saveJSON(path.join(qa,'determinism.json'),{frame:target,sha256:first,repeatSha256:second,passed:true});
  const keyFrames=new Set(e.scenes.flatMap(s=>[s.start,Math.floor((s.start+s.end-1)/2),s.end-1]));
  const sampled=inspect?[...keyFrames].sort((a,b)=>a-b):Array.from({length:e.durationFrames},(_,i)=>i);
  for(const f of sampled){
   const buffer=await snap(f);fs.writeFileSync(path.join(frames,`${String(f).padStart(6,'0')}.png`),buffer);
   if(keyFrames.has(f))fs.writeFileSync(path.join(qa,`key-${String(f).padStart(6,'0')}.png`),buffer);
   if(f%e.fps===0)process.stdout.write(`Rendered ${f}/${e.durationFrames} frames\n`);
  }
  invariant(!errors.length,`Browser errors: ${errors.join('; ')}`);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
 if(inspect){console.log(JSON.stringify({inspection:qa,exportedVideo:false}));return {qa};}
 const output=path.join(out,mixed?'master.mp4':'silent-master.mp4');
 const args=['-nostdin','-v','error','-n','-framerate',String(e.fps),'-i',path.join(frames,'%06d.png')];
 if(mixed)args.push('-i',mixed);
 args.push('-map','0:v:0');if(mixed)args.push('-map','1:a:0','-c:a','aac','-b:a','192k');else args.push('-an');
 args.push('-frames:v',String(e.durationFrames),'-t',String(validation.duration),'-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',output);command(ffmpeg,args);
 const media=probe(ffprobe,output),video=media.streams.find(s=>s.codec_type==='video'),audio=media.streams.filter(s=>s.codec_type==='audio');
 const [num,den]=video.avg_frame_rate.split('/').map(Number),checks={dimensions:video.width===e.width&&video.height===e.height,fps:Math.abs(num/den-e.fps)<0.001,frames:Number(video.nb_read_frames)===e.durationFrames,duration:Math.abs(Number(media.format.duration)-validation.duration)<Math.max(0.08,2/e.fps),audio:audio.length===(mixed?1:0)};
 command(ffmpeg,['-nostdin','-v','error','-xerror','-i',output,'-map','0:v:0','-map','0:a?','-f','null','-']);checks.fullDecode=true;
 if(mixed){const metrics=audioMetrics(ffmpeg,output),peak=dbValue(metrics.input_tp);checks.noClipping=peak===-Infinity||Number.isFinite(peak)&&peak<0;saveJSON(path.join(qa,'audio-output.json'),{metrics,target:e.audio.mix??null,peakTargetMet:peak<=(e.audio.mix?.truePeakDb??-1.5),subjectiveReview:'not_verified'});}
 saveJSON(path.join(qa,'technical.json'),{passed:Object.values(checks).every(Boolean),checks,media,visualReview:'not_verified',audioReview:mixed?'not_verified':'not_applicable_silent'});
 invariant(Object.values(checks).every(Boolean),'Media QA failed; inspect qa/technical.json');
 process.stdout.write(JSON.stringify({output,qa,technicalPassed:true,visualReview:'not_verified'})+'\n');return {output,qa};
}
async function main(){
 const [mode,directory,destination]=process.argv.slice(2);if(mode==='--help'||!mode){console.log(help);return;}
 invariant(directory&&['init','validate','inspect','mix','render'].includes(mode),help);const root=path.resolve(directory);
 if(mode==='init'){invariant(!fs.existsSync(root),'Refusing to overwrite an existing project');fs.mkdirSync(path.dirname(root),{recursive:true});fs.cpSync(path.join(skillRoot,'assets/starter'),root,{recursive:true,errorOnExist:true,force:false});console.log(JSON.stringify({project:root,...validateEpisode(readProject(root),root)}));}
 if(mode==='validate')console.log(JSON.stringify(validateEpisode(readProject(root),root),null,2));
 if(mode==='render')await renderProject(root);
 if(mode==='inspect')await renderProject(root,{inspect:true});
 if(mode==='mix'){invariant(destination,'mix requires a new output directory');const e=readProject(root);validateEpisode(e,root);const out=path.resolve(destination);invariant(!fs.existsSync(out),'Mix output already exists');fs.mkdirSync(out,{recursive:true});console.log(JSON.stringify({audio:buildMix(e,root,out,tool('ffmpeg','PIXEL_FFMPEG'),tool('ffprobe','PIXEL_FFPROBE'))}));}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(err=>{console.error(err.message);process.exitCode=1;});
