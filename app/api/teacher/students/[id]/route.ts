import { NextRequest, NextResponse } from "next/server";
import {
  TEACHER_COOKIE_NAME,
  verifyTeacherToken,
} from "@/lib/teacherAuth";
import { createTeacherAdminSupabase } from "@/lib/teacherSupabase";

export const runtime = "nodejs";

async function listStudentRecordingObjects(
  supabase: ReturnType<typeof createTeacherAdminSupabase>,
  userId: string
) {
  const paths: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage
      .from("exam-recordings")
      .list(userId, { limit: 100, offset });

    if (error) {
      throw new Error(`讀取學生 Storage 失敗：${error.message}`);
    }

    const rows = data || [];
    for (const row of rows) {
      if (row.name) paths.push(`${userId}/${row.name}`);
    }

    if (rows.length < 100) break;
    offset += 100;
  }

  return paths;
}

async function removeRecordingPaths(
  supabase: ReturnType<typeof createTeacherAdminSupabase>,
  paths: string[]
) {
  const unique = [...new Set(paths.filter(Boolean))];

  for (let i = 0; i < unique.length; i += 100) {
    const { error } = await supabase.storage
      .from("exam-recordings")
      .remove(unique.slice(i, i + 100));

    if (error) throw new Error(`刪除學生錄音失敗：${error.message}`);
  }

  return unique.length;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get(TEACHER_COOKIE_NAME)?.value;

  if (!verifyTeacherToken(token)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const body = await request.json();
    const fullName = typeof body?.full_name === "string" ? body.full_name.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!fullName && !password) {
      return NextResponse.json({ ok: false, message: "沒有需要更新的學生資料。" }, { status: 400 });
    }

    if (password && password.length < 6) {
      return NextResponse.json({ ok: false, message: "新的學生密碼至少需要 6 個字元。" }, { status: 400 });
    }

    const supabase = createTeacherAdminSupabase();

    if (fullName) {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName })
        .eq("user_id", id);

      if (error) throw new Error(`學生姓名更新失敗：${error.message}`);

      await supabase.auth.admin.updateUserById(id, {
        user_metadata: { full_name: fullName },
      });
    }

    if (password) {
      const { error } = await supabase.auth.admin.updateUserById(id, { password });
      if (error) throw new Error(`學生密碼更新失敗：${error.message}`);
    }

    const [{ data: profile }, authResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", id).maybeSingle(),
      supabase.auth.admin.getUserById(id),
    ]);

    const authUser = authResult.data.user;
    const username = authUser?.email?.split("@")[0] || "";

    return NextResponse.json({
      ok: true,
      student: {
        user_id: id,
        full_name:
          profile?.full_name ||
          (username ? username.charAt(0).toUpperCase() + username.slice(1) : id.slice(0, 8)),
        username,
        email: authUser?.email || "",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "更新學生資料失敗。" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get(TEACHER_COOKIE_NAME)?.value;

  if (!verifyTeacherToken(token)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const supabase = createTeacherAdminSupabase();

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("user_id,full_name,role")
      .eq("user_id", id)
      .maybeSingle();

    if (profileError) throw new Error(profileError.message);
    if (!profile || profile.role !== "student") {
      return NextResponse.json({ ok: false, message: "找不到指定的學生帳號。" }, { status: 404 });
    }

    const { data: sessions, error: sessionError } = await supabase
      .from("exam_sessions")
      .select("id,recording_path")
      .eq("student_id", id);

    if (sessionError) throw new Error(`讀取學生測驗紀錄失敗：${sessionError.message}`);

    const sessionRows = sessions || [];
    const sessionIds = sessionRows.map((row: any) => String(row.id));
    const referencedPaths = sessionRows
      .map((row: any) => String(row.recording_path || ""))
      .filter(Boolean);
    const folderPaths = await listStudentRecordingObjects(supabase, id);
    const deletedRecordings = await removeRecordingPaths(supabase, [...referencedPaths, ...folderPaths]);

    if (sessionIds.length > 0) {
      const events = await supabase.from("exam_events").delete().in("session_id", sessionIds);
      if (events.error) throw new Error(`刪除 exam_events 失敗：${events.error.message}`);

      const results = await supabase.from("exam_results").delete().in("session_id", sessionIds);
      if (results.error) throw new Error(`刪除 exam_results 失敗：${results.error.message}`);

      const sessionsDelete = await supabase.from("exam_sessions").delete().in("id", sessionIds);
      if (sessionsDelete.error) throw new Error(`刪除 exam_sessions 失敗：${sessionsDelete.error.message}`);
    }

    const profileDelete = await supabase.from("profiles").delete().eq("user_id", id);
    if (profileDelete.error) throw new Error(`刪除 profiles 失敗：${profileDelete.error.message}`);

    const authDelete = await supabase.auth.admin.deleteUser(id);
    if (authDelete.error) {
      throw new Error(`資料紀錄已刪除，但 Supabase Auth 帳號刪除失敗：${authDelete.error.message}`);
    }

    return NextResponse.json({
      ok: true,
      deleted_student_id: id,
      deleted_sessions: sessionIds.length,
      deleted_recordings: deletedRecordings,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "永久刪除學生失敗。" },
      { status: 500 }
    );
  }
}
