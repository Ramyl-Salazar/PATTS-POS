import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));
const destination = join(root, "www");
const assets = [
  "index.html",
  "styles.css",
  "app.js",
  "access.js",
  "backup.js",
  "checkout.js",
  "db.js",
  "inventory.js",
  "order.js",
  "reader-protocol.js",
  "reader-diagnostics.js",
  "views.js",
  "wallet.js",
  "students.js",
  "cards.js",
  "manifest.webmanifest",
  "sw.js",
  "icon.svg",
  "vendor",
];

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await Promise.all(assets.map((asset) => cp(join(root, asset), join(destination, asset), { recursive: true })));
console.log(`Bundled ${assets.length} offline assets into www/`);
