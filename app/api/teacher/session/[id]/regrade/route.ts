import { NextRequest, NextResponse } from "next/server";
import { TEACHER_COOKIE_NAME, verifyTeacherToken } from "@/lib/teacherAuth";
import { createTeacherAdminSupabase } from "@/lib/teacherSupabase";
import { gradeExamItemLevels } from "@/lib/examCalibratedGrading";
import { normalizeItemLevelGrades } from "@/lib/itemLevelGrades";
import {
  calculateWeightedExamScore,
  weightedScoreJson,
} from "@/lib/examWeightedScore";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get(TEACHER_COOKIE_NAME)?.value;

  if (!verifyTeacherToken(token)) {
    return NextResponse.json(
      { ok: false, message: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const { id: sessionId } = await context.params;
    const supabase = createTeacherAdminSupabase();
    const openai = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_GRADING_MODEL || "gpt-5.6-luna";

    const { data: result, error } = await supabase
      .from("exam_results")
      .select("*")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (error) throw new Error(`讀取測驗結果失敗：${error.message}`);
    if (!result) {
      return NextResponse.json(
        { ok: false, message: "找不到這次測驗的 AI 報告。" },
        { status: 404 }
      );
    }

    const existingJson =
      result.grading_json && typeof result.grading_json === "object"
        ? result.grading_json
        : {};

    let itemLevels = normalizeItemLevelGrades(existingJson?.item_level_grades);
    let itemLevelsGenerated = false;

    if (!itemLevels) {
      if (!openai) {
        throw new Error(
          "此舊紀錄沒有完整逐題 0～5 級，且伺服器未設定 OPENAI_API_KEY。"
        );
      }

      const transcript = String(result.transcript || "").trim();
      if (!transcript) {
        throw new Error(
          "此舊紀錄沒有完整逐題 0～5 級，也沒有 Transcript，無法補評。"
        );
      }

      itemLevels = await gradeExamItemLevels({
        openai,
        model,
        transcript,
        itemFeedback: result.item_feedback,
        gradingJson: existingJson,
      });
      itemLevelsGenerated = true;
    }

    const weighted = calculateWeightedExamScore(itemLevels);
    if (!weighted) {
      throw new Error("逐題 0～5 級資料不完整，無法計算加權總分。");
    }

    const history = Array.isArray(existingJson?.regrade_history)
      ? [...existingJson.regrade_history]
      : [];

    history.push({
      total_score: result.total_score ?? null,
      report_version: result.report_version || null,
      saved_at: new Date().toISOString(),
    });

    const updatedReportJson = {
      ...existingJson,
      report_version: "organized-v7-weighted-item-level",
      grading_policy_version: "weighted-item-level-phase15",
      item_level_grades: itemLevels,
      item_level_grades_version: itemLevelsGenerated
        ? "weighted-item-level-phase15-generated"
        : existingJson?.item_level_grades_version || "preserved-existing",
      weighted_score: weightedScoreJson(weighted),
      five_category_scores_used_for_total: false,
      regrade_history: history.slice(-10),
      last_regraded_at: new Date().toISOString(),
      regrade_source: "teacher_item_level_weighting",
    };

    const { error: saveError } = await supabase
      .from("exam_results")
      .update({
        total_score: weighted.total,
        passed: weighted.passed,
        grading_json: updatedReportJson,
        report_version: "organized-v7-weighted-item-level",
        graded_at: new Date().toISOString(),
      })
      .eq("session_id", sessionId);

    if (saveError) {
      throw new Error(`重新計分完成但儲存失敗：${saveError.message}`);
    }

    await supabase
      .from("exam_sessions")
      .update({
        status: "completed",
        grading_status: "completed",
        total_score: weighted.total,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    return NextResponse.json({
      ok: true,
      previous_score: result.total_score ?? null,
      total_score: weighted.total,
      passed: weighted.passed,
      item_levels_preserved: !itemLevelsGenerated,
      item_levels_generated: itemLevelsGenerated,
      weighted_score: weightedScoreJson(weighted),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "老師重新計分失敗。",
      },
      { status: 500 }
    );
  }
}
