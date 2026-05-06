"use server";
import { prisma } from "@/lib/prisma";
import { getDefaultOrg } from "@/lib/org";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createAssistant(formData: FormData) {
  const { id: orgId } = await getDefaultOrg();
  const a = await prisma.assistant.create({
    data: {
      organizationId: orgId,
      name: String(formData.get("name") || "New Assistant"),
      systemPrompt: String(formData.get("systemPrompt") || ""),
      firstMessage: String(formData.get("firstMessage") || "") || null,
      llmProvider: (String(formData.get("llmProvider") || "OPENAI") as any),
      llmModel: String(formData.get("llmModel") || "gpt-4o-mini"),
      ttsProvider: (String(formData.get("ttsProvider") || "DEEPGRAM") as any),
      voiceId: String(formData.get("voiceId") || "") || null,
      sttProvider: (String(formData.get("sttProvider") || "DEEPGRAM") as any),
    },
  });
  revalidatePath("/assistants");
  redirect(`/assistants/${a.id}`);
}

export async function updateAssistant(id: string, formData: FormData) {
  await prisma.assistant.update({
    where: { id },
    data: {
      name: String(formData.get("name") || "Untitled"),
      systemPrompt: String(formData.get("systemPrompt") || ""),
      firstMessage: String(formData.get("firstMessage") || "") || null,
      llmProvider: (String(formData.get("llmProvider") || "OPENAI") as any),
      llmModel: String(formData.get("llmModel") || "gpt-4o-mini"),
      ttsProvider: (String(formData.get("ttsProvider") || "DEEPGRAM") as any),
      voiceId: String(formData.get("voiceId") || "") || null,
      sttProvider: (String(formData.get("sttProvider") || "DEEPGRAM") as any),
    },
  });
  revalidatePath("/assistants");
  revalidatePath(`/assistants/${id}`);
}

export async function deleteAssistant(id: string) {
  await prisma.assistant.delete({ where: { id } });
  revalidatePath("/assistants");
  redirect("/assistants");
}
