/** The cookie that remembers List or Grid on the items page. Kept out of the
 *  client component that sets it: a constant exported from a "use client"
 *  module reaches a server component as a client reference, not a string. */
export const ITEMS_VIEW_COOKIE = "items-view";
