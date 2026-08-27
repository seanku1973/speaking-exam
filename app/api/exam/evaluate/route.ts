import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300;

type Segment = {
  start: number;
  end: number;
  text: string;
  speaker?: string;
};

type QuestionWindow = {
  question_number: number;
  question: string;
  answer_start: number;
  answer_end: number;
};

type ExamBlueprint = {
  reading: {
    answer_start: number;
    answer_end: number;
  };
  questions: QuestionWindow[];
  picture: {
    answer_start: number;
    answer_end: number;
  };
};

type LanguageIssue = {
  original: string;
  corrected: string;
  reason: string;
};

type QuestionReview = {
  question_number: number;
  question: string;
  student_answer: string;
  status: "strong" | "adequate" | "needs_improvement" | "no_response";
  directness: string;
  content_review: string;
  language_review: string;
  missing_or_expand: string;
  better_answer: string;
  next_step: string;
  language_issues: LanguageIssue[];
};

type ReadingReview = {
  student_text: string;
  status: "strong" | "adequate" | "needs_improvement" | "no_response";
  completion_review: string;
  fluency_review: string;
  accuracy_review: string;
  next_step: string;
};

type PictureReview = {
  student_answer: string;
  status: "strong" | "adequate" | "needs_improvement" | "no_response";
  scene_coverage: string;
  organization_review: string;
  language_review: string;
  development_review: string;
  better_description: string;
  next_step: string;
  language_issues: LanguageIssue[];
};

type FinalReport = {
  scores: {
    content: { score: number; feedback: string };
    organization: { score: number; feedback: string };
    grammar: { score: number; feedback: string };
    vocabulary: { score: number; feedback: string };
    fluency: { score: number; feedback: string };
  };
  executive_summary: string;
  reading_review: ReadingReview;
  question_reviews: QuestionReview[];
  picture_review: PictureReview;
  strengths: string[];
  priority_improvements: string[];
  action_plan: string[];
};

function jsonError(message: string, status = 500) {
  return NextResponse.json({ ok: false, message }, { status });
}

function clamp20(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(20, Math.round(n)));
}

async function readOpenAIError(response: Response) {
  try {
    const body = await response.json();
    return body?.error?.message || JSON.stringify(body);
  } catch {
    return await response.text();
  }
}

function extractResponseText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const pieces: string[] = [];

  if (Array.isArray(payload?.output)) {
    for (const item of payload.output) {
      if (!Array.isArray(item?.content)) continue;
      for (const content of item.content) {
        if (
          (content?.type === "output_text" || content?.type === "text") &&
          typeof content?.text === "string" &&
          content.text.trim()
        ) {
          pieces.push(content.text.trim());
        }
      }
    }
  }

  return pieces.join("\n").trim();
}

async function callStructuredResponse(
  apiKey: string,
  model: string,
  input: string,
  schemaName: string,
  schema: Record<string, unknown>
) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input,
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await readOpenAIError(response);
    throw new Error(`OpenAI 分析失敗：${detail}`);
  }

  const payload = await response.json();
  const text = extractResponseText(payload);

  if (!text) {
    throw new Error("OpenAI 請求成功，但找不到可解析的輸出文字。");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`OpenAI JSON 解析失敗：${text.slice(0, 220)}`);
  }
}

async function transcribeWithSegments(
  apiKey: string,
  blob: Blob,
  filename: string
): Promise<{ text: string; duration: number; segments: Segment[] }> {
  const form = new FormData();
  form.append("model", "gpt-4o-transcribe-diarize");
  form.append("response_format", "diarized_json");
  form.append("chunking_strategy", "auto");
  form.append("file", blob, filename);

  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    }
  );

  if (!response.ok) {
    const detail = await readOpenAIError(response);
    throw new Error(`OpenAI 時間軸轉錄失敗：${detail}`);
  }

  const payload = await response.json();

  const segments: Segment[] = Array.isArray(payload?.segments)
    ? payload.segments
        .map((seg: any) => ({
          start: Number(seg?.start ?? 0),
          end: Number(seg?.end ?? 0),
          text: String(seg?.text ?? "").trim(),
          speaker: typeof seg?.speaker === "string" ? seg.speaker : undefined,
        }))
        .filter(
          (seg: Segment) =>
            Number.isFinite(seg.start) &&
            Number.isFinite(seg.end) &&
            seg.end >= seg.start &&
            seg.text
        )
    : [];

  return {
    text: String(payload?.text ?? "").trim(),
    duration: Number(payload?.duration ?? 0),
    segments,
  };
}

