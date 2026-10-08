/**
 * The strip a row uncovers as it's swiped left: what letting go will do.
 *
 * Every swipe left means the same kind of thing: the row's "yes" (add it to
 * a production, mark it pulled, mark it checked, add it to the inventory).
 * Inventory items also swipe right, to "Add to room…". Nothing is removed or
 * cleared by a swipe; those stay on buttons and the right-click menu, where a
 * slip of the thumb can't do them. So every strip looks alike too: a green tint that
 * fills in once letting go will act, and grey with "Already …" when there's
 * nothing left to do. (Inventory cards draw their own, SwipeReveal, because
 * theirs names the production the item will go to.)
 *
 * Sits under the row, which needs `relative overflow-hidden`.
 */
export function SwipeStrip({
  armed,
  label,
  armedLabel,
  done,
  rounded = false,
}: {
  /** Far enough that letting go now will do it. */
  armed: boolean;
  /** "Mark pulled". */
  label: string;
  /** "Let go to mark pulled". Defaults to the label. */
  armedLabel?: string;
  /** Set when there's nothing to do: "Already pulled". */
  done?: string | null;
  rounded?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      data-swipe-strip
      className={`absolute inset-0 flex items-center justify-end pr-5 transition-colors ${
        rounded ? "rounded-lg" : ""
      } ${done ? "bg-rule/40" : armed ? "bg-accent" : "bg-accent/20"}`}
    >
      <span
        className={`flex items-center gap-1.5 font-body text-sm font-medium ${
          done ? "text-muted" : armed ? "text-background" : "text-accent-ink"
        }`}
      >
        {done ? null : (
          <span
            className={`hex w-2.5 shrink-0 transition-[rotate,background-color] duration-150 ${
              armed ? "rotate-90 bg-background" : "bg-honey"
            }`}
          />
        )}
        {done ?? (armed ? (armedLabel ?? label) : label)}
      </span>
    </div>
  );
}
