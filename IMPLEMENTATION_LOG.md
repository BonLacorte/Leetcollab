# LeetCollab revival — implementation log

**Last updated:** 2026-08-09  
**Scope:** local consolidation of the original LeetCollab web application and the separate Socket.IO backend into one new, unified workspace.

This is both a history of what was implemented and a reproducible setup guide. It deliberately excludes all real keys, tokens, and passwords.

## 1. Consolidation decision

The two original repositories were preserved as legacy references. They were **not** merged with `git merge` and were not modified. Instead, a clean monorepo was created in `revival/` and their useful functionality was rebuilt into a consistent, typed structure.

This avoids importing old Git history, duplicate configuration, unsafe backend assumptions, and deployment files that conflict with persistent Socket.IO hosting.

The resulting workspace layout is:

```text
revival/
├── apps/
│   ├── web/                 # Next.js frontend for Vercel
│   └── realtime/            # Express + Socket.IO service for Render
├── packages/
│   └── contracts/           # Shared Zod validation and Socket.IO types
├── supabase/
│   ├── migrations/          # PostgreSQL schema and RLS policies
│   ├── seed.sql             # Local sample problems
│   └── config.toml          # Local Supabase configuration
├── .env.example             # Safe root reference only
├── pnpm-workspace.yaml
└── package.json
```

## 2. Repository preparation that was performed

From the project parent folder, a fresh folder was used for the revival rather than overwriting the legacy checkout:

```powershell
cd H:\code\LeetCollab
New-Item -ItemType Directory revival
cd revival
git init -b main
```

