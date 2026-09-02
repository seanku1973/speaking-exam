import { NextRequest, NextResponse } from "next/server";
import {
  TEACHER_COOKIE_NAME,
  verifyTeacherToken,
} from "@/lib/teacherAuth";
import { createTeacherAdminSupabase } from "@/lib/teacherSupabase";
import {
  ITEM_LEVEL_RUBRIC,
  normalizeItemLevelGrades,
} from "@/lib/itemLevelGrades";

export const runtime = "nodejs";
export const maxDuration = 300;

function extractResponsesText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  return (
    payload?.output
      ?.flatMap((item: any) => item?.content || [])
      ?.map((content: any) => content?.text || "")
      ?.join("")
      ?.trim() || ""
  );
}

export async function POST(
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

  try {
    const { id: sessionId } = await context.params;
    const supabase = createTeacherAdminSupabase();

    const { data: result, error } = await supabase
      .from("exam_results")
      .select("id,session_id,transcript,grading_json,item_feedback")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (error) throw new Error(`讀取測驗結果失敗：${error.message}`);

    if (!result) {
      return NextResponse.json(
        { ok: false, message: "找不到這筆測驗的 AI 評分結果。" },
        { status: 404 }
      );
    }

    const existingJson =
      result.grading_json && typeof result.grading_json === "object"
        ? result.grading_json
        : {};

    const existingGrades = normalizeItemLevelGrades(
      existingJson?.item_level_grades
    );

    if (existingGrades) {
      return NextResponse.json({
        ok: true,
        already_exists: true,
        item_level_grades: existingGrades,
      });
    }

    const transcript =
      typeof result.transcript === "string"
        ? result.transcript.trim()
        : "";

    if (!transcript) {
      return NextResponse.json(
        {
          ok: false,
          message: "這筆測驗沒有 Transcript，因此無法補評逐題 0～5 級。",
        },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("伺服器未設定 OPENAI_API_KEY。");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_GRADING_MODEL || "gpt-5.6-luna",
        input: [
          {
            role: "system",
            content:
              "You are grading an English speaking test. " +
              ITEM_LEVEL_RUBRIC +
              "\nReturn only valid JSON matching the schema. " +
              "Use integer levels 0-5 only. " +
              "Do not invent unsupported pronunciation details.",
          },
          {
            role: "user",
            content:
              "Assign 12 diagnostic item-level grades for this completed speaking test.\n\n" +
              "TRANSCRIPT:\n" +
              transcript +
              "\n\nEXISTING ITEM FEEDBACK:\n" +
              JSON.stringify(result.item_feedback ?? {}) +
              "\n\nEXISTING GRADING JSON:\n" +
              JSON.stringify(existingJson),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "speaking_item_level_grades",
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
        `OpenAI 逐題等級評分失敗（HTTP ${response.status}）：${(
          await response.text()
        ).slice(0, 400)}`
      );
    }

    const raw = await response.json();
    const text = extractResponsesText(raw);
    if (!text) throw new Error("OpenAI 沒有回傳逐題等級 JSON。");

    const parsed = normalizeItemLevelGrades(JSON.parse(text));
    if (!parsed) throw new Error("OpenAI 回傳的逐題等級資料不完整。");

    const update = await supabase
      .from("exam_results")
      .update({
        grading_json: {
          ...existingJson,
          item_level_grades: parsed,
          item_level_grades_version: "phase11c-v1",
        },
      })
      .eq("session_id", sessionId);

    if (update.error) {
      throw new Error(`儲存逐題等級失敗：${update.error.message}`);
    }

    return NextResponse.json({
      ok: true,
      item_level_grades: parsed,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "逐題 0～5 級評定失敗。",
      },
      { status: 500 }
    );
  }
}
