import type { Prisma } from "@prisma/client";

export type PromptDirection = "INBOUND" | "OUTBOUND";

export function preservePromptLineEndings(previous: string, submitted: string): string {
  return previous.replace(/\r\n?/g, "\n") === submitted.replace(/\r\n?/g, "\n") ? previous : submitted;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function assistantPrompts(systemPrompt: string, metadata: unknown) {
  const stored = object(object(metadata).directionPrompts).outbound;
  return { inbound: systemPrompt, outbound: typeof stored === "string" ? stored : systemPrompt };
}

export function withOutboundPrompt(metadata: unknown, outbound: string): Prisma.InputJsonObject & {
  directionPrompts: Prisma.InputJsonObject & { outbound: string };
} {
  const current = object(metadata);
  return { ...current, directionPrompts: { ...object(current.directionPrompts), outbound } } as Prisma.InputJsonObject & {
    directionPrompts: Prisma.InputJsonObject & { outbound: string };
  };
}
