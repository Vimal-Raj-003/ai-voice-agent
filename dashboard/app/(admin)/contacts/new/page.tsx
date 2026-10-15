import ContactForm from "@/components/ContactForm";

export const dynamic = "force-dynamic";

export default function NewContactPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">New contact</h1>
        <p className="mt-1 text-sm text-gray-400">
          Save a person or customer to your address book. This is separate from
          Phone Numbers (your business telephony lines).
        </p>
      </div>
      <ContactForm />
    </div>
  );
}
