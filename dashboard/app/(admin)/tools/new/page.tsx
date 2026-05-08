import { createTool } from "../actions";
import ToolForm from "@/components/ToolForm";

export default function NewToolPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">New tool</h1>
        <p className="text-sm text-gray-400 mt-1">
          Define an HTTP endpoint the LLM can call as a function. Args are
          validated against the schema before the request fires.
        </p>
      </div>
      <ToolForm action={createTool} />
    </div>
  );
}
