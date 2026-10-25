// Local-only video export: composite the app's WebGL canvas and its DOM captions.
// Captures this prototype, never the user's screen, microphone, or other tabs.
const PROPS=['display','position','box-sizing','width','height','min-width','max-width','min-height','max-height','top','left','right','bottom','padding','margin','border','border-radius','background','color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align','text-transform','white-space','word-break','overflow','opacity','transform','transform-origin','flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis','align-items','justify-content','gap','z-index','vertical-align','object-fit','object-position','outline','outline-offset','isolation','box-shadow'];
const imageData=new Map();let fontCss='';
async function embedFonts(){try{const link=document.querySelector('link[href*="fonts.googleapis.com"]');if(!link)return;let css=await (await fetch(link.href)).text();const urls=[...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map(m=>m[1].replace(/["']/g,'')))];for(const url of urls){const data=await inlineImage(url);css=css.split(url).join(data);}fontCss=css;}catch{fontCss='';}}

async function inlineImage(url){if(!imageData.has(url))imageData.set(url,fetch(url).then(r=>r.blob()).then(blob=>new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob);})));return imageData.get(url);}
async function domImage(root){
 const rect=root.getBoundingClientRect(),clone=root.cloneNode(true),originals=[root,...root.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
 for(let i=0;i<originals.length;i++){const a=originals[i],b=copies[i],cs=getComputedStyle(a);if(!b?.style)continue;for(const prop of PROPS)b.style.setProperty(prop,cs.getPropertyValue(prop));b.style.setProperty('animation','none');b.style.setProperty('transition','none');
  if(a.tagName==='CANVAS')b.style.visibility='hidden';
  if(a.tagName==='IMG'){b.setAttribute('src',await inlineImage(a.src));b.removeAttribute('srcset');}
  if(!fontCss&&['STRONG','P','B','SMALL','H1','SPAN','EM','LABEL'].includes(a.tagName)&&cs.position!=='absolute')b.style.height='auto';
 }
 clone.style.background='transparent';clone.style.margin='0';clone.style.borderRadius='0';clone.style.width=rect.width+'px';clone.style.height=rect.height+'px';clone.style.position='relative';
 // The WebGL canvas supplies the stage pixels; keep only its HTML controls in the overlay.
 const stage=clone.querySelector('.tutorial-stage');stage.style.background='transparent';
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>${fontCss}</style>${new XMLSerializer().serializeToString(clone)}</div></foreignObject></svg>`;
 const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await img.decode();return img;
}
export async function recordFilm({setRecordState,setVideoUrl,start}){
 try{
  setRecordState('Preparing…');await embedFonts();const root=document.querySelector('.tutorial-app'),stage=root.querySelector('.tutorial-stage'),webgl=stage.querySelector('canvas');
  if(!webgl||!window.MediaRecorder)throw Error('Video export is unavailable in this browser.');
  // Rasterize once first so any browser restriction is reported before playback starts.
  let overlay=await domImage(root);const out=document.createElement('canvas');out.width=1280;out.height=720;const ctx=out.getContext('2d');ctx.drawImage(overlay,0,0,100,100);out.toDataURL();
  const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
  const stream=out.captureStream(30),recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4500000}),chunks=[];
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  recorder.onstop=()=>{stream.getTracks().forEach(track=>track.stop());setVideoUrl(URL.createObjectURL(new Blob(chunks,{type:'video/webm'})));setRecordState('Video ready');};
  start();recorder.start(500);setRecordState('Recording…');let busy=false,finished=false,lastOverlay=0,endAt=0;const started=performance.now();
  const loop=now=>{
   if(finished)return;const a=root.getBoundingClientRect(),b=stage.getBoundingClientRect(),scale=Math.min(1240/a.width,668/a.height),x=(1280-a.width*scale)/2,y=30+(668-a.height*scale)/2;
   ctx.fillStyle='#ebe7e0';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#4c5178';ctx.fillRect(x+(b.left-a.left)*scale,y+(b.top-a.top)*scale,b.width*scale,b.height*scale);
   ctx.drawImage(webgl,x+(b.left-a.left)*scale,y+(b.top-a.top)*scale,b.width*scale,b.height*scale);ctx.drawImage(overlay,x,y,a.width*scale,a.height*scale);
   ctx.fillStyle='#94838a';ctx.font='9px Arial';ctx.fillText('UNWRAP / MOSS PLAYABLE ONBOARDING — PROTOTYPE',20,17);ctx.fillText('Simulated research & other participants · local inputs · narrator stand-in · no money moves',20,710);
   if(!busy&&now-lastOverlay>85){busy=true;lastOverlay=now;domImage(root).then(img=>{overlay=img;}).catch(()=>{}).finally(()=>{busy=false;});}
   const t=Number(document.querySelector('input[aria-label="Tutorial animation time"]')?.value??0);if(t>=54&&!endAt)endAt=now+1200;
   if(endAt&&now>=endAt||now-started>90000){finished=true;recorder.stop();return;}
   requestAnimationFrame(loop);
  };requestAnimationFrame(loop);
 }catch(error){setRecordState('Export failed: '+error.message);}
}
