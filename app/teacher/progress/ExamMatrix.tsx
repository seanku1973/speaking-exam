"use client";

import { useEffect, useMemo, useState } from "react";

type ExamSetOption = {
  id: string;
  code: string;
  title: string;
  is_active: boolean;
};

type MatrixRow = {
  student_id: string;
  student_name: string;
  student_username: string;
  session_id: string | null;
  date: string | null;
  total_score: number | null;
  part1: number | null;
  part2: Array<number | null>;
  part3: number | null;
  has_item_grades: boolean;
  status_text: string;
  attempts: number;
};

type MatrixPayload = {
  ok: boolean;
  message?: string;
  exam_sets: ExamSetOption[];
  selected_exam_set_id: string | null;
  selected_exam_set: ExamSetOption | null;
  rows: MatrixRow[];
};

function levelColor(level: number | null) {
  if (level === 5) return "#2563eb";
  if (level === 4) return "#16a34a";
  if (level === 3) return "#f59e0b";
  if (level === 2) return "#f97316";
  if (level === 1) return "#ef4444";
  if (level === 0) return "#b91c1c";
  return "#94a3b8";
}

function totalColor(score: number | null) {
  if (score === null) return "#94a3b8";
  return score >= 80 ? "#16a34a" : "#dc2626";
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function ScoreCell({ value }: { value: number | null }) {
  return (
    <td
      style={{
        minWidth: 52,
        padding: "12px 8px",
        textAlign: "center",
        borderBottom: "1px solid #eef2f7",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <strong
        style={{
          color: levelColor(value),
          fontSize: 18,
          fontWeight: 950,
        }}
      >
        {value === null ? "—" : value}
      </strong>
    </td>
  );
}

export default function ExamMatrix({
  open,
  onClose,
  onOpenReport,
}: {
  open: boolean;
  onClose: () => void;
  onOpenReport: (sessionId: string) => void;
}) {
  const [data, setData] = useState<MatrixPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState("");

  async function load(examSetId?: string) {
    try {
      setLoading(true);
      setError("");

      const query = examSetId
        ? `?exam_set_id=${encodeURIComponent(examSetId)}`
        : "";

      const response = await fetch(`/api/teacher/exam-matrix${query}`, {
        cache: "no-store",
      });

      const raw = await response.text();
      let body: any = {};

      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(
          `全班答題表 API 回傳格式錯誤（HTTP ${response.status}）。`
        );
      }

      if (!response.ok || !body.ok) {
        throw new Error(body.message || "無法載入全班答題表。");
      }

      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入失敗。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  const stats = useMemo(() => {
    const rows = data?.rows || [];
    const tested = rows.filter((row) => row.session_id).length;
    const scored = rows.filter((row) => row.total_score !== null).length;
    const complete = rows.filter((row) => row.has_item_grades).length;
    const missingGrades = rows.filter(
      (row) =>
        row.session_id &&
        row.total_score !== null &&
        !row.has_item_grades
    ).length;

    return {
      students: rows.length,
      tested,
      scored,
      complete,
      missingGrades,
    };
  }, [data]);

  async function backfillAll() {
    const targets = (data?.rows || []).filter(
      (row) =>
        row.session_id &&
        row.total_score !== null &&
        !row.has_item_grades
    );

    if (targets.length === 0) return;

    try {
      setBackfillBusy(true);
      setError("");

      for (let i = 0; i < targets.length; i++) {
        const row = targets[i];
        setBackfillProgress(
          `正在補評 ${i + 1} / ${targets.length}：${row.student_name}`
        );

        const response = await fetch(
          `/api/teacher/session/${row.session_id}/item-grades`,
          { method: "POST" }
        );

        const raw = await response.text();
        let body: any = {};

        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          throw new Error(`${row.student_name} 的補評回傳格式錯誤。`);
        }

        if (!response.ok || !body.ok) {
          throw new Error(
            `${row.student_name}：${body.message || "逐題等級補評失敗"}`
          );
        }
      }

      setBackfillProgress("補評完成，正在重新整理...");
      await load(data?.selected_exam_set_id || undefined);
      setBackfillProgress("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "補評失敗。");
    } finally {
      setBackfillBusy(false);
    }
  }

  function exportCsv() {
    if (!data) return;

    const header = [
      "Student",
      "Username",
      "Part1",
      ...Array.from({ length: 10 }, (_, i) => `Q${i + 1}`),
      "Part3",
      "Total",
      "Status",
      "Date",
    ];

    const lines = data.rows.map((row) => [
      row.student_name,
      row.student_username,
      row.part1 ?? "",
      ...row.part2.map((x) => x ?? ""),
      row.part3 ?? "",
      row.total_score ?? "",
      row.status_text,
      row.date ?? "",
    ]);

    const escape = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;

    const csv = [header, ...lines]
      .map((line) => line.map(escape).join(","))
      .join("\r\n");

    const blob = new Blob(["\uFEFF", csv], {
      type: "text/csv;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${data.selected_exam_set?.code || "exam"}-class-matrix.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        background: "rgba(15,23,42,.45)",
        padding: 22,
        overflow: "auto",
      }}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        style={{
          width: "min(1500px, 100%)",
          minHeight: "min(780px, calc(100vh - 44px))",
          margin: "0 auto",
          borderRadius: 22,
          background: "#f8fafc",
          boxShadow: "0 24px 80px rgba(15,23,42,.25)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 20,
            padding: "22px 24px",
            background: "#fff",
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          <div>
            <div
              style={{
                color: "#2563eb",
                fontSize: 10,
                fontWeight: 950,
                letterSpacing: ".14em",
              }}
            >
              CLASS SCORE MATRIX
            </div>
            <h2
              style={{
                margin: "5px 0 0",
                color: "#0f172a",
                fontSize: 25,
                fontWeight: 950,
              }}
            >
              全班答題分數表
            </h2>
            <p
              style={{
                margin: "7px 0 0",
                color: "#64748b",
                fontSize: 12,
              }}
            >
              選擇測驗題組，一次查看所有學生 Part 1、Q1～Q10、Part 3 與總分。
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              width: 40,
              height: 40,
              border: 0,
              borderRadius: 10,
              background: "#f1f5f9",
              color: "#475569",
              fontSize: 24,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </header>

        <div style={{ padding: 20 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "end",
              justifyContent: "space-between",
              gap: 14,
              padding: 16,
              borderRadius: 16,
              border: "1px solid #e2e8f0",
              background: "#fff",
            }}
          >
            <div style={{ minWidth: 280 }}>
              <label
                style={{
                  display: "block",
                  marginBottom: 6,
                  color: "#64748b",
                  fontSize: 10,
                  fontWeight: 900,
                }}
              >
                測驗題組
              </label>
              <select
                value={data?.selected_exam_set_id || ""}
                onChange={(e) => load(e.target.value)}
                disabled={loading}
                style={{
                  width: "100%",
                  minHeight: 42,
                  border: "1px solid #cbd5e1",
                  borderRadius: 10,
                  padding: "0 12px",
                  background: "#fff",
                  color: "#0f172a",
                  fontWeight: 800,
                }}
              >
                {(data?.exam_sets || []).map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.title} ({exam.code})
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
              }}
            >
              <button
                type="button"
                onClick={() => load(data?.selected_exam_set_id || undefined)}
                disabled={loading || backfillBusy}
                style={{
                  minHeight: 40,
                  border: "1px solid #cbd5e1",
                  borderRadius: 10,
                  padding: "0 13px",
                  background: "#fff",
                  color: "#334155",
                  fontWeight: 850,
                  cursor: "pointer",
                }}
              >
                重新整理
              </button>

              {stats.missingGrades > 0 && (
                <button
                  type="button"
                  onClick={backfillAll}
                  disabled={backfillBusy}
                  style={{
                    minHeight: 40,
                    border: 0,
                    borderRadius: 10,
                    padding: "0 13px",
                    background: "#2563eb",
                    color: "#fff",
                    fontWeight: 900,
                    cursor: backfillBusy ? "not-allowed" : "pointer",
                    opacity: backfillBusy ? 0.65 : 1,
                  }}
                >
                  {backfillBusy
                    ? backfillProgress || "補評中..."
                    : `補齊缺少的 0～5 成績 (${stats.missingGrades})`}
                </button>
              )}

              <button
                type="button"
                onClick={exportCsv}
                disabled={!data?.rows?.length}
                style={{
                  minHeight: 40,
                  border: 0,
                  borderRadius: 10,
                  padding: "0 13px",
                  background: "#0f172a",
                  color: "#fff",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                匯出班級表 CSV
              </button>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,minmax(0,1fr))",
              gap: 10,
              marginTop: 12,
            }}
          >
            {[
              ["學生人數", stats.students],
              ["已有測驗紀錄", stats.tested],
              ["已有總分", stats.scored],
              ["逐題等級完成", stats.complete],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 13,
                  background: "#fff",
                  padding: "12px 14px",
                }}
              >
                <span
                  style={{
                    display: "block",
                    color: "#64748b",
                    fontSize: 10,
                    fontWeight: 850,
                  }}
                >
                  {label}
                </span>
                <strong
                  style={{
                    display: "block",
                    marginTop: 2,
                    color: "#0f172a",
                    fontSize: 22,
                    fontWeight: 950,
                  }}
                >
                  {value}
                </strong>
              </div>
            ))}
          </div>

          {error && (
            <div
              style={{
                marginTop: 12,
                border: "1px solid #fecaca",
                borderRadius: 12,
                background: "#fff1f2",
                color: "#b91c1c",
                padding: 12,
                fontSize: 12,
                fontWeight: 750,
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              marginTop: 12,
              border: "1px solid #e2e8f0",
              borderRadius: 16,
              background: "#fff",
              overflow: "auto",
            }}
          >
            {loading ? (
              <div
                style={{
                  padding: 45,
                  textAlign: "center",
                  color: "#64748b",
                  fontWeight: 800,
                }}
              >
                正在載入全班答題表...
              </div>
            ) : (
              <table
                style={{
                  width: "100%",
                  minWidth: 1180,
                  borderCollapse: "separate",
                  borderSpacing: 0,
                }}
              >
                <thead>
                  <tr>
                    <th
                      rowSpan={2}
                      style={{
                        position: "sticky",
                        left: 0,
                        zIndex: 4,
                        minWidth: 165,
                        padding: 10,
                        background: "#f8fafc",
                        borderBottom: "1px solid #dbe4ef",
                        textAlign: "left",
                        color: "#334155",
                        fontSize: 11,
                      }}
                    >
                      學生
                    </th>
                    <th
                      rowSpan={2}
                      style={{
                        minWidth: 70,
                        background: "#eef2ff",
                        borderBottom: "1px solid #dbe4ef",
                        color: "#3730a3",
                        fontSize: 11,
                      }}
                    >
                      Part 1
                    </th>
                    <th
                      colSpan={10}
                      style={{
                        padding: 9,
                        background: "#eff6ff",
                        borderBottom: "1px solid #dbe4ef",
                        color: "#1d4ed8",
                        fontSize: 11,
                        letterSpacing: ".06em",
                      }}
                    >
                      Part 2｜回答問題
                    </th>
                    <th
                      rowSpan={2}
                      style={{
                        minWidth: 70,
                        background: "#f0fdf4",
                        borderBottom: "1px solid #dbe4ef",
                        color: "#166534",
                        fontSize: 11,
                      }}
                    >
                      Part 3
                    </th>
                    <th
                      rowSpan={2}
                      style={{
                        minWidth: 76,
                        background: "#fff7ed",
                        borderBottom: "1px solid #dbe4ef",
                        color: "#9a3412",
                        fontSize: 11,
                      }}
                    >
                      Total
                    </th>
                    <th
                      rowSpan={2}
                      style={{
                        minWidth: 105,
                        background: "#f8fafc",
                        borderBottom: "1px solid #dbe4ef",
                        color: "#334155",
                        fontSize: 11,
                      }}
                    >
                      狀態
                    </th>
                    <th
                      rowSpan={2}
                      style={{
                        minWidth: 82,
                        background: "#f8fafc",
                        borderBottom: "1px solid #dbe4ef",
                      }}
                    />
                  </tr>
                  <tr>
                    {Array.from({ length: 10 }, (_, i) => (
                      <th
                        key={i}
                        style={{
                          minWidth: 52,
                          padding: "8px 4px",
                          background: "#f8fbff",
                          borderBottom: "1px solid #dbe4ef",
                          color: "#475569",
                          fontSize: 10,
                        }}
                      >
                        Q{i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {(data?.rows || []).map((row) => (
                    <tr key={row.student_id}>
                      <td
                        style={{
                          position: "sticky",
                          left: 0,
                          zIndex: 2,
                          padding: "11px 10px",
                          background: "#fff",
                          borderBottom: "1px solid #eef2f7",
                        }}
                      >
                        <strong
                          style={{
                            display: "block",
                            color: "#0f172a",
                            fontSize: 12,
                            fontWeight: 900,
                          }}
                        >
                          {row.student_name}
                        </strong>
                        <span
                          style={{
                            display: "block",
                            marginTop: 2,
                            color: "#94a3b8",
                            fontSize: 9,
                          }}
                        >
                          {row.student_username || "—"}
                          {row.attempts > 1 ? ` · ${row.attempts} 次` : ""}
                        </span>
                      </td>

                      <ScoreCell value={row.part1} />
                      {Array.from({ length: 10 }, (_, i) => (
                        <ScoreCell key={i} value={row.part2[i] ?? null} />
                      ))}
                      <ScoreCell value={row.part3} />

                      <td
                        style={{
                          padding: "12px 8px",
                          textAlign: "center",
                          borderBottom: "1px solid #eef2f7",
                        }}
                      >
                        <strong
                          style={{
                            color: totalColor(row.total_score),
                            fontSize: 18,
                            fontWeight: 950,
                          }}
                        >
                          {row.total_score === null ? "—" : row.total_score}
                        </strong>
                      </td>

                      <td
                        style={{
                          padding: "9px 7px",
                          textAlign: "center",
                          borderBottom: "1px solid #eef2f7",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-block",
                            borderRadius: 999,
                            padding: "5px 8px",
                            background: row.has_item_grades
                              ? "#ecfdf5"
                              : row.total_score !== null
                                ? "#fff7ed"
                                : "#f1f5f9",
                            color: row.has_item_grades
                              ? "#166534"
                              : row.total_score !== null
                                ? "#9a3412"
                                : "#64748b",
                            fontSize: 9,
                            fontWeight: 900,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.status_text}
                        </span>
                        <small
                          style={{
                            display: "block",
                            marginTop: 4,
                            color: "#94a3b8",
                            fontSize: 8,
                          }}
                        >
                          {fmtDate(row.date)}
                        </small>
                      </td>

                      <td
                        style={{
                          padding: "9px 8px",
                          textAlign: "center",
                          borderBottom: "1px solid #eef2f7",
                        }}
                      >
                        {row.session_id ? (
                          <button
                            type="button"
                            onClick={() => onOpenReport(row.session_id!)}
                            style={{
                              minHeight: 32,
                              border: 0,
                              borderRadius: 8,
                              padding: "0 10px",
                              background: "#eff6ff",
                              color: "#1d4ed8",
                              fontSize: 9,
                              fontWeight: 900,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            查看報告
                          </button>
                        ) : (
                          <span style={{ color: "#cbd5e1" }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}

                  {(data?.rows || []).length === 0 && (
                    <tr>
                      <td
                        colSpan={16}
                        style={{
                          padding: 40,
                          textAlign: "center",
                          color: "#64748b",
                        }}
                      >
                        目前沒有學生資料。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              marginTop: 11,
              color: "#64748b",
              fontSize: 10,
              fontWeight: 800,
            }}
          >
            <span><b style={{ color: "#2563eb" }}>5</b> 優異</span>
            <span><b style={{ color: "#16a34a" }}>4</b> 良好</span>
            <span><b style={{ color: "#f59e0b" }}>3</b> 達成</span>
            <span><b style={{ color: "#f97316" }}>2</b> 有限</span>
            <span><b style={{ color: "#ef4444" }}>1</b> 極少</span>
            <span><b style={{ color: "#b91c1c" }}>0</b> 無有效作答</span>
            <span><b style={{ color: "#94a3b8" }}>—</b> 尚無逐題成績</span>
          </div>
        </div>
      </section>
    </div>
  );
}
