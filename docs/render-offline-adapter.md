# Render adapter preparation

`apps/web/src/lib/server/judge/render.ts` is offline groundwork only. It does
not make Run or Submit usable through Render or safe for public Java execution.
Production `context.ts` still selects JDoodle. The production route duration, JDoodle selection, credential configuration and
preview settings are unchanged. Submission ingress follows the bounded
[judge API contract](backend-setup.md#judge-integration). Private additive admission
RPCs remain unused in production.

`RenderProvider.inactive()` is always unconfigured. The only configured construction
path is the explicitly named `forOfflineTests(config, transport)` seam, requiring
injected workspace/group/immutable image and reviewed toolchain identity plus a mock
HTTP transport. There
is no default transport, environment reader, live credential support or activation
flag. Tests supply fabricated HTTP responses and never compile source or contact
Render. Future live integration requires a separately reviewed code change.

The narrow wire contract is pinned to the official
[TypeScript SDK v1.8.0 source](https://github.com/render-oss/sdk/blob/8b67d01c164e43ee4d5b720004efdbba9e26d9a3/typescript/src/experimental/sandboxes/index.ts)
and [CLI v2.36.0 schema](https://github.com/render-oss/cli/blob/4fd34231b637f7121d440ec2dcfe135d6e06b7b2/pkg/client/sandboxes/sandboxes_gen.go).
It implements only create/get, upload-token/file PUT, exec-token/SSE and terminate.
Creation uses `ownerId`, `sandboxGroupId`, immutable `buildId`, `1c-2g`, an empty
`env` map, explicit `networkPolicy: { type: "deny-all" }`, runtime 60 seconds and
idle timeout 300 seconds. It never restores, resumes, snapshots or reuses a VM.
Source is uploaded as data to `/tmp/Main.java`; fixed commands are
`javac -proc:none -d /tmp /tmp/Main.java` and `java -cp /tmp Main`.
These commands and outer settings do not establish descendant resource confinement.

The main budget is 22 seconds, plus independent termination capped at 3 seconds,
within the unchanged 30-second route duration. Stage deadlines are create HTTP
3 seconds, readiness 5 seconds, upload 2 seconds, compile 5 seconds and runtime
2 seconds. Every stage covers HTTP and body consumption, including token requests.
Readiness polls only `creating`; other unexpected states fail. There are no retries
of failed operations or ambiguous creation, and each execution makes one create
request. Acknowledged IDs are retained before readiness validation and terminated
in `finally` using a fresh signal even after caller or stage cancellation. Cleanup
failure overrides an otherwise completed result. A successful termination HTTP
response follows the pinned SDK contract; actual provider destruction timing is
unproven. A lost create acknowledgement leaves the resource identity unknown;
this module cannot reconcile it or prove independent expiry. Future admission must
retain quota and halt further admission until reconciliation. The offline
integration now provides durable callbacks for this, described below.

Raw main-response bytes share a 64 KiB envelope, checked before decoding or
accumulating incomplete SSE lines/events, including multiline frames. Cleanup
responses have a separate 64 KiB cap. UTF-8 decoding is incremental and strict.
Program stdout is limited to 16 KiB; compiler output and runtime stderr share a
4 KiB diagnostics budget. Runtime stderr never enters compared stdout. SSE must
finish with a complete explicit integer exit event and intact EOF; malformed,
missing, extra terminal/output events, provider error events, timeouts and overflow
fail unavailable. Nonzero compiler exit prevents runtime and yields compile error;
nonzero runtime exit yields runtime error, never inferred from student text.
No provider response supplies acceptance or resource-limit attribution.

Before any live activation, separately establish and approve:

- Install a separately approved Render policy only after all live prerequisites
  below are established. The offline migration supplies no policy, defaults or prices.
  Review the production composition and confirm effective group concurrency before
  activation. Existing JDoodle accounting remains separate from Render admission.
- Proven non-raiseable compiler/JVM descendant CPU, memory, process/thread and
  aggregate writable-byte/inode confinement, privilege separation, network denial,
  and whole-tree cleanup. VM size, Java heap flags and shell timeouts do not prove
  those controls.
- Account creation entitlement, reviewed scoped automation credentials, billing
  owner, exact rates/minimums/creation-error charges, image identity and import
  costs, lifecycle clock/creating/errored behavior, independent expiry and bounded
  termination after broker death or acknowledgement loss. Never copy a CLI token.
- Exact lifecycle/account/cost approvals and separately controlled trusted live
  proof, then bounded containment proof and public activation authorization.
  Trusted fixture success alone does not establish public safety.

No group/image creation, key issuance, paid usage, live compilation, deployment or
hosted changes are authorized by this preparation. Existing sibling validation
remains parked and is outside this change.

Validation: `pnpm test` includes mocked wire/failure/bounds tests, the production
selection regression and existing service idempotency tests. `pnpm typecheck`
checks interface compatibility. No local Java or provider HTTP is needed.


## Offline durable admission

`202611150001_render_offline_admission.sql` adds private Render policy, attempt and
operator-evidence tables, without rewriting historical migrations or data. The
existing `submissions.id` is the durable attempt ID, labeled `leetcollab-<id>` in
mock create requests; `runner` records `render`, not JDoodle. Private provenance
records the exact selected workspace/group/build and the reviewed immutable-image
toolchain declaration. This is not a claimed live observation of `java -version`.
No provider identity, budget, lifecycle or verdict authority comes from the browser.

A policy must explicitly supply a review reference, validity, exact identities,
daily/monthly attempt ceilings, active ceiling, a positive all-in worst-case cost
per attempt and a monthly admission budget in integer micro USD. Unknown/null/zero
cost or missing/expired/mismatched policy rejects admission. No proposed live
$5/600-per-month values are installed or approved. Fixture numbers are synthetic.
Policy and terminal-evidence tables deny direct writes even to `service_role`;
installing policy/evidence requires a separately authorized operator. This change
performs neither operation outside disposable tests.

A row lock on the single provider policy serializes admission and transitions.
Indexed attempt records supply shared UTC day/month counts, monthly reserved cost
and all-period active capacity atomically. Counts/cost include failed and unknown
attempts; no refund, automatic retry or expiry releases a Render reservation.
Policy revisions never reset these records. These are admission-period spending
reservations, not provider invoice measurements or a provider-enforced dollar cap. Private admission
status also disables the existing status response on monthly/cost exhaustion,
active-capacity saturation, ambiguity or policy expiry without publishing metadata.
Actual pricing must bound all applicable charge paths before any policy is valid.

The offline broker option `renderPolicyId` and injected provider provenance select
these narrow RPCs through the existing repository/service and trusted comparison
and completion contract. Production `context.ts` supplies neither. A reserved
attempt's server callbacks persist `creating` before its one POST, then the known
resource ID and cleanup acknowledgement. A second begin cannot authorize another
POST. Completed results require settled cleanup evidence. Normal acknowledged-ID
termination follows the existing adapter's HTTP contract; finite physical cleanup
and final billing remain unproven activation prerequisites.

If creation, acknowledgement persistence, execution or cleanup fails without a
recorded settled state, failed completion records `unknown`, keeping usage, cost
and active capacity. A crash in `creating` also blocks new admission without a
lease timer. Unknown/creating attempts block the whole Render admission scope,
including across period boundaries and policy revisions. A late ID can be saved
without clearing unknown status. Cleanup callbacks cannot reconcile an unknown
attempt. If completion persistence itself fails, the prior durable phase still
holds capacity. Failures before any POST keep spent admission but release capacity.

`reconcile_render_attempt` requires a preexisting operator terminal-evidence record
for that attempt, including nonempty operator/evidence references, observation time
and all discovered resource IDs. A known ID must be included. The broker has no
write permission for that evidence. An operator must establish noncreation or
terminal cleanup of every match using separately reviewed provider facts; an empty
list or elapsed timer is not evidence. Reconciliation marks an unfinished attempt
failed and releases capacity only; it never refunds quota/cost or authorizes a
retry with the same key. Attempt records restrict cascading deletion so account or
problem removal cannot silently discard unresolved cost or lifecycle evidence.

Validation uses `supabase/tests/render_admission.py` against an owned disposable
PostgreSQL database with all migrations applied, plus injected provider/repository,
route and existing JDoodle tests. Run the database regression with
`TEST_POSTGRES_CONTAINER=<owned-test-container> TEST_DATABASE_NAME=<disposable-db>
python3 supabase/tests/render_admission.py`. It truncates Render test records and
must never point at a shared or hosted database. No credentials, provider requests,
live Java, infrastructure, deployment or public activation are part of these tests.

CI applies all migrations to a fresh PostgreSQL service using the minimal test-only
auth contract in `supabase/tests/disposable_auth.sql`, then runs the Render and
existing JDoodle concurrency regressions. This is database transaction/permission
coverage, not hosted Supabase auth parity or live provider evidence.
