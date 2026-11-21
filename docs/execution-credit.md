# Execution intent, allowance and room credit

Run and Submit save one real submission owned by the authenticated execution
actor. Only that actor spends an execution. Normal access defaults to 25 per
user per daily period; authorized local OnlineCompiler testing can use 50 under
the opt-in described in [local execution testing](local-execution-testing.md).
Already consumed attempts remain charged. The account ledger still tracks
aggregate usage, serializes reservations and enforces global provider concurrency.
A confirmed provider account exhaustion disables all users without spending
their remaining personal attempts. Restricted evaluation keeps its existing
shared budget, admission checks and 20-run ceiling. Its accepted Submits give
solved credit to the authenticated tester alone.

## Credit authority and concurrent membership

`POST /api/judge/submissions` accepts `action: "run" | "submit"`. Missing action
defaults to Run for older clients. The bearer session supplies the actor; client
user IDs, participant lists and verdicts cannot grant credit. Room clients send
the expected room ID with Submit so the server can verify the current room and
exercise before spending an attempt.

Immediately before reserving a Submit, the web server forwards the verified
bearer token to its configured realtime authority at `/judge/participants`.
That service authenticates the token independently and synchronously captures
the actor's room, selected problem and unique authenticated users with joined
live sockets. Stale disconnected members, users in other rooms and users in a
room showing another problem are excluded. A room Submit waits briefly for
confirmed membership and returns reconnect feedback if the room or exercise
cannot be verified. A solo Submit receives personal eligibility. A failed
authority lookup refuses Submit before reservation or any provider request. Run
neither looks up nor stores participants.

The captured membership is stored transactionally with the first reservation.
A participant who leaves after capture keeps eligibility for that attempt. A
later joiner does not receive it. A replay cannot replace the original room,
timestamp or participant set, including after the actor leaves. Reusing a key
for another action, problem, source, provider or quota scope is refused.
A matching Run can read a finalized legacy execution without changes to its
stored identity, quota or credit.

After the real submission completes with an accepted verdict and positive
matching passed/total counts, the completion transaction grants
`verified_problem_solves` rows to the captured participants only if its stored
action is Submit. Runs and unsuccessful Submits never grant or erase credit.
No peer submission is invented, and private submission source remains private.
Clients call `has_verified_problem_solve(p_problem_id)` for their own boolean
solved state. Attempt counts, submission IDs, timestamps and recipient rosters
remain internal. Direct client writes and direct service-role inserts are forbidden. Reservation and completion RPCs
are restricted to the trusted server role.

The realtime completion endpoint independently checks that a submission belongs
to the authenticated caller and is an accepted Submit before sending a refresh
hint to captured, newly solved recipients still connected to the room. Set
`SUPABASE_SERVICE_ROLE_KEY` on the realtime server to enable the internal
recipient lookup. Clients read their protected credit again on that hint, reconnect, window
focus or Refresh status. Losing a hint cannot undo durable credit or trigger a
provider retry. This process-local membership authority requires one realtime
room owner; a future multi-instance deployment needs shared authoritative room
membership before distributing rooms across processes.

## Local migration and restart handoff

These instructions are for the local preview owner. They are preparation for
local integration, not authorization for hosted changes or deployment.

1. Incorporate the implementation into the owner's combined source, retaining
   its editor and Result changes. Apply preceding migrations first, including
   the structured public-case migration. Preserve existing private environment
   values. Set `REALTIME_INTERNAL_URL=http://127.0.0.1:3201` for the established
   preview, or leave it blank to use `NEXT_PUBLIC_SOCKET_URL`.
2. Before changing the realtime process, capture **every live room**, with edits,
   chat, whiteboard, timer and membership paused through the snapshot/restart
   window. Use the existing authenticated `room:join` acknowledgement for each
   room and preserve its complete `data` value as an element in a JSON array.
   Keep the file private (0600), outside the repository, with no bearer tokens.
   Record the room inventory separately and compare each captured code value
   with the user's current unsaved editor text. The old process has no global
   snapshot API: a single room capture does not prove a complete inventory.
   If complete capture cannot be established, keep the old realtime process
   running and report that concrete preservation blocker before restarting it.
