import {useEffect,useRef,useState} from 'react';

// Browser-only collaboration for design review. No accounts or hosted room backend.
export function useLocalRoom(actor){
  const roomId=new URLSearchParams(location.search).get('room')?.replace(/[^a-z0-9_-]/gi,'').slice(0,40)||'maya-guided';
  const key='unwrap-design-room:'+roomId;
  const client=useRef(crypto.randomUUID()).current;
  const records=useRef({}), counter=useRef(0), channel=useRef(null), remote=useRef({});
  const local=useRef({actor,x:null,y:null,held:null,hovered:null,heldAt:0});local.current.actor=actor;
  const [data,setData]=useState({}),[peers,setPeers]=useState([]),[online,setOnline]=useState(false);
  const newer=(a,b)=>!b||a.clock>b.clock||a.clock===b.clock&&a.client>b.client;
  const publish=()=>{const values=Object.fromEntries(Object.entries(records.current).filter(([k,r])=>k!=='__reset'&&newer(r,records.current.__reset)).map(([k,r])=>[k,r.value]));setData(values);};
  const persist=()=>{try{localStorage.setItem(key,JSON.stringify(records.current));}catch{}};
  const merge=incoming=>{let changed=false;for(const [k,r]of Object.entries(incoming??{})){if(!r||!Number.isSafeInteger(r.clock)||typeof r.client!=='string')continue;counter.current=Math.max(counter.current,r.clock);if(newer(r,records.current[k])){records.current[k]=r;changed=true;}}if(changed){publish();persist();}};
  const send=message=>channel.current?.postMessage({...message,client});
  const refreshPeers=()=>setPeers(Object.values(remote.current).filter(p=>Date.now()-p.seen<5000));
  useEffect(()=>{
    try{merge(JSON.parse(localStorage.getItem(key)||'{}'));}catch{}
    if(!('BroadcastChannel'in window))return;
    const ch=new BroadcastChannel(key);channel.current=ch;setOnline(true);
    ch.onmessage=({data:m})=>{
      if(!m||m.client===client)return;
      if(m.type==='hello'){send({type:'state',records:records.current});send({type:'presence',...local.current});}
      if(m.type==='state')merge(m.records);
      if(m.type==='presence'){remote.current[m.client]={...m,seen:Date.now()};refreshPeers();}
      if(m.type==='bye'){delete remote.current[m.client];refreshPeers();}
    };
    const storage=e=>{if(e.key===key&&e.newValue){try{merge(JSON.parse(e.newValue));}catch{}}};
    window.addEventListener('storage',storage);
    const leave=()=>send({type:'bye'});window.addEventListener('pagehide',leave);
    const heartbeat=setInterval(()=>{send({type:'presence',...local.current});refreshPeers();},1000);
    send({type:'hello'});send({type:'presence',...local.current});
    return()=>{send({type:'bye'});clearInterval(heartbeat);window.removeEventListener('storage',storage);window.removeEventListener('pagehide',leave);ch.close();channel.current=null;};
  },[key]);
  useEffect(()=>{send({type:'presence',...local.current});},[actor]);
  function update(fields){const incoming={};for(const[k,value]of Object.entries(fields)){incoming[k]={value,clock:++counter.current,client};}merge(incoming);send({type:'state',records:incoming});}
  function field(name,fallback){return [data[name]??fallback,value=>{const current=records.current[name];const prior=current&&newer(current,records.current.__reset)?current.value:fallback;update({[name]:typeof value==='function'?value(prior):value});}];}
  function presence(patch){Object.assign(local.current,patch);send({type:'presence',...local.current});}
  function holder(id){
    const all=[{...local.current,client},...Object.values(remote.current).filter(p=>Date.now()-p.seen<5000)];
    return all.filter(p=>p.held===id).sort((a,b)=>a.heldAt-b.heldAt||a.client.localeCompare(b.client))[0];
  }
  function claim(id){presence({held:id,heldAt:Date.now()});const owner=holder(id);if(owner?.client!==client){presence({held:null});return false;}return true;}
  return {data,peers,online,roomId,client,field,update,presence,claim,holder,release:()=>presence({held:null}),reset:()=>update({__reset:Date.now()}),vote:(id,value)=>update({['signal:'+id+':'+actor]:value})};
}
