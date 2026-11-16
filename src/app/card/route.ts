/**
 * The address printed on the business card's QR code (Nov 2026).
 *
 * Printed cards can't be changed, so the QR code opens this address rather
 * than a page, and this sends people on. To send every card ever printed
 * somewhere else (a tryout link, the survey, a new domain), change
 * CARD_DESTINATION and push.
 *
 * A temporary redirect (307) on purpose: a permanent one would be
 * remembered by phones, and a later change would never reach them.
 */

import { NextResponse } from "next/server";

/** Where the card goes. A path on this site, or a full https address. */
const CARD_DESTINATION = "/";

export function GET(request: Request) {
  const response = NextResponse.redirect(new URL(CARD_DESTINATION, request.url), 307);
  response.headers.set("cache-control", "no-store");
  return response;
}
