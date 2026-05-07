import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { createAssistant } from "../actions";
import AssistantForm from "@/components/AssistantForm";
import {
  TEMPLATES,
  CUSTOM_FROM_SCRATCH,
} from "@/lib/assistant-templates";
import { Badge } from "@/components/Badge";

export default async function NewAssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const sp = await searchParams;
  const tpl =
    sp.template && sp.template !== "blank"
      ? TEMPLATES.find((t) => t.id === sp.template)
      : null;

  // No template chosen yet → show the gallery.
  if (!sp.template) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">New assistant</h1>
          <p className="text-sm text-gray-400 mt-1">
            Pick a template to start from, or build one from scratch. You can
            edit every field before saving.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {TEMPLATES.map((t) => {
            const Icon = t.icon;
            return (
              <Link
                key={t.id}
                href={`/assistants/new?template=${t.id}`}
                className="group glass rounded-2xl p-5 hover:-translate-y-[1px] transition relative overflow-hidden"
              >
                <div className="absolute -top-1/2 -right-1/2 size-[120%] rounded-full bg-gradient-to-br from-violet-400/20 via-cyan-400/0 to-transparent blur-3xl opacity-60 pointer-events-none" />
                <div className="relative flex items-start justify-between gap-3">
                  <div className="size-10 rounded-xl bg-gradient-to-br from-cyan-400/20 via-violet-400/20 to-pink-400/20 flex items-center justify-center">
                    <Icon size={18} className="text-cyan-300" />
                  </div>
                  <Badge tone={t.bestFor === "inbound" ? "info" : "neutral"}>
                    {t.bestFor === "both" ? "in / out" : t.bestFor}
                  </Badge>
                </div>
                <h3 className="relative mt-3 text-base font-semibold">
                  {t.label}
                </h3>
                <p className="relative mt-1 text-xs text-gray-400 leading-relaxed">
                  {t.description}
                </p>
                <div className="relative mt-4 flex items-center gap-1 text-xs text-violet-300 group-hover:text-violet-200">
                  Use this template <ArrowRight size={12} />
                </div>
              </Link>
            );
          })}
          {/* Blank / custom card */}
          <Link
            href={`/assistants/new?template=blank`}
            className="group rounded-2xl border border-dashed border-white/15 bg-white/[0.01] p-5 hover:bg-white/[0.03] transition flex flex-col items-center justify-center text-center"
          >
            <div className="size-10 rounded-xl bg-white/[0.04] flex items-center justify-center">
              <Sparkles size={18} className="text-gray-400" />
            </div>
            <h3 className="mt-3 text-base font-semibold">
              {CUSTOM_FROM_SCRATCH.label}
            </h3>
            <p className="mt-1 text-xs text-gray-400 max-w-[24ch]">
              {CUSTOM_FROM_SCRATCH.description}
            </p>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link
            href="/assistants/new"
            className="text-xs text-violet-300 hover:text-violet-200 inline-flex items-center gap-1"
          >
            ← Pick a different template
          </Link>
          <h1 className="text-3xl font-bold mt-1">
            {tpl ? tpl.label : "Custom assistant"}
          </h1>
          {tpl && (
            <p className="text-sm text-gray-400 mt-1">{tpl.description}</p>
          )}
        </div>
        {tpl && (
          <Badge tone={tpl.bestFor === "inbound" ? "info" : "neutral"}>
            {tpl.bestFor === "both" ? "inbound / outbound" : tpl.bestFor}
          </Badge>
        )}
      </div>
      <AssistantForm action={createAssistant} initial={tpl?.seed} />
    </div>
  );
}
