import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const selected = probe.address().port;
    probe.close((error) => error ? reject(error) : resolve(selected));
  });
});
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...process.env, PATTS_POS_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

async function fetchWithRetry(path) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/${path}`);
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

async function expectNotFound(path) {
  const response = await fetch(`http://127.0.0.1:${port}/${path}`);
  if (response.status !== 404) throw new Error(`${path} unexpectedly returned HTTP ${response.status}`);
}

try {
  await access(join(root, "www", "index.html"));
  const html = await (await fetchWithRetry("index.html")).text();
  if (!html.includes("PATTS Offline POS") || !html.includes('src="./app.js"')) throw new Error("The app shell is incomplete.");
  for (const asset of ["app.js", "access.js", "backup.js", "checkout.js", "db.js", "inventory.js", "reader-protocol.js", "reader-diagnostics.js", "views.js"]) {
    const response = await fetchWithRetry(asset);
    if (!/javascript/.test(response.headers.get("content-type") || "")) throw new Error(`${asset} has the wrong content type.`);
  }
  await expectNotFound("package.json");
  await expectNotFound(".git/config");
  console.log("Web smoke check passed: app shell and JavaScript modules are available.");
} finally {
  server.kill();
}
