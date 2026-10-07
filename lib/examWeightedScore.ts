import { normalizeItemLevelGrades } from "@/lib/itemLevelGrades";

export type WeightedExamScore = {
  part1Level: number;
  part2Levels: number[];
  part2Average: number;
  part3Level: number;
  weightedLevel: number;
  part1Points: number;
  part2Points: number;
  part3Points: number;
  total: number;
  passed: boolean;
};

export function calculateWeightedExamScore(value: unknown): WeightedExamScore | null {
  const grades = normalizeItemLevelGrades(value);
  if (!grades) return null;

  const part1Level = Number(grades.part1.level);
  const part2Levels = grades.part2.map((item) => Number(item.level));
  const part3Level = Number(grades.part3.level);

  if (part2Levels.length !== 10) return null;

  const part2Average =
    part2Levels.reduce((sum, value) => sum + value, 0) / part2Levels.length;

  const weightedLevel =
    part1Level * 0.2 + part2Average * 0.3 + part3Level * 0.5;

  const part1Points = part1Level * 4;
  const part2Points = part2Average * 6;
  const part3Points = part3Level * 10;
  const total = Math.round(weightedLevel * 20);

  return {
    part1Level,
    part2Levels,
    part2Average: Number(part2Average.toFixed(2)),
    part3Level,
    weightedLevel: Number(weightedLevel.toFixed(3)),
    part1Points: Number(part1Points.toFixed(1)),
    part2Points: Number(part2Points.toFixed(1)),
    part3Points: Number(part3Points.toFixed(1)),
    total,
    passed: total >= 80,
  };
}

export function weightedScoreJson(score: WeightedExamScore) {
  return {
    version: "part-weighted-v1",
    scale: "0-5 converted to 0-100",
    weights: {
      part1: 0.2,
      part2: 0.3,
      part3: 0.5,
    },
    part1_level: score.part1Level,
    part2_levels: score.part2Levels,
    part2_average: score.part2Average,
    part3_level: score.part3Level,
    weighted_level: score.weightedLevel,
    part1_points: score.part1Points,
    part2_points: score.part2Points,
    part3_points: score.part3Points,
    total_score: score.total,
    passed: score.passed,
  };
}
