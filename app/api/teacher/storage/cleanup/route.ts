import { NextRequest, NextResponse } from "next/server";
import {
  TEACHER_COOKIE_NAME,
  verifyTeacherToken,
} from "@/lib/teacherAuth";
import { createTeacherAdminSupabase } from "@/lib/teacherSupabase";

export const runtime = "nodejs";
export const maxDuration = 300;

const RETENTION_DAYS = 60;

export async function POST(request: NextRequest) {
  const token = request.cookies.get(TEACHER_COOKIE_NAME)?.value;

  if (!verifyTeacherToken(token)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createTeacherAdminSupabase();
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const { data: sessions, error } = await supabase
      .from("exam_sessions")
      .select("id,recording_path,recording_size_bytes,recording_finished_at,audio_finished_at,created_at")
      .not("recording_path", "is", null)
      .limit(5000);

    if (error) throw new Error(`讀取錄音紀錄失敗：${error.message}`);

    const expired = (sessions || []).filter((row: any) => {
      const reference = row.recording_finished_at || row.audio_finished_at || row.created_at;
      if (!reference) return false;
      const time = new Date(reference).getTime();
      return Number.isFinite(time) && time < cutoff.getTime();
    });

    let deletedCount = 0;
    let freedBytes = 0;

    for (let i = 0; i < expired.length; i += 100) {
      const batch = expired.slice(i, i + 100);
      const paths = batch.map((row: any) => String(row.recording_path || "")).filter(Boolean);

      if (paths.length) {
        const removal = await supabase.storage.from("exam-recordings").remove(paths);
        if (removal.error) throw new Error(`刪除過期錄音失敗：${removal.error.message}`);
      }

      for (const row of batch) {
        const update = await supabase
          .from("exam_sessions")
          .update({
            recording_path: null,
            recording_size_bytes: 0,
            recording_mime_type: null,
            upload_status: "recording_deleted_after_60_days",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        if (update.error) throw new Error(`更新過期錄音紀錄失敗：${update.error.message}`);

        deletedCount += 1;
        freedBytes += Number(row.recording_size_bytes || 0);
      }
    }

    return NextResponse.json({
      ok: true,
      result: {
        retention_days: RETENTION_DAYS,
        cutoff: cutoff.toISOString(),
        deleted_count: deletedCount,
        freed_bytes: freedBytes,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "60 天錄音清理失敗。" },
      { status: 500 }
    );
  }
}
