# Attenor Collaborative website

Production: https://www.attenorcollab.com/

The public site is static, with Vercel serverless functions for lead capture and private client
access. The `test-production` branch is intended for a Vercel preview deployment before merging
anything into `main`.

## What is stored

The booking and Impact follow-up forms send name, email, phone number, selected interest, optional
notes, source, and submission time to the
`interest_leads` table in Supabase. Attenor staff can view, filter, and export those records from
the Supabase table editor for follow-up. The browser never receives the Supabase service-role key.
Rows remain in the table until an authorized administrator explicitly changes or deletes them;
there is no automatic deletion job in this project.

Private documents belong in the non-public Supabase Storage bucket named `impact-documents`.
Document paths are assigned per account in `ATTENOR_ACCOUNTS_JSON`; the download API verifies the
signed-in user before retrieving a file. Do not put client files in the public `resources/` folder.

## One-time test environment setup

1. Create a Supabase project and run [`supabase/setup.sql`](supabase/setup.sql) in its SQL editor.
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
`user1` with password `1234` and the two Wayman Academy HTML reports. This fallback is deliberately
disabled when `VERCEL_ENV=production`; production requires `ATTENOR_ACCOUNTS_JSON` with a strong
password.

## Local checks

Use `npm run check` for authentication/session tests and `npm run build` for the deployment build.

Run `npm run dev` to preview the complete site locally at `http://localhost:8000`, including login,
sessions, the Impact page, and protected Wayman documents. The preview command creates a temporary
session secret in memory and uses `user1` / `1234`; stopping the server ends existing sessions.
Lead storage still requires Supabase environment variables because those records are persistent.

## Retention and backups

Database retention and backup recovery are different concerns. Active PostgreSQL rows persist
until they are deleted, but a backup is what protects against accidental deletion or corruption.
Supabase Free projects can pause after inactivity and do not include automatic downloadable
backups. Before production, use a paid project with daily backups or schedule regular off-site
exports. Periodically run `supabase/verify-retention.sql` and confirm that the earliest retained
lead remains present.
