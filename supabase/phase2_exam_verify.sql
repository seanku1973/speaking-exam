-- =========================================================
-- SPEAKING EXAM - Phase 2
-- Teacher verification + exam selection permissions
-- Safe to run more than once.
-- =========================================================

-- 1. Keep Auth users and profiles synchronized.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    user_id,
    full_name,
    role
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email, 'User'),
    'student'
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Backfill existing Auth users.
insert into public.profiles (
  user_id,
  full_name,
  role
)
select
  id,
  coalesce(raw_user_meta_data->>'full_name', email, 'User'),
  'student'
from auth.users
on conflict (user_id) do nothing;

-- Recognize the standard teacher account(s).
update public.profiles p
set role = 'teacher'
from auth.users u
where p.user_id = u.id
  and lower(u.email) in (
    'teacher@writing.test',
    'teacher@speaking.test'
  );

-- 2. profiles security.
alter table public.profiles enable row level security;

drop policy if exists "Users can read own profile"
on public.profiles;

create policy "Users can read own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = user_id);

-- 3. exam_sets: authenticated students may read active exam sets.
alter table public.exam_sets enable row level security;

drop policy if exists "Authenticated users can read active exam sets"
on public.exam_sets;

create policy "Authenticated users can read active exam sets"
on public.exam_sets
for select
to authenticated
using (is_active = true);

-- 4. exam_sessions: a student may create/read/update only their own sessions.
alter table public.exam_sessions enable row level security;

drop policy if exists "Students can create own exam sessions"
on public.exam_sessions;

create policy "Students can create own exam sessions"
on public.exam_sessions
for insert
to authenticated
with check (auth.uid() = student_id);

drop policy if exists "Students can read own exam sessions"
on public.exam_sessions;

create policy "Students can read own exam sessions"
on public.exam_sessions
for select
to authenticated
using (auth.uid() = student_id);

drop policy if exists "Students can update own exam sessions"
on public.exam_sessions;

create policy "Students can update own exam sessions"
on public.exam_sessions
for update
to authenticated
using (auth.uid() = student_id)
with check (auth.uid() = student_id);

-- 5. Create the first exam-set record if it does not already exist.
-- The actual MP3 and image paths will be added in the later media phase.
insert into public.exam_sets (
  code,
  title,
  description,
  duration_seconds,
  timeline,
  is_active
)
values (
  'GEPT-INTERMEDIATE-01',
  '新制中級口說能力測驗 01',
  '第一部分：朗讀短文；第二部分：回答問題；第三部分：看圖敘述。',
  900,
  '{}'::jsonb,
  true
)
on conflict (code) do update
set
  title = excluded.title,
  description = excluded.description,
  is_active = true;
