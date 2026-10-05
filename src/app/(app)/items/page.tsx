import { redirect } from "next/navigation";

/**
 * Items is part of Inventory now (with Locations and Search). Old links and
 * the spreadsheet import's way back still land in the right place: a
 * ?location= becomes the place you're in, everything else carries over.
 */
export default async function ItemsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value !== "string") continue;
    params.set(key === "location" ? "place" : key, value);
  }
  const query = params.toString();
  redirect(query ? `/inventory?${query}` : "/inventory");
}
