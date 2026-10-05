// The training set: every confirmed picture, grouped by what it's a picture
// of, laid out the way custom-recognition services import labelled photos.
//
// Pictures come from item_reference_photos (migration 008): photos people
// confirmed as an item ("That's it" on Find by photo, a ticked prop-table
// match, a deleted twin's photo). Each label also gets the items' own photos.
// Twins (migration 009) share one label: they're the same thing to a camera,
// and a model taught to tell them apart would only be learning noise.
//
// The download is one folder per label plus labels.csv. Both AWS Rekognition
// Custom Labels (folder names as labels) and Google Vertex AI / AutoML Vision
// (a CSV of file and label) can start from that. Pure, so the layout can be
// tested; src/app/(app)/items/training-set fetches the files and zips them.

export type TrainingItem = { id: string; name: string; category: string; photo_url: string | null };
export type TrainingPicture = {
  id: string;
  item_id: string;
  photo_path: string;
  source: string;
  similarity: number | null;
};
export type TrainingTwin = { item_id: string; twin_set: string };

export type TrainingFile = {
  /** Where it goes in the download: label/file. */
  path: string;
  /** Where it is in the photos bucket. */
  storagePath: string;
  label: string;
  itemId: string;
  itemName: string;
  category: string;
  /** "photo" for an item's own photo, else how the picture was confirmed. */
  source: string;
  similarity: number | null;
};

export type TrainingLabel = {
  label: string;
  /** What people call it: the item's name (the first, for twins). */
  name: string;
  itemIds: string[];
  files: TrainingFile[];
  /** Pictures people confirmed, as opposed to the items' own photos. */
  confirmed: number;
};

export type TrainingPlan = {
  labels: TrainingLabel[];
  files: TrainingFile[];
  /** Items left out: no confirmed picture (and only those were asked for). */
  leftOut: number;
};

/** Both services ask for at least this many pictures per label to train on. */
export const PICTURES_PER_LABEL = 10;

/** A folder name a label can be: lowercase letters, digits and hyphens. */
export function labelSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "item";
}

const EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
function extensionOf(path: string): string {
  const found = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? "jpg";
  return EXTENSIONS.has(found) ? (found === "jpeg" ? "jpg" : found) : "jpg";
}

const short = (id: string) => id.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "x";

/**
 * Lays out the training set. With `includeUnconfirmed`, items that only have
 * their own photo get a label too; otherwise only things somebody has
 * confirmed a picture of are in it.
 */
