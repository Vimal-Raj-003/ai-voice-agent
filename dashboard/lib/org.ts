import { prisma } from "./prisma";

const DEFAULT_SLUG = "default";
const DEFAULT_NAME = "Default Organization";

let cached: { id: string } | null = null;

export async function getDefaultOrg(): Promise<{ id: string }> {
  if (cached) return cached;
  const existing = await prisma.organization.findUnique({ where: { slug: DEFAULT_SLUG } });
  if (existing) {
    cached = { id: existing.id };
    return cached;
  }
  const created = await prisma.organization.create({
    data: { name: DEFAULT_NAME, slug: DEFAULT_SLUG },
  });
  cached = { id: created.id };
  return cached;
}
