"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ProgressPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session") ?? "";
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<any>(null);
  const [examTitle, setExamTitle] = useState("中級口說能力電腦測驗");
  const [student, setStudent] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace("/login");
        return;
      }

      setStudent(auth.user.email?.split("@")[0] || "考生");

      const { data: session } = await supabase
        .from("exam_sessions")
        .select("exam_set_id")
        .eq("id", sessionId)
        .eq("student_id", auth.user.id)
        .maybeSingle();

      if (!session) {
        setError("找不到考試資料。");
        setLoading(false);
        return;
      }

      const [{ data: examSet }, { data: examResult }] = await Promise.all([
        supabase.from("exam_sets").select("title").eq("id", session.exam_set_id).maybeSingle(),
        supabase
          .from("exam_results")
          .select("*")
          .eq("session_id", sessionId)
          .maybeSingle(),
      ]);

      if (!examResult || examResult.report_version !== "organized-v5") {
        setError("organized-v5 逐題報告尚未完成。");
        setLoading(false);
        return;
      }

      if (examSet?.title) setExamTitle(examSet.title);
      setResult(examResult);
      setLoading(false);
    }

    load();
  }, [router, sessionId]);

  const q = useMemo(() => {
    const rows = result?.grading_json?.question_reviews || [];
    return [...rows].sort((a: any, b: any) => a.question_number - b.question_number);
  }, [result]);

  if (loading) return <main className="min-h-screen grid place-items-center">載入報告...</main>;
  if (!result || error) return <main className="min-h-screen grid place-items-center"><div className="text-red-700">{error}</div></main>;

  const total = Number(result.total_score || 0);
  const passed = total >= 80;
  const scores = result.grading_json?.scores || {};
  const reading = result.grading_json?.reading_review || {};
  const picture = result.grading_json?.picture_review || {};

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className={`rounded-3xl border-2 p-8 ${passed ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}`}>
          <div className="flex flex-col gap-5 md:flex-row md:justify-between md:items-center">
            <div>
              <p className="text-sm font-black tracking-widest">SPEAKING EXAM REPORT</p>
              <h1 className="mt-2 text-3xl font-black">{examTitle}</h1>
              <p className="mt-2 text-slate-600">考生：{student}</p>
            </div>
            <div className="text-center md:text-right">
              <p className={`text-7xl font-black ${passed ? "text-green-700" : "text-red-700"}`}>{total}<span className="text-2xl">/100</span></p>
              <p className={`text-2xl font-black ${passed ? "text-green-700" : "text-red-700"}`}>{passed ? "PASS" : "NOT PASS"}</p>
            </div>
          </div>
        </header>

        <section className="rounded-2xl bg-white p-7 shadow-sm">
          <h2 className="text-2xl font-black">一、總體診斷</h2>
          <p className="mt-4 leading-8 text-slate-700">{result.grading_json?.executive_summary}</p>
        </section>

        <section className="rounded-2xl bg-white p-7 shadow-sm">
          <h2 className="text-2xl font-black">二、五項能力分析</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-5">
            {[
              ["Content", result.content_score, scores.content?.feedback],
              ["Organization", result.organization_score, scores.organization?.feedback],
              ["Grammar", result.grammar_score, scores.grammar?.feedback],
              ["Vocabulary", result.vocabulary_score, scores.vocabulary?.feedback],
              ["Fluency", result.fluency_score, scores.fluency?.feedback],
            ].map(([name, value]: any) => (
              <div key={name} className="rounded-xl border p-4 text-center">
                <p className="font-bold text-slate-500">{name}</p>
                <p className="mt-2 text-3xl font-black">{value}/20</p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {[
              ["Content", scores.content?.feedback],
              ["Organization", scores.organization?.feedback],
              ["Grammar", scores.grammar?.feedback],
              ["Vocabulary", scores.vocabulary?.feedback],
              ["Fluency", scores.fluency?.feedback],
            ].map(([name, feedback]) => (
              <div key={name} className="rounded-xl border p-5">
                <p className="font-black">{name}</p>
                <p className="mt-2 leading-7 text-slate-700">{feedback || "—"}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-7 shadow-sm">
          <h2 className="text-2xl font-black">三、第一部分｜朗讀短文</h2>
          <div className="mt-5 rounded-xl bg-slate-50 p-5">
            <p className="font-black text-slate-500">考生朗讀轉錄</p>
            <p className="mt-2 leading-8">{reading.student_text || "—"}</p>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {[
              ["完成度", reading.completion_review],
              ["流暢度", reading.fluency_review],
              ["明顯讀誤 / 漏讀", reading.accuracy_review],
            ].map(([t, x]) => (
              <div key={t} className="rounded-xl border p-5">
                <p className="font-black">{t}</p>
                <p className="mt-2 leading-7 text-slate-700">{x || "—"}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-7 shadow-sm">
          <div className="border-b pb-5">
            <h2 className="text-3xl font-black">四、第二部分｜Q1～Q10 逐題檢討</h2>
            <p className="mt-2 text-slate-500">每題固定：正式題目 → 考生回答 → 是否切題 → 內容 → 語言 → 建議回答 → 練習重點。</p>
          </div>

          <div className="mt-7 space-y-8">
            {q.map((item: any) => (
              <article key={item.question_number} className="overflow-hidden rounded-3xl border-2">
                <div className="bg-slate-900 p-6 text-white">
                  <p className="text-sm font-black text-blue-300">QUESTION {item.question_number}</p>
                  <h3 className="mt-2 text-xl font-black">{item.question}</h3>
                </div>
                <div className="bg-slate-50 p-6">
                  <p className="text-sm font-black text-slate-500">STUDENT ANSWER</p>
                  <p className="mt-2 text-lg leading-8">{item.student_answer || "（未偵測到有效回答）"}</p>
                </div>
                <div className="grid lg:grid-cols-2">
                  <div className="space-y-5 border-r p-6">
                    <div><b>1. 是否切題</b><p className="mt-2 leading-7 text-slate-700">{item.directness}</p></div>
                    <div><b>2. 內容檢討</b><p className="mt-2 leading-7 text-slate-700">{item.content_review}</p></div>
                    <div><b>3. 還可以補充什麼</b><p className="mt-2 leading-7 text-slate-700">{item.missing_or_expand}</p></div>
                  </div>
                  <div className="p-6">
                    <b>4. Grammar / Vocabulary</b>
                    <p className="mt-2 leading-7 text-slate-700">{item.language_review}</p>
                    {(item.language_issues || []).map((issue: any, i: number) => (
                      <div key={i} className="mt-3 rounded-xl bg-slate-50 p-4">
                        <p className="text-red-700"><b>原句：</b>{issue.original}</p>
                        <p className="mt-2 text-green-700"><b>修正：</b>{issue.corrected}</p>
                        <p className="mt-2 text-sm text-slate-600">{issue.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border-t bg-blue-50 p-6">
                  <b className="text-blue-900">5. 建議回答</b>
                  <p className="mt-2 text-lg leading-8 text-blue-950">{item.better_answer}</p>
                </div>
                <div className="border-t p-6"><b>6. 本題練習重點：</b>{item.next_step}</div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-7 shadow-sm">
          <h2 className="text-2xl font-black">五、第三部分｜看圖敘述</h2>
          <p className="mt-2 text-sm text-slate-500">整段 90 秒視為一個完整表現，不拆四個引導問題。</p>
          <div className="mt-5 rounded-xl bg-slate-50 p-5">
            <p className="font-black text-slate-500">考生看圖敘述</p>
            <p className="mt-2 leading-8">{picture.student_answer || "—"}</p>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {[
              ["畫面內容涵蓋", picture.scene_coverage],
              ["組織與順序", picture.organization_review],
              ["Grammar / Vocabulary", picture.language_review],
              ["內容發展", picture.development_review],
            ].map(([t, x]) => (
              <div key={t} className="rounded-xl border p-5">
                <p className="font-black">{t}</p>
                <p className="mt-2 leading-7 text-slate-700">{x || "—"}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-xl bg-blue-50 p-5">
            <p className="font-black text-blue-900">更好的敘述示範</p>
            <p className="mt-2 leading-8 text-blue-950">{picture.better_description || "—"}</p>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-7 shadow-sm">
          <h2 className="text-2xl font-black">六、改善優先順序</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div className="rounded-xl bg-green-50 p-5">
              <b className="text-green-900">主要優點</b>
              <ul className="mt-3 list-disc pl-6 text-green-900">
                {(result.grading_json?.strengths || []).map((x: string, i: number) => <li key={i}>{x}</li>)}
              </ul>
            </div>
            <div className="rounded-xl bg-red-50 p-5">
              <b className="text-red-900">優先改善</b>
              <ol className="mt-3 list-decimal pl-6 text-red-900">
                {(result.grading_json?.priority_improvements || []).map((x: string, i: number) => <li key={i}>{x}</li>)}
              </ol>
            </div>
          </div>
          <div className="mt-5 rounded-xl bg-slate-900 p-5 text-white">
            <b>下一階段練習計畫</b>
            <ol className="mt-3 list-decimal pl-6">
              {(result.grading_json?.action_plan || []).map((x: string, i: number) => <li key={i}>{x}</li>)}
            </ol>
          </div>
        </section>

        <details className="rounded-2xl bg-white p-7 shadow-sm">
          <summary className="cursor-pointer text-xl font-black">附錄｜完整 Transcript</summary>
          <p className="mt-5 whitespace-pre-wrap leading-8">{result.transcript}</p>
        </details>
      </div>
    </main>
  );
}
