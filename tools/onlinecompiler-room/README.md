This directory contains only the approved one-off local room fixture composition.
The evaluation is complete and its authorized attempts are spent. Do not rerun
the fixtures. See the [evaluation record](../../docs/onlinecompiler-room-evaluation.json)
for outcomes and the [integration guide](../../docs/onlinecompiler-integration.md#authorized-private-evaluation)
for scope and production limitations. The setup below describes the evaluated runtime.
It is outside both application source trees. `prepare.mjs` copies the web app to
`.onlinecompiler-room/web` and replaces the judge context only in that disposable
copy. Normal builds never load `fixture-context.ts`. Run from the repository root.

The local copy requires `OC_ROOM_ROOT` (absolute path inside this worktree) and
`OC_OWNER_ID` (new synthetic local Auth identity). It accepts only room `ocdemo01`,
problem `11111111-1111-4111-8111-111111111142`, fixture version 1, expected output
`42`, and the exact wrong-answer then passing solution bytes. Its two durable
attempt files prevent re-execution after restart. Preserve these files as evidence;
never delete them to regain allowance. It uses production JudgeService and
SupabaseJudgeRepository, checks context before reservation, and uses the shared
real OnlineCompiler transport. No arbitrary draft is eligible.

Start Next dev with `--webpack --hostname 127.0.0.1 --port 3320` in the prepared
copy; realtime uses `HOST=127.0.0.1 PORT=3321`. Both must use only the task-owned
Supabase URL `http://127.0.0.1:58550`. Never enable production confirmation flags.
Before startup verify the assigned ports are still free and publish disposable
Auth/API/database ports only on loopback. Do not use shared/hosted databases.

The composition checks account usage against the historical attempts recorded in
the evaluation record. Preserve its durable attempt files; preparing a new copy
does not authorize additional execution.
