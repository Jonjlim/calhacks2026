import React, { Suspense, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, useAnimations, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const memoriesAt = { pottery: [-5.4, 1.8, -1.2], coffee: [-5.4, -1.2, 2.4], handmade: [-3.1, 3.7, -3.7] };
const giftsAt = { kit: [7.2, 3.6, -3.8], mug: [4.9, .7, .6], wheel: [5.8, -1.4, 3.2], class: [1.4, 4.8, -5.8] };
const rootAt = [0, -1.8, 3];
const trunkAt = [0, 1.1, .1];

// Islands slide on a flat plane. Releasing closer to the box supports, farther away passes; a gift dropped on the box selects it.
const DragContext = createContext(null);
const BOX_RADIUS = 1.9, VOTE_DISTANCE = .9;
const ringDistance = v => Math.hypot(v.x/1.8, v.z);
function DragLayer({children, onMove, onDragging, controller, onToss, onHold, onRelease, canHold, onHover, onDropBox}) {
  const {camera, gl} = useThree();
  const controls = useRef(), drag = useRef(null), blockedClick = useRef(null);
  const callbacks=useRef({});callbacks.current={onMove,onDragging,onToss,onHold,onRelease,canHold,onHover,onDropBox};
  const intersect = (x,y,plane) => {
    const rect=gl.domElement.getBoundingClientRect();
    const ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1),camera);
    return ray.ray.intersectPlane(plane,new THREE.Vector3());
  };
  const intent=(d,at)=>{const rs=ringDistance(d.at),re=ringDistance(at);if(d.id.startsWith('gift:')&&re<BOX_RADIUS)return 'box';return re-rs<-VOTE_DISTANCE?1:re-rs>VOTE_DISTANCE?-1:0;};
  const finish = () => {
    const d=drag.current; if(!d)return;
    const cb=callbacks.current;
    if(d.moved){
      blockedClick.current={id:d.id,until:performance.now()+400};
      const result=intent(d,d.last);
      if(result==='box')cb.onDropBox?.(d.id);else if(result)cb.onToss?.(d.id,result);
      cb.onHover?.('node');
    }
    cb.onMove?.(null);cb.onRelease?.();
    drag.current=null; if(controls.current)controls.current.enabled=true;
    cb.onDragging?.(null);
  };
  useEffect(()=>{
    const pointerMove=e=>{
      const d=drag.current;if(!d||e.pointerId!==d.pointerId)return;
      if(!d.moved&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<6)return;
      const cb=callbacks.current;
      if(cb.canHold&&!cb.canHold(d.id)){finish();return;}
      if(!d.moved)cb.onHover?.('drag');
      d.moved=true;e.preventDefault();
      const point=intersect(e.clientX,e.clientY,d.plane);if(!point)return;
      const next=d.at.clone().add(point.sub(d.hit));
      const r=ringDistance(next);if(r>9.5){next.x*=9.5/r;next.z*=9.5/r;}
      d.last=next;cb.onMove?.(d.id,next.toArray());cb.onDragging?.({id:d.id,dir:intent(d,next)});
    };
    const pointerUp=e=>{if(drag.current?.pointerId===e.pointerId)finish();};
    window.addEventListener('pointermove',pointerMove,{passive:false});
    window.addEventListener('pointerup',pointerUp,true);window.addEventListener('pointercancel',pointerUp,true);window.addEventListener('blur',finish);
    return()=>{window.removeEventListener('pointermove',pointerMove);window.removeEventListener('pointerup',pointerUp,true);window.removeEventListener('pointercancel',pointerUp,true);window.removeEventListener('blur',finish);finish();};
  },[camera,gl]);
  const api={
    begin(id,at,event){
      const e=event.nativeEvent??event;if(!id||e.button!==0)return;
      event.stopPropagation();event.preventDefault?.();
      if(callbacks.current.onHold?.(id)===false)return;
      const plane=new THREE.Plane(new THREE.Vector3(0,1,0),-at[1]);
      const hit=intersect(e.clientX,e.clientY,plane);if(!hit)return;
      drag.current={id,at:new THREE.Vector3(...at),last:new THREE.Vector3(...at),plane,hit,x:e.clientX,y:e.clientY,pointerId:e.pointerId,moved:false};
      if(controls.current)controls.current.enabled=false;
    },
    hover(mode){callbacks.current.onHover?.(drag.current?.moved?'drag':mode);},
    activate(id,fn){if(blockedClick.current?.id===id&&performance.now()<blockedClick.current.until)return;fn?.();},
  };
  controller.current=api;
  return <DragContext.Provider value={api}>{children}<OrbitControls ref={controls} enablePan={false} enableZoom minDistance={18} maxDistance={34} minPolarAngle={.2} maxPolarAngle={.85} minAzimuthAngle={-.35} maxAzimuthAngle={.35} target={[0,-1,1.1]} enableDamping/></DragContext.Provider>;
}
function DragLabel({id,at,onClick,children,controller,...props}) {
  const context=useContext(DragContext);
  const drag=()=>controller?.current??context;
  return <button {...props} draggable={false} onPointerDown={e=>drag()?.begin(id,at,e)} onPointerUp={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();drag()?.activate(id,onClick);}}>{children}</button>;
}
function Spirit({ avatar = 'curious', active = false, reduce = false, ...props }) {
  const {scene, animations} = useGLTF(`./models/${avatar}.glb`);
  const instance = useMemo(()=>{
    const c=clone(scene), bounds=new THREE.Box3().setFromObject(c), size=bounds.getSize(new THREE.Vector3()), center=bounds.getCenter(new THREE.Vector3());
    const scale=1.18/Math.max(size.y,.001);
    c.scale.setScalar(scale);c.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);
    c.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;}});
    return c;
  },[scene]);
  const {actions,mixer}=useAnimations(animations,instance);
  useEffect(()=>{
    const names=Object.keys(actions);const clip=names.find(n=>active?/wave|celebrate/i.test(n):/idle/i.test(n))||names.find(n=>/idle/i.test(n))||names[0];
    const action=actions[clip];if(!action)return;
    action.reset().fadeIn(.3).play();mixer.timeScale=reduce?0:1;
    return ()=>action.fadeOut(.3);
  },[active,actions,mixer,reduce]);
  return <group {...props}><primitive object={instance}/></group>;
}
function Tree({position=[0,0,0], scale=1, shade='#7c9e69'}) {
  return <group position={position} scale={scale}><mesh position={[0,.38,0]}><cylinderGeometry args={[.045,.08,.8,6]}/><meshToonMaterial color="#89705b"/></mesh>{[[0,.85,0],[.14,1.04,.03],[-.16,1.02,-.02]].map((p,i)=><mesh key={i} position={p} scale={[1,.9,1]}><icosahedronGeometry args={[.32,1]}/><meshToonMaterial color={shade}/></mesh>)}</group>;
}
function Grass({radius=1, muted=false}) {
  return <group>{Array.from({length:9},(_,i)=>{
    const a=i*2.4,r=radius*(.45+(i%3)*.15);return <group key={i} position={[Math.cos(a)*r,.05,Math.sin(a)*r]}><mesh position={[0,.12,0]}><cylinderGeometry args={[.012,.018,.23,4]}/><meshToonMaterial color={muted?'#8a8994':'#8aab79'}/></mesh><mesh position={[0,.25,0]}><icosahedronGeometry args={[.045,0]}/><meshToonMaterial color={muted?'#aaa0aa':i%2?'#e6b6b0':'#e9dfb3'}/></mesh></group>;
  })}</group>;
}
const SUPPORT='#9fcf7f', PASS='#e08f8a';
// Pulsing ground ring: soft when the group leans one way, strong right after someone votes.
function GlowRing({radius,color,strong,reduce}) {
  const m=useRef();
  useFrame(({clock})=>{if(!m.current||reduce)return;const t=clock.elapsedTime*(strong?6:2);const s=1+Math.sin(t)*(strong?.07:.02);m.current.scale.set(s,s,s);m.current.material.opacity=strong?.6+Math.sin(t)*.3:.4;});
  return <mesh ref={m} rotation={[-Math.PI/2,0,0]} position={[0,.1,0]}><ringGeometry args={[radius*1.03,radius*(strong?1.38:1.14),48]}/><meshBasicMaterial color={color} transparent opacity={.45} depthWrite={false}/></mesh>;
}
function Pulse({pulse}) {
  if(!pulse)return null;
  return <Html position={[0,2.05,0]} center zIndexRange={[99,96]}><div key={pulse.at} className={'node-pulse '+(pulse.value>0?'yes':'pass')}><b>{pulse.actor}</b>{pulse.value>0?'♥ feels like Maya':'✕ pass for now'}</div></Html>;
}
function Island({at,radius=1,children,muted=false,active=false,reduce=false,onClick,delay=0,dragId,top,rock,ring,glow,pulse}) {
  const root=useRef(), clock=useRef(0);
  const [hovered,setHovered]=useState(false);
  const drag=useContext(DragContext);
  useFrame((_,dt)=>{
    if(!root.current)return;clock.current+=dt;
    const show=Math.max(0,Math.min(1,(clock.current-delay)*2.3));
    const amount=reduce?1:THREE.MathUtils.smoothstep(show,0,1);
    root.current.scale.setScalar(amount);root.current.position.lerp(new THREE.Vector3(...at),1-Math.exp(-dt*4));
    if(!reduce)root.current.position.y+=Math.sin(clock.current*1.2+at[0])*.0015;
  });
  return <group ref={root} position={at} scale={reduce?1:0} onPointerDown={e=>drag?.begin(dragId,at,e)} onClick={e=>{e.stopPropagation();drag?.activate(dragId,onClick);}} onPointerOver={e=>{e.stopPropagation();setHovered(true);drag?.hover('node');}} onPointerOut={()=>{setHovered(false);}}>
    <mesh position={[0,-.35,0]} rotation={[0,.2,0]} castShadow><cylinderGeometry args={[radius*.95,radius*.65,.7,7]}/><meshToonMaterial color={muted?'#777083':rock??'#ad8f8b'}/></mesh>
    <mesh position={[0,-.95,0]} rotation={[0,.2,Math.PI]} castShadow><coneGeometry args={[radius*.67,1,7,2]}/><meshToonMaterial color={muted?'#7c7889':'#8f7992'}/></mesh>
    <mesh position={[0,-.04,0]} receiveShadow castShadow><cylinderGeometry args={[radius,radius*.95,.22,9]}/><meshToonMaterial color={muted?'#8b8a93':active?'#c7d39c':top??'#8fa471'}/></mesh>
    {ring&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.095,0]}><ringGeometry args={[radius*.86,radius*.92,40]}/><meshBasicMaterial color={ring} transparent opacity={.9}/></mesh>}
    {glow&&<GlowRing radius={radius} color={glow.color} strong={glow.strong} reduce={reduce}/>}
    <Pulse pulse={pulse}/>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.08,0]} receiveShadow><circleGeometry args={[radius*.7,9]}/><meshToonMaterial color={muted?'#9b98a2':'#c5ba91'}/></mesh>
    <Grass radius={radius} muted={muted}/>
    <Tree position={[-radius*.7,.04,-radius*.4]} scale={radius*.65} shade={muted?'#91909a':'#8ca877'}/>
    {(active||hovered)&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.09,0]}><ringGeometry args={[radius*.94,radius,40]}/><meshBasicMaterial color="#eed3a0" transparent opacity={.85}/></mesh>}
    {children}
  </group>;
}
function Branch({from,to,removed=false,warm=false,reduce=false,color}) {
  const root=useRef(), progress=useRef(0), particle=useRef();
  const curve=useMemo(()=>new THREE.CatmullRomCurve3([new THREE.Vector3(...from),new THREE.Vector3((from[0]+to[0])*.5, Math.min(from[1],to[1])-.6,(from[2]+to[2])*.5),new THREE.Vector3(...to)]),[...from,...to]);
  const tube=useMemo(()=>new THREE.TubeGeometry(curve,50,warm?.045:.028,6,false),[curve,warm]);
  useEffect(()=>()=>tube.dispose(),[tube]);
  useFrame(({clock},dt)=>{
    progress.current=Math.min(1,progress.current+dt*1.6);tube.setDrawRange(0,Math.floor((reduce?1:progress.current)*50)*36);
    if(particle.current){const t=reduce?1:(clock.elapsedTime*.15)%1;particle.current.position.copy(curve.getPoint(t));}
  });
  return <group ref={root}><mesh geometry={tube}><meshStandardMaterial color={removed?'#77738d':warm?'#ecc58f':color??'#c7b28c'} emissive={removed?'#000000':warm?'#947246':color??'#766256'} emissiveIntensity={warm?.35:color?.25:.35} transparent opacity={removed?.2:warm?.95:.72}/></mesh>{!removed&&!reduce&&<mesh ref={particle}><sphereGeometry args={[warm?.07:.045,8,8]}/><meshBasicMaterial color={warm?'#fff1cf':'#ffe7b5'}/></mesh>}</group>;
}
function Present({approved,selected}) {
  const ref=useRef();useFrame((_,dt)=>{if(ref.current)ref.current.position.y=THREE.MathUtils.lerp(ref.current.position.y,approved?.78:.95,1-Math.exp(-dt*5));});
  return <group position={[.2,.08,0]}><mesh position={[0,.38,0]} castShadow><boxGeometry args={[.9,.75,.8]}/><meshToonMaterial color={selected?'#f0e3c9':'#e5d4bf'}/></mesh><group ref={ref} position={[0,.95,0]}><mesh castShadow><boxGeometry args={[1,.13,.9]}/><meshToonMaterial color="#f5e8d2"/></mesh>{[-1,1].map(i=><mesh key={i} position={[i*.17,.16,0]} rotation={[Math.PI/2,0,i*.35]} scale={[1,.65,1]}><torusGeometry args={[.18,.045,7,16]}/><meshToonMaterial color="#cf9788"/></mesh>)}</group><mesh position={[0,.4,.01]}><boxGeometry args={[.13,.8,.84]}/><meshToonMaterial color="#c99181"/></mesh><mesh position={[0,.4,.01]}><boxGeometry args={[.92,.8,.12]}/><meshToonMaterial color="#c99181"/></mesh></group>;
}
function GiftProp({kind,muted}) {
  const clay=muted?'#96909c':'#b88970';
  if(kind==='mug')return <group position={[.2,.08,0]}><mesh position={[0,.29,0]} castShadow><cylinderGeometry args={[.28,.24,.54,20,1,true]}/><meshToonMaterial color={clay} side={THREE.DoubleSide}/></mesh><mesh position={[0,.565,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.235,.28,20]}/><meshToonMaterial color="#d7b293"/></mesh><mesh position={[.3,.3,0]}><torusGeometry args={[.18,.045,7,18]}/><meshToonMaterial color={clay}/></mesh></group>;
  if(kind==='class')return <group position={[.1,.1,0]} rotation={[0,.2,-.08]}><mesh position={[0,.38,0]} castShadow><boxGeometry args={[.75,.65,.08]}/><meshToonMaterial color="#eee0bd"/></mesh><mesh position={[0,.43,.055]}><boxGeometry args={[.52,.04,.01]}/><meshToonMaterial color="#bb8c70"/></mesh><mesh position={[0,.28,.055]}><boxGeometry args={[.32,.04,.01]}/><meshToonMaterial color="#bb8c70"/></mesh></group>;
  if(kind==='wheel')return <group position={[.2,.12,0]}><mesh castShadow><boxGeometry args={[.8,.22,.6]}/><meshToonMaterial color="#b5a4bd"/></mesh><mesh position={[0,.15,0]}><cylinderGeometry args={[.44,.44,.08,20]}/><meshToonMaterial color="#d8ccd8"/></mesh><mesh position={[0,.35,0]}><cylinderGeometry args={[.19,.25,.33,12]}/><meshToonMaterial color={clay}/></mesh></group>;
  return <group position={[.2,.35,0]} rotation={[0,.3,0]}><mesh castShadow><boxGeometry args={[.72,.6,.54]}/><meshToonMaterial color={muted?'#99909c':'#d3b18d'}/></mesh><mesh position={[0,.07,.28]}><boxGeometry args={[.4,.18,.01]}/><meshToonMaterial color="#ead5b3"/></mesh></group>;
}
function Clouds({reduce}) {
  return <group>{Array.from({length:9},(_,i)=><group key={i} position={[Math.sin(i*4.1)*13,-4.8-(i%3)*.55,Math.cos(i*3.7)*11]}>{[[-1,0,0],[.4,.12,.1],[1.5,-.1,-.15]].map((p,j)=><mesh key={j} position={p} scale={[2.4-j*.3,.4+j*.08,1.1]}><sphereGeometry args={[1,14,8]}/><meshBasicMaterial color={i%2?'#d1cbe3':'#e6dce8'} transparent opacity={.065}/></mesh>)}</group>)}</group>;
}
function StarField({reduce}) {
  const points=useMemo(()=>new Float32Array(Array.from({length:180},(_,i)=>Math.sin(i*473.3)*(i%3===1?7:18))),[]);
  return <points><bufferGeometry><bufferAttribute attach="attributes-position" args={[points,3]}/></bufferGeometry><pointsMaterial size={.035} color="#efd6b3" transparent opacity={.6} sizeAttenuation/></points>;
}
const models={You:'curious',Jon:'explorer',Ally:'kind'};
const stop=e=>e.stopPropagation();
export const RINGS={input:8.2,theme:5.5,gift:3.2};
export const SX=1.8; // rings are stretched sideways to fill a wide stage
// Invisible floor under the rings: a click on empty space reports where it landed on the map plane.
function Backdrop({onEmpty,hover}) {
  return <mesh rotation={[-Math.PI/2,0,0]} position={[0,-1.2,0]} onPointerOver={()=>hover?.('empty')} onPointerMove={()=>hover?.('empty')} onClick={e=>{if(e.delta>5)return;e.stopPropagation();const p=e.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());if(p)onEmpty?.([p.x,0,p.z]);}}><planeGeometry args={[80,80]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>;
}
function Ring({r,color,glow,label,reduce}) {
  const m=useRef();
  useFrame(({clock})=>{if(m.current)m.current.material.opacity=glow?(reduce?.7:.45+Math.sin(clock.elapsedTime*5)*.25):.22;});
  return <group><mesh ref={m} rotation={[-Math.PI/2,0,0]} scale={[1.8,1,1]} position={[0,-.72,0]}><ringGeometry args={[r-(glow?.07:.03),r+(glow?.07:.03),160]}/><meshBasicMaterial color={glow??color} transparent opacity={.22} depthWrite={false}/></mesh>{label&&<Html position={[r*1.8*Math.cos(.35),-.7,r*Math.sin(.35)]} center zIndexRange={[5,0]}><span className="ring-label">{label}</span></Html>}</group>;
}
// One visual token per node: the face is the content itself; selecting it blooms round actions underneath.
function Token({controller,id,at,type,color,selected,onSelect,face,caption,actions=[],badges,label,editing}) {
  const hover=m=>controller.current?.hover(m);
  return <div className={`tok tok-${type}${selected?' on':''}`} style={{'--c':color}} onPointerDown={stop} onPointerUp={stop} onClick={stop} onPointerEnter={()=>hover('node')} onPointerLeave={()=>hover('empty')}>
    {editing?<div className="tok-face">{face}</div>:<DragLabel controller={controller} id={id} at={at} className="tok-face" onClick={()=>onSelect(id)} aria-label={label} aria-expanded={selected}>{face}</DragLabel>}
    {badges}
    {selected&&caption&&<div className="tok-caption">{caption}</div>}
    {selected&&actions.length>0&&<div className="tok-actions">{actions.map((a,i)=><button key={a.label} style={{'--i':i}} className={'tok-act'+(a.tone?' '+a.tone:'')} aria-pressed={a.on} disabled={a.disabled} onClick={e=>{e.stopPropagation();a.run();}} aria-label={a.label}><span aria-hidden>{a.icon}</span><small>{a.label}</small></button>)}</div>}
  </div>;
}
export function SkyTree({items=[],themes=[],gifts=[],products,art,rank,excluded={},growing,reduce,selectedGift,approved,boxInfo,selectedKey,onSelect,actionsFor,editor,overlays=[],onEmpty,onHover,onToss,onDropBox,onHold,onRelease,canHold,signals={},holds={},pulses={},viewers={},votes={},colors={},why=null,stage=0}) {
  const controller=useRef(null);
  const [dragging,setDragging]=useState(null), [dragAt,setDragAt]=useState(null);
  const onMove=(id,at)=>setDragAt(id?{id,at}:null);
  const place=(key,at)=>dragAt?.id===key?dragAt.at:at;
  const themeAt=Object.fromEntries(themes.map(t=>[t.key,place(t.key,t.at)]));
  const itemAt=Object.fromEntries(items.map(it=>[it.key,place(it.key,it.at)]));
  const giftAt=Object.fromEntries(gifts.map(g=>[g.id,place('gift:'+g.id,g.at)]));
  const glowFor=key=>{const p=pulses[key];if(p)return {color:p.value>0?SUPPORT:PASS,strong:true};const s=signals[key]??0;return s>0?{color:SUPPORT}:s<0?{color:PASS}:null;};
  const lit=key=>why?.has(key);
  const dim=key=>why&&!why.has(key);
  const badges=key=><>{votes[key]?.length>0&&<span className="tok-votes">{votes[key].map(v=><i key={v.name} className={v.value>0?'yes':'pass'} style={{'--who':colors[v.name]}} title={`${v.name} ${v.value>0?'feels like Maya':'passed'}`}>{v.value>0?'♥':'✕'}</i>)}</span>}{(viewers[key]?.length>0||holds[key])&&<span className="tok-viewers">{(viewers[key]??[holds[key]]).map(n=><i key={n} style={{'--who':colors[n]}} title={`${n} is here`}>{n[0]}</i>)}</span>}</>;
  const token=(key,type,at,face,label,color,offset=[0,-1,1])=>{const sel=selectedKey===key,info=sel?actionsFor?.(key):null;return <Html position={offset} center zIndexRange={sel?[90,80]:[30,0]}><div className={dim(key)?'tok-dim':''}><Token controller={controller} id={key} at={at} type={type} color={color} selected={sel} onSelect={onSelect} face={editor?.key===key?editor.node:face} editing={editor?.key===key} caption={info?.caption} actions={info?.actions} badges={badges(key)} label={label}/></div></Html>;};
  const faceFor=it=>it.small?<span className="mini" title={it.text}><img src={`./${it.face}.png`} alt=""/></span>:it.type==='photo'?<span className="polaroid"><img src={it.image} alt=""/>{it.text&&<em>{it.text}</em>}</span>:it.type==='idea'?<span className="idea"><b aria-hidden>💡</b>{it.text}</span>:<span className="bubble"><img src={`./${it.face}.png`} alt=""/><q>{it.text}</q></span>;
  const dir=dragging?.dir;
  return <div className="sky-tree"><Canvas shadows dpr={[1,1.5]} camera={{position:[0,23,8.5],fov:38,near:.1,far:140}} gl={{antialias:true,alpha:true}} onPointerMissed={()=>onEmpty?.(null)}><fog attach="fog" args={['#373653',34,70]}/><ambientLight intensity={.95}/><hemisphereLight args={['#e3dced','#756681',.85]}/><directionalLight position={[-6,16,8]} intensity={2.1} color="#ffdfb4" castShadow shadow-mapSize={[1024,1024]}/><directionalLight position={[8,6,-8]} intensity={1.6} color="#aaa9e3"/>
    <Suspense fallback={null}>
      <DragLayer onMove={onMove} onDragging={setDragging} controller={controller} onToss={onToss} onDropBox={onDropBox} onHold={onHold} onRelease={onRelease} canHold={canHold} onHover={onHover}><Backdrop onEmpty={onEmpty} hover={onHover}/><StarField reduce={reduce}/>
      <Ring r={RINGS.input} color="#d9cfe6" label="everything shared" glow={dir===-1?PASS:null} reduce={reduce}/>
      <Ring r={RINGS.theme} color="#bdb3da" label={themes.length?'themes':null} reduce={reduce}/>
      <Ring r={RINGS.gift} color="#e2b86d" label={gifts.length?'gift ideas':null} glow={dir===1?SUPPORT:null} reduce={reduce}/>
      <Ring r={BOX_RADIUS} color="#e2b86d" glow={dir==='box'?'#ffd98a':null} reduce={reduce}/>
      {items.map(it=>{const at=itemAt[it.key],c=colors[it.author],t=it.theme&&themeAt[it.theme];return <React.Fragment key={it.key}>{t&&<Branch from={at} to={t} reduce={reduce} color={c} warm={lit(it.key)} removed={dim(it.key)}/>}<Island dragId={it.key} at={at} radius={it.small?.45:.75} reduce={reduce} top="#bdb3da" rock="#a395b8" ring={c} glow={glowFor(it.key)} pulse={pulses[it.key]} onClick={()=>onSelect(it.key)} active={selectedKey===it.key||!!holds[it.key]}>{!it.small&&<Spirit avatar={it.model??models[it.author]??'dreamer'} position={[.28,.07,0]} rotation={[0,.25,0]} scale={.7} active={!!pulses[it.key]||!!holds[it.key]} reduce={reduce}/>}{token(it.key,it.small?'mini':it.type,at,faceFor(it),`${it.author}'s ${it.type}`,c,it.small?[0,-.4,.7]:[0,-1,1])}</Island></React.Fragment>;})}
      {themes.map(t=>{const at=themeAt[t.key];return <Island key={t.key} dragId={t.key} at={at} radius={1} reduce={reduce} top="#d3cbec" rock="#a99dcb" glow={glowFor(t.key)} pulse={pulses[t.key]} active={selectedKey===t.key||lit(t.key)||growing} onClick={()=>onSelect(t.key)}><Tree position={[.45,.05,-.3]} scale={.7} shade="#9db58a"/>{token(t.key,'theme',at,<span className="theme-pill"><b>{t.label}</b><small>{t.faces.map((f,i)=><img key={i} src={`./${f}.png`} alt=""/>)}<em>{t.count} shared</em></small></span>,t.label,'#bdb3da',[0,-1.05,1])}</Island>;})}
      {gifts.map((g,i)=>{const key='gift:'+g.id,at=giftAt[g.id],p=products[g.id];return <React.Fragment key={g.id}>{g.themes.map(tk=>themeAt[tk]&&<Branch key={tk} from={themeAt[tk]} to={at} reduce={reduce} color="#e2c48d" removed={!!excluded[g.id]||g.faded||dim(key)} warm={lit(key)}/>)}<Island dragId={key} at={at} radius={.8} delay={i*.12} reduce={reduce} muted={!!excluded[g.id]||g.faded} glow={excluded[g.id]||g.faded?null:glowFor(key)} pulse={pulses[key]} active={selectedGift===g.id||selectedKey===key||!!holds[key]} onClick={()=>onSelect(key)}><GiftProp kind={g.id==='beans'?'mug':g.id} muted={!!excluded[g.id]||g.faded}/>{token(key,'gift',at,<span className={'gift-pic'+(excluded[g.id]||g.faded?' resting':'')}>{art(g.id)}<b>${p.price}</b>{!excluded[g.id]&&!g.faded&&<i>#{rank(g.id)}</i>}<em>{g.title}</em></span>,g.title,'#e2b86d',[0,-.95,1])}</Island></React.Fragment>;})}
      {selectedGift&&giftAt[selectedGift]&&<Branch from={giftAt[selectedGift]} to={[0,0,0]} reduce={reduce} warm/>}
      <Island at={[0,0,0]} radius={1.5} active={!!selectedGift||selectedKey==='box'} reduce={reduce} onClick={()=>onSelect('box')}><Present approved={approved} selected={selectedGift}/><Spirit avatar="curious" position={[-.9,.08,.05]} active={approved} reduce={reduce}/><Tree position={[.8,.08,-.7]} scale={1.1}/>{token('box','box',[0,0,0],<span className="box-chip">🎁 <b>{boxInfo}</b></span>,'Our gift box','#e2b86d',[0,-.9,1.4])}</Island>
      {overlays.map(o=><Html key={o.key} position={o.at} center zIndexRange={[99,95]}><div onPointerDown={stop} onPointerUp={stop} onClick={stop} onPointerEnter={()=>onHover?.('node')}>{o.node}</div></Html>)}
      </DragLayer>
    </Suspense>
  </Canvas><div className="tree-instruction">{dragging?(dir==='box'?'Release to put it in the box':dir===1?'Release: ♥ feels like Maya':dir===-1?'Release: ✕ pass for now':'Toward the box supports · away passes'):stage===0?'Click empty space to add a memory, photo or idea':'Drag toward the box to support · away to pass'}<span>Click a node to act · drop a gift on the box to choose it</span></div></div>;
}

// Reuse the established storybook assets in the isolated interaction film.
export { Spirit, Tree, Present, GiftProp };
