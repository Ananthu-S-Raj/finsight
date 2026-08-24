"use client";

import type { SVGProps } from "react";

export type IconName =
  | "logo"
  | "home"
  | "transactions"
  | "analytics"
  | "budgets"
  | "card"
  | "lend"
  | "bell"
  | "profile"
  | "admin"
  | "settings"
  | "plus"
  | "eye"
  | "eyeOff"
  | "wallet"
  | "income"
  | "expense"
  | "transfer"
  | "trash"
  | "edit"
  | "copy"
  | "tag"
  | "close"
  | "check"
  | "chevronRight"
  | "chevronLeft"
  | "search"
  | "wifiOff"
  | "sync"
  | "download"
  | "lock"
  | "globe"
  | "refresh"
  | "alert"
  | "trendUp"
  | "trendDown"
  | "calendar"
  | "bank"
  | "coins"
  | "piggy"
  | "target"
  | "sparkles"
  | "filter"
  | "shield"
  | "logOut"
  | "info"
  | "sun"
  | "phone"
  | "creditCard"
  | "arrowUpRight"
  | "bellOff"
  | "menu"
  | "chart"
  | "volume"
  | "recurring"
  | "pause"
  | "play";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
  label?: string;
}

const PATHS: Record<IconName, React.ReactNode> = {
  logo: (
    <path d="M12 3 L19 8 L19 16 L12 21 L5 16 L5 8 Z M12 7.5 L14.5 12 L12 16.5 L9.5 12 Z" />
  ),
  home: <path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />,
  transactions: (
    <>
      <path d="M4 7h13M13 3l4 4-4 4" />
      <path d="M20 17H7m4 4-4-4 4-4" />
    </>
  ),
  analytics: (
    <>
      <path d="M3 21h18" />
      <path d="M5 17v-6M10 17V7M15 17v-9M20 17V4" />
    </>
  ),
  budgets: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" />
    </>
  ),
  card: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <path d="M2.5 10h19M6.5 15h4" />
    </>
  ),
  creditCard: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <path d="M2.5 10h19M6.5 15h4" />
    </>
  ),
  lend: (
    <>
      <path d="M7 8a4 4 0 1 0 0 8M7 8a4 4 0 1 1 0 8M7 8v2m0 4v-2" />
      <path d="M14.5 11c1.4 0 2.5-.9 2.5-2S15.9 7 14.5 7c-1 0-1.9.5-2.3 1.3M14.5 13c-1 0-1.9-.5-2.3-1.3" />
      <path d="M14 6v2m0 6v-2" />
      <circle cx="5.5" cy="12" r="0.4" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9.5A6 6 0 0 1 18 9.5c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  bellOff: (
    <>
      <path d="M6 9.5A6 6 0 0 1 18 9.5c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
      <path d="M3 3l18 18" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </>
  ),
  admin: (
    <>
      <path d="M12 3 4 6v5c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6l-8-3Z" />
      <path d="m9.2 12 2 2 3.6-4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6m13.2 0h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.3A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.7 17.7 0 0 1-2.7 3.6M6.2 6.5C4 8.2 2.5 12 2.5 12S6 18.5 12 18.5c1 0 2-.1 2.9-.4" />
      <path d="M9.9 9.9A3 3 0 0 0 14 14" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19a1 1 0 0 1 1 1v1" />
      <path d="M3 7.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2" />
      <path d="M16 13.5h.01" />
    </>
  ),
  income: (
    <>
      <path d="M12 20V5m0 0-5 5m5-5 5 5" />
      <path d="M4 20h16" />
    </>
  ),
  expense: (
    <>
      <path d="M12 4v15m0 0 5-5m-5 5-5-5" />
      <path d="M4 4h16" />
    </>
  ),
  transfer: (
    <>
      <path d="M4 7h13M13 3l4 4-4 4" />
      <path d="M20 17H7m4 4-4-4 4-4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-.8 12.2a2 2 0 0 1-2 1.8H8.8a2 2 0 0 1-2-1.8L6 7" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17l-1 4Z" />
      <path d="m13.5 6.5 3 3" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
    </>
  ),
  tag: (
    <>
      <path d="M3 12.5V5a2 2 0 0 1 2-2h7.5L21 11.5l-7.5 7.5L3 12.5Z" />
      <circle cx="8" cy="8" r="1.2" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  wifiOff: (
    <>
      <path d="M2 8.5a15 15 0 0 1 20 0M5 12a10.5 10.5 0 0 1 14 0M8.5 15.5a5.8 5.8 0 0 1 7 0" />
      <circle cx="12" cy="19" r="0.6" />
      <path d="M2 2l20 20" />
    </>
  ),
  sync: (
    <>
      <path d="M20 11A8 8 0 0 0 6 6.5L4 9" />
      <path d="M4 4v5h5" />
      <path d="M4 13a8 8 0 0 0 14 4.5l2-2.5" />
      <path d="M20 20v-5h-5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m0 0 5-5m-5 5-5-5" />
      <path d="M4 19h16" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
      <circle cx="12" cy="15.2" r="1.4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11A8 8 0 0 0 6 6.5L4 9" />
      <path d="M4 4v5h5" />
      <path d="M4 13a8 8 0 0 0 14 4.5l2-2.5" />
      <path d="M20 20v-5h-5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 21 20H3L12 3.5Z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17" r="0.5" />
    </>
  ),
  trendUp: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  trendDown: <path d="M3 7l6 6 4-4 8 8M15 17h6v-6" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 10h17M8 3v4m8-4v4" />
    </>
  ),
  bank: (
    <>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 10v7M9.5 10v7M14.5 10v7M19 10v7" />
      <path d="M4 19.5h16" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="8" cy="6.5" rx="5" ry="2.7" />
      <path d="M3 6.5v5c0 1.5 2.2 2.7 5 2.7s5-1.2 5-2.7v-5" />
      <path d="M13 12.3c3.2.2 5 1.4 5 2.7s-2.2 2.7-5 2.7" />
      <path d="M8 14.2v0c3.6 0 8 1.4 8 3.8" />
    </>
  ),
  piggy: (
    <>
      <path d="M20 8.5c-1.6-1.6-5-2.5-8-2.5-4.4 0-8 1.8-8 4v6.5c0 2.2 3.6 4 8 4s8-1.8 8-4" />
      <path d="M12 3v3M4 12h16" />
      <path d="M16.5 10.5c-.8-.8-2.2-1.3-4.5-1.3-2.3 0-3.7.5-4.5 1.3" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 4c1 2.2 2.8 4 5 5-2.2 1-4 2.8-5 5-1-2.2-2.8-4-5-5 2.2-1 4-2.8 5-5Z" />
      <path d="M18.5 13c.5 1.2 1.4 2.1 2.5 2.5-1.1.4-2 1.3-2.5 2.5-.5-1.2-1.4-2.1-2.5-2.5 1.1-.4 2-1.3 2.5-2.5Z" />
    </>
  ),
  filter: (
    <>
      <path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4 6v5c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6l-8-3Z" />
      <path d="m9.2 12 2 2 3.6-4" />
    </>
  ),
  logOut: (
    <>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="m16 16 4-4-4-4M20 12H9" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
    </>
  ),
  phone: (
    <>
      <path d="M5 4h4l1.5 4L8 9.5a12 12 0 0 0 6.5 6.5L17 13.5l4 1.5v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
    </>
  ),
  arrowUpRight: <path d="M7 17 17 7M8 7h9v9" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  chart: (
    <>
      <path d="M3 21h18" />
      <path d="M5 17v-6M10 17V7M15 17v-9M20 17V4" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M16 9a4 4 0 0 1 0 6" />
    </>
  ),
  recurring: (
    <>
      <path d="M4 10.5a8 8 0 0 1 13.6-3.2L20 9.8" />
      <path d="M20 4.5v5h-5" />
      <path d="M20 13.5a8 8 0 0 1-13.6 3.2L4 14.2" />
      <path d="M4 19.5v-5h5" />
    </>
  ),
  pause: (
    <>
      <rect x="7" y="4.5" width="3.4" height="15" rx="1.5" />
      <rect x="13.6" y="4.5" width="3.4" height="15" rx="1.5" />
    </>
  ),
  play: <path d="M7 4.5v15l12-7.5L7 4.5Z" />,
};

export default function Icon({ name, size = 20, label, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Brand wordmark mark used in the sidebar / splash. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="relative inline-flex items-center justify-center">
      <Icon name="logo" size={size} />
      <span className="absolute inline-flex h-full w-full items-center justify-center">
        <span
          className="rounded-full"
          style={{
            width: size * 0.22,
            height: size * 0.22,
            background: "linear-gradient(135deg,#10b981,#6366f1)",
            boxShadow: "0 0 12px rgba(16,185,129,0.8)",
          }}
        />
      </span>
    </span>
  );
}
