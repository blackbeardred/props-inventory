/**
 * Turning a photograph into 512 numbers that describe what it looks like.
 *
 * The photo screen already reads a prop table into a list of names, and then
 * has to guess which of the theatre's items each name means. Names are a poor
 * way to do that: "goblet" never finds "Chalice, pewter", and a bare
 * "candlestick" matches all six of them equally. Comparing the pictures
 * themselves is what turns that into "your brass globe, P-014, Shelf 3B".
 *
 * CLIP runs in the browser, not on a server and not through an API. Three
 * reasons, in order of how much they matter here:
 *
 *   1. No per-photo cost. A theatre backfilling two thousand items is not
 *      then holding a bill for it.
 *   2. No photograph leaves the browser to be embedded.
 *   3. Nothing to keep running. A hosted model is a thing that can be down,
 *      rate-limited, or quietly repriced.
 *
 * The cost is a one-time download of about 40MB per device, cached by the
 * browser afterwards. That is a real wait on theatre wifi, which is why the
 * backfill is meant to be run once from a desktop: after that a phone only
 * ever has to fingerprint the crops from one photo.
 *
 * The model is loaded through a dynamic import so it is never pulled into a
 * server bundle — it is browser-only code, and importing it on the server
 * would drag onnxruntime into a serverless function that has no use for it.
 */

/** Stored in item_photo_embeddings.model. Vectors from two different models
 *  are not comparable, so this is what makes a model change invalidate the
 *  old fingerprints rather than silently mixing them in. */
export const EMBEDDING_MODEL = "clip-vit-base-patch32";

/** What transformers.js downloads. Kept apart from EMBEDDING_MODEL above: one
 *  is a name in our database, the other is a repository that could move. */
export const EMBEDDING_REPO = "Xenova/clip-vit-base-patch32";

/** CLIP ViT-B/32's projected image embedding. Matches the vector(512) column;
 *  Postgres refuses anything else, which is the backstop if this ever drifts. */
export const EMBEDDING_DIMENSIONS = 512;

/**
 * Scales a vector to unit length.
 *
 * Cosine distance doesn't require this — it divides by the magnitudes anyway —
 * but storing normalised vectors means a stored fingerprint compared against
 * itself scores exactly 1, which makes "how close is close?" a question with
 * the same answer everywhere, and makes the numbers worth showing to a person.
 */
export function l2Normalize(values: ArrayLike<number>): number[] {
  let sumOfSquares = 0;
  for (let i = 0; i < values.length; i += 1) sumOfSquares += values[i] * values[i];

  const magnitude = Math.sqrt(sumOfSquares);
  // A zero vector has no direction, so cosine distance against it is
  // undefined. It shouldn't come out of CLIP, but returning it unchanged is
  // better than returning NaNs that only fail once they're in the database.
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    return Array.from(values, (value) => value);
  }

  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = values[i] / magnitude;
  return out;
}

/**
 * Checks a vector is the shape Postgres will accept, and says what's wrong if
 * it isn't. Called before every write: a bad fingerprint that reaches the
 * database doesn't fail loudly, it quietly matches the wrong prop.
 */
export function checkEmbedding(values: ArrayLike<number>): string | null {
  if (values.length !== EMBEDDING_DIMENSIONS) {
    return `Expected ${EMBEDDING_DIMENSIONS} numbers from the model, got ${values.length}.`;
  }
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) return "The model returned a number that isn't a number.";
  }
  return null;
}

/**
 * pgvector's text form: `[0.1,0.2,...]`. supabase-js sends this as a string
 * and Postgres casts it, which is why it's built here rather than passed as
 * an array.
 */
export function toVectorLiteral(values: ArrayLike<number>): string {
  const parts = new Array<string>(values.length);
  for (let i = 0; i < values.length; i += 1) {
    // Six decimals is well inside float32's precision and keeps the request
    // body about a third the size of full precision.
    parts[i] = values[i].toFixed(6);
  }
  return `[${parts.join(",")}]`;
}

/** How alike two fingerprints are, 0..1. The same measure Postgres uses, for
 *  the times the browser already holds both and needn't ask. */
export function similarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let aSquared = 0;
  let bSquared = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    aSquared += a[i] * a[i];
    bSquared += b[i] * b[i];
  }
  const magnitude = Math.sqrt(aSquared) * Math.sqrt(bSquared);
  return magnitude === 0 ? 0 : dot / magnitude;
}

