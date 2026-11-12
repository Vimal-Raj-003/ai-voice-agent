import Link from 'next/link';
import {prisma} from '@/lib/prisma';
import {getDefaultOrg} from '@/lib/org';
import AssistantForm from '@/components/AssistantForm';
import {TEMPLATES} from '@/lib/assistant-templates';

export const dynamic='force-dynamic';

export default async function NewAssistantPage({searchParams}:{searchParams:Promise<{template?:string}>}){
  const {template}=await searchParams;
  const selected=TEMPLATES.find(t=>t.id===template);
  const org=await getDefaultOrg();
  const tools=await prisma.tool.findMany({where:{organizationId:org.id},orderBy:{name:'asc'},select:{id:true,name:true,description:true,isActive:true}});
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
      <Link href="/assistants" className="text-sm text-violet-300 underline-offset-4 hover:underline">Back to assistants</Link>
      <form action="/assistants/new" className="flex flex-wrap items-center gap-2">
        <label htmlFor="assistant-template" className="text-sm text-gray-400">Start from</label>
        <select id="assistant-template" name="template" defaultValue={selected?.id||'blank'} className="max-w-full rounded-lg border border-white/15 bg-[var(--bg-base)] px-3 py-2 text-sm text-fg focus-visible:outline-violet-400">
          <option value="blank">Blank assistant</option>
          {TEMPLATES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button type="submit" title="Load the selected template; replaces unsaved fields." className="rounded-lg border border-white/15 px-3 py-2 text-sm text-fg hover:bg-violet-400/10">Load template</button>
      </form>
    </div>
    <AssistantForm key={selected?.id||'blank'} mode="create" title="Create assistant" initial={selected?.seed} tools={tools}/>
  </div>;
}
