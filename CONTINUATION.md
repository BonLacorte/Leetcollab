# Continue on another device

This branch preserves unfinished Shadcn/ui migration progress and all existing
pipeline fixes, including the desktop room layout fix and minimal GitHub Actions
workflow. Publication is a transfer checkpoint. Final validation and real browser
authentication/collaboration testing are deferred, not passed. Nothing is merged
or deployed.

## Get this exact branch

```sh
git clone --branch fm/leetcollab-shadcn-all-screens https://github.com/BonLacorte/Leetcollab.git
```

Open a terminal in the cloned `Leetcollab` directory. Existing review:
https://github.com/BonLacorte/Leetcollab/pull/1

For an existing clean checkout already on this branch:

```sh
git pull --ff-only origin fm/leetcollab-shadcn-all-screens
```

## Start locally

Install Node.js 22 (see `.nvmrc`), enable Corepack, and start Docker Desktop or
Docker Engine. Commands below run from the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm supabase:start
cp apps/web/.env.example apps/web/.env.local
cp apps/realtime/.env.example apps/realtime/.env
```

Copy the local API URL and anonymous key printed by Supabase into both copied
environment files. Existing custom API port: `55421`; Studio: `55423`; Postgres:
`55432`. Use the local anonymous key, not a service-role key or production values.
The templates use web port `3000` and realtime port `3001`.

On a **brand-new disposable local database only**, initialize migrations and the
problem catalogue with:

```sh
pnpm supabase:reset
```

That command deletes local database contents. Skip it for any existing database
whose data must be preserved. Local users, database contents, ignored environment
files, and Docker volumes are not transferred by Git; a clone does not restore
the previous device's accounts or data.

```sh
pnpm dev
```

Open http://localhost:3000. Realtime health is http://localhost:3001/health.
The old device used ports `3200`/`3201` to avoid collisions; those ignored local
overrides are not required on a fresh device. Git does not preserve running
services. Only esbuild is approved to run dependency build scripts in
`pnpm-workspace.yaml`; keep the other script restrictions intact.

## Resume testing

- Create two disposable local email/password accounts in independent browser
  sessions. Local email confirmation is disabled in `supabase/config.toml`.
- Sign in, create a room, join it from the second account, inspect the workspace,
  exchange chat messages, and exercise member controls.
- Check light/dark themes, desktop layout and narrow/mobile sizing.
- Run `pnpm typecheck` and `pnpm build` when ready to resume validation. There is
  no workspace test script. `.github/workflows/ci.yml` runs frozen installation,
  typecheck and build for pull requests; no green CI result is claimed here.

Earlier typecheck/build and HTTP health probes passed. Real Supabase auth health
was restored on the old device without resetting data, but email/password signup,
sign-in, room creation, workspace and chat still need real browser verification.
Synthetic auth and health probes are insufficient evidence for those flows.

The previous browser attachment returned `BRIDGE_NOT_READY`; local Chromium
needed `libnspr4`, `libnss3` and `libasound2t64`, and package downloads failed with
DNS resolution errors for `archive.ubuntu.com`. Resume with a reachable Chrome
remote-debugging session and `chrome-devtools-axi`. These blockers are deferred.

The old no-mistakes run `01M75H8J74ZN8XEGF8166FRAHA` was cancelled before this
transfer. Start a fresh validation of the final transferred head when ready;
do not treat its earlier step results as validation of the latest commit.

This branch contains the existing email/password app. Separate backend work,
including Google auth and proposed Java editor integration, is not integrated.
No Java runtime is required by the startup commands above. Earlier UX scout
application/schema experiments were excluded from this UI migration.
