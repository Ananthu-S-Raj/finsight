"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "./supabaseClient";
import { decodeJwtPayload } from "./jwt";

/** Returns the signed-in user id, redirecting to /login if needed. */
export function useRequireAuth(): string | null {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (!data.session) {
        router.replace("/login");
        return;
      }

      // Session-freshness guard: a session issued before the password was
      // last changed is stale (e.g. after a password reset). It is signed
      // out immediately so old tokens cannot keep using the app.
      const stale = await isStaleSession(data.session.access_token).catch(() => false);
      if (!active) return;
      if (stale) {
        await supabase.auth.signOut().catch(() => {});
        router.replace("/login");
        return;
      }

      setUserId(data.session.user.id);
    });
    return () => {
      active = false;
    };
  }, [router]);

  return userId;
}

async function isStaleSession(accessToken: string): Promise<boolean> {
  const payload = decodeJwtPayload(accessToken);
  const iat = payload?.iat;
  if (typeof iat !== "number") return false;

  const { data, error } = await supabase
    .from("profiles")
    .select("password_changed_at")
    .eq("id", payload?.sub ?? "")
    .maybeSingle();
  if (error || !data?.password_changed_at) return false;

  const changedAt = new Date(data.password_changed_at as string).getTime();
  if (!Number.isFinite(changedAt)) return false;
  return iat * 1000 < changedAt;
}
