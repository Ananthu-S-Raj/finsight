"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import Icon from "@/components/ui/Icons";
import PasswordStrength from "@/components/PasswordStrength";
import { supabase } from "@/lib/supabaseClient";

type Status = "idle" | "loading" | "success" | "error";

function ResetPasswordForm() {
  const params = useSearchParams();
  // Supabase recovery links carry the one-time code as `token_hash`
  // (with `type=recovery`). `token` is accepted as a fallback.
  const token = params.get("token_hash") ?? params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [matchError, setMatchError] = useState("");

  useEffect(() => {
    document.title = "Reset password · FinSight";
  }, []);

  const missingToken = !token;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMatchError("");

    if (password !== confirm) {
      setMatchError("Passwords don't match.");
      return;
    }

    setStatus("loading");
    try {
      const res = await fetch("/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        code?: string;
      };

      if (!res.ok) {
        // Drop any session that may be lingering in this browser.
        await supabase.auth.signOut().catch(() => {});
        if (data.code === "weak_password") {
          throw new Error(data.error ?? "That password doesn't meet the requirements.");
        }
        if (data.code === "rate_limited") {
          throw new Error(data.error ?? "Too many attempts. Please try again later.");
        }
        if (data.code === "invalid_token" || res.status === 400) {
          throw new Error(
            data.error ??
              "This reset link is invalid, has expired, or has already been used."
          );
        }
        throw new Error(data.error ?? "Something went wrong. Please try again.");
      }

      setMessage(data.message ?? "Password reset successful.");
      setStatus("success");
      // The reset invalidated every session, including any lingering in this
      // browser. Clear it so the user lands on a clean login.
      await supabase.auth.signOut().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  return (
    <AuthShell
      eyebrow="Reset password"
      title="Create a new password"
      subtitle="Choose a strong password for your FinSight account."
    >
      {missingToken ? (
        <div className="text-center animate-fade-up">
          <span
            className="inline-flex h-14 w-14 rounded-2xl items-center justify-center mb-4 text-danger"
            style={{ background: "#ef44441a" }}
          >
            <Icon name="alert" size={26} />
          </span>
          <h2 className="text-lg font-bold text-snow">This link is invalid or has expired</h2>
          <p className="text-sm text-slate mt-2 leading-relaxed">
            Password reset links expire after 30 minutes and can only be used once.
          </p>
          <Link href="/forgot-password" className="btn btn-primary w-full mt-6">
            Request a new link
          </Link>
          <Link href="/login" className="btn w-full mt-2.5">
            Back to log in
          </Link>
        </div>
      ) : status === "success" ? (
        <div className="text-center animate-fade-up">
          <span
            className="inline-flex h-14 w-14 rounded-2xl items-center justify-center mb-4"
            style={{ background: "#10b9811a", color: "#10b981" }}
          >
            <Icon name="check" size={26} />
          </span>
          <h2 className="text-lg font-bold text-snow">Password updated</h2>
          <p className="text-sm text-slate mt-2 leading-relaxed">{message}</p>
          <p className="text-[13px] text-muted mt-3">
            Old sessions have been signed out for your security.
          </p>
          <Link href="/login" className="btn btn-primary w-full mt-6">
            Log in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <label className="block">
            <span className="block text-sm uppercase tracking-widest text-slate mb-1.5 font-medium">
              New password
            </span>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field"
              placeholder="At least 8 characters"
              autoComplete="new-password"
              minLength={8}
            />
            <PasswordStrength password={password} />
          </label>

          <label className="block">
            <span className="block text-sm uppercase tracking-widest text-slate mb-1.5 font-medium">
              Confirm new password
            </span>
            <input
              required
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="field"
              placeholder="Repeat your new password"
              autoComplete="new-password"
            />
          </label>

          {matchError && (
            <p className="text-sm text-danger flex items-center gap-2">
              <Icon name="alert" size={15} /> {matchError}
            </p>
          )}
          {error && (
            <p className="text-sm text-danger flex items-start gap-2">
              <Icon name="alert" size={15} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}

          <button disabled={status === "loading"} className="btn btn-primary w-full !py-3.5">
            {status === "loading" ? "Updating…" : "Reset password"}
          </button>

          <div className="pt-2 border-t border-line text-center">
            <p className="text-sm text-slate">
              Remembered it?{" "}
              <Link href="/login" className="text-accent font-semibold hover:underline">
                Log in
              </Link>
            </p>
          </div>
        </form>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
