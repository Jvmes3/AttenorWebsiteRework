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

## Portal and Assessment Studio

The homepage’s **Launch Portal** button opens `/portal`, where visitors choose Student or
Facilitator. The portal uses the existing static frontend, Vercel functions, and the website’s
existing Supabase project. It does not create a separate hosting project or reuse Ronetta’s
question database for student accounts.

- **Students** create an account with a teacher-issued student code, teacher name, password, and
  one of eight animal avatars. Existing students sign in with their code and password. They see
  only the “Small steps. Growing minds.” benchmark area and currently available assessments.
  `/profile` shows their saved student details and lets them change their animal avatar.
- **Facilitators** sign in with the shared facilitator password. There is no individual profile
  setup. Their portal includes the Leadership Coherence Check, benchmarks, session management,
  and the Facilitator Workspace. The portal prompts facilitators to complete the leadership
  reflection before reviewing team results.

Student accounts and avatars are persistent in Supabase and can be used from another browser.
Passwords are stored as scrypt hashes; the browser receives a signed, HttpOnly cookie containing
an account ID and password revision, never the password hash or database credentials. Profile
changes read and update the signed-in student’s record. Role checks also run in the APIs: a
student cannot gain facilitator access by changing a URL or hiding/showing interface elements.
The existing `/login` client-document library is separate and does not grant portal admin access.

### Test branch and local preview

Publish this work from **`test-production`**, using a Vercel Preview deployment. Keep `main` and
Production unchanged until the team approves a release. The exact combination
`VERCEL_ENV=preview` and `VERCEL_GIT_COMMIT_REF=test-production` enables the test portal’s seeded
sessions and practice password. Local `npm run dev` also enables test mode by default using
`ATTENOR_ASSESSMENT_PREVIEW=1`; production never accepts that preview flag as authorization.
A branch name alone cannot turn on test access in a Production deployment.

Use fictional student codes, practice teacher names, and practice responses while testing. Test
records are retained in Supabase under `environment = 'test'`; they do not disappear when a Vercel
function or local server restarts. Production records use `environment = 'production'`. The same
student code may exist independently in the two environments. No automatic deletion job is
configured.

| Test access | Credentials |
| --- | --- |
| Student | Create an account at `/portal`, then use that student code and password |
| Facilitator at `/portal` | `Facilitator26!` |
| Leadership session `leadership-demo` | `Coherence26!` when using its participant password route |
| Benchmark 1 participant route | `Eagles_FY26!` when a session password is requested |

The portal routes are `/portal`, `/assessments`, `/profile`, `/facilitator`, `/coherence`,
`/coherence/<session-slug>`, and `/benchmark-1` through `/benchmark-22`. Available benchmark
metadata comes from the server. Benchmark 2 remains unavailable until its separate assessment
file is supplied and reviewed. Later benchmark routes are prepared but do not manufacture
questions or open assessments that are not configured.

### Supabase records and access

Run [`supabase/portal-setup.sql`](supabase/portal-setup.sql) against the website’s existing Supabase
project when preparing another environment. Its three additive tables are:

| Table | Saved records |
| --- | --- |
| `portal_students` | Student code, teacher name, animal avatar, password hash, and timestamps |
| `portal_assessment_sessions` | Unique session IDs/slugs, assessment type, password hash, expected response count, and status |
| `portal_assessment_responses` | Submission UUID, session ID, optional signed-in student ID, response payload, and submission time |

