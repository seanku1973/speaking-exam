import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createTeacherToken,
  TEACHER_COOKIE_NAME,
} from "@/lib/teacherAuth";

export const runtime = "nodejs";

function safeEqual(a: string, b: string) {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

export async function POST(request: NextRequest) {
  try {
    const configuredPassword = process.env.TEACHER_ADMIN_PASSWORD;

    if (!configuredPassword) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "TEACHER_ADMIN_PASSWORD 尚未設定。請確認 .env.local 後重新啟動網站。",
        },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const password = String(body?.password || "");

    if (!password) {
      return NextResponse.json(
        { ok: false, message: "請輸入老師管理密碼。" },
        { status: 400 }
      );
    }

    if (!safeEqual(password, configuredPassword)) {
      return NextResponse.json(
        { ok: false, message: "老師管理密碼錯誤。" },
        { status: 401 }
      );
    }

    // createTeacherToken() also verifies that the session secret exists.
    const token = createTeacherToken();

    const response = NextResponse.json({ ok: true });

    response.cookies.set({
      name: TEACHER_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 8 * 60 * 60,
    });

    return response;
  } catch (error) {
    // Always return JSON so the browser never gets:
    // "Unexpected end of JSON input"
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "老師登入服務發生未知錯誤。",
      },
      { status: 500 }
    );
  }
}
