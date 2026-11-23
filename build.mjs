import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));
const destination = join(root, "www");
const assets = [
  "index.html",
  "styles.css",
  "app.js",
  "db.js",
  "wallet.js",
  "students.js",
  "manifest.webmanifest",
  "icon.svg",
  "vendor",
];

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await Promise.all(assets.map((asset) => cp(join(root, asset), join(destination, asset), { recursive: true })));
console.log(`Bundled ${assets.length} offline assets into www/`);
