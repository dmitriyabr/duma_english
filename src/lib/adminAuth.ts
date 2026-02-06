import { NextRequest } from "next/server";

function decodeBasicHeader(encoded: string) {
  if (typeof atob === "function") {
    return atob(encoded);
  }
  return Buffer.from(encoded, "base64").toString("utf-8");
}

export function checkBasicAuth(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) return false;
  const encoded = authHeader.slice("Basic ".length);
  const decoded = decodeBasicHeader(encoded);
  const [user, pass] = decoded.split(":");
  const expectedUser = process.env.ADMIN_USER || "admin";
  const expectedPass = process.env.ADMIN_PASS || "changeme";
  return user === expectedUser && pass === expectedPass;
}
