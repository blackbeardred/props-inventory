import { redirect } from "next/navigation";

/** Search is the box at the top of Inventory now. A search in the address
 *  bar — a bookmark, a shared link — carries straight over. */
export default async function SearchRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  const query = params.toString();
  redirect(query ? `/inventory?${query}` : "/inventory");
}
