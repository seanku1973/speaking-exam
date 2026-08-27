"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type ExamSet = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  duration_seconds: number | null;
};

export default function ExamVerifyPage() {
  const router = useRouter();

  const [studentName, setStudentName] = useState("");
  const [pageLoading, setPageLoading] = useState(true);

  const [password, setPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);

  const [examSets, setExamSets] = useState<ExamSet[]>([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    async function loadStudent() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const username = user.email?.split("@")[0] ?? "考生";
      setStudentName(username);

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profile?.role === "teacher") {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      setPageLoading(false);
    }

    loadStudent();
  }, [router]);

  async function loadExamSets() {
    const { data, error: examError } = await supabase
      .from("exam_sets")
      .select("id, code, title, description, duration_seconds")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (examError) {
      throw new Error("無法讀取考試題組，請確認 Supabase 權限設定。");
    }

    const rows = (data ?? []) as ExamSet[];
    setExamSets(rows);

    if (rows.length > 0) {
      setSelectedExamId(rows[0].id);
    }
  }

  async function handleTeacherVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!password.trim()) {
      setError("請輸入監考老師密碼。");
      return;
    }

    try {
      setVerifying(true);
      setError("");
      setSuccess("");

      const response = await fetch("/api/exam/teacher-verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.message || "監考老師驗證失敗。");
      }

      await loadExamSets();

      setVerified(true);
      setPassword("");
      setSuccess("監考老師驗證成功，請選擇考試題組。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "驗證時發生錯誤。");
    } finally {
      setVerifying(false);
    }
  }

  async function handleSelectExam() {
    if (!selectedExamId) {
      setError("請選擇考試題組。");
      return;
    }

    try {
      setSubmitting(true);
      setError("");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: session, error: sessionError } = await supabase
        .from("exam_sessions")
        .insert({
          student_id: user.id,
          exam_set_id: selectedExamId,
          status: "teacher_verified",
        })
        .select("id")
        .single();

      if (sessionError || !session) {
        throw new Error(
          "無法建立考試場次。請確認 profiles 與 exam_sessions 的權限設定。"
        );
      }

      router.push(`/exam/instructions?session=${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立考試場次時發生錯誤。");
    } finally {
      setSubmitting(false);
    }
  }

  if (pageLoading) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-slate-500">載入中...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
        <div className="text-center">
          <div className="text-green-600 text-5xl mb-3">✓</div>

          <h1 className="text-2xl font-bold text-slate-900">
            考生登入成功
          </h1>

          <p className="mt-2 text-slate-600">
            考生：<span className="font-semibold">{studentName}</span>
          </p>
        </div>

        {!verified ? (
          <>
            <div className="mt-7 rounded-xl bg-amber-50 border border-amber-200 p-5 text-center">
              <p className="font-semibold text-amber-900">
                請交由監考老師操作
              </p>
              <p className="text-sm text-amber-700 mt-1">
                以下密碼由監考老師輸入，考生請勿操作。
              </p>
            </div>

            <form onSubmit={handleTeacherVerify} className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="teacher-password"
                  className="block text-sm font-medium text-slate-700 mb-2"
                >
                  監考老師密碼
                </label>

                <input
                  id="teacher-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={verifying}
                  className="w-full rounded-lg border border-slate-300 px-4 py-3
                             text-slate-900 outline-none
                             focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="請輸入老師密碼"
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={verifying}
                className="w-full rounded-lg bg-slate-900 px-4 py-3 font-semibold
                           text-white hover:bg-slate-800 disabled:bg-slate-400"
              >
                {verifying ? "驗證中..." : "確認老師身分"}
              </button>
            </form>
          </>
        ) : (
          <div className="mt-7">
            <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
              {success}
            </div>

            <h2 className="mt-6 text-lg font-bold text-slate-900">
              選擇本次考試題組
            </h2>

            {examSets.length === 0 ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
                目前沒有啟用中的考試題組。請先在 Supabase 建立 exam_sets。
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {examSets.map((exam) => (
                  <label
                    key={exam.id}
                    className={`block cursor-pointer rounded-xl border p-4 transition ${
                      selectedExamId === exam.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex gap-3">
                      <input
                        type="radio"
                        name="exam-set"
                        value={exam.id}
                        checked={selectedExamId === exam.id}
                        onChange={() => setSelectedExamId(exam.id)}
                        className="mt-1"
                      />

                      <div>
                        <p className="font-semibold text-slate-900">
                          {exam.title}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          {exam.code}
                        </p>

                        {exam.description && (
                          <p className="text-sm text-slate-600 mt-2">
                            {exam.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={handleSelectExam}
              disabled={
                submitting || examSets.length === 0 || !selectedExamId
              }
              className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-3
                         font-semibold text-white hover:bg-blue-700
                         disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {submitting ? "建立考試場次..." : "確認題組並交還考生"}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-5 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
