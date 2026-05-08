import { createApiKey } from "../actions";
import ApiKeyForm from "@/components/ApiKeyForm";

export default function NewApiKeyPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">New API key</h1>
        <p className="text-sm text-gray-400 mt-1">
          Issue a bearer token for an external system. The plaintext key is
          shown once on the next screen — copy and store it immediately.
        </p>
      </div>
      <ApiKeyForm action={createApiKey} />
    </div>
  );
}
