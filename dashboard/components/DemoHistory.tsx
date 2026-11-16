"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {ArrowUpRight,RefreshCw} from "lucide-react";
import {costPerMinute} from "@/lib/cost";
import Money from "./Money";

type Result={id:string;assistant:string|null;status:string;createdAt:string;durationSeconds:number|null;costUsd:number;costStatus:string};
const time=new Intl.DateTimeFormat("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Kolkata"});

// The demo page shows a result; Call history owns the full list and details.
export default function DemoHistory({refreshKey=0}:{refreshKey?:number}) {
  const [result,setResult]=useState<Result|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    let attempts=0;
    const load=async()=>{
      attempts++;
      try {
        const response=await fetch("/api/voice/calls?channel=demo&limit=1",{cache:"no-store",signal:controller.signal});
        if(!response.ok)throw new Error("Could not load the latest demo result.");
        const data=await response.json();
        if(controller.signal.aborted)return;
        const latest:Result|null=data.calls?.[0]??null;
        setResult(latest);setError("");
        // Worker usage can arrive shortly after the demo's disconnect callback.
        // Retry that fresh result briefly, even if its row already says completed.
        const waitingForUsage=refreshKey>0&&attempts<8&&(!latest||latest.costStatus==="incomplete");
        if(waitingForUsage||(latest&&(latest.costStatus==="pending"||["QUEUED","RINGING","IN_PROGRESS"].includes(latest.status))))timer=setTimeout(()=>void load(),8000);
      }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Could not load the latest demo result.");}
      finally{if(!controller.signal.aborted)setLoading(false);}
    };
    void load();
    return()=>{controller.abort();clearTimeout(timer);};
  },[refreshKey,refresh]);
  const perMinute=result?costPerMinute(result.costUsd,result.durationSeconds):null;
  return <section className="glass min-w-0 rounded-2xl p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold">Latest demo result</h2>
      <Link href="/contacts?section=calls&direction=DEMO" className="inline-flex min-h-9 items-center gap-1 text-sm text-violet-300 underline-offset-4 hover:underline">Demo call history <ArrowUpRight size={14} aria-hidden/></Link>
    </div>
    {loading&&<p role="status" className="mt-3 text-sm text-gray-400">Loading result…</p>}
    {error?<div className="mt-3 flex items-center gap-3"><p role="alert" className="text-sm text-red-300">{error}</p><button type="button" onClick={()=>setRefresh(value=>value+1)} className="inline-flex min-h-9 items-center gap-1 text-sm"><RefreshCw size={13}/>Retry</button></div>
      :result?<div className="mt-3 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-3">
        <div className="min-w-0"><h3 className="break-words text-sm font-medium">{result.assistant||"Assistant"}</h3>
          <p className="mt-1 text-xs text-gray-400">{time.format(new Date(result.createdAt))} · {result.durationSeconds==null?"Duration pending":`${Math.floor(result.durationSeconds/60)}m ${result.durationSeconds%60}s`} · {result.status}</p></div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div><p>{result.costStatus==="pending"?"Usage pending":<>Call subtotal <Money usd={result.costUsd} decimals={2}/></>}</p>
            {result.costStatus!=="pending"&&<p className="mt-1 text-xs text-gray-400">{result.costStatus==="incomplete"?"Usage incomplete":"Estimated"}{perMinute!=null&&<> · <Money usd={perMinute} decimals={2}/> / min</>}</p>}</div>
          <Link href={`/calls/${result.id}`} className="inline-flex min-h-9 items-center rounded-lg border border-white/10 px-3 text-sm">Recording &amp; cost</Link>
          <Link href={`/calls/${result.id}/logs`} className="inline-flex min-h-9 items-center rounded-lg border border-white/10 px-3 text-sm">View logs</Link>
        </div>
      </div>:!loading&&<p className="mt-3 text-sm text-gray-400">Your completed demo will appear here. All recordings, cost breakdowns and logs stay in Call history.</p>}
  </section>;
}
