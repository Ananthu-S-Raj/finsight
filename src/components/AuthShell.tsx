"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "./ui/Icons";

export default function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md animate-fade-up">
        <div className="flex flex-col items-center mb-8">
          <Link href="/" className="text-accent inline-flex glass rounded-2xl p-3.5 mb-4" aria-label="FinSight home">
            <Logo size={28} />
          </Link>
          <p className="text-[13px] uppercase tracking-[0.3em] text-slate font-semibold mb-1.5">
            {eyebrow}
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-snow">{title}</h1>
          {subtitle && <p className="text-sm text-slate mt-1.5 text-center">{subtitle}</p>}
        </div>

        <div className="glass rounded-3xl p-6 sm:p-8 shadow-glass-lg">{children}</div>

        {footer && <div className="text-center mt-6">{footer}</div>}
      </div>
    </main>
  );
}
