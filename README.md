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

Choose an exercise to practice alone in a room, or share the room ID with collaborators. The catalogue contains 15 original exercises with Java starter code. Changed Java code autosaves to your personal draft every 10 minutes and on normal in-app navigation. Saved drafts stay private when you open a room. Only your own editor changes autosave. If another tab has already saved a newer draft, the older save is rejected and the open editor keeps its text. Use the Restore saved draft icon to load your private draft into the shared editor when you have edit permission. A failed draft read pauses autosave to protect the saved copy; save/load errors appear in the Code card. The icon buttons reset the shared editor to the selected starter or retrieve your latest saved Run/Submit submission for this exercise and language. Both require edit permission; retrieval keeps newer shared edits made while the request is pending. Closing the browser or losing the network before a save completes can still lose changes since the last successful save. Use **Run** or **Submit** for a LeetCollab verdict when the external sandbox is enabled. When OnlineCompiler is selected, the controls disclose code/harness transmission and 365-day provider retention before execution; do not include secrets or sensitive information. Both actions use the same judge, run all private fixture test cases and save a personal submission; there is no separate sample-only execution mode. Only an accepted **Submit** creates new verified solved credit for its actor and the authenticated room members present at Submit admission; an accepted Run never creates new solved credit or removes earlier credit; see the [completion evidence contract](docs/backend-setup.md#judge-integration). Manual completion history remains labelled unverified and does not count as solved. Run and Submit open the Result tab with the pending state, verdict, and available safe diagnostics. Submission-validation failures also appear there. Compiler feedback includes recognized error categories and line numbers within your submitted source; raw harness echoes and runtime output are withheld to protect private tests. When the provider supplies no usable compiler location, Result explains that detailed diagnostics are unavailable. Structured compiler errors mark the matching submitted editor revision and show its original source lines in Result. Editing, resetting, retrieving or changing exercise/user clears the markers. Compiler totals are shown only when known; partial diagnostics are labelled. Accepted and wrong-answer results show public-case Input, Output and Expected details when the judge can safely attribute those outcomes; private cases remain aggregate checks and missing details stay unavailable. The room logo links to the homepage; **Refresh status** retries unavailable execution and completion status requests. The editor shows your personal execution allowance and reset time: 25 per normal daily period, or the explicitly configured 50-run local test allowance. Each click charges only its actor; room credit never consumes partners' allowances. When exhausted, eligible exercises link to a source judge with results labelled unverified; original exercises wait for reset.

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
