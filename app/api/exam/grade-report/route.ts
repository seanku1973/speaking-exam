import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Segment } from "@/lib/ai-audio";
import { gradeExamItemLevels, gradeExamReport, rescoreExamFromExistingEvidence } from "@/lib/examCalibratedGrading";

export const runtime = "nodejs";
export const maxDuration = 300;

function fail(message: string, status = 500) {
  return NextResponse.json({ ok: false, message }, { status });
}

function hasMeaningfulItemLevels(json: any) {
  const g = json?.item_level_grades;
  if (!g) return false;
  const levels = [g?.part1?.level, ...(Array.isArray(g?.part2) ? g.part2.map((x:any)=>x?.level) : []), g?.part3?.level]
    .map(Number)
    .filter(Number.isFinite);
  return levels.some((x) => x > 0);
}

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const openai = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_GRADING_MODEL || "gpt-5.6-luna";

  if (!url || !key || !openai) return fail("缺少 Supabase 或 OpenAI 環境變數。");

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail("缺少登入憑證。", 401);

  const body = await request.json().catch(() => ({}));
  const sessionId = String(body?.sessionId || "");
  const force = body?.force === true;
  if (!sessionId) return fail("缺少 sessionId。", 400);

  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: auth } = await supabase.auth.getUser(token);
  if (!auth.user) return fail("登入已失效。", 401);

  const { data: session } = await supabase.from("exam_sessions").select("id,student_id")
    .eq("id", sessionId).eq("student_id", auth.user.id).maybeSingle();
  if (!session) return fail("找不到本次測驗。", 404);

  const { data: result, error: resultError } = await supabase.from("exam_results").select("*")
    .eq("session_id", sessionId).maybeSingle();
  if (resultError || !result) return fail("找不到本次測驗的 AI 資料。", 404);

  const storedTotal = Number(result.total_score ?? 0);
  const inconsistentZero = storedTotal === 0 && hasMeaningfulItemLevels(result.grading_json);
  if (!force && result.report_version === "organized-v6-exam-calibrated" && !inconsistentZero) {
    return NextResponse.json({ ok: true, cached: true, result: { total_score: storedTotal, passed: result.passed ?? false } });
  }

  const blueprint = result.blueprint;
  const transcript = String(result.transcript || "").trim();
  const segments = Array.isArray(result.student_segments) ? (result.student_segments as Segment[]) : [];

  try {
    await supabase.from("exam_sessions").update({ status: "grading", grading_status: force ? "regrading_current_policy" : "step3_q1_q10_grading", updated_at: new Date().toISOString() })
      .eq("id", sessionId).eq("student_id", auth.user.id);

    let graded = await gradeExamReport({ openai, model, blueprint, transcript, segments });
    let itemLevels: any = null;
    try {
      itemLevels = await gradeExamItemLevels({ openai, model, transcript, itemFeedback: graded.report.question_reviews, gradingJson: graded.gradingJson });
    } catch (itemError) {
      console.error("Item-level grading failed:", itemError);
    }

    const meaningfulLevels = itemLevels && [itemLevels.part1, ...(itemLevels.part2 || []), itemLevels.part3].some((x:any)=>Number(x?.level)>0);
    let fallbackScore: Awaited<ReturnType<typeof rescoreExamFromExistingEvidence>> | null = null;

    if (graded.total === 0 && meaningfulLevels) {
      console.warn("Detected inconsistent 0/100 with non-zero item levels; using evidence-based rescore.");
      fallbackScore = await rescoreExamFromExistingEvidence({
        openai,
        model,
        transcript,
        gradingJson: graded.gradingJson,
        itemFeedback: graded.report.question_reviews,
        itemLevelGrades: itemLevels,
      });

      if (fallbackScore.total === 0) {
        throw new Error("100 分制評分與逐題 0～5 級結果仍不一致；系統已阻止寫入異常的 0 分。");
      }
    }

    const previousHistory = Array.isArray(result.grading_json?.regrade_history) ? [...result.grading_json.regrade_history] : [];
    if (force || inconsistentZero) {
      previousHistory.push({ total_score: result.total_score ?? null, content_score: result.content_score ?? null, organization_score: result.organization_score ?? null, grammar_score: result.grammar_score ?? null, vocabulary_score: result.vocabulary_score ?? null, fluency_score: result.fluency_score ?? null, report_version: result.report_version || null, saved_at: new Date().toISOString() });
    }

    const effective = fallbackScore
      ? {
          content: fallbackScore.content,
          organization: fallbackScore.organization,
          grammar: fallbackScore.grammar,
          vocabulary: fallbackScore.vocabulary,
          fluency: fallbackScore.fluency,
          total: fallbackScore.total,
          passed: fallbackScore.passed,
          executiveSummary: fallbackScore.executiveSummary,
          strengths: fallbackScore.strengths,
          priorityImprovements: fallbackScore.priorityImprovements,
          actionPlan: fallbackScore.actionPlan,
        }
      : {
          content: graded.content,
          organization: graded.organization,
          grammar: graded.grammar,
          vocabulary: graded.vocabulary,
          fluency: graded.fluency,
          total: graded.total,
          passed: graded.passed,
          executiveSummary: graded.report.executive_summary,
          strengths: graded.report.strengths,
          priorityImprovements: graded.report.priority_improvements,
          actionPlan: graded.report.action_plan,
        };

    const gradingJson = {
      ...graded.gradingJson,
      ...(fallbackScore
        ? {
            scores: {
              content: { ...(graded.gradingJson?.scores?.content || {}), score: effective.content },
              organization: { ...(graded.gradingJson?.scores?.organization || {}), score: effective.organization },
              grammar: { ...(graded.gradingJson?.scores?.grammar || {}), score: effective.grammar },
              vocabulary: { ...(graded.gradingJson?.scores?.vocabulary || {}), score: effective.vocabulary },
              fluency: { ...(graded.gradingJson?.scores?.fluency || {}), score: effective.fluency },
            },
            executive_summary: effective.executiveSummary,
            strengths: effective.strengths,
            priority_improvements: effective.priorityImprovements,
            action_plan: effective.actionPlan,
            score_repaired_from_item_level_consistency: true,
          }
        : {}),
      ...(itemLevels ? { item_level_grades: itemLevels, item_level_grades_version: "exam-calibrated-phase14b" } : {}),
      regrade_history: previousHistory.slice(-10),
      repaired_inconsistent_zero: inconsistentZero || undefined,
    };

    const { error: saveError } = await supabase.from("exam_results").update({
      content_score: effective.content,
      organization_score: effective.organization,
      grammar_score: effective.grammar,
      vocabulary_score: effective.vocabulary,
      fluency_score: effective.fluency,
      total_score: effective.total,
      passed: effective.passed,
      feedback: effective.executiveSummary,
      strengths: effective.strengths.join("\n"),
      weaknesses: effective.priorityImprovements.join("\n"),
      item_feedback: graded.report.question_reviews,
      grading_json: gradingJson,
      openai_model: model,
      report_version: "organized-v6-exam-calibrated",
      graded_at: new Date().toISOString(),
    }).eq("session_id", sessionId);
    if (saveError) throw new Error(`評分完成但儲存失敗：${saveError.message}`);

    await supabase.from("exam_sessions").update({ status: "completed", grading_status: "completed", total_score: effective.total, updated_at: new Date().toISOString() })
      .eq("id", sessionId).eq("student_id", auth.user.id);

    return NextResponse.json({ ok: true, cached: false, repaired: inconsistentZero, result: { total_score: effective.total, passed: effective.passed } });
  } catch (error) {
    await supabase.from("exam_sessions").update({ status: "completed", grading_status: "grading_failed", updated_at: new Date().toISOString() })
      .eq("id", sessionId).eq("student_id", auth.user.id);
    return fail(error instanceof Error ? error.message : "評分失敗。");
  }
}
