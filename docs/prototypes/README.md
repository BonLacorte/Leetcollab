# Preserved UX reference

Open [leetcollab-ux-prototype.html](leetcollab-ux-prototype.html) directly in a
browser. This standalone HTML/CSS/JavaScript prototype uses sample data and
simulated interactions. It does not create real rooms, persist application data,
authenticate users or execute code. Its Java sample editor does not require a
Java runtime.

## Design direction

The reviewed reference has four connected screens:

1. Dashboard: due work, a new problem, personal progress and room entry.
2. Problem library: 18 sample interview problems, filters and an Answer action.
3. Answer workspace: one solo/collaborative workspace with editor, problem,
   whiteboard, submissions, chat, timer and member controls.
4. Personal progress: attempt history, separate learner recall grades and
   suggested review dates.

Dashboard, Problem library and Progress form the persistent navigation. Answer
opens through contextual actions. Simulated submissions show who participated;
personal recall grades remain separate from correctness. Suggested review dates
do not prevent repeat practice.

The visual reference uses LeetCollab's compact diamond branding, Arial/system
typography, dense room layout, light/dark surfaces and monochrome primary actions.
The final review toned down decorative color rails, chips, oversized type and
hover effects. Production components should follow the actual Shadcn/ui system;
the prototype is a design/content reference, not a completed production feature
set. Sample grading, judging, scheduling and quota flows are not evidence those
features exist in the application.

## Preservation limits and continuation

The surviving prototype is preserved here unchanged. No private operational
report, browser profile, screenshots, runtime logs or credentials are included.

The historical scout reported uncommitted experiments in `page.tsx`,
`globals.css`, `room-header.tsx`, `supabase/seed.sql`, `pnpm-workspace.yaml` and
`supabase/migrations/202609050001_add_personal_review_schedule.sql`. Their earlier
versions could not be located during transfer inventory. **Those historical
experiments are not backed up by this transfer**, even where this branch has
files with the same names. They were not reconstructed or imported. This branch
preserves its own Shadcn migration and committed fixes separately.

See [CONTINUATION.md](../../CONTINUATION.md) for application startup and deferred
real authentication, room and chat browser testing. Reviewing this simulated
prototype does not validate those application flows.
