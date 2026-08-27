import { NextRequest, NextResponse } from "next/server";
import {
  TEACHER_COOKIE_NAME,
  verifyTeacherToken,
} from "@/lib/teacherAuth";
import { createTeacherAdminSupabase } from "@/lib/teacherSupabase";

export const runtime = "nodejs";

function value(obj: any, keys: string[], fallback = "") {
  for (const key of keys) {
    const v = obj?.[key];
    if (v !== null && v !== undefined && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return fallback;
}

function emailUsername(email?: string | null) {
  if (!email) return "";
  return String(email).split("@")[0] || "";
}

function displayName(profile: any, authUser: any, studentId: string) {
  const rawFullName = value(
    profile,
    ["full_name", "display_name", "name"],
    ""
  );

  // Avoid showing a synthetic auth email such as peter@writing.test
  // as the teacher-facing student name.
  if (rawFullName && !rawFullName.includes("@")) {
    return rawFullName;
  }

  const username =
    value(profile, ["username"], "") ||
    emailUsername(authUser?.email);

  if (username) {
    return username.charAt(0).toUpperCase() + username.slice(1);
  }

  return studentId.slice(0, 8);
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

    const [
      sessionsRes,
      resultsRes,
      profilesRes,
      examSetsRes,
      authUsersRes,
    ] = await Promise.all([
      supabase.from("exam_sessions").select("*").limit(1000),
      supabase.from("exam_results").select("*").limit(1000),
      supabase.from("profiles").select("*").limit(1000),
      supabase.from("exam_sets").select("*").limit(1000),
      supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    const firstError =
      sessionsRes.error ||
      resultsRes.error ||
      profilesRes.error ||
      examSetsRes.error ||
      authUsersRes.error;

    if (firstError) {
      throw new Error(firstError.message);
    }

    const resultsBySession = new Map(
      (resultsRes.data || []).map((r: any) => [String(r.session_id), r])
    );

    const profilesByUserId = new Map(
      (profilesRes.data || []).map((p: any) => [
        String(p.user_id || p.id || ""),
        p,
      ])
    );

    const examSetsById = new Map(
      (examSetsRes.data || []).map((e: any) => [String(e.id), e])
    );

    const authUsersById = new Map(
      (authUsersRes.data?.users || []).map((u: any) => [String(u.id), u])
    );

    const rows = (sessionsRes.data || [])
      .map((session: any) => {
        const studentId = String(session.student_id || "");
        const result: any =
          resultsBySession.get(String(session.id)) || null;
        const profile: any =
          profilesByUserId.get(studentId) || null;
        const authUser: any =
          authUsersById.get(studentId) || null;
        const examSet: any =
          examSetsById.get(String(session.exam_set_id)) || null;

        const date =
          session.created_at ||
          session.started_at ||
          session.audio_started_at ||
          session.updated_at ||
          null;

        const username =
          value(profile, ["username"], "") ||
          emailUsername(authUser?.email);

        return {
          session_id: session.id,
          student_id: session.student_id,
          student_name: displayName(profile, authUser, studentId || "student"),
          student_username: username,
          exam_set_id: session.exam_set_id,
          exam_code: value(examSet, ["code"], ""),
          exam_title: value(examSet, ["title", "name"], "未命名題組"),
          date,
          status: value(session, ["status"], "unknown"),
          grading_status: value(session, ["grading_status"], ""),
          recording_path: value(session, ["recording_path"], ""),
          upload_status: value(session, ["upload_status"], ""),
          total_score:
            result?.total_score !== null &&
            result?.total_score !== undefined
              ? Number(result.total_score)
              : session?.total_score !== null &&
                  session?.total_score !== undefined
                ? Number(session.total_score)
                : null,
          passed:
            result?.passed !== null &&
            result?.passed !== undefined
              ? Boolean(result.passed)
              : null,
          report_version: value(result, ["report_version"], ""),
          graded_at: result?.graded_at || null,
        };
      })
      .sort((a: any, b: any) => {
        const at = a.date ? new Date(a.date).getTime() : 0;
        const bt = b.date ? new Date(b.date).getTime() : 0;
        return bt - at;
      });

    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Teacher dashboard failed.",
      },
      { status: 500 }
    );
  }
}
