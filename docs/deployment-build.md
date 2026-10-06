# Production dependency cleanup

Use Node 20. The existing Render build command works unchanged:

```sh
npm ci --include=dev && npm run build
```

Keep the existing start command, `npm start`. Render sets
[`RENDER=true` during builds](https://render.com/docs/environment-variables).
After the client/server build finishes and its tsx/esbuild process exits, npm's
`postbuild` hook detects that flag, removes development packages with
`npm prune --omit=dev`, audits the remaining production dependency graph, then
smoke-tests the built app. Failure at any step fails the build and stops later
steps. No Render dashboard setting needs to change.
The smoke check uses Node's built-in modules, so it still runs after pruning. It
checks that build-only packages are absent, the server starts, health and built
HTML/JavaScript/CSS are served, and four protected API routes reject anonymous
requests. It uses no real credentials or customer data and makes no provider calls.

For an explicit deployment build outside Render, use:

```sh
npm ci --include=dev && npm run build:deploy
```

This wrapper sets `AIR_KING_DEPLOY_BUILD=true` only for a child `npm run build`,
which invokes the exact same `postbuild` path. The dependency-free helper invokes
npm through its JavaScript entrypoint for Windows compatibility. CI runs this
pipeline on Ubuntu and Windows after the normal release checks.

Without `RENDER=true` or `AIR_KING_DEPLOY_BUILD=true`, `npm run build` and
`npm run release:check` retain development packages for normal development.
Deployment builds intentionally remove them; run `npm ci --include=dev`
before resuming development, rebuilding, or running TypeScript tests after it.
`npm run smoke:production` can recheck an already-built, pruned deployment.

## Dependency advisory scope

`tailwindcss-animate` is used only by `tailwind.config.ts` during CSS compilation,
so it belongs in `devDependencies`. Its prior production classification pulled
Tailwind 3 and its file-watching/glob dependencies into the runtime install.
The production server build replaces `process.env.NODE_ENV` with `"production"`,
eliminating the development-only Vite branch before packages are pruned.

This change does not upgrade Tailwind or fix its development dependency advisory.
As checked October 6, 2026, `braces@3.0.3` is affected by
[GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The full development audit still reports seven high-severity affected packages
through that advisory; review `npm audit --include=dev` separately and use trusted
build inputs. Pruning removes the affected packages from the deployed runtime,
rather than suppressing or overriding the advisory.
The smoke check verifies all locked copies of Tailwind, braces, micromatch and
chokidar are absent from the deployed `node_modules` tree.

These checks do not replace authenticated workflow testing or a live provider
test. Publication and live deployment verification remain separate steps.
