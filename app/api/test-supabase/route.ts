import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return NextResponse.json(
      {
        ok: false,
        error: "Supabase environment variables are missing.",
      },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: {
        apikey: key,
      },
      cache: "no-store",
    });

    const data = await response.text();

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      message: response.ok
        ? "Supabase connected successfully."
        : "Supabase responded, but connection test failed.",
      response: data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown connection error",
      },
      { status: 500 }
    );
  }
}