The workspace was then configured with pnpm:

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
  - packages/*
```

```jsonc
// package.json — relevant commands
{
  "packageManager": "pnpm@11.16.0",
  "scripts": {
    "dev": "pnpm --filter @leetcollab/contracts build && concurrently -n realtime,web -c magenta,cyan \"pnpm --filter @leetcollab/realtime dev\" \"pnpm --filter @leetcollab/web dev\"",
    "build": "pnpm --filter @leetcollab/contracts build && pnpm --filter @leetcollab/realtime build && pnpm --filter @leetcollab/web build",
    "typecheck": "pnpm --filter @leetcollab/contracts build && pnpm --filter @leetcollab/realtime typecheck && pnpm --filter @leetcollab/web typecheck",
    "supabase:start": "pnpm dlx supabase start",
    "supabase:stop": "pnpm dlx supabase stop",
    "supabase:reset": "pnpm dlx supabase db reset"
  }
}
```

`revival/` is currently a **local Git repository only**. No GitHub remote, commit, push, or change to either legacy repository has been made. When ready to publish the clean project, create a new private GitHub repository and attach it explicitly:

```powershell
git remote add origin https://github.com/<your-account>/<new-private-repository>.git
git add .
git commit -m "chore: initialize LeetCollab revival monorepo"
git push -u origin main
```

Do this only after reviewing files with `git status` and confirming that no `.env` or `.env.local` file is staged.

## 3. What was migrated and improved

### Frontend → `apps/web`

The web app is a Next.js application. It handles:

- Supabase email/password sign-up and sign-in
- browsing seeded coding problems
- creating or joining a collaborative room
- shared code text, chat, and canvas-whiteboard UI
- connecting to the configurable realtime URL instead of a hard-coded Render URL

Environment variables are intentionally per app:

```dotenv
# apps/web/.env.local — create locally; never commit
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55421
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local Supabase Publishable Key>
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

### Socket backend → `apps/realtime`

The separate Socket.IO backend was incorporated as an Express + Socket.IO workspace application. It provides `/health` and WebSocket room events. It intentionally uses in-memory room state for the first MVP, so restarting this service clears active rooms; durable users, problems, progress, and submissions belong in Supabase.

```dotenv
# apps/realtime/.env — create locally; never commit
PORT=3001
CORS_ORIGIN=http://localhost:3000
SUPABASE_URL=http://127.0.0.1:55421
SUPABASE_ANON_KEY=<same local Supabase Publishable Key>
```

The connection flow implemented in `apps/realtime/src/index.ts` is equivalent to:

```ts
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (typeof token !== "string") return next(new Error("Unauthorized"));

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return next(new Error("Unauthorized"));

  socket.data.userId = data.user.id;
  socket.data.username = data.user.user_metadata.username ?? data.user.email?.split("@")[0] ?? "Member";
  next();
});
```

This replaces the legacy pattern of trusting a browser-supplied username. Every supported event validates its payload and requires room membership before it can change a room. Only the room host can choose the room problem.

### Shared contracts → `packages/contracts`

The frontend and server share Zod schemas plus Socket.IO event interfaces. This removes duplicated event names and validates network input at the backend boundary.

```ts
// Simplified excerpt from packages/contracts/src/index.ts
export const createRoomSchema = z.object({
  title: z.string().trim().min(1).max(80),
});

export interface ClientToServerEvents {
  "room:create": (payload: CreateRoomPayload, callback: Ack<RoomState>) => void;
  "room:join": (payload: { roomId: string }, callback: Ack<RoomState>) => void;
  "code:update": (payload: CodeUpdatePayload) => void;
  "chat:send": (payload: ChatSendPayload, callback: Ack<ChatMessage>) => void;
}
```

The realtime service uses the types as follows:

```ts
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, { cors: { origin: corsOrigin, credentials: true } });
```

### Supabase → `supabase/`

The local migration creates:

- `profiles` — public profile details, tied to `auth.users`
- `problems` — problem metadata
- `user_problem_progress` — each user’s saved progress
- `submissions` — each user’s submissions

It includes a profile-creation trigger for new Supabase Auth users and Row Level Security (RLS). Users can access only their own profiles, progress, and submissions. Problems are readable to the application. Passwords are never placed in public tables or custom API endpoints.

`supabase/seed.sql` adds five local development problems: Two Sum, Valid Parentheses, Reverse Linked List, Search a 2D Matrix, and Jump Game.

## 4. Local Supabase configuration and Windows troubleshooting

### Why the ports changed

This Windows machine reserves TCP ports `54231–54330`. Default Supabase ports such as `54321`, `54322`, `54323`, `54327`, and `54329` fall in that range, so Docker cannot bind them even when Docker Desktop shows no existing containers.

The reserved range was diagnosed with:

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

`supabase/config.toml` was changed to use safe ports and to disable services the MVP does not use:

```toml
[api]
port = 55421

[db]
port = 55432

[studio]
port = 55423

[local_smtp]
enabled = false

[db.pooler]
enabled = false

[analytics]
enabled = false

[edge_runtime]
enabled = false
```

Why disabled:

- `local_smtp`: confirmation emails are disabled locally, so the mail catcher is unnecessary.
- `db.pooler`: the application uses Supabase’s API locally, not a direct pooled database connection.
- `analytics`: unnecessary for this MVP and its default Docker port was blocked.
- `edge_runtime`: there are no Supabase Edge Functions. On Windows its empty runtime container failed with “failed to determine entrypoint.”

The older `[inbucket]` setting was also replaced with `[local_smtp]`, because the former is deprecated.

### Local key selection

After a successful start, obtain local values with:

```powershell
pnpm dlx supabase status -o env
```

Copy **API URL** and the **Publishable Key** into both application environment files. “Publishable Key” is the new Supabase label for the client-safe anonymous key. Do **not** copy the Secret Key / service-role key into either app.

If Supabase needs to recreate its local database after a migration or configuration change, use:

```powershell
pnpm supabase:reset
```

This resets **only local Supabase containers and local database data**, not the hosted Supabase project.

## 5. TypeScript issue found and fixed

The first `pnpm typecheck` reported that `@leetcollab/contracts` could not be found in the realtime project, followed by many misleading implicit-`any` errors in Socket.IO callbacks.

Cause: `@leetcollab/contracts` publishes its types from generated `dist/` files. Its source existed, but `dist/` had not been built before the downstream packages were checked.

Fix: the root `typecheck`, `build`, and `dev` commands now build the contracts package first:

```json
"typecheck": "pnpm --filter @leetcollab/contracts build && pnpm --filter @leetcollab/realtime typecheck && pnpm --filter @leetcollab/web typecheck"
```

After that, contracts and realtime type-checking passed. One real frontend error remained: React effect cleanups must return `void` or another cleanup function. `socket.disconnect()` returns the Socket instance, so the previous arrow-expression cleanup returned the wrong value.

Implemented fix in `apps/web/src/components/socket-provider.tsx`:

```ts
return () => {
  nextSocket.disconnect();
};
```

The braces ensure the cleanup returns `void` while still disconnecting the client correctly.

## 6. Exact local setup and validation procedure

Run these from PowerShell in the `revival` folder:

```powershell
cd H:\code\LeetCollab\revival
pnpm install
pnpm supabase:start
pnpm dlx supabase status -o env
```

Create the two ignored local environment files from the templates:

```powershell
Copy-Item apps\web\.env.example apps\web\.env.local
Copy-Item apps\realtime\.env.example apps\realtime\.env
```

Paste the API URL and Publishable Key from `supabase status` into both files, save them, and then run:

```powershell
pnpm supabase:reset
pnpm typecheck
pnpm build
pnpm dev
```

Expected local services:

| Service | Address |
| --- | --- |
| Web app | `http://localhost:3000` |
| Realtime health endpoint | `http://localhost:3001/health` |
| Supabase API | `http://127.0.0.1:55421` |
| Supabase Studio | `http://127.0.0.1:55423` |
| Local PostgreSQL | `postgresql://postgres:postgres@127.0.0.1:55432/postgres` |

For the collaborative smoke test:

1. Open `http://localhost:3000` in a normal window and an incognito/private window.
2. Create two separate accounts and sign in.
3. Create a room in the first window, then join it from the second using the room ID.
4. Confirm that shared code changes, chat messages, whiteboard drawing, presence, and problem selection update as expected.
5. Confirm that a non-host cannot change the selected problem.
6. Stop local services when done with `Ctrl+C`; optionally stop Supabase with `pnpm supabase:stop`.

## 7. Verification status at the time of this update

- [x] Legacy repositories inspected without modification.
- [x] Unified local monorepo scaffolded with web, realtime, contracts, and Supabase folders.
- [x] Shared event contracts and backend token validation implemented.
- [x] Supabase schema, RLS policies, trigger, and local seed data implemented.
- [x] Windows port conflicts identified and Supabase configuration updated.
- [x] Local environment templates added; real environment files remain ignored.
- [x] Contracts build and realtime type-check passed after the dependency-order correction.
- [x] Web Socket.IO cleanup TypeScript fix implemented.
- [ ] Re-run `pnpm typecheck` after the web cleanup to record a full green type-check.
- [ ] Run `pnpm build` successfully.
- [ ] Run the two-browser collaboration smoke test.
- [ ] Create the new GitHub repository, review, commit, and push this workspace.

## 8. Intended deployment and next work

The intended initial deployment model remains:

- **Vercel:** `apps/web` (Next.js frontend)
- **Render Web Service:** `apps/realtime` (persistent Express + Socket.IO process)
- **Supabase:** authentication and Postgres database

Before deploying, add a GitHub Actions CI workflow that runs `pnpm install --frozen-lockfile`, `pnpm typecheck`, and `pnpm build` on pull requests. Then add Vercel preview/production deployments, Render environment variables and health checks, and a separate hosted Supabase project for staging/production. Do not add an arbitrary-code runner to this service; if implemented later, it needs an isolated sandboxed execution architecture.
