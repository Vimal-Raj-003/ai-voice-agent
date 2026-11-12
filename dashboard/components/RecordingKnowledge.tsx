"use client";
import {useRef,useState} from "react";
import {Loader2,Upload,Trash2,AudioLines} from "lucide-react";
import InfoTooltip from "./InfoTooltip";
import type {RecordingReferencesState} from "@/lib/useRecordingReferences";

export default function RecordingKnowledge({references,onUploaded}:{references:RecordingReferencesState;onUploaded:()=>void}) {
  const [file,setFile]=useState<File|null>(null);
  const [consent,setConsent]=useState(false);
  const input=useRef<HTMLInputElement>(null);
  const {busy,error,setError,request}=references;
  async function upload(){
    if(!file)return;
    if(file.size>8*1024*1024){setError("Choose a recording smaller than 8 MB.");return;}
    const body=new FormData();body.set("file",file);body.set("analysisConsent","yes");
    if(await request("",{method:"POST",body})){
      setFile(null);if(input.current)input.current.value="";onUploaded();
    }
  }
  return <div className="space-y-3 pt-2">
    <div className="flex items-center text-sm text-gray-300">Conversation recording
      <InfoTooltip width={340}>Learn everyday words, Tamil/Tanglish switches, rhythm and situation-appropriate tone from a conversation. Audio is decoded locally to mono FLAC before Gemini analysis. Temporary provider errors can use a second analysis model, with two requests maximum. Review and enable the profile in Uploaded Files for new calls. This guides your selected voice; it does not clone a speaker or replace business instructions. WAV, MP3, M4A, AAC, OGG or FLAC; up to 8 MB and 10 minutes. Audio is not retained.</InfoTooltip>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <input ref={input} type="file" aria-label="Conversation recording" accept=".wav,.mp3,.m4a,.aac,.ogg,.flac" disabled={busy}
        onChange={e=>{setFile(e.target.files?.[0]||null);setError("");}}
        className="block min-w-0 flex-1 basis-64 rounded-lg border border-white/10 p-2 text-sm file:mr-2 file:rounded file:border-0 file:bg-violet-500/20 file:px-3 file:py-2 file:text-[var(--text-primary)]"/>
      <button type="button" disabled={!file||!consent||busy} onClick={()=>void upload()}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-500/20 px-3 py-2 text-sm text-violet-200 disabled:opacity-40">
        {busy?<Loader2 size={16} className="animate-spin"/>:<Upload size={16}/>} Upload &amp; analyze
      </button>
    </div>
    <div className="flex items-center gap-1 text-xs text-gray-300">
      <label className="flex min-h-8 items-center gap-2"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} className="accent-violet-400"/>
        I have permission to send this audio to Gemini.</label>
      <InfoTooltip>Only upload a conversation you have permission to use. Its audio is sent to your configured Gemini provider for style analysis. Up to six approved references can guide future calls.</InfoTooltip>
    </div>
    {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
  </div>;
}

export function RecordingList({references}:{references:RecordingReferencesState}) {
  const {rows,busy,loading,error,request}=references;
  return <div className="space-y-2">
    {loading&&<p role="status" className="text-xs text-gray-400">Loading recordings...</p>}
    {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
    {rows.map(row=><article key={row.id} className="rounded-lg border border-white/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 basis-48 items-center gap-2">
          <AudioLines size={16} className="shrink-0 text-violet-300"/>
          <div className="min-w-0"><h3 className="truncate text-sm font-medium" title={row.fileName}>{row.fileName}</h3>
            <div className="flex items-center gap-1 text-xs text-gray-400">
              {row.status==='PROCESSING'?'Analyzing':row.status==='READY'?(row.enabled?'Style enabled':'Ready to review'):row.retryable?'Provider unavailable — retry later':'Needs attention'} · {row.seconds}s
              {row.error&&<InfoTooltip width={330}>{row.error} Select the recording again under Recording to retry.</InfoTooltip>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {row.status==='READY'&&<button type="button" aria-pressed={row.enabled} disabled={busy}
            onClick={()=>void request('/'+row.id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!row.enabled})})}
            className="min-h-9 rounded-lg border border-violet-400/30 px-3 py-1.5 text-xs text-violet-200">{row.enabled?'Enabled for new calls':'Enable style'}</button>}
          <button type="button" aria-label={`Delete recording ${row.fileName}`} disabled={busy} onClick={()=>void request('/'+row.id,{method:"DELETE"})}
            className="rounded-lg p-2 text-gray-400 hover:text-red-300"><Trash2 size={16}/></button>
        </div>
      </div>
      {row.profile&&<details className="mt-2 text-sm text-gray-300">
        <summary className="cursor-pointer py-1 text-xs text-violet-200">Review speaking style</summary>
        <div className="space-y-2 pt-2"><p>{row.profile.summary}</p>
          <ul className="list-disc space-y-1 pl-5">{row.profile.guidance.map((rule,i)=><li key={i}>{rule}</li>)}</ul>
          {!!row.profile.wordChoices.length&&<dl className="grid gap-2 sm:grid-cols-2">{row.profile.wordChoices.map((choice,i)=><div key={i}><dt className="text-xs text-gray-400">Instead of {choice.avoid}</dt><dd>{choice.prefer}</dd></div>)}</dl>}
          {!!row.profile.examples.length&&<details><summary className="cursor-pointer py-1 text-xs text-violet-200">Example replies</summary><ul className="list-disc space-y-1 pl-5">{row.profile.examples.map((example,i)=><li key={i}>{example}</li>)}</ul></details>}
        </div>
      </details>}
    </article>)}
  </div>;
}
