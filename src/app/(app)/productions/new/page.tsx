import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Notice,
  PageHeading,
  SelectField,
  TextField,
} from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { supabaseConfigured } from "@/lib/supabase/config";
import { PRODUCTION_STATUS_LABELS } from "@/lib/inventory";
import { createProduction } from "./actions";

export const metadata: Metadata = {
  title: "Add production · Props & Costume Inventory",
};

type NewProductionPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewProductionPage({
  searchParams,
}: NewProductionPageProps) {
  if (!supabaseConfigured) {
    redirect("/productions");
  }

  const error = first((await searchParams).error);

  return (
    <>
      <PageHeading
        title="Add a production"
        intro="A show or run — pull lists live underneath it."
      />

      {error ? (
        <div className="mb-6">
          <Notice title="Couldn’t add this production">{error}</Notice>
        </div>
      ) : null}

      <form action={createProduction} className="max-w-lg space-y-5">
        <TextField label="Name" name="name" required />

        <div className="grid grid-cols-2 gap-4">
          <TextField label="Start date" name="startDate" type="date" />
          <TextField label="End date" name="endDate" type="date" />
        </div>

        <SelectField label="Status" name="status" defaultValue="planning">
          {Object.entries(PRODUCTION_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>

        <SubmitButton pendingText="Adding production…">
          Add production
        </SubmitButton>
      </form>
    </>
  );
}