export type LoadProgress = {
  /** What the model loader is doing, in words a person can read. */
  message: string;
  /** 0..100 while files are downloading, null when there's nothing to show. */
  percent: number | null;
};

type Embedder = {
  processor: (image: unknown) => Promise<unknown>;
  model: (inputs: unknown) => Promise<{ image_embeds: { data: ArrayLike<number> } }>;
  readImage: (blob: Blob) => Promise<unknown>;
};

let loading: Promise<Embedder> | null = null;
let ready = false;

/**
 * Whether this browser already holds the model, so using it costs nothing.
 *
 * The point of asking is that a 40MB download is fine when someone chose it on
 * the fingerprints page, and rude when it ambushes them for adding one item on
 * a phone in a storage room. Anything that fingerprints on its own initiative
 * checks here first and quietly does nothing when the answer is no.
 *
 * transformers.js stores model files in the Cache API under `transformers-cache`,
 * keyed by their URL. Rather than reconstructing the exact key — which would be
 * a guess about someone else's naming, and would break silently if it changed —
 * this looks for any cached .onnx belonging to the repo.
 */
export async function isModelCached(): Promise<boolean> {
  if (ready) return true;
  if (typeof caches === "undefined") return false;

  try {
    const cache = await caches.open("transformers-cache");
    const keys = await cache.keys();
    const repo = EMBEDDING_REPO.toLowerCase();
    return keys.some((request) => {
      const url = request.url.toLowerCase();
      return url.includes(repo) && url.endsWith(".onnx");
    });
  } catch {
    // Private windows, blocked storage, and insecure origins all throw here.
    // Not being able to tell is the same as not having it.
    return false;
  }
}

/**
 * Loads CLIP, once per page. The promise is cached rather than the result, so
 * two things asking at the same moment — the backfill and a lookalike search —
 * share one download instead of starting two.
 */
export function loadEmbedder(onProgress?: (progress: LoadProgress) => void): Promise<Embedder> {
  if (loading) return loading;

  loading = (async () => {
    onProgress?.({ message: "Loading the vision model…", percent: null });

    const { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } = await import(
      "@huggingface/transformers"
    );

    // Without this, transformers.js looks for the model on our own server
    // first and logs a 404 for every file before falling back to the hub.
    env.allowLocalModels = false;

    const report = (item: { status?: string; file?: string; progress?: number }) => {
      if (!onProgress) return;
      if (item.status === "progress" && typeof item.progress === "number") {
        onProgress({
          message: "Downloading the vision model — this happens once per device.",
          percent: Math.round(item.progress),
        });
      } else if (item.status === "ready" || item.status === "done") {
        onProgress({ message: "Getting the model ready…", percent: null });
      }
    };

    const [processor, model] = await Promise.all([
      AutoProcessor.from_pretrained(EMBEDDING_REPO, { progress_callback: report }),
      CLIPVisionModelWithProjection.from_pretrained(EMBEDDING_REPO, {
        // q8 is the browser default and roughly a quarter the download of
        // full precision. The loss matters for generation, not for asking
        // whether two photographs are of the same tankard.
        dtype: "q8",
        progress_callback: report,
      }),
    ]);

    onProgress?.({ message: "Ready.", percent: null });
    ready = true;

    return {
      processor: (image) => processor(image),
      model: (inputs) => model(inputs),
      readImage: (blob) => RawImage.fromBlob(blob),
    } as Embedder;
  })();

  // A failed load shouldn't be cached forever — a dropped connection halfway
  // through the download would otherwise leave the page permanently broken.
  loading.catch(() => {
    loading = null;
  });

  return loading;
}

/** Fingerprints one picture. Browser only. */
export async function embedImage(
  blob: Blob,
  onProgress?: (progress: LoadProgress) => void
): Promise<number[]> {
  const embedder = await loadEmbedder(onProgress);
  const image = await embedder.readImage(blob);
  const inputs = await embedder.processor(image);
  const { image_embeds } = await embedder.model(inputs);

  const problem = checkEmbedding(image_embeds.data);
  if (problem) throw new Error(problem);

  return l2Normalize(image_embeds.data);
}
