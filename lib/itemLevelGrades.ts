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

5 = Fully successful: complete, directly relevant, clear and natural; very few language problems.
4 = Successful: relevant and generally complete; minor problems do not prevent clear communication.
3 = Adequate: basic task completed and understandable, but content or language is noticeably limited.
2 = Limited: partial/incomplete response; frequent problems or weak relevance interfere with communication.
1 = Minimal: very little valid language/content; severely incomplete or mostly off-topic.
0 = No scorable response: no answer, empty/unintelligible response, or no valid evidence.

Task rules:
- Part 1 Reading Aloud: ONE integrated 0-5 grade for the whole reading.
- Part 2: Q1-Q10 EACH receive one separate integer 0-5 grade.
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
