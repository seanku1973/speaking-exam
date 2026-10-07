import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Segment } from "@/lib/ai-audio";
import { gradeExamItemLevels, gradeExamReport } from "@/lib/examCalibratedGrading";
import {
  calculateWeightedExamScore,
  weightedScoreJson,
} from "@/lib/examWeightedScore";

export const runtime = "nodejs";
export const maxDuration = 300;

function fail(message: string, status = 500) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const openai = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_GRADING_MODEL || "gpt-5.6-luna";

  if (!url || !key || !openai) {
    return fail("缺少 Supabase 或 OpenAI 環境變數。");
  }

  const token = (request.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
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

  const { data: session } = await supabase
    .from("exam_sessions")
    .select("id,student_id")
    .eq("id", sessionId)
    .eq("student_id", auth.user.id)
    .maybeSingle();

  if (!session) return fail("找不到本次測驗。", 404);

  const { data: result, error: resultError } = await supabase
    .from("exam_results")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (resultError || !result) {
    return fail("找不到本次測驗的 AI 資料。", 404);
  }

  const storedWeighted = calculateWeightedExamScore(
    result.grading_json?.item_level_grades
  );

  if (
    !force &&
    result.report_version === "organized-v7-weighted-item-level" &&
    storedWeighted &&
    Number(result.total_score) === storedWeighted.total
  ) {
    return NextResponse.json({
      ok: true,
      cached: true,
      result: {
        total_score: storedWeighted.total,
        passed: storedWeighted.passed,
      },
    });
  }

  const blueprint = result.blueprint;
  const transcript = String(result.transcript || "").trim();
  const segments = Array.isArray(result.student_segments)
    ? (result.student_segments as Segment[])
    : [];

  try {
    await supabase
      .from("exam_sessions")
      .update({
        status: "grading",
        grading_status: force
          ? "regrading_weighted_policy"
          : "step3_q1_q10_grading",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("student_id", auth.user.id);

    const graded = await gradeExamReport({
      openai,
      model,
      blueprint,
      transcript,
      segments,
    });

    const itemLevels = await gradeExamItemLevels({
      openai,
      model,
      transcript,
      itemFeedback: graded.report.question_reviews,
      gradingJson: graded.gradingJson,
    });

    const weighted = calculateWeightedExamScore(itemLevels);
    if (!weighted) {
      throw new Error("逐題 0～5 級資料不完整，無法計算正式總分。");
    }

    const existingHistory = Array.isArray(result.grading_json?.regrade_history)
      ? [...result.grading_json.regrade_history]
      : [];

    if (force || result.total_score !== null) {
      existingHistory.push({
        total_score: result.total_score ?? null,
        report_version: result.report_version || null,
        saved_at: new Date().toISOString(),
      });
    }

    const gradingJson = {
      ...graded.gradingJson,
      report_version: "organized-v7-weighted-item-level",
      grading_policy_version: "weighted-item-level-phase15",
      item_level_grades: itemLevels,
      item_level_grades_version: "weighted-item-level-phase15",
      weighted_score: weightedScoreJson(weighted),
      five_category_scores_used_for_total: false,
      regrade_history: existingHistory.slice(-10),
    };

    const { error: saveError } = await supabase
      .from("exam_results")
      .update({
        total_score: weighted.total,
        passed: weighted.passed,
        feedback: graded.report.executive_summary,
        strengths: graded.report.strengths.join("\n"),
        weaknesses: graded.report.priority_improvements.join("\n"),
        item_feedback: graded.report.question_reviews,
        grading_json: gradingJson,
        openai_model: model,
        report_version: "organized-v7-weighted-item-level",
        graded_at: new Date().toISOString(),
      })
      .eq("session_id", sessionId);

    if (saveError) {
      throw new Error(`評分完成但儲存失敗：${saveError.message}`);
    }

    await supabase
      .from("exam_sessions")
      .update({
        status: "completed",
        grading_status: "completed",
        total_score: weighted.total,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("student_id", auth.user.id);

    return NextResponse.json({
      ok: true,
      cached: false,
      result: {
        total_score: weighted.total,
        passed: weighted.passed,
        weighted_score: weightedScoreJson(weighted),
      },
    });
  } catch (error) {
    await supabase
      .from("exam_sessions")
      .update({
        status: "completed",
        grading_status: "grading_failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("student_id", auth.user.id);

    return fail(error instanceof Error ? error.message : "評分失敗。");
  }
}
