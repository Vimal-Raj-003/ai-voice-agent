import {auth} from "@/lib/auth";
import {prisma} from "@/lib/prisma";
import {getDefaultOrg} from "@/lib/org";
import {requireRole} from "@/lib/require-role";

export const dynamic = "force-dynamic";
type Context = {params:Promise<{assistantId:string;reference?:string[]}>};
async function proxy(req:Request, context:Context) {
  const session = await auth();
  if (!session?.user) return Response.json({error:"unauthorized"},{status:401});
  if (req.method !== "GET") await requireRole("ADMIN");
  const {assistantId,reference=[]} = await context.params;
  const org = await getDefaultOrg();
  if (!await prisma.assistant.findFirst({where:{id:assistantId,organizationId:org.id},select:{id:true}}))
    return Response.json({error:"Assistant not found"},{status:404});
  if (reference.length>1) return Response.json({error:"Not found"},{status:404});
  const base = process.env.VOICE_SERVICE_URL || "http://127.0.0.1:8000";
  const token = process.env.VOICE_SERVICE_TOKEN;
  const headers:Record<string,string> = token ? {Authorization:`Bearer ${token}`} : {};
  const contentType = req.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;
  if (Number(req.headers.get("content-length")||0)>9*1024*1024)
    return Response.json({error:"Recording exceeds 8 MB."},{status:413});
  try {
    const body = ["GET","DELETE"].includes(req.method) ? undefined : await req.arrayBuffer();
    if (body && body.byteLength>9*1024*1024) return Response.json({error:"Recording exceeds 8 MB."},{status:413});
    const response = await fetch(`${base}/api/knowledge/${encodeURIComponent(assistantId)}/recordings${reference.length ? '/'+encodeURIComponent(reference[0]):''}`,
      {method:req.method,headers,body,cache:"no-store",signal:AbortSignal.timeout(30000)});
    return Response.json(await response.json(),{status:response.status});
  } catch {
    return Response.json({error:"Voice service unavailable. Try again when it is running."},{status:502});
  }
}
export {proxy as GET,proxy as POST,proxy as PATCH,proxy as DELETE};
