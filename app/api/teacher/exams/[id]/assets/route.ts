import { NextRequest, NextResponse } from "next/server";
import {
  TEACHER_COOKIE_NAME,
  verifyTeacherToken,
} from "@/lib/teacherAuth";
import { createTeacherAdminSupabase } from "@/lib/teacherSupabase";

export const runtime = "nodejs";
export const maxDuration = 300;

const AUDIO_BUCKET = "exam-audio";
const IMAGE_BUCKET = "exam-images";

const AUDIO_LIMIT = 50 * 1024 * 1024;
const IMAGE_LIMIT = 10 * 1024 * 1024;

function safeName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-100);
}

function extension(name: string) {
  return safeName(name.split(".").pop()?.toLowerCase() || "");
}

function validateAudio(file: any) {
  const ext = extension(String(file?.name || ""));
  const type = String(file?.type || "").toLowerCase();
  const size = Number(file?.size || 0);

  const validExt = ["mp3", "wav"];
  const validMime = [
    "",
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
  ];

  if (!validExt.includes(ext) || !validMime.includes(type)) {
    throw new Error(
      "正式考試音檔請使用 MP3 或 WAV。此 Supabase bucket 目前未開放 M4A。"
    );
  }

  if (!size || size > AUDIO_LIMIT) {
    throw new Error("正式 MP3/WAV 必須小於或等於 50 MB。");
  }

  return { ext };
}

function validateImage(file: any) {
  const ext = extension(String(file?.name || ""));
  const type = String(file?.type || "").toLowerCase();
  const size = Number(file?.size || 0);

  const validExt = ["jpg", "jpeg", "png", "webp"];
  const validMime = ["", "image/jpeg", "image/png", "image/webp"];

  if (!validExt.includes(ext) || !validMime.includes(type)) {
    throw new Error("看圖圖片僅接受 JPG、PNG 或 WebP。");
  }

  if (!size || size > IMAGE_LIMIT) {
    throw new Error("圖片必須小於或等於 10 MB。");
  }

  return { ext };
}

function assertExamPath(
  examCode: string,
  kind: "audio" | "image",
  path: string
) {
  const prefix = `${examCode}/`;

  if (!path.startsWith(prefix)) {
    throw new Error("上傳路徑與題組不符。");
  }

  const filename = path.slice(prefix.length);

  if (
    kind === "audio" &&
    !/^exam-\d+\.(mp3|wav)$/i.test(filename)
  ) {
    throw new Error("MP3 上傳路徑格式錯誤。");
  }

  if (
    kind === "image" &&
    !/^picture-\d+\.(jpg|jpeg|png|webp)$/i.test(filename)
  ) {
    throw new Error("圖片上傳路徑格式錯誤。");
  }
}

async function objectExists(
  supabase: ReturnType<typeof createTeacherAdminSupabase>,
  bucket: string,
  path: string
) {
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  const filename = slash >= 0 ? path.slice(slash + 1) : path;

  const { data, error } = await supabase.storage
    .from(bucket)
    .list(folder, {
      limit: 20,
      search: filename,
    });

  if (error) {
    throw new Error(`無法確認 Storage 檔案：${error.message}`);
  }

  return Boolean(data?.some((item) => item.name === filename));
}

async function responseExamSet(
  supabase: ReturnType<typeof createTeacherAdminSupabase>,
  id: string,
  updated: any
) {
  let audio_url: string | null = null;
  let image_url: string | null = null;

  if (updated.audio_path) {
    const signed = await supabase.storage
      .from(AUDIO_BUCKET)
      .createSignedUrl(updated.audio_path, 60 * 60);

    if (!signed.error) {
      audio_url = signed.data?.signedUrl || null;
    }
  }

  if (updated.image_path) {
    const signed = await supabase.storage
      .from(IMAGE_BUCKET)
      .createSignedUrl(updated.image_path, 60 * 60);

    if (!signed.error) {
      image_url = signed.data?.signedUrl || null;
    }
  }

  const { count: sessionCount } = await supabase
    .from("exam_sessions")
    .select("*", { count: "exact", head: true })
    .eq("exam_set_id", id);

  return {
    ...updated,
    audio_url,
    image_url,
    session_count: sessionCount || 0,
    graded_count: 0,
  };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get(TEACHER_COOKIE_NAME)?.value;

  if (!verifyTeacherToken(token)) {
    return NextResponse.json(
      { ok: false, message: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id } = await context.params;

  try {
    const supabase = createTeacherAdminSupabase();

    const { data: exam, error: examError } = await supabase
      .from("exam_sets")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (examError || !exam) {
      return NextResponse.json(
        { ok: false, message: "找不到指定的測驗題組。" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const action = String(body?.action || "");

    if (action === "sign") {
      const kind: "audio" | "image" =
        body?.kind === "image" ? "image" : "audio";
      const file = body?.file || {};

      const validated =
        kind === "audio"
          ? validateAudio(file)
          : validateImage(file);

      const objectPath =
        kind === "audio"
          ? `${exam.code}/exam-${Date.now()}.${validated.ext}`
          : `${exam.code}/picture-${Date.now()}.${validated.ext}`;

      const bucket =
        kind === "audio" ? AUDIO_BUCKET : IMAGE_BUCKET;

      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUploadUrl(objectPath);

      if (error || !data?.token) {
        throw new Error(
          `無法建立 ${
            kind === "audio" ? "MP3" : "圖片"
          } 安全上傳授權：${
            error?.message || "missing upload token"
          }`
        );
      }

      return NextResponse.json({
        ok: true,
        upload: {
          bucket,
          path: objectPath,
          token: data.token,
        },
      });
    }

    if (action === "finalize") {
      const kind: "audio" | "image" =
        body?.kind === "image" ? "image" : "audio";
      const path = String(body?.path || "");

      assertExamPath(exam.code, kind, path);

      const bucket =
        kind === "audio" ? AUDIO_BUCKET : IMAGE_BUCKET;

      const exists = await objectExists(
        supabase,
        bucket,
        path
      );

      if (!exists) {
        throw new Error(
          `${
            kind === "audio" ? "MP3" : "圖片"
          } 尚未出現在 Supabase Storage，題組資料未變更。`
        );
      }

      const update: Record<string, unknown> = {};
      const previousPath =
        kind === "audio"
          ? exam.audio_path
          : exam.image_path;

      if (kind === "audio") {
        update.audio_path = path;
        update.grading_context = {};
        update.timeline = {};
      } else {
        update.image_path = path;
      }

      const { data: updated, error: updateError } =
        await supabase
          .from("exam_sets")
          .update(update)
          .eq("id", id)
          .select("*")
          .single();

      if (updateError) {
        throw new Error(
          `資料庫更新失敗：${updateError.message}`
        );
      }

      if (
        previousPath &&
        previousPath !== path
      ) {
        const removal = await supabase.storage
          .from(bucket)
          .remove([previousPath]);

        if (removal.error) {
          console.error(
            "Old exam asset cleanup failed:",
            removal.error.message
          );
        }
      }

      return NextResponse.json({
        ok: true,
        exam_set: await responseExamSet(
          supabase,
          id,
          updated
        ),
      });
    }

    return NextResponse.json(
      {
        ok: false,
        message: "不支援的題組檔案操作。",
      },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "檔案上傳失敗。",
      },
      { status: 500 }
    );
  }
}
