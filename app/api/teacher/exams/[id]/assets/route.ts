import { NextRequest, NextResponse } from "next/server";
import {
  TEACHER_COOKIE_NAME,
  verifyTeacherToken,
} from "@/lib/teacherAuth";
import { createTeacherAdminSupabase } from "@/lib/teacherSupabase";

export const runtime = "nodejs";
export const maxDuration = 300;

function safeName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-100);
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

    const form = await request.formData();
    const audio = form.get("audio");
    const image = form.get("image");

    if (!(audio instanceof File) && !(image instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          message: "請至少選擇一個音訊或圖片檔案。",
        },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = {};

    if (audio instanceof File) {
      if (!audio.type.startsWith("audio/")) {
        return NextResponse.json(
          { ok: false, message: "正式考試檔案必須是 audio 類型。" },
          { status: 400 }
        );
      }

      if (audio.size > 200 * 1024 * 1024) {
        return NextResponse.json(
          { ok: false, message: "正式 MP3 不可超過 200 MB。" },
          { status: 400 }
        );
      }

      const ext =
        audio.name.split(".").pop()?.toLowerCase() ||
        (audio.type.includes("mpeg") ? "mp3" : "audio");

      const audioPath = `${exam.code}/exam-${Date.now()}.${safeName(ext)}`;

      const upload = await supabase.storage
        .from("exam-audio")
        .upload(audioPath, audio, {
          contentType: audio.type,
          upsert: false,
        });

      if (upload.error) {
        throw new Error(`MP3 上傳失敗：${upload.error.message}`);
      }

      // Remove the previous object only after the new object is safe.
      if (exam.audio_path && exam.audio_path !== audioPath) {
        await supabase.storage
          .from("exam-audio")
          .remove([exam.audio_path]);
      }

      update.audio_path = audioPath;

      // Critical: official audio changed, so any cached Q1-Q10 blueprint
      // is now stale and must be rebuilt.
      update.grading_context = {};
      update.timeline = {};
    }

    if (image instanceof File) {
      const accepted = [
        "image/jpeg",
        "image/png",
        "image/webp",
      ];

      if (!accepted.includes(image.type)) {
        return NextResponse.json(
          {
            ok: false,
            message: "看圖圖片僅接受 JPG、PNG 或 WebP。",
          },
          { status: 400 }
        );
      }

      if (image.size > 15 * 1024 * 1024) {
        return NextResponse.json(
          { ok: false, message: "圖片不可超過 15 MB。" },
          { status: 400 }
        );
      }

      const ext =
        image.name.split(".").pop()?.toLowerCase() ||
        (image.type === "image/png" ? "png" : "jpg");

      const imagePath = `${exam.code}/picture-${Date.now()}.${safeName(ext)}`;

      const upload = await supabase.storage
        .from("exam-images")
        .upload(imagePath, image, {
          contentType: image.type,
          upsert: false,
        });

      if (upload.error) {
        throw new Error(`圖片上傳失敗：${upload.error.message}`);
      }

      if (exam.image_path && exam.image_path !== imagePath) {
        await supabase.storage
          .from("exam-images")
          .remove([exam.image_path]);
      }

      update.image_path = imagePath;
    }

    const { data: updated, error: updateError } = await supabase
      .from("exam_sets")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      throw new Error(`資料庫更新失敗：${updateError.message}`);
    }

    let audio_url: string | null = null;
    let image_url: string | null = null;

    if (updated.audio_path) {
      const signed = await supabase.storage
        .from("exam-audio")
        .createSignedUrl(updated.audio_path, 60 * 60);

      if (!signed.error) {
        audio_url = signed.data?.signedUrl || null;
      }
    }

    if (updated.image_path) {
      const signed = await supabase.storage
        .from("exam-images")
        .createSignedUrl(updated.image_path, 60 * 60);

      if (!signed.error) {
        image_url = signed.data?.signedUrl || null;
      }
    }

    const { count: sessionCount } = await supabase
      .from("exam_sessions")
      .select("*", { count: "exact", head: true })
      .eq("exam_set_id", id);

    return NextResponse.json({
      ok: true,
      exam_set: {
        ...updated,
        audio_url,
        image_url,
        session_count: sessionCount || 0,
        graded_count: 0,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "檔案上傳失敗。",
      },
      { status: 500 }
    );
  }
}
