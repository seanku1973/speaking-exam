
alter table public.exam_results
  add column if not exists blueprint jsonb,
  add column if not exists student_segments jsonb,
  add column if not exists item_feedback jsonb not null default '[]'::jsonb,
  add column if not exists report_version text;

update public.exam_results
set report_version = null
where report_version is distinct from 'organized-v5';
