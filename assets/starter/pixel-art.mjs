// Frame timings use composition frames; sampling is independent of playback order.
export function spriteFrameAt(animation,frame){
 const n=animation.frames.length,order=Array.from({length:n},(_,i)=>i);
 if(animation.mode==='ping-pong'&&n>2)order.push(...Array.from({length:n-2},(_,i)=>n-2-i));
 const durations=order.map(i=>animation.durations[i]),total=durations.reduce((a,b)=>a+b,0);
 let t=animation.mode==='hold'?Math.min(Math.max(0,frame),total-1):((frame%total)+total)%total;
 for(let i=0;i<order.length;i++){if(t<durations[i])return animation.frames[order[i]];t-=durations[i];}
 return animation.frames[0];
}

// Inspect the native sprite layer, never the antialiased Chinese UI/composite.
export function auditPixels(data,width,height,spec,palette){
 const colors=new Set(),unknown=new Set(),allowed=new Set(palette.map(c=>c.toLowerCase()));
 let semiTransparent=0,isolated=0,opaque=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,alpha=data[i+3];if(!alpha)continue;opaque++;
  if(alpha!==255)semiTransparent++;
  const color='#'+Array.from(data.slice(i,i+3),n=>n.toString(16).padStart(2,'0')).join('');colors.add(color);if(!allowed.has(color))unknown.add(color);
  // Bound neighbours to the same cell so adjacent animation frames cannot hide orphans.
  let neighbour=false;const cx=Math.floor(x/spec.frameWidth),cy=Math.floor(y/spec.frameHeight);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;
   if(nx>=0&&nx<width&&ny>=0&&ny<height&&Math.floor(nx/spec.frameWidth)===cx&&Math.floor(ny/spec.frameHeight)===cy&&data[(ny*width+nx)*4+3])neighbour=true;
  }
  if(!neighbour)isolated++;
 }
 const aligned=width%spec.frameWidth===0&&height%spec.frameHeight===0,total=width/spec.frameWidth*height/spec.frameHeight;
 const frameBounds=aligned&&Object.values(spec.animations).every(a=>a.frames.every(f=>f<total));
 return {id:spec.id,path:spec.path,width,height,opaquePixels:opaque,uniqueColors:colors.size,semiTransparentPixels:semiTransparent,unknownColors:[...unknown],isolatedPixels:isolated,aligned,frameBounds,passed:opaque>0&&!semiTransparent&&!unknown.size&&aligned&&frameBounds,warnings:isolated?[`${isolated} isolated pixels: inspect intent; particles and stars may legitimately be isolated`]:[]};
}
