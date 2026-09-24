import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

// Use the exact installed lockfile packages; never fetch licenses during a build.
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const groups = new Map();
const inventory = [];
const readLicense = path => readFileSync(path, "utf8").replace(/\r\n?/g, "\n")
  .split("\n").map(line => line.trimEnd()).join("\n").trim();
for (const [path, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b, "en"))) {
  if (!path || entry.dev) continue;
  const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
  if (pkg.version !== entry.version || !entry.license) throw new Error(`License/install metadata mismatch: ${path}`);
  const names = readdirSync(path).filter(name => /^(license|licence|copying|notice)(\..*)?$/i.test(name)).sort();
  const texts = names.map(name => readLicense(join(path, name)));
  if (pkg.name === "abstract-logging" && !texts.length) texts.push(readLicense("licenses/abstract-logging.txt"));
  if (!texts.length) throw new Error(`Missing license text: ${pkg.name}`);
  const text = texts.join("\n\n");
  const hash = createHash("sha256").update(text).digest("hex");
  const id = `${pkg.name}@${pkg.version}`;
  inventory.push(`${id} — ${entry.license}`);
  if (!groups.has(hash)) groups.set(hash, { packages: [], text });
  groups.get(hash).packages.push(id);
}
const output = `THIRD-PARTY SOFTWARE NOTICES\nGenerated from package-lock.json by npm run licenses:generate.\nThird-party copyright notices are retained as required by their licenses.\n\n${inventory.join("\n")}\n\n${[...groups.values()].map(group => `${"=".repeat(72)}\n${group.packages.join("\n")}\n\n${group.text}`).join("\n\n")}\n`;
const target = "public/third-party-licenses.txt";
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== output) throw new Error("Third-party notices are stale; run npm run licenses:generate");
} else writeFileSync(target, output);
console.log(`Verified notices for ${inventory.length} production packages (${groups.size} license groups).`);
