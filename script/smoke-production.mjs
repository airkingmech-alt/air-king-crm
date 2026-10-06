import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// No dev dependencies: this check must run after npm prune --omit=dev.
const root = fileURLToPath(new URL("../", import.meta.url));
const buildOnlyPackages = new Set([
  "@tailwindcss/typography", "@tailwindcss/vite", "braces", "chokidar",
  "esbuild", "micromatch", "tailwindcss", "tailwindcss-animate", "tsx",
  "typescript", "vite",
]);
const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
for (const packagePath of Object.keys(lock.packages)) {
  const name = packagePath.split("node_modules/").at(-1);
  if (buildOnlyPackages.has(name)) {
    assert(!existsSync(join(root, packagePath, "package.json")),
      `${packagePath} is still installed; run npm run build:deploy first.`);
  }
}
assert(existsSync(join(root, "dist/index.cjs")), "Build the production server first.");

// Reserve an available port rather than conflicting with a developer's server.
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));

// An empty working directory prevents dotenv from loading real credentials.
// Only platform essentials are inherited; no provider or database keys are used.
const cwd = await mkdtemp(join(tmpdir(), "air-king-production-smoke-"));
const env = { NODE_ENV: "production", PORT: String(port), SUPABASE_URL: "http://127.0.0.1:1" };
for (const key of ["SystemRoot", "SYSTEMROOT", "WINDIR", "PATH", "Path", "PATHEXT"]) {
  if (process.env[key]) env[key] = process.env[key];
}
const server = spawn(process.execPath, [join(root, "dist/index.cjs")], {
  cwd, env, stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
let spawnError;
let closed = false;
server.on("error", error => { spawnError = error; });
const serverClosed = new Promise(resolve => server.once("close", () => { closed = true; resolve(); }));
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", chunk => { output = (output + chunk).slice(-16_000); });
}
const base = `http://127.0.0.1:${port}`;
const request = path => fetch(`${base}${path}`, { signal: AbortSignal.timeout(2_000) });

try {
  const deadline = Date.now() + 20_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    assert(!closed, `Production server exited before becoming healthy.\n${output}`);
    try {
      const response = await request("/api/health");
      healthy = response.status === 200 && (await response.json()).status === "ok";
    } catch { /* The server may still be starting. */ }
    if (healthy) break;
    await delay(100);
  }
  assert(healthy, `Production server did not become healthy.\n${output}`);

  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") || "", /text\/html/);
  const html = await page.text();
  assert.match(html, /id="root"/);
  const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+\.(?:js|css))"/g)]
    .map(match => match[1].slice(1));
  assert(assets.some(path => path.endsWith(".js")), "Built JavaScript asset is missing.");
  assert(assets.some(path => path.endsWith(".css")), "Built CSS asset is missing.");
  for (const asset of assets) {
    const response = await request(asset);
    assert.equal(response.status, 200, `Could not serve ${asset}`);
    assert.match(response.headers.get("content-type") || "", asset.endsWith(".css") ? /text\/css/ : /javascript/);
    assert((await response.text()).length > 0, `Empty built asset: ${asset}`);
  }

  for (const path of ["/api/crm/config", "/api/crm/memberships/smoke-test", "/api/scheduling", "/api/time-clock"]) {
    const response = await request(path);
    assert.equal(response.status, 401, `Anonymous access must be denied: ${path}`);
    assert.equal((await response.json()).error, "Please sign in.");
  }
  assert(!closed, `Production server exited during smoke checks.\n${output}`);
  console.log("Production smoke passed: build-only packages absent, health, HTML/JS/CSS, and 4 protected endpoints.");
} catch (error) {
  if (output) console.error(output);
  throw error;
} finally {
  if (!closed) {
    server.kill();
    await Promise.race([serverClosed, delay(5_000, undefined, { ref: false })]);
    if (!closed) {
      server.kill("SIGKILL");
      await serverClosed;
    }
  }
  await rm(cwd, { recursive: true, force: true });
}
