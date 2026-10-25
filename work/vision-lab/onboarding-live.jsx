import React,{Suspense,useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AnimatePresence,motion} from 'motion/react';
import {Canvas,useFrame,useThree} from '@react-three/fiber';
import {Html} from '@react-three/drei';
import * as THREE from 'three';
import {FloatingIsland,IslandMesh} from '../../components/world/FloatingIsland';
import {IslandEnvironment} from '../../components/world/IslandEnvironment';
import {AtmosphericSky} from '../../components/world/AtmosphericSky';
import {DistantScenery} from '../../components/world/DistantScenery';
import {ScenePaletteContext} from '../../components/world/scenePalette';
import {paletteFor} from '../../components/world/timeOfDay';
import {GIFT_SPOT} from '../../components/world/sceneConfig';
import {platformTop} from '../../components/world/props/Stonework';
import {MapIcon} from '../../components/world/room/MapIcon';
import {Spirit,Tree,Present,GiftProp} from './sky-tree';

export const DURATION=60;
// Moss pauses the live room only around real events; between them the room keeps moving.
const PAUSES=[[22.3,28],[32.3,37],[41.4,46]];
const pausedAt=t=>PAUSES.find(p=>t>=p[0]&&t<p[1]);
const SEED='She throws pots at the community studio every Sunday.';
// Memory islands sit on the outer ring; the theme cloud and gifts sit closer to the present.
const YOU=[-13,1,1],JON=[-11,.6,-7],ALLY=[-12.5,.4,8.5],THEME=[-8,3.2,2],G1=[-5.5,1.2,9.5],G2=[-1,1,11],G3=[3.8,.8,10];
const SHAPE={seed:61,radius:1.5,stretch:1.25,depth:2.1,hilliness:.14};
const PAL={grassLow:'#5f8852',grassHigh:'#9bb67b',grassSun:'#d0d89b',rim:'#6f8f59',path:'#d4c7a5',strata:[[0,'#779361'],[.25,'#b9a1b2'],[.65,'#9786a5'],[1,'#645d83']]};
// [time, camera position, look-at, fov]: holds are pairs of identical shots, cuts are short eases.
const SHOTS=[
 [0,[8,6,14],[0,1,0],36],[1.3,[8,6,14],[0,1,0],36],[4.2,[0,23,39],[0,1,0],44],[5,[0,23,39],[0,1,0],44],
 [7.2,[-8,5.2,7.5],[-12.6,1.6,1],34],[16,[-8.5,5,7.8],[-12.6,1.6,1],34],
 [18,[0,22,34],[-4,1,2],44],[21.6,[0,22,34],[-4,1,2],44],
 [23,[-2,11,14],[-10,2,-1.5],38],[28,[-2.4,10.6,14.4],[-10,2,-1.5],38],
 [29.3,[0,22,34],[-4,1,2],44],[31.6,[0,22,34],[-4,1,2],44],
 [33,[-3,12,19],[-10,1.6,2],40],[37,[-3.3,11.6,19.4],[-10,1.6,2],40],
 [38.4,[-1,9,24],[-1.5,1,8],40],[41,[-1,8.8,23.5],[-1.5,1,8],40],
 [42.3,[-4,30,20],[-4,1,3],44],[46,[-4,30,20],[-4,1,3],44],
 [47.2,[0,17,30],[-2,1,5],40],[50.8,[0,17,30],[-2,1,5],40],
 [52,[0,13,17],[0,1,1.5],34],[56.2,[0,13,17],[0,1,1.5],34],
 [58.6,[0,24,40],[0,1,0],44],[60,[0,24,40],[0,1,0],44],
];
export const LINES=[
 [.4,4,'Welcome to Maya’s gift. Everyone here is helping.'],
 [5.2,8.8,'This island is yours. Let’s give it a memory.'],
 [9,12.6,'Type a thought, drop a photo, or ask me for a nudge.'],
 [13,16.5,'One real moment is enough. This becomes part of the gift.'],
 [17.6,21.4,'You’re in. Keep exploring. I’ll step in when something happens.'],
 [22.5,27.8,'Wait. Jon just dropped a memory. You both mention clay, so I’m connecting them.'],
 [32.5,36.8,'Ally’s here too. Three memories, one thread. That’s enough to search real shops.'],
 [38.4,41.2,'Listings are arriving, each with a source and a price.'],
 [41.6,45.8,'Tap why on any gift to follow it back to your memories.'],
 [47,50.8,'Jon supports the class. Ally knows she owns the wheel. Every signal moves the map.'],
 [52,55.8,'Bring the favorite to the present. Each person approves their own share.'],
 [56.2,60,'That’s it. You learned it by doing it.'],
];
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*x*(x*(x*6-15)+10);};
const ramp=(t,a,b)=>smooth((t-a)/(b-a));
const Icon=({name,size=18})=><MapIcon name={name} size={size}/>;

