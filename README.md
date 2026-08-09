# LeetCollab revival

LeetCollab is a collaborative coding-practice application. The project is organised as a pnpm monorepo so the web application, persistent Socket.IO service, and their shared contracts are versioned together but deployed independently.

## Local prerequisites

- Node.js 22 (see `.nvmrc`)
- pnpm 11 via Corepack
- Docker Desktop running (required by local Supabase)

The previous checkout has a broken npm installation. Repair/reinstall Node.js if `npm --version` fails, then run `corepack enable` and activate pnpm 11 in an elevated terminal if required by your Node installation. This workspace has been verified against the locally available pnpm 11.16.0.

## First local run

1. Start Docker Desktop.
2. From this directory, run `pnpm install`.
3. Run `pnpm supabase:start`; copy the printed local API URL and anonymous key.
4. Copy `apps/web/.env.example` to `apps/web/.env.local` and `apps/realtime/.env.example` to `apps/realtime/.env`, then fill the copied Supabase values.
5. Run `pnpm supabase:reset` to apply migrations and seed the catalogue.
6. Run `pnpm dev`.
7. Open `http://localhost:3000` in two browser sessions, create accounts, create a room, and join it from the second session.

The web app runs on port 3000 and the realtime service runs on port 3001. Supabase manages local Postgres and authentication through Docker. On this Windows development machine, local Supabase Postgres uses port 55432, Studio uses port 55423, and Analytics uses port 55437 because Windows reserves ports 54231–54330. The unused local mail catcher and database pooler are disabled.

After installation, validate the workspace with `pnpm typecheck` and `pnpm build`. In non-interactive CI environments, use `CI=true pnpm install --frozen-lockfile`.

## Windows local-port note

The Supabase API gateway is also remapped to `http://127.0.0.1:55421` on this machine. Use that URL in both generated environment files; do not use the usual `54321` local URL.

## Windows local-service note

Local Supabase uses API port `55421`, Postgres port `55432`, and Studio port `55423` on this machine because Windows reserves ports 54231-54330. Analytics and Supabase Edge Functions are disabled locally because this MVP does not use them.

## Design boundaries

- Supabase stores durable user/profile, problem, progress, and submission data.
- Socket.IO owns live-only room presence, code, chat, and whiteboard state. This is intentional for the first MVP; state is lost after a server restart or after a room ends.
- Code execution is deliberately disabled. A future runner must be isolated from the Socket.IO service.
- Production deployment is deferred until the local MVP is validated: Vercel hosts `apps/web`, Render hosts `apps/realtime`, and Supabase hosts data/auth.

See [IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md) for the step-by-step creation record and verification status.
