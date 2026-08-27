-- =========================================================
-- SPEAKING EXAM - Phase 4
-- Private exam audio access + recording upload + event logging
-- Safe to run more than once.
-- =========================================================

-- A. EXAM EVENTS
alter table public.exam_events enable row level security;

drop policy if exists "Students can insert own exam events"
on public.exam_events;

create policy "Students can insert own exam events"
on public.exam_events
for insert
to authenticated
with check (
  exists (
    select 1
    from public.exam_sessions s
    where s.id = exam_events.session_id
      and s.student_id = auth.uid()
  )
);

drop policy if exists "Students can read own exam events"
on public.exam_events;

create policy "Students can read own exam events"
on public.exam_events
for select
to authenticated
using (
  exists (
    select 1
    from public.exam_sessions s
    where s.id = exam_events.session_id
      and s.student_id = auth.uid()
  )
);

-- B. PRIVATE EXAM AUDIO
-- A student can read only the audio file attached to one of their exam sessions.
drop policy if exists "Students can read assigned exam audio"
on storage.objects;

create policy "Students can read assigned exam audio"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'exam-audio'
  and exists (
    select 1
    from public.exam_sessions s
    join public.exam_sets e
      on e.id = s.exam_set_id
    where s.student_id = auth.uid()
      and e.audio_path = storage.objects.name
      and s.status in (
        'teacher_verified',
        'ready',
        'recording',
        'audio_finished',
        'uploading',
        'uploaded'
      )
  )
);

-- C. PRIVATE STUDENT RECORDINGS
-- Recording path format:
--   <auth.uid()>/<session-id>.webm

drop policy if exists "Students can upload own exam recordings"
on storage.objects;

create policy "Students can upload own exam recordings"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'exam-recordings'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Students can update own exam recordings"
on storage.objects;

create policy "Students can update own exam recordings"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'exam-recordings'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'exam-recordings'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Students can read own exam recordings"
on storage.objects;

create policy "Students can read own exam recordings"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'exam-recordings'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- D. FIRST EXAM AUDIO PATH
-- Upload the actual MP3 to:
--   Storage > exam-audio > GEPT-INTERMEDIATE-01 > exam.mp3
--
-- Then this record points the exam engine to that private file.
update public.exam_sets
set audio_path = 'GEPT-INTERMEDIATE-01/exam.mp3'
where code = 'GEPT-INTERMEDIATE-01';
