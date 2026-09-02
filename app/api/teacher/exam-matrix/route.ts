import { NextRequest, NextResponse } from "next/server";
import {
  TEACHER_COOKIE_NAME,
  verifyTeacherToken,
} from "@/lib/teacherAuth";
import { createTeacherAdminSupabase } from "@/lib/teacherSupabase";
import { normalizeItemLevelGrades } from "@/lib/itemLevelGrades";

export const runtime = "nodejs";

function pick(obj: any, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

function emailUsername(email?: string | null) {
  if (!email) return "";
  return String(email).split("@")[0] || "";
}

function displayName(profile: any, authUser: any, studentId: string) {
  const fullName = pick(profile, ["full_name", "display_name", "name"], "");
  if (fullName && !fullName.includes("@")) return fullName;

  const username =
    pick(profile, ["username"], "") || emailUsername(authUser?.email);

  if (username) return username;
  return studentId.slice(0, 8);
}

function sessionDate(session: any) {
  return (
    session?.created_at ||
    session?.started_at ||
    session?.audio_started_at ||
    session?.updated_at ||
    null
  );
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(TEACHER_COOKIE_NAME)?.value;

  if (!verifyTeacherToken(token)) {
    return NextResponse.json(
      { ok: false, message: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const supabase = createTeacherAdminSupabase();
    const requestedExamSetId = new URL(request.url).searchParams.get(
      "exam_set_id"
    );

    const [examSetsRes, profilesRes, authUsersRes] = await Promise.all([
      supabase.from("exam_sets").select("*").limit(500),
      supabase.from("profiles").select("*").eq("role", "student").limit(2000),
      supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    const firstError =
      examSetsRes.error || profilesRes.error || authUsersRes.error;

    if (firstError) throw new Error(firstError.message);

    const examSets = [...(examSetsRes.data || [])]
      .map((exam: any) => ({
        id: String(exam.id),
        code: pick(exam, ["code"], ""),
        title: pick(exam, ["title", "name"], "未命名題組"),
        is_active: Boolean(exam.is_active),
      }))
      .sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return a.title.localeCompare(b.title, "zh-TW");
      });

    const selectedExamSet =
      examSets.find((exam) => exam.id === requestedExamSetId) ||
      examSets[0] ||
      null;

    if (!selectedExamSet) {
      return NextResponse.json({
        ok: true,
        exam_sets: [],
        selected_exam_set_id: null,
        selected_exam_set: null,
        rows: [],
      });
    }

    const sessionsRes = await supabase
      .from("exam_sessions")
      .select("*")
      .eq("exam_set_id", selectedExamSet.id)
      .limit(5000);

    if (sessionsRes.error) throw new Error(sessionsRes.error.message);

    const sessions = sessionsRes.data || [];
    const sessionIds = sessions.map((session: any) => String(session.id));

    let results: any[] = [];
    if (sessionIds.length > 0) {
      const resultsRes = await supabase
        .from("exam_results")
        .select("*")
        .in("session_id", sessionIds);

      if (resultsRes.error) throw new Error(resultsRes.error.message);
      results = resultsRes.data || [];
    }

    const resultsBySession = new Map(
      results.map((result: any) => [String(result.session_id), result])
    );

    const authUsersById = new Map(
      (authUsersRes.data?.users || []).map((user: any) => [String(user.id), user])
    );

    const sessionsByStudent = new Map<string, any[]>();
    for (const session of sessions) {
      const studentId = String(session.student_id || "");
      if (!studentId) continue;
      const list = sessionsByStudent.get(studentId) || [];
      list.push(session);
      sessionsByStudent.set(studentId, list);
    }

    for (const list of sessionsByStudent.values()) {
      list.sort((a: any, b: any) => {
        const at = sessionDate(a) ? new Date(sessionDate(a)).getTime() : 0;
        const bt = sessionDate(b) ? new Date(sessionDate(b)).getTime() : 0;
        return bt - at;
      });
    }

    const rows = (profilesRes.data || [])
      .map((profile: any) => {
        const studentId = String(profile.user_id || profile.id || "");
        const authUser: any = authUsersById.get(studentId) || null;
        const allAttempts = sessionsByStudent.get(studentId) || [];

        const latestScored = allAttempts.find((session: any) => {
          const result: any = resultsBySession.get(String(session.id));
          return result?.total_score !== null && result?.total_score !== undefined;
        });

        const chosenSession = latestScored || allAttempts[0] || null;
        const result: any = chosenSession
          ? resultsBySession.get(String(chosenSession.id)) || null
          : null;

        const grades = normalizeItemLevelGrades(
          result?.grading_json?.item_level_grades
        );

        const part2 = Array.from({ length: 10 }, (_, index) => {
          const item = grades?.part2?.find(
            (entry: any) =>
              String(entry?.key || "").toLowerCase() === `q${index + 1}`
          ) ?? grades?.part2?.[index];
          return item?.level ?? null;
        });

        const totalScore =
          result?.total_score !== null && result?.total_score !== undefined
            ? Number(result.total_score)
            : chosenSession?.total_score !== null &&
                chosenSession?.total_score !== undefined
              ? Number(chosenSession.total_score)
              : null;

        let statusText = "未測驗";
        if (chosenSession && totalScore === null) statusText = "未完成 / 未評分";
        if (totalScore !== null && !grades) statusText = "待補逐題";
        if (grades) statusText = "已完成";

        return {
          student_id: studentId,
          student_name: displayName(profile, authUser, studentId),
          student_username:
            pick(profile, ["username"], "") || emailUsername(authUser?.email),
          session_id: chosenSession?.id || null,
          date: chosenSession ? sessionDate(chosenSession) : null,
          total_score: totalScore,
          part1: grades?.part1?.level ?? null,
          part2,
          part3: grades?.part3?.level ?? null,
          has_item_grades: Boolean(grades),
          status_text: statusText,
          attempts: allAttempts.length,
        };
      })
      .sort((a: any, b: any) =>
        String(a.student_name).localeCompare(String(b.student_name), "zh-TW")
      );

    return NextResponse.json({
      ok: true,
      exam_sets: examSets,
      selected_exam_set_id: selectedExamSet.id,
      selected_exam_set: selectedExamSet,
      rows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Teacher exam matrix failed.",
      },
      { status: 500 }
    );
  }
}
