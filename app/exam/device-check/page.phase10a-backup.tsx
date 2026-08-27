"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function DeviceCheckPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session") ?? "";

  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const [checkingMic, setCheckingMic] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  const [speakerTested, setSpeakerTested] = useState(false);
  const [heardTestSound, setHeardTestSound] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [statusText, setStatusText] = useState("");

  useEffect(() => {
    async function validateSession() {
      if (!sessionId) {
        setError("找不到考試場次，請重新登入。");
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
        .select("id,status,student_id")
        .eq("id", sessionId)
        .eq("student_id", user.id)
        .maybeSingle();

      if (sessionError || !session) {
        setError("無法確認這次考試場次，請聯絡監考老師。");
      }
    }

    validateSession();

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());

      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => undefined);
      }
    };
  }, [router, sessionId]);

  async function startMicrophoneTest() {
    try {
      setCheckingMic(true);
      setError("");
      setStatusText("");

      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      streamRef.current = stream;

      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error("此瀏覽器不支援麥克風音量檢查。");
      }

      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateMeter = () => {
        analyser.getByteFrequencyData(dataArray);

        const average =
          dataArray.reduce((sum, value) => sum + value, 0) /
          Math.max(dataArray.length, 1);

        const level = Math.min(100, Math.round(average * 1.8));
        setMicLevel(level);

        if (level >= 4) {
          setMicReady(true);
        }

        animationRef.current = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch (err) {
      setMicReady(false);

      if (
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")
      ) {
        setError("麥克風權限被拒絕。請允許瀏覽器使用麥克風後再試一次。");
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "無法啟動麥克風，請通知監考老師。"
        );
      }
    } finally {
      setCheckingMic(false);
    }
  }

  async function playHeadphoneTest() {
    try {
      setError("");
      setStatusText("");
      setSpeakerTested(true);
      setHeardTestSound(false);

      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error("此瀏覽器無法播放測試音。");
      }

      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(660, context.currentTime);

      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.75);

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start();
      oscillator.stop(context.currentTime + 0.8);

      oscillator.addEventListener("ended", () => {
        context.close().catch(() => undefined);
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "測試音播放失敗，請通知監考老師。"
      );
    }
  }

  async function continueToExam() {
    if (!micReady || !heardTestSound) {
      setError("請先完成麥克風與耳機兩項檢查。");
      return;
    }

    if (!sessionId) {
      setError("找不到考試場次。");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setStatusText("正在確認考試場次...");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/login";
        return;
      }

      const now = new Date().toISOString();

      const { data: updatedSession, error: updateError } = await supabase
        .from("exam_sessions")
        .update({
          status: "ready",
          updated_at: now,
        })
        .eq("id", sessionId)
        .eq("student_id", user.id)
        .select("id,status")
        .maybeSingle();

      if (updateError) {
        throw new Error(`無法更新考試狀態：${updateError.message}`);
      }

      if (!updatedSession || updatedSession.status !== "ready") {
        throw new Error(
          "考試場次未成功切換為 ready。請通知監考老師重新建立考試場次。"
        );
      }

      setStatusText("設備檢查完成，正在進入正式測驗...");

      streamRef.current?.getTracks().forEach((track) => track.stop());

      // Hard navigation avoids any client-router issue.
      window.location.assign(
        `/exam/ready?session=${encodeURIComponent(sessionId)}`
      );
    } catch (err) {
      setStatusText("");
      setError(
        err instanceof Error ? err.message : "進入正式測驗時發生錯誤。"
      );
    } finally {
      setSaving(false);
    }
  }

  const allReady = micReady && heardTestSound;

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 pb-32">
      <div className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-7 shadow-lg">
        <div className="text-center">
          <p className="text-sm font-semibold tracking-wide text-blue-600">
            DEVICE CHECK
          </p>

          <h1 className="mt-2 text-2xl font-bold text-slate-900">
            耳機與麥克風檢查
          </h1>

          <p className="mt-2 text-slate-500">
            正式開始前，請確認以下兩項設備均正常。
          </p>
        </div>

        <section className="mt-8 rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-bold text-slate-900">1. 麥克風</h2>
              <p className="mt-1 text-sm text-slate-600">
                按下測試後，請對著麥克風說幾句話。
              </p>
            </div>

            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold ${
                micReady
                  ? "bg-green-100 text-green-700"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {micReady ? "✓ 正常" : "尚未完成"}
            </span>
          </div>

          <button
            type="button"
            onClick={startMicrophoneTest}
            disabled={checkingMic}
            className="mt-4 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800 disabled:bg-slate-400"
          >
            {checkingMic ? "啟動中..." : "開始麥克風測試"}
          </button>

          <div className="mt-4">
            <div className="mb-2 flex justify-between text-xs text-slate-500">
              <span>麥克風音量</span>
              <span>{micLevel}%</span>
            </div>

            <div className="h-4 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-green-500 transition-all duration-75"
                style={{ width: `${micLevel}%` }}
              />
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-bold text-slate-900">2. 耳機</h2>
              <p className="mt-1 text-sm text-slate-600">
                請戴上耳機，再播放測試音。
              </p>
            </div>

            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold ${
                heardTestSound
                  ? "bg-green-100 text-green-700"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {heardTestSound ? "✓ 正常" : "尚未完成"}
            </span>
          </div>

          <button
            type="button"
            onClick={playHeadphoneTest}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
          >
            播放耳機測試音
          </button>

          {speakerTested && (
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg bg-slate-50 p-4">
              <input
                type="checkbox"
                checked={heardTestSound}
                onChange={(e) => setHeardTestSound(e.target.checked)}
                className="mt-1 h-5 w-5"
              />

              <span className="text-slate-700">
                我可以清楚從耳機聽到測試音。
              </span>
            </label>
          )}
        </section>

        {error && (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {statusText && (
          <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-center text-sm font-semibold text-blue-700">
            {statusText}
          </div>
        )}
      </div>

      {/* Fixed action bar: guaranteed visible */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
          background: "white",
          borderTop: "1px solid #cbd5e1",
          boxShadow: "0 -4px 18px rgba(15,23,42,0.10)",
          padding: "14px 18px",
        }}
      >
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          <button
            type="button"
            onClick={continueToExam}
            disabled={!allReady || saving}
            style={{
              width: "100%",
              minHeight: 56,
              border: 0,
              borderRadius: 12,
              fontSize: 18,
              fontWeight: 800,
              cursor: !allReady || saving ? "not-allowed" : "pointer",
              background: !allReady || saving ? "#cbd5e1" : "#16a34a",
              color: "white",
              opacity: 1,
            }}
          >
            {saving
              ? "正在進入正式測驗..."
              : allReady
                ? "下一步：進入正式測驗"
                : "請先完成兩項設備檢查"}
          </button>
        </div>
      </div>
    </main>
  );
}
