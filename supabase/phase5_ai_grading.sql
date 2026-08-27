-- =========================================================
-- SPEAKING EXAM - Phase 5
-- AI transcription + five-category grading + Progress
-- Safe to run more than once.
-- =========================================================

-- 1. Add the five speaking-score columns.
alter table public.exam_results
  add column if not exists content_score numeric(5,2),
  add column if not exists organization_score numeric(5,2),
  add column if not exists grammar_score numeric(5,2),
  add column if not exists vocabulary_score numeric(5,2),
  add column if not exists fluency_score numeric(5,2),
  add column if not exists passed boolean,
  add column if not exists transcription_model text;

-- 2. Protect exam_results with RLS.
alter table public.exam_results enable row level security;

drop policy if exists "Students can read own exam results"
on public.exam_results;

create policy "Students can read own exam results"
on public.exam_results
for select
to authenticated
using (
  exists (
    select 1
    from public.exam_sessions s
    where s.id = exam_results.session_id
      and s.student_id = auth.uid()
  )
);

drop policy if exists "Students can insert own exam results"
on public.exam_results;

create policy "Students can insert own exam results"
on public.exam_results
for insert
to authenticated
with check (
  exists (
    select 1
    from public.exam_sessions s
    where s.id = exam_results.session_id
      and s.student_id = auth.uid()
  )
);

drop policy if exists "Students can update own exam results"
on public.exam_results;

create policy "Students can update own exam results"
on public.exam_results
for update
to authenticated
using (
  exists (
    select 1
    from public.exam_sessions s
    where s.id = exam_results.session_id
      and s.student_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.exam_sessions s
    where s.id = exam_results.session_id
      and s.student_id = auth.uid()
  )
);

-- 3. Helpful index.
create index if not exists exam_results_session_id_idx
  on public.exam_results(session_id);
