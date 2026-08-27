"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

type Student = {
  user_id: string;
  full_name: string;
  username: string;
  email: string;
  created_at: string | null;
  total_sessions: number;
  scored_sessions: number;
  average_score: number | null;
  pass_count: number;
  last_exam_at: string | null;
};

type CleanupResult = {
  deleted_count: number;
  freed_bytes: number;
  cutoff: string;
};

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function formatBytes(bytes: number) {
  const n = Math.max(0, Number(bytes || 0));
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export default function TeacherStudentsPage() {
  const router = useRouter();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Student | null>(null);
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [lastCleanup, setLastCleanup] = useState<CleanupResult | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    full_name: "",
    username: "",
    password: "",
  });

  async function loadStudents() {
    try {
      setLoading(true);
      const response = await fetch("/api/teacher/students", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/teacher-login");
        return;
      }
      const raw = await response.text();
      const body = raw ? JSON.parse(raw) : {};
      if (!response.ok || !body.ok) throw new Error(body.message || "無法載入學生資料。");
      setStudents(Array.isArray(body.students) ? body.students : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "無法載入學生資料。");
    } finally {
      setLoading(false);
    }
  }

  async function cleanupOldRecordings(silent = false) {
    try {
      setCleaning(true);
      if (!silent) {
        setError("");
        setNotice("");
      }
      const response = await fetch("/api/teacher/storage/cleanup", { method: "POST" });
      if (response.status === 401) {
        router.replace("/teacher-login");
        return;
      }
      const raw = await response.text();
      const body = raw ? JSON.parse(raw) : {};
      if (!response.ok || !body.ok) throw new Error(body.message || "60 天錄音清理失敗。");
      setLastCleanup(body.result);
      if (!silent) {
        setNotice(
          body.result.deleted_count > 0
            ? `已刪除 ${body.result.deleted_count} 份超過 60 天的錄音，釋放約 ${formatBytes(body.result.freed_bytes)}。成績與 AI 報告仍保留。`
            : "已檢查，目前沒有超過 60 天需要清理的錄音。"
        );
      }
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "60 天錄音清理失敗。");
    } finally {
      setCleaning(false);
    }
  }

  useEffect(() => {
    (async () => {
      await cleanupOldRecordings(true);
      await loadStudents();
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => `${s.full_name} ${s.username} ${s.email}`.toLowerCase().includes(q));
  }, [students, search]);

  async function createStudent(event: FormEvent) {
    event.preventDefault();
    try {
      setCreating(true);
      setError("");
      setNotice("");
      const response = await fetch("/api/teacher/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      const raw = await response.text();
      const body = raw ? JSON.parse(raw) : {};
      if (!response.ok || !body.ok) throw new Error(body.message || "建立學生失敗。");
      setNotice(`已建立學生帳號：${body.student.username}`);
      setCreateForm({ full_name: "", username: "", password: "" });
      setShowCreate(false);
      await loadStudents();
    } catch (e) {
      setError(e instanceof Error ? e.message : "建立學生失敗。");
    } finally {
      setCreating(false);
    }
  }

  function openStudent(student: Student) {
    setSelected(student);
    setNewName(student.full_name);
    setNewPassword("");
    setShowPassword(false);
    setError("");
    setNotice("");
  }

  async function saveStudent() {
    if (!selected) return;
    try {
      setSaving(true);
      setError("");
      const response = await fetch(`/api/teacher/students/${selected.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: newName.trim() !== selected.full_name ? newName.trim() : undefined,
          password: newPassword.trim() || undefined,
        }),
      });
      const raw = await response.text();
      const body = raw ? JSON.parse(raw) : {};
      if (!response.ok || !body.ok) throw new Error(body.message || "更新學生失敗。");
      setNotice(`已更新 ${selected.username}。`);
      setNewPassword("");
      await loadStudents();
      setSelected((current) => current ? { ...current, full_name: body.student.full_name } : current);
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新學生失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function deleteStudent() {
    if (!selected) return;
    const confirmed = window.confirm(
      `確定永久刪除「${selected.full_name}」嗎？\n\n` +
      "將一起刪除：\n• 登入帳號\n• 所有測驗紀錄\n• 所有成績與 AI 報告\n• Transcript\n• 所有錄音\n\n此操作無法復原。"
    );
    if (!confirmed) return;

    try {
      setDeleting(true);
      setError("");
      const response = await fetch(`/api/teacher/students/${selected.user_id}`, { method: "DELETE" });
      const raw = await response.text();
      const body = raw ? JSON.parse(raw) : {};
      if (!response.ok || !body.ok) throw new Error(body.message || "永久刪除學生失敗。");
      setNotice(`學生 ${selected.full_name} 與所有紀錄已永久刪除。`);
      setSelected(null);
      await loadStudents();
    } catch (e) {
      setError(e instanceof Error ? e.message : "永久刪除學生失敗。");
    } finally {
      setDeleting(false);
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
            <h1>學生帳號管理</h1>
            <p>簡單管理：新增、修改、重設密碼、永久刪除。</p>
          </div>
          <div className={styles.headerActions}>
            <button onClick={() => router.push("/teacher/progress")}>成績管理</button>
            <button onClick={() => router.push("/teacher/exams")}>題組管理</button>
            <button className={styles.primary} onClick={() => setShowCreate(true)}>＋ 新增學生</button>
            <button className={styles.logout} onClick={logout}>登出</button>
          </div>
        </header>

        {error && <div className={styles.error}>{error}</div>}
        {notice && <div className={styles.notice}>{notice}</div>}

        <section className={styles.retention}>
          <div>
            <span>60 天自動清理</span>
            <strong>學生原始錄音超過 60 天一律刪除</strong>
            <p>只刪錄音檔；成績、Transcript、AI 報告保留。每次開啟本頁都會自動檢查。</p>
          </div>
          <div className={styles.retentionRight}>
            {lastCleanup && <small>本次：{lastCleanup.deleted_count} 份 / {formatBytes(lastCleanup.freed_bytes)}</small>}
            <button disabled={cleaning} onClick={() => cleanupOldRecordings(false)}>{cleaning ? "清理中..." : "立即清理"}</button>
          </div>
        </section>

        <section className={styles.toolbar}>
          <div>
            <h2>學生名冊</h2>
            <p>不使用停用狀態；不再需要的學生直接永久刪除。</p>
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋姓名或帳號" />
        </section>

        <section className={styles.tableCard}>
          {loading ? <div className={styles.loading}>正在載入...</div> : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>學生</th><th>帳號</th><th>測驗</th><th>已評分</th><th>平均</th><th>最近測驗</th><th /></tr></thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.user_id}>
                      <td><div className={styles.student}><div className={styles.avatar}>{(s.full_name || s.username).charAt(0).toUpperCase()}</div><div><strong>{s.full_name}</strong><small>{s.email}</small></div></div></td>
                      <td className={styles.username}>{s.username}</td>
                      <td>{s.total_sessions}</td>
                      <td>{s.scored_sessions}</td>
                      <td className={s.average_score === null ? styles.muted : s.average_score >= 80 ? styles.pass : styles.fail}>{s.average_score === null ? "—" : s.average_score.toFixed(1)}</td>
                      <td>{fmtDate(s.last_exam_at)}</td>
                      <td className={styles.action}><button onClick={() => openStudent(s)}>管理</button></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={7} className={styles.empty}>沒有符合條件的學生</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {showCreate && (
        <div className={styles.overlay}>
          <form className={styles.modal} onSubmit={createStudent}>
            <div className={styles.modalHeader}><div><span>NEW STUDENT</span><h2>新增學生</h2></div><button type="button" onClick={() => setShowCreate(false)}>×</button></div>
            <label>學生姓名<input required value={createForm.full_name} onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })} /></label>
            <label>登入帳號<input required value={createForm.username} onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })} placeholder="peter" /></label>
            <label>初始密碼<input required minLength={6} type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} /></label>
            <div className={styles.formActions}><button type="button" onClick={() => setShowCreate(false)}>取消</button><button className={styles.primary} disabled={creating}>{creating ? "建立中..." : "建立學生"}</button></div>
          </form>
        </div>
      )}

      {selected && (
        <div className={styles.overlay} onMouseDown={(e) => { if (e.currentTarget === e.target) setSelected(null); }}>
          <aside className={styles.drawer}>
            <div className={styles.drawerHeader}><div><span>STUDENT ACCOUNT</span><h2>{selected.full_name}</h2><p>@{selected.username}</p></div><button onClick={() => setSelected(null)}>×</button></div>
            <div className={styles.drawerBody}>
              <div className={styles.stats}><div><span>測驗</span><strong>{selected.total_sessions}</strong></div><div><span>已評分</span><strong>{selected.scored_sessions}</strong></div><div><span>平均</span><strong>{selected.average_score === null ? "—" : selected.average_score.toFixed(1)}</strong></div><div><span>PASS</span><strong>{selected.pass_count}</strong></div></div>

              <section className={styles.card}><h3>修改姓名</h3><input value={newName} onChange={(e) => setNewName(e.target.value)} /></section>
              <section className={styles.card}><h3>重設密碼</h3><div className={styles.password}><input type={showPassword ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="至少 6 個字元" /><button onClick={() => setShowPassword(!showPassword)}>{showPassword ? "隱藏" : "顯示"}</button></div></section>
              <button className={styles.save} disabled={saving} onClick={saveStudent}>{saving ? "儲存中..." : "儲存學生資料"}</button>

              <section className={styles.danger}>
                <span>DANGER ZONE</span>
                <h3>永久刪除學生與所有紀錄</h3>
                <p>刪除 Auth 帳號、profiles、全部測驗、成績、AI 報告、Transcript、exam_events 與所有錄音。無法復原。</p>
                <button disabled={deleting} onClick={deleteStudent}>{deleting ? "永久刪除中..." : "永久刪除學生"}</button>
              </section>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
