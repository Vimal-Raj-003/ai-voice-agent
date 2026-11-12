import DemoWorkspace from "@/components/DemoWorkspace";
import { voiceService } from "@/lib/voice-service";
import {prisma} from "@/lib/prisma";
import {getDefaultOrg} from "@/lib/org";
import {voiceSettings} from "@/lib/native-voice";

export const dynamic='force-dynamic';

export default async function DemoPage({searchParams}:{searchParams:Promise<{assistant?:string}>}) {
  const requested=(await searchParams).assistant;
  const config = await voiceService.demoConfig().catch(() => null);
  const org=await getDefaultOrg();
  const rows=await prisma.assistant.findMany({where:{organizationId:org.id,isActive:true},orderBy:{name:'asc'},select:{id:true,name:true,metadata:true}});
  const assistants=rows.map(row=>{const saved=voiceSettings(row.metadata);return {id:row.id,assistant_name:row.name,engine:saved.engine,model:saved.model,voice:saved.voice,sandbox:true};});
  const initialAssistantId=assistants.find(a=>a.id===requested)?.id||assistants.find(a=>a.id===config?.assistant_id)?.id||assistants[0]?.id||'';
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Demo</h1>
      <DemoWorkspace assistants={assistants} initialAssistantId={initialAssistantId}/>
    </div>
  );
}
