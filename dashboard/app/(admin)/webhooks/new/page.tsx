import { createWebhook } from "../actions";
import WebhookForm from "@/components/WebhookForm";

export default function NewWebhookPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">New webhook</h1>
        <p className="text-sm text-gray-400 mt-1">
          Voice-service signs payloads with your secret and POSTs JSON to the
          URL on each enabled event.
        </p>
      </div>
      <WebhookForm action={createWebhook} />
    </div>
  );
}
