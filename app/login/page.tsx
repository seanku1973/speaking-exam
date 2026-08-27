"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const normalizedUsername = username.trim().toLowerCase();

    if (!normalizedUsername || !password) {
      setError("請輸入考生帳號與密碼。");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const email = `${normalizedUsername}@writing.test`;

      const { data, error: loginError } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        });

      if (loginError || !data.user) {
        throw new Error("帳號或密碼錯誤。");
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("user_id, full_name, role")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (!profileError && profile?.role === "teacher") {
        await supabase.auth.signOut();
        throw new Error("此頁面僅供考生登入。");
      }

      router.push("/exam/verify");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登入時發生錯誤。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-600 text-white text-2xl font-bold mb-4">
              S
            </div>

            <h1 className="text-2xl font-bold text-slate-900">
              中級口說能力電腦測驗
            </h1>

            <p className="text-slate-500 mt-2">Speaking Exam</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-slate-700 mb-2"
              >
                考生帳號
              </label>

              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                placeholder="例如：peter"
                className="w-full rounded-lg border border-slate-300 px-4 py-3
                           text-slate-900 outline-none
                           focus:border-blue-500 focus:ring-2 focus:ring-blue-100
                           disabled:bg-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700 mb-2"
              >
                密碼
              </label>

              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                placeholder="請輸入密碼"
                className="w-full rounded-lg border border-slate-300 px-4 py-3
                           text-slate-900 outline-none
                           focus:border-blue-500 focus:ring-2 focus:ring-blue-100
                           disabled:bg-slate-100"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 px-4 py-3
                         font-semibold text-white transition
                         hover:bg-blue-700
                         disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {loading ? "登入中..." : "考生登入"}
            </button>
          </form>

          <div className="mt-7 border-t border-slate-200 pt-5">
            <p className="text-center text-sm text-slate-500">
              請使用老師提供的考生帳號登入
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          請於正式測驗開始前完成登入
        </p>
      </div>
    </main>
  );
}
