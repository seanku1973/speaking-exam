import { createHmac, timingSafeEqual } from "crypto";

export const TEACHER_COOKIE_NAME = "speaking_exam_teacher_admin";
const SESSION_HOURS = 8;

type TeacherTokenPayload = {
  exp: number;
  scope: "teacher-admin";
};

function getSecret() {
  // Phase 6A accepts both names.
  // The user currently has TEACHER_SESSION_SECRET in .env.local.
  const secret =
    process.env.TEACHER_SESSION_SECRET ||
    process.env.TEACHER_ADMIN_SESSION_SECRET;

  if (!secret) {
    throw new Error(
      "找不到 TEACHER_SESSION_SECRET。請確認 .env.local 已設定後重新啟動網站。"
    );
  }

  if (secret.length < 24) {
    throw new Error(
      "TEACHER_SESSION_SECRET 太短，請使用至少 24 個字元的隨機字串。"
    );
  }

  return secret;
}

function signPayload(encodedPayload: string) {
  return createHmac("sha256", getSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function createTeacherToken() {
  const payload: TeacherTokenPayload = {
    exp: Date.now() + SESSION_HOURS * 60 * 60 * 1000,
    scope: "teacher-admin",
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );

  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

export function verifyTeacherToken(token?: string | null) {
  if (!token) return false;

  try {
    const [encodedPayload, suppliedSignature] = token.split(".");
    if (!encodedPayload || !suppliedSignature) return false;

    const expectedSignature = signPayload(encodedPayload);
    const supplied = Buffer.from(suppliedSignature, "utf8");
    const expected = Buffer.from(expectedSignature, "utf8");

    if (supplied.length !== expected.length) return false;
    if (!timingSafeEqual(supplied, expected)) return false;

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as TeacherTokenPayload;

    return (
      payload.scope === "teacher-admin" &&
      Number.isFinite(payload.exp) &&
      payload.exp > Date.now()
    );
  } catch {
    return false;
  }
}
