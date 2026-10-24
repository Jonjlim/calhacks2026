import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { SkyTree } from './sky-tree';

const products = {
  kit: { title: 'A little pottery kit', price: 48, tag: 'Make something', hue: 'clay', art: 'kit', why: 'A hands-on way to explore the pottery memory.', note: 'Connected to Jon’s pottery memory.' },
  mug: { title: 'A mug, made by hand', price: 34, tag: 'Everyday warmth', hue: 'sage', art: 'mug', why: 'Connects handmade ceramics with her slow Sunday mornings.', note: 'Connects Jon’s pottery note and Ally’s coffee memory.' },
  wheel: { title: 'A tiny pottery wheel', price: 118, tag: 'A bigger adventure', hue: 'lavender', art: 'wheel', why: 'A more ambitious direction, above this room’s $80 budget.', note: 'Above the sample room budget. Don’t quietly change anyone’s limit.' },
  class: { title: 'An afternoon with clay', price: 65, tag: 'A memory to make', hue: 'clay', art: 'class', why: 'An experience in the same direction, without another kit to keep.', note: 'Suggested alternative after you marked the kit as already owned.' },
};
const steps = ['Gather memories', 'Watch ideas grow', 'Steer the search', 'Choose together'];
function Art({ kind, small = false }) {
  return <div className={'art art-' + kind + (small ? ' small' : '')} aria-hidden="true">
    {kind === 'mug' ? <><div className="mug-body"><span /></div><div className="mug-handle"/><div className="steam one"/><div className="steam two"/></> :
      kind === 'wheel' ? <><div className="wheel-base"/><div className="wheel-top"/><div className="vase"/></> :
      kind === 'class' ? <><div className="class-sheet"><span>the clay club</span><strong>an afternoon<br/>of making</strong><i>admit one · with love</i></div><div className="clay-bowl"/></> :
      <><div className="kit-box"><span>make<br/>a little</span></div><div className="clay-ball"/><div className="tool"/><div className="tool second"/></>}
  </div>;
}
function Gift({ filled, wrapped }) { return <div className={'gift-art ' + (filled ? 'filled ' : '') + (wrapped ? 'wrapped' : '')} aria-hidden="true"><div className="gift-shadow"/><div className="gift-body"/><div className="gift-lid"/><div className="gift-ribbon"/><div className="bow bow-left"/><div className="bow bow-right"/><span className="gift-star">✧</span></div>; }
function Person({ name, color, image }) { return <span className="person"><img src={image} alt="" style={{background:color}}/><span>{name}</span></span>; }

