"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

type Summary = {
  attempts: number;
  scored: number;
  average: number | null;
  students: number;
  exam_sets: number;
};

export default function TeacherHomePage() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary>({
    attempts: 0,
    scored: 0,
    average: null,
    students: 0,
    exam_sets: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [dashboardRes, studentsRes, examsRes] = await Promise.all([
          fetch("/api/teacher/dashboard", { cache: "no-store" }),
          fetch("/api/teacher/students", { cache: "no-store" }),
          fetch("/api/teacher/exams", { cache: "no-store" }),
        ]);

        if (
          dashboardRes.status === 401 ||
          studentsRes.status === 401 ||
          examsRes.status === 401
        ) {
          router.replace("/teacher-login");
          return;
        }

        const dashboard = await dashboardRes.json();
        const students = await studentsRes.json();
        const exams = await examsRes.json();

        const rows = Array.isArray(dashboard?.rows) ? dashboard.rows : [];
        const scored = rows.filter(
          (row: any) =>
            row.total_score !== null &&
            row.total_score !== undefined
        );

        const average =
          scored.length > 0
            ? scored.reduce(
                (sum: number, row: any) =>
                  sum + Number(row.total_score || 0),
                0
              ) / scored.length
            : null;

        setSummary({
          attempts: rows.length,
          scored: scored.length,
          average:
            average === null
              ? null
              : Math.round(average * 10) / 10,
          students: Array.isArray(students?.students)
            ? students.students.length
            : 0,
          exam_sets: Array.isArray(exams?.exam_sets)
            ? exams.exam_sets.length
            : 0,
        });
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router]);

  async function logout() {
    await fetch("/api/teacher/logout", { method: "POST" });
    router.replace("/teacher-login");
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>SPEAKING EXAM · TEACHER</div>
            <h1>老師管理中心</h1>
            <p>三個主要功能集中在這裡，不需要記不同網址。</p>
          </div>

          <button
            type="button"
            className={styles.logout}
            onClick={logout}
          >
            登出
          </button>
        </header>

        <section className={styles.metrics}>
          <div>
            <span>學生</span>
            <strong>{loading ? "…" : summary.students}</strong>
          </div>
          <div>
            <span>題組</span>
            <strong>{loading ? "…" : summary.exam_sets}</strong>
          </div>
          <div>
            <span>測驗場次</span>
            <strong>{loading ? "…" : summary.attempts}</strong>
          </div>
          <div>
            <span>已評分</span>
            <strong>{loading ? "…" : summary.scored}</strong>
          </div>
          <div>
            <span>平均分數</span>
            <strong>
              {loading
                ? "…"
                : summary.average === null
                  ? "—"
                  : summary.average.toFixed(1)}
            </strong>
          </div>
        </section>

        <section className={styles.cards}>
          <button
            type="button"
            className={styles.card}
            onClick={() => router.push("/teacher/progress")}
          >
            <span className={styles.cardNumber}>01</span>
            <div>
              <h2>成績管理</h2>
              <p>
                查看學生測驗結果、AI 評分、Q1～Q10、錄音與歷次 Progress。
              </p>
            </div>
            <strong>進入 →</strong>
          </button>

          <button
            type="button"
            className={styles.card}
            onClick={() => router.push("/teacher/exams")}
          >
            <span className={styles.cardNumber}>02</span>
            <div>
              <h2>題組管理</h2>
              <p>
                新增測驗題組、上傳正式 MP3 與看圖圖片、啟用或停用題組。
              </p>
            </div>
            <strong>進入 →</strong>
          </button>

          <button
            type="button"
            className={styles.card}
            onClick={() => router.push("/teacher/students")}
          >
            <span className={styles.cardNumber}>03</span>
            <div>
              <h2>學生管理</h2>
              <p>
                新增學生、修改姓名、重設密碼、永久刪除學生與所有紀錄。
              </p>
            </div>
            <strong>進入 →</strong>
          </button>
        </section>

        <section className={styles.policy}>
          <div>
            <span>STORAGE POLICY</span>
            <h2>錄音保留 60 天</h2>
            <p>
              正式部署後由 Vercel 每天自動執行清理。原始錄音超過
              60 天刪除，但成績、Transcript、AI Report 與 Progress
              繼續保留。
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
