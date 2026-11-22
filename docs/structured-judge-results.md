# Structured judge results

Successful submission responses retain the existing verdict, aggregate check
counts and sanitized `diagnostics` string. The optional compiler and public-case
fields are defined by `judgeSubmissionSchema` in the
[shared contracts](../packages/contracts/src/index.ts).

Compiler locations use the original submitted source's 1-based line numbers.
Messages come from the existing server-written category allowlist. Raw source
echoes, symbols, paths and harness locations are withheld. Duplicate compiler
errors are retained, even when their mapped locations and categories match.
At most eight line-level diagnostics are available. The UI derives excerpts
from its captured submission source and owns editor revision checks.

`compilerErrorCount` is supplied only from an explicit terminal javac error
summary, never inferred from the number of matched headers. It is null when no
reliable total is available. `compilerDiagnosticsComplete` is false if locations
were filtered, diagnostics were capped, a message category is unavailable, or
the compiler report was incomplete. A known compiler total can exceed the number
of safe user-source locations. Raw compiler reports and structured detail are
not persisted. Idempotent replays do not reconstruct missing totals or annotate
unverified source; they return an empty structured diagnostic list and unknown
total. The legacy sanitized diagnostic string remains available.

The [release migrations](execution-credit.md#migration-and-restart) are required
before enabling this version. The public-case migration records associations
between published examples and private fixture invocations, bound to the
reviewed harness's SHA-256 and fixture version. Unknown or modified fixture
plans expose no per-case details. The private table's existing permissions stay
unchanged. Parcel Pair's public examples previously surrounded a private case;
fixture version 2 places both public invocations first and retains every check.
Compact Runs' public empty-string expected value is canonicalized from prose
to the actual empty string.

For a verified plan, only trusted harness output statements are changed. A
private harness helper emits an indexed Base64 record for each return value,
including empty and multiline strings. Submitted source is not rewritten.
Exactly one ordered record per fixture is required; duplicate, missing, malformed
or unframed output is an unavailable attempt with its quota charge retained.
There is no raw stdout fallback. All private checks still determine the overall
verdict and aggregate pass count. Only mapped public records cross the response
boundary, without private indexes, framing or hidden values.

Each public case's `output` is an observed value, never copied from `expected`.
`passed` is computed from that record and the corresponding fixture comparison.
Compilation or execution errors omit public cases. The Testcases tab still
shows example inputs and expected outputs. Public output exceeding 4,096
characters is withheld while its pass/fail status remains available. Framing
counts toward the existing provider output bounds, which stay at their current
limits alongside the existing timeout and admission gates. Legacy fixtures retain
their aggregate judging path without exposing raw output. Idempotent replays
omit per-case observations because they were not retained; the UI should show
the aggregate result and an honest detail-unavailable state.

Structured results use the same provider request as the verdict. In an authorized
live acceptance check, verify compiler markers, excerpts and counts, then public
Input, Output and Expected for a correct solution and a wrong answer. See the
[rollout sequence](onlinecompiler-integration.md#rollout-and-rollback) for hosted
activation and smoke-test requirements.
