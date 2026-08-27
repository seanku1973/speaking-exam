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

export async function GET(request: NextRequest) {
  const token = request.cookies.get(TEACHER_COOKIE_NAME)?.value;
  if (!verifyTeacherToken(token)) return unauthorized();

  try {
    const supabase = createTeacherAdminSupabase();

    const [examSetsRes, sessionsRes, resultsRes] = await Promise.all([
      supabase
        .from("exam_sets")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("exam_sessions")
        .select("id,exam_set_id"),
      supabase
        .from("exam_results")
        .select("session_id"),
    ]);

    const firstError =
      examSetsRes.error || sessionsRes.error || resultsRes.error;

    if (firstError) throw new Error(firstError.message);

    const sessions = sessionsRes.data || [];
    const results = resultsRes.data || [];
    const resultSessionIds = new Set(
      results.map((x: any) => String(x.session_id))
    );

    const examSets = await Promise.all(
      (examSetsRes.data || []).map(async (exam: any) => {
        const examSessions = sessions.filter(
          (session: any) =>
            String(session.exam_set_id) === String(exam.id)
        );

        const gradedCount = examSessions.filter((session: any) =>
          resultSessionIds.has(String(session.id))
        ).length;

        let audio_url: string | null = null;
        let image_url: string | null = null;

        if (exam.audio_path) {
          const signed = await supabase.storage
            .from("exam-audio")
            .createSignedUrl(exam.audio_path, 60 * 60);

          if (!signed.error) {
            audio_url = signed.data?.signedUrl || null;
          }
        }

        if (exam.image_path) {
          const signed = await supabase.storage
            .from("exam-images")
            .createSignedUrl(exam.image_path, 60 * 60);

          if (!signed.error) {
            image_url = signed.data?.signedUrl || null;
          }
        }

        return {
          ...exam,
          audio_url,
          image_url,
          session_count: examSessions.length,
          graded_count: gradedCount,
        };
      })
    );

    return NextResponse.json({
      ok: true,
      exam_sets: examSets,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "無法載入題組資料。",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(TEACHER_COOKIE_NAME)?.value;
  if (!verifyTeacherToken(token)) return unauthorized();

  try {
    const body = await request.json();

    const code = String(body?.code || "").trim();
    const title = String(body?.title || "").trim();
    const description = String(body?.description || "").trim();
    const duration = Number(body?.duration_seconds || 900);

    if (!code) {
      return NextResponse.json(
        { ok: false, message: "請輸入題組代碼。" },
        { status: 400 }
      );
    }

    if (!title) {
      return NextResponse.json(
        { ok: false, message: "請輸入題組名稱。" },
        { status: 400 }
      );
    }

    if (!Number.isFinite(duration) || duration < 60 || duration > 3600) {
      return NextResponse.json(
        {
          ok: false,
          message: "測驗時間請設定在 60～3600 秒之間。",
        },
        { status: 400 }
      );
    }

    const supabase = createTeacherAdminSupabase();

    const { data, error } = await supabase
      .from("exam_sets")
      .insert({
        code,
        title,
        description,
        duration_seconds: Math.round(duration),
        is_active: body?.is_active !== false,
        timeline: {},
        grading_context: {},
      })
      .select("*")
      .single();

    if (error) {
      if (
        error.code === "23505" ||
        error.message.toLowerCase().includes("duplicate")
      ) {
        return NextResponse.json(
          {
            ok: false,
            message: "這個題組代碼已經存在，請使用不同的代碼。",
          },
          { status: 409 }
        );
      }

      throw new Error(error.message);
    }

    return NextResponse.json({
      ok: true,
      exam_set: {
        ...data,
        audio_url: null,
        image_url: null,
        session_count: 0,
        graded_count: 0,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "建立題組失敗。",
      },
      { status: 500 }
    );
  }
}
