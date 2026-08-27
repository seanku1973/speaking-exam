import { NextRequest, NextResponse } from "next/server";
import {
  TEACHER_COOKIE_NAME,
  verifyTeacherToken,
} from "@/lib/teacherAuth";
import { createTeacherAdminSupabase } from "@/lib/teacherSupabase";

export const runtime = "nodejs";

export async function PATCH(
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
    const body = await request.json();
    const changes: Record<string, unknown> = {};

    if (typeof body?.is_active === "boolean") {
      changes.is_active = body.is_active;
    }

    if (typeof body?.title === "string" && body.title.trim()) {
      changes.title = body.title.trim();
    }

    if (typeof body?.description === "string") {
      changes.description = body.description.trim();
    }

    if (
      body?.duration_seconds !== undefined &&
      Number.isFinite(Number(body.duration_seconds))
    ) {
      changes.duration_seconds = Math.round(Number(body.duration_seconds));
    }

    if (Object.keys(changes).length === 0) {
      return NextResponse.json(
        { ok: false, message: "沒有需要更新的資料。" },
        { status: 400 }
      );
    }

    const supabase = createTeacherAdminSupabase();

    const { data, error } = await supabase
      .from("exam_sets")
      .update(changes)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({
      ok: true,
      exam_set: data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "更新題組失敗。",
      },
      { status: 500 }
    );
  }
}