function getWindowText(
  segments: Segment[],
  start: number,
  end: number
): {
  text: string;
  speech_seconds: number;
  window_seconds: number;
  speech_ratio: number;
} {
  const selected = segments.filter((seg) => {
    const midpoint = (seg.start + seg.end) / 2;
    return midpoint >= start && midpoint <= end;
  });

  const text = selected.map((s) => s.text).join(" ").trim();

  const speechSeconds = selected.reduce((total, seg) => {
    const overlapStart = Math.max(start, seg.start);
    const overlapEnd = Math.min(end, seg.end);
    return total + Math.max(0, overlapEnd - overlapStart);
  }, 0);

  const windowSeconds = Math.max(0.01, end - start);

  return {
    text,
    speech_seconds: Math.round(speechSeconds * 10) / 10,
    window_seconds: Math.round(windowSeconds * 10) / 10,
    speech_ratio: Math.round((speechSeconds / windowSeconds) * 1000) / 10,
  };
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const openaiKey = process.env.OPENAI_API_KEY;
  const gradingModel = process.env.OPENAI_GRADING_MODEL || "gpt-5.6-luna";

  if (!supabaseUrl || !supabaseKey) {
    return jsonError("Supabase 環境變數尚未設定。");
  }

  if (!openaiKey) {
    return jsonError("找不到 OPENAI_API_KEY。");
  }

  const authorization = request.headers.get("authorization") || "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return jsonError("缺少考生登入憑證。", 401);
  }

  let body: { sessionId?: string; force?: boolean };

  try {
    body = await request.json();
  } catch {
    return jsonError("請求格式錯誤。", 400);
  }

  const sessionId = body.sessionId?.trim();
  const force = Boolean(body.force);

  if (!sessionId) {
    return jsonError("缺少 sessionId。", 400);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const adminSupabase = serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      })
    : null;

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    return jsonError("考生登入已失效，請重新登入。", 401);
  }

  const { data: examSession, error: sessionError } = await supabase
    .from("exam_sessions")
    .select("id,student_id,exam_set_id,status,recording_path")
    .eq("id", sessionId)
    .eq("student_id", user.id)
    .maybeSingle();

  if (sessionError || !examSession) {
    return jsonError("找不到這次考試資料。", 404);
  }

  if (!examSession.recording_path) {
    return jsonError("這次考試尚未找到錄音檔。", 400);
  }

  const { data: existingResult } = await supabase
    .from("exam_results")
    .select("session_id,total_score,passed,report_version")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (
    !force &&
    existingResult?.report_version === "organized-v4" &&
    examSession.status === "completed"
  ) {
    return NextResponse.json({
      ok: true,
      alreadyCompleted: true,
      result: existingResult,
    });
  }

  let stage = "preparing";

  try {
    await supabase
      .from("exam_sessions")
      .update({
        status: "transcribing",
        grading_status: "organized_v4_transcribing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("student_id", user.id);

    const { data: examSet, error: examSetError } = await supabase
      .from("exam_sets")
      .select("id,code,title,audio_path,grading_context")
      .eq("id", examSession.exam_set_id)
      .maybeSingle();

    if (examSetError || !examSet) {
      throw new Error("找不到正式考試題組資料。");
    }

    if (!examSet.audio_path) {
      throw new Error("考試題組沒有設定 audio_path。");
    }

    stage = "official_audio";

    let blueprint: ExamBlueprint | null =
      examSet?.grading_context?.version === "blueprint-v4"
        ? examSet.grading_context.blueprint
        : null;

    if (!blueprint || !Array.isArray(blueprint.questions)) {
      const { data: officialBlob, error: officialDownloadError } =
        await supabase.storage
          .from("exam-audio")
          .download(examSet.audio_path);

      if (officialDownloadError || !officialBlob) {
        throw new Error(
          `無法下載正式考試 MP3：${
            officialDownloadError?.message || "unknown error"
          }`
        );
      }

      const official = await transcribeWithSegments(
        openaiKey,
        officialBlob,
        examSet.audio_path.split("/").pop() || "official.mp3"
      );

      const blueprintSchema = {
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
              required: [
                "question_number",
                "question",
                "answer_start",
                "answer_end",
              ],
              properties: {
                question_number: {
                  type: "integer",
                  minimum: 1,
                  maximum: 10,
                },
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

      const blueprintPrompt = `
Create the exact grading blueprint for this GEPT Intermediate-style speaking test from the official MP3 transcript and timestamps.

SOURCE TEST STRUCTURE:
- Opening seat-number / registration-number identification: NOT SCORED.
- Part 1 Reading Aloud: one integrated reading-performance block.
- Part 2 Answering Questions: exactly 10 questions.
  - Each official question is played twice.
  - Q1-Q5: approximately 15 seconds response time each.
  - Q6-Q10: approximately 30 seconds response time each.
- Part 3 Picture Description: one integrated 90-second picture-description performance.
  - There may be four guiding questions in the audio.
  - DO NOT turn them into four graded items.
  - The entire picture section is one performance.
- Closing seat-number / registration-number identification: NOT SCORED.

YOUR OUTPUT MUST:
1. Find the actual student speaking window for Part 1 reading.
2. Extract exactly Q1-Q10 from the official audio, merging the repeated playback into one clean question string.
3. Find the answer window immediately after each question.
4. Find ONE complete answer window for the entire picture-description section.
5. Ignore all opening/closing identification phrases.
6. Ensure every answer_end > answer_start.
7. Return Q1...Q10 in numerical order.

OFFICIAL AUDIO SEGMENTS:
${JSON.stringify(official.segments)}
`.trim();

      blueprint = (await callStructuredResponse(
        openaiKey,
        gradingModel,
        blueprintPrompt,
        "speaking_exam_blueprint_v4",
        blueprintSchema
      )) as ExamBlueprint;

      if (
        !blueprint ||
        !Array.isArray(blueprint.questions) ||
        blueprint.questions.length !== 10
      ) {
        throw new Error("正式 MP3 題目解析失敗：沒有取得完整 Q1～Q10。");
      }

      blueprint.questions = [...blueprint.questions].sort(
        (a, b) => a.question_number - b.question_number
      );

      if (adminSupabase) {
        await adminSupabase
          .from("exam_sets")
          .update({
            grading_context: {
              version: "blueprint-v4",
              blueprint,
              generated_at: new Date().toISOString(),
            },
          })
          .eq("id", examSet.id);
      }
    }

    stage = "student_audio";

    const { data: studentBlob, error: studentDownloadError } =
      await supabase.storage
        .from("exam-recordings")
        .download(examSession.recording_path);

    if (studentDownloadError || !studentBlob) {
      throw new Error(
        `無法下載考生錄音：${
          studentDownloadError?.message || "unknown error"
        }`
      );
    }

    const student = await transcribeWithSegments(
      openaiKey,
      studentBlob,
      examSession.recording_path.split("/").pop() || "student.webm"
    );

    if (!student.text) {
      throw new Error("沒有取得考生逐字稿。");
    }

    const readingInput = {
      ...getWindowText(
        student.segments,
        blueprint.reading.answer_start,
        blueprint.reading.answer_end
      ),
      answer_start: blueprint.reading.answer_start,
      answer_end: blueprint.reading.answer_end,
    };

    const questionInputs = blueprint.questions.map((q) => ({
      question_number: q.question_number,
      question: q.question,
      ...getWindowText(student.segments, q.answer_start, q.answer_end),
      answer_start: q.answer_start,
      answer_end: q.answer_end,
    }));

    const pictureInput = {
      ...getWindowText(
        student.segments,
        blueprint.picture.answer_start,
        blueprint.picture.answer_end
      ),
      answer_start: blueprint.picture.answer_start,
      answer_end: blueprint.picture.answer_end,
    };

    stage = "grading";

    await supabase
      .from("exam_sessions")
      .update({
        status: "grading",
        grading_status: "organized_v4_grading",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("student_id", user.id);

    const issueSchema = {
      type: "object",
      additionalProperties: false,
      required: ["original", "corrected", "reason"],
      properties: {
        original: { type: "string" },
        corrected: { type: "string" },
        reason: { type: "string" },
      },
    };

    const reportSchema = {
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
          required: [
            "content",
            "organization",
            "grammar",
            "vocabulary",
            "fluency",
          ],
          properties: {
            content: {
              type: "object",
              additionalProperties: false,
              required: ["score", "feedback"],
              properties: {
                score: { type: "integer", minimum: 0, maximum: 20 },
                feedback: { type: "string" },
              },
            },
            organization: {
              type: "object",
              additionalProperties: false,
              required: ["score", "feedback"],
              properties: {
                score: { type: "integer", minimum: 0, maximum: 20 },
                feedback: { type: "string" },
              },
            },
            grammar: {
              type: "object",
              additionalProperties: false,
              required: ["score", "feedback"],
              properties: {
                score: { type: "integer", minimum: 0, maximum: 20 },
                feedback: { type: "string" },
              },
            },
            vocabulary: {
              type: "object",
              additionalProperties: false,
              required: ["score", "feedback"],
              properties: {
                score: { type: "integer", minimum: 0, maximum: 20 },
                feedback: { type: "string" },
              },
            },
            fluency: {
              type: "object",
              additionalProperties: false,
              required: ["score", "feedback"],
              properties: {
                score: { type: "integer", minimum: 0, maximum: 20 },
                feedback: { type: "string" },
              },
            },
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
              question_number: {
                type: "integer",
                minimum: 1,
                maximum: 10,
              },
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
              language_issues: {
                type: "array",
                items: issueSchema,
              },
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
            "language_issues",
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
            language_issues: {
              type: "array",
              items: issueSchema,
            },
          },
        },
        strengths: {
          type: "array",
          minItems: 2,
          maxItems: 5,
          items: { type: "string" },
        },
        priority_improvements: {
          type: "array",
          minItems: 2,
          maxItems: 5,
          items: { type: "string" },
        },
        action_plan: {
          type: "array",
          minItems: 3,
          maxItems: 6,
          items: { type: "string" },
        },
      },
    };

    const gradingPrompt = `
You are an experienced English speaking teacher grading a GEPT Intermediate-style speaking exam. Produce a precise, highly organized diagnostic report in Traditional Chinese.

THIS IS NOT A GENERIC OVERALL COMMENTARY.
The central requirement is a TRUE QUESTION-BY-QUESTION REVIEW of Part 2.

SOURCE TEST STRUCTURE:
- Part 1 Reading Aloud: review as ONE integrated reading performance.
- Part 2 Answering Questions: EXACTLY 10 separate questions. Review Q1 through Q10 ONE BY ONE.
- Part 3 Picture Description: review as ONE integrated 90-second picture-description performance. Do not split it into four subquestions.

PART 2 RULES — MANDATORY:
For EACH of Q1-Q10, you MUST return a separate review object with the same question_number and question.
For EACH question:
1. Quote/display the official question.
2. Quote/display the student's actual answer from the synchronized answer window.
3. directness: say clearly whether the answer directly answers the question.
4. content_review: identify what is relevant and what is weak/incomplete.
5. language_review: discuss specific grammar/vocabulary/sentence problems found in THAT answer.
6. missing_or_expand: say what information should be added or clarified.
7. better_answer: provide one natural, realistic intermediate-level sample answer.
8. next_step: give one concrete practice action for THIS question type.
9. language_issues: include only real errors from THAT answer. Do not invent errors.

Do not combine Q1-Q10 into one paragraph.
Do not skip a question.
Do not give generic repeated comments.

PART 1 READING:
Do not treat the passage's grammar/content as the student's own language.
Use transcript evidence to discuss completion, continuity, obvious omissions/substitutions visible in transcription, and pacing.
Do not claim exact pronunciation errors unless supported by the available data.

PART 3 PICTURE DESCRIPTION:
Treat the entire response as one task.
Evaluate:
- coverage of visible scene/details,
- description of people/actions,
- development beyond isolated words,
- organization/sequence,
- grammar/vocabulary,
- continuity.
Do not create Picture Q1-Q4.
Do not penalize missing individual guiding questions.

OVERALL SCORING:
Content 0-20
Organization 0-20
Grammar 0-20
Vocabulary 0-20
Fluency 0-20
Total = /100
PASS = 80 or above.

REPORT LANGUAGE:
- Explanations: Traditional Chinese.
- Preserve student's English when quoting.
- Better answers: English.
- Be specific and teacher-like.
- Avoid vague phrases such as "grammar can be improved" unless immediately followed by concrete evidence.

SYNCHRONIZED INPUT

PART 1 READING:
${JSON.stringify(readingInput)}

PART 2 Q1-Q10:
${JSON.stringify(questionInputs)}

PART 3 PICTURE DESCRIPTION:
${JSON.stringify(pictureInput)}

FULL STUDENT TRANSCRIPT:
${student.text}
`.trim();

    const report = (await callStructuredResponse(
      openaiKey,
      gradingModel,
      gradingPrompt,
      "speaking_exam_organized_report_v4",
      reportSchema
    )) as FinalReport;

    if (!Array.isArray(report.question_reviews) || report.question_reviews.length !== 10) {
      throw new Error(
        `AI 詳細報告不完整：Q1～Q10 應有 10 筆，目前只有 ${
          report.question_reviews?.length ?? 0
        } 筆。`
      );
    }

    report.question_reviews = [...report.question_reviews].sort(
      (a, b) => a.question_number - b.question_number
    );

    for (let i = 1; i <= 10; i++) {
      const review = report.question_reviews[i - 1];
      if (!review || review.question_number !== i) {
        throw new Error(`AI 詳細報告缺少 Question ${i}。`);
      }
    }

    const contentScore = clamp20(report.scores?.content?.score);
    const organizationScore = clamp20(report.scores?.organization?.score);
    const grammarScore = clamp20(report.scores?.grammar?.score);
    const vocabularyScore = clamp20(report.scores?.vocabulary?.score);
    const fluencyScore = clamp20(report.scores?.fluency?.score);

    const totalScore =
      contentScore +
      organizationScore +
      grammarScore +
      vocabularyScore +
      fluencyScore;

    const passed = totalScore >= 80;
    const gradedAt = new Date().toISOString();

    const gradingJson = {
      report_version: "organized-v4",
      executive_summary: report.executive_summary,
      scores: {
        content: {
          score: contentScore,
          feedback: report.scores.content.feedback,
        },
        organization: {
          score: organizationScore,
          feedback: report.scores.organization.feedback,
        },
        grammar: {
          score: grammarScore,
          feedback: report.scores.grammar.feedback,
        },
        vocabulary: {
          score: vocabularyScore,
          feedback: report.scores.vocabulary.feedback,
        },
        fluency: {
          score: fluencyScore,
          feedback: report.scores.fluency.feedback,
        },
      },
      reading_review: report.reading_review,
      question_reviews: report.question_reviews,
      picture_review: report.picture_review,
      strengths: report.strengths,
      priority_improvements: report.priority_improvements,
      action_plan: report.action_plan,
      blueprint,
      total_score: totalScore,
      passed,
    };

    const allCorrections = [
      ...(report.question_reviews || []).flatMap((q) =>
        (q.language_issues || []).map((issue) => ({
          item: `Q${q.question_number}`,
          original: issue.original,
          corrected: issue.corrected,
          explanation: issue.reason,
        }))
      ),
      ...(report.picture_review?.language_issues || []).map((issue) => ({
        item: "Picture",
        original: issue.original,
        corrected: issue.corrected,
        explanation: issue.reason,
      })),
    ];

    const { error: resultError } = await supabase
      .from("exam_results")
      .upsert(
        {
          session_id: sessionId,
          transcript: student.text,
          content_score: contentScore,
          organization_score: organizationScore,
          grammar_score: grammarScore,
          vocabulary_score: vocabularyScore,
          fluency_score: fluencyScore,
          total_score: totalScore,
          passed,
          feedback: report.executive_summary,
          strengths: (report.strengths || []).join("\n"),
          weaknesses: (report.priority_improvements || []).join("\n"),
          corrections: allCorrections,
          item_feedback: report.question_reviews || [],
          grading_json: gradingJson,
          openai_model: gradingModel,
          transcription_model: "gpt-4o-transcribe-diarize",
          report_version: "organized-v4",
          graded_at: gradedAt,
        },
        { onConflict: "session_id" }
      );

    if (resultError) {
      throw new Error(
        `詳細評分完成，但無法寫入 exam_results：${resultError.message}`
      );
    }

    const { error: sessionFinishError } = await supabase
      .from("exam_sessions")
      .update({
        status: "completed",
        grading_status: "completed",
        total_score: totalScore,
        updated_at: gradedAt,
      })
      .eq("id", sessionId)
      .eq("student_id", user.id);

    if (sessionFinishError) {
      throw new Error(
        `詳細評分已儲存，但無法更新 exam_sessions：${sessionFinishError.message}`
      );
    }

    return NextResponse.json({
      ok: true,
      result: {
        session_id: sessionId,
        total_score: totalScore,
        passed,
        report_version: "organized-v4",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "詳細評分流程發生未知錯誤。";

    await supabase
      .from("exam_sessions")
      .update({
        status: "grading_failed",
        grading_status: `organized_v4_failed:${stage}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("student_id", user.id);

    return jsonError(message);
  }
}
