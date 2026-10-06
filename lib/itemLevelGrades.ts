/* PHASE11C_ITEM_LEVEL_GRADES */
export type ItemLevelGrade = {
  key: string;
  label: string;
  level: number;
  rationale?: string;
};

export type ItemLevelGradeBundle = {
  part1: ItemLevelGrade;
  part2: ItemLevelGrade[];
  part3: ItemLevelGrade;
};

export const ITEM_LEVEL_RUBRIC = `
Assign an integer performance level from 0 to 5 for each speaking item.

This formal mock-exam grading policy prioritizes communicative success and whether the student actually answers the task. Do not make silence length or answer-window usage a scoring target.

5 = Fully successful: the response clearly answers the task and is understandable. Minor grammar/vocabulary problems are acceptable if meaning stays clear. Extra elaboration is NOT required when the question has already been answered.
4 = Successful: the response is on-topic and understandable, with some language limitations or minor missing detail, but communication is successful.
3 = Adequate: the response addresses the task only partly, or recurring language problems noticeably limit clarity, but the main idea can still be understood.
2 = Limited: the response only partially addresses the task, is frequently unclear, or lacks enough valid content to demonstrate the requested answer.
1 = Minimal: very little valid task-related language/content is produced.
0 = No scorable response: no relevant answer or no usable evidence.

NON-PENALTY RULES — MANDATORY:
- Do NOT deduct any level because the student is silent for a few seconds before, during, or after an answer.
- Do NOT deduct because the student starts late, pauses, or leaves unused answer time.
- Do NOT deduct because the recording/timing window cuts off a FINAL unfinished sentence AFTER the student has already answered the question. Ignore that trailing fragment when grading grammar, completion, organization, and fluency.
- Do NOT call an answer incomplete merely because the last sentence is cut off by the time boundary if an earlier sentence already gives a relevant answer.
- Do NOT require extra examples, reasons, or details unless the actual question asks for them. A concise but relevant answer may still earn 4 or 5.
- Fluency must be judged only from the spoken language that is actually produced. Blank intervals, recording-window boundaries, and post-answer silence are NOT fluency penalties.

Task rules:
- Part 1 Reading Aloud: ONE integrated 0-5 grade for the whole reading. Judge actual reading performance; do not penalize silence before/after it and do not treat the printed passage's grammar/content as the student's own language production.
- Part 2: Q1-Q10 EACH receive one separate integer 0-5 grade. Relevance and communicative success come first.
- Part 3 Picture Description: ONE integrated 0-5 grade for the entire 90-second description.
- These item grades remain separate from the existing 100-point score.
`;

export function normalizeItemLevelGrades(value: any): ItemLevelGradeBundle | null {
  if (!value || typeof value !== "object") return null;

  const clamp = (n: any) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return null;
    return Math.max(0, Math.min(5, Math.round(x)));
  };

  const norm = (item: any, key: string, label: string): ItemLevelGrade | null => {
    if (!item || typeof item !== "object") return null;
    const level = clamp(item.level ?? item.score ?? item.grade);
    if (level === null) return null;
    return {
      key,
      label,
      level,
      rationale:
        typeof item.rationale === "string"
          ? item.rationale
          : typeof item.reason === "string"
            ? item.reason
            : "",
    };
  };

  const part1 = norm(value.part1, "part1", "第一部分：朗讀");
  const part3 = norm(value.part3, "part3", "第三部分：看圖敘述");
  const rawPart2 = Array.isArray(value.part2) ? value.part2 : [];
  const part2: ItemLevelGrade[] = [];

  for (let i = 1; i <= 10; i++) {
    const key = `q${i}`;
    const candidate =
      rawPart2.find((x: any) => String(x?.key || "").toLowerCase() === key) ??
      rawPart2[i - 1];
    const item = norm(candidate, key, `Q${i}`);
    if (item) part2.push(item);
  }

  if (!part1 || !part3 || part2.length !== 10) return null;
  return { part1, part2, part3 };
}
