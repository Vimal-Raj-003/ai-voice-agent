import { createAssistant } from "../actions";
import AssistantForm from "@/components/AssistantForm";

export default function NewAssistantPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">New assistant</h1>
      <AssistantForm action={createAssistant} />
    </div>
  );
}
