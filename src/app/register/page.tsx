"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import AuthShell from "@/components/AuthShell";
import Icon from "@/components/ui/Icons";
import { validatePassword } from "@/lib/auth/passwordPolicy";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = "Create account · FinSight";
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const weak = validatePassword(password);
    if (weak) {
      setError(weak);
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          ...(dateOfBirth ? { date_of_birth: dateOfBirth } : {}),
        },
        emailRedirectTo: `${window.location.origin}/verify`,
      },
    });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(`/verify?email=${encodeURIComponent(email)}`);
  }

  return (
    <AuthShell
      eyebrow="New account"
      title="Create your account"
      subtitle="Set up FinSight in under a minute."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="block text-sm uppercase tracking-widest text-slate mb-1.5 font-medium">
            Full name
          </span>
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="field"
            placeholder="Asha Rao"
            autoComplete="name"
          />
        </label>
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
          />
        </label>
        <label className="block">
          <span className="block text-sm uppercase tracking-widest text-slate mb-1.5 font-medium">
            Password
          </span>
          <input
            required
            minLength={8}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
        </label>
        <label className="block">
          <span className="block text-sm uppercase tracking-widest text-slate mb-1.5 font-medium">
            Date of birth <span className="text-muted font-normal">(optional)</span>
          </span>
          <input
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            className="field"
            max={new Date().toISOString().split("T")[0]}
            autoComplete="bday"
          />
          <p className="text-[12px] text-muted mt-1">
            We&apos;ll wish you a happy birthday on your special day!
          </p>
        </label>

        {error && (
          <p className="text-sm text-danger flex items-center gap-2">
            <Icon name="alert" size={15} /> {error}
          </p>
        )}

        <button disabled={loading} className="btn btn-primary w-full !py-3.5">
          {loading ? "Creating…" : "Create account"}
        </button>
      </form>

      <div className="mt-6 pt-5 border-t border-line text-center">
        <p className="text-sm text-slate">
          Already have an account?{" "}
          <Link href="/login" className="text-accent font-semibold hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
