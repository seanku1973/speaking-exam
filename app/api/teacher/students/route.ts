import { NextRequest, NextResponse } from "next/server";
import {
  TEACHER_COOKIE_NAME,
  verifyTeacherToken,
} from "@/lib/teacherAuth";
import { createTeacherAdminSupabase } from "@/lib/teacherSupabase";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json(
    { ok: false, message: "Unauthorized" },
    { status: 401 }
  );
}

function usernameFromEmail(email?: string | null) {
  if (!email) return "";
  return email.split("@")[0] || "";
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(TEACHER_COOKIE_NAME)?.value;

  if (!verifyTeacherToken(token)) {
    return unauthorized();
  }

  try {
    const supabase = createTeacherAdminSupabase();

    const [
      profilesRes,
      authUsersRes,
      sessionsRes,
      resultsRes,
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("*")
        .eq("role", "student")
        .order("created_at", { ascending: true }),
      supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      }),
      supabase
        .from("exam_sessions")
        .select("id,student_id,created_at,started_at,updated_at,total_score,status")
        .limit(5000),
      supabase
        .from("exam_results")
        .select("session_id,total_score,passed")
        .limit(5000),
    ]);

    const firstError =
      profilesRes.error ||
      authUsersRes.error ||
      sessionsRes.error ||
      resultsRes.error;

    if (firstError) {
      throw new Error(firstError.message);
    }

    const authById = new Map(
      (authUsersRes.data?.users || []).map((user: any) => [
        String(user.id),
        user,
      ])
    );

    const resultsBySession = new Map(
      (resultsRes.data || []).map((result: any) => [
        String(result.session_id),
        result,
      ])
    );

    const students = (profilesRes.data || []).map((profile: any) => {
      const userId = String(profile.user_id || profile.id || "");
      const authUser: any = authById.get(userId) || null;
      const username = usernameFromEmail(authUser?.email);

      const sessions = (sessionsRes.data || []).filter(
        (session: any) => String(session.student_id) === userId
      );

      const scored = sessions
        .map((session: any) => ({
          session,
          result: resultsBySession.get(String(session.id)),
        }))
        .filter(
          ({ result }: any) =>
            result?.total_score !== null &&
            result?.total_score !== undefined
        );

      const average =
        scored.length > 0
          ? scored.reduce(
              (sum: number, item: any) =>
                sum + Number(item.result.total_score),
              0
            ) / scored.length
          : null;

      const passCount = scored.filter(
        ({ result }: any) => Number(result.total_score) >= 80
      ).length;

      const lastExamAt = sessions
        .map(
          (session: any) =>
            session.created_at ||
            session.started_at ||
            session.updated_at ||
            null
        )
        .filter(Boolean)
        .sort(
          (a: string, b: string) =>
            new Date(b).getTime() - new Date(a).getTime()
        )[0] || null;

      return {
        user_id: userId,
        full_name:
          String(profile.full_name || "").trim() ||
          (username
            ? username.charAt(0).toUpperCase() + username.slice(1)
            : userId.slice(0, 8)),
        username,
        email: authUser?.email || "",
        created_at: profile.created_at || authUser?.created_at || null,
        total_sessions: sessions.length,
        scored_sessions: scored.length,
        average_score:
          average === null
            ? null
            : Math.round(average * 10) / 10,
        pass_count: passCount,
        last_exam_at: lastExamAt,
      };
    });

    return NextResponse.json({
      ok: true,
      students,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "無法載入學生資料。",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(TEACHER_COOKIE_NAME)?.value;

  if (!verifyTeacherToken(token)) {
    return unauthorized();
  }

  try {
    const body = await request.json();

    const username = String(body?.username || "")
      .trim()
      .toLowerCase();

    const fullName = String(body?.full_name || "").trim();
    const password = String(body?.password || "");

    if (!/^[a-z0-9._-]{2,30}$/.test(username)) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "學生帳號請使用 2～30 個英文字母、數字、句點、底線或連字號。",
        },
        { status: 400 }
      );
    }

    if (!fullName) {
      return NextResponse.json(
        {
          ok: false,
          message: "請輸入學生姓名。",
        },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        {
          ok: false,
          message: "學生密碼至少需要 6 個字元。",
        },
        { status: 400 }
      );
    }

    const email = `${username}@writing.test`;
    const supabase = createTeacherAdminSupabase();

    const createUser = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        full_name: fullName,
      },
    });

    if (createUser.error || !createUser.data.user) {
      const message =
        createUser.error?.message || "Supabase Auth 建立帳號失敗。";

      if (
        message.toLowerCase().includes("already") ||
        message.toLowerCase().includes("registered")
      ) {
        return NextResponse.json(
          {
            ok: false,
            message: `帳號 ${username} 已經存在。`,
          },
          { status: 409 }
        );
      }

      throw new Error(message);
    }

    const user = createUser.data.user;

    const profile = await supabase
      .from("profiles")
      .upsert(
        {
          user_id: user.id,
          full_name: fullName,
          role: "student",
        },
        {
          onConflict: "user_id",
        }
      )
      .select("*")
      .single();

    if (profile.error) {
      // Roll back the Auth user if profile creation fails.
      await supabase.auth.admin.deleteUser(user.id);
      throw new Error(
        `學生 Auth 已建立，但 profiles 建立失敗：${profile.error.message}`
      );
    }

    return NextResponse.json({
      ok: true,
      student: {
        user_id: user.id,
        full_name: fullName,
        username,
        email,
        created_at: user.created_at || null,
        total_sessions: 0,
        scored_sessions: 0,
        average_score: null,
        pass_count: 0,
        last_exam_at: null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "建立學生帳號失敗。",
      },
      { status: 500 }
    );
  }
}
