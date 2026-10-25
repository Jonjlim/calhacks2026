import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig, motion, useReducedMotion } from 'motion/react';
import { SkyTree, RINGS, SX } from './sky-tree';
import { useLocalRoom } from './local-room';

// Sample gifts. `themes` decides where each sits on the inner ring; `lean` answers the sharpen question.
const products = {
  kit: { title:'A little pottery kit', price:48, tag:'Make something', why:'A hands-on way to try the pottery Jon remembers.', memory:'pottery', themes:['theme:make'], angle:200, base:70, lean:'making', sharp:'A pottery kit with a studio drop-in', detail:'Air-dry clay, a few tools, and an afternoon to make something.' },
  mug: { title:'A mug, made by hand', price:34, tag:'Her Sunday ritual', why:'Handmade pottery meets Ally’s memory of slow coffee mornings.', memory:'coffee', themes:['theme:make','theme:ritual'], angle:274, base:68, lean:'owning', sharp:'A mug from a studio she can visit', detail:'A warm ceramic shape for her everyday coffee ritual.' },
  wheel: { title:'A tiny pottery wheel', price:118, tag:'A bigger adventure', why:'Follows the pottery memory, but exceeds the $80 sample budget.', memory:'pottery', themes:['theme:make'], angle:238, base:40, lean:'making', detail:'A more ambitious direction. The room’s budget stays at $80.' },
  class: { title:'An afternoon with clay', price:65, tag:'A memory to make', why:'An experience connected to pottery, without another object to keep.', memory:'pottery', themes:['theme:make'], angle:132, base:62, lean:'making', sharp:'A wheel-throwing class for two', detail:'A sample studio session for trying something new.' },
  beans: { title:'A Sunday coffee sampler', price:28, tag:'Slow mornings', why:'Small-batch beans for the slow Sunday Ally remembers.', memory:'coffee', themes:['theme:ritual'], angle:326, base:58, lean:'owning', sharp:'Local beans with a handwritten brewing card', detail:'Three small bags from a local roaster.' },
};
const THEMES = { 'theme:make':{label:'Makes things with her hands',angle:194}, 'theme:ritual':{label:'Slow, cozy rituals',angle:330} };
const D = Math.PI/180;
const polar = (angle,r) => [r*SX*Math.cos(angle*D),0,r*Math.sin(angle*D)];
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const nearestTheme = angle => Object.entries(THEMES).sort(([,a],[,b])=>Math.abs(((angle-a.angle+540)%360)-180)-Math.abs(((angle-b.angle+540)%360)-180))[0][0];
const people = [{name:'You',image:'curious'}, {name:'Jon',image:'explorer'}, {name:'Ally',image:'kind'}];
const owners = {pottery:'Jon',coffee:'Ally',handmade:'You'};
const colors = {You:'#e2ad6b',Jon:'#7fa9d6',Ally:'#d58fb6'};
const PULSE_MS = 2800;
const nodeName = key => key.startsWith('theme:')?`the “${THEMES[key]?.label}” theme`:key.startsWith('gift:')?products[key.slice(5)]?.title.replace(/^An? /,'the '):key.startsWith('node:')?'a shared note':key.startsWith('memory:')?`${owners[key.slice(7)]==='You'?'your':owners[key.slice(7)]+'’s'} memory`:'the gift box';
const cards = [{text:'She loves handmade things.',emoji:'✂',label:'Made by hand'}, {text:'She would love a creative afternoon.',emoji:'☀',label:'Time to make'}, {text:'She likes quiet little rituals.',emoji:'☕',label:'Small rituals'}];
const steps = ['Remember','Explore','Choose together'];
const council = ['Archivist','Scout','Keeper','Courier'];
const photoSvg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100"><rect width="120" height="100" fill="#e9d6bd"/><rect y="62" width="120" height="38" fill="#b88f6e"/><rect x="64" y="38" width="40" height="27" rx="2" fill="#7f9bb8"/><rect x="64" y="38" width="40" height="5" fill="#5f7d9b"/><path d="M22 44h28v19a8 8 0 0 1-8 8H30a8 8 0 0 1-8-8z" fill="#f4ece0"/><path d="M50 49h5a6 6 0 0 1 0 12h-5" fill="none" stroke="#f4ece0" stroke-width="4"/><ellipse cx="36" cy="45" rx="12" ry="3" fill="#7a5140"/><path d="M31 36c-3-5 3-7 0-12M40 36c-3-5 3-7 0-12" stroke="#fff" stroke-opacity=".7" stroke-width="2" fill="none"/><circle cx="98" cy="17" r="9" fill="#f6d58e"/></svg>');
// Seed nodes show each kind at a glance; anything friends add lives in the shared room as node:* records.
const seedNodes={'node:sunday':{type:'photo',text:'Her Sunday table',image:photoSvg,author:'Ally',angle:350,theme:'theme:ritual'},'node:makes':{type:'idea',text:'Something she makes herself',author:'Jon',angle:198,theme:'theme:make'}};
const memoryAngle={pottery:166,coffee:312,handmade:228};
const memoryTheme={pottery:'theme:make',coffee:'theme:ritual',handmade:'theme:make'};
const giftShapes={
  kit:<><g transform="rotate(-7 32 40)"><rect x="12" y="22" width="40" height="34" rx="3" fill="#d3b18d"/><rect x="12" y="22" width="40" height="7" rx="2" fill="#c09a74"/><text x="32" y="46" fontFamily="Caveat" fontSize="12" fill="#7d5f43" textAnchor="middle">make</text></g><ellipse cx="56" cy="55" rx="10" ry="8" fill="#b98364"/></>,
  mug:<><path d="M18 24h30v26a9 9 0 0 1-9 9H27a9 9 0 0 1-9-9z" fill="#b58c70"/><rect x="18" y="22" width="30" height="5" rx="2" fill="#896850"/><path d="M48 30h4a8 8 0 0 1 0 16h-4" fill="none" stroke="#b58c70" strokeWidth="5"/><path d="M28 16c-2-4 2-5 0-9M38 16c-2-4 2-5 0-9" stroke="#fff" strokeOpacity=".7" strokeWidth="2" fill="none"/></>,
  wheel:<><rect x="12" y="46" width="48" height="13" rx="4" fill="#aea2b9"/><ellipse cx="36" cy="46" rx="22" ry="5" fill="#d7c9dc"/><path d="M27 44c0-11 3-15 9-15s9 4 9 15z" fill="#b98364"/></>,
  beans:<><path d="M20 22h32l-3 36H23z" fill="#c9a27a"/><path d="M20 22h32v7H20z" fill="#a8825e"/><ellipse cx="36" cy="42" rx="6" ry="8" fill="#5e3d2b"/><path d="M36 35v14" stroke="#c9a27a" strokeWidth="1.5"/></>,
  class:<><g transform="rotate(-6 36 36)"><rect x="11" y="18" width="50" height="36" rx="3" fill="#f6e8c7" stroke="#cbb28d"/><text x="36" y="33" fontFamily="Cormorant Garamond" fontSize="10" fill="#987b58" textAnchor="middle">the clay club</text><text x="36" y="46" fontFamily="Caveat" fontSize="10" fill="#987b58" textAnchor="middle">one afternoon</text></g></>,
};
function GiftArt({kind}){return <svg viewBox="0 0 72 72" aria-hidden="true">{giftShapes[kind]}</svg>;}
function Art({kind}) {
  return <div className={'g-art g-art-'+kind} aria-hidden="true">{kind==='mug'?<><div className="g-cup"/><div className="g-handle"/></>:kind==='class'?<div className="g-ticket">the clay club<strong>An afternoon<br/>of making</strong><small>one lovely memory</small></div>:kind==='wheel'?<><div className="g-wheel"/><div className="g-clay"/></>:<><div className="g-kit">make<br/>a little</div><div className="g-clay"/></>}</div>;
}
function App(){
  const osReduced=useReducedMotion();
  const [reduce,setReduce]=useState(false), [phone,setPhone]=useState(false), [small,setSmall]=useState(false);
  const [actor,setActor]=useState(()=>['You','Jon','Ally'].includes(new URLSearchParams(location.search).get('person'))?new URLSearchParams(location.search).get('person'):'You');
  const room=useLocalRoom(actor);
  const [stage,setStage]=useState(0), [memories,setMemories]=room.field('memories',{pottery:'She keeps talking about pottery.',coffee:'Coffee. A book. A slow Sunday.'});
  const [focus,setFocus]=useState({kind:'welcome'}), [draft,setDraft]=useState(''), [candidate,setCandidate]=useState(null);
  const [expanded,setExpanded]=room.field('expanded',false), [work,setWork]=room.field('work',null), [excluded,setExcluded]=room.field('excluded',{}), [vibe,setVibe]=useState(false);
  const [selected,setSelected]=room.field('selected',null), [revision,setRevision]=room.field('revision',0), [approvals,setApprovals]=room.field('approvals',[]), [wrapped,setWrapped]=room.field('wrapped',false);
  const signals={}, votes={};
  for(const [key,value] of Object.entries(room.data))if(key.startsWith('signal:')&&value){const parts=key.slice(7).split(':');const name=parts.pop(),id=parts.join(':');signals[id]=(signals[id]??0)+value;(votes[id]??=[]).push({name,value});}
  const [sharpen,setSharpen]=room.field('sharpen',null);
  const themeSignal=id=>products[id].themes.reduce((n,t)=>n+(signals[t]??0),0);
  const baseScore=id=>products[id].base+18*(signals['gift:'+id]??0)+10*themeSignal(id)+(vibe&&id==='mug'?10:0)-(excluded[id]?100:0);
  const score=id=>baseScore(id)+(sharpen?.answer&&products[id].lean===sharpen.answer?22:0);
  const hasSignals=Object.keys(signals).length>0;
  const holds=Object.fromEntries(room.peers.filter(p=>p.held).map(p=>[p.held,room.holder(p.held)?.actor]));
  const pointerAt=useRef(0), worldRef=useRef(null);
  useEffect(()=>{const node=worldRef.current;if(!node)return;const leave=()=>room.presence({x:null,y:null});node.addEventListener("pointermove",point,{capture:true,passive:true});node.addEventListener("pointerleave",leave);return()=>{node.removeEventListener("pointermove",point,true);node.removeEventListener("pointerleave",leave);};},[room.roomId]);
  function point(e){if(Date.now()-pointerAt.current<60)return;pointerAt.current=Date.now();const r=e.currentTarget.getBoundingClientRect();room.presence({x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height});}
  // A vote stores the signal and a short-lived pulse so every tab can highlight the node.
  function signal(id,value){room.update({['signal:'+id+':'+actor]:value,...(value?{['pulse:'+actor]:{id,value,actor,at:Date.now()}}:{})});setNotice(value===0?`${actor} took back a vote on ${nodeName(id)}.`:`${actor==='You'?'You':actor} ${value>0?'think':'passed on'} ${nodeName(id)}${value>0?' feels like Maya':''}. Ranking follows the group; no clue, budget or approval changed.`);}
  const [notice,setNotice]=useState('Jon and Ally brought two memories. Add yours, or explore what’s here.');
  const [, tick]=useState(0);
  const pulses={};
  for(const [key,p] of Object.entries(room.data))if(key.startsWith('pulse:')&&p&&Date.now()-p.at<PULSE_MS&&(!pulses[p.id]||pulses[p.id].at<p.at))pulses[p.id]=p;
  const latestPulse=Object.entries(room.data).filter(([k,p])=>k.startsWith('pulse:')&&p).map(([,p])=>p).sort((a,b)=>b.at-a.at)[0];
  useEffect(()=>{if(!latestPulse)return;const left=PULSE_MS-(Date.now()-latestPulse.at);if(left<=0)return;if(latestPulse.actor!==actor)setNotice(`${latestPulse.actor} ${latestPulse.value>0?'voted ♥ Feels like Maya on':'passed on'} ${nodeName(latestPulse.id)}.`);const t=setTimeout(()=>tick(n=>n+1),left+30);return()=>clearTimeout(t);},[latestPulse?.at]);
  const [editing,setEditing]=useState(false), [more,setMore]=useState(false);
  const [sel,setSel]=useState(null), [editingKey,setEditingKey]=useState(null), [composer,setComposer]=useState(null), [why,setWhy]=useState(false), [openThemes,setOpenThemes]=useState([]);
  const meRef=useRef(null), fileRef=useRef(null);
  const timers=useRef([]), panel=useRef(null);
  const working=work&&work.until>Date.now()?work.phase:-1;
  const setWorking=phase=>setWork(phase<0?null:{phase,until:Date.now()+12000});
  const reduced=reduce||!!osReduced, mobile=phone||small, busy=working>=0;
  useEffect(()=>{if(busy){setStage(1);setFocus({kind:'research'});}else if(expanded&&focus.kind==='research'){setFocus({kind:'results'});}},[working,expanded]);
  useEffect(()=>{const m=matchMedia('(max-width: 760px)');const change=()=>setSmall(m.matches);change();m.addEventListener('change',change);return()=>m.removeEventListener('change',change);},[]);
  const cancel=()=>{timers.current.forEach(clearTimeout);timers.current=[];};
  useEffect(()=>()=>cancel(),[]);
  useEffect(()=>{panel.current?.scrollTo({top:0});setEditing(false);setMore(false);},[focus.kind,focus.id,stage]);
  const openNode=sel;
  useEffect(()=>{room.presence({viewing:openNode});},[openNode]);
  const viewers={};for(const peer of room.peers)if(peer.viewing&&peer.actor!==actor)(viewers[peer.viewing]??=[]).push(peer.actor);
  function dismiss(){setFocus({kind:'closed'});setCandidate(null);setSel(null);setEditingKey(null);setComposer(null);}
  useEffect(()=>{const key=e=>{if(e.key==='Escape')dismiss();};addEventListener('keydown',key);return()=>removeEventListener('keydown',key);},[]);
  const later=(fn,ms)=>timers.current.push(setTimeout(fn,reduced?Math.min(ms,80):ms));
  const visible=expanded?Object.keys(products).sort((a,b)=>score(b)-score(a)):[];
  const finalists=sharpen?Object.keys(products).filter(id=>!excluded[id]&&products[id].price<=80).sort((a,b)=>baseScore(b)-baseScore(a)).slice(0,2):null;
  const faded=id=>!!finalists&&!finalists.includes(id)&&selected!==id;
  const titleOf=id=>sharpen?.answer&&finalists?.includes(id)&&products[id].lean===sharpen.answer&&products[id].sharp?products[id].sharp:products[id].title;
  const p=focus.kind==='product'?products[focus.id]:null;
  const allApproved=approvals.length===3;
  function visitMemory(id){setSel('memory:'+id);setFocus({kind:'memory',id});setDraft(memories[id]);}
  function inspect(id){setSel('gift:'+id);setStage(1);setFocus({kind:'product',id});}
  function findGifts(){
    if(busy)return; cancel();setStage(1);setFocus({kind:'research'});setWorking(0);setNotice('Demo research: the council is following your confirmed memories.');
    [1,2,3].forEach((i)=>later(()=>setWorking(i),i*750));
    later(()=>{setWorking(-1);setExpanded(true);setFocus({kind:'results'});setNotice('The council found two themes and five sample gifts. Each gift sits between the themes it fits.');},3100);
  }
  function choose(id){
    if(excluded[id]||products[id].price>80||busy)return;setWhy(false);
    if(selected!==id){setRevision(r=>r+1);setApprovals([]);setWrapped(false);}
    setSelected(id);setStage(2);setSel('box');setFocus({kind:'box'});setNotice('The box is ready to review. Everyone approves this exact version. No payment is taken.');
  }
  function reject(id,reason){
    setExcluded(old=>({...old,[id]:reason}));
    if(selected===id){setSelected(null);setApprovals([]);setWrapped(false);setRevision(r=>r+1);}
    setStage(1);setNotice(reason==='owned'?'That gift is resting. A clay experience appeared as a sample alternative.':'Your price reaction is saved in this prototype. The room budget stays $80.');
  }
  function startSharpen(){if(!expanded||busy||sharpen)return;setSharpen({asked:actor,answer:null});setSel(null);setNotice('The council kept the two strongest ideas and faded the rest. One question will split them.');}
  function answerSharpen(answer){setSharpen({...(sharpen??{}),answer,by:actor});setNotice(`${actor} answered: ${answer==='making'?'she loves making things':'she loves owning handmade things'}. The matching idea moved toward the box and got more specific.`);}
  function restore(id){setExcluded(old=>{const next={...old};delete next[id];return next;});setNotice('Reaction undone. This idea is available again.');}
  function saveMemory(id,text){
    if(!text.trim())return;cancel();setWorking(-1);setMemories(old=>({...old,[id]:text.trim()}));setExpanded(false);setSharpen(null);setExcluded({});setSelected(null);setApprovals([]);setWrapped(false);setVibe(false);setStage(0);setCandidate(null);setFocus({kind:'memory',id});setDraft(text.trim());
    setNotice('Memory saved. Research and approvals were cleared so the next gifts reflect your changes.');
  }
  function navigate(i){if(busy||i===1&&!expanded||i===2&&!selected)return;setStage(i);setCandidate(null);setFocus({kind:i===0?'welcome':i===1?'results':'box'});}
  function reset(){cancel();setSel(null);setComposer(null);setEditingKey(null);setWhy(false);setOpenThemes([]);room.reset();setWorking(-1);setStage(0);setMemories({pottery:'She keeps talking about pottery.',coffee:'Coffee. A book. A slow Sunday.'});setFocus({kind:'welcome'});setCandidate(null);setExpanded(false);setExcluded({});setSelected(null);setApprovals([]);setWrapped(false);setRevision(0);setVibe(false);setNotice('Jon and Ally brought two memories. Add yours, or explore what’s here.');}
  function signalControls(id){const own=votes[id]?.find(v=>v.name===actor)?.value;return <div className="g-signal-controls"><span>GROUP DIRECTION · SOFT VOTE</span><div><button aria-pressed={own===-1} onClick={()=>signal(id,own===-1?0:-1)}>← Pass for me</button><button aria-pressed={own===1} onClick={()=>signal(id,own===1?0:1)}>Feels like Maya →</button></div><small>{votes[id]?.length?votes[id].map(v=>`${v.name} ${v.value>0?(v.name==='You'?'support':'supports'):'passed'}`).join(' · '):'No signals yet. Hold and toss this island left or right, or use these buttons.'}</small>{own&&<button className="g-text" onClick={()=>signal(id,0)}>Undo my signal</button>}</div>;}
  // Every node on the island: friends' memories, plus shared photos, messages and ideas.
  const nodes={...seedNodes};for(const [k,v] of Object.entries(room.data))if(k.startsWith('node:'))nodes[k]=v;
  const faceOf=name=>people.find(p=>p.name===name)?.image??'curious';
  const rawItems=[...Object.entries(memories).map(([id,text])=>({key:'memory:'+id,type:'memory',text,author:owners[id],face:faceOf(owners[id]),model:id==='pottery'?'explorer':id==='coffee'?'kind':'dreamer',angle:memoryAngle[id]??240,theme:memoryTheme[id]})),...Object.entries(nodes).filter(([,v])=>v).map(([key,v])=>({...v,key,face:faceOf(v.author),theme:v.theme??nearestTheme(v.angle??0)}))];
  // Ring layout. Positions are computed from room data; nobody arranges nodes by hand.
  const grouped=expanded||working>=1;
  const selTheme=sel?.startsWith('theme:')?sel:rawItems.find(i=>i.key===sel)?.theme;
  const whyKeys=why&&selected?new Set(['box','gift:'+selected,...products[selected].themes,...rawItems.filter(i=>products[selected].themes.includes(i.theme)).map(i=>i.key)]):null;
  const isOpen=t=>openThemes.includes(t)||selTheme===t||whyKeys?.has(t);
  const items=rawItems.map(it=>{
    if(grouped&&!isOpen(it.theme)){const group=rawItems.filter(i=>i.theme===it.theme),n=group.indexOf(it);return {...it,small:true,at:polar(THEMES[it.theme].angle+(n-(group.length-1)/2)*7,RINGS.theme+1.5)};}
    return {...it,at:polar(it.angle,RINGS.input-.45*clamp(signals[it.key]??0,-2,2))};
  });
  const themeNodes=grouped?Object.entries(THEMES).map(([key,t])=>{const members=rawItems.filter(i=>i.theme===key);return {key,label:t.label,count:members.length,faces:[...new Set(members.map(m=>m.face))],at:polar(t.angle,RINGS.theme-.4*clamp(signals[key]??0,-2,2))};}):[];
  const giftNodes=visible.map(id=>({id,title:titleOf(id),themes:products[id].themes,faded:faded(id),at:polar(products[id].angle,excluded[id]||faded(id)?RINGS.gift+1.4:clamp(RINGS.gift+(68-score(id))/28,2.6,4.4))}));
  const itemOf=key=>rawItems.find(i=>i.key===key);
  const setMode=m=>{if(meRef.current)meRef.current.dataset.mode=m||'empty';};
  useEffect(()=>{const node=worldRef.current;if(!node||mobile)return;const move=e=>{const el=meRef.current;if(!el)return;const r=node.getBoundingClientRect();el.style.opacity=e.target.closest?.('.sky-tree')?1:0;el.style.transform=`translate(${e.clientX-r.left}px,${e.clientY-r.top}px)`;};const leave=()=>{if(meRef.current)meRef.current.style.opacity=0;};node.addEventListener('pointermove',move,{capture:true,passive:true});node.addEventListener('pointerleave',leave);return()=>{node.removeEventListener('pointermove',move,true);node.removeEventListener('pointerleave',leave);};},[mobile]);
  function select(key){
    setComposer(null);setEditingKey(null);
    if(sel===key){dismiss();return;}
    setSel(key);
    if(key.startsWith('memory:'))setFocus({kind:'memory',id:key.slice(7)});
    else if(key.startsWith('gift:'))setFocus({kind:'product',id:key.slice(5)});
    else if(key==='box'){if(selected)setStage(2);setFocus({kind:'box'});}
    else if(key.startsWith('theme:'))setFocus({kind:'closed'});
    else setFocus({kind:'closed'});
  }
  // First click on empty sky closes whatever is open; the next one starts adding something there.
  function onEmpty(point){
    if(!point||sel||composer||editingKey){dismiss();return;}
    setDraft('');setComposer({at:point,mode:null,image:null});
  }
  function addNode(){
    const c=composer,text=draft.trim();if(!c||(c.mode==='photo'?!c.image:!text))return;
    const key='node:'+crypto.randomUUID().slice(0,8);
    const angle=(Math.atan2(c.at[2],c.at[0]/SX)/D+360)%360;room.update({[key]:{type:c.mode,text,image:c.image??null,author:actor,angle,theme:nearestTheme(angle),time:Date.now()}});
    setComposer(null);setDraft('');setSel(key);setFocus({kind:'closed'});
    setNotice(`${actor} added a ${c.mode==='photo'?'photo':c.mode==='idea'?'new idea':'message'} to the island.`);
  }
  function loadPhoto(e){
    const f=e.target.files?.[0];if(!f)return;
    if(!f.type.startsWith('image/')){setNotice('That file is not an image.');return;}
    const url=URL.createObjectURL(f),img=new Image();
    img.onload=()=>{const k=Math.min(1,360/Math.max(img.width,img.height)),cv=document.createElement('canvas');cv.width=Math.round(img.width*k);cv.height=Math.round(img.height*k);cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);URL.revokeObjectURL(url);setComposer(c=>c&&{...c,mode:'photo',image:cv.toDataURL('image/jpeg',.78)});};
    img.onerror=()=>{URL.revokeObjectURL(url);setNotice('Could not read that photo.');};
    img.src=url;
  }
  function saveEdit(){
    const key=editingKey,text=draft.trim();if(!key||!text)return;
    if(key.startsWith('memory:'))saveMemory(key.slice(7),text);
    else room.update({[key]:{...nodes[key],text}});
    setEditingKey(null);setSel(key);
  }
  const keyInput=(submit,cancel)=>e=>{e.stopPropagation();if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit();}if(e.key==='Escape')cancel();};
  const own=key=>votes[key]?.find(v=>v.name===actor)?.value;
  const voteActs=key=>[{icon:'♥',label:'Feels like Maya',tone:'yes',on:own(key)===1,run:()=>signal(key,own(key)===1?0:1)},{icon:'✕',label:'Pass for me',tone:'pass',on:own(key)===-1,run:()=>signal(key,own(key)===-1?0:-1)}];
  function actionsFor(key){
    if(editingKey===key)return {caption:'Enter to save · Esc to cancel',actions:[{icon:'✓',label:'Save',tone:'yes',disabled:!draft.trim(),run:saveEdit},{icon:'↩',label:'Cancel',run:()=>setEditingKey(null)}]};
    if(key==='box'){
      if(!selected)return {caption:'Pick a gift island, then add it here.',actions:[]};
      const g=products[selected];
      return {caption:<><b>{titleOf(selected)}</b> · ${g.price} of $80 · v{revision}<span className="tok-people">{people.map(p=><i key={p.name} className={approvals.includes(p.name)?'ok':''} style={{'--who':colors[p.name]}}>{p.name}{approvals.includes(p.name)?' ✓':''}</i>)}</span></>,
        actions:[!approvals.includes(actor)?{icon:'✓',label:'Approve my share',tone:'yes',run:()=>{setApprovals(a=>[...new Set([...a,actor])]);setNotice(`${actor} approved version ${revision}.`);}}:!allApproved?{icon:'✨',label:'Simulate the others',run:()=>{setApprovals(['You','Jon','Ally']);setNotice('Demo: Jon and Ally approved this version.');}}:!wrapped?{icon:'🎀',label:'Wrap it',tone:'gold',run:()=>{setWrapped(true);setNotice('Wrapped. No order placed, no money moved.');}}:{icon:'🎉',label:'Wrapped',disabled:true,run:()=>{}},{icon:'✨',label:why?'Hide the path':'Why this?',on:why,run:()=>{setWhy(w=>!w);setNotice(why?'Back to the whole map.':'The gold path runs from the gift through its themes to the memories behind it.');}},{icon:'🔍',label:'See the gift',run:()=>select('gift:'+selected)}]};
    }
    if(key.startsWith('gift:')){
      const id=key.slice(5),g=products[id],over=g.price>80;
      if(excluded[id])return {caption:<><b>{g.title}</b> · resting, {excluded[id]==='owned'?'she has it':'too pricey'}</>,actions:[{icon:'↺',label:'Undo',run:()=>restore(id)},...(excluded[id]==='owned'?[{icon:'✨',label:'Alternative',run:()=>inspect('class')}]:[])]};
      if(faded(id))return {caption:<><b>{g.title}</b> · faded back after sharpening</>,actions:[...voteActs(key),{icon:'↩',label:'Undo sharpen',run:()=>{setSharpen(null);setNotice('Sharpening undone. Every idea is back in play.');}}]};
      return {caption:<><b>{titleOf(id)}</b> · {over?<span className="over">${g.price-80} over our budget</span>:g.why}{g.themes.length>1&&<span className="tok-tag">fits 2 themes</span>}</>,
        actions:[...voteActs(key),over?{icon:'↘',label:'Cheaper pick',run:()=>inspect('kit')}:{icon:'🎁',label:selected===id?'In the box':'Add to box',tone:'gold',on:selected===id,disabled:busy,run:()=>selected===id?select('box'):choose(id)},{icon:'🏠',label:'She has it',run:()=>reject(id,'owned')},{icon:'💸',label:'Too pricey',run:()=>reject(id,'price')},{icon:'🪐',label:'Its theme',run:()=>select(g.themes[0])}]};
    }
    if(key.startsWith('theme:')){
      const t=THEMES[key],members=rawItems.filter(i=>i.theme===key),its=visible.filter(g=>products[g].themes.includes(key)&&!excluded[g]);
      return {caption:<><b>{t.label}</b> · suggested by the council from {members.length} shared {members.length===1?'thing':'things'}</>,
        actions:[...voteActs(key),{icon:'👁',label:openThemes.includes(key)?'Tuck them in':'Show what’s inside',on:openThemes.includes(key),run:()=>setOpenThemes(o=>o.includes(key)?o.filter(x=>x!==key):[...o,key])},...(its.length?[{icon:'🎁',label:'Its gifts',run:()=>select('gift:'+its[0])}]:[])]};
    }
    const it=itemOf(key);if(!it)return null;
    return {caption:<>{it.author==='You'?'Your':it.author+'’s'} {it.type==='photo'?'photo':it.type==='idea'?'idea':'memory'}{grouped?<> · in “{THEMES[it.theme].label}”</>:''}</>,
      actions:[...voteActs(key),...(grouped?[{icon:'🪐',label:'Its theme',run:()=>select(it.theme)}]:[{icon:'🌱',label:'Find gifts',disabled:busy,run:findGifts}]),{icon:'✎',label:it.type==='photo'?'Caption':'Edit',run:()=>{setDraft(it.text??'');setEditingKey(key);}},...(key.startsWith('node:')&&it.author===actor?[{icon:'🗑',label:'Remove',run:()=>{room.update({[key]:null});dismiss();}}]:[])]};
  }
  const editItem=editingKey?itemOf(editingKey):null;
  const editArea=placeholder=><textarea autoFocus value={draft} maxLength={160} placeholder={placeholder} onChange={e=>setDraft(e.target.value)} onKeyDown={keyInput(saveEdit,()=>setEditingKey(null))}/>;
  const editor=editItem?{key:editingKey,node:editItem.type==='photo'?<span className="polaroid editing"><img src={editItem.image} alt=""/>{editArea('Caption')}</span>:editItem.type==='idea'?<span className="idea editing"><b aria-hidden>💡</b>{editArea('An idea')}</span>:<span className="bubble editing"><img src={`./${editItem.face}.png`} alt=""/>{editArea('A memory')}</span>}:null;
  const composeArea=placeholder=><textarea autoFocus value={draft} maxLength={160} placeholder={placeholder} onChange={e=>setDraft(e.target.value)} onKeyDown={keyInput(addNode,()=>setComposer(null))}/>;
  const composeNode=composer&&(composer.mode===null
    ?<div className="compose" aria-label="Add to the island">{[['memory','💬','Message'],['photo','📷','Photo'],['idea','💡','Idea']].map(([m,icon,label],i)=><button key={m} style={{'--i':i}} className="tok-act" onClick={()=>{setDraft('');setComposer(c=>({...c,mode:m}));if(m==='photo'&&fileRef.current){fileRef.current.value='';fileRef.current.click();}}}><span aria-hidden>{icon}</span><small>{label}</small></button>)}<i className="compose-dot"/></div>
    :<div className={'tok on tok-'+composer.mode} style={{'--c':colors[actor]}}><div className="tok-face">{composer.mode==='photo'?<span className="polaroid editing">{composer.image?<img src={composer.image} alt=""/>:<button className="polaroid-pick" onClick={()=>fileRef.current?.click()}>📷<small>Choose a photo</small></button>}{composeArea('Caption (optional)')}</span>:composer.mode==='idea'?<span className="idea editing"><b aria-hidden>💡</b>{composeArea('An idea for Maya…')}</span>:<span className="bubble editing"><img src={`./${faceOf(actor)}.png`} alt=""/>{composeArea('Something only you know…')}</span>}</div><div className="tok-actions"><button className="tok-act yes" style={{'--i':0}} disabled={composer.mode==='photo'?!composer.image:!draft.trim()} onClick={addNode}><span>✓</span><small>Add</small></button><button className="tok-act" style={{'--i':1}} onClick={()=>setComposer(null)}><span>↩</span><small>Cancel</small></button></div></div>);
  const question=sharpen&&!sharpen.answer?<div className="ask"><small>The council asks one question</small><p>Does Maya love <b>making</b> things, or <b>owning</b> handmade things?</p><div><button onClick={()=>answerSharpen('making')}>Making them</button><button onClick={()=>answerSharpen('owning')}>Owning them</button></div></div>:null;
  const overlays=[...(composer?[{key:'compose',at:composer.at,node:composeNode}]:[]),...(question?[{key:'ask',at:[0,1,4.4],node:question}]:[])];
  const GiftList=()=> <div className="g-result-list">{visible.map(id=><button key={id} className={'g-result '+(excluded[id]?'g-resting':'')+(focus.id===id?' g-current':'')} onClick={()=>inspect(id)}><Art kind={id}/><span><small>{excluded[id]?'Resting · inspect to undo':products[id].price>80?'Above our budget':`Rank ${visible.indexOf(id)+1} · fit score ${score(id)}`}</small><strong>{products[id].title}</strong><b>${products[id].price}</b></span><span aria-hidden>↗</span></button>)}</div>;
  return <MotionConfig reducedMotion={reduced?'always':'user'}><div className={'guided '+(phone?'g-phone':'')}>
    <div className="g-lab"><span>UNWRAP / GUIDED EXPERIENCE <b>Sample gifts & agent reasoning · cursors, holds and votes sync across local tabs</b></span><div><button aria-pressed={!phone} onClick={()=>setPhone(false)}>Desktop</button><button aria-pressed={phone} onClick={()=>setPhone(true)}>Phone controller</button><button onClick={reset}>Restart</button></div></div>
    <main className="g-app">
      <header className="g-header"><a href="#" onClick={e=>{e.preventDefault();navigate(0);}} className="g-logo">unwrap.</a><div className="g-identity"><strong>Maya’s birthday</strong><small>A gift only her friends could find.</small></div><div className="g-people">{people.map(person=><span key={person.name}><img src={'./'+person.image+'.png'} alt=""/>{person.name}</span>)}</div><span className="g-budget">Together, up to <b>$80</b></span></header><div className="g-multiplayer"><label>Local demo identity <select value={actor} onChange={e=>setActor(e.target.value)}>{people.map(p=><option key={p.name}>{p.name}</option>)}</select></label><span>{room.online?`${room.peers.length+1} local tab${room.peers.length?"s":""} connected`:"Local collaboration unavailable"} · browser-only room</span><a href={`?room=${room.roomId}&person=${actor==='Jon'?'Ally':'Jon'}`} target="_blank" rel="noreferrer">Open another friend’s view ↗</a></div>
      <nav className="g-steps" aria-label="Gift planning stages">{steps.map((name,i)=><button key={name} aria-current={stage===i?'step':undefined} disabled={busy||(i===1&&!expanded)||(i===2&&!selected)} onClick={()=>navigate(i)}><span>{i<stage?'✓':i+1}</span>{name}<small>{i===0?`${Object.keys(memories).length} shared memories`:i===1?expanded?'Ideas ready':'Follow a memory':selected?allApproved?'Everyone approved':'Review the box':'Choose one gift'}</small></button>)}</nav>
      <section className="g-title"><p>{stage===0?'THE LITTLE THINGS ONLY YOU KNOW':stage===1?'FROM THEIR STORIES TO SOMETHING REAL':'ONE GIFT. EVERYONE TOGETHER.'}</p><h1>{stage===0?'Start with a little memory.':stage===1?'Follow what feels like Maya.':wrapped?'A little world, ready for Maya.':'Make this one a shared yes.'}</h1><span>{stage===0?'Visit a friend’s island, or add your own memory.':stage===1?'Each idea has a thread back to something a friend remembers.':'Review the gift and approve this version together.'}</span></section>
      <div className={'g-workspace'+(mobile?'':' g-solo')}>
        <section className="g-world" aria-label="Maya’s shared island" ref={worldRef}>
          {!mobile?<SkyTree items={items} themes={themeNodes} gifts={giftNodes} products={products} art={id=><GiftArt kind={id}/>} rank={id=>visible.indexOf(id)+1} excluded={excluded} growing={busy} reduce={reduced} selectedGift={selected} approved={wrapped} boxInfo={selected?`$${products[selected].price} · ${approvals.length}/3 yes`:"Our gift box"} selectedKey={sel} onSelect={select} actionsFor={actionsFor} editor={editor} overlays={overlays} onEmpty={onEmpty} onHover={setMode} onToss={signal} onDropBox={id=>{const g=id.slice(5);if(products[g].price>80||excluded[g]){setNotice(products[g].price>80?"That one is over the $80 budget, so it can’t go in the box.":"That idea is resting. Undo the reaction first.");return;}choose(g);}} onHold={id=>room.claim(id)} onRelease={room.release} canHold={id=>{const owner=room.holder(id);return !owner||owner.client===room.client;}} signals={signals} holds={holds} pulses={pulses} viewers={viewers} votes={votes} colors={colors} why={whyKeys} stage={stage}/>:<div className="g-controller"><span className="g-kicker">SAME ROOM · PHONE CONTROLLER</span>{stage===0?<div className="g-memory-list">{Object.entries(memories).map(([id,text])=><button key={id} onClick={()=>visitMemory(id)}><img src={'./'+(id==='pottery'?'explorer':id==='coffee'?'kind':'curious')+'.png'} alt=""/><span><small>{owners[id]} remembers</small><strong>{text}</strong></span><span>↗</span></button>)}</div>:stage===1?busy?<p>The sample council is following your memories…</p>:<p>{visible.length} sample gift ideas are ready. Explore their stories in the panel below.</p>:<button className="g-controller-box" onClick={()=>setFocus({kind:'box'})}><Art kind={selected}/><strong>{selected?products[selected].title:'Your gift box'}</strong><span>{allApproved?'Everyone approved this version':'Review this version below'}</span></button>}</div>}
          <div className="g-council" role="status"><span className="g-council-heading">{busy?'DEMO COUNCIL AT WORK':'THE COUNCIL’S NOTEBOOK'}</span>{busy?<div className="g-agent-progress">{council.map((name,i)=><span key={name} data-state={i<working?'done':i===working?'active':'waiting'}>{i<working?'✓':i===working?'•':'○'} {name}<small>{i===working?['Reading memories','Finding ideas','Checking the budget','Bringing it together'][i]:i<working?'Done':'Next'}</small></span>)}</div>:<p>{notice}</p>}</div>
          <div className="g-peer-cursors" aria-hidden="true">{room.peers.filter(peer=>peer.x!==null&&peer.y!==null).map(peer=><span key={peer.client} className="g-cursor" style={{left:`${peer.x*100}%`,top:`${peer.y*100}%`,'--who':colors[peer.actor]}}><svg viewBox="0 0 20 22"><path d="M2 2l15 8-6.5 1.8L7.5 19z"/></svg><b>{peer.actor}</b>{peer.held&&<i>holding</i>}</span>)}</div>
          {!mobile&&<div className="g-cursor g-me" ref={meRef} data-mode="empty" style={{'--who':colors[actor]}} aria-hidden="true"><svg viewBox="0 0 20 22"><path d="M2 2l15 8-6.5 1.8L7.5 19z"/></svg><b>{actor}</b><i className="cm-add">+ add here</i></div>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={loadPhoto}/>
        </section>
        {mobile&&<aside className="g-panel" ref={panel} aria-label="Memory and gift details">
          {focus.kind==='memory'?<><div className="g-panel-label">{owners[focus.id]}’S SHARED MEMORY</div><h2>{memories[focus.id]}</h2><p>This is a confirmed sample memory. Supporting it boosts its connected gift directions; passing lowers their priority.</p>{signalControls("memory:"+focus.id)}<label className="g-label" htmlFor="memory-edit">Edit this sample memory</label><textarea id="memory-edit" value={draft} maxLength={200} onChange={e=>setDraft(e.target.value)}/><button className="g-secondary" disabled={!draft.trim()||draft.trim()===memories[focus.id]||busy} onClick={()=>saveMemory(focus.id,draft)}>Save memory</button><small className="g-fine">Editing clears researched ideas and approvals in this prototype. In the live app, only the publisher can edit.</small><button className="g-text" onClick={()=>{setFocus({kind:expanded?'results':'welcome'});setStage(expanded?1:0);}}>← {expanded?'Back to gift ideas':'Back to memories'}</button></>:
          p?<><button className="g-text g-back" onClick={()=>{setStage(1);setFocus({kind:'results'});}}>← All gift ideas</button><div className="g-panel-label">ILLUSTRATIVE GIFT · SAMPLE PRICE</div><Art kind={focus.id}/><h2>{p.title}</h2><div className="g-price">${p.price}<span>{p.price>80?'$38 above our budget':'Within our $80 budget'}</span></div><p>{p.detail}</p>{signalControls("gift:"+focus.id)}<div className="g-score-explanation">Sample fit score {score(focus.id)}<small>Base relevance + 18 × gift votes + 10 × votes on {owners[p.memory]}’s memory. Soft votes never authorize a purchase.</small></div><div className="g-thread"><span>WHY THIS GIFT</span><p>{p.why}</p><button onClick={()=>visitMemory(p.memory)}>{owners[p.memory]}’s memory ↗</button></div><small className="g-fine">Concept item, not a merchant listing. Shipping, tax and availability are unknown. No purchase link or checkout.</small>{excluded[focus.id]?<div className="g-reaction"><p>{excluded[focus.id]==='owned'?'You marked this as already owned.':'You marked this too pricey for you.'}</p><button className="g-secondary" onClick={()=>restore(focus.id)}>Undo reaction</button><button className="g-text" onClick={()=>inspect('class')}>See the experience alternative ↗</button></div>:<><div className="g-reactions"><button onClick={()=>reject(focus.id,'owned')}>Already has it</button><button onClick={()=>reject(focus.id,'price')}>Too pricey for me</button></div><button className="g-primary" disabled={p.price>80||busy} onClick={()=>choose(focus.id)}>{p.price>80?'Above our $80 budget':selected===focus.id?'Review in our gift box →':'Add to our gift box →'}</button>{p.price>80&&<button className="g-text" onClick={()=>inspect('kit')}>See the $48 pottery kit ↗</button>}</>}</>:
          stage===0?<><div className="g-panel-label">YOUR LITTLE PIECE OF MAYA</div><h2>What feels like her?</h2><p>Pick a starting point. You’ll confirm the memory before it joins the island.</p><div className="g-memory-cards">{cards.map(c=><button key={c.label} aria-pressed={candidate===c.text} onClick={()=>{setCandidate(c.text);setDraft(c.text);}}><span aria-hidden>{c.emoji}</span><strong>{c.label}</strong></button>)}</div><button className="g-text" onClick={()=>{setCandidate('custom');setDraft('');}}>Or write a memory of your own ↗</button>{candidate&&<div className="g-confirm-memory"><label htmlFor="new-memory" className="g-label">Does this sound true about Maya?</label><textarea id="new-memory" maxLength={200} value={draft} onChange={e=>setDraft(e.target.value)}/><button className="g-primary" disabled={!draft.trim()} onClick={()=>saveMemory('handmade',draft)}>Yes, share this memory</button><small className="g-fine">This only changes this local prototype.</small></div>}<div className="g-collected"><b>{Object.keys(memories).length} memories together</b><p>You have enough to explore. You can always come back.</p></div></>:
          stage===1?<><div className="g-panel-label">{busy?'FOLLOWING YOUR MEMORIES':'THREE THREADS, ONE THOUGHTFUL GIFT'}</div><h2>{busy?'A little thinking, together.':'Which direction feels right?'}</h2><p>{busy?'Watch the sample council follow the memories, find ideas, and check the budget.':mobile?'Choose a gift below. Its story and actions open in this same panel.':'Click a gift island or choose below. Its story and actions open right here.'}</p>{busy?<div className="g-search-memory">“{memories.pottery}”<small>Jon’s confirmed memory</small></div>:<><GiftList/><button className="g-vibe" aria-pressed={vibe} onClick={()=>{setVibe(v=>!v);setNotice(vibe?'All directions are back in place.':'Handmade brings the mug’s branch closer. This local layout change starts no new search.');}}>A little more handmade <span>{vibe?'✓':'+'}</span></button><small className="g-fine">A visual nudge, not another search or a new fact.</small>{hasSignals&&<div className="g-exploration"><span>SAMPLE AGENT EXPLORATION</span><p>The group’s signals opened a clay experience branch. It follows Jon’s pottery memory and stays within $80.</p><button className="g-text" onClick={()=>inspect("class")}>Explore this possible direction ↗</button><small>Scripted explanation using sample candidates, not a live model or merchant search.</small></div>}</>}</>:
          <><div className="g-panel-label">OUR SHARED GIFT · VERSION {revision}</div><h2>{wrapped?'Ready for her next chapter.':allApproved?'Everyone’s in.':'Does this feel like Maya?'}</h2>{selected&&<><div className="g-box-summary"><Art kind={selected}/><strong>{products[selected].title}</strong><span>${products[selected].price} of our $80 budget</span><div className="g-budget-track"><i style={{width:products[selected].price/80*100+'%'}}/></div></div><button className="g-text" onClick={()=>inspect(selected)}>Review the gift’s story ↗</button><p className="g-fine">Sample split across three friends. Shipping and tax are unknown. Approvals are simulated pledges; nobody is charged.</p><div className="g-approval-list">{people.map((person,i)=>{const cents=Math.floor(products[selected].price*100/3)+(i<products[selected].price*100%3?1:0);return <div key={person.name}><img src={'./'+person.image+'.png'} alt=""/><strong>{person.name}</strong><span>${(cents/100).toFixed(2)}</span><small>{approvals.includes(person.name)?'Approved ✓':'Waiting'}</small></div>;})}</div>{!approvals.includes(actor)?<button className="g-primary" onClick={()=>{setApprovals(a=>[...new Set([...a,actor])]);setNotice(`${actor} approved sample version ${revision}. Other friends still need to decide.`);}}>Approve my sample share</button>:!allApproved?<button className="g-primary" onClick={()=>{setApprovals(['You','Jon','Ally']);setNotice('Demo: Jon and Ally approved this version. You can wrap the gift.');}}>Simulate remaining approvals</button>:!wrapped?<button className="g-primary" onClick={()=>{setWrapped(true);setNotice('The sample gift is wrapped. No order was placed and no money moved.');}}>Wrap our gift →</button>:<div className="g-finished" role="status">Wrapped with three shared yeses.<small>Prototype complete · no purchase placed</small></div>}{!wrapped&&<button className="g-text" onClick={()=>{setStage(1);setFocus({kind:'results'});setNotice('Explore other gifts. Choosing a different one will reset every approval.');}}>Keep looking at gift ideas</button>}<small className="g-fine">Changing the gift creates a new version and resets everyone’s approvals.</small></>}</>}
        </aside>}
      </div>
      <footer className="g-next"><div><small>{wrapped?'READY TO REVEAL':busy?'EXPLORE · DEMO RESEARCH':`STEP ${stage+1} OF 3`}</small><strong>{wrapped?'Something that feels like Maya.':stage===0?'Your memories give the council a direction.':stage===1?busy?'Themes appear first, then gifts between them.':sharpen?'Drag the winner onto the box to choose it.':'Pull ideas toward the box, then sharpen.':`${approvals.length} of 3 friends approved version ${revision}.`}</strong></div>{stage===0?<button className="g-primary" disabled={busy} onClick={()=>expanded?navigate(1):findGifts()}>{expanded?'Explore our gift ideas →':'Find gifts from these memories →'}</button>:stage===1?(selected?<button className="g-primary" disabled={busy} onClick={()=>navigate(2)}>Review our gift box →</button>:!sharpen&&!busy?<button className="g-primary" onClick={startSharpen}>Sharpen the ideas ✨</button>:<button className="g-primary" disabled>{busy?'Following the memories…':sharpen&&!sharpen.answer?'Answer the council’s question':'Drop a gift on the box'}</button>):<span className="g-next-hint">{wrapped?'Made thoughtful, together.':mobile?'Review and approve in the panel ↑':'Review and approve on the gift island ↑'}</span>}</footer>
    </main><div className="g-review"><span>One island · one detail panel · three clear steps</span><label><input type="checkbox" checked={reduce} onChange={e=>setReduce(e.target.checked)}/> Reduce motion</label></div>
  </div></MotionConfig>;
}
createRoot(document.getElementById('root')).render(<App/>);
