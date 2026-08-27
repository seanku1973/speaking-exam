import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const TEACHER_EMAIL_CANDIDATES = [
  "teacher@writing.test",
  "teacher@speaking.test",
];

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { ok: false, message: "Supabase 環境變數尚未設定。" },
      { status: 500 }
    );
  }

  let body: { password?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "請求格式錯誤。" },
      { status: 400 }
    );
  }

  const password = body.password?.trim();

  if (!password) {
    return NextResponse.json(
      { ok: false, message: "請輸入監考老師密碼。" },
      { status: 400 }
    );
  }

  for (const email of TEACHER_EMAIL_CANDIDATES) {
    const serverSupabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data, error } = await serverSupabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      continue;
    }

    const { data: profile, error: profileError } = await serverSupabase
      .from("profiles")
      .select("role")
      .eq("user_id", data.user.id)
      .maybeSingle();

    await serverSupabase.auth.signOut();

    if (!profileError && profile?.role === "teacher") {
      return NextResponse.json({
        ok: true,
        message: "監考老師驗證成功。",
      });
    }
  }

  return NextResponse.json(
    { ok: false, message: "監考老師密碼錯誤，或老師帳號尚未設定。" },
    { status: 401 }
  );
}
