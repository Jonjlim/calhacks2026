import React,{Suspense,useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AnimatePresence,MotionConfig,motion,useReducedMotion} from 'motion/react';
import {Canvas,useFrame,useThree} from '@react-three/fiber';
import {Html,OrbitControls} from '@react-three/drei';
import * as THREE from 'three';
import {FloatingIsland,IslandMesh} from '../../components/world/FloatingIsland';
import {IslandEnvironment} from '../../components/world/IslandEnvironment';
import {ScenePaletteContext} from '../../components/world/scenePalette';
import {paletteFor} from '../../components/world/timeOfDay';
import {GIFT_SPOT} from '../../components/world/sceneConfig';
import {platformTop} from '../../components/world/props/Stonework';
import {MapIcon} from '../../components/world/room/MapIcon';
import {formatMinor,parseMajorToMinor} from '../../lib/money';
import {Spirit,Tree,Present,GiftProp} from './sky-tree';
import {recordFilm} from './tutorial-recorder';

const END=54,KEY='unwrap:tutorial-study:v1';
const SEED='She loves pottery and making things with her hands.';
const CLASS={id:'class',title:'An afternoon with clay',price:6500,kind:'class'};
const KIT={id:'kit',title:'A little pottery kit',price:4800,kind:'kit'};
const TIMES=[0,4,12,18,25,31,36,41,49];
const CHAPTERS=['Meet Moss','Your memory','Connections','Discovery','Your say','Why this?','The present','Everyone agrees','The reveal'];
const AT={memory:[-8.2,0,-.8],friend:[-8.4,0,3.5],theme:[-4.7,0,-3.4],class:[6.3,0,-2],kit:[9.6,0,2.1],box:[0,0,0]};
const MOSS=[[-5.5,0,4.9],[-1.7,0,6.5],[-2.6,0,-4.7],[-2.6,0,-4.7],[7.6,0,5.1],[3.5,0,-5.4],[5,0,-5.4],[-8.3,0,5.2],[-5.8,0,3.8]];
const SAY=[
 ['A little help. A gift that is yours.','I’m Moss. Let’s start with one thing you know about Maya.'],
 ['One memory is enough to begin.','What does she love? Your words become part of this gift.'],
 ['That gives us a direction.','Your memory joins Jon’s. Watch a shared theme grow between them.'],
 ['Let’s follow that thread.','We’ll look for gifts from these memories. You can keep adding while we explore.'],
 ['You know her better than we do.','Support an idea, pass for now, or tell us she already owns it.'],
 ['Every suggestion has a story.','Follow these threads: pottery, making things, and a kit she already owns.'],
 ['Found your favorite?','Bring it to the present. Choosing a gift doesn’t buy it.'],
 ['A small yes, from each of you.','Approve your own amount. Nobody else can give your yes.'],
 ['Look what you made together.','Your memory, your choice, everyone’s agreement. That’s a gift with a story.'],
];
function load(){try{return JSON.parse(localStorage.getItem(KEY))??{};}catch{return {};}}
function I({name,size=15}){return <MapIcon name={name} size={size}/>;}
const SHOTS=[
 {look:[-1,1,1],offset:[0,18,26],zoom:1.08},
 {look:[-4.5,1.1,2],offset:[-5,16,25],zoom:1.25},
 {look:[-3.9,1,-1.1],offset:[-11,22,26],zoom:1.08},
 {look:[-.6,1,-1],offset:[-6,18,26],zoom:1.02},
 {look:[6.5,1,1.5],offset:[9,16,26],zoom:1.22},
 {look:[.1,1,-1],offset:[0,29,25],zoom:.96},
 {look:[2,1,0],offset:[6,18,25],zoom:1.1},
 {look:[-1.2,1,2.4],offset:[0,26,28],zoom:1.05},
 {look:[-1,1,1],offset:[-6,18,26],zoom:1.15},
];
function Fit({stage,reduce}){const {camera,size}=useThree(),target=useRef(new THREE.Vector3(-1,1,1)),init=useRef(false);useFrame((_,dt)=>{const shot=SHOTS[stage],aim=new THREE.Vector3(...shot.look),position=new THREE.Vector3(...shot.offset).add(aim),k=reduce||!init.current?1:1-Math.exp(-Math.min(dt,.08)*8);camera.position.lerp(position,k);target.current.lerp(aim,k);camera.lookAt(target.current);camera.zoom=THREE.MathUtils.lerp(camera.zoom,Math.min(size.width/30,size.height/18.5)*shot.zoom,k);camera.updateProjectionMatrix();init.current=true;});return null;}
function Thread({a,b,lit=false,reduce}){const dot=useRef();const curve=useMemo(()=>new THREE.CatmullRomCurve3([new THREE.Vector3(...a),new THREE.Vector3((a[0]+b[0])/2,-.3,(a[2]+b[2])/2),new THREE.Vector3(...b)]),[...a,...b]);const geometry=useMemo(()=>new THREE.TubeGeometry(curve,40,lit?.035:.018,6,false),[curve,lit]);useEffect(()=>()=>geometry.dispose(),[geometry]);useFrame(({clock})=>{dot.current?.position.copy(curve.getPoint((clock.elapsedTime*.21)%1));});return <group><mesh geometry={geometry}><meshBasicMaterial color={lit?'#f3d28f':'#d8c9d9'} transparent opacity={lit?.85:.25}/></mesh>{lit&&!reduce&&<mesh ref={dot}><sphereGeometry args={[.075,8,8]}/><meshBasicMaterial color="#fff1ce"/></mesh>}</group>;}
const SHAPE={seed:61,radius:.75,stretch:1.1,depth:1.1,hilliness:.08};
const PAL={grassLow:'#6f8c62',grassHigh:'#a3bd85',grassSun:'#d4d7a5',rim:'#7e9472',path:'#d4c7a5',strata:[[0,'#779361'],[.25,'#b9a1b2'],[.65,'#9786a5'],[1,'#645d83']]};
function Islet({at,show=true,children,reduce,rest=false}){const ref=useRef(),initial=useRef(at);useFrame((_,dt)=>{if(!ref.current)return;const k=reduce?1:1-Math.exp(-dt*7);ref.current.position.lerp(new THREE.Vector3(...at),k);ref.current.scale.lerp(new THREE.Vector3().setScalar(show?(rest?.75:1):.001),k);});return <group ref={ref} position={initial.current} scale={show?1:.001}><IslandMesh shape={SHAPE} palette={PAL} detail={{segments:18,rings:6}} shadows={false}/>{show&&children}</group>;}
function Spin({reduce}){const ref=useRef();useFrame((_,dt)=>{if(ref.current&&!reduce)ref.current.rotation.z-=dt;});return <mesh ref={ref} rotation={[-Math.PI/2,0,0]} position={[0,.18,0]}><ringGeometry args={[.92,.98,48,1,0,Math.PI*1.6]}/><meshBasicMaterial color="#f2cf89" side={THREE.DoubleSide}/></mesh>;}
function Bubble({children,selected=false,quiet=false}){return <div className={`thought ${selected?'focused':''} ${quiet?'subdued':''}`} onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>{children}</div>;}
function Coach({at,stage,visible,reduce,onNext,approved}){const ref=useRef(),initial=useRef(at);useFrame((_,dt)=>{if(ref.current)ref.current.position.lerp(new THREE.Vector3(...at),reduce?1:1-Math.exp(-dt*4.5));});return <group ref={ref} position={initial.current}><Spirit avatar="calm" scale={.8} active={stage===0||stage===8} reduce={reduce}/>{visible&&<Html position={[0,3.9,0]} center zIndexRange={[90,80]}><motion.div key={stage} className="moss-coach" initial={{opacity:0,y:reduce?0:8}} animate={{opacity:1,y:0}} transition={{duration:.3}} onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}><span><i/> MOSS <small>{stage+1} / 9</small></span><strong>{SAY[stage][0]}</strong><p>{stage===7&&approved?'Your approval is in. Jon and Ally still approve their own shares.':SAY[stage][1]}</p>{stage===0&&<button onClick={onNext}>Let’s make a gift <I name="sprout"/></button>}</motion.div></Html>}</group>;}
function AnimatedPresent({reveal,shares,yes,reduce}){const present=useRef();useFrame(({clock},dt)=>{if(!present.current)return;const target=reveal?1.4:1.3;present.current.scale.lerp(new THREE.Vector3().setScalar(target),reduce?1:1-Math.exp(-dt*5));present.current.position.y=platformTop()+.1+(reveal&&!reduce?Math.sin(clock.elapsedTime*2)*.14:0);});return <group ref={present} position={[GIFT_SPOT.x,platformTop()+.1,GIFT_SPOT.z]} scale={1.3}><Present selected={shares} approved={yes===3}/></group>;}
function World({v,act,reduce}){
 const {stage,t,memory,gift,yes,owned,selected,guide,custom}=v;
 const hasMemory=stage>=2||!!memory, hasGifts=stage>=4||stage===3&&t>=22, shares=stage>=7,reveal=stage===8;
 const classAt=stage>=6?[4.4,0,1.8]:AT.class,kitAt=owned?[11,0,2.8]:AT.kit;

 return <Canvas orthographic dpr={[1,1.4]} camera={{position:[0,20,25],zoom:35,near:.1,far:200}} gl={{antialias:true,preserveDrawingBuffer:true}} aria-label="Moss tutorial island map"><Fit stage={stage} reduce={reduce}/><ambientLight intensity={1.4}/><directionalLight position={[-6,14,8]} intensity={2.4} color="#ffe7ca"/><hemisphereLight args={['#ece4f5','#586178',1]}/><ScenePaletteContext.Provider value={paletteFor('day')}>
 <group position={[0,-.4,0]} scale={.43}><FloatingIsland/><IslandEnvironment quality="low" animate={!reduce} showPlayers={false}/><AnimatedPresent reveal={reveal} shares={shares} yes={yes} reduce={reduce}/></group>
 {[4.3,7,10.8].map(r=><mesh key={r} rotation={[-Math.PI/2,0,0]} scale={[1.15,1,1]} position={[0,-1.3,0]}><ringGeometry args={[r-.014,r+.014,90]}/><meshBasicMaterial color="#d9d0e3" transparent opacity={.17}/></mesh>)}
 {hasMemory&&<><Thread a={AT.memory} b={AT.theme} lit={stage===2||stage===5} reduce={reduce}/><Thread a={AT.friend} b={AT.theme} lit={stage===5} reduce={reduce}/></>}
 {hasGifts&&<><Thread a={AT.theme} b={classAt} lit={stage===5||selected==='class'} reduce={reduce}/><Thread a={AT.theme} b={kitAt} reduce={reduce}/></>}
 {stage>=6&&<Thread a={classAt} b={AT.box} lit reduce={reduce}/>}
 <Suspense fallback={<Html center><span className="loading-world">Your little world is arriving…</span></Html>}>
 <Islet at={AT.memory} show={stage>=1} reduce={reduce}><Spirit avatar="curious" scale={.65} reduce={reduce}/><Html position={[0,-.4,1.2]} center zIndexRange={[45,35]}><Bubble quiet={shares}><button className={`memory-token ${stage===1?'target-pulse':''}`} onClick={()=>act('memory')} aria-label="Add or edit your memory"><img src="./curious.png" alt=""/>{hasMemory?'Your memory':'Add a memory'}<I name="cloud"/></button>{hasMemory&&(stage===2||stage===5)&&<p className="memory-quote">“{memory||SEED}”</p>}{v.composer&&<form className="memory-form" onSubmit={e=>{e.preventDefault();act('saveMemory',new FormData(e.currentTarget).get('memory'));}}><label>A little thing about Maya<textarea name="memory" aria-label="Your memory for Maya" maxLength={180} required defaultValue={memory} placeholder="She loves pottery…" autoFocus/></label><button>Keep this memory <I name="check"/></button><small>Saved in this prototype, not your live room.</small></form>}{stage===1&&!v.composer&&t>=5&&<div className="typed-memory">{(memory||SEED).slice(0,memory?undefined:Math.max(0,Math.floor((t-5)*13)))}<i/></div>}</Bubble></Html></Islet>
 <Islet at={AT.friend} show={hasMemory} reduce={reduce}><Spirit avatar="explorer" scale={.65} reduce={reduce}/><Html position={[0,-.4,1.2]} center zIndexRange={[35,25]}><Bubble quiet={shares}><span className="tiny-title"><img src="./explorer.png" alt=""/>Jon’s memory <small>sample</small></span>{(stage===2||stage===5)&&<p className="memory-quote">“She already owns a pottery kit.”</p>}</Bubble></Html></Islet>
 <Islet at={AT.theme} show={stage>=2} reduce={reduce}><Tree scale={.7} shade="#9fb481"/>{stage===3&&<Spin reduce={reduce}/>}<Html position={[0,-.4,1.3]} center zIndexRange={[40,30]}><Bubble quiet={shares}><span className="theme-title"><I name="gather"/> Making things</span>{stage===2&&<><small className="node-meta">Two memories, one direction</small><button className="small-primary" onClick={()=>act('research')}>Explore gifts <I name="sprout"/></button></>}{stage===3&&<span className="research-status"><i/>Scout is exploring<small>Simulated research · no source call</small></span>}</Bubble></Html></Islet>
 {[['class',classAt,custom||CLASS],['kit',kitAt,KIT]].map(([id,at,item])=><Islet key={id} at={at} show={hasGifts} rest={id==='kit'&&owned} reduce={reduce}><GiftProp kind={item.kind} muted={id==='kit'&&owned}/><Html position={[0,-.4,1.35]} center zIndexRange={selected===id?[65,55]:[45,35]}><Bubble selected={selected===id} quiet={shares||stage===4&&selected&&id!==selected}><button className={`gift-token ${stage===6&&id==='class'?'target-pulse':''}`} draggable={stage>=4&&id==='class'} onDragStart={e=>{e.dataTransfer.setData('text/plain','gift');act('drag');}} onClick={()=>act('inspect',id)} aria-label={`Inspect ${item.title}`}><I name={id==='class'?'sprout':'present'}/><b>{item.title}</b><small>{formatMinor(item.price)} · sample</small>{id==='kit'&&owned&&<em><I name="home"/> Already owns</em>}</button>{selected===id&&!shares&&<div className="attached-controls"><button className={v.support?'on':''} onClick={()=>act('support')}><I name="heart"/>Support</button><button onClick={()=>act('pass',id)}><I name="drift"/>Pass</button><button onClick={()=>act('why')}><I name="thread"/>Why?</button>{id==='kit'&&<button onClick={()=>act('owned')}>{owned?'Undo ownership':'She already owns it'}</button>}{id==='class'&&<button className="choose-action" onClick={()=>act('choose')}>Put in the present <I name="present"/></button>}</div>}{stage===5&&id==='class'&&<p className="why-note">A new way to make pottery, without another kit.<small>{memory?'Your memory is kept in the gift story.':'Linked to the room’s two memories.'}</small></p>}</Bubble></Html></Islet>)}
 <Html position={[.1,1.5,2.4]} center zIndexRange={[55,45]}><div className={`present-target ${stage===6?'ready':''}`} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';}} onDrop={e=>{e.preventDefault();if(e.dataTransfer.getData('text/plain')==='gift')act('choose');}}><button onClick={()=>act(stage>=6?'shares':'present')} aria-label="Our present"><I name="present"/>{stage>=6?gift.title:'Our present'}</button>{stage===6&&<><small>Your choice · not purchased</small><button className="small-primary" onClick={()=>act('shares')}>Review our split <I name="coins"/></button></>}</div></Html>
 {shares&&<>
  {[0,1,2].map(i=><mesh key={i} position={[.1,.1,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[3,3.07,48,1,i*Math.PI*2/3+.03,Math.PI*2/3-.06]}/><meshBasicMaterial color={i<yes?'#c1d49d':'#b4a3c6'} transparent opacity={i<yes?.9:.35}/></mesh>)}
  {[[-3,.7,4],[3,.7,4],[0,.6,7]].map((at,i)=><React.Fragment key={i}><Thread a={[0,0,0]} b={at} lit={i<yes} reduce={reduce}/><Html position={at} center zIndexRange={[75,65]}><motion.div className={`split-petal ${i<yes?'yes':''}`} initial={{opacity:0,y:reduce?0:-12,scale:reduce?1:.85}} animate={{opacity:1,y:0,scale:1}} transition={{delay:i*.12}}><span><img src={`./${['curious','explorer','kind'][i]}.png`} alt=""/>{['You','Jon','Ally'][i]}</span><b>{formatMinor(Math.floor(gift.price/3)+(i<gift.price%3?1:0))}</b>{i===0?<button onClick={()=>act('approve')} aria-pressed={v.myApproval}>{v.myApproval?'Approved':'Approve my share'}{v.myApproval&&<I name="check" size={11}/>}</button>:<small>{i<yes?'Approved':'Awaiting their yes'} · sample</small>}</motion.div></Html></React.Fragment>)}
  <Html position={[0,3.3,-1]} center zIndexRange={[70,60]}><div className="approval-heading"><span>{yes}/3 shared yeses</span><small>Sample split · tax & shipping unknown<br/>No money moves.</small>{yes===3&&!reveal&&<button onClick={()=>act('reveal')}>Wrap our gift <I name="spark"/></button>}</div></Html>
 </>}
 <Coach at={MOSS[stage]} stage={stage} visible={guide} reduce={reduce} onNext={()=>act('start')} approved={v.myApproval}/>
 </Suspense></ScenePaletteContext.Provider></Canvas>;
}
function Tutorial(){
 const osReduce=useReducedMotion();const [reduce,setReduce]=useState(false),[t,setT]=useState(0),[playing,setPlaying]=useState(false),[step,setStep]=useState(null),[draft,setDraft]=useState(load),[composer,setComposer]=useState(false),[selected,setSelected]=useState(null),[myApproval,setMyApproval]=useState(false),[otherYes,setOtherYes]=useState(false),[guide,setGuide]=useState(true),[idea,setIdea]=useState(false),[notice,setNotice]=useState(''),[searching,setSearching]=useState(false),[recordState,setRecordState]=useState(''),[videoUrl,setVideoUrl]=useState(null);
 const timer=useRef(),reduced=reduce||!!osReduce;
 const scripted=step===null, stage=step??Math.max(0,TIMES.findLastIndex(x=>t>=x));
 const memory=scripted?'':draft.memory||'',gift=scripted?CLASS:draft.gift||CLASS;
 const yes=scripted?(t>=47?3:t>=45?2:t>=43?1:0):myApproval?(otherYes?3:1):0;
 const owned=scripted?t>=28:!!draft.owned;
 const view={stage,t,memory,gift,yes,owned,selected:scripted?(stage===4?'kit':stage===5||stage===6?'class':null):selected,guide,composer,custom:scripted?null:draft.gift,myApproval:scripted?t>=43:myApproval,support:scripted?t>=33:!!draft.support};
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(draft));}catch{}},[draft]);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 useEffect(()=>{if(!playing)return;let id,last=performance.now(),acc=0;const tick=now=>{acc+=Math.min((now-last)/1000,.15);last=now;if(acc>.05){const d=acc;acc=0;setT(old=>{const next=Math.min(END,old+d);if(next===END)setPlaying(false);return next;});}id=requestAnimationFrame(tick);};id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);},[playing]);
 function seek(n){clearTimeout(timer.current);setSearching(false);setPlaying(false);setStep(null);setComposer(false);setIdea(false);setNotice('');setT(n);}
 function act(type,value){setPlaying(false);setNotice('');if(scripted)setStep(stage);if(type==='start'){setStep(1);setComposer(true);}if(type==='memory'){setStep(Math.max(1,stage));setComposer(c=>!c);}
 if(type==='saveMemory'){const text=String(value).trim();if(!text)return;setDraft(d=>({...d,memory:text}));setComposer(false);setStep(2);setNotice('Your memory is saved locally and stays in the final gift story.');}
 if(type==='research'){setStep(3);setSearching(true);clearTimeout(timer.current);timer.current=setTimeout(()=>{setStep(4);setSearching(false);setSelected('class');},reduced?100:2100);}
 if(type==='inspect'){setSelected(selected===value?null:value);if(stage<4)setStep(4);}
 if(type==='support'){setDraft(d=>({...d,support:!d.support}));setNotice('A preference signal. Your memory and approval are unchanged.');}
 if(type==='pass'){setDraft(d=>({...d,passed:value}));setNotice('Passed for now. The idea stays on the map.');}
 if(type==='owned'){setDraft(d=>({...d,owned:!owned}));setNotice(owned?'Ownership confirmation undone.':'You confirmed ownership. This is separate from a pass.');}
 if(type==='why'){setStep(5);setSelected('class');}
 if(type==='choose'){setStep(6);setSelected(null);setMyApproval(false);setOtherYes(false);setNotice('Your chosen gift is in the present. Nobody has been charged.');}
 if(type==='shares'){setStep(7);setComposer(false);setMyApproval(false);setOtherYes(false);}
 if(type==='present'){setNotice('This is where your chosen gift and the group’s approvals come together.');}
 if(type==='approve'){setMyApproval(v=>!v);setOtherYes(false);}
 if(type==='reveal'){setStep(8);setGuide(true);}
 if(type==='drag'){setNotice('Drop onto the present, or use “Put in the present”.');}
 }
 const note=notice||(stage===3?'Illustrative research, tied to the theme being explored.':stage>=7?'Each person approves their own amount. Changes require fresh approvals.':stage===5?'The thread is the explanation. Your memory stays connected.':memory?'Your memory is part of this gift. Guidance can disappear; your contribution stays.':'Your first memory becomes part of the gift, not a throwaway tutorial task.');
 return <MotionConfig reducedMotion={reduced?'always':'user'}><div className="tutorial-study"><div className="review-label"><span>UNWRAP / PLAYABLE ONBOARDING</span><span>Prototype · local inputs · simulated research & friends · Moss uses a stand-in</span><a href="./quiet.html">Quiet map study</a></div>
 <main className="tutorial-app"><header><div className="identity"><b>unwrap.</b><i/><span>Maya’s gift<small>Built from the little things you know</small></span></div><nav aria-label="Gift progress">{['Remember','Discover','Choose','Agree'].map((x,i)=><span key={x} className={Math.min(3,Math.floor(stage/2))===i?'current':''}>{x}</span>)}</nav><div className="header-actions"><span className="avatars"><img src="./curious.png" alt="You"/><img src="./explorer.png" alt="Jon, sample participant"/><img src="./kind.png" alt="Ally, sample participant"/></span><button onClick={()=>{setGuide(g=>!g);if(guide){setPlaying(false);setStep(Math.max(stage,memory?2:1));}setNotice('Only the guidance changed. Your memory and gift are kept.');}}>{guide?'Skip guidance':'Ask Moss'}</button></div></header>
 <div className={`tutorial-stage ${stage>=7?'split-stage':''}`}><World v={view} act={act} reduce={reduced}/><div className="stage-kicker"><span>{stage<7?'ONE GIFT, MADE TOGETHER':stage===7?'A YES FROM EVERYONE':'A GIFT WITH A STORY'}</span><small>{stage<7?'Your inputs become the final gift.':stage===7?'Pledges, not payments.':'Selected together. Not purchased.'}</small></div>
 {stage>=2&&stage<7&&<button className="add-idea" onClick={()=>{setIdea(!idea);setPlaying(false);setStep(stage);}}>Add your gift idea <I name="present"/></button>}
 <AnimatePresence>{idea&&<motion.form className="idea-editor" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0}} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),title=String(f.get('title')).trim(),price=parseMajorToMinor(String(f.get('price')));if(!title||price===null||price<=0)return;setDraft(d=>({...d,gift:{...CLASS,title,price}}));setIdea(false);setStep(6);setMyApproval(false);setOtherYes(false);setNotice('Your gift idea is in the present. Price is entered by you, not source-verified.');}}><label>Your gift idea<input name="title" aria-label="Your gift idea" maxLength={70} required placeholder="A ceramics night together"/></label><label>Your estimated item price ($)<input name="price" aria-label="Your estimated gift price" inputMode="decimal" required pattern="[0-9]+(\.[0-9]{1,2})?" placeholder="60"/></label><small>An idea, not a verified listing. Shipping & tax unknown.</small><div><button type="button" onClick={()=>setIdea(false)}>Cancel</button><button>Put in the present <I name="present"/></button></div></motion.form>}</AnimatePresence>
 <AnimatePresence>{stage===8&&<motion.div className="final-story" initial={{opacity:0,y:reduced?0:18,scale:reduced?1:.94}} animate={{opacity:1,y:0,scale:1}} transition={{duration:.65}}><span><I name="spark"/> OUR GIFT · PROTOTYPE</span><h1>{gift.title}</h1><strong>{formatMinor(gift.price)} <small>{!scripted&&draft.gift?'your estimate':'sample price'} · item only</small></strong><p className="story-memory">“{memory||SEED}”</p><small>Your memory stayed with the gift, from the first step.</small><div><I name="check"/>Everyone’s sample approval is in.</div><footer>Not purchased. No money charged.</footer><button onClick={()=>{setStep(7);setGuide(false);setNotice('The guidance is gone. Your memory, chosen gift and approvals remain.');}}>Back to our gift <I name="present"/></button></motion.div>}</AnimatePresence>
 </div><div className="tutorial-status" role="status"><img src="./calm.png" alt=""/><p>{note}</p><span>{memory?'1 memory kept':'Your story starts here'}</span></div></main>
 <section className="demo-controls" aria-label="Prototype playback"><div className="control-main"><button className="watch" onClick={()=>{clearTimeout(timer.current);setStep(null);setComposer(false);setGuide(true);if(t>=END)setT(0);setPlaying(p=>!p);}}>{playing?'Pause animation':'Play 54-second walkthrough'}</button><button onClick={()=>{clearTimeout(timer.current);setPlaying(false);setStep(memory?2:1);setGuide(true);setComposer(!memory);}}>Try it with your memory</button><label><span>{Math.floor(t)} / {END}s</span><input aria-label="Tutorial animation time" type="range" min="0" max={END} step=".1" value={t} onChange={e=>seek(Number(e.target.value))}/></label><button onClick={()=>recordFilm({setRecordState,setVideoUrl,start:()=>{seek(0);setGuide(true);setPlaying(true);}})} disabled={recordState==='Recording…'}>{recordState||'Export video'}</button>{videoUrl&&<a className="video-download" download="unwrap-moss-tutorial.webm" href={videoUrl}>Download video</a>}<button className="reduce-motion" aria-pressed={reduced} disabled={!!osReduce} onClick={()=>setReduce(r=>!r)}>Reduce motion</button></div>
 <nav aria-label="Tutorial scenes">{CHAPTERS.map((c,i)=><button key={c} aria-current={stage===i?'step':undefined} onClick={()=>seek(TIMES[i]+.2)}><span>{i+1}</span>{c}</button>)}</nav>
 {!scripted&&stage===7&&myApproval&&!otherYes&&<div className="simulation-control"><span>Review control, outside the product:</span><button onClick={()=>setOtherYes(true)}>Simulate Jon & Ally approving</button><small>No real users or approvals are affected.</small></div>}
 <p>Reuses the production island scenery, spirits and custom map icons. Your typed memory and gift idea persist in this browser only. Discovery, source prices and other people’s approvals are illustrative. No live application, backend, model or payment calls.</p>
 </section></div></MotionConfig>;
}
createRoot(document.getElementById('root')).render(<Tutorial/>);
