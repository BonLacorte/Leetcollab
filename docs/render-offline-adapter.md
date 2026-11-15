# Render adapter preparation

`apps/web/src/lib/server/judge/render.ts` is offline groundwork only. It does
not make Run or Submit usable through Render or safe for public Java execution.
Production `context.ts` still selects JDoodle. No route, duration, reservation,
comparison, persistence, schema, credential configuration or preview setting changes.

`RenderProvider.inactive()` is always unconfigured. The only configured construction
path is the explicitly named `forOfflineTests(config, transport)` seam, requiring
injected workspace/group/immutable image identity and a mock HTTP transport. There
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
retain quota and halt further admission until reconciliation.

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

- Correct provider/toolchain/attempt provenance through an additive migration;
  existing reservations still record JDoodle. Preserve the shared Run/Submit
  validation, assembled-source bound, comparison, idempotency and persistence.
- Atomic durable Render admission and monthly budget accounting, ambiguity
  reconciliation, effective group concurrency one, cost ceilings and quotas.
  Existing JDoodle reset/accounting is insufficient for Render billing.
- Bounded raw request ingress before JSON parsing; proposed 256 KiB maximum.
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