function Camera({t}){const {camera}=useThree();useFrame(()=>{let i=Math.max(0,SHOTS.findLastIndex(s=>t>=s[0]));const a=SHOTS[i],b=SHOTS[Math.min(i+1,SHOTS.length-1)],p=smooth((t-a[0])/Math.max(.01,b[0]-a[0]));camera.position.lerpVectors(new THREE.Vector3(...a[1]),new THREE.Vector3(...b[1]),p);camera.lookAt(new THREE.Vector3().lerpVectors(new THREE.Vector3(...a[2]),new THREE.Vector3(...b[2]),p));camera.fov=THREE.MathUtils.lerp(a[3],b[3],p);camera.updateProjectionMatrix();});return null;}

// Growth and the traveling spark are driven by film time so stepped frame capture stays deterministic.
function Branch({a,b,grow,lit,t,dim}){
 const curve=useMemo(()=>new THREE.CatmullRomCurve3([new THREE.Vector3(...a),new THREE.Vector3((a[0]+b[0])/2,Math.min(a[1],b[1])-.5,(a[2]+b[2])/2),new THREE.Vector3(...b)]),[...a,...b]);
 const geo=useMemo(()=>new THREE.TubeGeometry(curve,48,lit?.06:.035,6,false),[curve,lit]);
 useEffect(()=>()=>geo.dispose(),[geo]);
 geo.setDrawRange(0,Math.floor(grow*48)*36);
 if(grow<=0)return null;
 return <><mesh geometry={geo}><meshBasicMaterial color={lit?'#f2d49a':dim?'#a59fb4':'#e2c99c'} transparent opacity={dim?.3:lit?.95:.75}/></mesh>{grow>=1&&!dim&&<mesh position={curve.getPoint((t*.3)%1)}><sphereGeometry args={[lit?.11:.07,8,8]}/><meshBasicMaterial color="#fff2cf"/></mesh>}</>;
}
function MemoryIsland({at,size=1,tree=1,drop=1,children}){if(drop<=0)return null;return <group position={[at[0],at[1]+(1-drop)*9,at[2]]} scale={size*(.7+.3*drop)}><IslandMesh shape={SHAPE} palette={PAL} detail={{rings:10,segments:32,layers:12}} shadows={false}/><Tree position={[-.8,.15,-.5]} scale={tree} shade="#a3bc82"/>{children}</group>;}
function Ring({r,o,color='#efd294',pulse=0}){return <mesh position={[0,.16,0]} rotation={[-Math.PI/2,0,0]} scale={1+pulse}><ringGeometry args={[r,r+.06,80]}/><meshBasicMaterial color={color} transparent opacity={o} side={THREE.DoubleSide}/></mesh>;}
function ThemeCloud({t}){
 const s=ramp(t,24,25.8);if(s<=0)return null;
 const search=t>=35.6&&t<38.4,prog=ramp(t,35.6,38.4),count=t>=33.6?3:2;
 return <group position={THEME} scale={.6+.4*s}>
  {[[-.9,0,0,1.1],[.3,.25,.1,1.3],[1.3,-.05,-.1,.95],[.2,-.2,.5,.9]].map(([x,y,z,r],i)=><mesh key={i} position={[x,y,z]} scale={[r*1.25,r*.7,r]}><sphereGeometry args={[1,18,12]}/><meshToonMaterial color="#f4eef4" transparent opacity={.92*s}/></mesh>)}
  {search&&<mesh position={[.2,-.9,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[2.1,2.22,96,1,0,Math.PI*2*prog]}/><meshBasicMaterial color="#e8c47e" side={THREE.DoubleSide}/></mesh>}
  <Html position={[0,1.6,0]} center zIndexRange={[50,40]}><div className="theme-tag" style={{opacity:s}}><Icon name="thread" size={13}/><b>Handmade</b><span>{count} memories</span>{search&&<em>Searching shops… {Math.round(prog*100)}%</em>}{t>=38.4&&<em className="done">3 real listings found</em>}</div></Html>
 </group>;
}
const GIFTS=[
 {at:G1,kind:'class',title:'Wheel-throwing date night',price:'$68',src:'ClassBento',time:'retrieved 1 min ago',from:39.4},
 {at:G2,kind:'mug',title:'Handmade glaze sampler',price:'$42',src:'Etsy',time:'retrieved 1 min ago',from:38.6},
 {at:G3,kind:'wheel',title:'Tabletop pottery wheel',price:'$54',src:'Amazon',time:'retrieved 1 min ago',from:39,owned:true},
];
function GiftNode({g,t}){
 const s=ramp(t,g.from-.3,g.from+.6);if(s<=0)return null;
 const toBox=g.kind==='class'?ramp(t,51.8,54):0;
 const pos=g.at.map((v,i)=>THREE.MathUtils.lerp(v,[0,1.4,.2][i],toBox));
 if(g.kind!=='class'&&t>=51.8)return null;
 const owned=g.owned&&t>=49,why=g.kind==='class'&&t>=42.4&&t<46,support=g.kind==='class'&&t>=47.8,chosen=toBox>0;
 return <group position={pos} scale={(.55+.45*s)*(1-toBox*.55)}>
  <mesh position={[0,-.25,0]}><cylinderGeometry args={[1.05,.8,.4,9]}/><meshToonMaterial color={owned?'#8e8a97':'#c9bfa2'}/></mesh>
  <group position={[-.2,-.05,0]}><GiftProp kind={g.kind} muted={owned}/></group>
  {(why||support)&&!chosen&&<Ring r={1.25} o={.8} color={why?'#f2d49a':'#bcd29a'}/>}
  {!chosen&&<Html position={[0,1.35,0]} center zIndexRange={[60,50]}><div className={`listing ${owned?'owned':''} ${support?'liked':''}`} style={{opacity:s}}>
   <strong>{g.title}</strong><span className="price">{g.price}</span><span className="src"><Icon name="open" size={10}/>{g.src} · {g.time}</span>
   {support&&<span className="signal yes"><img src="./explorer.png" alt=""/>Jon supports</span>}
   {owned&&<span className="signal own"><img src="./kind.png" alt=""/>Ally: she already owns one</span>}
  </div></Html>}
 </group>;
}
function Cursor({name,img,path,t,start,end}){
 if(t<start||t>end)return null;
 let i=Math.max(0,path.findLastIndex(p=>t>=p[0]));const a=path[i],b=path[Math.min(i+1,path.length-1)],p=smooth((t-a[0])/Math.max(.01,b[0]-a[0]));
 const pos=a[1].map((v,k)=>THREE.MathUtils.lerp(v,b[1][k],p));
 return <Html position={pos} zIndexRange={[90,80]}><div className="peer-cursor"><svg width="20" height="24" viewBox="0 0 26 31"><path d="M3 2l19 14-9 1-4 10z" fill="#fff4d4" stroke="#74604a" strokeWidth="1.5"/></svg><span><img src={img} alt=""/>{name}</span></div></Html>;
}
function World({t}){
 const saved=t>=16.2,why=t>=42.4&&t<46,jonDrop=ramp(t,19.6,21),allyDrop=ramp(t,29.8,31.2);
 const grow=k=>k<2?ramp(t,24.4+k*.5,26.4+k*.5):ramp(t,33.4,35.2);
 const split=t>=53.6&&t<57,yes=t>=55.6?3:t>=55?2:t>=54.4?1:0,frozen=pausedAt(t);
 return <Canvas camera={{position:[8,6,14],fov:36,near:.1,far:600}} dpr={[1,1.5]} gl={{antialias:true,preserveDrawingBuffer:true}}><Camera t={t}/>
  <ambientLight intensity={1.45}/><hemisphereLight args={['#e8e1f1','#60745e',1.1]}/><directionalLight color="#ffdfb8" intensity={2.2} position={[-8,20,12]}/><fog attach="fog" args={['#68748c',65,145]}/>
  <ScenePaletteContext.Provider value={paletteFor('day')}><AtmosphericSky animate={false}/><DistantScenery animate={false} islets={false}/>
  <group scale={.75}><FloatingIsland/><IslandEnvironment quality="low" animate={false} showPlayers={false}/><group position={[GIFT_SPOT.x,platformTop()+.1,GIFT_SPOT.z]} scale={1.4}><Present selected={t>=53.6} approved={yes===3}/></group></group>
  <Suspense fallback={null}>
   <MemoryIsland at={YOU} size={1.15} tree={saved?1:.5}>
    <Spirit avatar="curious" position={[.35,.1,.2]} scale={.85} reduce/>
    {t<18&&<Spirit avatar="calm" position={[-.55,.12,.6]} scale={.62} reduce/>}
    {t>=5&&t<16.2&&<Ring r={1.85} o={.75}/>}
    {saved&&<Html position={[0,1.05,1.7]} center zIndexRange={[40,30]}><div className={`island-chip ${why?'lit':''}`}><img src="./curious.png" alt=""/>You · pottery every Sunday<Icon name="check" size={12}/></div></Html>}
   </MemoryIsland>
   <MemoryIsland at={JON} size={.8} drop={jonDrop}><Spirit avatar="explorer" position={[.2,.1,.2]} scale={.75} reduce/>{jonDrop>=1&&<Html position={[0,.9,1.6]} center><div className={`island-chip small ${why?'lit':''} ${t>=22.3&&t<28?'event':''}`}><img src="./explorer.png" alt=""/>Jon · she glazes her own clay mugs</div></Html>}</MemoryIsland>
   <MemoryIsland at={ALLY} size={.8} drop={allyDrop}><Spirit avatar="kind" position={[.2,.1,.2]} scale={.75} reduce/>{allyDrop>=1&&<Html position={[0,.9,1.6]} center><div className={`island-chip small ${why?'lit':''} ${t>=32.3&&t<37?'event':''}`}><img src="./kind.png" alt=""/>Ally · wants a class with friends</div></Html>}</MemoryIsland>
   <Branch a={YOU} b={THEME} grow={grow(0)} lit={why||(t>=24.4&&t<28)} t={frozen?frozen[0]:t}/><Branch a={JON} b={THEME} grow={grow(1)} lit={why||(t>=24.9&&t<28)} t={frozen?frozen[0]:t}/><Branch a={ALLY} b={THEME} grow={grow(2)} lit={why||(t>=33.4&&t<37)} t={frozen?frozen[0]:t}/>
   <ThemeCloud t={t}/>
   {GIFTS.map((g,i)=><React.Fragment key={g.kind}><Branch a={THEME} b={g.at} grow={ramp(t,g.from-.6,g.from+.4)*(g.kind==='class'?1-ramp(t,51.8,52.3):1)} lit={why&&g.kind==='class'} dim={g.owned&&t>=49} t={t+i*.3}/><GiftNode g={g} t={t}/></React.Fragment>)}
   <Cursor name="Jon" img="./explorer.png" t={t} start={46.6} end={51.5} path={[[46.6,[-9,2,4]],[47.8,[-5.3,2.6,9.6]],[51.5,[-5.3,2.6,9.6]]]}/>
   <Cursor name="Ally" img="./kind.png" t={t} start={47.2} end={51.5} path={[[47.2,[8,2,6]],[49,[4,2.2,10]],[51.5,[4,2.2,10]]]}/>
   {split&&[[-3.4,1.6,4.2],[3.4,1.6,4.2],[0,1.6,7.6]].map((at,i)=><React.Fragment key={i}><Branch a={[0,1.2,0]} b={at} grow={ramp(t,53.6,54.4)} lit={i<yes} t={t}/><Html position={at} center zIndexRange={[65,55]}><div className={`cinema-petal ${i<yes?'approved':''}`}><span><img src={`./${['curious','explorer','kind'][i]}.png`} alt=""/>{['You','Jon','Ally'][i]}</span><b>${['22.67','22.67','22.66'][i]}</b><button>{i<yes?<><Icon name="check" size={12}/>Approved</>:'Awaiting their yes'}</button></div></Html></React.Fragment>)}
   {split&&<Html position={[0,4.6,0]} center><div className="split-heading">Wheel-throwing date night · {yes}/3 approved<small>Each person approves only their own share</small></div></Html>}
   {t>=57&&<Html position={[0,3.4,0]} center zIndexRange={[70,60]}><div className="island-chip gold"><Icon name="present"/>Wheel-throwing date night · everyone’s in</div></Html>}
  </Suspense></ScenePaletteContext.Provider></Canvas>;
}
function Narration({t}){const line=LINES.find(c=>t>=c[0]&&t<c[1]);return <AnimatePresence mode="wait">{line&&<motion.div key={line[0]} className="narration" initial={{opacity:0,y:7}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}} transition={{duration:.2}}><img src="./calm.png" alt="Moss"/><div><span>MOSS</span><p>{line[2]}</p></div></motion.div>}</AnimatePresence>;}
const CHAPTERS=[[0,'Arrive'],[5,'Your island'],[17.5,'Live room']];
function Film(){
 const q=new URLSearchParams(location.search),capture=q.has('capture');
 const [t,setT]=useState(Number(q.get('t')??0)),[playing,setPlaying]=useState(false);
 useEffect(()=>{window.__setT=v=>new Promise(r=>{setT(v);requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r)));});},[]);
 useEffect(()=>{if(!playing)return;let id,last=performance.now();const tick=now=>{const d=Math.min((now-last)/1000,.1);last=now;setT(o=>{const n=Math.min(DURATION,o+d);if(n>=DURATION)setPlaying(false);return n;});id=requestAnimationFrame(tick);};id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);},[playing]);
 const choice=t>=8.6&&t<12.6,editor=t>=12.6&&t<16.2,typed=SEED.slice(0,Math.floor(Math.max(0,t-13)*20));
 const chapter=CHAPTERS.findLastIndex(c=>t>=c[0]);
 return <div className={`cinematic-shell ${capture?'capture':''}`}><main className="tutorial-app"><header><b>unwrap.</b><span>Maya’s gift</span><div className="chapter-rail">{CHAPTERS.map((c,i)=><i key={c[1]} className={i===chapter?'current':i<chapter?'past':''}>{c[1]}</i>)}</div></header>
  <div className="tutorial-stage"><World t={t}/>
   <AnimatePresence mode="wait">
    {choice&&<motion.div className="choice-panel" key="choice" initial={{opacity:0,x:24}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-14}} transition={{duration:.3}}><span className="eyebrow">YOUR FIRST MEMORY</span><h1>Start with a little thing.</h1><p>There’s no right way to remember someone.</p><button className={t>=11.6?'selected':''}><Icon name="memory"/><span>Type a thought<small>A hobby, a wish, a little habit</small></span><b>↗</b></button><button><Icon name="camera"/><span>Drop a photo<small>Moss finds the clues in it</small></span><b>↗</b></button><button><Icon name="spark"/><span>I can’t think of anything<small>Moss asks you a question</small></span><b>↗</b></button></motion.div>}
    {editor&&<motion.div key="editor" className="entry-panel" initial={{opacity:0,y:18}} animate={{opacity:1,y:0}} exit={{opacity:0,scale:.92,y:-12}} transition={{duration:.3}}><span className="eyebrow">A MEMORY OF MAYA</span><h1>What comes to mind?</h1><div className="writing-area">{typed}<i/></div><button className={t>=15.6?'pressed':''}><Icon name="sprout"/>Share with the room</button><small>Published memories are visible to everyone in this gift.</small></motion.div>}
   </AnimatePresence>
   {t>=17.5&&<div className={`live-pill ${pausedAt(t)?'held':''}`}><i/>{pausedAt(t)?'Moss paused the room for a moment':`LIVE · ${t<21?1:t<31.2?2:3} in Maya’s gift`}</div>}
   <div className={`pause-veil ${pausedAt(t)?'on':''}`}/>
   {(()=>{const p=pausedAt(t);if(!p)return null;const k=Math.min(1,(t-p[0])/(p[1]-p[0]));return <div className="pause-timer"><i style={{transform:`scaleX(${1-k})`}}/><span>Continues on its own · tap to keep going</span></div>;})()}
   <Narration t={t}/><div className="cinema-vignette"/>
  </div></main>
  {!capture&&<section className="export-controls"><button onClick={()=>{if(t>=DURATION)setT(0);setPlaying(p=>!p);}}>{playing?'Pause':'Play film'}</button><label><span>{Math.floor(t)} / {DURATION}s</span><input aria-label="Film time" type="range" min="0" max={DURATION} step=".1" value={t} onChange={e=>{setPlaying(false);setT(Number(e.target.value));}}/></label></section>}
 </div>;
}
createRoot(document.getElementById('root')).render(<Film/>);