Every table includes an environment tag. Every response belongs to a session; foreign keys keep
student and session references within that environment. Responses are saved only after validation,
and retrying the same submission UUID returns the original receipt rather than adding another row.
The SQL enables row-level security and revokes table access from browser `anon` and `authenticated`
roles. Server requests use the existing `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or legacy
`SUPABASE_SERVICE_ROLE_KEY`). Keep those values only in `.env.local` and the appropriate Vercel
server environment. Never put a service-role/secret key in HTML, browser JavaScript, a tracked
file, a URL, or a `NEXT_PUBLIC_*` variable.

Configure a stable `SESSION_SECRET` with at least 32 random characters in Vercel Preview. All portal
and assessment functions must receive the same value so cookies remain valid across serverless
instances. Local development generates a temporary secret only if one is not supplied; changing
that secret ends existing logins without deleting saved profiles or responses.

Session creation generates a unique invitation link and password and saves the session in
Supabase. The generated password is shown once; only its hash is retained. Facilitators can select
any configured session and track its saved response count. The workspace refreshes every ten
seconds while visible. Leadership averages and score ranges become available when saved complete
responses meet the session’s expected count (5–15; the test leadership session defaults to 15).
Before that threshold, the interface shows collection progress. Shared facilitator access does
not verify the identity of each respondent. Benchmark tracking counts saved submissions; graded
score analytics require stored grading data and are not fabricated from the question-only snapshot.
AI calibration summaries and spreadsheet exports are not enabled by this build.

### Production configuration

Production student signup/signin remains disabled unless `ATTENOR_PORTAL_STUDENTS_ENABLED=1` is
explicitly configured. Before a production release, also configure
`ATTENOR_ASSESSMENT_ADMIN_PASSWORD_HASH` and actual session settings; the built-in facilitator
password and demo sessions are test-only. Generate scrypt password hashes with `npm run hash-password`.
`ATTENOR_ASSESSMENT_SESSIONS_JSON` can supply initial sessions, including unique `id` and `slug`,
`name`, `organization`, `type`, `status`, and `passwordHash`; benchmark sessions also supply
`benchmark` (1 through 22), and leadership sessions can supply `expectedParticipants` (5 through 15).
Server database errors are reported as unavailable access or unconfirmed saves, rather than a
successful registration or receipt.

### Ronetta’s Wayman question database

`WAYMAN_SUPABASE_URL` and `WAYMAN_SUPABASE_KEY` are separate server settings for Ronetta’s existing
Wayman project. The adapter reads `wayman_questions` by `assessment_id`, ordered by
`question_number`, and returns question text, A–D choices, and standards without exposing answer
keys. In test mode only, Benchmark 1 may use the supplied seven-question snapshot in
`api/_assets/benchmark-1.json` when the external question connection is not configured. It contains
no answer keys or student records. Test portal responses are saved to the website’s
`portal_assessment_responses` table, not written to Ronetta’s student tables.

For a separate production integration that saves directly to Ronetta’s Wayman tables, configure
an atomic database function through `WAYMAN_SUBMIT_RPC`. This build does not install a function
or change the schema in her project. The fallback adapter calls
`/rest/v1/rpc/<WAYMAN_SUBMIT_RPC>` with:

```json
{
  "p_submission_id": "client-generated-uuid",
  "p_session_id": "configured-session-id",
  "p_assessment_id": 1,
  "p_student_code": "student-code",
  "p_teacher_name": "Teacher name",
  "p_answers": [{ "question_id": 1, "selected_answer": "A" }]
}
```

The function must validate session/assessment access, grade with server-side answer keys, save
answers and the submission in one transaction, preserve teacher name and session ID, and
deduplicate `p_submission_id`. It must return
`{"id":"<same-submission-uuid>","submittedAt":"<ISO-8601-timestamp>"}`. This avoids the supplied
HTML’s separate inserts, which can partially save or duplicate a response. Review the existing
Wayman tables’ permissions and function with Ronetta before using that integration for students.

The leadership PDF is a facilitated participant guide rather than an eight-dimension scoring
instrument. The form uses the eight dimensions from the build brief. Its descriptions and 1–5
rating anchors are draft web copy for Dr. Wards to calibrate before a live engagement, rather than
transcribed scoring criteria from the PDF.

### Wayman subdomain

Add `wayman.attenorcollab.com` to the existing Vercel project and configure its DNS record when
ready to launch that host. `/benchmark-1` through `/benchmark-22` then use the same application.
If that host should open the portal at `/`, add a host-conditional rewrite from `/` to `/portal`
for that exact hostname. Keep the main domain’s homepage at `/`. Publishing the test branch does
not change domain/DNS configuration or promote the branch to Production.

## Retention and backups

Database retention and backup recovery are different concerns. Active PostgreSQL rows persist
until they are deleted, but a backup is what protects against accidental deletion or corruption.
Supabase Free projects can pause after inactivity and do not include automatic downloadable
backups. Before production, use a paid project with daily backups or schedule regular off-site
exports. Periodically run `supabase/verify-retention.sql` and confirm that the earliest retained
lead remains present.