3. Stop only the owner's web admission. Let in-flight requests settle. Inspect
   `submissions` for `judge_state='reserved'` and `judge_quota_periods.active`.
   The migration refuses unsettled reservations. For an abandoned attempt,
   wait until its reservation deadline and use the existing trusted completion
   RPC to settle it as failed, retaining its usage. Do not delete reservations,
   reset counters or fabricate an accepted outcome to unblock migration.
4. Apply `supabase/migrations/202611180002_execution_intent_and_credit.sql`
   through the existing local operator connection. It preserves submissions,
   aggregate usage, reviews and manual history; backfills personal consumed
   attempts from the real submission ledger; and preserves historical verified
   actor solves because old buttons had no distinct persisted intent. It never
   promotes old manual completion or invents historical partner credit.
5. For local 50 testing, explicitly apply
   `supabase/local/enable-test-quota.sql` **after** that migration. It raises the
   current personal limits while preserving usage. Retain the existing approved
   private OnlineCompiler key and set `JUDGE_DAILY_LIMIT=50`,
   `JUDGE_LOCAL_TESTING=true`, `JUDGE_PROVIDER=onlinecompiler`, normal access and
   the existing policy/approval flags. Use `next dev` and an HTTP loopback
   Supabase URL. Do not put a credential in public configuration. No provider
   submission is needed to apply or check this configuration.
6. Replace only the owner's realtime process using its existing port and
   environment, plus `ROOM_RESTORE_FILE=/absolute/private/rooms.json`.
   Startup validates the full file and restores room identity, exact code,
   members, chat, timer and whiteboard. Reconnected authenticated sockets become
   eligible only after joining; restored disconnected members alone do not
   earn credit. Compare every restored room acknowledgement to the snapshot
   before allowing edits again. Keep the original file for recovery, but do
   not reuse an old snapshot on a later restart: capture fresh state first.
7. Start only the owner's web service. Refresh status and confirm the personal
   limit is 50 and remaining is `50 - previously consumed attempts`. Old servers
   can lower existing limits, so keep their admission stopped. Reconnect the
   clients and verify their unsaved code remains intact before user testing.

The local database command for either SQL file is
`docker.exe exec -i supabase_db_leetcollab psql -X -U postgres -d postgres -v ON_ERROR_STOP=1`
with the named file on stdin. Verify that this is the intended local container
first. Neither this implementation nor its deterministic checks apply the
migration to the shared preview database.

For a later normal deployment, explicitly set any retained
`JUDGE_DAILY_LIMIT=20` environment value to 25 and disable the local opt-in.
Changing the code default alone cannot override an explicit environment value.
An existing higher usage count stays charged even if it exceeds 25.

## User acceptance after the owner confirms readiness

Use two distinct authenticated users in the same room and an exercise neither
has previously solved. Record both remaining allowances first.

1. User A Runs correct code: Result is Accepted, only A loses one attempt, and
   neither user becomes Solved.
2. A Submits incorrect or uncompilable code: only A loses another attempt and
   neither gains solved credit. Existing Result/editor diagnostics still work.
3. A Submits correct code while B is present: both become Solved, only A loses
   one attempt, and B's private submission history has no invented submission.
4. A Runs again: prior Solved status remains. Refresh/reconnect B to confirm
   the shared credit persists. Code, drafts, chat and whiteboard remain intact.
5. If testing capture timing, B must be present at capture to receive credit;
   a later joiner receives no credit for that attempt. Each user sees their own
   limit of 50 locally. Do not spend all 50 just to prove the ceiling: the
   deterministic SQL checks cover the boundary and competing clicks.

All live Run/Submit acceptance actions belong to the user. Automated tests use
synthetic transport and disposable database state, with no provider executions.
