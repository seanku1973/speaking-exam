-- =========================================================
-- SPEAKING EXAM - Phase 5C
-- Organized report + guaranteed Q1-Q10 detailed review
-- =========================================================

alter table public.exam_results
  add column if not exists item_feedback jsonb not null default '[]'::jsonb,
  add column if not exists report_version text;

alter table public.exam_sets
  add column if not exists grading_context jsonb not null default '{}'::jsonb;

-- Remove any previously generated blueprint/timeline.
-- The next evaluation will rebuild it as blueprint-v4.
update public.exam_sets
set grading_context = '{}'::jsonb
where code = 'GEPT-INTERMEDIATE-01';

-- Mark old reports as old so /exam/submitted must rebuild them.
update public.exam_results
set report_version = null
where report_version is distinct from 'organized-v4';
