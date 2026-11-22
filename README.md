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
4. Copy `apps/web/.env.example` to `apps/web/.env.local` and `apps/realtime/.env.example` to `apps/realtime/.env`, then fill the local API URL and anonymous key in both. Set the server-only `SUPABASE_SERVICE_ROLE_KEY` in the web environment and keep execution disabled for basic setup. For local judge and realtime credit configuration, follow [execution credit](docs/execution-credit.md#migration-and-restart).
5. Run `pnpm dlx supabase migration up --local` to apply pending migrations. Never reset an existing database.
6. Run `pnpm dev`.
7. Open `http://localhost:3000` in two browser sessions, create accounts, create a room, and join it from the second session.

The web app runs on port 3000 and the realtime service runs on port 3001, with health at `http://localhost:3001/health`. Supabase manages local Postgres and authentication through Docker. The unused local mail catcher and database pooler are disabled. See the local-service note below for the configured Supabase ports.

After installation, validate the workspace with `pnpm test`, `pnpm typecheck` and `pnpm build`. In non-interactive CI environments, use `CI=true pnpm install --frozen-lockfile`.

## Windows local-service note

The local ports and enabled services are configured in [`supabase/config.toml`](supabase/config.toml). The API gateway uses `http://127.0.0.1:55421`, Postgres uses port `55432`, and Studio uses port `55423` because Windows reserves ports 54231-54330 on the original development machine. Use the configured API URL in both environment files. Analytics and Supabase Edge Functions are disabled locally because this MVP does not use them.

## Practice

Sign in with email/password or Google. Google sign-in requires the operator configuration in [backend setup](docs/backend-setup.md#google-sign-in).

Creating or joining a room requires a live collaboration connection. If the homepage shows **Not connected**, select **Reconnect**, then create or join again once connected; reload if the connection still fails. Connection attempts and room confirmations have a 10-second wait limit. An unconfirmed request may have succeeded: it is never automatically replayed, and further room requests stay disabled until you reload to check for an active room. Use **Return to current room** when offered.

Choose an exercise to practice alone in a room, or share the room ID with collaborators. The catalogue contains 15 original exercises with Java starter code.

Your own Java edits autosave to a private draft every 10 minutes and on normal in-app navigation. Opening a room leaves the saved draft private. Use **Restore saved draft to shared editor** to fetch and share the latest saved draft. A failed draft read pauses autosave until a safe baseline is available. If another tab saves first, or the initial read finds an existing draft after you start editing, the Code card keeps your unsaved edit in a private recovery copy. Choose **Recover into shared editor** or **Discard unsaved draft** before editing that exercise again. The recovery copy survives in-app navigation in the same tab. Closing or reloading the tab can lose unsaved edits.

Use the Code card icons to reset to the exercise's starter code, restore your draft, or retrieve your latest saved Java Run or Submit for the exercise. These actions require edit permission and preserve shared edits made while a replacement is being prepared. If **Retry code sync** appears, use it to reload the room's code before editing or executing. If a replacement is still unconfirmed, check the editor and retry the intended action explicitly. Use the maximize and fold icons to change the Code card layout without losing the editor state. Press Escape to leave the maximized view.

Use **Run** or **Submit** for a LeetCollab verdict when the external sandbox is enabled. Both actions use the same fixture suite and save a personal submission. The controls show the execution allowance, reset time and provider disclosure. Keep secrets and sensitive information out of submissions. Only an accepted **Submit** grants new solved credit. Manual completion history stays unverified. See [execution allowance and room credit](docs/execution-credit.md) for charging and eligibility rules.

**Run** and **Submit** open the **Result** tab with pending status, the verdict and available diagnostics. Compiler errors can mark the matching editor revision and show the original submitted lines in Result. Code changes, confirmed replacements, exercise or user changes, and reconnects can clear the markers while the historical result remains available for the current exercise and user. Accepted and wrong-answer results show Input, Output and Expected for public examples when available. Private checks contribute to the overall result. See [structured judge results](docs/structured-judge-results.md) for diagnostic and public testcase limits.

The room logo links to the homepage. **Refresh status** retries unavailable execution and completion status requests. When your allowance is exhausted, eligible exercises link to a source judge whose results are unverified. Original exercises wait for reset.

Save a personal grade with **again**, **hard**, **good**, or **easy** to receive a suggested review date. These grades schedule review in 1, 3, 7 and 14 days respectively; they never count as a passing verdict or mark an exercise solved. Repeat practice is voluntary. **Due today** includes overdue reviews and reviews scheduled later in your local calendar day. The labelled demo history is illustrative and is not your progress.

## Design boundaries

Hosted tester-only execution can restrict Run, Submit and judge status to one
tester and exercise during a fixed window. See the
[restricted evaluation configuration](docs/onlinecompiler-integration.md#restricted-hosted-evaluation)
for admission requirements and closure behavior.

- Supabase stores durable user/profile, problem, progress, and submission data.
- Socket.IO owns live-only room presence, code, chat, and whiteboard state. This is intentional for the first MVP; state is lost after a server restart or after a room ends.
- Authenticated code execution uses an external sandbox and remains disabled until provider credentials and supported resource limits are confirmed. See [backend setup](docs/backend-setup.md) for Google OAuth, API contracts, migrations and operator requirements.
- Staging uses Vercel for `apps/web` (frontend and web API), Render for `apps/realtime`, and Supabase for data/auth. Production release follows scoped hosted validation; see [staging setup](docs/backend-setup.md#staging-setup).

See [the continuation guide](docs/continuation.md) for the default-branch handoff, historical evidence and remaining hosted validation.
