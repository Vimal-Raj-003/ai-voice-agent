import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

// Streams the stored settings table out as a `.env`-style file. Sensitive
// values are redacted by default — pass `?include=secrets` (and be signed in)
// to download the unredacted version. The middleware excludes /api/* from the
// auth check so this route enforces auth inline like the other admin
// downloads.

function shellEscape(v: string): string {
  // Wrap in single quotes if the value contains anything that would confuse a
  // dotenv parser. Already-clean values pass through verbatim.
  if (/^[A-Za-z0-9_./:@\-]+$/.test(v)) return v;
  return `'${v.replace(/'/g, "'\\''")}'`;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const url = new URL(request.url);
  const includeSecrets = url.searchParams.get("include") === "secrets";

  const rows = await prisma.setting.findMany({
    orderBy: { key: "asc" },
  });

  const lines: string[] = [
    "# Jilljill Voice — exported settings",
    `# Generated: ${new Date().toISOString()}`,
    `# Source: dashboard /settings (stored overrides only — env-only keys are NOT included)`,
    includeSecrets
      ? "# WARNING: contains sensitive values. Treat this file like a credential."
      : "# Sensitive values are redacted. Re-run with ?include=secrets to export them.",
    "",
  ];

  for (const r of rows) {
    const value =
      r.isSensitive && !includeSecrets ? "***REDACTED***" : r.value;
    lines.push(`${r.key}=${shellEscape(value)}`);
  }

  const filename = includeSecrets
    ? "jilljill-voice-settings-with-secrets.env"
    : "jilljill-voice-settings.env";

  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
