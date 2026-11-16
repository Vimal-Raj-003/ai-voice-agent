import {auth} from '@/lib/auth';
import {getDefaultOrg} from '@/lib/org';
import {GEMINI_LIVE_MODELS} from '@/lib/native-voice';

export async function GET(request:Request) {
  if(!(await auth())?.user) return Response.json({error:'unauthorized'},{status:401});
  const org=await getDefaultOrg();
  const refresh=new URL(request.url).searchParams.get('refresh')==='1';
  try {
    const response=await fetch(`${process.env.VOICE_SERVICE_URL||'http://127.0.0.1:8000'}/api/voice/live-models?organization_id=${encodeURIComponent(org.id)}&refresh=${refresh}`,{
      headers:process.env.VOICE_SERVICE_TOKEN?{Authorization:`Bearer ${process.env.VOICE_SERVICE_TOKEN}`}:{},
      cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new Error('Discovery unavailable');
    return Response.json(await response.json());
  } catch {
    return Response.json({models:GEMINI_LIVE_MODELS.map(id=>({id,label:id,status:'unverified'})),
      stale:true,source:'fallback',credentialSource:'unknown',billingProject:null,error:'Live catalogue unavailable. Saved model is preserved.'});
  }
}
