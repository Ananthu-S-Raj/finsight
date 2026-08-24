"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import AuthShell from "@/components/AuthShell";
import Icon from "@/components/ui/Icons";
import { haptic } from "@/lib/haptics";

function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resent, setResent] = useState(false);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    document.title = "Verify email · FinSight";
  }, []);

  // If the user arrived via a confirmation link, Supabase's detectSessionInUrl
  // (enabled by default) will have already exchanged the tokens in the URL hash
  // for a session.  Detect that and redirect straight to the dashboard.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      if (session) {
        setVerified(true);
        haptic("success");
        router.replace("/dashboard");
      }
    });
    return () => {
      active = false;
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "signup",
    });

    setLoading(false);
    if (error) {
      setError(
        error.message.includes("code") ? "That code didn't work. Check and try again." : error.message
      );
      return;
    }
    haptic("success");
    router.push("/dashboard");
  }

  async function resend() {
    setError("");
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) setError(error.message);
    else setResent(true);
  }

  if (verified) return null;

  return (
    <AuthShell
      eyebrow="Verify it's you"
      title="Enter the code"
      subtitle={
        <>
          We sent a 6-digit code to <span className="font-mono text-frost">{email}</span>.
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
          className="field text-center text-3xl tracking-[0.5em] font-semibold tabular"
          maxLength={6}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          autoFocus
          placeholder="000000"
          aria-label="6-digit verification code"
        />
        {error && (
          <p className="text-sm text-danger flex items-center gap-2">
            <Icon name="alert" size={15} /> {error}
          </p>
        )}
        <button disabled={loading} className="btn btn-primary w-full !py-3.5">
          {loading ? "Checking…" : "Verify & continue"}
        </button>
      </form>

      <div className="mt-5 flex items-center justify-between">
        <button onClick={resend} className="text-sm text-accent font-semibold hover:underline">
          Resend code
        </button>
        {resent && (
          <span className="text-sm text-slate flex items-center gap-1.5">
            <Icon name="check" size={14} className="text-accent" /> Sent — check your inbox
          </span>
        )}
      </div>
    </AuthShell>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyForm />
    </Suspense>
  );
}
