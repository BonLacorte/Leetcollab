# Continue on another device

This is an unfinished progress snapshot published at the owner's request. Further implementation, validation, merges and deployment are deferred.

## Get the saved work

```sh
git clone --branch fm/leetcollab-backend-mvp https://github.com/BonLacorte/Leetcollab.git
```

The backend branch includes private progress and grades/review dates, 15 original Java exercises and fixtures, authenticated judging and shared quota accounting, Google sign-in alongside email/password, and minimal dashboard/editor integration. Preserved review fixes through implementation commit `6c6a5bc4e91ac4f76ae49f074c473f0742fa825a` are included.

The separate frontend branch is `fm/leetcollab-shadcn-all-screens` in the same repository. Fetch it with `git fetch origin`; switch to it with `git switch --track origin/fm/leetcollab-shadcn-all-screens` when ready to inspect that work. These branches have not been combined. Reconcile overlapping dashboard, room/editor, dependency and lockfile changes while retaining backend API consumers and OAuth logic.

## Local setup

Use Node.js 22 from `.nvmrc`, Corepack and pnpm 11.16.0. Run `pnpm install --frozen-lockfile`. Only esbuild's dependency build script is approved; do not broadly enable other dependency scripts.

Follow [README.md](../README.md) for Docker, local Supabase and `pnpm dev`. Copy the web and realtime `.env.example` files to their documented ignored local destinations and supply local values there. Credentials, installed dependencies, build output and the previous device's local database are not transferred by cloning. Apply additive migrations with `pnpm dlx supabase migration up --local`; never reset an existing database. Hosted migration application remains an operator action after review.

[backend-setup.md](backend-setup.md) documents Google client/Supabase redirect configuration, server-only environment variables and the API/data contracts. Retain Supabase's built-in linking for matching verified email; no custom linking is needed. Verify live Google consent, linking, callback errors and session persistence after configuring credentials locally.

Java execution remains disabled until server-only JDoodle credentials, the Java version index and concrete provider capability evidence are supplied. Keep `JDOODLE_LIMITS_CONFIRMED=false` until the plan guarantees the required finite compilation/runtime/memory/output/process bounds, filesystem isolation and no network access. App deadlines and source restrictions do not provide sandbox guarantees. Live execution is unverified. All current original exercises have no source judge and therefore no external fallback destination.

## Validation to resume

The previous no-mistakes run `01M75K8DPTKD7CG8Y4VWTQM572` completed Review and failed at Test because its agent hit a usage limit. Its unpublished fixes were recovered with supported custody sync. No validation run remains active. Document, Lint, Push, PR and CI did not complete in that run. This transfer does not claim a green build, tests or CI for the final snapshot.

Before the review fixes, recorded checks passed: 41 mocked application tests, typecheck, build with placeholder public Supabase values, 23 pgTAP checks in disposable local Postgres, and a two-connection quota concurrency regression. These results do not validate the later fixes. Real Google/Supabase hosted auth and JDoodle execution were not exercised.

On the next device, rerun `pnpm test`, `pnpm typecheck` and `pnpm build`, then the RLS and concurrency checks described in [backend-setup.md](backend-setup.md) using a disposable database. Validate auth redirects and cross-user isolation, independent review state, quota exhaustion/concurrency, and fallback eligibility. Resume the standard no-mistakes review/test/lint/PR/CI path after setup; initialize its device-local tooling if required. No merge or deployment is authorized by this handoff.
