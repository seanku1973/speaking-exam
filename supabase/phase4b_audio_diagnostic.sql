-- =========================================================
-- SPEAKING EXAM - Phase 4B
-- Diagnose and auto-fix the first exam audio path
-- =========================================================
--
-- This script:
-- 1. Shows the current exam_sets.audio_path
-- 2. Shows the actual files inside the private exam-audio bucket
-- 3. If there is exactly one MP3 file in exam-audio, it automatically
--    assigns that file to GEPT-INTERMEDIATE-01.
--
-- Safe to run more than once.
-- =========================================================

-- Diagnostic result #1: current configured path.
select
  code,
  title,
  audio_path
from public.exam_sets
where code = 'GEPT-INTERMEDIATE-01';

-- Diagnostic result #2: actual files currently stored in exam-audio.
select
  name,
  metadata,
  created_at
from storage.objects
where bucket_id = 'exam-audio'
order by created_at desc;

-- Auto-fix:
-- If there is exactly one file in exam-audio, use that exact Storage path.
do $$
declare
  v_count integer;
  v_name text;
begin
  select count(*), min(name)
  into v_count, v_name
  from storage.objects
  where bucket_id = 'exam-audio'
    and lower(name) ~ '\.(mp3|wav|m4a|ogg|webm)$';

  if v_count = 1 then
    update public.exam_sets
    set audio_path = v_name
    where code = 'GEPT-INTERMEDIATE-01';

    raise notice 'Audio path automatically updated to: %', v_name;
  elsif v_count = 0 then
    raise exception 'No audio file found in exam-audio bucket.';
  else
    raise exception 'More than one audio file exists in exam-audio. Please keep only the intended exam file or set audio_path manually.';
  end if;
end $$;

-- Final verification:
select
  e.code,
  e.audio_path,
  o.name as storage_file,
  case
    when o.name is not null then 'MATCH ✓'
    else 'NO MATCH ✗'
  end as result
from public.exam_sets e
left join storage.objects o
  on o.bucket_id = 'exam-audio'
 and o.name = e.audio_path
where e.code = 'GEPT-INTERMEDIATE-01';
