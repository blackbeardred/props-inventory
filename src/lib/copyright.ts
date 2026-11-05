/**
 * The copyright notice, in one place, so every footer says the same thing
 * and a change of owner is a one-line edit.
 *
 * The site shows the brand, "Propolis". The legal owner is named in LICENSE
 * at the root of the repository. When Propolis becomes a company, change
 * both: the company's name goes in LICENSE, and here too if the notice
 * should name it ("Propolis LLC").
 */

export const COPYRIGHT_HOLDER = "Propolis";

/** The year the work was first published. A notice counts from here. */
export const FIRST_YEAR = 2026;

/** "2026", or "2026–2028" once the years run on. */
export function copyrightYears(now: Date = new Date()): string {
  const year = now.getFullYear();
  return year > FIRST_YEAR ? `${FIRST_YEAR}–${year}` : String(FIRST_YEAR);
}

/** "© 2026 Propolis. All rights reserved." */
export function copyrightNotice(now: Date = new Date()): string {
  return `© ${copyrightYears(now)} ${COPYRIGHT_HOLDER}. All rights reserved.`;
}
