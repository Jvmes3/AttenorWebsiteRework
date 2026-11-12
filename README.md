# Attenor Collaborative website

Production: https://www.attenorcollab.com/

The public site is static, with Vercel serverless functions for lead capture and private client
access. The `test-production` branch is intended for a Vercel preview deployment before merging
anything into `main`.

## What is stored

The homepage booking form sends name, email, phone number, selected interest, optional notes,
source, and submission time to the
`interest_leads` table in Supabase. Attenor staff can view, filter, and export those records from
the Supabase table editor for follow-up. The browser never receives the Supabase service-role key.
Rows remain in the table until an authorized administrator explicitly changes or deletes them;
there is no automatic deletion job in this project.

After a lead is saved, the server sends the client a confirmation through Resend when
`RESEND_API_KEY` and `LEAD_CONFIRMATION_FROM` are configured. Email delivery is deliberately
non-blocking: a provider outage is logged, but it does not discard the lead or tell the client to
submit a duplicate. Verify the sending domain in Resend, then add both variables to the matching
Vercel Preview and Production environments. `ATTENOR_SCHEDULER_URL` is optional and defaults to
the public Attenor Calendly URL.

To mirror each saved lead into a Google Sheet, deploy an Apps Script web app that accepts JSON and
appends it as a row, then set its HTTPS URL as `LEAD_SPREADSHEET_WEBHOOK_URL`. The mirror runs only
after Supabase accepts the lead and is non-blocking, so Supabase remains the source of truth if the
spreadsheet is temporarily unavailable. The payload contains `full_name`, `email`, `phone`,
`interest`, `notes`, `source`, and `submitted_at`.

Private documents belong in the non-public Supabase Storage bucket named `impact-documents`.
Document paths are assigned per account in `ATTENOR_ACCOUNTS_JSON`; the download API verifies the
signed-in user before retrieving a file. Do not put client files in the public `resources/` folder.

## One-time test environment setup

1. Use the website’s existing Supabase project and run [`supabase/setup.sql`](supabase/setup.sql)
   in its SQL editor when preparing a fresh environment.
   Then run [`supabase/verify-retention.sql`](supabase/verify-retention.sql) to confirm the table,
   row-level security, retained record count, and rollback-safe test insertion.
2. In the private `impact-documents` Storage bucket, upload each client document under a distinct
   path such as `client-one/impact-report.pdf`.
3. Copy `.env.example` to `.env.local` for local Vercel development. Never commit that file.
4. Generate a strong password hash for each account by running `npm run hash-password`.
5. Build the one-line `ATTENOR_ACCOUNTS_JSON` value using the example shape in `.env.example`.
   There must be at least one account object. Each document needs a unique `id`, display `title`,
   optional `description`, private `storagePath`, and download `filename`.
6. Add `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SESSION_SECRET`, and
   `ATTENOR_ACCOUNTS_JSON` to the Vercel Preview environment. Keep Production unchecked until the
   team approves the feature.
7. Push `test-production` and use its Vercel preview URL to test. This does not change the live
   site unless the branch is merged or explicitly promoted.

Generate `SESSION_SECRET` with `openssl rand -base64 48`. Keep all four plain-text passwords in the
client's password manager; only their scrypt hashes belong in Vercel.

For Preview and local environments only, the repository includes the requested test account
`Wayman` with password `Eagles_FY26!` and the two Wayman Academy HTML reports. This fallback is deliberately
disabled when `VERCEL_ENV=production`; production requires `ATTENOR_ACCOUNTS_JSON` with a strong
password.

## Local checks

Use `npm run check` for authentication/session tests and `npm run build` for the deployment build.

Run `npm run dev` to preview the complete site locally at `http://localhost:8000`, including login,
sessions, the Impact page, and protected Wayman documents. The preview command creates a temporary
session secret in memory and uses `Wayman` / `Eagles_FY26!`; stopping the server ends existing sessions.
Lead storage still requires Supabase environment variables because those records are persistent.

## Separate Wayman benchmark site

Wayman students, parents, and teachers use a dedicated entry at `/wayman` in the test preview.
The planned live hostname is `wayman.attenorcollab.com`, with `/benchmark-1` through
`/benchmark-22`. These routes render `wayman.html`, not the consulting portal. The host-specific
root rewrite opens the Wayman directory. Known consulting entry paths on that hostname redirect
back to the school directory; consulting authentication APIs reject that hostname.

Students do not register, sign in, choose an avatar, or enter a password. At the beginning of
each benchmark they enter their teacher-assigned **student number** and **teacher’s name**.
Numbers are unique across Wayman for the school year, as confirmed by James. Preserve numbers
as strings, including leading zeros. The stable growth-tracking identity is school year + student
number; teacher name is an attribute of the submission, so a teacher change does not change the
student’s identity. Teachers retain the master list mapping numbers to real identities. The
assessment form accepts digits only for student numbers and never asks for student names.

All 22 benchmark paths are available without dates, week-based locks, prerequisite completion,
or individual access grants. The directory distinguishes actual available question content from
questions still being prepared. It never invents content for an empty assessment. A student can
return directly to an older benchmark for a makeup whenever its questions exist.

### Test-only publication

Keep this revision on **`test-production`** and publish it through Vercel Preview. Do not merge to
`main`, promote a deployment, activate the live subdomain, or change DNS as part of this test.
The exact combination `VERCEL_ENV=preview` and `VERCEL_GIT_COMMIT_REF=test-production` enables
test mode; local `npm run dev` also enables it by default. Production ignores the preview flag.

