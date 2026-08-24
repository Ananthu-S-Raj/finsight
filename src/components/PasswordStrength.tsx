"use client";

import {
  checkPasswordRequirements,
  passwordStrengthLabel,
  scorePassword,
} from "@/lib/auth/passwordPolicy";

const BAR_COLORS = ["#ef4444", "#f59e0b", "#eab308", "#10b981", "#10b981"];

/** Password strength meter + requirements checklist (design-system aware). */
export default function PasswordStrength({ password }: { password: string }) {
  const score = scorePassword(password);
  const label = passwordStrengthLabel(score);
  const requirements = checkPasswordRequirements(password);
  const color = BAR_COLORS[score];

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-full transition-colors duration-200"
            style={{
              background: i < score ? color : "var(--tint-hi)",
            }}
          />
        ))}
        <span
          className="ml-2 text-xs font-semibold shrink-0"
          style={{ color: password ? color : "var(--text-muted)" }}
        >
          {password ? label : ""}
        </span>
      </div>

      <ul className="space-y-1">
        {requirements.map((req) => (
          <li
            key={req.id}
            className="flex items-center gap-2 text-[13px]"
            style={{ color: req.met ? "var(--accent)" : "var(--text-muted)" }}
          >
            <span
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
              style={{
                background: req.met ? "var(--accent)" : "var(--tint-hi)",
                color: req.met ? "#04140d" : "var(--text-muted)",
              }}
            >
              {req.met ? "✓" : ""}
            </span>
            {req.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
