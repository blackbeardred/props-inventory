// The resolution rules themselves, run on node's module-loading thread.

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolvePath, dirname } from "node:path";

const SOURCE_ROOT = resolvePath(process.cwd(), "src");

export async function resolve(specifier, context, nextResolve) {
  let target = specifier;

  // "@/lib/csv" → <repo>/src/lib/csv
  if (target.startsWith("@/")) {
    target = pathToFileURL(resolvePath(SOURCE_ROOT, target.slice(2))).href;
  } else if (target.startsWith(".") && context.parentURL?.startsWith("file:")) {
    target = pathToFileURL(
      resolvePath(dirname(fileURLToPath(context.parentURL)), target)
    ).href;
  } else {
    return nextResolve(specifier, context);
  }

  // Extensionless imports: try the TypeScript file, then the plain one.
  const path = fileURLToPath(target);
  for (const candidate of [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`]) {
    if (existsSync(candidate)) {
      return nextResolve(pathToFileURL(candidate).href, context);
    }
  }

  return nextResolve(target, context);
}
