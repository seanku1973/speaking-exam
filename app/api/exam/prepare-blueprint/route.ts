
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { structuredResponse, transcribeWithSegments } from "@/lib/ai-audio";

export const runtime = "nodejs";
export const maxDuration = 300;

function fail(message: string, status = 500) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const openai = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_GRADING_MODEL || "gpt-5.6-luna";

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

  const { data: session } = await supabase
    .from("exam_sessions")
    .select("exam_set_id")
    .eq("id", sessionId)
    .eq("student_id", auth.user.id)
    .maybeSingle();

  if (!session) return fail("找不到本次測驗。", 404);

  const { data: existing } = await supabase
    .from("exam_results")
    .select("blueprint")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (existing?.blueprint?.questions?.length === 10) {
    return NextResponse.json({ ok: true, cached: true });
  }

  const { data: examSet } = await supabase
    .from("exam_sets")
    .select("audio_path")
    .eq("id", session.exam_set_id)
    .maybeSingle();

  if (!examSet?.audio_path) return fail("題組沒有正式 MP3。");

  await supabase
    .from("exam_sessions")
    .update({ grading_status: "step1_blueprint" })
    .eq("id", sessionId)
    .eq("student_id", auth.user.id);

  const { data: audio, error: audioError } = await supabase.storage
    .from("exam-audio")
    .download(examSet.audio_path);

  if (!audio || audioError) {
    return fail(`正式 MP3 下載失敗：${audioError?.message || "unknown"}`);
  }

  const official = await transcribeWithSegments(
    openai,
    audio,
    examSet.audio_path.split("/").pop() || "official.mp3"
  );

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["reading", "questions", "picture"],
    properties: {
      reading: {
        type: "object",
        additionalProperties: false,
        required: ["answer_start", "answer_end"],
        properties: {
          answer_start: { type: "number", minimum: 0 },
          answer_end: { type: "number", minimum: 0 },
        },
      },
      questions: {
        type: "array",
        minItems: 10,
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["question_number", "question", "answer_start", "answer_end"],
          properties: {
            question_number: { type: "integer", minimum: 1, maximum: 10 },
            question: { type: "string" },
            answer_start: { type: "number", minimum: 0 },
            answer_end: { type: "number", minimum: 0 },
          },
        },
      },
      picture: {
        type: "object",
        additionalProperties: false,
        required: ["answer_start", "answer_end"],
        properties: {
          answer_start: { type: "number", minimum: 0 },
          answer_end: { type: "number", minimum: 0 },
        },
      },
    },
  };

  const blueprint = await structuredResponse(
    openai,
    model,
    `
從正式口說測驗 MP3 建立作答時間軸。

規則：
- 開頭與結尾的 seat number / registration number 不計分。
- 第一部分朗讀：視為一個完整作答區間。
- 第二部分：必須得到 Q1～Q10 共十題；每題播放兩次，要合併成一個乾淨題目。
- Q1～Q5 約 15 秒作答，Q6～Q10 約 30 秒作答。
- 第三部分看圖敘述：整個 90 秒視為一個作答區間，不拆四個引導問題。
- questions 必須恰好十題並依 1～10 排序。
- 每個 answer_end 必須大於 answer_start。

OFFICIAL SEGMENTS:
${JSON.stringify(official.segments)}
`,
    "speaking_exam_blueprint_stage",
    schema
  );

  if (!Array.isArray(blueprint?.questions) || blueprint.questions.length !== 10) {
    return fail("題組解析失敗：沒有取得完整 Q1～Q10。");
  }

  blueprint.questions.sort((a: any, b: any) => a.question_number - b.question_number);

  const { error: saveError } = await supabase
    .from("exam_results")
    .upsert(
      {
        session_id: sessionId,
        blueprint,
        report_version: "processing-v5",
      },
      { onConflict: "session_id" }
    );

  if (saveError) return fail(`題組時間軸儲存失敗：${saveError.message}`);

  return NextResponse.json({ ok: true, cached: false });
}