Open `/wayman` or `/benchmark-1` to test without a login. Use practice student numbers and teacher
names. In test mode, `/api/wayman` saves validated responses to the website’s existing
`portal_assessment_responses` table with `environment='test'`, `participant_id=null`, and a payload
containing `schoolYear`, `assessmentId`, `studentNumber`, `teacherName`, and answers. No student
account is read or created. The previously created `portal_students` table is retired and remains
untouched; the old signup/signin/profile API actions return HTTP 410. Existing student cookies
are ignored, cleared, and directed to the separate Wayman entry.

Starting a benchmark issues a short-lived, HttpOnly, host-only attempt cookie, not a student login.
The attempt binds number, teacher, school year, benchmark, and a server-generated submission UUID.
Submissions cannot replace that identity with values in the request body. A mismatched attempt
(such as another student starting the same benchmark in another tab) cannot save under the wrong
student. Retrying the same submission returns its original receipt without creating a duplicate.
The form does not retain profiles, names, numbers, or answers in localStorage/sessionStorage.
A confirmation is displayed only after the server confirms a database save.

### Question bank and live saves

`WAYMAN_SUPABASE_URL` and `WAYMAN_SUPABASE_KEY` are server-only settings for Ronetta’s existing
Wayman project. The adapter reads question content from `wayman_questions` filtered by
`assessment_id`, ordered by `question_number`. It returns only question text, choices, numbering,
and standards, never answer keys or other students’ responses. Availability is derived from actual
question rows for assessments 1–22. In test mode only, Benchmark 1 can use the supplied seven-question
snapshot in `api/_assets/benchmark-1.json` when the external connection is not configured.

Set `WAYMAN_SCHOOL_YEAR=2026-2027` consistently for the entire school year. Change it only when
opening the next school year. The separate `SUPABASE_URL` and `SUPABASE_SECRET_KEY` settings are
for Attenor’s existing test/facilitator storage and must not be confused with Ronetta’s project.
Keep all service credentials out of HTML, browser JavaScript, Git, URLs, and `NEXT_PUBLIC_*` values.
All functions must share a stable `SESSION_SECRET` of at least 32 random characters.

Live Wayman saves remain disabled until Ronetta/Ethan provide and verify the actual schema and
approved server-side connection. The prepared RPC adapter requires both
`WAYMAN_SUBMISSIONS_ENABLED=1` and `WAYMAN_SUBMIT_RPC=<approved-function-name>`, and calls:

```json
{
  "p_submission_id": "server-generated-attempt-uuid",
  "p_session_id": "wayman-2026-2027-benchmark-1",
  "p_assessment_id": 1,
  "p_school_year": "2026-2027",
  "p_student_code": "0017",
  "p_teacher_name": "Teacher name",
  "p_answers": [{ "question_id": 1, "selected_answer": "A" }]
}
```

`p_student_code` is the compatibility field for the assigned student number; it is not an account.
Confirm this contract against the supplied schema before enabling it. The approved function must
validate question/assessment membership, preserve the school-year/number identity and teacher,
save atomically, and deduplicate the submission UUID. It must return
`{"id":"<same-attempt-uuid>","submittedAt":"<ISO-8601-timestamp>"}`. No live save falls back to
Attenor’s test store or server memory. No schema or function in Ronetta’s project has been changed.

### Facilitator and consulting access

The homepage’s **Launch Portal** button continues to `/portal`, now exclusively for facilitator
shared-password access. There is no student role picker, signup, avatar selection, or profile page.
`/profile` redirects to the separate Wayman directory. The existing client-document `/login` is
independent. Facilitator navigation links to the school site separately. The Leadership Coherence
Check, session management, response tracking, and Facilitator Workspace experience remain intact.
Analytics display changes, AI summaries, and grading/trend integration are on hold until the live
backend is verified and real data is available.

The test facilitator password remains `Facilitator26!`. Production requires
`ATTENOR_ASSESSMENT_ADMIN_PASSWORD_HASH`; the test password and seeded leadership session are never
production credentials. Optional initial sessions use `ATTENOR_ASSESSMENT_SESSIONS_JSON` as before.
The existing facilitator tables remain service-role-only with row-level security enabled.

### Live subdomain handoff and target timeline

The code contains the host-specific routing, but `wayman.attenorcollab.com` has not been added,
activated, or pointed at this test branch. Before activating it, the domain owner should add the
hostname to the intended Vercel deployment/project, apply the exact DNS record Vercel supplies,
and verify HTTPS. Do not guess a CNAME target or modify the main Attenor domain’s root route.
The live deployment must contain the revised Wayman routes and verified live save configuration.

To target student use by **November 30, 2026**, aim to receive the following by **November 18**:

- Question and submission schema, approved server access through a secure channel, and the
  actual Benchmark 1 question/answer set or confirmation of the existing assessment mapping.
- Confirmation of where school year, student number, teacher, answers, and grading belong,
  plus retry/retake rules and the intended production project.
- The domain/DNS administrator and access needed to add and verify the Wayman hostname.

Allow 2–3 working days after complete access for integration and verification, then a teacher-led
pilot around November 23–25. Resolve pilot findings before the November 30 target. This schedule
is conditional on timely backend/DNS access; the test revision can be reviewed independently now.

## Retention and backups

Database retention and backup recovery are different concerns. Active PostgreSQL rows persist
until they are deleted, but a backup is what protects against accidental deletion or corruption.
Supabase Free projects can pause after inactivity and do not include automatic downloadable
backups. Before production, use a paid project with daily backups or schedule regular off-site
exports. Periodically run `supabase/verify-retention.sql` and confirm that the earliest retained
lead remains present.
