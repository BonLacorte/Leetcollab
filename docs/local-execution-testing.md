# Local Run and Submit testing

Run and Submit use the same server-owned judge and each consumes one execution.
Disabled buttons with `External sandbox is not configured.` mean the selected
provider lacks credentials or approval. A successful status request alone does
not verify real Java execution.

The normal application ceiling stays at 20 executions per shared daily period.
For explicitly authorized local testing, the development server supports up to
50 total executions in that period, including usage already charged. It never
resets usage or enlarges the provider's account allowance.

The preview owner should first verify current provider allowance and explicit
local activation authority. OnlineCompiler requires the REST key and both
approval flags documented in [provider setup](onlinecompiler-integration.md#selection-and-approval).
Keep the key private and server-only. This opt-in changes no provider approval,
source restrictions, authentication, concurrency, idempotency, or verdict rules.

With all judge admission stopped and no active reservations, apply
[the local SQL opt-in](../supabase/local/enable-test-quota.sql) to the verified
local Supabase database using its existing operator connection. Apply the normal
migrations first. The script is deliberately outside `supabase/migrations` and
must never be applied to a hosted database. It raises only the database ceiling
and current local period's limit, preserving `used`, submission history and RPC
permissions. It aborts if reservations are active. Subsequent status/reservation
calls continue to preserve any lower limit, so an older server still configured
at 20 can lower the period again. Stop admission from that server before setup.

Set these server-only values in the local web environment, retaining the existing
Supabase keys and realtime settings:

```dotenv
JUDGE_PROVIDER=onlinecompiler
JUDGE_ACCESS_MODE=normal
JUDGE_LOCAL_TESTING=true
JUDGE_DAILY_LIMIT=50
ONLINECOMPILER_POLICY_ACCEPTED=true
ONLINECOMPILER_EXECUTION_APPROVED=true
JDOODLE_LIMITS_CONFIRMED=false
```

The separately supplied `ONLINECOMPILER_API_KEY` is also required. Normal access
is appropriate only when that scope is authorized; never use it to open a
tester-only deployment. Start the web app with `next dev`, so
`NODE_ENV=development`, and an HTTP Supabase URL on `localhost`, `127.0.0.1`, or
`[::1]`. The server's effective `SUPABASE_URL` takes precedence over
`NEXT_PUBLIC_SUPABASE_URL`. Production builds, remote databases, other providers,
and restricted evaluation retain their existing ceilings. The local flag alone
does not enable any provider or raise the default configured daily limit of 20.

The preview owner restarts only its own web service after environment changes.
Refresh judge status before the user tests. Expected allowance is
`50 - previously charged usage`; if it is lower, inspect the actual quota row
and active callers rather than deleting usage or automatically retrying calls.
Only the user performs the authorized Run/Submit acceptance calls.

To stop testing, set `ONLINECOMPILER_EXECUTION_APPROVED=false` and restart the
owning web service. For the next normal configuration, set
`JUDGE_LOCAL_TESTING=false` and `JUDGE_DAILY_LIMIT=20`. Existing usage remains
charged, even if it exceeds 20, until the normal 23:55 UTC reset. The opt-in SQL
is unnecessary on any other database and is not part of deployment.
