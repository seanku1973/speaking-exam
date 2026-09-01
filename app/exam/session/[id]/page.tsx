/* PHASE10E2_IPAD_RECORDER_FIX */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type ExamSet = {
  id: string;
  code: string;
  title: string;
  audio_path: string | null;
};

type ExamSession = {
  id: string;
  student_id: string;
  exam_set_id: string;
  status: string;
};

function formatTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "00:00";
  const seconds = Math.floor(totalSeconds);
  const mm = Math.floor(seconds / 60).toString().padStart(2, "0");
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function pickRecordingMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];

  for (const candidate of candidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(candidate)
    ) {
      return candidate;
    }
  }

  return "";
}

function extensionForMime(mimeType: string) {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  return "webm";
}

export default function ExamSessionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const sessionId = params.id;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const examActiveRef = useRef(false);

  const [studentId, setStudentId] = useState("");
  const [examSet, setExamSet] = useState<ExamSet | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioReady, setAudioReady] = useState(false);
  const [micReady, setMicReady] = useState(false);

  const [preparing, setPreparing] = useState(true);
  const [starting, setStarting] = useState(false);
  const [examStarted, setExamStarted] = useState(false);
  const [audioFinished, setAudioFinished] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [diagnostic, setDiagnostic] = useState("");

  const logEvent = useCallback(
    async (
      eventType: string,
      audioCurrentTime?: number,
      metadata: Record<string, unknown> = {}
    ) => {
      try {
        await supabase.from("exam_events").insert({
          session_id: sessionId,
          event_type: eventType,
          audio_current_time_seconds:
            typeof audioCurrentTime === "number" ? audioCurrentTime : null,
          metadata,
        });
      } catch {
        // Best-effort audit log.
      }
    },
    [sessionId]
  );

  useEffect(() => {
    let cancelled = false;

    async function prepareExam() {
      try {
        setPreparing(true);
        setError("");
        setDiagnostic("");

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace("/login");
          return;
        }

        setStudentId(user.id);

        const { data: session, error: sessionError } = await supabase
          .from("exam_sessions")
          .select("id, student_id, exam_set_id, status")
          .eq("id", sessionId)
          .eq("student_id", user.id)
          .maybeSingle<ExamSession>();

        if (sessionError || !session) {
          throw new Error(`找不到考試場次：${sessionError?.message ?? "unknown"}`);
        }

        if (session.status !== "ready") {
          throw new Error(
            `目前考試狀態是 ${session.status}，必須是 ready 才能進入正式測驗。`
          );
        }

        const { data: loadedExamSet, error: examSetError } = await supabase
          .from("exam_sets")
          .select("id, code, title, audio_path")
          .eq("id", session.exam_set_id)
          .maybeSingle<ExamSet>();

        if (examSetError || !loadedExamSet) {
          throw new Error(`找不到考試題組：${examSetError?.message ?? "unknown"}`);
        }

        if (!loadedExamSet.audio_path) {
          throw new Error("exam_sets.audio_path 是空白。");
        }

        if (cancelled) return;
        setExamSet(loadedExamSet);
        setDiagnostic(`目前設定的 MP3 路徑：${loadedExamSet.audio_path}`);

        const { data: signedData, error: signedError } = await supabase.storage
          .from("exam-audio")
          .createSignedUrl(loadedExamSet.audio_path, 60 * 60 * 2);

        if (signedError || !signedData?.signedUrl) {
          throw new Error(
            `無法取得正式考試音檔。Storage 回覆：${
              signedError?.message ?? "沒有 Signed URL"
            }。目前 audio_path：${loadedExamSet.audio_path}`
          );
        }

        if (cancelled) return;
        setAudioUrl(signedData.signedUrl);

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        micStreamRef.current = stream;
        setMicReady(true);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "正式測驗準備時發生錯誤。"
        );
      } finally {
        if (!cancelled) setPreparing(false);
      }
    }

    prepareExam();

    return () => {
      cancelled = true;
      if (!examActiveRef.current) {
        micStreamRef.current?.getTracks().forEach((track) => track.stop());
      }
    };
  }, [router, sessionId]);

  async function startExam() {
    if (
      !audioRef.current ||
      !micStreamRef.current ||
      !audioReady ||
      !micReady ||
      !examSet
    ) {
      setError("考試音檔或麥克風尚未準備完成。");
      return;
    }

    try {
      setStarting(true);
      setError("");
      chunksRef.current = [];

      const mimeType = pickRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(micStreamRef.current, { mimeType })
        : new MediaRecorder(micStreamRef.current);

      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) chunksRef.current.push(event.data);
      };

      const audio = audioRef.current;
      audio.currentTime = 0;
      const startedAt = new Date().toISOString();

      recorder.start(1000);

      try {
        await audio.play();
      } catch (playError) {
        if (recorder.state !== "inactive") recorder.stop();
        throw playError;
      }

      examActiveRef.current = true;
      setExamStarted(true);

      await supabase
        .from("exam_sessions")
        .update({
          status: "recording",
          started_at: startedAt,
          audio_started_at: startedAt,
          recording_started_at: startedAt,
          updated_at: startedAt,
        })
        .eq("id", sessionId)
        .eq("student_id", studentId);

      void logEvent("EXAM_STARTED", 0);
    } catch (err) {
      setError(
        err instanceof Error ? `無法開始正式測驗：${err.message}` : "無法開始正式測驗。"
      );
    } finally {
      setStarting(false);
    }
  }

  async function handleAudioEnded() {
    if (!examStarted || audioFinished) return;

    const endedAt = new Date().toISOString();
    setAudioFinished(true);

    await supabase
      .from("exam_sessions")
      .update({
        status: "audio_finished",
        audio_finished_at: endedAt,
        updated_at: endedAt,
      })
      .eq("id", sessionId)
      .eq("student_id", studentId);

    void logEvent("AUDIO_FINISHED", audioRef.current?.currentTime ?? duration);
  }

  async function finishAndUpload() {
    if (!audioFinished || !recorderRef.current || !studentId) return;

    try {
      setSubmitting(true);
      setError("");

      const recorder = recorderRef.current;

      const blob = await new Promise<Blob>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("停止錄音逾時。")),
          60000
        );

        recorder.addEventListener(
          "stop",
          () => {
            window.clearTimeout(timeout);
            resolve(
              new Blob(chunksRef.current, {
                type: recorder.mimeType || "audio/webm",
              })
            );
          },
          { once: true }
        );

        recorder.stop();
      });

      if (blob.size <= 0) throw new Error("錄音檔為空白。");

      const mimeType = blob.type || recorder.mimeType || "audio/webm";
      const extension = extensionForMime(mimeType);
      const recordingPath = `${studentId}/${sessionId}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("exam-recordings")
        .upload(recordingPath, blob, {
          contentType: mimeType,
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`錄音上傳失敗：${uploadError.message}`);
      }

      const finishedAt = new Date().toISOString();

      const { error: dbError } = await supabase
        .from("exam_sessions")
        .update({
          status: "uploaded",
          recording_finished_at: finishedAt,
          recording_path: recordingPath,
          recording_mime_type: mimeType,
          recording_size_bytes: blob.size,
          upload_status: "completed",
          grading_status: "pending",
          updated_at: finishedAt,
        })
        .eq("id", sessionId)
        .eq("student_id", studentId);

      if (dbError) throw new Error(dbError.message);

      examActiveRef.current = false;
      micStreamRef.current?.getTracks().forEach((track) => track.stop());

      window.location.assign(
        `/exam/submitted?session=${encodeURIComponent(sessionId)}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交測驗時發生錯誤。");
    } finally {
      setSubmitting(false);
    }
  }

  const progress =
    duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-4xl">
        <header className="text-center">
          <p className="text-sm font-semibold tracking-[0.2em] text-blue-300">
            OFFICIAL SPEAKING EXAM
          </p>
          <h1 className="mt-3 text-3xl font-bold">
            {examSet?.title ?? "中級口說能力電腦測驗"}
          </h1>
        </header>

        {error && (
          <div className="mt-7 rounded-xl border border-red-500 bg-red-950/70 p-5 text-red-100">
            <p className="font-bold">正式考試音檔載入失敗</p>
            <p className="mt-2 break-all text-sm leading-6">{error}</p>
            {diagnostic && (
              <p className="mt-3 break-all rounded-lg bg-black/30 p-3 text-xs text-amber-100">
                {diagnostic}
              </p>
            )}
          </div>
        )}

        <audio
          ref={audioRef}
          src={audioUrl || undefined}
          preload="auto"
          onCanPlay={() => setAudioReady(true)}
          onLoadedMetadata={(e) => {
            if (Number.isFinite(e.currentTarget.duration)) {
              setDuration(e.currentTarget.duration);
            }
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onEnded={handleAudioEnded}
          className="hidden"
        />

        <div className="mt-7 rounded-2xl border border-slate-700 bg-slate-900 p-7">
          {!examStarted ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
                  <p className="text-sm text-slate-400">正式考試音檔</p>
                  <p className={`mt-2 font-bold ${audioReady ? "text-green-400" : "text-amber-300"}`}>
                    {audioReady ? "✓ 已載入" : preparing ? "載入中..." : "尚未載入"}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
                  <p className="text-sm text-slate-400">麥克風</p>
                  <p className={`mt-2 font-bold ${micReady ? "text-green-400" : "text-amber-300"}`}>
                    {micReady ? "✓ 已準備" : preparing ? "準備中..." : "尚未準備"}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={startExam}
                disabled={!audioReady || !micReady || starting || !!error}
                className="mt-7 w-full rounded-xl bg-red-600 px-6 py-4 text-lg font-bold text-white
                           hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-slate-600"
              >
                {starting ? "正在開始..." : "開始正式測驗"}
              </button>
            </>
          ) : (
            <>
              <div className="text-center">
                <div className="inline-flex items-center gap-3 rounded-full bg-red-950/60 px-5 py-2">
                  <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
                  <span className="font-bold">全程錄音中</span>
                </div>

                <h2 className="mt-7 text-4xl font-bold">
                  {audioFinished ? "考試音檔播放完畢" : "考試進行中"}
                </h2>
              </div>

              <div className="mt-10">
                <div className="flex justify-between text-sm text-slate-400">
                  <span>{formatTime(currentTime)}</span>
                  <span>{duration ? formatTime(duration) : "--:--"}</span>
                </div>

                <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className="h-full bg-blue-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={finishAndUpload}
                disabled={!audioFinished || submitting}
                className="mt-8 w-full rounded-xl bg-green-600 px-6 py-4 text-lg font-bold text-white
                           hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-slate-600"
              >
                {submitting
                  ? "正在上傳錄音..."
                  : audioFinished
                    ? "結束並提交測驗"
                    : "考試音檔尚未播放完畢"}
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
