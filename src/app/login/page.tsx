"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import AuthShell from "@/components/AuthShell";
import Icon from "@/components/ui/Icons";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = "Log in · FinSight";
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (error) {
      setError(
        error.message.includes("Invalid login") || error.message.includes("bad")
          ? "That email or password doesn't match."
          : error.message
      );
      return;
    }
    router.push("/dashboard");
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Log in"
      subtitle="Your money, in focus."
    >
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
            autoComplete="email"
          />
        </label>
        <label className="block">
          <span className="block text-sm uppercase tracking-widest text-slate mb-1.5 font-medium">
            Password
          </span>
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
            autoComplete="current-password"
          />
        </label>

        {error && (
          <p className="text-sm text-danger flex items-center gap-2">
            <Icon name="alert" size={15} /> {error}
          </p>
        )}

        <button disabled={loading} className="btn btn-primary w-full !py-3.5">
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>

      <div className="mt-4 text-center">
        <Link
          href="/forgot-password"
          className="text-sm text-accent font-semibold hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      <div className="mt-6 pt-5 border-t border-line text-center">
        <p className="text-sm text-slate">
          New here?{" "}
          <Link href="/register" className="text-accent font-semibold hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
