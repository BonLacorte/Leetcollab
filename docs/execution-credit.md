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
user IDs, participant lists and verdicts cannot grant credit. Each new normal
Submit requires the expected room ID so the server can verify the current room
and exercise before spending an attempt. Restricted evaluation remains actor-only.

Immediately before reserving a normal Submit, the web server forwards the verified
bearer token to its configured realtime authority at `/judge/participants`.
Both servers use the same dedicated private `REALTIME_JUDGE_SHARED_SECRET`.
Realtime verifies this credential and the actor token before it captures
the actor's room, selected problem and unique authenticated users with joined
live sockets. Stale disconnected members, users in other rooms and users in a
room showing another problem are excluded. A room Submit waits briefly for
confirmed membership and returns reconnect feedback if the room or exercise
cannot be verified. To Submit alone, use a one-member room. A failed
authority lookup refuses Submit before reservation or any provider request. Run
neither looks up nor stores participants.

The captured membership is stored transactionally with the first reservation.
A participant who leaves after capture keeps eligibility for that attempt. A
later joiner does not receive it. A replay cannot replace the original room
or participant set, including after the actor leaves. Reusing a key
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
remain internal. Direct application-role access to solve rows is forbidden. A
recipient keeps earned credit if the originating submission or its actor is deleted. Reservation and completion RPCs
are restricted to the trusted server role.

The web server sends its private `REALTIME_JUDGE_SHARED_SECRET` and the actor's
bearer token to the realtime completion endpoint. Realtime requires both
credentials and checks that the submission belongs to the actor and is an
accepted Submit before sending a refresh hint to captured, newly solved
recipients still connected to the room. Set
`SUPABASE_SERVICE_ROLE_KEY` on the realtime server to enable the internal
recipient lookup. Clients read their protected credit again on that hint, reconnect, window
focus or Refresh status. Losing a hint cannot undo durable credit or trigger a
provider retry. This process-local membership authority requires one realtime
room owner; a future multi-instance deployment needs shared authoritative room
membership before distributing rooms across processes.

## Migration and restart

For production, follow the [provider rollout sequence](onlinecompiler-integration.md#rollout-and-rollback).
For an owned local preview, stop admission before applying the release migrations.
In-flight reservations must settle. Use the existing trusted completion RPC to
mark abandoned reservations failed after expiry without clearing their usage.
Apply `202611180001_public_case_plans.sql` before
`202611180002_execution_intent_and_credit.sql`. The migration preserves the shared
ledger and backfills personal usage from existing charged attempts. It carries
forward historical verified actor solves. Manual completion and historical room
membership confer no verified credit.

Start the updated realtime service with the matching private capture secret,
then start the web service. Realtime starts with fresh rooms. Persisted drafts,
manual history and verified credit remain in Supabase. Follow
[local execution testing](local-execution-testing.md) for the separate 50-attempt
opt-in. Normal hosted access uses 25 per user, and any higher historical usage
stays charged.

Reload any room tab opened before this release to edit again. Realtime now
requires the current exercise ID on every code edit, with explicit `null` for
rooms without a selected exercise.

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
   a later joiner receives no credit for that attempt. Each user sees a personal
   limit of 25 in production or 50 with the local opt-in. Disposable SQL checks
   cover the ceiling and competing clicks.

All live Run/Submit acceptance actions belong to the user. Automated tests use
synthetic transport and disposable database state, with no provider executions.
