import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, OrbitControls, useAnimations, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const memoriesAt = { pottery: [-5.4, 1.8, -1.2], coffee: [-5.4, -1.2, 2.4], handmade: [-3.1, 3.7, -3.7] };
const giftsAt = { kit: [6, 3, -3.2], mug: [5.7, 1, .1], wheel: [5.8, -1.4, 3.2], class: [1.4, 4.8, -5.8] };
const rootAt = [0, -1.8, 3];
const trunkAt = [0, 1.1, .1];

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
function Island({at,radius=1,children,muted=false,active=false,reduce=false,onClick,delay=0}) {
  const root=useRef(), clock=useRef(0);
  useFrame((_,dt)=>{
    if(!root.current)return;clock.current+=dt;
    const show=Math.max(0,Math.min(1,(clock.current-delay)*2.3));
    const amount=reduce?1:THREE.MathUtils.smoothstep(show,0,1);
    root.current.scale.setScalar(amount);root.current.position.lerp(new THREE.Vector3(...at),1-Math.exp(-dt*4));
    if(!reduce)root.current.position.y+=Math.sin(clock.current*1.2+at[0])*.0015;
  });
  return <group ref={root} position={at} scale={reduce?1:0} onClick={e=>{e.stopPropagation();onClick?.();}} onPointerOver={e=>{e.stopPropagation();if(onClick)document.body.style.cursor='pointer';}} onPointerOut={()=>document.body.style.cursor='auto'}>
    <mesh position={[0,-.35,0]} rotation={[0,.2,0]} castShadow><cylinderGeometry args={[radius*.95,radius*.65,.7,7]}/><meshToonMaterial color={muted?'#777083':'#ad8f8b'}/></mesh>
    <mesh position={[0,-.95,0]} rotation={[0,.2,Math.PI]} castShadow><coneGeometry args={[radius*.67,1,7,2]}/><meshToonMaterial color={muted?'#7c7889':'#8f7992'}/></mesh>
    <mesh position={[0,-.04,0]} receiveShadow castShadow><cylinderGeometry args={[radius,radius*.95,.22,9]}/><meshToonMaterial color={muted?'#8b8a93':active?'#b8c68d':'#8fa471'}/></mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.08,0]} receiveShadow><circleGeometry args={[radius*.7,9]}/><meshToonMaterial color={muted?'#9b98a2':'#c5ba91'}/></mesh>
    <Grass radius={radius} muted={muted}/>
    <Tree position={[-radius*.7,.04,-radius*.4]} scale={radius*.65} shade={muted?'#91909a':'#8ca877'}/>
    {active&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.09,0]}><ringGeometry args={[radius*.94,radius,40]}/><meshBasicMaterial color="#eed3a0" transparent opacity={.85}/></mesh>}
    {children}
  </group>;
}
function Branch({from,to,removed=false,warm=false,reduce=false}) {
  const root=useRef(), progress=useRef(0), particle=useRef();
  const curve=useMemo(()=>new THREE.CatmullRomCurve3([new THREE.Vector3(...from),new THREE.Vector3((from[0]+to[0])*.5, Math.min(from[1],to[1])-.6,(from[2]+to[2])*.5),new THREE.Vector3(...to)]),[...from,...to]);
  const tube=useMemo(()=>new THREE.TubeGeometry(curve,50,warm?.045:.028,6,false),[curve,warm]);
  useEffect(()=>()=>tube.dispose(),[tube]);
  useFrame(({clock},dt)=>{
    progress.current=Math.min(1,progress.current+dt*1.6);tube.setDrawRange(0,Math.floor((reduce?1:progress.current)*50)*36);
    if(particle.current){const t=reduce?1:(clock.elapsedTime*.15)%1;particle.current.position.copy(curve.getPoint(t));}
  });
  return <group ref={root}><mesh geometry={tube}><meshStandardMaterial color={removed?'#77738d':warm?'#ecc58f':'#c7b28c'} emissive={removed?'#000000':warm?'#947246':'#766256'} emissiveIntensity={.35} transparent opacity={removed?.2:.72}/></mesh>{!removed&&!reduce&&<mesh ref={particle}><sphereGeometry args={[.045,8,8]}/><meshBasicMaterial color="#ffe7b5"/></mesh>}</group>;
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
export function SkyTree({expanded,growing,excluded,vibe,selected,approved,focus,reduce,products,memories,onMemory,onProduct,onChoose,onUndo}) {
  const positions={...giftsAt,mug:vibe?[3.8,1.35,.3]:giftsAt.mug};
  const ids=expanded?['kit','mug','wheel',...(excluded.kit?['class']:[])]:[];
  const nodeLabel=(id)=>{const p=products[id];return <Html position={[0,-1.05,1.05]} center zIndexRange={[30,0]}><div onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} className={`island-label gift-label ${excluded[id]?'faded':''} ${focus===id?'picked':''}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const r=e.dataTransfer.getData('constraint');if(r)onProduct(id,r);}}><button draggable={!excluded[id]} onDragStart={e=>e.dataTransfer.setData('gift',id)} onClick={()=>onProduct(id)} aria-label={`Visit ${p.title} island`}><span>{excluded[id]?(excluded[id]==='owned'?'Already owns · branch resting':'Too pricey · branch resting'):p.tag}</span><strong>{p.title}</strong><small>${p.price} sample price {p.price>80?'· over budget':''}</small></button>{excluded[id]?<button className="island-action" onClick={()=>onUndo(id)}>Restore this branch ↺</button>:<button className="island-action" onClick={()=>onChoose(id)}>{selected===id?'In our gift box ✓':'Send to the gift island ↗'}</button>}</div></Html>;};
  return <div className="sky-tree"><Canvas shadows dpr={[1,1.5]} camera={{position:[0,6.2,16],fov:43,near:.1,far:100}} gl={{antialias:true,alpha:true}}><fog attach="fog" args={['#373653',23,55]}/><ambientLight intensity={.9}/><hemisphereLight args={['#e3dced','#756681',.85]}/><directionalLight position={[-5,12,8]} intensity={2.2} color="#ffdfb4" castShadow shadow-mapSize={[1024,1024]}/><directionalLight position={[7,4,-6]} intensity={1.8} color="#aaa9e3"/>
    <Suspense fallback={null}>
      <Clouds reduce={reduce}/><StarField reduce={reduce}/>
      <Branch from={[0,-1.7,2.5]} to={trunkAt} reduce={reduce} warm/>
      {Object.entries(memoriesAt).map(([id,at])=><React.Fragment key={id}><Branch from={trunkAt} to={at} reduce={reduce}/><Island at={at} radius={id==='handmade'?.78:1.1} reduce={reduce} onClick={()=>onMemory(id)} active={growing&&id==='pottery'}><Spirit avatar={id==='pottery'?'explorer':id==='coffee'?'kind':'dreamer'} position={[.25,.07,0]} rotation={[0,.25,0]} active={growing&&id==='pottery'} reduce={reduce}/><Html position={[0,-1.15,1.1]} center zIndexRange={[30,0]}><button className={'island-label memory-label '+(growing&&id==='pottery'?'working':'')} onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onMemory(id);}} aria-label={`Visit ${id} memory island`}><span>{id==='pottery'?'JON’S MEMORY':id==='coffee'?'ALLY’S MEMORY':'YOUR MEMORY'}</span><strong>{memories[id]}</strong><small>{growing&&id==='pottery'?'Scout is growing this branch…':expanded&&id==='pottery'?'Branch explored · tap to edit':'Touch a memory to grow an idea ↗'}</small></button></Html></Island></React.Fragment>)}
      {ids.map((id,i)=><React.Fragment key={id}><Branch from={trunkAt} to={positions[id]} reduce={reduce} removed={!!excluded[id]} warm={vibe&&id==='mug'}/><Island at={positions[id]} radius={id==='class'?.82:.95} delay={i*.12} reduce={reduce} muted={!!excluded[id]} active={selected===id||focus===id} onClick={()=>onProduct(id)}><GiftProp kind={id} muted={!!excluded[id]}/><Spirit avatar={id==='mug'?'kind':id==='class'?'dreamer':'calm'} position={[-.6,.08,0]} scale={.65} reduce={reduce} active={focus===id}/>{nodeLabel(id)}</Island></React.Fragment>)}
      <Island at={rootAt} radius={1.65} active={!!selected} reduce={reduce} onClick={()=>selected&&onProduct(selected)}><Present approved={approved} selected={selected}/><Spirit avatar="curious" position={[-.9,.08,.05]} active={approved} reduce={reduce}/><Tree position={[.8,.08,-.7]} scale={1.3}/><Html position={[0,-.9,1.5]} center zIndexRange={[30,0]}><div onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} className="island-label root-label" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('gift');if(id)onChoose(id);}}><span>{approved?'EVERYONE SAID YES':selected?'OUR GIFT IS TAKING SHAPE':'THE GIFT ISLAND'}</span><strong>{selected?products[selected].title:'A little world, for Maya'}</strong><small>{selected?`$${products[selected].price} of $80 · shipping unknown`:'Let your memories take root.'}</small></div></Html></Island>
      {growing&&<Html position={[.2,2.3,0]} center><div className="tree-status">✦ Following this memory…</div></Html>}

      <OrbitControls enablePan={false} enableZoom minDistance={13} maxDistance={23} minPolarAngle={.85} maxPolarAngle={1.35} minAzimuthAngle={-.3} maxAzimuthAngle={.3} target={[0,.4,0]} enableDamping/>
    </Suspense>
  </Canvas>{vibe&&<div className="tree-vibe tree-vibe-floating">handmade <span>the closest branch leans in</span></div>}<div className="tree-instruction">Touch an island to explore it <span>Drag the sky to look around · scroll to get closer</span></div></div>;
}
