"use client";

import type { ReactNode } from "react";
import { useSettings } from "@/lib/settings";

/**
 * Applies the persisted theme preference (dark/light/system) at the root and
 * keeps it in sync with OS color-scheme changes. Mounted once in the layout;
 * the theme is also applied pre-hydration by an inline script to avoid FOUC.
 */
export default function ThemeProvider({ children }: { children: ReactNode }) {
  useSettings();
  return <>{children}</>;
}
