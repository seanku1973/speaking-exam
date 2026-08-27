"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ExamReadyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session") ?? "";

  const [loading, setLoading] = useState(true);
  const [studentName, setStudentName] = useState("");
  const [examTitle, setExamTitle] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadReadyState() {
      if (!sessionId) {
        setError("找不到考試場次。");
        setLoading(false);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      setStudentName(user.email?.split("@")[0] ?? "考生");

      const { data: session, error: sessionError } = await supabase
        .from("exam_sessions")
        .select("id, status, exam_set_id")
        .eq("id", sessionId)
        .eq("student_id", user.id)
        .maybeSingle();

      if (sessionError || !session) {
        setError("找不到這次考試資料。");
        setLoading(false);
        return;
      }

      if (session.status !== "ready") {
        setError("設備檢查尚未完成，不能進入正式測驗。");
        setLoading(false);
        return;
      }

      const { data: examSet } = await supabase
        .from("exam_sets")
        .select("title")
        .eq("id", session.exam_set_id)
        .maybeSingle();

      setExamTitle(examSet?.title ?? "中級口說能力電腦測驗");
      setLoading(false);
    }

    loadReadyState();
  }, [router, sessionId]);

  function continueToExam() {
    if (!sessionId) return;
    router.push(`/exam/session/${encodeURIComponent(sessionId)}`);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-300">載入中...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 text-center shadow-2xl">
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">
            {error}
          </div>
        ) : (
          <>
            <div className="text-5xl text-green-600">✓</div>

            <h1 className="mt-4 text-3xl font-bold text-slate-900">
              準備完成
            </h1>

            <p className="mt-3 text-slate-600">
              考生：<span className="font-semibold">{studentName}</span>
            </p>

            <p className="mt-1 text-slate-600">
              題組：<span className="font-semibold">{examTitle}</span>
            </p>

            <div className="mt-7 rounded-xl border border-green-200 bg-green-50 p-5">
              <p className="font-bold text-green-800">
                耳機與麥克風檢查完成
              </p>
              <p className="mt-2 text-sm leading-6 text-green-700">
                下一頁會先載入正式考試音檔並重新取得麥克風。全部準備完成後，
                才會出現可使用的「開始正式測驗」按鈕。
              </p>
            </div>

            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
              進入下一頁後仍不會立刻開始考試；考生按下「開始正式測驗」後，
              考試音檔與全程錄音才會同步開始。
            </div>

            <button
              type="button"
              onClick={continueToExam}
              className="mt-7 w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700"
            >
              進入正式測驗
            </button>
          </>
        )}
      </div>
    </main>
  );
}
