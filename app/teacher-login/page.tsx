"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function TeacherLoginPage() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (!password.trim()) {
      setError("請輸入老師管理密碼。");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/teacher/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const raw = await response.text();

      let body: any = {};
      if (raw.trim()) {
        try {
          body = JSON.parse(raw);
        } catch {
          throw new Error(
            `登入伺服器回傳異常資料（HTTP ${response.status}）。請重新啟動網站後再試。`
          );
        }
      }

      if (!response.ok || !body?.ok) {
        throw new Error(body?.message || `登入失敗（HTTP ${response.status}）。`);
      }

      router.replace("/teacher");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "老師登入失敗。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-blue-50 via-slate-50 to-white px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl lg:grid-cols-[1.1fr_.9fr]">
          <section className="hidden bg-blue-50 p-12 lg:block">
            <div className="inline-flex rounded-full border border-blue-200 bg-white px-4 py-2 text-sm font-bold text-blue-700">
              Speaking Exam
            </div>

            <h1 className="mt-7 text-4xl font-black leading-tight text-slate-900">
              中級口說能力測驗
              <br />
              老師管理中心
            </h1>

            <p className="mt-5 max-w-md text-base leading-8 text-slate-600">
              成績、測驗題組與學生帳號集中管理。
            </p>

            <div className="mt-10 space-y-4">
              {[
                "學生成績與 AI 報告",
                "正式測驗題組與 MP3",
                "學生帳號與密碼管理",
                "60 天錄音保留政策",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 rounded-xl border border-blue-100 bg-white/80 px-4 py-3 text-slate-700"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-sm font-black text-white">
                    ✓
                  </span>
                  <span className="font-semibold">{item}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="p-7 sm:p-10 lg:p-12">
            <div className="mx-auto max-w-sm">
              <p className="text-sm font-black uppercase tracking-[0.15em] text-blue-600">
                Teacher Console
              </p>

              <h2 className="mt-3 text-3xl font-black text-slate-900">
                老師登入
              </h2>

              <p className="mt-3 leading-7 text-slate-500">
                請輸入老師管理密碼。
              </p>

              <form onSubmit={submit} className="mt-8">
                <label
                  htmlFor="teacher-password"
                  className="block text-sm font-bold text-slate-700"
                >
                  管理密碼
                </label>

                <div className="relative mt-2">
                  <input
                    id="teacher-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 pr-20 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    placeholder="請輸入管理密碼"
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-sm font-semibold text-blue-600 hover:bg-blue-50"
                  >
                    {showPassword ? "隱藏" : "顯示"}
                  </button>
                </div>

                {error && (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">
                    <p className="font-bold">登入失敗</p>
                    <p className="mt-1">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !password.trim()}
                  className="mt-6 w-full rounded-xl bg-blue-600 px-5 py-3.5 font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {loading ? "正在登入..." : "進入老師管理中心"}
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
