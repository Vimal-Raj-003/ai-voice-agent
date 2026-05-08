import { redirect } from "next/navigation";
import { requireRole } from "@/lib/require-role";
import { addDndNumber } from "../actions";

export default async function NewDndPage() {
  await requireRole("ADMIN");
  async function action(formData: FormData) {
    "use server";
    await addDndNumber(formData);
    redirect("/dnd");
  }
  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-bold">Add to DND</h1>
      <form action={action} className="glass rounded-2xl p-5 space-y-3">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            Phone (E.164 or 10-digit IN)
          </span>
          <input
            name="phone"
            required
            placeholder="+919876543210 or 9876543210"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-mono"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            Reason (optional)
          </span>
          <input
            name="reason"
            placeholder="Customer requested"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
        </label>
        <button type="submit" className="rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium">
          Add
        </button>
      </form>
    </div>
  );
}
