"use client";
import Select from "./Select";

export default function InviteForm({
  action,
}: {
  action: (fd: FormData) => Promise<void>;
}) {
  return (
    <form action={action} className="glass rounded-2xl p-5 space-y-4">
      <label className="block">
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          Email
        </span>
        <input
          name="email"
          type="email"
          required
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
        />
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
          Role
        </span>
        <Select
          name="role"
          defaultValue="AGENT"
          options={[
            { value: "OWNER", label: "Owner" },
            { value: "ADMIN", label: "Admin" },
            { value: "AGENT", label: "Agent" },
            { value: "VIEWER", label: "Viewer" },
          ]}
        />
      </label>
      <button
        type="submit"
        className="rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium hover:bg-violet-400"
      >
        Send invite
      </button>
    </form>
  );
}
