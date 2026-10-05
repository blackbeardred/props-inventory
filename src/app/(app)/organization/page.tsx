import { redirect } from "next/navigation";

/**
 * Organization is part of the Theatre page now. Kept as a redirect so old
 * links, bookmarks and the installed app's history still land somewhere,
 * carrying any message along with them.
 */
export default async function OrganizationRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  const query = params.toString();
  redirect(`/theatre${query ? `?${query}` : ""}#members`);
}
