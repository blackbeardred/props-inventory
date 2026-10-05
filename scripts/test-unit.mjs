// Runs every unit test file (src/**/*.test.mjs), one node process each, and
// fails if any of them does. The tests use no framework: each file prints its
// checks and exits non-zero on a failure. The --import hook teaches node the
// "@/..." path alias.
//
//   npm run test:unit
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function find(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return find(path);
    return name.endsWith(".test.mjs") ? [path] : [];
  });
}

const files = find(join(root, "src")).sort();
let failed = 0;
for (const file of files) {
  const run = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", "--import", "./src/lib/test-resolver.mjs", file],
    { cwd: root, encoding: "utf8" }
  );
  const last = (run.stdout.trim().split("\n").pop() ?? "").trim();
  const ok = run.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${relative(root, file)}  ${last}`);
  if (!ok) {
    process.stdout.write(run.stdout);
    process.stderr.write(run.stderr);
  }
}
console.log(`\n${files.length - failed}/${files.length} test files passed`);
process.exit(failed ? 1 : 0);
