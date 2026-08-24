"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import Icon from "@/components/ui/Icons";

type Status = "idle" | "loading" | "success" | "error";

const SUCCESS_MESSAGE =
  "If an account exists with this email, a password reset link has been sent.";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Forgot password · FinSight";
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStatus("loading");

    try {
      const res = await fetch("/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        code?: string;
        retryAfterSeconds?: number;
      };

      if (!res.ok) {
        if (res.status === 429) {
          const wait = data.retryAfterSeconds
            ? ` Please wait about ${Math.ceil(data.retryAfterSeconds / 60)} minute(s) and try again.`
            : " Please try again later.";
          throw new Error(data.error ?? "Too many requests." + wait);
        }
        throw new Error(data.error ?? "Something went wrong. Please try again.");
      }

      setMessage(data.message ?? SUCCESS_MESSAGE);
      setStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  return (
    <AuthShell
      eyebrow="Password help"
      title="Forgot your password?"
      subtitle="Enter the email you signed up with and we'll send you a reset link."
    >
      {status === "success" ? (
        <div className="text-center animate-fade-up">
          <span
            className="inline-flex h-14 w-14 rounded-2xl items-center justify-center mb-4"
            style={{ background: "#10b9811a", color: "#10b981" }}
          >
            <Icon name="check" size={26} />
          </span>
          <h2 className="text-lg font-bold text-snow">Check your inbox</h2>
          <p className="text-sm text-slate mt-2 leading-relaxed">{message}</p>
          <p className="text-[13px] text-muted mt-3 leading-relaxed">
            The reset link expires in 30 minutes. If you don&apos;t see the email, check your
            spam folder.
          </p>
          <Link href="/login" className="btn btn-primary w-full mt-6">
            Back to log in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="block text-sm uppercase tracking-widest text-slate mb-1.5 font-medium">
              Email
            </span>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
            />
          </label>

          {error && (
            <p className="text-sm text-danger flex items-start gap-2">
              <Icon name="alert" size={15} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}

          <button disabled={status === "loading"} className="btn btn-primary w-full !py-3.5">
            {status === "loading" ? "Sending…" : "Send reset link"}
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
