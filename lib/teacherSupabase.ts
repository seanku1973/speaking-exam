import { createClient } from "@supabase/supabase-js";

export function createTeacherAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  // Prefer the current Supabase Secret Key name, but keep compatibility
  // with the legacy/previous Phase 6 variable.
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL 尚未設定。");
  }

  if (!secretKey) {
    throw new Error(
      "找不到 SUPABASE_SECRET_KEY。請確認 .env.local 已設定 sb_secret_... 後重新啟動網站。"
    );
  }

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
