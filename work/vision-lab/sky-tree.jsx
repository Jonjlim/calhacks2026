import React, { Suspense, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, useAnimations, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const memoriesAt = { pottery: [-5.4, 1.8, -1.2], coffee: [-5.4, -1.2, 2.4], handmade: [-3.1, 3.7, -3.7] };
const giftsAt = { kit: [7.2, 3.6, -3.8], mug: [4.9, .7, .6], wheel: [5.8, -1.4, 3.2], class: [1.4, 4.8, -5.8] };
const rootAt = [0, -1.8, 3];
const trunkAt = [0, 1.1, .1];

// A camera-facing plane makes island dragging feel like moving a map card.
const DragContext = createContext(null);
function DragLayer({children, onMove, onDragging, controller, onToss, onHold, onRelease, canHold, onHover}) {
  const {camera, gl} = useThree();
  const controls = useRef(), drag = useRef(null), blockedClick = useRef(null);
  const move = useRef(onMove); move.current = onMove;
  const status = useRef(onDragging); status.current = onDragging;
  const callbacks=useRef({});callbacks.current={onToss,onHold,onRelease,canHold,onHover};
  const intersect = (x,y,plane) => {
    const rect=gl.domElement.getBoundingClientRect();
    const ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1),camera);
    return ray.ray.intersectPlane(plane,new THREE.Vector3());
  };
  const finish = () => {
    const d=drag.current; if(!d)return;
    if(d.moved){
      blockedClick.current={id:d.id,until:performance.now()+400};
      const rect=gl.domElement.getBoundingClientRect(),dx=d.lastX-d.x,dy=d.lastY-d.y;
      const horizontal=Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.25;
      const lane=d.lastX<rect.left+rect.width*.18?-1:d.lastX>rect.right-rect.width*.18?1:0;
      const flick=performance.now()-d.lastTime<120&&Math.abs(d.velocity)>.7?Math.sign(d.velocity):0;
      if(d.id!=='box'&&horizontal&&(lane||flick)){move.current?.(d.id,d.at.toArray());callbacks.current.onToss?.(d.id,lane||flick);}
    }
    callbacks.current.onRelease?.();
    drag.current=null; if(controls.current)controls.current.enabled=true;
    status.current?.(null);if(d.moved)callbacks.current.onHover?.('node');
  };
  useEffect(()=>{
    const pointerMove=e=>{
      const d=drag.current;if(!d||e.pointerId!==d.pointerId)return;
      if(!d.moved&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<6)return;
      if(callbacks.current.canHold&&!callbacks.current.canHold(d.id)){finish();return;}
      const now=performance.now();d.velocity=(e.clientX-d.lastX)/Math.max(1,now-d.lastTime);d.lastX=e.clientX;d.lastY=e.clientY;d.lastTime=now;
      if(!d.moved)callbacks.current.onHover?.('drag');d.moved=true;e.preventDefault();status.current?.(d.id);
      const point=intersect(e.clientX,e.clientY,d.plane);if(!point)return;
      const next=d.at.clone().add(point.sub(d.hit));
      next.x=THREE.MathUtils.clamp(next.x,-9,9);next.y=THREE.MathUtils.clamp(next.y,-3,6);next.z=THREE.MathUtils.clamp(next.z,-7,5);
      move.current?.(d.id,next.toArray());
    };
    const pointerUp=e=>{if(drag.current?.pointerId===e.pointerId)finish();};
    window.addEventListener('pointermove',pointerMove,{passive:false});
    window.addEventListener('pointerup',pointerUp,true);window.addEventListener('pointercancel',pointerUp,true);window.addEventListener('blur',finish);
    return()=>{window.removeEventListener('pointermove',pointerMove);window.removeEventListener('pointerup',pointerUp,true);window.removeEventListener('pointercancel',pointerUp,true);window.removeEventListener('blur',finish);finish();};
  },[camera,gl]);
  const api={
    begin(id,at,event){
      const e=event.nativeEvent??event;if(e.button!==0)return;
      event.stopPropagation();event.preventDefault?.();
      if(callbacks.current.onHold?.(id)===false)return;
      const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()),new THREE.Vector3(...at));
      const hit=intersect(e.clientX,e.clientY,plane);if(!hit)return;
      drag.current={id,at:new THREE.Vector3(...at),plane,hit,x:e.clientX,y:e.clientY,pointerId:e.pointerId,moved:false,lastX:e.clientX,lastY:e.clientY,lastTime:performance.now(),velocity:0};
      if(controls.current)controls.current.enabled=false;
    },
    hover(mode){callbacks.current.onHover?.(drag.current?.moved?'drag':mode);},
    activate(id,fn){if(blockedClick.current?.id===id&&performance.now()<blockedClick.current.until)return;fn?.();},
  };
  controller.current=api;
  return <DragContext.Provider value={api}>{children}<OrbitControls ref={controls} enablePan={false} enableZoom minDistance={13} maxDistance={23} minPolarAngle={.85} maxPolarAngle={1.35} minAzimuthAngle={-.3} maxAzimuthAngle={.3} target={[0,-.35,0]} enableDamping/></DragContext.Provider>;
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
// Invisible backdrop far behind the islands: a click on empty sky reports a point on the mid-depth plane.
function Backdrop({onEmpty,hover}) {
  const ref=useRef();const {camera}=useThree();
  useEffect(()=>{ref.current?.lookAt(camera.position);},[camera]);
  return <mesh ref={ref} position={[0,.4,-9]} onPointerOver={()=>hover?.('empty')} onPointerMove={()=>hover?.('empty')} onClick={e=>{if(e.delta>5)return;e.stopPropagation();const n=camera.getWorldDirection(new THREE.Vector3());const p=e.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n,new THREE.Vector3(0,.6,0)),new THREE.Vector3());if(!p)return;onEmpty?.([THREE.MathUtils.clamp(p.x,-8.5,8.5),THREE.MathUtils.clamp(p.y,-2.5,5.5),THREE.MathUtils.clamp(p.z,-6,4.5)]);}}><planeGeometry args={[120,70]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>;
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
export function SkyTree({items=[],gifts=[],products,art,rank,excluded={},vibe,growing,reduce,layout={},selectedGift,approved,boxInfo,selectedKey,onSelect,actionsFor,editor,composer,onEmpty,onHover,onMove,onResetLayout,onToss,onHold,onRelease,canHold,signals={},holds={},pulses={},viewers={},votes={},colors={}}) {
  const controller=useRef(null);
  const [dragging,setDragging]=useState(null);
  const boxAt=layout.box??rootAt;
  const itemAt=Object.fromEntries(items.map(it=>[it.key,layout[it.key]??it.at]));
  const giftAt=Object.fromEntries(gifts.map(id=>{const at=id==='mug'&&vibe?[3.8,1.35,.3]:giftsAt[id];return [id,layout['gift:'+id]??[at[0],at[1]+.28*(signals['gift:'+id]??0)+.13*(signals['memory:'+products[id].memory]??0),at[2]]];}));
  const sources=id=>['memory:'+products[id].memory,...(id==='mug'?['memory:pottery']:[])].filter(k=>itemAt[k]);
  const glowFor=key=>{const p=pulses[key];if(p)return {color:p.value>0?SUPPORT:PASS,strong:true};const s=signals[key]??0;return s>0?{color:SUPPORT}:s<0?{color:PASS}:null;};
  const lit=(src,id)=>selectedKey==='gift:'+id||selectedKey===src;
  const badges=key=><>{votes[key]?.length>0&&<span className="tok-votes">{votes[key].map(v=><i key={v.name} className={v.value>0?'yes':'pass'} style={{'--who':colors[v.name]}} title={`${v.name} ${v.value>0?'feels like Maya':'passed'}`}>{v.value>0?'♥':'✕'}</i>)}</span>}{(viewers[key]?.length>0||holds[key])&&<span className="tok-viewers">{(viewers[key]??[holds[key]]).map(n=><i key={n} style={{'--who':colors[n]}} title={`${n} is here`}>{n[0]}</i>)}</span>}</>;
  const token=(key,type,at,face,label,color)=>{const sel=selectedKey===key,info=sel?actionsFor?.(key):null;return <Html position={type==='gift'?[0,-.95,1]:[0,-1.05,1]} center zIndexRange={sel?[90,80]:[30,0]}><Token controller={controller} id={key} at={at} type={type} color={color} selected={sel} onSelect={onSelect} face={editor?.key===key?editor.node:face} editing={editor?.key===key} caption={info?.caption} actions={info?.actions} badges={badges(key)} label={label}/></Html>;};
  const faceFor=it=>it.type==='photo'?<span className="polaroid"><img src={it.image} alt=""/>{it.text&&<em>{it.text}</em>}</span>:it.type==='idea'?<span className="idea"><b aria-hidden>💡</b>{it.text}</span>:<span className="bubble"><img src={`./${it.face}.png`} alt=""/><q>{it.text}</q></span>;
  return <div className="sky-tree"><Canvas shadows dpr={[1,1.5]} camera={{position:[0,5.6,16.6],fov:44,near:.1,far:100}} gl={{antialias:true,alpha:true}} onPointerMissed={()=>onEmpty?.(null)}><fog attach="fog" args={['#373653',23,55]}/><ambientLight intensity={.9}/><hemisphereLight args={['#e3dced','#756681',.85]}/><directionalLight position={[-5,12,8]} intensity={2.2} color="#ffdfb4" castShadow shadow-mapSize={[1024,1024]}/><directionalLight position={[7,4,-6]} intensity={1.8} color="#aaa9e3"/>
    <Suspense fallback={null}>
      <DragLayer onMove={onMove} onDragging={setDragging} controller={controller} onToss={onToss} onHold={onHold} onRelease={onRelease} canHold={canHold} onHover={onHover}><Backdrop onEmpty={onEmpty} hover={onHover}/><Clouds reduce={reduce}/><StarField reduce={reduce}/>
      <Branch from={boxAt} to={trunkAt} reduce={reduce} warm/>
      {selectedGift&&giftAt[selectedGift]&&<Branch from={giftAt[selectedGift]} to={boxAt} reduce={reduce} warm/>}
      {items.map(it=>{const at=itemAt[it.key],c=colors[it.author];return <React.Fragment key={it.key}><Branch from={trunkAt} to={at} reduce={reduce} color={c}/><Island dragId={it.key} at={at} radius={it.radius??.8} reduce={reduce} top="#bdb3da" rock="#a395b8" ring={c} glow={glowFor(it.key)} pulse={pulses[it.key]} onClick={()=>onSelect(it.key)} active={selectedKey===it.key||!!holds[it.key]||growing&&it.key==='memory:pottery'}><Spirit avatar={it.model??models[it.author]??'dreamer'} position={[.3,.07,0]} rotation={[0,.25,0]} scale={it.radius>1?1:.75} active={!!pulses[it.key]||!!holds[it.key]||growing&&it.key==='memory:pottery'} reduce={reduce}/>{token(it.key,it.type,at,faceFor(it),`${it.author}'s ${it.type}`,c)}</Island></React.Fragment>;})}
      {gifts.map((id,i)=>{const key='gift:'+id,at=giftAt[id],p=products[id];return <React.Fragment key={id}>{sources(id).map(src=><Branch key={src} from={itemAt[src]} to={at} reduce={reduce} removed={!!excluded[id]} color={colors[items.find(it=>it.key===src)?.author]} warm={vibe&&id==='mug'||lit(src,id)}/>)}<Island dragId={key} at={at} radius={id==='class'?.75:.85} delay={i*.12} reduce={reduce} muted={!!excluded[id]} glow={excluded[id]?null:glowFor(key)} pulse={pulses[key]} active={selectedGift===id||selectedKey===key||!!holds[key]} onClick={()=>onSelect(key)}><GiftProp kind={id} muted={!!excluded[id]}/>{token(key,'gift',at,<span className={'gift-pic'+(excluded[id]?' resting':'')}>{art(id)}<b>${p.price}</b>{!excluded[id]&&<i>#{rank(id)}</i>}<em>{p.title}</em></span>,p.title,'#e2b86d')}</Island></React.Fragment>;})}
      <Island dragId="box" at={boxAt} radius={1.5} active={!!selectedGift||selectedKey==='box'} reduce={reduce} onClick={()=>onSelect('box')}><Present approved={approved} selected={selectedGift}/><Spirit avatar="curious" position={[-.9,.08,.05]} active={approved} reduce={reduce}/><Tree position={[.8,.08,-.7]} scale={1.2}/>{token('box','box',boxAt,<span className="box-chip">🎁 <b>{boxInfo}</b></span>,'Our gift box','#e2b86d')}</Island>
      {composer&&<Html position={composer.at} center zIndexRange={[99,95]}><div onPointerDown={stop} onPointerUp={stop} onClick={stop} onPointerEnter={()=>onHover?.('node')}>{composer.node}</div></Html>}
      {growing&&<Html position={[.2,2.3,0]} center><div className="tree-status">✦ Following this memory…</div></Html>}
      </DragLayer>
    </Suspense>
  </Canvas>{dragging&&dragging!=="box"&&<div className="toss-zones" aria-hidden="true"><span>← Pass for me<small>release here</small></span><span>Feels like Maya →<small>release here</small></span></div>}<div className="tree-instruction">{dragging?'Release left to pass · right to support':'Click empty sky to add · click a node to act'}<span>Drag to arrange · toss left or right to vote</span></div>{onResetLayout&&<button className="tree-reset-layout" onClick={onResetLayout}>Reset layout ↺</button>}</div>;
}
