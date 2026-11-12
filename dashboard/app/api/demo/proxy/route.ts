import { voiceService } from "@/lib/voice-service";
import { auth } from "@/lib/auth";
import {prisma} from "@/lib/prisma";
import {getDefaultOrg} from "@/lib/org";

// Middleware skips /api/demo/proxy, so the session is checked here before
// a voice-agent session is spawned (this costs paid API usage).
export async function POST(request:Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body=await request.json().catch(()=>({}));
    const assistantId=typeof body.assistantId==='string'?body.assistantId:undefined;
    const org=await getDefaultOrg();
    if(assistantId&&!await prisma.assistant.findFirst({where:{id:assistantId,organizationId:org.id,isActive:true},select:{id:true}}))
      return Response.json({error:'Assistant not found.'},{status:404});
    const t = await voiceService.demoToken(assistantId,org.id);
    return Response.json(t);
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    return Response.json({ error: msg }, { status: 502 });
  }
}
