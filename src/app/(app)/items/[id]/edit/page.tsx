import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Notice,
  PageHeading,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { SubmitShortcut } from "@/components/submit-shortcut";
import { PhotoField } from "@/components/photo-field";
import { LocationField } from "@/components/location-field";
import type { LocationNode } from "@/lib/locations";
import { locationPaths } from "@/lib/locations";
import { loadTwinPanel } from "@/lib/twins-data";
import { DeleteButton } from "@/components/delete-button";
import { ImportDataPanel } from "@/components/import-data-panel";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  type ItemRow,
} from "@/lib/inventory";
import { PHOTOS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/supabase/storage";
import { addTwin, deleteItem, regenerateTags, removeFromTwins, updateItem } from "./actions";
import { TwinsPanel } from "./twins-panel";

export const metadata: Metadata = {
  title: "Edit item · Props & Costume Inventory",
};

type EditItemPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EditItemPage({
  params,
  searchParams,
}: EditItemPageProps) {
  if (!supabaseConfigured) {
    redirect("/inventory");
  }

  const { id } = await params;
  const error = first((await searchParams).error);
  const notice = first((await searchParams).notice);
  const linkedTwin = first((await searchParams).twin);

  const supabase = await createClient();

  const [{ data: item }, { data: locations }, { data: openChecks }] = await Promise.all([
    supabase
      .from("items")
      .select(
        "id, name, category, description, photo_url, quantity, condition, location_id, created_at, auto_tags, import_data"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("locations").select("id, name, parent_location_id").order("name"),
    // Every list this item is on. Two different facts come out of it: whether
    // it's out on a show, and whether anyone has actually stood in front of it
    // — and this is the page someone opens when a prop has gone missing.
    supabase
      .from("pull_list_items")
      .select("id, status, check_state, quantity_needed, pull_lists(name, productions(id, name))")
      .eq("item_id", id),
  ]);

  if (!item) {
    return (
      <>
        <PageHeading title="Item not found" />
        <Notice title="This item isn’t available">
          It may have been deleted, or you may not have access to it.
        </Notice>
      </>
    );
  }

  const typedItem = item as unknown as ItemRow;

  const listRows = ((openChecks ?? []) as unknown as {
    id: string;
    status: string;
    check_state: string | null;
    quantity_needed: number;
    pull_lists: { name: string; productions: { id: string; name: string } | null } | null;
  }[]).filter((row) => row.pull_lists?.productions);

  const pulled = listRows.filter((row) => row.status === "pulled");
  const pulledQuantity = pulled.reduce((total, row) => total + row.quantity_needed, 0);
  const unchecked = listRows.filter((row) => (row.check_state ?? "open") === "open");

  // Its twins (the same prop, owned more than once), and likely ones.
  const twinPanel = await loadTwinPanel(supabase, typedItem, (locations ?? []) as LocationNode[]);
  const placeNames = locationPaths((locations ?? []) as LocationNode[]);
  const searchPlaces = [...placeNames].map(([placeId, name]) => ({ id: placeId, name }));

  let currentPhotoUrl: string | null = null;
  if (typedItem.photo_url) {
    const { data: signed } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .createSignedUrl(typedItem.photo_url, SIGNED_URL_TTL_SECONDS);
    currentPhotoUrl = signed?.signedUrl ?? null;
  }

  // Where it lives, from the outermost room in: the breadcrumb under the title.
  const placeRows = (locations ?? []) as LocationNode[];
  const placeById = new Map(placeRows.map((place) => [place.id, place]));
  const trail: LocationNode[] = [];
  for (
    let at = typedItem.location_id ? placeById.get(typedItem.location_id) : undefined, guard = 0;
    at && guard < 50;
    at = at.parent_location_id ? placeById.get(at.parent_location_id) : undefined, guard += 1
  ) {
    trail.unshift(at);
  }
  const tags = typedItem.auto_tags ?? [];

  return (
    <>
      {/* The item's own name is the title, and the breadcrumb says where it
          is: what someone holding the prop wants to know first. */}
      <div className="mb-6">
        <nav aria-label="Where it’s kept" data-item-crumbs className="font-mono text-xs text-muted">
          <Link href="/inventory" className="-my-3 inline-block py-3 text-accent-ink hover:underline md:my-0 md:py-0">
            Inventory
          </Link>
          {trail.length ? (
            trail.map((place) => (
              <span key={place.id}>
                {" › "}
                <Link
                  href={`/inventory?place=${place.id}`}
                  className="-my-3 inline-block py-3 text-accent-ink hover:underline md:my-0 md:py-0"
                >
                  {place.name}
                </Link>
              </span>
            ))
          ) : (
            <span> › Not filed anywhere yet</span>
          )}
        </nav>
        <h1 className="mt-1 font-display text-3xl leading-tight text-foreground">{typedItem.name}</h1>

        {pulled.length || unchecked.length || twinPanel.twins.length ? (
          <div data-item-status className="mt-3 flex flex-wrap gap-2">
            {pulled.length ? (
              <span className="inline-flex flex-wrap items-center gap-x-1 rounded-full border border-in-use/40 bg-in-use/10 px-3 py-1 font-body text-xs text-in-use-ink">
                <span aria-hidden="true" className="mr-1 inline-block h-[7px] w-[7px] rounded-full bg-in-use" />
                {typedItem.quantity > 1 ? `${pulledQuantity} of ${typedItem.quantity} pulled for` : "Pulled for"}
                {pulled.map((row, index) => (
                  <span key={row.id}>
                    {index > 0 ? ", " : " "}
                    <Link
                      href={`/productions/${row.pull_lists!.productions!.id}`}
                      // Taller to the thumb than it looks: padding the
                      // negative margin takes back.
                      className="-my-3.5 inline-block py-3.5 font-medium underline-offset-2 hover:underline md:my-0 md:py-0"
                    >
                      {row.pull_lists!.productions!.name}
                    </Link>
                  </span>
                ))}
              </span>
            ) : null}
            {unchecked.length ? (
              <span
                title="On a pull list, and nobody has confirmed it in the store yet"
                className="inline-flex flex-wrap items-center gap-x-1 rounded-full border border-danger/50 bg-danger/10 px-3 py-1 font-body text-xs font-semibold text-danger-ink"
              >
                NOT CHECKED
                {unchecked.map((row, index) => (
                  <span key={row.id} className="font-normal">
                    {index > 0 ? ", " : " · "}
                    <Link
                      href={`/productions/${row.pull_lists!.productions!.id}/checklist`}
                      className="-my-3.5 inline-block py-3.5 underline-offset-2 hover:underline md:my-0 md:py-0"
                    >
                      {row.pull_lists!.productions!.name}
                    </Link>
                  </span>
                ))}
              </span>
            ) : null}
            {twinPanel.twins.length ? (
              <a
                href="#twins"
                className="-my-3 inline-flex items-center gap-1.5 py-3 md:my-0 md:py-0"
              >
                <span className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-surface px-3 py-1 font-body text-xs text-accent-ink">
                  <span aria-hidden="true" className="hex w-2.5 bg-honey" />
                  {twinPanel.twins.length === 1
                    ? `Twin of ${twinPanel.twins[0].name}`
                    : `One of ${twinPanel.twins.length + 1} twins`}
                </span>
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      {notice === "twin-linked" ? (
        <div className="mb-6">
          <Notice title={linkedTwin ? `Linked as a twin of ${linkedTwin}` : "Linked as twins"}>
            A photo of either one now finds both.
          </Notice>
        </div>
      ) : null}
      {notice === "twin-unlinked" ? (
        <div className="mb-6">
          <Notice title="No longer a twin">Its photos only find this item now.</Notice>
        </div>
      ) : null}
      {notice === "tags-regenerated" ? (
        <div className="mb-6">
          <Notice title="Tags regenerated">
            Ran AI detection again on the current photo.
          </Notice>
        </div>
      ) : null}
      {error ? (
        <div className="mb-6">
          <Notice title="Couldn’t save this item">{error}</Notice>
        </div>
      ) : null}

      <form action={updateItem} data-item-form className="max-w-4xl">
        <input type="hidden" name="itemId" value={typedItem.id} />

        {/* Two columns from md up: the photo on the left, its details on the
            right. One column on a phone, photo first. */}
        <div className="grid gap-6 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:gap-8">
          <div>
            <PhotoField
              size="large"
              removeName="removePhoto"
              label="Photo"
              name="photo"
              accept="image/png,image/jpeg,image/webp,image/gif"
              helpText="JPG, PNG, GIF or WEBP, up to 8MB."
              existingUrl={currentPhotoUrl}
            />
          </div>

          <div className="space-y-5">
            {/* Where it's kept comes first: it's the thing most often changed. */}
            <LocationField
              nodes={placeRows}
              defaultValue={typedItem.location_id ?? ""}
              label="Kept in"
            />

            <TextField label="Name" name="name" defaultValue={typedItem.name} required />

            <div className="grid grid-cols-2 gap-4">
              <SelectField label="Category" name="category" defaultValue={typedItem.category}>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectField>

              <TextField
                label="Quantity"
                name="quantity"
                type="number"
                defaultValue={String(typedItem.quantity)}
              />
            </div>

            <SelectField label="Condition" name="condition" defaultValue={typedItem.condition ?? ""}>
              <option value="">Not set</option>
              {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>

            <TextareaField
              label="Description"
              name="description"
              rows={3}
              defaultValue={typedItem.description ?? ""}
            />

            {/* On a phone, Save stays in reach above the tab bar, to the
                right of the thumb hexagon; from md up it sits under the form. */}
            <div
              data-save-bar
              className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 -mx-6 flex items-center justify-end gap-3 border-t border-rule bg-background/95 px-6 py-3 backdrop-blur md:static md:mx-0 md:justify-start md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none"
            >
              <SubmitShortcut />
              <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
            </div>
          </div>
        </div>
      </form>

      <div className="mt-10 grid max-w-4xl gap-4 md:grid-cols-2">
        {twinPanel.available ? (
          <TwinsPanel
            itemId={typedItem.id}
            itemName={typedItem.name}
            twins={twinPanel.twins}
            suggestions={twinPanel.suggestions}
            locations={searchPlaces}
            addAction={addTwin}
            removeAction={removeFromTwins}
          />
        ) : null}

        {/* Folded away: useful to know, rarely needed. */}
        <details data-search-tags className="group rounded-lg border border-rule bg-background px-4 py-3 md:self-start">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 md:min-h-0 [&::-webkit-details-marker]:hidden">
            <span className="font-display text-lg text-foreground">Search tags</span>
            <span className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-muted">
              <span className="truncate">{tags.length ? tags.slice(0, 4).join(", ") : "none yet"}</span>
              <span
                aria-hidden="true"
                className="hex w-2.5 shrink-0 bg-honey transition-[rotate] duration-200 group-open:rotate-90 group-open:bg-foreground"
              />
            </span>
          </summary>
          <p className="mt-2 font-body text-xs text-muted">
            Generated from this item’s name, description and photo, and used only to decide what
            a search matches. They’re never shown in lists. They’re what lets someone find this by
            searching “wood” when nothing here says “wood”.
          </p>
          {tags.length ? (
            <p className="mt-3 font-body text-sm text-foreground">{tags.join(", ")}</p>
          ) : (
            <p className="mt-3 font-body text-sm text-muted">
              None yet — save this item, or regenerate, to tag it.
            </p>
          )}
          <form action={regenerateTags} className="mt-3">
            <input type="hidden" name="itemId" value={typedItem.id} />
            <SubmitButton pendingText="Regenerating…" variant="ghost">
              Regenerate tags
            </SubmitButton>
          </form>
        </details>
      </div>

      <div className="max-w-4xl">
        <ImportDataPanel data={typedItem.import_data} />
      </div>

      <form action={deleteItem} className="mt-10 max-w-4xl border-t border-rule pt-6">
        <input type="hidden" name="itemId" value={typedItem.id} />
        {twinPanel.twins.length && twinPanel.photoCount ? (
          <p data-twin-handover className="mb-3 max-w-xl font-body text-sm text-muted">
            Deleting it gives{" "}
            {twinPanel.photoCount === 1 ? "its photo" : `its ${twinPanel.photoCount} photos`} to
            its twin, {twinPanel.twins[0].name}, so that one is still easy to find from a photo.
          </p>
        ) : null}
        <DeleteButton
          confirmMessage={
            twinPanel.twins.length
              ? `Delete "${typedItem.name}"? Its photos will go to its twin. You can restore it from Theatre → Recently deleted for 30 days.`
              : `Delete "${typedItem.name}"? You can restore it from Theatre → Recently deleted for 30 days.`
          }
        >
          Delete item
        </DeleteButton>
      </form>
    </>
  );
}
