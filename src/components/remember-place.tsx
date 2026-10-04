"use client";

import { useEffect } from "react";
import { rememberChecklist, rememberProduction } from "@/lib/recent-places";

/** Notes the production (and, on a checklist, the checklist) this device has
 *  open, for the hexagon menu's shortcuts. Renders nothing. */
export function RememberPlace({
  id,
  name,
  checklist = false,
}: {
  id: string;
  name: string;
  checklist?: boolean;
}) {
  useEffect(() => {
    if (checklist) rememberChecklist({ id, name });
    else rememberProduction({ id, name });
  }, [id, name, checklist]);
  return null;
}
