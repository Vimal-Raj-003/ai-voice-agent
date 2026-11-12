import {auth} from '@/lib/auth';
import {prisma} from '@/lib/prisma';
import {getDefaultOrg} from '@/lib/org';
import {voiceSettings} from '@/lib/native-voice';

export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){
  if (!(await auth())?.user) return Response.json({error:'Unauthorized'},{status:401});
  const {id}=await params;const org=await getDefaultOrg();
  const assistant=await prisma.assistant.findFirst({where:{id,organizationId:org.id},select:{metadata:true,llmModel:true,voiceId:true}});
  if(!assistant)return Response.json({error:'Assistant not found'},{status:404});
  const settings=voiceSettings(assistant.metadata);
  const query=new URLSearchParams({model:settings.engine==='gemini-live'?settings.model:settings.engine==='gpt-live'?'gpt-live-1':assistant.llmModel,voice:settings.engine==='gemini-live'?settings.voice:assistant.voiceId||''});
  try{
    const response=await fetch(`${process.env.VOICE_SERVICE_URL||'http://127.0.0.1:8000'}/api/assistant-voice-previews/${encodeURIComponent(id)}?${query}`,{headers:{Authorization:`Bearer ${process.env.VOICE_SERVICE_TOKEN||''}`},cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)return Response.json({error:response.status===404?'Record a demo with this voice to add a preview.':'Preview unavailable. Please try again.'},{status:response.status===404?404:502});
    const headers:Record<string,string>={'Content-Type':'audio/wav','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
    const length=response.headers.get('content-length');
    if(length&&/^\d+$/.test(length))headers['Content-Length']=length;
    return new Response(response.body,{headers});
  }catch{return Response.json({error:'Voice service unavailable. Please try again.'},{status:502});}
}
