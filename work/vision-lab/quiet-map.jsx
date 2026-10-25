import React,{Suspense,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AnimatePresence,MotionConfig,motion,useReducedMotion} from 'motion/react';
import {Canvas,useFrame,useThree} from '@react-three/fiber';
import {Html,OrbitControls} from '@react-three/drei';
import * as THREE from 'three';
import {Spirit,Tree,Present,GiftProp} from './sky-tree';
import {mockQrModules} from '../../lib/invitation/mockQr';

const LENGTH=38;
const SHORT={pottery:'Pottery',coffee:'Slow mornings',make:'Handmade',ritual:'Sunday rituals',mug:'Handmade mug',kit:'Pottery kit',beans:'Coffee sampler',class:'Clay workshop',box:'Our gift'};
const EXTRA_NAMES=['Garden mornings','Weekend walks','Little rituals','Art books','Warm textures','Cooking together','New skills','Shared experiences','Local makers','Tea time','Nature breaks','Collecting stories','Sketching','Cozy evenings','Small adventures','Made with care','Music nights'];
const PREVIEW_QR=mockQrModules('node-interaction-film');
const CHAPTERS=[
 {at:0,label:'A calmer map',title:'Let the map breathe.',note:'Room controls live in the header. The map keeps the attention.'},
 {at:3,label:'Hover',title:'A little context, right where you look.',note:'Hover or focus a node for a two-line preview. Move away and it quietly folds back.'},
 {at:7,label:'Attached actions',title:'Click once. The node becomes the control.',note:'A small cluster blooms from its anchor. Support and pass stay separate and undoable.'},
 {at:12,label:'Pass',title:'A pass changes priority, not the facts.',note:'The kit drifts outward with an attributed rose signal. It remains available.'},
 {at:16,label:'Already owns',title:'Ownership needs a different gesture.',note:'Confirm the fact in place. The gift rests with a clear label and an undo action.'},
 {at:21,label:'Why this?',title:'Follow the evidence, not another panel.',note:'Only the relevant memories, themes and gift light up. The rest of the map stays in place.'},
 {at:26,label:'Research',title:'The work appears where it is happening.',note:'Progress belongs to the theme being explored. A sample result grows from that same branch.'},
 {at:32,label:'Shares',title:'Three small yeses unfold from the present.',note:'Each friend gets a share petal. Approvals fill the ring without opening a large panel.'},
];
const NODES={
 pottery:{type:'memory',title:'“She keeps talking about pottery.”',by:'Jon remembers',preview:'A confirmed memory from Jon.',at:[-10,0,-3.7],avatar:'explorer'},
 coffee:{type:'memory',title:'“Coffee. A book. A slow Sunday.”',by:'Ally remembers',preview:'A quiet ritual, shared by Ally.',at:[-10,0,3.4],avatar:'kind'},
 make:{type:'theme',title:'Makes things with her hands',by:'Suggested theme · 1 memory',preview:'An interpretation of Jon’s pottery memory.',at:[-5.3,0,-3.3]},
 ritual:{type:'theme',title:'Slow Sunday rituals',by:'Suggested theme · 1 memory',preview:'An interpretation of Ally’s coffee memory.',at:[-5.3,0,3.2]},
 mug:{type:'gift',title:'A mug, made by hand',by:'$34 · illustrative price',preview:'Connects pottery with slow coffee mornings.',at:[4.8,0,1.7],price:34,prop:'mug'},
 kit:{type:'gift',title:'A little pottery kit',by:'$48 · illustrative price',preview:'A hands-on direction from the pottery memory.',at:[4.8,0,-3.8],price:48,prop:'kit'},
 beans:{type:'gift',title:'A Sunday coffee sampler',by:'$28 · sample alternative',preview:'A new sample coffee branch from slow rituals.',at:[9.2,0,3.5],price:28,prop:'kit'},
 class:{type:'gift',title:'An afternoon with clay',by:'$65 · sample alternative',preview:'A new sample experience branch from pottery.',at:[9.2,0,-1.8],price:65,prop:'class'},
 box:{type:'box',title:'Our gift',by:'Together, up to $80',at:[0,0,0]},
};
EXTRA_NAMES.forEach((title,i)=>{const a=i/EXTRA_NAMES.length*Math.PI*2;NODES['extra'+i]={type:i%3===0?'memory':'theme',title,by:'Sample clue · density study',preview:'An illustrative direction. Click to inspect its local controls.',at:[Math.cos(a)*12.4,0,Math.sin(a)*8],avatar:i%2?'kind':'explorer'};});
const LINKS=[['pottery','make'],['coffee','ritual'],['make','mug'],['ritual','mug'],['make','kit'],['make','class'],['ritual','beans']];
const WHY=new Set(['pottery','coffee','make','ritual','mug']);
const signalOf=(v,id)=>v.signals?.[id]??(id==='mug'&&v.support?1:id==='kit'&&v.pass?-1:0);
const owns=(v,id)=>v.ownedIds?.[id]??(id==='kit'&&v.owned);
const whyOf=v=>v.selected==='kit'||v.selected==='class'||v.selected==='make'?new Set(['pottery','make',v.selected]):v.selected==='ritual'?new Set(['coffee','ritual']):WHY;
function frame(t){return {hover:t>=3&&t<7?'mug':null,selected:t>=7&&t<12?'mug':t>=12&&t<21?'kit':t>=21&&t<26?'mug':t>=26&&t<32?'make':t>=32?'box':null,support:t>=9,pass:t>=12,confirm:t>=16&&t<18,owned:t>=18,why:t>=21&&t<26,researchTarget:'make',research:t>=26&&t<30,newResult:t>=30,shares:t>=32,yes:t>=36?3:t>=34.5?2:t>=33.5?1:0,menu:null,sub:null,chosen:'mug'};}
function useFit(reset){const {camera,size}=useThree();useEffect(()=>{camera.zoom=Math.min(size.width/29,size.height/19);camera.position.set(0,19,22);camera.lookAt(0,0,0);camera.updateProjectionMatrix();},[camera,size.width,size.height,reset]);return null;}
function Fit({reset}){useFit(reset);return null;}
function Anchor({children,active}){
 const ref=useRef();
 useLayoutEffect(()=>{const node=ref.current;if(!node)return;const stage=node.closest('.film-stage');if(!stage)return;let id;const measure=()=>{node.style.setProperty('--shift','0px');const a=node.getBoundingClientRect(),b=stage.getBoundingClientRect();const dx=a.left<b.left+12?b.left+12-a.left:a.right>b.right-12?b.right-12-a.right:0;node.style.setProperty('--shift',`${dx}px`);};id=requestAnimationFrame(measure);const ro=new ResizeObserver(measure);ro.observe(node);window.addEventListener('resize',measure);return()=>{cancelAnimationFrame(id);ro.disconnect();window.removeEventListener('resize',measure);};},[active]);
 return <div className="anchor-content" ref={ref}>{children}</div>;
}
function Link({from,to,bright,dim,reduce}){
 const dot=useRef();const curve=useMemo(()=>new THREE.CatmullRomCurve3([new THREE.Vector3(...from),new THREE.Vector3((from[0]+to[0])/2,-.4,(from[2]+to[2])/2),new THREE.Vector3(...to)]),[...from,...to]);
 const geo=useMemo(()=>new THREE.TubeGeometry(curve,40,bright?.035:.018,5,false),[curve,bright]);useEffect(()=>()=>geo.dispose(),[geo]);
 useFrame(({clock})=>{if(dot.current)dot.current.position.copy(curve.getPoint((clock.elapsedTime*.22)%1));});
 return <group><mesh geometry={geo}><meshBasicMaterial color={bright?'#f3d69d':'#bfb4d2'} transparent opacity={dim?.1:bright?.95:.32}/></mesh>{bright&&!reduce&&<mesh ref={dot}><sphereGeometry args={[.065,8,8]}/><meshBasicMaterial color="#fff1d3"/></mesh>}</group>;
}
function Ground({at,radius=1,color='#b9b6cf',active,dim,children,onClick,onHover,onUnhover,reduce}){
 const ref=useRef(),initial=useRef(at);useFrame((_,dt)=>{if(ref.current){if(reduce)ref.current.position.set(...at);else ref.current.position.lerp(new THREE.Vector3(...at),1-Math.exp(-dt*6));}});
 return <group ref={ref} position={initial.current} onPointerOver={e=>{e.stopPropagation();onHover?.();}} onPointerOut={()=>onUnhover?.()} onClick={e=>{e.stopPropagation();onClick?.();}}><mesh position={[0,-.26,0]}><cylinderGeometry args={[radius,radius*.66,.55,7]}/><meshToonMaterial color={dim?'#827d91':color}/></mesh><mesh position={[0,-.83,0]} rotation={[0,0,Math.PI]}><coneGeometry args={[radius*.65,.8,7]}/><meshToonMaterial color="#8d809e"/></mesh><mesh position={[0,.03,0]}><cylinderGeometry args={[radius,radius,.12,9]}/><meshToonMaterial color={dim?'#929294':'#aaba8a'}/></mesh>{active&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.1,0]}><ringGeometry args={[radius*1.03,radius*1.12,48]}/><meshBasicMaterial color="#ead1a4" transparent opacity={.85}/></mesh>}{children}</group>;
}
function ProgressRing({reduce}){const ref=useRef();useFrame((_,dt)=>{if(ref.current&&!reduce)ref.current.rotation.z-=dt*1.1;});return <group position={[0,.15,0]} rotation={[-Math.PI/2,0,0]}><mesh ref={ref}><ringGeometry args={[1.05,1.12,48,1,0,Math.PI*1.4]}/><meshBasicMaterial color="#efd29a" side={THREE.DoubleSide}/></mesh></group>;}
function Icon({kind}){return <span aria-hidden="true">{{support:'♥',pass:'−',why:'⌁',more:'···',owned:'✓',search:'↗',box:'↘',close:'×'}[kind]}</span>;}
function NodeUI({id,v,act,reduce}){
 const n=NODES[id],active=v.selected===id,hovered=v.hover===id&&!v.selected;
 const revealed=active||hovered,short=SHORT[id]??n.title;
 const motionProps={initial:{opacity:0,y:reduce?0:5,scale:reduce?1:.96},animate:{opacity:1,y:0,scale:1},exit:{opacity:0,y:reduce?0:3},transition:{type:'spring',stiffness:330,damping:28}};
 const signal=owns(v,id)?'owned':signalOf(v,id)>0?'support':signalOf(v,id)<0?'pass':null;
 const evidence=v.why&&whyOf(v).has(id);
 const subdued=v.shares||v.selected&&!active&&!evidence;
 return <Anchor active={revealed}><div className={`node-unit ${active?'selected':''} ${hovered?'hovered':''} ${signal??''} ${subdued?'focus-other':''} ${id.startsWith('extra')?'density-node':''} ${evidence?'evidence-node':''}`} onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>
  <button className="node-face" aria-expanded={active} onMouseEnter={()=>act('hover',id)} onMouseLeave={()=>act('unhover',id)} onFocus={()=>act('hover',id)} onBlur={()=>act('unhover',id)} onClick={()=>act('select',id)} aria-label={`Inspect ${n.title}`}>
   {active&&<small>{n.by}</small>}
   <strong>{active?n.title:short}</strong>
   {signal&&<em aria-label={signal==='owned'?'Confirmed ownership':signal==='support'?'Supported':'Passed'}><span aria-hidden="true">{signal==='support'?'♥':signal==='pass'?'−':'✓'}</span>{active&&(signal==='support'?' Supported':signal==='pass'?' Passed for now':' Confirmed owned')}</em>}
  </button>
  <AnimatePresence mode="wait">{hovered&&<motion.div key="preview" className="node-preview" {...motionProps}>{n.price&&<b>${n.price} · sample price</b>}<p>{n.preview??'One shared gift, approved together.'}</p></motion.div>}
  {active&&id!=='box'&&<motion.div key="actions" className="node-attached" {...motionProps}>
   <i className="anchor-stem"/>
   {id.startsWith('extra')?<div className="node-actions"><button onClick={()=>act('select',id)}>Back to the map</button></div>:n.type==='gift'?<>
    <div className="node-actions" role="group" aria-label={`Actions for ${n.title}`}>
     <button className="action-support" aria-pressed={signalOf(v,id)>0} onClick={()=>act('support',id)}><Icon kind="support"/>Support</button>
     <button className="action-pass" aria-pressed={signalOf(v,id)<0} onClick={()=>act('pass',id)}><Icon kind="pass"/>Pass</button>
     <button className="action-why" aria-pressed={v.why} onClick={()=>act('why',id)}><Icon kind="why"/>Why?</button>
     <button className="action-more" aria-expanded={v.sub==='more'} onClick={()=>act('more',id)} aria-label="More gift actions"><Icon kind="more"/></button>
    </div>
    <AnimatePresence>{(v.confirm||v.sub==='more')&&<motion.div key="more" className="node-more" {...motionProps}>
     {owns(v,id)?<button onClick={()=>act('undoOwned',id)}>Undo ownership confirmation</button>:v.confirm?<><p>This is a fact about Maya, not a vote.</p><button className="confirm-ownership" onClick={()=>act('owned',id)}>Confirm she already owns it</button><button onClick={()=>act('cancelConfirm',id)}>Cancel</button></>:<><button onClick={()=>act('confirm',id)}>She already owns this…</button><button onClick={()=>act('choose',id)}>Put this gift in the box ↘</button></>}
    </motion.div>}</AnimatePresence>
    {v.why&&<motion.p className="local-note" {...motionProps}>{n.preview}</motion.p>}
   </>:n.type==='theme'?<>
    {v.research?<div className="research-inline"><i/><span>Scout · checking {id==='ritual'?'coffee':'pottery'} ideas<small>Demo progress · no source call</small></span></div>:v.newResult&&id===(v.researchTarget??'make')?<div className="research-inline done"><span>✓ One sample alternative grew<small>Connected to this theme</small></span></div>:<div className="node-actions"><button onClick={()=>act('research',id)}><Icon kind="search"/>Explore gifts</button><button onClick={()=>act('why',id)}><Icon kind="why"/>Memories</button></div>}
   </>:<div className="node-actions"><button className="action-support" onClick={()=>act('support',id)}><Icon kind="support"/>Feels like her</button><button onClick={()=>act('research',id==='coffee'?'ritual':'make')}><Icon kind="search"/>Explore</button></div>}
  </motion.div>}

  </AnimatePresence>
 </div></Anchor>;
}
function Petal({name,amount,at,yes,mine,act,reduce}){return <Html position={at} center zIndexRange={[60,50]}><motion.div className={`share-petal ${yes?'approved':''}`} initial={{opacity:0,y:reduce?0:-12,scale:reduce?1:.8}} animate={{opacity:1,y:0,scale:1}} transition={{type:'spring',stiffness:220,damping:24,delay:mine?0:name==='Jon'?.12:.24}} onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}><span><img src={`./${mine?'curious':name==='Jon'?'explorer':'kind'}.png`} alt=""/>{name}</span><strong>${amount}</strong>{mine?<button onClick={()=>act('approve')} aria-pressed={yes}>{yes?'Approved ✓':'Approve my share'}</button>:<small>{yes?'Approved ✓':'Awaiting their yes'}</small>}</motion.div></Html>;}
function Scene({v,act,reduce,reset}){
 const lit=whyOf(v);
 const at=id=>{const p=[...NODES[id].at],signal=signalOf(v,id);if(signal>0)p[0]*=.9;if(signal<0||owns(v,id))p[0]*=1.13;if(v.shares){if(NODES[id].type==='gift')p[0]+=2.4;if(NODES[id].type==='theme')p[0]-=2.3;if(NODES[id].type==='memory')p[0]-=2.1;}return p;};
 const total=NODES[v.chosen].price*100;const amounts=[0,1,2].map(i=>((Math.floor(total/3)+(i<total%3?1:0))/100).toFixed(2));
 const target=v.researchTarget??'make';
 const visible=Object.keys(NODES).filter(id=>id.startsWith('extra')?v.dense:id==='class'?v.newResult&&target==='make':id==='beans'?v.newResult&&target==='ritual':true);
 return <Canvas orthographic shadows dpr={[1,1.5]} camera={{position:[0,19,22],zoom:36,near:.1,far:100}} gl={{antialias:true}} aria-label="Animated gift map"><Fit reset={reset}/><ambientLight intensity={1.3}/><directionalLight position={[-7,12,7]} intensity={2} color="#ffe0b9"/><hemisphereLight args={['#eee3f2','#7b7187',1]}/>
  {[3.5,6.5,10.7].map((r,i)=><mesh key={r} rotation={[-Math.PI/2,0,0]} scale={[1.15,1,1]} position={[0,-1.5,0]}><ringGeometry args={[r-.014,r+.014,100]}/><meshBasicMaterial color={i===0?'#dfc19a':'#c5bdd9'} transparent opacity={.17}/></mesh>)}
  {LINKS.filter(([a,b])=>visible.includes(b)).map(([a,b])=><Link key={a+b} from={at(a)} to={at(b)} bright={v.why&&lit.has(a)&&lit.has(b)||v.research&&a===target} dim={v.why&&(!lit.has(a)||!lit.has(b))||owns(v,b)} reduce={reduce}/>)}
  {v.shares&&<Link from={at(v.chosen)} to={at('box')} bright reduce={reduce}/>}
  <Suspense fallback={<Html center><div className="scene-loading">The little world is arriving…</div></Html>}>
   {visible.map(id=>{const n=NODES[id],dim=owns(v,id)||v.why&&!lit.has(id)&&id!=='box';return <Ground key={id} at={at(id)} reduce={reduce} radius={id==='box'?1.7:n.type==='theme'?.85:.75} color={n.type==='theme'?'#a99ac7':'#bcb0c8'} dim={dim} active={v.selected===id||v.hover===id} onClick={()=>act('select',id)} onHover={()=>act('hover',id)} onUnhover={()=>act('unhover',id)}>
    {n.type==='memory'?<Spirit avatar={n.avatar} scale={.75} position={[0,.1,0]} reduce={reduce}/>:n.type==='box'?<><group scale={1.5}><Present approved={v.yes===3} selected={v.shares}/></group><Tree position={[-1,.1,-.5]} scale={.9}/></>:n.type==='gift'?<GiftProp kind={n.prop} muted={dim}/>:<Tree position={[0,.08,0]} scale={.9} shade="#a6b77e"/>}
    {id===target&&v.research&&<ProgressRing reduce={reduce}/>}
    {!(id==='box'&&v.shares)&&<Html position={[0,id==='box'?-.4:-1.3,id==='box'?1:1.5]} center zIndexRange={v.selected===id?[45,35]:[25,10]}><NodeUI id={id} v={v} act={act} reduce={reduce}/></Html>}
   </Ground>;})}
   {v.shares&&<>
    {[0,1,2].map(i=><mesh key={'pledge'+i} position={[0,.15,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[2.08,2.17,48,1,i*Math.PI*2/3+.04,Math.PI*2/3-.08]}/><meshBasicMaterial color={i<v.yes?'#b5cd92':'#aa9bb4'} transparent opacity={i<v.yes?.95:.45} side={THREE.DoubleSide}/></mesh>)}
    {[[-3.2,.2,.4],[3.2,.2,.4],[0,.2,5.8]].map((p,i)=><Link key={'petal'+i} from={[0,.2,0]} to={p} bright={i<v.yes} dim={false} reduce={reduce}/>)}
    <Petal name="You" amount={amounts[0]} at={[-3.2,.5,.4]} mine yes={v.yes>=1} act={act} reduce={reduce}/><Petal name="Jon" amount={amounts[1]} at={[3.2,.5,.4]} yes={v.yes>=2} act={act} reduce={reduce}/><Petal name="Ally" amount={amounts[2]} at={[0,.5,5.8]} yes={v.yes>=3} act={act} reduce={reduce}/>
    <Html position={[0,3.7,-1]} center zIndexRange={[50,40]}><div className="box-status"><span>{v.yes}/3 shared yeses · version {v.version??1}</span><small>Illustrative split · shipping & tax unknown<br/>Pledges only. Nobody is charged.</small><button onClick={()=>act('limit')}>Your private limit: ${v.limit??40} · edit</button>{v.sub==='limit'&&<form onSubmit={e=>{e.preventDefault();act('limitSaved',Number(new FormData(e.currentTarget).get('limit')));}}><label>Only you see this<input aria-label="Your sample private limit" name="limit" type="number" min="0" step=".01" defaultValue={v.limit??40} required/></label><button>Save sample limit</button></form>}</div></Html>
   </>}
  </Suspense><OrbitControls enableRotate={false} enablePan={false} minZoom={18} maxZoom={75}/>
 </Canvas>;
}
function Film(){
 const osReduce=useReducedMotion();const [reduce,setReduce]=useState(false),[time,setTime]=useState(0),[playing,setPlaying]=useState(false),[manual,setManual]=useState(null),[reset,setReset]=useState(0),[menu,setMenu]=useState(null),[night,setNight]=useState(true),[note,setNote]=useState(null),[dense,setDense]=useState(false);
 const ref=useRef(0), researchTimer=useRef();const reduced=reduce||!!osReduce;
 useEffect(()=>{if(!playing)return;let id,previous=performance.now();const step=now=>{const dt=Math.min((now-previous)/1000,.12);previous=now;ref.current+=dt;if(ref.current>=.05){const d=ref.current;ref.current=0;setTime(t=>{const n=Math.min(LENGTH,t+d);if(n===LENGTH)setPlaying(false);return n;});}id=requestAnimationFrame(step);};id=requestAnimationFrame(step);return()=>cancelAnimationFrame(id);},[playing]);
 useEffect(()=>()=>clearTimeout(researchTimer.current),[]);
 const v={...(manual??frame(time)),dense};const chapter=CHAPTERS.findLast(c=>time>=c.at)??CHAPTERS[0];
 function seek(t){clearTimeout(researchTimer.current);setTime(t);setManual(null);setNote(null);}
 function act(type,id){
  if(type==='unhover'&&v.selected)return;
  if(type==='hover'&&(v.selected||playing))return;
  if(type==='unhover'&&playing)return;
  setPlaying(false);let next={...v,hover:null};setNote(null);
  if(type==='hover')next.hover=id;
  if(type==='select'){next.selected=v.selected===id?null:id;next.sub=null;next.confirm=false;next.why=false;next.shares=id==='box'&&next.selected==='box';}
  if(type==='unhover')next.hover=null;
  if(type==='support'){next.selected=id;next.signals={...v.signals,[id]:signalOf(v,id)>0?0:1};setNote('Support is an undoable preference signal. No facts, budgets or approvals changed.');}
  if(type==='pass'){next.selected=id;next.passBy='You';next.signals={...v.signals,[id]:signalOf(v,id)<0?0:-1};setNote('Pass lowers priority. The idea stays on the map.');}
  if(type==='why'){next.selected=id;next.why=!v.why;}
  if(type==='more'){next.sub=v.sub==='more'?null:'more';next.confirm=false;}
  if(type==='confirm'){next.confirm=true;next.sub='more';}
  if(type==='cancelConfirm'){next.confirm=false;next.sub=null;}
  if(type==='owned'){next.ownedIds={...v.ownedIds,[id]:true};next.confirm=false;next.sub='more';setNote('Ownership was explicitly confirmed in this sample. This is separate from passing.');}
  if(type==='undoOwned'){next.ownedIds={...v.ownedIds,[id]:false};next.sub=null;setNote('Ownership confirmation undone.');}
  if(type==='research'){next.selected=id;next.researchTarget=id;next.research=true;next.newResult=false;clearTimeout(researchTimer.current);researchTimer.current=setTimeout(()=>setManual(old=>old?{...old,research:false,newResult:true}:old),reduced?100:2300);}
  if(type==='choose'){if(owns(v,id)){setNote('Undo ownership before choosing this gift.');return;}next.chosen=id;next.selected='box';next.shares=true;next.yes=0;next.confirm=false;next.sub=null;}
  if(type==='approve'){next.yes=v.yes>=1?0:1;setNote('Only your sample approval changed. Other friends approve their own shares.');}
  if(type==='limit')next.sub=v.sub==='limit'?null:'limit';
  if(type==='limitSaved'){next.sub=null;next.limit=id;next.version=(v.version??1)+1;next.yes=0;setNote('Sample limit edited; approvals reset. Allocation is illustrative in this animation.');}
  setManual(next);
 }
 useEffect(()=>{const key=e=>{if(e.key==='Escape'){setMenu(null);setPlaying(false);setManual({...v,selected:null,hover:null,shares:false,why:false,sub:null});}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[v]);
 return <MotionConfig reducedMotion={reduced?'always':'user'}><div className={`film ${night?'night':'day'}`}>
  <div className="film-review-label"><span>UNWRAP / QUIET MAP STUDY</span><span>Progressive detail · sample data · live app unchanged</span><a href="./film.html">Previous animation ↗</a></div>
  <main className="film-app">
   <header className="room-bar"><div className="room-name"><b>unwrap.</b><i/><span>Maya’s birthday<small>One gift, together · $80 budget</small></span></div><div className="room-tools"><div className="room-roster">{[['curious','You'],['explorer','Jon'],['kind','Ally']].map(([image,name])=><img key={name} src={`./${image}.png`} alt={name} title={name}/>)}</div><button aria-expanded={menu==='invite'} onClick={()=>setMenu(menu==='invite'?null:'invite')}>Invite friends</button><button aria-expanded={menu==='settings'} aria-label="Room settings" onClick={()=>setMenu(menu==='settings'?null:'settings')}>⚙</button></div>
   <AnimatePresence>{menu&&<motion.div key={menu} className="header-pocket" initial={{opacity:0,y:-5}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-5}}>{menu==='invite'?<><strong>Bring a friend into the story</strong><p>The invite link and QR belong here, on request.</p><div className="invite-sample"><svg viewBox="-4 -4 33 33" role="img" aria-label="Decorative QR placement preview, not scannable"><rect x="-4" y="-4" width="33" height="33" fill="#fffaf0"/>{PREVIEW_QR.flatMap((row,y)=>row.map((dark,x)=>dark?<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#58495d"/>:null))}</svg><div><span>Invite on request</span><small>Decorative code<br/>No live invitation</small></div></div><button onClick={()=>setMenu(null)}>Back to the map</button></>:<><strong>Room settings</strong><label><input type="checkbox" checked={reduced} disabled={!!osReduce} onChange={e=>setReduce(e.target.checked)}/> Reduce motion</label><label><input type="checkbox" checked={!night} onChange={e=>setNight(!e.target.checked)}/> Daylight</label><button onClick={()=>{setReset(n=>n+1);setMenu(null);}}>Recenter map</button></>}</motion.div>}</AnimatePresence>
   </header>
   <div className={`film-stage ${v.shares?'split-view':''}`}><Scene v={v} act={act} reduce={reduced} reset={reset}/><div className="map-mode"><span>{v.shares?'DECIDE TOGETHER':v.why?'FOLLOW THE CONNECTIONS':v.selected?'ONE ISLAND IN FOCUS':'EXPLORE THE LITTLE WORLD'}</span><p>{v.shares?'Your amount. Your approval.':v.why?'Memories → themes → this gift':v.selected?'Escape to return to the map':'Hover to peek · click to explore'}</p></div><button className="density-switch" aria-pressed={dense} onClick={()=>setDense(d=>!d)}>{(dense?24:7)+(v.newResult?1:0)} islands <span>{dense?'− Less':'＋ Stress test'}</span></button><div className="map-legend"><span className="support-dot"/>♥ Support <span className="pass-dot"/>− Pass <span className="owned-dot"/>✓ Already owns</div></div>
   <div className="council-line" role="status"><span className="council-avatar"><img src="./calm.png" alt=""/></span><div><small>THE COUNCIL’S NOTEBOOK</small><p>{note??(v.research?`Scout is working on “${NODES[v.researchTarget??'make'].title}”.`:v.shares?`${v.yes}/3 sample approvals. Shares unfold from the present.`:v.why?'The lit threads connect two memories to one gift.':v.owned?'The kit rests because ownership was confirmed.':v.pass?'A pass is a preference, not an ownership claim.':'Hover to peek. Click to act. The map keeps the context.')}</p></div><>{!v.shares&&v.selected&&<button disabled={owns(v,v.selected)} onClick={()=>NODES[v.selected]?.type==='gift'?act('choose',v.selected):act('research',v.selected==='ritual'||v.selected==='coffee'?'ritual':'make')}>{NODES[v.selected]?.type==='gift'?owns(v,v.selected)?'Confirmed owned · choose another':'Put this gift in the box ↘':'Explore this direction ↗'}</button>}</></div>
  </main>
  <section className="film-player" aria-label="Animation playback"><div className="study-caption"><small>{manual?'TRY IT YOURSELF':`SCENE ${CHAPTERS.indexOf(chapter)+1} / ${CHAPTERS.length}`}</small><h1>{manual?'One focus. Everything else gets out of the way.':chapter.title}</h1><p>{manual?'Select another island, or press Escape to restore the quiet map.':chapter.note}</p></div><div className="transport"><button className="play-film" onClick={()=>{clearTimeout(researchTimer.current);if(time>=LENGTH)seek(0);setManual(null);setPlaying(p=>!p);}}>{playing?'Ⅱ Pause':'▷ Play walkthrough'}</button><button onClick={()=>{seek(0);setPlaying(false);}}>Restart</button><label className="timeline"><span>{Math.floor(time).toString().padStart(2,'0')} / {LENGTH}s</span><input aria-label="Walkthrough time" type="range" min="0" max={LENGTH} step=".1" value={time} onChange={e=>{setPlaying(false);seek(Number(e.target.value));}}/></label></div><nav aria-label="Walkthrough chapters">{CHAPTERS.map((c,i)=><button key={c.at} aria-current={chapter===c&&!manual?'step':undefined} onClick={()=>{setPlaying(false);seek(c.at+.2);}}><span>{i+1}</span>{c.label}</button>)}</nav><p>Click a chapter or play the film, then interact with any node. All data, research results and contributions are illustrative. No live room is modified.</p></section>
 </div></MotionConfig>;
}
createRoot(document.getElementById('root')).render(<Film/>);
