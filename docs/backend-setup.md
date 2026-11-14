# Backend setup and integration

Apply new migrations with `supabase migration up --local` for an existing local project, or review `supabase db push --dry-run` before an operator applies hosted migrations. Never reset an existing database. The migrations preserve prior rows and introduce 15 original exercises with private Java fixture harnesses. The profile backfill recovers existing Auth users with missing profiles using the signup normalization and collision rules, without replacing existing profiles. No proprietary statements or hidden tests were copied. The original exercises have no source judge, so their fallback is null.

## Staging setup

Use the existing Vercel web/API, Render realtime and Supabase database/auth split.
Next.js serves dynamic API and OAuth callback routes; deploy it as a server-capable
application. Use Node 22 (`.nvmrc`) and pnpm 11.16.0 (`package.json`). Both apps need
the repository workspace, root lockfile and `packages/contracts`; retain development
dependencies such as TypeScript and tsup during installation.

For Vercel, select Next.js with `apps/web` as project root and enable access to
workspace files outside that directory. Install from the repository workspace
with `CI=true pnpm install --frozen-lockfile`. Build contracts before web:

```sh
pnpm --filter @leetcollab/contracts build && pnpm --filter @leetcollab/web build
```

Confirm the configured install/build working directories resolve the workspace
and preserve the dynamic routes in actual deployment output.

For Render realtime, use the repository root as build context. Build:

```sh
CI=true pnpm install --frozen-lockfile && pnpm --filter @leetcollab/contracts build && pnpm --filter @leetcollab/realtime build
```

Start with `pnpm --filter @leetcollab/realtime start`, use `/health` for process
health and keep one instance with autoscaling disabled. Rooms, shared code, chat,
timer and whiteboard are in memory and disappear on process replacement. A disk
does not persist these Maps; personal saved drafts and grades live in Supabase.

| Location | Environment names and boundary |
| --- | --- |
| Web public build configuration | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SOCKET_URL`. Use the hosted Supabase URL/key and Render public HTTPS origin. Rebuild when these values change. |
| Web server runtime | `SUPABASE_SERVICE_ROLE_KEY`; optional `SUPABASE_URL` override must select the same project. The service-role key is required even for disabled-judge status paths that instantiate the admin client. |
| Realtime runtime | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CORS_ORIGIN` set to the exact frontend origin. Render supplies `PORT`. Realtime needs no service-role key. |
| Deferred judge, web server only | `JDOODLE_CLIENT_ID`, `JDOODLE_CLIENT_SECRET`, `JDOODLE_JAVA_VERSION_INDEX`, `JDOODLE_LIMITS_CONFIRMED`; tuning: `JUDGE_DAILY_LIMIT`, `JUDGE_MAX_CONCURRENCY`, `JUDGE_RESERVATION_SECONDS`, `JUDGE_REQUEST_TIMEOUT_MS`. Keep `JDOODLE_LIMITS_CONFIRMED=false` and execution disabled. |

The anonymous key is public by design and relies on RLS. Never prefix service-role
or provider credentials with `NEXT_PUBLIC_`, expose them in browser assets/network,
or commit values. Keep the Google client secret in Supabase provider configuration.
The tracked app `.env.example` files list local defaults; loopback addresses cannot
serve hosted apps.

Choose a stable staging frontend HTTPS origin. Match it in realtime `CORS_ORIGIN`,
Google JavaScript origins and Supabase Site URL/redirect allowlists. Configure
Google's Supabase `/auth/v1/callback` separately from the application's
`/auth/callback`, including intended `next` patterns, as described below. Avoid
arbitrary preview-domain wildcards and ensure preview protection permits the test
browsers and callback. The browser forces WebSocket transport: confirm its actual
authenticated connection to Render. HTTP CORS configuration alone does not enforce
a WebSocket Origin allowlist or prove authorization.

Before applying hosted schema, inventory migration history against
`supabase/migrations`, review `supabase db push --dry-run` for additive changes,
and preserve existing rows. Never reset or blindly replay historical migrations.
Review all migrations, including grade fixes, quota preservation, profile backfill
and retired external-recording permissions. Verify the 15 enabled exercises and
private fixtures supplied by migrations, profile coverage and actual grants/RLS
under dedicated user tokens. `supabase/seed.sql` is intentionally empty. Run the
existing database regressions only in a separately disposable database.

