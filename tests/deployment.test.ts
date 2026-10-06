import assert from "node:assert/strict";
import test from "node:test";
import { runDeploymentBuild, runNpm, runPostbuild } from "../script/deployment.mjs";

const cleanup = [
  ["prune", "--omit=dev"],
  ["audit", "--omit=dev"],
  ["run", "smoke:production"],
];

test("ordinary local builds do not prune or audit the developer install", () => {
  for (const env of [{}, { NODE_ENV: "production" }, { RENDER: "false" },
    { RENDER: "1" }, { AIR_KING_DEPLOY_BUILD: "false" }]) {
    assert.equal(runPostbuild(env, () => assert.fail("Local builds must retain dev dependencies")), 0);
  }
});

test("Render and explicit deployment builds use the same ordered cleanup", () => {
  for (const env of [{ RENDER: "true" }, { AIR_KING_DEPLOY_BUILD: "true" },
    { RENDER: "true", AIR_KING_DEPLOY_BUILD: "true" }]) {
    const commands: string[][] = [];
    assert.equal(runPostbuild(env, (args: string[], childEnv: object) => {
      assert.equal(childEnv, env);
      commands.push(args);
      return 0;
    }), 0);
    assert.deepEqual(commands, cleanup);
  }
});

test("deployment wrapper flags a normal npm build without mutating the parent env", () => {
  const env = { npm_execpath: "path with spaces/npm-cli.js", RENDER: "false" };
  const calls: unknown[] = [];
  assert.equal(runDeploymentBuild(env, (args: string[], childEnv: object) => {
    calls.push([args, childEnv]);
    return 7;
  }), 7);
  assert.deepEqual(calls, [[["run", "build"], { ...env, AIR_KING_DEPLOY_BUILD: "true" }]]);
  assert.equal(Object.hasOwn(env, "AIR_KING_DEPLOY_BUILD"), false);
});

test("cleanup propagates prune, audit, or smoke failure and never runs later steps", () => {
  for (let failedStep = 0; failedStep < cleanup.length; failedStep++) {
    const commands: string[][] = [];
    assert.equal(runPostbuild({ RENDER: "true" }, (args: string[]) => {
      commands.push(args);
      return commands.length - 1 === failedStep ? 13 : 0;
    }), 13);
    assert.deepEqual(commands, cleanup.slice(0, failedStep + 1));
  }
});

test("spawn errors abort cleanup instead of proceeding to later commands", () => {
  const failure = new Error("could not start npm");
  let calls = 0;
  assert.throws(() => runPostbuild({ RENDER: "true" }, () => {
    calls++;
    throw failure;
  }), failure);
  assert.equal(calls, 1);
});

test("npm commands use the current Node executable and npm entrypoint without a shell", () => {
  const env = { npm_execpath: "path with spaces/npm-cli.js" };
  const calls: unknown[] = [];
  assert.equal(runNpm(cleanup[0], env, (...args: unknown[]) => {
    calls.push(args);
    return { status: 0 };
  }), 0);
  assert.deepEqual(calls, [[process.execPath, [env.npm_execpath, ...cleanup[0]], { env, stdio: "inherit" }]]);
});

test("missing npm entrypoint, process errors, and signals cannot report success", () => {
  assert.throws(() => runNpm([], {}, () => assert.fail("Must not spawn")), /through npm scripts/);
  const env = { npm_execpath: "npm-cli.js" };
  const failure = new Error("spawn failed");
  assert.throws(() => runNpm([], env, () => ({ error: failure })), failure);
  assert.equal(runNpm([], env, () => ({ status: null, signal: "SIGTERM" })), 1);
});
