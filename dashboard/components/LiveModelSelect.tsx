"use client";
import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import Select from './Select';
import InfoTooltip from './InfoTooltip';
import {GEMINI_LIVE_MODELS,isLiveModelId} from '@/lib/native-voice';

type Catalog={models:{id:string;label:string;status:string;compatible?:boolean;reason?:string}[];stale:boolean;credentialSource:string;error?:string};
export default function LiveModelSelect({saved}:{saved:string}) {
  const [catalog,setCatalog]=useState<Catalog|null>(null);
  const [revision,setRevision]=useState(0);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();
    fetch(`/api/voice/live-models${revision?'?refresh=1':''}`,{signal:controller.signal})
      .then(response=>{if(!response.ok)throw new Error('Unavailable');return response.json();})
      .then(setCatalog).catch(()=>{if(!controller.signal.aborted)setCatalog({models:GEMINI_LIVE_MODELS.map(id=>({id,label:id,status:'unverified'})),stale:true,credentialSource:'unknown'});})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[revision]);
  const models:Catalog['models']=catalog?.models||GEMINI_LIVE_MODELS.map(id=>({id,label:id,status:'unverified'}));
  const options=models.map(model=>({value:model.id,label:model.label,disabled:model.compatible===false||!isLiveModelId(model.id),description:model.reason||(model.status==='listed'?'Listed by Google for Live API; call compatibility is not yet tested':'Discovery unavailable; verify access before calling')}));
  if(!options.some(model=>model.value===saved)) options.unshift({value:saved,label:saved,disabled:!isLiveModelId(saved),description:'Saved selection; not present in the current provider list'});
  return <div className="space-y-2">
    <Select name="realtimeModel" ariaLabel="Realtime audio model" defaultValue={saved} options={options}/>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
      <span role="status" className="flex items-center">{loading?'Loading Live models…':catalog?.stale?'Model list unverified':`${models.length} Live models · ${options.filter(option=>!option.disabled).length} for voice agents`}
        <InfoTooltip width={310}>Google Gemini API · {catalog?.credentialSource==='organization'?'saved provider key':catalog?.credentialSource==='server'?'server key':'key source unverified'}. Charges follow the Google project linked to the effective API key. Provider keys override the server key. This app cannot read its credit balance. Listed models are not a paid call test. Saved model and voice stay unchanged until you save.</InfoTooltip>
      </span>
      <button type="button" aria-label="Refresh Live models" disabled={loading} className="inline-flex items-center gap-1 rounded px-1 py-1 text-[var(--accent)] disabled:opacity-50" onClick={()=>{setLoading(true);setRevision(value=>value+1);}}><RefreshCw size={12}/>Refresh</button>
    </div>
  </div>;
}
