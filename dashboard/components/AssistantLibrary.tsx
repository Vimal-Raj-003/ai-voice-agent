"use client";

import {useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import {GraduationCap,Headphones,HeartPulse,PhoneCall,Search,CalendarDays,Megaphone,Users,Workflow,Play,Pause,LoaderCircle} from 'lucide-react';
import InfoTooltip from './InfoTooltip';
import styles from './AssistantLibrary.module.css';

export type AssistantSummary={id:string;name:string;description:string|null;active:boolean;role:string;engine:string;model:string;voice:string;languages?:string[];knowledge:number;setupRequired:boolean;preview?:boolean};
const icons:Record<string,typeof Users>={academy:GraduationCap,clinic:HeartPulse,vasan:HeartPulse,ivr:Workflow,appointment:CalendarDays,support:Headphones,marketing:Megaphone,sales:PhoneCall,receptionist:Users};
const clock=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;

export default function AssistantLibrary({assistants}:{assistants:AssistantSummary[]}){
  const [query,setQuery]=useState('');
  const [playing,setPlaying]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [position,setPosition]=useState(0);
  const [duration,setDuration]=useState(0);
  const [audioId,setAudioId]=useState('');
  const audio=useRef<HTMLAudioElement>(null);
  const resources=useRef<{url:string;loadedId:string;request:AbortController|null;attempt:number}>({url:'',loadedId:'',request:null,attempt:0});
  const rows=useMemo(()=>assistants.filter(a=>`${a.name} ${a.description||''}`.toLowerCase().includes(query.trim().toLowerCase())),[assistants,query]);

  useEffect(()=>{
    const player=audio.current,media=resources.current;
    return ()=>{
      media.attempt++;media.request?.abort();player?.pause();
      if(media.url)URL.revokeObjectURL(media.url);
    };
  },[]);

  async function listen(assistant:AssistantSummary){
    const player=audio.current,media=resources.current;
    if(!player)return;
    if(audioId===assistant.id&&media.loadedId===assistant.id&&media.url){
      if(!player.paused){player.pause();return;}
      try{if(player.ended)player.currentTime=0;await player.play();}catch{setError('Preview could not play. Try again, or open Demo.');}
      return;
    }
    const attempt=++media.attempt;
    media.request?.abort();const request=new AbortController();media.request=request;
    player.pause();setPosition(0);setDuration(0);setAudioId(assistant.id);setError('');setLoading(true);
    try{
      const response=await fetch(`/api/assistants/${encodeURIComponent(assistant.id)}/voice-preview`,{signal:request.signal});
      if(!response.ok)throw new Error('Preview unavailable');
      const bytes=await response.arrayBuffer();
      if(attempt!==media.attempt)return;
      if(media.url)URL.revokeObjectURL(media.url);
      media.url=URL.createObjectURL(new Blob([bytes],{type:response.headers.get('content-type')||'audio/wav'}));
      media.loadedId=assistant.id;
      player.src=media.url;await player.play();
    }catch{if(attempt===media.attempt&&!request.signal.aborted)setError('Preview unavailable. Use Demo to hear this assistant.');}
    finally{if(attempt===media.attempt)setLoading(false);}
  }

  return <div className={styles.library}>
    <header className={styles.header}>
      <div><h1>Assistants <span>{assistants.length}</span></h1><p>Open an assistant to manage its instructions and call settings.</p></div>
      <Link href="/assistants/new" className={styles.create}>Create assistant</Link>
    </header>
    <section className={styles.theatre} aria-label="Your assistants">
      <div className={styles.toolbar}>
        <span className={styles.sampleNote}>Test voice samples<InfoTooltip>Existing greeting samples. Playing these makes no new model request. Use Demo for a live conversation.</InfoTooltip></span>
        <label className={styles.search}><Search size={16} aria-hidden="true"/><input aria-label="Search assistants" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search assistants…"/></label>
      </div>
      <div className={styles.stage}>
        {rows.map(assistant=>{
          const Icon=icons[assistant.role]||Users;const isPlaying=playing&&audioId===assistant.id;
          return <article key={assistant.id} className={styles.station} data-playing={isPlaying}>
            <Link href={`/assistants/${assistant.id}`} aria-label={`Configure ${assistant.name}`} className={styles.orb}>
              <Icon size={37} strokeWidth={1.6} aria-hidden="true"/>
              <h2>{assistant.name}</h2><span className={styles.status}><i data-active={assistant.active}/>{assistant.active?'Active':'Inactive'}</span>
            </Link>
            <span className={styles.plinth} aria-hidden="true"/>
            <span className={styles.voice}>{assistant.voice||assistant.engine}</span>
            {assistant.preview?<button type="button" className={styles.listen} aria-label={`${isPlaying?'Pause':'Listen to'} ${assistant.name} voice preview`} aria-pressed={isPlaying} onClick={()=>listen(assistant)}>
              {loading&&audioId===assistant.id?<LoaderCircle size={14} className={styles.spinner}/>:isPlaying?<Pause size={14}/>:<Play size={14}/>}{isPlaying?'Pause':'Listen'}
            </button>:<Link href={`/demo?assistant=${encodeURIComponent(assistant.id)}`} className={styles.listen}>Try Demo</Link>}
          </article>;
        })}
        {!rows.length&&<div className={styles.empty}><h2>No assistants found</h2><p>Try another name or clear your search.</p><button type="button" onClick={()=>setQuery('')}>Clear search</button></div>}
      </div>
    </section>
    <audio ref={audio} preload="none" onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}
      onTimeUpdate={()=>setPosition(audio.current?.currentTime||0)} onLoadedMetadata={()=>{const value=audio.current?.duration;if(value&&Number.isFinite(value))setDuration(value);}}
      onError={()=>{setPlaying(false);setLoading(false);setError('Preview unavailable. Use Demo to hear this assistant.');}}/>
    {audioId&&<div className={styles.progress}><label htmlFor="voice-preview-position">{assistants.find(a=>a.id===audioId)?.name}</label>
      <input id="voice-preview-position" type="range" aria-label="Voice preview position" min={0} max={duration||1} step={.05} value={Math.min(position,duration||1)} disabled={!duration}
        onChange={event=>{const value=Number(event.target.value);if(audio.current)audio.current.currentTime=value;setPosition(value);}}/>
      <span>{clock(position)} / {duration?clock(duration):'—:—'}</span></div>}
    {error&&<p role="alert" className={styles.error}>{error}</p>}
  </div>;
}
