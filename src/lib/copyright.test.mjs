// Tests for the copyright notice. Run with:
//   node --experimental-strip-types src/lib/copyright.test.mjs

import { copyrightNotice, copyrightYears, COPYRIGHT_HOLDER, FIRST_YEAR } from "./copyright.ts";

let passed = 0;
let failed = 0;
function eq(label, actual, expected) {
  if (actual === expected) { passed += 1; console.log(`  PASS  ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`); }
}

eq("it counts from the year Propolis was first published", FIRST_YEAR, 2026);
eq("it names the brand", COPYRIGHT_HOLDER, "Propolis");
eq("in the first year, one year", copyrightYears(new Date(2026, 10, 5)), "2026");
eq("on New Year's Eve, still one", copyrightYears(new Date(2026, 11, 31, 23, 59)), "2026");
eq("from the next year, a range", copyrightYears(new Date(2027, 0, 1)), "2026–2027");
eq("and the range keeps running", copyrightYears(new Date(2030, 5, 1)), "2026–2030");
eq("a clock set wrong never gives a year before the first", copyrightYears(new Date(2020, 0, 1)), "2026");
eq("the whole notice", copyrightNotice(new Date(2026, 10, 5)), "© 2026 Propolis. All rights reserved.");
eq("the whole notice, later", copyrightNotice(new Date(2028, 2, 1)), "© 2026–2028 Propolis. All rights reserved.");

console.log("");
console.log(`════ ${passed} passed, ${failed} failed ════`);
process.exit(failed ? 1 : 0);
