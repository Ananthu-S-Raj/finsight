"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Logo } from "@/components/ui/Icons";

export default function Home() {
  const router = useRouter();
  const [message, setMessage] = useState("Opening FinSight…");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      router.replace(data.session ? "/dashboard" : "/login");
    });
  }, [router]);

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-5 px-4">
      <div className="relative">
        <div
          className="absolute inset-0 rounded-3xl"
          style={{
            background: "radial-gradient(circle, rgba(16,185,129,0.35), transparent 70%)",
            filter: "blur(20px)",
          }}
        />
        <span className="relative text-accent inline-flex glass rounded-2xl p-5">
          <Logo size={40} />
        </span>
      </div>
      <p className="text-xl font-bold tracking-tight text-snow">
        Fin<span className="text-accent">Sight</span>
      </p>
      <p className="text-sm text-slate animate-pulse-soft">{message}</p>
    </main>
  );
}
