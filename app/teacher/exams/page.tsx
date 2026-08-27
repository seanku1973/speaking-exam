"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

type ExamSet = {
  id: string;
  code: string;
  title: string;
  description: string;
  audio_path: string;
  image_path: string;
  duration_seconds: number;
  is_active: boolean;
  created_at: string;
  audio_url: string | null;
  image_url: string | null;
  session_count: number;
  graded_count: number;
};

type FormState = {
  code: string;
  title: string;
  description: string;
  duration_seconds: string;
  is_active: boolean;
};

const emptyForm: FormState = {
  code: "",
  title: "",
  description: "",
  duration_seconds: "900",
  is_active: true,
};

function formatDuration(seconds: number) {
  const value = Number(seconds || 0);
  const min = Math.floor(value / 60);
  const sec = value % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function fmtDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export default function TeacherExamsPage() {
  const router = useRouter();

  const [examSets, setExamSets] = useState<ExamSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  const [selected, setSelected] = useState<ExamSet | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError("");

      const response = await fetch("/api/teacher/exams", {
        cache: "no-store",
      });

      if (response.status === 401) {
        router.replace("/teacher-login");
        return;
      }

      const raw = await response.text();
      const body = raw ? JSON.parse(raw) : {};

      if (!response.ok || !body.ok) {
        throw new Error(body.message || "無法載入題組資料。");
      }

      setExamSets(Array.isArray(body.exam_sets) ? body.exam_sets : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入題組失敗。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return examSets;

    return examSets.filter((exam) =>
      `${exam.code} ${exam.title} ${exam.description}`
        .toLowerCase()
        .includes(needle)
    );
  }, [examSets, search]);

  const stats = useMemo(() => {
    const active = examSets.filter((x) => x.is_active).length;
    const ready = examSets.filter((x) => x.audio_path).length;
    const totalSessions = examSets.reduce(
      (sum, x) => sum + Number(x.session_count || 0),
      0
    );

    return {
      total: examSets.length,
      active,
      ready,
      totalSessions,
    };
  }, [examSets]);

  async function createExam(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/teacher/exams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code.trim(),
          title: form.title.trim(),
          description: form.description.trim(),
          duration_seconds: Number(form.duration_seconds || 900),
          is_active: form.is_active,
        }),
      });

      const raw = await response.text();
      const body = raw ? JSON.parse(raw) : {};

      if (!response.ok || !body.ok) {
        throw new Error(body.message || "建立題組失敗。");
      }

      setNotice(`已建立題組：${body.exam_set.title}`);
      setForm(emptyForm);
      setShowCreate(false);
      await load();
      setSelected(body.exam_set);
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立題組失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(exam: ExamSet) {
    try {
      setError("");
      setNotice("");

      const response = await fetch(`/api/teacher/exams/${exam.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_active: !exam.is_active,
        }),
      });

      const body = await response.json();

      if (!response.ok || !body.ok) {
        throw new Error(body.message || "更新題組狀態失敗。");
      }

      setNotice(
        `${exam.title} 已${exam.is_active ? "停用" : "啟用"}。`
      );
      await load();

      if (selected?.id === exam.id) {
        setSelected((current) =>
          current ? { ...current, is_active: !exam.is_active } : current
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失敗。");
    }
  }

  async function uploadAssets(exam: ExamSet) {
    if (!audioFile && !imageFile) {
      setError("請至少選擇一個 MP3 或圖片檔案。");
      return;
    }

    try {
      setUploading(exam.id);
      setError("");
      setNotice("");

      const data = new FormData();

      if (audioFile) data.append("audio", audioFile);
      if (imageFile) data.append("image", imageFile);

      const response = await fetch(
        `/api/teacher/exams/${exam.id}/assets`,
        {
          method: "POST",
          body: data,
        }
      );

      const raw = await response.text();
      const body = raw ? JSON.parse(raw) : {};

      if (!response.ok || !body.ok) {
        throw new Error(body.message || "檔案上傳失敗。");
      }

      setNotice("題組檔案已更新。若更換正式 MP3，AI 題目時間軸已自動清除。");
      setAudioFile(null);
      setImageFile(null);
      await load();
      setSelected(body.exam_set);
    } catch (err) {
      setError(err instanceof Error ? err.message : "檔案上傳失敗。");
    } finally {
      setUploading(null);
    }
  }

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
            <h1>測驗題組管理</h1>
            <p>
              建立正式題組、上傳考試 MP3／看圖圖片、控制是否開放學生使用
            </p>
          </div>

          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => router.push("/teacher/progress")}
            >
              成績管理
            </button>

            <button
              type="button"
              className={styles.secondaryButton}
              onClick={load}
            >
              重新整理
            </button>

            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setShowCreate(true)}
            >
              ＋ 新增題組
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

        {error && <div className={styles.error}>{error}</div>}
        {notice && <div className={styles.notice}>{notice}</div>}

        <section className={styles.stats}>
          <div>
            <span>全部題組</span>
            <strong>{stats.total}</strong>
          </div>
          <div>
            <span>目前啟用</span>
            <strong>{stats.active}</strong>
          </div>
          <div>
            <span>MP3 已就緒</span>
            <strong>{stats.ready}</strong>
          </div>
          <div>
            <span>累計測驗場次</span>
            <strong>{stats.totalSessions}</strong>
          </div>
        </section>

        <section className={styles.workspace}>
          <div className={styles.toolbar}>
            <div>
              <h2>正式測驗題組</h2>
              <p>只有「啟用」中的題組會提供老師在考前選擇。</p>
            </div>

            <input
              className={styles.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋題組代碼或名稱"
            />
          </div>

          {loading ? (
            <div className={styles.loading}>正在載入題組...</div>
          ) : (
            <div className={styles.grid}>
              {filtered.map((exam) => (
                <article key={exam.id} className={styles.examCard}>
                  <div className={styles.cardTop}>
                    <div>
                      <div className={styles.code}>{exam.code}</div>
                      <h3>{exam.title}</h3>
                    </div>

                    <span
                      className={
                        exam.is_active
                          ? styles.activeBadge
                          : styles.inactiveBadge
                      }
                    >
                      {exam.is_active ? "啟用中" : "已停用"}
                    </span>
                  </div>

                  <p className={styles.description}>
                    {exam.description || "尚未填寫題組說明。"}
                  </p>

                  <div className={styles.assetStatus}>
                    <div>
                      <span>正式 MP3</span>
                      <strong className={exam.audio_path ? styles.ok : styles.missing}>
                        {exam.audio_path ? "✓ 已上傳" : "尚未上傳"}
                      </strong>
                    </div>

                    <div>
                      <span>看圖圖片</span>
                      <strong className={exam.image_path ? styles.ok : styles.muted}>
                        {exam.image_path ? "✓ 已上傳" : "未設定"}
                      </strong>
                    </div>
                  </div>

                  <div className={styles.meta}>
                    <span>時間 {formatDuration(exam.duration_seconds)}</span>
                    <span>建立 {fmtDate(exam.created_at)}</span>
                    <span>{exam.session_count} 次測驗</span>
                    <span>{exam.graded_count} 次已評分</span>
                  </div>

                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.detailButton}
                      onClick={() => {
                        setSelected(exam);
                        setAudioFile(null);
                        setImageFile(null);
                      }}
                    >
                      管理題組
                    </button>

                    <button
                      type="button"
                      className={
                        exam.is_active
                          ? styles.deactivateButton
                          : styles.activateButton
                      }
                      onClick={() => toggleActive(exam)}
                    >
                      {exam.is_active ? "停用" : "啟用"}
                    </button>
                  </div>
                </article>
              ))}

              {filtered.length === 0 && (
                <div className={styles.empty}>
                  <strong>沒有符合條件的題組</strong>
                  <span>可清除搜尋文字或新增正式題組。</span>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {showCreate && (
        <div className={styles.overlay}>
          <section className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.eyebrow}>NEW EXAM SET</div>
                <h2>新增測驗題組</h2>
              </div>
              <button
                type="button"
                className={styles.close}
                onClick={() => setShowCreate(false)}
              >
                ×
              </button>
            </div>

            <form onSubmit={createExam} className={styles.form}>
              <label>
                <span>題組代碼</span>
                <input
                  required
                  value={form.code}
                  onChange={(e) =>
                    setForm({ ...form, code: e.target.value })
                  }
                  placeholder="例如 GEPT-INTERMEDIATE-02"
                />
              </label>

              <label>
                <span>題組名稱</span>
                <input
                  required
                  value={form.title}
                  onChange={(e) =>
                    setForm({ ...form, title: e.target.value })
                  }
                  placeholder="例如 新制中級口說能力測驗 02"
                />
              </label>

              <label>
                <span>題組說明</span>
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder="朗讀短文、回答問題、看圖敘述..."
                  rows={4}
                />
              </label>

              <label>
                <span>預計測驗時間（秒）</span>
                <input
                  type="number"
                  min={60}
                  max={3600}
                  value={form.duration_seconds}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      duration_seconds: e.target.value,
                    })
                  }
                />
              </label>

              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm({ ...form, is_active: e.target.checked })
                  }
                />
                <span>建立後立即啟用</span>
              </label>

              <div className={styles.formActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => setShowCreate(false)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={styles.primaryButton}
                >
                  {saving ? "建立中..." : "建立題組"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {selected && (
        <div
          className={styles.overlay}
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) {
              setSelected(null);
            }
          }}
        >
          <aside className={styles.drawer}>
            <div className={styles.drawerHeader}>
              <div>
                <div className={styles.eyebrow}>{selected.code}</div>
                <h2>{selected.title}</h2>
              </div>

              <button
                type="button"
                className={styles.close}
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>

            <div className={styles.drawerBody}>
              <section className={styles.detailSection}>
                <h3>題組狀態</h3>

                <div className={styles.infoGrid}>
                  <div>
                    <span>目前狀態</span>
                    <strong>
                      {selected.is_active ? "啟用中" : "已停用"}
                    </strong>
                  </div>
                  <div>
                    <span>測驗時間</span>
                    <strong>
                      {formatDuration(selected.duration_seconds)}
                    </strong>
                  </div>
                  <div>
                    <span>累計測驗</span>
                    <strong>{selected.session_count}</strong>
                  </div>
                  <div>
                    <span>已評分</span>
                    <strong>{selected.graded_count}</strong>
                  </div>
                </div>
              </section>

              <section className={styles.detailSection}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h3>正式考試 MP3</h3>
                    <p>學生正式測驗時播放的完整考試音訊。</p>
                  </div>
                </div>

                {selected.audio_url ? (
                  <audio
                    controls
                    className={styles.audio}
                    src={selected.audio_url}
                  />
                ) : (
                  <div className={styles.assetMissing}>
                    尚未上傳正式 MP3
                  </div>
                )}

                <label className={styles.filePicker}>
                  <span>
                    {audioFile
                      ? audioFile.name
                      : "選擇新的 MP3 / audio 檔案"}
                  </span>
                  <input
                    type="file"
                    accept="audio/*,.mp3,.m4a,.wav"
                    onChange={(e) =>
                      setAudioFile(e.target.files?.[0] || null)
                    }
                  />
                </label>

                <div className={styles.warningBox}>
                  更換正式 MP3 後，系統會清除舊的 AI
                  題目時間軸。下一位學生評分時會重新建立 Q1～Q10
                  對應資料。
                </div>
              </section>

              <section className={styles.detailSection}>
                <div className={styles.sectionHeader}>
                  <div>
                    <h3>看圖敘述圖片</h3>
                    <p>第三部分提供學生觀看的圖片。</p>
                  </div>
                </div>

                {selected.image_url ? (
                  <img
                    className={styles.previewImage}
                    src={selected.image_url}
                    alt={selected.title}
                  />
                ) : (
                  <div className={styles.assetMissing}>
                    尚未設定看圖圖片
                  </div>
                )}

                <label className={styles.filePicker}>
                  <span>
                    {imageFile
                      ? imageFile.name
                      : "選擇新的 JPG / PNG / WebP 圖片"}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) =>
                      setImageFile(e.target.files?.[0] || null)
                    }
                  />
                </label>
              </section>

              <button
                type="button"
                disabled={
                  uploading === selected.id || (!audioFile && !imageFile)
                }
                className={styles.saveAssets}
                onClick={() => uploadAssets(selected)}
              >
                {uploading === selected.id
                  ? "正在上傳..."
                  : "儲存題組檔案"}
              </button>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
