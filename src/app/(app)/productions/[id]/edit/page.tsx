import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Notice,
  PageHeading,
  SelectField,
  TextField,
} from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { DeleteButton } from "@/components/delete-button";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { PRODUCTION_STATUS_LABELS, type ProductionRow } from "@/lib/inventory";
import { deleteProduction, updateProduction } from "./actions";

export const metadata: Metadata = {
  title: "Edit production · Props & Costume Inventory",
};

type EditProductionPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EditProductionPage({
  params,
  searchParams,
}: EditProductionPageProps) {
  if (!supabaseConfigured) {
    redirect("/productions");
  }

  const { id } = await params;
  const error = first((await searchParams).error);

  const supabase = await createClient();
  const { data: production } = await supabase
    .from("productions")
    .select("id, name, status, start_date, end_date, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!production) {
    return (
      <>
        <PageHeading title="Production not found" />
        <Notice title="This production isn’t available">
          It may have been deleted, or you may not have access to it.
        </Notice>
      </>
    );
  }

  const typed = production as unknown as ProductionRow;

  return (
    <>
      <PageHeading
        title="Edit production"
        intro={
          <Link
            href={`/productions/${typed.id}`}
            className="text-accent hover:underline"
          >
            {typed.name}
          </Link>
        }
      />

      {error ? (
        <div className="mb-6">
          <Notice title="Couldn’t save this production">{error}</Notice>
        </div>
      ) : null}

      <form action={updateProduction} className="max-w-lg space-y-5">
        <input type="hidden" name="productionId" value={typed.id} />

        <TextField label="Name" name="name" defaultValue={typed.name} required />

        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Start date"
            name="startDate"
            type="date"
            defaultValue={typed.start_date ?? ""}
          />
          <TextField
            label="End date"
            name="endDate"
            type="date"
            defaultValue={typed.end_date ?? ""}
          />
        </div>

        <SelectField label="Status" name="status" defaultValue={typed.status}>
          {Object.entries(PRODUCTION_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>

        <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
      </form>

      <form
        action={deleteProduction}
        className="mt-10 border-t border-rule pt-6"
      >
        <input type="hidden" name="productionId" value={typed.id} />
        <p className="mb-3 font-body text-sm text-muted">
          Its pull lists and pull-list items are deleted with it.
        </p>
        <DeleteButton
          confirmMessage={`Delete "${typed.name}" and all of its pull lists? This can’t be undone.`}
        >
          Delete production
        </DeleteButton>
      </form>
    </>
  );
}
