/* PHASE12_CLASS_SCORE_MATRIX */
/* PHASE11C_DISPLAY_AND_BACKFILL */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import ExamMatrix from "./ExamMatrix";

type Row = {
  session_id: string;
  student_id: string;
  student_name: string;
  student_username: string;
  exam_set_id: string;
  exam_code: string;
  exam_title: string;
  date: string | null;
  status: string;
  grading_status: string;
  recording_path: string;
  upload_status: string;
  total_score: number | null;
  passed: boolean | null;
  report_version: string;
  graded_at: string | null;
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

type ItemLevelGrade = {
  key?: string;
  label?: string;
  level?: number;
  rationale?: string;
};

type ItemLevelGradeBundle = {
  part1?: ItemLevelGrade;
  part2?: ItemLevelGrade[];
  part3?: ItemLevelGrade;
};

type Detail = {
  session: any;
  result: any;
  student: { id: string; name: string; username?: string; profile: any };
  exam_set: any;
  recording_url: string | null;
  history: Array<{
    session_id: string;
    date: string | null;
    exam_title: string;
    total_score: number | null;
    status: string;
    report_version: string;
  }>;
};

type ViewMode = "scored" | "pending" | "all";
type DetailTab = "overview" | "reading" | "questions" | "picture" | "transcript" | "history";

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function scoreTone(score: number | null) {
  if (score === null) return "neutral";
  return score >= 80 ? "pass" : "fail";
}

function resultLabel(score: number | null) {
  if (score === null) return "尚未評分";
  return score >= 80 ? "PASS" : "NOT PASS";
}

function sessionLabel(status: string, gradingStatus: string) {
  const combined = `${status} ${gradingStatus}`.toLowerCase();

  if (combined.includes("failed")) {
    return { text: "異常 / 失敗", tone: "error" };
  }
  if (status === "completed") {
    return { text: "已完成", tone: "success" };
  }
  if (status === "uploaded") {
    return { text: "等待 AI 評分", tone: "warning" };
  }
  if (status === "grading" || status === "transcribing") {
    return { text: "AI 處理中", tone: "info" };
  }
  if (status === "ready" || status === "teacher_verified") {
    return { text: "未完成測驗", tone: "neutral" };
  }
  if (status === "recording" || status === "audio_finished") {
    return { text: "測驗進行中", tone: "info" };
  }
  return { text: status || "未知", tone: "neutral" };
}

function questionStatus(status?: string) {
  if (status === "strong") {
    return { label: "表現良好", tone: "good" };
  }
  if (status === "adequate") {
    return { label: "基本達成", tone: "ok" };
  }
  if (status === "needs_improvement") {
    return { label: "需要加強", tone: "warn" };
  }
  return { label: "未充分作答", tone: "bad" };
}


function normalizeLevel(value: unknown) {
  const level = Number(value);
  if (!Number.isFinite(level)) return null;
  return Math.max(0, Math.min(5, Math.round(level)));
}

function itemLevelStyle(level: number | null) {
  if (level === null) {
    return {
      background: "#f8fafc",
      border: "1px solid #e2e8f0",
      color: "#94a3b8",
    };
  }

  if (level >= 4) {
    return {
      background: "#ecfdf5",
      border: "1px solid #bbf7d0",
      color: "#166534",
    };
  }

  if (level === 3) {
    return {
      background: "#fffbeb",
      border: "1px solid #fde68a",
      color: "#92400e",
    };
  }

  return {
    background: "#fff1f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
  };
}

function ItemLevelBadge({
  level,
  label,
  compact = false,
}: {
  level: unknown;
  label?: string;
  compact?: boolean;
}) {
  const normalized = normalizeLevel(level);
  const tone = itemLevelStyle(normalized);

  return (
    <div
      style={{
        ...tone,
        minWidth: compact ? 54 : 72,
        minHeight: compact ? 34 : 48,
        borderRadius: 10,
        padding: compact ? "6px 9px" : "8px 12px",
        display: "inline-flex",
        alignItems: "baseline",
        justifyContent: "center",
        gap: 3,
        fontWeight: 900,
        whiteSpace: "nowrap",
      }}
      aria-label={`${label || "題目"}等級 ${
        normalized === null ? "尚未評定" : `${normalized} / 5`
      }`}
    >
      {label && !compact && (
        <span
          style={{
            marginRight: 5,
            fontSize: 11,
            fontWeight: 800,
            opacity: 0.8,
          }}
        >
          {label}
        </span>
      )}
      <strong style={{ fontSize: compact ? 15 : 20, lineHeight: 1 }}>
        {normalized === null ? "—" : normalized}
      </strong>
      <small style={{ fontSize: compact ? 9 : 10, fontWeight: 800 }}>/ 5</small>
    </div>
  );
}

export default function TeacherProgressPage() {
  const router = useRouter();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [mode, setMode] = useState<ViewMode>("scored");
  const [search, setSearch] = useState("");
  const [examSet, setExamSet] = useState("all");
  const [resultStatus, setResultStatus] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [activeQuestion, setActiveQuestion] = useState(1);
  const [itemGradeLoading, setItemGradeLoading] = useState(false);
  const [itemGradeMessage, setItemGradeMessage] = useState("");
  const [matrixOpen, setMatrixOpen] = useState(false);

  async function loadDashboard() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch("/api/teacher/dashboard", {
        cache: "no-store",
      });

      if (response.status === 401) {
        router.replace("/teacher-login");
        return;
      }

      const raw = await response.text();
      let body: any = {};

      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(`老師成績 API 回傳格式錯誤（HTTP ${response.status}）。`);
      }

      if (!response.ok || !body.ok) {
        throw new Error(body.message || "無法載入老師成績管理資料。");
      }

      setRows(Array.isArray(body.rows) ? body.rows : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入失敗。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  async function openDetail(sessionId: string) {
    try {
      setSelectedId(sessionId);
      setDetail(null);
      setDetailError("");
      setDetailLoading(true);
      setDetailTab("overview");
      setActiveQuestion(1);

      const response = await fetch(`/api/teacher/session/${sessionId}`, {
        cache: "no-store",
      });

      if (response.status === 401) {
        router.replace("/teacher-login");
        return;
      }

      const raw = await response.text();
      let body: any = {};

      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(`詳細資料 API 回傳格式錯誤（HTTP ${response.status}）。`);
      }

      if (!response.ok || !body.ok) {
        throw new Error(body.message || "無法載入測驗詳細資料。");
      }

      setDetail(body.detail);
    } catch (err) {
      setDetailError(
        err instanceof Error ? err.message : "載入詳細資料失敗。"
      );
    } finally {
      setDetailLoading(false);
    }
  }

  async function generateItemGrades() {
    if (!selectedId) return;

    try {
      setItemGradeLoading(true);
      setItemGradeMessage("");

      const response = await fetch(
        `/api/teacher/session/${selectedId}/item-grades`,
        { method: "POST" }
      );

      if (response.status === 401) {
        router.replace("/teacher-login");
        return;
      }

      const raw = await response.text();
      let body: any = {};

      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(
          `逐題等級 API 回傳格式錯誤（HTTP ${response.status}）。`
        );
      }

      if (!response.ok || !body.ok) {
        throw new Error(body.message || "無法產生逐題 0～5 級成績。");
      }

      setItemGradeMessage("逐題 0～5 級成績已完成。");
      await openDetail(selectedId);
    } catch (err) {
      setItemGradeMessage(
        err instanceof Error ? err.message : "逐題等級評定失敗。"
      );
    } finally {
      setItemGradeLoading(false);
    }
  }

  async function logout() {
    await fetch("/api/teacher/logout", { method: "POST" });
    router.replace("/teacher-login");
  }

  const examOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((row) => {
      if (row.exam_set_id) map.set(row.exam_set_id, row.exam_title);
    });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const metrics = useMemo(() => {
    const scored = rows.filter((row) => row.total_score !== null);
    const passed = scored.filter((row) => Number(row.total_score) >= 80);
    const pending = rows.filter(
      (row) =>
        row.total_score === null &&
        !`${row.status} ${row.grading_status}`.toLowerCase().includes("failed")
    );
    const failed = rows.filter((row) =>
      `${row.status} ${row.grading_status}`.toLowerCase().includes("failed")
    );

    const average = scored.length
      ? scored.reduce((sum, row) => sum + Number(row.total_score || 0), 0) /
        scored.length
      : 0;

    return {
      attempts: rows.length,
      scored: scored.length,
      pending: pending.length,
      failed: failed.length,
      average,
      passRate: scored.length ? (passed.length / scored.length) * 100 : 0,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (mode === "scored" && row.total_score === null) return false;
      if (mode === "pending" && row.total_score !== null) return false;

      if (
        needle &&
        !`${row.student_name} ${row.student_username} ${row.exam_title} ${row.exam_code}`
          .toLowerCase()
          .includes(needle)
      ) {
        return false;
      }

      if (examSet !== "all" && row.exam_set_id !== examSet) return false;

      if (
        resultStatus === "pass" &&
        !(row.total_score !== null && row.total_score >= 80)
      ) {
        return false;
      }

      if (
        resultStatus === "not-pass" &&
        !(row.total_score !== null && row.total_score < 80)
      ) {
        return false;
      }

      if (resultStatus === "unscored" && row.total_score !== null) {
        return false;
      }

      if (
        resultStatus === "failed" &&
        !`${row.status} ${row.grading_status}`.toLowerCase().includes("failed")
      ) {
        return false;
      }

      const time = row.date ? new Date(row.date).getTime() : 0;

      if (fromDate) {
        const from = new Date(`${fromDate}T00:00:00`).getTime();
        if (!time || time < from) return false;
      }

      if (toDate) {
        const to = new Date(`${toDate}T23:59:59`).getTime();
        if (!time || time > to) return false;
      }

      return true;
    });
  }, [rows, mode, search, examSet, resultStatus, fromDate, toDate]);

  function clearFilters() {
    setSearch("");
    setExamSet("all");
    setResultStatus("all");
    setFromDate("");
    setToDate("");
  }

  function exportCsv() {
    const header = [
      "Student",
      "Username",
      "Exam",
      "ExamCode",
      "Date",
      "Score",
      "Result",
      "Status",
      "ReportVersion",
      "SessionID",
    ];

    const lines = filtered.map((row) => [
      row.student_name,
      row.student_username,
      row.exam_title,
      row.exam_code,
      row.date || "",
      row.total_score ?? "",
      row.total_score === null
        ? ""
        : row.total_score >= 80
          ? "PASS"
          : "NOT PASS",
      row.status,
      row.report_version,
      row.session_id,
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
    link.download = `speaking-exam-results-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const report = detail?.result?.grading_json || {};
  const itemLevelGrades: ItemLevelGradeBundle =
    report?.item_level_grades || {};

  const readingGrade = itemLevelGrades?.part1 || null;
  const pictureGrade = itemLevelGrades?.part3 || null;

  function getQuestionGrade(questionNumber: number) {
    const part2 = Array.isArray(itemLevelGrades?.part2)
      ? itemLevelGrades.part2
      : [];

    const key = `q${questionNumber}`;

    return (
      part2.find(
        (item) => String(item?.key || "").toLowerCase() === key
      ) ||
      part2[questionNumber - 1] ||
      null
    );
  }


  const questions = useMemo(() => {
    const source = Array.isArray(report?.question_reviews)
      ? report.question_reviews
      : [];
    return [...source].sort(
      (a: QuestionReview, b: QuestionReview) =>
        Number(a.question_number) - Number(b.question_number)
    );
  }, [report]);

  const selectedQuestion =
    questions.find(
      (q: QuestionReview) => Number(q.question_number) === activeQuestion
    ) || questions[0];

  if (loading) {
    return (
      <main className={styles.loadingPage}>
        <div className={styles.loadingCard}>
          <div className={styles.spinner} />
          <p>正在載入老師成績管理...</p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>SPEAKING EXAM · TEACHER</div>
            <h1 className={styles.title}>口說測驗成績管理</h1>
            <p className={styles.subtitle}>
              集中查看學生測驗、AI 評分、Q1～Q10 檢討、錄音與學習歷程
            </p>
          </div>

          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setMatrixOpen(true)}
            >
              全班答題表
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={loadDashboard}
            >
              重新整理
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={exportCsv}
            >
              匯出 CSV
            </button>
            <button
              type="button"
              className={styles.logoutButton}
              onClick={logout}
            >
              登出
            </button>
          </div>
        </header>

        {error && <div className={styles.errorBanner}>{error}</div>}

        <section className={styles.metricGrid}>
          <div className={styles.metricCard}>
            <span>全部場次</span>
            <strong>{metrics.attempts}</strong>
            <small>包含已完成與未完成測驗</small>
          </div>

          <div className={styles.metricCard}>
            <span>已評分</span>
            <strong>{metrics.scored}</strong>
            <small>已有 AI 總分的測驗</small>
          </div>

          <div className={styles.metricCard}>
            <span>平均分數</span>
            <strong>{metrics.scored ? metrics.average.toFixed(1) : "—"}</strong>
            <small>僅計算已評分測驗</small>
          </div>

          <div className={styles.metricCard}>
            <span>通過率</span>
            <strong>
              {metrics.scored ? `${metrics.passRate.toFixed(1)}%` : "—"}
            </strong>
            <small>80 分以上為 PASS</small>
          </div>

          <div className={styles.metricCard}>
            <span>待處理 / 異常</span>
            <strong>
              {metrics.pending}
              <em> / {metrics.failed}</em>
            </strong>
            <small>未評分 / 失敗</small>
          </div>
        </section>

        <section className={styles.workspace}>
          <div className={styles.workspaceHeader}>
            <div className={styles.viewTabs}>
              <button
                type="button"
                className={mode === "scored" ? styles.activeTab : styles.tab}
                onClick={() => setMode("scored")}
              >
                成績結果 <span>{metrics.scored}</span>
              </button>

              <button
                type="button"
                className={mode === "pending" ? styles.activeTab : styles.tab}
                onClick={() => setMode("pending")}
              >
                待處理 <span>{metrics.pending + metrics.failed}</span>
              </button>

              <button
                type="button"
                className={mode === "all" ? styles.activeTab : styles.tab}
                onClick={() => setMode("all")}
              >
                全部紀錄 <span>{metrics.attempts}</span>
              </button>
            </div>

            <div className={styles.resultCount}>
              顯示 <b>{filtered.length}</b> 筆
            </div>
          </div>

          <div className={styles.filters}>
            <div className={styles.searchField}>
              <label>搜尋</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="學生姓名、帳號或題組"
              />
            </div>

            <div>
              <label>題組</label>
              <select
                value={examSet}
                onChange={(e) => setExamSet(e.target.value)}
              >
                <option value="all">全部題組</option>
                {examOptions.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label>結果</label>
              <select
                value={resultStatus}
                onChange={(e) => setResultStatus(e.target.value)}
              >
                <option value="all">全部結果</option>
                <option value="pass">PASS</option>
                <option value="not-pass">NOT PASS</option>
                <option value="unscored">尚未評分</option>
                <option value="failed">異常 / 失敗</option>
              </select>
            </div>

            <div>
              <label>開始日期</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>

            <div>
              <label>結束日期</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>

            <button
              type="button"
              className={styles.clearButton}
              onClick={clearFilters}
            >
              清除
            </button>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>考生</th>
                  <th>題組</th>
                  <th>測驗時間</th>
                  <th>總分</th>
                  <th>測驗狀態</th>
                  <th aria-label="操作" />
                </tr>
              </thead>

              <tbody>
                {filtered.map((row) => {
                  const status = sessionLabel(
                    row.status,
                    row.grading_status
                  );
                  const tone = scoreTone(row.total_score);

                  return (
                    <tr key={row.session_id}>
                      <td>
                        <div className={styles.studentCell}>
                          <div className={styles.avatar}>
                            {(row.student_name || "?")
                              .trim()
                              .charAt(0)
                              .toUpperCase()}
                          </div>
                          <div>
                            <div className={styles.studentName}>
                              {row.student_name}
                            </div>
                            {row.student_username &&
                              row.student_username !== row.student_name && (
                                <div className={styles.muted}>
                                  {row.student_username}
                                </div>
                              )}
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className={styles.examTitle}>
                          {row.exam_title}
                        </div>
                        <div className={styles.muted}>{row.exam_code}</div>
                      </td>

                      <td>
                        <div className={styles.dateCell}>
                          {fmtDate(row.date)}
                        </div>
                      </td>

                      <td>
                        <div className={`${styles.scoreBox} ${styles[tone]}`}>
                          <strong>
                            {row.total_score === null ? "—" : row.total_score}
                          </strong>
                          <span>{resultLabel(row.total_score)}</span>
                        </div>
                      </td>

                      <td>
                        <span
                          className={`${styles.statusBadge} ${
                            styles[status.tone]
                          }`}
                        >
                          {status.text}
                        </span>
                      </td>

                      <td className={styles.actionCell}>
                        <button
                          type="button"
                          className={styles.detailButton}
                          onClick={() => openDetail(row.session_id)}
                        >
                          查看報告
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <div className={styles.emptyState}>
                        <strong>目前沒有符合條件的測驗</strong>
                        <span>可切換上方分頁或清除篩選條件。</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <ExamMatrix
        open={matrixOpen}
        onClose={() => setMatrixOpen(false)}
        onOpenReport={(sessionId) => {
          setMatrixOpen(false);
          openDetail(sessionId);
        }}
      />

      {selectedId && (
        <div
          className={styles.overlay}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setSelectedId(null);
              setDetail(null);
              setDetailError("");
            }
          }}
        >
          <aside className={styles.drawer}>
            <div className={styles.drawerHeader}>
              <div>
                <div className={styles.eyebrow}>STUDENT REPORT</div>
                <h2>學生口說測驗報告</h2>
              </div>

              <button
                type="button"
                className={styles.closeButton}
                onClick={() => {
                  setSelectedId(null);
                  setDetail(null);
                  setDetailError("");
                }}
              >
                ×
              </button>
            </div>

            {detailLoading && (
              <div className={styles.drawerLoading}>
                <div className={styles.spinner} />
                <p>正在載入測驗詳細資料...</p>
              </div>
            )}

            {detailError && (
              <div className={styles.drawerError}>{detailError}</div>
            )}

            {detail && !detailLoading && (
              <>
                <div className={styles.reportHero}>
                  <div className={styles.reportIdentity}>
                    <div className={styles.reportAvatar}>
                      {(detail.student.name || "?").charAt(0).toUpperCase()}
                    </div>

                    <div>
                      <div className={styles.reportStudentName}>
                        {detail.student.name}
                      </div>
                      {detail.student.username && (
                        <div className={styles.reportUsername}>
                          @{detail.student.username}
                        </div>
                      )}
                      <div className={styles.reportMeta}>
                        {detail.exam_set?.title || "—"}
                        <span>·</span>
                        {fmtDate(
                          detail.session?.created_at ||
                            detail.session?.started_at
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    className={`${styles.reportTotal} ${
                      Number(detail.result?.total_score) >= 80
                        ? styles.reportPass
                        : styles.reportFail
                    }`}
                  >
                    <span>TOTAL</span>
                    <strong>
                      {detail.result?.total_score === null ||
                      detail.result?.total_score === undefined
                        ? "—"
                        : Number(detail.result.total_score)}
                    </strong>
                    <small>
                      {detail.result?.total_score === null ||
                      detail.result?.total_score === undefined
                        ? "尚未評分"
                        : Number(detail.result.total_score) >= 80
                          ? "PASS"
                          : "NOT PASS"}
                    </small>
                  </div>
                </div>

                <div className={styles.drawerTabs}>
                  {[
                    ["overview", "總覽"],
                    ["reading", "朗讀"],
                    ["questions", "Q1～Q10"],
                    ["picture", "看圖敘述"],
                    ["transcript", "Transcript"],
                    ["history", "歷次成績"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={
                        detailTab === key
                          ? styles.drawerTabActive
                          : styles.drawerTab
                      }
                      onClick={() => setDetailTab(key as DetailTab)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className={styles.drawerBody}>
                  {detailTab === "overview" && (
                    <div className={styles.reportSections}>
                      {detail.recording_url && (
                        <section className={styles.reportCard}>
                          <div className={styles.reportCardHeader}>
                            <div>
                              <span className={styles.sectionKicker}>
                                AUDIO
                              </span>
                              <h3>考生完整錄音</h3>
                            </div>

                            <a
                              href={detail.recording_url}
                              download
                              className={styles.linkButton}
                            >
                              下載錄音
                            </a>
                          </div>

                          <audio
                            className={styles.audio}
                            controls
                            src={detail.recording_url}
                          />
                        </section>
                      )}

                      {detail.result && (
                        <>
                          <section className={styles.reportCard}>
                            <div className={styles.reportCardHeader}>
                              <div>
                                <span className={styles.sectionKicker}>
                                  SCORE PROFILE
                                </span>
                                <h3>五項能力</h3>
                              </div>
                            </div>

                            <div className={styles.categoryGrid}>
                              {[
                                ["Content", detail.result.content_score],
                                [
                                  "Organization",
                                  detail.result.organization_score,
                                ],
                                ["Grammar", detail.result.grammar_score],
                                [
                                  "Vocabulary",
                                  detail.result.vocabulary_score,
                                ],
                                ["Fluency", detail.result.fluency_score],
                              ].map(([label, raw]) => {
                                const score = Number(raw ?? 0);
                                return (
                                  <div
                                    key={String(label)}
                                    className={`${styles.categoryScore} ${
                                      score >= 16
                                        ? styles.categoryPass
                                        : styles.categoryFail
                                    }`}
                                  >
                                    <span>{label}</span>
                                    <strong>{score}</strong>
                                    <small>/20</small>
                                  </div>
                                );
                              })}
                            </div>
                          </section>

                          <section className={styles.reportCard}>
                            <div className={styles.reportCardHeader}>
                              <div>
                                <span className={styles.sectionKicker}>
                                  ITEM LEVEL GRADES
                                </span>
                                <h3>逐題成績（0～5 級）</h3>
                              </div>
                            </div>

                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns:
                                  "repeat(auto-fit, minmax(92px, 1fr))",
                                gap: 8,
                              }}
                            >
                              <ItemLevelBadge
                                label="朗讀"
                                level={readingGrade?.level}
                              />

                              {Array.from({ length: 10 }, (_, index) => {
                                const grade = getQuestionGrade(index + 1);
                                return (
                                  <ItemLevelBadge
                                    key={`overview-q${index + 1}`}
                                    label={`Q${index + 1}`}
                                    level={grade?.level}
                                  />
                                );
                              })}

                              <ItemLevelBadge
                                label="看圖"
                                level={pictureGrade?.level}
                              />
                            </div>

                            {!report?.item_level_grades && (
                              <div
                                style={{
                                  marginTop: 14,
                                  padding: 14,
                                  borderRadius: 12,
                                  border: "1px solid #bfdbfe",
                                  background: "#eff6ff",
                                }}
                              >
                                <p
                                  className={styles.longText}
                                  style={{ margin: 0 }}
                                >
                                  此筆測驗尚未產生逐題 0～5 級成績。舊測驗不需要重新錄音，可直接使用既有 Transcript 與 AI 報告補評。
                                </p>

                                <button
                                  type="button"
                                  onClick={generateItemGrades}
                                  disabled={itemGradeLoading}
                                  style={{
                                    marginTop: 10,
                                    minHeight: 38,
                                    border: 0,
                                    borderRadius: 9,
                                    padding: "0 14px",
                                    background: "#2563eb",
                                    color: "white",
                                    fontWeight: 900,
                                    cursor: itemGradeLoading
                                      ? "not-allowed"
                                      : "pointer",
                                    opacity: itemGradeLoading ? 0.6 : 1,
                                  }}
                                >
                                  {itemGradeLoading
                                    ? "正在產生逐題等級..."
                                    : "產生這筆測驗的 0～5 級成績"}
                                </button>

                                {itemGradeMessage && (
                                  <p
                                    style={{
                                      margin: "9px 0 0",
                                      color: "#475569",
                                      fontSize: 11,
                                      fontWeight: 700,
                                    }}
                                  >
                                    {itemGradeMessage}
                                  </p>
                                )}
                              </div>
                            )}
                          </section>

                          <section className={styles.reportCard}>
                            <div className={styles.reportCardHeader}>
                              <div>
                                <span className={styles.sectionKicker}>
                                  DIAGNOSIS
                                </span>
                                <h3>總體診斷</h3>
                              </div>
                            </div>

                            <p className={styles.longText}>
                              {report?.executive_summary ||
                                detail.result.feedback ||
                                "—"}
                            </p>
                          </section>

                          <section className={styles.reportSplit}>
                            <div className={styles.goodCard}>
                              <span className={styles.sectionKicker}>
                                STRENGTHS
                              </span>
                              <h3>主要優點</h3>
                              <ul>
                                {(report?.strengths || []).map(
                                  (item: string, index: number) => (
                                    <li key={index}>{item}</li>
                                  )
                                )}
                              </ul>
                            </div>

                            <div className={styles.improveCard}>
                              <span className={styles.sectionKicker}>
                                PRIORITIES
                              </span>
                              <h3>優先改善</h3>
                              <ol>
                                {(report?.priority_improvements || []).map(
                                  (item: string, index: number) => (
                                    <li key={index}>{item}</li>
                                  )
                                )}
                              </ol>
                            </div>
                          </section>

                          <section className={styles.actionPlan}>
                            <span className={styles.sectionKicker}>
                              NEXT ACTIONS
                            </span>
                            <h3>下一階段練習計畫</h3>
                            <ol>
                              {(report?.action_plan || []).map(
                                (item: string, index: number) => (
                                  <li key={index}>
                                    <span>{index + 1}</span>
                                    <p>{item}</p>
                                  </li>
                                )
                              )}
                            </ol>
                          </section>
                        </>
                      )}
                    </div>
                  )}

                  {detailTab === "reading" && (
                    <div className={styles.reportSections}>
                      <section className={styles.reportCard}>
                        <div className={styles.reportCardHeader}>
                          <div>
                            <span className={styles.sectionKicker}>
                              PART 1 · READING ALOUD
                            </span>
                            <h3>第一部分｜朗讀</h3>
                          </div>

                          <ItemLevelBadge level={readingGrade?.level} />
                        </div>

                        <div className={styles.studentAnswerCard}>
                          <span>ITEM GRADE</span>
                          <p>
                            第一部分以整段朗讀表現作為一個完整項目評分，不將文章內容拆成個別題目。
                          </p>
                        </div>

                        <div className={styles.practiceFocus}>
                          <span>0～5 級評分理由</span>
                          <p>
                            {readingGrade?.rationale ||
                              "此筆結果尚未產生第一部分 0～5 級評分。"}
                          </p>
                        </div>
                      </section>
                    </div>
                  )}

                  {detailTab === "questions" && (
                    <div className={styles.questionWorkspace}>
                      {questions.length === 0 ? (
                        <div className={styles.emptyState}>
                          <strong>這次測驗沒有 Q1～Q10 詳細資料</strong>
                          <span>
                            可能是舊版報告，或 AI 逐題分析尚未完成。
                          </span>
                        </div>
                      ) : (
                        <>
                          <aside className={styles.questionNav}>
                            <div className={styles.questionNavTitle}>
                              Questions
                            </div>

                            {questions.map((q: QuestionReview) => {
                              const status = questionStatus(q.status);
                              return (
                                <button
                                  key={q.question_number}
                                  type="button"
                                  className={
                                    activeQuestion === q.question_number
                                      ? styles.questionNavActive
                                      : styles.questionNavButton
                                  }
                                  onClick={() =>
                                    setActiveQuestion(q.question_number)
                                  }
                                >
                                  <span>Q{q.question_number}</span>
                                  <span
                                    style={{
                                      marginLeft: "auto",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 6,
                                    }}
                                  >
                                    <ItemLevelBadge
                                      compact
                                      level={
                                        getQuestionGrade(q.question_number)
                                          ?.level
                                      }
                                    />
                                    <i
                                      className={`${styles.statusDot} ${
                                        styles[status.tone]
                                      }`}
                                    />
                                  </span>
                                </button>
                              );
                            })}
                          </aside>

                          {selectedQuestion && (
                            <section className={styles.questionDetail}>
                              <div className={styles.questionTitleBlock}>
                                <div>
                                  <span className={styles.sectionKicker}>
                                    QUESTION {selectedQuestion.question_number}
                                  </span>
                                  <h3>{selectedQuestion.question}</h3>
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    flexWrap: "wrap",
                                    justifyContent: "flex-end",
                                  }}
                                >
                                  <ItemLevelBadge
                                    level={
                                      getQuestionGrade(
                                        selectedQuestion.question_number
                                      )?.level
                                    }
                                  />

                                  <span
                                    className={`${styles.questionStatusBadge} ${
                                      styles[
                                        questionStatus(
                                          selectedQuestion.status
                                        ).tone
                                      ]
                                    }`}
                                  >
                                    {
                                      questionStatus(
                                        selectedQuestion.status
                                      ).label
                                    }
                                  </span>
                                </div>
                              </div>

                              <div className={styles.studentAnswerCard}>
                                <span>STUDENT ANSWER</span>
                                <p>
                                  {selectedQuestion.student_answer ||
                                    "（沒有偵測到有效回答）"}
                                </p>
                              </div>

                              <div className={styles.practiceFocus}>
                                <span>本題 0～5 級評分理由</span>
                                <p>
                                  {getQuestionGrade(
                                    selectedQuestion.question_number
                                  )?.rationale ||
                                    "此筆結果尚未產生本題的 0～5 級評分理由。"}
                                </p>
                              </div>

                              <div className={styles.reviewGrid}>
                                <div>
                                  <span>01</span>
                                  <b>是否切題</b>
                                  <p>{selectedQuestion.directness || "—"}</p>
                                </div>

                                <div>
                                  <span>02</span>
                                  <b>內容檢討</b>
                                  <p>
                                    {selectedQuestion.content_review || "—"}
                                  </p>
                                </div>

                                <div>
                                  <span>03</span>
                                  <b>還可以補充</b>
                                  <p>
                                    {selectedQuestion.missing_or_expand || "—"}
                                  </p>
                                </div>

                                <div>
                                  <span>04</span>
                                  <b>Grammar / Vocabulary</b>
                                  <p>
                                    {selectedQuestion.language_review || "—"}
                                  </p>
                                </div>
                              </div>

                              {Array.isArray(
                                selectedQuestion.language_issues
                              ) &&
                                selectedQuestion.language_issues.length > 0 && (
                                  <div className={styles.correctionSection}>
                                    <div className={styles.correctionTitle}>
                                      具體修正
                                    </div>

                                    <div className={styles.correctionList}>
                                      {selectedQuestion.language_issues.map(
                                        (
                                          issue: LanguageIssue,
                                          index: number
                                        ) => (
                                          <div
                                            key={index}
                                            className={styles.correctionCard}
                                          >
                                            <div className={styles.original}>
                                              <span>原句</span>
                                              <p>{issue.original}</p>
                                            </div>
                                            <div className={styles.corrected}>
                                              <span>修正</span>
                                              <p>{issue.corrected}</p>
                                            </div>
                                            <div className={styles.reason}>
                                              {issue.reason}
                                            </div>
                                          </div>
                                        )
                                      )}
                                    </div>
                                  </div>
                                )}

                              <div className={styles.betterAnswer}>
                                <span>BETTER ANSWER</span>
                                <p>{selectedQuestion.better_answer || "—"}</p>
                              </div>

                              <div className={styles.practiceFocus}>
                                <span>本題練習重點</span>
                                <p>{selectedQuestion.next_step || "—"}</p>
                              </div>
                            </section>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {detailTab === "picture" && (
                    <div className={styles.reportSections}>
                      <section className={styles.reportCard}>
                        <div className={styles.reportCardHeader}>
                          <div>
                            <span className={styles.sectionKicker}>
                              PICTURE DESCRIPTION
                            </span>
                            <h3>第三部分｜看圖敘述</h3>
                          </div>

                          <ItemLevelBadge level={pictureGrade?.level} />
                        </div>

                        <div className={styles.studentAnswerCard}>
                          <span>STUDENT RESPONSE</span>
                          <p>
                            {report?.picture_review?.student_answer ||
                              "（沒有偵測到有效回答）"}
                          </p>
                        </div>
                      </section>

                      <section className={styles.practiceFocus}>
                        <span>看圖敘述 0～5 級評分理由</span>
                        <p>
                          {pictureGrade?.rationale ||
                            "此筆結果尚未產生第三部分 0～5 級評分理由。"}
                        </p>
                      </section>

                      <section className={styles.pictureGrid}>
                        <div>
                          <span>CONTENT</span>
                          <h4>畫面內容涵蓋</h4>
                          <p>
                            {report?.picture_review?.scene_coverage || "—"}
                          </p>
                        </div>

                        <div>
                          <span>ORGANIZATION</span>
                          <h4>組織與順序</h4>
                          <p>
                            {report?.picture_review?.organization_review ||
                              "—"}
                          </p>
                        </div>

                        <div>
                          <span>LANGUAGE</span>
                          <h4>Grammar / Vocabulary</h4>
                          <p>
                            {report?.picture_review?.language_review || "—"}
                          </p>
                        </div>

                        <div>
                          <span>DEVELOPMENT</span>
                          <h4>內容發展</h4>
                          <p>
                            {report?.picture_review?.development_review || "—"}
                          </p>
                        </div>
                      </section>

                      <section className={styles.betterAnswer}>
                        <span>BETTER DESCRIPTION</span>
                        <p>
                          {report?.picture_review?.better_description || "—"}
                        </p>
                      </section>

                      <section className={styles.practiceFocus}>
                        <span>看圖敘述練習重點</span>
                        <p>{report?.picture_review?.next_step || "—"}</p>
                      </section>
                    </div>
                  )}

                  {detailTab === "transcript" && (
                    <section className={styles.transcriptCard}>
                      <div className={styles.reportCardHeader}>
                        <div>
                          <span className={styles.sectionKicker}>
                            FULL TRANSCRIPT
                          </span>
                          <h3>完整逐字稿</h3>
                        </div>
                      </div>

                      <p className={styles.transcript}>
                        {detail.result?.transcript || "沒有逐字稿。"}
                      </p>
                    </section>
                  )}

                  {detailTab === "history" && (
                    <section className={styles.reportCard}>
                      <div className={styles.reportCardHeader}>
                        <div>
                          <span className={styles.sectionKicker}>
                            PROGRESS
                          </span>
                          <h3>歷次測驗成績</h3>
                        </div>
                      </div>

                      <div className={styles.historyList}>
                        {detail.history?.length ? (
                          detail.history.map((item) => (
                            <button
                              type="button"
                              key={item.session_id}
                              className={styles.historyRow}
                              onClick={() => openDetail(item.session_id)}
                            >
                              <div>
                                <strong>{item.exam_title}</strong>
                                <span>{fmtDate(item.date)}</span>
                              </div>
                              <div
                                className={
                                  item.total_score === null
                                    ? styles.historyNeutral
                                    : item.total_score >= 80
                                      ? styles.historyPass
                                      : styles.historyFail
                                }
                              >
                                {item.total_score ?? "—"}
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className={styles.emptyState}>
                            <span>尚無其他歷次測驗。</span>
                          </div>
                        )}
                      </div>
                    </section>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
