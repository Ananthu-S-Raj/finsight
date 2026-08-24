"use client";

import { useEffect, useRef, useState } from "react";
import { useOnline } from "@/lib/hooks";
import Icon from "./ui/Icons";

type Status = "online" | "offline" | "syncing";

export default function OfflineIndicator() {
  const online = useOnline();
  const [status, setStatus] = useState<Status>(online ? "online" : "offline");
  const [visible, setVisible] = useState(false);
  const lastOnline = useRef(online);

  useEffect(() => {
    if (!online && lastOnline.current) {
      setStatus("offline");
      setVisible(true);
    } else if (online && !lastOnline.current) {
      setStatus("syncing");
      setVisible(true);
      const t = window.setTimeout(() => setStatus("online"), 1600);
      const t2 = window.setTimeout(() => setVisible(false), 2600);
      return () => {
        window.clearTimeout(t);
        window.clearTimeout(t2);
      };
    }
    lastOnline.current = online;
  }, [online]);

  if (!visible) return null;

  const meta =
    status === "offline"
      ? { icon: "wifiOff" as const, text: "Offline", color: "#f59e0b" }
      : status === "syncing"
        ? { icon: "sync" as const, text: "Syncing…", color: "#6366f1" }
        : { icon: "check" as const, text: "Back online", color: "#10b981" };

  return (
    <div className="fixed top-0 inset-x-0 z-[90] flex justify-center pointer-events-none safe-top" style={{ top: "calc(var(--safe-top) + 10px)" }}>
      <div
        className="glass-elevated rounded-full px-4 py-1.5 flex items-center gap-2 animate-fade-up shadow-glass"
        role="status"
      >
        <span
          className={`h-2 w-2 rounded-full ${status === "syncing" ? "animate-pulse-soft" : ""}`}
          style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}` }}
        />
        <span className="text-[13px] font-semibold text-snow">{meta.text}</span>
        <Icon name={meta.icon} size={13} className="text-slate" />
      </div>
    </div>
  );
}
