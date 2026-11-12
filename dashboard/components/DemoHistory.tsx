"use client";
import {useEffect,useState} from "react";
import {RefreshCw} from "lucide-react";
import CallCostBreakdown from "./CallCostBreakdown";
import type {CostBreakdown} from "@/lib/cost";

import Money from "./Money";
import InfoTooltip from './InfoTooltip';
type Row={id:string;assistant:string|null;status:string;createdAt:string;durationSeconds:number|null;costUsd:number;modelCostUsd:number;costStatus:string;breakdown:CostBreakdown;usage?:{model:string|null;tokens:Record<string,number>;complete:boolean}|null};
const time=new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});

export default function DemoHistory({refreshKey=0}:{refreshKey?:number}){
  const [rows,setRows]=useState<Row[]>([]);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    const load=async()=>{
      try{
        const response=await fetch('/api/voice/calls?channel=demo&limit=12',{cache:'no-store',signal:controller.signal});
        if(!response.ok)throw new Error('Could not load demo history.');
        const data=await response.json();if(!controller.signal.aborted){setRows(data.calls||[]);setError('');}
      }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load demo history.');}
      finally{if(!controller.signal.aborted)setLoading(false);}
    };
    void load();const timer=setInterval(()=>void load(),8000);
    return()=>{controller.abort();clearInterval(timer);};
  },[refreshKey,refresh]);
  return <section className="glass flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Demo call history</h2>
      <button type="button" onClick={()=>setRefresh(value=>value+1)} className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs"><RefreshCw size={12}/>Refresh</button></div>
    <p className="mb-3 flex items-center text-xs text-gray-400">Separate cost for every demo<InfoTooltip width={330}>Calculated from the provider-reported audio/text tokens for this call and configured rates. No phone-carrier charge is added to browser demos. Unclassified tokens, missing media/storage charges, credits and tax prevent an exact invoice total. Usage appears after the call finishes.</InfoTooltip></p>
    {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
    {loading&&<p role="status" className="text-sm text-gray-400">Loading demos…</p>}
    {!loading&&!error&&!rows.length&&<p className="py-4 text-sm text-gray-400">No demo calls recorded yet.</p>}
    <div className="min-h-0 max-h-[45svh] flex-1 divide-y divide-white/10 overflow-y-auto lg:max-h-none">
      {rows.map(row=><article key={row.id} className="py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0"><h3 className="truncate text-sm font-medium">{row.assistant||'Assistant'}</h3>
            <p className="text-xs text-gray-400">{time.format(new Date(row.createdAt))} · {row.durationSeconds==null?'Duration pending':`${Math.floor(row.durationSeconds/60)}m ${row.durationSeconds%60}s`} · {row.status}</p></div>
          <div className="flex items-center gap-3 text-xs"><div className="text-right"><span className="font-medium">{row.costStatus==='pending'?'Usage pending':<>Call subtotal <Money usd={row.costUsd} decimals={2}/></>}</span>{row.costStatus!=='pending'&&<p className="mt-1 text-[11px] text-gray-400">{row.costStatus==='incomplete'?'Usage incomplete · ':'Estimated · '}{!!row.durationSeconds&&<><Money usd={row.costUsd*60/row.durationSeconds} decimals={2}/> / min</>}</p>}</div>
            <a href={`/calls/${row.id}/logs`} className="rounded-lg border border-white/10 px-2 py-1.5 text-violet-300">View logs</a></div>
        </div>
        {row.costStatus!=='pending'&&<details className="mt-2"><summary className="cursor-pointer text-xs text-violet-300">Cost breakdown</summary><div className="mt-2 space-y-2">
          {row.usage&&/^gemini-.*live/.test(row.usage.model||'')&&<div className="rounded-lg border border-white/10 p-3 text-xs text-gray-400"><div className="flex flex-wrap justify-between gap-2"><span>Metered voice model cost</span><span className="font-mono text-fg"><Money usd={row.modelCostUsd||0} decimals={4}/></span></div><p className="mt-1 break-all text-[11px]">{row.usage.model}</p><p className="mt-1">Each line below is recorded tokens ÷ 1,000,000 × its displayed rate. Input history can be billed again on each response; this is not a fixed per-minute tariff.</p><dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">{[['inputAudio','Audio input'],['inputText','Text input'],['outputAudio','Audio output'],['outputText','Text output']].map(([key,label])=><div key={key} className="flex flex-wrap justify-between gap-1"><dt>{label}</dt><dd className="tabular-nums">{(row.usage?.tokens[key]||0).toLocaleString('en-IN')} tokens</dd></div>)}</dl>{!!row.usage.tokens.unclassified&&<p className="mt-2">{row.usage.tokens.unclassified.toLocaleString('en-IN')} tokens lack a billing modality; excluded from the priced subtotal.</p>}{!!row.usage.tokens.cached&&<p className="mt-2">Cached usage is present; the provider invoice may differ from standard rates.</p>}</div>}
          <CallCostBreakdown breakdown={row.breakdown}/></div></details>}
      </article>)}
    </div>
  </section>;
}
