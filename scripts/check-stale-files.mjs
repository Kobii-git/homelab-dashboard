import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", "data", "dist", "node_modules", "playwright-report", "test-results"]);
const staleCopyPattern = / 2(?:\.|$)/;
const matches = [];

async function scan(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await scan(path);
    } else if (staleCopyPattern.test(basename(path))) {
      matches.push(relative(root, path));
    }
  }
}

await scan(root);

if (matches.length > 0) {
  console.error("Stale duplicate files are not allowed:");
  for (const match of matches.sort()) console.error(`- ${match}`);
  process.exitCode = 1;
}
