# LeetCollab revival

LeetCollab is a collaborative coding-practice application. The project is organised as a pnpm monorepo so the web application, persistent Socket.IO service, and their shared contracts are versioned together but deployed independently.

## Local prerequisites

- Node.js 22 (see `.nvmrc`)
- pnpm 11 via Corepack
- Docker Desktop running (required by local Supabase)

The previous checkout has a broken npm installation. Repair/reinstall Node.js if `npm --version` fails, then run `corepack enable` and activate pnpm 11 in an elevated terminal if required by your Node installation. This workspace has been verified against the locally available pnpm 11.16.0.

## First local run

1. Start Docker Desktop.
2. From this directory, run `corepack enable` and `pnpm install --frozen-lockfile`.
3. Run `pnpm supabase:start`; copy the printed local API URL, anonymous key and server-only service-role key.
4. Copy `apps/web/.env.example` to `apps/web/.env.local` and `apps/realtime/.env.example` to `apps/realtime/.env`, then fill the local API URL and anonymous key in both. Set `SUPABASE_SERVICE_ROLE_KEY` only in the web environment; leave JDoodle disabled.
5. Run `pnpm dlx supabase migration up --local` to apply pending migrations. Never reset an existing database.
6. Run `pnpm dev`.
7. Open `http://localhost:3000` in two browser sessions, create accounts, create a room, and join it from the second session.

The web app runs on port 3000 and the realtime service runs on port 3001, with health at `http://localhost:3001/health`. Supabase manages local Postgres and authentication through Docker. The unused local mail catcher and database pooler are disabled. See the local-service note below for the configured Supabase ports.

After installation, validate the workspace with `pnpm test`, `pnpm typecheck` and `pnpm build`. In non-interactive CI environments, use `CI=true pnpm install --frozen-lockfile`.

## Windows local-service note

The local ports and enabled services are configured in [`supabase/config.toml`](supabase/config.toml). The API gateway uses `http://127.0.0.1:55421`, Postgres uses port `55432`, and Studio uses port `55423` because Windows reserves ports 54231-54330 on the original development machine. Use the configured API URL in both environment files. Analytics and Supabase Edge Functions are disabled locally because this MVP does not use them.

## Practice

Sign in with email/password or Google. Google sign-in requires the operator configuration in [backend setup](docs/backend-setup.md#google-sign-in).

Choose an exercise to practice alone in a room, or share the room ID with collaborators. The catalogue contains 15 original exercises with Java starter code. Save drafts independently from other room members. Use **Run** or **Submit** for a LeetCollab verdict when the external sandbox is enabled. Both actions use the same judge, run all private fixture test cases and save a personal submission; there is no separate sample-only execution mode. A verified passing submission marks the problem solved; see the [completion evidence contract](docs/backend-setup.md#judge-integration). Manual completion history remains labelled unverified and does not count as solved. Verdicts appear above the editor. The room logo links to the homepage; **Refresh status** retries unavailable execution and completion status requests. The editor shows the shared execution allowance and reset time. When exhausted, eligible exercises link to a source judge with results labelled unverified; original exercises wait for reset.

Save a personal grade with **again**, **hard**, **good**, or **easy** to receive a suggested review date. These grades schedule review in 1, 3, 7 and 14 days respectively; they never count as a passing verdict or mark an exercise solved. Repeat practice is voluntary. **Due today** includes overdue reviews and reviews scheduled later in your local calendar day. The labelled demo history is illustrative and is not your progress.

## Design boundaries

- Supabase stores durable user/profile, problem, progress, and submission data.
- Socket.IO owns live-only room presence, code, chat, and whiteboard state. This is intentional for the first MVP; state is lost after a server restart or after a room ends.
- Authenticated code execution uses an external sandbox and remains disabled until provider credentials and supported resource limits are confirmed. See [backend setup](docs/backend-setup.md) for Google OAuth, API contracts, migrations and operator requirements.
- Staging uses Vercel for `apps/web` (frontend and web API), Render for `apps/realtime`, and Supabase for data/auth. Production release follows scoped hosted validation; see [staging setup](docs/backend-setup.md#staging-setup).

See [the continuation guide](docs/continuation.md) for the default-branch handoff, historical evidence and remaining hosted validation.