export function planTrainingSet(
  items: TrainingItem[],
  pictures: TrainingPicture[],
  twins: TrainingTwin[],
  { includeUnconfirmed = false }: { includeUnconfirmed?: boolean } = {}
): TrainingPlan {
  const byId = new Map(items.map((item) => [item.id, item]));
  const setOf = new Map(twins.filter((row) => byId.has(row.item_id)).map((row) => [row.item_id, row.twin_set]));

  // Each item's group: its twin set, or itself.
  const groups = new Map<string, string[]>();
  for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = setOf.get(item.id) ? `set:${setOf.get(item.id)}` : `item:${item.id}`;
    groups.set(key, [...(groups.get(key) ?? []), item.id]);
  }

  const picturesOf = new Map<string, TrainingPicture[]>();
  for (const picture of pictures) {
    if (!byId.has(picture.item_id) || !picture.photo_path) continue;
    picturesOf.set(picture.item_id, [...(picturesOf.get(picture.item_id) ?? []), picture]);
  }

  type Draft = { name: string; itemIds: string[]; confirmed: number };
  const drafts: Draft[] = [];
  let leftOut = 0;
  for (const itemIds of groups.values()) {
    const confirmed = itemIds.reduce((total, id) => total + (picturesOf.get(id)?.length ?? 0), 0);
    const hasFiles = confirmed > 0 || itemIds.some((id) => byId.get(id)?.photo_url);
    if (!hasFiles || (!confirmed && !includeUnconfirmed)) {
      leftOut += itemIds.length;
      continue;
    }
    // Twins usually share a name; if not, the first one's (by id) stands.
    drafts.push({ name: byId.get(itemIds[0])!.name, itemIds, confirmed });
  }

  // Unique folder names, given out in name order so they don't shift about.
  drafts.sort((a, b) => a.name.localeCompare(b.name) || a.itemIds[0].localeCompare(b.itemIds[0]));
  const used = new Map<string, number>();
  const labels: TrainingLabel[] = drafts.map((draft) => {
    const base = labelSlug(draft.name);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const label = n === 1 ? base : `${base}-${n}`;

    const files: TrainingFile[] = [];
    const names = new Set<string>();
    const add = (file: Omit<TrainingFile, "path" | "label">, stem: string) => {
      let fileName = `${stem}.${extensionOf(file.storagePath)}`;
      for (let k = 2; names.has(fileName); k += 1) fileName = `${stem}-${k}.${extensionOf(file.storagePath)}`;
      names.add(fileName);
      files.push({ ...file, label, path: `${label}/${fileName}` });
    };
    for (const id of draft.itemIds) {
      const item = byId.get(id)!;
      const base = { itemId: id, itemName: item.name, category: item.category };
      if (item.photo_url) {
        add({ ...base, storagePath: item.photo_url, source: "photo", similarity: null }, `${short(id)}-photo`);
      }
      for (const picture of [...(picturesOf.get(id) ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
        add(
          { ...base, storagePath: picture.photo_path, source: picture.source, similarity: picture.similarity },
          `${short(picture.id)}-${labelSlug(picture.source)}`
        );
      }
    }
    return { label, name: draft.name, itemIds: draft.itemIds, files, confirmed: draft.confirmed };
  });

  return { labels, files: labels.flatMap((label) => label.files), leftOut };
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** labels.csv: one row per file. */
export function trainingCsv(files: TrainingFile[]): string {
  const rows = [["file", "label", "item_id", "item_name", "category", "source", "similarity"]];
  for (const file of files) {
    rows.push([
      file.path,
      file.label,
      file.itemId,
      file.itemName,
      file.category,
      file.source,
      file.similarity === null ? "" : file.similarity.toFixed(3),
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** README.txt: what's in the download and how to use it. */
export function trainingReadme(
  plan: TrainingPlan,
  { theatre, made, missing }: { theatre: string; made: Date; missing: string[] }
): string {
  const ready = plan.labels.filter((label) => label.files.length >= PICTURES_PER_LABEL).length;
  const lines = [
    `Training set for ${theatre}`,
    `Made ${made.toISOString().slice(0, 10)} from the Props & Costume Inventory.`,
    "",
    `${plan.labels.length} label${plan.labels.length === 1 ? "" : "s"}, ${plan.files.length - missing.length} picture${plan.files.length - missing.length === 1 ? "" : "s"}.`,
    `${ready} label${ready === 1 ? " has" : "s have"} ${PICTURES_PER_LABEL} or more pictures, which is about the least either service will train on.`,
    "",
    "Each folder is one label: one prop, or one set of twins (props you own more",
    "than one of that look exactly alike, which a camera can't tell apart).",
    "In each folder are the items' own photos (…-photo) and the pictures people",
    "confirmed: find-by-photo (\"That's it\"), prop-table (a ticked match), and",
    "twin or duplicate (the photo of one that was deleted).",
    "",
    "labels.csv lists every file with its label, item and how it was confirmed.",
    "",
    "AWS Rekognition Custom Labels: upload the folders to S3 and create a",
    "dataset with \"automatically assign image-level labels based on the folder",
    "name\".",
    "Google Vertex AI (AutoML Vision): upload the folders to Cloud Storage and",
    "import a CSV of gs://… paths and labels, made from labels.csv.",
  ];
  if (missing.length) {
    lines.push("", `${missing.length} picture${missing.length === 1 ? "" : "s"} couldn't be downloaded and ${missing.length === 1 ? "isn't" : "aren't"} included:`, ...missing.map((path) => `  ${path}`));
  }
  return lines.join("\r\n") + "\r\n";
}
