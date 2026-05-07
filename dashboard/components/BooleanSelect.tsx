// Tiny wrapper around Select for boolean form values. Keeps the
// "Enabled / Disabled" labels consistent + removes the "true"/"false"
// stringification ceremony from each consumer.

import Select from "./Select";

const OPTIONS = [
  { value: "true", label: "Enabled" },
  { value: "false", label: "Disabled" },
];

export default function BooleanSelect({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: boolean | null | undefined;
}) {
  return (
    <Select
      name={name}
      options={OPTIONS}
      defaultValue={defaultValue ? "true" : "false"}
    />
  );
}
