import {prisma} from '@/lib/prisma';
import {getDefaultOrg} from '@/lib/org';
import SavedToast from '@/components/SavedToast';
import AssistantLibrary from '@/components/AssistantLibrary';
import {voiceSettings} from '@/lib/native-voice';

export default async function AssistantsPage(){
  const {id:orgId}=await getDefaultOrg();
  const rows=await prisma.assistant.findMany({where:{organizationId:orgId},orderBy:{name:'asc'}});
  // Knowledge tables are owned by the voice service, outside Prisma's models.
  const sources=await prisma.$queryRaw<{assistant_id:string;count:number}[]>`
    SELECT s.assistant_id,count(*)::int AS count FROM knowledge_sources s
    JOIN assistants a ON a.id=s.assistant_id WHERE a."organizationId"=${orgId}
    GROUP BY s.assistant_id`;
  const counts=new Map(sources.map(s=>[s.assistant_id,s.count]));
  const assistants=rows.map(a=>{
    const meta=(a.metadata||{}) as Record<string,unknown>;const voice=voiceSettings(a.metadata);
    const native=voice.engine==='gemini-live'||voice.engine==='gpt-live';
    const languageNames:Record<string,string>={ta:'Tamil',en:'English',te:'Telugu',ml:'Malayalam',hi:'Hindi',kn:'Kannada',mr:'Marathi',bn:'Bengali',gu:'Gujarati',pa:'Punjabi',ur:'Urdu',es:'Spanish',fr:'French',de:'German',ar:'Arabic',zh:'Chinese',ja:'Japanese',ko:'Korean',pt:'Portuguese'};
    const languages=native
      ? ['Tamil','Tanglish','English','Telugu','Malayalam','Hindi','Kannada','Marathi','Bengali','Gujarati','Punjabi','Urdu','Spanish','French','German','Arabic','Chinese','Japanese','Korean','Portuguese'].filter(name=>new RegExp(`\\b${name}\\b`,'i').test(a.systemPrompt))
      : a.sttLanguage==='multi'||a.sttLanguage==='unknown'||a.sttLanguage==='auto'?['Auto-detect']: [languageNames[a.sttLanguage.split('-')[0]]||a.sttLanguage];
    const role=typeof meta.roleKey==='string'?meta.roleKey:a.name.toLowerCase().includes('vasan')?'vasan':a.name.toLowerCase().includes('appointment')?'appointment':a.name.toLowerCase().includes('support')?'support':a.name.toLowerCase().includes('sales')?'sales':a.name.toLowerCase().includes('marketing')?'marketing':'receptionist';
    return {id:a.id,name:a.name,description:a.description,active:a.isActive,role,engine:voice.engine==='gemini-live'?'Gemini Live':voice.engine==='gpt-live'?'GPT-Live':'STT / LLM / TTS',model:voice.engine==='gemini-live'?voice.model:voice.engine==='gpt-live'?'gpt-live-1':a.llmModel,voice:voice.engine==='gemini-live'?voice.voice:voice.engine==='gpt-live'?String((meta.voiceRuntime as Record<string,unknown>|undefined)?.voice||''):a.voiceId||'',languages,knowledge:counts.get(a.id)||0,setupRequired:meta.setupRequired===true};
  });
  let previews:Record<string,boolean>={};
  try{
    const response=await fetch(`${process.env.VOICE_SERVICE_URL||'http://127.0.0.1:8000'}/api/assistant-voice-previews`,{method:'POST',headers:{Authorization:`Bearer ${process.env.VOICE_SERVICE_TOKEN||''}`,'Content-Type':'application/json'},body:JSON.stringify({assistants:assistants.map(({id,model,voice})=>({id,model,voice}))}),cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(response.ok)previews=await response.json();
  }catch{/* Keep settings usable when the recording service is unavailable. */}
  return <><SavedToast message="Assistant saved successfully"/><AssistantLibrary assistants={assistants.map(a=>({...a,preview:previews[a.id]===true}))}/></>;
}
