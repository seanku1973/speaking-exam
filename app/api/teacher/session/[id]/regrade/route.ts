import { NextRequest, NextResponse } from "next/server";
import { TEACHER_COOKIE_NAME, verifyTeacherToken } from "@/lib/teacherAuth";
import { createTeacherAdminSupabase } from "@/lib/teacherSupabase";
import type { Segment } from "@/lib/ai-audio";
import {
  gradeExamReport,
  rescoreExamFromExistingEvidence,
} from "@/lib/examCalibratedGrading";
import { normalizeItemLevelGrades } from "@/lib/itemLevelGrades";

export const runtime = "nodejs";
export const maxDuration = 300;

function hasMeaningfulItemLevels(bundle: any) {
  const g = normalizeItemLevelGrades(bundle);
  if (!g) return false;
  return [g.part1, ...g.part2, g.part3].some(
    (item: any) => Number(item?.level) > 0
  );
}

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

    if (!openai) throw new Error("伺服器未設定 OPENAI_API_KEY。");

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

    const transcript = String(result.transcript || "").trim();
    if (!transcript) {
      return NextResponse.json(
        { ok: false, message: "這筆測驗沒有 Transcript，無法重新評分。" },
        { status: 400 }
      );
    }

    const existingJson =
      result.grading_json && typeof result.grading_json === "object"
        ? result.grading_json
        : {};

    // Critical Phase 14C rule: NEVER discard the previously stored 0-5 grades.
    const existingItemLevels = normalizeItemLevelGrades(
      existingJson?.item_level_grades
    );

    const segments = Array.isArray(result.student_segments)
      ? (result.student_segments as Segment[])
      : [];

    let fullGrade: Awaited<ReturnType<typeof gradeExamReport>> | null = null;
    let fullGradeError = "";

    // Prefer the full timeline-aware grader when the old record contains the data.
    if (
      result.blueprint?.questions &&
      Array.isArray(result.blueprint.questions) &&
      result.blueprint.questions.length === 10 &&
      segments.length > 0
    ) {
      try {
        fullGrade = await gradeExamReport({
          openai,
          model,
          blueprint: result.blueprint,
          transcript,
          segments,
        });
      } catch (err) {
        fullGradeError = err instanceof Error ? err.message : "完整重新評分失敗";
        console.error("Full teacher regrade failed; using evidence fallback:", err);
      }
    }

    // If full scoring is unavailable, failed, or contradicts meaningful old item grades,
    // rescore from the already stored transcript/report. This also supports older records
    // that did not save student_segments.
    const mustFallback =
      !fullGrade ||
      (fullGrade.total === 0 && hasMeaningfulItemLevels(existingItemLevels));

    let score: {
      content: number;
      organization: number;
      grammar: number;
      vocabulary: number;
      fluency: number;
      total: number;
      passed: boolean;
      executiveSummary: string;
      strengths: string[];
      priorityImprovements: string[];
      actionPlan: string[];
    };

    let updatedReportJson: any = { ...existingJson };
    let scoringMode = "existing-evidence";

    if (mustFallback) {
      score = await rescoreExamFromExistingEvidence({
        openai,
        model,
        transcript,
        gradingJson: existingJson,
        itemFeedback: result.item_feedback,
        itemLevelGrades: existingItemLevels,
      });

      // Safety retry: a nonzero old item profile must not become an unexplained 0/100.
      if (score.total === 0 && hasMeaningfulItemLevels(existingItemLevels)) {
        score = await rescoreExamFromExistingEvidence({
          openai,
          model,
          transcript,
          gradingJson: existingJson,
          itemFeedback: result.item_feedback,
          itemLevelGrades: existingItemLevels,
        });
      }

      if (score.total === 0 && hasMeaningfulItemLevels(existingItemLevels)) {
        throw new Error(
          "重新評分仍回傳與既有逐題 0～5 級矛盾的 0 分，因此系統沒有覆寫原資料。"
        );
      }

      updatedReportJson = {
        ...existingJson,
        report_version: "organized-v6-exam-calibrated",
        grading_policy_version: "exam-calibrated-phase14c",
        executive_summary: score.executiveSummary,
        scores: {
          content: { score: score.content, feedback: existingJson?.scores?.content?.feedback || "" },
          organization: { score: score.organization, feedback: existingJson?.scores?.organization?.feedback || "" },
          grammar: { score: score.grammar, feedback: existingJson?.scores?.grammar?.feedback || "" },
          vocabulary: { score: score.vocabulary, feedback: existingJson?.scores?.vocabulary?.feedback || "" },
          fluency: { score: score.fluency, feedback: existingJson?.scores?.fluency?.feedback || "" },
        },
        strengths: score.strengths,
        priority_improvements: score.priorityImprovements,
        action_plan: score.actionPlan,
      };
    } else {
      scoringMode = "timeline-aware";
      score = {
        content: fullGrade!.content,
        organization: fullGrade!.organization,
        grammar: fullGrade!.grammar,
        vocabulary: fullGrade!.vocabulary,
        fluency: fullGrade!.fluency,
        total: fullGrade!.total,
        passed: fullGrade!.passed,
        executiveSummary: fullGrade!.report.executive_summary,
        strengths: fullGrade!.report.strengths,
        priorityImprovements: fullGrade!.report.priority_improvements,
        actionPlan: fullGrade!.report.action_plan,
      };
      updatedReportJson = {
        ...existingJson,
        ...fullGrade!.gradingJson,
      };
    }

    // Restore/preserve the exact old item-level bundle after every merge.
    if (existingItemLevels) {
      updatedReportJson.item_level_grades = existingItemLevels;
      updatedReportJson.item_level_grades_version =
        existingJson?.item_level_grades_version || "preserved-phase14c";
    }

    const history = Array.isArray(existingJson?.regrade_history)
      ? [...existingJson.regrade_history]
      : [];

    history.push({
      total_score: result.total_score ?? null,
      content_score: result.content_score ?? null,
      organization_score: result.organization_score ?? null,
      grammar_score: result.grammar_score ?? null,
      vocabulary_score: result.vocabulary_score ?? null,
      fluency_score: result.fluency_score ?? null,
      report_version: result.report_version || null,
      saved_at: new Date().toISOString(),
    });

    updatedReportJson = {
      ...updatedReportJson,
      regrade_history: history.slice(-10),
      last_regraded_at: new Date().toISOString(),
      regrade_source: "teacher_existing_record",
      regrade_mode: scoringMode,
      full_grade_error: fullGradeError || undefined,
    };

    const { error: saveError } = await supabase
      .from("exam_results")
      .update({
        content_score: score.content,
        organization_score: score.organization,
        grammar_score: score.grammar,
        vocabulary_score: score.vocabulary,
        fluency_score: score.fluency,
        total_score: score.total,
        passed: score.passed,
        feedback: score.executiveSummary,
        strengths: score.strengths.join("\n"),
        weaknesses: score.priorityImprovements.join("\n"),
        // Keep existing Q1-Q10 item_feedback when fallback was used.
        item_feedback:
          scoringMode === "timeline-aware"
            ? fullGrade!.report.question_reviews
            : result.item_feedback,
        grading_json: updatedReportJson,
        openai_model: model,
        report_version: "organized-v6-exam-calibrated",
        graded_at: new Date().toISOString(),
      })
      .eq("session_id", sessionId);

    if (saveError) {
      throw new Error(`重新評分完成但儲存失敗：${saveError.message}`);
    }

    await supabase
      .from("exam_sessions")
      .update({
        status: "completed",
        grading_status: "completed",
        total_score: score.total,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    return NextResponse.json({
      ok: true,
      previous_score: result.total_score ?? null,
      total_score: score.total,
      passed: score.passed,
      item_levels_preserved: Boolean(existingItemLevels),
      scoring_mode: scoringMode,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "老師重新評分失敗。",
      },
      { status: 500 }
    );
  }
}
