# Continue the combined application

The `fm/leetcollab-shadcn-all-screens` branch combines the Shadcn/ui migration,
prototype, CI workflow and backend head
`640d2e06cc5e76abcfc51214bd7d8740a1048878`. Nothing is merged into main or deployed.
The open review is https://github.com/BonLacorte/Leetcollab/pull/1.

## Clone and start

```sh
git clone --branch fm/leetcollab-shadcn-all-screens https://github.com/BonLacorte/Leetcollab.git
```

Follow [First local run](README.md#first-local-run) for prerequisites, installation,
local environment setup, additive migrations and startup. Keep provider execution
disabled until the requirements in [backend setup](docs/backend-setup.md) are met.

Use separate browser profiles or a normal and private window for two accounts.
Local email confirmation is disabled. Create disposable accounts, select an
exercise to create a room, and join its room ID from the other account. Edit code,
exchange chat messages, save a draft, grade your practice and reload to check
persistence. Only esbuild's dependency build script is approved in
`pnpm-workspace.yaml`; keep the other restrictions intact.

The current task preview uses http://localhost:3200 and realtime port `3201`.
Its ignored realtime environment has `PORT=3201` and
`CORS_ORIGIN=http://localhost:3200`; the ignored web environment has
`NEXT_PUBLIC_SOCKET_URL=http://localhost:3201`. To reproduce that port choice,
set those values before building and start in two terminals:

```sh
pnpm build
pnpm --filter @leetcollab/web start --port 3200 --hostname 0.0.0.0
```

```sh
pnpm --filter @leetcollab/realtime start
```

Git does not transfer local accounts, database volumes, ignored credentials,
dependencies or running services. Do not reset an existing database. The
standalone [prototype](docs/prototypes/README.md) remains available.

## Validation and limits

Use the workspace validation commands in [README.md](README.md#first-local-run).

The retained [GitHub Actions workflow](.github/workflows/ci.yml) defines the
checks for pull requests and pushes to main. Final combined no-mistakes review
and CI evidence must be read from the open review; earlier standalone validation does not prove
the final combined head.

Real local browser checks on 2026-11-13 passed two-account signup/login, room
creation/join, code synchronization in both directions, bidirectional chat,
permission changes, draft saving, independent grades and review dates, and room
rejoin after browser reload. See [Design boundaries](README.md#design-boundaries)
for persistence limits. No database reset or production change was used.

Live Google consent and automatic verified-email account linking remain deferred
until an operator supplies provider configuration. Remote Java execution remains
deferred until server-only credentials and supported provider execution limits
are verified. Neither is an external end-to-end pass. See
[backend setup](docs/backend-setup.md) for these requirements, API contracts and
database tests. No live provider secrets, merge or deployment are authorized by
this continuation guide.
