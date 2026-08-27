"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type SessionInfo = {
  id: string;
  status: string;
  student_id: string;
  exam_set_id: string;
};

export default function InstructionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session") ?? "";

  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [examTitle, setExamTitle] = useState("中級口說能力電腦測驗");

  useEffect(() => {
    async function validateSession() {
      if (!sessionId) {
        setError("找不到考試場次，請重新登入後開始。");
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

      const { data: session, error: sessionError } = await supabase
        .from("exam_sessions")
        .select("id, status, student_id, exam_set_id")
        .eq("id", sessionId)
        .eq("student_id", user.id)
        .maybeSingle<SessionInfo>();

      if (sessionError || !session) {
        setError("找不到這次考試資料，請聯絡監考老師。");
        setLoading(false);
        return;
      }

      const { data: examSet } = await supabase
        .from("exam_sets")
        .select("title")
        .eq("id", session.exam_set_id)
        .maybeSingle();

      if (examSet?.title) {
        setExamTitle(examSet.title);
      }

      setLoading(false);
    }

    validateSession();
  }, [router, sessionId]);

  function goToDeviceCheck() {
    if (!accepted || !sessionId) return;
    router.push(`/exam/device-check?session=${encodeURIComponent(sessionId)}`);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-slate-500">載入考試須知...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="text-center">
          <p className="text-sm font-semibold tracking-wide text-blue-600">
            SPEAKING EXAM
          </p>

          <h1 className="mt-2 text-3xl font-bold text-slate-900">
            {examTitle}
          </h1>

          <p className="mt-2 text-slate-500">考試須知</p>
        </div>

        {error ? (
          <div className="mt-7 rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">
            {error}
          </div>
        ) : (
          <>
            <div className="mt-8 space-y-5 text-slate-700">
              <section className="rounded-xl border border-slate-200 p-5">
                <h2 className="font-bold text-slate-900">一、測驗內容</h2>
                <p className="mt-2 leading-7">
                  本測驗包含朗讀短文、回答問題與看圖敘述三個部分。
                </p>
              </section>

              <section className="rounded-xl border border-slate-200 p-5">
                <h2 className="font-bold text-slate-900">二、測驗進行方式</h2>
                <ul className="mt-3 list-disc space-y-2 pl-6 leading-7">
                  <li>請全程配戴耳機，並保持測驗環境安靜。</li>
                  <li>正式開始後，系統會自動播放考試音檔並同步開始全程錄音。</li>
                  <li>考試音檔播放期間不可暫停、快轉或重新播放。</li>
                  <li>請依照耳機中的指示，在指定時間內完成作答。</li>
                  <li>考試音檔尚未播放完畢前，「結束測驗」按鈕不會啟用。</li>
                  <li>測驗結束後，請等待錄音完成上傳，不要關閉瀏覽器。</li>
                </ul>
              </section>

              <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                <h2 className="font-bold text-amber-900">三、重要提醒</h2>
                <ul className="mt-3 list-disc space-y-2 pl-6 leading-7 text-amber-800">
                  <li>正式開始後請勿重新整理頁面或關閉瀏覽器。</li>
                  <li>請勿拔除耳機或麥克風。</li>
                  <li>正式測驗中不可返回上一頁重新作答。</li>
                  <li>如果設備異常，請在正式開始前通知監考老師。</li>
                </ul>
              </section>
            </div>

            <label className="mt-7 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-1 h-5 w-5"
              />

              <span className="text-slate-700">
                我已閱讀並了解以上考試須知，並確認將遵守正式測驗規定。
              </span>
            </label>

            <button
              type="button"
              onClick={goToDeviceCheck}
              disabled={!accepted}
              className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold
                         text-white hover:bg-blue-700
                         disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              我已閱讀並確認，進行設備檢查
            </button>
          </>
        )}
      </div>
    </main>
  );
}
