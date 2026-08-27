
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  extractResponseText,
  readOpenAIError,
  windowText,
  type Segment,
} from "@/lib/ai-audio";

export const runtime = "nodejs";
export const maxDuration = 300;

function fail(message: string, status = 500) {
  return NextResponse.json({ ok: false, message }, { status });
}

function clamp20(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(20, Math.round(n))) : 0;
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

  const { data: result } = await supabase
    .from("exam_results")
    .select("blueprint,transcript,student_segments,report_version,total_score,passed")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (result?.report_version === "organized-v5") {
    return NextResponse.json({
      ok: true,
      cached: true,
      result: { total_score: result.total_score, passed: result.passed },
    });
  }

  const blueprint = result?.blueprint;
  const transcript = String(result?.transcript || "").trim();
  const segments = Array.isArray(result?.student_segments)
    ? (result.student_segments as Segment[])
    : [];

  if (!blueprint?.questions || blueprint.questions.length !== 10) {
    return fail("第 1 階段尚未完成 Q1～Q10 題組時間軸。");
  }
  if (!transcript || segments.length === 0) {
    return fail("第 2 階段尚未完成考生時間軸逐字稿。");
  }

  await supabase
    .from("exam_sessions")
    .update({ status: "grading", grading_status: "step3_q1_q10_grading" })
    .eq("id", sessionId)
    .eq("student_id", auth.user.id);

  const readingInput = windowText(
    segments,
    blueprint.reading.answer_start,
    blueprint.reading.answer_end
  );

  const questionInputs = [...blueprint.questions]
    .sort((a: any, b: any) => a.question_number - b.question_number)
    .map((q: any) => ({
      question_number: q.question_number,
      question: q.question,
      ...windowText(segments, q.answer_start, q.answer_end),
    }));

  const pictureInput = windowText(
    segments,
    blueprint.picture.answer_start,
    blueprint.picture.answer_end
  );

  const issue = {
    type: "object",
    additionalProperties: false,
    required: ["original", "corrected", "reason"],
    properties: {
      original: { type: "string" },
      corrected: { type: "string" },
      reason: { type: "string" },
    },
  };

  const scoreObject = {
    type: "object",
    additionalProperties: false,
    required: ["score", "feedback"],
    properties: {
      score: { type: "integer", minimum: 0, maximum: 20 },
      feedback: { type: "string" },
    },
  };

  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "scores",
      "executive_summary",
      "reading_review",
      "question_reviews",
      "picture_review",
      "strengths",
      "priority_improvements",
      "action_plan",
    ],
    properties: {
      scores: {
        type: "object",
        additionalProperties: false,
        required: ["content", "organization", "grammar", "vocabulary", "fluency"],
        properties: {
          content: scoreObject,
          organization: scoreObject,
          grammar: scoreObject,
          vocabulary: scoreObject,
          fluency: scoreObject,
        },
      },
      executive_summary: { type: "string" },
      reading_review: {
        type: "object",
        additionalProperties: false,
        required: [
          "student_text",
          "status",
          "completion_review",
          "fluency_review",
          "accuracy_review",
          "next_step",
        ],
        properties: {
          student_text: { type: "string" },
          status: {
            type: "string",
            enum: ["strong", "adequate", "needs_improvement", "no_response"],
          },
          completion_review: { type: "string" },
          fluency_review: { type: "string" },
          accuracy_review: { type: "string" },
          next_step: { type: "string" },
        },
      },
      question_reviews: {
        type: "array",
        minItems: 10,
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "question_number",
            "question",
            "student_answer",
            "status",
            "directness",
            "content_review",
            "language_review",
            "missing_or_expand",
            "better_answer",
            "next_step",
            "language_issues",
          ],
          properties: {
            question_number: { type: "integer", minimum: 1, maximum: 10 },
            question: { type: "string" },
            student_answer: { type: "string" },
            status: {
              type: "string",
              enum: ["strong", "adequate", "needs_improvement", "no_response"],
            },
            directness: { type: "string" },
            content_review: { type: "string" },
            language_review: { type: "string" },
            missing_or_expand: { type: "string" },
            better_answer: { type: "string" },
            next_step: { type: "string" },
            language_issues: { type: "array", items: issue },
          },
        },
      },
      picture_review: {
        type: "object",
        additionalProperties: false,
        required: [
          "student_answer",
          "status",
          "scene_coverage",
          "organization_review",
          "language_review",
          "development_review",
          "better_description",
          "next_step",
        ],
        properties: {
          student_answer: { type: "string" },
          status: {
            type: "string",
            enum: ["strong", "adequate", "needs_improvement", "no_response"],
          },
          scene_coverage: { type: "string" },
          organization_review: { type: "string" },
          language_review: { type: "string" },
          development_review: { type: "string" },
          better_description: { type: "string" },
          next_step: { type: "string" },
        },
      },
      strengths: { type: "array", minItems: 2, maxItems: 5, items: { type: "string" } },
      priority_improvements: {
        type: "array",
        minItems: 2,
        maxItems: 5,
        items: { type: "string" },
      },
      action_plan: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
    },
  };

  const prompt = `
你是一位嚴謹的 GEPT 中級口說教師。請用繁體中文製作高度有組織的診斷報告。

硬性規則：
1. Part 1 Reading = 一個整體檢討。
2. Part 2 必須 EXACTLY Q1～Q10 十個獨立檢討，不可合併、不可漏題。
3. Part 3 Picture Description = 一個完整 90 秒看圖敘述，不拆四個引導問題。

每一題 Q1～Q10 都要包含：
- 正式題目
- 考生實際回答
- 是否切題
- 內容優缺點
- Grammar / Vocabulary 的具體問題
- 還能補充什麼
- 一個自然、符合中級程度的英文建議回答
- 一個本題專屬練習重點
- 只列考生真的說錯的句子，不可虛構錯誤

不得使用空泛重複的評語。

總分：
Content / Organization / Grammar / Vocabulary / Fluency 各 0～20。
總分 >=80 PASS。

READING:
${JSON.stringify(readingInput)}

Q1-Q10:
${JSON.stringify(questionInputs)}

PICTURE DESCRIPTION:
${JSON.stringify(pictureInput)}

FULL TRANSCRIPT:
${transcript}
`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openai}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "speaking_exam_organized_v5",
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    return fail(`OpenAI 評分失敗：${await readOpenAIError(response)}`);
  }

  const payload = await response.json();
  const text = extractResponseText(payload);
  if (!text) return fail("OpenAI 評分完成，但沒有回傳內容。");

  let report: any;
  try {
    report = JSON.parse(text);
  } catch {
    return fail("OpenAI 評分 JSON 解析失敗。");
  }

  if (!Array.isArray(report.question_reviews) || report.question_reviews.length !== 10) {
    return fail(`Q1～Q10 報告不完整，目前只有 ${report.question_reviews?.length ?? 0} 題。`);
  }

  report.question_reviews.sort((a: any, b: any) => a.question_number - b.question_number);
  for (let i = 1; i <= 10; i++) {
    if (report.question_reviews[i - 1]?.question_number !== i) {
      return fail(`逐題報告缺少 Question ${i}。`);
    }
  }

  const content = clamp20(report.scores.content.score);
  const organization = clamp20(report.scores.organization.score);
  const grammar = clamp20(report.scores.grammar.score);
  const vocabulary = clamp20(report.scores.vocabulary.score);
  const fluency = clamp20(report.scores.fluency.score);
  const total = content + organization + grammar + vocabulary + fluency;
  const passed = total >= 80;

  const gradingJson = {
    report_version: "organized-v5",
    executive_summary: report.executive_summary,
    scores: {
      content: { score: content, feedback: report.scores.content.feedback },
      organization: {
        score: organization,
        feedback: report.scores.organization.feedback,
      },
      grammar: { score: grammar, feedback: report.scores.grammar.feedback },
      vocabulary: {
        score: vocabulary,
        feedback: report.scores.vocabulary.feedback,
      },
      fluency: { score: fluency, feedback: report.scores.fluency.feedback },
    },
    reading_review: report.reading_review,
    question_reviews: report.question_reviews,
    picture_review: report.picture_review,
    strengths: report.strengths,
    priority_improvements: report.priority_improvements,
    action_plan: report.action_plan,
  };

  const { error: saveError } = await supabase
    .from("exam_results")
    .update({
      content_score: content,
      organization_score: organization,
      grammar_score: grammar,
      vocabulary_score: vocabulary,
      fluency_score: fluency,
      total_score: total,
      passed,
      feedback: report.executive_summary,
      strengths: report.strengths.join("\n"),
      weaknesses: report.priority_improvements.join("\n"),
      item_feedback: report.question_reviews,
      grading_json: gradingJson,
      openai_model: model,
      report_version: "organized-v5",
      graded_at: new Date().toISOString(),
    })
    .eq("session_id", sessionId);

  if (saveError) return fail(`評分完成但儲存失敗：${saveError.message}`);

  await supabase
    .from("exam_sessions")
    .update({
      status: "completed",
      grading_status: "completed",
      total_score: total,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("student_id", auth.user.id);

  return NextResponse.json({
    ok: true,
    result: { total_score: total, passed },
  });
}
