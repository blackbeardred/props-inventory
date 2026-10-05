import { redirect } from "next/navigation";

/** Locations are browsed inside Inventory now: rooms are the tiles at the
 *  top, and you walk into them. */
export default function LocationsRedirect() {
  redirect("/inventory");
}
