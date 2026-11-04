"use client";

import { useActionState } from "react";
import { changePassword } from "@/app/(admin)/settings/password/actions";

export default function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, {});
  return (
    <form action={action} className="glass rounded-xl p-5 space-y-4 max-w-md">
      <h2 className="text-lg font-semibold">Change password</h2>
      <p className="text-sm text-gray-400">Save a new password for your next sign-in. Use at least 8 characters.</p>
      {state.error && <p role="alert" className="text-sm text-red-400">{state.error}</p>}
      {state.success && <p role="status" className="text-sm text-emerald-400">Password saved. Use your new password the next time you sign in.</p>}
      <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
        {[
          { name: "currentPassword", label: "Current password", autoComplete: "current-password" },
          { name: "newPassword", label: "New password", autoComplete: "new-password" },
          { name: "confirmPassword", label: "Confirm new password", autoComplete: "new-password" },
        ].map((field) => (
          <label key={field.name} className="block text-sm">
            <span className="block mb-1">{field.label}</span>
            <input name={field.name} type="password" autoComplete={field.autoComplete} required
              minLength={field.name === "currentPassword" ? undefined : 8}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40" />
          </label>
        ))}
        <button type="submit" className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium hover:bg-violet-400 disabled:opacity-60">
          {pending ? "Saving…" : "Save password"}
        </button>
      </fieldset>
    </form>
  );
}
