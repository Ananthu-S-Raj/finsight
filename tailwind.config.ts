import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--bg)",
        ink2: "var(--bg-2)",
        ink3: "var(--surface-elevated)",
        line: "var(--line)",
        glass: "var(--glass)",
        glasshi: "var(--glass-hi)",
        accent: "var(--accent)",
        accent2: "var(--accent-2)",
        warn: "var(--warn)",
        danger: "var(--danger)",
        slate: "var(--text-secondary)",
        snow: "var(--text-primary)",
        frost: "var(--text-secondary)",
        muted: "var(--text-muted)",
        card: "var(--surface)",
        tint: "var(--tint)",
        tintHi: "var(--tint-hi)",
        surface: "var(--surface)",
        scrim: "var(--scrim)",
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glass: "var(--shadow-glass)",
        "glass-lg": "var(--shadow-glass-lg)",
        "neo": "var(--shadow-neo)",
        "neo-inset": "var(--shadow-neo-inset)",
        "glow-accent": "0 0 0 1px rgba(16,185,129,0.35), 0 8px 32px -8px rgba(16,185,129,0.5)",
        "glow-indigo": "0 0 0 1px rgba(99,102,241,0.35), 0 8px 32px -8px rgba(99,102,241,0.5)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.92)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "ring-soft": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(16,185,129,0.35)" },
          "50%": { boxShadow: "0 0 0 8px rgba(16,185,129,0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s cubic-bezier(0.16,1,0.3,1) both",
        "fade-in": "fade-in 0.3s ease-out both",
        "scale-in": "scale-in 0.2s cubic-bezier(0.16,1,0.3,1) both",
        "ring-soft": "ring-soft 2.4s ease-out infinite",
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};
export default config;
