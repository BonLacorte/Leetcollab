# OnlineCompiler integration and evaluation

This is a server-only integration for the exact service
[OnlineCompiler.io](https://onlinecompiler.io/docs). The production release
enables normal authenticated Run and Submit through the coordinated
[rollout](#rollout-and-rollback). Restricted hosted evaluation keeps its own
settings and fixed expiry.

## Selection and approval

`JUDGE_PROVIDER` accepts `disabled`, `jdoodle`, or `onlinecompiler`. The environment
example defaults to `disabled`; an existing deployment without a selector retains
its JDoodle configuration. Unknown values disable execution. There is no automatic
fallback: a refused or ambiguous request never executes on a second provider.
Render remains offline-only and cannot be selected for live execution.

OnlineCompiler requires all of the following server-only values:

- `JUDGE_PROVIDER=onlinecompiler`
- `ONLINECOMPILER_API_KEY`: a REST API key, never a widget/WebSocket key
- `ONLINECOMPILER_EXECUTION_APPROVED=true`: explicit authority for the intended runtime
- `ONLINECOMPILER_POLICY_ACCEPTED=true`: adoption of the provider-specific policy below

For local development, put the REST key in `ONLINECOMPILER_API_KEY` in
`apps/web/.env.local`, using `apps/web/.env.example` as the template. For a hosted
web app, use its server runtime environment settings. Keep approval flags false
until their prerequisites are met.

A key or selector alone leaves status unavailable. Do not set either approval flag
just to make buttons clickable. The constructor's injected options let tests use
synthetic credentials and responses without attesting provider capabilities.
Never put a real key in tracked files, browser variables, commands, logs, or the
sandbox environment. The application does not read an arbitrary operator key file.
Only a separately authorized runtime may receive server credentials.

The [current pricing](https://onlinecompiler.io/pricing) publishes a standard Free
API allowance of 100,000 runs/month, commercial use included, without a payment
card. The million-run Pro allowance costs $49/month unless a conditional program
is approved. An account's effective allowance and plan must be checked separately.

## Restricted hosted evaluation

For a separately approved tester-only proof, set `JUDGE_ACCESS_MODE=evaluation`
in the web server environment. This mode requires every restriction below; missing,
empty, malformed or inconsistent settings deny both judge endpoints with HTTP 503
and a generic `JUDGE_UNAVAILABLE` response. Other users and problems are rejected
before judge composition or quota mutation, including direct authenticated API
requests. Hosting protection, room membership, CORS and hidden UI controls are not
this authorization boundary. No evaluation settings or credentials enter public
payloads or `NEXT_PUBLIC_` variables.

`JUDGE_ACCESS_MODE` absent or `normal` preserves the existing authenticated-user
policy and provider approval gates. Unknown or empty modes deny admission. Never
remove the mode or switch to `normal` to disable a tester-only deployment; that
would remove the tester restriction. The tracked provider remains disabled.

Before enabling, use an authorized **read-only** query of the current shared quota
row, not judge status: status's existing RPC can insert/lower that row. Compute
its period as the last 23:55 UTC instant, with reset 24 hours later. For example,
with an operator-supplied `period_start` psql variable:

```sql
SELECT period_start, period_end, used, quota_limit, active
FROM public.judge_quota_periods
WHERE period_start = :'period_start'::timestamptz;
```

Record used `U`, effective limit `L` and active count zero. No row means `U=0`
and an initial effective ceiling of 20. Require `U+2 <= L <= 20`; abort if a prior
lowered limit leaves fewer than two slots. Never reset usage or raise that limit.
Confirm exclusive authorized provider-account use, current Free allowance and
nonexecuting provider accounting separately; application quota is not independent
provider accounting. All enabled callers/deployments must be coordinated within
the same shared cap. A previously enabled unrestricted artifact must be closed
before starting this proof.

Use the following exact server-only configuration in the sole enabled artifact,
replacing placeholders with verified nonsecret identities, baseline and instants:

```dotenv
JUDGE_ACCESS_MODE=evaluation
JUDGE_PROVIDER=onlinecompiler
ONLINECOMPILER_POLICY_ACCEPTED=true
ONLINECOMPILER_EXECUTION_APPROVED=true
JDOODLE_LIMITS_CONFIRMED=false
JUDGE_EVALUATION_USER_ID=<verified tester A UUID>
JUDGE_EVALUATION_PROBLEM_ID=<verified enabled problem UUID>
JUDGE_EVALUATION_PERIOD_START=<pinned quota period start at 23:55:00.000Z>
JUDGE_EVALUATION_STARTS_AT=<fixed UTC window start>
JUDGE_EVALUATION_EXPIRES_AT=<fixed UTC exclusive expiry>
JUDGE_EVALUATION_BASELINE_USED=<U>
JUDGE_DAILY_LIMIT=<U+2>
JUDGE_MAX_CONCURRENCY=1
JUDGE_RESERVATION_SECONDS=45
JUDGE_REQUEST_TIMEOUT_MS=15000
```

The approved custodian supplies `ONLINECOMPILER_API_KEY` directly through the
hosting secret mechanism. For the existing staging alias, target its Production
serving environment, not Preview/Development. Do not copy secrets into examples,
commands, logs, reports or browser variables. Keep all other server/auth/realtime
configuration on its existing target. Deployment and calls require separate
operational authority and reviewed merged code.

All times require UTC ISO strings ending in `Z`, with seconds and optional three
digit milliseconds. The window starts at or after the pinned quota start, lasts
at most ten minutes, and ends at least two minutes before the next 23:55 UTC reset.
Start is inclusive; expiry is exclusive. Choose future instants with deployment
lead time and verify the actual deployed artifact before the window. A deployment
that finishes too late stays closed; do not silently extend it or borrow the next
period. Changing the window/baseline is a new coordinated admission decision.

Admission checks the live clock before work, after awaited preparation, after
reservation and immediately before outbound transport. A queued reservation that
outlives the window never transmits, remains charged and is recorded failed.
Expiry never cancels work already sent. The existing atomic reservation transaction
locks the shared period, monotonically lowers its limit and increments usage before
execution. The explicit baseline must not exceed stored usage; a missing positive
baseline, incompatible reset, already active baseline or previously lower limit
fails before mutation. Stale lower baselines can only shrink the remaining budget.
Duplicates, races and failed attempts cannot add slots. With `U=0`, the daily limit
is **2**, not 20. The pin and expiry prevent reopening after daily reset without a
new deployment/configuration decision. No SQL migration or privileged quota-status
mutation is needed to inspect this boundary.

The separately authorized two-call proof is sequential: A's synthetic wrong-answer
Run, then accepted Submit only after the first durable and independent-accounting
checkpoint passes. B and other identities cannot use either judge endpoint; B's
private-row/unsolved checks use normal application reads. Stop on ambiguity or any
unexpected result; no retry, replacement slot or third execution to test closure.
Preserve the existing 365-day disclosure and privacy/terms links above the controls.

## Request and result contract

The adapter sends one JSON POST to the fixed HTTPS endpoint
`https://api.onlinecompiler.io/api/run-code-sync/`, with the REST key in the
`Authorization` header, `compiler: "openjdk-25"`, and the assembled program in
`code`. It requests no external files, libraries, network access, or custom input.
Redirects are refused. There are no retries.

The existing validation reserves the package-private `Solution` and `Main` names.
Solutions may use ordinary imports of top-level types from `java.util` and
`java.math`, including package wildcards. Static imports, subpackage/nested-type
imports and imports from other packages remain unsupported. All existing
forbidden-API checks still inspect the original source, including imported names.
Imports are preserved when assembling the program and storing the submission;
they do not change provider admission, isolation or fixture verification.
After the server adds its trusted harness, the adapter makes that one `Main`
class public. This supplies the documented public entry class when `Solution`
is the first class in the single source file; it does not modify stored drafts
or change the other providers' program construction.
See the [compiler contract](https://onlinecompiler.io/docs/compilers).

A bounded deadline covers HTTP and response consumption, including a stalled body.
The default is 15 seconds, configurable within 1-30 seconds by the existing
`JUDGE_REQUEST_TIMEOUT_MS`. Source including the entry-class adjustment is limited
to 64 KiB, raw response to 64 KiB, stdout to 16 KiB and stderr to 4 KiB. Raw bytes are
checked before decoding. Invalid UTF-8, malformed or inconsistent result fields,
missing exit information, and truncated output cannot produce acceptance.

The provider's structured status, exit code and signal distinguish execution errors
and limits. An anchored Java compiler location identifies a compile failure;
other unsuccessful exits remain runtime errors. Persisted error diagnostics are
generated locally to avoid retaining source echoes or raw provider errors. Recognized
Java error categories and locations are retained only for lines inside the submitted
solution, mapped back to editor lines after source trimming. Unknown messages use a
generic compilation explanation. Result displays these safe diagnostics; raw harness
source, paths, symbols and runtime values are never displayed. Older idempotent
results are filtered again before returning diagnostics to the client. A 429
can mean account allowance, rate, or capacity, so it remains unavailable and never
blindly exhausts all shared application quota. Provider wall time is not labeled
as CPU time. See the [run-code reference](https://onlinecompiler.io/docs/run-code).

Successful provider output still passes through LeetCollab's existing fixture
comparison and private completion RPC. HTTP 200 is not an accepted solution.
Run and Submit save actor-owned submissions. Only an accepted Submit grants new
verified solved credit, including its server-captured eligible room participants;
see [execution credit](execution-credit.md). Draft persistence is independent.

## Persistence and quota

Apply the additive `202611150002_onlinecompiler_reservations.sql` migration in a
reviewed runtime before selecting this provider. It preserves existing data,
accounting and completion functions, binds new rows to `runner=onlinecompiler`,
and rejects reusing an idempotency key with another provider. Only the trusted
service role can call the fixed-runner reservation RPCs; internal helpers cannot
be called by application roles.

Normal access uses a personal application cap of 25 attempts/day, resetting at
23:55 UTC, across JDoodle and OnlineCompiler. Explicit authorized local testing
can use 50/user; restricted evaluation keeps its pinned shared cap of at most 20.
Apply `202611180002_execution_intent_and_credit.sql` before enabling those normal
semantics, following its [migration handoff](execution-credit.md#local-migration-and-restart-handoff).
The global account ledger still bounds concurrent provider requests. This is an
application limit, not OnlineCompiler's monthly reset or an upgrade to 100,000
application attempts. Existing consumed usage is preserved. Failed or ambiguous
attempts retain their charge and cannot be replayed into another execution.
A dedicated account/key without conflicting callers and reconciled provider
usage remain evaluation prerequisites.

## Accepted normal-user policy

The owner accepted a policy specific to authenticated Java exercise practice on
OnlineCompiler Free. `ONLINECOMPILER_POLICY_ACCEPTED` replaces the overbroad
limits-confirmation attestation. The legacy `ONLINECOMPILER_LIMITS_CONFIRMED`
setting is ignored, even when true. Policy acceptance and runtime execution
authorization remain separate; neither a key nor either flag alone enables runs.
This policy does not relax the requirements for JDoodle, Render or local execution.

The policy relies on the provider's documented fresh gVisor sandbox for each run,
no outbound network, unprivileged execution and read-only image. The documented
shared per-run envelope is 512 MB, 2 CPU cores, up to 30 seconds, 16 simultaneous
processes, and 256 MB workspace plus 128 MB temporary storage within the memory
limit. These are provider claims, not independently audited guarantees. See
[security](https://onlinecompiler.io/security) and
[limits](https://onlinecompiler.io/docs/limits), checked 2026-11-16.

For this provider, the owner explicitly accepts the absence of evidence for
separate compilation (5 CPU/wall seconds, 768 MiB) and runtime (2 CPU/wall seconds,
512 MiB) budgets, aggregate descendant CPU and combined process/thread accounting,
32 MiB/1024-inode all-write limits, and independently timed destruction after
broker loss or provider failure. Provider-managed fresh-run cleanup is relied on;
no quantified destruction-completion bound or independent audit is claimed.
Java's requested time limit has a startup allowance and a lower memory limit is a
post-run check. The evaluated transport therefore still sends neither
`time_limit` nor `memory_limit`. Application deadlines do not terminate remote code.

Application authentication, server-only keys and fixed endpoint, Java/source
restrictions, deadlines, source/response/output caps, atomic per-actor allowance,
concurrency reservations, no fallback/redirect/retry, complete structured results,
server fixture verification and private persisted completion remain required.
Source filtering remains a usability check, not a sandbox boundary.

Before Run or Submit can transmit through the UI, status identifies the selected
provider and the controls show the OnlineCompiler notice: the learner's Java code
and exercise harness are sent to OnlineCompiler.io; execution code, input and
output are retained for 365 days; do not include secrets or sensitive information.
The notice links the [privacy policy](https://onlinecompiler.io/privacy) and
[terms](https://onlinecompiler.io/terms). Provider execution history is distinct
from LeetCollab's private submissions and sandbox filesystem cleanup. The app
cannot promise immediate provider deletion or unverified AI-training restrictions.
Learner-code transfer under this notice is accepted by the policy; private fixture
evaluation alone did not authorize it.

## Live evaluation and release boundary

A production evaluation needs current Free allowance, no paid/overage authority,
the accepted provider policy and a coordinated isolated authenticated runtime. The
historical private evaluation authorized three direct trusted synthetic attempts
(passing solution, wrong answer and compile error), then two authenticated room
attempts, without authorizing ordinary learner access. That allowance is fully
spent. A future evaluation needs its own explicit allowance. Do not retry ambiguous
attempts; stop at the first unexpected outcome and count it as spent. Real provider
verdicts and private persisted completion must be verified before recommending a
public switch. Mock responses are never a claim of working Java execution.

## Deterministic checks

`pnpm test` includes adapter boundaries, selection/status, broker verdict/persistence
and existing auth/UI regressions. Route-level evaluation tests use the production
composition/repository/adapter with synthetic Supabase responses and credentials:
identity/problem denials, missing/malformed fields, UTC window/reset closure,
read-only baseline validation and delayed reservation/transport rechecks. The
disposable database CI job applies all migrations and checks runner permissions, persisted outcomes, quota retention and
cross-provider races using `onlinecompiler_reservations.sql` and
`onlinecompiler_concurrency.py`. These never run Java or call the provider. Do not
run database regression scripts against shared or hosted data.

## Authorized private evaluation

The [direct adapter record](onlinecompiler-evaluation.json) contains three live
synthetic outcomes: accepted, wrong answer and compile error. Those are distinct
from its mocked boundary checks and did not test authenticated rooms.

The follow-up [room evaluation record](onlinecompiler-room-evaluation.json)
contains two additional real provider executions driven by browser buttons in an
owned disposable Supabase/Auth/database, web and realtime runtime. Wrong-answer
Run persisted a completed nonaccepted submission with 0/1 checks passed and left
the UI unsolved. Passing Submit persisted a completed accepted submission with
1/1 checks passed. Both used `runner=onlinecompiler` and `verification=leetcollab`.
The verified solved state survived browser reload and returning from home to the
same room. Authenticated owner readback returned both submissions; the synthetic
observer could read neither private owner row. No response interception or direct
verdict insertion was used.

Nonexecuting usage metadata reconciled exactly five total provider runs and
99,995 remaining from the 100,000 allowance. All five approved execution slots
are spent. Do not rerun these fixtures. The record retains the earlier blocked
checkpoints, concrete resource inventory and scoped cleanup plan.

The fixture-only composition lives in `tools/onlinecompiler-room`, outside normal
production builds. Its prepare command creates a separate disposable web copy.
It restricts identity, room URL, problem/config, exact draft and assembled bytes,
prior persisted outcome and durable attempt files. It delegates to the same
`executeOnlineCompilerProgram` transport used by production, with production
JudgeService, repository and reservation/completion RPCs. Production calls require
both policy acceptance and execution approval in `OnlineCompilerProvider.execute`.

The local endpoints were web `127.0.0.1:3320`, realtime `127.0.0.1:3321`, and
Supabase gateway `127.0.0.1:58550`. Docker assigned the replacement loopback gateway
port after the proposed ports collided. The database had no host-published port;
SQL used `docker.exe exec` in the owned container. Web used an explicit loopback
hostname and realtime used `HOST=127.0.0.1`. CORS alone does not restrict exposure.

This establishes bounded trusted-fixture UI and persistence behavior. It is not
fresh live proof of normal production composition with edited learner code. The
accepted policy now permits that composition when all configuration gates are
satisfied, and deterministic tests cover edited synthetic source through the
production service/transport with fake credentials. No extra provider executions
are authorized; all five historical attempts are spent. No runtime approval flag,
hosted configuration, deployment or public provider selection was changed.

## Rollout and rollback

1. Use the release revision that passed CI. Confirm the private database backup
   and isolated restore evidence, the dedicated OnlineCompiler REST account and
   available allowance, and the known disabled web artifact for rollback. Keep
   production admission stopped while the schema and realtime service change.
2. Let in-flight executions settle and confirm there are no reserved submissions
   or active leases. Apply pending migrations in order, including
   `202611180001_public_case_plans.sql` and
   `202611180002_execution_intent_and_credit.sql`. Preserve submissions and
   consumed usage. Follow the [database checks](backend-setup.md).
3. Set the same dedicated random `REALTIME_JUDGE_SHARED_SECRET` in both server
   environments, set realtime's `SUPABASE_SERVICE_ROLE_KEY` for completion refresh,
   and deploy the release realtime service first. Check `/health` and authenticated
   room creation and join. The restart clears old in-memory rooms. Point the web
   server's optional `REALTIME_INTERNAL_URL` at the release realtime HTTPS origin
   when it differs from `NEXT_PUBLIC_SOCKET_URL`.
4. For the production web environment serving `https://leetcollab.vercel.app/`,
   set `JUDGE_PROVIDER=onlinecompiler`, `JUDGE_ACCESS_MODE=normal`,
   `ONLINECOMPILER_EXECUTION_APPROVED=true`, `ONLINECOMPILER_POLICY_ACCEPTED=true`,
   `JUDGE_DAILY_LIMIT=25` and `JUDGE_LOCAL_TESTING=false`. Supply the private
   `ONLINECOMPILER_API_KEY` and keep `JDOODLE_LIMITS_CONFIRMED=false`. Redeploy
   to apply these settings. Keep expired evaluation artifacts pinned to their
   original evaluation settings and expiry.
5. Confirm authenticated judge status shows OnlineCompiler and the personal
   25-attempt allowance less any consumed usage. Use the [two-user checks](execution-credit.md#user-acceptance-after-the-owner-confirms-readiness)
   for scoped live acceptance only after confirming the account allowance and
   the approved smoke-test budget. Record the deployed revision and results.

To roll back, use the known disabled artifact and stop or protect every enabled
artifact that remains directly reachable. For future artifacts, set `ONLINECOMPILER_EXECUTION_APPROVED=false`
and `JUDGE_PROVIDER=disabled`; keep `JUDGE_ACCESS_MODE=evaluation` and its expired
pin on tester-only configurations. Hosting environment edits require a new
deployment and do not change an already-built artifact. Before enabling, verify
operator access to restore a known disabled artifact to the stable alias. On
completion or incident, restore that alias and disabled project settings, then
verify unavailable admission and unchanged quota/provider counters using authorized
nonexecuting observations. Do not spend an execution as a closure probe.

Alias rollback alone leaves direct immutable deployment URLs serving their old
configuration. Every enabled evaluation artifact therefore closes on its own fixed
expiry and remains closed after reset. For immediate closure before expiry, the
authorized hosting operator must also stop/protect those enabled artifacts; a
settings edit alone is not an emergency switch. Configuration-only rollback cannot
revoke already-running invocations or recall outbound source. Keep drafts, submissions and consumed quota. Attempts admitted by a compatible
rollback revision also count in the same personal period after redeploy.
Already-sent jobs cannot be cancelled by this switch and provider execution history
cannot be recalled. There is no automatic fallback, database reset or schema rollback.
