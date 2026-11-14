# Continue the application

Continue from the repository's default branch, `main`:

```sh
git clone https://github.com/BonLacorte/Leetcollab.git
```

The 2026-11-14 readiness assessment inspected main at
`91b9fe7eb6ca8c7b3c75d2521bc637f72c72fa1b`, which includes the combined UI/backend
work and subsequent completion-evidence and OAuth callback fixes. The earlier
feature-branch handoff is superseded. Record the exact candidate revision when
resuming; this historical assessment does not establish later deployment state.

## Local setup

Follow [First local run](README.md#first-local-run) for prerequisites, installation,
local environment setup, additive migrations and startup. Keep provider execution
disabled until the requirements in [backend setup](docs/backend-setup.md) are met.
Only esbuild's dependency build script is approved in `pnpm-workspace.yaml`.

Use separate browser profiles for two disposable accounts. Local email confirmation
is disabled; hosted Auth may require confirmation. Select an exercise to create a
room, then join its room ID from the other account. Git does not transfer accounts,
database volumes, ignored credentials, dependencies or running services. Never
reset an existing database. The standalone [prototype](docs/prototypes/README.md)
remains available.

## Staging handoff

Use the existing split: Vercel hosts the Next.js frontend, web API and OAuth
callback; Render hosts realtime; Supabase hosts database/auth. Follow
[staging setup](docs/backend-setup.md#staging-setup) for workspace builds,
environment boundaries, stable origins and additive schema review. Local loopback
services cannot supply the hosted apps.

Before testing, record the deployed revision, frontend and realtime HTTPS URLs,
migration parity, test-account aliases and expected nonsecret draft/grade markers.
Use two independent browser profiles and retain expected/actual results, sanitized
errors and screenshots. Do not include tokens, credentials or personal data.

Scoped two-user E2E checklist:

- [ ] Load the frontend, a room deep link and realtime `/health`; verify an actual
  authenticated secure WebSocket connection from the frontend. Health alone proves
  process responsiveness, not Auth, database access or collaboration.
- [ ] Sign up/sign in A and B with the intended confirmation policy; reload and sign
  out/in. Verify profiles, session isolation and hosted Google callback/cookies with
  a designated test account when configured.
- [ ] A creates a room; B joins. Check invalid IDs, Return to current room and reload.
  Edit code and chat in both directions; exercise whiteboard and shared timer.
- [ ] Revoke and restore B's edit/chat/draw/problem permissions. Verify server denial
  under B's own token as well as UI behavior, including host-only controls.
- [ ] Save distinct personal drafts and grades; reload and explicitly load each
  draft. Loading broadcasts to the shared editor. Verify independent review dates
  and user-token denial of the other's private records and private fixtures.
  Grades must not mark a problem solved.
- [ ] Disconnect/reconnect B, refresh the token and try a same-user second tab.
  Check convergence, membership and duplicate events; record concurrent/offline
  edit behavior against the current whole-buffer synchronization model.
- [ ] Test explicit host Leave and host transfer; distinguish tab closure, which
  retains membership. Process-replacement testing requires a separately authorized
  staging-only operation: expect live-room loss and durable personal draft/grade
  survival. Do not restart a shared preview.
- [ ] With execution disabled, verify clear status and usable collaboration,
  drafts and grades without external execution. Run the existing database
  regressions in a disposable database as described in
  [Validation](docs/backend-setup.md#validation).

Fix and retest material failures before production release. Record approved MVP
boundaries explicitly. This is scoped collaboration E2E; real Run/Submit and Java
execution remain DEFERRED and are required before claiming full product E2E.

## Retained validation evidence and limits

Use the workspace validation commands in [README.md](README.md#first-local-run).
The [GitHub Actions workflow](.github/workflows/ci.yml) defines checks for pull
requests and pushes to main; inspect results for the actual candidate revision.
Build success and mocked tests do not prove a deployed working system.

The earlier continuation recorded real local browser checks on 2026-11-13 passing
two-account signup/login, room creation/join, bidirectional code and chat,
permission changes, draft saving, independent grades/review dates and room rejoin
after reload. No database reset or production change was used. The 2026-11-14
readiness assessment separately recorded 83 passing tests, application type checks
and production builds at the revision above; its runner used Node 24.18.0, so that
is not Node 22 deployment-image evidence. These are historical local results,
not current service availability or hosted verification. See
[Design boundaries](README.md#design-boundaries) for persistence limits.

The later Google live follow-up, as summarized by the readiness assessment,
records a user report that same-email Google sign-in loaded a previous draft.
Google access and that observed continuity are established local evidence, not
blanket deferred setup. Stable user ID, distinct-email separation, all progress
and submission continuity, and hosted HTTPS cookies were not independently
measured. Verify the target environment using
[Google sign-in](docs/backend-setup.md#google-sign-in).

Remote Java execution and live accepted-submission persistence remain unverified.
Keep `JDOODLE_LIMITS_CONFIRMED=false` until the
[provider capability gate](docs/backend-setup.md#provider-capability-gate) is met.
This guide records setup and verification requirements; it is not evidence that
migrations, deployments or provider requests have been performed.
