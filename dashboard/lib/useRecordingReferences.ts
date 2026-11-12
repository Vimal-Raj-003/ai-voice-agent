"use client";

import {useCallback, useEffect, useState} from "react";

export type SpeechProfile = {summary:string;guidance:string[];wordChoices:{avoid:string;prefer:string}[];examples:string[]};
export type RecordingReference = {id:string;fileName:string;seconds:number;status:string;enabled:boolean;error?:string;errorCode?:number;retryable?:boolean;profile?:SpeechProfile};

export function useRecordingReferences(assistantId:string) {
  const [rows,setRows]=useState<RecordingReference[]>([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const base=`/api/knowledge/${assistantId}/recordings`;
  const load=useCallback(async(signal?:AbortSignal)=>{
    const response=await fetch(base,{cache:"no-store",signal});
    const body=await response.json();
    if(!response.ok)throw new Error(body.detail||body.error||"Could not load recordings.");
    if(!signal?.aborted)setRows(Array.isArray(body.recordings)?body.recordings:[]);
  },[base]);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);
    void load(controller.signal).catch(e=>{
      if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Could not load recordings.");
    }).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[load]);
  const processing=rows.some(row=>row.status==="PROCESSING");
  useEffect(()=>{
    if(!processing)return;
    const controller=new AbortController();
    const timer=setInterval(()=>void load(controller.signal).catch(e=>{
      if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Could not refresh recordings.");
    }),3000);
    return()=>{clearInterval(timer);controller.abort();};
  },[load,processing]);
  const request=async(path:string,options:RequestInit)=>{
    setBusy(true);setError("");
    try{
      const response=await fetch(base+path,options);
      const body=await response.json();
      if(!response.ok)throw new Error(body.detail||body.error||"Recording could not be updated.");
      await load();return true;
    }catch(e){setError(e instanceof Error?e.message:"Recording could not be updated.");return false;}
    finally{setBusy(false);}
  };
  return {rows,busy,loading,error,setError,request};
}

export type RecordingReferencesState=ReturnType<typeof useRecordingReferences>;
