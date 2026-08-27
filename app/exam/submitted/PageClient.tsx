"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type State = "pending" | "running" | "done" | "error";

export default function SubmittedPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session") ?? "";
  const startRef = useRef(Date.now());

  const [elapsed, setElapsed] = useState(0);
  const [states, setStates] = useState<State[]>(["pending", "pending", "pending"]);
  const [details, setDetails] = useState([
    "從正式 MP3 找出 Q1～Q10 與各題作答時間。",
    "建立帶時間位置的考生逐字稿。",
    "逐題比對 Q1～Q10，產生完整 organized report。",
  ]);
  const [error, setError] = useState("");
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)),
      1000
    );
    return () => window.clearInterval(id);
  }, []);

  function setStep(index: number, state: State, detail?: string) {
    setStates((current) => current.map((x, i) => (i === index ? state : x)));
    if (detail) {
      setDetails((current) => current.map((x, i) => (i === index ? detail : x)));
    }
  }

  const post = useCallback(
    async (url: string) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.replace("/login");
        throw new Error("登入已失效。");
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ sessionId }),
      });

      const body = await response.json();
      if (!response.ok || !body.ok) {
        throw new Error(body.message || "處理失敗。");
      }
      return body;
    },
    [router, sessionId]
  );

  const run = useCallback(async () => {
    setError("");
    setScore(null);
    startRef.current = Date.now();

    try {
      setStep(0, "running");
      const b = await post("/api/exam/prepare-blueprint");
      setStep(
        0,
        "done",
        b.cached ? "Q1～Q10 時間軸已有快取 ✓" : "Q1～Q10 時間軸建立完成 ✓"
      );

      setStep(1, "running");
      const t = await post("/api/exam/transcribe-student");
      setStep(
        1,
        "done",
        t.cached
          ? "考生時間軸逐字稿已有快取 ✓"
          : `考生時間軸逐字稿完成（${t.segmentCount ?? 0} segments）✓`
      );

      setStep(2, "running");
      const g = await post("/api/exam/grade-report");
      setStep(2, "done", "Q1～Q10 逐題檢討報告完成 ✓");
      setScore(Number(g.result?.total_score ?? 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : "處理失敗。");
      setStates((current) =>
        current.map((x) => (x === "running" ? "error" : x))
      );
    }
  }, [post]);

  useEffect(() => {
    async function init() {
      const { data: result } = await supabase
        .from("exam_results")
        .select("report_version,total_score")
        .eq("session_id", sessionId)
        .maybeSingle();

      if (result?.report_version === "organized-v5") {
        setStates(["done", "done", "done"]);
        setScore(Number(result.total_score ?? 0));
        return;
      }

      await run();
    }

    if (sessionId) init();
  }, [run, sessionId]);

  const titles = [
    "1｜建立題組時間軸",
    "2｜轉錄考生錄音",
    "3｜Q1～Q10 逐題評分",
  ];

  const passed = score !== null && score >= 80;

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-2xl rounded-3xl bg-white p-8 shadow-xl">
        <div className="text-center">
          <div className="text-5xl text-green-600">✓</div>
          <h1 className="mt-4 text-3xl font-black">測驗錄音已安全保存</h1>
          <p className="mt-2 text-slate-500">
            AI 處理時間：{Math.floor(elapsed / 60)}:
            {String(elapsed % 60).padStart(2, "0")}
          </p>
        </div>

        <div className="mt-8 space-y-4">
          {titles.map((title, index) => (
            <div
              key={title}
              className={`rounded-2xl border p-5 ${
                states[index] === "done"
                  ? "border-green-200 bg-green-50"
                  : states[index] === "running"
                    ? "border-blue-300 bg-blue-50"
                    : states[index] === "error"
                      ? "border-red-300 bg-red-50"
                      : "border-slate-200 bg-slate-50"
              }`}
            >
              <div className="flex justify-between gap-4">
                <p className="font-black">{title}</p>
                <p className="text-sm font-bold">
                  {states[index] === "done"
                    ? "✓ 完成"
                    : states[index] === "running"
                      ? "處理中…"
                      : states[index] === "error"
                        ? "✕ 失敗"
                        : "等待"}
                </p>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {details[index]}
              </p>
            </div>
          ))}
        </div>

        {error && (
          <div className="mt-6 rounded-2xl border border-red-300 bg-red-50 p-5 text-red-700">
            <p className="font-black">處理失敗</p>
            <p className="mt-2 break-words text-sm">{error}</p>
            <button
              onClick={run}
              className="mt-4 w-full rounded-xl bg-blue-600 px-5 py-3 font-black text-white"
            >
              從失敗階段重新執行
            </button>
          </div>
        )}

        {score !== null && (
          <>
            <div
              className={`mt-7 rounded-2xl border-2 p-6 text-center ${
                passed
                  ? "border-green-300 bg-green-50"
                  : "border-red-300 bg-red-50"
              }`}
            >
              <p
                className={`text-6xl font-black ${
                  passed ? "text-green-700" : "text-red-700"
                }`}
              >
                {score}<span className="text-xl">/100</span>
              </p>
              <p
                className={`mt-2 text-xl font-black ${
                  passed ? "text-green-700" : "text-red-700"
                }`}
              >
                {passed ? "PASS" : "NOT PASS"}
              </p>
            </div>

            <button
              onClick={() =>
                router.push(`/progress?session=${encodeURIComponent(sessionId)}`)
              }
              className="mt-6 w-full rounded-xl bg-slate-900 px-5 py-4 text-lg font-black text-white"
            >
              查看完整 Q1～Q10 逐題報告
            </button>
          </>
        )}
      </div>
    </main>
  );
}
