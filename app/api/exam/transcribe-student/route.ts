
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { transcribeWithSegments } from "@/lib/ai-audio";

export const runtime = "nodejs";
export const maxDuration = 300;

function fail(message: string, status = 500) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const openai = process.env.OPENAI_API_KEY;

  if (!url || !key || !openai) return fail("缺少 Supabase 或 OpenAI 環境變數。");

  const token = (request.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return fail("缺少登入憑證。", 401);

  const { sessionId } = await request.json().catch(() => ({ sessionId: "" }));
  if (!sessionId) return fail("缺少 sessionId。", 400);

  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: auth } = await supabase.auth.getUser(token);
  if (!auth.user) return fail("登入已失效。", 401);

  const { data: existing } = await supabase
    .from("exam_results")
    .select("transcript,student_segments")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (
    String(existing?.transcript || "").trim() &&
    Array.isArray(existing?.student_segments) &&
    existing.student_segments.length > 0
  ) {
    return NextResponse.json({
      ok: true,
      cached: true,
      segmentCount: existing.student_segments.length,
    });
  }

  const { data: session } = await supabase
    .from("exam_sessions")
    .select("recording_path")
    .eq("id", sessionId)
    .eq("student_id", auth.user.id)
    .maybeSingle();

  if (!session?.recording_path) return fail("找不到考生錄音。", 404);

  await supabase
    .from("exam_sessions")
    .update({ status: "transcribing", grading_status: "step2_student_transcript" })
    .eq("id", sessionId)
    .eq("student_id", auth.user.id);

  const { data: audio, error: audioError } = await supabase.storage
    .from("exam-recordings")
    .download(session.recording_path);

  if (!audio || audioError) {
    return fail(`考生錄音下載失敗：${audioError?.message || "unknown"}`);
  }

  const student = await transcribeWithSegments(
    openai,
    audio,
    session.recording_path.split("/").pop() || "student.webm"
  );

  if (!student.text || student.segments.length === 0) {
    return fail("沒有取得可用的考生時間軸逐字稿。");
  }

  const { error: saveError } = await supabase
    .from("exam_results")
    .upsert(
      {
        session_id: sessionId,
        transcript: student.text,
        student_segments: student.segments,
        transcription_model: "gpt-4o-transcribe-diarize",
        report_version: "processing-v5",
      },
      { onConflict: "session_id" }
    );

  if (saveError) return fail(`逐字稿儲存失敗：${saveError.message}`);

  return NextResponse.json({
    ok: true,
    cached: false,
    segmentCount: student.segments.length,
  });
}
