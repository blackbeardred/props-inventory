// Row shapes and display helpers for the Day 2 list pages.
// Mirrors supabase/schema.sql — keep in sync when the schema changes.

export type Category = "prop" | "costume";
export type Condition = "new" | "good" | "fair" | "needs_repair";
export type ProductionStatus = "planning" | "in_run" | "closed";

export type LocationRow = {
  id: string;
  name: string;
  description: string | null;
  parent_location_id: string | null;
  created_at: string;
};

export type ItemRow = {
  id: string;
  name: string;
  category: Category;
  description: string | null;
  photo_url: string | null;
  quantity: number;
  condition: Condition | null;
  location_id: string | null;
  created_at: string;
  // AI-detected tags from the item's photo (Day 9) — never rendered in list
  // or search-result views, only affects which items a text search matches.
  auto_tags: string[];
};

export type PullListItemStatus = "pending" | "pulled" | "returned";

export type PullListRow = {
  id: string;
  production_id: string;
  name: string;
  created_at: string;
};

export type PullListItemRow = {
  id: string;
  pull_list_id: string;
  item_id: string;
  quantity_needed: number;
  status: PullListItemStatus;
  created_at: string;
};

export type ProductionRow = {
  id: string;
  name: string;
  status: ProductionStatus;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};

export const CATEGORY_LABELS: Record<Category, string> = {
  prop: "Prop",
  costume: "Costume",
};

export const CONDITION_LABELS: Record<Condition, string> = {
  new: "New",
  good: "Good",
  fair: "Fair",
  needs_repair: "Needs repair",
};

export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  planning: "Planning",
  in_run: "In run",
  closed: "Closed",
};

export const PULL_LIST_ITEM_STATUS_LABELS: Record<PullListItemStatus, string> = {
  pending: "Pending",
  pulled: "Pulled",
  returned: "Returned",
};

/** The status a pull-list item moves to when its action button is pressed. */
export const NEXT_PULL_LIST_ITEM_STATUS: Record<PullListItemStatus, PullListItemStatus> = {
  pending: "pulled",
  pulled: "returned",
  returned: "pending",
};

export const NEXT_PULL_LIST_ITEM_ACTION_LABEL: Record<PullListItemStatus, string> = {
  pending: "Mark pulled",
  pulled: "Mark returned",
  returned: "Mark pending",
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return DATE_FORMAT.format(parsed);
}

export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start && !end) return "Dates TBD";
  if (start && !end) return `${formatDate(start)} onward`;
  if (!start && end) return `through ${formatDate(end)}`;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}