Use the [two-user staging checklist](../CONTINUATION.md#staging-handoff) and record
the deployed revision and results. A successful build, `/health` response or local
browser pass does not establish hosted Auth, schema parity, WebSockets or privacy.
Retain the previous app revision for rollback and review schema compatibility;
rolling back the app does not roll back database changes. Production release
follows the scoped hosted checks; full product E2E also requires live execution.

## Google sign-in

Retain email/password. Render `GoogleSignInButton` on the sign-in surface; its optional `next` prop is a relative application path. Styling may change without duplicating its OAuth logic. The shared Supabase browser client uses PKCE cookies. `/auth/callback` exchanges the code and redirects only to a sanitized internal path. Errors return stable `authError` codes without provider details. Use a single origin consistently when starting and completing a flow.

An operator must configure the following, without putting secrets in tracked files:

1. In Google Auth Platform, choose a Web application OAuth client. Set the audience and test users as applicable. Allow only `openid`, email and profile scopes. Add the actual application origin under JavaScript origins, such as `http://localhost:3000` during development.
2. In Google authorized redirect URIs, use the Supabase callback, `https://<project-ref>.supabase.co/auth/v1/callback`. For this repository's remapped local gateway the callback is `http://127.0.0.1:55421/auth/v1/callback`. This is different from the application's callback.
3. In Supabase Auth providers, enable Google and enter the Google client ID/secret. Keep nonce checking enabled. For local development configure `[auth.external.google]` with the client ID and `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"`, then enable it only after local secrets are supplied.
4. Set Supabase Site URL to the real application origin. Add the application's `/auth/callback` URL to its redirect allow list, including the `next` query pattern for the intended internal destinations. Prefer explicit production origins; do not allow arbitrary preview domains. Local example: `http://localhost:3000/auth/callback?next=/**` plus the callback with no query.
5. Supabase's built-in automatic identity linking for matching verified email is accepted. Do not implement custom linking or enable manual linking. Verify that an existing confirmed email/password account retains its user ID and progress after Google sign-in, and that a distinct verified email creates a separate account.

No Google credentials are needed for controlled callback tests. The later Google live follow-up, summarized in the 2026-11-14 readiness assessment, records a user report of same-email Google sign-in loading a previous draft. This establishes observed local access/continuity, not an independent measurement of stable user IDs, distinct-email separation or all progress/submission continuity. Verify those properties and HTTPS cookies on the target hosted environment; do not treat historical local success as hosted verification.

The application callback returns a relative `Location` header so the browser retains its public origin even when Next binds to `0.0.0.0`. Redirects use only sanitized internal paths and stable error codes; request origins and forwarding headers do not choose a redirect origin.

References: [Supabase Google setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).

## Judge integration

Both judge endpoints require `Authorization: Bearer <Supabase access token>`. The server verifies the token through Supabase Auth. `POST /api/judge/submissions` accepts `{ problemId, language: "java", sourceCode, idempotencyKey }`; use one UUID per click and reuse it for retries. Success returns `{ ok: true, submission, quota }`. Failures return `{ ok: false, error, quota?, fallback? }`. `GET /api/judge/status?problemId=<uuid>` returns availability, quota, reset time and eligible fallback.

Fixtures, quota mutation and trusted verdict writes are server-only. Personal submissions are private. Read `user_problem_progress` under RLS and call `record_problem_grade(p_problem_id, p_grade)` with `again`, `hard`, `good`, or `easy`. Review attempts are persisted independently per user. Historical client-authored submissions are `legacy_unverified`. Room completion is derived from private, persisted submissions with `verification = leetcollab`, `judge_state = completed`, `verdict = accepted`, and matching positive passed/total test counts. Client-authored progress and personal grades never provide completion evidence. Existing manual completion fields remain historical unverified data; no backfill promotes them to verified. See [Practice](../README.md#practice) for Run, Submit and personal review grade behavior.

Quota is shared by the application account and reserved atomically before any provider request. Lowering the configured daily limit preserves consumed usage, even when it exceeds the new limit; remaining credits then stay at zero until reset. JDoodle documents a reset at 23:55 UTC. Reservations are never refunded after an ambiguous provider failure, since a request might have consumed a credit. Use a dedicated provider credential for this application, with no other callers, to keep this accounting authoritative. Never automatically retry provider calls. Exhaustion disables execution and exposes the reset time. Original exercises wait for reset. A source destination may be configured only after it is verified to judge the same exercise; external results are never LeetCollab verified. External-result recording is retired: the retained table and RPC are inaccessible to application roles, including service_role; fallback is a link only.

## Provider capability gate

Live execution is disabled by default, even with credentials. JDoodle REST documents no caller-configurable numeric compilation/runtime/memory/output ceilings. Broker deadlines, output caps and source restrictions are not sandbox enforcement. The operator must obtain concrete provider confirmation of finite compilation, runtime, memory, output and process limits, per-run filesystem isolation, no network access and the selected Java version/entry-point behavior before setting `JDOODLE_LIMITS_CONFIRMED=true`. If those guarantees cannot be obtained for the free plan, keep it false and report the capability blocker. Do not execute submissions locally as a workaround.

Server-only environment variables are listed in `apps/web/.env.example`. The adapter pins Java, accepts no extra libraries or compiler/runtime arguments, bounds the broker deadline to 30 seconds, limits source+harness to 64 KB, bounds response reading to 64 KB and output to 16 KB, and stores at most 4 KB of diagnostics. Provider CPU/memory fields are retained as opaque measurements; no undocumented memory unit is assumed. These application bounds do not stop remote execution. Regex source rejection is a usability restriction, not a security sandbox.

References: [REST contract](https://www.jdoodle.com/docs/api/rest), [quota and reset](https://www.jdoodle.com/docs/api/credits), [failures](https://www.jdoodle.com/docs/api/errors).

## Validation

Run `pnpm test`, `pnpm typecheck` and `pnpm build` with placeholder public Supabase variables if no local configuration exists. Run `supabase/tests/backend_mvp_rls.sql` through psql in a disposable local Supabase database with pgTAP. Also run `supabase/tests/quota_profile_recovery.sql` and `supabase/tests/external_recording_retired.sql` through psql against the migrated disposable database for quota/profile recovery and retired-recording permissions. Run `TEST_POSTGRES_CONTAINER=<local container> TEST_DATABASE_NAME=<test database> python3 supabase/tests/quota_concurrency.py` against that disposable database. The concurrency test uses two database connections and is unsuitable for shared or production databases. Mock execution proves broker behavior, not sandbox security or live Java execution. These local checks do not establish a deployment, live provider execution or hosted database parity.
