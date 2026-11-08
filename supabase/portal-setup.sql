-- Portal records are isolated from the public lead form and from Ronetta's question bank.
-- Only server-side service-role requests can access these tables.
begin;

create table if not exists public.portal_students (
  environment text not null check (environment in ('test', 'production')),
  id uuid not null default gen_random_uuid(),
  student_code text not null check (length(student_code) between 1 and 80 and student_code = upper(student_code)),
  teacher_name text not null check (length(teacher_name) between 1 and 120),
  avatar text not null check (avatar in ('fox', 'owl', 'bear', 'rabbit', 'panda', 'cat', 'dog', 'tiger')),
  password_hash text not null check (password_hash like 'scrypt$%'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (environment, id),
  unique (environment, student_code)
);

create table if not exists public.portal_assessment_sessions (
  environment text not null check (environment in ('test', 'production')),
  id text not null check (length(id) between 1 and 100),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  name text not null check (length(name) between 1 and 160),
  organization text not null check (length(organization) between 1 and 160),
  type text not null check (type in ('leadership', 'benchmark')),
  benchmark integer check (benchmark between 1 and 22),
  expected_participants integer check (expected_participants between 5 and 15),
  status text not null default 'open' check (status in ('open', 'closed', 'unavailable')),
  password_hash text not null check (password_hash like 'scrypt$%'),
  created_at timestamptz not null default now(),
  primary key (environment, id),
  unique (environment, slug),
  check ((type = 'benchmark' and benchmark is not null) or (type = 'leadership' and benchmark is null))
);

create table if not exists public.portal_assessment_responses (
  environment text not null check (environment in ('test', 'production')),
  id uuid not null,
  session_id text not null,
  participant_id uuid,
  type text not null check (type in ('leadership', 'benchmark')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 20000),
  submitted_at timestamptz not null default now(),
  primary key (environment, id),
  foreign key (environment, session_id) references public.portal_assessment_sessions(environment, id),
  foreign key (environment, participant_id) references public.portal_students(environment, id)
);

create index if not exists portal_assessment_responses_session_idx
  on public.portal_assessment_responses(environment, session_id, submitted_at);
create index if not exists portal_assessment_responses_participant_idx
  on public.portal_assessment_responses(environment, participant_id);

alter table public.portal_students enable row level security;
alter table public.portal_assessment_sessions enable row level security;
alter table public.portal_assessment_responses enable row level security;

revoke all on public.portal_students, public.portal_assessment_sessions,
  public.portal_assessment_responses from anon, authenticated;
grant select, insert, update on public.portal_students to service_role;
grant select, insert, update on public.portal_assessment_sessions to service_role;
grant select, insert on public.portal_assessment_responses to service_role;

commit;
