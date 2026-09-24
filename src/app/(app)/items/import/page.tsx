import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice, PageHeading } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = {
  title: "Import items · Props & Costume Inventory",
};

type ImportPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ImportItemsPage({ searchParams }: ImportPageProps) {
  if (!supabaseConfigured) {
    redirect("/items");
  }

  const error = first((await searchParams).error);

  const supabase = await createClient();
  const { data: locations } = await supabase.from("locations").select("name");

  const locationNames = ((locations ?? []) as { name: string }[]).map(
    (location) => location.name
  );

  return (
    <>
      <PageHeading
        title="Import items"
        intro="Bring an existing inventory in from a spreadsheet, rather than typing it in one item at a time."
        action={
          <Link
            href="/items"
            className="inline-flex items-center justify-center rounded-md border border-rule px-4 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface"
          >
            Back to items
          </Link>
        }
      />

      {error ? (
        <div className="mb-6">
          <Notice title="That import didn’t go through">{error}</Notice>
        </div>
      ) : null}

      <div className="max-w-3xl">
        <ImportWizard locationNames={locationNames} />
      </div>
    </>
  );
}