function App() {
  const [variant, setVariant] = useState('sky');
  const [view, setView] = useState('desktop');
  const [expanded, setExpanded] = useState(false);
  const [growing, setGrowing] = useState(false);
  const [excluded, setExcluded] = useState({});
  const [vibe, setVibe] = useState(false);
  const [selected, setSelected] = useState(null);
  const [focus, setFocus] = useState(null);
  const [constraint, setConstraint] = useState(null);
  const [approved, setApproved] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [reduce, setReduce] = useState(false);
  const [revision, setRevision] = useState(0);
  const [focusMemory, setFocusMemory] = useState(null);
  const [memories, setMemories] = useState({pottery:'She keeps talking about pottery.', coffee:'Coffee. A book. A slow Sunday.', handmade:'She loves handmade things.'});
  const [memoryDraft, setMemoryDraft] = useState('');
  const [log, setLog] = useState(['Three friends brought a little piece of Maya.']);
  const timers = useRef([]);
  const box = useRef(null);
  const dragMoved = useRef(false);
  const selectedProduct = selected ? products[selected] : null;
  const focusProduct = focus ? products[focus] : null;
  const stage = selected ? 3 : Object.keys(excluded).length || vibe ? 2 : expanded ? 1 : 0;
  const report = text => setLog(old => [text, ...old].slice(0, 4));
  const clearTimers = () => {timers.current.forEach(clearTimeout); timers.current = [];};
  useEffect(() => () => clearTimers(), []);
  const later = (fn, delay) => timers.current.push(setTimeout(fn, delay));
  function reset() { clearTimers(); setExpanded(false); setGrowing(false); setExcluded({}); setVibe(false); setSelected(null); setFocus(null); setFocusMemory(null); setConstraint(null); setApproved(false); setPlaying(false); setRevision(0); setLog(['Three friends brought a little piece of Maya.']); }
  function grow() { if(expanded || growing) return; setGrowing(true); report('Scout is following Jon’s pottery memory… (simulated)'); later(() => { setGrowing(false); setExpanded(true); report('Three sample ideas grew from two confirmed memories.'); }, reduce ? 50 : 1250); }
  function reject(id, reason = constraint) {
    if (!reason) { setFocus(id); return; }
    setExcluded(old => ({...old, [id]: reason})); setConstraint(null); setFocus(id);
    if(selected === id) {setSelected(null); setApproved(false);setRevision(r=>r+1);}
    report(reason === 'owned' ? `You marked “${products[id].title}” as already owned. An experience takes its place.` : `You marked “${products[id].title}” too pricey. Lower-priced ideas stay in view.`);
  }
  function choose(id) { if(excluded[id]) return; setSelected(id); setFocus(id); setFocusMemory(null); setApproved(false); setRevision(r => r + 1); report(`“${products[id].title}” is in the sample box. Previous approvals reset.`); }
  function jump(n) { reset(); if(n>0)setExpanded(true); if(n>1){setExcluded({kit:'owned'});setVibe(true);} if(n>2){setSelected('class');setFocus('class');setRevision(1);} }
  function play() { reset(); setPlaying(true); setGrowing(true); report('Scout is following Jon’s pottery memory… (simulated)'); later(()=>{setGrowing(false);setExpanded(true);report('Three sample ideas grew from two confirmed memories.');},1250); later(()=>{setVibe(true);report('“Handmade” gathers the closest ideas. No new search.');},2700); later(()=>reject('kit','owned'),4400); later(()=>choose('class'),6500); later(()=>{setApproved(true);report('Demo: three friends approved revision 1. Ready to wrap.');},8700); later(()=>setPlaying(false),10200); }
  const visible = expanded ? ['kit','mug','wheel', ...(excluded.kit ? ['class'] : [])] : [];
  const positions = {kit: [67, 6], mug: [69, 37], wheel: [66, 68], class: [43, 30]};
  const paths = visible.map(id => { const [x,y] = positions[id]; return {id, d:`M 338 220 C 480 220, ${x*10-80} ${y*6.3+68}, ${x*10} ${y*6.3+68}`}; });
  function productClick(id) { if(dragMoved.current) return; setFocusMemory(null); constraint ? reject(id) : setFocus(id); }
  function visitMemory(id) {setFocus(null);setFocusMemory(id);setMemoryDraft(memories[id]);if(id==='handmade'){setVibe(v=>!v);if(!expanded)grow();}else grow();}
  const productCard = (id, isMobile=false) => {
    const p = products[id], gone=!!excluded[id];
    return <motion.article key={id} layout className={`product ${p.hue} ${gone?'excluded':''} ${vibe && id==='mug'?'attracted':''} ${focus===id?'focused':''} ${selected===id?'chosen':''}`}
      style={isMobile ? {} : {left:positions[id][0]+'%',top:positions[id][1]+'%'}}
      initial={{opacity:0,scale:.65,y:25}} animate={{opacity:gone?.4:1,scale:vibe&&id==='mug'?1.04:1,y:vibe&&id==='mug'?-16:0}} exit={{opacity:0,scale:.7}}
      transition={{type:'spring',stiffness:170,damping:21,delay:reduce?0:visible.indexOf(id)*.08}}
      drag={!isMobile&&!gone} dragSnapToOrigin dragMomentum={false} whileDrag={{scale:1.04,zIndex:20,rotate:3}}
      onDragStart={()=>{dragMoved.current=true;}}
      onDragEnd={(_,info)=>{const r=box.current?.getBoundingClientRect();if(r && info.point.x>=r.left && info.point.x<=r.right && info.point.y>=r.top && info.point.y<=r.bottom) choose(id);setTimeout(()=>{dragMoved.current=false;},100);}}
      onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const reason=e.dataTransfer.getData('constraint');if(reason)reject(id,reason);}}
      onClick={()=>productClick(id)}>
      <button className="product-main" onClick={()=>{}} aria-label={`Inspect ${p.title}`}><Art kind={p.art}/><div className="product-copy"><span className="eyebrow">{gone?(excluded[id]==='owned'?'Already owns · undo below':'Too pricey · undo below'):p.tag}</span><strong>{p.title}</strong><span className={'price '+(p.price>80?'over':'')}>${p.price}<small>{p.price>80?'over $80 budget':'sample price'}</small></span></div></button>
      {!gone && <button className="add-button" aria-label={`Put ${p.title} in the box`} onClick={e=>{e.stopPropagation();choose(id);}}>{selected===id?'In the box ✓':'Put in box ↗'}</button>}
      {gone && <button className="add-button" onClick={e=>{e.stopPropagation();setExcluded(old=>{const copy={...old};delete copy[id];return copy;});report('Constraint undone. The idea returns.');}}>Undo constraint</button>}
    </motion.article>;
  };
  return <MotionConfig reducedMotion={reduce?'always':'user'}><div className={`lab ${variant} ${view==='phone'?'phone-preview':''} ${reduce?'reduce-motion':''}`}>
    <div className="lab-chrome"><div><span className="lab-dot"/> UNWRAP / VISION LAB <span className="lab-caption">Interactive concept · not the live app</span></div><div className="lab-controls"><div className="segmented"><button aria-pressed={variant==='sky'} onClick={()=>setVariant('sky')}>Sky tree</button><button aria-pressed={variant==='parchment'} onClick={()=>setVariant('parchment')}>Earlier paper study</button></div><div className="segmented"><button aria-pressed={view==='desktop'} onClick={()=>setView('desktop')}>Desktop</button><button aria-pressed={view==='phone'} onClick={()=>setView('phone')}>Phone</button></div></div></div>
    <div className="app-window">
      <header className="app-header"><a className="wordmark" href="#" onClick={e=>e.preventDefault()}>unwrap<span>.</span></a><span className="divider"/><div><strong>Maya’s birthday</strong><small>Something that feels like her</small></div><div className="friends"><Person name="You" color="#dcd8f1" image="./curious.png"/><Person name="Jon" color="#d9b66f" image="./explorer.png"/><Person name="Ally" color="#d59b87" image="./kind.png"/></div><span className="budget-pill">Our budget <strong>$80</strong></span></header>
      <div className="page-heading"><div><span className="eyebrow">A LITTLE WORLD, GROWN FROM YOUR MEMORIES</span><h1>{variant==='sky'?'Every memory grows a little world.':<>Follow a memory.<br className="phone-only"/> Find their gift.</>}</h1><p>{variant==='sky'?'Visit a friend. Follow their branch. Find something that feels like Maya.':'Small things you remember. Ideas that grow from them.'}</p></div><button className="play-button" disabled={playing} onClick={play}>{playing?'Playing the story…':'▷ Play the 10-second story'}</button></div>
      <div className="workspace">
        <section className="board" aria-label="Interactive gift map">
          <div className="board-top"><span className="board-label">{variant==='sky'?'Maya’s memory tree':'Maya’s constellation'}</span><span className="sample-label">Sample memories & illustrative prices</span></div>
          {variant==='sky'?<SkyTree expanded={expanded} growing={growing} excluded={excluded} vibe={vibe} selected={selected} approved={approved} focus={focus} reduce={reduce} products={products} memories={memories} onMemory={visitMemory} onProduct={(id,reason)=>reason?reject(id,reason):productClick(id)} onChoose={choose} onUndo={id=>{setExcluded(old=>{const copy={...old};delete copy[id];return copy;});report('The branch is restored.');}}/>:<div className="map-content">
            <svg className="connections" viewBox="0 0 1000 630" preserveAspectRatio="none" aria-hidden="true"><path className="root-path" d="M 275 220 C 380 220 330 405 470 435"/><path className="root-path" d="M 200 405 C 300 405 330 435 470 435"/><path className="root-path" d="M 145 540 C 340 570 300 440 470 435"/>{paths.map(({id,d})=><motion.path key={id} d={d} className={'branch '+(excluded[id]?'removed':'')+(vibe&&id==='mug'?' warm':'')} initial={{pathLength:0,opacity:0}} animate={{pathLength:1,opacity:1}} transition={{duration:reduce?0:.85,delay:reduce?0:visible.indexOf(id)*.12}}/>)}</svg>
            <div className="map-note">a few little things<br/>only friends would know <span>↘</span></div>
            <motion.button className={'memory pottery '+(growing?'growing':'')} style={{left:'10%',top:'20%'}} whileHover={{rotate:-1,scale:1.025}} onClick={grow} aria-label="Explore pottery memory"><span className="memory-owner"><img src="./explorer.png" alt=""/> Jon remembers</span><strong>“She keeps talking<br/>about pottery.”</strong><span className="memory-foot">Confirmed clue <b>{growing?'Following the thread…':expanded?'3 ideas found':'Explore this memory ↗'}</b></span><span className="seed-pin"/></motion.button>
            <motion.button className="memory coffee" style={{left:'7%',top:'55%'}} whileHover={{rotate:1,scale:1.025}} onClick={()=>{grow();setFocus('mug');}} aria-label="Explore slow Sunday mornings"><span className="memory-owner"><img src="./kind.png" alt=""/> Ally remembers</span><strong>“Coffee. A book.<br/>A slow Sunday.”</strong><span className="memory-foot">Confirmed clue <b>Little everyday rituals</b></span><span className="seed-pin"/></motion.button>
            <div className="tiny-memory"><span>You remembered</span><strong>She loves handmade things.</strong></div>
            <AnimatePresence>{growing&&<motion.div className="searching" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><span className="thinking-dot"/> Scout is following this thread…</motion.div>}{vibe&&<motion.div className="vibe-magnet" initial={{scale:0}} animate={{scale:1}}><span>handmade</span><small>a direction, not a rule</small></motion.div>}</AnimatePresence>
            <AnimatePresence>{visible.map(id=>productCard(id))}</AnimatePresence>
            <motion.div ref={box} className={'gift-node '+(selected?'has-gift':'')+(approved?' is-approved':'')} animate={{rotate:selected&&selectedProduct.price>80?[0,-3,3,-3,0]:0}} onDragOver={e=>e.preventDefault()}>
              <Gift filled={!!selected} wrapped={approved}/><div className="box-caption"><span>{approved?'READY TO WRAP':selected?'OUR GIFT · REVISION '+revision:'A GIFT, STILL BECOMING'}</span><strong>{selected?selectedProduct.title:'A little box of possibility'}</strong><small>{selected?`$${selectedProduct.price} of $80 · ${selectedProduct.price>80?'over budget':'item only; shipping unknown'}`:'Drag an idea here, or use “Put in box”'}</small></div>
              {selected&&<div className="budget-track"><motion.div initial={{width:0}} animate={{width:Math.min(selectedProduct.price/80*100,100)+'%'}} className={selectedProduct.price>80?'over':''}/></div>}
            </motion.div>
          </div>}
          <div className="phone-board"><div className="phone-memory"><span className="eyebrow">JON REMEMBERS</span><h2>“She keeps talking<br/>about pottery.”</h2><button className="primary" onClick={grow} disabled={growing||expanded}>{growing?'Following the thread…':expanded?'Ideas found below':'Explore this memory ↗'}</button></div><div className="phone-products">{visible.map(id=>productCard(id,true))}</div><div className="phone-box"><Gift filled={!!selected} wrapped={approved}/><strong>{selected?selectedProduct.title:'Your gift box'}</strong><span>{selected?`$${selectedProduct.price} of $80`:'Choose one thoughtful gift'}</span></div></div>
          <div className="board-bottom"><span><i className="legend-dot clue"/> A friend’s clue</span><span><i className="legend-dot idea"/> A sourced idea</span><span className="gesture-hint">Tap to explore · drag to choose</span></div>
        </section>
        <aside className="inspector">
          {focusMemory&&<div className="memory-editor"><span className="eyebrow">YOU’RE VISITING {focusMemory==='pottery'?'JON':focusMemory==='coffee'?'ALLY':'YOUR LITTLE FRIEND'}</span><h3>A memory can change.</h3><label htmlFor="memory-draft">Edit this sample memory</label><textarea id="memory-draft" value={memoryDraft} maxLength={120} onChange={e=>setMemoryDraft(e.target.value)}/><button className="primary" disabled={!memoryDraft.trim()} onClick={()=>{setMemories(m=>({...m,[focusMemory]:memoryDraft.trim()}));report('Memory updated. Its island now tells the new story. Branches stay illustrative in this prototype.');}}>Save this memory</button></div>}
          <div className="direction"><span className="eyebrow">GIVE IT A LITTLE DIRECTION</span><h2>Less searching.<br/>More “that’s her.”</h2><p>Choose a feeling. Watch the closest ideas gather.</p><button className={'vibe-button '+(vibe?'active':'')} aria-pressed={vibe} onClick={()=>{setVibe(v=>!v);if(!expanded)grow();report(vibe?'Handmade direction removed.':'“Handmade” brings the ceramic idea closer. Layout only; no paid search.');}}>✧ Handmade <span>{vibe?'✓':'+'}</span></button></div>
          <div className="constraints"><span className="eyebrow">A LITTLE COURSE CORRECTION</span><p>Drag a card onto an idea, or choose a card and tap an idea.</p><div className="constraint-row"><button draggable className={'constraint-card '+(constraint==='owned'?'armed':'')} aria-pressed={constraint==='owned'} onDragStart={e=>e.dataTransfer.setData('constraint','owned')} onClick={()=>setConstraint(constraint==='owned'?null:'owned')}>Already has it <span>↘</span></button><button draggable className={'constraint-card '+(constraint==='price'?'armed':'')} aria-pressed={constraint==='price'} onDragStart={e=>e.dataTransfer.setData('constraint','price')} onClick={()=>setConstraint(constraint==='price'?null:'price')}>Too pricey <span>↘</span></button></div>{constraint&&<p className="armed-hint" role="status">Now choose an idea to apply “{constraint==='owned'?'Already has it':'Too pricey'}”.</p>}</div>
          <AnimatePresence mode="wait"><motion.div className="why-panel" key={focus||'empty'} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}><span className="eyebrow">{focusProduct?'FOLLOW THE THREAD':'NOT JUST A GUESS'}</span><h3>{focusProduct?focusProduct.title:'Every idea begins with someone.'}</h3><p>{focusProduct?focusProduct.why:'Visit a little friend or gift island. Each branch remembers where it came from.'}</p>{focusProduct&&<><div className="source-thread"><span>Jon’s memory</span><b>→</b><span>{focus==='mug'?'Ally’s ritual':'Pottery direction'}</span></div><small>{focusProduct.note}</small><small className="fiction-label">Prototype illustration · fictional listing</small>{variant==='sky'&&<div className="island-detail-actions"><button onClick={()=>reject(focus,'owned')}>Already has it</button><button onClick={()=>reject(focus,'price')}>Too pricey</button>{!excluded[focus]&&<button className="primary" onClick={()=>choose(focus)}>Send to gift island ↗</button>}</div>}</>}</motion.div></AnimatePresence>
          {selected&&<motion.div className="approval-panel" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}><span className="eyebrow">ONE GIFT. ONE SHARED YES.</span><h3>Revision {revision} · ${selectedProduct.price}</h3><p>{approved?'3 of 3 sample approvals. A change to the gift resets them.':'Friends approve this exact gift and their shares.'}</p><button className="primary" disabled={approved||selectedProduct.price>80} onClick={()=>{setApproved(true);report('Demo: all three friends approved this exact revision.');}}>{approved?'All approved · ready to wrap ✓':selectedProduct.price>80?'Choose an idea under $80':'Simulate group approval'}</button></motion.div>}
        </aside>
      </div>
      <div className="agent-strip"><div className="agent-mark"><img src="./calm.png" alt=""/></div><div aria-live="polite"><span className="eyebrow">THE COUNCIL’S NOTEBOOK · SIMULATED</span><p>{log[0]}</p></div><button onClick={reset}>Start again ↺</button></div>
    </div>
    <footer className="review-controls"><div className="story-steps" aria-label="Preview different moments">{steps.map((s,i)=><button key={s} aria-pressed={stage===i} onClick={()=>jump(i)}><span>{i+1}</span>{s}</button>)}</div><label><input type="checkbox" checked={reduce} onChange={e=>setReduce(e.target.checked)}/> Reduce motion</label></footer>
    <div className="prototype-note">Design study only. Memories, prices, products, agent progress and approvals are simulated. Nothing is saved to Convex; no API calls or purchases.</div>
  </div></MotionConfig>;
}
createRoot(document.getElementById('root')).render(<App/>);
