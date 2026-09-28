// Lets the plain-node test files import modules the way the app does.
//
// Next.js resolves "@/lib/csv" and extensionless relative imports for us; node
// does neither. Rather than making the library code import differently from the
// rest of the codebase just to be testable, teach node the same two rules.
//
// Used as: node --experimental-strip-types --import ./src/lib/test-resolver.mjs <test file>

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./test-resolver-hooks.mjs", pathToFileURL("./src/lib/"));
