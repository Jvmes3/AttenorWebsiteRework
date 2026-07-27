-- Run in the Supabase SQL editor after setup.sql.
-- This verifies the table, security posture, retained-row history, and insert behavior.

select
  to_regclass('public.interest_leads') as lead_table,
  c.relrowsecurity as row_level_security_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'interest_leads';

select
  count(*) as retained_lead_count,
  min(created_at) as earliest_retained_lead,
  max(created_at) as latest_retained_lead
from public.interest_leads;

-- Confirm that a row can be written and read without leaving test data behind.
begin;

insert into public.interest_leads (full_name, email, phone, interest, notes, source)
values (
  'Retention Verification',
  'retention-verification@example.invalid',
  '555-0100',
  'Verify lead retention',
  'Rollback-safe verification row',
  'manual-retention-test'
);

select id, full_name, email, phone, interest, notes, source, created_at
from public.interest_leads
where email = 'retention-verification@example.invalid';

rollback;
