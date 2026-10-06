import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Invoke npm's JavaScript entrypoint directly: npm.cmd needs a shell on Windows.
export function runNpm(args, env = process.env, spawn = spawnSync) {
  if (!env.npm_execpath) throw new Error("Run deployment commands through npm scripts.");
  const result = spawn(process.execPath, [env.npm_execpath, ...args], {
    env, stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export function runDeploymentBuild(env = process.env, run = runNpm) {
  // Use the same build and postbuild lifecycle as Render, without shell-specific
  // environment assignment or changing the caller's environment.
  return run(["run", "build"], { ...env, AIR_KING_DEPLOY_BUILD: "true" });
}

export function runPostbuild(env = process.env, run = runNpm) {
  if (env.RENDER !== "true" && env.AIR_KING_DEPLOY_BUILD !== "true") return 0;
  // npm starts postbuild only after the tsx/esbuild process has exited.
  // This helper and the smoke test use built-ins and survive dev pruning.
  for (const args of [
    ["prune", "--omit=dev"],
    ["audit", "--omit=dev"],
    ["run", "smoke:production"],
  ]) {
    const status = run(args, env);
    if (status !== 0) return status;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2];
    if (mode !== "build" && mode !== "postbuild") throw new Error("Expected build or postbuild.");
    process.exitCode = mode === "build" ? runDeploymentBuild() : runPostbuild();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
