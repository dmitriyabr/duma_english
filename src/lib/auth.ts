import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { config } from "./config";

const SESSION_COOKIE = "session";
const TEACHER_SESSION_COOKIE = "teacher_session";
const SESSION_TTL_DAYS = config.auth.sessionTtlDays;

function getJwtSecret() {
  const secret = config.auth.sessionSecret;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

export async function issueStudentToken(payload: {
  studentId: string;
  classId: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_DAYS * 24 * 60 * 60;

  return new SignJWT({
    sub: payload.studentId,
    classId: payload.classId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(getJwtSecret());
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export async function getStudentFromRequest() {
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(SESSION_COOKIE)?.value;
  const authHeader = (await headers()).get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : undefined;
  const token = bearerToken || cookieToken;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (!payload.sub || typeof payload.classId !== "string") return null;
    return {
      studentId: payload.sub,
      classId: payload.classId,
    };
  } catch {
    return null;
  }
}

// ——— Teacher session (separate cookie, same JWT secret) ———

export async function issueTeacherToken(payload: { teacherId: string }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_DAYS * 24 * 60 * 60;

  return new SignJWT({ sub: payload.teacherId, role: "teacher" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(getJwtSecret());
}

export async function setTeacherSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(TEACHER_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export async function clearTeacherSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(TEACHER_SESSION_COOKIE);
}

export async function getTeacherFromRequest() {
  const cookieStore = await cookies();
  const token = cookieStore.get(TEACHER_SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (payload.role !== "teacher" || !payload.sub) return null;
    return { teacherId: payload.sub };
  } catch {
    return null;
  }
}
