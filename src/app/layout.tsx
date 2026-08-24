import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import InstallAppPrompt from "@/components/InstallAppPrompt";
import StartupSplash from "@/components/StartupSplash";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { QuickAddProvider } from "@/components/QuickAddContext";
import ThemeProvider from "@/components/ThemeProvider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: {
    default: "FinSight — Smart money, beautifully simple",
    template: "%s · FinSight",
  },
  description:
    "A premium personal finance tracker. Track spending, savings, budgets and credit cards in one place.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FinSight",
  },
  applicationName: "FinSight",
};

export const viewport: Viewport = {
  themeColor: "#0B0F14",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

const THEME_SCRIPT = `
(function () {
  try {
    var key = "finsight:settings";
    var raw = localStorage.getItem(key);
    var theme = "system";
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && (parsed.theme === "dark" || parsed.theme === "light" || parsed.theme === "system")) {
        theme = parsed.theme;
      }
    }
    var resolved = theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : theme;
    var html = document.documentElement;
    html.setAttribute("data-theme", resolved);
    html.style.colorScheme = resolved;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = resolved === "light" ? "#F8FAFC" : "#0B0F14";
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The nonce is generated per request by middleware and stamped onto the two
  // app-owned inline scripts below. Next.js reads the same value from the CSP
  // header and applies it to its own inline scripts/styles and page bundles.
  // Calling headers() also opts every route into dynamic rendering, which
  // nonce-based CSP requires.
  const nonce = headers().get("x-nonce") ?? undefined;

  return (
    <html lang="en" className={`${inter.variable} scroll-smooth`}>
      <body className="font-sans text-snow min-h-dvh antialiased overflow-x-hidden">
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <div className="aurora" aria-hidden="true" />
        <ThemeProvider>
          <ToastProvider>
            <QuickAddProvider>
              {children}
              <InstallAppPrompt />
            </QuickAddProvider>
          </ToastProvider>
        </ThemeProvider>
        <StartupSplash />
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js');
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
