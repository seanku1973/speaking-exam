import {
  extractResponseText,
  readOpenAIError,
  windowText,
  type Segment,
} from "@/lib/ai-audio";
import {
  ITEM_LEVEL_RUBRIC,
  normalizeItemLevelGrades,
} from "@/lib/itemLevelGrades";

export type ExamGradeInput = {
  openai: string;
  model: string;
  blueprint: any;
  transcript: string;
  segments: Segment[];
};

function clamp20(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(20, Math.round(n))) : 0;
}

export async function gradeExamReport(input: ExamGradeInput) {
  const { openai, model, blueprint, transcript, segments } = input;

  if (!blueprint?.questions || blueprint.questions.length !== 10) {
    throw new Error("第 1 階段尚未完成 Q1～Q10 題組時間軸。");
  }
  if (!transcript || segments.length === 0) {
    throw new Error("第 2 階段尚未完成考生時間軸逐字稿。");
  }

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

  const prompt = `
你是一位重視溝通成功、評分一致且具教學診斷能力的 GEPT 中級口說教師。請用繁體中文製作高度有組織的診斷報告。

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
- 還能補充什麼（僅作進階練習建議；若原回答已切題，不得把未補充內容當作扣分理由）
- 一個自然、符合中級程度的英文建議回答
- 一個本題專屬練習重點
- 只列考生真的說錯的句子，不可虛構錯誤

不得使用空泛重複的評語。

總分：
Content / Organization / Grammar / Vocabulary / Fluency 各 0～20。
總分 >=80 PASS。

【正式模擬測驗評分校準－必須遵守】
這是正式模擬測驗。評分要優先看「是否切中題目、是否成功傳達意思」，但不可把停頓秒數、開始作答速度或是否把時間用滿當成扣分依據。

1. 如果考生已經直接回答到問題核心，空白幾秒、思考停頓、較晚開始、回答後留下空白時間，都不得作為扣分理由，也不得寫成缺點。
2. 如果時間到了或答題時間窗切斷最後一句，且前面已經有完整、切題、可理解的答案：
   - 不得因最後一句未完成而扣 Content、Organization、Grammar、Vocabulary 或 Fluency。
   - 不得把被截斷的最後片段列為 grammar error。
   - 評分時直接忽略該尾端未完成片段。
3. 如果題目已經被充分回答，不得因「沒有再多說一個例子／原因／細節」而扣分，除非正式題目本身要求那些內容。
4. 簡短但切題、清楚、可理解的回答可以得到高分；不要把篇幅長短當作分數高低的主要依據。
5. Fluency 只評估「實際說出的英文」是否順暢可理解；沉默區段、錄音切分、作答時間窗邊界、作答結束後的空白都不計入 Fluency 扣分。
6. Grammar / Vocabulary 僅在真實語言錯誤影響精確度或理解時扣分。零星小錯但意思清楚，應維持中高分。
7. Content 若大多數題目都有直接切題回答，應給中高分；不要因回答不夠華麗或不夠長而壓低。
8. Organization 若回答短但邏輯清楚，仍可高分；不要要求每題都有完整作文式結構。

建議校準：
- 18～20：表現強，任務大多清楚完成；允許少量不影響理解的小錯。
- 16～17：穩定達標，多數回答切題可理解，有一些語言限制。
- 13～15：基本可溝通，但多題有明顯內容不足或語言問題。
- 0～12：多數任務未完成、偏題、無有效回答，或語言問題嚴重影響理解。

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
          name: "speaking_exam_organized_v6_exam_calibrated",
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI 評分失敗：${await readOpenAIError(response)}`);
  }

  const payload = await response.json();
  const text = extractResponseText(payload);
  if (!text) throw new Error("OpenAI 評分完成，但沒有回傳內容。");

  let report: any;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error("OpenAI 評分 JSON 解析失敗。");
  }

  if (!Array.isArray(report.question_reviews) || report.question_reviews.length !== 10) {
    throw new Error(
      `Q1～Q10 報告不完整，目前只有 ${report.question_reviews?.length ?? 0} 題。`
    );
  }

  report.question_reviews.sort(
    (a: any, b: any) => a.question_number - b.question_number
  );

  for (let i = 1; i <= 10; i++) {
    if (report.question_reviews[i - 1]?.question_number !== i) {
      throw new Error(`逐題報告缺少 Question ${i}。`);
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
    report_version: "organized-v6-exam-calibrated",
    grading_policy_version: "exam-calibrated-phase14b",
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

  return {
    content,
    organization,
    grammar,
    vocabulary,
    fluency,
    total,
    passed,
    report,
    gradingJson,
  };
}

export async function gradeExamItemLevels(args: {
  openai: string;
  model: string;
  transcript: string;
  itemFeedback: any;
  gradingJson: any;
}) {
  const { openai, model, transcript, itemFeedback, gradingJson } = args;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openai}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You are grading a formal English speaking mock exam. Apply a supportive, communicative-success-first calibration. " +
            ITEM_LEVEL_RUBRIC +
            "\nReturn only valid JSON matching the schema. Use integer levels 0-5 only. Never penalize pauses, unused time, late starts, or a trailing sentence cut off by the answer-time boundary after the core question has already been answered.",
        },
        {
          role: "user",
          content:
            "Assign the 12 item-level grades for this formal mock exam.\n\n" +
            "TRANSCRIPT:\n" +
            transcript +
            "\n\nEXISTING ITEM FEEDBACK:\n" +
            JSON.stringify(itemFeedback ?? {}) +
            "\n\nEXISTING GRADING JSON:\n" +
            JSON.stringify(gradingJson),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "speaking_exam_item_level_grades",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["part1", "part2", "part3"],
            properties: {
              part1: {
                type: "object",
                additionalProperties: false,
                required: ["key", "label", "level", "rationale"],
                properties: {
                  key: { type: "string", const: "part1" },
                  label: { type: "string" },
                  level: { type: "integer", minimum: 0, maximum: 5 },
                  rationale: { type: "string" },
                },
              },
              part2: {
                type: "array",
                minItems: 10,
                maxItems: 10,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["key", "label", "level", "rationale"],
                  properties: {
                    key: { type: "string" },
                    label: { type: "string" },
                    level: { type: "integer", minimum: 0, maximum: 5 },
                    rationale: { type: "string" },
                  },
                },
              },
              part3: {
                type: "object",
                additionalProperties: false,
                required: ["key", "label", "level", "rationale"],
                properties: {
                  key: { type: "string", const: "part3" },
                  label: { type: "string" },
                  level: { type: "integer", minimum: 0, maximum: 5 },
                  rationale: { type: "string" },
                },
              },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `逐題 0～5 級評分失敗：${(await response.text()).slice(0, 500)}`
    );
  }

  const raw = await response.json();
  const text = extractResponseText(raw);
  if (!text) throw new Error("逐題評分沒有回傳內容。");

  let parsed: any;
  try {
    parsed = normalizeItemLevelGrades(JSON.parse(text));
  } catch {
    throw new Error("逐題評分 JSON 解析失敗。");
  }

  if (!parsed) throw new Error("逐題評分資料不完整。");
  return parsed;
}
