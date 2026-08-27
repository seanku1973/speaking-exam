-- SPEAKING EXAM - Phase 5B2
-- Correct report structure:
-- Reading = 1 integrated item
-- Q1-Q10 = 10 separate items
-- Picture description = 1 integrated item

alter table public.exam_results
  add column if not exists item_feedback jsonb not null default '[]'::jsonb,
  add column if not exists report_version text;

alter table public.exam_sets
  add column if not exists grading_context jsonb not null default '{}'::jsonb;

-- Important: remove any cached old timeline so the next run rebuilds it as v3.
update public.exam_sets
set grading_context = '{}'::jsonb
where code = 'GEPT-INTERMEDIATE-01';
