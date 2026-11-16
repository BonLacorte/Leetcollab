# OnlineCompiler integration and evaluation

This is a server-only integration for the exact service
[OnlineCompiler.io](https://onlinecompiler.io/docs). It does not activate a hosted
provider or replace an existing deployment's provider. Credentials, deployment,
and live evaluation are separate operator actions.

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
- `ONLINECOMPILER_LIMITS_CONFIRMED=true`: reviewed evidence for the applicable safety contract

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

## Request and result contract

The adapter sends one JSON POST to the fixed HTTPS endpoint
`https://api.onlinecompiler.io/api/run-code-sync/`, with the REST key in the
`Authorization` header, `compiler: "openjdk-25"`, and the assembled program in
`code`. It requests no external files, libraries, network access, or custom input.
Redirects are refused. There are no retries.

The existing validation reserves the package-private `Solution` and `Main` names.
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
generated locally to avoid retaining source echoes or raw provider errors. A 429
can mean account allowance, rate, or capacity, so it remains unavailable and never
blindly exhausts all shared application quota. Provider wall time is not labeled
as CPU time. See the [run-code reference](https://onlinecompiler.io/docs/run-code).

Successful provider output still passes through LeetCollab's existing fixture
comparison and private completion RPC. HTTP 200 is not an accepted solution.
Run and Submit retain their existing shared persistence semantics. Authentication,
rooms, drafts and verified-completion rules are unchanged.

## Persistence and quota

Apply the additive `202611150002_onlinecompiler_reservations.sql` migration in a
reviewed runtime before selecting this provider. It preserves existing data,
accounting and completion functions, binds new rows to `runner=onlinecompiler`,
and rejects reusing an idempotency key with another provider. Only the trusted
service role can call the fixed-runner reservation RPCs; internal helpers cannot
be called by application roles.

The existing conservative application cap remains at most 20 attempts/day,
resetting at 23:55 UTC, shared across JDoodle and OnlineCompiler. This is an
application limit, not OnlineCompiler's monthly reset or an upgrade to 100,000
application attempts. Existing consumed usage is preserved. Failed or ambiguous
attempts retain their charge and cannot be replayed into another execution.
A dedicated account/key without conflicting callers and reconciled provider
usage remain evaluation prerequisites.

## Live evaluation prerequisites

Published default limits are not proof of a stricter safety contract. In particular,
OnlineCompiler documents a 30-second combined timeout, 512 MB default memory,
16 simultaneous processes, and larger writable mounts than the retained strict
compile/runtime/write budgets. Java's requested time limit has a startup allowance;
a memory limit below the sandbox cap is checked after execution. Separate compile
and runtime tree limits, aggregate CPU/thread/inode enforcement and independent
cleanup requirements must be resolved before claiming compatibility or setting
`ONLINECOMPILER_LIMITS_CONFIRMED=true`. Application deadlines do not terminate
remote code. See [limits](https://onlinecompiler.io/docs/limits) and
[security claims](https://onlinecompiler.io/security).

Provider execution history includes source/input/output and can be retained for
365 days. Use only explicitly approved synthetic fixtures for evaluation and never
private drafts or personal data. Judged submissions have separate plan retention.
See the [privacy policy](https://onlinecompiler.io/privacy).

A production evaluation needs current Free allowance, no paid/overage authority,
compatible safety facts and a coordinated isolated authenticated runtime. A separately
authorized private evaluation can use fixed trusted synthetic fixtures under the
documented provider limits without confirming production safety compatibility. Record
at most three sequential trusted attempts: passing solution, wrong answer and
compile error. Do not retry ambiguous attempts; stop at the first unexpected
outcome and count it as spent. Real provider verdicts and private persisted
completion must be verified before recommending a public switch. Mock responses
are never a claim of working Java execution.

## Deterministic checks

`pnpm test` includes adapter boundaries, selection/status, broker verdict/persistence
and existing auth/UI regressions. The disposable database CI job applies all
migrations and checks runner permissions, persisted outcomes, quota retention and
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
JudgeService, repository and reservation/completion RPCs. Production calls retain
both approval checks in `OnlineCompilerProvider.execute`.

The local endpoints were web `127.0.0.1:3320`, realtime `127.0.0.1:3321`, and
Supabase gateway `127.0.0.1:58550`. Docker assigned the replacement loopback gateway
port after the proposed ports collided. The database had no host-published port;
SQL used `docker.exe exec` in the owned container. Web used an explicit loopback
hostname and realtime used `HOST=127.0.0.1`. CORS alone does not restrict exposure.

This establishes bounded trusted-fixture UI and persistence behavior. It does not
establish safe arbitrary-user execution or resolve production eligibility. Normal
Run/Submit remains gated until the stricter safety contract is established. No
production approval flag, hosted configuration, deployment or public provider
selection was changed.
