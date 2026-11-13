# Backend setup and integration

Apply new migrations with `supabase migration up --local` for an existing local project, or review `supabase db push --dry-run` before an operator applies hosted migrations. Never reset an existing database. The migrations preserve prior rows and introduce 15 original exercises with private Java fixture harnesses. The profile backfill recovers existing Auth users with missing profiles using the signup normalization and collision rules, without replacing existing profiles. No proprietary statements or hidden tests were copied. The original exercises have no source judge, so their fallback is null.

## Google sign-in

Retain email/password. Render `GoogleSignInButton` on the sign-in surface; its optional `next` prop is a relative application path. Styling may change without duplicating its OAuth logic. The shared Supabase browser client uses PKCE cookies. `/auth/callback` exchanges the code and redirects only to a sanitized internal path. Errors return stable `authError` codes without provider details. Use a single origin consistently when starting and completing a flow.

An operator must configure the following, without putting secrets in tracked files:

1. In Google Auth Platform, choose a Web application OAuth client. Set the audience and test users as applicable. Allow only `openid`, email and profile scopes. Add the actual application origin under JavaScript origins, such as `http://localhost:3000` during development.
2. In Google authorized redirect URIs, use the Supabase callback, `https://<project-ref>.supabase.co/auth/v1/callback`. For this repository's remapped local gateway the callback is `http://127.0.0.1:55421/auth/v1/callback`. This is different from the application's callback.
3. In Supabase Auth providers, enable Google and enter the Google client ID/secret. Keep nonce checking enabled. For local development configure `[auth.external.google]` with the client ID and `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"`, then enable it only after local secrets are supplied.
4. Set Supabase Site URL to the real application origin. Add the application's `/auth/callback` URL to its redirect allow list, including the `next` query pattern for the intended internal destinations. Prefer explicit production origins; do not allow arbitrary preview domains. Local example: `http://localhost:3000/auth/callback?next=/**` plus the callback with no query.
5. Supabase's built-in automatic identity linking for matching verified email is accepted. Do not implement custom linking or enable manual linking. Verify that an existing confirmed email/password account retains its user ID and progress after Google sign-in, and that a distinct verified email creates a separate account.

No Google credentials are needed for controlled callback tests. Live consent, identity linking and hosted cookies still require operator verification.

References: [Supabase Google setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).

## Judge integration

Both judge endpoints require `Authorization: Bearer <Supabase access token>`. The server verifies the token through Supabase Auth. `POST /api/judge/submissions` accepts `{ problemId, language: "java", sourceCode, idempotencyKey }`; use one UUID per click and reuse it for retries. Success returns `{ ok: true, submission, quota }`. Failures return `{ ok: false, error, quota?, fallback? }`. `GET /api/judge/status?problemId=<uuid>` returns availability, quota, reset time and eligible fallback.

Fixtures, quota mutation and trusted verdict writes are server-only. Personal submissions are private. Read `user_problem_progress` under RLS and call `record_problem_grade(p_problem_id, p_grade)` with `again`, `hard`, `good`, or `easy`. Suggestions are respectively 1, 3, 7 and 14 days after the grade; practice is always voluntary. Review attempts are persisted independently per user. Historical client-authored submissions are `legacy_unverified`.

Quota is shared by the application account and reserved atomically before any provider request. Lowering the configured daily limit preserves consumed usage, even when it exceeds the new limit; remaining credits then stay at zero until reset. JDoodle documents a reset at 23:55 UTC. Reservations are never refunded after an ambiguous provider failure, since a request might have consumed a credit. Use a dedicated provider credential for this application, with no other callers, to keep this accounting authoritative. Never automatically retry provider calls. Exhaustion disables execution and exposes the reset time. Original exercises wait for reset. A source destination may be configured only after it is verified to judge the same exercise; external results are never LeetCollab verified. External-result recording is retired: the retained table and RPC are inaccessible to application roles, including service_role; fallback is a link only.

## Provider capability gate

Live execution is disabled by default, even with credentials. JDoodle REST documents no caller-configurable numeric compilation/runtime/memory/output ceilings. Broker deadlines, output caps and source restrictions are not sandbox enforcement. The operator must obtain concrete provider confirmation of finite compilation, runtime, memory, output and process limits, per-run filesystem isolation, no network access and the selected Java version/entry-point behavior before setting `JDOODLE_LIMITS_CONFIRMED=true`. If those guarantees cannot be obtained for the free plan, keep it false and report the capability blocker. Do not execute submissions locally as a workaround.

Server-only environment variables are listed in `apps/web/.env.example`. The adapter pins Java, accepts no extra libraries or compiler/runtime arguments, bounds the broker deadline to 30 seconds, limits source+harness to 64 KB, bounds response reading to 64 KB and output to 16 KB, and stores at most 4 KB of diagnostics. Provider CPU/memory fields are retained as opaque measurements; no undocumented memory unit is assumed. These application bounds do not stop remote execution. Regex source rejection is a usability restriction, not a security sandbox.

References: [REST contract](https://www.jdoodle.com/docs/api/rest), [quota and reset](https://www.jdoodle.com/docs/api/credits), [failures](https://www.jdoodle.com/docs/api/errors).

## Validation

Run `pnpm test`, `pnpm typecheck` and `pnpm build` with placeholder public Supabase variables if no local configuration exists. Run `supabase/tests/backend_mvp_rls.sql` through psql in a disposable local Supabase database with pgTAP. Also run `supabase/tests/quota_profile_recovery.sql` and `supabase/tests/external_recording_retired.sql` through psql against the migrated disposable database for quota/profile recovery and retired-recording permissions. Run `TEST_POSTGRES_CONTAINER=<local container> TEST_DATABASE_NAME=<test database> python3 supabase/tests/quota_concurrency.py` against that disposable database. The concurrency test uses two database connections and is unsuitable for shared or production databases. Mock execution proves broker behavior, not sandbox security or live Java execution. No deployment, provider request or hosted database mutation is part of this delivery.
