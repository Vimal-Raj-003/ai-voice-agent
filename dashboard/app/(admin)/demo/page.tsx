import DemoWidget from "@/components/DemoWidget";
import { voiceService } from "@/lib/voice-service";

export default async function DemoPage() {
  const config = await voiceService.demoConfig().catch(() => null);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Demo</h1>
      <DemoWidget config={config} />
    </div>
  );
}
