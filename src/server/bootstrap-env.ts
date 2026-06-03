import fs from "node:fs";
import path from "node:path";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "file:../data/homelab.db";
}

const dbUrl = process.env.DATABASE_URL;
if (dbUrl.startsWith("file:")) {
  const filePath = dbUrl.slice("file:".length);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}
