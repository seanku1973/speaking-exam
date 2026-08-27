import { NextRequest, NextResponse } from "next/server";
import {
  TEACHER_COOKIE_NAME,
  verifyTeacherToken,
} from "@/lib/teacherAuth";
import { createTeacherAdminSupabase } from "@/lib/teacherSupabase";

export const runtime = "nodejs";

function pick(obj: any, keys: string[], fallback = "") {
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

function teacherFacingName(profile: any, authUser: any, studentId: string) {
  const rawFullName = pick(
    profile,
    ["full_name", "display_name", "name"],
    ""
  );

  if (rawFullName && !rawFullName.includes("@")) {
    return rawFullName;
  }

  const username =
    pick(profile, ["username"], "") ||
    emailUsername(authUser?.email);

  if (username) {
    return username.charAt(0).toUpperCase() + username.slice(1);
  }

  return studentId.slice(0, 8);
}

export async function GET(
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

  const { id } = await context.params;

  try {
    const supabase = createTeacherAdminSupabase();

    const { data: session, error: sessionError } = await supabase
      .from("exam_sessions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (sessionError || !session) {
      return NextResponse.json(
        { ok: false, message: "找不到這次測驗資料。" },
        { status: 404 }
      );
    }

    const [
      resultRes,
      profileRes,
      examSetRes,
      historySessionsRes,
      authUserRes,
    ] = await Promise.all([
      supabase
        .from("exam_results")
        .select("*")
        .eq("session_id", id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("*")
        .eq("user_id", session.student_id)
        .maybeSingle(),
      supabase
        .from("exam_sets")
        .select("*")
        .eq("id", session.exam_set_id)
        .maybeSingle(),
      supabase
        .from("exam_sessions")
        .select("*")
        .eq("student_id", session.student_id)
        .limit(100),
      supabase.auth.admin.getUserById(session.student_id),
    ]);

    if (resultRes.error) throw new Error(resultRes.error.message);
    if (profileRes.error) throw new Error(profileRes.error.message);
    if (examSetRes.error) throw new Error(examSetRes.error.message);
    if (historySessionsRes.error) {
      throw new Error(historySessionsRes.error.message);
    }
    if (authUserRes.error) {
      throw new Error(authUserRes.error.message);
    }

    let recording_url: string | null = null;

    if (session.recording_path) {
      const signed = await supabase.storage
        .from("exam-recordings")
        .createSignedUrl(session.recording_path, 60 * 60);

      if (!signed.error) {
        recording_url = signed.data?.signedUrl || null;
      }
    }

    const historySessions = historySessionsRes.data || [];
    const historyIds = historySessions.map((s: any) => s.id);

    let historyResults: any[] = [];

    if (historyIds.length > 0) {
      const { data, error } = await supabase
        .from("exam_results")
        .select("*")
        .in("session_id", historyIds);

      if (error) throw new Error(error.message);
      historyResults = data || [];
    }

    const resultsBySession = new Map(
      historyResults.map((r: any) => [String(r.session_id), r])
    );

    const historyExamSetIds = [
      ...new Set(
        historySessions
          .map((s: any) => String(s.exam_set_id || ""))
          .filter(Boolean)
      ),
    ];

    let historyExamSets: any[] = [];

    if (historyExamSetIds.length > 0) {
      const { data, error } = await supabase
        .from("exam_sets")
        .select("*")
        .in("id", historyExamSetIds);

      if (error) throw new Error(error.message);
      historyExamSets = data || [];
    }

    const examSetsById = new Map(
      historyExamSets.map((e: any) => [String(e.id), e])
    );

    const history = historySessions
      .map((s: any) => {
        const r: any = resultsBySession.get(String(s.id));
        const e: any = examSetsById.get(String(s.exam_set_id));

        return {
          session_id: s.id,
          date:
            s.created_at ||
            s.started_at ||
            s.updated_at ||
            null,
          exam_title: pick(e, ["title", "name"], "未命名題組"),
          total_score:
            r?.total_score !== null &&
            r?.total_score !== undefined
              ? Number(r.total_score)
              : s?.total_score !== null &&
                  s?.total_score !== undefined
                ? Number(s.total_score)
                : null,
          status: pick(s, ["status"], "unknown"),
          report_version: pick(r, ["report_version"], ""),
        };
      })
      .filter(
        (x: any) =>
          x.total_score !== null ||
          x.status === "completed"
      )
      .sort((a: any, b: any) => {
        const at = a.date ? new Date(a.date).getTime() : 0;
        const bt = b.date ? new Date(b.date).getTime() : 0;
        return bt - at;
      });

    const profile = profileRes.data || {};
    const examSet = examSetRes.data || {};
    const authUser = authUserRes.data?.user || null;

    const username =
      pick(profile, ["username"], "") ||
      emailUsername(authUser?.email);

    const studentName = teacherFacingName(
      profile,
      authUser,
      String(session.student_id)
    );

    return NextResponse.json({
      ok: true,
      detail: {
        session,
        result: resultRes.data || null,
        student: {
          id: session.student_id,
          name: studentName,
          username,
          profile,
        },
        exam_set: examSet,
        recording_url,
        history,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Teacher detail failed.",
      },
      { status: 500 }
    );
  }
}
