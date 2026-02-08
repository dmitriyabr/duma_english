"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const PUBLIC_PATHS = ["/teacher/login", "/teacher/signup"];

export function TeacherGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (PUBLIC_PATHS.includes(pathname ?? "")) {
      setAllowed(true);
      setChecking(false);
      return;
    }
    fetch("/api/auth/teacher/me")
      .then((res) => {
        if (res.ok) setAllowed(true);
        else router.replace("/teacher/login");
      })
      .catch(() => router.replace("/teacher/login"))
      .finally(() => setChecking(false));
  }, [pathname, router]);

  if (checking) {
    return (
      <div className="page" style={{ justifyContent: "center", alignItems: "center" }}>
        <p className="subtitle">Loading…</p>
      </div>
    );
  }
  return <>{children}</>;
}
