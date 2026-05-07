// Shared form-field wrapper used by every form in the dashboard. Renders a
// small uppercase label, an optional InfoTooltip icon beside it (replaces
// the previous inline-hint pattern — cleaner layout, less vertical real
// estate), and any input element passed as children.

import InfoTooltip from "./InfoTooltip";

export default function FormField({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center text-[10px] uppercase tracking-widest text-gray-400 mb-1">
        {label}
        {tooltip && <InfoTooltip>{tooltip}</InfoTooltip>}
      </span>
      {children}
    </label>
  );
}
